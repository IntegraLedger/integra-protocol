/**
 * Stellar rail pieces: the payer-signed Soroban `transfer` and the authorization entry that signs it, the digest of
 * that entry, the signed-payload precondition over H (`stellar-position.ts` writes and reads its 40-byte payload), the
 * events that show what moved, the search for a buyer's acts through a bounded reader, and the read of the agreement
 * `x402/exact/stellar/precondition`. XDR and hashing use the base part of @stellar/stellar-sdk, loaded once when this
 * module is; without it every function that needs it refuses `stellar/peer-missing`, after the checks that need no
 * peer (an envelope's network, size, base64 and union tags, an event's form, a strkey), which give the codes they give
 * with it. Strkeys (`G…`, `C…` and `M…`) are read and written without it (`stellar-strkey.ts`). The public names are
 * re-exported by `../stellar.ts`.
 */
import type * as StellarBase from "@stellar/stellar-sdk/base";
import type {
  HashIdPreimageWire,
  InvokeContractArgsWire,
  InvokeHostFunctionOpWire,
  MuxedAccountWire,
  ScAddressWire,
  ScValWire,
  SorobanAddressCredentialsWire,
  SorobanAuthorizationEntryWire,
  TransactionEnvelopeWire,
  TransactionV1EnvelopeWire,
} from "@stellar/stellar-sdk/xdr";
import { toRawBytes, type AtrHash } from "../core.js";
import { isObject, normalHash } from "../fields.js";
import type { Hex } from "../evm.js";
import { fromBase64, toBase64 } from "../rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import {
  decide,
  type Facts,
  type Moved,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type Undecoded,
  type UnreadableReason,
} from "./read.js";
import { bigintOrder, isQuery, ledgerOf } from "./read-ledger.js";
import { isLedgerSequence, lastPositionOf, parseStellarPosition, readSignedPayload, stellarPosition } from "./stellar-position.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";
import { accountKey, contractId, isAccount, isContract, unmux } from "./stellar-strkey.js";

export { isAccount, isContract, unmux };

const peer: typeof StellarBase | undefined = await import("@stellar/stellar-sdk/base").then(
  (m) => m,
  () => undefined,
);

export type StellarNetwork = "stellar:pubnet" | "stellar:testnet";

/** Each network's passphrase; its SHA-256 is the network id. */
export const PASSPHRASE: Readonly<Record<StellarNetwork, string>> = Object.freeze({
  "stellar:pubnet": "Public Global Stellar Network ; September 2015",
  "stellar:testnet": "Test SDF Network ; September 2015",
});

export const MAX_XDR = 8192;
/**
 * The deepest nesting of ScVal vectors and maps (a contract instance's storage counting as a map) within one ScVal,
 * the outermost container being level 1, and of authorized invocations within one authorization entry, the root
 * invocation being level 1. It bounds what is read of an envelope, the operation and the payer's authorization entry,
 * and an event's topics and data. It does not apply to the rest of an envelope (another authorization entry, a
 * delegate, the footprint, another operation), which is decoded whatever its depth, so nesting there does not make the
 * envelope unreadable.
 */
export const SCVAL_MAX_DEPTH = 64;
/**
 * The schema levels js-xdr may enter to read or write an envelope: more than any envelope of at most `MAX_XDR`
 * characters reaches, so the decoder's own depth refuses none of them. js-xdr enters one level for each union, struct,
 * array, fixed array, optional value and named type it reads. `MAX_XDR` characters are at most 6,144 bytes, and in
 * @stellar/stellar-sdk 17.2.1's XDR each pass through a recursive type enters these levels in at least these bytes: a
 * contract instance in the storage of the one above, 8 in 20 (the most levels per byte); a map, 6 in 16; a vector, 4
 * in 12; a claim predicate, 3 in 8; an authorized invocation, 3 in 20; a delegate, 3 in 44. Every path through the
 * envelope's other types enters at most 37 levels. So no envelope reaches more than 37 + ⌊6,144 × 8 / 20⌋ = 2,494
 * levels, and this value is that bound rounded up to the next hundred, 6 levels above it. The deepest envelope of
 * `MAX_XDR` characters reaches 2,427: contract instances, each in the storage of the one above, as a contract
 * creation's constructor argument. js-xdr's default depth, 1,500, is below the bound.
 */
export const XDR_MAX_DEPTH = 2500;
/** The events pages one search reads in one call. */
export const MAX_PAGES = 10;
/**
 * The candidate transactions one search reads in one call. Any contract can emit an event naming the buyer, so a
 * stranger can fill it; a search that reaches it is not read through, and resumes at the position it returns.
 */
export const MAX_CANDIDATES = 50;
/** The symbols read here, as bytes: a symbol is compared byte for byte, so one led by a byte-order mark is another. */
const symbol = (s: string): Uint8Array => new TextEncoder().encode(s);
const TRANSFER = symbol("transfer");
const BURN = symbol("burn");
const MINT = symbol("mint");
const AMOUNT_KEY = symbol("amount");
const TO_MUXED_ID = symbol("to_muxed_id");
const PUBLIC_KEY = symbol("public_key");

export function isStellarNetwork(s: unknown): s is StellarNetwork {
  return s === "stellar:pubnet" || s === "stellar:testnet";
}

export interface StellarPayment {
  asset: string;
  from: string;
  to: string;
  toBase: string;
  toId: bigint | null;
  amount: bigint;
  auth: { address: string; nonce: bigint; expiration: number; v2: boolean; preimageHash: Hex };
}

/** One event `getEvents` answers, as the reader gives it. */
export interface StellarEventRow {
  /** The RPC's event id: the operation's TOID in 19 decimal digits, `-`, and the event's index in 10. */
  readonly id: string;
  readonly ledger: number;
  readonly txHash: string;
  /** The contract that emitted it, a `C…` strkey. */
  readonly contractId: string;
  /** Its topics, each the base64 XDR of an ScVal. */
  readonly topic: readonly string[];
  /** Its data, the base64 XDR of an ScVal. */
  readonly value: string;
}

/**
 * Bounded, read-only calls against one network's Stellar RPC. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`: a `ReaderError` reads by its kind (`too-large` as `too-large`, `malformed` as
 * `unparseable`), and any other rejection as `transport`. A throttled call is retried by the reader, never answered as
 * absence.
 */
export interface StellarReader {
  /** `getNetwork`: the network's passphrase. */
  passphrase(): Promise<string>;
  /** `getLatestLedger`: the latest closed ledger's sequence, and its close time in Unix seconds where the RPC gives it. */
  latestLedger(): Promise<{ sequence: number; closeTime?: number }>;
  /**
   * `getTransaction`: its status, and, where it was included, its envelope, its ledger and its application order in
   * that ledger; with the oldest and latest ledgers the RPC holds.
   */
  transaction(hash: string): Promise<{
    status: "SUCCESS" | "FAILED" | "NOT_FOUND";
    envelopeXdr?: string;
    ledger?: number;
    applicationOrder?: number;
    oldestLedger: number;
    latestLedger: number;
  }>;
  /**
   * One page of `getEvents` of contract events on every contract, by a filter that names no contract and holds
   * `topics`, each a topic filter of base64 XDR segments, `*` and `**`, from `fromLedger` through `toLedger`, both
   * inclusive. `cursor` is present while more pages remain: until the RPC has scanned through `toLedger`, or through its
   * own `latestLedger` where that is lower. Stellar RPC's `getEvents` treats `endLedger` as exclusive and takes a cursor
   * or a ledger range but not both, so a reader over it sends `startLedger: fromLedger` and `endLedger: toLedger + 1` on
   * the first page and only the cursor on later pages, and keeps only the events through `toLedger`.
   */
  events(f: {
    fromLedger: number;
    toLedger: number;
    topics: readonly (readonly string[])[];
    cursor?: string;
  }): Promise<{ events: readonly StellarEventRow[]; cursor?: string; oldestLedger: number; latestLedger: number }>;
  /** `getLedgerEntries` of an account: its sequence number, or null where the account does not exist. */
  sequence?(account: string): Promise<bigint | null>;
}

