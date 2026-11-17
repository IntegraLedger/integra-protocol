// The read kit's form for x402/exact/algorand: each case of read-status.json made on Indexer fixtures and run through
// the pairing's own read, as it ships: the facts its search rests on not yet shown (the profile's rule 16), so the
// cases its gate holds are declared. The claimed transaction id lands where the case's value
// is consumed; otherwise it is absent, lapsed where the case needs the search for H, and every other transaction the case
// names is a page of the payer's transactions. Positions are rounds above a base; the search's positions are the
// cursors the fixtures give, each mapped to the case's number.
import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";
import { encodeAddress } from "algosdk";
import { avmStatus, type AvmIndexed, type AvmPage, type AvmReader, type AvmRef, type AvmSearch } from "../../../src/avm.js";
import { toLcpString, type AtrHash } from "../../../src/core.js";
import type { Act, Moved } from "../../../src/internal/read.js";
import type { CaseAnswer, CaseMark, CaseSeen, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS } from "../harness.js";

const NETWORK = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe" as const;
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as AtrHash;
const CARRIER = new TextEncoder().encode(toLcpString(H));
const OTHER_NOTE = new TextEncoder().encode("another note");
const account = (label: string) => encodeAddress(sha512_256(new TextEncoder().encode(label)));
const PAYER = account("read kit payer");
const PAYEE = account("read kit payee");
const STRANGER = account("read kit another signer");
const ELSEWHERE = [account("read kit another receiver 1"), account("read kit another receiver 2")];
const NO_ACCOUNT = encodeAddress(new Uint8Array(32));
const txid = (name: string) => base32.encode(sha512_256(new TextEncoder().encode(`read kit ${name}`))).replace(/=+$/, "");
const CLAIMED_ABSENT = txid("the claimed id, absent");
const BASE = 1000n;
const LAST_VALID = BASE + 100n;

// --- The cases this read cannot meet, as the profile's rule 18 states them: by a reason, every case whose answer on the
// act carries it; by the opening words of a case's text, every case that opens so; and the cases the search's gate
// holds while the facts its search rests on are not yet shown. Each case and act is stated once, under the first
// statement that takes it.
const RULE = "x402-exact-algorand-note.md, rule 18, cases this read cannot meet";
const ONE_ROUND = "since the Indexer's one round is the final mark and the latest head";
const NO_FAILED = "since no failed transaction is included";
const ONE_READ = "since the id is read consumed only by finding its transaction, at that one round";
const PLACED = "since every transaction is in a round";

/** Every case whose expected answer on an act carries `reason`, on those acts. */
const byReason = (reason: string, why: string): Inapplicable[] =>
  READ_STATUS.cases.flatMap((c) => {
    const acts = ACTS.filter((a) => "reason" in c.expect[a] && c.expect[a].reason === reason);
    return acts.length === 0 ? [] : [{ case: c.case, acts, stated: `${RULE}: \`${reason}\`, ${why}` }];
  });
/** Every case whose text opens with `words`, on both acts; words that open no case throw. */
const byWords = (words: string, why: string): Inapplicable[] => {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words));
  if (found.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return found.map((c) => ({ case: c.case, stated: `${RULE}: *${words}*, ${why}` }));
};
/** The cases the search's gate holds: at coverage full, those whose answer on an act is one of the gated failures. */
const GATED = new Set(["instrument-unused", "instrument-consumed", "transaction-failed"]);
const gate = (why: string): Inapplicable[] =>
  READ_STATUS.cases.flatMap((c) => {
    if (c.coverage !== "full") return [];
    const acts = ACTS.filter((a) => c.expect[a].state === "failed" && "reason" in c.expect[a] && GATED.has(c.expect[a].reason));
    return acts.length === 0 ? [] : [{ case: c.case, acts, stated: `${RULE}: ${why}` }];
  });

/** The statements, the first that takes a case and act holding it. */
function once(statements: readonly Inapplicable[]): Inapplicable[] {
  const seen = new Set<string>();
  const out: Inapplicable[] = [];
  for (const d of statements) {
    const acts = (d.acts ?? ACTS).filter((a) => !seen.has(`${d.case}\u0000${a}`));
    for (const a of acts) seen.add(`${d.case}\u0000${a}`);
    if (acts.length > 0) out.push(acts.length === ACTS.length ? { case: d.case, stated: d.stated } : { ...d, acts });
  }
  return out;
}

