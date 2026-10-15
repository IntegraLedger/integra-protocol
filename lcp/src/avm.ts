/**
 * Algorand: the pairing `x402/exact/algorand`, in which the payer signs an asset transfer whose note is the ATR
 * hash's LCP string, and the settlement read from an Indexer by the transaction id computed from the signed bytes.
 * `algosdk` is an optional peer: this module loads it when present. Without it the pairing serves no option, and
 * `avmCarrier` and `build` refuse `avm/peer-missing`.
 */
import type * as Algosdk from "algosdk";
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { readEntry, type AvmEntry, type AvmPaymentPayload } from "./internal/avm.js";
import { advertiseFor, chosen, isAmount, isTimeoutSeconds, paymentWith, presentedWith, readFor, type X402Read } from "./internal/x402.js";
import { fromBase64, toBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
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

/** Bounded, read-only calls against one network's Indexer. Every failure rejects. */
export interface AvmReader {
  readonly network: AlgorandNetwork;
  /** `GET /v2/transactions?txid=…` */
  search(txid: string): Promise<{ currentRound: bigint; found: null | { confirmedRound: bigint; note: Uint8Array } }>;
}

/**
 * The read keys `reference` returns, computed from the signed bytes. `lastValid` is a decimal string, so the reference
 * is JSON-serialisable.
 */
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
  request: { kind: "algorand-txn"; bytes: Uint8Array<ArrayBuffer> };
  /**
   * Completes the payment with the payer's 64-byte Ed25519 signature over `request.bytes`; a signature of any other
   * length is `avm/signature-malformed`.
   */
  complete(signature: Uint8Array): AvmPaymentPayload | Refusal;
}

const ID = "x402/exact/algorand" as const;
const NETWORK = /^algorand:([-_a-zA-Z0-9]{32})$/;
const ASSET = /^(0|[1-9][0-9]{0,19})$/;
const UINT64_LIMIT = 1n << 64n;
/**
 * A transaction id as `reference` writes it: the base32 of a 32-byte hash without padding, 52 characters, the last
 * holding one bit of the hash and four zero bits.
 */
const TXID = /^[A-Z2-7]{51}[AQ]$/;
const MAX_GROUP = 16;
const MAX_ENTRY = 8192;
const MAX_NOTE = 4096;
const MAX_TXN_LIFE = 1000n;
/**
 * A 64-byte signature that is not all zero bytes, which the encoding writes in full: the entry `build` checks is as
 * long as any `complete` writes.
 */
const FULL_SIGNATURE = new Uint8Array(64).fill(1);
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ENCODER = new TextEncoder();
/**
 * The deepest nesting of msgpack arrays and maps `avmCarrier` reads in a payment entry, the outermost container being
 * level 1. algod's signed transaction nests at most 10 (a state proof's reveal, down to a byte string written as an
 * array of numbers), so the cap refuses no entry algod decodes.
 */
export const MSGPACK_MAX_DEPTH = 32;

function uint64Of(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !ASSET.test(s)) return undefined;
  const v = BigInt(s);
  return v < UINT64_LIMIT ? v : undefined;
}

function isAddress(s: unknown): s is string {
  return typeof s === "string" && s.length === 58 && sdk !== null && sdk.isValidAddress(s);
}

/**
 * The pairing's option filter: the option's scheme, network, asset, `payTo` and `extra` (its fee payer, no transfer
 * method, and no flow other than `"authorization"`), the amount a positive decimal (`isAmount`) below 2^64 and
 * `maxTimeoutSeconds` a positive safe integer, which `build` writes into the asset transfer and its last valid round.
 * `pairingOf`, `advertise`, `read` and `build` apply it, and `bound` and `reference` hold the option a presented payment
 * echoes to it. Without algosdk no option is served.
 */
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
  if (uint64Of(o.asset) === undefined || !isAddress(o.payTo) || (feePayer !== undefined && !isAddress(feePayer))) {
    return refusal("avm/option-malformed");
  }
  if (!isAmount(o.amount) || uint64Of(o.amount) === undefined || !isTimeoutSeconds(o.maxTimeoutSeconds)) {
    return refusal("avm/option-malformed");
  }
  return true;
}

