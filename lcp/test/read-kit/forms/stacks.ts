// The read kit's form for mpp/charge/usdc/stacks: each case of read-status.json made on a constructed Stacks API ledger
// (../../stacks-ledger.ts) and run through the pairing's own `status`, its answer put back in the case's terms.
//
// How a case's facts become the ledger. The origin signs nonce n0 (2, or 50 where the value is unconsumed and the
// search is not read whole, so that the nonces below it outrun one read's search). The origin's other nonces hold
// fillers: contract calls that carry no H and move nothing. A case transaction of the payer that consumed the value is
// the origin's at n0; one that consumed nothing is the origin's at n0 + 1, or, with a failed result, a skipped one at
// n0; one the payee or another account signed is theirs, met as the reference's transaction, the hint the read takes
// first. Only the origin's own transaction consumes its nonce, so one another account signed that consumed the value
// is the origin's (case "a transaction that consumed the value at or before the position given"), and so is a second
// one that consumed it, at another nonce, since two that decide at one nonce are an answer no chain gives (case "a
// second act of the payer that meets every test", whose rule 21 asks nothing of the nonce). It carries H in the
// pairing's form (`transfer` with `(some H)`) or, for another kind, as an argument of another function; its account is
// the recipient of its token's transfer events, and of a failed one, which moved nothing, its recipient argument; a failed result is `abort_by_response`; a final mark is a block at or
// below `finalThrough`; a position p is block 1000 + p, and none an unanchored transaction. A value consumed with no
// case transaction at n0 leaves n0 empty under a filler at n0 + 1; a value unconsumed has the fillers stop below n0.
// A search not read whole has the origin's nonces run 44 past where the search starts, and an item it cannot decode is
// a lookup result whose transaction the API answers out of form. The answer's block heights, nonces, transactions,
// marks and transfers map back to the case's names.
import { createHash } from "node:crypto";
import { principalCV, serializeCV } from "@stacks/transactions";
import { readFileSync } from "node:fs";
import type { Hex } from "../../../src/evm-abi.js";
import { MAX_SEARCH_NONCES, stacksStatus, type StacksLanded, type StacksMark, type StacksQuery } from "../../../src/stacks.js";
import type { Act, ForeignItem, Moved, OtherAct, Seen } from "../../../src/internal/read.js";
import { ftEvent, ledgerReader, type Fault, type Ledger } from "../../stacks-ledger.js";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS } from "../harness.js";

const NETWORK = "stacks:2147483648" as const;
const ORIGIN = "ST1THWXQ8368SDN2MJGE4BMDKMCHZ2GSVTSQDA7QF";
const PAYEE = "ST3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8NQXMNRQ";
const OTHER = "ST3AZN3BSQYJ5VWMNG92N88Z4G9498VYSHDZD9EK";
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" as const;
const TOKEN = { A: ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx", "usdcx-token"], B: ["ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.other", "coin"] } as const;
const BASE = 1000n;
const SPAN = 44n;
const MEMO = `0x0a0200000020${H.slice(2)}` as Hex;

/** M4's signed transfer and the same transfer signed again with another fee (mpp-charge-usdc-stacks.json, M4 and M4s). */
const V = JSON.parse(readFileSync(new URL("../../../vectors/mpp-charge-usdc-stacks.json", import.meta.url), "utf8"));
const bytes = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));
const SIGNED = {
  digest: V.M4.expectReference.signed as Hex,
  yes: { txid: V.M4.expectTxid as Hex, raw: bytes(V.M4.wireHex) },
  no: { txid: V.M4s.otherFee.txid as Hex, raw: bytes(V.M4s.otherFee.wireHex) },
};

const idOf = (label: string): Hex => `0x${createHash("sha256").update(`stacks read kit ${label}`).digest("hex")}`;

/** The account and its name in the cases: the payee, another account (`elsewhere`). */
const ACCOUNT: Record<string, string> = { payee: PAYEE, elsewhere: OTHER };

function call(contract: string, functionName: string, args: Hex[]): StacksLanded["call"] {
  return { contractId: contract, functionName, args };
}

function filler(nonce: bigint, height: bigint): StacksLanded {
  return landed(idOf(`filler ${nonce}`), ORIGIN, nonce, height, "success", call(TOKEN.A[0], "ping", ["0x09"]), []);
}

