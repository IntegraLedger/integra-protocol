/**
 * Hedera: the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and
 * `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only), with the transaction wire form and
 * the Mirror Node settlement read.
 *
 * The wire form is read and written by hand (protobuf, five messages). The entry point also holds the escrow channel
 * pieces `hederaChannelId` and `hederaVoucher`, and `FETCHED`, the key under which a pairing's `fetchPresented` writes
 * the seller's read onto a credential.
 *
 * @module
 */
import { canonicalJson, fromLcpString, fromLegalContext, hash, toLcpString, type AtrHash, type Json } from "./core.js";
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
import { fromBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { HEDERA } from "./internal/data/hedera.js";
import {
  decide,
  type Facts,
  type Ledger,
  type Moved,
  type RecoverInput,
  type Undecoded,
  type StatusAnswer,
  type StatusQuery,
  type UnreadableReason,
} from "./internal/read.js";
import {
  completeWith,
  consensusKey,
  counted,
  decides,
  ENCODER,
  entriesOf,
  FEE_ACCOUNTS,
  fieldsOf,
  int64Of,
  isEntry,
  MAX_ROWS,
  memoOf,
  netOf,
  NOT_COUNTED,
  partiesOf,
  single,
  UINT64_LIMIT,
  writeBody,
  type Field,
} from "./internal/hedera-wire.js";
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

/** One row of a transfer list, as the signed body or the mirror holds it: the account and its signed change. */
export interface HederaRow {
  account: string;
  /** The change in the asset's smallest unit, a decimal integer, negative for a debit. */
  amount: string;
  /** `is_approval`: true where the row spends an allowance the account granted, so the account did not sign it. */
  isApproval: boolean;
}

/** A crypto transfer as the signed body holds it: its HBAR rows, and its rows per token. */
export interface HederaTransfer {
  hbar: readonly HederaRow[];
  tokens: readonly { token: string; rows: readonly HederaRow[] }[];
}

export interface HederaBody {
  id: HederaTxId;
  /** `nodeAccountID`: the node the body is for. */
  node: string;
  /** `transactionFee`: the most the fee payer pays, in tinybars, a decimal integer. */
  maxFee: string;
  /** `transactionValidDuration`, in seconds. */
  validDuration: number;
  memo: string;
  /** The body's `cryptoTransfer`; absent where the body is another transaction. */
  transfer?: HederaTransfer;
  bodyBytes: Uint8Array<ArrayBuffer>;
}

/** A transfer row of a Mirror Node entry: `transfers`, `token_transfers` (with `token_id`) or `staking_reward_transfers`. */
export interface MirrorRow {
  account: string;
  amount: number;
  is_approval?: boolean;
  token_id?: string;
}

/** The Mirror Node's `Transaction` entry: the fields read here. */
export interface MirrorEntry {
  result: string;
  memo_base64: string | null;
  nonce: number;
  scheduled: boolean;
  consensus_timestamp: string;
  /** The transaction id, `shard.realm.num-seconds-nanos`. */
  transaction_id?: string;
  /** The transaction's type: `CRYPTOTRANSFER` for a transfer. */
  name?: string;
  /** The node the transaction was submitted through. */
  node?: string | null;
  max_fee?: string;
  valid_duration_seconds?: string;
  valid_start_timestamp?: string;
  /** The fee charged to the transaction's fee payer, in tinybars; its `transfers` row includes it. */
  charged_tx_fee?: number;
  transfers?: readonly MirrorRow[];
  token_transfers?: readonly MirrorRow[];
  /**
   * HIP-406 staking rewards paid by this transaction, in tinybars. `transfers` already holds each account's total
   * change, so a reward is in the rewarded account's credit there, and the staking reward account `0.0.800` pays it.
   */
  staking_reward_transfers?: readonly MirrorRow[];
  /** The custom fees a token transfer assessed (the detail of `GET /api/v1/transactions/{id}`); they change its rows. */
  assessed_custom_fees?: readonly unknown[];
}

/** One page of the account's transactions: the answer's `transactions` and its `links.next`. */
export interface MirrorPage {
  transactions: readonly MirrorEntry[];
  next: string | null;
}

/** Bounded, read-only calls against one network's Mirror Node. Every failure rejects. */
export interface HederaReader {
  readonly network: HederaNetwork;
  /** `GET /api/v1/transactions/{id}`: the answer's `transactions`; null on the mirror's 404 for the id. */
  transactions(mirrorId: string): Promise<readonly MirrorEntry[] | null>;
  /**
   * The mirror's latest consensus timestamp: the end of its newest block, `timestamp.to` of
   * `GET /api/v1/blocks?order=desc&limit=1`.
   */
  latest(): Promise<string>;
  /**
   * How far back the mirror holds records: the start of its oldest block, `timestamp.from` of
   * `GET /api/v1/blocks?order=asc&limit=1`, or `archival` where the endpoint is declared archival.
   */
  oldest(): Promise<string | "archival">;
  /**
   * One page of an account's transactions, oldest first: `GET /api/v1/transactions` with `account.id` the account,
   * `timestamp` `gt:` `after` and `lte:` `until`, `order` `asc` and `limit` 100.
   */
  accountTransactions(q: { account: string; after: string; until: string }): Promise<MirrorPage>;
}

/** The members of the body the payer signed that the read compares with the landed entry, as presented. */
export interface HederaPresented {
  /** The node of each body the presented list holds; one for a single `Transaction`. */
  nodes: readonly string[];
  maxFee: string;
  transfer: HederaTransfer;
}

/** The read keys `reference` returns. */
export interface HederaRef {
  network: HederaNetwork;
  /** The transaction id, the single-use value, in the Mirror Node's form. */
  transactionId: string;
  /** The valid start the id names, as a consensus timestamp `seconds.nanos`, nanoseconds in nine digits. */
  validStart: string;
  /** `transactionValidDuration`, in seconds. */
  validDuration: number;
  /** The body's memo: H's LCP string. */
  expectMemo: string;
  /** The one account the signed body debits: the payer, the signer the read names, and the search's key. */
  payer: string;
  /** The option's `payTo`. */
  payee: string;
  /** The rest of the members of the payment presented. */
  presented: HederaPresented;
}

/**
 * The answer of `hederaStatus` and `executorStatus`: positions are the Mirror Node's `consensus_timestamp`
 * (`seconds.nanos`), and the one mark is `consensus`, the record the Mirror Node serves, which is final. A `settled`
 * answer of `hederaStatus` states `presented` (the profile `x402/exact/hedera`, rule 12).
 */
export type HederaStatus = StatusAnswer<string, "consensus", string>;

/** The body the payer signs, and how its signature completes the wire transaction. */
export interface HederaUnsigned {
  request: { kind: "hedera-body"; bodyBytes: Uint8Array<ArrayBuffer> };
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
/**
 * The chain's longest `transactionValidDuration`, `transaction.maxValidDuration`, in seconds: a body above it never
 * reaches consensus (`INVALID_TRANSACTION_DURATION`).
 */
const MAX_VALID_DURATION = 180;
const MAX_EXECUTORS = 16;
const MAX_AUTHORIZATION_HEX = 8192;
/** The most pages of the payer's transactions one read reads before it answers with the search's position. */
const MAX_SEARCH_PAGES = 8;
/** The most entries one page of the payer's transactions holds: the `limit` the search asks for. */
const PAGE_LIMIT = 100;
const SUCCESS = "SUCCESS";
const MIRROR_ID = /^((?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18}))-(\d{1,19})-(\d{1,9})$/;
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ── protobuf, read ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Reads a wire `Transaction`, or the SDK's `TransactionList` of them (a top-level field 1): each body's transaction
 * id, node, maximum fee, valid duration, memo, crypto transfer and exact bytes, the bytes a copy of `wire`'s. Every
 * body of a list must equal the first in all but its node, else `hedera/list-inconsistent`; a valid duration above
 * the chain's 180 seconds is `hedera/valid-duration`.
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
  const first = withoutNode(bodies[0]!.bodyBytes);
  return bodies.every((b) => withoutNode(b.bodyBytes) === first) ? { bodies } : refusal("hedera/list-inconsistent");
}

