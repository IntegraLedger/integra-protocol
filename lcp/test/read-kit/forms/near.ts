// The form of `x402/exact/near`: each case of read-status.json made on a constructed NEAR ledger, read through
// `exactNear.status`, and the answer put back in the case's terms. The ledger is a constructed fixture, marked so: a
// reader whose answers take the shapes of NEAR's RPC (`EXPERIMENTAL_tx_status`, `block`, `query` `view_access_key`,
// `changes` `single_access_key_changes` and `all_access_key_changes`; https://docs.near.org/api-reference/, read
// 2026-11-16), not a recorded answer of a real endpoint. The vector file's `read` rows use the same reader.
import { readFileSync } from "node:fs";
import { ReaderError } from "../../../src/evm.js";
import {
  exactNear,
  type NearKeyChanges,
  type NearMark,
  type NearOutcome,
  type NearQuery,
  type NearReader,
  type NearRef,
  type NearStatus,
} from "../../../src/near.js";
import type { Act } from "../../../src/internal/read.js";
import type { CaseAnswer, CaseMark, CaseSeen, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS, answering } from "../harness.js";

const V = JSON.parse(readFileSync(new URL("../../../vectors/x402-exact-near.json", import.meta.url), "utf8"));

/** A constructed ledger, as JSON: heights, nonces, gas and deposits as decimal strings. */
export interface LedgerJson {
  readonly network?: string;
  readonly final: string;
  readonly latest: string;
  /** The reference's payer's key, read at each finality: its nonce, or null where the key is absent, and the block read. */
  readonly key: Readonly<Record<NearMark, { readonly nonce: string | null; readonly blockHeight: string }>>;
  readonly changes: readonly {
    readonly account: string;
    readonly height: string;
    readonly publicKey: string;
    readonly nonce: string | null;
    readonly transaction?: { readonly hash: string; readonly signer: string };
  }[];
  readonly txs: Readonly<Record<string, TxJson>>;
  /** Where the read of every key of an account stops, below the range's end. */
  readonly through?: string;
  readonly history?: "missing";
  /** `finalHeight` rejects with a transport failure or a `ReaderError` `too-large`, or answers out of form. */
  readonly reject?: "transport" | "too-large" | "unparseable";
}

/** A transaction as `txStatus` answers it, in JSON. */
export interface TxJson {
  readonly status: string;
  readonly delegate: null | {
    readonly senderId: string;
    readonly publicKey: string;
    readonly nonce: string;
    readonly maxBlockHeight: string;
    readonly receiverId: string;
    readonly actions: readonly (null | { readonly methodName: string; readonly argsBase64: string; readonly gas: string; readonly deposit: string })[];
  };
  readonly receipts: readonly { readonly id: string; readonly executor: string; readonly outcome: string; readonly height?: string }[];
}

/** The reader over a constructed ledger, for the reference's payer and key. */
export function ledgerReader(l: LedgerJson, payer: string, key: string): NearReader {
  const range = (pick: (c: LedgerJson["changes"][number]) => boolean, from: bigint, to: bigint, stop: bigint): NearKeyChanges => {
    if (l.history === "missing") return { history: "missing" };
    const through = stop < to ? (stop < from - 1n ? from - 1n : stop) : to;
    const changes = l.changes
      .filter((c) => pick(c) && BigInt(c.height) >= from && BigInt(c.height) <= through)
      .map((c) => ({
        height: BigInt(c.height),
        publicKey: c.publicKey,
        nonce: c.nonce === null ? null : BigInt(c.nonce),
        ...(c.transaction === undefined ? {} : { transaction: c.transaction }),
      }));
    return { changes, through };
  };
  return {
    network: (l.network ?? "near:testnet") as NearReader["network"],
    finalHeight: async () => {
      if (l.reject === "transport") throw new Error("connection reset");
      if (l.reject === "too-large") throw new ReaderError("too-large");
      return l.reject === "unparseable" ? ("200000050" as unknown as bigint) : BigInt(l.final);
    },
    accessKeyNonce: async (account, publicKey, finality) => {
      const k =
        account === payer && publicKey === key
          ? l.key[finality]
          : { nonce: null, blockHeight: finality === "final" ? l.final : l.latest };
      return { nonce: k.nonce === null ? null : BigInt(k.nonce), blockHeight: BigInt(k.blockHeight) };
    },
    accessKeyChanges: async (account, publicKey, from, to) =>
      range((c) => c.account === account && c.publicKey === publicKey, from, to, to),
    accountKeyChanges: async (account, from, to) =>
      range((c) => c.account === account, from, to, l.through === undefined ? to : BigInt(l.through)),
    txStatus: async (hash) => {
      const t = l.txs[hash];
      return t === undefined ? null : outcomeOf(t);
    },
  };
}

