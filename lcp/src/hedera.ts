/**
 * Hedera: the transaction wire form read and written by hand (protobuf, five messages), the Mirror Node settlement
 * read, and the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and
 * `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only); and MPP's `mpp/charge/hedera`, whose
 * signed memo is MPP's attribution memo, its nonce keccak256 of the challenge id that carries the hash.
 */
import { fromLcpString, fromLegalContext, hash, parseJson, toLcpString, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  attributionMemo,
  challengeBound,
  checkAttribution,
  credentialOf,
  place,
  read as readMpp,
  tie as tieMpp,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
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

export type HederaNetwork = "hedera:mainnet" | "hedera:testnet" | "hedera:previewnet" | "hedera:devnet";
export const HEDERA_NETWORKS: readonly HederaNetwork[] = Object.freeze([
  "hedera:mainnet",
  "hedera:testnet",
  "hedera:previewnet",
  "hedera:devnet",
]);

/** MPP's EIP-155 chain ids for Hedera, mapped to their CAIP-2 networks. */
export const HEDERA_CHAIN_IDS: Readonly<Record<number, HederaNetwork>> = Object.freeze({
  295: "hedera:mainnet",
  296: "hedera:testnet",
});

/** The CAIP-2 network of an MPP `methodDetails.chainId`: 295 and 296 only. */
export function hederaNetworkOfChainId(chainId: unknown): HederaNetwork | Refusal {
  if (typeof chainId !== "number" || !Object.hasOwn(HEDERA_CHAIN_IDS, chainId)) return refusal("hedera/chain-id-unnamed");
  return HEDERA_CHAIN_IDS[chainId]!;
}

export interface HederaTxId {
  /** "shard.realm.num" */
  account: string;
  seconds: bigint;
  nanos: number;
}

/** "0.0.1235@1700000000.000000000" */
export function txIdText(id: HederaTxId): string {
  return `${id.account}@${id.seconds}.${String(id.nanos).padStart(9, "0")}`;
}

/** "0.0.1235-1700000000-000000000", the Mirror Node's form. */
export function txIdMirror(id: HederaTxId): string {
  return `${id.account}-${id.seconds}-${String(id.nanos).padStart(9, "0")}`;
}

export interface HederaBody {
  id: HederaTxId;
  /** `transactionValidDuration`, in seconds. */
  validDuration: number;
  memo: string;
  bodyBytes: Uint8Array;
}

/** The Mirror Node's `Transaction` entry: the fields read here. */
export interface MirrorEntry {
  result: string;
  memo_base64: string | null;
  nonce: number;
  scheduled: boolean;
  consensus_timestamp: string;
  transfers?: readonly { account: string; amount: number }[];
  token_transfers?: readonly { token_id: string; account: string; amount: number }[];
  /**
   * HIP-406 staking rewards paid by this transaction, in tinybars. `transfers` already holds each account's total
   * change, so a reward is in the rewarded account's credit there, and the staking reward account `0.0.800` pays it.
   */
  staking_reward_transfers?: readonly { account: string; amount: number }[];
}

/** Bounded, read-only calls against one network's Mirror Node. Every failure rejects. */
export interface HederaReader {
  readonly network: HederaNetwork;
  /** `GET /api/v1/transactions/{id}`; null on 404. */
  transactions(mirrorId: string): Promise<readonly MirrorEntry[] | null>;
}

/** The read keys recorded at claim, taken from the signed body. */
export interface HederaRef {
  network: HederaNetwork;
  /** Mirror form. */
  transactionId: string;
  expectMemo: string;
  /** Unix seconds: valid start plus the valid duration. */
  validUntil: number;
}

export type HederaStatus =
  | { state: "settled"; consensus: string }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "not-this-instrument" | `result:${string}` };

/** The body the payer signs, and how its signature completes the wire transaction. */
export interface HederaUnsigned {
  /** `broadcast: true` when the payer's signer signs and broadcasts the body itself (a push). */
  request: { kind: "hedera-body"; bodyBytes: Uint8Array; broadcast?: true };
  /** The signed `Transaction`, base64. */
  complete(s: { publicKey: Uint8Array; signature: Uint8Array; type: "ed25519" | "ecdsa-secp256k1" }): string | Refusal;
}

/** The x402 `exact` payload on Hedera: the partially signed transaction, base64. */
export type HederaPayload = { transaction: string };
export type HederaPaymentPayload = X402Payment<HederaPayload>;

/** The x402 `transferExecutor` payload. */
export type ExecutorPayload = { payer: string; executor: string; authorization: Hex };
export type ExecutorPaymentPayload = X402Payment<ExecutorPayload>;

export interface ExecutorRef {
  network: HederaNetwork;
  asset: string;
  idDigest: Hex;
  /** Unix seconds: claim time plus `maxTimeoutSeconds`. */
  settleBy: number;
  /** The facilitator's `SettlementResponse.transaction`, mirror form. */
  transaction?: string;
}

const EXACT = "x402/exact/hedera" as const;
const EXECUTOR = "x402/exact/hedera/transfer-executor" as const;
const MAX_TX = 8192;
const MAX_LIST = 16;
const MAX_DEPTH = 8;
const MAX_MEMO = 100;
const VALID_DURATION = 120;
const MAX_EXECUTORS = 16;
const MAX_AUTHORIZATION_HEX = 8192;
const MAX_ENTRIES = 64;
const MAX_ROWS = 256;
/**
 * Results that do not use up the transaction id: a rejected duplicate, and the node due-diligence failures after
 * which a valid transaction with the same id still reaches consensus (hiero `RecordCache.NODE_FAILURES`).
 */
const NOT_COUNTED: ReadonlySet<string> = new Set([
  "DUPLICATE_TRANSACTION",
  "INVALID_NODE_ACCOUNT",
  "INVALID_PAYER_SIGNATURE",
]);
/** The account that pays HIP-406 staking rewards. */
const STAKING_REWARD_ACCOUNT = "0.0.800";
const SUCCESS = "SUCCESS";
const ENTITY = /^(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})$/;
const MIRROR_ID = /^((?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18}))-(\d{1,19})-(\d{1,9})$/;
const DECIMAL = /^(0|[1-9][0-9]{0,18})$/;
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const INT64_LIMIT = 1n << 63n;
const UINT64_LIMIT = 1n << 64n;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ENCODER = new TextEncoder();

// ── protobuf, read ───────────────────────────────────────────────────────────────────────────────────────────────────

type Field = { n: number; wt: 0 | 1 | 2 | 5; varint: bigint; bytes: Uint8Array };

