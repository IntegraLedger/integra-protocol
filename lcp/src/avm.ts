/**
 * Algorand: the pairing `x402/exact/algorand`, in which the payer signs an asset transfer whose note is the ATR
 * hash's LCP string, and the settlement read from an Indexer by the transaction id computed from the signed bytes.
 * `algosdk` is an optional peer: this module loads it when present, and without it the pairing serves no option.
 */
import type * as Algosdk from "algosdk";
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  paymentWith,
  presentedWith,
  readFor,
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
  type X402Payment,
} from "./x402.js";

const sdk: typeof Algosdk | null = await import("algosdk").then(
  (m) => m,
  () => null,
);

/** CAIP-2: the first 32 characters of the URL-safe base64 genesis hash. */
export type AlgorandNetwork = `algorand:${string}`;

/** The buyer's read of algod `GET /v2/transactions/params`. `genesisHash` is its base64. */
export interface AvmParams {
  firstValid: bigint;
  genesisHash: string;
  genesisId: string;
  minFee: bigint;
  feePerByte: bigint;
}

/** The x402 payload on Algorand. */
export interface AvmPresented {
  paymentIndex: number;
  paymentGroup: readonly string[];
}
export type AvmPaymentPayload = X402Payment<AvmPresented>;

/** Bounded, read-only calls against one network's Indexer. Every failure rejects. */
export interface AvmReader {
  readonly network: AlgorandNetwork;
  /** `GET /v2/transactions?txid=…` */
  search(txid: string): Promise<{ currentRound: bigint; found: null | { confirmedRound: bigint; note: Uint8Array } }>;
}

/** The read keys recorded at claim, computed from the signed bytes. `lastValid` is a decimal string, so the issuer stores the
 * reference as JSON. */
export interface AvmRef {
  network: AlgorandNetwork;
  txid: string;
  lastValid: string;
}

export type AvmStatus =
  | { state: "settled"; finality: "final"; round: bigint }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "expired" };

/** The bytes the payer signs, and how the signature completes the payment. */
export interface AvmUnsigned {
  /** "TX" ‖ msgpack(txn) */
  request: { kind: "algorand-txn"; bytes: Uint8Array };
  /** A 64-byte Ed25519 signature. */
  complete(signature: Uint8Array): AvmPaymentPayload | Refusal;
}

const ID = "x402/exact/algorand" as const;
const NETWORK = /^algorand:([-_a-zA-Z0-9]{32})$/;
const ASSET = /^(0|[1-9][0-9]{0,19})$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UINT64_LIMIT = 1n << 64n;
const MAX_GROUP = 16;
const MAX_ENTRY = 8192;
const MAX_NOTE = 4096;
const MAX_TXN_LIFE = 1000n;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ENCODER = new TextEncoder();
/**
 * The deepest nesting of msgpack arrays and maps in a signed transaction, the outermost container being level 1. An
 * Algorand signed transaction nests three (the signed transaction, its transaction, and a map or array inside that).
 */
export const MSGPACK_MAX_DEPTH = 32;

/**
 * True when `b` is exactly one msgpack value (the msgpack specification's formats) whose arrays and maps nest at most
 * `MSGPACK_MAX_DEPTH` deep, and whose every declared length (a string's, binary's or extension's bytes, an array's
 * elements, a map's keys and values) is no more than the bytes that remain, so no count is trusted past the input.
 * The value is scanned, never built.
 */
