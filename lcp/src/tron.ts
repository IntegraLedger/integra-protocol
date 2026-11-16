/**
 * Tron: the transaction pieces (protobuf for the fields the profile uses, base58check addresses, the transaction id)
 * and the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its
 * memo, `raw_data.data`, in LCP string form. Settlement is read by transaction id through a bounded reader.
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
import { TRON } from "./internal/data/tron.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import { decide, type Facts, type RecoverInput, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import { actSeen, bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

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
  /** `address` is 20-byte hex as the node returns it. */
  logs: readonly { address: string; topics: readonly string[] }[];
}

/**
 * Bounded, read-only calls against one network's FullNode: its `/walletsolidity` API for solidified data and its
 * `/wallet` API at the head. Every failure rejects, for example with `ReaderError` from `@integraledger/lcp/evm`; any
 * rejection reads as unreadable.
 */
export interface TronReader {
  readonly network: TronNetwork;
  /**
   * `/walletsolidity/gettransactioninfobyid` ("solid") or `/wallet/gettransactioninfobyid` ("head"). When the node does
   * not know the transaction, `notFound` with `timestamp`: the time in milliseconds of the latest block at that level
   * on the node that answered (`/walletsolidity/getnowblock` or `/wallet/getnowblock`), read from that same node before
   * the lookup, or null when the reader cannot read it from that node. A lookup naming no time never reads failed.
   */
  info(txid: Hex, level: "solid" | "head"): Promise<TronInfo | { notFound: true; timestamp: bigint | null }>;
  /** `/walletsolidity/gettransactionbyid`; null: none. */
  transaction(txid: Hex): Promise<{ rawDataHex: string } | null>;
  /** `/walletsolidity/getnowblock`: the latest solidified block's number and time in milliseconds. */
  solidHead(): Promise<{ number: bigint; timestamp: bigint }>;
}

/**
 * The read keys `reference` returns, JSON-serialisable. `asset` is the contract's 21-byte address; `expiration` is
 * decimal milliseconds; `payee` is the `payTo` of the option the payment answers.
 */
export interface TronRef {
  network: TronNetwork;
  payee: string;
  txid: Hex;
  asset: Hex;
  expiration: string;
}

/**
 * The answer of `tronStatus`, as the profile `read-status` gives it. Its marks are `head` and `solidified`, in that
 * order, and its position the block number.
 */
export type TronStatus = StatusAnswer<bigint, TronMark>;

type TronMark = "head" | "solidified";
const MARKS: readonly TronMark[] = ["head", "solidified"];

/** What the read of the transaction by id found, with the mark of the lookup that found it. */
type TronRead =
  | { state: "settled"; finality: TronMark; blockNumber: bigint }
  | { state: "pending"; why: "not-found" }
  | { state: "failed"; why: "contract-failed" | "no-transfer"; finality: TronMark; blockNumber: bigint }
  | { state: "failed"; why: "expired" }
  | { state: "unreadable"; reason: UnreadableReason };

interface TronChoice {
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
  /** The 32-byte transaction id the payer signs. */
  request: { kind: "tron-txid"; txid: Uint8Array<ArrayBuffer> };
  /** Takes the 65-byte secp256k1 signature `r ‖ s ‖ v`, v in {0, 1, 27, 28}. */
  complete(signature: Uint8Array): TronPayment | Refusal;
}

const ID = "x402/exact/tron/lcp-trc20-memo" as const;
const MAX_TX_HEX = 8192;
const MAX_SIGNATURES = 5;
const SIGNATURE_BYTES = 65;
const CALL_DATA_BYTES = 68;
const MAX_TIMEOUT_SECONDS = 86_340;
const MAX_FEE_LIMIT = 15_000_000_000n;
const INT64_LIMIT = 1n << 63n;
const UINT256_LIMIT = 1n << 256n;
const EXPIRY_SLOTS_MS = 6000n;
const NETWORK = /^tron:(0|[1-9][0-9]{0,15})$/;
const LOWER_HEX = /^(?:[0-9a-f]{2})*$/;
const BLOCK_ID = /^0x[0-9a-fA-F]{64}$/;
const BASE58_ADDRESS_CHARS = 34;

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
 * Answers the read of the transaction by id as the profile `read-status` gives it. The id is the single-use value: Tron
 * derives it from the signed raw data alone, so a transaction with it that was included, succeeded or not, consumed it.
 * The read takes the latest solidified block first, then the transaction by id: through the FullNode's
 * `/walletsolidity` API for solidified data, at the mark `solidified`, then its `/wallet` API at the head, at the mark
 * `head`, and at its block number. A transaction whose receipt result is `SUCCESS` and that holds a `Transfer` log from
 * `ref.asset` is the payer's act; one whose result is not `SUCCESS` is the act included with a failed result; one that
 * holds no such log carries no act of the payer's. The id's validity has passed once that earlier solidified block is
 * two slots past the expiration and neither lookup finds the transaction, each naming a block time at or past that
 * earlier block's; a lookup whose node lags the block read first, or that names no time, names no included act. The
 * read holds no search for H, so none of these answers `failed`. A read that rejects is unreadable `transport`; an
 * answer of neither documented shape, or a ref whose expiration is not decimal milliseconds where the read needs it,
 * `unparseable`; and a reader for another network than the ref's `chain-mismatch`. A ref, a reader or a query that is
 * not one, a reader that names no network, or a ref whose `txid` is not `0x` and 64 hex digits, or whose `asset` is
 * not the token's 21-byte address in hex (`41` and 20 bytes, `0x` optional), is unreadable `unparseable`, with nothing
 * read; the reader is given the txid in lowercase, and the answer names it so. At most three calls.
 */
