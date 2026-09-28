/**
 * Tron: the transaction pieces (protobuf for the fields the profile uses, base58check addresses, the transaction id)
 * and the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its
 * memo, `raw_data.data`, in LCP string form. Settlement is read by transaction id through a bounded reader.
 */
import { base58 } from "@scure/base";
import { fromLcpString, hash, hashEquals, toLcpString, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { bytesOfHexDigits, decimalBelow, hexDigits } from "./rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  paymentWith,
  presentedWith,
  readFor,
  tie,
  type LcpPattern,
  type OptionFilter,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
  type X402Payment,
} from "./x402.js";

/** CAIP-2 with the decimal chain id: tron:728126428 mainnet, tron:3448148188 Nile, tron:2494104990 Shasta. */
export type TronNetwork = `tron:${number}`;
export const LCP_TRC20_MEMO = "lcp-trc20-memo";
export const TRIGGER_SMART_CONTRACT = 31;
export const TRIGGER_URL = "type.googleapis.com/protocol.TriggerSmartContract";
/** transfer(address,uint256) */
export const TRANSFER_SELECTOR = "a9059cbb";
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The `Transaction.raw` fields this profile uses. */
export interface TronRaw {
  refBlockBytes: Uint8Array;
  refBlockHash: Uint8Array;
  expiration: bigint;
  data: Uint8Array;
  owner: Uint8Array;
  contractAddress: Uint8Array;
  callData: Uint8Array;
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

/** Bounded, read-only calls against one network's FullNode and SolidityNode. Every failure rejects with `ReaderError`. */
export interface TronReader {
  readonly network: TronNetwork;
  /** `/walletsolidity/gettransactioninfobyid` ("solid") or `/wallet/gettransactioninfobyid` ("head"); null: none. */
  info(txid: Hex, level: "solid" | "head"): Promise<TronInfo | null>;
  /** `/walletsolidity/gettransactionbyid`; null: none. */
  transaction(txid: Hex): Promise<{ rawDataHex: string } | null>;
  /** `/walletsolidity/getnowblock`: the latest solidified block's number and time in milliseconds. */
  solidHead(): Promise<{ number: bigint; timestamp: bigint }>;
}

/** The read keys recorded at claim, JSON-serialisable. `asset` is the contract's 21-byte address; `expiration` is decimal milliseconds. */
export interface TronRef {
  network: TronNetwork;
  txid: Hex;
  asset: Hex;
  expiration: string;
}

export type TronStatus =
  | { state: "settled"; finality: "solidified" | "head"; blockNumber: bigint }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "contract-failed" | "no-transfer" | "expired"; result?: string };

export type TronPayment = X402Payment<{ transaction: string }>;

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
  /** The 32-byte transaction id the payer signs. */
  request: { kind: "tron-txid"; txid: Uint8Array };
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
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

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
  for (const x of b) out.push(x);
}

function pushInt(out: number[], no: number, v: bigint): void {
  if (v === 0n) return;
  pushVarint(out, BigInt(no << 3));
  pushVarint(out, v);
}

