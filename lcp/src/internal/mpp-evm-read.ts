/**
 * The reads of the MPP charges on EVM chains, as the profile `read-status` and the `mpp-charge` profile state them, and
 * of the EVM session's opening (`mpp/session/evm`, the profile `mpp/session/evm-tempo`). The EIP-3009 charges
 * (`mpp/charge/evm/authorization`, `mpp/charge/usdc/evm`) and the Permit2 charge read the single-use value at the final
 * mark and at the latest head, and search for the payer's acts carrying the nonce the challenge derives (on Permit2,
 * the nonce or the challenge's witness word), from the position the caller gives to the latest head, in pages of at most 10,000 blocks; each transaction met is classified
 * from what landed against the reference's payer and the option's payee. The session's opening is read alike, by its
 * funding, its search being no search for H. The `transaction` and `hash` charges, at coverage `none`, read the
 * transaction the credential names. `decide` composes every answer.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  addressOfWord,
  addressWord,
  bytes32Word,
  bytesOf,
  concat,
  hexOf,
  keccak,
  keccakHex,
  uintOf,
  uintWord,
  wordAt,
  type Hex,
} from "../evm-abi.js";
import { isAddress, isObject, normalHash, uint256Of } from "../fields.js";
import {
  AUTHORIZATION_STATE_SELECTOR,
  AUTHORIZATION_USED_TOPIC,
  NONCE_BITMAP_SELECTOR,
  TRANSFER_TOPIC,
  TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
  evmLedger,
  isEvmQuery,
  isLog,
  isReceipt,
  readerFault,
  rejected,
  type EvmLog,
  type EvmMark,
  type EvmQuery,
  type EvmReceipt,
  type EvmTransaction,
} from "./evm.js";
import type { EvmLogEntry, EvmSearchReader } from "./evm-search.js";
import { decide, type Facts, type Moved, type Seen, type StatusAnswer, type UnreadableReason } from "./read.js";
import { issuedDigest, isChallengeShape, type MppChallenge } from "../mpp-challenge.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";

/** keccak256("AuthorizationCanceled(address,bytes32)"), EIP-3009's cancellation of a nonce. */
export const AUTHORIZATION_CANCELED_TOPIC = keccakHex("AuthorizationCanceled(address,bytes32)");
/** keccak256("UnorderedNonceInvalidation(address,uint256,uint256)"), Permit2's cancellation of a word of nonces. */
export const UNORDERED_NONCE_INVALIDATION_TOPIC = keccakHex("UnorderedNonceInvalidation(address,uint256,uint256)");
/** keccak256 of EIP-3009's `ReceiveWithAuthorization` type. */
const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccakHex(
  "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
);
const EIP712_DOMAIN_TYPEHASH = keccakHex(
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
);
/** `name()` and `version()`, read from a contract other than the asset to verify an authorization in its domain. */
const NAME_SELECTOR = "0x06fdde03";
const VERSION_SELECTOR = "0x54fd4d50";

/** The blocks one page of a search reads at most; a page the endpoint refuses is halved. */
export const SEARCH_PAGE_BLOCKS = 10_000n;
/** The pages one `status` call reads at most; a search with range left answers its position, and the next call resumes. */
export const MAX_SEARCH_PAGES = 8;

/** Whether an act is the payment the reference was built from, `Seen.presented`. */
export type Presentation = NonNullable<Seen<bigint, EvmMark>["presented"]>;

/** One transfer an act made, named by its transaction and its `Transfer` log's position among the receipt's logs. */
export type EvmMoved = Moved & { readonly transaction: Hex; readonly place: number };

/** What an MPP EVM charge's `status` answers: `read-status`'s answer, with `presented` on `settled`. */
export type MppEvmStatus = StatusAnswer<bigint, EvmMark>;

/**
 * The reader of an MPP EVM charge's read: `EvmSearchReader`, and `archival`, set where the seller declares the endpoint
 * archival, by which a lookup at coverage `none` shows that it holds the history its transaction would be in.
 */
export type MppEvmReader = EvmSearchReader & { readonly archival?: boolean };

/** The members of what the payer signed, as read from a landed act or as presented, each a lowercase string. */
export type Signed = Readonly<Record<string, string>>;

/** A transaction a read met, with what the payer signed in it where the read shows every member its form names. */
type SeenEvm = Seen<bigint, EvmMark> & { readonly signed?: Signed; readonly moved?: readonly EvmMoved[] };
type Act = Omit<SeenEvm, "transaction" | "position" | "mark">;

/** `yes` where every member the landed act shows equals the presented one, `no` where one differs, `unshown` else. */
export function presentation(presented: Signed | undefined, signed: Signed | undefined): Presentation {
  if (presented === undefined || signed === undefined) return "unshown";
  for (const [k, v] of Object.entries(signed)) {
    if (presented[k] === undefined) return "unshown";
    if (presented[k] !== v) return "no";
  }
  return "yes";
}

/** The reason of a rejected read: a rejection that names missing history `history-gap`, any other as `rejected` reads it. */
export function whyRejected(e: unknown): UnreadableReason {
  return isObject(e) && e["kind"] === "history" ? "history-gap" : rejected(e);
}

/**
 * True where `option`, the challenge a pairing's `reference` is given, is the challenge the presented credential
 * echoes: the same `id`, and the same members fixed at issue (`issuedDigest`); else `mpp/challenge-not-option`, since
 * the payee the read tests is the option's the payment answers.
 */
export async function echoesOption(echoed: unknown, option: MppChallenge): Promise<true | Refusal> {
  if (!isChallengeShape(echoed) || !isChallengeShape(option)) return refusal("mpp/challenge-malformed");
  if (echoed.id !== option.id) return refusal("mpp/challenge-not-option");
  const a = await issuedDigest(echoed);
  const b = await issuedDigest(option);
  if (isRefusal(a) || isRefusal(b)) return refusal("mpp/challenge-malformed");
  return a === b ? true : refusal("mpp/challenge-not-option");
}

const lower = (h: string): string => h.toLowerCase();
const same = (a: unknown, b: unknown): boolean => typeof a === "string" && typeof b === "string" && lower(a) === lower(b);

/** The party a signer is against the reference's payer and the option's payee. */
function partyOf(signer: string | undefined, payer: string, payee: string): "payer" | "payee" | "other" {
  if (signer === undefined) return "other";
  if (same(signer, payee)) return "payee";
  return same(signer, payer) ? "payer" : "other";
}

function topicAddress(t: unknown): Hex | undefined {
  const b = bytesOf(t);
  return b === undefined || b.length !== 32 ? undefined : addressOfWord(b);
}

function addressTopic(a: Hex): Hex {
  return hexOf(addressWord(a));
}

/** A `Transfer` log's parts and its position among the receipt's logs. */
interface TransferAt {
  readonly token: Hex;
  readonly from: Hex;
  readonly to: Hex;
  readonly value: bigint;
  readonly log: number;
}

/**
 * The system emitter of EIP-7708's native-value `Transfer` log. On Arc each USDC transfer also emits a `Transfer` from
 * it, in 18 decimals and before every other log of its transaction, beside the USDC contract's own `Transfer` in 6, and
 * a plain native send emits it alone (Arc's documentation, *How-to: Detect and process deposits* and *USDC system
 * events*, read on 2026-11-16). It is no asset contract's own `Transfer`: no read pairs it, records it as what moved, or
 * counts it as a second transfer.
 */
export const SYSTEM_TRANSFER_EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe" as Hex;

/** The ERC-20 `Transfer` logs of a receipt: three topics, one data word, from a contract, never the system emitter. */
function transfersIn(logs: readonly EvmLog[]): TransferAt[] {
  const out: TransferAt[] = [];
  logs.forEach((l, i) => {
    if (l.topics.length !== 3 || !same(l.topics[0], TRANSFER_TOPIC) || !isAddress(l.address)) return;
    if (same(l.address, SYSTEM_TRANSFER_EMITTER)) return;
    const from = topicAddress(l.topics[1]);
    const to = topicAddress(l.topics[2]);
    const data = bytesOf(l.data);
    if (from === undefined || to === undefined || data === undefined || data.length !== 32) return;
    out.push({ token: lower(l.address) as Hex, from, to, value: uintOf(data), log: i });
  });
  return out;
}

function movedOf(t: TransferAt, transaction: Hex): EvmMoved {
  return { asset: t.token, amount: t.value.toString(), to: t.to, transaction, place: t.log };
}

/** A selector's call found at any byte offset of `input`: its offset, its selector and its argument bytes. */
function callsIn(input: Uint8Array, selectors: readonly Hex[]): { at: number; selector: Hex; args: Uint8Array }[] {
  const sel = selectors.map((s) => bytesOf(s)!);
  const out: { at: number; selector: Hex; args: Uint8Array }[] = [];
  for (let at = 0; at + 4 <= input.length; at++) {
    const i = sel.findIndex((s) => s.every((b, j) => input[at + j] === b));
    if (i >= 0) out.push({ at, selector: selectors[i]!, args: input.subarray(at + 4) });
  }
  return out;
}

/** Whether `input` holds the 32-byte `word` at any byte offset. */
function inputCarries(input: Uint8Array, word: Hex): boolean {
  const w = bytesOf(word);
  if (w === undefined || w.length !== 32) return false;
  next: for (let i = 0; i + 32 <= input.length; i++) {
    for (let j = 0; j < 32; j++) if (input[i + j] !== w[j]) continue next;
    return true;
  }
  return false;
}