/** Every field of one message, in wire order; null when the bytes are not a well-formed message. */
function fieldsOf(buf: Uint8Array): Field[] | null {
  const out: Field[] = [];
  let i = 0;
  while (i < buf.length) {
    const key = varintAt(buf, i);
    if (key === null) return null;
    i = key.next;
    const n = Number(key.value >> 3n);
    const wt = Number(key.value & 7n);
    if (n < 1 || n > 536_870_911) return null;
    if (wt === 0) {
      const v = varintAt(buf, i);
      if (v === null) return null;
      out.push({ n, wt, varint: v.value, bytes: new Uint8Array(0) });
      i = v.next;
    } else if (wt === 1 || wt === 5) {
      const size = wt === 1 ? 8 : 4;
      if (i + size > buf.length) return null;
      out.push({ n, wt, varint: 0n, bytes: buf.subarray(i, i + size) });
      i += size;
    } else if (wt === 2) {
      const len = varintAt(buf, i);
      if (len === null || len.value > BigInt(buf.length - len.next)) return null;
      const end = len.next + Number(len.value);
      out.push({ n, wt, varint: 0n, bytes: buf.subarray(len.next, end) });
      i = end;
    } else {
      return null;
    }
  }
  return out;
}

function varintAt(buf: Uint8Array, at: number): { value: bigint; next: number } | null {
  let value = 0n;
  for (let k = 0; k < 10; k++) {
    const b = buf[at + k];
    if (b === undefined) return null;
    value |= BigInt(b & 0x7f) << BigInt(7 * k);
    if ((b & 0x80) === 0) return value < UINT64_LIMIT ? { value, next: at + k + 1 } : null;
  }
  return null;
}

/** The one field numbered `n`, which must have wire type `wt`; undefined when absent, null when repeated or mistyped. */
function single(fields: readonly Field[], n: number, wt: Field["wt"]): Field | undefined | null {
  let found: Field | undefined;
  for (const f of fields) {
    if (f.n !== n) continue;
    if (f.wt !== wt || found !== undefined) return null;
    found = f;
  }
  return found;
}

function int64Of(v: bigint): bigint {
  return v >= INT64_LIMIT ? v - UINT64_LIMIT : v;
}

/**
 * Reads a wire `Transaction`, or the SDK's `TransactionList` of them (a top-level field 1): each body's transaction
 * id, valid duration, memo and exact bytes. Every body of a list must share id and memo.
 */
export function decodeHederaTx(wire: Uint8Array): { bodies: readonly HederaBody[] } | Refusal {
  if (!(wire instanceof Uint8Array)) return refusal("hedera/tx-malformed");
  if (wire.length > MAX_TX) return refusal("hedera/tx-too-large");
  const top = fieldsOf(wire);
  if (top === null || top.length === 0) return refusal("hedera/tx-malformed");
  if (!top.some((f) => f.n === 1)) {
    const body = transactionOf(top, 1);
    return isRefusal(body) ? body : { bodies: [body] };
  }
  if (top.some((f) => f.n !== 1 || f.wt !== 2)) return refusal("hedera/tx-malformed");
  if (top.length > MAX_LIST) return refusal("hedera/tx-malformed");
  const bodies: HederaBody[] = [];
  for (const entry of top) {
    const fields = fieldsOf(entry.bytes);
    if (fields === null) return refusal("hedera/tx-malformed");
    const body = transactionOf(fields, 2);
    if (isRefusal(body)) return body;
    bodies.push(body);
  }
  const first = bodies[0]!;
  const same = bodies.every((b) => txIdText(b.id) === txIdText(first.id) && b.memo === first.memo);
  return same ? { bodies } : refusal("hedera/list-inconsistent");
}

/** `Transaction` → `SignedTransaction` → `TransactionBody`. */
function transactionOf(tx: readonly Field[], depth: number): HederaBody | Refusal {
  if (depth > MAX_DEPTH) return refusal("hedera/tx-malformed");
  if (tx.some((f) => f.n >= 1 && f.n <= 4)) return refusal("hedera/deprecated-fields");
  const signed = single(tx, 5, 2);
  if (!signed) return refusal("hedera/tx-malformed");
  const signedFields = fieldsOf(signed.bytes);
  if (signedFields === null) return refusal("hedera/tx-malformed");
  const bodyField = single(signedFields, 1, 2);
  if (!bodyField) return refusal("hedera/tx-malformed");
  const body = bodyOf(bodyField.bytes, depth + 2);
  return body === null ? refusal("hedera/tx-malformed") : body;
}

/** `TransactionBody`: `transactionID` (1), `transactionValidDuration` (4), `memo` (6). */
function bodyOf(bodyBytes: Uint8Array, depth: number): HederaBody | null {
  if (depth + 3 > MAX_DEPTH) return null;
  const fields = fieldsOf(bodyBytes);
  if (fields === null) return null;
  const idField = single(fields, 1, 2);
  const durationField = single(fields, 4, 2);
  const memoField = single(fields, 6, 2);
  if (!idField || durationField === null || memoField === null) return null;

  const idFields = fieldsOf(idField.bytes);
  if (idFields === null) return null;
  const startField = single(idFields, 1, 2);
  const accountField = single(idFields, 2, 2);
  if (!startField || !accountField) return null;
  const start = fieldsOf(startField.bytes);
  const account = accountOf(accountField.bytes);
  if (start === null || account === null) return null;
  const seconds = single(start, 1, 0);
  const nanos = single(start, 2, 0);
  if (seconds === null || nanos === null) return null;
  const s = seconds === undefined ? 0n : int64Of(seconds.varint);
  const ns = nanos === undefined ? 0n : int64Of(nanos.varint);
  if (s < 0n || ns < 0n || ns > 999_999_999n) return null;

  let validDuration = 0;
  if (durationField !== undefined) {
    const d = fieldsOf(durationField.bytes);
    if (d === null) return null;
    const ds = single(d, 1, 0);
    if (ds === null) return null;
    const v = ds === undefined ? 0n : int64Of(ds.varint);
    if (v < 0n || v > 1_000_000n) return null;
    validDuration = Number(v);
  }

  let memo = "";
  if (memoField !== undefined) {
    if (memoField.bytes.length > MAX_MEMO) return null;
    try {
      memo = UTF8.decode(memoField.bytes);
    } catch {
      return null;
    }
  }
  return { id: { account, seconds: s, nanos: Number(ns) }, validDuration, memo, bodyBytes: bodyBytes.slice() };
}

/** `AccountID` {shardNum 1, realmNum 2, accountNum 3} as "shard.realm.num"; an alias account is not read. */
function accountOf(bytes: Uint8Array): string | null {
  const f = fieldsOf(bytes);
  if (f === null || f.some((x) => x.n === 4)) return null;
  const parts: bigint[] = [];
  for (const n of [1, 2, 3]) {
    const x = single(f, n, 0);
    if (x === null) return null;
    const v = x === undefined ? 0n : int64Of(x.varint);
    if (v < 0n) return null;
    parts.push(v);
  }
  return parts.join(".");
}