export function msgpackWithinCaps(b: Uint8Array): boolean {
  const n = b.length;
  let i = 0;
  /** For each open array or map, the values still to come in it. */
  const pending: number[] = [];
  let opened = false;
  const uint = (width: number): number | undefined => {
    if (i + width > n) return undefined;
    let v = 0;
    for (let k = 0; k < width; k++) v = v * 256 + b[i + k]!;
    i += width;
    return v;
  };
  const skip = (length: number | undefined): boolean => {
    if (length === undefined || length > n - i) return false;
    i += length;
    return true;
  };
  const open = (values: number | undefined): boolean => {
    if (values === undefined || values > n - i || pending.length + 1 > MSGPACK_MAX_DEPTH) return false;
    if (values > 0) {
      pending.push(values);
      opened = true;
    }
    return true;
  };
  const withType = (length: number | undefined): number | undefined => (length === undefined ? undefined : length + 1);
  do {
    if (i >= n) return false;
    const t = b[i++]!;
    opened = false;
    let ok: boolean;
    if (t <= 0x7f || t >= 0xe0 || t === 0xc0 || t === 0xc2 || t === 0xc3) ok = true;
    else if (t <= 0x8f) ok = open(2 * (t & 0x0f));
    else if (t <= 0x9f) ok = open(t & 0x0f);
    else if (t <= 0xbf) ok = skip(t & 0x1f);
    else if (t === 0xc4 || t === 0xd9) ok = skip(uint(1));
    else if (t === 0xc5 || t === 0xda) ok = skip(uint(2));
    else if (t === 0xc6 || t === 0xdb) ok = skip(uint(4));
    else if (t === 0xc7) ok = skip(withType(uint(1)));
    else if (t === 0xc8) ok = skip(withType(uint(2)));
    else if (t === 0xc9) ok = skip(withType(uint(4)));
    else if (t === 0xca) ok = skip(4);
    else if (t === 0xcb) ok = skip(8);
    else if (t >= 0xcc && t <= 0xcf) ok = skip(1 << (t - 0xcc));
    else if (t >= 0xd0 && t <= 0xd3) ok = skip(1 << (t - 0xd0));
    else if (t >= 0xd4 && t <= 0xd8) ok = skip((1 << (t - 0xd4)) + 1);
    else if (t === 0xdc) ok = open(uint(2));
    else if (t === 0xdd) ok = open(uint(4));
    else if (t === 0xde) ok = open(2 * (uint(2) ?? n));
    else if (t === 0xdf) ok = open(2 * (uint(4) ?? n));
    else ok = false;
    if (!ok) return false;
    if (opened) continue;
    while (pending.length > 0) {
      const top = pending.length - 1;
      pending[top] = pending[top]! - 1;
      if (pending[top]! > 0) break;
      pending.pop();
    }
  } while (pending.length > 0);
  return i === n;
}

function uint64Of(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !ASSET.test(s)) return undefined;
  const v = BigInt(s);
  return v < UINT64_LIMIT ? v : undefined;
}

function isAddress(s: unknown): s is string {
  return typeof s === "string" && s.length === 58 && sdk !== null && sdk.isValidAddress(s);
}

/** The pairing's option filter. Without algosdk no option is served. */
function check(o: PaymentRequirements): true | Refusal | undefined {
  if (!isObject(o) || typeof o.network !== "string" || !o.network.startsWith("algorand:")) return undefined;
  if (o.scheme !== "exact" || sdk === null) return undefined;
  const extra = o.extra;
  if (extra !== undefined && !isObject(extra)) return refusal("avm/option-malformed");
  if (!NETWORK.test(o.network)) return refusal("avm/network-malformed");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("avm/option-malformed");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("avm/option-malformed");
  const feePayer = extra?.["feePayer"];
  if (
    uint64Of(o.asset) === undefined ||
    !isAddress(o.payTo) ||
    (feePayer !== undefined && !isAddress(feePayer)) ||
    uint64Of(o.amount) === undefined ||
    !Number.isSafeInteger(o.maxTimeoutSeconds) ||
    o.maxTimeoutSeconds <= 0
  ) {
    return refusal("avm/option-malformed");
  }
  return true;
}

/** The pairing's id for an option it can pay, or undefined. */
export function avmPairingOf(o: PaymentRequirements): typeof ID | undefined {
  return check(o) === true ? ID : undefined;
}

function fromBase64(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || s.length % 4 !== 0 || !BASE64.test(s)) return null;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * The payment transaction of an x402 Algorand payload: `paymentGroup[paymentIndex]`, decoded as a signed asset
 * transfer whose note is an LCP string. Gives the hash, the transaction id and the last valid round.
 */
