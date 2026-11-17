// The Hedera forms: each case of read-status.json made on a Mirror Node, its entries constructed in the shape of the
// Mirror Node REST interface's OpenAPI description 0.163.1, and run through the pairing's own `status`. A case's
// positions are consensus timestamps that many seconds after 1700000000, its one final mark the mirror's `consensus`,
// and its transactions Hedera transaction ids; the answer is put back in the case's terms. The stock session's cases
// are made on the network's JSON-RPC relay and its mirror's account and contract-result reads, from HS7's rows of
// mpp-session-hedera-solana-xrpl.json, its positions block numbers. The cases that cannot arise on these pairings are
// listed with the reason each profile states (x402-exact-hedera.md, rule 17; the session's in
// mpp-session-hedera-solana-xrpl.md, clause 1).
import { readFileSync } from "node:fs";
import {
  executorStatus,
  hederaIdDigest,
  hederaStatus,
  type HederaReader,
  type HederaRef,
  type HederaStatus,
  type MirrorEntry,
} from "../../../src/hedera.js";
import { hederaStockStatus, type HederaStockReader, type HederaStockRef, type HederaStockStatus } from "../../../src/hedera-session.js";
import type { EvmLog, EvmReceipt } from "../../../src/internal/evm.js";
import type { Act, ForeignItem } from "../../../src/internal/read.js";
import type { CaseAnswer, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, answering, READ_STATUS } from "../harness.js";

const V = JSON.parse(readFileSync(new URL("../../../vectors/x402-exact-hedera.json", import.meta.url), "utf8"));
const H_MEMO = Buffer.from(V.fixed.L, "utf8").toString("base64");
const OTHER_MEMO = Buffer.from("not this hash", "utf8").toString("base64");
const BASE = 1700000000n;
const PAYER = "0.0.5555";
const PAYEE = "0.0.1234";
const OTHER = "0.0.7777";
const ELSEWHERE = "0.0.4444";
const SETTLER = "0.0.1235";
const ID = `${SETTLER}-${BASE}-000000000`;
const TOKEN = "0.0.6000";

/** Why a case cannot be made on the mirror; the form states it, and only a declared case may be skipped. */
class Cannot extends Error {}

const ts = (p: number, nanos = 0): string => `${BASE + BigInt(p)}.${String(nanos).padStart(9, "0")}`;

/** The mapping of one case: its transactions and positions to the mirror's and back. */
class Mapping {
  readonly ids = new Map<string, string>();
  /** The case's names for the mirror's assets and credited accounts, where its transactions name them. */
  readonly names = new Map<string, string>();
  /** The case's places of its transfers, by the mirror's place `<asset>/<account>`. */
  readonly places = new Map<string, number | string>();
  private n = 0;
  idOf(name: string): string {
    let id = this.ids.get(name);
    if (id === undefined) {
      id = `${SETTLER}-${BASE - 1000n + BigInt(++this.n)}-000000000`;
      this.ids.set(name, id);
    }
    return id;
  }
  nameOf(id: string): string {
    for (const [k, v] of this.ids) if (v === id) return k;
    return id;
  }
  positionOf(t: string): number | string {
    const m = /^(\d+)\.(\d{9})$/.exec(t);
    return m === null || m[2] !== "000000000" ? t : Number(BigInt(m[1]!) - BASE);
  }
}

type Seen = ReadCase["facts"]["seen"][number];