/**
 * The members of an EIP-3009 payment presented (`read-status`, `presented`): the token under whose domain it is signed,
 * the challenge's `currency`, and `from`, `to`, `value` and `nonce`, lowercase, `value` in decimal; the validity window
 * is no member.
 */
export function eip3009Presented(token: Hex, from: Hex, to: Hex, value: bigint, nonce: Hex): Readonly<Record<string, string>> {
  return { token: token.toLowerCase(), from: from.toLowerCase(), to: to.toLowerCase(), value: value.toString(), nonce: nonce.toLowerCase() };
}

/** A word as `0x` and 64 lowercase hex digits. */
function wordHex(w: Uint8Array): Hex {
  return hexOf(w);
}

// ── The read every logs-searching charge shares.

/** The heads a read is made at, each with its time. */
interface Heads {
  readonly final: { readonly number: bigint; readonly timestamp: bigint };
  readonly safe: { readonly number: bigint; readonly timestamp: bigint };
  readonly latest: { readonly number: bigint; readonly timestamp: bigint };
}

/** A transaction a read classifies: its hash, its receipt, and its body, read once where asked for. */
interface TxView {
  readonly hash: Hex;
  readonly receipt: EvmReceipt;
  readonly tx: () => Promise<EvmTransaction | null | { readonly unreadable: UnreadableReason }>;
}

/** What classifying a transaction gives: the acts it holds, an item the read cannot decode, or a read that failed. */
type Classified = { readonly seen: readonly Act[] } | { readonly undecodable: true } | { readonly unreadable: UnreadableReason };

/** A log filter of a search: `address` absent reads every contract. */
interface Filter {
  readonly address?: Hex;
  readonly topics: readonly (Hex | null)[];
}

/** The reference fields every logs-searching read takes. */
interface ChargeRefBase {
  readonly network: `eip155:${string}`;
  readonly payee: string;
  readonly payer: Hex;
  /** A transaction a settler or the caller named, read beside the search, as the landed form gives it; never needed. */
  readonly transaction?: Hex;
}

/** A read of a charge that searches its logs: the value it reads, its bound, its filters, how it classifies a transaction. */
interface ChargeSpec<R extends ChargeRefBase> {
  readonly check: (ref: unknown) => ref is R;
  /** Whether the single-use value is consumed in the state after `block`. */
  readonly value: (ref: R, reader: MppEvmReader, block: bigint) => Promise<boolean | { readonly unreadable: UnreadableReason }>;
  /** The signed bound: lapsed at a block whose time is at or past `at` (`inclusive`), or past it. */
  readonly deadline: (ref: R) => { readonly at: bigint; readonly inclusive: boolean };
  readonly filters: (ref: R) => readonly Filter[];
  /**
   * The logs that find the transaction that consumed the value, read in the one block it was first read consumed at
   * when that block is at or below the position given (`consumerBelow`); absent where no indexed log finds it.
   */
  readonly consumers?: (ref: R) => readonly Filter[];
  readonly classify: (ref: R, view: TxView, reader: MppEvmReader) => Promise<Classified>;
  /** The members of the payment presented, as a reference holds them. */
  readonly presented: (ref: unknown) => Signed | undefined;
  /**
   * Set where the search is no search for H (its key a digest over other members as well): it is then never read
   * whole, and its position is returned only where it has range left, so no answer but `before-position` is `failed`.
   */
  readonly notForH?: true;
}

const QUERY_UNPARSEABLE: MppEvmStatus = Object.freeze({ state: "unreadable", reason: "unparseable", foreign: [] });

/** The `status` of a charge whose read searches its logs, at coverage `full`. */
function chargeStatus<R extends ChargeRefBase>(
  spec: ChargeSpec<R>,
): (ref: R, reader: MppEvmReader, query: EvmQuery<unknown>) => Promise<MppEvmStatus> {
  return async (ref, reader, query) => {
    if (!isEvmQuery(query)) return QUERY_UNPARSEABLE;
    const read = await chargeFacts(spec, ref, reader, query);
    if ("unreadable" in read) return { state: "unreadable", reason: read.unreadable, foreign: [] };
    return decide(read.facts, query, evmLedger("full"));
  };
}

/** The final, `safe` and latest heads, each with its time; a network that serves no `safe` mark reads it as the final one. */
async function headsOf(reader: MppEvmReader): Promise<Heads | { unreadable: UnreadableReason }> {
  try {
    const final = await reader.block("finalized");
    let safe = final;
    try {
      safe = await reader.block("safe");
    } catch {
      // A mark the endpoint refuses is not declared: the final one stands for it.
    }
    const latest = await reader.block("latest");
    if (!isBlock(final) || !isBlock(safe) || !isBlock(latest)) return { unreadable: "unparseable" };
    const s = safe.number < final.number ? final : safe;
    return { final, safe: s, latest: latest.number < s.number ? s : latest };
  } catch (e) {
    return { unreadable: whyRejected(e) };
  }
}

function isBlock(b: unknown): b is { number: bigint; timestamp: bigint } {
  return isObject(b) && typeof b["number"] === "bigint" && typeof b["timestamp"] === "bigint" && b["number"] >= 0n;
}

/**
 * The logs of `filters` from `from` to `to`, in pages of at most `SEARCH_PAGE_BLOCKS` blocks, halved where the endpoint
 * refuses a page, a page refused at one block `transport`, never absence; at most `MAX_SEARCH_PAGES` pages, after which
 * the search answers the block it would read next. A rejection that names missing history is `history-gap`.
 */
async function search(
  reader: MppEvmReader,
  filters: readonly Filter[],
  from: bigint,
  to: bigint,
): Promise<{ entries: EvmLogEntry[]; whole: boolean; at?: bigint } | { unreadable: UnreadableReason }> {
  const entries: EvmLogEntry[] = [];
  let pos = from;
  let span = SEARCH_PAGE_BLOCKS;
  let pages = 0;
  while (pos <= to) {
    if (pages === MAX_SEARCH_PAGES) return { entries, whole: false, at: pos };
    const end = pos + span - 1n < to ? pos + span - 1n : to;
    const page: EvmLogEntry[] = [];
    try {
      for (const f of filters) {
        const got = await reader.logs({
          ...(f.address === undefined ? {} : { address: f.address }),
          topics: f.topics,
          fromBlock: pos,
          toBlock: end,
        });
        if (!Array.isArray(got)) return { unreadable: "unparseable" };
        page.push(...got);
      }
    } catch (e) {
      if (whyRejected(e) === "history-gap") return { unreadable: "history-gap" };
      if (end === pos) return { unreadable: "transport" };
      span = (end - pos + 1n) / 2n;
      continue;
    }
    if (!page.every(isEntry)) return { unreadable: "unparseable" };
    entries.push(...page);
    pages++;
    pos = end + 1n;
  }
  return { entries, whole: true };
}

function isEntry(e: unknown): e is EvmLogEntry {
  return isLog(e) && normalHash((e as EvmLogEntry).transactionHash) !== null && typeof (e as EvmLogEntry).blockNumber === "bigint";
}

/** The other acts the caller gave: by transaction, each in the caller's spelling by its lowercase form; and by reference. */
function othersOf(query: EvmQuery<unknown>): { byTx: Map<string, string>; byRef: unknown[] } {
  const byTx = new Map<string, string>();
  const byRef: unknown[] = [];
  for (const o of (query.others ?? []) as readonly Record<string, unknown>[]) {
    if (typeof o["transaction"] === "string") byTx.set(lower(o["transaction"]), o["transaction"]);
    else if ("ref" in o) byRef.push(o["ref"]);
  }
  return { byTx, byRef };
}

