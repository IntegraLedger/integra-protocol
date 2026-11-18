/**
 * Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo
 * of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer
 * event.
 *
 * The signed transaction is read in x402's wire form, the JSON-serialized V1 sponsored transaction: with
 * `@concordium/web-sdk`, `JSON.parse(Transaction.toJSONString(tx))`. Any other value, such as the SDK's object
 * before serialization, whose header holds bigints, is `ccd/transaction-malformed`.
 *
 * @module
 */
import { canonicalJson, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { decodeCbor, isMap, isTag, mapGet, type Cbor, type CborMap } from "./cbor.js";
import {
  accountBytes,
  CCD_MAX_MEMO,
  ccdMemo,
  memoCarrier,
  pltMemo,
  signedDigest,
  signedEnergy,
  transferMemo,
  type CcdPaymentPayload,
} from "./internal/ccd.js";
export { accountBytes, CCD_MAX_ADDRESS, CCD_MAX_MEMO, ccdMemo, memoCarrier, pltMemo } from "./internal/ccd.js";
import { acceptedBy, advertiseFor, chosen, filterOf, isAmount, isTimeoutSeconds, paymentWith, readFor, sameJson, x402Broadcaster, type X402Read, type X402Forms } from "./internal/x402.js";
import { ccdRead, isItem } from "./internal/ccd-read.js";
export { CCD_SEARCH_NUMBERS } from "./internal/ccd-read.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { CCD } from "./internal/data/ccd.js";
import { x402Payee } from "./internal/payee.js";
import type { RecoverInput, StatusAnswer, StatusQuery } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { CcdPaymentPayload } from "./internal/ccd.js";
export type { X402Advertise, X402Read } from "./internal/x402.js";

/** CAIP-2: `ccd:` and the first 32 lowercase hex digits of the genesis block hash. */
export type CcdNetwork = `ccd:${string}`;

/**
 * One transfer an item's effects or events list: CCD, its amount in microCCD (concordium-grpc-api
 * `v2/concordium/types.proto` L328, `Amount`), or a PLT by its token id, its amount the `value` of the event's
 * `TokenAmount` and `decimals` that amount's own (`v2/concordium/protocol-level-tokens.proto` L43-50 at 30c79ca0).
 */
export interface CcdTransfer {
  kind: "ccd" | "plt";
  tokenId?: string;
  receiver: Uint8Array;
  amount: bigint;
  /** A PLT's: the `decimals` of its `TokenAmount`. A CCD transfer gives none, microCCD being six. */
  decimals?: number;
  memo: Uint8Array | null;
}

/**
 * An answer of gRPC v2 `GetBlockItemStatus` in the reader's form: received; or in a block, `committed` or `finalized`,
 * with its outcome: whether it succeeded, its sender, each transfer its effects or events list in their order, and
 * `unknown`, set where an effect or event kind is one the reader does not know (never read as "no transfer"). For an
 * item in a block the reader may add the height of the block that holds it and its header's sequence number, read
 * with `GetBlockInfo` and `GetBlockItems` on that block; `status` takes an item a hint names only with its height.
 */
export type CcdItem =
  | { state: "received" }
  | {
      state: "committed" | "finalized";
      success: boolean;
      sender: Uint8Array | null;
      transfers: readonly CcdTransfer[];
      unknown?: boolean;
      height?: bigint;
      nonce?: bigint;
    };

/**
 * One item of gRPC v2 `GetBlockItems` on a finalized block, as the reader gives it: an account transaction's hash, its
 * signed header (the sender's 32 bytes, its sequence number, `expiry` in seconds, the energy and, on a sponsored
 * transaction, the sponsor's 32 bytes) and its payload in the protocol's binary form, `raw_payload`, which lcp decodes;
 * or an item the reader cannot read as one, by its hash.
 */
export type CcdBlockItem =
  | {
      hash: string;
      sender: Uint8Array;
      nonce: bigint;
      expiry: bigint;
      energy: bigint;
      sponsor: Uint8Array | null;
      payload: Uint8Array;
    }
  | { hash: string; undecoded: true };

/**
 * Bounded, read-only calls against one network's node (gRPC v2). Every failure rejects, for example with
 * `ReaderError` from `@integraledger/lcp/evm`: a `ReaderError` reads by its kind (`too-large` as `too-large`,
 * `malformed` as `unparseable`), and any other rejection as `transport`.
 */
export interface CcdReader {
  readonly network: CcdNetwork;
  /** `GetConsensusInfo`'s last finalized block height. */
  lastFinal(): Promise<bigint>;
  /** `GetBlockInfo` at a finalized height: its `slot_time`, in milliseconds; null where the node does not hold it. */
  block(height: bigint): Promise<{ slotTime: bigint } | null>;
  /**
   * `GetAccountInfo(account, block).sequence_number`, the account's next sequence number, at a finalized height or at
   * the latest head (`best`); null where the node answers that it has no such account at that block, or no such block,
   * which the read tells apart with `block`.
   */
  nextNonce(account: string, at: bigint | "best"): Promise<bigint | null>;
  /** `GetBlockItems` on a finalized height, every item of the block. */
  items(height: bigint): Promise<readonly CcdBlockItem[]>;
  /** `GetBlockItemStatus`; null when the node does not know the item. */
  item(hash: string): Promise<CcdItem | null>;
}

/**
 * The read keys `reference` returns: the network, H, the header's sender and its signed sequence number (a decimal
 * string), the signed `expiry` in seconds, the option's `payTo`, and the digest of what the sender signed. The caller
 * may add `transaction`, a hash a settler named, which the read takes as a hint.
 */
export interface CcdRef {
  network: CcdNetwork;
  h: AtrHash;
  sender: string;
  nonce: string;
  expiry: number;
  /** The option's `payTo`. */
  payee: string;
  /** SHA-256 over the members the sender signed (the profile's rule 14). */
  signed: Hex;
  transaction?: string;
}

/** The search's position: the next of the sender's sequence numbers to locate. */
export interface CcdSearch {
  next: bigint;
}

/** The marks of a block item in a block, ascending: `committed`, below the one mark, and `finalized`. */
export type CcdMark = "committed" | "finalized";

/**
 * The answer of `ccdStatus`. Positions are finalized block heights; the one mark is `finalized`, and an item read
 * above the last finalized block is at `committed`, below it; the search's position is `CcdSearch`.
 */
export type CcdStatus = StatusAnswer<bigint, CcdMark, CcdSearch>;

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
    memo: Uint8Array<ArrayBuffer>;
    expiresBy: number;
  };
  /**
   * Takes the sender-signed V1 sponsored transaction in x402's wire form: with `@concordium/web-sdk`,
   * `JSON.parse(Transaction.toJSONString(tx))`. A value that is not a JSON object is `ccd/transaction-malformed`.
   */
  complete(signedTransaction: unknown): CcdPaymentPayload | Refusal;
}

