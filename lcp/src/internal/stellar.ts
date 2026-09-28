/**
 * Stellar rail pieces: the payer-signed Soroban `transfer`, its muxed `to` whose 8-byte id is the ATR hash's first 8
 * bytes, the digest of the signed authorization entry, and settlement read through a bounded reader. XDR, strkeys and
 * hashing use the base part of @stellar/stellar-sdk, loaded once when this module is; without it every function that
 * needs it refuses `stellar/peer-missing`. The public names are re-exported by `../stellar.ts`.
 */
import type * as StellarBase from "@stellar/stellar-sdk/base";
import { base64 } from "@scure/base";
import type {
  HashIdPreimageWire,
  InvokeContractArgsWire,
  ScAddressWire,
  ScValWire,
  SorobanAddressCredentialsWire,
  SorobanAuthorizationEntryWire,
  TransactionEnvelopeWire,
  TransactionV1EnvelopeWire,
} from "@stellar/stellar-sdk/xdr";
import { toRawBytes, type AtrHash } from "../core.js";
import type { Hex } from "../evm.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";

const peer: typeof StellarBase | undefined = await import("@stellar/stellar-sdk/base").then(
  (m) => m,
  () => undefined,
);

export type StellarNetwork = "stellar:pubnet" | "stellar:testnet";

export const PASSPHRASE: Readonly<Record<StellarNetwork, string>> = Object.freeze({
  "stellar:pubnet": "Public Global Stellar Network ; September 2015",
  "stellar:testnet": "Test SDF Network ; September 2015",
});

export const MAX_XDR = 8192;
/**
 * The deepest nesting of ScVal vectors and maps (a contract instance's storage counting as a map) within one ScVal,
 * the outermost container being level 1, and of authorized invocations within one authorization entry.
 */
export const SCVAL_MAX_DEPTH = 64;
/**
 * The most ScVal vector elements and map entries in one envelope. Each takes at least its 4-byte discriminant, so no
 * envelope within `MAX_XDR` base64 characters holds more.
 */
export const SCVAL_MAX_ELEMENTS = (MAX_XDR * 3) / 4 / 4;
const MAX_LOCATE_PAGES = 10;
const MAX_CANDIDATES = 50;

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

/** Bounded, read-only calls against one network's RPC. Every failure rejects with `ReaderError`. */
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
   * One page of SEP-41 `transfer` events of `asset` to `toBase` between two ledgers, with each event's `to_muxed_id`.
   * `cursor` is present while more pages remain. `complete` is false when the RPC reports events disabled.
   * `oldestLedger` is the oldest ledger the RPC still holds.
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
  }>;
  /** `getLatestLedger`. */
  latestLedger(): Promise<number>;
}

/** The read keys recorded at claim. */
export interface StellarRef {
  network: StellarNetwork;
  transaction?: string;
  authDigest: Hex;
  asset: string;
  toBase: string;
  /** The muxed id, as a decimal string. */
  toId: string;
  expiration: number;
  fromLedger: number;
}

/**
 * What a read of the instrument shows. `settled`: a transaction that used this authorization entry succeeded.
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
  request: { kind: "stellar-auth"; preimage: Uint8Array };
  /** The base64 XDR of the transaction with the entry signed. */
  complete(signature: Uint8Array): string | Refusal;
}

// ── the carrier ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The hash's first 8 bytes, big-endian, as a u64. */
export function muxedId(h: AtrHash): bigint {
  const b = toRawBytes(h);
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[i]!);
  return v;
}

/** The `M…` strkey of a `G…` account and `muxedId(h)`. Throws TypeError when `base` is not a `G…` strkey. */
export function muxedFor(base: string, h: AtrHash): string {
  const S = need();
  if (S === null || !S.StrKey.isValidEd25519PublicKey(base)) throw new TypeError("not a G account strkey");
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
  return S.xdr.HashIdPreimage.fromXdrObject(wire).toXdr("raw");
}

