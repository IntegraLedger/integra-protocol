/**
 * Stacks rail pieces: the transaction id, the reader a read goes through, the read of a payment by its origin and the
 * nonce the origin signed with the search for H over the origin's nonces, and the zero-party recovery of the ATR hash
 * from a mined transaction. The profile `mpp/charge/usdc/stacks` states the read.
 */
import { sha512_256 } from "@noble/hashes/sha2.js";
import { fromRawBytes, type AtrHash } from "./core.js";
import { bytesOf, hexOf, type Hex } from "./evm-abi.js";
import { isObject, normalHash } from "./fields.js";
import { isCanonicalPrincipal } from "./internal/c32.js";
import { bufferArgument, MEMO_PREFIX, memoArgument, originSigned, principalArgument, transferMemo } from "./internal/stacks.js";
import {
  decide,
  type Facts,
  type Moved,
  type OtherAct,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type Undecoded,
  type UnreadableReason,
} from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import { STACKS } from "./internal/data/stacks.js";
import { decodeObject, isChallengeShape, type MppChallenge } from "./mpp-challenge.js";
import { refusal, type Refusal } from "./refusal.js";
import type { PaymentRequirements } from "./x402.js";

/** CAIP-2: `stacks:1` (mainnet), `stacks:2147483648` (testnet). */
export type StacksNetwork = `stacks:${string}`;

/**
 * The largest Stacks transaction lcp decodes, in bytes: 16,384. A credential carries the transaction whole, and no
 * Stacks specification lcp reads bounds a transaction's size below a block's, so lcp bounds the work of decoding one.
 */
export const MAX_STACKS_TX_BYTES = 16_384;

/**
 * The most of an origin's nonces one read searches for H: 32. The search covers every nonce the origin used after the
 * position it starts from, which a busy origin makes long, so one read reads at most these and answers
 * `search-incomplete` with the next nonce to read, from which the next read resumes.
 */
export const MAX_SEARCH_NONCES = 32;

/**
 * The most pages of 50 transactions one read takes of a block's transactions or of an origin's, in the lookup's
 * fallback and its scan for nonce 0: 20 of a block, 4 of an origin. Past them the transaction is not found in that
 * read, and the answer is `search-incomplete`.
 */
const MAX_BLOCK_PAGES = 20;
const MAX_ORIGIN_PAGES = 4;

/**
 * The Bitcoin blocks, the anchoring block among them, that make a Stacks block final: 6. Stacks' documentation names
 * no depth (*Bitcoin Finality*, *Bitcoin Reorgs*), and 6 is Bitcoin's common one.
 */
const BITCOIN_FINALITY = 6n;

/**
 * SHA-512/256 of a transaction's whole consensus serialization, as `0x` and lowercase hex. Throws TypeError when `wire`
 * is not a `Uint8Array`.
 */
export function stacksTxid(wire: Uint8Array): Hex {
  return hexOf(sha512_256(wire));
}

/** A `fungible_token_asset` event of `asset_event_type` `transfer`, as the API lists it among a transaction's events. */
export interface StacksAssetEvent {
  /** `event_index`: its place among the transaction's events, as the endpoint lists them. */
  index: number;
  /** `asset.asset_id`: the token's contract, `::` and the token's name. */
  assetId: string;
  sender: string;
  recipient: string;
  amount: bigint;
}

/**
 * A mined transaction as the Stacks Blockchain API reports it (`GET /extended/v1/tx/<id>`, stacks-blockchain-api 9.9.0
 * `src/api/schemas/v1/entities/transactions.ts`). `raw` is the transaction's bytes (`GET /extended/v1/tx/<id>/raw`),
 * or null where the reader does not read them.
 */
export interface StacksLanded {
  mined: true;
  /** `tx_id`. */
  txid: Hex;
  /** `canonical`: the block is on the canonical chain. */
  canonical: boolean;
  /** `is_unanchored`: in a microblock no anchor block has confirmed, so no block places it. */
  unanchored: boolean;
  status: "success" | "abort_by_response" | "abort_by_post_condition" | "problematic_skipped";
  /** `sender_address` and `nonce`: the origin, never the sponsor. */
  sender: { address: string; nonce: bigint };
  /** `sponsor_address`, or null for a standard authorization. */
  sponsor: string | null;
  blockHeight: bigint;
  /** The contract call, with each argument's consensus serialization as `0x` hex; null for any other payload. */
  call: { contractId: string; functionName: string; args: readonly Hex[] } | null;
  /** A token transfer's `recipient_address`, `amount` and 34-byte `memo` as `0x` hex; null for any other payload. */
  transfer: { recipient: string; amount: bigint; memo: Hex } | null;
  /** Its `fungible_token_asset` `transfer` events. */
  events: readonly StacksAssetEvent[];
  raw: Uint8Array | null;
}

