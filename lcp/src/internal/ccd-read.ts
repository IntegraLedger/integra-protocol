/**
 * The read of `x402/exact/ccd`, as the profiles `read-status` and `x402/exact/ccd` state it: the sender's signed
 * sequence number read at the last finalized height and at the latest head, the item that consumed it found by a
 * bisection of finalized heights, and the search for H over the sender's numbers. `../ccd.ts` exports it as
 * `ccdStatus`; no entry point exports this module.
 */
import type { CcdBlockItem, CcdItem, CcdReader, CcdRef, CcdSearch, CcdStatus } from "../ccd.js";
import { isObject, normalHash } from "../fields.js";
import { isRefusal } from "../refusal.js";
import {
  accountBytes,
  accountText,
  decodePayload,
  memoCarries,
  sameAccount,
  signedDigest,
  transferMemo,
  type CcdPayload,
} from "./ccd.js";
import { CCD } from "./data/ccd.js";
import { decide, type Facts, type Ledger, type Moved, type OtherAct, type StatusQuery, type UnreadableReason } from "./read.js";

/**
 * lcp's own resource bound on one read: the search for H locates at most 16 of the sender's sequence numbers in one
 * call, and an answer that stops there carries the next number to locate, from which the next call resumes.
 */
export const CCD_SEARCH_NUMBERS = 16;