const ID = "x402/exact/ccd" as const;
const NETWORK = /^ccd:[0-9a-f]{32}$/;
const TOKEN = /^[\x21-\x7e]{1,128}$/;
const DECIMAL = /^[0-9]{1,20}$/;
const HEX = /^(?:[0-9a-fA-F]{2})*$/;
/** A block item hash: 32 bytes as hex digits. */
const ITEM_HASH = /^[0-9a-fA-F]{64}$/;
/**
 * lcp's own resource bound on a PLT `tokenUpdate`'s operations, in bytes: one `transfer` operation with a memo at the
 * chain's bound is far below it.
 */
export const CCD_MAX_OPERATIONS = 4096;
/**
 * lcp's own resource bound on the presented signed transaction's canonical JSON, in bytes: one transfer with a memo
 * at the chain's bound and its signatures is far below it.
 */
export const CCD_MAX_TRANSACTION = 16384;
/**
 * The margin the stock client takes off an expiry, in seconds: it signs `now` plus `maxTimeoutSeconds` less this, so
 * that the stock facilitator, which refuses an expiry past its own clock plus `maxTimeoutSeconds`, takes the payment.
 */
export const CCD_EXPIRY_MARGIN = 5;
const MAX_MEMO = CCD_MAX_MEMO;
const MAX_OPERATIONS = CCD_MAX_OPERATIONS;
const MAX_TRANSACTION = CCD_MAX_TRANSACTION;
const UINT64_LIMIT = 1n << 64n;
const utf8 = new TextEncoder();




/**
 * The read of the act asked about, as the profiles `read-status` and `x402/exact/ccd` answer it: by the sender's signed
 * sequence number, the item that consumed it, and the search for H over the sender's numbers (the profile's rules 8 to
 * 15). A hash the reference names is a hint.
 */
export async function ccdStatus(
  ref: CcdRef,
  reader: CcdReader,
  query: StatusQuery<CcdRef, bigint, "finalized", CcdSearch>,
): Promise<CcdStatus> {
  return ccdRead(ref, reader, query);
}