/** A Mirror Node entry made from a case's transaction. */
function entryOf(s: Seen, id: string, memoOverride?: string, m?: Mapping): MirrorEntry {
  if (s.position === undefined) throw new Cannot("every Mirror Node entry carries its consensus timestamp");
  if (s.mark !== "final") throw new Cannot("every record the mirror serves is final");
  const signer = s.party === "payer" ? PAYER : s.party === "payee" ? PAYEE : OTHER;
  const moved = s.moved?.[0];
  if (moved !== undefined && moved.amount === "0") throw new Cannot("a transfer of zero debits no account, and the mirror lists no row for it");
  if ((s.moved?.length ?? 0) > 2) throw new Cannot("the form makes at most two transfers of one act");
  const amount = moved === undefined ? 1000 : Number(moved.amount);
  // An account's transfer to itself nets to nothing on the mirror: the payee's own act names another account.
  const credit = s.account === "payee" && signer !== PAYEE ? PAYEE : s.account === "none" ? "0.0.98" : ELSEWHERE;
  if (moved !== undefined && m !== undefined) {
    if (moved.asset !== "A" && moved.asset !== m.names.get("0.0.0") && m.names.has("0.0.0")) throw new Cannot("one asset per case");
    m.names.set("0.0.0", moved.asset);
    m.names.set(credit, moved.to);
  }
  // A second transfer of the act to the same account: the mirror holds one row per account and asset, so it is made in
  // a token, its place `<token>/<account>` (x402-exact-hedera.md, rule 14).
  const second = s.moved?.[1];
  const tokenRows =
    second === undefined || s.result !== "succeeded" || s.kind === "other"
      ? []
      : [
          { token_id: TOKEN, account: signer, amount: -Number(second.amount), is_approval: false },
          { token_id: TOKEN, account: credit, amount: Number(second.amount), is_approval: false },
        ];
  if (m !== undefined && s.moved !== undefined) {
    const tx = s.moved.map((x) => x.transaction).find((t) => t !== undefined);
    if (tx !== undefined) m.ids.set(tx, m.ids.get(tx) ?? id);
    s.moved.forEach((x, i) => x.place !== undefined && m.places.set(`${i === 0 ? "0.0.0" : TOKEN}/${credit}`, x.place));
    if (second !== undefined) m.names.set(TOKEN, second.asset);
  }
  const fee = 96926;
  const kindOther = s.kind === "other";
  const feePayer = kindOther ? signer : id.split("-")[0]!;
  const rows = [{ account: feePayer, amount: -fee, is_approval: false }];
  if (s.result === "succeeded" && !kindOther) {
    rows.push({ account: signer, amount: -amount, is_approval: false }, { account: credit, amount, is_approval: false });
  }
  rows.push({ account: "0.0.802", amount: fee, is_approval: false });
  const [, secs] = id.split("-");
  const transaction = kindOther ? `${signer}-${secs}-000000000` : id;
  if (m !== undefined && kindOther) m.ids.set(m.nameOf(id), transaction);
  return {
    transaction_id: transaction,
    name: kindOther ? "CONSENSUSSUBMITMESSAGE" : "CRYPTOTRANSFER",
    result: s.result === "succeeded" ? "SUCCESS" : "INSUFFICIENT_PAYER_BALANCE",
    nonce: 0,
    scheduled: false,
    memo_base64: memoOverride ?? (s.carries ? H_MEMO : OTHER_MEMO),
    consensus_timestamp: ts(s.position),
    valid_start_timestamp: `${secs}.000000000`,
    valid_duration_seconds: "120",
    // The body presented names 100000000; a case whose act differs from it in a member differs here.
    max_fee: s.presented === "no" ? "200000000" : "100000000",
    node: "0.0.3",
    charged_tx_fee: fee,
    transfers: rows,
    token_transfers: tokenRows,
    staking_reward_transfers: [],
    assessed_custom_fees: [],
  };
}

/** The reference of the payment presented: V2's, its transaction id the case's single-use value. */
const REF: HederaRef = { ...V.V5.reference, payer: PAYER, payee: PAYEE };

/** The answer in the case's terms: transactions by their case names, positions as integers, the one mark `final`. */
function back(answer: HederaStatus, m: Mapping): CaseAnswer {
  const out: Record<string, unknown> = { ...answer };
  if ("transaction" in answer && answer.transaction !== undefined) out["transaction"] = m.nameOf(answer.transaction);
  if ("position" in answer && answer.position !== undefined) out["position"] = m.positionOf(answer.position);
  if ("finality" in answer && answer.finality !== undefined) out["finality"] = "final";
  if ("search" in answer && answer.search !== undefined) out["search"] = m.positionOf(answer.search);
  if ("undecoded" in answer && answer.undecoded !== undefined) out["undecoded"] = answer.undecoded.map((t) => m.nameOf(t));
  if ("moved" in answer && answer.moved !== undefined) {
    out["moved"] = answer.moved.map((x) => ({
      asset: m.names.get(x.asset) ?? x.asset,
      amount: x.amount,
      to: m.names.get(x.to) ?? x.to,
      ...(x.transaction === undefined ? {} : { transaction: m.nameOf(x.transaction) }),
      ...(x.place === undefined ? {} : { place: m.places.get(String(x.place)) ?? x.place }),
    }));
  }
  out["foreign"] = answer.foreign.map((f: ForeignItem<string>) => ({ transaction: m.nameOf(f.transaction), reason: f.reason }));
  return out as unknown as CaseAnswer;
}