const ID = "x402/exact/ccd" as const;
type CcdMark = "committed" | "finalized";
type Seen = Facts<bigint, CcdMark, CcdSearch>["seen"][number];
type Query = StatusQuery<CcdRef, bigint, "finalized", CcdSearch>;
const ITEM_HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^[1-9][0-9]{0,19}$/;
const MARKS: readonly CcdMark[] = ["committed", "finalized"];
const LEDGER: Ledger<bigint, CcdMark> = {
  coverage: CCD[ID].coverage,
  final: "finalized",
  markOrder: (a, b) => MARKS.indexOf(a) - MARKS.indexOf(b),
  positionOrder: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

/** A read that established nothing, by its reason. */
class Stop extends Error {
  constructor(readonly reason: UnreadableReason) {
    super(reason);
  }
}

/** A rejected read: a `ReaderError` by its kind, anything else `transport`. */
function rejected(e: unknown): UnreadableReason {
  if (e instanceof Stop) return e.reason;
  const kind = e instanceof Error && e.name === "ReaderError" ? (e as { kind?: unknown }).kind : undefined;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/** An item in a block, with its outcome. */
type InBlock = Exclude<CcdItem, { state: "received" }>;
const unreadable = (reason: UnreadableReason): CcdStatus => ({ state: "unreadable", reason, foreign: [] });

/**
 * The read of the act asked about. The sender's next sequence number at the last finalized height and at the latest
 * head reads the signed number unconsumed or consumed; the last finalized block's own time, against the signed
 * `expiry`, reads it lapsed. Where it was consumed by the last finalized height, the bisection of finalized heights
 * finds the block at which it passed, and that block's items the one at the number. Where no act asked about is found
 * there and the answer would be `failed`, the search for H reads the sender's items at every other number from the
 * position given to the latest head. A hash the reference names is a hint: an item it names that is committed and not
 * finalized is read at `committed`, below the final mark. The facts the search rests on are not yet shown by a run (the
 * profile's rule 15), so a search read to its end proves no absence: the read reports it not whole, at the number it
 * reached, and answers `pending`, `search-incomplete`, where it would answer `failed` for any reason but
 * `before-position` (`read-status`, rule 25).
 */
export async function ccdRead(ref: CcdRef & { transaction?: string }, reader: CcdReader, query: Query): Promise<CcdStatus> {
  if (!isRef(ref)) return unreadable("unparseable");
  if (!isObject(query)) return unreadable("unparseable");
  const after = query.after;
  if (after !== undefined && (typeof after !== "bigint" || after < 0n)) return unreadable("unparseable");
  const cursor = query.search;
  if (cursor !== undefined && !(isObject(cursor) && typeof cursor.next === "bigint" && cursor.next >= 1n)) {
    return unreadable("unparseable");
  }
  if (!isObject(reader) || reader.network !== ref.network) return unreadable("chain-mismatch");
  const sender = accountBytes(ref.sender) as Uint8Array;
  const payee = accountBytes(ref.payee) as Uint8Array;
  const nonce = BigInt(ref.nonce);
  const others = Array.isArray(query.others) ? (query.others as readonly OtherAct<CcdRef>[]) : [];
  const givenHashes = new Set(
    others.flatMap((o) => (isObject(o) && "transaction" in o && typeof o.transaction === "string" ? [o.transaction.toLowerCase()] : [])),
  );
  const givenRefs = others.flatMap((o) => {
    if (!isObject(o) || !("ref" in o) || !isObject(o.ref)) return [];
    const r = o.ref as Partial<CcdRef>;
    const account = typeof r.sender === "string" ? accountBytes(r.sender) : null;
    return account !== null && !isRefusal(account) && typeof r.nonce === "string" && DECIMAL.test(r.nonce)
      ? [{ account, nonce: BigInt(r.nonce) }]
      : [];
  });
  const isGiven = (hash: string, account: Uint8Array | null, n: bigint | undefined): boolean =>
    givenHashes.has(hash.toLowerCase()) || givenRefs.some((g) => g.nonce === n && sameAccount(g.account, account));

  try {
    const final = await reader.lastFinal();
    if (typeof final !== "bigint" || final < 0n) throw new Stop("unparseable");
    // The account's next number at a height: an account the node holds no state for at a block it holds has used none.
    const nextAt = async (height: bigint | "best"): Promise<bigint> => {
      const n = await reader.nextNonce(ref.sender, height);
      if (n === null) {
        if (height !== "best" && (await blockAt(height)) === null) throw new Stop("history-gap");
        return 1n;
      }
      if (typeof n !== "bigint" || n < 1n) throw new Stop("unparseable");
      return n;
    };
    const blockAt = async (height: bigint): Promise<{ slotTime: bigint } | null> => {
      const b = await reader.block(height);
      if (b !== null && !(isObject(b) && typeof b.slotTime === "bigint")) throw new Stop("unparseable");
      return b;
    };
    const finalBlock = await blockAt(final);
    if (finalBlock === null) throw new Stop("history-gap");
    const nFinal = await nextAt(final);
    const nHead = await nextAt("best");
    const nAfter = after === undefined ? undefined : await nextAt(after);
    // A bound is compared with the final head's own time: `slot_time` is in milliseconds, the expiry in seconds.
    const lapsed = finalBlock.slotTime > BigInt(ref.expiry) * 1000n;
    const value = { consumed: nFinal > nonce, lapsed, mark: "finalized" as const, head: { consumed: nHead > nonce } };

    // The first finalized height in (lo, hi] at which the next number has passed n, its passing at hi known.
    const locate = async (n: bigint, lo: bigint, hi: bigint): Promise<bigint> => {
      while (hi - lo > 1n) {
        const mid = lo + (hi - lo) / 2n;
        if ((await nextAt(mid)) > n) hi = mid;
        else lo = mid;
      }
      return hi;
    };
    const blocks = new Map<bigint, readonly CcdBlockItem[]>();
    const itemsAt = async (height: bigint): Promise<readonly CcdBlockItem[]> => {
      let items = blocks.get(height);
      if (items === undefined) {
        items = await reader.items(height);
        if (!Array.isArray(items) || !items.every(isBlockItem)) throw new Stop("unparseable");
        blocks.set(height, items);
      }
      return items;
    };
    const outcomeOf = async (hash: string): Promise<InBlock> => {
      const o = await reader.item(hash);
      if (o === null || !isItem(o) || o.state !== "finalized") throw new Stop("unparseable");
      return o;
    };

    const seen: Seen[] = [];
    const undecoded: { transaction: string; at: CcdSearch }[] = [];

    // The item at a number of the sender's, located at a height: its Seen; `passed`, an item of the search's that
    // carries no H; `absent`, no item of the sender's at that number in the block; or `held`, an item the read could not
    // decode, which may be it and holds the search.
    const readAt = async (n: bigint, height: bigint, outcomeUnknown: "unparseable" | "hold"): Promise<Seen | "absent" | "passed" | "held"> => {
      const items = await itemsAt(height);
      const it = items.find((i): i is Extract<CcdBlockItem, { sender: Uint8Array }> => !("undecoded" in i) && i.nonce === n && sameAccount(i.sender, sender));
      if (it === undefined) {
        const held = items.filter((i) => "undecoded" in i);
        for (const u of held) undecoded.push({ transaction: u.hash, at: { next: n } });
        return held.length > 0 ? "held" : "absent";
      }
      const payload = decodePayload(it.payload);
      if (payload === null) {
        if (outcomeUnknown === "unparseable") throw new Stop("unparseable");
        undecoded.push({ transaction: it.hash, at: { next: n } });
        return "held";
      }
      const signed = carriesOf(payload, ref.h);
      // The search passes over an item of the sender's that carries no H; the item at the signed number is read whole.
      if (n !== nonce && !signed.carries) return "passed";
      const outcome = await outcomeOf(it.hash);
      if (outcome.unknown === true) {
        if (outcomeUnknown === "unparseable") throw new Stop("unparseable");
        undecoded.push({ transaction: it.hash, at: { next: n } });
        return "held";
      }
      const presented =
        (await signedDigest({ sender: it.sender, nonce: it.nonce, expiry: it.expiry, energy: it.energy, sponsor: it.sponsor, payload: it.payload })) ===
        ref.signed.toLowerCase();
      return {
        transaction: it.hash,
        position: height,
        mark: "finalized",
        result: outcome.success ? "succeeded" : "failed",
        consumed: n === nonce,
        carries: signed.carries,
        party: sameAccount(it.sender, payee) ? "payee" : sameAccount(it.sender, sender) ? "payer" : "other",
        kind: signed.one ? "same" : "other",
        // The account the signed payload names, whatever its result moved.
        account: signed.receiver === null ? "none" : sameAccount(signed.receiver, payee) ? "payee" : "other",
        ...(isGiven(it.hash, it.sender, n) ? { given: true } : {}),
        presented: presented ? "yes" : "no",
        moved: movedOf(outcome, it.hash),
        signer: accountText(it.sender),
      };
    };

    // The hint: an item a hash names, taken where the reader gives the height of the block that holds it and its
    // outcome names no effect or event kind the reader does not know. One committed and not yet finalized is read below
    // the final mark; one finalized under another account's signature, which no number of the sender's reaches, is read
    // at the final mark. The sender's own finalized items are read by their numbers, which prevail.
    if (typeof ref.transaction === "string" && ITEM_HASH.test(ref.transaction.toLowerCase())) {
      const hinted = await reader.item(ref.transaction.toLowerCase());
      if (hinted !== null && !isItem(hinted)) throw new Stop("unparseable");
      if (
        hinted !== null &&
        hinted.state !== "received" &&
        hinted.height !== undefined &&
        hinted.unknown !== true &&
        (hinted.state === "committed" || !sameAccount(hinted.sender, sender))
      ) {
        seen.push(hintSeen(ref, hinted as InBlock & { height: bigint }, sender, payee, nonce, isGiven));
      }
    }

    // The item at the signed number, where the last finalized height reads it consumed.
    const before = nAfter !== undefined && nAfter > nonce;
    let atNumber: Seen | "absent" | "passed" | "held" | undefined;
    if (value.consumed) {
      const height = before ? await locate(nonce, -1n, after!) : await locate(nonce, after ?? -1n, final);
      atNumber = await readAt(nonce, height, "unparseable");
      if (typeof atNumber === "object") seen.push(atNumber);
    }

    const settles = (s: Seen | "absent" | "passed" | "held" | undefined): boolean =>
      typeof s === "object" &&
      s.result === "succeeded" &&
      s.carries &&
      s.party === "payer" &&
      s.kind === "same" &&
      s.given !== true &&
      (query.act === "agreement" || s.account === "payee");
    // The search for H, where the answer would be `failed`: the number consumed by another item or by this one's failed
    // result, or lapsed unconsumed at the final mark and at the latest head.
    const needSearch = !before && !settles(atNumber) && (value.consumed || (lapsed && !value.head.consumed));
    // Where no search runs, a position the caller gave is carried back unchanged, for the next call to take.
    let search: { whole: boolean; at?: CcdSearch } = cursor === undefined ? { whole: false } : { whole: false, at: cursor };
    if (needSearch) {
      let n = cursor?.next ?? nAfter ?? 1n;
      let located = 0;
      for (; n < nHead && located < CCD_SEARCH_NUMBERS; n++) {
        if (n === nonce) continue;
        // A number not passed at the last finalized height has its item above it, which the bisection does not reach.
        if (nFinal <= n) break;
        located++;
        const found = await readAt(n, await locate(n, after !== undefined && nAfter! <= n ? after : -1n, final), "hold");
        // A number located with no item of the sender's at it leaves the search incomplete there.
        if (found === "absent") break;
        if (typeof found === "object") seen.push(found);
      }
      // Read to its end or not, the search proves no absence until a run shows the facts it rests on (rule 15).
      search = { whole: false, at: { next: n } };
    }

    const facts = { seen, value, search, history: true, ...(undecoded.length === 0 ? {} : { undecoded }) };
    return decide(facts, query, LEDGER) as CcdStatus;
  } catch (e) {
    return unreadable(rejected(e));
  }
}

/**
 * What a signed payload carries: whether it holds H's memo, whether it is one transfer (the pairing's act), and the
 * account that transfer names.
 */
function carriesOf(p: CcdPayload, h: CcdRef["h"]): { carries: boolean; one: boolean; receiver: Uint8Array | null } {
  switch (p.kind) {
    case "ccd":
      return { carries: memoCarries(p.memo, h), one: true, receiver: p.receiver };
    case "plt": {
      const one = !p.others && p.transfers.length === 1;
      return {
        carries: p.transfers.some((t) => memoCarries(t.memo, h)),
        one,
        receiver: one ? p.transfers[0]!.receiver : (p.transfers.find((t) => memoCarries(t.memo, h))?.receiver ?? null),
      };
    }
    case "memo":
      return { carries: memoCarries(p.memo, h), one: false, receiver: p.receiver };
    case "other":
      return { carries: false, one: false, receiver: null };
  }
}

/**
 * What an item's outcome moved: each transfer it lists, named by the item's hash and its index among them, with the
 * decimals of its amount: six for CCD, in microCCD, and a PLT's own.
 */
function movedOf(outcome: InBlock, hash: string): Moved[] {
  return outcome.transfers.map((t, place) => ({
    asset: t.kind === "ccd" ? "CCD" : (t.tokenId ?? ""),
    amount: t.amount.toString(),
    to: accountText(t.receiver),
    transaction: hash,
    place,
    decimals: t.kind === "ccd" ? CCD_DECIMALS : t.decimals!,
  }));
}

/**
 * An item a hint names, read from its outcome alone at the mark the node answers and the height of the block that holds
 * it: committed and not yet finalized, or finalized under another account's signature. It carries H where exactly one
 * transfer's memo is H; it consumed the signed number where the reader read its header's number in that block and its
 * sender is the reference's.
 */
function hintSeen(
  ref: CcdRef & { transaction?: string },
  it: InBlock & { height: bigint },
  sender: Uint8Array,
  payee: Uint8Array | null,
  nonce: bigint,
  isGiven: (hash: string, account: Uint8Array | null, n: bigint | undefined) => boolean,
): Seen {
  const hash = ref.transaction!.toLowerCase();
  const carrying = it.transfers.filter((t) => memoCarries(transferMemo(t), ref.h));
  const t = carrying.length === 1 ? carrying[0]! : undefined;
  const from = it.sender ?? new Uint8Array(32);
  return {
    transaction: hash,
    position: it.height,
    mark: it.state,
    result: it.success ? "succeeded" : "failed",
    consumed: it.nonce === nonce && sameAccount(from, sender),
    carries: t !== undefined,
    party: sameAccount(from, payee) ? "payee" : sameAccount(from, sender) ? "payer" : "other",
    kind: "same",
    account: t === undefined ? "none" : sameAccount(t.receiver, payee) ? "payee" : "other",
    ...(isGiven(hash, it.sender, it.nonce) ? { given: true } : {}),
    moved: movedOf(it, hash),
    ...(it.sender === null ? {} : { signer: accountText(it.sender) }),
  };
}

function isBlockItem(v: unknown): v is CcdBlockItem {
  if (!isObject(v) || typeof v["hash"] !== "string") return false;
  if (v["undecoded"] === true) return true;
  return (
    v["sender"] instanceof Uint8Array &&
    v["sender"].length === 32 &&
    typeof v["nonce"] === "bigint" &&
    typeof v["expiry"] === "bigint" &&
    typeof v["energy"] === "bigint" &&
    (v["sponsor"] === null || (v["sponsor"] instanceof Uint8Array && v["sponsor"].length === 32)) &&
    v["payload"] instanceof Uint8Array
  );
}

/** An answer of `GetBlockItemStatus` in the reader's form. */
export function isItem(v: unknown): v is CcdItem {
  if (!isObject(v)) return false;
  if (v["state"] === "received") return true;
  if ((v["state"] !== "finalized" && v["state"] !== "committed") || typeof v["success"] !== "boolean") return false;
  const sender = v["sender"];
  if (sender !== null && !(sender instanceof Uint8Array)) return false;
  if (v["unknown"] !== undefined && typeof v["unknown"] !== "boolean") return false;
  if (v["height"] !== undefined && typeof v["height"] !== "bigint") return false;
  if (v["nonce"] !== undefined && typeof v["nonce"] !== "bigint") return false;
  const transfers = v["transfers"];
  return (
    Array.isArray(transfers) &&
    transfers.every(
      (t: unknown) =>
        isObject(t) &&
        (t["kind"] === "ccd" ? t["decimals"] === undefined : t["kind"] === "plt" && isDecimals(t["decimals"])) &&
        t["receiver"] instanceof Uint8Array &&
        typeof t["amount"] === "bigint" &&
        (t["memo"] === null || t["memo"] instanceof Uint8Array),
    )
  );
}

/** The decimals of a CCD amount, in microCCD (concordium-grpc-api `v2/concordium/types.proto` L328 at 30c79ca0). */
const CCD_DECIMALS = 6;

/** A `TokenAmount`'s `decimals`, a `uint32` (`v2/concordium/protocol-level-tokens.proto` L49 at 30c79ca0). */
function isDecimals(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

/** A reference in the form `reference` writes it. */
function isRef(ref: unknown): ref is CcdRef & { transaction?: string } {
  return (
    isObject(ref) &&
    typeof ref["network"] === "string" &&
    normalHash(ref["h"] as CcdRef["h"]) !== null &&
    typeof ref["sender"] === "string" &&
    !isRefusal(accountBytes(ref["sender"])) &&
    typeof ref["nonce"] === "string" &&
    DECIMAL.test(ref["nonce"]) &&
    BigInt(ref["nonce"]) < 1n << 64n &&
    typeof ref["expiry"] === "number" &&
    Number.isSafeInteger(ref["expiry"]) &&
    ref["expiry"] >= 0 &&
    typeof ref["payee"] === "string" &&
    !isRefusal(accountBytes(ref["payee"])) &&
    typeof ref["signed"] === "string" &&
    normalHash(ref["signed"] as CcdRef["h"]) !== null &&
    (ref["transaction"] === undefined || typeof ref["transaction"] === "string")
  );
}