/**
 * The read keys `reference` returns for `x402/exact/stellar/precondition`: the
 * network; the option's payee (`payTo`), the key of the read's two party tests; the buyer; the asset and the `to` base
 * account of the transfer the buyer's entry signs; that entry's nonce (an `int64` in decimal), its expiration ledger and
 * the SHA-256 of its `HashIDPreimage` (`authDigest`, `0x` and 64 lowercase hex digits), which names the entry under any
 * envelope; and the 40-byte payload as presented (`0x` and 80 lowercase hex digits), whose first 32 bytes are H.
 */
export interface StellarRef {
  network: StellarNetwork;
  payee: string;
  buyer: string;
  asset: string;
  toBase: string;
  nonce: string;
  expiration: number;
  authDigest: Hex;
  payload: string;
}

/** What the caller adds to the reference for `stellarStatus`: `fromLedger`, the ledger the search starts from, the ledger recorded at issue. */
export interface StellarLanded {
  fromLedger: number;
}

/** The one mark: a transaction in a closed ledger, which is final. */
export type StellarMark = "finalized";

/**
 * What `stellarStatus` takes beside the reference and the reader: the act, the finality, and, where the caller gives
 * them, `after`, the ledger sequence a transaction must come after (one in that ledger or below answers
 * `before-position`), `search`, the position an earlier answer returned, and the other acts under the same H.
 */
export type StellarQuery = Omit<StatusQuery<StellarRef, string, StellarMark, string>, "after"> & { readonly after?: number };

/**
 * The answer of `stellarStatus`: positions, and the search position, are positions P (`stellar-position.ts`), and the
 * one mark is `finalized`.
 */
export type StellarStatus = StatusAnswer<string, StellarMark, string>;

/**
 * What the buyer signs for `x402/exact/stellar/precondition`, with one key: SHA-256 of `preimage`, the authorization
 * entry's `HashIDPreimage`, and `payload` itself, the 40 bytes of the signed-payload precondition (CAP-40); and how the
 * two signatures complete the payment.
 */
export interface StellarUnsigned {
  request: { kind: "stellar-precondition"; preimage: Uint8Array<ArrayBuffer>; payload: Uint8Array<ArrayBuffer> };
  /**
   * The x402 payment: the entry's signature written as a Stellar account's, the payload's as a decorated signature of
   * the envelope. A signature that is not 64 bytes is `stellar/tx-malformed`, and a signed envelope over 8,192
   * characters `stellar/tx-too-large`.
   */
  complete(signatures: { entry: Uint8Array; payload: Uint8Array }): StellarPaymentPayload | Refusal;
}

/** A Stellar x402 payment: the base64 XDR of the transaction with the payer's entry signed. */
export interface StellarPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string };
  extensions?: PaymentRequired["extensions"];
}

export function isMuxed(s: unknown): s is string {
  return unmux(s) !== null;
}

function need(): typeof StellarBase | null {
  return peer ?? null;
}

// ── decoding ─────────────────────────────────────────────────────────────────────────────────────────────────

/** An `SCAddress` as a strkey, its non-muxed base, and its muxed id when it has one. */
function addressOf(S: typeof StellarBase, a: ScAddressWire): { s: string; base: string; id: bigint | null } | null {
  if (a.type === 0) {
    if (a.accountId.type !== 0) return null;
    const g = S.StrKey.encodeEd25519PublicKey(a.accountId.ed25519);
    return { s: g, base: g, id: null };
  }
  if (a.type === 1) {
    const c = S.StrKey.encodeContract(a.contractId);
    return { s: c, base: c, id: null };
  }
  if (a.type === 2) {
    const { id, ed25519 } = a.muxedAccount;
    const raw = new Uint8Array(40);
    raw.set(ed25519, 0);
    new DataView(raw.buffer).setBigUint64(32, id, false);
    return { s: S.StrKey.encodeMed25519PublicKey(raw), base: S.StrKey.encodeEd25519PublicKey(ed25519), id };
  }
  return null;
}

function i128(v: ScValWire): bigint | null {
  if (v.type !== 10) return null;
  return (BigInt.asIntN(64, v.i128.hi) << 64n) | BigInt.asUintN(64, v.i128.lo);
}

/** The entry's address credentials, and whether they are V2 (CAP-71); null for any other credential type. */
function addressCredentials(e: SorobanAuthorizationEntryWire): { c: SorobanAddressCredentialsWire; v2: boolean } | null {
  const k = e.credentials;
  if (k.type === 1) return { c: k.address, v2: false };
  if (k.type === 2) return { c: k.addressV2, v2: true };
  return null;
}

/** The `HashIDPreimage` bytes an address credential's signature commits to: V1, or V2 with the address. */
function preimageOf(
  S: typeof StellarBase,
  network: StellarNetwork,
  e: SorobanAuthorizationEntryWire,
  a: { c: SorobanAddressCredentialsWire; v2: boolean },
): Uint8Array {
  const networkId = S.hash(new TextEncoder().encode(PASSPHRASE[network]));
  const common = { networkId, nonce: a.c.nonce, signatureExpirationLedger: a.c.signatureExpirationLedger };
  const wire: HashIdPreimageWire = a.v2
    ? { type: 10, sorobanAuthorizationWithAddress: { ...common, address: a.c.address, invocation: e.rootInvocation } }
    : { type: 9, sorobanAuthorization: { ...common, invocation: e.rootInvocation } };
  return writeXdr(S.xdr.HashIdPreimage, wire);
}

function hexOf(b: Uint8Array): string {
  let out = "";
  for (const x of b) out += x.toString(16).padStart(2, "0");
  return out;
}

/** An XDR type of @stellar/stellar-sdk: its js-xdr schema. */
type XdrOf<T> = {
  readonly schema: {
    decode(bytes: Uint8Array, options: { maxDepth: number }): T;
    encode(value: T, options: { maxDepth: number }): Uint8Array;
  };
};

/** `bytes` read whole as one `type`, js-xdr entering at most `XDR_MAX_DEPTH` levels; throws when they are not one. */
function readXdr<T>(type: XdrOf<T>, bytes: Uint8Array): T {
  return type.schema.decode(bytes, { maxDepth: XDR_MAX_DEPTH });
}

/** `value` written as `type`, js-xdr entering at most `XDR_MAX_DEPTH` levels. */
function writeXdr<T>(type: XdrOf<T>, value: T): Uint8Array {
  return type.schema.encode(value, { maxDepth: XDR_MAX_DEPTH });
}

/** The v1 transaction envelope of a `TransactionEnvelope`: itself, or a fee bump's inner transaction. */
function v1Of(env: TransactionEnvelopeWire): TransactionV1EnvelopeWire | null {
  if (env.type === 2) return env.v1;
  if (env.type === 5) return env.feeBump.tx.innerTx.type === 2 ? env.feeBump.tx.innerTx.v1 : null;
  return null;
}

type Parsed = {
  payment: StellarPayment;
  /** True when the operation's invocation is byte-equal to the invocation the payer's entry signs. */
  agrees: boolean;
  wire: TransactionEnvelopeWire;
  entry: SorobanAuthorizationEntryWire;
  cred: { c: SorobanAddressCredentialsWire; v2: boolean };
};

/**
 * A contract call's `transfer(from, to, amount)`: the contract, both addresses and the amount, or null. The function
 * name is the symbol `transfer`, byte for byte.
 */