function landed(
  txid: Hex,
  sender: string,
  nonce: bigint,
  height: bigint,
  status: StacksLanded["status"],
  c: StacksLanded["call"],
  events: StacksLanded["events"],
  unanchored = false,
): StacksLanded {
  return {
    mined: true,
    txid,
    canonical: true,
    unanchored,
    status,
    sender: { address: sender, nonce },
    sponsor: null,
    blockHeight: height,
    call: c,
    transfer: null,
    events,
    raw: null,
  };
}

/** The case transaction as a ledger transaction, at the nonce and height the form gives it. */
function caseTx(s: Seen<number, CaseMark>, nonce: bigint, height: bigint): StacksLanded {
  const sender = s.consumed || s.party === "payer" ? ORIGIN : s.party === "payee" ? PAYEE : OTHER;
  const moved: readonly Moved[] =
    s.moved ?? (s.account === "none" ? [] : [{ asset: "A", amount: "1", to: s.account === "payee" ? "payee" : "elsewhere" }]);
  const token = TOKEN[(moved[0]?.asset ?? "A") as "A" | "B"];
  const events = moved.map((m, i) => {
    const [contract, name] = TOKEN[m.asset as "A" | "B"];
    return ftEvent(typeof m.place === "number" ? m.place : i, contract, name, sender, ACCOUNT[m.to]!, BigInt(m.amount));
  });
  const memo = s.carries ? MEMO : ("0x09" as Hex);
  // The recipient argument names the account a failed transfer, which moved nothing, would have paid.
  const named = s.account === "none" ? "0x0500" : (`0x${serializeCV(principalCV(s.account === "payee" ? PAYEE : OTHER))}` as Hex);
  const c = s.kind === "same" ? call(token[0], "transfer", ["0x0100", "0x0500", named, memo]) : call(token[0], "transfer-many", [memo]);
  const status = s.result === "succeeded" ? "success" : s.consumed ? "abort_by_response" : "problematic_skipped";
  const t = landed(idOf(s.transaction), sender, nonce, height, status, c, events, s.position === undefined);
  // The presented payment is M4's signed transfer: `yes` lands its bytes, `no` another body its origin signed.
  if (s.presented === "yes") return { ...t, txid: SIGNED.yes.txid, raw: SIGNED.yes.raw };
  if (s.presented === "no") return { ...t, txid: SIGNED.no.txid, raw: SIGNED.no.raw };
  return t;
}