/** An unmined transaction: `pending`, or one of the `dropped_…` states. It decides nothing. */
export interface StacksMempool {
  mined: false;
  status: string;
}

/** A transaction as a list of the API's names it: its id, its origin and its nonce. */
export interface StacksListed {
  txid: Hex;
  sender: string;
  nonce: bigint;
}

/** A page of a list, with the count the list holds in all (`total`). */
export interface StacksPage {
  results: readonly StacksListed[];
  total: number;
}

/**
 * Bounded reads of one network's Stacks Blockchain API, stacks-blockchain-api 9.9.0's routes. Any failure rejects, for
 * example with `ReaderError` from `@integraledger/lcp/evm`: one of kind `too-large` reads as `too-large`, one of kind
 * `malformed` as `unparseable`, and any other rejection as `transport`. A route that answers 404 for a height it does
 * not know answers `{ unknownHeight: true }`, which is never absence.
 */
export interface StacksReader {
  readonly network: StacksNetwork;
  /** `GET /extended`: the chain tip's Stacks block height and the Bitcoin block height the indexer serves. */
  tip(): Promise<{ height: bigint; burnHeight: bigint }>;
  /** `GET /extended/v1/tx/<id>` with its events, and its bytes; `notFound` where the API does not know it. */
  transaction(txid: Hex): Promise<StacksLanded | StacksMempool | { notFound: true }>;
  /**
   * `GET /extended/v1/address/<principal>/nonces`, at `height` where given (`?block_height=<height>`), else at the tip:
   * `last_executed_tx_nonce`, null where the principal has none.
   */
  lastNonce(principal: string, height?: bigint): Promise<{ nonce: bigint | null } | { unknownHeight: true }>;
  /** `GET /extended/v1/tx/?from_address=<principal>&nonce=<nonce>`: the results, each by its id, origin and nonce. */
  byNonce(principal: string, nonce: bigint): Promise<readonly StacksListed[]>;
  /** `GET /extended/v1/tx/?from_address=<principal>&order=asc&limit=50&offset=<offset>`: a page of the origin's transactions. */
  byOrigin(principal: string, offset: number): Promise<StacksPage>;
  /** `GET /extended/v1/tx/block_height/<height>?limit=50&offset=<offset>`: a page of a block's transactions. */
  inBlock(height: bigint, offset: number): Promise<StacksPage | { unknownHeight: true }>;
  /**
   * The Bitcoin height of the burn block of the first tenure that starts after the tenure of the Stacks block at
   * `height` and builds on it, read from the tenures the indexer lists with their burn blocks; null where it lists none
   * yet.
   */
  nextTenureBurn(height: bigint): Promise<bigint | null>;
}

/**
 * The read keys of a Stacks payment: its network, the origin and the nonce it signed as a decimal string, the payee,
 * the recipient of the challenge the payment answers, for the read's two party tests, each a principal as a Stacks node
 * writes it (the API's spelling, which the read compares as written), `signed`, the digest of what the
 * origin signed (`0x` and 64 hex digits), the member `presented` compares, and `transaction`, the id of a standard
 * authorization's transaction, which is a hint the read takes first. A sponsored transaction's id is fixed only by the
 * sponsor's signature, so its reference names none.
 */
export interface StacksRef {
  network: StacksNetwork;
  payee: string;
  origin: string;
  nonce: string;
  signed?: Hex;
  transaction?: Hex;
}

/**
 * The answer of `stacksStatus`, as the profile `read-status` gives it. Its marks are `block` and `bitcoin`, in that
 * order, its position the block height, its search position the next of the origin's nonces to read, and a transfer's
 * place the index of its event among the transaction's events, or `payload` for an STX token transfer.
 */
export type StacksStatus = StatusAnswer<bigint, StacksMark, bigint>;

/** A Stacks mark: the block (`block`), and Bitcoin finality (`bitcoin`), the final one. */
export type StacksMark = "block" | "bitcoin";
const MARKS: readonly StacksMark[] = ["block", "bitcoin"];

/** What `stacksStatus` takes beside the reference and the reader. */
export type StacksQuery = StatusQuery<StacksRef, bigint, StacksMark, bigint>;

