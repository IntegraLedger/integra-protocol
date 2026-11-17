/**
 * The reads of the x402 pairings on eip155 chains, and of the MPP EIP-3009 charges (`evm-eip3009.ts`), as the profile
 * `read-status` and each pairing's own profile state them: the single-use value read at the final mark and at the latest head, the search for the payer's acts carrying H
 * from the position the caller gives to the latest head, and each transaction met, classified from what landed against
 * the reference's payer and the option's payee. `decide` composes the answer; each pairing's `status` is `statusOf` over
 * its read.
 */
import { agreementValue, type AtrHash } from "./core.js";
import { addressOfWord, addressWord, bytesOf, concat, hexOf, keccakHex, uintOf, uintWord, wordAt, type Hex } from "../evm-abi.js";
import { isAddress, isObject, normalHash, uint256Of } from "../fields.js";
import {
  AUTHORIZATION_STATE_SELECTOR,
  AUTHORIZATION_USED_TOPIC,
  NONCE_BITMAP_SELECTOR,
  PERMIT2,
  ReaderError,
  TRANSFER_TOPIC,
  evmLedger,
  isEvmQuery,
  isLog,
  isReceipt,
  readerFault,
  rejected,
  type EvmLog,
  type EvmLogEntry,
  type EvmMark,
  type EvmQuery,
  type EvmReader,
  type EvmReceipt,
  type EvmTransaction,
} from "./evm.js";
import {
  decide,
  type Act,
  type Facts,
  type Moved,
  type Seen,
  type StatusAnswer,
  type UnreadableReason,
} from "./read.js";
import type { Coverage } from "./registry.js";

/** keccak256("AuthorizationCanceled(address,bytes32)") */
export const AUTHORIZATION_CANCELED_TOPIC = keccakHex("AuthorizationCanceled(address,bytes32)");
/** keccak256("UnorderedNonceInvalidation(address,uint256,uint256)"), Permit2's cancellation of a word of nonces. */
export const UNORDERED_NONCE_INVALIDATION_TOPIC = keccakHex("UnorderedNonceInvalidation(address,uint256,uint256)");

/**
 * The blocks one page of a search reads: a public endpoint refuses a wider range (Arc's refused a range above 10,000
 * blocks on 2026-11-16), and a page an endpoint refuses is halved.
 */
export const SEARCH_PAGE_BLOCKS = 10_000;
/**
 * lcp's own bound on the pages one `status` call reads, so that one call makes a bounded number of reader calls; a
 * search with range left answers its position, from which the next call resumes.
 */
export const MAX_SEARCH_PAGES = 8;

/** Whether an act is the payment the reference was built from, what the payer signed compared: `Seen.presented`. */
type Presentation = Seen<bigint, EvmMark>["presented"];

/** The members of what the payer signed, as read from a landed act or as presented, each a lowercase string. */
export type Signed = Readonly<Record<string, string>>;

/** A transaction a read met, with what the payer signed in it where the read shows every member its form names. */
export type SeenEvm = Seen<bigint, EvmMark> & { readonly signed?: Signed };

/** The single-use value of the act asked about, and the other act's under the same H where the pairing has one. */
export interface Values {
  /** H, where the reference holds it. */
  readonly h?: AtrHash;
  readonly act: Act;
  /** The value the act asked about consumes: H, the agreement's own value, or a value the pairing derives. */
  readonly v: Hex;
  /** The value the other act under the same H carries, where the pairing's agreement has its own. */
  readonly w?: Hex;
}

/** A log filter of a search. */
export interface Filter {
  readonly address?: Hex;
  readonly topics: readonly (Hex | null)[];
}

/** The heads a read is made at: the final block with its time, the `safe` block, the latest block with its time. */
export interface Heads {
  readonly final: { readonly number: bigint; readonly timestamp?: bigint };
  readonly safe: { readonly number: bigint; readonly timestamp?: bigint };
  readonly latest?: { readonly number: bigint; readonly timestamp: bigint };
}