export async function tronStatus(ref: TronRef, reader: TronReader, query: StatusQuery<TronRef, bigint, TronMark>): Promise<TronStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint")) return UNPARSEABLE;
  return decide(factsOf(await readTron(ref, reader), ref), query, LEDGER);
}

const LEDGER = ledgerOf<bigint, TronMark>(TRON[ID].coverage, MARKS, bigintOrder);

async function readTron(ref: TronRef, reader: TronReader): Promise<TronRead> {
  const unparseable = { state: "unreadable", reason: "unparseable" } as const;
  if (!isObject(ref) || !isObject(reader) || typeof reader.network !== "string") return unparseable;
  const txid = normalHash(ref.txid);
  const asset: unknown = ref.asset;
  if (typeof ref.network !== "string" || txid === null || typeof asset !== "string" || !/^41[0-9a-f]{40}$/.test(bare(asset))) {
    return unparseable;
  }
  if (reader.network !== ref.network) return { state: "unreadable", reason: "chain-mismatch" };
  const head = await solidTimestamp(reader);
  let covered = true;
  for (const level of ["solid", "head"] as const) {
    let info: unknown;
    try {
      info = await reader.info(txid, level);
    } catch {
      return { state: "unreadable", reason: "transport" };
    }
    const readTo = notFoundPoint(info, "timestamp");
    if (readTo !== undefined) {
      covered &&= readTo !== null && typeof head === "bigint" && readTo >= head;
      continue;
    }
    if (!isInfo(info)) return unparseable;
    const at = { finality: level === "solid" ? "solidified" : "head", blockNumber: info.blockNumber } as const;
    if (info.result !== "SUCCESS") return { state: "failed", why: "contract-failed", ...at };
    if (!info.logs.some((log) => isAssetTransfer(log, ref.asset))) return { state: "failed", why: "no-transfer", ...at };
    return { state: "settled", ...at };
  }
  const expiration = typeof ref.expiration === "string" && /^[0-9]{1,19}$/.test(ref.expiration) ? BigInt(ref.expiration) : null;
  if (typeof head === "string") return { state: "unreadable", reason: head };
  if (expiration === null) return unparseable;
  if (head >= expiration + EXPIRY_SLOTS_MS && covered) return { state: "failed", why: "expired" };
  return { state: "pending", why: "not-found" };
}

/**
 * The read's facts: the act at its mark and block where it succeeded, or included with a failed result, which
 * consumed the id, read so where the solidified lookup found it; the id read unconsumed with its validity passed where
 * it expired; and nothing for a transaction that carries no transfer, nor for one not found. The lookup by id is never
 * a search read whole.
 */
function factsOf(read: TronRead, ref: TronRef): Facts<bigint, TronMark> {
  const none = { seen: [], search: { whole: false }, history: false } as const;
  const txid = (): Hex => normalHash(ref.txid) as Hex;
  switch (read.state) {
    case "unreadable":
      return { ...none, unreadable: read.reason };
    case "pending":
      return none;
    case "settled":
      return { ...none, seen: [actSeen(txid(), read.finality, read.blockNumber)] };
    case "failed":
      if (read.why === "expired") return { ...none, value: { consumed: false, lapsed: true, mark: "solidified" } };
      if (read.why === "no-transfer") return none;
      return {
        ...none,
        seen: [actSeen(txid(), read.finality, read.blockNumber, "failed")],
        ...(read.finality === "solidified" ? { value: { consumed: true, lapsed: false, mark: "solidified" } } : {}),
      };
  }
}

/**
 * The latest solidified block's timestamp in milliseconds; `transport` when the read fails, and `unparseable` when its
 * answer is malformed.
 */
async function solidTimestamp(reader: TronReader): Promise<bigint | "transport" | "unparseable"> {
  let head: unknown;
  try {
    head = await reader.solidHead();
  } catch {
    return "transport";
  }
  return isObject(head) && typeof head["timestamp"] === "bigint" ? head["timestamp"] : "unparseable";
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

/** True for a log emitted by `asset` whose first topic is `Transfer`. */
function isAssetTransfer(log: unknown, asset: Hex): boolean {
  if (!isObject(log) || typeof log["address"] !== "string" || !Array.isArray(log["topics"])) return false;
  const emitter = bare(log["address"]);
  const token = bare(asset);
  if (token.length !== 42 || !token.startsWith("41")) return false;
  const address = emitter.length === 42 && emitter.startsWith("41") ? emitter.slice(2) : emitter;
  if (address !== token.slice(2)) return false;
  const first: unknown = log["topics"][0];
  return typeof first === "string" && bare(first) === TRANSFER_TOPIC;
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
  if (!isAmount(o.amount) || decimalBelow(o.amount, UINT256_LIMIT) === undefined) return refusal("tron/option-malformed");
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
    request: { kind: "tron-txid", txid },
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
): Promise<{ accepted: PaymentRequirements; raw: TronRaw; h: AtrHash; txid: Hex } | Refusal> {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const transaction = p.payload["transaction"];
  if (typeof transaction !== "string") return refusal("x402/payload-malformed");
  const tx = decodeTronTx(transaction);
  if (isRefusal(tx)) return tx;
  const c = await tronCarrier(tx);
  if (isRefusal(c)) return c;
  return { accepted: p.accepted, raw: tx.raw, h: c.h, txid: c.txid };
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
 * The read keys, computed from the signed bytes: the transaction id, the token contract and the expiration; and the
 * payee, the `payTo` of the option the payment answers.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<TronRef | Refusal> {
  const c = await carried(presented);
  if (isRefusal(c)) return c;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  return {
    network: c.accepted.network as TronNetwork,
    payee,
    txid: c.txid,
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
    query: StatusQuery<TronRef, bigint, TronMark>;
    answer: TronStatus;
  }
>;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