const inapplicable: Inapplicable[] = once([
  ...byReason("below-mark", "since the Indexer serves confirmed rounds alone"),
  ...byReason(
    "not-found",
    "since the read holds the single-use value, the transaction id within its validity rounds, and answers its absence " +
      "`pending`, `instrument-live`, or `unreadable`, `history-gap`",
  ),
  ...byReason("transaction-failed", "since Algorand includes no failed transaction"),
  ...byWords("an act read at the finality asked for, below the final mark", ONE_ROUND),
  ...byWords("a value unconsumed at the final mark and consumed at the latest head", ONE_ROUND),
  ...byWords("a value whose validity passed, unconsumed at the final mark and consumed at the latest head", ONE_ROUND),
  ...byWords("transactions carrying H with a failed result", NO_FAILED),
  ...byWords("a failed result that left the value unconsumed", NO_FAILED),
  ...byWords("a failed result that consumed the value", NO_FAILED),
  ...byWords("a read with no means to read the single-use value", NO_FAILED),
  ...byWords("a value read consumed whose transaction the search has not found", ONE_READ),
  ...byWords("a read that did not read the value at the latest head", ONE_READ),
  ...byWords("an act the read cannot place against the position given", PLACED),
  ...byWords("an item the search could not decode that gives no position", PLACED),
  ...gate(
    "while the search proves no absence (rule 16), the cases its gate holds: its failed answers but before-position, " +
      "which the read answers pending, search-incomplete",
  ),
]);
const declared = (c: ReadCase, act: Act): Inapplicable | undefined =>
  inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));

type Named = { name: string; seen?: CaseSeen };