/** A transaction a read classifies: its hash, its receipt, and its body, read once where asked for. */
export interface TxView {
  readonly hash: Hex;
  readonly receipt: EvmReceipt;
  readonly tx: () => Promise<EvmTransaction | null | { readonly unreadable: UnreadableReason }>;
}

/** What classifying a transaction gives: the acts it holds, an item the read cannot decode, or a read that failed. */
export type Classified =
  | { readonly seen: readonly Omit<SeenEvm, "transaction" | "position" | "mark" | "presented">[] }
  | { readonly undecodable: true }
  | { readonly unreadable: UnreadableReason };

/** A pairing's read: what its reference holds, how its value and lapse are read, what it searches, how it classifies. */
export interface ReadSpec<R> {
  readonly coverage: Coverage;
  /** Whether the pairing's agreement has its own value, so that the two acts' values differ. */
  readonly agreementValue: boolean;
  /** True for a reference of the pairing's form. */
  readonly check: (ref: unknown) => ref is R;
  /** The value the payment consumes, where it is not H itself. */
  readonly paymentValue?: (ref: R) => Hex;
  /** `false` where the reference holds no H, the value being `paymentValue`'s alone. */
  readonly holdsH?: false;
  /** Whether the value is consumed in the state after `block`; absent where the read holds no single-use value. */
  readonly value?: (ref: R, v: Hex, reader: EvmReader, block: bigint) => Promise<boolean | { readonly unreadable: UnreadableReason }>;
  /** The signed bound: lapsed at a block whose time is at or past `at` (`inclusive`), or past it. */
  readonly deadline?: (ref: R) => { readonly at: bigint; readonly inclusive: boolean };
  /**
   * How the search for H reads: `value`, the read of the value at the final mark and at the latest head is the search,
   * the logs read only to find the act that consumed it; `logs`, the logs read whole to the latest head; `open`, no
   * search for H is defined, or the search runs to the end of the caller's hold, so it is never whole.
   */
  readonly search: "value" | "logs" | "open";
  /** The log filters of the search. */
  readonly filters: (ref: R, values: Values) => readonly Filter[];
  /**
   * Whether a log entry the search found can be an act of this read, tested on the entry before its receipt is read, so
   * that a filter that names only an event's topic reads no receipt of another user's event; absent, every entry's
   * receipt is read.
   */
  readonly entry?: (ref: R, values: Values, e: EvmLogEntry) => boolean;
  /**
   * The indexed logs that name, within one block, the transaction that consumed the value: read where the value reads
   * consumed, the search found no transaction that consumed it, and the value reads consumed at the position given, in
   * the first block at which it reads consumed (`firstConsumed`). Absent where the read holds no single-use value.
   */
  readonly consumers?: (ref: R, values: Values) => readonly Filter[];
  /** The acts a transaction holds that carry H or the value, classified against the reference. */
  readonly classify: (ref: R, values: Values, view: TxView, reader: EvmReader) => Promise<Classified>;
  /** The members of the payment presented, as the reference holds them; undefined where the pairing compares none. */
  readonly presented: (ref: unknown) => Signed | undefined;
  /** The reference's payer, against which a signer is tested. */
  readonly payer: (ref: R) => Hex;
}

/** The reference every read over `statusOf` takes: the network, the option's payee, and a named transaction as a hint. */
export interface EvmReadRefBase {
  readonly network: `eip155:${string}`;
  readonly payee: string;
  /** A transaction a settler or the caller named, read beside the search; never needed. */
  readonly transaction?: Hex;
}

/** The reference every x402 eip155 read takes: `EvmReadRefBase` and H. */
export interface X402EvmRefBase extends EvmReadRefBase {
  readonly h: AtrHash;
}

const QUERY_UNPARSEABLE: StatusAnswer<bigint, EvmMark> = Object.freeze({ state: "unreadable", reason: "unparseable", foreign: [] });

