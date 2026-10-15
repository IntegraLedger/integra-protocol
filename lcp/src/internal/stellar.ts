/**
 * Stellar rail pieces: the payer-signed Soroban `transfer`, its muxed `to` whose 8-byte id is the ATR hash's first 8
 * bytes, the digest of the signed authorization entry, and settlement read through a bounded reader. XDR, strkeys and
 * hashing use the base part of @stellar/stellar-sdk, loaded once when this module is; without it every function that
 * needs it refuses `stellar/peer-missing`, except the writer `muxedFor`, which throws TypeError, and the reads:
 * `stellarStatus` is pending `unreadable` and `stellarLocate` `complete: false`, with nothing read. The public names
 * are re-exported by `../stellar.ts`.
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
import { isObject } from "../fields.js";
import type { Hex } from "../evm.js";
import { fromBase64, toBase64 } from "../rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

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
const MAX_LOCATE_PAGES = 10;
const MAX_CANDIDATES = 50;
/** The symbols read here, as bytes: a symbol is compared byte for byte, so one led by a byte-order mark is another. */
const TRANSFER = new TextEncoder().encode("transfer");
const TO_MUXED_ID = new TextEncoder().encode("to_muxed_id");

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

/**
 * Bounded, read-only calls against one network's RPC. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`; any rejection reads as unreadable.
 */
export interface StellarReader {
  readonly network: StellarNetwork;
  /** `getTransaction`. */
  transaction(hash: string): Promise<{
    status: "SUCCESS" | "FAILED" | "NOT_FOUND";
    envelopeXdr?: string;
    ledger?: number;
    oldestLedger: number;
  }>;
  /**
   * One page of SEP-41 `transfer` events of `asset` to `toBase` from `fromLedger` through `toLedger`, both inclusive,
   * with each event's `to_muxed_id`. `stellarLocate` passes the authorization entry's expiration ledger as `toLedger`,
   * and the entry can still be used in that ledger. `cursor` is present while more pages remain: until the search has
   * read through `toLedger`, or through the `latestLedger` the node reported where that is lower (a short page, which
   * `stellarLocate` reads as behind). `complete` is false when the RPC reports events disabled. `oldestLedger` is the oldest
   * ledger the RPC still holds, and `latestLedger` the latest ledger it held when it answered (`getEvents`'
   * `latestLedger`). Stellar RPC's `getEvents` treats `endLedger` as exclusive, takes a cursor or a ledger range but
   * not both, and scans a bounded number of ledgers per call (10,000 in stellar-rpc), so a reader over it sends
   * `startLedger: fromLedger` and `endLedger: toLedger + 1` on the first page and only the cursor on later pages, and
   * returns a `cursor` until `getEvents` has scanned through `toLedger` or its own `latestLedger`, whichever is lower,
   * whether or not a page holds events. A cursor
   * page can scan past `toLedger`, so the reader keeps only the events through `toLedger`.
   */
  transfers(f: {
    asset: string;
    toBase: string;
    fromLedger: number;
    toLedger: number;
    cursor?: string;
  }): Promise<{
    events: readonly { txHash: string; toMuxedId: bigint | null }[];
    cursor?: string;
    complete: boolean;
    oldestLedger: number;
    latestLedger: number;
  }>;
  /** `getLatestLedger`. */
  latestLedger(): Promise<number>;
}

/** The read keys `reference` returns. */
export interface StellarRef {
  network: StellarNetwork;
  transaction?: string;
  /**
   * SHA-256 of the payer's authorization entry's `HashIDPreimage`. Absent, with `expiration`, for an MPP push payment
   * the payer authorized as the transaction's source account: `transaction` then names the instrument.
   */
  authDigest?: Hex;
  asset: string;
  toBase: string;
  /** The muxed id, as a decimal string. */
  toId: string;
  /** The entry's expiration ledger. Absent with `authDigest`. */
  expiration?: number;
  fromLedger: number;
}

/**
 * What a read of the instrument shows. `settled`: a transaction that used this authorization entry succeeded, or, for a
 * ref without `authDigest`, the named transaction succeeded as the transfer the payer authorized as its source account.
 * `pending`: nothing final yet; `why` names what the named transaction read as (`not-found`, `transaction-failed`, a
 * successful transaction that is `not-this-instrument`) or that a read failed (`unreadable`). `failed` is final:
 * `expired`, the ledger is past the entry's expiration and a complete search finds no transaction that used it.
 */