/**
 * The hash from a settlement block item alone, when it is finalized and successful: the memo of its one transfer whose
 * memo `memoCarrier` reads (a PLT memo with tag 24 unwrapped), as `status` counts the transfers whose memo carries
 * `ref.h`. A transfer without a memo, or whose memo `memoCarrier` refuses, is passed over; no such transfer, or more
 * than one, is `ccd/no-carrier`. An input whose `tx` is not 64 hex digits, or whose option is not an object, is
 * `ccd/wrong-reader`, with nothing read; the option is not read further.
 */
export async function ccdRecover(
  input: RecoverInput<CcdNetwork, PaymentRequirements | MppChallenge>,
  reader: CcdReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("ccd/wrong-reader");
  if (typeof input.tx !== "string" || !ITEM_HASH.test(input.tx) || !isObject(input.option)) return refusal("ccd/wrong-reader");
  let it: CcdItem | null;
  try {
    it = await reader.item(input.tx);
  } catch {
    return refusal("ccd/unreadable");
  }
  if (it === null) return refusal("ccd/not-found");
  if (!isItem(it)) return refusal("ccd/unreadable");
  if (it.state !== "finalized") return refusal("ccd/not-finalized");
  if (!it.success) return refusal("ccd/rejected");
  const carried = it.transfers.flatMap((t) => {
    const memo = transferMemo(t);
    const h = memo === null ? null : memoCarrier(memo);
    return h === null || isRefusal(h) ? [] : [h];
  });
  return carried.length === 1 ? carried[0]! : refusal("ccd/no-carrier");
}

/**
 * The pairing's filter: an `exact` option on a `ccd:` network, for CCD or a token symbol, whose `payTo` and
 * `extra.feePayer` are base58check account addresses, and whose amount is `"0"` or a positive decimal below 2^64: the
 * scheme asks strict equality and sets no floor, and the pairing's agreement floor is zero.
 */
function ccdOption(o: unknown): o is PaymentRequirements {
  if (!isObject(o)) return false;
  const extra = o["extra"];
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
    (isAmount(amount) || amount === "0") &&
    DECIMAL.test(amount) &&
    BigInt(amount) < UINT64_LIMIT &&
    isTimeoutSeconds(o["maxTimeoutSeconds"])
  );
}

/** The pairing's option filter, which `advertise`, `read`, `build` and `bound` apply. */
const filter = filterOf(ccdOption);
const advertise = advertiseFor(filter);
const read: (doc: PaymentRequired) => X402Read | Refusal = readFor(filter);

/**
 * What the buyer's wallet assembles and signs: one transfer to `payTo` whose memo carries the hash, the CCD memo where
 * the asset is CCD in any case and the PLT memo otherwise, expiring at `now` plus `maxTimeoutSeconds` less
 * `CCD_EXPIRY_MARGIN`, as the stock client sets it. H is checked first, then the form of the choice's `now`, then its
 * document and option.
 */
async function build(c: CcdChoice, h: AtrHash): Promise<CcdUnsigned | Refusal> {
  if (normalHash(h) === null) return refusal("ccd/memo-not-lcp");
  if (!isObject(c)) return refusal("x402/not-v2");
  const { required, accepted, now } = c;
  if (!Number.isSafeInteger(now) || now < 0) return refusal("ccd/option-malformed");
  const wrong = chosen(required, accepted, filter);
  if (wrong !== true) return wrong;
  const sponsor = accepted.extra!["feePayer"] as string;
  // CCD is named without regard to case, as the stock facilitator reads the asset.
  const memo = accepted.asset.toLowerCase() === "ccd" ? ccdMemo(h) : pltMemo(h);
  return {
    request: {
      kind: "ccd-transfer",
      network: accepted.network as CcdNetwork,
      sponsor,
      toAddress: accepted.payTo,
      asset: accepted.asset,
      amount: accepted.amount,
      memo,
      expiresBy: now + accepted.maxTimeoutSeconds - CCD_EXPIRY_MARGIN,
    },
    complete(signedTransaction: unknown): CcdPaymentPayload | Refusal {
      if (!isObject(signedTransaction) || jsonSize(signedTransaction) === undefined) {
        return refusal("ccd/transaction-malformed");
      }
      return paymentWith(required, accepted, { signedTransaction: signedTransaction as { [k: string]: Json } });
    },
  };
}

/**
 * What `bound` and `reference` share from a signed transaction: the sender, the expiry, the one transfer's memo
 * carrier, and that transfer as signed, whose receiver and amount `reference` alone reads (`transferOf`).
 */