/** A body's fields other than `nodeAccountID` (2), in wire order, as one comparable string. */
function withoutNode(bodyBytes: Uint8Array): string {
  return (fieldsOf(bodyBytes) ?? [])
    .filter((f) => f.n !== 2)
    .map((f) => `${f.n}:${f.wt}:${f.varint}:${Array.from(f.bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`)
    .join(",");
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
  if (body === "duration") return refusal("hedera/valid-duration");
  return body === null ? refusal("hedera/tx-malformed") : body;
}

/**
 * `TransactionBody`: `transactionID` (1), `nodeAccountID` (2), `transactionFee` (3), `transactionValidDuration` (4),
 * `memo` (6) and `cryptoTransfer` (14). Null where the body is not well formed; `duration` where its valid duration is
 * above the chain's maximum.
 */
function bodyOf(bodyBytes: Uint8Array, depth: number): HederaBody | "duration" | null {
  if (depth + 3 > MAX_DEPTH) return null;
  const fields = fieldsOf(bodyBytes);
  if (fields === null) return null;
  const idField = single(fields, 1, 2);
  const nodeField = single(fields, 2, 2);
  const feeField = single(fields, 3, 0);
  const durationField = single(fields, 4, 2);
  const memoField = single(fields, 6, 2);
  const transferField = single(fields, 14, 2);
  if (!idField || !nodeField || feeField === null || durationField === null || memoField === null || transferField === null) {
    return null;
  }

  const idFields = fieldsOf(idField.bytes);
  if (idFields === null) return null;
  const startField = single(idFields, 1, 2);
  const accountField = single(idFields, 2, 2);
  if (!startField || !accountField) return null;
  const start = fieldsOf(startField.bytes);
  const account = accountOf(accountField.bytes);
  const node = accountOf(nodeField.bytes);
  if (start === null || account === null || node === null) return null;
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
    if (v < 0n) return null;
    if (v > BigInt(MAX_VALID_DURATION)) return "duration";
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
  let transfer: HederaTransfer | undefined;
  if (transferField !== undefined) {
    const t = transferOf(transferField.bytes);
    if (t === null) return null;
    transfer = t;
  }
  return {
    id: { account, seconds: s, nanos: Number(ns) },
    node,
    maxFee: (feeField === undefined ? 0n : feeField.varint).toString(),
    validDuration,
    memo,
    ...(transfer === undefined ? {} : { transfer }),
    bodyBytes: new Uint8Array(bodyBytes),
  };
}

