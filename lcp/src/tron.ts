/**
 * Tron: the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its
 * memo, `raw_data.data`, in LCP string form, and the transaction pieces it uses.
 *
 * The pieces are protobuf for the fields the profile uses, base58check addresses and the transaction id. Settlement is
 * read by transaction id through a bounded reader.
 *
 * @module
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { createBase58check } from "@scure/base";
import { fromLcpString, hash, hashEquals, toLcpString, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash, notFoundPoint } from "./fields.js";
import type { TronPayment } from "./internal/tron.js";
import {
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  paymentWith,
  presentedWith,
  readFor,
  sameJson,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { bytesOfHexDigits, decimalBelow, hexDigits } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { TRON, TRON_ZERO_SHOWN } from "./internal/data/tron.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import { decide, type Facts, type Moved, type RecoverInput, type Seen, type StatusAnswer, type StatusQuery, type Undecoded, type UnreadableReason } from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { TronPayment } from "./internal/tron.js";
export type { X402Payment, X402Read } from "./internal/x402.js";

/** CAIP-2 with the decimal chain id: tron:728126428 mainnet, tron:3448148188 Nile, tron:2494104990 Shasta. */
export type TronNetwork = `tron:${number}`;
export const LCP_TRC20_MEMO = "lcp-trc20-memo";
export const TRIGGER_SMART_CONTRACT = 31;
export const TRIGGER_URL = "type.googleapis.com/protocol.TriggerSmartContract";
/** transfer(address,uint256) */
export const TRANSFER_SELECTOR = "a9059cbb";
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * The `Transaction.raw` fields this profile uses. `B` is what its bytes are backed by: `decodeTronTx` gives
 * `TronRaw<ArrayBuffer>`, each byte field in its own fresh `ArrayBuffer`, and `encodeTronRaw` and `tronCarrier` take
 * any backing.
 */
export interface TronRaw<B extends ArrayBufferLike = ArrayBufferLike> {
  refBlockBytes: Uint8Array<B>;
  refBlockHash: Uint8Array<B>;
  expiration: bigint;
  data: Uint8Array<B>;
  owner: Uint8Array<B>;
  contractAddress: Uint8Array<B>;
  callData: Uint8Array<B>;
  timestamp: bigint;
  feeLimit: bigint;
}

export interface TronInfo {
  blockNumber: bigint;
  /** `receipt.result` as the node returns it: "SUCCESS", "REVERT", … */
  result: string;
  /** `address` is 20-byte hex as the node returns it; `data`, where given, the log's data in hex. */
  logs: readonly { address: string; topics: readonly string[]; data?: string }[];
}

/** The level a read goes through: the full node's `/walletsolidity` API ("solid") or its `/wallet` API ("head"). */
export type TronLevel = "solid" | "head";

/** A node's latest block at a level, as its `getnowblock` names it: its number, its `blockID` and its time in ms. */
export interface TronNow {
  number: bigint;
  blockId: Hex;
  timestamp: bigint;
}

/**
 * A block as `getblockbylimitnext` and `getblockbynum` give it: its `blockID`, the `number` and `parentHash` of its
 * header's `raw_data`, and the `raw_data_hex` of each of its `transactions`, in order (java-tron at `4e8389f1`,
 * `framework/src/main/java/org/tron/core/services/http/Util.java:137-148`, `:295-298`).
 */
export interface TronBlock {
  blockId: Hex;
  number: bigint;
  parentHash: Hex;
  transactions: readonly string[];
}

/**
 * Bounded, read-only calls against one network's FullNode: its `/walletsolidity` API for solidified data and its
 * `/wallet` API at the head. Every failure rejects, for example with `ReaderError` from `@integraledger/lcp/evm`, and
 * reads as unreadable `transport`; a rejection whose `kind` is `too-large`, as `ReaderError` carries it, is an answer over
 * the reader's byte bound.
 */
export interface TronReader {
  readonly network: TronNetwork;
  /**
   * Declared by the caller where its node holds the chain's whole history, so that with no position given absence can
   * be read; absent, it is not declared.
   */
  readonly archival?: boolean;
  /**
   * `/walletsolidity/gettransactioninfobyid` ("solid") or `/wallet/gettransactioninfobyid` ("head"). When the node does
   * not know the transaction, `notFound` with `timestamp`: the time in milliseconds of the latest block at that level
   * on the node that answered (`/walletsolidity/getnowblock` or `/wallet/getnowblock`), read from that same node before
   * the lookup, or null when the reader cannot read it from that node. A lookup naming no time never reads failed.
   */
  info(txid: Hex, level: TronLevel): Promise<TronInfo | { notFound: true; timestamp: bigint | null }>;
  /** `/walletsolidity/gettransactionbyid`; null: none. */
  transaction(txid: Hex): Promise<{ rawDataHex: string } | null>;
  /** `/walletsolidity/getnowblock` ("solid") or `/wallet/getnowblock` ("head"): the latest block at that level. */
  now(level: TronLevel): Promise<TronNow>;
  /**
   * `getblockbylimitnext` under `/walletsolidity` ("solid") or `/wallet` ("head"): the blocks from `start` up to `end`,
   * not including it, at most 100, in the order the node gives them, none for its `{}`; and `head`, the number of that
   * node's latest block at that level, read from that same node before the call, or null where the reader cannot.
   */
  blocks(start: bigint, end: bigint, level: TronLevel): Promise<{ head: bigint | null; blocks: readonly TronBlock[] }>;
  /** `getblockbynum` at the level: the block, or null for the node's `{}`; and `head`, as `blocks` gives it. */
  block(num: bigint, level: TronLevel): Promise<{ head: bigint | null; block: TronBlock | null }>;
}

/**
 * The read keys `reference` returns, JSON-serialisable. `raw` is the `raw_data` the owner signed, lowercase hex, which
 * is the payment presented; `txid` its SHA-256, the single-use value; `asset` the contract's 21-byte address;
 * `expiration` decimal milliseconds; `payer` the transaction's owner in base58check, read from the signed bytes; and
 * `payee` the `payTo` of the option the payment answers, the key of the two party tests and no search key.
 */
export interface TronRef {
  network: TronNetwork;
  payee: string;
  payer: string;
  txid: Hex;
  raw: string;
  asset: Hex;
  expiration: string;
}

/**
 * The search's position: the last block it linked, by its number and `blockID`, at or below the solidified head. A
 * `pending` answer returns it, and the next call takes it as `query.search` and reads on from the block after it.
 */
export interface TronCursor {
  readonly number: bigint;
  readonly blockId: Hex;
}

/**
 * The answer of `tronStatus`, as the profile `read-status` gives it. Its marks are `head` and `solidified`, in that
 * order, its position the block number and its search position a `TronCursor`. A `settled` answer states `presented`:
 * `yes` where the settled transaction's id is the reference's, the id being the SHA-256 of the `raw_data` the owner
 * signed, and `no` otherwise; its `signer` is the transaction's owner in base58check, and its `authority` the
 * contract's `Permission_id`, as `Permission_id 0`, 0 where the transaction names none.
 */
export type TronStatus = StatusAnswer<bigint, TronMark, TronCursor>;

/** The query `tronStatus` takes: the profile `read-status`'s, its search position a `TronCursor`. */
export type TronQuery = StatusQuery<TronRef, bigint, TronMark, TronCursor>;