const NONCE = /^(?:0|[1-9][0-9]{0,19})$/;
const NONCE_LIMIT = 1n << 64n;
/** A standard principal as c32check writes it: `S`, the version and the checked hash160, 28 to 41 characters in all. */
const PRINCIPAL = /^S[0-9A-HJKMNP-TV-Z]{27,40}$/;
/** A contract principal: a standard principal, `.` and a Clarity contract name of at most 128 characters. */
const CONTRACT = /^S[0-9A-HJKMNP-TV-Z]{27,40}\.[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;
const PAGE = 50;
const INCLUDED = new Set(["success", "abort_by_response", "abort_by_post_condition"]);
const STATUSES = new Set([...INCLUDED, "problematic_skipped"]);

/** H from a memo argument that is `(some <32-byte buffer>)`, or null. */
function memoHash(arg: unknown): AtrHash | null {
  if (typeof arg !== "string" || arg.length !== MEMO_PREFIX.length + 64) return null;
  if (arg.slice(0, MEMO_PREFIX.length).toLowerCase() !== MEMO_PREFIX) return null;
  const raw = bytesOf(`0x${arg.slice(MEMO_PREFIX.length)}`);
  return raw === undefined ? null : fromRawBytes(raw);
}

/** A read that established nothing, with its reason. */
type Unread = { readonly unreadable: UnreadableReason };
const unread = (unreadable: UnreadableReason): Unread => ({ unreadable });
const isUnread = (v: unknown): v is Unread => isObject(v) && typeof v["unreadable"] === "string";

/**
 * The reason a rejected read gives: a `ReaderError` of kind `too-large` is `too-large`, one of kind `malformed`
 * `unparseable`, and any other rejection `transport`.
 */
function rejectedAs(e: unknown): UnreadableReason {
  if (!isObject(e) || e["name"] !== "ReaderError") return "transport";
  return e["kind"] === "too-large" ? "too-large" : e["kind"] === "malformed" ? "unparseable" : "transport";
}

async function call<T>(f: () => Promise<T>): Promise<T | Unread> {
  try {
    return await f();
  } catch (e) {
    return unread(rejectedAs(e));
  }
}

/** The reference, checked: undefined where a member is not of its form. */
interface Keys {
  network: string;
  payee: string;
  origin: string;
  nonce: bigint;
  signed: Hex | undefined;
  hint: Hex | undefined;
  h: AtrHash;
}

function keysOf(ref: unknown): Keys | undefined {
  if (!isObject(ref)) return undefined;
  const { network, payee, origin, nonce, signed, transaction, h } = ref;
  if (typeof network !== "string" || typeof payee !== "string" || !isCanonicalPrincipal(payee)) return undefined;
  if (typeof origin !== "string" || !PRINCIPAL.test(origin) || !isCanonicalPrincipal(origin)) return undefined;
  if (typeof nonce !== "string" || !NONCE.test(nonce)) return undefined;
  const n = BigInt(nonce);
  const hh = normalHash(h);
  if (n >= NONCE_LIMIT || hh === null) return undefined;
  const s = signed === undefined ? undefined : normalHash(signed);
  const hint = transaction === undefined ? undefined : normalHash(transaction);
  if (s === null || hint === null) return undefined;
  return { network, payee, origin, nonce: n, signed: s as Hex | undefined, hint: hint as Hex | undefined, h: hh };
}

/** True for an answer of `StacksLanded`'s shape. */
function isLanded(v: unknown): v is StacksLanded {
  if (!isObject(v) || v["mined"] !== true || typeof v["status"] !== "string" || !STATUSES.has(v["status"])) return false;
  if (normalHash(v["txid"]) === null || typeof v["canonical"] !== "boolean" || typeof v["unanchored"] !== "boolean") return false;
  const sender = v["sender"];
  if (!isObject(sender) || typeof sender["address"] !== "string" || typeof sender["nonce"] !== "bigint") return false;
  if (v["sponsor"] !== null && typeof v["sponsor"] !== "string") return false;
  if (typeof v["blockHeight"] !== "bigint") return false;
  if (!(v["raw"] === null || v["raw"] instanceof Uint8Array)) return false;
  const c = v["call"];
  if (c !== null) {
    if (!isObject(c) || typeof c["contractId"] !== "string" || typeof c["functionName"] !== "string") return false;
    const args = c["args"];
    if (!Array.isArray(args) || !args.every((a) => typeof a === "string")) return false;
  }
  const t = v["transfer"];
  if (t !== null) {
    if (!isObject(t) || typeof t["recipient"] !== "string" || typeof t["amount"] !== "bigint" || typeof t["memo"] !== "string") {
      return false;
    }
  }
  const events = v["events"];
  return (
    Array.isArray(events) &&
    events.every(
      (e) =>
        isObject(e) &&
        Number.isSafeInteger(e["index"]) &&
        typeof e["assetId"] === "string" &&
        typeof e["sender"] === "string" &&
        typeof e["recipient"] === "string" &&
        typeof e["amount"] === "bigint",
    )
  );
}

/** True for an answer of `StacksMempool`'s shape. */
function isMempool(v: unknown): v is StacksMempool {
  return isObject(v) && v["mined"] === false && typeof v["status"] === "string";
}

function isListed(v: unknown): v is StacksListed {
  return isObject(v) && normalHash(v["txid"]) !== null && typeof v["sender"] === "string" && typeof v["nonce"] === "bigint";
}

function isPage(v: unknown): v is StacksPage {
  return isObject(v) && Array.isArray(v["results"]) && v["results"].every(isListed) && Number.isSafeInteger(v["total"]);
}

const unknownHeight = (v: unknown): boolean => isObject(v) && v["unknownHeight"] === true;

/** The transaction by its id: landed, or null where it is unmined or unknown. */
async function landedTx(reader: StacksReader, txid: Hex): Promise<StacksLanded | null | Unread> {
  const t = await call(() => reader.transaction(txid));
  if (isUnread(t)) return t;
  if (isLanded(t)) return normalHash(t.txid) === normalHash(txid) ? t : unread("unparseable");
  if (isMempool(t) || (isObject(t) && t["notFound"] === true)) return null;
  return unread("unparseable");
}

/** The last nonce the principal executed, at `height` or at the tip; `history-gap` where the route does not know it. */
async function lastNonce(reader: StacksReader, principal: string, height?: bigint): Promise<bigint | null | Unread> {
  const n = await call(() => reader.lastNonce(principal, height));
  if (isUnread(n)) return n;
  if (unknownHeight(n)) return unread("history-gap");
  const nonce: unknown = isObject(n) ? (n as Record<string, unknown>)["nonce"] : undefined;
  return nonce === null || typeof nonce === "bigint" ? nonce : unread("unparseable");
}

/** Whether a landed transaction is the origin's, at the nonce, on the canonical chain and included. */
const decidesAt = (t: StacksLanded, origin: string, nonce: bigint): boolean =>
  t.canonical && INCLUDED.has(t.status) && t.sender.address === origin && t.sender.nonce === nonce;

/**
 * The origin's transaction at `nonce` on the canonical chain, included: by the lookup by origin and nonce, or for nonce
 * 0, which the route does not filter, by a scan of the origin's transactions in ascending order; then, where neither
 * finds it, by the fallback, a bisection on the origin's nonce by block height from `low` to the tip and a read of the
 * block where the nonce passes it. `missing` where none of them finds it within its bounds. A lookup or scan answer
 * naming another origin's transaction, or another nonce's for a nonce other than 0, is not the route's documented answer
 * and proves nothing. Every result is read: two that decide at the one nonce are an answer no chain gives, and they and
 * any result whose answer the read cannot decode are named as undecodable, never one of them taken.
 */
async function transactionAt(
  reader: StacksReader,
  origin: string,
  nonce: bigint,
  low: bigint,
  tip: bigint,
): Promise<StacksLanded | "missing" | Undecodable | Unread> {
  let ids: Hex[];
  if (nonce === 0n) {
    ids = [];
    for (let page = 0; page < MAX_ORIGIN_PAGES; page++) {
      const p = await call(() => reader.byOrigin(origin, page * PAGE));
      if (isUnread(p)) return p;
      if (!isPage(p)) return unread("unparseable");
      if (p.results.some((r) => r.sender !== origin)) {
        ids = [];
        break;
      }
      ids.push(...p.results.filter((r) => r.nonce === 0n).map((r) => r.txid));
      if (p.results.some((r) => r.nonce > 0n) || (page + 1) * PAGE >= p.total) break;
    }
  } else {
    const l = await call(() => reader.byNonce(origin, nonce));
    if (isUnread(l)) return l;
    if (!Array.isArray(l) || !l.every(isListed)) return unread("unparseable");
    ids = l.every((r) => r.sender === origin && r.nonce === nonce) ? l.map((r) => r.txid) : [];
  }
  const deciding = new Map<string, StacksLanded>();
  const undecodable: Hex[] = [];
  for (const id of ids) {
    const t = await landedTx(reader, id);
    if (isUnread(t) && t.unreadable === "unparseable") undecodable.push(normalHash(id) as Hex);
    else if (isUnread(t)) return t;
    else if (t !== null && decidesAt(t, origin, nonce)) deciding.set(normalHash(t.txid)!, t);
  }
  const one = decided(deciding, undecodable);
  return one ?? fallback(reader, origin, nonce, low, tip);
}

/**
 * The one transaction that decides at a nonce, from every result read there: undecodable where two decide, naming
 * them, or where a result could not be decoded, naming it; undefined where none decides and none is undecodable.
 */
function decided(deciding: ReadonlyMap<string, StacksLanded>, undecodable: readonly Hex[]): StacksLanded | Undecodable | undefined {
  if (undecodable.length > 0) return { undecodable: [...new Set(undecodable)] };
  if (deciding.size > 1) return { undecodable: [...deciding.keys()] as Hex[] };
  return deciding.values().next().value;
}

/**
 * Transactions a lookup named that the read cannot take as the one at the nonce, by their ids: one whose answer it
 * could not decode, or two that decide at one nonce.
 */
type Undecodable = { readonly undecodable: readonly Hex[] };
const isUndecodable = (v: unknown): v is Undecodable => isObject(v) && Array.isArray(v["undecodable"]);

/**
 * The lookup's fallback: the first block at which the origin's last nonce reaches `nonce`, and its transaction there,
 * every page of that block read within the bound. The bisection starts at `low`, or at height 1 where the nonce at
 * `low` already reaches `nonce`, the transaction being at or before it.
 */
async function fallback(
  reader: StacksReader,
  origin: string,
  nonce: bigint,
  low: bigint,
  tip: bigint,
): Promise<StacksLanded | "missing" | Undecodable | Unread> {
  let lo = low < 1n ? 1n : low;
  let hi = tip;
  const at = async (h: bigint) => await lastNonce(reader, origin, h);
  const top = await at(hi);
  if (isUnread(top)) return top;
  if (top === null || top < nonce) return "missing";
  if (lo > 1n && lo < hi) {
    const n = await at(lo);
    if (isUnread(n)) return n;
    if (n !== null && n >= nonce) lo = 1n;
  }
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    const n = await at(mid);
    if (isUnread(n)) return n;
    if (n !== null && n >= nonce) hi = mid;
    else lo = mid + 1n;
  }
  const deciding = new Map<string, StacksLanded>();
  const undecodable: Hex[] = [];
  for (let page = 0; page < MAX_BLOCK_PAGES; page++) {
    const p = await call(() => reader.inBlock(hi, page * PAGE));
    if (isUnread(p)) return p;
    if (unknownHeight(p)) return unread("history-gap");
    if (!isPage(p)) return unread("unparseable");
    for (const r of p.results) {
      if (r.sender !== origin || r.nonce !== nonce) continue;
      const t = await landedTx(reader, r.txid);
      if (isUnread(t) && t.unreadable === "unparseable") undecodable.push(normalHash(r.txid) as Hex);
      else if (isUnread(t)) return t;
      else if (t !== null && decidesAt(t, origin, nonce)) deciding.set(normalHash(t.txid)!, t);
    }
    if ((page + 1) * PAGE >= p.total) break;
  }
  return decided(deciding, undecodable) ?? "missing";
}

