/**
 * The read of `x402/exact/algorand`, as the profiles `read-status` and `x402/exact/algorand/note` state it: the lookup of
 * the transaction id, the history, and the search for H over the payer's transactions. `../avm.ts` exports it as
 * `avmStatus`; no entry point exports this module.
 */
import type { AtrHash } from "../core.js";
import { toLcpString } from "../core.js";
import { isObject, normalHash } from "../fields.js";
import type { AvmAssetTransfer, AvmIndexed, AvmPage, AvmReader, AvmRef, AvmSearch, AvmStatus } from "../avm.js";
import { ALGORAND } from "./data/algorand.js";
import { isAlgorandAddress } from "./avm.js";
import { decide, type Facts, type Ledger, type Moved, type StatusQuery, type UnreadableReason } from "./read.js";

/**
 * lcp's own resource bound on one read: the search for H reads at most 32 pages of the payer's transactions in one
 * call, and an answer that stops there carries the search's position, from which the next call resumes.
 */
export const AVM_SEARCH_PAGES = 32;
/** The deepest nesting of inner transactions the read takes in an Indexer answer, as `MSGPACK_MAX_DEPTH` bounds an entry. */
const MAX_INNER_DEPTH = 32;
const ID = "x402/exact/algorand" as const;
const ENCODER = new TextEncoder();
/** A transaction id as `reference` writes it: 52 base32 characters, the last holding one bit and four zero bits. */
const TXID = /^[A-Z2-7]{51}[AQ]$/;
const DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const isTxid = (t: unknown): t is string => typeof t === "string" && TXID.test(t);
const isRound = (s: unknown): boolean => typeof s === "string" && DECIMAL.test(s) && BigInt(s) < 1n << 64n;