export type StellarStatus =
  | { state: "settled"; ledger: number }
  | { state: "pending"; why: "not-found" | "transaction-failed" | "not-this-instrument" | "unreadable" }
  | { state: "failed"; why: "expired" };

/** What the payer signs (the signer signs SHA-256 of `preimage`), and how the signature completes the transaction. */
export interface StellarUnsigned {
  request: { kind: "stellar-auth"; preimage: Uint8Array<ArrayBuffer> };
  /** The base64 XDR of the transaction with the entry signed. */
  complete(signature: Uint8Array): string | Refusal;
}

/**
 * A payment on `x402/exact/stellar`: the base64 XDR of the transaction with the payer's entry signed. The root names it
 * among the payments `Presented` covers; no entry point exports it.
 */
export interface StellarPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string };
  extensions?: PaymentRequired["extensions"];
}

// ── the carrier ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The hash's first 8 bytes, big-endian, as a u64. Throws TypeError when `h` is not a 32-byte hash. */
export function muxedId(h: AtrHash): bigint {
  const b = toRawBytes(h);
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[i]!);
  return v;
}

/**
 * The `M…` strkey of a `G…` account and `muxedId(h)`. Throws TypeError when `base` is not a `G…` strkey or `h` is not a
 * 32-byte hash, and when @stellar/stellar-sdk is not installed.
 */
export function muxedFor(base: string, h: AtrHash): string {
  const S = need();
  if (S === null) throw new TypeError("@stellar/stellar-sdk is not installed");
  if (!S.StrKey.isValidEd25519PublicKey(base)) throw new TypeError("not a G account strkey");
  const raw = new Uint8Array(40);
  raw.set(S.StrKey.decodeEd25519PublicKey(base), 0);
  new DataView(raw.buffer).setBigUint64(32, muxedId(h), false);
  return S.StrKey.encodeMed25519PublicKey(raw);
}

/** The `G…` base and the id of an `M…` strkey, or null. */
export function unmux(m: unknown): { base: string; id: bigint } | null {
  const S = need();
  if (S === null || typeof m !== "string" || !S.StrKey.isValidMed25519PublicKey(m)) return null;
  const raw = S.StrKey.decodeMed25519PublicKey(m);
  return {
    base: S.StrKey.encodeEd25519PublicKey(raw.subarray(0, 32)),
    id: new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getBigUint64(32, false),
  };
}

export function isAccount(s: unknown): s is string {
  const S = need();
  return S !== null && typeof s === "string" && S.StrKey.isValidEd25519PublicKey(s);
}

export function isContract(s: unknown): s is string {
  const S = need();
  return S !== null && typeof s === "string" && S.StrKey.isValidContract(s);
}

export function isMuxed(s: unknown): s is string {
  return unmux(s) !== null;
}

function need(): typeof StellarBase | null {
  return peer ?? null;
}