function transferOf(
  S: typeof StellarBase,
  call: InvokeContractArgsWire,
): { asset: string; from: NonNullable<ReturnType<typeof addressOf>>; to: NonNullable<ReturnType<typeof addressOf>>; amount: bigint } | null {
  const args = call.args;
  if (!equalBytes(call.functionName.bytes, TRANSFER) || args.length !== 3 || call.contractAddress.type !== 1) {
    return null;
  }
  const asset = addressOf(S, call.contractAddress);
  const [a0, a1, a2] = args as [ScValWire, ScValWire, ScValWire];
  if (asset === null || a0.type !== 18 || a1.type !== 18) return null;
  const from = addressOf(S, a0.address);
  const to = addressOf(S, a1.address);
  const amount = i128(a2);
  if (from === null || to === null || amount === null) return null;
  return { asset: asset.s, from, to, amount };
}

/**
 * True when every ScVal in a decoded XDR value nests at most `SCVAL_MAX_DEPTH` vectors and maps, and authorized
 * invocations nest at most `SCVAL_MAX_DEPTH` levels. The walk keeps its own stack.
 */
export function scValsWithinCaps(wire: unknown): boolean {
  const stack: { node: unknown; sc: number; inv: number }[] = [{ node: wire, sc: 0, inv: 0 }];
  while (stack.length > 0) {
    const { node, sc, inv } = stack.pop()!;
    if (typeof node !== "object" || node === null || ArrayBuffer.isView(node)) continue;
    if (Array.isArray(node)) {
      for (const x of node) stack.push({ node: x, sc, inv });
      continue;
    }
    const o = node as Record<string, unknown>;
    const entries = (m: unknown): unknown[] => (Array.isArray(m) ? m : []);
    let children: unknown[] | undefined;
    if (o["type"] === 16 && "vec" in o) children = entries(o["vec"]);
    else if (o["type"] === 17 && "map" in o) children = entries(o["map"]);
    else if (o["type"] === 19 && typeof o["instance"] === "object" && o["instance"] !== null) {
      children = entries((o["instance"] as Record<string, unknown>)["storage"]);
    }
    if (children !== undefined) {
      if (sc + 1 > SCVAL_MAX_DEPTH) return false;
      for (const x of children) stack.push({ node: x, sc: sc + 1, inv });
      continue;
    }
    if ("subInvocations" in o) {
      if (inv + 1 > SCVAL_MAX_DEPTH) return false;
      for (const x of Object.values(o)) stack.push({ node: x, sc, inv: inv + 1 });
      continue;
    }
    for (const x of Object.values(o)) stack.push({ node: x, sc, inv });
  }
  return true;
}

/**
 * The envelope's one `invokeHostFunction` operation calling `transfer(from, to, amount)`, its host function within the
 * ScVal cap.
 */
type Operation = {
  wire: TransactionEnvelopeWire;
  v1: TransactionV1EnvelopeWire;
  op: InvokeHostFunctionOpWire;
  operation: NonNullable<ReturnType<typeof transferOf>>;
  /** True when an entry's `rootInvocation` is the operation's call, byte for byte, with no sub-invocations. */
  carries(e: SorobanAuthorizationEntryWire): boolean;
};

/**
 * The envelope's one `transfer` operation: strict base64 of a v1 envelope (or a fee bump's inner v1) holding exactly
 * one `invokeHostFunction` operation that calls `transfer(from, to, amount)` on a contract. The envelope is decoded
 * whole, whatever the nesting of what is not read (`XDR_MAX_DEPTH`). The operation's host function nests within
 * `SCVAL_MAX_DEPTH` (`stellar/tx-malformed` past it); its authorization entries are left to the caller: `parse` walks
 * the one entry it reads, and the entry `readSourceTransfer` reads is the operation's call, byte for byte, with no
 * sub-invocations.
 */
function operationOf(S: typeof StellarBase, bytes: Uint8Array): Operation | Refusal {
  let wire: TransactionEnvelopeWire;
  try {
    wire = readXdr(S.xdr.TransactionEnvelope, bytes);
  } catch {
    return refusal("stellar/tx-malformed");
  }
  const v1 = v1Of(wire);
  if (v1 === null) return refusal("stellar/tx-malformed");
  try {
    const ops = v1.tx.operations;
    if (ops.length !== 1) return refusal("stellar/not-one-transfer");
    const body = ops[0]!.body;
    if (body.type !== 24) return refusal("stellar/not-one-transfer");
    const op = body.invokeHostFunctionOp;
    if (!scValsWithinCaps(op.hostFunction)) return refusal("stellar/tx-malformed");
    if (op.hostFunction.type !== 0) return refusal("stellar/not-one-transfer");
    const call = op.hostFunction.invokeContract;
    const operation = transferOf(S, call);
    if (operation === null) return refusal("stellar/not-one-transfer");
    const callBytes = writeXdr(S.xdr.InvokeContractArgs, call);
    const carries = (e: SorobanAuthorizationEntryWire): boolean =>
      e.rootInvocation.function.type === 0 &&
      e.rootInvocation.subInvocations.length === 0 &&
      equalBytes(callBytes, writeXdr(S.xdr.InvokeContractArgs, e.rootInvocation.function.contractFn));
    return { wire, v1, op, operation, carries };
  } catch {
    return refusal("stellar/tx-malformed");
  }
}

/** True when `e` is an address-credential entry whose address is `from`. */
function isAddressEntryOf(S: typeof StellarBase, e: SorobanAuthorizationEntryWire, from: string): boolean {
  const a = addressCredentials(e);
  if (a === null) return false;
  const who = addressOf(S, a.c.address);
  return who !== null && who.s === from;
}

/**
 * The envelope's one `transfer` operation and the one address-credential entry whose address is its `from`. The
 * payment's contract, `to` and amount are read from the entry's `rootInvocation`, the invocation the payer signs, which
 * must itself be one `transfer(from, to, amount)` with no sub-invocations.
 *
 * With `landed`, the transaction is one the ledger recorded, and the entry read is the first address-credential entry
 * of `from` whose `rootInvocation` is the operation's `transfer`, byte for byte, with no sub-invocations. The host tries
 * the entries in order, skips one whose address or root invocation does not match, and authenticates the first that
 * matches, so other entries of `from` may ride unused. With no such entry, `from` must have exactly one entry, as
 * without `landed`.
 *
 * The entry read nests within `SCVAL_MAX_DEPTH` (`stellar/tx-malformed` past it), as the operation does. No other entry
 * is walked, and each is decoded whatever its depth, so an unused entry nested deeper does not make the transaction
 * unreadable.
 */