/** The case's ledger: the fixtures, the reader over them, and the maps back to the case's names and numbers. */
function arrange(c: ReadCase, act: Act): { run: () => Promise<CaseAnswer> } {
  const f = c.facts;
  const toId = new Map<string, string>();
  const toName = new Map<string, string>();
  const id = (name: string) => {
    if (!toId.has(name)) {
      toId.set(name, txid(name));
      toName.set(txid(name), name);
    }
    return toId.get(name)!;
  };
  const assets = new Map<string, bigint>();
  const tos = new Map<string, string>([["payee", PAYEE]]);
  for (const m of f.seen.flatMap((s) => s.moved ?? [])) {
    if (!assets.has(m.asset)) assets.set(m.asset, 1001n + BigInt(assets.size));
    if (!tos.has(m.to)) tos.set(m.to, ELSEWHERE[tos.size - 1]!);
  }
  const round = (p: number) => BASE + BigInt(p);
  // Each transfer's place in the case's spelling, by the member it is read from: the first `arcv`, the second `aclose`.
  const places = new Map<string, number | string>();
  const fixture = (s: CaseSeen): AvmIndexed => {
    s.moved?.forEach((m, i) => {
      if (m.place !== undefined) places.set(`${id(s.transaction)}\u0000${i === 0 ? "arcv" : "aclose"}`, m.place);
    });
    const m = s.moved?.[0];
    const receiver = s.account === "payee" ? PAYEE : s.account === "none" ? NO_ACCOUNT : m !== undefined ? tos.get(m.to)! : ELSEWHERE[0]!;
    return {
      id: id(s.transaction),
      confirmedRound: round(s.position!),
      type: s.kind === "same" ? "axfer" : "pay",
      sender: s.party === "other" ? STRANGER : PAYER,
      authAddr: s.party === "payee" ? PAYEE : null,
      signature: "sig",
      note: s.carries ? CARRIER : OTHER_NOTE,
      transfer:
        s.kind === "same"
          ? {
              assetId: m === undefined ? 1001n : assets.get(m.asset)!,
              receiver,
              amount: m === undefined ? 1n : BigInt(m.amount),
              // A second transfer of the case is the close of the holding to its account.
              closeTo: s.moved?.[1] === undefined ? null : tos.get(s.moved[1].to)!,
              closeAmount: s.moved?.[1] === undefined ? 0n : BigInt(s.moved[1].amount),
              assetSender: null,
            }
          : null,
      inner: [],
    };
  };

  // The claimed id: the transaction that consumed the value, where the case reads it consumed, or where it names no
  // other transaction beside it and is the payment presented; otherwise absent, and the transaction the search finds,
  // which is another transaction than the one presented.
  const consumer = f.seen.find((s) => s.consumed && s.result === "succeeded");
  const others = f.seen.filter((s) => s !== consumer && s.carries);
  const lands = consumer !== undefined && (f.value?.consumed === true || (others.length === 0 && consumer.presented !== "no"));
  const claimed = lands ? id(consumer.transaction) : CLAIMED_ABSENT;
  const hits = f.seen.filter((s) => !(lands && s === consumer));
  const needsSearch = hits.length > 0 || !f.search.whole || (f.undecoded ?? []).length > 0;
  const lapsed = f.value !== undefined ? f.value.lapsed : !lands && needsSearch;
  const current = lands || !lapsed ? BASE + 60n : LAST_VALID + 1n;

  // The search's pages, from one past the position given, in one sub-range topped at the lookup's round: the
  // transactions the case names, then each item it could not decode on a page of its own, then, where the case's
  // search is not whole, a page that answers a round below the top.
  const cursors = new Map<string, number>();
  const key = (cursor: AvmSearch) => JSON.stringify(cursor, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const after = c.query.after === undefined ? undefined : round(c.query.after);
  const through = after ?? -1n;
  const pages: AvmPage[] = [];
  const tail = (f.undecoded ?? []).length + (f.search.whole ? 0 : 1);
  const first = hits.map(fixture);
  if (tail > 0 && first.length === 0) first.push({ ...fixture({ ...f.seen[0]!, transaction: "filler", position: 1, carries: false } as never) });
  pages.push({ currentRound: current, transactions: first, ...(tail > 0 || first.length > 0 ? { next: "p1" } : {}) });
  let k = 1;
  for (const u of f.undecoded ?? []) {
    cursors.set(key({ through, top: current, next: `p${k}` }), u.at as number);
    pages.push({ currentRound: current, transactions: [{ unparseable: true, id: id(u.transaction) }], next: `p${k + 1}` });
    k++;
  }
  if (!f.search.whole) {
    cursors.set(key({ through, top: current, next: `p${k}` }), f.search.at as number);
    pages.push({ currentRound: current - 1n, transactions: [], next: `p${k + 1}` });
  } else if (pages[pages.length - 1]!.next !== undefined) {
    pages.push({ currentRound: current, transactions: [] });
  }
  // Where the value is live, the read runs no search: the case's search position is the one an earlier answer gave.
  const held = (f.undecoded ?? [])[0]?.at ?? f.search.at;
  let given: AvmSearch | undefined;
  if (!lands && !lapsed && held !== undefined) {
    given = { through: round(held as number) };
    cursors.set(key(given), held as number);
  }

  const reader: AvmReader = {
    network: f.unreadable === "chain-mismatch" ? "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k" : NETWORK,
    ...(f.history ? { archival: true } : {}),
    transaction: async () => {
      if (f.unreadable === "transport") throw new Error("transport");
      if (f.unreadable === "too-large") throw Object.assign(new Error("too large"), { name: "ReaderError", kind: "too-large" });
      if (f.unreadable === "unparseable") return { currentRound: current, found: { ...fixture(f.seen[0] ?? ({ transaction: "x", position: 1, mark: "final", result: "succeeded", consumed: true, carries: true, party: "payer", kind: "same", account: "payee" } as never)), id: txid("another id") } };
      return { currentRound: current, found: lands ? fixture(consumer) : null };
    },
    header: async () => false,
    accountPage: async () => {
      const p = pages.shift();
      if (p === undefined) throw new Error("the form gives no more pages");
      return p;
    },
  };
  const ref: AvmRef = { network: NETWORK, txid: claimed, lastValid: LAST_VALID.toString(), h: H, sender: PAYER, signer: PAYER, payee: PAYEE };
  const othersGiven = (c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: id(o.transaction) } : o));
  const query = {
    act,
    finality: "final" as const,
    ...(after === undefined ? {} : { after }),
    ...(given === undefined ? {} : { search: given }),
    ...(othersGiven.length === 0 ? {} : { others: othersGiven }),
  };

  const assetName = new Map([...assets].map(([n, i]) => [i.toString(), n]));
  const toNameOf = new Map([...tos].map(([n, a]) => [a, n]));
  const movedBack = (ms: readonly Moved[]) =>
    ms.map((m) => ({
      asset: assetName.get(m.asset) ?? m.asset,
      amount: m.amount,
      to: toNameOf.get(m.to) ?? m.to,
      ...(m.transaction === undefined ? {} : { transaction: nameOf(m.transaction) }),
      ...(m.place === undefined ? {} : { place: places.get(`${m.transaction}\u0000${m.place}`) ?? m.place }),
    }));
  const nameOf = (t: string) => toName.get(t) ?? t;
  const back = (a: Record<string, unknown>): CaseAnswer => {
    const out: Record<string, unknown> = { ...a };
    if (typeof a["transaction"] === "string") out["transaction"] = nameOf(a["transaction"]);
    if (typeof a["position"] === "bigint") out["position"] = Number(a["position"] - BASE);
    if (Array.isArray(a["moved"])) out["moved"] = movedBack(a["moved"] as Moved[]);
    if (a["search"] !== undefined) out["search"] = cursors.get(key(a["search"] as AvmSearch)) ?? a["search"];
    if (Array.isArray(a["undecoded"])) out["undecoded"] = (a["undecoded"] as string[]).map(nameOf);
    out["foreign"] = (a["foreign"] as Record<string, unknown>[]).map((i) => back({ ...i, foreign: [] })).map(({ foreign: _, ...i }) => i);
    return out as unknown as CaseAnswer;
  };
  return { run: async () => back((await avmStatus(ref, reader, query as never)) as unknown as Record<string, unknown>) };
}

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/algorand",
      arrange: (c, act) => {
        const stated = declared(c, act);
        return stated !== undefined ? { inapplicable: stated.stated } : arrange(c, act);
      },
    },
    inapplicable,
  },
];