/** What a logs-searching read observed, for `decide`, or the reason it established nothing. */
async function chargeFacts<R extends ChargeRefBase>(
  spec: ChargeSpec<R>,
  ref: R,
  reader: MppEvmReader,
  query: EvmQuery<unknown>,
): Promise<{ facts: Facts<bigint, EvmMark> & { seen: readonly SeenEvm[] } } | { unreadable: UnreadableReason }> {
  if (!isObject(ref)) return { unreadable: "unparseable" };
  const fault = readerFault(ref, reader);
  if (fault !== undefined) return { unreadable: fault };
  if (!spec.check(ref)) return { unreadable: "unparseable" };
  if (ref.transaction !== undefined && normalHash(ref.transaction) === null) return { unreadable: "unparseable" };

  const heads = await headsOf(reader);
  if ("unreadable" in heads) return heads;
  const markOf = (block: bigint): EvmMark =>
    block <= heads.final.number ? "finalized" : block <= heads.safe.number ? "safe" : "latest";

  // The single-use value at the final mark and at the latest head; the bound against each head's time.
  const atFinal = await spec.value(ref, reader, heads.final.number);
  if (typeof atFinal !== "boolean") return atFinal;
  const atLatest = heads.latest.number === heads.final.number ? atFinal : await spec.value(ref, reader, heads.latest.number);
  if (typeof atLatest !== "boolean") return atLatest;
  const bound = spec.deadline(ref);
  const past = (t: bigint): boolean => (bound.inclusive ? t >= bound.at : t > bound.at);
  const lapsedFinal = past(heads.final.timestamp);
  const lapsed = lapsedFinal || past(heads.safe.timestamp) || past(heads.latest.timestamp);
  const valueMark: EvmMark = lapsedFinal || !lapsed ? "finalized" : past(heads.safe.timestamp) ? "safe" : "latest";
  const value = { consumed: atFinal, lapsed, mark: valueMark, head: { consumed: atLatest } };

  // The search, from the position an earlier answer returned, else just after the position the caller gives.
  const start = query.search ?? (query.after !== undefined ? query.after + 1n : 0n);
  const s = await search(reader, spec.filters(ref), start, heads.latest.number);
  if ("unreadable" in s) return s;

  // Every transaction the search met, and the one the reference names, classified from what landed.
  const { byTx, byRef } = othersOf(query);
  const name = (h: Hex): Hex => (byTx.get(lower(h)) as Hex | undefined) ?? h;
  const hashes = new Map<string, Hex>();
  if (ref.transaction !== undefined) hashes.set(lower(ref.transaction), ref.transaction);
  for (const e of s.entries) if (!hashes.has(lower(e.transactionHash))) hashes.set(lower(e.transactionHash), e.transactionHash);
  const seen: SeenEvm[] = [];
  const undecoded: { transaction: Hex; at: bigint }[] = [];
  const read = async (key: string, hash: Hex): Promise<{ unreadable: UnreadableReason } | undefined> => {
    let receipt: EvmReceipt | null;
    try {
      receipt = await reader.receipt(hash);
    } catch (e) {
      return { unreadable: whyRejected(e) };
    }
    if (receipt === null) return undefined;
    if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return { unreadable: "unparseable" };
    let body: EvmTransaction | null | { unreadable: UnreadableReason } | undefined;
    const view: TxView = {
      hash,
      receipt,
      tx: async () => {
        if (body !== undefined) return body;
        try {
          const t = await reader.transaction(hash);
          body = t === null || (isObject(t) && typeof t.input === "string") ? t : { unreadable: "unparseable" };
        } catch (e) {
          body = { unreadable: whyRejected(e) };
        }
        return body;
      },
    };
    const c = await spec.classify(ref, view, reader);
    if ("unreadable" in c) return c;
    if ("undecodable" in c) {
      undecoded.push({ transaction: name(hash), at: receipt.blockNumber });
      return undefined;
    }
    for (const a of c.seen) {
      const given = byTx.has(key) || (a.signed !== undefined && byRef.some((o) => presentation(spec.presented(o), a.signed) === "yes"));
      seen.push({
        ...a,
        ...(a.kind === "same" && a.result === "succeeded" ? { presented: presentation(spec.presented(ref), a.signed) } : {}),
        transaction: name(hash),
        position: receipt.blockNumber,
        mark: markOf(receipt.blockNumber),
        ...(given ? { given } : {}),
      });
    }
    return undefined;
  };
  for (const [key, hash] of hashes) {
    const r = await read(key, hash);
    if (r !== undefined) return r;
  }
  // The transaction that consumed the value at or before the position given, where no act read took it.
  if (spec.consumers !== undefined && query.after !== undefined && (atFinal || atLatest) && !seen.some((a) => a.consumed)) {
    for (const hash of await consumerBelow(spec, ref, reader, query.after)) {
      if (hashes.has(lower(hash))) continue;
      hashes.set(lower(hash), hash);
      const r = await read(lower(hash), hash);
      if (r !== undefined) return r;
    }
  }
  // The act at the lowest position first, so that `decide` settles on the first that landed.
  seen.sort((a, b) => (a.position! < b.position! ? -1 : a.position! > b.position! ? 1 : 0));
  undecoded.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return {
    facts: {
      seen,
      value,
      search: { whole: s.whole && spec.notForH === undefined, ...(s.at === undefined ? {} : { at: s.at }) },
      ...(undecoded.length === 0 ? {} : { undecoded }),
      history: true,
    },
  };
}

/**
 * The transactions that may have consumed the value at or before `after`, the position given: where the value reads
 * consumed at `after`, the first block at which it reads consumed is found by halving `[0, after]`, one read of the
 * value a halving, and the logs `spec.consumers` names are read in that block alone. None where the value reads
 * unconsumed at `after`; a read of the value or of the logs that fails leaves the consumer unfound, so the answer stays
 * `search-incomplete`, never `failed`.
 */
async function consumerBelow<R extends ChargeRefBase>(spec: ChargeSpec<R>, ref: R, reader: MppEvmReader, after: bigint): Promise<Hex[]> {
  const consumed = async (block: bigint): Promise<boolean | undefined> => {
    const v = await spec.value(ref, reader, block).catch(() => undefined);
    return typeof v === "boolean" ? v : undefined;
  };
  if ((await consumed(after)) !== true) return [];
  // Invariant: consumed at b; unconsumed at a, or a is block 0 and consumed (b = a).
  let a = 0n;
  let b = after;
  const atZero = await consumed(0n);
  if (atZero === undefined) return [];
  if (atZero) b = 0n;
  while (b - a > 1n) {
    const m = (a + b) / 2n;
    const v = await consumed(m);
    if (v === undefined) return [];
    if (v) b = m;
    else a = m;
  }
  const out: Hex[] = [];
  try {
    for (const f of spec.consumers!(ref)) {
      const got = await reader.logs({ ...(f.address === undefined ? {} : { address: f.address }), topics: f.topics, fromBlock: b, toBlock: b });
      if (!Array.isArray(got)) return [];
      for (const e of got) if (isEntry(e) && !out.some((h) => same(h, e.transactionHash))) out.push(e.transactionHash);
    }
  } catch {
    return [];
  }
  return out;
}

/** An `eth_call` answer of one word, or the reason it is not one. */
async function callWord(reader: MppEvmReader, to: Hex, data: Hex, block: bigint): Promise<Uint8Array | { unreadable: UnreadableReason }> {
  let answer: unknown;
  try {
    answer = await reader.call(to, data, block);
  } catch (e) {
    return { unreadable: whyRejected(e) };
  }
  const word = bytesOf(answer, 32);
  return word === undefined || word.length !== 32 ? { unreadable: "unparseable" } : word;
}

// ── EIP-3009: `mpp/charge/evm/authorization` and `mpp/charge/usdc/evm`.

/** The reference an MPP EIP-3009 charge's read takes; the pairing's `reference` writes it. */
export interface MppEip3009Ref extends ChargeRefBase {
  /** The challenge's `currency`, the token under whose domain the payer signed, which records the nonce's use. */
  readonly authorization: { readonly at: Hex; readonly nonce: Hex; readonly deadline: string };
  /** The members of the payment presented: the token, `from`, `to`, `value` and `nonce`, lowercase, `value` in decimal. */
  readonly presented: Signed;
}

const PRESENTED_3009 = ["token", "from", "to", "value", "nonce"] as const;

function isSigned(s: unknown, names: readonly string[]): s is Signed {
  return isObject(s) && Object.values(s).every((v) => typeof v === "string") && names.every((n) => typeof s[n] === "string");
}

function isEip3009Ref(r: unknown): r is MppEip3009Ref {
  if (!isObject(r) || !isAddress(r["payer"]) || typeof r["payee"] !== "string" || !isObject(r["authorization"])) return false;
  const a = r["authorization"];
  return (
    isAddress(a["at"]) &&
    normalHash(a["nonce"]) !== null &&
    uint256Of(a["deadline"]) !== undefined &&
    isSigned(r["presented"], PRESENTED_3009) &&
    typeof r["network"] === "string" &&
    /^eip155:[1-9][0-9]*$/.test(r["network"])
  );
}

/** The calls through which a token consumes an EIP-3009 authorization, in their `v, r, s` and `bytes` forms. */
export const EIP3009_SELECTORS: readonly Hex[] = Object.freeze([
  "0xe3ee160e", // transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
  "0xcf092995", // transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)
  "0xef55bec6", // receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
  "0x88b7ab63", // receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)
] as Hex[]);

/** An EIP-3009 call decoded from a transaction's input: its signed words and its signature, where it is 65 bytes. */
interface Eip3009Call {
  readonly receive: boolean;
  readonly from: Hex;
  readonly to: Hex;
  readonly value: bigint;
  readonly validAfter: bigint;
  readonly validBefore: bigint;
  readonly nonce: Hex;
  /** `r`, `s` and `v` as the call carries them; absent for a `bytes` signature that is not 65 bytes. */
  readonly sig?: { readonly r: Uint8Array; readonly s: Uint8Array; readonly v: number };
}

function eip3009CallsIn(input: Uint8Array): Eip3009Call[] {
  const out: Eip3009Call[] = [];
  for (const c of callsIn(input, EIP3009_SELECTORS)) {
    const w = [0, 1, 2, 3, 4, 5].map((i) => wordAt(c.args, i));
    if (w.some((x) => x === undefined)) continue;
    const from = addressOfWord(w[0]!);
    const to = addressOfWord(w[1]!);
    if (from === undefined || to === undefined) continue;
    const receive = c.selector === "0xef55bec6" || c.selector === "0x88b7ab63";
    const packed = c.selector === "0xcf092995" || c.selector === "0x88b7ab63";
    let sig: Eip3009Call["sig"];
    if (!packed) {
      const v = wordAt(c.args, 6);
      const r = wordAt(c.args, 7);
      const s = wordAt(c.args, 8);
      if (v !== undefined && r !== undefined && s !== undefined && uintOf(v) < 256n) sig = { r, s, v: Number(uintOf(v)) };
    } else {
      const off = wordAt(c.args, 6);
      const o = off === undefined ? undefined : uintOf(off);
      const len = o === undefined || o > BigInt(c.args.length) ? undefined : wordAt(c.args.subarray(Number(o)), 0);
      if (o !== undefined && len !== undefined && uintOf(len) === 65n && Number(o) + 32 + 65 <= c.args.length) {
        const b = c.args.subarray(Number(o) + 32, Number(o) + 97);
        sig = { r: b.subarray(0, 32), s: b.subarray(32, 64), v: b[64]! };
      }
    }
    out.push({
      receive,
      from,
      to,
      value: uintOf(w[2]!),
      validAfter: uintOf(w[3]!),
      validBefore: uintOf(w[4]!),
      nonce: wordHex(w[5]!),
      ...(sig === undefined ? {} : { sig }),
    });
  }
  return out;
}