// ── protobuf, write ──────────────────────────────────────────────────────────────────────────────────────────────────

function varint(v: bigint): number[] {
  const out: number[] = [];
  let x = v < 0n ? v + UINT64_LIMIT : v;
  do {
    const b = Number(x & 0x7fn);
    x >>= 7n;
    out.push(x === 0n ? b : b | 0x80);
  } while (x !== 0n);
  return out;
}

/** A varint field; a zero value is not written. */
function vField(n: number, v: bigint): number[] {
  return v === 0n ? [] : [...varint(BigInt(n << 3)), ...varint(v)];
}

/** A length-delimited field, written even when empty. */
function lenField(n: number, bytes: readonly number[] | Uint8Array): number[] {
  return [...varint(BigInt((n << 3) | 2)), ...varint(BigInt(bytes.length)), ...bytes];
}

/** A length-delimited field; an empty value is not written. */
function lenFieldNonEmpty(n: number, bytes: readonly number[] | Uint8Array): number[] {
  return bytes.length === 0 ? [] : lenField(n, bytes);
}

function zigzag(v: bigint): bigint {
  return v >= 0n ? v << 1n : (-v << 1n) - 1n;
}

function entity(id: string): number[] {
  const [shard, realm, num] = id.split(".").map((p) => BigInt(p)) as [bigint, bigint, bigint];
  return [...vField(1, shard), ...vField(2, realm), ...vField(3, num)];
}

function accountAmount(account: string, amount: bigint): number[] {
  return [...lenField(1, entity(account)), ...vField(2, zigzag(amount))];
}

/** The two transfer rows, the payer's debit first. */
function transferRows(payer: string, payTo: string, amount: bigint): number[] {
  return [...lenField(1, accountAmount(payer, -amount)), ...lenField(1, accountAmount(payTo, amount))];
}

function writeBody(b: {
  feePayer: string;
  seconds: bigint;
  nanos: number;
  node: string;
  maxFee: bigint;
  memo: string;
  asset: string;
  payer: string;
  payTo: string;
  amount: bigint;
  decimals?: number;
}): Uint8Array {
  const txId = [
    ...lenField(1, [...vField(1, b.seconds), ...vField(2, BigInt(b.nanos))]),
    ...lenField(2, entity(b.feePayer)),
  ];
  let transfer: number[];
  if (b.asset === "0.0.0") {
    transfer = lenField(1, transferRows(b.payer, b.payTo, b.amount));
  } else {
    const tokenList = [
      ...lenField(1, entity(b.asset)),
      ...lenField(2, accountAmount(b.payer, -b.amount)),
      ...lenField(2, accountAmount(b.payTo, b.amount)),
      ...(b.decimals === undefined ? [] : lenField(4, vField(1, BigInt(b.decimals)))),
    ];
    transfer = lenField(2, tokenList);
  }
  return Uint8Array.from([
    ...lenField(1, txId),
    ...lenField(2, entity(b.node)),
    ...vField(3, b.maxFee),
    ...lenField(4, vField(1, BigInt(VALID_DURATION))),
    ...lenFieldNonEmpty(6, ENCODER.encode(b.memo)),
    ...lenField(14, transfer),
  ]);
}

/** `Transaction` {5: `SignedTransaction` {1: bodyBytes, 2: `SignatureMap` {1: `SignaturePair`}}}, base64. */
function completeWith(
  bodyBytes: Uint8Array,
  s: { publicKey: Uint8Array; signature: Uint8Array; type: "ed25519" | "ecdsa-secp256k1" },
): string | Refusal {
  if (!isObject(s) || !(s.publicKey instanceof Uint8Array) || !(s.signature instanceof Uint8Array)) {
    return refusal("hedera/tx-malformed");
  }
  const keyLength = s.type === "ed25519" ? 32 : s.type === "ecdsa-secp256k1" ? 33 : -1;
  if (s.publicKey.length !== keyLength || s.signature.length !== 64) return refusal("hedera/tx-malformed");
  const pair = [...lenField(1, s.publicKey), ...lenField(s.type === "ed25519" ? 3 : 6, s.signature)];
  const signed = [...lenField(1, bodyBytes), ...lenField(2, lenField(1, pair))];
  return toBase64(Uint8Array.from(lenField(5, signed)));
}

// ── base64 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || s.length % 4 !== 0 || !BASE64.test(s)) return null;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function entriesOf(
  network: HederaNetwork,
  transaction: string,
  reader: HederaReader,
): Promise<readonly MirrorEntry[] | "not-found" | "unreadable"> {
  if (!isObject(reader) || reader.network !== network) return "unreadable";
  let entries: readonly MirrorEntry[] | null;
  try {
    entries = await reader.transactions(transaction);
  } catch {
    return "unreadable";
  }
  if (entries === null) return "not-found";
  if (!Array.isArray(entries) || !entries.every(isEntry)) return "unreadable";
  return entries;
}

function isEntry(e: unknown): e is MirrorEntry {
  if (!isObject(e)) return false;
  return (
    typeof e["result"] === "string" &&
    (e["memo_base64"] === null || typeof e["memo_base64"] === "string") &&
    Number.isSafeInteger(e["nonce"]) &&
    typeof e["scheduled"] === "boolean" &&
    typeof e["consensus_timestamp"] === "string"
  );
}

/**
 * The user transaction's own entries: nonce 0, not scheduled, and not a rejected duplicate or a node due-diligence
 * failure.
 */
function counted(entries: readonly MirrorEntry[]): MirrorEntry[] {
  return entries.filter((e) => e.nonce === 0 && e.scheduled === false && !NOT_COUNTED.has(e.result));
}