function parse(S: typeof StellarBase, bytes: Uint8Array, network: StellarNetwork, landed: boolean): Parsed | Refusal {
  const o = operationOf(S, bytes);
  if (isRefusal(o)) return o;
  const { wire, op, operation } = o;
  try {
    const entries = op.auth.flatMap((e) => (isAddressEntryOf(S, e, operation.from.s) ? [{ e, a: addressCredentials(e)! }] : []));
    const used = landed ? entries.find(({ e }) => o.carries(e)) : undefined;
    if (used === undefined && entries.length !== 1) return refusal("stellar/no-address-auth");
    const { e: entry, a: cred } = used ?? entries[0]!;
    if (!scValsWithinCaps(entry)) return refusal("stellar/tx-malformed");
    const root = entry.rootInvocation;
    if (root.function.type !== 0 || root.subInvocations.length !== 0) return refusal("stellar/not-one-transfer");
    const signed = transferOf(S, root.function.contractFn);
    if (signed === null) return refusal("stellar/not-one-transfer");
    const agrees = o.carries(entry);
    const preimageHash = S.hash(preimageOf(S, network, entry, cred));
    return {
      wire,
      entry,
      cred,
      agrees,
      payment: {
        asset: signed.asset,
        from: operation.from.s,
        to: signed.to.s,
        toBase: signed.to.base,
        toId: signed.to.id,
        amount: signed.amount,
        auth: {
          address: operation.from.s,
          nonce: cred.c.nonce,
          expiration: cred.c.signatureExpirationLedger,
          v2: cred.v2,
          preimageHash: `0x${hexOf(preimageHash)}`,
        },
      },
    };
  } catch {
    return refusal("stellar/tx-malformed");
  }
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The envelope's bytes, after the checks every envelope reader makes before it needs @stellar/stellar-sdk, which give
 * the codes the SDK's reading gives: a network that is not a Stellar network is `stellar/network-malformed`; text that
 * is empty, or not base64, is `stellar/tx-malformed`, and text longer than `MAX_XDR` characters `stellar/tx-too-large`;
 * and the XDR's union tags read at fixed places must be a v1 envelope's (2), or a fee bump's (5) whose fee source is an
 * account (0) or a muxed account (0x100) and whose inner envelope is a v1 envelope, else `stellar/tx-malformed`, as the
 * SDK reads no other envelope as a v1 transaction.
 */
function envelopeOf(xdrB64: unknown, network: unknown): Uint8Array | Refusal {
  if (!isStellarNetwork(network)) return refusal("stellar/network-malformed");
  if (typeof xdrB64 !== "string" || xdrB64.length === 0) return refusal("stellar/tx-malformed");
  if (xdrB64.length > MAX_XDR) return refusal("stellar/tx-too-large");
  const bytes = fromBase64(xdrB64);
  if (bytes === null) return refusal("stellar/tx-malformed");
  const tag = (at: number): number | null =>
    at + 4 > bytes.length ? null : new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0, false);
  const envelope = tag(0);
  if (envelope === 2) return bytes;
  if (envelope !== 5) return refusal("stellar/tx-malformed");
  // FeeBumpTransactionEnvelope: the fee source (a MuxedAccount), the fee (an int64), then the inner envelope's tag.
  const feeSource = tag(4);
  const feeSourceBytes = feeSource === 0 ? 32 : feeSource === 0x100 ? 40 : null;
  if (feeSourceBytes === null) return refusal("stellar/tx-malformed");
  return tag(8 + feeSourceBytes + 8) === 2 ? bytes : refusal("stellar/tx-malformed");
}

/**
 * `signingFor`'s checks that need no @stellar/stellar-sdk: `envelopeOf`'s, then a fee bump, which is not a simulated
 * transaction, and an expiration that is not a ledger sequence (an integer from 0 to 2^32 − 1), each
 * `stellar/tx-malformed`. A `build` that reads its recipient with the SDK makes them first, so they give one code with
 * the SDK and without it.
 */
export function signingInput(simulatedXdr: string, network: StellarNetwork, expiration: number): Uint8Array | Refusal {
  const bytes = envelopeOf(simulatedXdr, network);
  if (isRefusal(bytes)) return bytes;
  if (bytes[3] !== 2) return refusal("stellar/tx-malformed");
  if (!Number.isInteger(expiration) || expiration < 0 || expiration > 0xffffffff) {
    return refusal("stellar/tx-malformed");
  }
  return bytes;
}

/**
 * The payment the payer's entry signs, and whether the operation invokes exactly that: the input checks of
 * `decodeStellarTx`, without refusing an operation that differs from the signed invocation. With `landed` (a
 * transaction the ledger recorded), the entry is the first entry of `from` that carries the operation's `transfer`;
 * without it (before anything lands), `from` must have exactly one entry. `envelopeOf`'s checks come first, without the
 * SDK.
 */
export function readSignedTransfer(
  xdrB64: string,
  network: StellarNetwork,
  landed: boolean,
): { payment: StellarPayment; agrees: boolean } | Refusal {
  const bytes = envelopeOf(xdrB64, network);
  if (isRefusal(bytes)) return bytes;
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  const p = parse(S, bytes, network, landed);
  return isRefusal(p) ? p : { payment: p.payment, agrees: p.agrees };
}

/** A landed transfer the payer authorized as the transaction's source account: no address entry, so no `auth`. */
export type SourcePayment = Omit<StellarPayment, "auth"> & { auth: null };

/**
 * The transfer of a landed transaction whose payer authorized it as the transaction's source account: `from` has no
 * address-credential entry, `from` is the source account of the transaction (the inner one of a fee bump) and of its
 * operation, and an entry with source-account credentials has the operation's `transfer` as its `rootInvocation`, byte
 * for byte, with no sub-invocations. The transaction's signatures, which the network verified when it applied the
 * transaction, cover it whole, `to` included. Anything else is `stellar/no-address-auth`.
 */
export function readSourceTransfer(xdrB64: string, network: StellarNetwork): SourcePayment | Refusal {
  const bytes = envelopeOf(xdrB64, network);
  if (isRefusal(bytes)) return bytes;
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  const o = operationOf(S, bytes);
  if (isRefusal(o)) return o;
  const { v1, op, operation } = o;
  try {
    const from = operation.from.s;
    if (!S.StrKey.isValidEd25519PublicKey(from)) return refusal("stellar/no-address-auth");
    const key = S.StrKey.decodeEd25519PublicKey(from);
    const isFrom = (m: MuxedAccountWire): boolean => equalBytes(m.type === 0 ? m.ed25519 : m.med25519.ed25519, key);
    const opSource = v1.tx.operations[0]!.sourceAccount;
    if (!isFrom(v1.tx.sourceAccount) || (opSource !== null && !isFrom(opSource))) return refusal("stellar/no-address-auth");
    if (op.auth.some((e) => isAddressEntryOf(S, e, from))) return refusal("stellar/no-address-auth");
    if (!op.auth.some((e) => e.credentials.type === 0 && o.carries(e))) return refusal("stellar/no-address-auth");
    const { asset, to, amount } = operation;
    return { asset, from, to: to.s, toBase: to.base, toId: to.id, amount, auth: null };
  } catch {
    return refusal("stellar/tx-malformed");
  }
}

/**
 * Decodes a base64 `TransactionEnvelope` (v1, or a fee bump's inner v1) of at most 8,192 base64 characters (6 KiB of
 * XDR) holding exactly one
 * `invokeHostFunction` operation that calls `transfer(from, to, amount)` on a contract, and the one authorization entry
 * with address credentials (`sorobanCredentialsAddress` or `sorobanCredentialsAddressV2`) whose address is `from`.
 * The entry's `rootInvocation` must be that same `transfer`, byte for byte, with no sub-invocations; the payment's
 * contract, `to` and amount are the signed invocation's. The base64 is read strictly (RFC 4648 §4, zero padding bits),
 * and the XDR must be consumed whole. The operation and that entry nest ScVals and authorized invocations at most
 * `SCVAL_MAX_DEPTH` levels (`stellar/tx-malformed` past it); the cap does not apply to the rest of the envelope
 * (another entry, a delegate, the footprint, another operation), which is decoded whatever its depth, so its nesting
 * does not refuse the envelope. `preimageHash` is SHA-256 of that entry's `HashIDPreimage` under the network's
 * passphrase: the V1 form, or for V2 the form with the address. An entry with source-account credentials is not one:
 * without an address entry of `from` the envelope is `stellar/no-address-auth`. Only `stellarStatus` and
 * `stellarLocate`, on a ref without `authDigest`, read a payer that authorized the transfer as the transaction's source
 * account.
 */
export function decodeStellarTx(xdrB64: string, network: StellarNetwork): StellarPayment | Refusal {
  const p = readSignedTransfer(xdrB64, network, false);
  if (isRefusal(p)) return p;
  return p.agrees ? p.payment : refusal("stellar/not-one-transfer");
}

/** A signed-payload signer of a transaction's preconditions: its Ed25519 key as a `G…` strkey, and its payload. */
export interface PayloadSigner {
  readonly key: string;
  readonly payload: Uint8Array;
}

/** The signed-payload signers of a v1 transaction's preconditions, in order: none where they are not `PRECOND_V2`. */
function payloadSignersOf(S: typeof StellarBase, v1: TransactionV1EnvelopeWire): PayloadSigner[] {
  const c = v1.tx.cond;
  if (c.type !== 2) return [];
  return c.v2.extraSigners.flatMap((k) =>
    k.type === 3
      ? [{ key: S.StrKey.encodeEd25519PublicKey(k.ed25519SignedPayload.ed25519), payload: k.ed25519SignedPayload.payload }]
      : [],
  );
}