/** A transaction in JSON as `txStatus` answers it. */
export function outcomeOf(t: TxJson): NearOutcome {
  const d = t.delegate;
  return {
    status: t.status,
    delegate:
      d === null
        ? null
        : {
            ...d,
            nonce: BigInt(d.nonce),
            maxBlockHeight: BigInt(d.maxBlockHeight),
            actions: d.actions.map((a) => (a === null ? null : { ...a, gas: BigInt(a.gas), deposit: BigInt(a.deposit) })),
          },
    receipts: t.receipts.map((r) => ({
      id: r.id,
      executor: r.executor,
      outcome: r.outcome as "success" | "failure" | "pending",
      ...(r.height === undefined ? {} : { height: BigInt(r.height) }),
    })),
  };
}

// ── The cases on NEAR.

/** The reference the cases read: V2's, the delegate the vectors sign, its window ending at BASE + 60. */
export const REF: NearRef = V.V2.expectReference;
const BASE = 200_000_000n;
const SIGNED = BigInt(REF.nonce);
const PAYER = REF.payer;
const KEY = REF.publicKey;
/** Another key of the payer's account, and the keys of the payee's and of another account. */
const KEY2 = "ed25519:8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR";
const PAYEE_KEY = "ed25519:CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8";
const OTHER_KEY = "ed25519:GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq";
const OTHER = "other.testnet";
const RELAYER = "relayer.testnet";
const GAS = "30000000000000";
const LCP_H = `lcp:sha256:${REF.h}`;
const LCP_OTHER = "lcp:sha256:0xa52d159f262b2c6ddb724a61840befc36eb30c88877a4030b65cbe86298449c9";

const at = (p: number): string => (BASE + BigInt(p)).toString();
const argsOf = (receiver: string, amount: string, memo: string): string =>
  Buffer.from(JSON.stringify({ receiver_id: receiver, amount, memo }), "utf8").toString("base64");

/**
 * A case made on NEAR for the act: the ledger, the query and the names that put the answer back in the case's terms;
 * and what of the case NEAR cannot hold, as it was mapped. Each transaction of the case is a relayed delegate of its
 * signer's: the payer's with the reference's key where it consumed the single-use value, with another key of the payer's
 * where it did not; the payee's or another account's, read through the reference's hint, since the read searches the
 * payer's account alone. Every delegate of the payer's ran, and changes its key at the case's position: one with a
 * failed result is a delegate whose token receipt failed, which consumes that key's nonce, so the search reads it. A delegate not the payer's, or one the case places at or before the position given, is read through
 * the hint. The read meets one transaction outside the payer's key changes, the hint: a case that holds two is no case
 * NEAR's read can meet, and the form fails it, naming both, rather than leave one unread (never a skip). The
 * value the case reads absent is the key absent at both reads, unless a transaction of the case that succeeded consumed
 * it; one read consumed is the key's nonce at the signed one.
 */