export type TronMark = "head" | "solidified";
const MARKS: readonly TronMark[] = ["head", "solidified"];

export interface TronChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  /** The payer's base58check address. */
  payer: string;
  /** A recent block from the buyer's FullNode. */
  refBlock: { number: bigint; id: Hex };
  /** Milliseconds since the epoch. */
  now: bigint;
  /** In sun, from 1 to 15,000,000,000. */
  feeLimit: bigint;
}

export interface TronUnsigned {
  /**
   * What the payer signs. `rawBytes` is the transaction's `raw_data`, `Transaction.raw` as `encodeTronRaw` writes it;
   * `txid` is its SHA-256, the 32-byte transaction id. `tronRequest` reads them.
   */
  request: { kind: "tron-txid"; txid: Uint8Array<ArrayBuffer>; rawBytes: Uint8Array<ArrayBuffer> };
  /** Takes the 65-byte secp256k1 signature `r ‖ s ‖ v`, v in {0, 1, 27, 28}. */
  complete(signature: Uint8Array): TronPayment | Refusal;
}

const ID = "x402/exact/tron/lcp-trc20-memo" as const;

/**
 * The pairing's bounds, each the chain's, the profile's or lcp's own resource bound, with its reason.
 * `transactionHex`: lcp's bound on a signed transaction's hex digits, which the profile's transaction fits many times
 * over and which bounds what is decoded. `signatures`: lcp's bound on the signatures decoded, enough for an owner's
 * permission of five keys. `signatureBytes`: a secp256k1 signature `r ‖ s ‖ v`. `callData`: `transfer(address,uint256)`,
 * its selector and two 32-byte words. `feeLimit`: the network's largest `fee_limit` in sun. `maxTimeoutSeconds`: the
 * profile's, which keeps a signed `expiration` within the node's 24-hour cap. `rangeBlocks`: the node's own bound on a
 * range of `getblockbylimitnext` (java-tron at `4e8389f1`, `GetBlockByLimitNextServlet.java:18`). `searchBlocks`: lcp's
 * resource bound, the blocks one call of `tronStatus` reads of its search, two full ranges, so that each call's reads
 * are bounded; the next call takes the search's position.
 */
export const TRON_BOUNDS = Object.freeze({
  transactionHex: 8192,
  signatures: 5,
  signatureBytes: 65,
  callData: 68,
  feeLimit: 15_000_000_000,
  maxTimeoutSeconds: 86_340,
  rangeBlocks: 100,
  searchBlocks: 200,
} as const);
const MAX_TX_HEX = TRON_BOUNDS.transactionHex;
const MAX_SIGNATURES = TRON_BOUNDS.signatures;
const SIGNATURE_BYTES = TRON_BOUNDS.signatureBytes;
const CALL_DATA_BYTES = TRON_BOUNDS.callData;
const MAX_TIMEOUT_SECONDS = TRON_BOUNDS.maxTimeoutSeconds;
const MAX_FEE_LIMIT = BigInt(TRON_BOUNDS.feeLimit);
const INT64_LIMIT = 1n << 63n;
const UINT256_LIMIT = 1n << 256n;
const EXPIRY_SLOTS_MS = 6000n;
const NETWORK = /^tron:(0|[1-9][0-9]{0,15})$/;
const LOWER_HEX = /^(?:[0-9a-f]{2})*$/;
const BLOCK_ID = /^0x[0-9a-fA-F]{64}$/;
const BASE58_ADDRESS_CHARS = 34;
/** H's LCP string: `lcp:sha256:0x` and 64 hex digits. */
const MEMO_BYTES = 77;

const utf8 = new TextEncoder();
/** The memo's text: strict UTF-8, a leading byte-order mark kept, so a memo that begins with one holds no hash. */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ── Protobuf: varints and length-delimited fields, for the fields named in TronRaw only.

type Field = { no: number; wire: 0; value: bigint } | { no: number; wire: 2; value: Uint8Array };

function pushVarint(out: number[], n: bigint): void {
  let v = n;
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
}

function pushBytes(out: number[], no: number, b: Uint8Array): void {
  if (b.length === 0) return;
  pushVarint(out, BigInt((no << 3) | 2));
  pushVarint(out, BigInt(b.length));
  for (let i = 0; i < b.length; i++) out.push(b[i]!);
}

function pushInt(out: number[], no: number, v: bigint): void {
  if (v === 0n) return;
  pushVarint(out, BigInt(no << 3));
  pushVarint(out, v);
}

function message(build: (out: number[]) => void): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  build(out);
  return Uint8Array.from(out);
}

/** The fields of one protobuf message, in the order written; null when the bytes are not well-formed. */
function fieldsOf(b: Uint8Array): Field[] | null {
  const fields: Field[] = [];
  let i = 0;
  const varint = (): bigint | null => {
    let v = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const c = b[i++];
      if (c === undefined) return null;
      v |= BigInt(c & 0x7f) << shift;
      if ((c & 0x80) === 0) return v < 1n << 64n ? v : null;
    }
    return null;
  };
  while (i < b.length) {
    const key = varint();
    if (key === null || key > 0xffffffffn) return null;
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (no === 0) return null;
    if (wire === 0) {
      const v = varint();
      if (v === null) return null;
      fields.push({ no, wire: 0, value: v });
    } else if (wire === 2) {
      const len = varint();
      if (len === null || len > BigInt(b.length - i)) return null;
      fields.push({ no, wire: 2, value: b.subarray(i, i + Number(len)) });
      i += Number(len);
    } else {
      return null;
    }
  }
  return fields;
}

/**
 * `Transaction.raw` as java-tron serialises it: fields in ascending order, default values omitted. Throws TypeError
 * when `r` is not an object, a bytes field is not a `Uint8Array`, or `expiration`, `timestamp` or `feeLimit` is not a
 * bigint from 0 below 2^63, the values `decodeTronTx` reads back.
 */
export function encodeTronRaw(r: TronRaw): Uint8Array<ArrayBuffer> {
  if (!isTronRaw(r)) throw new TypeError("not a TronRaw");
  const trigger = message((o) => {
    pushBytes(o, 1, r.owner);
    pushBytes(o, 2, r.contractAddress);
    pushBytes(o, 4, r.callData);
  });
  const any = message((o) => {
    pushBytes(o, 1, utf8.encode(TRIGGER_URL));
    pushBytes(o, 2, trigger);
  });
  const contract = message((o) => {
    pushInt(o, 1, BigInt(TRIGGER_SMART_CONTRACT));
    pushBytes(o, 2, any);
  });
  return message((o) => {
    pushBytes(o, 1, r.refBlockBytes);
    pushBytes(o, 4, r.refBlockHash);
    pushInt(o, 8, r.expiration);
    pushBytes(o, 10, r.data);
    pushBytes(o, 11, contract);
    pushInt(o, 14, r.timestamp);
    pushInt(o, 18, r.feeLimit);
  });
}

const RAW_BYTES = ["refBlockBytes", "refBlockHash", "data", "owner", "contractAddress", "callData"] as const;
const RAW_INTS = ["expiration", "timestamp", "feeLimit"] as const;

function isTronRaw(r: unknown): r is TronRaw {
  if (!isObject(r)) return false;
  const int64 = (v: unknown) => typeof v === "bigint" && v >= 0n && v < INT64_LIMIT;
  return RAW_BYTES.every((k) => r[k] instanceof Uint8Array) && RAW_INTS.every((k) => int64(r[k]));
}

