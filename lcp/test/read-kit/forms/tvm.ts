// The form of x402/exact/tvm: each case of read-status.json arranged as a TON ledger (tvm-ledger.ts, a constructed
// fixture) and read through the pairing's own `status`. A transaction of the case is a transaction of the payer's W5
// wallet named as the case names it: the payer's own act is the presented request, found by its body hash, or another
// request of the wallet's key, at the signed sequence number where it consumed the value and at another where it did
// not; one signed by the payee or another account is an installed extension's actions from that account; an act of
// another kind sends a plain comment carrying H. A case whose transactions are all the payee's is read for a wallet
// that is the option's payee. The value is the W5 wallet's sequence number, read from its state; a case with no value
// is read for a wallet that is not W5, which gets no expiry read and makes no search beyond the request's body hash,
// except where the case names a transaction or an item only the search meets, or holds its search at a position, which
// a W5 wallet whose number has moved with no consumer found is read for (the answer is the same: a value consumed with
// no consumer found decides nothing a case without a value would not). A transaction another account signed that
// consumed the value is the payer's own run at the signed number, since only a run of a request the wallet's key signed
// consumes it; rule 16 decides before-position before it asks who signed (read-status rule 28: the ledger's own
// spelling). A search held at a position is a list held at a transaction the index gives without the account's states,
// and an item it could not decode that gives no position is the request itself, found by its body alone, whose
// delivery the read cannot decode. Marks: `included` and `safe` are `confirmed`, `final` is `finalized`, and each comes
// back as the case's own; positions are masterchain block sequence numbers, and a search position, a `TvmSearch`, comes
// back as the case's number of the transaction it reads next.
import { exactTvm, type TvmRef, type TvmStatus } from "../../../src/tvm.js";
import { isObject } from "../../../src/fields.js";
import type { Act, Seen } from "../../../src/internal/read.js";
import { ELSEWHERE, MASTERS, STRANGER, TVM_REF, ledgerReader, type LedgerSpec, type LedgerTx } from "../../tvm-ledger.js";
import type { Arranged, CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS } from "../harness.js";

const VU = TVM_REF.validUntil;
const STATED =
  "x402-exact-tvm.md, rule 9, declared inapplicable to the read kit: while " +
  "the expiry read releases nothing (rule 6, *Not yet shown*), the cases its gate holds";
/** The failed answers whose search rests on the expiry read, at coverage full: the cases the gate holds, on those acts. */
const GATED = new Set(["instrument-unused", "instrument-consumed", "transaction-failed"]);
const DECLARED: readonly Inapplicable[] = READ_STATUS.cases.flatMap((c): Inapplicable[] => {
  if (c.coverage !== "full") return [];
  const acts = ACTS.filter((a) => c.expect[a].state === "failed" && "reason" in c.expect[a] && GATED.has(c.expect[a].reason));
  return acts.length === 0 ? [] : [{ case: c.case, acts, stated: STATED }];
});

const tonMark = (m: CaseMark): "confirmed" | "finalized" => (m === "final" ? "finalized" : "confirmed");

/** Whether only the W5 wallet's list, the expiry read, meets the case's transaction. */
const listedOnly = (s: Seen<number, CaseMark>, payeeOnly: boolean): boolean =>
  (s.party !== "payer" && !payeeOnly) ||
  s.kind === "other" ||
  (s.result === "succeeded" && !s.consumed) ||
  s.presented === "no" ||
  s.presented === "unshown";

function txOf(s: Seen<number, CaseMark>, payeeOnly: boolean, payee: string): LedgerTx {
  const moved = s.moved?.[0];
  const base = {
    hash: s.transaction,
    mc: s.position === undefined ? null : BigInt(s.position),
    finality: s.mark === "final" ? (2 as const) : (1 as const),
    master: moved?.asset === "B" ? MASTERS.B : MASTERS.A,
    amount: moved?.amount ?? "1",
    delivery: s.result === "failed" ? ("bounced" as const) : s.account === "payee" ? ("payee" as const) : ("elsewhere" as const),
    ...(s.kind === "other" ? { sends: "comment" as const } : {}),
    ...(s.moved !== undefined && s.moved.length > 1 ? { transfers: s.moved.map((m, k) => ({ place: Number(m.place ?? k), amount: m.amount })) } : {}),
  };
  // Only a run of a request the wallet's key signed consumes the number: a consumer another account signed is the payer's.
  if (s.consumed && s.party !== "payer" && !payeeOnly) return { ...base, form: "run", seqno: TVM_REF.seqno };
  if (s.party === "other" || (s.party === "payee" && !payeeOnly)) {
    return { ...base, form: "extension", source: s.party === "payee" ? payee : STRANGER };
  }
  if (s.result === "failed" && !s.consumed) return { ...base, form: "aborted" };
  if (s.kind === "other") return { ...base, form: "run", seqno: s.consumed ? TVM_REF.seqno : 9 };
  // Another request at the signed number, whose signed part is not the presented one's, or holds an exotic cell.
  if (s.presented === "no" || s.presented === "unshown") return { ...base, form: "run", seqno: TVM_REF.seqno, exotic: s.presented === "unshown" };
  return s.consumed ? { ...base, form: "request" } : { ...base, form: "run", seqno: 9 };
}

