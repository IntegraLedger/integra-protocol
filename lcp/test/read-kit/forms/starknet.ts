// The read kit's form for x402/exact/starknet: each case of read-status.json arranged on a constructed Starknet node
// (the payer's outside-execution nonce, read used from one block on; the newest ACCEPTED_ON_L1 and ACCEPTED_ON_L2
// blocks with their timestamps; the asset's events as starknet_getEvents pages them; the receipts and traces) and read by
// exactStarknet.status, its answer put back in the case's terms. The case's marks map so: included and safe to
// ACCEPTED_ON_L2, final to ACCEPTED_ON_L1. A case is arranged with its facts as written, or in the ledger's own spelling
// where the rule that decides it treats the two alike, and says why; the cases the profile x402-exact-starknet.md
// declares inapplicable (rule 22) are skipped, and a case the read cannot meet that the profile does not declare runs as
// written and fails.
import { exactStarknet, type StarknetCursor, type StarknetEmittedEvent, type StarknetInvocation, type StarknetReader, type StarknetReceipt, type StarknetStatus } from "../../../src/starknet.js";
import { agreementValue, type AtrHash } from "../../../src/core.js";
import { ReaderError } from "../../../src/evm.js";
import type { Act } from "../../../src/internal/read.js";
import type { CaseAnswer, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { answering, READ_STATUS } from "../harness.js";

const NETWORK = "starknet:SN_SEPOLIA";
const ASSET = "0x512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343";
const TOKEN_B = "0x612feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343";
const PAYER = "0x3f16efeb2ae57f7d8befb03af08a3a370562dde15149c3506ac2038ffa9be24";
const PAYEE = "0x2dd1b492765c064eac4039e3841aa5f382773b598097a40073bd8b48170ab57";
const FEE = "0x5f2e02acd59f37f1e19da7ea1db6bf31d49e6e5ba66a7f1c2f0e2ba1be36f81";
const OTHER = "0xccc";
const ELSEWHERE = "0x777";
const H: AtrHash = `0x${"5a".repeat(32)}`;
const MASK = 2n ** 250n - 1n;
const SEL_TRANSFER = "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e";
const SEL_EXEC = "0x34cc13b274446654ca3233ed2c1620d4c5d1d32fd20b47146a3371064bdc57d";
const SEL_ACCOUNT = "0x15d40a3d6ca2ac30f4031e42be28da9b056fef9bb7357ac5e85627ee876e5ad";
const EV = "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";
const BEFORE = 1_790_000_300n;
const BASE = 1000n;
const FINAL = BASE + 50n;
const LATEST = BASE + 60n;
const TX: Record<string, string> = { t1: "0x4c2f9a1b", t2: "0x5d3e0a2c", a1: "0x6e4f1b3d", c1: "0x7f502c4e", u1: "0x8a1", u2: "0x8a2" };
const CASE_TX = Object.fromEntries(Object.entries(TX).map(([k, v]) => [v, k]));

/** A transaction of the node: who executed what under which of H's values, and what its receipt holds. */
interface Spec {
  readonly tx: keyof typeof TX;
  readonly pos: number;
  /** Its receipt's finality: ACCEPTED_ON_L1 (`final`) or ACCEPTED_ON_L2 (`l2`). */
  readonly mark?: "final" | "l2";
  readonly signer?: "payer" | "payee" | "other";
  readonly value?: "own" | "other";
  /** Its `Transfer`s from the signer, each at its index among the receipt's events where given. */
  readonly transfers?: readonly { readonly to: "payee" | "elsewhere"; readonly amount?: string; readonly token?: "A" | "B"; readonly index?: number }[];
  readonly reverted?: boolean;
  readonly preconfirmed?: boolean;
  /** The reference names it as the transaction a settler named. */
  readonly named?: boolean;
  /** The caller gives it by its transaction as another act under the same H. */
  readonly given?: boolean;
  /**
   * An event of the asset with the `Transfer` key in neither layout, an item the search cannot decode; read by its
   * transaction, its receipt holds that event and its trace is not well formed.
   */
  readonly neither?: boolean;
  /** Its `Execute Before` one second past the one presented. */
  readonly differs?: boolean;
}

/** A case's arrangement on the node. */
interface Setup {
  /** The case position from whose block the payer's nonce reads used; `latest` above the final block; absent never. */
  readonly consumed?: number | "latest";
  /** Whether the final block's own timestamp is at `Execute Before`. */
  readonly lapsed?: boolean;
  /** Whether the newest block's own timestamp is at `Execute Before`, the final block's being before it. */
  readonly lapsedBelow?: boolean;
  readonly txs?: readonly Spec[];
  /** Nine more events of the asset from another sender, a page each, past the eight pages a call reads. */
  readonly overflow?: boolean;
  /** The reference holds no outside execution as presented, so the read compares none: the case of a read that made no comparison. */
  readonly bare?: boolean;
  /** The node serves no state at the final block. */
  readonly stateGap?: boolean;
  readonly fault?: "transport" | "too-large" | "unparseable" | "chain-mismatch";
  /** Why the arrangement is not the case's facts as written. */
  readonly why?: string;
}

const own = (tx: Spec["tx"], pos: number, to: "payee" | "elsewhere" = "payee", amount = "1", more: Partial<Spec> = {}): Spec => ({
  tx,
  pos,
  transfers: [{ to, amount }],
  ...more,
});
const neither = (tx: Spec["tx"], pos: number): Spec => ({ tx, pos, neither: true });

// Why a case is arranged in the ledger's own spelling, by what this ledger shows.
const CONSUMES = "the payer's own execution under the act's nonce always consumes it (profile rule 16); the nearest is";

/** Each case's arrangement, by its name in read-status.json; a function where the act changes it. */
const SETUPS: Record<string, Setup | ((act: Act) => Setup)> = {
  "a payment act carrying H that transferred zero to the payee's account is the act, with what it moved": { consumed: 10, txs: [own("t1", 10, "payee", "0")] },
  "a payment act carrying H that moved another asset and amount to the payee's account is the act, with what it moved": {
    consumed: 10,
    txs: [{ tx: "t1", pos: 10, transfers: [{ to: "payee", amount: "7", token: "B" }], named: true }],
    why: "the search reads the asset's events alone, so the act that moved another token is the one the settler named",
  },
  "an act whose signed message differs in a member from the payment presented is settled all the same: presented no": {
    consumed: 10,
    txs: [own("t1", 10, "payee", "5", { differs: true })],
  },
  "a read that made no comparison with the payment presented states no presented, never yes": { consumed: 10, bare: true, txs: [own("t1", 10)] },
  "each transfer of what moved is named by its transaction and its place in it, in the pairing's own spelling": {
    consumed: 10,
    txs: [{ tx: "t1", pos: 10, transfers: [{ to: "payee", amount: "5", index: 1 }, { to: "payee", amount: "2", index: 4 }] }],
  },
  "an act carrying H that transferred to another account and consumed the single-use value: instrument-consumed for a payment, settled for an agreement": {
    consumed: 10,
    txs: [own("t1", 10, "elsewhere", "5")],
  },
  "an act carrying H that transferred zero to another account and consumed the single-use value": { consumed: 10, txs: [own("t1", 10, "elsewhere", "0")] },
  // Declared on the act payment; on the act agreement:
  "an act carrying H that names no account and consumed nothing: a foreign item for a payment, settled for an agreement": {
    consumed: 10,
    txs: [{ tx: "t1", pos: 10, transfers: [], named: true }],
    why: `${CONSUMES} its execution naming no account, which an agreement settles on`,
  },
  "an act the option's payee signed is a foreign item on either act": {
    consumed: 20,
    overflow: true,
    txs: [{ tx: "t1", pos: 10, signer: "payee", named: true }],
    why: "another account's execution is met only in a named transaction, the search being keyed on the payer's Transfers; the search has range left",
  },
  "an act carrying H under another account's signature is a foreign item": {
    consumed: 20,
    overflow: true,
    txs: [{ tx: "t1", pos: 10, signer: "other", named: true }],
    why: "another account's execution is met only in a named transaction; the search has range left",
  },
  "an act the caller gave as another act under the same H is never settled on: a foreign item where it consumed nothing": {
    consumed: 20,
    overflow: true,
    txs: [own("t1", 10, "payee", "1", { value: "other" })],
    why: `${CONSUMES} the payer's execution under H's other value, which consumes nothing of the act's`,
  },
  "an act the caller gave that consumed the single-use value: instrument-consumed, given": { consumed: 10, txs: [own("t1", 10)] },
  "an act of another pairing or kind carrying H is a foreign item": { consumed: 20, overflow: true, txs: [own("t1", 10, "payee", "1", { value: "other" })] },
  "a transaction for which two reasons hold is named by the first": {
    consumed: 20,
    overflow: true,
    txs: [{ tx: "t1", pos: 10, signer: "payee", value: "other", named: true }],
  },
  "transactions carrying H with a failed result, the payer's own and one the payee signed, are no foreign items": {
    txs: [own("t1", 10, "payee", "1", { reverted: true, named: true }), { tx: "t2", pos: 10, signer: "payee", reverted: true, given: true }],
    why: "with the nonce valid the read meets a transaction only where it is named or given (profile rule 13): the payer's REVERTED one is the settler's, the payee's REVERTED one is given by its transaction, and a transaction that did not succeed decides nothing, given or not (rules 13 and 18)",
  },
  "the settled act's answer names every foreign item beside it": {
    consumed: 10,
    txs: [own("t1", 10), { tx: "t2", pos: 10, signer: "payee", named: true }],
  },
  "an act read at the finality asked for, below the final mark, is settled at that mark": {
    consumed: "latest",
    txs: [own("t1", 10, "payee", "1", { mark: "l2" })],
  },
  "before-position is decided before any other reason, an act otherwise settled included": {
    consumed: 3,
    txs: [own("t1", 3, "payee", "1", { named: true })],
    why: "the search starts at the position given, so the act before it is the one the settler named",
  },
  "a transaction at the position given counts as before it": { consumed: 5, txs: [own("t1", 5)] },
  "a transaction that consumed the value at or before the position given answers before-position": {
    consumed: 4,
    txs: [own("t1", 4, "elsewhere", "1", { named: true })],
    why: "only the payer's own execution consumes its nonce; the nearest is the payer's execution to another account, named",
  },
  "an act after the position given is settled": { consumed: 6, txs: [own("t1", 6)] },
  "a transaction that consumed the value, read below the final mark, answers below-mark and names it": {
    consumed: "latest",
    txs: [own("t1", 10, "elsewhere", "1", { mark: "l2" })],
  },
  // Declared on the act payment; on the act agreement the payer's execution to another account is the act.
  "at coverage full, instrument-consumed waits for the search for H to be read whole": { consumed: 10, txs: [own("t1", 10, "elsewhere")] },
  "a failed result that left the value unconsumed, its validity not passed: instrument-live": { txs: [own("t1", 10, "payee", "1", { reverted: true, named: true })] },
  "a failed result that left the value unconsumed, its validity passed and the search read whole: instrument-unused": {
    lapsed: true,
    txs: [own("t1", 10, "payee", "1", { reverted: true, named: true })],
  },
  // The newest block past Execute Before and the final one not, the nonce valid at both (profile rule 14).
  "the validity passed with the value unconsumed, read below the final mark: below-mark": { lapsedBelow: true },
  "the validity passed with the value unconsumed and the search for H read whole: instrument-unused": { lapsed: true },
  "a value read consumed whose transaction the search has not found is never failed and never not-found": { consumed: 10 },
  "below-mark is answered before instrument-live": { consumed: "latest", txs: [own("t1", 10, "payee", "1", { mark: "l2" })] },
  "absence without the history shown is history-gap": { stateGap: true, why: "the read holds the nonce, so absence is never answered; the node serving no state at the final block is history-gap" },
  "a read that established nothing: transport": { fault: "transport" },
  "a read that established nothing: unparseable": { fault: "unparseable" },
  "a read that established nothing: too-large": { fault: "too-large" },
  "a read that established nothing: chain-mismatch": { fault: "chain-mismatch" },
  "a value unconsumed at the final mark and consumed at the latest head, its act not found: search-incomplete, never instrument-live": { consumed: "latest" },
  "a value whose validity passed, unconsumed at the final mark and consumed at the latest head, is not instrument-unused: search-incomplete": {
    consumed: "latest",
    lapsed: true,
  },
  "a search that met an item it cannot decode and found nothing else that decides: search-incomplete, held at that item, which it names": {
    consumed: 20,
    txs: [neither("u1", 15)],
  },
  "the answer names every item the search could not decode in its range, held at the first": { consumed: 20, txs: [neither("u1", 15), neither("u2", 16)] },
  "the search's range left to read and an item it could not decode before its end: held at the item": { consumed: 20, overflow: true, txs: [neither("u1", 15)] },
  // The read reads the transaction the caller gave, whose trace is not well formed (profile rule 13: it arises).
  "an item the caller gave by its transaction holds no search though the read cannot decode it, and is named given": {
    lapsed: true,
    txs: [neither("u1", 15)],
  },
  "an item the caller gave that the read cannot decode, beside one it did not give: held at the one not given, which alone it names": {
    consumed: 20,
    txs: [neither("u1", 15), neither("u2", 16)],
    why: "a valid nonce reports no item; the nearest reads it consumed, the search meeting both",
  },
  "an act the search found is settled, whatever items it could not decode": { consumed: 10, txs: [neither("u1", 8), own("t1", 10)] },
};

const block = (pos: number): bigint => BASE + BigInt(pos);
const felt = (v: bigint): string => `0x${v.toString(16)}`;
const account = (who: Spec["signer"]): string => (who === "payee" ? PAYEE : who === "other" ? OTHER : PAYER);
const recipient = (to: "payee" | "elsewhere"): string => (to === "payee" ? PAYEE : ELSEWHERE);
const token = (t: "A" | "B" | undefined): string => (t === "B" ? TOKEN_B : ASSET);

/** The calldata of an `execute_from_outside_v2` for a spec: `Caller`, `Nonce`, window, its calls, and a signature. */
function calldataOf(s: Spec, nonce: bigint): string[] {
  const calls = (s.transfers ?? [{ to: "payee" as const }]).flatMap((t) => [token(t.token), SEL_TRANSFER, "0x3", recipient(t.to), felt(BigInt(t.amount ?? "1")), "0x0"]);
  const count = (s.transfers ?? [{ to: "payee" }]).length;
  const signature = ["0x1", "0x1234"];
  return [FEE, felt(nonce), "0x1", felt(s.differs === true ? BEFORE + 1n : BEFORE), felt(BigInt(count)), ...calls, ...signature];
}

/** The node of a setup, for the act's nonce and H's other value. */
function nodeOf(s: Setup, nonce: bigint, other: bigint, start: bigint): { reader: StarknetReader; pageSize: number } {
  const txs = s.txs ?? [];
  const valueOf = (x: Spec): bigint => (x.value === "other" ? other : nonce);
  const usedAt = s.consumed === undefined ? undefined : s.consumed === "latest" ? FINAL + 5n : block(s.consumed);
  const events: StarknetEmittedEvent[] = [];
  for (const x of [...txs].sort((a, b) => a.pos - b.pos)) {
    if (x.neither === true) {
      events.push({ fromAddress: ASSET, keys: [EV, PAYER], data: [PAYEE, "0x1"], transaction: TX[x.tx]!, blockNumber: block(x.pos) } as StarknetEmittedEvent);
      continue;
    }
    if ((x.signer ?? "payer") !== "payer" || x.preconfirmed === true || x.reverted === true) continue;
    for (const t of x.transfers ?? []) {
      if ((t.token ?? "A") !== "A") continue;
      events.push({ fromAddress: ASSET, keys: [EV, PAYER, recipient(t.to)], data: [felt(BigInt(t.amount ?? "1")), "0x0"], transaction: TX[x.tx]!, blockNumber: block(x.pos) } as StarknetEmittedEvent);
    }
  }
  if (s.overflow === true) {
    for (let i = 0; i < 9; i++) {
      events.push({ fromAddress: ASSET, keys: [EV, ELSEWHERE, PAYEE], data: ["0x1", "0x0"], transaction: felt(0x9000n + BigInt(i)), blockNumber: BASE + 40n } as StarknetEmittedEvent);
    }
  }
  const pageSize = s.overflow === true ? 1 : 100;
  const receiptOf = (x: Spec): StarknetReceipt => {
    if (x.neither === true) {
      return { finality: "ACCEPTED_ON_L1", execution: "SUCCEEDED", blockNumber: block(x.pos), events: [{ fromAddress: ASSET, keys: [EV, PAYER], data: [PAYEE, "0x1"] }] } as never;
    }
    const out: StarknetReceipt["events"][number][] = [];
    (x.transfers ?? []).forEach((t, i) => {
      const at = t.index ?? i;
      while (out.length < at) out.push({ fromAddress: ASSET, keys: ["0x1"], data: [] } as never);
      out[at] = { fromAddress: token(t.token), keys: [EV, account(x.signer), recipient(t.to)], data: [felt(BigInt(t.amount ?? "1")), "0x0"] } as never;
    });
    return {
      finality: x.preconfirmed === true ? "PRE_CONFIRMED" : x.mark === "l2" ? "ACCEPTED_ON_L2" : "ACCEPTED_ON_L1",
      execution: x.reverted === true ? "REVERTED" : "SUCCEEDED",
      blockNumber: x.preconfirmed === true ? null : block(x.pos),
      events: x.reverted === true ? [] : out,
    };
  };
  const traceOf = (x: Spec): StarknetInvocation => {
    if (x.neither === true) return { contract: FEE, selector: "not a felt", calldata: [], reverted: false, calls: [] } as never;
    return {
      contract: FEE,
      selector: SEL_ACCOUNT,
      calldata: ["0x1"],
      reverted: false,
      calls: [
        {
          contract: account(x.signer),
          selector: SEL_EXEC,
          calldata: calldataOf(x, valueOf(x)),
          reverted: false,
          calls: (x.transfers ?? []).map((t) => ({ contract: token(t.token), selector: SEL_TRANSFER, calldata: [recipient(t.to), felt(BigInt(t.amount ?? "1")), "0x0"], reverted: false, calls: [] })),
        },
      ],
    } as never;
  };
  const find = (hash: string): Spec | undefined => txs.find((x) => BigInt(TX[x.tx]!) === BigInt(hash));
  const fail = async (): Promise<void> => {
    if (s.fault === "transport" || s.fault === "too-large") throw new ReaderError(s.fault);
  };
  void start;
  return {
    pageSize,
    reader: {
      network: s.fault === "chain-mismatch" ? "starknet:SN_MAIN" : NETWORK,
      async receipt(hash) {
        await fail();
        const x = find(hash);
        return x === undefined ? null : receiptOf(x);
      },
      async trace(hash) {
        await fail();
        const x = find(hash);
        return x === undefined ? null : traceOf(x);
      },
      async head(mark) {
        await fail();
        if (s.fault === "unparseable") return { number: "1050" } as never;
        if (mark === "ACCEPTED_ON_L2") return { number: LATEST, timestamp: s.lapsedBelow === true ? BEFORE : BEFORE - 570n };
        return { number: FINAL, timestamp: s.lapsed === true ? BEFORE : BEFORE - 600n };
      },
      async nonceValid(acct, n, at) {
        await fail();
        if (s.stateGap === true) return null;
        return !(BigInt(acct) === BigInt(PAYER) && BigInt(n) === nonce && usedAt !== undefined && at >= usedAt);
      },
      async events(q) {
        await fail();
        const all = events.filter((e) => e.blockNumber !== null && e.blockNumber >= q.from && e.blockNumber <= q.to);
        const at = q.continuation === undefined ? 0 : Number(q.continuation);
        return { events: all.slice(at, at + pageSize), continuation: at + pageSize < all.length ? String(at + pageSize) : null };
      },
    },
  };
}

/** The search positions the setup can leave the read at, each with the case's own name for it. */
function cursorsOf(s: Setup, c: ReadCase, start: bigint): [StarknetCursor, unknown][] {
  const named: [StarknetCursor, unknown][] = [];
  const to = s.consumed === "latest" ? LATEST : FINAL;
  if (s.overflow === true) named.push([{ from: start, to, continuation: "8" }, c.facts.search.at]);
  const items = [...(s.txs ?? [])].sort((a, b) => a.pos - b.pos).filter((x) => x.neither === true || ((x.signer ?? "payer") === "payer" && x.preconfirmed !== true && x.reverted !== true));
  let index = 0;
  for (const x of items) {
    if (x.neither === true) {
      const at: StarknetCursor = s.overflow === true ? { from: start, to, ...(index === 0 ? {} : { continuation: String(index) }), skip: 0 } : { from: start, to, skip: index };
      named.push([at, c.facts.undecoded?.find((u) => u.transaction === x.tx)?.at]);
      index += 1;
    } else index += (x.transfers ?? []).filter((t) => (t.token ?? "A") === "A").length;
  }
  return named;
}

const json = (v: unknown): string => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? `${x}` : x));