function encodeTransaction(rawBytes: Uint8Array, signatures: readonly Uint8Array[]): Uint8Array {
  return message((o) => {
    pushBytes(o, 1, rawBytes);
    for (const s of signatures) pushBytes(o, 2, s);
  });
}

/**
 * Decodes a signed `Transaction` from lowercase hex: `raw_data` with exactly one `TriggerSmartContract` and only the
 * fields TronRaw names, and 1 to 5 signatures of 65 bytes. The raw bytes must be exactly what `encodeTronRaw` writes
 * for the fields read.
 */
export function decodeTronTx(
  hex: string,
): { raw: TronRaw<ArrayBuffer>; rawBytes: Uint8Array<ArrayBuffer>; signatures: Uint8Array<ArrayBuffer>[] } | Refusal {
  if (typeof hex !== "string") return refusal("tron/tx-malformed");
  if (hex.length > MAX_TX_HEX) return refusal("tron/tx-too-large");
  if (hex.length === 0 || !LOWER_HEX.test(hex)) return refusal("tron/tx-malformed");
  const outer = fieldsOf(bytesOfHexDigits(hex)!);
  if (outer === null) return refusal("tron/tx-malformed");
  let rawBytes: Uint8Array | undefined;
  const signatures: Uint8Array[] = [];
  for (const f of outer) {
    if (f.no === 1 && f.wire === 2 && rawBytes === undefined) rawBytes = f.value;
    else if (f.no === 2 && f.wire === 2) signatures.push(f.value);
    else return refusal("tron/tx-malformed");
  }
  if (rawBytes === undefined) return refusal("tron/tx-malformed");
  if (signatures.length < 1 || signatures.length > MAX_SIGNATURES) return refusal("tron/signature-malformed");
  if (signatures.some((s) => s.length !== SIGNATURE_BYTES)) return refusal("tron/signature-malformed");
  const raw = decodeRaw(rawBytes);
  if (isRefusal(raw)) return raw;
  return { raw, rawBytes: Uint8Array.from(rawBytes), signatures: signatures.map((s) => Uint8Array.from(s)) };
}

function decodeRaw(rawBytes: Uint8Array): TronRaw<ArrayBuffer> | Refusal {
  const fields = fieldsOf(rawBytes);
  if (fields === null) return refusal("tron/tx-malformed");
  const raw: TronRaw<ArrayBuffer> = {
    refBlockBytes: new Uint8Array(0),
    refBlockHash: new Uint8Array(0),
    expiration: 0n,
    data: new Uint8Array(0),
    owner: new Uint8Array(0),
    contractAddress: new Uint8Array(0),
    callData: new Uint8Array(0),
    timestamp: 0n,
    feeLimit: 0n,
  };
  const contracts: Uint8Array[] = [];
  for (const f of fields) {
    if (f.wire === 2 && f.no === 1) raw.refBlockBytes = Uint8Array.from(f.value);
    else if (f.wire === 2 && f.no === 4) raw.refBlockHash = Uint8Array.from(f.value);
    else if (f.wire === 2 && f.no === 10) raw.data = Uint8Array.from(f.value);
    else if (f.wire === 2 && f.no === 11) contracts.push(f.value);
    else if (f.wire === 0 && (f.no === 8 || f.no === 14 || f.no === 18)) {
      if (f.value >= INT64_LIMIT) return refusal("tron/tx-malformed");
      if (f.no === 8) raw.expiration = f.value;
      else if (f.no === 14) raw.timestamp = f.value;
      else raw.feeLimit = f.value;
    } else return refusal("tron/tx-malformed");
  }
  if (contracts.length !== 1) return refusal("tron/contracts");

  const contract = fieldsOf(contracts[0]!);
  if (contract === null) return refusal("tron/tx-malformed");
  let type = 0n;
  let any: Uint8Array | undefined;
  for (const f of contract) {
    if (f.no === 1 && f.wire === 0) type = f.value;
    else if (f.no === 2 && f.wire === 2) any = f.value;
    else return refusal("tron/tx-malformed");
  }
  if (type !== BigInt(TRIGGER_SMART_CONTRACT) || any === undefined) return refusal("tron/not-trigger");
  const anyFields = fieldsOf(any);
  if (anyFields === null) return refusal("tron/tx-malformed");
  let url: Uint8Array | undefined;
  let value: Uint8Array | undefined;
  for (const f of anyFields) {
    if (f.no === 1 && f.wire === 2) url = f.value;
    else if (f.no === 2 && f.wire === 2) value = f.value;
    else return refusal("tron/tx-malformed");
  }
  if (url === undefined || !sameBytes(url, utf8.encode(TRIGGER_URL))) return refusal("tron/not-trigger");
  const trigger = fieldsOf(value ?? new Uint8Array(0));
  if (trigger === null) return refusal("tron/tx-malformed");
  for (const f of trigger) {
    if (f.no === 1 && f.wire === 2) raw.owner = Uint8Array.from(f.value);
    else if (f.no === 2 && f.wire === 2) raw.contractAddress = Uint8Array.from(f.value);
    else if (f.no === 4 && f.wire === 2) raw.callData = Uint8Array.from(f.value);
    else return refusal("tron/tx-malformed");
  }
  if (!sameBytes(encodeTronRaw(raw), rawBytes)) return refusal("tron/raw-not-canonical");
  return raw;
}

// ── Addresses.

/** Decodes a base58check address to its 21 bytes, which begin 0x41. The checksum is SHA-256 twice. */
export async function tronAddress(address: string): Promise<Uint8Array<ArrayBuffer> | Refusal> {
  return addressBytes(address) ?? refusal("tron/address-malformed");
}

const BASE58CHECK = createBase58check(sha256);

/**
 * The 21 bytes of a base58check string of 34 characters whose first byte is 0x41 and whose last four bytes are the
 * first four of SHA-256 twice over the 21, or null.
 */
function addressBytes(address: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof address !== "string" || address.length !== BASE58_ADDRESS_CHARS) return null;
  let b: Uint8Array;
  try {
    b = BASE58CHECK.decode(address);
  } catch {
    return null;
  }
  return b.length === 21 && b[0] === 0x41 ? Uint8Array.from(b) : null;
}

// ── The carrier.

/**
 * The hash in the memo of a transaction whose one contract calls `transfer`, and the transaction id. A `tx` that is not
 * `decodeTronTx`'s `{ raw, rawBytes }` is `tron/tx-malformed`.
 */
export async function tronCarrier(tx: { raw: TronRaw; rawBytes: Uint8Array }): Promise<{ h: AtrHash; txid: Hex } | Refusal> {
  if (!isObject(tx) || !isTronRaw(tx.raw) || !(tx.rawBytes instanceof Uint8Array)) return refusal("tron/tx-malformed");
  const call = tx.raw.callData;
  if (call.length !== CALL_DATA_BYTES || hexDigits(call.subarray(0, 4)) !== TRANSFER_SELECTOR) {
    return refusal("tron/not-transfer");
  }
  const h = memoHash(tx.raw.data);
  if (h === null) return refusal("tron/memo-not-lcp");
  return { h, txid: await hash(tx.rawBytes) };
}