export function avmCarrier(p: AvmPresented): { h: AtrHash; txid: string; lastValid: bigint } | Refusal {
  if (sdk === null) return refusal("avm/txn-malformed");
  if (!isObject(p) || !Array.isArray(p.paymentGroup)) return refusal("avm/txn-malformed");
  const group = p.paymentGroup;
  if (group.length < 1 || group.length > MAX_GROUP) return refusal("avm/group-too-large");
  const i = p.paymentIndex;
  if (!Number.isSafeInteger(i) || i < 0 || i >= group.length) return refusal("avm/index-out-of-range");
  const entry = group[i];
  if (typeof entry !== "string" || entry.length > MAX_ENTRY) return refusal("avm/txn-malformed");
  const bytes = fromBase64(entry);
  if (bytes === null || !msgpackWithinCaps(bytes)) return refusal("avm/txn-malformed");
  let txn: Algosdk.Transaction;
  try {
    txn = sdk.decodeSignedTransaction(bytes).txn;
  } catch {
    return refusal("avm/txn-malformed");
  }
  if (txn.type !== sdk.TransactionType.axfer) return refusal("avm/not-axfer");
  if (txn.note.length > MAX_NOTE) return refusal("avm/txn-malformed");
  let note: string;
  try {
    note = UTF8.decode(txn.note);
  } catch {
    return refusal("avm/note-not-lcp");
  }
  const h = fromLcpString(note);
  if (h === null) return refusal("avm/note-not-lcp");
  return { h, txid: txn.txID(), lastValid: txn.lastValid };
}

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(check)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(check)(doc);
}

/** The URL-safe base64 of a standard base64 string, as CAIP-2's reference for Algorand is taken from. */
function urlSafe(s: string): string {
  return s.replaceAll("+", "-").replaceAll("/", "_");
}

/**
 * The asset transfer the payer signs, with the hash's LCP string as its note; with the option's fee payer, grouped
 * after that fee payer's zero payment, which carries both fees.
 */
async function build(
  c: { required: PaymentRequired; accepted: PaymentRequirements; payer: string; params: AvmParams },
  h: AtrHash,
): Promise<AvmUnsigned | Refusal> {
  if (sdk === null || !isObject(c)) return refusal("avm/option-malformed");
  const ok = chosen(c.required, c.accepted, check);
  if (ok !== true) return ok;
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  const pr = c.params;
  if (
    !isAddress(c.payer) ||
    !isObject(pr) ||
    typeof pr.firstValid !== "bigint" ||
    typeof pr.minFee !== "bigint" ||
    typeof pr.feePerByte !== "bigint" ||
    typeof pr.genesisId !== "string" ||
    pr.firstValid < 0n ||
    pr.minFee < 0n ||
    pr.feePerByte < 0n
  ) {
    return refusal("avm/option-malformed");
  }
  const gh = fromBase64(pr.genesisHash);
  if (gh === null || gh.length !== 32) return refusal("avm/network-mismatch");
  const { required, accepted } = c;
  if (urlSafe(pr.genesisHash).slice(0, 32) !== NETWORK.exec(accepted.network)![1]) return refusal("avm/network-mismatch");

  const firstValid = pr.firstValid;
  const lastValid = firstValid + (BigInt(accepted.maxTimeoutSeconds) < MAX_TXN_LIFE ? BigInt(accepted.maxTimeoutSeconds) : MAX_TXN_LIFE);
  const params = (fee: bigint, flatFee: boolean): Algosdk.SuggestedParams => ({
    flatFee,
    fee: flatFee ? fee : pr.feePerByte,
    minFee: pr.minFee,
    firstValid,
    lastValid,
    genesisID: pr.genesisId,
    genesisHash: gh,
  });
  const feePayer = isObject(accepted.extra) ? (accepted.extra["feePayer"] as string | undefined) : undefined;
  const axfer = (sp: Algosdk.SuggestedParams) =>
    sdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: c.payer,
      receiver: accepted.payTo,
      assetIndex: uint64Of(accepted.asset)!,
      amount: uint64Of(accepted.amount)!,
      note: ENCODER.encode(toLcpString(nh)),
      suggestedParams: sp,
    });

  let group: Algosdk.Transaction[];
  let paymentIndex: number;
  try {
    if (feePayer === undefined) {
      group = [axfer(params(0n, false))];
      paymentIndex = 0;
    } else {
      const zeroPay = (sp: Algosdk.SuggestedParams) =>
        sdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: feePayer,
          receiver: feePayer,
          amount: 0n,
          suggestedParams: sp,
        });
      const fee = zeroPay(params(0n, false)).fee + axfer(params(0n, false)).fee;
      group = [zeroPay(params(fee, true)), axfer(params(0n, true))];
      const groupId = sdk.computeGroupID(group);
      for (const txn of group) txn.group = groupId;
      paymentIndex = 1;
    }
  } catch {
    return refusal("avm/option-malformed");
  }
  const payment = group[paymentIndex]!;
  return {
    request: { kind: "algorand-txn", bytes: payment.bytesToSign() },
    complete(signature: Uint8Array): AvmPaymentPayload | Refusal {
      if (!(signature instanceof Uint8Array) || signature.length !== 64) return refusal("avm/signature-malformed");
      const paymentGroup = group.map((txn, i) =>
        toBase64(sdk.encodeMsgpack(new sdk.SignedTransaction(i === paymentIndex ? { txn, sig: signature.slice() } : { txn }))),
      );
      return paymentWith(required, accepted, { paymentIndex, paymentGroup });
    },
  };
}