function message(build: (out: number[]) => void): Uint8Array {
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

/** `Transaction.raw` as java-tron serialises it: fields in ascending order, default values omitted. */
export function encodeTronRaw(r: TronRaw): Uint8Array {
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
export function decodeTronTx(hex: string): { raw: TronRaw; rawBytes: Uint8Array; signatures: Uint8Array[] } | Refusal {
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

function decodeRaw(rawBytes: Uint8Array): TronRaw | Refusal {
  const fields = fieldsOf(rawBytes);
  if (fields === null) return refusal("tron/tx-malformed");
  const raw: TronRaw = {
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
export async function tronAddress(address: string): Promise<Uint8Array | Refusal> {
  const b = base58Shape(address);
  if (b === null) return refusal("tron/address-malformed");
  const payload = b.subarray(0, 21);
  const once = await hash(payload);
  const twice = bytesOfHexDigits((await hash(bytesOfHexDigits(once.slice(2))!)).slice(2))!;
  for (let i = 0; i < 4; i++) if (twice[i] !== b[21 + i]) return refusal("tron/address-malformed");
  return Uint8Array.from(payload);
}

/** The 25 decoded bytes of a base58 string of 34 characters whose first byte is 0x41, or null. */
function base58Shape(address: unknown): Uint8Array | null {
  if (typeof address !== "string" || address.length !== BASE58_ADDRESS_CHARS) return null;
  let b: Uint8Array;
  try {
    b = base58.decode(address);
  } catch {
    return null;
  }
  return b.length === 25 && b[0] === 0x41 ? b : null;
}

// ── The carrier.

/** The hash in the memo of a transaction whose one contract calls `transfer`, and the transaction id. */
export async function tronCarrier(tx: { raw: TronRaw; rawBytes: Uint8Array }): Promise<{ h: AtrHash; txid: Hex } | Refusal> {
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
 * Reads the latest solidified block first, then the transaction by id: at the Solidity node, then at the FullNode's
 * head. Settled when its receipt result is `SUCCESS` and it holds a `Transfer` log from `ref.asset`. Failed as
 * `expired` only when that earlier solidified block is two slots past the expiration and neither lookup finds the
 * transaction. A failed read, or a reader for another network, is pending. At most three calls.
 */
export async function tronStatus(ref: TronRef, reader: TronReader): Promise<TronStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  const head = await solidTimestamp(reader);
  for (const level of ["solid", "head"] as const) {
    let info: TronInfo | null;
    try {
      info = await reader.info(ref.txid, level);
    } catch {
      return { state: "pending", why: "unreadable" };
    }
    if (info === null) continue;
    if (!isInfo(info)) return { state: "pending", why: "unreadable" };
    if (info.result !== "SUCCESS") return { state: "failed", why: "contract-failed", result: info.result };
    if (!info.logs.some((log) => isAssetTransfer(log, ref.asset))) return { state: "failed", why: "no-transfer" };
    return { state: "settled", finality: level === "solid" ? "solidified" : "head", blockNumber: info.blockNumber };
  }
  const expiration = typeof ref.expiration === "string" && /^[0-9]{1,19}$/.test(ref.expiration) ? BigInt(ref.expiration) : null;
  if (head === null || expiration === null) return { state: "pending", why: "unreadable" };
  if (head >= expiration + EXPIRY_SLOTS_MS) return { state: "failed", why: "expired" };
  return { state: "pending", why: "not-found" };
}

/** The latest solidified block's timestamp in milliseconds, or null when the read fails or its answer is malformed. */
async function solidTimestamp(reader: TronReader): Promise<bigint | null> {
  let head: unknown;
  try {
    head = await reader.solidHead();
  } catch {
    return null;
  }
  return isObject(head) && typeof head["timestamp"] === "bigint" ? head["timestamp"] : null;
}

/** Recovers the hash from the transaction id alone: the memo of the transaction whose raw bytes hash to the id. One call. */
export async function tronRecover(ref: { network: TronNetwork; txid: Hex }, reader: TronReader): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("tron/wrong-reader");
  let tx: { rawDataHex: string } | null;
  try {
    tx = await reader.transaction(ref.txid);
  } catch {
    return refusal("tron/unreadable");
  }
  if (tx === null) return refusal("tron/not-found");
  if (!isObject(tx) || typeof tx.rawDataHex !== "string" || tx.rawDataHex.length > MAX_TX_HEX) {
    return refusal("tron/unreadable");
  }
  const rawBytes = bytesOfHexDigits(tx.rawDataHex);
  if (rawBytes === null) return refusal("tron/unreadable");
  if (!hashEquals(await hash(rawBytes), ref.txid)) return refusal("tron/tx-malformed");
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
  if (base58Shape(o.asset) === null || base58Shape(o.payTo) === null) return refusal("tron/address-malformed");
  if (decimalBelow(o.amount, UINT256_LIMIT) === undefined) return refusal("tron/option-malformed");
  const t = o.maxTimeoutSeconds;
  if (!Number.isSafeInteger(t) || t < 1 || t > MAX_TIMEOUT_SECONDS) return refusal("tron/option-malformed");
  return true;
};

/** This pairing's id for an option it can pay, or undefined. */
export function pairingOf(option: PaymentRequirements): typeof ID | undefined {
  return check(option) === true ? ID : undefined;
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

/** The unsigned transaction for the chosen option, with the hash's LCP string as its memo. */
async function build(c: TronChoice, h: AtrHash): Promise<TronUnsigned | Refusal> {
  if (!isObject(c)) return refusal("x402/option-malformed");
  const { required, accepted, payer, refBlock, now, feeLimit } = c;
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  const owner = await tronAddress(payer);
  if (isRefusal(owner)) return owner;
  const asset = await tronAddress(accepted.asset);
  if (isRefusal(asset)) return asset;
  const payTo = await tronAddress(accepted.payTo);
  if (isRefusal(payTo)) return payTo;
  if (typeof feeLimit !== "bigint" || feeLimit < 1n || feeLimit > MAX_FEE_LIMIT) return refusal("tron/fee-limit");
  if (!isObject(refBlock) || typeof refBlock.number !== "bigint" || refBlock.number < 0n || refBlock.number >= INT64_LIMIT) {
    return refusal("tron/tx-malformed");
  }
  if (typeof refBlock.id !== "string" || !BLOCK_ID.test(refBlock.id)) return refusal("tron/tx-malformed");
  if (typeof now !== "bigint" || now < 1n) return refusal("tron/tx-malformed");
  const expiration = now + BigInt(accepted.maxTimeoutSeconds) * 1000n;
  if (expiration >= INT64_LIMIT) return refusal("tron/tx-malformed");
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");

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
      const transaction = hexDigits(encodeTransaction(rawBytes, [Uint8Array.from(signature)]));
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

/** The read keys, computed from the signed bytes: the transaction id, the token contract and the expiration. */
async function reference(presented: unknown): Promise<TronRef | Refusal> {
  const c = await carried(presented);
  if (isRefusal(c)) return c;
  return {
    network: c.accepted.network as TronNetwork,
    txid: c.txid,
    asset: `0x${hexDigits(c.raw.contractAddress)}`,
    expiration: c.raw.expiration.toString(),
  };
}

/** The option unchanged: on this pairing the hash rides in the transaction, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
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
    "The payer signed a Tron transaction whose memo is this ATR's hash in LCP string form, and whose one contract " +
    "calls transfer on the token. The network verified the signature, which covers the memo through the transaction " +
    "id. The call succeeded with the token's Transfer event, at the finality recorded. The memo is on chain in the " +
    "transaction. This does not show that amount, payee, token or timing match the ATR's content.",
});

const TX_HEX = /^(?:0x)?[0-9a-fA-F]{64}$/;

/**
 * A Tron transaction id in one spelling: lowercase hex without `0x`, the SHA-256 of `raw_data` as the node's `txID`
 * gives it, whether it is given with or without `0x` and in either case. Any other string is returned unchanged.
 */
export function tronTxId(tx: string): string {
  return typeof tx === "string" && TX_HEX.test(tx) ? tx.replace(/^0x/, "").toLowerCase() : tx;
}

export const exactTronMemo = Object.freeze({
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
  status: tronStatus,
  recover: tronRecover,
  txId: tronTxId,
});

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