/**
 * The `G…` keys whose signatures an address entry carries, as a Stellar account's entry carries them: a vector of maps
 * `{public_key, signature}`, each `public_key` 32 bytes. None where the signature has another form.
 */
function entryKeysOf(S: typeof StellarBase, c: SorobanAddressCredentialsWire): string[] {
  const sig = c.signature;
  if (sig.type !== 16) return [];
  const keys: string[] = [];
  for (const m of sig.vec ?? []) {
    if (m.type !== 17) return [];
    const pk = (m.map ?? []).find((e) => e.key.type === 15 && equalBytes(e.key.sym.bytes, PUBLIC_KEY));
    if (pk === undefined || pk.val.type !== 13 || pk.val.bytes.length !== 32) return [];
    keys.push(S.StrKey.encodeEd25519PublicKey(pk.val.bytes));
  }
  return keys;
}

/**
 * What an envelope of the precondition form shows: the payment the buyer's entry signs and whether the operation
 * invokes exactly that (as `readSignedTransfer` reads them), the signed-payload signers of its preconditions, and the
 * keys whose signatures the buyer's entry carries.
 */
export interface PreconditionEnvelope {
  readonly payment: StellarPayment;
  readonly agrees: boolean;
  readonly signers: readonly PayloadSigner[];
  readonly entryKeys: readonly string[];
}

/** An envelope of the precondition form, read as `readSignedTransfer` reads it, with its preconditions. */
export function readPrecondition(xdrB64: string, network: StellarNetwork, landed: boolean): PreconditionEnvelope | Refusal {
  const bytes = envelopeOf(xdrB64, network);
  if (isRefusal(bytes)) return bytes;
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  const p = parse(S, bytes, network, landed);
  if (isRefusal(p)) return p;
  const v1 = v1Of(p.wire);
  if (v1 === null) return refusal("stellar/tx-malformed");
  try {
    return { payment: p.payment, agrees: p.agrees, signers: payloadSignersOf(S, v1), entryKeys: entryKeysOf(S, p.cred.c) };
  } catch {
    return refusal("stellar/tx-malformed");
  }
}

/**
 * Every address-credential entry of every `invokeHostFunction` operation of an envelope, by its address and nonce, and
 * the signed-payload signers of its preconditions: what a read needs of a landed transaction that is not of one form.
 * `envelopeOf`'s checks come first; XDR that does not decode whole is `stellar/tx-malformed`.
 */
export function scanEnvelope(
  xdrB64: string,
  network: StellarNetwork,
): { entries: { address: string; nonce: bigint }[]; signers: PayloadSigner[] } | Refusal {
  const bytes = envelopeOf(xdrB64, network);
  if (isRefusal(bytes)) return bytes;
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  try {
    const v1 = v1Of(readXdr(S.xdr.TransactionEnvelope, bytes));
    if (v1 === null) return refusal("stellar/tx-malformed");
    const entries: { address: string; nonce: bigint }[] = [];
    for (const op of v1.tx.operations) {
      if (op.body.type !== 24) continue;
      for (const e of op.body.invokeHostFunctionOp.auth) {
        const a = addressCredentials(e);
        const who = a === null ? null : addressOf(S, a.c.address);
        if (a !== null && who !== null) entries.push({ address: who.s, nonce: a.c.nonce });
      }
    }
    return { entries, signers: payloadSignersOf(S, v1) };
  } catch {
    return refusal("stellar/tx-malformed");
  }
}

/**
 * The precondition form's signing inputs from a simulated envelope: the buyer's entry's expiration ledger set, the
 * transaction's preconditions set to `PRECOND_V2` holding one signed-payload signer, the buyer's key with `payload`
 * (which the caller writes from H and the entry's nonce), its time bounds, ledger bounds and sequence conditions kept;
 * the entry's `HashIDPreimage`, the payment that entry signs, whether the operation invokes exactly that, and a
 * completion that writes the entry's signature as `authorizeEntry` does for an account (a vector of one map
 * `{public_key, signature}`) and appends the payload's signature as a decorated signature whose hint is the key's last
 * 4 bytes XOR the payload's last 4 (CAP-40). `signingInput`'s checks come first; a buyer that is not an account is
 * `stellar/no-address-auth`, and a simulated transaction that already holds an extra signer `stellar/tx-malformed`.
 */
export function preconditionSigningFor(
  simulatedXdr: string,
  network: StellarNetwork,
  expiration: number,
  payload: (nonce: bigint) => Uint8Array<ArrayBuffer> | Refusal,
):
  | {
      payment: StellarPayment;
      agrees: boolean;
      preimage: Uint8Array<ArrayBuffer>;
      payload: Uint8Array<ArrayBuffer>;
      written(signatures: { entry: Uint8Array; payload: Uint8Array }): string | Refusal;
    }
  | Refusal {
  const bytes = signingInput(simulatedXdr, network, expiration);
  if (isRefusal(bytes)) return bytes;
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  const parsed = parse(S, bytes, network, false);
  if (isRefusal(parsed)) return parsed;
  const { payment, wire, entry, cred } = parsed;
  if (!S.StrKey.isValidEd25519PublicKey(payment.from)) return refusal("stellar/no-address-auth");
  // `signingInput` refused a fee bump; this narrows the envelope's type.
  if (wire.type !== 2) return refusal("stellar/tx-malformed");
  const tx = wire.v1.tx;
  const v2 = tx.cond.type === 2 ? tx.cond.v2 : null;
  if (v2 !== null && v2.extraSigners.length > 0) return refusal("stellar/tx-malformed");
  const signed = payload(cred.c.nonce);
  if (isRefusal(signed)) return signed;
  const key = S.StrKey.decodeEd25519PublicKey(payment.from);
  tx.cond = {
    type: 2,
    v2: {
      timeBounds: tx.cond.type === 1 ? tx.cond.timeBounds : (v2?.timeBounds ?? null),
      ledgerBounds: v2?.ledgerBounds ?? null,
      minSeqNum: v2?.minSeqNum ?? null,
      minSeqAge: v2?.minSeqAge ?? 0n,
      minSeqLedgerGap: v2?.minSeqLedgerGap ?? 0,
      extraSigners: [{ type: 3, ed25519SignedPayload: { ed25519: Uint8Array.from(key), payload: Uint8Array.from(signed) } }],
    },
  };
  cred.c.signatureExpirationLedger = expiration;
  const preimage = Uint8Array.from(preimageOf(S, network, entry, cred));
  const hint = Uint8Array.from(key.subarray(28), (b, i) => b ^ signed[signed.length - 4 + i]!);
  const x = S.xdr;
  const written = (signatures: { entry: Uint8Array; payload: Uint8Array }): string | Refusal => {
    if (!isObject(signatures)) return refusal("stellar/tx-malformed");
    const { entry: e, payload: p } = signatures;
    if (!(e instanceof Uint8Array) || e.length !== 64 || !(p instanceof Uint8Array) || p.length !== 64) {
      return refusal("stellar/tx-malformed");
    }
    cred.c.signature = {
      type: 16,
      vec: [
        {
          type: 17,
          map: [
            { key: { type: 15, sym: new x.XdrString("public_key") }, val: { type: 13, bytes: Uint8Array.from(key) } },
            { key: { type: 15, sym: new x.XdrString("signature") }, val: { type: 13, bytes: new Uint8Array(e) } },
          ],
        },
      ],
    };
    try {
      const out = writeXdr(x.TransactionEnvelope, {
        type: 2,
        v1: { tx: wire.v1.tx, signatures: [...wire.v1.signatures, { hint, signature: new Uint8Array(p) }] },
      });
      const text = toBase64(out);
      return text.length > MAX_XDR ? refusal("stellar/tx-too-large") : text;
    } catch {
      return refusal("stellar/tx-malformed");
    }
  };
  return { payment, agrees: parsed.agrees, preimage, payload: Uint8Array.from(signed), written };
}