/** True when @stellar/stellar-sdk loaded with this module. */
export function hasPeer(): boolean {
  return peer !== undefined;
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
function operationOf(S: typeof StellarBase, xdrB64: string): Operation | Refusal {
  const bytes = fromBase64(xdrB64);
  if (bytes === null) return refusal("stellar/tx-malformed");
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
function parse(S: typeof StellarBase, xdrB64: string, network: StellarNetwork, landed: boolean): Parsed | Refusal {
  const o = operationOf(S, xdrB64);
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
 * The payment the payer's entry signs, and whether the operation invokes exactly that: the input checks of
 * `decodeStellarTx`, without refusing an operation that differs from the signed invocation. With `landed` (a
 * transaction the ledger recorded), the entry is the first entry of `from` that carries the operation's `transfer`;
 * without it (before anything lands), `from` must have exactly one entry.
 */
export function readSignedTransfer(
  xdrB64: string,
  network: StellarNetwork,
  landed: boolean,
): { payment: StellarPayment; agrees: boolean } | Refusal {
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  if (!isStellarNetwork(network)) return refusal("stellar/network-malformed");
  if (typeof xdrB64 !== "string" || xdrB64.length === 0) return refusal("stellar/tx-malformed");
  if (xdrB64.length > MAX_XDR) return refusal("stellar/tx-too-large");
  const p = parse(S, xdrB64, network, landed);
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
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  if (!isStellarNetwork(network)) return refusal("stellar/network-malformed");
  if (typeof xdrB64 !== "string" || xdrB64.length === 0) return refusal("stellar/tx-malformed");
  if (xdrB64.length > MAX_XDR) return refusal("stellar/tx-too-large");
  const o = operationOf(S, xdrB64);
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
 * without an address entry of `from` the envelope is `stellar/no-address-auth`. Only `mpp/charge/stellar`'s push
 * credential, once its transaction landed, reads a payer that authorized the transfer as the transaction's source
 * account.
 */
export function decodeStellarTx(xdrB64: string, network: StellarNetwork): StellarPayment | Refusal {
  const p = readSignedTransfer(xdrB64, network, false);
  if (isRefusal(p)) return p;
  return p.agrees ? p.payment : refusal("stellar/not-one-transfer");
}

/**
 * Sets the `from` entry's expiration ledger in a simulated envelope and returns its `HashIDPreimage` bytes, the payment
 * that entry signs, whether the operation invokes exactly that, and a completion that writes the payer's signature as `authorizeEntry` does for an account: a vector of one map
 * `{public_key, signature}`.
 */
export function signingFor(
  simulatedXdr: string,
  network: StellarNetwork,
  expiration: number,
  zeroSource: boolean,
): { payment: StellarPayment; agrees: boolean; unsigned: StellarUnsigned } | Refusal {
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  if (!isStellarNetwork(network)) return refusal("stellar/network-malformed");
  if (typeof simulatedXdr !== "string" || simulatedXdr.length === 0) return refusal("stellar/tx-malformed");
  if (simulatedXdr.length > MAX_XDR) return refusal("stellar/tx-too-large");
  const parsed = parse(S, simulatedXdr, network, false);
  if (isRefusal(parsed)) return parsed;
  const { payment, wire, entry, cred } = parsed;
  if (!Number.isInteger(expiration) || expiration < 0 || expiration > 0xffffffff) return refusal("stellar/tx-malformed");
  if (!S.StrKey.isValidEd25519PublicKey(payment.from)) return refusal("stellar/no-address-auth");
  if (wire.type !== 2) return refusal("stellar/tx-malformed");
  if (zeroSource) wire.v1.tx.sourceAccount = { type: 0, ed25519: new Uint8Array(32) };
  cred.c.signatureExpirationLedger = expiration;
  const preimage = Uint8Array.from(preimageOf(S, network, entry, cred));
  const publicKey = S.StrKey.decodeEd25519PublicKey(payment.from);
  const x = S.xdr;
  return {
    payment,
    agrees: parsed.agrees,
    unsigned: {
      request: { kind: "stellar-auth", preimage },
      complete(signature: Uint8Array): string | Refusal {
        if (!(signature instanceof Uint8Array) || signature.length !== 64) return refusal("stellar/tx-malformed");
        cred.c.signature = {
          type: 16,
          vec: [
            {
              type: 17,
              map: [
                { key: { type: 15, sym: new x.XdrString("public_key") }, val: { type: 13, bytes: Uint8Array.from(publicKey) } },
                { key: { type: 15, sym: new x.XdrString("signature") }, val: { type: 13, bytes: new Uint8Array(signature) } },
              ],
            },
          ],
        };
        try {
          return toBase64(writeXdr(x.TransactionEnvelope, wire));
        } catch {
          return refusal("stellar/tx-malformed");
        }
      },
    },
  };
}

// ── transfer events ──────────────────────────────────────────────────────────────────────────────────────────

const MAX_EVENT_XDR = 1024;

/**
 * The `getEvents` topic filter for SEP-41 `transfer` events to `toBase`, as base64 XDR segments: the symbol
 * `transfer`, any `from`, `toBase` as an address, and any trailing topics (the Stellar Asset Contract adds its asset).
 */
export function transferEventTopics(toBase: string): readonly string[] | Refusal {
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  const x = S.xdr;
  let to: ScAddressWire;
  if (S.StrKey.isValidEd25519PublicKey(toBase)) to = { type: 0, accountId: { type: 0, ed25519: S.StrKey.decodeEd25519PublicKey(toBase) } };
  else if (S.StrKey.isValidContract(toBase)) to = { type: 1, contractId: S.StrKey.decodeContract(toBase) };
  else return refusal("stellar/option-malformed");
  return [
    x.ScVal.fromXdrObject({ type: 15, sym: new x.XdrString("transfer") }).toXdr("base64"),
    "*",
    x.ScVal.fromXdrObject({ type: 18, address: to }).toXdr("base64"),
    "**",
  ];
}

/**
 * A `transfer` event's recipient (the non-muxed `to` topic) and its `to_muxed_id`: the u64 in the event's data map, or
 * null when the data carries none, or carries the string or bytes form. The first topic and the data map's key are the
 * symbols `transfer` and `to_muxed_id`, byte for byte.
 */
export function transferEventOf(topic: readonly string[], value: string): { toBase: string; toMuxedId: bigint | null } | Refusal {
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  if (!Array.isArray(topic) || topic.length < 3 || topic.length > 4 || typeof value !== "string" || value.length > MAX_EVENT_XDR) {
    return refusal("stellar/event-malformed");
  }
  try {
    const x = S.xdr;
    const t = topic.map((b) => {
      if (typeof b !== "string" || b.length > MAX_EVENT_XDR) throw new TypeError("topic");
      const bytes = fromBase64(b);
      if (bytes === null) throw new TypeError("topic");
      return x.ScVal.fromXdr(bytes).toXdrObject();
    });
    if (!scValsWithinCaps(t)) return refusal("stellar/event-malformed");
    const name = t[0]!;
    if (name.type !== 15 || !equalBytes(name.sym.bytes, TRANSFER)) return refusal("stellar/event-malformed");
    const to = t[2]!;
    const who = to.type === 18 ? addressOf(S, to.address) : null;
    if (who === null) return refusal("stellar/event-malformed");
    const valueBytes = fromBase64(value);
    if (valueBytes === null) return refusal("stellar/event-malformed");
    const data = x.ScVal.fromXdr(valueBytes).toXdrObject();
    if (!scValsWithinCaps(data)) return refusal("stellar/event-malformed");
    let toMuxedId: bigint | null = null;
    if (data.type === 17) {
      const entry = (data.map ?? []).find((e) => e.key.type === 15 && equalBytes(e.key.sym.bytes, TO_MUXED_ID));
      if (entry !== undefined && entry.val.type === 5) toMuxedId = entry.val.u64;
    } else if (data.type !== 10) return refusal("stellar/event-malformed");
    return { toBase: who.base, toMuxedId };
  } catch {
    return refusal("stellar/event-malformed");
  }
}

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One transaction read by hash: settled on this instrument, not final, or a transaction that is not this one's use. */
type Named =
  | { state: "settled"; ledger: number }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "other"; why: "transaction-failed" | "not-this-instrument" };

const TX_HASH = /^[0-9a-fA-F]{64}$/;
const AUTH_DIGEST = /^0x[0-9a-fA-F]{64}$/;
const U64_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;

/** A ledger sequence number: an integer from 0 to 2^32 − 1. */
function isLedger(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 0xffffffff;
}

/**
 * True when the fields a read compares the payment with, or looks it up by, are in the forms `reference` writes and
 * the caller completes: a Stellar network; an `authDigest` of `0x` and 64 hex digits with an `expiration` ledger, or
 * neither (the MPP push form whose payer is the transaction's source account); `asset` a contract strkey and `toBase`
 * an account or contract strkey; `toId` a u64 in decimal; and a `fromLedger` ledger.
 */
function refWellFormed(ref: StellarRef): boolean {
  const entry = ref.authDigest !== undefined || ref.expiration !== undefined;
  return (
    isStellarNetwork(ref.network) &&
    (!entry || (typeof ref.authDigest === "string" && AUTH_DIGEST.test(ref.authDigest) && isLedger(ref.expiration))) &&
    isContract(ref.asset) &&
    (isAccount(ref.toBase) || isContract(ref.toBase)) &&
    typeof ref.toId === "string" &&
    U64_DECIMAL.test(ref.toId) &&
    BigInt(ref.toId) < 1n << 64n &&
    isLedger(ref.fromLedger)
  );
}

/**
 * Reads one transaction. Settled when it succeeded and the payer's first address-credential entry that carries its
 * `transfer` has the preimage digest and `to` id the ref records. A transaction that failed, or succeeded with another
 * entry, is `other`: the entry was not used there. For a ref without `authDigest`, settled when it succeeded as a
 * transfer the payer authorized as its source account (`readSourceTransfer`) whose `to` carries the ref's `toId`. One
 * call.
 */
async function readNamed(ref: StellarRef, hash: string, reader: StellarReader): Promise<Named> {
  let r: Awaited<ReturnType<StellarReader["transaction"]>>;
  try {
    r = await reader.transaction(hash);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (typeof r !== "object" || r === null) return { state: "pending", why: "unreadable" };
  if (r.status === "NOT_FOUND") return { state: "pending", why: "not-found" };
  if (r.status === "FAILED") return { state: "other", why: "transaction-failed" };
  if (r.status !== "SUCCESS" || typeof r.envelopeXdr !== "string" || !Number.isInteger(r.ledger)) {
    return { state: "pending", why: "unreadable" };
  }
  const digest = ref.authDigest;
  if (digest === undefined) {
    const s = readSourceTransfer(r.envelopeXdr, ref.network);
    if (isRefusal(s) && s.code === "stellar/peer-missing") return { state: "pending", why: "unreadable" };
    if (isRefusal(s) || s.toId === null || s.toId.toString() !== ref.toId) {
      return { state: "other", why: "not-this-instrument" };
    }
    return { state: "settled", ledger: r.ledger! };
  }
  const t = readSignedTransfer(r.envelopeXdr, ref.network, true);
  if (isRefusal(t) && t.code === "stellar/peer-missing") return { state: "pending", why: "unreadable" };
  if (isRefusal(t) || !t.agrees) return { state: "other", why: "not-this-instrument" };
  const p = t.payment;
  if (p.auth.preimageHash !== digest.toLowerCase() || p.toId === null || p.toId.toString() !== ref.toId) {
    return { state: "other", why: "not-this-instrument" };
  }
  return { state: "settled", ledger: r.ledger! };
}

/**
 * Reads the instrument through a named transaction. Settled when that transaction succeeded and used the authorization
 * entry `ref.authDigest` names. A landed transaction is read by the payer's first address-credential entry whose
 * `rootInvocation` is the operation's `transfer`, byte for byte, with no sub-invocations; other entries of the payer in
 * it are not read. Otherwise the entry can still be used by another transaction until its expiration ledger, so a named
 * transaction that is not found, failed, or succeeded with another entry is pending. The read is final only past that
 * ledger (`latestLedger()` above `expiration`): then `stellarLocate`'s search decides, settled when it finds a
 * transaction that used the entry, failed `expired` when it is complete, finds none, and each events page names a
 * `latestLedger` at or above the one read first, and pending otherwise: an events index that lags the ledger read first
 * is never read as absence. A failed read, or a reader for another network, is pending. A ref that lacks a field the
 * read uses, or holds one in another form than `reference` writes, is pending `unreadable`, with nothing read: a
 * `transaction` other than 64 hex digits (looked up in lower case), an `authDigest` other than `0x` and 64 hex digits,
 * an `authDigest` without an `expiration` or an `expiration` without an `authDigest`, an `asset` that is not a contract
 * strkey, a `toBase` that is not an account or contract strkey, a `toId` that is not a u64 in decimal, or an
 * `expiration` or `fromLedger` that is not an integer from 0 to 2^32 − 1. One call when the named transaction settles or
 * a read fails, two before the expiration ledger has passed, and after it `stellarLocate`'s calls as well. A ref
 * without `authDigest` (an MPP push payment the payer authorized as the transaction's source account, with no
 * `expiration` either) is settled when the named transaction succeeded as that transfer, and is otherwise pending:
 * there is no expiration ledger to pass.
 */
export async function stellarStatus(
  ref: StellarRef & { transaction: string },
  reader: StellarReader,
): Promise<StellarStatus> {
  if (
    !isObject(ref) ||
    !isObject(reader) ||
    reader.network !== ref.network ||
    typeof ref.transaction !== "string" ||
    !TX_HASH.test(ref.transaction) ||
    !refWellFormed(ref)
  ) {
    return { state: "pending", why: "unreadable" };
  }
  const named = await readNamed(ref, ref.transaction.toLowerCase(), reader);
  if (named.state === "settled") return named;
  if (named.why === "unreadable") return { state: "pending", why: "unreadable" };
  const expiration = ref.expiration;
  if (ref.authDigest === undefined || expiration === undefined) return { state: "pending", why: named.why };
  let latest: number;
  try {
    latest = await reader.latestLedger();
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (!Number.isSafeInteger(latest)) return { state: "pending", why: "unreadable" };
  if (latest <= expiration) return { state: "pending", why: named.why };
  const l = await locate(ref, expiration, reader, latest);
  if (l.found !== undefined) return { state: "settled", ledger: l.found.ledger };
  return l.complete ? { state: "failed", why: "expired" } : { state: "pending", why: named.why };
}

/**
 * Finds the instrument when no transaction was named: the asset's transfer events to `toBase` from `fromLedger` through
 * the entry's expiration ledger, both inclusive, keeping those whose muxed id is `toId`, each read as `stellarStatus`
 * reads its named transaction. A candidate that settles is `found`, on any page. With none found, `complete` is true
 * only when every page was read, the reader reported events enabled on each, the RPC still held `fromLedger`
 * (`oldestLedger` ≤ `fromLedger`) and had reached the expiration ledger (`latestLedger` ≥ `expiration`), and every
 * candidate was read: a listed candidate whose transaction is not found, or cannot be read, leaves the search
 * incomplete. At most 10 pages and 50 candidates. A ref without `authDigest` or `expiration` names its transaction and
 * has no entry to search for: `complete` is false. A ref or reader that is not an object, a reader for another network,
 * or a ref with a field the search uses in another form than `stellarStatus` reads (an `authDigest`, `expiration`,
 * `asset`, `toBase`, `toId` or `fromLedger`), is `complete` false too, with nothing read.
 */
export async function stellarLocate(
  ref: StellarRef,
  reader: StellarReader,
): Promise<{ found?: string; complete: boolean }> {
  if (!isObject(ref) || !isObject(reader)) return { complete: false };
  if (reader.network !== ref.network || typeof ref.authDigest !== "string" || ref.expiration === undefined) return { complete: false };
  if (!refWellFormed(ref)) return { complete: false };
  const l = await locate(ref, ref.expiration, reader, ref.expiration);
  return l.found !== undefined ? { found: l.found.hash, complete: true } : { complete: l.complete };
}

/**
 * The search through `expiration`. A candidate that settles is found on any page; with none found, the search is
 * complete only when every events page names a `latestLedger` at or above `through`: the ledger the caller read its
 * reference point at, or the expiration ledger itself.
 */
async function locate(
  ref: StellarRef,
  expiration: number,
  reader: StellarReader,
  through: number,
): Promise<{ found?: { hash: string; ledger: number }; complete: boolean }> {
  let cursor: string | undefined;
  let candidates = 0;
  let behind = false;
  for (let page = 0; page < MAX_LOCATE_PAGES; page++) {
    let r: Awaited<ReturnType<StellarReader["transfers"]>>;
    try {
      r = await reader.transfers({
        asset: ref.asset,
        toBase: ref.toBase,
        fromLedger: ref.fromLedger,
        toLedger: expiration,
        ...(cursor !== undefined ? { cursor } : {}),
      });
    } catch {
      return { complete: false };
    }
    if (typeof r !== "object" || r === null || !Array.isArray(r.events) || r.complete !== true) return { complete: false };
    if (!Number.isInteger(r.oldestLedger) || r.oldestLedger > ref.fromLedger) return { complete: false };
    if (!Number.isInteger(r.latestLedger) || r.latestLedger < through) behind = true;
    for (const e of r.events) {
      if (typeof e?.toMuxedId !== "bigint" || e.toMuxedId.toString() !== ref.toId || typeof e.txHash !== "string") continue;
      if (++candidates > MAX_CANDIDATES) return { complete: false };
      const s = await readNamed(ref, e.txHash, reader);
      if (s.state === "settled") return { found: { hash: e.txHash, ledger: s.ledger }, complete: true };
      if (s.state === "pending") return { complete: false };
    }
    if (r.cursor === undefined) return { complete: !behind };
    cursor = r.cursor;
  }
  return { complete: false };
}