export function onNear(c: ReadCase, act: Act): {
  ledger: LedgerJson;
  ref: NearRef;
  query: NearQuery;
  back: (a: NearStatus) => CaseAnswer;
  mapped: string[];
  /** Where the case holds what NEAR's read cannot meet, which the form fails rather than map. */
  unmet?: string;
} {
  const f = c.facts;
  const mapped: string[] = [];
  const lapsedFinal = f.value?.lapsed === true && f.value.mark === "final";
  const lapsedBelow = f.value?.lapsed === true && f.value.mark !== "final";
  const final = lapsedFinal ? 100 : 50;
  const latest = lapsedFinal ? 110 : lapsedBelow ? 70 : 55;
  const ours = f.seen.find((s) => s.consumed);
  const keyAbsent = f.value === undefined && !f.seen.some((s) => s.consumed && s.result === "succeeded");
  const consumed = !keyAbsent && (ours !== undefined || f.value?.consumed === true);
  const nonce = keyAbsent ? null : (consumed ? SIGNED : SIGNED - 1n).toString();
  // The nonce at the latest head: at the signed one where the case reads the value consumed there.
  const nonceLatest = keyAbsent ? null : (consumed || f.value?.head?.consumed === true ? SIGNED : SIGNED - 1n).toString();

  const names = new Map<string, string>();
  const tokens = new Map<string, string>();
  const receivers = new Map<string, string>();
  const changes: LedgerJson["changes"][number][] = [];
  const txs: Record<string, TxJson> = {};
  let hint: string | undefined;
  /** The case's transactions outside the payer's key changes after the position given: the read meets one, the hint. */
  const outside: string[] = [];
  const after = c.query.after;

  f.seen.forEach((s: CaseSeen, i) => {
    const hash = `T${i + 1}near`;
    names.set(hash, s.transaction);
    const usesKey = s === ours;
    if (usesKey && s.party !== "payer") mapped.push(`${s.transaction}: only the payer's own key consumes its nonce on NEAR; signed by the payer`);
    const sender = usesKey || s.party === "payer" ? PAYER : s.party === "payee" ? REF.payee : OTHER;
    const key = usesKey ? KEY : sender === PAYER ? KEY2 : sender === REF.payee ? PAYEE_KEY : OTHER_KEY;
    // A delegate of the payer's ran: one with a failed result failed in its token receipt.
    const ran = s.result === "succeeded" || s.consumed || sender === PAYER;
    const moved = s.moved?.[0];
    const token = moved === undefined || moved.asset === "A" ? REF.asset : `${moved.asset.toLowerCase()}-token.testnet`;
    if (moved !== undefined) tokens.set(token, moved.asset);
    if (s.account === "none") mapped.push(`${s.transaction}: every ft_transfer names its receiver_id on NEAR; it names another account`);
    const receiver = s.account === "payee" ? REF.payee : moved === undefined ? OTHER : `${moved.to.toLowerCase()}.testnet`;
    if (moved !== undefined) receivers.set(receiver, moved.to);
    const placed = s.position !== undefined;
    const height = placed ? at(s.position as number) : undefined;
    const byChange = sender === PAYER && ran && placed && (after === undefined || (s.position as number) > after);
    if (sender === PAYER && ran) {
      changes.push({
        account: PAYER,
        height: height ?? at(2),
        publicKey: key,
        nonce: (usesKey ? SIGNED : 7n).toString(),
        transaction: { hash, signer: RELAYER },
      });
    }
    if (!byChange) outside.push(s.transaction);
    if (!byChange && hint === undefined) hint = hash;
    const heightOf = height === undefined ? {} : { height };
    txs[hash] = {
      status: s.mark === "final" ? "FINAL" : "EXECUTED_OPTIMISTIC",
      delegate: {
        senderId: sender,
        publicKey: key,
        nonce: (usesKey ? SIGNED : 7n).toString(),
        maxBlockHeight: REF.maxBlockHeight,
        receiverId: token,
        actions: [
          {
            methodName: s.kind === "same" ? "ft_transfer" : "ft_transfer_call",
            argsBase64: argsOf(receiver, moved?.amount ?? "1000000", s.carries ? LCP_H : LCP_OTHER),
            gas: GAS,
            deposit: "1",
          },
        ],
      },
      receipts: [
        { id: `R${i + 1}a`, executor: sender, outcome: ran ? "success" : "failure", ...heightOf },
        ...(ran ? [{ id: `R${i + 1}b`, executor: token, outcome: s.result === "succeeded" ? "success" : "failure", ...heightOf }] : []),
      ],
    };
  });

  // An item the search cannot decode: a change of another key of the payer's at the block after the position it holds
  // at, carried by a transaction the reader does not know.
  (f.undecoded ?? []).forEach((u, i) => {
    const hash = `U${i + 1}near`;
    names.set(hash, u.transaction);
    changes.push({ account: PAYER, height: at((u.at ?? 0) + 1), publicKey: KEY2, nonce: "7", transaction: { hash, signer: RELAYER } });
  });

  const ledger: LedgerJson = {
    ...(f.unreadable === "chain-mismatch" ? { network: "near:mainnet" } : {}),
    final: at(final),
    latest: at(latest),
    key: { final: { nonce, blockHeight: at(final) }, optimistic: { nonce: nonceLatest, blockHeight: at(latest) } },
    changes,
    txs,
    ...(f.search.whole || f.search.at === undefined ? {} : { through: at(f.search.at) }),
    ...(f.history ? {} : { history: "missing" as const }),
    ...(f.unreadable === "transport" || f.unreadable === "too-large" || f.unreadable === "unparseable" ? { reject: f.unreadable } : {}),
  };
  const hashOf = new Map([...names].map(([h, n]) => [n, h]));
  const query: NearQuery = {
    act,
    finality: c.query.finality === "final" ? "final" : "optimistic",
    ...(after === undefined ? {} : { after: BASE + BigInt(after) }),
    ...(c.query.others === undefined
      ? {}
      : { others: c.query.others.map((o) => ("transaction" in o ? { transaction: hashOf.get(o.transaction) ?? o.transaction } : o)) }),
  };
  const ref: NearRef = hint === undefined ? REF : { ...REF, transaction: hint };
  const markOf = (tx: string | undefined, m: NearMark): CaseMark =>
    m === "final" ? "final" : (f.seen.find((s) => s.transaction === tx)?.mark ?? c.query.finality);
  const back = (a: NearStatus): CaseAnswer => {
    const named = "transaction" in a && a.transaction !== undefined ? names.get(a.transaction) ?? a.transaction : undefined;
    const out: Record<string, unknown> = { ...a, foreign: a.foreign.map((x) => ({ ...x, transaction: names.get(x.transaction) ?? x.transaction, ...(x.position === undefined ? {} : { position: Number(x.position - BASE) }) })) };
    if (named !== undefined) out["transaction"] = named;
    if ("position" in a && a.position !== undefined) out["position"] = Number(a.position - BASE);
    if ("finality" in a && a.finality !== undefined) out["finality"] = markOf(named, a.finality);
    if ("search" in a && a.search !== undefined) out["search"] = Number(a.search - BASE);
    if ("undecoded" in a && a.undecoded !== undefined) out["undecoded"] = a.undecoded.map((t) => names.get(t) ?? t);
    if ("moved" in a && a.moved !== undefined) {
      out["moved"] = a.moved.map((m) => ({ asset: tokens.get(m.asset) ?? "A", amount: m.amount, to: m.to === REF.payee ? "payee" : (receivers.get(m.to) ?? m.to) }));
    }
    return out as CaseAnswer;
  };
  const unmet =
    outside.length > 1
      ? `${c.case}: ${outside.join(" and ")} are each outside the payer's key changes, and the read meets one, the hint`
      : undefined;
  return { ledger, ref, query, back, mapped, ...(unmet === undefined ? {} : { unmet }) };
}