// ── events ───────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_EVENT_XDR = 1024;

/** What a Stellar Asset Contract event shows: its kind, its `from` and its `to` (non-muxed), `to_muxed_id`, and the amount. */
export interface StellarEvent {
  readonly kind: "transfer" | "burn" | "mint";
  /** The `from` topic: absent from a `mint`. */
  readonly from: string | null;
  /** The `to` topic, its base account: absent from a `burn`. */
  readonly toBase: string | null;
  readonly toMuxedId: bigint | null;
  readonly amount: bigint;
}

/**
 * The `getEvents` topic filters of the buyer's acts, as base64 XDR segments: `transfer` events whose `from` topic is
 * the buyer, and `burn` events whose `from` topic is the buyer, each with any trailing topics. A `mint` event names no
 * `from` (CAP-67 removed the admin from its topics), so no filter of `mint` names the buyer. A buyer that is not an
 * account or contract strkey is `stellar/option-malformed`, which needs no SDK: the SDK is needed after it, to write
 * the XDR.
 */
export function transferEventTopics(buyer: string): readonly (readonly string[])[] | Refusal {
  const key = accountKey(buyer);
  const id = key === null ? contractId(buyer) : null;
  if (key === null && id === null) return refusal("stellar/option-malformed");
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  const x = S.xdr;
  const from: ScAddressWire = key !== null ? { type: 0, accountId: { type: 0, ed25519: key } } : { type: 1, contractId: id! };
  const sym = (s: string): string => x.ScVal.fromXdrObject({ type: 15, sym: new x.XdrString(s) }).toXdr("base64");
  const who = x.ScVal.fromXdrObject({ type: 18, address: from }).toXdr("base64");
  return [
    [sym("transfer"), who, "*", "**"],
    [sym("burn"), who, "**"],
  ];
}

/**
 * A Stellar Asset Contract event, as CAP-67 writes it: `transfer` (`from`, `to`, then any trailing topic), `burn`
 * (`from`), or `mint` (`to`; or `admin` then `to`, where the third topic is an address); its data the `i128` amount, or
 * a map holding `amount` and, for a muxed recipient, `to_muxed_id` (read where it is a `u64`). The first topic and the
 * map's keys are symbols, compared byte for byte. Every refusal is `stellar/event-malformed`. The topics' and the
 * value's form (2 to 4 topics, each one and the value base64 of at most 1,024 characters) is checked before the SDK is
 * needed, which reads the XDR.
 */
export function transferEventOf(topic: readonly string[], value: string): StellarEvent | Refusal {
  if (!Array.isArray(topic) || topic.length < 2 || topic.length > 4 || typeof value !== "string" || value.length > MAX_EVENT_XDR) {
    return refusal("stellar/event-malformed");
  }
  const topicBytes: Uint8Array[] = [];
  for (const b of topic) {
    const bytes = typeof b === "string" && b.length <= MAX_EVENT_XDR ? fromBase64(b) : null;
    if (bytes === null) return refusal("stellar/event-malformed");
    topicBytes.push(bytes);
  }
  const valueBytes = fromBase64(value);
  if (valueBytes === null) return refusal("stellar/event-malformed");
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  try {
    const x = S.xdr;
    const t = topicBytes.map((bytes) => x.ScVal.fromXdr(bytes).toXdrObject());
    if (!scValsWithinCaps(t)) return refusal("stellar/event-malformed");
    const name = t[0]!;
    if (name.type !== 15) return refusal("stellar/event-malformed");
    const address = (v: ScValWire | undefined): string | null => {
      const a = v !== undefined && v.type === 18 ? addressOf(S, v.address) : null;
      return a === null ? null : a.base;
    };
    let kind: StellarEvent["kind"];
    let from: string | null = null;
    let toBase: string | null = null;
    if (equalBytes(name.sym.bytes, TRANSFER) && t.length >= 3) {
      kind = "transfer";
      from = address(t[1]);
      toBase = address(t[2]);
      if (from === null || toBase === null) return refusal("stellar/event-malformed");
    } else if (equalBytes(name.sym.bytes, BURN)) {
      kind = "burn";
      from = address(t[1]);
      if (from === null) return refusal("stellar/event-malformed");
    } else if (equalBytes(name.sym.bytes, MINT)) {
      kind = "mint";
      toBase = address(t[2]) ?? address(t[1]);
      if (toBase === null) return refusal("stellar/event-malformed");
    } else return refusal("stellar/event-malformed");
    const data = x.ScVal.fromXdr(valueBytes).toXdrObject();
    if (!scValsWithinCaps(data)) return refusal("stellar/event-malformed");
    let amount: bigint | null = null;
    let toMuxedId: bigint | null = null;
    if (data.type === 17) {
      const map = data.map ?? [];
      const at = (k: Uint8Array) => map.find((e) => e.key.type === 15 && equalBytes(e.key.sym.bytes, k));
      const a = at(AMOUNT_KEY);
      amount = a === undefined ? null : i128(a.val);
      const m = at(TO_MUXED_ID);
      if (m !== undefined && m.val.type === 5) toMuxedId = m.val.u64;
    } else amount = i128(data);
    if (amount === null) return refusal("stellar/event-malformed");
    return { kind, from, toBase, toMuxedId, amount };
  } catch {
    return refusal("stellar/event-malformed");
  }
}

// ── the search ───────────────────────────────────────────────────────────────────────────────────────────────

/** A transaction the search found, read whole: its hash, its position P, its result, its envelope, and its events. */
export interface StellarCandidate {
  readonly transaction: string;
  readonly position: string;
  readonly result: "succeeded" | "failed";
  readonly envelopeXdr: string;
  /** The events of the transaction the search met, each with its id and its contract, in the RPC's order. */
  readonly events: readonly (StellarEvent & { readonly id: string; readonly contract: string })[];
}

/**
 * What a search found: the candidates read whole; the items it could not decode, each with the position held at it;
 * whether it read through to the latest closed ledger at the read within its bounds; the position the next call resumes
 * at where it did not; and that ledger.
 */
export interface StellarSearch {
  readonly candidates: readonly StellarCandidate[];
  readonly undecoded: readonly { readonly transaction: string; readonly at?: string }[];
  readonly through: boolean;
  readonly at?: string;
  readonly latest: number;
}

const TX_HASH = /^[0-9a-f]{64}$/;
const EVENT_ID = /^([0-9]{19})-[0-9]{10}$/;

/** An answer out of the reader's documented form. */
class Malformed extends Error {}

