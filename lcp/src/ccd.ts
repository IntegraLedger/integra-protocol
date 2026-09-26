/**
 * Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo
 * of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer
 * event.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { fromLcpString, hash, hashEquals, toLcpString, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash, UINT256_LIMIT } from "./fields.js";
import { decodeCbor, isMap, isTag, mapGet, type Cbor } from "./cbor.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  filterOf,
  paymentWith,
  readFor,
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

/** CAIP-2: `ccd:` and the first 32 lowercase hex digits of the genesis block hash. */
export type CcdNetwork = `ccd:${string}`;

export interface CcdTransfer {
  kind: "ccd" | "plt";
  tokenId?: string;
  receiver: Uint8Array;
  amount: bigint;
  memo: Uint8Array | null;
}

export type CcdItem =
  | { state: "received" }
  | { state: "committed" }
  | { state: "finalized"; success: boolean; sender: Uint8Array | null; transfers: readonly CcdTransfer[] };

/** Bounded, read-only calls against one network's node. Every failure rejects with `ReaderError`. */
export interface CcdReader {
  readonly network: CcdNetwork;
  /** gRPC v2 `GetBlockItemStatus`; null when the node does not know the item. */
  item(hash: string): Promise<CcdItem | null>;
}

/** The read keys recorded at claim. */
export interface CcdRef {
  network: CcdNetwork;
  transaction?: string;
  asset: string;
  idDigest: Hex;
  settleBy: number;
}

export type CcdStatus =
  | { state: "settled"; finality: "finalized" }
  | { state: "pending"; why: "not-found" | "received" | "committed" | "unreadable" }
  | { state: "failed"; why: "rejected" | "not-this-instrument" };

export type CcdPaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { signedTransaction: { [k: string]: Json } };
  extensions?: PaymentRequired["extensions"];
};

export interface CcdChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  now: number;
}

export interface CcdUnsigned {
  request: {
    kind: "ccd-transfer";
    network: CcdNetwork;
    sponsor: string;
    toAddress: string;
    asset: string;
    amount: string;
    memo: Uint8Array;
    expiresBy: number;
  };
  /** Takes the sender-signed V1 sponsored transaction in the SDK's `signableToJSON` form. */
  complete(signedTransaction: Json): CcdPaymentPayload | Refusal;
}

const ID = "x402/exact/ccd" as const;
const NETWORK = /^ccd:[0-9a-f]{32}$/;
const TOKEN = /^[\x21-\x7e]{1,128}$/;
const DECIMAL = /^[0-9]{1,20}$/;
const HEX = /^(?:[0-9a-fA-F]{2})*$/;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAX_ADDRESS = 64;
const MAX_MEMO = 256;
const MAX_OPERATIONS = 4096;
const MAX_TRANSACTION = 16384;
const UINT64_LIMIT = 1n << 64n;
const TEXT_PREFIX = new Uint8Array([0x78, 0x4d]);
const TAG24_PREFIX = new Uint8Array([0xd8, 0x18, 0x58, 0x4f]);
const utf8 = new TextEncoder();

/** The CBOR text string of `toLcpString(h)`: `78 4d` and the 77 ASCII bytes. */
export function ccdMemo(h: AtrHash): Uint8Array {
  return concat(TEXT_PREFIX, utf8.encode(toLcpString(h)));
}

/** CBOR tag 24 around a byte string holding `ccdMemo(h)`: `d8 18 58 4f` and the 79 bytes. */
export function pltMemo(h: AtrHash): Uint8Array {
  return concat(TAG24_PREFIX, ccdMemo(h));
}

/**
 * The hash a memo carries: exactly one CBOR text string, nothing after it, whose bytes are `ccdMemo` of the hash it
 * names (LCP's string form with lowercase hex, under the preferred two-byte head). `bound`, `status` and `recover` all
 * read a memo through this one function.
 */
export function memoCarrier(memo: Uint8Array): AtrHash | Refusal {
  const v = memo instanceof Uint8Array && memo.length <= MAX_MEMO ? decodeCbor(memo) : null;
  if (typeof v !== "string") return refusal("ccd/memo-not-cbor-text");
  const h = fromLcpString(v);
  return h !== null && equalBytes(memo, ccdMemo(h)) ? h : refusal("ccd/memo-not-lcp");
}

/**
 * The 32 bytes of a base58check account address whose version byte is 1: its last four bytes are the first four of
 * the double SHA-256 of the 33 before them.
 */
export function accountBytes(address: string): Uint8Array | Refusal {
  const raw = accountShape(address);
  if (raw === null) return refusal("ccd/address-malformed");
  const twice = sha256(sha256(raw.subarray(0, 33)));
  for (let i = 0; i < 4; i++) if (twice[i] !== raw[33 + i]) return refusal("ccd/address-malformed");
  return raw.slice(1, 33);
}