/** The read's view of a landed transaction against the reference and the query, as `decide` takes it. */
interface Classified {
  seen: Seen<bigint, StacksMark>;
  landed: StacksLanded;
}

/** The forms a landed transaction carries H in: the pairing's own (`same`), another (`other`), or none. */
function carriage(t: StacksLanded, k: Keys): "same" | "other" | "none" {
  const memo = memoArgument(k.h);
  const stx = transferMemo(k.h);
  const buffer = bufferArgument(k.h);
  const c = t.call;
  if (c !== null && c.functionName === "transfer" && c.args[3]?.toLowerCase() === memo) return "same";
  if (t.transfer !== null && t.transfer.memo.toLowerCase() === stx) return "same";
  if (c !== null && c.args.some((a) => a.toLowerCase() === memo || a.toLowerCase() === buffer)) return "other";
  return "none";
}

/**
 * What a landed transaction moved, each transfer named by the transaction and its place: each transfer event of the
 * called contract's token, by its event index, or an STX token transfer, the transaction's own payload, `payload`.
 */
function movedOf(t: StacksLanded): Moved[] {
  const transaction = normalHash(t.txid)!;
  if (t.transfer !== null) {
    return [{ asset: "STX", amount: t.transfer.amount.toString(), to: t.transfer.recipient, transaction, place: "payload" }];
  }
  if (t.call === null) return [];
  const contract = t.call.contractId;
  return t.events
    .filter((e) => e.assetId.startsWith(`${contract}::`))
    .map((e) => ({ asset: e.assetId, amount: e.amount.toString(), to: e.recipient, transaction, place: e.index }));
}