/** A rejected read: an answer out of form `unparseable`, a `ReaderError` by its kind, anything else `transport`. */
function rejected(e: unknown): UnreadableReason {
  if (e instanceof Malformed) return "unparseable";
  const kind = isObject(e) && e["name"] === "ReaderError" ? e["kind"] : undefined;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/**
 * The search for a buyer's acts: `getEvents` on every contract with `transferEventTopics(buyer)`, from `fromLedger`
 * (or, given `search`, the position an earlier search returned, from which it resumes) through the latest closed ledger
 * at the read, and each candidate transaction read whole by `getTransaction`. An event's transaction is placed by its
 * id's position, the operation's TOID with its low 12 bits cleared, which must be the position `getTransaction` gives
 * it (its ledger and application order); an event that does not decode, or whose transaction is not found, does not
 * decode or sits at another position, is an item the search could not decode, held at that position. At most
 * `MAX_PAGES` pages and `MAX_CANDIDATES` candidates: a search that reaches either, or whose events index answers below
 * the latest closed ledger read first, is not read through, and gives the position the next call resumes at. A network
 * whose passphrase is not the reference's is `chain-mismatch`; an RPC whose oldest ledger is above the ledger the search
 * starts from, `history-gap`; an answer out of the reader's form, `unparseable`; a rejected read by its reason. The
 * search needs @stellar/stellar-sdk to write its filter and decode events: without it, it is `unparseable`.
 */
export async function stellarLocate(
  q: { readonly network: StellarNetwork; readonly buyer: string; readonly fromLedger: number; readonly search?: string },
  reader: StellarReader,
): Promise<StellarSearch | { readonly unreadable: UnreadableReason }> {
  if (!isObject(q) || !isStellarNetwork(q.network) || !isLedgerSequence(q.fromLedger)) return { unreadable: "unparseable" };
  const resume = q.search === undefined ? undefined : parseStellarPosition(q.search);
  if (resume !== undefined && isRefusal(resume)) return { unreadable: "unparseable" };
  const topics = transferEventTopics(q.buyer);
  if (isRefusal(topics)) return { unreadable: "unparseable" };
  if (!isObject(reader) || typeof reader.passphrase !== "function") return { unreadable: "chain-mismatch" };
  try {
    if ((await reader.passphrase()) !== PASSPHRASE[q.network]) return { unreadable: "chain-mismatch" };
    const head = await reader.latestLedger();
    if (!isObject(head) || !isLedgerSequence(head.sequence)) throw new Malformed();
    const latest = head.sequence;
    const resumeAt = resume === undefined ? undefined : BigInt(q.search!);
    const start = resume === undefined ? q.fromLedger : Math.max(q.fromLedger, resume.ledger);
    const byTx = new Map<string, { position: string; read?: Omit<StellarCandidate, "events">; events: StellarCandidate["events"][number][] }>();
    const undecoded: { transaction: string; at?: string }[] = [];
    const held = new Set<string>();
    let cursor: string | undefined;
    let through = false;
    let at: string | undefined;
    let behind: number | undefined;
    let last: string | undefined;
    pages: for (let page = 0; page < MAX_PAGES; page++) {
      const r = await reader.events({ fromLedger: start, toLedger: latest, topics, ...(cursor === undefined ? {} : { cursor }) });
      if (!isObject(r) || !Array.isArray(r.events) || !isLedgerSequence(r.oldestLedger) || !isLedgerSequence(r.latestLedger)) {
        throw new Malformed();
      }
      if (r.oldestLedger > start) return { unreadable: "history-gap" };
      if (r.latestLedger < latest) behind = Math.min(behind ?? r.latestLedger, r.latestLedger);
      for (const e of r.events) {
        const id = isObject(e) && typeof e.id === "string" ? EVENT_ID.exec(e.id) : null;
        if (id === null || typeof e.txHash !== "string" || !TX_HASH.test(e.txHash.toLowerCase()) || !isLedgerSequence(e.ledger)) {
          throw new Malformed();
        }
        if (e.ledger > latest) continue;
        const position = (BigInt(id[1]!) & ~0xfffn).toString();
        if (resumeAt !== undefined && BigInt(position) < resumeAt) continue;
        const hash = e.txHash.toLowerCase();
        last = position;
        if (held.has(hash)) continue;
        const ev = transferEventOf(e.topic, e.value);
        if (isRefusal(ev)) {
          if (ev.code === "stellar/peer-missing") throw new Malformed();
          held.add(hash);
          undecoded.push({ transaction: hash, at: position });
          continue;
        }
        let tx = byTx.get(hash);
        if (tx === undefined) {
          if (byTx.size >= MAX_CANDIDATES) {
            at = position;
            break pages;
          }
          tx = { position, events: [] };
          byTx.set(hash, tx);
          const read = await readCandidate(reader, hash, position);
          if (read === null) {
            held.add(hash);
            byTx.delete(hash);
            undecoded.push({ transaction: hash, at: position });
            continue;
          }
          tx.read = read;
        }
        tx.events.push({ ...ev, id: e.id, contract: typeof e.contractId === "string" ? e.contractId : "" });
      }
      if (r.cursor === undefined) {
        through = behind === undefined;
        break;
      }
      cursor = r.cursor;
      if (page === MAX_PAGES - 1) at = last;
    }
    if (behind !== undefined && at === undefined) {
      const next = stellarPosition(behind + 1, 1);
      at = isRefusal(next) ? undefined : next;
    }
    const candidates = [...byTx.entries()].flatMap(([, t]) => (t.read === undefined ? [] : [{ ...t.read, events: t.events }]));
    return { candidates, undecoded, through, ...(through || at === undefined ? {} : { at }), latest };
  } catch (e) {
    return { unreadable: rejected(e) };
  }
}

/**
 * A candidate read whole by `getTransaction`: null where it is not found, is out of the documented form, or sits at
 * another position than its event's.
 */
async function readCandidate(
  reader: StellarReader,
  hash: string,
  position: string,
): Promise<Omit<StellarCandidate, "events"> | null> {
  const t = await reader.transaction(hash);
  if (!isObject(t) || (t.status !== "SUCCESS" && t.status !== "FAILED")) return null;
  if (typeof t.envelopeXdr !== "string" || !isLedgerSequence(t.ledger) || !Number.isInteger(t.applicationOrder)) return null;
  const p = stellarPosition(t.ledger, t.applicationOrder!);
  if (isRefusal(p) || p !== position) return null;
  return { transaction: hash, position, result: t.status === "SUCCESS" ? "succeeded" : "failed", envelopeXdr: t.envelopeXdr };
}

// ── the agreement's read ─────────────────────────────────────────────────────────────────────────────────────

const MARKS: readonly StellarMark[] = ["finalized"];
const LEDGER = ledgerOf<string, StellarMark>("full", MARKS, (a, b) => bigintOrder(BigInt(a), BigInt(b)));
const DIGEST = /^0x[0-9a-f]{64}$/;
const PAYLOAD = /^0x[0-9a-f]{80}$/;
const INT64 = /^-?(0|[1-9][0-9]{0,18})$/;

/** The reference as the read compares it, or null where a member is not in the form `reference` writes. */
function refOf(ref: unknown): (StellarRef & StellarLanded & { h: AtrHash; value: bigint }) | null {
  if (!isObject(ref)) return null;
  const r = ref as unknown as StellarRef & StellarLanded;
  if (!isStellarNetwork(r.network) || !isAccount(r.buyer) || typeof r.payee !== "string" || r.payee === "") return null;
  if (!isContract(r.asset) || !(isAccount(r.toBase) || isContract(r.toBase))) return null;
  if (typeof r.nonce !== "string" || !INT64.test(r.nonce) || !isLedgerSequence(r.expiration) || !isLedgerSequence(r.fromLedger)) {
    return null;
  }
  if (typeof r.authDigest !== "string" || !DIGEST.test(r.authDigest) || typeof r.payload !== "string" || !PAYLOAD.test(r.payload)) {
    return null;
  }
  const value = BigInt(r.nonce);
  if (value < -(1n << 63n) || value >= 1n << 63n) return null;
  const last = new Uint8Array(8);
  new DataView(last.buffer).setBigInt64(0, value, false);
  if (r.payload.slice(66) !== hexOf(last)) return null;
  return { ...r, h: `0x${r.payload.slice(2, 66)}` as AtrHash, value };
}

/** The `0x` hex of bytes. */
function hex0x(b: Uint8Array): string {
  return `0x${hexOf(b)}`;
}

/**
 * The read of `x402/exact/stellar/precondition`, as the profile `read-status` answers it, through `stellarLocate`'s
 * search from the reference's `fromLedger`. A candidate that succeeded and is of the form (its one operation the
 * `transfer` the buyer's entry signs) is the agreement where the five checks hold for H and the buyer: its
 * preconditions hold exactly one signed-payload signer, whose payload is H then the nonce of the entry the transaction
 * consumed; that payload's key is a key whose signature the entry carries; the transfer's `from` is not the option's
 * payee; and the buyer is an account whose entry has address credentials. A candidate whose payload key is the payee's,
 * or whose `from` is the payee, is the payee's; one whose payload key the entry did not sign carries H under another
 * account's signature; one of the form that fails the payload's layout is of another kind. A candidate that consumed
 * the entry's nonce is its consumer; one not of the form that holds an entry of the buyer's over that nonce is an item
 * the search could not decode, since the read cannot tell whether the host used that entry. The nonce is read only by
 * the search read through, which shows it consumed where a candidate consumed it, and its validity passed where the
 * latest closed ledger is above the entry's expiration ledger; a search not read through, or that met an item it could
 * not decode, reads it neither consumed nor unconsumed. The search proves no absence until a run shows that the event
 * search with no contract named holds every act of the buyer, so the read never reports it read whole, and every
 * answer it decides but `before-position` is `pending`, `search-incomplete`. `presented` is `yes` where the landed
 * entry's digest and payload are the reference's, `no` otherwise. Each transfer is named by its transaction and its
 * event's id. A reference, reader or query that is not one is `unparseable`, with nothing read.
 */
export async function stellarStatus(
  ref: StellarRef & StellarLanded,
  reader: StellarReader,
  query: StellarQuery,
): Promise<StellarStatus> {
  const unparseable: StellarStatus = { state: "unreadable", reason: "unparseable", foreign: [] };
  if (!isQuery(query, MARKS, isLedgerSequence)) return unparseable;
  if (query.search !== undefined && isRefusal(parseStellarPosition(query.search))) return unparseable;
  const r = refOf(ref);
  if (r === null) return unparseable;
  const found = await stellarLocate(
    { network: r.network, buyer: r.buyer, fromLedger: r.fromLedger, ...(query.search === undefined ? {} : { search: query.search }) },
    reader,
  );
  if ("unreadable" in found) return { state: "unreadable", reason: found.unreadable, foreign: [] };
  const givenRefs = (query.others ?? []).flatMap((o) => ("ref" in o && isObject(o.ref) ? [(o.ref as StellarRef).authDigest] : []));
  const seen: Seen<string, StellarMark>[] = [];
  const undecoded: Undecoded<string>[] = [...found.undecoded];
  for (const c of found.candidates) {
    const s = classify(c, r, givenRefs);
    if (s === "undecodable") undecoded.push({ transaction: c.transaction, at: c.position });
    else if (s !== undefined) seen.push(s);
  }
  const readThrough = found.through && undecoded.length === 0;
  const consumed = seen.some((s) => s.consumed && s.result === "succeeded");
  const facts: Facts<string, StellarMark, string> = {
    seen,
    undecoded,
    ...(readThrough ? { value: { consumed, lapsed: found.latest > r.expiration, mark: "finalized", head: { consumed } } } : {}),
    search: { whole: false, ...(found.at === undefined ? {} : { at: found.at }) },
    history: true,
  };
  const { after, ...rest } = query;
  return decide(facts, { ...rest, ...(after === undefined ? {} : { after: lastPositionOf(after) }) }, LEDGER);
}

/** A candidate as the agreement's read classifies it, undefined where it bears on nothing the read decides. */
function classify(
  c: StellarCandidate,
  r: StellarRef & StellarLanded & { h: AtrHash; value: bigint },
  givenRefs: readonly string[],
): Seen<string, StellarMark> | undefined | "undecodable" {
  const carriesH = (signers: readonly PayloadSigner[]): PayloadSigner | undefined =>
    signers.find((s) => s.payload.length === 40 && hex0x(s.payload.subarray(0, 32)) === r.h);
  const moved = (toBase?: string): Moved[] =>
    c.events.map((e) => ({
      asset: e.contract,
      amount: e.amount.toString(),
      to: e.toBase ?? toBase ?? "",
      transaction: c.transaction,
      place: e.id,
    }));
  const p = readPrecondition(c.envelopeXdr, r.network, true);
  if (isRefusal(p)) {
    if (p.code === "stellar/peer-missing") return "undecodable";
    const scan = scanEnvelope(c.envelopeXdr, r.network);
    if (isRefusal(scan)) return "undecodable";
    if (scan.entries.some((e) => e.address === r.buyer && e.nonce === r.value)) return "undecodable";
    const carrier = carriesH(scan.signers);
    if (carrier === undefined) return undefined;
    return {
      transaction: c.transaction,
      position: c.position,
      mark: "finalized",
      result: c.result,
      consumed: false,
      carries: true,
      party: carrier.key === r.payee ? "payee" : carrier.key === r.buyer ? "payer" : "other",
      kind: "other",
      account: "none",
      presented: "no",
      moved: moved(),
      signer: carrier.key,
    };
  }
  const { payment, signers, entryKeys } = p;
  const carrier = carriesH(signers);
  const consumed = c.result === "succeeded" && payment.from === r.buyer && payment.auth.nonce === r.value;
  if (carrier === undefined && !consumed) return undefined;
  const one = signers.length === 1 ? signers[0]! : undefined;
  const layout = one !== undefined && carrier === one && readSignedPayload(one.payload);
  const sameKind = p.agrees && layout !== false && !isRefusal(layout) && layout.value === payment.auth.nonce && isAccount(payment.from);
  const party =
    payment.from === r.payee || carrier?.key === r.payee
      ? "payee"
      : carrier !== undefined && !entryKeys.includes(carrier.key)
        ? "other"
        : payment.from === r.buyer
          ? "payer"
          : "other";
  const presented = payment.auth.preimageHash === r.authDigest && carrier !== undefined && hex0x(carrier.payload) === r.payload;
  return {
    transaction: c.transaction,
    position: c.position,
    mark: "finalized",
    result: c.result,
    consumed,
    carries: carrier !== undefined,
    party,
    kind: sameKind ? "same" : "other",
    account: payment.toBase === r.payee ? "payee" : "other",
    ...(givenRefs.includes(payment.auth.preimageHash) ? { given: true } : {}),
    presented: presented ? "yes" : "no",
    moved: c.result === "succeeded" ? moved(payment.toBase) : [],
    signer: payment.from,
  };
}

/**
 * H as the landed transaction `tx` carries it: the first 32 bytes of the one signed-payload signer of its
 * preconditions, whose payload is 40 bytes. A transaction with none or more than one is `stellar/no-carrier`, and a
 * payload of another length `stellar/carrier-mismatch`; a transaction the reader does not know is `stellar/not-found`;
 * a rejected read, or an answer out of the reader's form, is `stellar/unreadable`. An input that is not one, a `tx`
 * that is not 64 hex digits, or a reader whose passphrase is not the network's, is `stellar/wrong-reader`. The
 * envelope is read as `scanEnvelope` reads it. H is recovered whatever the transaction's result.
 */
export async function stellarRecover(
  input: RecoverInput<StellarNetwork, unknown>,
  reader: StellarReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isStellarNetwork(input.network) || !isObject(reader)) return refusal("stellar/wrong-reader");
  if (typeof input.tx !== "string" || !TX_HASH.test(input.tx.toLowerCase())) return refusal("stellar/wrong-reader");
  let t: Awaited<ReturnType<StellarReader["transaction"]>>;
  try {
    if ((await reader.passphrase()) !== PASSPHRASE[input.network]) return refusal("stellar/wrong-reader");
    t = await reader.transaction(input.tx.toLowerCase());
  } catch {
    return refusal("stellar/unreadable");
  }
  if (!isObject(t)) return refusal("stellar/unreadable");
  if (t.status === "NOT_FOUND") return refusal("stellar/not-found");
  if ((t.status !== "SUCCESS" && t.status !== "FAILED") || typeof t.envelopeXdr !== "string") return refusal("stellar/unreadable");
  const scan = scanEnvelope(t.envelopeXdr, input.network);
  if (isRefusal(scan)) return scan;
  if (scan.signers.length !== 1) return refusal("stellar/no-carrier");
  const read = readSignedPayload(scan.signers[0]!.payload);
  return isRefusal(read) ? read : read.h;
}