/** The answer in the case's terms: its transaction names, positions, marks, accounts, assets and search position. */
function toCase(a: StarknetStatus, c: ReadCase, s: Setup, start: bigint): CaseAnswer {
  const tx = (t: string): string => CASE_TX[t] ?? t;
  const at = (p: bigint): number => Number(p - BASE);
  const l2 = json(c).includes('"safe"') ? "safe" : "included";
  const mark = (m: string): string => (m === "ACCEPTED_ON_L1" ? "final" : l2);
  const who = (to: string): string => (to === PAYEE ? "payee" : to === ELSEWHERE ? "elsewhere" : to);
  const moved = (m: readonly { asset: string; amount: string; to: string; transaction?: string; place?: number | string }[]) =>
    m.map((x) => ({
      ...x,
      asset: x.asset === ASSET ? "A" : x.asset === TOKEN_B ? "B" : x.asset,
      to: who(x.to),
      ...(x.transaction === undefined ? {} : { transaction: tx(x.transaction) }),
    }));
  const out: Record<string, unknown> = { ...a };
  if ("transaction" in a && a.transaction !== undefined) out["transaction"] = tx(a.transaction);
  if ("position" in a && a.position !== undefined) out["position"] = at(a.position);
  if ("finality" in a && a.finality !== undefined) out["finality"] = mark(a.finality);
  if ("moved" in a && a.moved !== undefined) out["moved"] = moved(a.moved);
  if ("search" in a) out["search"] = cursorsOf(s, c, start).find(([k]) => json(k) === json(a.search))?.[1] ?? a.search;
  if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(tx);
  out["foreign"] = a.foreign.map((f) => ({
    ...f,
    transaction: tx(f.transaction),
    ...(f.position === undefined ? {} : { position: at(f.position) }),
    ...(f.moved === undefined ? {} : { moved: moved(f.moved) }),
  }));
  return out as unknown as CaseAnswer;
}