/** The cases the read cannot meet, each with its reason, as the profile `x402-exact-near-memo` (rule 12) states them. */
export const NOT_FOUND =
  "On `x402/exact/near`, `not-found`: the read holds the single-use value, the access key's nonce, where the key is " +
  "present at both reads, and a key absent at either read, as one the payer deleted is, leaves the value unread and is " +
  "answered `pending`, `search-incomplete`, never `not-found`, whatever the search shows: the value may have been " +
  "taken before the key went, and no state in which it may have been taken is answered `not-found`";
export const ZERO =
  "*a payment act carrying H that transferred zero* and *an act carrying H that transferred zero*: the standard token " +
  "refuses a zero `ft_transfer` (inferred from NEP-141's reference token, not yet shown by a run)";
export const ONE =
  "*each transfer of what moved is named by its transaction and its place in it*: a delegate holds one action, an " +
  "`ft_transfer`, which moves one transfer";
export const HEAD =
  "*a read that did not read the value at the latest head*: the read reads the access key's nonce and its changes to " +
  "the latest head";
export const NOPOS =
  "*an act the read cannot place against the position given* (its three cases) and *an item the search could not decode " +
  "that gives no position*: the search reads changes by block";
export const UNSHOWN =
  "while no run has shown the search over the account's access keys whole, the cases answering `instrument-unused`, " +
  "`instrument-consumed` or `transaction-failed`, each of which rests on that search";