/**
 * Reads the `raw_data` a `tron-txid` request carries, as `decodeTronTx` reads a signed transaction's and `tronCarrier`
 * reads its call and memo, with their codes, and gives `txid`, its SHA-256, which is the request's `txid` when the bytes
 * are its `rawBytes`. `raw` is every field the bytes hold, which are all the fields `decodeTronTx` admits: the reference
 * block's bytes and hash, `expiration` and `timestamp` in milliseconds, the memo `data`, `fee_limit` in sun, and the one
 * contract, a `TriggerSmartContract` with no call value from `owner` to `contractAddress` whose call data is
 * `transfer(address,uint256)`. Read from them: `payer`, the owner, and `asset`, the contract, in base58check; `payTo`,
 * the transfer's recipient, its address word's last 20 bytes under 0x41, in base58check; `amount`, the transfer's
 * value, in decimal; and `h`, the hash the memo carries. Bytes longer than the longest transaction `decodeTronTx` reads,
 * 4,096 bytes, are `tron/tx-too-large`, and a value that is not a `Uint8Array` `tron/tx-malformed`.
 */
export async function tronRequest(rawBytes: Uint8Array): Promise<{
  txid: Uint8Array<ArrayBuffer>;
  raw: TronRaw<ArrayBuffer>;
  payer: string;
  asset: string;
  payTo: string;
  amount: string;
  h: AtrHash;
} | Refusal> {
  if (!(rawBytes instanceof Uint8Array)) return refusal("tron/tx-malformed");
  if (rawBytes.length > MAX_TX_HEX / 2) return refusal("tron/tx-too-large");
  const raw = decodeRaw(rawBytes);
  if (isRefusal(raw)) return raw;
  const c = await tronCarrier({ raw, rawBytes });
  if (isRefusal(c)) return c;
  const call = raw.callData;
  return {
    txid: bytesOfHexDigits(c.txid.slice(2))!,
    raw,
    payer: BASE58CHECK.encode(raw.owner),
    asset: BASE58CHECK.encode(raw.contractAddress),
    payTo: BASE58CHECK.encode(Uint8Array.of(0x41, ...call.subarray(16, 36))),
    amount: BigInt(`0x${hexDigits(call.subarray(36))}`).toString(),
    h: c.h,
  };
}

/** Whether `data` is an LCP string of `h`, as `memoHash` reads one: `lcp:sha256:0x` and its hex digits in either case. */
function carries(data: Uint8Array, h: AtrHash): boolean {
  const m = memoHash(data);
  return m !== null && hashEquals(m, h);
}

function memoHash(data: Uint8Array): AtrHash | null {
  let text: string;
  try {
    text = strictUtf8.decode(data);
  } catch {
    return null;
  }
  return fromLcpString(text);
}

// ── Settlement.

/**
 * Whether a run has shown that a block's answer lists every transaction of its block, at each level, and the block
 * reads under `/wallet` to the full node's head, on a test network such as Nile. Until one has, a search read whole
 * proves no absence (the profile `read-status`, rule 25), and is read as not whole: the read answers no `failed` but
 * `before-position`.
 */
const BLOCK_LISTS_SHOWN = false as boolean;

/** A read that established nothing. */
class Stop {
  constructor(readonly reason: UnreadableReason) {}
}

async function call<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw new Stop(isObject(e) && e["kind"] === "too-large" ? "too-large" : "transport");
  }
}

const LEDGER = ledgerOf<bigint, TronMark>(TRON[ID].coverage, MARKS, bigintOrder);
const markOf = (level: TronLevel): TronMark => (level === "solid" ? "solidified" : "head");

/**
 * Answers the read of the act the query asks about as the profile `read-status` gives it, by the pairing's profile, rule
 * 8. The single-use value is the transaction id, the SHA-256 of the `raw_data` the owner signed, which the reference
 * holds whole as the payment presented. The read takes the latest solidified block first, then the transaction by id at
 * the solidified level and at the head, each lookup naming its own node's latest block time. Found, the transaction
 * consumed the id: it is the payer's act where its owner is the reference's payer and not the option's payee, it
 * succeeded where its receipt's result is `SUCCESS`, and what it moved is each `Transfer` log of its receipt whose
 * sender is the owner, named by the id and the log's place among the receipt's logs, or, where the receipt holds no
 * `Transfer` log and its signed call is a transfer of zero, that call's transfer of zero to its `to`; on the act
 * `payment` it is the payment only where one of those names `payTo`. Its owner is the answer's signer, and its
 * `Permission_id` the answer's authority. Absent from both lookups, each lookup's node at or past the solidified head's time, and the node holding the
 * block at the position the caller gave (or declared archival where it gave none), the id is unconsumed: before the
 * lapse, two slots past `expiration`, `instrument-live`. Only a `failed` answer needs the search for H, which the read
 * makes only then: it reads every block after the position given, or after the search position an earlier answer
 * returned, up to the solidified head read first through `/walletsolidity`, then on to the full node's head under
 * `/wallet`, at most `TRON_BOUNDS.rangeBlocks` a call and `TRON_BOUNDS.searchBlocks` a read, each block linked to the one
 * before it by its `parentHash`. Each transaction whose `data`, field 10 of its `raw_data`, is H's LCP string, its hex digits
 * in either case as `bound` reads it, is read by its id: one of the form whose owner is the payer and that meets the act's tests is the act asked about; any other is
 * named as a foreign item where a reason holds. Until a run shows that a block's answer lists every transaction of its
 * block, a search read whole proves no absence, so no `failed` but `before-position` is answered. A ref, a reader or a
 * query that is not one, a ref whose `raw` does not hash to its `txid`, is not the form's or is not owned by its
 * `payer`, or a search position that is not a `TronCursor`, is unreadable `unparseable`, with nothing read; a reader for
 * another network `chain-mismatch`; a read that rejects `transport`; one block over the reader's byte bound
 * `too-large`; and absence where the node does not hold the history `history-gap`.
 */
export async function tronStatus(ref: TronRef, reader: TronReader, query: TronQuery): Promise<TronStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint")) return UNPARSEABLE;
  const facts = await readTron(ref, reader, query).catch((e: unknown) => {
    if (e instanceof Stop) return e;
    throw e;
  });
  if (facts instanceof Stop) return { state: "unreadable", reason: facts.reason, foreign: [] };
  return decide(facts, query, LEDGER);
}

/** The presented transaction the reference holds, decoded: its form, its id and the hash its LCP string carries. */
interface Presented {
  raw: TronRaw;
  txid: Hex;
  h: AtrHash;
}

/** The reference's presented transaction, or null where the ref is not one `reference` writes. */
async function presentedOf(ref: TronRef): Promise<Presented | null> {
  const txid = normalHash(ref.txid);
  const asset: unknown = ref.asset;
  if (typeof ref.network !== "string" || txid === null || typeof asset !== "string" || !/^41[0-9a-f]{40}$/.test(bare(asset))) return null;
  if (typeof ref.raw !== "string" || ref.raw.length === 0 || ref.raw.length > MAX_TX_HEX || !LOWER_HEX.test(ref.raw)) return null;
  if (typeof ref.expiration !== "string" || !/^[0-9]{1,19}$/.test(ref.expiration)) return null;
  const payer = addressBytes(ref.payer);
  if (payer === null || addressBytes(ref.payee) === null) return null;
  const bytes = bytesOfHexDigits(ref.raw)!;
  const raw = decodeRaw(bytes);
  if (isRefusal(raw) || !sameBytes(raw.owner, payer)) return null;
  const carrier = await tronCarrier({ raw, rawBytes: bytes });
  if (isRefusal(carrier) || carrier.txid !== txid) return null;
  return { raw, txid, h: carrier.h };
}