function memoOf(e: MirrorEntry): Uint8Array | null {
  return e.memo_base64 === null ? new Uint8Array(0) : fromBase64(e.memo_base64);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Reads every Mirror Node entry for the transaction id. Duplicates, node due-diligence failures, child and scheduled
 * records are skipped; the user transaction with SUCCESS and the recorded memo is settled, with another memo it is
 * not this instrument, and any other result is failed with that result. A failed read, or a reader for another
 * network, is pending.
 */
export async function hederaStatus(ref: HederaRef, reader: HederaReader): Promise<HederaStatus> {
  const entries = await entriesOf(ref.network, ref.transactionId, reader);
  if (entries === "not-found" || entries === "unreadable") return { state: "pending", why: entries };
  const own = counted(entries);
  const success = own.find((e) => e.result === SUCCESS);
  if (success !== undefined) {
    const memo = memoOf(success);
    if (memo === null) return { state: "pending", why: "unreadable" };
    return sameBytes(memo, ENCODER.encode(ref.expectMemo))
      ? { state: "settled", consensus: success.consensus_timestamp }
      : { state: "failed", why: "not-this-instrument" };
  }
  const first = own[0];
  if (first === undefined) return { state: "pending", why: "not-found" };
  return { state: "failed", why: `result:${first.result}` };
}

/** The hash from the landed user transaction's memo alone, for anyone holding the transaction id. One call. */
async function recover(
  ref: { network: HederaNetwork; transactionId: string },
  reader: HederaReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(reader) || reader.network !== ref.network) return refusal("hedera/wrong-reader");
  const entries = await entriesOf(ref.network, ref.transactionId, reader);
  if (entries === "unreadable") return refusal("hedera/unreadable");
  if (entries === "not-found") return refusal("hedera/not-found");
  const success = counted(entries).find((e) => e.result === SUCCESS);
  if (success === undefined) return refusal("hedera/not-found");
  const memo = memoOf(success);
  if (memo === null) return refusal("hedera/unreadable");
  if (memo.length === 0) return refusal("hedera/no-memo");
  let text: string;
  try {
    text = UTF8.decode(memo);
  } catch {
    return refusal("hedera/memo-not-lcp");
  }
  return fromLcpString(text) ?? refusal("hedera/memo-not-lcp");
}

// ── the options ──────────────────────────────────────────────────────────────────────────────────────────────────────

function isEntity(s: unknown): s is string {
  return typeof s === "string" && ENTITY.test(s);
}

function isHederaNetwork(s: unknown): s is HederaNetwork {
  return typeof s === "string" && (HEDERA_NETWORKS as readonly string[]).includes(s);
}

/** Positive decimal below 2^63. */
function amountOf(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !DECIMAL.test(s)) return undefined;
  const v = BigInt(s);
  return v > 0n && v < INT64_LIMIT ? v : undefined;
}

function methodOf(o: PaymentRequirements): unknown {
  return isObject(o.extra) ? o.extra["assetTransferMethod"] : undefined;
}

/** The option's common Hedera shape: `exact` on a `hedera:` network. Undefined when it is not a Hedera option. */
function onHedera(o: PaymentRequirements): boolean {
  return isObject(o) && o.scheme === "exact" && typeof o.network === "string" && o.network.startsWith("hedera:");
}

/** Everything but the transfer method: network, asset, payee, amount and timeout. */
function isServable(o: PaymentRequirements): boolean {
  return (
    isHederaNetwork(o.network) &&
    (o.extra === undefined || isObject(o.extra)) &&
    isEntity(o.asset) &&
    isEntity(o.payTo) &&
    amountOf(o.amount) !== undefined &&
    Number.isSafeInteger(o.maxTimeoutSeconds) &&
    o.maxTimeoutSeconds > 0
  );
}

function checkExact(o: PaymentRequirements): true | Refusal | undefined {
  if (!onHedera(o)) return undefined;
  const method = methodOf(o);
  if (method === "transferExecutor") return undefined;
  if (method !== undefined && method !== "cryptoTransfer") return refusal("hedera/option-malformed");
  if (!isServable(o) || !isEntity((o.extra as Record<string, unknown>)?.["feePayer"])) {
    return refusal("hedera/option-malformed");
  }
  return true;
}

function executorsOf(o: PaymentRequirements): readonly string[] | undefined {
  const list = isObject(o.extra) ? o.extra["executors"] : undefined;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_EXECUTORS || !list.every(isEntity)) {
    return undefined;
  }
  return list as string[];
}

function checkExecutor(o: PaymentRequirements): true | Refusal | undefined {
  if (!onHedera(o)) return undefined;
  const method = methodOf(o);
  if (method !== "transferExecutor") {
    return method === undefined || method === "cryptoTransfer" ? undefined : refusal("hedera/option-malformed");
  }
  return isServable(o) && executorsOf(o) !== undefined ? true : refusal("hedera/option-malformed");
}

/**
 * The Hedera pairing an option names: `x402/exact/hedera` for `cryptoTransfer` (or no method), the transfer-executor
 * pairing for `transferExecutor`; a Hedera option either cannot serve is `hedera/option-malformed`. Undefined for an
 * option on another rail.
 */
export function hederaPairingOf(o: PaymentRequirements): typeof EXACT | typeof EXECUTOR | Refusal | undefined {
  if (!onHedera(o)) return undefined;
  const exact = checkExact(o);
  if (exact === true) return EXACT;
  const executor = checkExecutor(o);
  if (executor === true) return EXECUTOR;
  return isRefusal(exact) ? exact : isRefusal(executor) ? executor : refusal("hedera/option-malformed");
}

// ── x402/exact/hedera ────────────────────────────────────────────────────────────────────────────────────────────────

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(checkExact)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(checkExact)(doc);
}

/**
 * The `TransactionBody` the payer signs: the fee payer's transaction id, the hash's LCP string as the memo, and the
 * payer's debit and the payee's credit of the option's amount, in HBAR or the option's token.
 */
async function build(
  c: {
    required: PaymentRequired;
    accepted: PaymentRequirements;
    payer: string;
    node: string;
    validStart: { seconds: bigint; nanos: number };
    maxFee: bigint;
    decimals?: number;
  },
  h: AtrHash,
): Promise<HederaUnsigned | Refusal> {
  if (!isObject(c)) return refusal("hedera/option-malformed");
  const ok = chosen(c.required, c.accepted, checkExact);
  if (ok !== true) return ok;
  const vs = c.validStart;
  if (
    !isEntity(c.payer) ||
    !isEntity(c.node) ||
    !isObject(vs) ||
    typeof vs.seconds !== "bigint" ||
    vs.seconds < 0n ||
    vs.seconds >= INT64_LIMIT ||
    !Number.isInteger(vs.nanos) ||
    vs.nanos < 0 ||
    vs.nanos > 999_999_999 ||
    typeof c.maxFee !== "bigint" ||
    c.maxFee < 0n ||
    c.maxFee >= UINT64_LIMIT ||
    (c.decimals !== undefined && (!Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 0xffffffff))
  ) {
    return refusal("hedera/option-malformed");
  }
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  const a = c.accepted;
  const bodyBytes = writeBody({
    feePayer: (a.extra as Record<string, string>)["feePayer"]!,
    seconds: vs.seconds,
    nanos: vs.nanos,
    node: c.node,
    maxFee: c.maxFee,
    memo: toLcpString(nh),
    asset: a.asset,
    payer: c.payer,
    payTo: a.payTo,
    amount: amountOf(a.amount)!,
    ...(c.decimals !== undefined ? { decimals: c.decimals } : {}),
  });
  return {
    request: { kind: "hedera-body", bodyBytes },
    complete: (s) => completeWith(bodyBytes, s),
  };
}