/** The accounts a transaction names against the payee: the payee's where one is the payee, none where it names none. */
function accountOf(named: readonly (string | undefined)[], payee: string): Seen<bigint, StacksMark>["account"] {
  const accounts = named.filter((a): a is string => a !== undefined);
  return accounts.length === 0 ? "none" : accounts.includes(payee) ? "payee" : "other";
}

/** The account a transaction included with a failed result would have paid: a `transfer` call's recipient, or an STX transfer's. */
function intended(t: StacksLanded): (string | undefined)[] {
  if (t.transfer !== null) return [t.transfer.recipient];
  if (t.call !== null && t.call.functionName === "transfer" && t.call.args[2] !== undefined) return [principalArgument(t.call.args[2])];
  return [];
}

/** The read's mark of a transaction's block: `bitcoin` once 6 Bitcoin blocks stand on the block that anchors it. */
async function markOf(reader: StacksReader, height: bigint, burnTip: bigint): Promise<StacksMark | Unread> {
  const b = await call(() => reader.nextTenureBurn(height));
  if (isUnread(b)) return b;
  if (b !== null && typeof b !== "bigint") return unread("unparseable");
  return b !== null && burnTip - b >= BITCOIN_FINALITY ? "bitcoin" : "block";
}

/** Whether a transaction is one of the other acts the caller gave, by its transaction or its reference. */
function givenIn(t: StacksLanded, others: readonly OtherAct<StacksRef>[] | undefined): boolean {
  const id = normalHash(t.txid);
  return (others ?? []).some((o) => {
    if ("transaction" in o) return normalHash(o.transaction) === id;
    const r = o.ref;
    if (!isObject(r)) return false;
    if (r.transaction !== undefined && normalHash(r.transaction) === id) return true;
    return r.origin === t.sender.address && typeof r.nonce === "string" && NONCE.test(r.nonce) && BigInt(r.nonce) === t.sender.nonce;
  });
}