/** The search's position, or null where it is not a `TronCursor`. */
function cursorOf(c: unknown): TronCursor | null {
  if (!isObject(c) || typeof c["number"] !== "bigint" || c["number"] < 0n || typeof c["blockId"] !== "string") return null;
  const id = normalHash(c["blockId"]);
  return id === null ? null : { number: c["number"], blockId: id };
}

/** What the read observed: the profile `read-status`'s facts, from the lookups by id and, before a `failed`, the search. */
async function readTron(ref: TronRef, reader: TronReader, query: TronQuery): Promise<Facts<bigint, TronMark, TronCursor>> {
  if (!isObject(ref) || !isObject(reader) || typeof reader.network !== "string") throw new Stop("unparseable");
  const p = await presentedOf(ref);
  const resume = query.search === undefined ? undefined : cursorOf(query.search);
  if (p === null || resume === null) throw new Stop("unparseable");
  if (reader.network !== ref.network) throw new Stop("chain-mismatch");
  const payTo = addressBytes(ref.payee)!;
  // The lapse is the signed `expiration`, read from the presented raw data, not from a member beside it.
  const expiration = p.raw.expiration;
  // The solidified head is read first; a transaction the lookups find is answered whether or not that read succeeded.
  const solidRead = await nowOf(reader, "solid").catch((e: unknown) => {
    if (e instanceof Stop) return e;
    throw e;
  });
  const others = otherIds(query);

  let found: { info: TronInfo; level: TronLevel } | undefined;
  const readTos: (bigint | null)[] = [];
  for (const level of ["solid", "head"] as const) {
    const info: unknown = await call(() => reader.info(p.txid, level));
    const readTo = notFoundPoint(info, "timestamp");
    if (readTo !== undefined) {
      readTos.push(readTo);
      continue;
    }
    if (!isInfo(info)) throw new Stop("unparseable");
    found = { info, level };
    break;
  }
  if (solidRead instanceof Stop && (found === undefined || found.level === "solid")) {
    // Absence, and a failed result's search, rest on the solidified head read first.
    const s = found === undefined ? undefined : seenOf(p.txid, p.raw, found.info, "solidified", ref, payTo, others, true);
    const settles = s !== undefined && s.result === "succeeded" && s.party === "payer" && (query.act === "agreement" || s.account === "payee");
    if (!settles && !(s !== undefined && query.after !== undefined && s.position! <= query.after)) throw solidRead;
  }
  const solid = solidRead instanceof Stop ? { number: -1n, blockId: p.txid, timestamp: 0n } : solidRead;
  const covered = readTos.every((t) => t !== null && t >= solid.timestamp);

  const seen: Seen<bigint, TronMark>[] = [];
  let value: NonNullable<Facts<bigint, TronMark, TronCursor>["value"]>;
  let history = false;
  let searchFrom: { start: bigint; anchor: Hex } | undefined;
  let needsSearch = false;
  if (found !== undefined) {
    const s = seenOf(p.txid, p.raw, found.info, markOf(found.level), ref, payTo, others, true);
    seen.push(s);
    value = { consumed: found.level === "solid", lapsed: false, mark: "solidified", head: { consumed: true } };
    const before = query.after !== undefined && s.position! <= query.after;
    const settles = s.result === "succeeded" && s.party === "payer" && (query.act === "agreement" || s.account === "payee");
    needsSearch = found.level === "solid" && !before && !settles;
    history = true;
  } else if (!covered) {
    // A lookup whose node lags the solidified head read first, or names no time, proves no absence.
    value = { consumed: false, lapsed: false, mark: "solidified" };
  } else {
    const lapsed = solid.timestamp >= expiration + EXPIRY_SLOTS_MS;
    if (query.after === undefined) {
      if (reader.archival !== true) throw new Stop("history-gap");
      history = true;
    } else {
      const at = await blockAt(reader, query.after, "solid");
      if (at === "lags") history = false;
      else if (at === "gap") throw new Stop("history-gap");
      else {
        history = true;
        searchFrom = { start: query.after + 1n, anchor: at.blockId };
      }
    }
    value = history ? { consumed: false, lapsed, mark: "solidified", head: { consumed: false } } : { consumed: false, lapsed: false, mark: "solidified" };
    needsSearch = history && lapsed;
  }

  let search: Facts<bigint, TronMark, TronCursor>["search"] = { whole: false };
  let undecoded: Undecoded<TronCursor>[] = [];
  if (needsSearch) {
    if (resume !== undefined) searchFrom = { start: resume.number + 1n, anchor: resume.blockId };
    else if (searchFrom === undefined && query.after !== undefined) {
      const at = await blockAt(reader, query.after, "solid");
      if (at === "gap") throw new Stop("history-gap");
      if (at !== "lags") searchFrom = { start: query.after + 1n, anchor: at.blockId };
    }
    if (searchFrom !== undefined) {
      const r = await searchH(reader, p, ref, payTo, others, solid, searchFrom, found !== undefined);
      seen.push(...r.seen);
      if (r.found !== undefined) {
        // The transaction asked about, which a lookup that lagged did not return: answered as found.
        seen.unshift(r.found.seen);
        value = { consumed: r.found.level === "solid", lapsed: false, mark: "solidified", head: { consumed: true } };
      }
      undecoded = r.undecoded;
      search = { whole: r.complete && BLOCK_LISTS_SHOWN, ...(r.at === undefined ? {} : { at: r.at }) };
    }
  }
  return { seen, value, search, history, ...(undecoded.length === 0 ? {} : { undecoded }) };
}