/** The case's ledger, reference and query, and the maps that put an answer back in the case's terms. */
function arrange(c: ReadCase, act: Act) {
  const f = c.facts;
  const unconsumed = f.value !== undefined && !f.value.consumed && f.value.head?.consumed !== true;
  const n0 = unconsumed && !f.search.whole ? 50n : 2n;
  const finalMark = (m: CaseMark) => m === "final";
  const heightOf = (s: Seen<number, CaseMark>) => BASE + BigInt(s.position ?? 10);
  const nonFinal = f.seen.filter((s) => !finalMark(s.mark)).map(heightOf);
  const finalThrough = nonFinal.length > 0 ? nonFinal.reduce((a, b) => (a < b ? a : b)) - 1n : BASE + 500n;
  const txs: StacksLanded[] = [];
  const names = new Map<string, string>();
  let hint: Hex | undefined;
  let atN0 = false;
  let others = n0 + 1n;
  let consumedAtN0 = false;
  for (const s of f.seen) {
    // One transaction at a nonce: a second that consumed the value is the payer's at another nonce (rule 21's spelling).
    const second = s.consumed && consumedAtN0;
    const atOwn = !second && (s.consumed || (s.party === "payer" && s.result === "failed"));
    if (atOwn && s.consumed) consumedAtN0 = true;
    const ownNonce = atOwn ? n0 : s.party === "payer" || second ? others++ : 0n;
    const t = caseTx(s, ownNonce, heightOf(s));
    names.set(t.txid, s.transaction);
    txs.push(t);
    if (atOwn) atN0 = true;
    if (t.sender.address !== ORIGIN) hint ??= t.txid;
    else if (s.party !== "payer" && !s.consumed) hint ??= t.txid;
  }
  // The origin's nonces: fillers below n0, n0 where no case transaction holds it, and after it as the case asks.
  const consumed = f.value === undefined ? true : f.value.consumed || f.value.head?.consumed === true;
  const searchStart = 0n;
  let top = consumed ? (atN0 ? n0 : n0 + 1n) : n0 - 1n;
  for (const t of txs) if (t.sender.address === ORIGIN && t.status !== "problematic_skipped" && t.sender.nonce > top) top = t.sender.nonce;
  if (!f.search.whole && consumed) top = searchStart + SPAN;
  const undecoded = f.undecoded ?? [];
  const faults = new Map<string, Fault>();
  const nonces = new Map<bigint, number>();
  undecoded.forEach((u, i) => {
    const nonce = consumed ? n0 + 1n + BigInt(i) : BigInt(i);
    if (nonce > top) top = nonce;
    const txid = idOf(u.transaction);
    txs.push({ ...filler(nonce, BASE + 1n), txid });
    faults.set(txid, { answer: { mined: true, status: "success" } });
    names.set(txid, u.transaction);
    if (u.at !== undefined) nonces.set(nonce, u.at);
  });
  const taken = new Set(txs.filter((t) => t.sender.address === ORIGIN && t.status !== "problematic_skipped").map((t) => t.sender.nonce));
  for (let n = 0n; n <= top; n++) {
    if (taken.has(n) || (n === n0 && consumed && !atN0)) continue;
    if (n === n0 && !consumed) continue;
    txs.push(filler(n, n < n0 ? BASE + 1n : BASE + 400n + n));
  }
  if (!f.search.whole && f.search.at !== undefined) {
    // The 33rd nonce the search would read: where one read of MAX_SEARCH_NONCES stops.
    const read: bigint[] = [];
    for (let n = searchStart; read.length <= MAX_SEARCH_NONCES; n++) if (!(n === n0 && consumed)) read.push(n);
    nonces.set(read[MAX_SEARCH_NONCES]!, f.search.at);
  }
  const ledger: Ledger = {
    network: NETWORK,
    txs,
    tipHeight: BASE + 1000n,
    finalThrough,
  };
  if (f.unreadable === "transport") ledger.faults = { tip: { kind: "transport" } };
  if (f.unreadable === "too-large") ledger.faults = { tip: { kind: "too-large" } };
  if (f.unreadable === "unparseable") ledger.faults = { tip: { answer: { height: "1" } } };
  if (f.unreadable === "history-gap" || (!f.history && f.value === undefined)) ledger.unknownHeights = [ledger.tipHeight];
  const reader = ledgerReader(ledger);
  const answerFor = reader.transaction.bind(reader);
  reader.transaction = async (txid: Hex) => {
    const fault = faults.get(txid.toLowerCase());
    if (fault !== undefined && "answer" in fault) return fault.answer as never;
    return answerFor(txid);
  };
  if (f.unreadable === "chain-mismatch") (reader as { network: string }).network = "stacks:1";
  const ref = {
    network: NETWORK,
    payee: PAYEE,
    origin: ORIGIN,
    nonce: n0.toString(),
    // The read compares the act with the payment presented only where the reference holds what the origin signed.
    ...(f.seen.some((s) => s.presented !== undefined) ? { signed: SIGNED.digest } : {}),
    h: H,
    ...(hint === undefined ? {} : { transaction: hint }),
  };
  const nonFinalCaseMark = (f.seen.find((s) => !finalMark(s.mark))?.mark ?? (f.value && !finalMark(f.value.mark) ? f.value.mark : "safe")) as CaseMark;
  const toMark = (m: CaseMark): StacksMark => (m === "final" ? "bitcoin" : "block");
  const fromMark = (m: StacksMark): CaseMark => (m === "bitcoin" ? "final" : c.query.finality !== "final" ? c.query.finality : nonFinalCaseMark);
  const txOf = (name: string): Hex => idOf(name);
  const query: StacksQuery = {
    act,
    finality: toMark(c.query.finality),
    ...(c.query.after === undefined ? {} : { after: BASE + BigInt(c.query.after) }),
    ...(c.query.others === undefined
      ? {}
      : { others: c.query.others.map((o): OtherAct<never> => ("transaction" in o ? { transaction: txOf(o.transaction) } : o)) }),
  };
  const nameOf = (txid: string) => names.get(txid) ?? txid;
  const back = (a: Awaited<ReturnType<typeof stacksStatus>>): CaseAnswer => {
    const out: Record<string, unknown> = { ...a };
    delete out["signer"];
    if ("transaction" in a && a.transaction !== undefined) out["transaction"] = nameOf(a.transaction);
    if ("position" in a && a.position !== undefined) out["position"] = Number(a.position - BASE);
    if ("finality" in a && a.finality !== undefined) out["finality"] = fromMark(a.finality);
    if ("search" in a && a.search !== undefined) out["search"] = nonces.get(a.search) ?? `nonce ${a.search}`;
    if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map(nameOf);
    if ("moved" in a && a.moved !== undefined) out["moved"] = a.moved.map((m) => movedBack(m, nameOf));
    out["foreign"] = a.foreign.map((x: ForeignItem<bigint>) => ({
      ...x,
      transaction: nameOf(x.transaction),
      ...(x.position === undefined ? {} : { position: Number(x.position - BASE) }),
      ...(x.moved === undefined ? {} : { moved: x.moved.map((m) => movedBack(m, nameOf)) }),
    }));
    return out as unknown as CaseAnswer;
  };
  return { run: async () => back(await stacksStatus(ref, reader, query)) };
}