/** The signed body of a presented x402 Hedera payment. */
function signedBody(presented: unknown): { accepted: PaymentRequirements; body: HederaBody } | Refusal {
  const p = presentedWith(presented, checkExact);
  if (isRefusal(p)) return p;
  const wire = fromBase64(p.payload["transaction"]);
  if (wire === null) return refusal("hedera/tx-malformed");
  const decoded = decodeHederaTx(wire);
  if (isRefusal(decoded)) return decoded;
  return { accepted: p.accepted, body: decoded.bodies[0]! };
}

/**
 * The hash inside what the payer signed: the body memo, in LCP string form. Transfers, amounts, the fee payer and the
 * payer are not read, and no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const s = signedBody(presented);
  if (isRefusal(s)) return s;
  if (s.body.memo === "") return refusal("hedera/no-memo");
  return fromLcpString(s.body.memo) ?? refusal("hedera/memo-not-lcp");
}

/** The read keys recorded at claim, from the signed body: the mirror-form id, the memo and the end of validity. */
async function reference(presented: unknown): Promise<HederaRef | Refusal> {
  const h = await bound(presented);
  if (isRefusal(h)) return h;
  const { accepted, body } = signedBody(presented) as { accepted: PaymentRequirements; body: HederaBody };
  return {
    network: accepted.network as HederaNetwork,
    transactionId: txIdMirror(body.id),
    expectMemo: body.memo,
    validUntil: Number(body.id.seconds) + body.validDuration,
  };
}

/** The option unchanged: the hash rides in the signed body, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

const exactPattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: EXACT,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a Hedera transaction body whose memo carries this ATR's hash in LCP string form, and the " +
    "transaction reached consensus with SUCCESS. The memo is in the public transaction record. This does not show " +
    "that amount, recipient, token or timing match the ATR's content. The seller read the landed entry by its " +
    "transaction id and memo; the fee payer, the seller's facilitator, could land another body under the same id.",
});

export const exactHedera = Object.freeze({
  id: EXACT,
  pattern: exactPattern,
  claims: true as boolean,
  carrier: "TransactionBody.memo" as const,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: hederaStatus,
  recover,
});

// ── x402/exact/hedera/transfer-executor ─────────────────────────────────────────────────────────────────────────────

/** the core's hash over the ASCII of `payer,payTo,amount`: the identity of one transfer, never shown in the clear. */
export async function hederaIdDigest(payer: string, payTo: string, amount: string): Promise<Hex> {
  return hash(ENCODER.encode(`${payer},${payTo},${amount}`));
}

function executorPayloadOf(payload: Record<string, unknown>): ExecutorPayload | Refusal {
  const { payer, executor, authorization } = payload;
  if (
    !isEntity(payer) ||
    !isEntity(executor) ||
    typeof authorization !== "string" ||
    authorization.length > MAX_AUTHORIZATION_HEX + 2 ||
    !HEX_BYTES.test(authorization)
  ) {
    return refusal("hedera/executor-malformed");
  }
  return { payer, executor, authorization: authorization as Hex };
}

function advertiseExecutor(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(checkExecutor)(doc, h, link, offer, agreementUrl);
}

function readExecutor(doc: PaymentRequired): X402Read | Refusal {
  return readFor(checkExecutor)(doc);
}

/**
 * What the buyer's wallet or executor tooling needs to obtain an authorization, and how that authorization completes
 * the payment. Nothing here carries the hash.
 */
async function buildExecutor(
  c: { required: PaymentRequired; accepted: PaymentRequirements; now: number },
  h: AtrHash,
): Promise<
  | {
      request: {
        kind: "hedera-executor";
        network: HederaNetwork;
        executors: readonly string[];
        asset: string;
        payTo: string;
        amount: string;
        validBefore: number;
      };
      complete(a: { payer: string; executor: string; authorization: Hex }): ExecutorPaymentPayload | Refusal;
    }
  | Refusal
> {
  if (!isObject(c)) return refusal("hedera/option-malformed");
  const ok = chosen(c.required, c.accepted, checkExecutor);
  if (ok !== true) return ok;
  if (!Number.isSafeInteger(c.now) || c.now < 0) return refusal("hedera/option-malformed");
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  const { required, accepted } = c;
  const executors = executorsOf(accepted)!;
  return {
    request: {
      kind: "hedera-executor",
      network: accepted.network as HederaNetwork,
      executors,
      asset: accepted.asset,
      payTo: accepted.payTo,
      amount: accepted.amount,
      validBefore: c.now + accepted.maxTimeoutSeconds,
    },
    complete(a) {
      if (!isObject(a)) return refusal("hedera/executor-malformed");
      const payload = executorPayloadOf(a);
      if (isRefusal(payload)) return payload;
      if (!executors.includes(payload.executor)) return refusal("hedera/executor-not-offered");
      return paymentWith(required, accepted, payload);
    },
  };
}

/** The presented option, checked, and its executor payload. */
function executorPresented(presented: unknown): { accepted: PaymentRequirements; payload: ExecutorPayload } | Refusal {
  const p = presentedWith(presented, checkExecutor);
  if (isRefusal(p)) return p;
  const payload = executorPayloadOf(p.payload);
  if (isRefusal(payload)) return payload;
  return { accepted: p.accepted, payload };
}

/** The hash from the echoed, unsigned `extensions.legalContext`. Nothing the payer signed carries it. */
async function boundExecutor(presented: unknown): Promise<AtrHash | Refusal> {
  const p = executorPresented(presented);
  if (isRefusal(p)) return p;
  const extensions = (presented as Record<string, unknown>)["extensions"];
  const lc = isObject(extensions) ? extensions["legalContext"] : undefined;
  const decoded = isObject(lc) ? fromLegalContext({ legalContext: lc["info"] }) : null;
  return decoded === null ? refusal("hedera/no-legal-context") : decoded.h;
}

/**
 * Read keys only: the network, the asset, the digest of payer, payee and amount, and the time by which the transfer
 * settles, counted from now (the claim).
 */
async function referenceExecutor(presented: unknown): Promise<ExecutorRef | Refusal> {
  const h = await boundExecutor(presented);
  if (isRefusal(h)) return h;
  const { accepted, payload } = executorPresented(presented) as { accepted: PaymentRequirements; payload: ExecutorPayload };
  return {
    network: accepted.network as HederaNetwork,
    asset: accepted.asset,
    idDigest: await hederaIdDigest(payload.payer, accepted.payTo, accepted.amount),
    settleBy: Math.floor(Date.now() / 1000) + accepted.maxTimeoutSeconds,
  };
}