/** An ABI-encoded `string` return, or undefined where the answer is not one. */
function abiString(answer: unknown): Uint8Array | undefined {
  const b = bytesOf(answer, 4096);
  if (b === undefined || b.length < 64) return undefined;
  const off = uintOf(b.subarray(0, 32));
  if (off > BigInt(b.length - 32)) return undefined;
  const len = uintOf(b.subarray(Number(off), Number(off) + 32));
  const start = Number(off) + 32;
  if (len > BigInt(b.length - start)) return undefined;
  return b.subarray(start, start + Number(len));
}

/**
 * Whether `call`'s signature recovers to its `from` over the authorization in the EIP-712 domain of `contract`, its
 * name and version read from it at `block`, the network's chain id and the contract as the verifying contract: `true`,
 * `false`, or `undecodable` where the signature is not 65 bytes with a low `s` or the contract's name or version cannot
 * be read.
 */
async function verifies(
  call: Eip3009Call,
  contract: Hex,
  chainId: bigint,
  block: bigint,
  reader: MppEvmReader,
): Promise<boolean | "undecodable"> {
  if (call.sig === undefined) return "undecodable";
  let name: Uint8Array | undefined;
  let version: Uint8Array | undefined;
  try {
    name = abiString(await reader.call(contract, NAME_SELECTOR, block));
    version = abiString(await reader.call(contract, VERSION_SELECTOR, block));
  } catch {
    return "undecodable";
  }
  if (name === undefined || version === undefined) return "undecodable";
  const domain = keccak(
    concat([bytesOf(EIP712_DOMAIN_TYPEHASH)!, keccak(name), keccak(version), uintWord(chainId), addressWord(contract)]),
  );
  const struct = keccak(
    concat([
      bytesOf(call.receive ? RECEIVE_WITH_AUTHORIZATION_TYPEHASH : TRANSFER_WITH_AUTHORIZATION_TYPEHASH)!,
      addressWord(call.from),
      addressWord(call.to),
      uintWord(call.value),
      uintWord(call.validAfter),
      uintWord(call.validBefore),
      bytes32Word(call.nonce),
    ]),
  );
  const digest = keccak(concat([new Uint8Array([0x19, 0x01]), domain, struct]));
  const v = call.sig.v;
  const parity = v === 27 || v === 28 ? v - 27 : v === 0 || v === 1 ? v : -1;
  if (parity < 0) return "undecodable";
  try {
    const s = secp256k1.Signature.fromBytes(concat([call.sig.r, call.sig.s]), "compact");
    if (s.hasHighS()) return "undecodable";
    const key = s.addRecoveryBit(parity).recoverPublicKey(digest).toBytes(false).subarray(1);
    return same(hexOf(keccak(key).subarray(12)), call.from);
  } catch {
    return "undecodable";
  }
}

/**
 * The acts a transaction holds under EIP-3009 that carry the reference's nonce. Each `AuthorizationUsed` of that nonce,
 * on the asset, or on another contract where the payer's signature over the authorization the transaction carries
 * verifies in that contract's domain (one whose signature does not verify counts for nothing; one the read cannot
 * decode or verify holds the search); paired with its `Transfer` by that contract's two logs where the transaction holds
 * one use and at most one transfer of that authorizer there, and otherwise by the one call that consumed it, decoded
 * at any byte offset of the input, uses that decode alike taking their transfers one each in log order. Each of the
 * asset's `AuthorizationCanceled` over the nonce. In a reverted transaction, each call that would have consumed it.
 */
async function eip3009Classify(ref: MppEip3009Ref, view: TxView, reader: MppEvmReader): Promise<Classified> {
  const nonce = lower(ref.authorization.nonce) as Hex;
  const asset = ref.authorization.at;
  const { receipt } = view;
  const acts: Act[] = [];
  const input = async (): Promise<Uint8Array | null | { unreadable: UnreadableReason }> => {
    const tx = await view.tx();
    if (tx === null || "unreadable" in tx) return tx;
    return bytesOf(tx.input) ?? { unreadable: "unparseable" };
  };
  if (receipt.status === 0) {
    const bytes = await input();
    if (bytes === null) return { seen: [] };
    if ("unreadable" in bytes) return bytes;
    for (const c of eip3009CallsIn(bytes)) {
      if (!same(c.nonce, nonce)) continue;
      acts.push({
        result: "failed",
        consumed: false,
        carries: true,
        party: partyOf(c.from, ref.payer, ref.payee),
        kind: "same",
        account: same(c.to, ref.payee) ? "payee" : "other",
        signer: c.from,
      });
    }
    return { seen: acts };
  }
  const logs = receipt.logs;
  const transfers = transfersIn(logs);
  const usesAll = logs.filter((l) => l.topics.length === 3 && same(l.topics[0], AUTHORIZATION_USED_TOPIC));
  const uses = usesAll.filter((l) => same(l.topics[2], nonce));
  const taken = new Set<number>();
  const chainId = BigInt(ref.network.slice("eip155:".length));
  for (const l of uses) {
    const contract = lower(l.address) as Hex;
    const authorizer = topicAddress(l.topics[1]);
    if (authorizer === undefined || !isAddress(contract)) return { undecodable: true };
    const mine = usesAll.filter((u) => same(u.address, contract) && same(topicAddress(u.topics[1]), authorizer));
    const from = transfers.filter((t) => same(t.token, contract) && same(t.from, authorizer));
    const onAsset = same(contract, asset);
    let call: Eip3009Call | undefined;
    if (!onAsset || mine.length !== 1 || from.length > 1) {
      const bytes = await input();
      if (bytes === null) return { undecodable: true };
      if ("unreadable" in bytes) return bytes;
      const calls = eip3009CallsIn(bytes).filter((c) => same(c.from, authorizer) && same(c.nonce, nonce));
      if (calls.length !== 1) return { undecodable: true };
      call = calls[0]!;
    }
    if (!onAsset) {
      const ok = await verifies(call!, contract, chainId, receipt.blockNumber, reader);
      if (ok === "undecodable") return { undecodable: true };
      if (!ok) continue;
    }
    let transfer: TransferAt | undefined;
    if (mine.length === 1 && from.length <= 1) transfer = from[0];
    else {
      transfer = from.find((t) => !taken.has(t.log) && same(t.to, call!.to) && t.value === call!.value);
      if (transfer === undefined) return { undecodable: true };
    }
    if (transfer !== undefined) taken.add(transfer.log);
    acts.push({
      result: "succeeded",
      consumed: onAsset && same(authorizer, ref.payer),
      carries: true,
      party: partyOf(authorizer, ref.payer, ref.payee),
      kind: "same",
      account: transfer === undefined ? "none" : same(transfer.to, ref.payee) ? "payee" : "other",
      moved: transfer === undefined ? [] : [movedOf(transfer, view.hash)],
      signer: authorizer,
      ...(transfer === undefined
        ? {}
        : { signed: { token: contract, from: authorizer, to: transfer.to, value: transfer.value.toString(), nonce } }),
    });
  }
  for (const l of logs) {
    if (l.topics.length !== 3 || !same(l.topics[0], AUTHORIZATION_CANCELED_TOPIC) || !same(l.address, asset)) continue;
    if (!same(l.topics[2], nonce)) continue;
    const authorizer = topicAddress(l.topics[1]);
    acts.push({
      result: "succeeded",
      consumed: same(authorizer, ref.payer),
      carries: true,
      party: partyOf(authorizer, ref.payer, ref.payee),
      kind: "other",
      account: "none",
      moved: [],
      ...(authorizer === undefined ? {} : { signer: authorizer }),
    });
  }
  return { seen: acts };
}

/** `[AuthorizationUsed, payer, nonce]` on every contract and `[AuthorizationCanceled, null, nonce]` on the token. */
function eip3009Filters(ref: MppEip3009Ref): Filter[] {
  return [
    { topics: [AUTHORIZATION_USED_TOPIC, addressTopic(ref.payer), lower(ref.authorization.nonce) as Hex] },
    { address: ref.authorization.at, topics: [AUTHORIZATION_CANCELED_TOPIC, null, lower(ref.authorization.nonce) as Hex] },
  ];
}

const EIP3009_SPEC: ChargeSpec<MppEip3009Ref> = {
  check: isEip3009Ref,
  value: async (ref, reader, block) => {
    const data = hexOf(
      concat([bytesOf(AUTHORIZATION_STATE_SELECTOR)!, addressWord(ref.payer), bytes32Word(ref.authorization.nonce)]),
    );
    const w = await callWord(reader, ref.authorization.at, data, block);
    if (!(w instanceof Uint8Array)) return w;
    const v = uintOf(w);
    return v <= 1n ? v === 1n : { unreadable: "unparseable" };
  },
  deadline: (ref) => ({ at: BigInt(ref.authorization.deadline), inclusive: true }),
  filters: eip3009Filters,
  // The nonce's use or cancellation is indexed by the authorizer and the nonce: the search's own logs find it.
  consumers: eip3009Filters,
  classify: eip3009Classify,
  presented: (ref) => (isObject(ref) && isSigned(ref["presented"], PRESENTED_3009) ? ref["presented"] : undefined),
};