interface Signed {
  sender: Uint8Array;
  expiry: number;
  carrier: AtrHash;
  transfer: { kind: "ccd"; body: Record<string, unknown> } | { kind: "plt"; body: CborMap };
  /** The signed header and payload as presented, and a token update's operations. */
  header: Record<string, unknown>;
  body: Record<string, unknown>;
  ops?: Uint8Array;
}

/**
 * The hash inside what the sender signed, in x402's wire form: the one transfer's memo, through `memoCarrier`. Of the
 * signed transaction it reads the version, the header's sender and expiry, the payload's type and the one transfer's
 * memo, and no sponsor, receiver, amount or token. No signature is verified here; the chain accepts the transaction
 * only with the sender's valid signature.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const s = await signed(presented);
  return isRefusal(s) ? s : s.carrier;
}

/**
 * The read keys for finding this payment later (the profile's rule 8): the network, H, the header's sender, its signed
 * sequence number and `expiry`, the option's `payTo` for the two party tests, and the digest of the members the sender
 * signed (rule 14), its payload written in the protocol's binary form and its energy the header's whole energy, which
 * the sender signed and the wire form does not hold (`signedEnergy`, from `executionEnergyAmount`, the two signature
 * counts and the payload's size). A presented payment whose `accepted` is not the option given, compared as RFC 8785
 * JSON, is `x402/accepted-not-option`; a header whose sequence number or signature counts are not positive integers,
 * whose `executionEnergyAmount` is not a non-negative one, that names no sponsor, or whose sponsor is not an account,
 * and a receiver, amount or token id that cannot be read, are refused here, and not by `bound`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<CcdRef | Refusal> {
  const s = await signed(presented);
  if (isRefusal(s)) return s;
  const t = transferOf(s.transfer);
  if (isRefusal(t)) return t;
  const { accepted } = presented as CcdPaymentPayload;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameJson(accepted, option)) return refusal("x402/accepted-not-option");
  const nonce = s.header["nonce"];
  const execution = s.header["executionEnergyAmount"];
  const sponsorField = s.header["sponsor"];
  const signatures = [s.header["numSignatures"], isObject(sponsorField) ? sponsorField["numSignatures"] : undefined];
  if (!isCount(nonce, 1) || !isCount(execution, 0) || !signatures.every((n) => isCount(n, 1))) return refusal("ccd/transaction-malformed");
  if (!isObject(sponsorField)) return refusal("ccd/transaction-malformed");
  const sponsor = typeof sponsorField["account"] === "string" ? accountBytes(sponsorField["account"]) : refusal("ccd/address-malformed");
  if (isRefusal(sponsor)) return sponsor;
  const payload = payloadBytes(s, t);
  if (isRefusal(payload)) return payload;
  const energy = signedEnergy(BigInt(execution as number), BigInt(signatures[0] as number) + BigInt(signatures[1] as number), payload.length);
  const digest = await signedDigest({ sender: s.sender, nonce: BigInt(nonce as number), expiry: BigInt(s.expiry), energy, sponsor, payload });
  return {
    network: accepted.network as CcdNetwork,
    h: s.carrier,
    sender: s.header["sender"] as string,
    nonce: String(nonce),
    expiry: s.expiry,
    payee,
    signed: digest,
  };
}

/**
 * The signed payload in the protocol's binary form: `transferWithMemo` (22), the receiver's 32 bytes, the memo with its
 * 2-byte length and the amount as 8 bytes big-endian; `tokenUpdate` (27), the token id with a 1-byte length and the
 * operations with a 4-byte big-endian length (`concordium-base` `Execution.hs:776-780`, `:829-832`).
 */
function payloadBytes(s: Signed, t: { receiver: Uint8Array; amount: bigint }): Uint8Array | Refusal {
  if (s.transfer.kind === "ccd") {
    const memo = hexToBytes(s.body["memo"] as string);
    const out = new Uint8Array(1 + 32 + memo.length + 8);
    out[0] = 22;
    out.set(t.receiver, 1);
    out.set(memo, 33);
    new DataView(out.buffer).setBigUint64(33 + memo.length, t.amount);
    return out;
  }
  const id = s.body["tokenId"];
  const idBytes = typeof id === "string" ? utf8.encode(id) : new Uint8Array(0);
  if (idBytes.length === 0 || idBytes.length > 255) return refusal("ccd/transaction-malformed");
  const ops = s.ops!;
  const out = new Uint8Array(2 + idBytes.length + 4 + ops.length);
  out[0] = 27;
  out[1] = idBytes.length;
  out.set(idBytes, 2);
  new DataView(out.buffer).setUint32(2 + idBytes.length, ops.length);
  out.set(ops, 2 + idBytes.length + 4);
  return out;
}