/**
 * Reads the merged consensus record of the named transaction: the user entry must be SUCCESS; each account's net
 * change in the asset is summed over the user entry and its children, with HIP-406 staking rewards taken back out of
 * HBAR transfers and the fee payer left out; exactly one other account must be debited, and a credit of the same
 * magnitude must give the recorded digest. A transfer list that is not an array is pending `unreadable`.
 */
export async function executorStatus(
  ref: ExecutorRef & { transaction: string },
  reader: HederaReader,
): Promise<HederaStatus> {
  const id = typeof ref.transaction === "string" ? MIRROR_ID.exec(ref.transaction) : null;
  if (id === null) return { state: "pending", why: "unreadable" };
  const feePayer = id[1]!;
  const entries = await entriesOf(ref.network, ref.transaction, reader);
  if (entries === "not-found" || entries === "unreadable") return { state: "pending", why: entries };
  if (entries.length > MAX_ENTRIES) return { state: "pending", why: "unreadable" };
  const own = counted(entries);
  const user = own.find((e) => e.result === SUCCESS) ?? own[0];
  if (user === undefined) return { state: "pending", why: "not-found" };
  if (user.result !== SUCCESS) return { state: "failed", why: `result:${user.result}` };

  const merged = entries.filter((e) => e.scheduled === false && !NOT_COUNTED.has(e.result) && (e === user || e.nonce > 0));
  const net = new Map<string, bigint>();
  const credit = (account: string, amount: bigint): void => {
    if (account !== feePayer) net.set(account, (net.get(account) ?? 0n) + amount);
  };
  let rows = 0;
  /** Each well-formed row of `list` in the asset, or undefined when the list or a row is unreadable. */
  const movesOf = (list: unknown): { account: string; amount: bigint }[] | undefined => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) return undefined;
    const out: { account: string; amount: bigint }[] = [];
    for (const m of list as readonly unknown[]) {
      if (++rows > MAX_ROWS) return undefined;
      if (!isObject(m) || typeof m["account"] !== "string" || !Number.isSafeInteger(m["amount"])) return undefined;
      if (ref.asset !== "0.0.0" && m["token_id"] !== ref.asset) continue;
      out.push({ account: m["account"], amount: BigInt(m["amount"] as number) });
    }
    return out;
  };
  // A reward row takes the reward back out of the account it names and returns it to the account that paid it, so a
  // row naming `0.0.800` itself changes nothing.
  for (const e of merged) {
    const moves = movesOf(ref.asset === "0.0.0" ? e.transfers : e.token_transfers);
    const rewards = ref.asset === "0.0.0" ? movesOf(e.staking_reward_transfers) : [];
    if (moves === undefined || rewards === undefined) return { state: "pending", why: "unreadable" };
    for (const m of moves) credit(m.account, m.amount);
    for (const r of rewards) {
      credit(r.account, -r.amount);
      credit(STAKING_REWARD_ACCOUNT, r.amount);
    }
  }
  const debited = [...net].filter(([, v]) => v < 0n);
  if (debited.length !== 1) return { state: "failed", why: "not-this-instrument" };
  const [payer, debit] = debited[0]!;
  const m = -debit;
  for (const [account, v] of net) {
    if (v !== m) continue;
    if ((await hederaIdDigest(payer, account, m.toString())) === ref.idDigest.toLowerCase()) {
      return { state: "settled", consensus: user.consensus_timestamp };
    }
  }
  return { state: "failed", why: "not-this-instrument" };
}

const executorPattern: LcpPattern = deepFreeze({
  pattern: "http-advisory",
  canonical: true,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
    "recorded in <transaction>. The payment is an x402 transferExecutor payment on Hedera: the payer's executor " +
    "contract moved the funds under an authorization the seller did not read, and the facilitator submitted the " +
    "transaction. The hash reached the payer only in the challenge's extension, and nothing the payer signed carries " +
    "it. The seller read the merged consensus record of the named transaction, and found the transfer whose payer, " +
    "payee and amount match the digest recorded at claim. This does not show that amount, recipient, token or timing " +
    "match the ATR's content.",
});

export const exactHederaExecutor = Object.freeze({
  id: EXECUTOR,
  pattern: executorPattern,
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseExecutor,
  read: readExecutor,
  build: buildExecutor,
  bound: boundExecutor,
  reference: referenceExecutor,
  status: executorStatus,
});

// ── mpp/charge/hedera ────────────────────────────────────────────────────────────────────────────────────────────────

const CHARGE = "mpp/charge/hedera" as const;
const MAX_SPLITS = 9;
const TX_ID_TEXT = /^((?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18}))@(\d{1,19})\.(\d{1,9})$/;
const ATTRIBUTION = /^0x[0-9a-fA-F]{64}$/;
/** The longest valid duration a Hedera transaction may declare, in seconds. */
const MAX_VALID_DURATION = 180;

/** An MPP Hedera charge request as decoded from the challenge's `request`. */
export type MppHederaRequest = { [k: string]: Json };

/** The request's legs: the payer's debit of `amount`, the recipient's remainder, and each split, in `currency`. */
function chargeLegs(
  request: MppHederaRequest,
): { currency: string; amount: bigint; legs: readonly { account: string; amount: bigint }[] } | Refusal {
  if (!isObject(request)) return refusal("hedera/option-malformed");
  const amount = amountOf(request["amount"]);
  const currency = request["currency"];
  const recipient = request["recipient"];
  if (amount === undefined || !isEntity(currency) || !isEntity(recipient)) return refusal("hedera/option-malformed");
  const splits = request["splits"] ?? [];
  if (!Array.isArray(splits) || splits.length > MAX_SPLITS) return refusal("hedera/option-malformed");
  const legs: { account: string; amount: bigint }[] = [];
  let splitTotal = 0n;
  for (const sp of splits) {
    const a = isObject(sp) ? amountOf(sp["amount"]) : undefined;
    if (!isObject(sp) || !isEntity(sp["recipient"]) || a === undefined) return refusal("hedera/option-malformed");
    legs.push({ account: sp["recipient"], amount: a });
    splitTotal += a;
  }
  if (splitTotal >= amount) return refusal("hedera/option-malformed");
  const all = [{ account: recipient, amount: amount - splitTotal }, ...legs];
  const accounts = new Set(all.map((l) => l.account));
  if (accounts.size !== all.length) return refusal("hedera/option-malformed");
  return { currency, amount, legs: all };
}