/**
 * The `status` of an MPP EIP-3009 charge: the value, `authorizationState(payer, nonce)` on the challenge's `currency`,
 * at the `finalized` block and at the latest block, lapsed where a head's time is at or past `validBefore`; the search
 * `[AuthorizationUsed, payer, nonce]` on every contract and `[AuthorizationCanceled, null, nonce]` on `currency`; each
 * transaction met classified as `eip3009Classify` states; where the value reads used at the position given and no
 * transaction read took it, the same logs read in the first block it reads used at (`consumerBelow`); `presented` on
 * `settled`, from the token's two paired logs.
 */
export const mppEip3009Status = chargeStatus(EIP3009_SPEC);

// ── Permit2: `mpp/charge/evm/permit2`.

/** The reference the MPP Permit2 charge's read takes; the pairing's `reference` writes it. */
export interface MppPermit2Ref extends ChargeRefBase {
  /** The Permit2 deployment that records the owner's nonce, the nonce, and the permit's `deadline`. */
  readonly authorization: { readonly at: Hex; readonly nonce: Hex; readonly deadline: string };
  /**
   * The members of the payment presented: the permit's `permitted` list (`token:amount`, comma-separated), `nonce`
   * and `deadline`, the `owner`, the transfer details (`to:requestedAmount`, comma-separated) and the witness's hash.
   */
  readonly presented: Signed;
}

const PRESENTED_PERMIT2 = ["permitted", "nonce", "deadline", "owner", "transfers", "witness"] as const;

function isPermit2Ref(r: unknown): r is MppPermit2Ref {
  if (!isObject(r) || !isAddress(r["payer"]) || typeof r["payee"] !== "string" || !isObject(r["authorization"])) return false;
  const a = r["authorization"];
  return (
    isAddress(a["at"]) &&
    normalHash(a["nonce"]) !== null &&
    uint256Of(a["deadline"]) !== undefined &&
    isSigned(r["presented"], PRESENTED_PERMIT2) &&
    typeof r["network"] === "string" &&
    /^eip155:[1-9][0-9]*$/.test(r["network"])
  );
}

/** Permit2's witness transfers: `permitWitnessTransferFrom`, single and batch. */
export const PERMIT2_WITNESS_SELECTORS: readonly Hex[] = Object.freeze([
  keccakHex(
    "permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)",
  ).slice(0, 10) as Hex,
  keccakHex(
    "permitWitnessTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)",
  ).slice(0, 10) as Hex,
]);

/** A Permit2 witness transfer decoded from a transaction's input. */
interface Permit2Call {
  readonly own: boolean;
  readonly permitted: readonly { readonly token: Hex; readonly amount: bigint }[];
  readonly nonce: Hex;
  readonly deadline: bigint;
  readonly transfers: readonly { readonly to: Hex; readonly amount: bigint }[];
  readonly owner: Hex;
  readonly witness: Hex;
}

/** A dynamic ABI array of two-word tuples at byte offset `at` of `args`, at most `max` long. */
function pairsAt(args: Uint8Array, at: bigint, max: number): [Uint8Array, Uint8Array][] | undefined {
  if (at > BigInt(args.length)) return undefined;
  const body = args.subarray(Number(at));
  const n = wordAt(body, 0);
  if (n === undefined || uintOf(n) > BigInt(max)) return undefined;
  const out: [Uint8Array, Uint8Array][] = [];
  for (let i = 0; i < Number(uintOf(n)); i++) {
    const a = wordAt(body, 1 + 2 * i);
    const b = wordAt(body, 2 + 2 * i);
    if (a === undefined || b === undefined) return undefined;
    out.push([a, b]);
  }
  return out;
}

function permit2CallsIn(input: Uint8Array, txTo: Hex | null, permit2: Hex): Permit2Call[] {
  const out: Permit2Call[] = [];
  for (const c of callsIn(input, PERMIT2_WITNESS_SELECTORS)) {
    const own = c.at === 0 && same(txTo, permit2);
    if (c.selector === PERMIT2_WITNESS_SELECTORS[0]) {
      const w = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => wordAt(c.args, i));
      if (w.some((x) => x === undefined)) continue;
      const token = addressOfWord(w[0]!);
      const to = addressOfWord(w[4]!);
      const owner = addressOfWord(w[6]!);
      if (token === undefined || to === undefined || owner === undefined) continue;
      out.push({
        own,
        permitted: [{ token, amount: uintOf(w[1]!) }],
        nonce: wordHex(w[2]!),
        deadline: uintOf(w[3]!),
        transfers: [{ to, amount: uintOf(w[5]!) }],
        owner,
        witness: wordHex(w[7]!),
      });
      continue;
    }
    const w = [0, 1, 2, 3].map((i) => wordAt(c.args, i));
    if (w.some((x) => x === undefined)) continue;
    const owner = addressOfWord(w[2]!);
    const permitAt = uintOf(w[0]!);
    if (owner === undefined || permitAt > BigInt(c.args.length)) continue;
    const permit = c.args.subarray(Number(permitAt));
    const p = [0, 1, 2].map((i) => wordAt(permit, i));
    if (p.some((x) => x === undefined)) continue;
    const permitted = pairsAt(permit, uintOf(p[0]!), 16);
    const details = pairsAt(c.args, uintOf(w[1]!), 16);
    if (permitted === undefined || details === undefined) continue;
    const tokens = permitted.map(([t, a]) => ({ token: addressOfWord(t), amount: uintOf(a) }));
    const tos = details.map(([t, a]) => ({ to: addressOfWord(t), amount: uintOf(a) }));
    if (tokens.some((t) => t.token === undefined) || tos.some((t) => t.to === undefined)) continue;
    out.push({
      own,
      permitted: tokens as { token: Hex; amount: bigint }[],
      nonce: wordHex(p[1]!),
      deadline: uintOf(p[2]!),
      transfers: tos as { to: Hex; amount: bigint }[],
      owner,
      witness: wordHex(w[3]!),
    });
  }
  return out;
}

/** The members of a decoded witness transfer, as `presented` compares them. */
function permit2Signed(c: Permit2Call): Signed {
  return {
    permitted: c.permitted.map((p) => `${lower(p.token)}:${p.amount}`).join(","),
    nonce: lower(c.nonce),
    deadline: c.deadline.toString(),
    owner: lower(c.owner),
    transfers: c.transfers.map((t) => `${lower(t.to)}:${t.amount}`).join(","),
    witness: lower(c.witness),
  };
}

/** Bit `nonce & 0xff` of `nonceBitmap(owner, nonce >> 8)` on Permit2 at `block`. */
async function bitSet(at: Hex, owner: Hex, nonce: Hex, block: bigint, reader: MppEvmReader): Promise<boolean | { unreadable: UnreadableReason }> {
  const n = BigInt(nonce);
  const data = hexOf(concat([bytesOf(NONCE_BITMAP_SELECTOR)!, addressWord(owner), uintWord(n >> 8n)]));
  const w = await callWord(reader, at, data, block);
  if (!(w instanceof Uint8Array)) return w;
  return ((uintOf(w) >> (n & 0xffn)) & 1n) === 1n;
}

/**
 * The acts a transaction holds over Permit2 that carry H: the reference's nonce, or the witness word of the challenge it
 * holds (the presented `witness`, the EIP-712 hash of `PaymentWitness{challengeHash, externalId}`, draft-evm-charge-00
 * at tempoxyz/mpp-specs 08e7dd87, lines 449-483). Each witness transfer found at any byte offset of the input whose owner
 * is the payer and that carries the nonce or the witness word, counted where the receipt holds, for each transfer it
 * names, a `Transfer` of its token from the owner to its recipient of its amount, and the owner's bit for the call's own
 * nonce is set at the receipt's block and unset at the block before; what moved is those transfers, and it consumed the
 * value where its nonce is the reference's. An input that carries the nonce or the witness word with no such call
 * decoded holds the search, unless it holds another pairing's act over the nonce, an EIP-3009 use the token logged
 * (`eip3009Uses`). Each Permit2 `UnorderedNonceInvalidation` of the payer that covers the nonce. In a reverted
 * transaction, each such call.
 */