/**
 * `CryptoTransferTransactionBody`: `transfers` (1), a `TransferList` of `AccountAmount`s, and `tokenTransfers` (2),
 * each a `TokenTransferList` of `token` (1), `transfers` (2) and `expected_decimals` (4). Null for any other field, NFT
 * transfers (3) among them, or a row that is not an `AccountAmount` of `accountID` (1), `amount` (2) and
 * `is_approval` (3) alone.
 */
function transferOf(bytes: Uint8Array): HederaTransfer | null {
  const fields = fieldsOf(bytes);
  if (fields === null || fields.some((f) => f.n !== 1 && f.n !== 2) || fields.some((f) => f.wt !== 2)) return null;
  const list = single(fields, 1, 2);
  if (list === null) return null;
  let hbar: HederaRow[] = [];
  if (list !== undefined) {
    const rows = rowsOf(list.bytes, 1);
    if (rows === null) return null;
    hbar = rows;
  }
  const tokens: { token: string; rows: HederaRow[] }[] = [];
  for (const f of fields.filter((x) => x.n === 2)) {
    const t = fieldsOf(f.bytes);
    if (t === null || t.some((x) => x.n !== 1 && x.n !== 2 && x.n !== 4)) return null;
    const token = single(t, 1, 2);
    if (!token) return null;
    const id = accountOf(token.bytes);
    const rows = rowsOf(f.bytes, 2);
    if (id === null || rows === null) return null;
    tokens.push({ token: id, rows });
  }
  return { hbar, tokens };
}

/** The `AccountAmount`s numbered `n` in a message. */
function rowsOf(bytes: Uint8Array, n: number): HederaRow[] | null {
  const fields = fieldsOf(bytes);
  if (fields === null) return null;
  const out: HederaRow[] = [];
  for (const f of fields.filter((x) => x.n === n)) {
    if (f.wt !== 2) return null;
    const a = fieldsOf(f.bytes);
    if (a === null || a.some((x) => x.n < 1 || x.n > 3)) return null;
    const id = single(a, 1, 2);
    const amount = single(a, 2, 0);
    const approval = single(a, 3, 0);
    if (!id || amount === null || approval === null) return null;
    const account = accountOf(id.bytes);
    if (account === null) return null;
    const z = amount === undefined ? 0n : amount.varint;
    const value = z & 1n ? -((z + 1n) >> 1n) : z >> 1n;
    out.push({ account, amount: value.toString(), isApproval: approval !== undefined && approval.varint !== 0n });
  }
  return out;
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

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────────

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

export type HederaQuery<Ref> = StatusQuery<Ref, string, "consensus", string>;
type HederaFacts = Facts<string, "consensus", string>;
type HederaSeen = HederaFacts["seen"][number];

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * An entry's facts against the payer the reference names and the option's payee, from what landed: its signer, the
 * one account its rows debit, or the fee payer where they debit none (an act of another kind); `payee` where the payee
 * is among the accounts debited, `payer` where the payer is the one account debited and spent no allowance, `other`
 * otherwise; the account it names, `payee` where its rows credit the payee, `other` where they credit another account
 * and `none` where they credit only the node and the fee accounts; and what moved, each credited account with its
 * asset. Null where a member the read needs is not well formed.
 */
async function entryFacts(
  entries: readonly MirrorEntry[],
  payee: string,
  payerMatches: (account: string) => boolean | Promise<boolean>,
): Promise<Pick<HederaSeen, "transaction" | "position" | "party" | "account" | "moved" | "signer"> | null> {
  const user = entries[0]!;
  const id = typeof user.transaction_id === "string" ? MIRROR_ID.exec(user.transaction_id) : null;
  if (id === null) return null;
  const net = netOf(entries, id[1]!);
  if (net === null) return null;
  const { debited, approved, credited } = partiesOf(net, user.node, user.transaction_id!);
  const signers = debited.size === 0 ? [id[1]!] : [...debited];
  const one = signers.length === 1 ? signers[0]! : undefined;
  const party = signers.includes(payee) ? "payee" : one !== undefined && !approved && (await payerMatches(one)) ? "payer" : "other";
  const account = credited.some((m) => m.to === payee) ? "payee" : credited.length > 0 ? "other" : "none";
  return {
    transaction: user.transaction_id!,
    position: user.consensus_timestamp,
    party,
    account,
    moved: credited,
    ...(one === undefined ? {} : { signer: one }),
  };
}

/** The account the presented body names: `payee` where it credits the payee, `other` where it credits another, else `none`. */
function signedCredit(ref: HederaRef): "payee" | "other" | "none" {
  const rows = [...ref.presented.transfer.hbar, ...ref.presented.transfer.tokens.flatMap((t) => t.rows)];
  const credited = rows.filter((r) => BigInt(r.amount) > 0n).map((r) => r.account);
  return credited.includes(ref.payee) ? "payee" : credited.length > 0 ? "other" : "none";
}

/** The transaction ids of the other acts the caller gave, by transaction or by reference, in the mirror's form. */
function givenIds(others: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(others)) return out;
  for (const o of others as readonly unknown[]) {
    if (!isObject(o)) continue;
    const t = "ref" in o ? (isObject(o["ref"]) ? (o["ref"]["transactionId"] ?? o["ref"]["transaction"]) : undefined) : o["transaction"];
    const m = typeof t === "string" ? mirrorFormOf(t) : null;
    if (m !== null) out.add(m);
  }
  return out;
}