/**
 * The payment transaction of an x402 Algorand payload: `paymentGroup[paymentIndex]`, read as a signed asset transfer
 * whose note is an LCP string. Gives the hash, the transaction id and the last valid round. On the x402 path the entry
 * has two readers: the facilitator decodes it, and algod decodes the bytes the facilitator submits, which are the
 * entry's own. The entry is read only when it is one msgpack value nesting at most `MSGPACK_MAX_DEPTH` deep, algod's
 * decoder takes it as a signed transaction of a type algod knows with no member of another type set, the
 * facilitator's decoder takes it as an asset transfer, and both read the same signed transaction: their canonical
 * encodings are equal, and the facilitator can compute its id (it has a genesis hash). Any other entry is
 * `avm/txn-malformed`, and one algod reads as another type is `avm/not-axfer`. So a repeated scalar key, keys out of
 * order, a member written at its default, an integer or length in a longer format than it needs, a nil member, or a
 * binary and a string in each other's place reads as algod reads it, and the transaction id is the one algod computes,
 * from the transaction's canonical encoding. Where the two read different transactions the entry is refused: a
 * repeated struct whose earlier occurrences set a member the last one does not, which algod merges in and the
 * facilitator does not read, a repeated list whose elements algod decodes into those an earlier list left, and a
 * fixed-length byte member of another length. A byte member written as a msgpack string is read as its
 * bytes, whatever they are; a string member (`type`, `gen`) is refused when its bytes are not UTF-8, which the
 * facilitator reads as other text. Each answer is a function of the entry's bytes alone. Without algosdk,
 * `avm/peer-missing`.
 */
export function avmCarrier(p: AvmPresented): { h: AtrHash; txid: string; lastValid: bigint } | Refusal {
  if (sdk === null) return refusal("avm/peer-missing");
  if (!isObject(p) || !Array.isArray(p.paymentGroup)) return refusal("avm/txn-malformed");
  const group = p.paymentGroup;
  if (group.length < 1 || group.length > MAX_GROUP) return refusal("avm/group-too-large");
  const i = p.paymentIndex;
  if (!Number.isSafeInteger(i) || i < 0 || i >= group.length) return refusal("avm/index-out-of-range");
  const read = paymentEntry(group[i]);
  if (isRefusal(read)) return read;
  let note: string;
  try {
    note = UTF8.decode(read.note);
  } catch {
    return refusal("avm/note-not-lcp");
  }
  const h = fromLcpString(note);
  if (h === null) return refusal("avm/note-not-lcp");
  return { h, txid: read.txid, lastValid: read.lastValid };
}

/**
 * One payment entry as `avmCarrier` reads it: base64 of at most `MAX_ENTRY` characters, read by `readEntry` within
 * `MSGPACK_MAX_DEPTH`, with a note of at most `MAX_NOTE` bytes. An entry algod reads as another transaction type is
 * `avm/not-axfer`; any other entry outside these bounds is `avm/txn-malformed`.
 */