/**
 * The row of a landed transaction the read met: none for one that is not on the canonical chain or was not included,
 * or that neither carries H nor consumed the signed nonce. Its party is the origin against the option's payee and the
 * reference's origin, never the sponsor; the account it names is the recipient of the called contract's transfer
 * events, or of the STX transfer: the payee's where one reaches the payee, another where none does, none where it moved
 * nothing. A transaction included with a failed result moved nothing, so the account it names is the one it would have
 * paid: the recipient argument of a call of `transfer`, or the token transfer's recipient. Its kind is the act's only where it carries H in the pairing's form: an origin's transaction at the signed
 * nonce that does not, included with a failed result, consumed the nonce and is not the act's own failed result.
 */
async function classify(
  reader: StacksReader,
  t: StacksLanded,
  k: Keys,
  query: StacksQuery,
  burnTip: bigint,
): Promise<Classified | null | Unread> {
  if (!t.canonical || !INCLUDED.has(t.status)) return null;
  const carries = carriage(t, k);
  const consumed = t.sender.address === k.origin && t.sender.nonce === k.nonce;
  if (carries === "none" && !consumed) return null;
  const mark = await markOf(reader, t.blockHeight, burnTip);
  if (isUnread(mark)) return mark;
  const moved = movedOf(t);
  const result = t.status === "success" ? "succeeded" : "failed";
  const party = t.sender.address === k.payee ? "payee" : t.sender.address === k.origin ? "payer" : "other";
  const seen: Seen<bigint, StacksMark> = {
    transaction: normalHash(t.txid)!,
    ...(t.unanchored ? {} : { position: t.blockHeight }),
    mark,
    result,
    consumed,
    carries: carries !== "none",
    party,
    kind: carries === "same" ? "same" : "other",
    account: accountOf(result === "failed" ? intended(t) : moved.map((m) => m.to), k.payee),
    ...(givenIn(t, query.others) ? { given: true } : {}),
    moved,
    signer: t.sender.address,
    ...(k.signed === undefined ? {} : { presented: presentedOf(t, k.signed) }),
  };
  return { seen, landed: t };
}