function arrange(c: ReadCase, act: Act): Arranged | { inapplicable: string } {
  const gated = DECLARED.find((d) => d.case === c.case && (d.acts ?? ACTS).includes(act));
  if (gated !== undefined) return { inapplicable: gated.stated };
  const f = c.facts;
  const payeeOnly = f.seen.length > 0 && f.seen.every((s) => s.party === "payee");
  // The reference holds the members of the payment presented only where the case states `presented`.
  const { signedHash: _signed, ...bare } = TVM_REF;
  const held = f.seen.some((s) => s.presented !== undefined) ? TVM_REF : bare;
  const ref: TvmRef = payeeOnly ? { ...held, payee: TVM_REF.wallet } : held;
  const undecoded = f.undecoded ?? [];
  const heldAt = f.search.whole ? undefined : f.search.at;
  const w5 = f.value !== undefined || undecoded.length > 0 || heldAt !== undefined || f.seen.some((s) => listedOnly(s, payeeOnly));
  const txs: LedgerTx[] = [
    ...f.seen.map((s) => txOf(s, payeeOnly, ref.payee)),
    ...undecoded.map((u): LedgerTx =>
      u.at === undefined
        ? { hash: u.transaction, form: "request", delivery: "garbled", unlisted: true }
        : // The list is read newest first: an item at an earlier position of the case is a newer transaction.
          { hash: u.transaction, form: "undecodable", mc: 1000n - BigInt(u.at) },
    ),
  ];
  const v = f.value;
  // A value unconsumed at the final mark and consumed at the latest head: the number moved by a transaction above the
  // stated block, which the search has not found to be a run.
  const movedAbove = v !== undefined && !v.consumed && v.head?.consumed === true;
  if (movedAbove) txs.push({ hash: "above", form: "incoming", mc: 60n });
  txs.sort((a, b) => Number((b.mc ?? 1000n) - (a.mc ?? 1000n)));
  // A search held at a position: the list ends at a transaction the index gives without its states.
  if (heldAt !== undefined) txs.push({ hash: "hold", form: "incoming", mc: BigInt(heldAt), unlinked: true });
  /** The case's number of the transaction a search position reads next. */
  const numbers = new Map<string, number>([...(heldAt === undefined ? [] : [["hold", heldAt] as const]), ...undecoded.flatMap((u) => (u.at === undefined ? [] : [[u.transaction, u.at] as const]))]);
  const lapsed = v?.lapsed ?? false;
  const final = v === undefined || v.mark === "final";
  const head = lapsed ? VU + 100 : VU - 100;
  const whole = f.search.whole;
  const statedUtime = lapsed ? (final ? head : VU) : w5 || whole ? head : head - 1;
  const after = c.query.after;
  const spec: LedgerSpec = {
    ref,
    head:
      f.unreadable === "transport" ? "reject" : f.unreadable === "unparseable" ? "malformed" : f.unreadable === "too-large" ? "too-large" : head,
    ...(f.unreadable === "chain-mismatch" ? { network: "tvm:-3" } : {}),
    indexed: {
      first: f.history ? 1n : after !== undefined ? BigInt(after) + 1n : 2n,
      last: whole ? 50n : BigInt(f.search.at ?? 50),
      utime: statedUtime,
    },
    wallet: w5
      ? { status: "active", code: "w5", seqno: v !== undefined && v.head === undefined && !v.consumed ? null : v === undefined || v.consumed || movedAbove ? TVM_REF.seqno + 1 : TVM_REF.seqno }
      : { status: "active", code: "other", seqno: 0 },
    txs,
  };
  const marks = new Map(f.seen.map((s) => [s.transaction, s.mark]));
  const back = (m: string, tx?: string): CaseMark => (m === "finalized" ? "final" : (tx !== undefined ? marks.get(tx) : undefined) ?? "safe");
  const named = (to: string): string => (to === ELSEWHERE ? "elsewhere" : "payee");
  const asset = (a: string): string => (a === MASTERS.B ? "B" : "A");
  const placeOf = (p: unknown): number => Number(String(p).slice(String(p).indexOf(":t") + 2));
  const movedBack = (m: readonly { asset: string; amount: string; to: string; transaction?: string; place?: unknown }[]) =>
    m.map((x) => ({
      asset: asset(x.asset),
      amount: x.amount,
      to: named(x.to),
      ...(x.transaction === undefined ? {} : { transaction: x.transaction }),
      ...(x.place === undefined ? {} : { place: placeOf(x.place) }),
    }));
  return {
    run: async () => {
      const query = {
        act,
        finality: tonMark(c.query.finality),
        ...(after === undefined ? {} : { after: BigInt(after) }),
        ...(c.query.others === undefined ? {} : { others: c.query.others }),
      };
      const a = (await exactTvm.status(ref, ledgerReader(spec), query as never)) as TvmStatus & Record<string, unknown>;
      const { signer: _s, ...rest } = a as Record<string, unknown>;
      const out: Record<string, unknown> = { ...rest };
      if (typeof a["finality"] === "string") out["finality"] = back(a["finality"], a["transaction"] as string | undefined);
      if (typeof a["position"] === "bigint") out["position"] = Number(a["position"]);
      if (isObject(a["search"])) out["search"] = numbers.get((a["search"] as { next: { hash: string } }).next.hash) ?? a["search"];
      if (Array.isArray(a["undecoded"])) out["undecoded"] = a["undecoded"];
      if (Array.isArray(a["moved"])) out["moved"] = movedBack(a["moved"] as never);
      out["foreign"] = a.foreign.map((x) => ({
        transaction: x.transaction,
        reason: x.reason,
        ...(x.position === undefined ? {} : { position: Number(x.position) }),
        ...(x.moved === undefined ? {} : { moved: movedBack(x.moved) }),
      }));
      return out as unknown as CaseAnswer;
    },
  };
}

export const forms: readonly DeclaredForm[] = [
  { form: { subject: "x402/exact/tvm", arrange }, inapplicable: DECLARED },
];