/** The mirror a case describes, for the x402 pairing, and the query in its terms. */
function x402Mirror(c: ReadCase, act: Act, m: Mapping): { reader: HederaReader; query: object } {
  const f = c.facts;
  const after = c.query.after;
  if (f.unreadable !== undefined) {
    if (f.unreadable === "unparseable") return { reader: readerOf({ byId: [entryOf(own(), ID, "bGNw=")] }), query: q() };
    if (f.unreadable === "too-large") return { reader: readerOf({ byId: Array(65).fill(entryOf(own(), ID)) }), query: q() };
    if (f.unreadable === "chain-mismatch") return { reader: readerOf({ byId: null }, "hedera:mainnet"), query: q() };
    if (f.unreadable === "transport") return { reader: readerOf({ byId: null, latest: "throw" }), query: q() };
    throw new Cannot("the read answers history-gap from its own reads alone");
  }
  // The chain takes one transaction under a transaction id: a case's second act that consumed the value is made as the
  // payer's act under its own id, which read-status rule 15 treats alike, being an act that meets every test.
  const consumers = f.seen.filter((s) => s.consumed);
  const under = consumers[0];
  if (f.value !== undefined) {
    if (f.value.mark !== "final") throw new Cannot("every record the mirror serves is final");
    if (f.value.consumed !== (under !== undefined)) throw new Cannot("the id is read consumed only by an entry under it, which names the transaction");
    if (f.value.head !== undefined && f.value.head.consumed !== f.value.consumed) {
      throw new Cannot("the mirror's one mark is its latest consensus timestamp: the value reads alike at the final mark and the head");
    }
  }
  if (under !== undefined) m.ids.set(under.transaction, ID);
  const lapsed = f.value === undefined ? under === undefined : f.value.lapsed;
  const page: MirrorEntry[] = [];
  for (const s of f.seen.filter((x) => x !== under)) page.push(entryOf(s, m.idOf(s.transaction), undefined, m));
  for (const u of f.undecoded ?? []) {
    const id = m.idOf(u.transaction);
    if (u.at === undefined) throw new Cannot("an entry the read cannot decode holds the search one nanosecond before its timestamp");
    page.push({ ...entryOf(own(), id, "bGNw="), consensus_timestamp: ts(u.at, 1) });
  }
  page.sort((a, b) => (a.consensus_timestamp < b.consensus_timestamp ? -1 : 1));
  const pages: ({ transactions: MirrorEntry[]; next: string | null } | "refused")[] = [];
  if (f.search.whole) pages.push({ transactions: page, next: null });
  else if (f.search.at !== undefined) {
    const filler: MirrorEntry = { ...entryOf({ ...own(), carries: false, position: f.search.at, consumed: false }, `${PAYER}-${BASE + 5000n}-000000000`) };
    pages.push({ transactions: [...page, filler], next: "more" }, "refused");
  } else pages.push("refused");
  const reader = readerOf({
    byId: under === undefined ? null : [entryOf(under, ID, undefined, m)],
    latest: lapsed ? ts(1000) : ts(100),
    oldest: f.history ? "archival" : ts((after ?? 0) + 1),
    pages,
  });
  return { reader, query: q() };

  function q(): object {
    return {
      act,
      finality: "consensus",
      ...(after === undefined ? {} : { after: ts(after) }),
      ...(c.query.search === undefined ? {} : { search: ts(c.query.search) }),
      ...(c.query.others === undefined
        ? {}
        : { others: c.query.others.map((o) => ("transaction" in o ? { transaction: m.ids.get(o.transaction) ?? m.idOf(o.transaction) } : o)) }),
    };
  }
}

function own(): Seen {
  return { transaction: "own", position: 3, mark: "final", result: "succeeded", consumed: true, carries: true, party: "payer", kind: "same", account: "payee" };
}