/** The `status` of a pairing over its read. */
export function statusOf<R extends EvmReadRefBase>(
  spec: ReadSpec<R>,
): (ref: R, reader: EvmReader, query: EvmQuery<unknown>) => Promise<StatusAnswer<bigint, EvmMark>> {
  return async (ref, reader, query) => {
    if (!isEvmQuery(query)) return QUERY_UNPARSEABLE;
    const read = await factsOf(spec, ref, reader, query);
    if ("unreadable" in read) return { state: "unreadable", reason: read.unreadable, foreign: [] };
    return decide(read.facts, query, evmLedger(spec.coverage));
  };
}

/** `yes` where every member the landed act shows equals the presented one, `no` where one differs, `unshown` else. */
function presentation(presented: Signed | undefined, signed: Signed | undefined): Presentation {
  if (presented === undefined || signed === undefined) return "unshown";
  for (const [k, v] of Object.entries(signed)) {
    if (presented[k] === undefined) return "unshown";
    if (presented[k] !== v) return "no";
  }
  return "yes";
}

/** The values of the act asked about: on a pairing whose agreement has its own value, the agreement's for `agreement`. */
async function valuesOf<R extends EvmReadRefBase>(spec: ReadSpec<R>, ref: R, act: Act): Promise<Values | undefined> {
  if (spec.holdsH === false) {
    const v = spec.paymentValue === undefined ? null : normalHash(spec.paymentValue(ref));
    return v === null ? undefined : { act, v };
  }
  const h = normalHash((ref as { h?: unknown }).h);
  if (h === null) return undefined;
  if (spec.agreementValue) {
    const d = await agreementValue(h);
    return act === "agreement" ? { h, act, v: d, w: h } : { h, act, v: h, w: d };
  }
  return { h, act, v: spec.paymentValue?.(ref) ?? h };
}