async function signed(presented: unknown): Promise<Signed | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = acceptedBy(presented["accepted"], filter);
  if (isRefusal(accepted)) return accepted;
  const payload = presented["payload"];
  const tx = isObject(payload) ? payload["signedTransaction"] : undefined;
  if (!isObject(tx)) return refusal("ccd/transaction-malformed");
  const size = jsonSize(tx);
  if (size === undefined) return refusal("ccd/transaction-malformed");
  if (size > MAX_TRANSACTION) return refusal("ccd/too-large");
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
      return { sender, expiry, carrier, transfer: { kind: "ccd", body }, header, body };
    }
    case "tokenUpdate": {
      const ops = hexBytes(body["operations"], MAX_OPERATIONS);
      if (isRefusal(ops)) return ops;
      const t = tokenTransfer(ops, sender, expiry);
      return isRefusal(t) ? t : { ...t, header, body, ops };
    }
    case "transfer":
      return refusal("ccd/no-memo");
    default:
      return refusal("ccd/payload-kind");
  }
}

/** The one `transfer` operation of a PLT `TokenUpdate` and its memo's carrier. */
function tokenTransfer(ops: Uint8Array, sender: Uint8Array, expiry: number): Omit<Signed, "header" | "body" | "ops"> | Refusal {
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
  return { sender, expiry, carrier, transfer: { kind: "plt", body } };
}

/**
 * The signed transfer's receiver and amount, for `ccdIdDigest`: `toAddress` and `amount` (microCCD, decimal below
 * 2^64) of a transfer with memo; the `recipient` tag-40307 map's key 3 and the tag-4 decimal fraction's mantissa of a
 * PLT transfer.
 */
function transferOf(t: Signed["transfer"]): { receiver: Uint8Array; amount: bigint } | Refusal {
  if (t.kind === "ccd") {
    const receiver = typeof t.body["toAddress"] === "string" ? accountBytes(t.body["toAddress"]) : refusal("ccd/address-malformed");
    if (isRefusal(receiver)) return receiver;
    const amount = t.body["amount"];
    if (typeof amount !== "string" || !DECIMAL.test(amount) || BigInt(amount) >= UINT64_LIMIT) {
      return refusal("ccd/transaction-malformed");
    }
    return { receiver, amount: BigInt(amount) };
  }
  const recipient = mapGet(t.body, "recipient");
  const account = recipient !== undefined && isTag(recipient, 40307n) && isMap(recipient.value) ? mapGet(recipient.value, 3n) : undefined;
  if (!(account instanceof Uint8Array) || account.length !== 32) return refusal("ccd/operations-malformed");

  const amount = mapGet(t.body, "amount");
  const fraction = amount !== undefined && isTag(amount, 4n) ? amount.value : undefined;
  if (!Array.isArray(fraction) || fraction.length !== 2) return refusal("ccd/operations-malformed");
  const mantissa = (fraction as readonly Cbor[])[1];
  if (typeof mantissa !== "bigint" || mantissa < 0n) return refusal("ccd/operations-malformed");
  return { receiver: account, amount: mantissa };
}

/** The UTF-8 length of a JSON value's serialization, or undefined for a value that is not JSON (a bigint, say). */
function jsonSize(v: unknown): number | undefined {
  const text = canonicalJson(v);
  return typeof text === "string" ? utf8.encode(text).length : undefined;
}

/**
 * The option unchanged: on this pairing the hash rides in the signed transfer's memo, not in the option. An option that
 * carries a `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/** A JSON number that is a safe integer at or above `min`. */
function isCount(v: unknown, min: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min;
}

function isAccount(v: unknown): boolean {
  return typeof v === "string" && !isRefusal(accountBytes(v));
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


const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/ccd`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the sponsor,
 * signs and submits the sponsored transaction the payer signed; `status` reads the finalized transfer.
 */
export const exactCcd = Object.freeze({
  id: ID,
  data: CCD[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee", { payload: () => refusal("ccd/transaction-malformed") }),
  reference,
  status: ccdStatus,
  recover: ccdRecover,
}) satisfies Entry<
  typeof ID,
  CcdPaymentPayload,
  CcdRef,
  CcdReader,
  X402Forms & {
    choice: CcdChoice;
    unsigned: CcdUnsigned;
    landed: unknown;
    network: CcdNetwork;
    query: StatusQuery<CcdRef, bigint, "finalized", CcdSearch>;
    answer: CcdStatus;
  }
>;