function readerOf(
  m: { byId: MirrorEntry[] | null; latest?: string; oldest?: string; pages?: ({ transactions: MirrorEntry[]; next: string | null } | "refused")[] },
  network = "hedera:testnet",
): HederaReader {
  let page = 0;
  return {
    network: network as HederaReader["network"],
    transactions: async () => m.byId,
    latest: async () => {
      if (m.latest === "throw") throw new Error("transport");
      return m.latest ?? ts(100);
    },
    oldest: async () => m.oldest ?? "archival",
    accountTransactions: async () => {
      const p = m.pages?.[page++];
      if (p === undefined || p === "refused") throw new Error("refused");
      return p;
    },
  };
}

/** The mirror a case describes, for the transfer-executor: the named transaction and the mirror's statements. */
async function executorRun(c: ReadCase, act: Act): Promise<CaseAnswer> {
  const m = new Mapping();
  const f = c.facts;
  const named = `0.0.9000-${BASE}-000000000`;
  const idDigest = await hederaIdDigest("0.0.5001");
  const ref = { network: "hedera:testnet" as const, asset: "0.0.0", payee: PAYEE, idDigest, settleBy: 0, transaction: named };
  const s = f.seen[0];
  let byId: MirrorEntry[] | null = null;
  if (s !== undefined) {
    m.ids.set(s.transaction, named);
    const signer = s.party === "payer" ? "0.0.5001" : s.party === "payee" ? PAYEE : OTHER;
    const e = entryOf({ ...s, party: "other" }, named);
    const rows = s.result === "succeeded" ? [
      { account: "0.0.9000", amount: -96926, is_approval: false },
      { account: signer, amount: -1000, is_approval: false },
      { account: s.account === "payee" ? PAYEE : ELSEWHERE, amount: 1000, is_approval: false },
      { account: "0.0.802", amount: 96926, is_approval: false },
    ] : e.transfers!;
    byId = [{ ...e, transfers: rows }];
  }
  const reader = readerOf({ byId, latest: ts(100), oldest: f.history ? "archival" : ts(1) });
  const query = { act, finality: "consensus", ...(c.query.after === undefined ? {} : { after: ts(c.query.after) }) };
  return back(await executorStatus(ref, reader, query as never), m);
}

/**
 * The session's rows of mpp-session-hedera-solana-xrpl.json, HS7: the opening that settles (HS3's `ChannelOpened` behind
 * the token's `Transfer`, constructed, marked so there), the revert whose sender signed the escrow's `open` (HS2's
 * calldata) with the mirror's contract result, and the recipient another address resolving to another account.
 */