async function permit2Classify(ref: MppPermit2Ref, view: TxView, reader: MppEvmReader): Promise<Classified> {
  const nonce = lower(ref.authorization.nonce) as Hex;
  const at = ref.authorization.at;
  const acts: Act[] = [];
  const { receipt } = view;
  const n = BigInt(nonce);
  for (const l of receipt.logs) {
    if (!same(l.address, at) || l.topics.length !== 2 || !same(l.topics[0], UNORDERED_NONCE_INVALIDATION_TOPIC)) continue;
    const owner = topicAddress(l.topics[1]);
    const data = bytesOf(l.data);
    if (owner === undefined || data === undefined || data.length !== 64) continue;
    const word = uintOf(data.subarray(0, 32));
    const mask = uintOf(data.subarray(32, 64));
    if (word !== n >> 8n || ((mask >> (n & 0xffn)) & 1n) === 0n) continue;
    acts.push({
      result: "succeeded",
      consumed: same(owner, ref.payer),
      carries: true,
      party: partyOf(owner, ref.payer, ref.payee),
      kind: "other",
      account: "none",
      moved: [],
      signer: owner,
    });
  }
  const tx = await view.tx();
  if (tx === null) return { seen: acts };
  if ("unreadable" in tx) return tx;
  const input = bytesOf(tx.input);
  if (input === undefined) return { unreadable: "unparseable" };
  const witness = lower(ref.presented["witness"] ?? "") as Hex;
  if (!inputCarries(input, nonce) && !inputCarries(input, witness)) return { seen: acts };
  const calls = permit2CallsIn(input, tx.to, at).filter((c) => (same(c.nonce, nonce) || same(c.witness, witness)) && same(c.owner, ref.payer));
  const transfers = transfersIn(receipt.logs);
  if (calls.length === 0) {
    const used = eip3009Uses(receipt, input, nonce, transfers, ref, view.hash);
    if (used.length > 0) return { seen: [...acts, ...used] };
    return acts.length > 0 ? { seen: acts } : { undecodable: true };
  }
  const taken = new Set<number>();
  for (const c of calls) {
    const account = c.transfers.some((t) => same(t.to, ref.payee)) ? "payee" : "other";
    const party = partyOf(c.owner, ref.payer, ref.payee);
    if (receipt.status === 0) {
      acts.push({ result: "failed", consumed: false, carries: true, party, kind: "same", account, signer: c.owner });
      continue;
    }
    if (c.permitted.length !== c.transfers.length) continue;
    const paid: TransferAt[] = [];
    for (const [i, d] of c.transfers.entries()) {
      const token = c.permitted[i]!.token;
      const t = transfers.find(
        (x) => !taken.has(x.log) && !paid.includes(x) && same(x.token, token) && same(x.from, c.owner) && same(x.to, d.to) && x.value === d.amount,
      );
      if (t !== undefined) paid.push(t);
    }
    if (paid.length !== c.transfers.length) continue;
    const after = await bitSet(at, c.owner, c.nonce, receipt.blockNumber, reader);
    if (typeof after !== "boolean") return after;
    if (!after) continue;
    const before = receipt.blockNumber === 0n ? false : await bitSet(at, c.owner, c.nonce, receipt.blockNumber - 1n, reader);
    if (typeof before !== "boolean") return before;
    if (before) continue;
    for (const t of paid) taken.add(t.log);
    acts.push({
      result: "succeeded",
      consumed: same(c.owner, ref.payer) && same(c.nonce, nonce),
      carries: true,
      party,
      kind: "same",
      account: paid.some((t) => same(t.to, ref.payee)) ? "payee" : "other",
      moved: paid.map((t) => movedOf(t, view.hash)),
      signer: c.owner,
      // What the payer signed: the decoded call where it is the transaction's own; a wrapped call's arguments are not
      // shown to be what ran, and `presented` is then `unshown`.
      ...(c.own ? { signed: permit2Signed(c) } : {}),
    });
  }
  return { seen: acts };
}

/**
 * The acts of another pairing over the same nonce in a transaction that holds no Permit2 call carrying it: each
 * EIP-3009 call whose nonce it is (the `authorization` charge of the same challenge signs that digest as its nonce)
 * and whose use the token logged, `AuthorizationUsed` of its `from` and the nonce, an act of another kind that
 * consumes no Permit2 bit, with the token's `Transfer` from `from` to the call's `to` of its value.
 */
function eip3009Uses(
  receipt: EvmReceipt,
  input: Uint8Array,
  nonce: Hex,
  transfers: readonly TransferAt[],
  ref: MppPermit2Ref,
  hash: Hex,
): Act[] {
  if (receipt.status !== 1) return [];
  const out: Act[] = [];
  for (const c of eip3009CallsIn(input)) {
    if (!same(c.nonce, nonce)) continue;
    const use = receipt.logs.find(
      (l) => l.topics.length === 3 && same(l.topics[0], AUTHORIZATION_USED_TOPIC) && same(topicAddress(l.topics[1]), c.from) && same(l.topics[2], nonce),
    );
    if (use === undefined) continue;
    const t = transfers.find((x) => same(x.token, use.address) && same(x.from, c.from) && same(x.to, c.to) && x.value === c.value);
    out.push({
      result: "succeeded",
      consumed: false,
      carries: true,
      party: partyOf(c.from, ref.payer, ref.payee),
      kind: "other",
      account: same(c.to, ref.payee) ? "payee" : "other",
      moved: t === undefined ? [] : [movedOf(t, hash)],
      signer: c.from,
    });
  }
  return out;
}

/** Every contract's `[Transfer, payer]` and Permit2's `[UnorderedNonceInvalidation, payer]`. */
function permit2Filters(ref: MppPermit2Ref): Filter[] {
  return [
    { topics: [TRANSFER_TOPIC, addressTopic(ref.payer)] },
    { address: ref.authorization.at, topics: [UNORDERED_NONCE_INVALIDATION_TOPIC, addressTopic(ref.payer)] },
  ];
}

const PERMIT2_SPEC: ChargeSpec<MppPermit2Ref> = {
  check: isPermit2Ref,
  value: (ref, reader, block) => bitSet(ref.authorization.at, ref.payer, ref.authorization.nonce, block, reader),
  deadline: (ref) => ({ at: BigInt(ref.authorization.deadline), inclusive: false }),
  filters: permit2Filters,
  // The payer's `Transfer` whose transaction carries the nonce in a Permit2 call, or its `UnorderedNonceInvalidation`.
  consumers: permit2Filters,
  classify: permit2Classify,
  presented: (ref) => (isObject(ref) && isSigned(ref["presented"], PRESENTED_PERMIT2) ? ref["presented"] : undefined),
};

/**
 * The `status` of the MPP Permit2 charge: the value, the owner's bit for the nonce on the Permit2 deployment, at the
 * `finalized` block and at the latest block, lapsed where a head's time is past `deadline`; the search, every contract's
 * `Transfer` from the payer and Permit2's `UnorderedNonceInvalidation` of the payer; each transaction met classified as
 * `permit2Classify` states; `presented` on `settled`, from the decoded call where it is the transaction's own.
 */
export const mppPermit2Status = chargeStatus(PERMIT2_SPEC);

// ── The EVM session's opening: `mpp/session/evm`.

/** `openWithAuthorization(address,address,uint128,bytes32,address,address,uint256,uint256,bytes32,bytes)`. */
export const OPEN_WITH_AUTHORIZATION_SELECTOR = keccakHex(
  "openWithAuthorization(address,address,uint128,bytes32,address,address,uint256,uint256,bytes32,bytes)",
).slice(0, 10) as Hex;
/** `openWithPermit2(address,address,uint128,bytes32,address,address,uint256,uint256,bytes)`. */
export const OPEN_WITH_PERMIT2_SELECTOR = keccakHex(
  "openWithPermit2(address,address,uint128,bytes32,address,address,uint256,uint256,bytes)",
).slice(0, 10) as Hex;
/** `open(address,address,uint128,bytes32,address)`, the opening its payer sends itself, funded by a `hash`. */
const OPEN_SELECTOR = keccakHex("open(address,address,uint128,bytes32,address)").slice(0, 10) as Hex;

/** The reference the EVM session's opening read takes; the pairing's `reference` writes it. */
export interface MppSessionOpeningRef extends ChargeRefBase {
  /** The escrow, the channel the opening opens, H and the chain. */
  readonly opens: { readonly escrow: Hex; readonly channel: Hex; readonly h: Hex; readonly chainId: number };
  /**
   * The funding the payer signed: its type; the challenge's `currency`; the contract that keeps its single-use value,
   * the token for an `authorization` and the Permit2 deployment for a `permit2`; that value, the authorization's nonce
   * or the permit's nonce as a 32-byte word; and its signed bound, `validBefore` or `deadline`, in decimal.
   */
  readonly funding: {
    readonly type: "authorization" | "permit2";
    readonly token: Hex;
    readonly at: Hex;
    readonly nonce: Hex;
    readonly deadline: string;
  };
  /**
   * The members of the payment presented, lowercase, numbers in decimal: `funding`, the type; on an `authorization`
   * the token, `from`, `to` and `value` and `nonce`, EIP-3009's members; on a `permit2` the token, `amount`, `nonce`,
   * `deadline`, `spender` and `owner`, and `witness`, the witness's `payee:salt:authorizedSigner`.
   */
  readonly presented: Signed;
}

const PRESENTED_OPENING: Readonly<Record<"authorization" | "permit2", readonly string[]>> = {
  authorization: ["funding", "token", "from", "to", "value", "nonce"],
  permit2: ["funding", "token", "amount", "nonce", "deadline", "spender", "owner", "witness"],
};

function isOpeningRef(r: unknown): r is MppSessionOpeningRef {
  if (!isObject(r) || !isAddress(r["payer"]) || typeof r["payee"] !== "string") return false;
  const o = r["opens"];
  const f = r["funding"];
  if (!isObject(o) || !isObject(f)) return false;
  const chainId = o["chainId"];
  const type = f["type"];
  return (
    isAddress(o["escrow"]) &&
    normalHash(o["channel"]) !== null &&
    normalHash(o["h"]) !== null &&
    typeof chainId === "number" &&
    Number.isSafeInteger(chainId) &&
    chainId > 0 &&
    (type === "authorization" || type === "permit2") &&
    isAddress(f["token"]) &&
    isAddress(f["at"]) &&
    normalHash(f["nonce"]) !== null &&
    uint256Of(f["deadline"]) !== undefined &&
    isSigned(r["presented"], PRESENTED_OPENING[type]) &&
    typeof r["network"] === "string" &&
    /^eip155:[1-9][0-9]*$/.test(r["network"])
  );
}

