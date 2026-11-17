// The read kit's form for x402/exact/casper: each case of read-status.json arranged on a constructed Casper node (the
// item of the reference's `(from, nonce)` in the asset's `used_nonces`, set from one block; that block's executed
// transactions, a page each; the newest block and its timestamp) and read by exactCasper.status, its answer put back in
// the case's terms. A case is arranged with its facts as written, or in the ledger's own spelling where the rule that
// decides it treats the two alike, and says why; the cases the profile x402-exact-casper.md declares inapplicable
// (rule 22) are skipped, and a case the read cannot meet that the profile does not declare runs as written and fails.
import { exactCasper, type CasperBlockCall, type CasperCursor, type CasperReader, type CasperStatus } from "../../../src/casper.js";
import { agreementValue, type AtrHash } from "../../../src/core.js";
import { ReaderError } from "../../../src/evm.js";
import type { Act, Moved } from "../../../src/internal/read.js";
import type { CaseAnswer, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { answering, READ_STATUS } from "../harness.js";

const NETWORK = "casper:casper-test";
const PKG = "dd".repeat(32);
const OTHER_PKG = "0d".repeat(32);
const PAYER = `00${"aa".repeat(32)}`;
const PAYEE = `00${"bb".repeat(32)}`;
const OTHER = `01${"cc".repeat(32)}`;
const ELSEWHERE = `00${"ee".repeat(32)}`;
const H: AtrHash = `0x${"5a".repeat(32)}`;
const VALID_BEFORE = 2_000_000_000n;
const BASE = 1000n;
const HEAD = BASE + 50n;
const TX: Record<string, string> = {
  t1: "11".repeat(32),
  t2: "22".repeat(32),
  setter: "33".repeat(32),
  filler: "44".repeat(32),
  u1: "55".repeat(32),
  u2: "66".repeat(32),
  c1: "77".repeat(32),
};
const CASE_TX = Object.fromEntries(Object.entries(TX).map(([k, v]) => [v, k]));

/** A call of the block that set the item: its signer, which of H's two values its nonce is, and what it moved. */
interface Spec {
  readonly tx: keyof typeof TX;
  readonly from: "payer" | "payee" | "other";
  readonly value: "own" | "other";
  readonly to?: "payee" | "elsewhere";
  readonly amount?: string;
  readonly entry?: "transfer_with_authorization" | "receive_with_authorization" | "cancel_authorization";
  readonly error?: boolean;
  /** The node gives the call without its `from`: an item the read cannot decode. */
  readonly undecoded?: boolean;
}

/** A case's arrangement on the node. */
interface Setup {
  /** The case position of the block from which the item is set; null where it is never set. */
  readonly setFrom: number | null;
  /** Where the item is never set, the case position of a block that holds `calls` all the same. */
  readonly callsAt?: number;
  /** Whether the newest block's timestamp is at or past `validBefore`. */
  readonly lapsed?: boolean;
  /** The block's first page. */
  readonly calls?: readonly Spec[];
  /** Its second page. */
  readonly more?: readonly Spec[];
  /** Eight pages more after it, the most a call reads, with the call that set the item on the last. */
  readonly overflow?: boolean;
  /** The caller resumes a search position: the height below the newest block that an earlier read found unset. */
  readonly resume?: boolean;
  /** Where the payment presented differs, in its amount, from the call that set the item. */
  readonly presentedDiffers?: boolean;
  /** The lowest height the node serves, as a case position. */
  readonly lowest?: number;
  readonly fault?: "transport" | "too-large" | "unparseable" | "chain-mismatch";
}

const setter: Spec = { tx: "setter", from: "payer", value: "own", to: "payee" };
const own = (tx: Spec["tx"], to: "payee" | "elsewhere", amount?: string): Spec => ({ tx, from: "payer", value: "own", to, ...(amount === undefined ? {} : { amount }) });
const undecoded = (tx: Spec["tx"]): Spec => ({ tx, from: "payer", value: "own", to: "payee", undecoded: true });

/** Each case's arrangement, by its name in read-status.json. */
const SETUPS: Record<string, Setup> = {
  "a payment act carrying H that transferred zero to the payee's account is the act, with what it moved": { setFrom: 10, calls: [own("t1", "payee", "0")] },
  "an act carrying H that transferred to another account and consumed the single-use value: instrument-consumed for a payment, settled for an agreement": {
    setFrom: 10, calls: [own("t1", "elsewhere", "5")],
  },
  "an act carrying H that transferred zero to another account and consumed the single-use value": { setFrom: 10, calls: [own("t1", "elsewhere", "0")] },
  // On Casper every executed authorization names its `to` and sets the item, so an act of the payer's that names no
  // account and consumes nothing cannot arise; the nearest is its transfer to another account in a block read in part.
  "an act carrying H that names no account and consumed nothing: a foreign item for a payment, settled for an agreement": {
    setFrom: 10, calls: [own("t1", "elsewhere")], overflow: true,
  },
  "an act the option's payee signed is a foreign item on either act": { setFrom: 10, calls: [{ tx: "t1", from: "payee", value: "own", to: "payee" }], overflow: true },
  "an act carrying H under another account's signature is a foreign item": { setFrom: 10, calls: [{ tx: "t1", from: "other", value: "own", to: "payee" }], overflow: true },
  "an act the caller gave as another act under the same H is never settled on: a foreign item where it consumed nothing": {
    setFrom: 10, calls: [{ tx: "t1", from: "payer", value: "other", to: "payee" }], overflow: true,
  },
  "an act of another pairing or kind carrying H is a foreign item": { setFrom: 10, calls: [{ tx: "t1", from: "payer", value: "other", to: "payee" }], overflow: true },
  "a transaction for which two reasons hold is named by the first": { setFrom: 10, calls: [{ tx: "t1", from: "payee", value: "other", to: "payee" }], overflow: true },
  // Both executed with an error_message, which rolls back and leaves the item unset, so the read of the item at the
  // newest block answers before any block is read.
  "transactions carrying H with a failed result, the payer's own and one the payee signed, are no foreign items": {
    setFrom: null,
    callsAt: 10,
    calls: [{ ...own("t1", "payee"), error: true }, { tx: "t2", from: "payee", value: "own", to: "payee", error: true }],
  },
  "the settled act's answer names every foreign item beside it": {
    setFrom: 10, calls: [own("t1", "payee"), { tx: "t2", from: "payee", value: "own", to: "payee" }],
  },
  "a search narrowed to one asset, payee or token is never read whole: search-incomplete with its position": { setFrom: null, lapsed: true },
  "before-position is decided before any other reason, an act otherwise settled included": { setFrom: 3, calls: [own("t1", "payee")] },
  "a transaction at the position given counts as before it": { setFrom: 5, calls: [own("t1", "payee")] },
  // Only the payer's own authorization or cancellation sets the payer's item; the nearest consumer at the position is
  // the payer's transfer to another account.
  "a transaction that consumed the value at or before the position given answers before-position": { setFrom: 4, calls: [own("t1", "elsewhere")] },
  "an act after the position given is settled": { setFrom: 6, calls: [own("t1", "payee")] },
  "at coverage full, instrument-consumed waits for the search for H to be read whole": { setFrom: 10, calls: [own("t1", "elsewhere")], overflow: true },
  "a failed result that left the value unconsumed, its validity not passed: instrument-live": { setFrom: null },
  "the validity passed with the value unconsumed and the search for H not read whole: search-incomplete": { setFrom: null, lapsed: true },
  // The read always reads the item, so the case, which reads no value, is made as the item read unset past
  // `validBefore` with nothing found and the search not read whole: read-status rule 22 answers both `search-incomplete`,
  // at the search's position.
  "search-incomplete is answered before not-found": { setFrom: null, lapsed: true },
  "a value read consumed whose transaction the search has not found is never failed and never not-found": { setFrom: 10, calls: [] },
  "instrument-live is answered before search-incomplete": { setFrom: null, resume: true },
  "absence without the history shown is history-gap": { setFrom: 0, lowest: 0 },
  "a read that established nothing: transport": { setFrom: 10, fault: "transport" },
  "a read that established nothing: unparseable": { setFrom: 10, fault: "unparseable" },
  "a read that established nothing: too-large": { setFrom: 10, fault: "too-large" },
  "a read that established nothing: chain-mismatch": { setFrom: 10, fault: "chain-mismatch" },
  "a search that met an item it cannot decode and found nothing else that decides: search-incomplete, held at that item, which it names": {
    setFrom: 10, calls: [undecoded("u1")],
  },
  "the answer names every item the search could not decode in its range, held at the first": {
    setFrom: 10, calls: [undecoded("u1")], more: [undecoded("u2")],
  },
  "the search's range left to read and an item it could not decode before its end: held at the item": {
    setFrom: 10, calls: [undecoded("u1")], overflow: true,
  },
  "an item the caller gave that the read cannot decode, beside one it did not give: held at the one not given, which alone it names": {
    setFrom: 10, calls: [undecoded("u1")], more: [undecoded("u2")], lapsed: true,
  },
  "an act the search found is settled, whatever items it could not decode": { setFrom: 10, calls: [undecoded("u1"), own("t1", "payee")] },
  "an act whose signed message differs in a member from the payment presented is settled all the same: presented no": {
    setFrom: 10, calls: [own("t1", "payee", "5")], presentedDiffers: true,
  },
};

const height = (position: number): bigint => BASE + BigInt(position);

/** The amount of the call that sets the item in the setup, which the payment presented names unless it differs. */
const presentedAmount = (s: Setup): string =>
  [...(s.calls ?? []), ...(s.more ?? [])].find((x) => x.from === "payer" && x.value === "own" && x.error !== true)?.amount ?? "1";

/** The node of a setup, for the act's nonce and its other value. */
function nodeOf(s: Setup, nonce: AtrHash, other: AtrHash): CasperReader {
  const block = s.setFrom === null ? undefined : height(s.setFrom);
  const callsBlock = block ?? (s.callsAt === undefined ? undefined : height(s.callsAt));
  const lowest = height(s.lowest ?? 0);
  const call = (c: Spec): CasperBlockCall => {
    const made = callWhole(c);
    if (c.undecoded !== true) return made;
    const { from: _, ...args } = made.args;
    return { ...made, args };
  };
  const callWhole = (c: Spec): CasperBlockCall => ({
    transaction: TX[c.tx]!,
    executed: true,
    blockHeight: callsBlock ?? null,
    error: c.error === true ? "User error: 1" : null,
    packageHash: PKG,
    entryPoint: c.entry ?? "transfer_with_authorization",
    args: {
      from: c.from === "payer" ? PAYER : c.from === "payee" ? PAYEE : OTHER,
      ...(c.entry === "cancel_authorization"
        ? {}
        : { to: c.to === "elsewhere" ? ELSEWHERE : PAYEE, value: BigInt(c.amount ?? "1"), validAfter: 0n, validBefore: VALID_BEFORE }),
      nonce: Buffer.from((c.value === "own" ? nonce : other).slice(2), "hex"),
    },
  });
  // Another account's authorization on another package under a nonce of its own: a call that carries nothing of H's.
  const filler: CasperBlockCall = {
    ...callWhole(setter),
    transaction: TX["filler"]!,
    packageHash: OTHER_PKG,
    args: { ...callWhole(setter).args, from: ELSEWHERE, nonce: Buffer.from("11".repeat(32), "hex") },
  };
  const pages: CasperBlockCall[][] = [(s.calls ?? []).map(call), ...(s.more === undefined ? [] : [s.more.map(call)])];
  if (s.overflow === true) {
    for (let i = 0; i < 7; i++) pages.push([filler]);
    pages.push(s.calls?.some((c) => c.from === "payer" && c.value === "own" && c.error !== true) === true ? [filler] : [call(setter)]);
  }
  const fail = async (): Promise<void> => {
    if (s.fault === "transport" || s.fault === "too-large") throw new ReaderError(s.fault);
  };
  return {
    network: s.fault === "chain-mismatch" ? "casper:casper" : NETWORK,
    async transaction(hash) {
      await fail();
      return pages.flat().find((c) => c.transaction === hash) ?? null;
    },
    async head() {
      await fail();
      if (s.fault === "unparseable") return { height: "1050", timestamp: 0n } as never;
      return { height: HEAD, timestamp: s.lapsed === true ? VALID_BEFORE * 1000n : (VALID_BEFORE - 600n) * 1000n };
    },
    async lowest() {
      await fail();
      return lowest;
    },
    async nonceUsed(asset, from, n, at) {
      await fail();
      if (at < lowest || at > HEAD) return null;
      const item = asset === PKG && from === PAYER && Buffer.from(n).toString("hex") === nonce.slice(2);
      return item && block !== undefined && at >= block;
    },
    async blockCalls(at, start) {
      await fail();
      if (at !== callsBlock) return { calls: [], next: null };
      return { calls: pages[start] ?? [], next: start + 1 < pages.length ? start + 1 : null };
    },
  };
}

/** The search positions the setup can leave the read at, each with the case's own name for it. */
function cursorsOf(s: Setup, c: ReadCase): [CasperCursor, unknown][] {
  const named: [CasperCursor, unknown][] = [];
  if (s.setFrom === null) {
    if (s.lapsed === true || s.resume === true) named.push([{ unset: HEAD }, c.facts.search.at]);
    return named;
  }
  const block = height(s.setFrom);
  const found = [...(s.calls ?? []), ...(s.more ?? [])].find((x) => x.from === "payer" && x.value === "own" && x.error !== true && x.undecoded !== true);
  const at = (next: number): CasperCursor => ({ unset: block - 1n, block, next, ...(found === undefined ? {} : { found: TX[found.tx]! }) });
  if (s.overflow === true) named.push([at(8), c.facts.search.at]);
  const pages = [s.calls ?? [], s.more ?? []];
  pages.forEach((page, next) =>
    page.filter((x) => x.undecoded === true).forEach((x) => named.push([at(next), c.facts.undecoded?.find((u) => u.transaction === x.tx)?.at])),
  );
  return named;
}

const json = (v: unknown): string => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}` : x));

/** The answer in the case's terms: its transaction names, positions, mark, accounts, asset and search position. */
function toCase(a: CasperStatus, c: ReadCase, s: Setup): CaseAnswer {
  const tx = (t: string): string => CASE_TX[t] ?? t;
  const at = (p: bigint): number => Number(p - BASE);
  const account = (to: string): string => (to === PAYEE ? "payee" : to === ELSEWHERE ? "elsewhere" : to);
  const moved = (m: readonly Moved[]) =>
    m.map((x) => ({
      asset: x.asset === PKG ? "A" : x.asset === OTHER_PKG ? "B" : x.asset,
      amount: x.amount,
      to: account(x.to),
      ...(x.transaction === undefined ? {} : { transaction: tx(x.transaction) }),
      ...(x.place === undefined ? {} : { place: x.place }),
    }));
  const out: Record<string, unknown> = { ...a };
  delete out["signer"];
  if ("transaction" in a && a.transaction !== undefined) out["transaction"] = tx(a.transaction);
  if ("position" in a && a.position !== undefined) out["position"] = at(a.position);
  if ("finality" in a && a.finality !== undefined) out["finality"] = "final";
  if ("moved" in a && a.moved !== undefined) out["moved"] = moved(a.moved);
  if ("search" in a) out["search"] = cursorsOf(s, c).find(([k]) => json(k) === json(a.search))?.[1] ?? a.search;
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(tx);
  out["foreign"] = a.foreign.map((f) => ({
    ...f,
    transaction: tx(f.transaction),
    ...(f.position === undefined ? {} : { position: at(f.position) }),
    ...(f.moved === undefined ? {} : { moved: moved(f.moved) }),
  }));
  return out as unknown as CaseAnswer;
}

const STATED = (why: string): string => `declared inapplicable to the read kit by the profile x402-exact-casper.md, rule 22: ${why}`;

/** The cases whose name opens with `words`, each on both acts, as one statement that they cannot arise; none is a fault. */
function opening(words: string, stated: string): Inapplicable[] {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words)).map((c) => ({ case: c.case, stated }));
  if (found.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return found;
}

const FAILED = STATED(
  "`transaction-failed` and the cases opening a failed result that consumed the value, since a failed execution leaves the nonce unset",
);
const ONE_MARK = STATED("by the case's words, since the one mark is the latest head and the read holds the nonce (rule 12)");
const HOLDS = STATED("by the case's words, since the read always holds the nonce");
const AT_HEIGHT = STATED("by the case's words, since the read takes each transaction from a block at its height (rule 15)");
const UNSET_MEETS_NONE = STATED(
  "by the case's words, since the read reads a block's transactions only once the item is set, so a nonce read unset meets no item (rules 13 and 15)",
);
const ONE_PACKAGE = STATED(
  "by the case's words, since the act asked about is the one call under the signed nonce on the option's asset package, which one act sets, and no search reaches the payer's acts in another package (rules 13 and 16)",
);

/**
 * The declarations with each case stated once on each act: a case the profile declares both by a reason and by its words
 * keeps the first statement, on the acts no earlier one names.
 */
function once(list: readonly Inapplicable[]): Inapplicable[] {
  const acts = (d: Inapplicable): readonly Act[] => d.acts ?? ["payment", "agreement"];
  const seen = new Set<string>();
  return list.flatMap((d) => {
    const left = acts(d).filter((a) => !seen.has(`${d.case}\u0000${a}`));
    for (const a of left) seen.add(`${d.case}\u0000${a}`);
    if (left.length === 0) return [];
    return [left.length === acts(d).length ? d : { ...d, acts: left }];
  });
}

/** The cases the profile declares inapplicable to the read kit, as its rule 22 states them. */
const inapplicable: Inapplicable[] = once([
  ...answering("below-mark", STATED("`below-mark`, since the family has one mark")),
  ...answering("transaction-failed", FAILED),
  ...answering("instrument-unused", STATED("`instrument-unused`, since no `failed` but `before-position` is answered (rules 13 and 16)")),
  ...answering("instrument-consumed", STATED("`instrument-consumed`, since no `failed` but `before-position` is answered (rules 13 and 16)")),
  ...answering("not-found", STATED("`not-found`, since the read always holds the nonce (rule 13)")),
  ...opening("a failed result that consumed the value", FAILED),
  ...opening("an act read at the finality asked for, below the final mark", ONE_MARK),
  ...opening("a value unconsumed at the final mark and consumed at the latest head", ONE_MARK),
  ...opening("a value whose validity passed, unconsumed at the final mark and consumed at the latest head", ONE_MARK),
  ...opening("a read that did not read the value at the latest head", ONE_MARK),
  ...opening("a read with no means to read the single-use value", HOLDS),
  ...opening("an act the read cannot place against the position given", AT_HEIGHT),
  ...opening("an item the search could not decode that gives no position", AT_HEIGHT),
  ...opening(
    "each transfer of what moved is named by its transaction and its place",
    STATED("by the case's words, since the one CEP-3009 call the act makes moves one transfer (rule 19)"),
  ),
  ...opening("a payment act carrying H that moved another asset", ONE_PACKAGE),
  ...opening("a second act of the payer that meets every test", ONE_PACKAGE),
  ...opening("instrument-live is answered before an item the search could not decode", UNSET_MEETS_NONE),
  ...opening("an item the search could not decode holds a failed answer", UNSET_MEETS_NONE),
]);

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/casper",
      arrange: (c: ReadCase, act: Act) => {
        const declared = inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
        if (declared !== undefined) return { inapplicable: declared.stated };
        const s = SETUPS[c.case];
        if (s === undefined) return { inapplicable: "no arrangement on a Casper node" };
        return {
          run: async () => {
            const agreement = await agreementValue(H);
            const nonce = act === "agreement" ? agreement : H;
            const other = act === "agreement" ? H : agreement;
            const reader = nodeOf(s, nonce, other);
            const presented = {
              from: PAYER,
              to: PAYEE,
              value: `${BigInt(presentedAmount(s)) + (s.presentedDiffers === true ? 1n : 0n)}`,
              validAfter: "0",
              validBefore: `${VALID_BEFORE}`,
              nonce,
            };
            const ref = {
              network: NETWORK,
              asset: PKG,
              from: PAYER,
              nonce,
              settleBy: Number(VALID_BEFORE),
              payee: PAYEE,
              presented,
              h: H,
            } as const;
            const others = (c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: TX[o.transaction] ?? o.transaction } : o));
            const query = {
              act,
              finality: "finalized" as const,
              ...(c.query.after === undefined ? {} : { after: height(c.query.after) }),
              ...(s.resume === true ? { search: { unset: HEAD - 10n } } : {}),
              ...(others.length === 0 ? {} : { others }),
            };
            return toCase(await exactCasper.status(ref, reader, query as never), c, s);
          },
        };
      },
    },
    inapplicable,
  },
];