/**
 * The hash inside what the payer signed: the payment transaction's note. Amount, receiver, asset, fee payer and
 * sender are not read, and no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const carried = carriedOf(presented);
  return isRefusal(carried) ? carried : carried.h;
}

/** The network, the payment's transaction id and its last valid round, from the signed bytes. */
async function reference(presented: unknown): Promise<AvmRef | Refusal> {
  const carried = carriedOf(presented);
  if (isRefusal(carried)) return carried;
  const network = (presented as { accepted: PaymentRequirements }).accepted.network as AlgorandNetwork;
  return { network, txid: carried.txid, lastValid: carried.lastValid.toString() };
}

function carriedOf(presented: unknown): { h: AtrHash; txid: string; lastValid: bigint } | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  return avmCarrier(p.payload as unknown as AvmPresented);
}

/**
 * Reads the payment by its id. Found is settled and final; absent after the last valid round is expired; otherwise
 * pending. A failed read, or a reader for another network, is pending.
 */
export async function avmStatus(ref: AvmRef, reader: AvmReader): Promise<AvmStatus> {
  if (!isObject(reader) || reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  if (typeof ref.lastValid !== "string" || !ASSET.test(ref.lastValid)) return { state: "pending", why: "unreadable" };
  let answer: Awaited<ReturnType<AvmReader["search"]>>;
  try {
    answer = await reader.search(ref.txid);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (!isAnswer(answer)) return { state: "pending", why: "unreadable" };
  if (answer.found !== null) return { state: "settled", finality: "final", round: answer.found.confirmedRound };
  if (answer.currentRound > BigInt(ref.lastValid)) return { state: "failed", why: "expired" };
  return { state: "pending", why: "not-found" };
}

/** The hash from the landed payment's note, for anyone holding the transaction id. One call. */
export async function avmRecover(
  ref: { network: AlgorandNetwork; txid: string },
  reader: AvmReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(reader) || reader.network !== ref.network) return refusal("avm/wrong-reader");
  let answer: Awaited<ReturnType<AvmReader["search"]>>;
  try {
    answer = await reader.search(ref.txid);
  } catch {
    return refusal("avm/unreadable");
  }
  if (!isAnswer(answer)) return refusal("avm/unreadable");
  if (answer.found === null) return refusal("avm/not-found");
  let note: string;
  try {
    note = UTF8.decode(answer.found.note);
  } catch {
    return refusal("avm/note-not-lcp");
  }
  return fromLcpString(note) ?? refusal("avm/note-not-lcp");
}

function isAnswer(a: unknown): a is Awaited<ReturnType<AvmReader["search"]>> {
  if (!isObject(a) || typeof a["currentRound"] !== "bigint") return false;
  const found = a["found"];
  if (found === null) return true;
  return isObject(found) && typeof found["confirmedRound"] === "bigint" && found["note"] instanceof Uint8Array;
}

/** The option unchanged: the hash rides in the signed note, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: "x402/exact/algorand/note",
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: true,
  publicProof: true,
  proves:
    "The payer signed an Algorand asset transfer whose note is this ATR's hash in LCP string form. The ledger " +
    "verified that signature when it confirmed the transaction, which is final on confirmation, and the note is on " +
    "chain in it. This does not show that amount, receiver, asset or timing match the ATR's content.",
});

export const exactAvm = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  carrier: null,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: avmStatus,
  recover: avmRecover,
});