/** An escrow open call decoded from a transaction's input: the channel's members and its funding's. */
interface OpenCall {
  readonly funding: "authorization" | "permit2" | "hash";
  /** Whether it is the transaction's own call to the escrow. */
  readonly own: boolean;
  readonly payee: Hex;
  readonly token: Hex;
  readonly deposit: bigint;
  readonly salt: Hex;
  readonly signer: Hex;
  /** The payer: the funding's `from`, or the sender of an `open` it sends itself. */
  readonly from: Hex;
  /** The funding's nonce and bound: EIP-3009's `nonce` and `validBefore`, or Permit2's `nonce` and `deadline`. */
  readonly nonce?: Hex;
  readonly deadline?: bigint;
}

/**
 * The escrow's open calls in `input`: `openWithAuthorization` and `openWithPermit2` at any byte offset, their payer
 * being their `from`; and `open`, funded by a `hash`, only as the transaction's own call to the escrow, its payer the
 * sender, since a wrapped one's caller is not shown.
 */
function openCallsIn(input: Uint8Array, tx: EvmTransaction, escrow: Hex): OpenCall[] {
  const out: OpenCall[] = [];
  for (const c of callsIn(input, [OPEN_WITH_AUTHORIZATION_SELECTOR, OPEN_WITH_PERMIT2_SELECTOR, OPEN_SELECTOR])) {
    const own = c.at === 0 && same(tx.to, escrow);
    const plain = c.selector === OPEN_SELECTOR;
    if (plain && !own) continue;
    const n = c.selector === OPEN_WITH_AUTHORIZATION_SELECTOR ? 9 : plain ? 5 : 8;
    const w = Array.from({ length: n }, (_, i) => wordAt(c.args, i));
    if (w.some((x) => x === undefined)) continue;
    const payee = addressOfWord(w[0]!);
    const token = addressOfWord(w[1]!);
    const signer = addressOfWord(w[4]!);
    const from = plain ? (isAddress(tx.from) ? (lower(tx.from) as Hex) : undefined) : addressOfWord(w[5]!);
    if (payee === undefined || token === undefined || signer === undefined || from === undefined) continue;
    const common = { own, payee, token, deposit: uintOf(w[2]!), salt: wordHex(w[3]!), signer, from };
    if (plain) out.push({ funding: "hash", ...common });
    else if (c.selector === OPEN_WITH_AUTHORIZATION_SELECTOR) {
      out.push({ funding: "authorization", ...common, nonce: wordHex(w[8]!), deadline: uintOf(w[7]!) });
    } else out.push({ funding: "permit2", ...common, nonce: wordHex(w[6]!), deadline: uintOf(w[7]!) });
  }
  return out;
}

/** The nonce `openWithAuthorization` recomputes and the token consumes: keccak256(abi.encode(from, payee, token, salt, signer)). */
function openingNonce(c: OpenCall): Hex {
  return keccakHex(concat([addressWord(c.from), addressWord(c.payee), addressWord(c.token), bytes32Word(c.salt), addressWord(c.signer)]));
}

/**
 * The acts a transaction holds that open a channel at the reference's escrow. The draft's escrow emits no event, so an
 * open call decoded from the input (`openCallsIn`) counts only where the receipt shows the escrow ran it: an
 * `openWithAuthorization` by its token's `AuthorizationUsed` of its `from` and its nonce, the nonce being the one the
 * escrow recomputes over the call's from, payee, token, salt and signer (`openingNonce`) before the token consumes it
 * (draft-evm-session-00, `openWithAuthorization`); an `openWithPermit2` or an `open` only as the transaction's own call,
 * sent to the escrow with the call at the input's start. Each counts with its deposit, a `Transfer` of its token from
 * its payer to the escrow of the deposit, which no other call took. A decoded call that carries H, or the funding's
 * nonce, and that the receipt does not show so makes the transaction an item the read cannot decode: calldata alone
 * shows no opening ran. A counted call carries H where its salt is H; its signer is its payer; it names the payee's
 * account where its `payee` is the option's payee; what moved is the deposit, recorded with the channel's `payee` as the
 * beneficiary; it is of the pairing's kind where an `authorization` or a `permit2` funds it, and of another where its
 * payer sent it itself (`hash`). It consumed the reference's value where its funding is the reference's, of the
 * payer and the nonce: on an `authorization` the token logged `AuthorizationUsed` of the payer and the nonce, on a
 * `permit2` the payer's bit for the nonce is set at its block and unset at the block before. What the payer signed is
 * read on an `authorization` from the token's two logs, on a `permit2` from the call. A transaction that holds the
 * payer's `AuthorizationUsed` of the nonce, or a deposit of the payer's, in any token, to the escrow, whose input
 * carries H or the nonce in no call so counted is an item the read cannot decode; on an `authorization` an EIP-3009 call
 * of the payer over the nonce that is no opening is an act of another kind that consumed the value. A reverted
 * transaction's own call to the escrow is a failed act that consumed nothing; a wrapped call in it carrying H or the
 * nonce is an item the read cannot decode.
 */
async function openingClassify(ref: MppSessionOpeningRef, view: TxView, reader: MppEvmReader): Promise<Classified> {
  const { receipt } = view;
  const escrow = ref.opens.escrow;
  const f = ref.funding;
  const nonce = lower(f.nonce) as Hex;
  const tx = await view.tx();
  if (tx === null) return { seen: [] };
  if ("unreadable" in tx) return tx;
  const input = bytesOf(tx.input);
  if (input === undefined) return { unreadable: "unparseable" };
  const calls = openCallsIn(input, tx, escrow);
  const acts: Act[] = [];
  const carries = (c: OpenCall): boolean => same(c.salt, ref.opens.h);
  const party = (c: OpenCall) => partyOf(c.from, ref.payer, ref.payee);
  const account = (c: OpenCall): "payee" | "other" => (same(c.payee, ref.payee) ? "payee" : "other");
  // A call carrying H or the funding's nonce that the receipt does not show the escrow ran.
  const unshown = (c: OpenCall): boolean => carries(c) || (c.nonce !== undefined && same(c.nonce, nonce));
  if (receipt.status === 0) {
    for (const c of calls) {
      if (!c.own) {
        if (unshown(c)) return { undecodable: true };
        continue;
      }
      if (c.funding === "hash") continue;
      acts.push({ result: "failed", consumed: false, carries: carries(c), party: party(c), kind: "same", account: account(c), signer: c.from });
    }
    return { seen: acts };
  }
  const transfers = transfersIn(receipt.logs);
  const usedOn = (token: Hex, from: Hex, n: Hex): boolean =>
    receipt.logs.some(
      (l) => l.topics.length === 3 && same(l.address, token) && same(l.topics[0], AUTHORIZATION_USED_TOPIC) && same(topicAddress(l.topics[1]), from) && same(l.topics[2], n),
    );
  const used = (from: Hex, n: Hex): boolean => usedOn(f.token, from, n);
  const taken = new Set<number>();
  for (const c of calls) {
    const ran = c.funding === "authorization" ? same(c.nonce, openingNonce(c)) && usedOn(c.token, c.from, c.nonce!) : c.own;
    const t = ran
      ? transfers.find((x) => !taken.has(x.log) && same(x.token, c.token) && same(x.from, c.from) && same(x.to, escrow) && x.value === c.deposit)
      : undefined;
    if (t === undefined) {
      if (unshown(c)) return { undecodable: true };
      continue;
    }
    taken.add(t.log);
    let consumed = false;
    // Permit2 keeps one bitmap across the payer's tokens; EIP-3009 keeps each token's nonces apart.
    if (c.funding === f.type && same(c.from, ref.payer) && same(c.nonce, nonce) && (f.type === "permit2" || same(c.token, f.token))) {
      if (f.type === "authorization") consumed = used(c.from, nonce);
      else {
        const after = await bitSet(f.at, c.from, nonce, receipt.blockNumber, reader);
        if (typeof after !== "boolean") return after;
        const before = !after || receipt.blockNumber === 0n ? false : await bitSet(f.at, c.from, nonce, receipt.blockNumber - 1n, reader);
        if (typeof before !== "boolean") return before;
        consumed = after && !before;
      }
    }
    let signed: Signed | undefined;
    if (c.funding === "authorization") {
      signed = { funding: "authorization", token: lower(c.token), from: lower(c.from), to: lower(escrow), value: c.deposit.toString(), nonce: lower(c.nonce!) };
    } else if (c.funding === "permit2") {
      signed = {
        funding: "permit2",
        token: lower(c.token),
        amount: c.deposit.toString(),
        nonce: lower(c.nonce!),
        deadline: c.deadline!.toString(),
        spender: lower(escrow),
        owner: lower(c.from),
        witness: `${lower(c.payee)}:${lower(c.salt)}:${lower(c.signer)}`,
      };
    }
    acts.push({
      result: "succeeded",
      consumed,
      carries: carries(c),
      party: party(c),
      kind: c.funding === "hash" ? "other" : "same",
      account: account(c),
      moved: [{ asset: c.token, amount: c.deposit.toString(), to: c.payee, transaction: view.hash, place: t.log }],
      signer: c.from,
      ...(signed === undefined ? {} : { signed }),
    });
  }
  // A use of the payer's value, or a deposit of the payer's to the escrow, that no open call above accounts for.
  const unaccounted =
    f.type === "authorization"
      ? used(ref.payer, nonce) && !acts.some((a) => a.consumed)
      : transfers.some((x) => !taken.has(x.log) && same(x.from, ref.payer) && same(x.to, escrow));
  if (unaccounted) {
    if (f.type === "authorization") {
      const other = eip3009CallsIn(input).filter((c) => same(c.from, ref.payer) && same(c.nonce, nonce));
      if (other.length === 1) {
        const c = other[0]!;
        const t = transfers.find((x) => same(x.token, f.token) && same(x.from, c.from) && same(x.to, c.to) && x.value === c.value);
        acts.push({
          result: "succeeded",
          consumed: true,
          carries: false,
          party: "payer",
          kind: "other",
          account: same(c.to, ref.payee) ? "payee" : "other",
          moved: t === undefined ? [] : [movedOf(t, view.hash)],
          signer: c.from,
        });
        return { seen: acts };
      }
    }
    if (inputCarries(input, ref.opens.h) || inputCarries(input, nonce)) return { undecodable: true };
  }
  return { seen: acts };
}