/** What the read observed, for `decide`, or the reason it established nothing. */
async function factsOf<R extends EvmReadRefBase>(
  spec: ReadSpec<R>,
  ref: R,
  reader: EvmReader,
  query: EvmQuery<unknown>,
): Promise<{ facts: Facts<bigint, EvmMark> & { seen: readonly SeenEvm[] } } | { unreadable: UnreadableReason }> {
  if (!isObject(ref)) return { unreadable: "unparseable" };
  const fault = readerFault(ref, reader);
  if (fault !== undefined) return { unreadable: fault };
  if (!spec.check(ref)) return { unreadable: "unparseable" };
  if (ref.transaction !== undefined && normalHash(ref.transaction) === null) return { unreadable: "unparseable" };
  const values = await valuesOf(spec, ref, query.act);
  if (values === undefined) return { unreadable: "unparseable" };

  const heads = await headsOf(reader);
  if ("unreadable" in heads) return heads;
  const markOf = (block: bigint): EvmMark =>
    block <= heads.final.number ? "finalized" : block <= heads.safe.number ? "safe" : "latest";

  // The single-use value, at the final mark and at the latest head, and the signed bound against each head's time.
  let value: Facts<bigint, EvmMark>["value"];
  let consumedLatest = false;
  if (spec.value !== undefined) {
    const atFinal = await spec.value(ref, values.v, reader, heads.final.number);
    if (typeof atFinal !== "boolean") return atFinal;
    let atLatest: boolean | undefined;
    if (heads.latest !== undefined) {
      const l = heads.latest.number === heads.final.number ? atFinal : await spec.value(ref, values.v, reader, heads.latest.number);
      if (typeof l !== "boolean") return l;
      atLatest = l;
    }
    consumedLatest = atFinal || atLatest === true;
    const bound = spec.deadline?.(ref);
    const past = (t: bigint | undefined): boolean =>
      bound !== undefined && t !== undefined && (bound.inclusive ? t >= bound.at : t > bound.at);
    const lapsedFinal = past(heads.final.timestamp);
    const lapsedSafe = past(heads.safe.timestamp);
    const lapsedLatest = past(heads.latest?.timestamp);
    const lapsed = lapsedFinal || lapsedSafe || lapsedLatest;
    const mark: EvmMark = lapsedFinal || !lapsed ? "finalized" : lapsedSafe ? "safe" : "latest";
    value = { consumed: atFinal, lapsed, mark, ...(atLatest === undefined ? {} : { head: { consumed: atLatest } }) };
  }

  // The search, from the position the caller gives, or the one an earlier answer returned, to the latest head.
  const start = query.search ?? (query.after !== undefined ? query.after + 1n : 0n);
  let whole = false;
  let at: bigint | undefined;
  let entries: readonly EvmLogEntry[] = [];
  // On a pairing whose value is H's own carrier, the value's two reads are the search (read-status rule 26): the logs
  // are read only to find the act that consumed it, and the search is whole by those reads.
  const valueIsSearch = spec.search === "value" && value !== undefined && value.head !== undefined;
  if (valueIsSearch && !consumedLatest) {
    whole = true;
  } else if (heads.latest !== undefined && reader.logs !== undefined && spec.filters(ref, values).length > 0) {
    const s = await search(reader, spec.filters(ref, values), start, heads.latest.number);
    if ("unreadable" in s) return s;
    entries = s.entries;
    // On a value that is H's carrier, read consumed, the logs are the search for the act that consumed it: whole where
    // read to its end, and otherwise held at its position, as every search with range left is.
    whole = s.whole && spec.search !== "open";
    at = s.at;
  }

  // Every transaction the search met, and the one the reference names, classified from what landed.
  const hashes = new Map<string, Hex>();
  if (ref.transaction !== undefined) hashes.set(ref.transaction.toLowerCase(), ref.transaction);
  for (const e of entries) if (spec.entry?.(ref, values, e) ?? true) hashes.set(e.transactionHash.toLowerCase(), e.transactionHash);
  const others = (query.others ?? []) as readonly Record<string, unknown>[];
  // An other act given by its transaction, or by a reference that names the transaction it landed in, is that
  // transaction's act; one given by a reference alone is matched by the members of what its payer signed.
  const givenTx = new Set(
    others.flatMap((o) => {
      const r = o["ref"];
      const t = typeof o["transaction"] === "string" ? o["transaction"] : isObject(r) && typeof r["transaction"] === "string" ? r["transaction"] : undefined;
      return t === undefined ? [] : [t.toLowerCase()];
    }),
  );
  const givenRefs = others.flatMap((o) => ("ref" in o ? [spec.presented(o["ref"])] : []));
  const presentedHere = spec.presented(ref);
  // One transaction read and classified: the acts it holds, placed at its block; `undecodable` where the read cannot
  // decode it; `missing` where the endpoint holds no receipt for it.
  const classified = async (
    key: string,
    hash: Hex,
  ): Promise<{ seen: SeenEvm[] } | { undecodable: bigint } | { missing: true } | { unreadable: UnreadableReason }> => {
    let receipt: EvmReceipt | null;
    try {
      receipt = await reader.receipt(hash);
    } catch (e) {
      return { unreadable: rejected(e) };
    }
    if (receipt === null) return { missing: true };
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
          body = { unreadable: rejected(e) };
        }
        return body;
      },
    };
    const c = await spec.classify(ref, values, view, reader);
    if ("unreadable" in c) return c;
    if ("undecodable" in c) return { undecodable: receipt.blockNumber };
    const at = receipt.blockNumber;
    return {
      seen: c.seen.map((s) => {
        const given = givenTx.has(key) || (s.signed !== undefined && givenRefs.some((p) => presentation(p, s.signed) === "yes"));
        const presented = presentation(presentedHere, s.signed);
        return { ...s, transaction: hash, position: at, mark: markOf(at), ...(given ? { given } : {}), presented };
      }),
    };
  };
  const seen: SeenEvm[] = [];
  const undecoded: { transaction: Hex; at: bigint }[] = [];
  let lookupMissing = false;
  for (const [key, hash] of hashes) {
    const c = await classified(key, hash);
    if ("unreadable" in c) return c;
    if ("missing" in c) lookupMissing = true;
    else if ("undecodable" in c) {
      if (!valueIsSearch) undecoded.push({ transaction: hash, at: c.undecodable });
    } else seen.push(...c.seen);
  }

  // Below the position given: where the value reads consumed and the search found no transaction that consumed it,
  // the value read at that position shows whether it was consumed at or before it; where it was, the first block at
  // which it reads consumed holds the transaction that consumed it, named by the pairing's indexed logs in that block.
  if (
    value !== undefined &&
    consumedLatest &&
    query.after !== undefined &&
    spec.consumers !== undefined &&
    reader.logs !== undefined &&
    !seen.some((s) => s.consumed)
  ) {
    const first = await firstConsumed((block) => spec.value!(ref, values.v, reader, block), query.after);
    if (typeof first === "object") return first;
    if (first !== undefined) {
      const found = await search(reader, spec.consumers(ref, values), first, first);
      if ("unreadable" in found) return found;
      const met = new Map<string, Hex>();
      for (const e of found.entries) met.set(e.transactionHash.toLowerCase(), e.transactionHash);
      for (const [key, hash] of met) {
        const c = await classified(key, hash);
        if ("unreadable" in c) return c;
        if ("seen" in c) seen.push(...c.seen.filter((s) => s.consumed));
      }
    }
  }
  // The act at the lowest position first, so `decide` settles on the first that landed.
  seen.sort((a, b) => (a.position! < b.position! ? -1 : a.position! > b.position! ? 1 : 0));

  // Whether the reader showed it holds the history the act would be in: a read answered at the position given.
  let history = true;
  if (spec.value === undefined) {
    history = false;
    if (query.after !== undefined && reader.block !== undefined) {
      try {
        const b = await reader.block(query.after);
        history = isObject(b) && typeof b.number === "bigint";
      } catch (e) {
        const why = rejected(e);
        if (why !== "history-gap") return { unreadable: why };
      }
    }
  }
  if (spec.coverage === "none" && spec.filters(ref, values).length === 0) {
    // At coverage `none` a read with no search is the lookup of the transaction the reference names, read whole where
    // it is named.
    // A named transaction the endpoint holds shows the history it is in. The read holds no single-use value, so a named
    // transaction that is not the act answers no `instrument-live`: one that reverted `search-incomplete`, and one that
    // holds no transfer to the payee's account, or that the caller gave, `not-found`.
    whole = ref.transaction !== undefined;
    if (ref.transaction !== undefined && !lookupMissing) history = true;
  }
  return {
    facts: {
      seen,
      ...(value === undefined ? {} : { value }),
      search: { whole, ...(at === undefined ? {} : { at }) },
      ...(undecoded.length === 0 ? {} : { undecoded: undecoded.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)) }),
      history,
    },
  };
}