/**
 * Answers the read of the act the query asks about as the profile `read-status` gives it, by the origin and the nonce
 * it signed (the profile `mpp/charge/usdc/stacks`). The read takes the tip, then the reference's transaction where it
 * names one, a hint that decides only where it is the origin's at the signed nonce; then the origin's last executed
 * nonce at the tip, the signed nonce being consumed where that is at or past it; then, where the hint has not, the
 * origin's transaction at the signed nonce (`transactionAt`). That transaction, where it is the act at or above the
 * finality asked for, settles; otherwise the read searches for H every nonce the origin executed after the position it
 * starts from: the query's `search` where given, else the nonce after the one the origin had executed at the height of
 * the query's `after`, else 0; through the last it executed at the tip, at most `MAX_SEARCH_NONCES` in one read. A
 * search from `after` rests on the nonce route's answer at a height, which no run has yet shown, so it proves no absence
 * and is never read whole. A transaction counts only on the canonical chain and included; its mark is `bitcoin` once 6
 * Bitcoin blocks stand on the block that anchors it (`nextTenureBurn` against the tip's Bitcoin height), else `block`.
 * A Stacks transaction has no expiry, so the signed nonce never lapses; read at the tip, a nonce unconsumed there is
 * unconsumed at the final mark. A transaction the search's lookup names whose answer the read cannot decode, and two
 * that decide at one nonce, an answer no chain gives, are named as items it could not decode, held at their nonce, and
 * the search reads on; at the signed nonce, which the read names by its number, or as the reference's own, either is
 * `unparseable`. A reference whose payee or origin is not a principal as a Stacks node writes it is `unparseable`. A rejected read is `transport`, `too-large` or
 * `unparseable` by its kind, an answer of no documented shape `unparseable`, a height a route does not know
 * `history-gap`, and a reader for another network than the reference's `chain-mismatch`. A reference or query not of
 * its form is `unparseable`, with nothing read. A `settled` answer states `presented`: `yes` where the digest of what
 * the landed transaction's origin signed is the reference's `signed`, `no` where it differs, and `unshown` where the
 * reference holds none or the reader gives no bytes that are the transaction's.
 */
export async function stacksStatus(ref: StacksRef & { h: AtrHash }, reader: StacksReader, query: StacksQuery): Promise<StacksStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint")) return UNPARSEABLE;
  if (query.search !== undefined && (typeof query.search !== "bigint" || query.search < 0n)) return UNPARSEABLE;
  const k = keysOf(ref);
  if (k === undefined || !isObject(reader) || typeof reader.network !== "string") return UNPARSEABLE;
  if (reader.network !== k.network) return { state: "unreadable", reason: "chain-mismatch", foreign: [] };
  const read = await readStacks(k, reader, query);
  if ("unreadable" in read) return { state: "unreadable", reason: read.unreadable, foreign: [] };
  return decide(read.facts, query, LEDGER);
}

const LEDGER = ledgerOf<bigint, StacksMark>(STACKS["mpp/charge/usdc/stacks"].coverage, MARKS, bigintOrder);

/** Whether the landed transaction is the one presented, by the digest of what its origin signed. */
function presentedOf(t: StacksLanded, signed: Hex): "yes" | "no" | "unshown" {
  if (t.raw === null) return "unshown";
  if (stacksTxid(t.raw) !== normalHash(t.txid)) return "unshown";
  const digest = originSigned(t.raw);
  return digest === undefined ? "unshown" : digest === signed ? "yes" : "no";
}

async function readStacks(
  k: Keys,
  reader: StacksReader,
  query: StacksQuery,
): Promise<{ facts: Facts<bigint, StacksMark, bigint>; met: Map<string, StacksLanded> } | Unread> {
  const tip = await call(() => reader.tip());
  if (isUnread(tip)) return tip;
  if (!isObject(tip) || typeof tip.height !== "bigint" || typeof tip.burnHeight !== "bigint") return unread("unparseable");
  const seen: Seen<bigint, StacksMark>[] = [];
  const met = new Map<string, StacksLanded>();
  const add = async (t: StacksLanded): Promise<Unread | undefined> => {
    const id = normalHash(t.txid)!;
    if (met.has(id)) return undefined;
    met.set(id, t);
    const c = await classify(reader, t, k, query, tip.burnHeight);
    if (isUnread(c)) return c;
    if (c !== null) seen.push(c.seen);
    return undefined;
  };

  let atNonce: StacksLanded | undefined;
  if (k.hint !== undefined) {
    const t = await landedTx(reader, k.hint);
    if (isUnread(t)) return t;
    if (t !== null) {
      const u = await add(t);
      if (u !== undefined) return u;
      if (decidesAt(t, k.origin, k.nonce)) atNonce = t;
    }
  }
  const last = await lastNonce(reader, k.origin);
  if (isUnread(last)) return last;
  const consumed = last !== null && last >= k.nonce;
  const low = query.after ?? 1n;
  if (consumed && atNonce === undefined) {
    const t = await transactionAt(reader, k.origin, k.nonce, low, tip.height);
    if (isUnread(t)) return t;
    // The transaction at the signed nonce is one the read names by its number: an answer it cannot decode is unparseable.
    if (isUndecodable(t)) return unread("unparseable");
    if (t !== "missing") {
      atNonce = t;
      const u = await add(t);
      if (u !== undefined) return u;
    }
  }
  // The nonce is read at the tip: unconsumed there, it is unconsumed at the final mark, and consumed there it is held so.
  const value = { consumed, lapsed: false, mark: "bitcoin" as const, head: { consumed } };
  const own = atNonce === undefined ? undefined : seen.find((s) => s.transaction === normalHash(atNonce.txid));
  const settles =
    own !== undefined &&
    own.result === "succeeded" &&
    own.carries &&
    own.party === "payer" &&
    own.kind === "same" &&
    own.given !== true &&
    (query.act === "agreement" || own.account === "payee") &&
    LEDGER.markOrder(own.mark, query.finality) >= 0;
  if (settles) return { facts: { seen, value, search: { whole: true }, history: true }, met };

  // The search for H over the origin's nonces.
  let start: bigint;
  if (query.search !== undefined) start = query.search;
  else if (query.after !== undefined) {
    const n = await lastNonce(reader, k.origin, query.after);
    if (isUnread(n)) return n;
    start = n === null ? 0n : n + 1n;
  } else start = 0n;
  const end = last ?? -1n;
  let next = start;
  let whole = query.after === undefined;
  const undecoded: Undecoded<bigint>[] = [];
  for (let read = 0; next <= end; next++) {
    if (next === k.nonce && consumed) continue;
    if (read === MAX_SEARCH_NONCES) break;
    read++;
    const t = await transactionAt(reader, k.origin, next, low, tip.height);
    if (isUnread(t)) return t;
    if (t === "missing") break;
    if (isUndecodable(t)) {
      for (const id of t.undecodable) undecoded.push({ transaction: id, at: next });
      continue;
    }
    const u = await add(t);
    if (u !== undefined) return u;
  }
  // A range read to its end resumes from its start where the position it started from holds it; else from the next nonce.
  const search = next <= end ? { whole: false, at: next } : { whole };
  return { facts: { seen, value, search, undecoded, history: true }, met };
}