/** The Hedera request checks a charge challenge must pass before it is placed. */
export function hederaChargeRequest(c: MppChallenge): true | Refusal {
  if (!isObject(c) || c.method !== "hedera" || c.intent !== "charge") return refusal("mpp/not-this-pairing");
  let request: unknown;
  try {
    request = parseJson(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(c.request)));
  } catch {
    return refusal("mpp/request-malformed");
  }
  if (!isObject(request)) return refusal("mpp/request-malformed");
  const legs = chargeLegs(request as MppHederaRequest);
  if (isRefusal(legs)) return legs;
  const md = request["methodDetails"];
  if (md !== undefined && !isObject(md)) return refusal("mpp/request-malformed");
  const chainId = isObject(md) ? md["chainId"] : undefined;
  if (chainId !== undefined) {
    const n = hederaNetworkOfChainId(chainId);
    if (isRefusal(n)) return n;
  }
  return true;
}

function fromBase64Url(s: unknown): Uint8Array {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error("not base64url");
  const plain = s.replace(/=+$/, "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = plain + "=".repeat((4 - (plain.length % 4)) % 4);
  const bytes = fromBase64(padded);
  if (bytes === null) throw new Error("not base64url");
  return bytes;
}

/**
 * The CAIP-2 network of a charge request: `methodDetails.chainId` 295 or 296; absent, `defaultNetwork`.
 */
function chargeNetwork(request: MppHederaRequest, defaultNetwork?: HederaNetwork): HederaNetwork | Refusal {
  if (!isObject(request)) return refusal("hedera/option-malformed");
  const md = request["methodDetails"];
  const chainId = isObject(md) ? md["chainId"] : undefined;
  if (chainId === undefined) return defaultNetwork !== undefined && isHederaNetwork(defaultNetwork) ? defaultNetwork : refusal("hedera/chain-id-unnamed");
  return hederaNetworkOfChainId(chainId);
}

/**
 * The body the payer signs for an MPP Hedera charge: the payer's own transaction id, MPP's attribution memo for this
 * challenge as the memo, and the token transfers of `currency`: the payer's debit, the recipient's remainder and each
 * split. With `credentialType` `hash` the request carries `broadcast: true`, for a signer that signs and broadcasts
 * the body; with `transaction`, the default, the signature completes the transaction.
 */
async function buildCharge(
  credentialChallenge: { id: string; realm: string },
  request: MppHederaRequest,
  c: {
    payer: string;
    node: string;
    validStart: { seconds: bigint; nanos: number };
    maxFee: bigint;
    clientId?: string;
    credentialType?: "transaction" | "hash";
  },
): Promise<HederaUnsigned | Refusal> {
  if (!isObject(credentialChallenge) || typeof credentialChallenge.id !== "string" || typeof credentialChallenge.realm !== "string") {
    return refusal("mpp/challenge-malformed");
  }
  const legs = chargeLegs(request);
  if (isRefusal(legs)) return legs;
  const vs = isObject(c) ? c.validStart : undefined;
  if (
    !isObject(c) ||
    !isEntity(c.payer) ||
    !isEntity(c.node) ||
    !isObject(vs) ||
    typeof vs.seconds !== "bigint" ||
    vs.seconds < 0n ||
    vs.seconds >= INT64_LIMIT ||
    !Number.isInteger(vs.nanos) ||
    vs.nanos < 0 ||
    vs.nanos > 999_999_999 ||
    typeof c.maxFee !== "bigint" ||
    c.maxFee < 0n ||
    c.maxFee >= UINT64_LIMIT ||
    (c.clientId !== undefined && typeof c.clientId !== "string") ||
    (c.credentialType !== undefined && c.credentialType !== "transaction" && c.credentialType !== "hash") ||
    legs.legs.some((l) => l.account === c.payer)
  ) {
    return refusal("hedera/option-malformed");
  }
  const memo = attributionMemo(credentialChallenge.realm, credentialChallenge.id, c.clientId);
  const tokenList = [
    ...lenField(1, entity(legs.currency)),
    ...lenField(2, accountAmount(c.payer, -legs.amount)),
    ...legs.legs.flatMap((l) => lenField(2, accountAmount(l.account, l.amount))),
  ];
  const txId = [...lenField(1, [...vField(1, vs.seconds), ...vField(2, BigInt(vs.nanos))]), ...lenField(2, entity(c.payer))];
  const bodyBytes = Uint8Array.from([
    ...lenField(1, txId),
    ...lenField(2, entity(c.node)),
    ...vField(3, c.maxFee),
    ...lenField(4, vField(1, BigInt(VALID_DURATION))),
    ...lenFieldNonEmpty(6, ENCODER.encode(memo)),
    ...lenField(14, lenField(2, tokenList)),
  ]);
  const push = c.credentialType === "hash";
  return {
    request: push ? { kind: "hedera-body", bodyBytes, broadcast: true } : { kind: "hedera-body", bodyBytes },
    complete: (s) => completeWith(bodyBytes, s),
  };
}

/** The echoed challenge's hash and request, checked to be a Hedera charge, with the credential's payload type. */
function chargeCredential(
  credential: MppCredential,
): { h: AtrHash; challenge: MppCredential["challenge"]; request: MppHederaRequest; type: "transaction" | "hash" } | Refusal {
  const cb = challengeBound(credential);
  if (isRefusal(cb)) return cb;
  const { challenge, payload } = credential;
  if (challenge.method !== "hedera" || challenge.intent !== "charge") return refusal("mpp/not-this-pairing");
  const type = payload["type"];
  if (type !== "transaction" && type !== "hash") return refusal("mpp/credential-type");
  return { h: cb.h, challenge, request: cb.request, type };
}

/** A Hedera charge credential with what `fetchPresented` read: the network, and for a push the landed memo. */
export type HederaLandedCharge = MppCredential & { landed: { network: HederaNetwork; memo?: string } };

/**
 * The credential with `landed` written from the reader: the charge's network (the request's `chainId`, or
 * `defaultNetwork` when the request names none), and for a push credential (`type="hash"`) the memo of the
 * landed SUCCESS entry. The reader must be of that network. A read that fails, or finds nothing, is a refusal the
 * seller retries.
 */
async function fetchCharge(
  input: unknown,
  reader: HederaReader,
  defaultNetwork?: HederaNetwork,
): Promise<HederaLandedCharge | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const c = chargeCredential(credential);
  if (isRefusal(c)) return c;
  const network = chargeNetwork(c.request, defaultNetwork);
  if (isRefusal(network)) return network;
  if (!isObject(reader) || !isHederaNetwork(reader.network)) return refusal("hedera/wrong-reader");
  if (network !== reader.network) return refusal("hedera/wrong-reader");
  if (c.type === "transaction") return { ...credential, landed: { network } };
  const id = pushTransactionId(credential);
  if (isRefusal(id)) return id;
  const entries = await entriesOf(network, txIdMirror(id), reader);
  if (entries === "unreadable") return refusal("hedera/unreadable");
  if (entries === "not-found") return refusal("hedera/not-found");
  const success = counted(entries).find((e) => e.result === SUCCESS);
  if (success === undefined) return refusal("hedera/not-found");
  const memo = memoOf(success);
  if (memo === null) return refusal("hedera/unreadable");
  let text: string;
  try {
    text = UTF8.decode(memo);
  } catch {
    return refusal("mpp/attribution-malformed");
  }
  return { ...credential, landed: { network, memo: text } };
}