/** A transaction id in either spelling, `shard.realm.num@seconds.nanos` or the mirror's, in the mirror's; else null. */
function mirrorFormOf(t: string): string | null {
  if (MIRROR_ID.test(t)) return t;
  const m = /^((?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18})\.(?:0|[1-9][0-9]{0,18}))@(\d{1,19})\.(\d{1,9})$/.exec(t);
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]!.padStart(9, "0")}`;
}

/** A decimal integer as `reference` writes a row's amount or the maximum fee: at most 20 digits, signed where `signed`. */
function isDecimal(v: unknown, signed: boolean): boolean {
  return typeof v === "string" && (signed ? /^-?(?:0|[1-9][0-9]{0,19})$/ : /^(?:0|[1-9][0-9]{0,19})$/).test(v);
}

/** Rows as `reference` writes them: each an entity account, a signed decimal amount and a boolean `isApproval`. */
function isRows(rows: unknown): boolean {
  return (
    Array.isArray(rows) &&
    rows.length <= MAX_ROWS &&
    rows.every((r) => isObject(r) && isEntity(r["account"]) && isDecimal(r["amount"], true) && typeof r["isApproval"] === "boolean")
  );
}

/** The payment presented as `reference` writes it: each body's node, the maximum fee and the transfer rows. */
function isPresented(p: unknown): boolean {
  if (!isObject(p) || !isObject(p["transfer"])) return false;
  const { hbar, tokens } = p["transfer"];
  return (
    Array.isArray(p["nodes"]) &&
    p["nodes"].length >= 1 &&
    p["nodes"].length <= MAX_LIST &&
    p["nodes"].every(isEntity) &&
    isDecimal(p["maxFee"], false) &&
    isRows(hbar) &&
    Array.isArray(tokens) &&
    tokens.length <= MAX_ROWS &&
    tokens.every((t) => isObject(t) && isEntity(t["token"]) && isRows(t["rows"]))
  );
}

/** Whether a reference is one `hederaStatus` reads: every member in its form. */
function isHederaRef(ref: unknown): ref is HederaRef {
  if (!isObject(ref) || !isHederaNetwork(ref["network"])) return false;
  return (
    typeof ref["transactionId"] === "string" &&
    MIRROR_ID.test(ref["transactionId"]) &&
    consensusKey(ref["validStart"]) >= 0n &&
    Number.isSafeInteger(ref["validDuration"]) &&
    (ref["validDuration"] as number) >= 0 &&
    typeof ref["expectMemo"] === "string" &&
    isEntity(ref["payer"]) &&
    typeof ref["payee"] === "string" &&
    isPresented(ref["presented"])
  );
}

/**
 * The search for H over the payer's transactions: the acts it found, the entries it could not decode, each with the
 * position held at it, and its position. It is never read whole (`searchForH`).
 */
type Search = { seen: HederaSeen[]; undecoded: Undecoded<string>[]; at?: string };

/**
 * The search for H (the profile `x402/exact/hedera`, rule 13): the payer's transactions after `from` up to `until`,
 * the mirror's latest consensus timestamp read first, page by page, each entry that decides and whose memo is H's
 * string byte for byte classified; an entry under the presented id is the one the id's read already holds. Its
 * position is the consensus timestamp of the last entry read, where the last page names no next page, a page is left
 * at the read's bound, or the reader refused a page. It is never read whole: three facts it rests on are not yet shown
 * by a run (the profile `x402/exact/hedera`, rule 13), so it proves no absence and every `failed` but `before-position`
 * waits. An entry it cannot decode is named by its transaction id, the position held one nanosecond before its
 * consensus timestamp, and the search reads on.
 */
async function searchForH(
  ref: HederaRef,
  reader: HederaReader,
  from: string,
  until: string,
  classify: (e: MirrorEntry) => Promise<HederaSeen | null | undefined>,
): Promise<Search> {
  const seen: HederaSeen[] = [];
  const undecoded: Undecoded<string>[] = [];
  let cursor = from;
  pages: for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    let answer: MirrorPage;
    try {
      answer = await reader.accountTransactions({ account: ref.payer, after: cursor, until });
    } catch {
      break;
    }
    if (!isObject(answer) || !Array.isArray(answer.transactions) || answer.transactions.length > PAGE_LIMIT) break;
    if (answer.next !== null && typeof answer.next !== "string") break;
    for (const e of answer.transactions as readonly unknown[]) {
      const t = isObject(e) ? e["consensus_timestamp"] : undefined;
      const k = consensusKey(t);
      // An entry with no consensus timestamp in the range cannot be placed: the search holds where it is.
      if (k <= consensusKey(cursor) || k > consensusKey(until)) break pages;
      const id = isObject(e) && typeof e["transaction_id"] === "string" && MIRROR_ID.test(e["transaction_id"]) ? e["transaction_id"] : undefined;
      const s = isEntry(e) ? (e.transaction_id === ref.transactionId ? undefined : await classify(e)) : null;
      if (s === null) undecoded.push({ transaction: id ?? (t as string), at: previous(t as string) });
      else if (s !== undefined) seen.push(s);
      cursor = t as string;
    }
    if (answer.next === null || answer.transactions.length === 0) break;
  }
  return { seen, undecoded, at: cursor };
}

/** The consensus timestamp one nanosecond before `t`, so that a search resumed after it reads `t` again. */
function previous(t: string): string {
  const k = consensusKey(t) - 1n;
  return `${k / 1_000_000_000n}.${String(k % 1_000_000_000n).padStart(9, "0")}`;
}

/** Whether the mirror holds records back to `t`: the start of its oldest block at or before `t`, or archival. */
async function holds(reader: HederaReader, t: string): Promise<boolean | UnreadableReason> {
  let oldest: string;
  try {
    oldest = await reader.oldest();
  } catch {
    return "transport";
  }
  if (oldest === "archival") return true;
  if (consensusKey(oldest) < 0n) return "unparseable";
  return consensusKey(oldest) <= consensusKey(t);
}

/** The mirror's latest consensus timestamp, read first. */
async function latestOf(reader: HederaReader): Promise<string | UnreadableReason> {
  try {
    const t = await reader.latest();
    return consensusKey(t) >= 0n ? t : "unparseable";
  } catch {
    return "transport";
  }
}

/**
 * Whether the landed entry is the body presented, member by member as the mirror shows it (the profile
 * `x402/exact/hedera`, rule 12): the transaction id and valid start, the memo, the valid duration, the maximum fee,
 * the node, any the presented list names, and the transfer rows: each HBAR row read with its staking reward taken out
 * and the fee added back, the rows of the node and of the fee accounts and the rows that net to zero set aside, and the
 * token rows. `unshown` where the entry lacks a member, the body itself lists the node or a fee account, or the entry
 * assessed a custom fee. An entry with no `assessed_custom_fees`, a member the mirror's `TransactionDetail` makes
 * optional and leaves out where no custom fee is assessed, assessed none, as one with `[]`; a member that is not an
 * array is not shown.
 */
function presentedOf(e: MirrorEntry, ref: HederaRef): "yes" | "no" | "unshown" {
  const p = ref.presented;
  if (
    typeof e.transaction_id !== "string" ||
    typeof e.valid_start_timestamp !== "string" ||
    typeof e.valid_duration_seconds !== "string" ||
    typeof e.max_fee !== "string" ||
    typeof e.node !== "string" ||
    (e.assessed_custom_fees !== undefined && !Array.isArray(e.assessed_custom_fees))
  ) {
    return "unshown";
  }
  const listed = [...p.transfer.hbar, ...p.transfer.tokens.flatMap((t) => t.rows)].map((r) => r.account);
  if ((e.assessed_custom_fees ?? []).length > 0 || listed.some((a) => a === e.node || FEE_ACCOUNTS.has(a) || p.nodes.includes(a))) {
    return "unshown";
  }
  const memo = memoOf(e);
  if (
    e.transaction_id !== ref.transactionId ||
    consensusKey(e.valid_start_timestamp) !== consensusKey(ref.validStart) ||
    memo === null ||
    !sameBytes(memo, ENCODER.encode(ref.expectMemo)) ||
    e.valid_duration_seconds !== String(ref.validDuration) ||
    e.max_fee !== p.maxFee ||
    !p.nodes.includes(e.node)
  ) {
    return "no";
  }
  const net = netOf([e], ref.transactionId.split("-")[0]!);
  if (net === null) return "unshown";
  const landed: string[] = [];
  for (const [asset, byAccount] of net) {
    for (const [account, c] of byAccount) {
      if (c.amount === 0n || (asset === "0.0.0" && (account === e.node || FEE_ACCOUNTS.has(account)))) continue;
      landed.push(`${asset}|${account}|${c.amount}|${c.approval}`);
    }
  }
  const body = [
    ...p.transfer.hbar.map((r) => `0.0.0|${r.account}|${r.amount}|${r.isApproval && BigInt(r.amount) < 0n}`),
    ...p.transfer.tokens.flatMap((t) => t.rows.map((r) => `${t.token}|${r.account}|${r.amount}|${r.isApproval && BigInt(r.amount) < 0n}`)),
  ];
  return landed.length === body.length && body.every((r) => landed.includes(r)) ? "yes" : "no";
}

/**
 * The read of the act the query asks about (the profiles `read-status` and `x402/exact/hedera`). The mirror's latest
 * consensus timestamp is read first, then the entries under the presented transaction id, its single-use value. An
 * entry under the id that decides consumed the id: it is the act where it succeeded, its memo is H's string, it is the
 * payer's own transfer and, for the act `payment`, it credits the option's payee; a failed result under the id is the
 * act's own failed result. With no such entry the id is unconsumed, live while the mirror holds records back to the
 * valid start (else `history-gap`), and lapsed once the valid start plus the valid duration is strictly before the
 * timestamp read first. Before a
 * `failed`, the search for H over the payer's transactions, from the position the caller gives, or the search position
 * an earlier answer returned, to that timestamp; an act it finds is the act, and with none found the answer is
 * `pending`, `search-incomplete`, at the search's position, the search proving no absence until a run shows its three
 * facts. A `settled` answer states `presented`.
 */
export async function hederaStatus(ref: HederaRef, reader: HederaReader, query: HederaQuery<HederaRef>): Promise<HederaStatus> {
  const ledger = hederaLedger(HEDERA[EXACT].coverage);
  const unreadable = (reason: UnreadableReason): HederaStatus => ({ state: "unreadable", reason, foreign: [] });
  if (!isHederaRef(ref)) return unreadable("unparseable");
  // A query that is not one asking about an act is unparseable, as `decide` answers it, before anything is read.
  if (!isObject(query) || (query.act !== "payment" && query.act !== "agreement")) return unreadable("unparseable");
  if (!isObject(reader) || reader.network !== ref.network) return unreadable("chain-mismatch");
  const head = await latestOf(reader);
  if (consensusKey(head) < 0n) return unreadable(head as UnreadableReason);
  const entries = await entriesOf(ref.network, ref.transactionId, reader);
  if (entries !== "not-found" && typeof entries === "string") return unreadable(entries);
  const given = givenIds(query.others);
  const memo = ENCODER.encode(ref.expectMemo);
  const kindOf = (e: MirrorEntry): "same" | "other" | null =>
    typeof e.name !== "string" ? null : e.name === "CRYPTOTRANSFER" ? "same" : "other";

  /**
   * An entry's facts, with `presented`: the entry under the id compared with the body presented (rule 12), and any
   * other `no`, its transaction id differing; null where it cannot be parsed.
   */
  const classify = async (group: readonly MirrorEntry[], consumed: boolean): Promise<HederaSeen | null> => {
    const e = group[0]!;
    const m = memoOf(e);
    const kind = kindOf(e);
    if (m === null || kind === null) return null;
    const read = await entryFacts(group, ref.payee, (a) => a === ref.payer);
    if (read === null) return null;
    const failed = e.result !== SUCCESS;
    // A failed result under the id is the act's own (the profile `x402/exact/hedera`, rule 11): its rows show the fee
    // alone, so they name no signer and move nothing. The account it names is the one the body presented credits, by
    // that rule and not by a read: the id names the settler, whose key could land another body under it, and the mirror
    // shows nothing of what a failed body would have credited. Whether it carries H is read from its memo.
    const { signer, ...facts } = read;
    return {
      ...facts,
      ...(failed && consumed
        ? { party: "payer" as const, kind: "same" as const, account: signedCredit(ref) }
        : { kind, ...(signer === undefined ? {} : { signer }) }),
      mark: "consensus",
      result: failed ? "failed" : "succeeded",
      consumed,
      carries: sameBytes(m, memo),
      presented: consumed ? presentedOf(e, ref) : "no",
      ...(given.has(facts.transaction) ? { given: true } : {}),
    };
  };

  const seen: HederaSeen[] = [];
  const own = entries === "not-found" ? [] : counted(entries);
  const under = own[0];
  let underSeen: HederaSeen | undefined;
  if (under !== undefined) {
    const s = await classify([under], true);
    if (s === null) return unreadable("unparseable");
    underSeen = s;
    seen.push(s);
  }
  const validEnd = consensusKey(ref.validStart) + BigInt(ref.validDuration) * 1_000_000_000n;
  const lapsed = under === undefined && validEnd < consensusKey(head);
  const isAct = (s: HederaSeen): boolean =>
    s.result === "succeeded" &&
    s.carries &&
    s.party === "payer" &&
    s.kind === "same" &&
    s.given !== true &&
    (query.act === "agreement" || s.account === "payee");

  let search: Search = { seen: [], undecoded: [] };
  let history = false;
  if (under === undefined && !lapsed) {
    // The id is unconsumed and its validity open: the act can still land under it, where the mirror holds records back
    // to the valid start, so that no entry under the id lies before them.
    const held = await holds(reader, ref.validStart);
    if (typeof held === "string") return unreadable(held);
    if (!held) return unreadable("history-gap");
    history = true;
  } else if (underSeen === undefined || !isAct(underSeen)) {
    const from = typeof query.search === "string" ? query.search : typeof query.after === "string" ? query.after : "0.0";
    const back = typeof query.after === "string" ? query.after : "0.0";
    const held = await holds(reader, under === undefined && consensusKey(ref.validStart) < consensusKey(back) ? ref.validStart : back);
    if (typeof held === "string") return unreadable(held);
    if (!held) return unreadable("history-gap");
    history = true;
    search = await searchForH(ref, reader, from, head, async (e) => {
      if (!decides(e)) return undefined;
      const m = memoOf(e);
      if (m === null) return null;
      return sameBytes(m, memo) ? classify([e], false) : undefined;
    });
  }
  const facts: HederaFacts = {
    seen: [...seen, ...search.seen],
    // One mark, the latest consensus timestamp, which is final: the value read at the final mark is read at the head.
    value: { consumed: under !== undefined, lapsed, mark: "consensus", head: { consumed: under !== undefined } },
    search: { whole: false, ...(search.at === undefined ? {} : { at: search.at }) },
    history,
    ...(search.undecoded.length === 0 ? {} : { undecoded: search.undecoded }),
  };
  return decide(facts, query, ledger);
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
  if (startsLater(vs)) return refusal("hedera/valid-start-future");
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

/**
 * Whether a valid start is later than the time of the check: the network takes no valid start later than its consensus
 * time (HAPI `ResponseCode` `INVALID_TRANSACTION_START`).
 */
function startsLater(vs: { seconds: bigint; nanos: number }): boolean {
  return vs.seconds * 1_000_000_000n + BigInt(vs.nanos) > BigInt(Date.now()) * 1_000_000n;
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
 * The hash inside what the payer signed: the body memo, byte for byte H's LCP string, `lcp:sha256:0x` and 64 lowercase
 * hex digits; an empty memo is `hedera/no-memo` and any other `hedera/memo-not-lcp`, an uppercase digit among them,
 * since the read settles only on the exact string. A body whose valid start is later than the time of the check is
 * `hedera/valid-start-future`, as the network refuses it. The presented option is held to the filter `read` applies,
 * so a payment under an option `read` would not offer is refused. Transfers, amounts, the fee payer and the payer are
 * not read, and no signature is verified here.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const s = signedBody(presented);
  if (isRefusal(s)) return s;
  if (startsLater(s.body.id)) return refusal("hedera/valid-start-future");
  if (s.body.memo === "") return refusal("hedera/no-memo");
  const h = fromLcpString(s.body.memo);
  return h !== null && toLcpString(h) === s.body.memo ? h : refusal("hedera/memo-not-lcp");
}

/**
 * The one account a crypto transfer debits, by its rows in every asset; undefined where the body is no crypto
 * transfer, or its rows debit no account or more than one.
 */
function debitedBy(t: HederaTransfer | undefined): string | undefined {
  if (t === undefined) return undefined;
  const debited = new Set([...t.hbar, ...t.tokens.flatMap((x) => x.rows)].filter((r) => BigInt(r.amount) < 0n).map((r) => r.account));
  return debited.size === 1 ? [...debited][0] : undefined;
}

/**
 * The read keys, from the signed body: the mirror-form id, its valid start to the nanosecond, the valid duration, the
 * memo, the one account the body debits, which is the payer, and the members of the payment presented (each body's
 * node, the maximum fee and the transfer rows); and the payee, the `payTo` of the option the payment answers. A
 * presented `accepted` that is not that option, compared by its RFC 8785 form, is `x402/accepted-not-option`; a
 * body that is no crypto transfer, or whose rows do not debit exactly one account, is `hedera/tx-malformed`; and one
 * whose debited account is the account the transaction id names, the fee payer, is `hedera/payer-not-buyer`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<HederaRef | Refusal> {
  const h = await bound(presented);
  if (isRefusal(h)) return h;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const { accepted } = signedBody(presented) as { accepted: PaymentRequirements; body: HederaBody };
  if (canonicalJson(accepted as unknown as Json) !== canonicalJson(option as unknown as Json)) return refusal("x402/accepted-not-option");
  const wire = fromBase64((presented as { payload: { transaction: string } }).payload.transaction)!;
  const { bodies } = decodeHederaTx(wire) as { bodies: readonly HederaBody[] };
  const body = bodies[0]!;
  const payer = debitedBy(body.transfer);
  if (payer === undefined) return refusal("hedera/tx-malformed");
  if (payer === body.id.account) return refusal("hedera/payer-not-buyer");
  return {
    network: accepted.network as HederaNetwork,
    transactionId: txIdMirror(body.id),
    validStart: `${body.id.seconds}.${String(body.id.nanos).padStart(9, "0")}`,
    validDuration: body.validDuration,
    expectMemo: body.memo,
    payer,
    payee,
    presented: { nodes: bodies.map((b) => b.node), maxFee: body.maxFee, transfer: body.transfer! },
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
 * payment answers; a presented `accepted` that is not that option, compared by its RFC 8785 form, is
 * `x402/accepted-not-option`. The amount is not recorded: the facilitator builds the executor's transfer and reports
 * what it moved.
 */
async function referenceExecutor(presented: unknown, option: PaymentRequirements): Promise<ExecutorRef | Refusal> {
  const h = await boundExecutor(presented);
  if (isRefusal(h)) return h;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const { accepted, payload } = executorPresented(presented) as { accepted: PaymentRequirements; payload: ExecutorPayload };
  if (canonicalJson(accepted as unknown as Json) !== canonicalJson(option as unknown as Json)) return refusal("x402/accepted-not-option");
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
 * The read of the executor's transfer by the transaction the facilitator named, as the profile `read-status` answers
 * it at coverage `none` (the profile `x402/exact/hedera`, rule 15): the named transaction is the act, read in its
 * merged consensus record, the user entry and its child entries, each account's net change in every asset taken with
 * HIP-406 staking rewards taken back out and the user entry's `charged_tx_fee` added back to the fee payer. Its signer
 * is the one account the record debits, which is the payer where its digest is the one `reference` recorded and the
 * option's payee where it is that account; it pays where it credits the payee. The named transaction id is single-use:
 * an entry under it that decides consumed it, and with none it lapses once its valid start plus the chain's longest
 * valid duration, 180 seconds, is strictly before the mirror's latest consensus timestamp, read first, the mirror
 * holding records back to that valid start; no search is made, the act being the transaction named. A ref whose
 * `transaction` is not a Mirror Node transaction id, whose `asset` is not `shard.realm.num` (it is read for nothing
 * else), or whose `idDigest` is not `0x` and 64 hex digits, is
 * `unparseable`, with nothing read; a record whose rows are not well formed is `unparseable`, and more than 64 entries
 * `too-large`.
 */
export async function executorStatus(
  ref: ExecutorRef & { transaction: string },
  reader: HederaReader,
  query: HederaQuery<ExecutorRef & { transaction: string }>,
): Promise<HederaStatus> {
  const unreadable = (reason: UnreadableReason): HederaStatus => ({ state: "unreadable", reason, foreign: [] });
  if (!isObject(ref)) return unreadable("unparseable");
  const id = typeof ref.transaction === "string" ? MIRROR_ID.exec(ref.transaction) : null;
  const idDigest = normalHash(ref.idDigest);
  if (id === null || idDigest === null || !isEntity(ref.asset) || typeof ref.payee !== "string") return unreadable("unparseable");
  if (!isObject(reader) || reader.network !== ref.network) return unreadable("chain-mismatch");
  const head = await latestOf(reader);
  if (consensusKey(head) < 0n) return unreadable(head as UnreadableReason);
  const entries = await entriesOf(ref.network, ref.transaction, reader);
  if (entries !== "not-found" && typeof entries === "string") return unreadable(entries);
  const own = entries === "not-found" ? [] : counted(entries);
  const user = own.find((e) => e.result === SUCCESS) ?? own[0];
  // The id's nanoseconds are an integer, as `txIdMirror` writes them: one valid start for the lapse and the history.
  const validStart = BigInt(id[2]!) * 1_000_000_000n + BigInt(id[3]!);
  const ledger = hederaLedger(HEDERA[EXECUTOR].coverage);
  if (user === undefined) {
    const held = await holds(reader, `${id[2]}.${id[3]!.padStart(9, "0")}`);
    if (typeof held === "string") return unreadable(held);
    if (!held) return unreadable("history-gap");
    const lapsed = validStart + BigInt(MAX_VALID_DURATION) * 1_000_000_000n < consensusKey(head);
    const facts: HederaFacts = {
      seen: [],
      value: { consumed: false, lapsed, mark: "consensus", head: { consumed: false } },
      search: { whole: true },
      history: true,
    };
    return decide(facts, query, ledger);
  }
  const merged = (entries as readonly MirrorEntry[]).filter((e) => e === user || (e.scheduled === false && !NOT_COUNTED.has(e.result) && e.nonce > 0));
  const facts = await entryFacts([{ ...user, transaction_id: ref.transaction }, ...merged.filter((e) => e !== user)], ref.payee, async (a) => (await hederaIdDigest(a)) === idDigest);
  if (facts === null) return unreadable("unparseable");
  const given = givenIds(isObject(query) ? query.others : undefined);
  const failed = user.result !== SUCCESS;
  const { signer, ...rest } = facts;
  const seen: HederaSeen = {
    ...rest,
    // A failed result of the named transaction is the act's own, the transaction the reference names being the act at
    // coverage none (the profile `x402/exact/hedera`, rule 15): its rows show the fee alone, and the authorization the
    // payer signed is one the read does not decode, so it names the payee the facilitator named it for, by that rule
    // and not by a read.
    ...(failed ? { party: "payer" as const, account: "payee" as const } : signer === undefined ? {} : { signer }),
    mark: "consensus",
    result: failed ? "failed" : "succeeded",
    consumed: true,
    carries: false,
    kind: "same",
    // The read decodes no authorization the payer signed, so no member of the payment presented is shown.
    presented: "unshown",
    ...(given.has(ref.transaction) ? { given: true } : {}),
  };
  return decide(
    { seen: [seen], value: { consumed: true, lapsed: false, mark: "consensus", head: { consumed: true } }, search: { whole: true }, history: true },
    query,
    ledger,
  );
}

const executorPattern: LcpPattern = deepFreeze({
  pattern: "http-advisory",
  profile: "x402/exact/hedera",
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
} from "./internal/hedera-session.js";
export type { HederaVoucherTypedData } from "./internal/hedera-session.js";
export type { ExecutorPayload, ExecutorPaymentPayload } from "./internal/hedera.js";
export type { X402Payment, X402Read } from "./internal/x402.js";