/** The ids of the other acts the caller gave under the same H, by their reference or their transaction, normalised. */
function otherIds(query: TronQuery): Set<string> {
  const ids = new Set<string>();
  for (const o of query.others ?? []) {
    const id = "ref" in o && isObject(o.ref) ? normalHash(o.ref.txid) : "transaction" in o ? normalHash(o.transaction) : null;
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** A node's latest block at a level; `unparseable` where its answer is not one. */
async function nowOf(reader: TronReader, level: TronLevel): Promise<TronNow> {
  const now: unknown = await call(() => reader.now(level));
  if (!isObject(now) || typeof now["number"] !== "bigint" || typeof now["timestamp"] !== "bigint") throw new Stop("unparseable");
  const blockId = normalHash(now["blockId"]);
  if (blockId === null) throw new Stop("unparseable");
  return { number: now["number"], blockId, timestamp: now["timestamp"] };
}

/** A block of a node's answer, or null where it is not one. */
function blockOf(b: unknown): TronBlock | null {
  if (!isObject(b) || typeof b["number"] !== "bigint" || !Array.isArray(b["transactions"])) return null;
  const blockId = normalHash(b["blockId"]);
  const parentHash = normalHash(b["parentHash"]);
  if (blockId === null || parentHash === null) return null;
  const transactions = b["transactions"] as unknown[];
  if (!transactions.every((t) => typeof t === "string")) return null;
  return { blockId, number: b["number"], parentHash, transactions: transactions as string[] };
}

/**
 * The block at `num` by `getblockbynum`: the block; `lags` where the node answered `{}` and its own latest block at the
 * level, read before the call, is below it or names none; `gap` where it answered `{}` at or past it.
 */
async function blockAt(reader: TronReader, num: bigint, level: TronLevel): Promise<TronBlock | "lags" | "gap"> {
  const a: unknown = await call(() => reader.block(num, level));
  if (!isObject(a) || !("block" in a)) throw new Stop("unparseable");
  const head = a["head"];
  if (a["block"] === null) return typeof head === "bigint" && head >= num ? "gap" : "lags";
  const b = blockOf(a["block"]);
  if (b === null || b.number !== num) throw new Stop("unparseable");
  return b;
}

/**
 * The blocks from `start` up to `end`, not including it: read by `getblockbylimitnext`, an answer over the reader's
 * byte bound read again in halves down to one block, and a block missing from an answer read alone by `getblockbynum`.
 * Gives the blocks read, in order, up to the first that could not be read, and why it could not: `lags` (the node is
 * below it), `gap` (the node is at or past it and holds none) or `unparsed` (an answer or a block of no documented
 * shape).
 */
async function rangeOf(
  reader: TronReader,
  start: bigint,
  end: bigint,
  level: TronLevel,
): Promise<{ blocks: TronBlock[]; stop?: "lags" | "gap" | "unparsed" }> {
  let a: unknown;
  try {
    a = await reader.blocks(start, end, level);
  } catch (e) {
    if (!(isObject(e) && e["kind"] === "too-large")) throw new Stop("transport");
    if (end - start <= 1n) throw new Stop("too-large");
    const mid = start + (end - start) / 2n;
    const first = await rangeOf(reader, start, mid, level);
    if (first.stop !== undefined) return first;
    const second = await rangeOf(reader, mid, end, level);
    return { blocks: [...first.blocks, ...second.blocks], ...(second.stop === undefined ? {} : { stop: second.stop }) };
  }
  if (!isObject(a) || !Array.isArray(a["blocks"])) return { blocks: [], stop: "unparsed" };
  const answered = a["blocks"] as unknown[];
  const head = a["head"];
  const out: TronBlock[] = [];
  for (let n = start, i = 0; n < end; n++, i++) {
    const raw = answered[i];
    if (raw === undefined) {
      // A block missing from the range's answer: the node is below it, or it is read alone.
      if (!(typeof head === "bigint" && head >= n)) return { blocks: out, stop: "lags" };
      const one = await blockAt(reader, n, level).catch((e: unknown) => {
        if (e instanceof Stop && e.reason === "unparseable") return "unparsed" as const;
        throw e;
      });
      if (typeof one === "string") return { blocks: out, stop: one };
      out.push(one);
      continue;
    }
    const b = blockOf(raw);
    if (b === null) return { blocks: out, stop: "unparsed" };
    out.push(b);
  }
  return { blocks: out };
}

/** What the search found: the acts and foreign items it read, the items it could not decode, and where it stands. */
interface Searched {
  seen: Seen<bigint, TronMark>[];
  found?: { seen: Seen<bigint, TronMark>; level: TronLevel };
  undecoded: Undecoded<TronCursor>[];
  complete: boolean;
  at?: TronCursor;
}

/**
 * The search for H (the profile's rule 8): every block from `from.start`, linked to `from.anchor`, up to the solidified
 * head read first under `/walletsolidity`, then on to the full node's head under `/wallet`, at most
 * `TRON_BOUNDS.searchBlocks` blocks. Complete where every block was read, each block's number is the one asked and its
 * `parentHash` the `blockID` of the one before it, and the last block of each part is that part's head. A link that
 * fails starts the search again at the position given: it gives no position. Any other stop holds the search at the
 * last block linked, at or below the solidified head.
 */
async function searchH(
  reader: TronReader,
  p: Presented,
  ref: TronRef,
  payTo: Uint8Array,
  others: Set<string>,
  solid: TronNow,
  from: { start: bigint; anchor: Hex },
  lookedUp: boolean,
): Promise<Searched> {
  const out: Searched = { seen: [], undecoded: [], complete: false };
  let last: TronCursor = { number: from.start - 1n, blockId: from.anchor };
  const held = (): TronCursor => (last.number <= solid.number ? last : { number: solid.number, blockId: solid.blockId });
  let budget = BigInt(TRON_BOUNDS.searchBlocks);
  for (const level of ["solid", "head"] as const) {
    const top = level === "solid" ? solid : await nowOf(reader, "head");
    while (last.number < top.number) {
      if (budget <= 0n) return { ...out, at: held() };
      const start = last.number + 1n;
      let count = top.number + 1n - start;
      if (count > BigInt(TRON_BOUNDS.rangeBlocks)) count = BigInt(TRON_BOUNDS.rangeBlocks);
      if (count > budget) count = budget;
      const range = await rangeOf(reader, start, start + count, level);
      for (const b of range.blocks) {
        if (b.number !== last.number + 1n || b.parentHash !== last.blockId) return out;
        const before = held();
        const stop = await scan(reader, b, level, p, ref, payTo, others, lookedUp, out, before);
        if (stop) return { ...out, at: before };
        last = { number: b.number, blockId: b.blockId };
        budget -= 1n;
      }
      if (range.stop === "gap") throw new Stop("history-gap");
      if (range.stop !== undefined) return { ...out, at: held() };
    }
    if (last.number !== top.number || last.blockId !== top.blockId) return out;
  }
  return { ...out, complete: true, at: held() };
}

/**
 * Reads one block's transactions for H: each whose `data` is H's LCP string is read by its id at the block's level and
 * added to what the search found. A transaction whose bytes are not a protobuf message is an item the search could not
 * decode, held at `before`. True where the search stops before this block: a transaction found whose receipt the
 * lookup by its id does not return, or a block whose transactions are not hex.
 */
async function scan(
  reader: TronReader,
  b: TronBlock,
  level: TronLevel,
  p: Presented,
  ref: TronRef,
  payTo: Uint8Array,
  others: Set<string>,
  lookedUp: boolean,
  out: Searched,
  before: TronCursor,
): Promise<boolean> {
  for (const hexed of b.transactions) {
    const bytes = bytesOfHexDigits(hexed.toLowerCase());
    if (bytes === null) return true;
    const fields = fieldsOf(bytes);
    const id = await hash(bytes);
    if (fields === null) {
      out.undecoded.push({ transaction: id, at: before });
      continue;
    }
    // H's LCP string as `bound` reads it: its hex digits in either case.
    if (!fields.some((f) => f.no === 10 && f.wire === 2 && f.value.length === MEMO_BYTES && carries(f.value, p.h))) continue;
    if (id === p.txid && lookedUp) continue;
    const info: unknown = await call(() => reader.info(id as Hex, level));
    if (notFoundPoint(info, "timestamp") !== undefined) return true;
    if (!isInfo(info)) throw new Stop("unparseable");
    const raw = decodeRaw(bytes);
    const form = !isRefusal(raw) && !isRefusal(await tronCarrier({ raw, rawBytes: bytes })) ? raw : null;
    const s = seenOf(id as Hex, form ?? ownerOnly(fields), info, markOf(level), ref, payTo, others, id === p.txid);
    if (id === p.txid) out.found = { seen: s, level };
    else out.seen.push({ ...s, position: b.number, ...(form === null ? { kind: "other" as const } : {}) });
  }
  return false;
}

/**
 * The owner of a transaction that is not the form's: field 1 of its one contract's parameter, the `owner_address` every
 * contract of `Tron.proto` names first; empty where it has not exactly one contract or names none. With it, the
 * contract's `Permission_id`, its field 5 (java-tron at `4e8389f1`, `protocol/src/main/protos/core/Tron.proto:384`), 0
 * where absent.
 */
function ownerOnly(fields: readonly Field[]): { owner: Uint8Array; callData: Uint8Array; contractAddress: Uint8Array; permission: bigint } {
  const none = { owner: new Uint8Array(0), callData: new Uint8Array(0), contractAddress: new Uint8Array(0), permission: 0n };
  const contracts = fields.filter((f) => f.no === 11 && f.wire === 2);
  if (contracts.length !== 1) return none;
  const contract = fieldsOf(contracts[0]!.value as Uint8Array);
  const permission = contract?.find((f) => f.no === 5 && f.wire === 0)?.value;
  const any = contract?.find((f) => f.no === 2 && f.wire === 2);
  const value = any === undefined ? undefined : fieldsOf(any.value as Uint8Array)?.find((f) => f.no === 2 && f.wire === 2);
  const owner = value === undefined ? undefined : fieldsOf(value.value as Uint8Array)?.find((f) => f.no === 1 && f.wire === 2);
  const held = { ...none, permission: typeof permission === "bigint" ? permission : 0n };
  return owner === undefined ? held : { ...held, owner: Uint8Array.from(owner.value as Uint8Array) };
}

/**
 * A Transfer log's sender and recipient, each `0x41` and its topic's last 20 bytes (TRC-20's `Transfer(address indexed
 * _from, address indexed _to, uint256 _value)`, tronprotocol/tips at `c29d7363`, `tip-20.md:159`), and its amount in
 * decimal; null for another log.
 */
function transferOf(log: unknown): { emitter: string; from: string; to: string; amount: string } | null {
  if (!isObject(log) || typeof log["address"] !== "string" || !Array.isArray(log["topics"])) return null;
  const topics = log["topics"] as unknown[];
  if (typeof topics[0] !== "string" || bare(topics[0]) !== TRANSFER_TOPIC) return null;
  if (typeof topics[1] !== "string" || typeof topics[2] !== "string") return null;
  const from = bare(topics[1]);
  const to = bare(topics[2]);
  if (!/^[0-9a-f]{64}$/.test(from) || !/^[0-9a-f]{64}$/.test(to)) return null;
  const emitter = bare(log["address"]);
  const data = typeof log["data"] === "string" ? bare(log["data"]) : "";
  return {
    emitter: `0x${emitter.length === 42 ? emitter : `41${emitter}`}`,
    from: `0x41${from.slice(24)}`,
    to: `0x41${to.slice(24)}`,
    amount: /^[0-9a-f]{1,64}$/.test(data) ? BigInt(`0x${data}`).toString() : "",
  };
}

/**
 * A transaction carrying H as the read classifies it, from its landed bytes and its receipt: its owner against the
 * reference's payer and the option's payee; what it moved, each `Transfer` log of its receipt whose sender is the
 * owner, named by the id and the log's place among the receipt's logs, or, where the receipt holds no `Transfer` log
 * and its signed call is the form's transfer of zero, that transfer to the call's `to`, named by the call; the account
 * it names against `payTo`; its owner as the signer and its `Permission_id` as the authority; and whether it is the
 * payment presented, by its id.
 */
function seenOf(
  id: Hex,
  raw: { owner: Uint8Array; callData: Uint8Array; contractAddress: Uint8Array; permission?: bigint },
  info: TronInfo,
  mark: TronMark,
  ref: TronRef,
  payTo: Uint8Array,
  others: Set<string>,
  consumed: boolean,
): Seen<bigint, TronMark> {
  const payee = `0x${hexDigits(payTo)}`;
  const succeeded = info.result === "SUCCESS";
  const sender = `0x${hexDigits(raw.owner)}`;
  const transfers = info.logs.map((log, place) => ({ t: transferOf(log), place }));
  const moved: Moved[] = succeeded
    ? transfers.flatMap(({ t, place }) =>
        t === null || t.from !== sender ? [] : [{ asset: t.emitter, amount: t.amount, to: t.to, transaction: id, place }],
      )
    : [];
  const call = raw.callData;
  const signedTo = call.length === CALL_DATA_BYTES && hexDigits(call.subarray(0, 4)) === TRANSFER_SELECTOR ? `0x41${hexDigits(call.subarray(16, 36))}` : null;
  const logsNone = transfers.every(({ t }) => t === null);
  if (succeeded && logsNone && signedTo !== null && call.subarray(36).every((x) => x === 0)) {
    moved.push({ asset: `0x${hexDigits(raw.contractAddress)}`, amount: "0", to: signedTo, transaction: id, place: "call" });
  }
  // A failed receipt's transfers are reverted with it: the account it names is the one its signed call names.
  const account = !succeeded
    ? signedTo === null ? "none" : signedTo === payee ? "payee" : "other"
    : moved.length === 0 ? "none" : moved.some((m) => m.to === payee) ? "payee" : "other";
  const payer = addressBytes(ref.payer)!;
  const owner = raw.owner.length === 21 && raw.owner[0] === 0x41 ? BASE58CHECK.encode(raw.owner) : `0x${hexDigits(raw.owner)}`;
  return {
    transaction: id,
    position: info.blockNumber,
    mark,
    result: succeeded ? "succeeded" : "failed",
    consumed,
    carries: true,
    party: sameBytes(raw.owner, payTo) ? "payee" : sameBytes(raw.owner, payer) ? "payer" : "other",
    kind: "same",
    account,
    ...(others.has(id) ? { given: true } : {}),
    moved,
    signer: owner,
    authority: `Permission_id ${raw.permission ?? 0n}`,
    presented: id === normalHash(ref.txid) ? "yes" : "no",
  };
}

/**
 * Recovers the hash from the transaction id alone: the memo of the transaction whose raw bytes hash to the id. A ref
 * whose `txid` is not a 32-byte hash is `tron/wrong-reader`, with nothing read. Raw data longer than the size bound
 * `decodeTronTx` reads is `tron/tx-too-large`, the code that function gives such a transaction. Raw data whose SHA-256
 * is not the id is not the transaction it names, and is `tron/unreadable`, as a failed read is. The input's `tx` is the
 * id, and its `option` the option the payment answers, an object, of which the read needs no member; an input whose
 * `tx` is not a 32-byte hash, or whose option is not an object, is `tron/wrong-reader`, with nothing read. One call.
 */
export async function tronRecover(
  input: RecoverInput<TronNetwork, PaymentRequirements | MppChallenge>,
  reader: TronReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("tron/wrong-reader");
  if (normalHash(input.tx) === null || !isObject(input.option)) return refusal("tron/wrong-reader");
  const txid = input.tx as Hex;
  let tx: { rawDataHex: string } | null;
  try {
    tx = await reader.transaction(txid);
  } catch {
    return refusal("tron/unreadable");
  }
  if (tx === null) return refusal("tron/not-found");
  if (!isObject(tx) || typeof tx.rawDataHex !== "string") return refusal("tron/unreadable");
  if (tx.rawDataHex.length > MAX_TX_HEX) return refusal("tron/tx-too-large");
  const rawBytes = bytesOfHexDigits(tx.rawDataHex);
  if (rawBytes === null) return refusal("tron/unreadable");
  if (!hashEquals(await hash(rawBytes), txid)) return refusal("tron/unreadable");
  const raw = decodeRaw(rawBytes);
  if (isRefusal(raw)) return raw;
  return memoHash(raw.data) ?? refusal("tron/memo-not-lcp");
}

function isInfo(v: unknown): v is TronInfo {
  if (!isObject(v)) return false;
  return typeof v["blockNumber"] === "bigint" && typeof v["result"] === "string" && Array.isArray(v["logs"]);
}

/** Lowercase hex without a `0x` prefix. */
function bare(s: string): string {
  const t = s.toLowerCase();
  return t.startsWith("0x") ? t.slice(2) : t;
}

// ── The pairing.

/** The pairing's filter, with the refusal that names what does not pass. */
const check: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact") return refusal("x402/option-not-this-pairing");
  if (typeof o.network !== "string" || !o.network.startsWith("tron:")) return refusal("x402/option-not-this-pairing");
  const extra: unknown = o.extra;
  if (!isObject(extra) || extra["assetTransferMethod"] !== LCP_TRC20_MEMO) return refusal("x402/option-not-this-pairing");
  const flow = extra["paymentFlow"];
  if (flow !== undefined && flow !== "authorization" && flow !== "upfront") return refusal("x402/option-not-this-pairing");
  const m = NETWORK.exec(o.network);
  if (m === null || !Number.isSafeInteger(Number(m[1]))) return refusal("tron/network-malformed");
  if (addressBytes(o.asset) === null || addressBytes(o.payTo) === null) return refusal("tron/address-malformed");
  const zero = o.amount === "0" && TRON_ZERO_SHOWN.some((c) => c.network === o.network && c.contract === o.asset);
  if (!zero && (!isAmount(o.amount) || decimalBelow(o.amount, UINT256_LIMIT) === undefined)) return refusal("tron/option-malformed");
  const t = o.maxTimeoutSeconds;
  if (!isTimeoutSeconds(t) || t > MAX_TIMEOUT_SECONDS) return refusal("tron/option-malformed");
  return true;
};

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

/**
 * The unsigned transaction for the chosen option, with the hash's LCP string as its memo. H is checked first, then the
 * form of the choice's payer, fee limit, reference block and `now`, then its document and option, then the expiration
 * `now` and the option's timeout give.
 */
async function build(c: TronChoice, h: AtrHash): Promise<TronUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/option-malformed");
  const { required, accepted, payer, refBlock, now, feeLimit } = c;
  const owner = await tronAddress(payer);
  if (isRefusal(owner)) return owner;
  if (typeof feeLimit !== "bigint" || feeLimit < 1n || feeLimit > MAX_FEE_LIMIT) return refusal("tron/fee-limit");
  if (!isObject(refBlock) || typeof refBlock.number !== "bigint" || refBlock.number < 0n || refBlock.number >= INT64_LIMIT) {
    return refusal("tron/tx-malformed");
  }
  if (typeof refBlock.id !== "string" || !BLOCK_ID.test(refBlock.id)) return refusal("tron/tx-malformed");
  if (typeof now !== "bigint" || now < 1n) return refusal("tron/tx-malformed");
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  const asset = await tronAddress(accepted.asset);
  if (isRefusal(asset)) return asset;
  const payTo = await tronAddress(accepted.payTo);
  if (isRefusal(payTo)) return payTo;
  const expiration = now + BigInt(accepted.maxTimeoutSeconds) * 1000n;
  if (expiration >= INT64_LIMIT) return refusal("tron/tx-malformed");

  const number = new Uint8Array(8);
  let n = refBlock.number;
  for (let i = 7; i >= 0; i--) {
    number[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  const callData = new Uint8Array(CALL_DATA_BYTES);
  callData.set(bytesOfHexDigits(TRANSFER_SELECTOR)!, 0);
  callData.set(payTo.subarray(1), 16);
  let amount = BigInt(accepted.amount);
  for (let i = CALL_DATA_BYTES - 1; i >= 36; i--) {
    callData[i] = Number(amount & 0xffn);
    amount >>= 8n;
  }
  const raw: TronRaw = {
    refBlockBytes: number.subarray(6, 8),
    refBlockHash: bytesOfHexDigits(refBlock.id.slice(2))!.subarray(8, 16),
    expiration,
    data: utf8.encode(toLcpString(nh)),
    owner,
    contractAddress: asset,
    callData,
    timestamp: now,
    feeLimit,
  };
  const rawBytes = encodeTronRaw(raw);
  const txid = bytesOfHexDigits((await hash(rawBytes)).slice(2))!;
  return {
    request: { kind: "tron-txid", txid, rawBytes: Uint8Array.from(rawBytes) },
    complete(signature: Uint8Array): TronPayment | Refusal {
      if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_BYTES) {
        return refusal("tron/signature-malformed");
      }
      const v = signature[64]!;
      if (v !== 0 && v !== 1 && v !== 27 && v !== 28) return refusal("tron/signature-malformed");
      const transaction = hexDigits(encodeTransaction(rawBytes, [new Uint8Array(signature)]));
      return paymentWith(required, accepted, { transaction });
    },
  };
}

/** The decoded, canonical transaction of a payment this pairing accepts, and its carrier. */
async function carried(
  presented: unknown,
): Promise<{ accepted: PaymentRequirements; raw: TronRaw; rawBytes: Uint8Array; h: AtrHash; txid: Hex } | Refusal> {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const transaction = p.payload["transaction"];
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  const tx = decodeTronTx(transaction);
  if (isRefusal(tx)) return tx;
  const c = await tronCarrier(tx);
  if (isRefusal(c)) return c;
  return { accepted: p.accepted, raw: tx.raw, rawBytes: tx.rawBytes, h: c.h, txid: c.txid };
}

/**
 * The hash in the memo of the transaction the payer signed. The signature is not verified here; the facilitator
 * verifies it under the profile, and the node verifies it before execution.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const c = await carried(presented);
  return isRefusal(c) ? c : c.h;
}

/**
 * The read keys, computed from the signed bytes: the `raw_data` the owner signed, which is the payment presented, its
 * id, its owner, the token contract and the expiration; and the payee, the `payTo` of the option the payment answers. A
 * presented `accepted` that is not `option` is `x402/accepted-not-option`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<TronRef | Refusal> {
  const c = await carried(presented);
  if (isRefusal(c)) return c;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameJson(c.accepted, option)) return refusal("x402/accepted-not-option");
  return {
    network: c.accepted.network as TronNetwork,
    payee,
    payer: BASE58CHECK.encode(c.raw.owner),
    txid: c.txid,
    raw: hexDigits(c.rawBytes),
    asset: `0x${hexDigits(c.raw.contractAddress)}`,
    expiration: c.raw.expiration.toString(),
  };
}

/**
 * The option unchanged: on this pairing the hash rides in the transaction, not in the option. An option that carries a
 * `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/tron/lcp-trc20-memo`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator
 * broadcasts the TRC-20 transfer the payer signed; `status` reads it by transaction id.
 */
export const exactTronMemo = Object.freeze({
  id: ID,
  data: TRON[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: tronStatus,
  recover: tronRecover,
}) satisfies Entry<
  typeof ID,
  TronPayment,
  TronRef,
  TronReader,
  X402Forms & {
    choice: TronChoice;
    unsigned: TronUnsigned;
    landed: unknown;
    network: TronNetwork;
    query: TronQuery;
    answer: TronStatus;
  }
>;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