function hexOf(b: Uint8Array): string {
  let out = "";
  for (const x of b) out += x.toString(16).padStart(2, "0");
  return out;
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

/** A contract call's `transfer(from, to, amount)`: the contract, both addresses and the amount, or null. */
function transferOf(
  S: typeof StellarBase,
  call: InvokeContractArgsWire,
): { asset: string; from: NonNullable<ReturnType<typeof addressOf>>; to: NonNullable<ReturnType<typeof addressOf>>; amount: bigint } | null {
  const args = call.args;
  if (new TextDecoder().decode(call.functionName.bytes) !== "transfer" || args.length !== 3 || call.contractAddress.type !== 1) {
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
 * True when every ScVal in a decoded XDR value nests at most `SCVAL_MAX_DEPTH` vectors and maps, every authorized
 * invocation at most `SCVAL_MAX_DEPTH` sub-invocations, and the value holds at most `SCVAL_MAX_ELEMENTS` vector
 * elements and map entries. The walk keeps its own stack.
 */
export function scValsWithinCaps(wire: unknown): boolean {
  let elements = 0;
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
      elements += children.length;
      if (elements > SCVAL_MAX_ELEMENTS) return false;
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

/** Strict RFC 4648 base64: the standard alphabet, padded to a multiple of 4, with zero padding bits. */
function strictBase64(s: string): Uint8Array | null {
  try {
    return base64.decode(s);
  } catch {
    return null;
  }
}

/**
 * The envelope's one `transfer` operation and the one address-credential entry whose address is its `from`. The
 * payment's contract, `to` and amount are read from the entry's `rootInvocation`, the invocation the payer signs, which
 * must itself be one `transfer(from, to, amount)` with no sub-invocations.
 */
function parse(S: typeof StellarBase, xdrB64: string, network: StellarNetwork): Parsed | Refusal {
  const bytes = strictBase64(xdrB64);
  if (bytes === null) return refusal("stellar/tx-malformed");
  let wire: TransactionEnvelopeWire;
  try {
    wire = S.xdr.TransactionEnvelope.fromXdr(bytes).toXdrObject();
  } catch {
    return refusal("stellar/tx-malformed");
  }
  if (!scValsWithinCaps(wire)) return refusal("stellar/tx-malformed");
  const v1 = v1Of(wire);
  if (v1 === null) return refusal("stellar/tx-malformed");
  try {
    const ops = v1.tx.operations;
    if (ops.length !== 1) return refusal("stellar/not-one-transfer");
    const body = ops[0]!.body;
    if (body.type !== 24) return refusal("stellar/not-one-transfer");
    const op = body.invokeHostFunctionOp;
    if (op.hostFunction.type !== 0) return refusal("stellar/not-one-transfer");
    const call = op.hostFunction.invokeContract;
    const operation = transferOf(S, call);
    if (operation === null) return refusal("stellar/not-one-transfer");

    const entries = op.auth.flatMap((e) => {
      const a = addressCredentials(e);
      if (a === null) return [];
      const who = addressOf(S, a.c.address);
      return who !== null && who.s === operation.from.s ? [{ e, a }] : [];
    });
    if (entries.length !== 1) return refusal("stellar/no-address-auth");
    const { e: entry, a: cred } = entries[0]!;
    const root = entry.rootInvocation;
    if (root.function.type !== 0 || root.subInvocations.length !== 0) return refusal("stellar/not-one-transfer");
    const signed = transferOf(S, root.function.contractFn);
    if (signed === null) return refusal("stellar/not-one-transfer");
    const agrees = equalBytes(
      S.xdr.InvokeContractArgs.fromXdrObject(call).toXdr("raw"),
      S.xdr.InvokeContractArgs.fromXdrObject(root.function.contractFn).toXdr("raw"),
    );
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
 * `decodeStellarTx`, without refusing an operation that differs from the signed invocation.
 */
export function readSignedTransfer(
  xdrB64: string,
  network: StellarNetwork,
): { payment: StellarPayment; agrees: boolean } | Refusal {
  const S = need();
  if (S === null) return refusal("stellar/peer-missing");
  if (!isStellarNetwork(network)) return refusal("stellar/network-malformed");
  if (typeof xdrB64 !== "string" || xdrB64.length === 0) return refusal("stellar/tx-malformed");
  if (xdrB64.length > MAX_XDR) return refusal("stellar/tx-too-large");
  const p = parse(S, xdrB64, network);
  return isRefusal(p) ? p : { payment: p.payment, agrees: p.agrees };
}

/**
 * Decodes a base64 `TransactionEnvelope` (v1, or a fee bump's inner v1) of at most 8 KiB holding exactly one
 * `invokeHostFunction` operation that calls `transfer(from, to, amount)` on a contract, and the one authorization entry
 * with address credentials (`sorobanCredentialsAddress` or `sorobanCredentialsAddressV2`) whose address is `from`.
 * The entry's `rootInvocation` must be that same `transfer`, byte for byte, with no sub-invocations; the payment's
 * contract, `to` and amount are the signed invocation's. The base64 is read strictly (RFC 4648 §4, zero padding bits),
 * and the XDR must be consumed whole. `preimageHash` is SHA-256 of that entry's `HashIDPreimage` under the network's
 * passphrase: the V1 form, or for V2 the form with the address.
 */
export function decodeStellarTx(xdrB64: string, network: StellarNetwork): StellarPayment | Refusal {
  const p = readSignedTransfer(xdrB64, network);
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
  const parsed = parse(S, simulatedXdr, network);
  if (isRefusal(parsed)) return parsed;
  const { payment, wire, entry, cred } = parsed;
  if (!Number.isInteger(expiration) || expiration < 0 || expiration > 0xffffffff) return refusal("stellar/tx-malformed");
  if (!S.StrKey.isValidEd25519PublicKey(payment.from)) return refusal("stellar/no-address-auth");
  if (wire.type !== 2) return refusal("stellar/tx-malformed");
  if (zeroSource) wire.v1.tx.sourceAccount = { type: 0, ed25519: new Uint8Array(32) };
  cred.c.signatureExpirationLedger = expiration;
  const preimage = preimageOf(S, network, entry, cred);
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
                { key: { type: 15, sym: new x.XdrString("signature") }, val: { type: 13, bytes: Uint8Array.from(signature) } },
              ],
            },
          ],
        };
        try {
          return x.TransactionEnvelope.fromXdrObject(wire).toXdr("base64");
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
 * null when the data carries none, or carries the string or bytes form.
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
      return x.ScVal.fromXdr(b, "base64").toXdrObject();
    });
    if (!scValsWithinCaps(t)) return refusal("stellar/event-malformed");
    const name = t[0]!;
    if (name.type !== 15 || new TextDecoder().decode(name.sym.bytes) !== "transfer") return refusal("stellar/event-malformed");
    const to = t[2]!;
    const who = to.type === 18 ? addressOf(S, to.address) : null;
    if (who === null) return refusal("stellar/event-malformed");
    const data = x.ScVal.fromXdr(value, "base64").toXdrObject();
    if (!scValsWithinCaps(data)) return refusal("stellar/event-malformed");
    let toMuxedId: bigint | null = null;
    if (data.type === 17) {
      const entry = (data.map ?? []).find((e) => e.key.type === 15 && new TextDecoder().decode(e.key.sym.bytes) === "to_muxed_id");
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

/**
 * Reads one transaction. Settled when it succeeded and its authorization entry's preimage digest and `to` id are the
 * ones recorded at claim. A transaction that failed, or succeeded with another entry, is `other`: the entry was not
 * used there. One call.
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
  const p = decodeStellarTx(r.envelopeXdr, ref.network);
  if (isRefusal(p) && p.code === "stellar/peer-missing") return { state: "pending", why: "unreadable" };
  if (isRefusal(p)) return { state: "other", why: "not-this-instrument" };
  if (p.auth.preimageHash !== ref.authDigest.toLowerCase() || p.toId === null || p.toId.toString() !== ref.toId) {
    return { state: "other", why: "not-this-instrument" };
  }
  return { state: "settled", ledger: r.ledger! };
}

/**
 * Reads the instrument through a named transaction. Settled when that transaction used the authorization entry recorded
 * at claim and succeeded. Otherwise the entry can still be used by another transaction until its expiration ledger, so
 * a named transaction that is not found, failed, or succeeded with another entry is pending. The read is final only
 * past that ledger (`latestLedger()` above `expiration`): then `stellarLocate`'s search decides, settled when it finds a
 * transaction that used the entry, failed `expired` when it is complete and finds none, and pending when it is
 * incomplete. A failed read, or a reader for another network, is pending. One call when the named transaction settles
 * or a read fails, two before the expiration ledger has passed, and after it `stellarLocate`'s calls as well.
 */
export async function stellarStatus(
  ref: StellarRef & { transaction: string },
  reader: StellarReader,
): Promise<StellarStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  const named = await readNamed(ref, ref.transaction, reader);
  if (named.state === "settled") return named;
  if (named.why === "unreadable") return { state: "pending", why: "unreadable" };
  let latest: number;
  try {
    latest = await reader.latestLedger();
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (!Number.isSafeInteger(latest)) return { state: "pending", why: "unreadable" };
  if (latest <= ref.expiration) return { state: "pending", why: named.why };
  const l = await locate(ref, reader);
  if (l.found !== undefined) return { state: "settled", ledger: l.found.ledger };
  return l.complete ? { state: "failed", why: "expired" } : { state: "pending", why: named.why };
}

/**
 * Finds the instrument when no transaction was named: the asset's transfer events to `toBase` from `fromLedger` to
 * the entry's expiration, keeping those whose muxed id is `toId`, each read as `stellarStatus` reads its named
 * transaction. `complete` is true only when every page was read, the reader reported events enabled on each, the RPC
 * still held `fromLedger` (`oldestLedger` ≤ `fromLedger`), and every candidate was read: a listed candidate whose
 * transaction is not found, or cannot be read, leaves the search incomplete. At most 10 pages and 50 candidates.
 */
export async function stellarLocate(
  ref: StellarRef,
  reader: StellarReader,
): Promise<{ found?: string; complete: boolean }> {
  if (reader.network !== ref.network) return { complete: false };
  const l = await locate(ref, reader);
  return l.found !== undefined ? { found: l.found.hash, complete: true } : { complete: l.complete };
}

async function locate(
  ref: StellarRef,
  reader: StellarReader,
): Promise<{ found?: { hash: string; ledger: number }; complete: boolean }> {
  let cursor: string | undefined;
  let candidates = 0;
  for (let page = 0; page < MAX_LOCATE_PAGES; page++) {
    let r: Awaited<ReturnType<StellarReader["transfers"]>>;
    try {
      r = await reader.transfers({
        asset: ref.asset,
        toBase: ref.toBase,
        fromLedger: ref.fromLedger,
        toLedger: ref.expiration,
        ...(cursor !== undefined ? { cursor } : {}),
      });
    } catch {
      return { complete: false };
    }
    if (typeof r !== "object" || r === null || !Array.isArray(r.events) || r.complete !== true) return { complete: false };
    if (!Number.isInteger(r.oldestLedger) || r.oldestLedger > ref.fromLedger) return { complete: false };
    for (const e of r.events) {
      if (typeof e?.toMuxedId !== "bigint" || e.toMuxedId.toString() !== ref.toId || typeof e.txHash !== "string") continue;
      if (++candidates > MAX_CANDIDATES) return { complete: false };
      const s = await readNamed(ref, e.txHash, reader);
      if (s.state === "settled") return { found: { hash: e.txHash, ledger: s.ledger }, complete: true };
      if (s.state === "pending") return { complete: false };
    }
    if (r.cursor === undefined) return { complete: true };
    cursor = r.cursor;
  }
  return { complete: false };
}