/** A rejected read: a `ReaderError` by its kind, anything else `transport`. */
function rejected(e: unknown): UnreadableReason {
  const kind = e instanceof Error && e.name === "ReaderError" ? (e as { kind?: unknown }).kind : undefined;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/** The Indexer's ledger: one mark, and positions ordered by round. */
const AVM_LEDGER: Ledger<bigint, "final"> = {
  coverage: ALGORAND[ID].coverage,
  final: "final",
  markOrder: () => 0,
  positionOrder: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

type Seen = Facts<bigint, "final", AvmSearch>["seen"][number];
type Query = StatusQuery<AvmRef, bigint, "final", AvmSearch>;
const unreadable = (reason: UnreadableReason): AvmStatus => ({ state: "unreadable", reason, foreign: [] });

/**
 * The read of the payment, as the profiles `read-status` and `x402/exact/algorand/note` answer it. The transaction id
 * is the single-use value: a transaction confirmed under it is the act asked about, or consumed it as another; an id
 * the Indexer holds none of, before `lastValid`, is live. Past `lastValid`, or under an id landed as another act, the
 * search for H decides. Absence is read only where the Indexer is declared archival or answers the header at the
 * position the caller gives, and `history-gap` otherwise. The facts the search rests on (that the Indexer holds every
 * transaction of the rounds after a header it answers, and its paging as the profile reads it) are not yet shown by a
 * run (the profile's rule 16), so a search read whole proves no absence: the read reports it not whole, at the round
 * it reached, and answers `pending`, `search-incomplete`, where it would answer `failed` for any reason but
 * `before-position` (`read-status`, rule 25).
 */
export async function avmRead(ref: AvmRef, reader: AvmReader, query: Query): Promise<AvmStatus> {
  if (!isRef(ref)) return unreadable("unparseable");
  const lastValid = BigInt(ref.lastValid);
  if (!isObject(query)) return unreadable("unparseable");
  const after = query.after;
  if (after !== undefined && (typeof after !== "bigint" || after < 0n)) return unreadable("unparseable");
  const cursor = query.search;
  if (cursor !== undefined && !isCursor(cursor)) return unreadable("unparseable");
  if (!isObject(reader) || reader.network !== ref.network) return unreadable("chain-mismatch");
  const others = Array.isArray(query.others) ? query.others : [];
  const givenIds = new Set(
    others.flatMap((o) => {
      if (!isObject(o)) return [];
      const id = "ref" in o && isObject(o.ref) ? (o.ref as { txid?: unknown }).txid : "transaction" in o ? o.transaction : undefined;
      return typeof id === "string" ? [id.toUpperCase()] : [];
    }),
  );
  const carrier = ENCODER.encode(toLcpString(ref.h));
  const seenOf = (t: AvmIndexed): Seen => classify(t, ref, givenIds);

  let look: Awaited<ReturnType<AvmReader["transaction"]>>;
  try {
    look = await reader.transaction(ref.txid);
  } catch (e) {
    return unreadable(rejected(e));
  }
  if (!isObject(look) || typeof look.currentRound !== "bigint") return unreadable("unparseable");
  const found = look.found;
  if (found !== null && (!isIndexed(found) || found.id !== ref.txid)) return unreadable("unparseable");
  const seen: Seen[] = [];
  if (found !== null) seen.push({ ...seenOf(found), carries: sameBytes(found.note, carrier) });
  // The Indexer serves confirmed rounds alone, so its round is both the final mark and the latest head: one read gives
  // the value at both.
  const consumed = found !== null;
  const value = { consumed, lapsed: !consumed && look.currentRound > lastValid, mark: "final", head: { consumed } } as const;
  const asked = query.act === "agreement" ? "agreement" : "payment";
  const isAct = (x: Seen): boolean =>
    x.carries && x.party === "payer" && x.kind === "same" && x.given !== true && (asked === "agreement" || x.account === "payee");
  const before = found !== null && after !== undefined && found.confirmedRound <= after;
  const needSearch = found === null ? value.lapsed : !before && !isAct(seen[0]!);

  if (found === null || needSearch) {
    let history = reader.archival === true;
    if (!history && after !== undefined) {
      try {
        history = (await reader.header(after)) === true;
      } catch (e) {
        return unreadable(rejected(e));
      }
    }
    if (!history) return unreadable("history-gap");
  }

  // Where no search runs, a position the caller gave is carried back unchanged, for the next call to take.
  let search: { whole: boolean; at?: AvmSearch } = cursor === undefined ? { whole: false } : { whole: false, at: cursor };
  let undecoded: { transaction: string; at: AvmSearch }[] = [];
  if (needSearch) {
    const from: AvmSearch = cursor ?? { through: after ?? -1n };
    const read = await searchFor(ref, reader, carrier, from, look.currentRound);
    if ("unreadable" in read) return unreadable(read.unreadable);
    for (const t of read.hits) {
      if (t.root.id === ref.txid && found !== null && t.inner === undefined) continue;
      if (t.inner === undefined) seen.push({ ...seenOf(t.root), consumed: t.root.id === ref.txid });
      else seen.push(innerSeen(t.root, t.inner, t.path!, ref, givenIds));
    }
    undecoded = read.undecoded;
    // Read whole or not, the search proves no absence until a run shows the facts it rests on (rule 16).
    search = { whole: false, at: read.at };
  }
  const facts = { seen, value, search, history: true, ...(undecoded.length === 0 ? {} : { undecoded }) };
  return decide(facts, query, AVM_LEDGER) as AvmStatus;
}

/**
 * A transaction met, against the reference and the option's payee. It is the payment presented where its id is the
 * reference's: the id covers the whole transaction the payer signed, its signature apart.
 */
function classify(t: AvmIndexed, ref: AvmRef, given: ReadonlySet<string>): Seen {
  const signer = t.authAddr ?? t.sender;
  const tr = t.type === "axfer" ? t.transfer : null;
  const byKey = t.signature === "sig" || t.signature === "multisig" || t.signature === "pqsig";
  const party =
    t.sender === ref.payee || signer === ref.payee
      ? "payee"
      : t.sender === ref.sender && byKey && (tr === null || tr.assetSender === null)
        ? "payer"
        : "other";
  return {
    transaction: t.id,
    position: t.confirmedRound,
    mark: "final",
    result: "succeeded",
    consumed: t.id === ref.txid,
    carries: true,
    party,
    kind: tr !== null ? "same" : "other",
    account: tr === null ? "none" : tr.receiver === ref.payee ? "payee" : "other",
    ...(given.has(t.id.toUpperCase()) ? { given: true } : {}),
    presented: t.id === ref.txid ? "yes" : "no",
    ...(tr === null ? {} : { moved: movedOf(tr, t.id, "") }),
    signer,
    authority: t.signature,
  };
}

/**
 * An inner transaction carrying H: an application's act, named by its root, which no key of the payer signed; what it
 * moved is placed by its path among the root's `inner-txns`.
 */
function innerSeen(root: AvmIndexed, inner: AvmIndexed, path: string, ref: AvmRef, given: ReadonlySet<string>): Seen {
  const tr = inner.type === "axfer" ? inner.transfer : null;
  const party = inner.sender === ref.payee || (inner.authAddr ?? inner.sender) === ref.payee ? "payee" : "other";
  return {
    transaction: root.id,
    position: root.confirmedRound,
    mark: "final",
    result: "succeeded",
    consumed: false,
    carries: true,
    party,
    kind: "other",
    account: tr === null ? "none" : tr.receiver === ref.payee ? "payee" : "other",
    ...(given.has(root.id.toUpperCase()) ? { given: true } : {}),
    ...(tr === null ? {} : { moved: movedOf(tr, root.id, path) }),
    signer: inner.sender,
    authority: "none",
  };
}

/**
 * What an asset transfer moved: `aamt` of `xaid` to `arcv`, and where it closes, the close amount to `aclose`. Each is
 * named by its transaction and its place, the member naming the account it reached, `arcv` or `aclose`, under the
 * path of `inner-txns` indexes that leads to an inner transaction (`inner-txns/0/arcv`), and alone at the top level.
 */
function movedOf(tr: AvmAssetTransfer, transaction: string, path: string): Moved[] {
  const asset = tr.assetId.toString();
  const moved: Moved[] = [{ asset, amount: tr.amount.toString(), to: tr.receiver, transaction, place: `${path}arcv` }];
  if (tr.closeTo !== null) moved.push({ asset, amount: tr.closeAmount.toString(), to: tr.closeTo, transaction, place: `${path}aclose` });
  return moved;
}

/** A transaction the search found carrying H: a top-level one, or an inner one under its root, with its path there. */
type Hit = { root: AvmIndexed; inner?: AvmIndexed; path?: string };

/**
 * The search for H over the payer's transactions, from one past `from.through`, in sub-ranges topped by the Indexer's
 * own round and paged by its token, to the top of a sub-range at or past `reach`, the round of the id's lookup. It reads
 * at most `AVM_SEARCH_PAGES` pages. Whole where it reached `reach`; otherwise its position, held at a page that answered
 * a round below its top or held an item the reader cannot parse, or where the bound ended it.
 */
async function searchFor(
  ref: AvmRef,
  reader: AvmReader,
  carrier: Uint8Array,
  from: AvmSearch,
  reach: bigint,
): Promise<{ hits: Hit[]; undecoded: { transaction: string; at: AvmSearch }[]; whole: boolean; at: AvmSearch } | { unreadable: UnreadableReason }> {
  const hits: Hit[] = [];
  const undecoded: { transaction: string; at: AvmSearch }[] = [];
  let { through, top, next } = from;
  for (let pages = 0; ; ) {
    if (top === undefined && through >= reach) return { hits, undecoded, whole: true, at: { through } };
    if (pages >= AVM_SEARCH_PAGES) return { hits, undecoded, whole: false, at: atOf(through, top, next) };
    let page: AvmPage;
    try {
      page = await reader.accountPage(
        ref.sender,
        top === undefined ? { minRound: through + 1n } : { minRound: through + 1n, maxRound: top, ...(next === undefined ? {} : { next }) },
      );
    } catch (e) {
      return { unreadable: rejected(e) };
    }
    pages++;
    if (!isObject(page) || typeof page.currentRound !== "bigint" || !Array.isArray(page.transactions)) {
      return { unreadable: "unparseable" };
    }
    if (page.next !== undefined && typeof page.next !== "string") return { unreadable: "unparseable" };
    const subTop = top ?? page.currentRound;
    if (page.currentRound < subTop) return { hits, undecoded, whole: false, at: atOf(through, top, next) };
    // An item the reader cannot parse is named by its id, with the position of its page, from which the next call reads
    // that page again; the rest of the range is read, and an act found in it decides.
    for (const t of page.transactions) {
      if (isIndexed(t)) collect(t, t, carrier, hits);
      else if (isObject(t) && typeof t["id"] === "string") undecoded.push({ transaction: t["id"], at: atOf(through, top, next) });
      else return { unreadable: "unparseable" };
    }
    if (page.transactions.length === 0) {
      through = subTop;
      top = undefined;
      next = undefined;
    } else {
      top = subTop;
      next = page.next;
    }
  }
}

function atOf(through: bigint, top: bigint | undefined, next: string | undefined): AvmSearch {
  return { through, ...(top === undefined ? {} : { top }), ...(next === undefined ? {} : { next }) };
}

/** The transaction and each of its inner transactions, at any depth, whose note is exactly H's carrier. */
function collect(root: AvmIndexed, t: AvmIndexed, carrier: Uint8Array, hits: Hit[], path = ""): void {
  if (sameBytes(t.note, carrier)) hits.push(t === root ? { root } : { root, inner: t, path });
  t.inner.forEach((i, n) => collect(root, i, carrier, hits, `${path}inner-txns/${n}/`));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const SIGNATURES: ReadonlySet<unknown> = new Set(["sig", "multisig", "logicsig", "pqsig", "none"]);

function isIndexed(t: unknown, depth = 0): t is AvmIndexed {
  if (!isObject(t) || depth > MAX_INNER_DEPTH) return false;
  const tr = t["transfer"];
  const inner = t["inner"];
  return (
    typeof t["id"] === "string" &&
    typeof t["confirmedRound"] === "bigint" &&
    typeof t["type"] === "string" &&
    typeof t["sender"] === "string" &&
    (t["authAddr"] === null || typeof t["authAddr"] === "string") &&
    SIGNATURES.has(t["signature"]) &&
    t["note"] instanceof Uint8Array &&
    (tr === null || isTransfer(tr)) &&
    Array.isArray(inner) &&
    inner.every((i) => isIndexed(i, depth + 1))
  );
}

function isTransfer(tr: unknown): tr is AvmAssetTransfer {
  return (
    isObject(tr) &&
    typeof tr["assetId"] === "bigint" &&
    typeof tr["receiver"] === "string" &&
    typeof tr["amount"] === "bigint" &&
    (tr["closeTo"] === null || typeof tr["closeTo"] === "string") &&
    typeof tr["closeAmount"] === "bigint" &&
    (tr["assetSender"] === null || typeof tr["assetSender"] === "string")
  );
}

/** A reference in the form `reference` writes it. */
function isRef(ref: unknown): ref is AvmRef {
  return (
    isObject(ref) &&
    isTxid(ref["txid"]) &&
    isRound(ref["lastValid"]) &&
    normalHash(ref["h"] as AtrHash) !== null &&
    isAlgorandAddress(ref["sender"]) &&
    isAlgorandAddress(ref["signer"]) &&
    isAlgorandAddress(ref["payee"])
  );
}

function isCursor(c: unknown): c is AvmSearch {
  return (
    isObject(c) &&
    typeof c["through"] === "bigint" &&
    c["through"] >= -1n &&
    (c["top"] === undefined || typeof c["top"] === "bigint") &&
    (c["next"] === undefined || typeof c["next"] === "string")
  );
}