const OPENING_SPEC: ChargeSpec<MppSessionOpeningRef> = {
  check: isOpeningRef,
  value: async (ref, reader, block) => {
    const f = ref.funding;
    if (f.type === "permit2") return bitSet(f.at, ref.payer, f.nonce, block, reader);
    const data = hexOf(concat([bytesOf(AUTHORIZATION_STATE_SELECTOR)!, addressWord(ref.payer), bytes32Word(f.nonce)]));
    const w = await callWord(reader, f.at, data, block);
    if (!(w instanceof Uint8Array)) return w;
    const v = uintOf(w);
    return v <= 1n ? v === 1n : { unreadable: "unparseable" };
  },
  // EIP-3009 takes an authorization before `validBefore`; Permit2 a permit at or before `deadline`.
  deadline: (ref) => ({ at: BigInt(ref.funding.deadline), inclusive: ref.funding.type === "authorization" }),
  filters: (ref) =>
    ref.funding.type === "authorization"
      ? [{ address: ref.funding.token, topics: [AUTHORIZATION_USED_TOPIC, addressTopic(ref.payer), lower(ref.funding.nonce) as Hex] }]
      : [{ topics: [TRANSFER_TOPIC, addressTopic(ref.payer), addressTopic(ref.opens.escrow)] }],
  // The funding's own logs: the currency's `AuthorizationUsed` of the payer and the nonce, or the payer's `Transfer` to
  // the escrow.
  consumers: (ref) => OPENING_SPEC.filters(ref),
  classify: openingClassify,
  presented: (ref) => {
    if (!isObject(ref) || !isObject(ref["funding"])) return undefined;
    const type = ref["funding"]["type"];
    if (type !== "authorization" && type !== "permit2") return undefined;
    return isSigned(ref["presented"], PRESENTED_OPENING[type]) ? ref["presented"] : undefined;
  },
  notForH: true,
};

/**
 * The `status` of the EVM session's opening, met by its funding (mpp-session-evm-tempo.md rule 6). The value is the
 * funding's: `authorizationState(payer, nonce)` on the challenge's `currency` for an `authorization`, lapsed at a head
 * whose time is at or past `validBefore`, and the payer's Permit2 bit at the nonce it signed for a `permit2`, lapsed
 * past `deadline`; each read at the `finalized` block and at the latest block. The search: the currency's
 * `AuthorizationUsed` of the payer and the nonce, whose nonce is over the token; or every contract's `Transfer` from the
 * payer to the escrow, by a filter that names no address, since the payer's Permit2 bit is one across its tokens and the
 * read compares no asset; each transaction met classified as `openingClassify` states, an opening counted only where
 * the receipt shows the escrow ran it; where the value reads used at the position given and no transaction read took
 * it, the search's logs read in the first block it reads used at (`consumerBelow`). The nonce of an `authorization` is a digest over the recipient and the token
 * as well as H, and a `permit2`'s any unused value, so neither search is a search for H: it is never read whole, and the
 * answer is never `failed` but `before-position`. `presented` on `settled`, from what `openingClassify` reads.
 */
export const mppSessionOpeningStatus = chargeStatus(OPENING_SPEC);

// ── Coverage `none`: `mpp/charge/evm/transaction` and `mpp/charge/evm/hash`.

/** The reference the named-transaction read takes: the transaction the credential carries or names, its payer, the payee. */
export interface MppNamedRef {
  readonly network: `eip155:${string}`;
  readonly payee: string;
  readonly payer: Hex;
  /** The transaction the credential names (`hash`) or carries (`transaction`, by the hash of its signed bytes). */
  readonly transaction: Hex;
}

function isNamedRef(r: unknown): r is MppNamedRef {
  return (
    isObject(r) &&
    isAddress(r["payer"]) &&
    typeof r["payee"] === "string" &&
    normalHash(r["transaction"]) !== null &&
    typeof r["network"] === "string" &&
    /^eip155:[1-9][0-9]*$/.test(r["network"])
  );
}

/**
 * The `status` of the `transaction` and `hash` charges, at coverage `none`: the act is the transaction the reference
 * names. Found, it is read whole: its signer, the transaction's `from`, against the reference's payer and the option's
 * payee; what it moved, each `Transfer` from its signer by its log (never the system emitter's); the account test, a
 * transfer to the payee, or, where it reverted and moved nothing, the recipient of the `transfer` call that is the
 * transaction's own; its result; and the payer's account nonce it consumed by its inclusion, whatever its result. Not found, the lookup was read
 * whole, and the reader shows the history it would be in where the seller declares the endpoint archival or it answers a
 * read at the position the caller gives. `presented` on `settled` is `yes`, the act being the transaction the
 * credential names.
 */
export async function mppNamedStatus(ref: MppNamedRef, reader: MppEvmReader, query: EvmQuery<unknown>): Promise<MppEvmStatus> {
  if (!isEvmQuery(query)) return QUERY_UNPARSEABLE;
  const read = await namedFacts(ref, reader, query);
  if ("unreadable" in read) return { state: "unreadable", reason: read.unreadable, foreign: [] };
  return decide(read, query, evmLedger("none"));
}

async function namedFacts(
  ref: MppNamedRef,
  reader: MppEvmReader,
  query: EvmQuery<unknown>,
): Promise<Facts<bigint, EvmMark> | { unreadable: UnreadableReason }> {
  if (!isObject(ref)) return { unreadable: "unparseable" };
  const fault = readerFault(ref, reader);
  if (fault !== undefined) return { unreadable: fault };
  if (!isNamedRef(ref)) return { unreadable: "unparseable" };
  const heads = await headsOf(reader);
  if ("unreadable" in heads) return heads;
  let receipt: EvmReceipt | null;
  let tx: EvmTransaction | null;
  try {
    receipt = await reader.receipt(ref.transaction);
    tx = receipt === null ? null : await reader.transaction(ref.transaction);
  } catch (e) {
    return { unreadable: whyRejected(e) };
  }
  if (receipt === null || tx === null) {
    let history = reader.archival === true;
    if (!history && query.after !== undefined) {
      try {
        history = isBlock(await reader.block(query.after));
      } catch (e) {
        const why = whyRejected(e);
        if (why !== "history-gap") return { unreadable: why };
      }
    }
    return { seen: [], search: { whole: true }, history };
  }
  if (!isReceipt(receipt) || !receipt.logs.every(isLog) || !isObject(tx) || !isAddress(tx.from)) {
    return { unreadable: "unparseable" };
  }
  const block = receipt.blockNumber;
  const mark: EvmMark = block <= heads.final.number ? "finalized" : block <= heads.safe.number ? "safe" : "latest";
  const signer = lower(tx.from) as Hex;
  const sent = transfersIn(receipt.logs).filter((t) => same(t.from, signer));
  const named = (byTx: Map<string, string>): Hex => (byTx.get(lower(ref.transaction)) as Hex | undefined) ?? ref.transaction;
  const { byTx } = othersOf(query);
  // The account the act names: a succeeded one's by the transfers it made; a reverted one, which made none, by the
  // recipient of the `transfer` call the payer signed as the transaction's own.
  const recipients: readonly Hex[] = receipt.status === 1 ? sent.map((t) => t.to) : transferCallRecipient(tx);
  const seen: SeenEvm = {
    transaction: named(byTx),
    position: block,
    mark,
    result: receipt.status === 1 ? "succeeded" : "failed",
    consumed: true,
    carries: false,
    party: partyOf(signer, ref.payer, ref.payee),
    kind: "same",
    account: recipients.some((to) => same(to, ref.payee)) ? "payee" : recipients.length > 0 ? "other" : "none",
    moved: receipt.status === 1 ? sent.map((t) => movedOf(t, ref.transaction)) : [],
    signer,
    // What was presented is the transaction the credential names, and the act is that transaction.
    presented: "yes",
    ...(byTx.has(lower(ref.transaction)) ? { given: true } : {}),
  };
  return {
    seen: [seen],
    value: { consumed: true, lapsed: false, mark, head: { consumed: true } },
    search: { whole: true },
    history: true,
  };
}

/** ERC-20 `transfer(address,uint256)`. */
const TRANSFER_CALL_SELECTOR = "0xa9059cbb";

/** The recipient of a transaction whose own call is an ERC-20 `transfer`, its input exactly that call; else none. */
function transferCallRecipient(tx: EvmTransaction): Hex[] {
  const input = bytesOf(tx.input);
  if (input === undefined || input.length !== 68 || hexOf(input.subarray(0, 4)) !== TRANSFER_CALL_SELECTOR) return [];
  const to = addressOfWord(input.subarray(4, 36));
  return to === undefined ? [] : [to];
}
