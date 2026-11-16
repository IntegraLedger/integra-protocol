/**
 * Hedera: the transaction wire form read and written by hand (protobuf, five messages), the Mirror Node settlement
 * read, and the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and
 * `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only); the escrow channel pieces
 * `hederaChannelId` and `hederaVoucher`; and `FETCHED`, the key under which a pairing's `fetchPresented` writes the
 * seller's read onto a credential.
 */
import { fromLcpString, fromLegalContext, hash, toLcpString, type AtrHash } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import {
  amountOf,
  INT64_LIMIT,
  isEntity,
  type ExecutorPayload,
  type ExecutorPaymentPayload,
  type HederaPaymentPayload,
} from "./internal/hedera.js";
import { advertiseFor, chosen, isAmount, isTimeoutSeconds, paymentWith, presentedWith, readFor, x402Broadcaster, type X402Read, type X402Forms } from "./internal/x402.js";
import { fromBase64, toBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { HEDERA } from "./internal/data/hedera.js";
import { decide, type Facts, type Ledger, type RecoverInput, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import { x402Payee } from "./internal/payee.js";
import type { Entry } from "./internal/registry.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

export type HederaNetwork = "hedera:mainnet" | "hedera:testnet" | "hedera:previewnet" | "hedera:devnet";
/** The four CAIP-2 Hedera networks. */
const HEDERA_NETWORKS: readonly HederaNetwork[] = Object.freeze([
  "hedera:mainnet",
  "hedera:testnet",
  "hedera:previewnet",
  "hedera:devnet",
]);

export interface HederaTxId {
  /** "shard.realm.num" */
  account: string;
  /** A non-negative bigint. */
  seconds: bigint;
  /** An integer from 0 to 999,999,999. */
  nanos: number;
}

/** "0.0.1235@1700000000.000000000". Throws TypeError on an id that is not a `HederaTxId`. */
export function txIdText(id: HederaTxId): string {
  txIdOf(id);
  return `${id.account}@${id.seconds}.${String(id.nanos).padStart(9, "0")}`;
}

/** "0.0.1235-1700000000-000000000", the Mirror Node's form. Throws TypeError on an id that is not a `HederaTxId`. */
export function txIdMirror(id: HederaTxId): string {
  txIdOf(id);
  return `${id.account}-${id.seconds}-${String(id.nanos).padStart(9, "0")}`;
}

/**
 * Throws TypeError unless `id` is a `HederaTxId`: an account `shard.realm.num`, `seconds` a non-negative bigint, and
 * `nanos` an integer from 0 to 999,999,999, the range of protobuf's `Timestamp`.
 */
function txIdOf(id: unknown): asserts id is HederaTxId {
  if (!isObject(id) || !isEntity(id["account"])) throw new TypeError("not a Hedera transaction id");
  const { seconds, nanos } = id;
  if (typeof seconds !== "bigint" || seconds < 0n) throw new TypeError("not a Hedera transaction id");
  if (!Number.isInteger(nanos) || (nanos as number) < 0 || (nanos as number) > 999_999_999) {
    throw new TypeError("not a Hedera transaction id");
  }
}

export interface HederaBody {
  id: HederaTxId;
  /** `transactionValidDuration`, in seconds. */
  validDuration: number;
  memo: string;
  bodyBytes: Uint8Array<ArrayBuffer>;
}

/** The Mirror Node's `Transaction` entry: the fields read here. */
export interface MirrorEntry {
  result: string;
  memo_base64: string | null;
  nonce: number;
  scheduled: boolean;
  consensus_timestamp: string;
  /** The fee charged to the transaction's fee payer, in tinybars; its `transfers` row includes it. */
  charged_tx_fee?: number;
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

/** The read keys `reference` returns. */
export interface HederaRef {
  network: HederaNetwork;
  /** Mirror form. */
  transactionId: string;
  expectMemo: string;
  /** Unix seconds: valid start plus the valid duration. */
  validUntil: number;
  /** The option's `payTo`. */
  payee: string;
}

/**
 * The answer of `hederaStatus` and `executorStatus`: positions are the Mirror Node's `consensus_timestamp`
 * (`seconds.nanos`), and the one mark is `consensus`, the record the Mirror Node serves, which is final.
 */
export type HederaStatus = StatusAnswer<string, "consensus", string>;

/** The body the payer signs, and how its signature completes the wire transaction. */
export interface HederaUnsigned {
  /** `broadcast: true` when the payer's signer signs and broadcasts the body itself (a push). */
  request: { kind: "hedera-body"; bodyBytes: Uint8Array<ArrayBuffer>; broadcast?: true };
  /** The signed `Transaction`, base64. */
  complete(s: { publicKey: Uint8Array; signature: Uint8Array; type: "ed25519" | "ecdsa-secp256k1" }): string | Refusal;
}

export interface ExecutorRef {
  network: HederaNetwork;
  asset: string;
  /** The option's `payTo`. */
  payee: string;
  /** `hederaIdDigest` of the payer. */
  idDigest: Hex;
  /** Unix seconds: the time `reference` ran plus `maxTimeoutSeconds`. */
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
const MIRROR_ID = /^((?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18}))-(\d{1,19})-(\d{1,9})$/;
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;
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
 * id, valid duration, memo and exact bytes, the bytes a copy of `wire`'s. Every body of a list must share id and memo.
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
  return { id: { account, seconds: s, nanos: Number(ns) }, validDuration, memo, bodyBytes: new Uint8Array(bodyBytes) };
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
  const out = [...varint(BigInt((n << 3) | 2)), ...varint(BigInt(bytes.length))];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
  return out;
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
}): Uint8Array<ArrayBuffer> {
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

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every Mirror Node entry for the transaction id. A reader for another network is `chain-mismatch`, a rejected read
 * `transport`, and an answer that is not a list of entries `unparseable`.
 */
async function entriesOf(
  network: HederaNetwork,
  transaction: string,
  reader: HederaReader,
): Promise<readonly MirrorEntry[] | "not-found" | UnreadableReason> {
  if (!isObject(reader) || reader.network !== network) return "chain-mismatch";
  let entries: readonly MirrorEntry[] | null;
  try {
    entries = await reader.transactions(transaction);
  } catch {
    return "transport";
  }
  if (entries === null) return "not-found";
  if (!Array.isArray(entries) || !entries.every(isEntry)) return "unparseable";
  return entries;
}

/** A consensus timestamp, `seconds.nanos`, as nanoseconds; -1 for one that is not that form. */
function consensusKey(t: string): bigint {
  const m = typeof t === "string" ? /^(\d{1,19})\.(\d{1,9})$/.exec(t) : null;
  return m === null ? -1n : BigInt(m[1]!) * 1_000_000_000n + BigInt(m[2]!.padEnd(9, "0"));
}

/** The Mirror Node's ledger: one mark, the record it serves, and positions ordered by consensus timestamp. */
function hederaLedger(coverage: "full" | "none"): Ledger<string, "consensus"> {
  return {
    coverage,
    final: "consensus",
    markOrder: () => 0,
    positionOrder: (a, b) => {
      const d = consensusKey(a) - consensusKey(b);
      return d < 0n ? -1 : d > 0n ? 1 : 0;
    },
  };
}

type HederaQuery<Ref> = StatusQuery<Ref, string, "consensus", string>;
type HederaFacts = Facts<string, "consensus", string>;

/** What the read of a transaction id observed, before the profile's rules choose the answer. */
type HederaRead =
  | { state: "settled"; consensus: string }
  | { state: "pending"; why: "not-found" }
  | { state: "failed"; why: "not-this-instrument" }
  | { state: "failed"; why: `result:${string}`; consensus: string }
  | { state: "unreadable"; why: UnreadableReason };

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
 * records are skipped; the user transaction with SUCCESS and the recorded memo is settled, with another memo another
 * body consumed the transaction id, and any other result is the transaction's own failed result. A SUCCESS entry whose
 * `memo_base64` is not base64 in its canonical form (RFC 4648 §3.5) is `unparseable`, as is a ref whose `expectMemo`
 * is not a string, with nothing read. `validUntil` is not read.
 */
async function readHedera(ref: HederaRef, reader: HederaReader): Promise<HederaRead> {
  if (!isObject(ref) || typeof ref.expectMemo !== "string") return { state: "unreadable", why: "unparseable" };
  const entries = await entriesOf(ref.network, ref.transactionId, reader);
  if (entries === "not-found") return { state: "pending", why: "not-found" };
  if (typeof entries === "string") return { state: "unreadable", why: entries };
  const own = counted(entries);
  const success = own.find((e) => e.result === SUCCESS);
  if (success !== undefined) {
    const memo = memoOf(success);
    if (memo === null) return { state: "unreadable", why: "unparseable" };
    return sameBytes(memo, ENCODER.encode(ref.expectMemo))
      ? { state: "settled", consensus: success.consensus_timestamp }
      : { state: "failed", why: "not-this-instrument" };
  }
  const first = own[0];
  if (first === undefined) return { state: "pending", why: "not-found" };
  return { state: "failed", why: `result:${first.result}`, consensus: first.consensus_timestamp };
}

/**
 * The facts of a read of the transaction id the payer signed, its single-use value: a record of it, settled or failed,
 * consumed the id, and a record under another memo is another act that consumed it.
 */
function factsOfHedera(read: HederaRead, ref: HederaRef): HederaFacts {
  const none = { seen: [], search: { whole: false }, history: false } as const;
  switch (read.state) {
    case "unreadable":
      return { ...none, unreadable: read.why };
    case "settled":
      return { ...none, seen: [own(ref.transactionId, read.consensus, "succeeded")] };
    case "pending":
      return none;
    case "failed":
      if (read.why === "not-this-instrument") return { ...none, value: { consumed: true, lapsed: false, mark: "consensus" } };
      return {
        ...none,
        seen: [own(ref.transactionId, read.consensus, "failed")],
        value: { consumed: true, lapsed: false, mark: "consensus" },
      };
  }
}

/** The payer's own transaction under the reference, read at consensus. */
function own(transaction: string, consensus: string, result: "succeeded" | "failed"): HederaFacts["seen"][number] {
  return {
    transaction,
    position: consensus,
    mark: "consensus",
    result,
    consumed: true,
    carries: true,
    party: "payer",
    kind: "same",
    account: "payee",
  };
}

/**
 * The read of the payment by its transaction id, as the profile `read-status` answers it: the record of the id with
 * the recorded memo is the act, settled at `consensus`; another memo under the id is a consumed value and the
 * transaction's own failed result a failed act, each `pending`, `search-incomplete`, since the read has no search for H.
 */
export async function hederaStatus(ref: HederaRef, reader: HederaReader, query: HederaQuery<HederaRef>): Promise<HederaStatus> {
  return decide(factsOfHedera(await readHedera(ref, reader), ref), query, hederaLedger(HEDERA[EXACT].coverage));
}

/**
 * The hash from the landed user transaction's memo alone, for anyone holding the transaction id. A transaction id that
 * no counted user entry uses yet is `hedera/not-found`; counted user entries with no `SUCCESS` among them are
 * `hedera/not-success`: the transaction reached consensus and failed, and a later read gives the same answer. An input
 * whose `tx` is not a Mirror Node transaction id (`shard.realm.num-seconds-nanos`, as `reference` writes it), or whose
 * option is not an object, is `hedera/wrong-reader`, with nothing read; the option is not read further. One call.
 */
async function recover(
  input: RecoverInput<HederaNetwork, PaymentRequirements | MppChallenge>,
  reader: HederaReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("hedera/wrong-reader");
  if (typeof input.tx !== "string" || !MIRROR_ID.test(input.tx) || !isObject(input.option)) return refusal("hedera/wrong-reader");
  const entries = await entriesOf(input.network, input.tx, reader);
  if (entries === "not-found") return refusal("hedera/not-found");
  if (typeof entries === "string") return refusal("hedera/unreadable");
  const own = counted(entries);
  const success = own.find((e) => e.result === SUCCESS);
  if (success === undefined) return own.length === 0 ? refusal("hedera/not-found") : refusal("hedera/not-success");
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

function isHederaNetwork(s: unknown): s is HederaNetwork {
  return typeof s === "string" && (HEDERA_NETWORKS as readonly string[]).includes(s);
}

function methodOf(o: PaymentRequirements): unknown {
  return isObject(o.extra) ? o.extra["assetTransferMethod"] : undefined;
}

/** The option's common Hedera shape: `exact` on a `hedera:` network. Undefined when it is not a Hedera option. */
function onHedera(o: PaymentRequirements): boolean {
  return isObject(o) && o.scheme === "exact" && typeof o.network === "string" && o.network.startsWith("hedera:");
}

/** The option's network, asset and payee, with `extra` an object when present. */
function isNamed(o: PaymentRequirements): boolean {
  return isHederaNetwork(o.network) && (o.extra === undefined || isObject(o.extra)) && isEntity(o.asset) && isEntity(o.payTo);
}

/** Everything but the transfer method: network, asset, payee, amount and timeout. */
function isServable(o: PaymentRequirements): boolean {
  return isNamed(o) && isAmount(o.amount) && amountOf(o.amount) !== undefined && isTimeoutSeconds(o.maxTimeoutSeconds);
}

/**
 * The `cryptoTransfer` method (or none) with a `feePayer`, on a servable option: the option `advertise`, `read` and
 * `build` serve, and the one `bound` and `reference` hold a presented payment's option to. `build` writes the
 * transfers from its amount.
 */
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
 * payer's debit and the payee's credit of the option's amount, in HBAR or the option's token. H is checked first, then
 * the form of the choice's payer, node, valid start, maximum fee and decimals, then its document and option.
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
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("hedera/option-malformed");
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
  const ok = chosen(c.required, c.accepted, checkExact);
  if (ok !== true) return ok;
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

/** The signed body of a presented x402 Hedera payment, under an option `read` offers. */
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
 * The hash inside what the payer signed: the body memo, in LCP string form. The presented option is held to the filter
 * `read` applies, so a payment under an option `read` would not offer is refused. Transfers, amounts, the fee payer and
 * the payer are not read, and no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const s = signedBody(presented);
  if (isRefusal(s)) return s;
  if (s.body.memo === "") return refusal("hedera/no-memo");
  return fromLcpString(s.body.memo) ?? refusal("hedera/memo-not-lcp");
}

/**
 * The read keys, from the signed body: the mirror-form id, the memo and the end of validity; and the payee, the
 * `payTo` of the option the payment answers.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<HederaRef | Refusal> {
  const h = await bound(presented);
  if (isRefusal(h)) return h;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const { accepted, body } = signedBody(presented) as { accepted: PaymentRequirements; body: HederaBody };
  return {
    network: accepted.network as HederaNetwork,
    transactionId: txIdMirror(body.id),
    expectMemo: body.memo,
    validUntil: Number(body.id.seconds) + body.validDuration,
    payee,
  };
}

/**
 * The option unchanged: neither Hedera x402 pairing carries the hash inside the option. An option that carries a
 * `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const exactPattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: EXACT,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/hedera`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the
 * transaction's fee payer, adds its signature to the transaction the payer signed and submits it; `status` reads it by
 * its transaction id.
 */
export const exactHedera = Object.freeze({
  id: EXACT,
  data: HEDERA[EXACT],
  pattern: exactPattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: hederaStatus,
  recover,
}) satisfies Entry<
  typeof EXACT,
  HederaPaymentPayload,
  HederaRef,
  HederaReader,
  X402Forms & {
    choice: Parameters<typeof build>[0];
    unsigned: HederaUnsigned;
    landed: unknown;
    network: HederaNetwork;
    query: HederaQuery<HederaRef>;
    answer: HederaStatus;
  }
>;

// ── x402/exact/hedera/transfer-executor ─────────────────────────────────────────────────────────────────────────────

/** The core's hash over the ASCII of `payer`: the payer's identity, never shown in the clear. */
export async function hederaIdDigest(payer: string): Promise<Hex> {
  return hash(ENCODER.encode(payer));
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
 * the payment. Nothing here carries the hash. `validBefore` is `now` plus the option's `maxTimeoutSeconds`; a `now`
 * that is not a non-negative safe integer, or whose sum with `maxTimeoutSeconds` is not a safe integer, is
 * `hedera/option-malformed`. H is checked first, then the form of `now`, then the choice's document and option, then
 * the sum.
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
  if (normalHash(h) === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("hedera/option-malformed");
  if (!Number.isSafeInteger(c.now) || c.now < 0) return refusal("hedera/option-malformed");
  const ok = chosen(c.required, c.accepted, checkExecutor);
  if (ok !== true) return ok;
  const validBefore = c.now + c.accepted.maxTimeoutSeconds;
  if (!Number.isSafeInteger(validBefore)) return refusal("hedera/option-malformed");
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
      validBefore,
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
 * Read keys only: the network, the asset, the digest of the payer, and the time by which the transfer settles, counted
 * from the time `reference` runs: that time in Unix seconds plus the option's `maxTimeoutSeconds`. A sum that is not a
 * safe integer is `hedera/option-malformed`, as `build`'s `validBefore` is. The payee is the `payTo` of the option the
 * payment answers; the amount is not recorded: the facilitator builds the executor's transfer and reports what it moved.
 */
async function referenceExecutor(presented: unknown, option: PaymentRequirements): Promise<ExecutorRef | Refusal> {
  const h = await boundExecutor(presented);
  if (isRefusal(h)) return h;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const { accepted, payload } = executorPresented(presented) as { accepted: PaymentRequirements; payload: ExecutorPayload };
  const settleBy = Math.floor(Date.now() / 1000) + accepted.maxTimeoutSeconds;
  if (!Number.isSafeInteger(settleBy)) return refusal("hedera/option-malformed");
  return {
    network: accepted.network as HederaNetwork,
    asset: accepted.asset,
    payee,
    idDigest: await hederaIdDigest(payload.payer),
    settleBy,
  };
}

/**
 * Reads the merged consensus record of the named transaction: the user entry must be SUCCESS; each account's net
 * change in the asset is summed over the user entry and its children, with HIP-406 staking rewards taken back out of
 * HBAR transfers. The fee payer's rows are kept: fees are paid in HBAR, so token rows are whole, and on HBAR the fee the
 * user entry's `charged_tx_fee` names is added back to the fee payer, so a payer or payee that is also the fee payer
 * reads as what it paid or received. Exactly one account must be debited, by at least one unit, and its digest must be
 * the recorded one: the payment is the named transaction's debit of the payer; another debit is no act of the payer's.
 * Payee and amount are not read. A transfer list that is not an array, or an HBAR user entry without
 * `charged_tx_fee`, is `unparseable`, and more than 64 entries `too-large`. A ref whose `transaction` is not a Mirror
 * Node transaction id, whose `asset` is not `shard.realm.num` or whose `idDigest` is not `0x` and 64 hex digits is
 * `unparseable`, with nothing read.
 */
async function readExecutorTransfer(ref: ExecutorRef & { transaction: string }, reader: HederaReader): Promise<HederaRead> {
  if (!isObject(ref)) return { state: "unreadable", why: "unparseable" };
  const id = typeof ref.transaction === "string" ? MIRROR_ID.exec(ref.transaction) : null;
  const idDigest = normalHash(ref.idDigest);
  if (id === null || idDigest === null || !isEntity(ref.asset)) return { state: "unreadable", why: "unparseable" };
  const feePayer = id[1]!;
  const entries = await entriesOf(ref.network, ref.transaction, reader);
  if (entries === "not-found") return { state: "pending", why: "not-found" };
  if (typeof entries === "string") return { state: "unreadable", why: entries };
  if (entries.length > MAX_ENTRIES) return { state: "unreadable", why: "too-large" };
  const own = counted(entries);
  const user = own.find((e) => e.result === SUCCESS) ?? own[0];
  if (user === undefined) return { state: "pending", why: "not-found" };
  if (user.result !== SUCCESS) return { state: "failed", why: `result:${user.result}`, consensus: user.consensus_timestamp };
  const fee = ref.asset === "0.0.0" ? user.charged_tx_fee : 0;
  if (typeof fee !== "number" || !Number.isSafeInteger(fee) || fee < 0) return { state: "unreadable", why: "unparseable" };

  const merged = entries.filter((e) => e.scheduled === false && !NOT_COUNTED.has(e.result) && (e === user || e.nonce > 0));
  const net = new Map<string, bigint>();
  const credit = (account: string, amount: bigint): void => {
    net.set(account, (net.get(account) ?? 0n) + amount);
  };
  credit(feePayer, BigInt(fee));
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
    if (moves === undefined || rewards === undefined) return { state: "unreadable", why: "unparseable" };
    for (const m of moves) credit(m.account, m.amount);
    for (const r of rewards) {
      credit(r.account, -r.amount);
      credit(STAKING_REWARD_ACCOUNT, r.amount);
    }
  }
  const debited = [...net].filter(([, v]) => v < 0n);
  if (debited.length !== 1) return { state: "failed", why: "not-this-instrument" };
  const [payer] = debited[0]!;
  return (await hederaIdDigest(payer)) === idDigest
    ? { state: "settled", consensus: user.consensus_timestamp }
    : { state: "failed", why: "not-this-instrument" };
}

/**
 * The facts of a read of the transaction the facilitator named. Nothing the payer signs carries H or a single-use value
 * the read can read, so a debit of the payer that succeeded is the act, the transaction's own failed result is a
 * failed act that leaves no value read, and a transaction that debits another account is no act of the payer's.
 */
function factsOfExecutor(read: HederaRead, ref: ExecutorRef & { transaction: string }): HederaFacts {
  const none = { seen: [], search: { whole: true }, history: false } as const;
  switch (read.state) {
    case "unreadable":
      return { ...none, unreadable: read.why };
    case "settled":
      return { ...none, seen: [own(ref.transaction, read.consensus, "succeeded")] };
    case "pending":
      return none;
    case "failed":
      return "consensus" in read ? { ...none, seen: [{ ...own(ref.transaction, read.consensus, "failed"), consumed: false }] } : none;
  }
}

/**
 * The read of the executor's transfer by the transaction the facilitator named, as the profile `read-status` answers
 * it at coverage `none`: the named transaction is the act, settled at `consensus` where it debits the payer. With no
 * single-use value to read, a missing or failed transaction answers no `failed`.
 */
export async function executorStatus(
  ref: ExecutorRef & { transaction: string },
  reader: HederaReader,
  query: HederaQuery<ExecutorRef & { transaction: string }>,
): Promise<HederaStatus> {
  return decide(factsOfExecutor(await readExecutorTransfer(ref, reader), ref), query, hederaLedger(HEDERA[EXECUTOR].coverage));
}

const executorPattern: LcpPattern = deepFreeze({
  pattern: "http-advisory",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/**
 * `x402/exact/hedera/transfer-executor`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
 * facilitator submits the executor's transfer under the authorization the payer signed, and names its transaction;
 * `status` reads it.
 */
export const exactHederaExecutor = Object.freeze({
  id: EXECUTOR,
  data: HEDERA[EXECUTOR],
  pattern: executorPattern,
  claims: false as boolean,
  unplaced,
  tie,
  advertise: advertiseExecutor,
  read: readExecutor,
  build: buildExecutor,
  bound: boundExecutor,
  broadcaster: x402Broadcaster("payee"),
  reference: referenceExecutor,
  status: executorStatus,
}) satisfies Entry<
  typeof EXECUTOR,
  ExecutorPaymentPayload,
  ExecutorRef,
  HederaReader,
  X402Forms & {
    choice: Parameters<typeof buildExecutor>[0];
    unsigned: Exclude<Awaited<ReturnType<typeof buildExecutor>>, Refusal>;
    landed: { transaction: string };
    network: never;
    query: HederaQuery<ExecutorRef & { transaction: string }>;
    answer: HederaStatus;
  }
>;

export { FETCHED } from "./mpp-challenge.js";
export {
  CHANNEL_CLOSED_TOPIC,
  CHANNEL_OPENED_TOPIC,
  hederaChannelId,
  hederaVoucher,
  type HederaChannelConfig,
  type HederaCloseRef,
  type HederaEvmReader,
  type HederaSessionRef,
} from "./internal/hedera-session.js";