/**
 * The first block at or below `at` at which the value reads consumed, `read` giving the value in the state after a
 * block: the value read at `at`, then the range from the network's first block to `at` halved by reads of the value at
 * blocks. Where `from`, a block below `at`, is given, the value is read there first: unconsumed there, the range halved
 * is from `from` to `at`; consumed there, from the network's first block to `from`. Undefined where the value reads
 * unconsumed at `at`; unreadable where a read fails, `history-gap` where the endpoint does not hold a block's state.
 */
export async function firstConsumed(
  read: (block: bigint) => Promise<boolean | { readonly unreadable: UnreadableReason }>,
  at: bigint,
  from?: bigint,
): Promise<bigint | undefined | { unreadable: UnreadableReason }> {
  const there = await read(at);
  if (typeof there !== "boolean") return { unreadable: there.unreadable };
  if (!there) return undefined;
  // Consumed at `b`; unconsumed at `a`, or `a` lies below the network's first block.
  let a = -1n;
  let b = at;
  if (from !== undefined && from >= 0n && from < at) {
    const r = await read(from);
    if (typeof r !== "boolean") return { unreadable: r.unreadable };
    if (r) b = from;
    else a = from;
  }
  while (b - a > 1n) {
    const m = a + (b - a) / 2n;
    const r = await read(m);
    if (typeof r !== "boolean") return { unreadable: r.unreadable };
    if (r) b = m;
    else a = m;
  }
  return b;
}