/** A push credential's `transactionId`, `shard.realm.num@seconds.nanos`. */
function pushTransactionId(credential: MppCredential): { account: string; seconds: bigint; nanos: number } | Refusal {
  const t = credential.payload["transactionId"];
  const m = typeof t === "string" ? TX_ID_TEXT.exec(t) : null;
  if (m === null) return refusal("hedera/tx-malformed");
  return { account: m[1]!, seconds: BigInt(m[2]!), nanos: Number(m[3]!.padEnd(9, "0")) };
}

/** What `fetchPresented` wrote, or undefined. */
function landedOf(credential: MppCredential): { network?: unknown; memo?: unknown } | undefined {
  const landed = (credential as Partial<HederaLandedCharge>).landed;
  return isObject(landed) ? landed : undefined;
}

function landedBody(credential: MppCredential): HederaBody | Refusal {
  const wire = fromBase64(credential.payload["transaction"]);
  if (wire === null) return refusal("hedera/tx-malformed");
  const decoded = decodeHederaTx(wire);
  return isRefusal(decoded) ? decoded : decoded.bodies[0]!;
}

function attributed(memo: string, challenge: { realm: string; id: string }): true | Refusal {
  if (!ATTRIBUTION.test(memo)) return refusal("mpp/attribution-malformed");
  return checkAttribution(memo, challenge.realm, challenge.id);
}

/**
 * The hash from the echoed challenge, once the payer's memo is this challenge's attribution memo: from the signed body
 * (`type="transaction"`), or from the landed entry's memo that `fetchPresented` wrote (`type="hash"`). No transfer,
 * amount, payer or signature is read.
 */
async function boundCharge(input: unknown): Promise<AtrHash | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const c = chargeCredential(credential);
  if (isRefusal(c)) return c;
  let memo: string;
  if (c.type === "transaction") {
    const body = landedBody(credential);
    if (isRefusal(body)) return body;
    memo = body.memo;
  } else {
    const landed = landedOf(credential)?.memo;
    if (typeof landed !== "string") return refusal("hedera/read-first");
    memo = landed;
  }
  const ok = attributed(memo, c.challenge);
  return ok === true ? c.h : ok;
}

/**
 * The read keys recorded at claim, on the network `fetchPresented` wrote (else the request's `chainId`).
 * `type="transaction"`: from the signed body. `type="hash"`: the credential's transaction id, the landed memo, and
 * validity to the valid start plus 180 s.
 */
async function referenceCharge(input: unknown): Promise<HederaRef | Refusal> {
  const credential = credentialOf(input);
  if (isRefusal(credential)) return credential;
  const h = await boundCharge(credential);
  if (isRefusal(h)) return h;
  const c = chargeCredential(credential) as { request: MppHederaRequest };
  const landed = landedOf(credential);
  const network = landed?.network !== undefined ? landed.network : chargeNetwork(c.request);
  if (isRefusal(network)) return network;
  if (!isHederaNetwork(network)) return refusal("hedera/network-malformed");
  if (credential.payload["type"] === "transaction") {
    const body = landedBody(credential) as HederaBody;
    return {
      network,
      transactionId: txIdMirror(body.id),
      expectMemo: body.memo,
      validUntil: Number(body.id.seconds) + body.validDuration,
    };
  }
  const id = pushTransactionId(credential);
  if (isRefusal(id)) return id;
  return { network, transactionId: txIdMirror(id), expectMemo: landed!.memo as string, validUntil: Number(id.seconds) + MAX_VALID_DURATION };
}

/** The placement: the Hedera request checks, then MPP's `place`. */
function advertiseCharge(
  doc: readonly MppChallenge[],
  h: AtrHash,
  link: string,
  offer: MppChallenge,
  agreementUrl?: string,
): MppChallenge[] | Refusal {
  const ok = hederaChargeRequest(offer);
  if (ok !== true) return ok;
  return place(doc, h, link, offer, agreementUrl);
}

/** The challenge unchanged: the hash rides in the challenge id and `opaque`, never in `request`. */
function unplacedCharge(option: MppChallenge): MppChallenge {
  return option;
}

const chargePattern: LcpPattern = deepFreeze({
  pattern: "opaque-challenge",
  canonical: true,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The ATR was assembled, written to the seller's storage and linked in the challenge before approval, " +
    "and its hash is in the MPP challenge this payment " +
    "answered, protected by the server's binding of the challenge, not by the payer's signature. The payer signed a " +
    "memo whose 7-byte nonce is keccak256 of that challenge's id. It ties the payment to the challenge instance, and " +
    "binds this ATR's hash only through those 7 bytes: whoever assembles the ATR can construct a second ATR whose " +
    "challenge id gives the same 7 bytes. This does not show that amount, recipient, token or timing match the ATR's " +
    "content.",
});

export const chargeHedera = Object.freeze({
  id: CHARGE,
  pattern: chargePattern,
  claims: true as boolean,
  carrier: "challenge" as const,
  unplaced: unplacedCharge,
  tie: tieMpp,
  advertise: advertiseCharge,
  read: readMpp,
  network: chargeNetwork,
  build: buildCharge,
  fetchPresented: fetchCharge,
  landedTx: (presented: unknown): string | undefined => {
    const c = credentialOf(presented);
    if (isRefusal(c) || c.payload["type"] !== "hash") return undefined;
    const id = pushTransactionId(c);
    return isRefusal(id) ? undefined : txIdMirror(id);
  },
  bound: boundCharge,
  reference: referenceCharge,
  status: hederaStatus,
});

export {
  APPROVE_SELECTOR,
  CHANNEL_CLOSED_TOPIC,
  CHANNEL_OPENED_TOPIC,
  ESCROW_OPEN_SELECTOR,
  approveCalldata,
  hederaChannelId,
  hederaVoucher,
  openCalldata,
  type HederaChannelConfig,
  type HederaCloseRef,
  type HederaEvmReader,
  type HederaSessionRef,
  type HederaVoucherTypedData,
} from "./internal/hedera-session.js";