/** The declared cases, each case and act once, under the first statement that names it. */
export const DECLARED: readonly Inapplicable[] = (() => {
  const byWords = (stated: string, ...opening: string[]): Inapplicable[] =>
    READ_STATUS.cases.filter((c) => opening.some((o) => c.case.startsWith(o))).map((c) => ({ case: c.case, stated }));
  const all: Inapplicable[] = [
    ...answering("not-found", NOT_FOUND),
    ...byWords(ZERO, "a payment act carrying H that transferred zero", "an act carrying H that transferred zero"),
    ...byWords(ONE, "each transfer of what moved is named by its transaction and its place in it"),
    ...byWords(HEAD, "a read that did not read the value at the latest head"),
    ...byWords(NOPOS, "an act the read cannot place against the position given", "an item the search could not decode that gives no position"),
    ...["instrument-unused", "instrument-consumed", "transaction-failed"].flatMap((r) => answering(r, UNSHOWN)),
  ];
  const out: Inapplicable[] = [];
  for (const d of all) {
    const taken = out.filter((o) => o.case === d.case).flatMap((o) => o.acts ?? ACTS);
    const acts = (d.acts ?? ACTS).filter((a) => !taken.includes(a));
    if (acts.length > 0) out.push({ case: d.case, ...(acts.length === ACTS.length ? {} : { acts }), stated: d.stated });
  }
  return out;
})();

/** The declaration that names the case on the act, where one does. */
export function declaredFor(c: ReadCase, act: Act): Inapplicable | undefined {
  return DECLARED.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
}

/** The case made on NEAR for the act, read through the pairing's `status`. */
export function runOnNear(c: ReadCase, act: Act): { run: () => Promise<CaseAnswer> } {
  const made = onNear(c, act);
  return {
    run: async () => {
      // Never a skip: the profile states no reason this case cannot arise.
      if (made.unmet !== undefined) throw new Error(`the case cannot be met on NEAR and the profile states no reason it cannot arise: ${made.unmet}`);
      return made.back(await exactNear.status(made.ref, ledgerReader(made.ledger, PAYER, KEY), made.query));
    },
  };
}

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/near",
      arrange: (c, act) => {
        const d = declaredFor(c, act);
        return d === undefined ? runOnNear(c, act) : { inapplicable: d.stated };
      },
    },
    inapplicable: DECLARED,
  },
];