/** The final, `safe` and latest heads, each with its time where the reader reads blocks. */
async function headsOf(reader: EvmReader): Promise<Heads | { unreadable: UnreadableReason }> {
  try {
    if (reader.block === undefined) {
      const final = await reader.blockNumber("finalized");
      let safe = final;
      try {
        safe = await reader.blockNumber("safe");
      } catch {
        // A network that serves no `safe` mark reads it as the final one.
      }
      if (typeof final !== "bigint" || typeof safe !== "bigint") return { unreadable: "unparseable" };
      return { final: { number: final }, safe: { number: safe < final ? final : safe } };
    }
    const final = await reader.block("finalized");
    if (!isBlock(final)) return { unreadable: "unparseable" };
    let safe = final;
    try {
      safe = await reader.block("safe");
    } catch {
      // As above.
    }
    const latest = await reader.block("latest");
    if (!isBlock(safe) || !isBlock(latest)) return { unreadable: "unparseable" };
    const s = safe.number < final.number ? final : safe;
    const l = latest.number < s.number ? s : latest;
    return { final, safe: s, latest: l };
  } catch (e) {
    return { unreadable: rejected(e) };
  }
}

function isBlock(b: unknown): b is { number: bigint; timestamp: bigint } {
  return isObject(b) && typeof b["number"] === "bigint" && typeof b["timestamp"] === "bigint" && b["number"] >= 0n;
}

/**
 * The logs of `filters` from `from` to `to`, in pages of at most `SEARCH_PAGE_BLOCKS` blocks, halved where the endpoint
 * refuses a page's range; at most `MAX_SEARCH_PAGES` pages, after which the search answers where it stopped. A range
 * refused at one block is `transport`, never absence.
 */
export async function search(
  reader: EvmReader,
  filters: readonly Filter[],
  from: bigint,
  to: bigint,
): Promise<{ entries: EvmLogEntry[]; whole: boolean; at?: bigint } | { unreadable: UnreadableReason }> {
  const entries: EvmLogEntry[] = [];
  let pos = from;
  let span = BigInt(SEARCH_PAGE_BLOCKS);
  let pages = 0;
  while (pos <= to) {
    if (pages === MAX_SEARCH_PAGES) return { entries, whole: false, at: pos };
    const end = pos + span - 1n < to ? pos + span - 1n : to;
    const page: EvmLogEntry[] = [];
    try {
      for (const f of filters) {
        const got = await reader.logs!({ ...(f.address === undefined ? {} : { address: f.address }), topics: f.topics, fromBlock: pos, toBlock: end });
        if (!Array.isArray(got)) return { unreadable: "unparseable" };
        page.push(...got);
      }
    } catch (e) {
      if (e instanceof ReaderError && e.kind === "too-large") {
        if (end === pos) return { unreadable: "transport" };
        span = (end - pos + 1n) / 2n;
        continue;
      }
      return { unreadable: rejected(e) };
    }
    if (!page.every(isEntry)) return { unreadable: "unparseable" };
    entries.push(...page);
    pages++;
    pos = end + 1n;
  }
  return { entries, whole: true };
}

function isEntry(e: unknown): e is EvmLogEntry {
  return (
    isLog(e) &&
    normalHash((e as EvmLogEntry).transactionHash) !== null &&
    typeof (e as EvmLogEntry).blockNumber === "bigint"
  );
}

// ── Helpers the pairings' reads share.

/** The address in a topic or word, lowercase, or undefined. */
export function topicAddress(t: unknown): Hex | undefined {
  const b = bytesOf(t);
  return b === undefined || b.length !== 32 ? undefined : addressOfWord(b);
}