/** A transfer in the cases' terms: its asset, account and transaction by their names, its place as it is. */
function movedBack(m: Moved, nameOf: (txid: string) => string): Moved {
  const asset = m.asset === `${TOKEN.A[0]}::${TOKEN.A[1]}` ? "A" : m.asset === `${TOKEN.B[0]}::${TOKEN.B[1]}` ? "B" : m.asset;
  const to = m.to === PAYEE ? "payee" : m.to === OTHER ? "elsewhere" : m.to;
  return { asset, amount: m.amount, to, ...(m.transaction === undefined ? {} : { transaction: nameOf(m.transaction) }), ...(m.place === undefined ? {} : { place: m.place }) };
}

const RULE_16 = "mpp-charge-usdc-stacks.md rule 16, transcribing the chain entry `stacks`, Marks: Declared inapplicable to the read kit";
const NO_EXPIRY = `${RULE_16}: every case that reads the value with its validity passed, since a Stacks transaction has no expiry`;
const HOLDS_THE_NONCE =
  `${RULE_16}: *a read with no means to read the single-use value*, *search-incomplete is answered before not-found* and ` +
  "*a read that did not read the value at the latest head*, since the read holds the nonce and reads it at the latest head's height";
const NOT_FOUND =
  `${RULE_16}: \`not-found\`, since the read holds the single-use value, the origin's nonce, and answers it unconsumed ` +
  "`pending`, `instrument-live`, and consumed with its transaction not found `pending`, `search-incomplete`";

/** The cases the entry names by their words, each by the opening words of its text. */
const BY_WORDS = [
  "a read with no means to read the single-use value",
  "search-incomplete is answered before not-found",
  "a read that did not read the value at the latest head",
];

/**
 * The cases the profile states cannot arise on this ledger, each under the first statement that takes it: every case
 * whose facts give a value whose validity passed; the three the entry names by their words; and, by its reason, every
 * other case whose answer is `not-found`. (`instrument-unused`, by its reason, takes no case the first does not.)
 */
export const STACKS_INAPPLICABLE: readonly Inapplicable[] = READ_STATUS.cases.flatMap((c): Inapplicable[] => {
  if (c.facts.value?.lapsed === true) return [{ case: c.case, stated: NO_EXPIRY }];
  if (BY_WORDS.some((w) => c.case.startsWith(w))) return [{ case: c.case, stated: HOLDS_THE_NONCE }];
  const acts = ACTS.filter((a) => "reason" in c.expect[a] && c.expect[a].reason === "not-found");
  if (acts.length > 0) return [{ case: c.case, acts, stated: NOT_FOUND }];
  return [];
});

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "mpp/charge/usdc/stacks",
      arrange: (c, act) => {
        const stated = STACKS_INAPPLICABLE.find((d) => d.case === c.case && (d.acts ?? ACTS).includes(act));
        if (stated !== undefined) return { inapplicable: stated.stated };
        return arrange(c, act);
      },
    },
    inapplicable: STACKS_INAPPLICABLE,
  },
];