/**
 * Zero-party: H from a mined, successful transaction: the fourth argument of its call to the contract's `transfer`, or
 * an STX token transfer's memo, H followed by two zero bytes; in one reader call, or three for a failed one. A failed
 * status is `stacks/not-success` once 6 Bitcoin blocks stand on the block that anchors the transaction's block, as
 * `stacksStatus` reads `bitcoin`, and `stacks/not-final` below that or where a mark read fails, since that block can be
 * replaced. An input or reader that is not one, a reader for another network, or an input whose `tx` is not a 32-byte
 * hash or whose option is not a challenge whose decoded request names a contract in `methodDetails.stacks` (its
 * `contractAddress`, `.` and its `contractName`) is `stacks/wrong-reader`, with nothing read; a failed read or an answer
 * of no documented shape, `stacks/unreadable`; an unknown or unmined transaction, or one not on the canonical chain,
 * `stacks/not-found`; no H in either form, `stacks/no-memo`.
 */
export async function stacksRecover(
  input: RecoverInput<StacksNetwork, PaymentRequirements | MppChallenge>,
  reader: StacksReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("stacks/wrong-reader");
  const txid = normalHash(input.tx);
  const contract = contractOf(input.option);
  if (txid === null || contract === undefined) return refusal("stacks/wrong-reader");
  const t = await landedTx(reader, txid as Hex);
  if (isUnread(t)) return refusal("stacks/unreadable");
  if (t === null || !t.canonical || t.status === "problematic_skipped") return refusal("stacks/not-found");
  if (t.status !== "success") {
    const tip = await call(() => reader.tip());
    if (isUnread(tip) || !isObject(tip) || typeof tip.burnHeight !== "bigint") return refusal("stacks/not-final");
    const mark = await markOf(reader, t.blockHeight, tip.burnHeight);
    return mark === "bitcoin" ? refusal("stacks/not-success") : refusal("stacks/not-final");
  }
  if (t.transfer !== null) {
    const memo = bytesOf(t.transfer.memo);
    const h = memo !== undefined && memo.length === 34 && memo[32] === 0 && memo[33] === 0 ? fromRawBytes(memo.subarray(0, 32)) : null;
    return h ?? refusal("stacks/no-memo");
  }
  const c = t.call;
  if (c === null || c.contractId !== contract || c.functionName !== "transfer") return refusal("stacks/no-memo");
  const h = memoHash(c.args[3]);
  return h === null ? refusal("stacks/no-memo") : h;
}

/** The contract a Stacks challenge's decoded request names in `methodDetails.stacks`, or undefined. */
function contractOf(option: unknown): string | undefined {
  if (!isChallengeShape(option)) return undefined;
  const details = decodeObject(option.request)?.["methodDetails"];
  const stacks = isObject(details) ? details["stacks"] : undefined;
  if (!isObject(stacks)) return undefined;
  const { contractAddress, contractName } = stacks;
  if (typeof contractAddress !== "string" || typeof contractName !== "string") return undefined;
  const contract = `${contractAddress}.${contractName}`;
  return CONTRACT.test(contract) ? contract : undefined;
}