/** Two addresses or words, equal by bytes whatever their case. */
export function same(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

/** The party a signer is against the reference's payer and the option's payee. */
export function partyOf(signer: string | undefined, payer: string, payee: string): "payer" | "payee" | "other" {
  if (signer === undefined) return "other";
  if (same(signer, payee)) return "payee";
  return same(signer, payer) ? "payer" : "other";
}

/** An address as a log topic: a 32-byte word. */
export function addressTopic(a: Hex): Hex {
  return hexOf(addressWord(a));
}

/** A `Transfer` log's parts: the token, `from`, `to`, `value`, and the log's position among the receipt's logs. */
export interface TransferAt {
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

/** The ERC-20 `Transfer` logs of a receipt, each with its position: an asset contract's own, never the system emitter's. */
export function transfersIn(logs: readonly EvmLog[]): TransferAt[] {
  const out: TransferAt[] = [];
  logs.forEach((l, i) => {
    if (l.topics.length !== 3 || !same(l.topics[0], TRANSFER_TOPIC) || !isAddress(l.address)) return;
    if (same(l.address, SYSTEM_TRANSFER_EMITTER)) return;
    const from = topicAddress(l.topics[1]);
    const to = topicAddress(l.topics[2]);
    const data = bytesOf(l.data);
    const w = data === undefined || data.length !== 32 ? undefined : wordAt(data, 0);
    if (from === undefined || to === undefined || w === undefined) return;
    out.push({ token: l.address.toLowerCase() as Hex, from, to, value: uintOf(w), log: i });
  });
  return out;
}

/** What a transfer moved, as an answer names it: by its transaction and its log's position among the receipt's logs. */
export function movedOf(t: TransferAt, transaction: Hex, to?: Hex): Moved {
  return { asset: t.token, amount: t.value.toString(), to: to ?? t.to, transaction, place: t.log };
}

/** Whether `input` holds the 32-byte `word` at any byte offset. */
export function inputCarries(input: Uint8Array, word: Hex): boolean {
  const w = bytesOf(word);
  if (w === undefined || w.length !== 32) return false;
  next: for (let i = 0; i + 32 <= input.length; i++) {
    for (let j = 0; j < 32; j++) if (input[i + j] !== w[j]) continue next;
    return true;
  }
  return false;
}

/** A selector's call found at any byte offset of `input`: its offset and its argument words from there. */
export function callsIn(input: Uint8Array, selectors: readonly Hex[]): { at: number; selector: Hex; args: Uint8Array }[] {
  const sel = selectors.map((s) => bytesOf(s)!);
  const out: { at: number; selector: Hex; args: Uint8Array }[] = [];
  for (let at = 0; at + 4 <= input.length; at++) {
    const i = sel.findIndex((s) => s.every((b, j) => input[at + j] === b));
    if (i >= 0) out.push({ at, selector: selectors[i]!, args: input.subarray(at + 4) });
  }
  return out;
}

/**
 * `authorizationState(authorizer, nonce)` on `token` (EIP-3009), or bit `nonce & 0xff` of `nonceBitmap(authorizer,
 * nonce >> 8)` on Permit2, in the state after `block`: whether the nonce is used. A call the reader rejects is unreadable
 * by its error; an answer that is not one word, or for EIP-3009 one holding neither 0 nor 1, `unparseable`.
 */
export async function nonceUsed(
  scheme: "eip3009" | "permit2",
  at: Hex,
  authorizer: Hex,
  nonce: Hex,
  block: bigint,
  reader: EvmReader,
): Promise<boolean | { unreadable: UnreadableReason }> {
  const n = BigInt(nonce);
  const data =
    scheme === "eip3009"
      ? hexOf(concat([bytesOf(AUTHORIZATION_STATE_SELECTOR)!, addressWord(authorizer), uintWord(n)]))
      : hexOf(concat([bytesOf(NONCE_BITMAP_SELECTOR)!, addressWord(authorizer), uintWord(n >> 8n)]));
  let answer: unknown;
  try {
    answer = await reader.call(scheme === "eip3009" ? at : PERMIT2, data, block);
  } catch (e) {
    return { unreadable: rejected(e) };
  }
  const word = bytesOf(answer, 32);
  if (word === undefined || word.length !== 32) return { unreadable: "unparseable" };
  const v = uintOf(word);
  if (scheme === "eip3009") return v <= 1n ? v === 1n : { unreadable: "unparseable" };
  return ((v >> (n & 0xffn)) & 1n) === 1n;
}

/** A uint256 member as a decimal string, or undefined. */
export function decimal(v: unknown): string | undefined {
  const n = uint256Of(v);
  return n === undefined ? undefined : n.toString();
}

export { AUTHORIZATION_USED_TOPIC, TRANSFER_TOPIC };