const S = JSON.parse(readFileSync(new URL("../../../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
type HsRow = {
  case: string;
  reference: HederaStockRef;
  relay: { receipt: { logs: EvmLog[] } | null; transaction?: { to: string | null; input: string } };
  mirror: { accounts: Record<string, string>; contractResult?: { result: string } | null };
};
const hs = (opens: string): HsRow => {
  const found = (S.HS7.rows as HsRow[]).filter((r) => r.case.startsWith(opens));
  if (found.length !== 1) throw new Error(`HS7 has ${found.length} rows beginning "${opens}"`);
  return found[0]!;
};
const OPENED = hs("the opening's receipt holds one ChannelOpened");
const REVERTED = hs("the opening reverted, its sender having signed");
const ELSEWHERE_PAYEE = hs("the opening reverted, the open it signed naming");
const FAILED = hs("the opening failed, its sender having signed");
/** The relay's block numbers: a case's position 10 is HS7's block 40845556. */
const BLOCK = 40845546n;

/** The relay and mirror a case describes for the stock session, the reference, and the query in their terms. */
function sessionRead(c: ReadCase, act: Act): { ref: HederaStockRef; reader: HederaStockReader; query: object; m: Mapping } {
  const m = new Mapping();
  const f = c.facts;
  if ((f.undecoded ?? []).length > 0) throw new Cannot("the read makes no search and decodes no item but the receipt of the hash the credential names");
  if (f.seen.length > 1) throw new Cannot("at coverage none the read reads the one transaction the credential names");
  if (c.query.search !== undefined || c.query.others !== undefined) throw new Cannot("the read makes no search, so it takes no search position and meets no other act");
  const s = f.seen[0];
  const hash = OPENED.reference.transaction;
  if (s !== undefined) m.ids.set(s.transaction, hash);
  const accounts = { ...OPENED.mirror.accounts };
  let ref: HederaStockRef = { ...OPENED.reference };
  let receipt: EvmReceipt | null | "throw" | "unparseable" = null;
  let signed: { to: string | null; input: string } | null = null;
  let result: string | null = null;
  if (f.unreadable === "transport") receipt = "throw";
  else if (f.unreadable === "unparseable") receipt = "unparseable";
  else if (f.unreadable === "history-gap") throw new Cannot("the read answers history-gap from its own reads alone");
  else if (s !== undefined) {
    if (s.position === undefined) throw new Cannot("every receipt names its block");
    if (s.mark !== "final") throw new Cannot("every block the relay serves is final");
    if (s.party === "other") throw new Cannot("the read names the account that opened the channel and compares it with none: the caller compares it with the account that signed the agreement");
    if (f.value === undefined ? false : !f.value.consumed || f.value.lapsed || f.value.head?.consumed === false) {
      throw new Cannot("the read reads no nonce state: the receipt of the named transaction is all it reads of the opening's sender nonce");
    }
    if ((s.moved?.length ?? 0) > 1) throw new Cannot("an opening makes one deposit");
    if (s.account === "none" && s.kind === "same") throw new Cannot("an opening names its payee, in its ChannelOpened log and in the open its sender signs");
    if (s.account === "other") {
      ref = { ...ref, payee: ELSEWHERE_PAYEE.reference.payee };
      Object.assign(accounts, ELSEWHERE_PAYEE.mirror.accounts);
    }
    // The payee's own act: the log's payer resolves to the account the challenge's recipient names.
    const opener = OPENED.relay.receipt!.logs[1]!.topics[2]!;
    if (s.party === "payee") accounts[`0x${opener.slice(26)}`] = accounts[ref.payee]!;
    const block = BLOCK + BigInt(s.position);
    if (s.result === "failed") {
      receipt = { status: 0, blockNumber: block, logs: [] };
      signed = s.kind === "same" ? REVERTED.relay.transaction! : { to: ref.payee, input: "0x" };
      // A revert that consumed the value was executed in the EVM; one that did not failed with a status that comes
      // before it as well (HS7's rows, HIP-844).
      result = s.consumed ? REVERTED.mirror.contractResult!.result : FAILED.mirror.contractResult!.result;
    } else {
      const logs = OPENED.relay.receipt!.logs;
      const deposit = s.moved?.[0];
      if (deposit !== undefined) {
        m.names.set(`0x${logs[1]!.data.slice(2 + 64 * 0 + 24, 2 + 64 * 1)}`, deposit.asset);
        m.names.set(accounts[`0x${logs[1]!.topics[3]!.slice(26)}`]!, deposit.to);
        if (deposit.place !== undefined) m.places.set("1", deposit.place);
      }
      const opened: EvmLog = deposit === undefined ? logs[1]! : { ...logs[1]!, data: `0x${logs[1]!.data.slice(2, 2 + 64 * 3)}${BigInt(deposit.amount).toString(16).padStart(64, "0")}` };
      receipt = { status: 1, blockNumber: block, logs: s.kind === "same" ? [logs[0]!, opened] : [logs[0]!] };
    }
  } else if (f.value !== undefined) throw new Cannot("the read reads no nonce state: with no receipt it reads nothing consumed or lapsed");
  if (f.unreadable === "too-large") receipt = { status: 1, blockNumber: BLOCK, logs: Array(65).fill(OPENED.relay.receipt!.logs[0]!) };
  const after = c.query.after === undefined ? undefined : BLOCK + BigInt(c.query.after);
  const reader: HederaStockReader = {
    network: f.unreadable === "chain-mismatch" ? "hedera:mainnet" : ref.network,
    receipt: async () => {
      if (receipt === "throw") throw new Error("transport");
      return receipt === "unparseable" ? ({ status: 2, blockNumber: BLOCK, logs: [] } as never) : receipt;
    },
    transaction: async () => signed as never,
    account: async (address) => accounts[address.toLowerCase()] ?? null,
    contractResult: async () => result,
    // No position given: the mirror holds the blocks only where the endpoint is declared archival.
    oldestBlock: async () => (f.history ? "archival" : (after ?? BLOCK) + 2n),
  };
  return { ref, reader, query: { act, finality: "finalized", ...(after === undefined ? {} : { after }) }, m };
}

/** The session's answer in the case's terms: the hash by its case name, block numbers as the case's positions. */
function sessionBack(answer: HederaStockStatus, m: Mapping): CaseAnswer {
  const out: Record<string, unknown> = { ...answer };
  if ("transaction" in answer && answer.transaction !== undefined) out["transaction"] = m.nameOf(answer.transaction);
  if ("position" in answer && answer.position !== undefined) out["position"] = Number(answer.position - BLOCK);
  if ("finality" in answer && answer.finality !== undefined) out["finality"] = "final";
  if ("moved" in answer && answer.moved !== undefined) {
    out["moved"] = answer.moved.map((x) => ({
      asset: m.names.get(x.asset) ?? x.asset,
      amount: x.amount,
      to: m.names.get(x.to) ?? x.to,
      ...(x.transaction === undefined ? {} : { transaction: m.nameOf(x.transaction) }),
      ...(x.place === undefined ? {} : { place: m.places.get(String(x.place)) ?? x.place }),
    }));
  }
  out["foreign"] = answer.foreign.map((f) => ({ transaction: m.nameOf(f.transaction), reason: f.reason }));
  return out as unknown as CaseAnswer;
}

/**
 * What cannot arise on these pairings, each with the reason its profile states: x402-exact-hedera.md, rule 17, for the
 * charge and the transfer-executor, and mpp-session-hedera-solana-xrpl.md, clause 1, for the stock session.
 */
const BELOW = "every record the mirror serves and every block the relay serves is final (x402-exact-hedera.md, rules 11 and 17; mpp-session-hedera-solana-xrpl.md, clause 1)";
const NOT_FOUND =
  "the read holds the single-use value, the transaction id, and reads the entries under it, an id with no entry that decides being pending, instrument-live, until the lapse (x402-exact-hedera.md, rules 11 and 17)";
const ONE_MARK =
  "the mirror's one mark is its latest consensus timestamp, read first, at which the id is read (x402-exact-hedera.md, rules 11 and 17)";
const NAMES_IT = "the id is read consumed only by an entry under it, which names the transaction (x402-exact-hedera.md, rules 11 and 17)";
const HOLDS_ID = "the read holds the id (x402-exact-hedera.md, rules 9 and 17)";
const ZERO =
  "a transfer of zero debits no account and the buyer is the account the body debits (x402-exact-hedera.md, rules 8, 16 and 17)";
const BEFORE_FAILED = "the search is made only before a failed (x402-exact-hedera.md, rules 13 and 17)";
const PLACED = "every entry carries its consensus timestamp (x402-exact-hedera.md, rules 11 and 17)";
const GATE =
  "while the search proves no absence, three facts it rests on not yet shown by a run, the cases at coverage full that answer instrument-unused, instrument-consumed or transaction-failed answer search-incomplete, which the pairing's vectors hold (x402-exact-hedera.md, rules 13 and 17)";
const SESSION =
  "the session's read takes the opening by the hash its credential names, reads no nonce state, makes no search and states no lapse (mpp-session-hedera-solana-xrpl.md, clause 1)";
const SESSION_SEARCH =
  "the one case at coverage none that answers search-incomplete is a search's item it could not decode, and the session's read makes no search, decoding nothing but the receipt and the contract result of the hash its credential names (mpp-session-hedera-solana-xrpl.md, clause 1)";
const EXECUTOR =
  "the transfer-executor's read takes the transaction the facilitator names by its id, read as the charge reads its own, and makes no search (x402-exact-hedera.md, rules 15 and 17)";

/** The case of read-status.json whose name begins with `prefix`, stated on both acts. */
function stated(prefix: string, statement: string): Inapplicable {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(prefix));
  if (found.length !== 1) throw new Error(`read-status.json has ${found.length} cases beginning "${prefix}"`);
  return { case: found[0]!.case, stated: statement };
}

/** Every case of read-status.json whose name begins with `prefix`, stated on both acts. */
function statedAll(prefix: string, count: number, statement: string): Inapplicable[] {
  const found = READ_STATUS.cases.filter((c) => c.case.startsWith(prefix));
  if (found.length !== count) throw new Error(`read-status.json has ${found.length} cases beginning "${prefix}", not ${count}`);
  return found.map((c) => ({ case: c.case, stated: statement }));
}

/** `more`, less each case and act `listed` already states: a case is declared once on each act. */
function beside(listed: readonly Inapplicable[], more: readonly Inapplicable[]): Inapplicable[] {
  return more.flatMap((d) => {
    const acts = (d.acts ?? ACTS).filter((act) => !listed.some((x) => x.case === d.case && (x.acts ?? ACTS).includes(act)));
    return acts.length === 0 ? [] : [{ ...d, acts }];
  });
}

/** The charge's declarations, by reason and by the case's words, then the cases the gate holds. */
const chargeWords: Inapplicable[] = [
  ...answering("below-mark", BELOW),
  ...beside(answering("below-mark", BELOW), answering("not-found", NOT_FOUND)),
  stated("an act read at the finality asked for, below the final mark", ONE_MARK),
  stated("a value unconsumed at the final mark and consumed at the latest head", ONE_MARK),
  stated("a value whose validity passed, unconsumed at the final mark and consumed at the latest head", ONE_MARK),
  stated("a read that did not read the value at the latest head", ONE_MARK),
  stated("a value read consumed whose transaction the search has not found", NAMES_IT),
  ...statedAll("a read with no means to read the single-use value", 2, HOLDS_ID),
  stated("a payment act carrying H that transferred zero", ZERO),
  stated("an act carrying H that transferred zero", ZERO),
  stated("the settled act's answer names every foreign item", BEFORE_FAILED),
  stated("instrument-live is answered before search-incomplete", BEFORE_FAILED),
  stated("instrument-live is answered before an item the search could not decode", BEFORE_FAILED),
  ...statedAll("an act the read cannot place against the position given", 3, PLACED),
  stated("an item the search could not decode that gives no position", PLACED),
];
const charge: Inapplicable[] = [
  ...chargeWords,
  ...beside(chargeWords, [
    ...answering("instrument-unused", GATE),
    ...answering("instrument-consumed", GATE),
    ...answering("transaction-failed", GATE),
  ]).filter((d) => READ_STATUS.cases.find((c) => c.case === d.case)!.coverage === "full"),
];

/** A form that states each case its declaration names, and runs every other. */
function declared(subject: DeclaredForm["form"]["subject"], arrange: DeclaredForm["form"]["arrange"], inapplicable: readonly Inapplicable[]): DeclaredForm {
  return {
    form: {
      subject,
      arrange: (c, act) => {
        const d = inapplicable.find((x) => x.case === c.case && (x.acts === undefined || x.acts.includes(act)));
        return d === undefined ? arrange(c, act) : { inapplicable: d.stated };
      },
    },
    inapplicable,
  };
}

export const forms: readonly DeclaredForm[] = [
  declared(
    "x402/exact/hedera",
    (c, act) => {
      const m = new Mapping();
      try {
        const { reader, query } = x402Mirror(c, act, m);
        return { run: async () => back(await hederaStatus(REF, reader, query as never), m) };
      } catch (e) {
        if (e instanceof Cannot) return { inapplicable: e.message };
        throw e;
      }
    },
    charge,
  ),
  declared("x402/exact/hedera/transfer-executor", (c, act) => ({ run: () => executorRun(c, act) }), [
    ...answering("not-found", EXECUTOR),
    stated("at coverage none, a lookup read whole beside an item the search could not decode", EXECUTOR),
  ]),
  declared(
    "mpp/session/hedera/stock",
    (c, act) => {
      try {
        const { ref, reader, query, m } = sessionRead(c, act);
        return { run: async () => sessionBack(await hederaStockStatus(ref, reader, query as never), m) };
      } catch (e) {
        if (e instanceof Cannot) return { inapplicable: e.message };
        throw e;
      }
    },
    [
      ...answering("below-mark", BELOW),
      ...answering("instrument-live", SESSION),
      ...answering("instrument-unused", SESSION),
      ...answering("search-incomplete", SESSION_SEARCH),
    ],
  ),
];