function paymentEntry(entry: unknown): AvmEntry | Refusal {
  if (typeof entry !== "string" || entry.length > MAX_ENTRY) return refusal("avm/txn-malformed");
  const bytes = fromBase64(entry);
  if (bytes === null) return refusal("avm/txn-malformed");
  const read = readEntry(bytes, MSGPACK_MAX_DEPTH);
  if (read === "malformed") return refusal("avm/txn-malformed");
  if (read === "not-axfer") return refusal("avm/not-axfer");
  if (read.note.length > MAX_NOTE) return refusal("avm/txn-malformed");
  return read;
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
 * after that fee payer's zero payment, which carries both fees. The suggested parameters' genesis id is written as each
 * transaction's `gen`, a msgpack string, so one holding a lone surrogate, which UTF-8 cannot encode, is
 * `avm/option-malformed`. The payment entry is read as `avmCarrier` reads it, with a 64-byte signature in place, as
 * `complete` writes it, so `build` writes no payment `bound` refuses: an entry `avmCarrier` would refuse, one whose
 * base64 is longer than 8,192 characters included, is `avm/option-malformed`. Without algosdk, `avm/peer-missing`.
 */
async function build(
  c: { required: PaymentRequired; accepted: PaymentRequirements; payer: string; params: AvmParams },
  h: AtrHash,
): Promise<AvmUnsigned | Refusal> {
  if (sdk === null) return refusal("avm/peer-missing");
  if (!isObject(c)) return refusal("avm/option-malformed");
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
    !pr.genesisId.isWellFormed() ||
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
  const signed = sdk.encodeMsgpack(new sdk.SignedTransaction({ txn: payment, sig: FULL_SIGNATURE }));
  if (isRefusal(paymentEntry(toBase64(signed)))) return refusal("avm/option-malformed");
  return {
    request: { kind: "algorand-txn", bytes: Uint8Array.from(payment.bytesToSign()) },
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
 * The hash inside what the payer signed: the payment transaction's note. The echoed option is held to the filter `read`
 * applies, so a payment under an option `read` would not offer is refused. The transaction's amount, receiver,
 * asset, fee payer and sender are not read, and no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const carried = carriedOf(presented);
  return isRefusal(carried) ? carried : carried.h;
}

/**
 * The network, the payment's transaction id and its last valid round, from the signed bytes, with the echoed option
 * checked as `bound` checks it.
 */
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
 * pending. A failed read, or a reader for another network, is pending. A ref whose `txid` is not the 52 base32
 * characters of a 32-byte hash, as `reference` writes it, or whose `lastValid` is not a decimal below 2^64, is pending
 * `unreadable`, with nothing read.
 */
export async function avmStatus(ref: AvmRef, reader: AvmReader): Promise<AvmStatus> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) {
    return { state: "pending", why: "unreadable" };
  }
  const lastValid = uint64Of(ref.lastValid);
  if (lastValid === undefined || !isTxid(ref.txid)) return { state: "pending", why: "unreadable" };
  let answer: Awaited<ReturnType<AvmReader["search"]>>;
  try {
    answer = await reader.search(ref.txid);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (!isAnswer(answer)) return { state: "pending", why: "unreadable" };
  if (answer.found !== null) return { state: "settled", finality: "final", round: answer.found.confirmedRound };
  if (answer.currentRound > lastValid) return { state: "failed", why: "expired" };
  return { state: "pending", why: "not-found" };
}

/**
 * The hash from the landed payment's note, for anyone holding the transaction id. A ref whose `txid` is not the 52
 * base32 characters of a 32-byte hash is `avm/wrong-reader`, with nothing read. One call.
 */
export async function avmRecover(
  ref: { network: AlgorandNetwork; txid: string },
  reader: AvmReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("avm/wrong-reader");
  if (!isTxid(ref.txid)) return refusal("avm/wrong-reader");
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

function isTxid(t: unknown): t is string {
  return typeof t === "string" && TXID.test(t);
}

function isAnswer(a: unknown): a is Awaited<ReturnType<AvmReader["search"]>> {
  if (!isObject(a) || typeof a["currentRound"] !== "bigint") return false;
  const found = a["found"];
  if (found === null) return true;
  return isObject(found) && typeof found["confirmedRound"] === "bigint" && found["note"] instanceof Uint8Array;
}

/**
 * The option unchanged: the hash rides in the signed note, not in the option. An option that carries a `refused`
 * member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
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
    "The payer's account authorized an Algorand asset transfer whose note is this ATR's hash in LCP string form, " +
    "with a signature, a multisignature or a logic signature. The ledger verified that authorization when it " +
    "confirmed the transaction, which is final on confirmation, and the note is on chain in it. This does not show " +
    "that amount, receiver, asset or timing match the ATR's content.",
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