/** SHA-256 over the 32 + 32 bytes of the two accounts and the amount as a 32-byte big-endian integer. */
export async function ccdIdDigest(sender: Uint8Array, receiver: Uint8Array, amount: bigint): Promise<Hex | Refusal> {
  if (!(sender instanceof Uint8Array) || sender.length !== 32) return refusal("ccd/address-malformed");
  if (!(receiver instanceof Uint8Array) || receiver.length !== 32) return refusal("ccd/address-malformed");
  if (typeof amount !== "bigint" || amount < 0n || amount >= UINT256_LIMIT) return refusal("ccd/transaction-malformed");
  const packed = new Uint8Array(96);
  packed.set(sender, 0);
  packed.set(receiver, 32);
  let rest = amount;
  for (let i = 95; i >= 64; i--) {
    packed[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return hash(packed);
}

/**
 * Reads the named block item. Settled when it is finalized and successful, with exactly one transfer whose memo
 * `memoCarrier` reads as `ref.h` (a PLT memo with tag 24 unwrapped) and whose sender, receiver and amount hash to
 * `ref.idDigest`. Not final, unknown or unreadable is pending; a reader for another network is pending.
 */
export async function ccdStatus(ref: CcdRef & { transaction: string; h: AtrHash }, reader: CcdReader): Promise<CcdStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  let it: CcdItem | null;
  try {
    it = await reader.item(ref.transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (it === null) return { state: "pending", why: "not-found" };
  if (!isItem(it)) return { state: "pending", why: "unreadable" };
  if (it.state === "received" || it.state === "committed") return { state: "pending", why: it.state };
  if (!it.success) return { state: "failed", why: "rejected" };
  const carrying = it.transfers.filter((t) => t.memo !== null && carries(innerMemo(t), ref.h));
  if (carrying.length !== 1 || it.sender === null) return { state: "failed", why: "not-this-instrument" };
  const t = carrying[0]!;
  const digest = await ccdIdDigest(it.sender, t.receiver, t.amount);
  if (isRefusal(digest) || !hashEquals(digest, ref.idDigest)) return { state: "failed", why: "not-this-instrument" };
  return { state: "settled", finality: "finalized" };
}

/** The hash from a settlement block item alone: its one memo-carrying transfer's memo, through `memoCarrier`. */
export async function ccdRecover(ref: { network: CcdNetwork; transaction: string }, reader: CcdReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("ccd/wrong-reader");
  let it: CcdItem | null;
  try {
    it = await reader.item(ref.transaction);
  } catch {
    return refusal("ccd/unreadable");
  }
  if (it === null) return refusal("ccd/not-found");
  if (!isItem(it)) return refusal("ccd/unreadable");
  if (it.state !== "finalized") return refusal("ccd/not-finalized");
  if (!it.success) return refusal("ccd/rejected");
  const withMemo = it.transfers.filter((t) => t.memo !== null);
  if (withMemo.length !== 1) return refusal("ccd/no-carrier");
  const h = memoCarrier(innerMemo(withMemo[0]!));
  return isRefusal(h) ? refusal("ccd/no-carrier") : h;
}

/** Whether `memoCarrier` reads the memo as `h`. */
function carries(memo: Uint8Array, h: AtrHash): boolean {
  const got = memoCarrier(memo);
  return !isRefusal(got) && hashEquals(got, h);
}

/** A transfer's memo bytes, with a PLT memo's tag 24 around a byte string removed. */
function innerMemo(t: CcdTransfer): Uint8Array {
  const m = t.memo!;
  if (t.kind !== "plt") return m;
  const v = decodeCbor(m);
  return v !== null && isTag(v, 24n) && v.value instanceof Uint8Array ? v.value : m;
}

function isItem(v: unknown): v is CcdItem {
  if (!isObject(v)) return false;
  if (v["state"] === "received" || v["state"] === "committed") return true;
  if (v["state"] !== "finalized" || typeof v["success"] !== "boolean") return false;
  const sender = v["sender"];
  if (sender !== null && !(sender instanceof Uint8Array)) return false;
  const transfers = v["transfers"];
  return (
    Array.isArray(transfers) &&
    transfers.every(
      (t: unknown) =>
        isObject(t) &&
        (t["kind"] === "ccd" || t["kind"] === "plt") &&
        t["receiver"] instanceof Uint8Array &&
        typeof t["amount"] === "bigint" &&
        (t["memo"] === null || t["memo"] instanceof Uint8Array),
    )
  );
}

/**
 * The pairing's filter: an `exact` option on a `ccd:` network, for CCD or a token symbol, whose `payTo` and
 * `extra.feePayer` are base58check account addresses.
 */
export function ccdOption(o: unknown): o is PaymentRequirements {
  if (!isObject(o)) return false;
  const extra = o["extra"];
  const timeout = o["maxTimeoutSeconds"];
  const amount = o["amount"];
  return (
    o["scheme"] === "exact" &&
    typeof o["network"] === "string" &&
    NETWORK.test(o["network"]) &&
    typeof o["asset"] === "string" &&
    TOKEN.test(o["asset"]) &&
    isAccount(o["payTo"]) &&
    isObject(extra) &&
    isAccount(extra["feePayer"]) &&
    typeof amount === "string" &&
    DECIMAL.test(amount) &&
    BigInt(amount) < UINT64_LIMIT &&
    typeof timeout === "number" &&
    Number.isSafeInteger(timeout) &&
    timeout > 0
  );
}

const advertise = advertiseFor(filterOf(ccdOption));
const read: (doc: PaymentRequired) => X402Read | Refusal = readFor(filterOf(ccdOption));

/** What the buyer's wallet assembles and signs: one transfer to `payTo` whose memo carries the hash. */
async function build(c: CcdChoice, h: AtrHash): Promise<CcdUnsigned | Refusal> {
  const wrong = chosen(c.required, c.accepted, filterOf(ccdOption));
  if (wrong !== true) return wrong;
  const { required, accepted, now } = c;
  const sponsor = accepted.extra!["feePayer"] as string;
  if (!Number.isSafeInteger(now) || now < 0) return refusal("ccd/option-malformed");
  if (normalHash(h) === null) return refusal("ccd/memo-not-lcp");
  const memo = accepted.asset === "CCD" ? ccdMemo(h) : pltMemo(h);
  return {
    request: {
      kind: "ccd-transfer",
      network: accepted.network as CcdNetwork,
      sponsor,
      toAddress: accepted.payTo,
      asset: accepted.asset,
      amount: accepted.amount,
      memo,
      expiresBy: now + accepted.maxTimeoutSeconds,
    },
    complete(signedTransaction: Json): CcdPaymentPayload | Refusal {
      if (!isObject(signedTransaction)) return refusal("ccd/transaction-malformed");
      return paymentWith(required, accepted, { signedTransaction: signedTransaction as { [k: string]: Json } });
    },
  };
}

/** What `bound` and `reference` read from a signed transaction. */
interface Signed {
  sender: Uint8Array;
  expiry: number;
  carrier: AtrHash;
  receiver: Uint8Array;
  amount: bigint;
}

/**
 * The hash inside what the sender signed: the one transfer's memo, through `memoCarrier`. No signature is verified
 * here; the chain accepts the transaction only with the sender's valid signature.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const s = await signed(presented);
  return isRefusal(s) ? s : s.carrier;
}

/** The read keys for finding this payment later: network, asset, the expiry and the transfer's digest. */
async function reference(presented: unknown): Promise<CcdRef | Refusal> {
  const s = await signed(presented);
  if (isRefusal(s)) return s;
  const idDigest = await ccdIdDigest(s.sender, s.receiver, s.amount);
  if (isRefusal(idDigest)) return idDigest;
  const { accepted } = presented as CcdPaymentPayload;
  return { network: accepted.network as CcdNetwork, asset: accepted.asset, idDigest, settleBy: s.expiry };
}

async function signed(presented: unknown): Promise<Signed | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  if (!ccdOption(presented["accepted"])) return refusal("x402/option-not-this-pairing");
  const payload = presented["payload"];
  const tx = isObject(payload) ? payload["signedTransaction"] : undefined;
  if (!isObject(tx)) return refusal("ccd/transaction-malformed");
  if (utf8.encode(JSON.stringify(tx)).length > MAX_TRANSACTION) return refusal("ccd/too-large");
  if (tx["version"] !== 1) return refusal("ccd/not-v1");
  const header = tx["header"];
  const body = tx["payload"];
  if (!isObject(header) || !isObject(body)) return refusal("ccd/transaction-malformed");
  const expiry = header["expiry"];
  if (typeof expiry !== "number" || !Number.isSafeInteger(expiry) || expiry < 0) {
    return refusal("ccd/transaction-malformed");
  }
  const sender = typeof header["sender"] === "string" ? accountBytes(header["sender"]) : refusal("ccd/address-malformed");
  if (isRefusal(sender)) return sender;

  switch (body["type"]) {
    case "transferWithMemo": {
      const memo = memoBlob(body["memo"]);
      if (isRefusal(memo)) return memo;
      const carrier = memoCarrier(memo);
      if (isRefusal(carrier)) return carrier;
      const receiver = typeof body["toAddress"] === "string" ? accountBytes(body["toAddress"]) : refusal("ccd/address-malformed");
      if (isRefusal(receiver)) return receiver;
      const amount = body["amount"];
      if (typeof amount !== "string" || !DECIMAL.test(amount) || BigInt(amount) >= UINT64_LIMIT) {
        return refusal("ccd/transaction-malformed");
      }
      return { sender, expiry, carrier, receiver, amount: BigInt(amount) };
    }
    case "tokenUpdate": {
      const ops = hexBytes(body["operations"], MAX_OPERATIONS);
      if (isRefusal(ops)) return ops;
      return tokenTransfer(ops, sender, expiry);
    }
    case "transfer":
      return refusal("ccd/no-memo");
    default:
      return refusal("ccd/payload-kind");
  }
}

/** The one `transfer` operation of a PLT `TokenUpdate`: its memo's carrier, recipient and amount mantissa. */
function tokenTransfer(ops: Uint8Array, sender: Uint8Array, expiry: number): Signed | Refusal {
  const v = decodeCbor(ops);
  if (v === null || !Array.isArray(v)) return refusal("ccd/operations-malformed");
  const list = v as readonly Cbor[];
  if (list.length !== 1) return refusal("ccd/operation-count");
  const op = list[0]!;
  if (!isMap(op) || op.map.length !== 1 || op.map[0]![0] !== "transfer") return refusal("ccd/operation-count");
  const body = op.map[0]![1];
  if (!isMap(body)) return refusal("ccd/operations-malformed");

  const memo = mapGet(body, "memo");
  if (memo === undefined) return refusal("ccd/no-memo");
  const memoBytes = isTag(memo, 24n) ? memo.value : memo;
  if (!(memoBytes instanceof Uint8Array)) return refusal("ccd/operations-malformed");
  const carrier = memoCarrier(memoBytes);
  if (isRefusal(carrier)) return carrier;

  const recipient = mapGet(body, "recipient");
  const account = recipient !== undefined && isTag(recipient, 40307n) && isMap(recipient.value) ? mapGet(recipient.value, 3n) : undefined;
  if (!(account instanceof Uint8Array) || account.length !== 32) return refusal("ccd/operations-malformed");

  const amount = mapGet(body, "amount");
  const fraction = amount !== undefined && isTag(amount, 4n) ? amount.value : undefined;
  if (!Array.isArray(fraction) || fraction.length !== 2) return refusal("ccd/operations-malformed");
  const mantissa = (fraction as readonly Cbor[])[1];
  if (typeof mantissa !== "bigint" || mantissa < 0n) return refusal("ccd/operations-malformed");

  return { sender, expiry, carrier, receiver: account, amount: mantissa };
}

/** The option unchanged: on this pairing the hash rides in the signed transfer's memo, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

function isAccount(v: unknown): boolean {
  return typeof v === "string" && !isRefusal(accountBytes(v));
}

/** The 37 bytes a base58 account address decodes to, when their version byte is 1; the checksum is not checked. */
function accountShape(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || s.length === 0 || s.length > MAX_ADDRESS) return null;
  let n = 0n;
  for (const c of s) {
    const d = BASE58.indexOf(c);
    if (d < 0) return null;
    n = n * 58n + BigInt(d);
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const body: number[] = [];
  while (n > 0n) {
    body.push(Number(n & 0xffn));
    n >>= 8n;
  }
  const out = new Uint8Array(zeros + body.length);
  for (let i = 0; i < body.length; i++) out[out.length - 1 - i] = body[i]!;
  return out.length === 37 && out[0] === 0x01 ? out : null;
}

/**
 * The memo bytes of a transfer-with-memo payload in the SDK's JSON form: hex of a 2-byte big-endian length, then
 * exactly that many bytes, at most 256.
 */
function memoBlob(v: unknown): Uint8Array | Refusal {
  const b = hexBytes(v, MAX_MEMO + 2);
  if (isRefusal(b)) return b;
  if (b.length < 2) return refusal("ccd/transaction-malformed");
  const n = (b[0]! << 8) | b[1]!;
  if (n > MAX_MEMO) return refusal("ccd/too-large");
  if (b.length !== 2 + n) return refusal("ccd/transaction-malformed");
  return b.subarray(2);
}

function hexBytes(v: unknown, max: number): Uint8Array | Refusal {
  if (typeof v !== "string" || !HEX.test(v)) return refusal("ccd/transaction-malformed");
  if (v.length / 2 > max) return refusal("ccd/too-large");
  return hexToBytes(v);
}

function hexToBytes(s: string): Uint8Array {
  const h = s.startsWith("0x") ? s.slice(2) : s;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: ID,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a Concordium transaction whose one transfer carries this ATR's hash, in LCP string form, as " +
    "its memo. The chain accepted the transaction only with the sender's valid signature, and the memo is on chain in " +
    "the finalized transfer event. This does not show that amount, payee, token or timing match the ATR's content.",
});

export const exactCcd = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: ccdStatus,
  recover: ccdRecover,
});