const STATED = (why: string): string =>
  `declared inapplicable to the read kit by the profile x402-exact-starknet.md, rule 22: ${why}`;

/**
 * The cases whose name opens with `words`, on the acts given (both where absent), as one statement that they cannot
 * arise; words that open no case are a fault.
 */
function opening(words: string, stated: string, acts?: readonly Act[]): Inapplicable[] {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(words)).map((c) => ({ case: c.case, stated, ...(acts === undefined ? {} : { acts }) }));
  if (found.length === 0) throw new Error(`no case of read-status.json opens with "${words}"`);
  return found;
}

const FAILED = STATED(
  "`transaction-failed` and the cases opening a failed result that consumed the value, since neither failed outcome consumes the nonce (rules 8 and 9)",
);
const HOLDS = STATED(
  "by the case's words, since the read holds the nonce and reads it at a final block and at the latest block (rule 14)",
);
const PLACED = STATED("by the case's words, since every event the search reads names its block (rule 15)");
const ONE_SEARCH = STATED(
  "by the case's words, since the nonce is H's low bits, or the agreement's own value's, keyed by the account alone, so its read at the final mark and at the latest head is the search for H, read whole, no search has range left, a nonce read unconsumed is read with no search and so meets no item, and every act of the payer that carries H runs under that nonce, which one act consumes (rules 14 to 16)",
);
const ONE_NONCE = STATED(
  "by the case's words, on the act payment, since every act of the payer that carries H runs under that nonce and so consumes it, and that read is the search (rules 14 and 15)",
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
  ...answering("transaction-failed", FAILED),
  ...answering("not-found", STATED("`not-found`, since the read always holds the nonce (rule 14)")),
  ...opening("a failed result that consumed the value", FAILED),
  ...opening("a read with no means to read the single-use value", HOLDS),
  ...opening("search-incomplete is answered before not-found", HOLDS),
  ...opening("a read that did not read the value at the latest head", HOLDS),
  ...opening("an act the read cannot place against the position given", PLACED),
  ...opening("an item the search could not decode that gives no position", PLACED),
  ...opening("an act found above the final head", ONE_SEARCH),
  ...opening("a search narrowed to one asset, payee or token", ONE_SEARCH),
  ...opening("the validity passed with the value unconsumed and the search for H not read whole", ONE_SEARCH),
  ...opening("instrument-live is answered before search-incomplete", ONE_SEARCH),
  ...opening("an item the search could not decode holds a failed answer", ONE_SEARCH),
  ...opening("instrument-live is answered before an item the search could not decode", ONE_SEARCH),
  ...opening("a second act of the payer that meets every test", ONE_SEARCH),
  ...opening("an act carrying H that names no account and consumed nothing", ONE_NONCE, ["payment"]),
  ...opening("at coverage full, instrument-consumed waits for the search for H", ONE_NONCE, ["payment"]),
]);

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/starknet",
      arrange: (c: ReadCase, act: Act) => {
        const declared = inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
        if (declared !== undefined) return { inapplicable: declared.stated };
        const found = SETUPS[c.case];
        if (found === undefined) return { inapplicable: "no arrangement on a Starknet node" };
        const s = typeof found === "function" ? found(act) : found;
        return {
          run: async () => {
            const own = BigInt(H) & MASK;
            const agreed = BigInt(await agreementValue(H)) & MASK;
            const nonce = act === "agreement" ? agreed : own;
            const other = act === "agreement" ? own : agreed;
            const start = c.query.after === undefined ? 0n : block(c.query.after);
            const { reader } = nodeOf(s, nonce, other, start);
            const named = (s.txs ?? []).find((x) => x.named === true);
            const act0 = (s.txs ?? []).find((x) => (x.signer ?? "payer") === "payer" && (x.value ?? "own") === "own" && x.neither !== true);
            const presentedOf = (x: Spec | undefined) => {
              const d = calldataOf(x ?? { tx: "t1", pos: 0 }, nonce);
              const calls = (x?.transfers ?? [{ to: "payee" as const }]).map((t) => ({
                to: token(t.token),
                selector: SEL_TRANSFER,
                calldata: [recipient(t.to), felt(BigInt(t.amount ?? "1")), "0x0"],
              }));
              return { caller: FEE, nonce: felt(nonce), executeAfter: "0x1", executeBefore: felt(BEFORE), calls: d.length > 0 ? calls : [] };
            };
            const ref = {
              network: NETWORK,
              from: PAYER,
              asset: ASSET,
              nonce: felt(nonce),
              payee: PAYEE,
              settleBy: Number(BEFORE),
              h: H,
              ...(s.bare === true ? {} : { presented: presentedOf(act0) }),
              ...(named === undefined ? {} : { transaction: TX[named.tx]! }),
            };
            const others = [
              ...(c.query.others ?? []).map((o) => ("transaction" in o ? { transaction: TX[o.transaction] ?? o.transaction } : o)),
              ...(s.txs ?? []).filter((x) => x.given === true).map((x) => ({ transaction: TX[x.tx]! })),
            ];
            const query = {
              act,
              finality: c.query.finality === "final" ? ("ACCEPTED_ON_L1" as const) : ("ACCEPTED_ON_L2" as const),
              ...(c.query.after === undefined ? {} : { after: block(c.query.after) }),
              ...(others.length === 0 ? {} : { others }),
            };
            return toCase(await exactStarknet.status(ref as never, reader, query as never), c, s, start);
          },
        };
      },
    },
    inapplicable,
  },
];
