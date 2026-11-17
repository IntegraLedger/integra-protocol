// The read kit's forms for the Cardano pairings: each case of read-status.json made on a constructed Cardano ledger
// (test/cardano-world.ts, every answer constructed and marked so) and read through the pairing's own `status`.
//
// The mapping. Marks are counts of confirmations under a security parameter of 10: `included` 0, `safe` 5, `final` 10.
// A case's position p is the height 1000 + p, and the tip the lowest height that gives each transaction its mark. The
// single-use value is the input the reference names, held by the payer. A transaction that consumed it is the one the
// endpoint names as its spender (a second one is listed with an input of its own); a transaction that failed and
// consumed it takes it as collateral; the others are listed among the payer's credential's transactions, each spending
// an input of the account the case names as its signer, paying the payee's credential, another one, or only the
// payer's own (an act that names no account), and carrying H or another hash. An act of another kind holds a Masumi
// escrow datum where the pairing is the address method, and none where it is the lock. A search not read whole is an
// endpoint that names, before its page, a height below the tip, whose height maps back to the case's position. A
// value the case reads as passed is a TTL at or before the slot of the block 10 below the tip, or past the tip's own
// slot for one read below the final mark. A case that reads no value is an input the endpoint documents as absent,
// where nothing else the case holds needs the search, which runs only over the payer's credential; elsewhere the input
// is read, consumed where an act consumed it, and its TTL passed, so that the answer turns on what the case's does.
// Each transfer a case names by its place is an output at that index of the body, the others paying the payer's own
// credential. The reference names the act's own body where the case's act states presented `yes`, and another body
// otherwise; Cardano's read states `presented` on every settled answer, the body's id being its digest.
//
// The lock pairing runs each case under both its methods. On the Masumi lock the payee is the seller, a deposit into
// the reference's escrow naming it by its datum. On the `script` lock the payee is `payTo`, a script's address, which
// an act pays by a deposit with an inline datum, and which signs by an input it holds; there every act is of its kind (the
// profile's rule 15), so a case holding an act of another kind runs on the Masumi lock alone, and every other case runs on both,
// each answer held to the case's.
//
// The cases the reads cannot meet, which the form skips, each with its reason as the profile's read-kit statement gives
// it: the two zero-transfer cases, the undecodable item that gives no position, and, while no run has shown a listing
// whole, every case whose answer on the act is `instrument-unused`, `instrument-consumed` or `transaction-failed`, each
// of which rests on that search. Through the read each of those answers `pending`, `search-incomplete`
// (test/cardano.test.ts holds it).
import type { AtrHash } from "../../../src/core.js";
import { exactCardano, exactCardanoLock, type CardanoRef } from "../../../src/cardano.js";
import type { Act, Seen } from "../../../src/internal/read.js";
import {
  REF_INPUT,
  addressOf,
  bech,
  credOf,
  inputN,
  masumiDatum,
  CRED,
  readerOf,
  refFor,
  txOf,
  type LedgerTx,
  type TxSpec,
  type Who,
  type World,
} from "../../cardano-world.js";
import { expect } from "vitest";
import type { CaseAnswer, CaseMark, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS, answering } from "../harness.js";

const H = `0x${"ab".repeat(32)}` as AtrHash;
const BASE = 1000n;
const K = 10n;
/** The native token that stands for any asset other than the case's `A`, which is lovelace. */
const TOKEN = "ff".repeat(28);
const CONF: Record<CaseMark, bigint> = { included: 0n, safe: 5n, final: K };
const markOf = (conf: bigint): CaseMark => (conf >= K ? "final" : conf >= 5n ? "safe" : "included");

/** The case made on a Cardano ledger for the act, read through the pairing's `status`. */
export function arrangeOn(method: CardanoRef["method"], c: ReadCase, act: Act): { run: () => Promise<CaseAnswer> } {
  const status = method === "default" ? exactCardano.status : exactCardanoLock.status;
  // The option's payee: on the `script` lock its `payTo`, a script's address, paid by a deposit carrying the inline
  // datum the option's `extra.datum` names (x402's Cardano scheme, the script method), a contract's own.
  const PAYEE: Who = method === "script" ? "escrow" : "payee";
  const deposit = method === "script" ? { datum: [42] } : {};
  const f = c.facts;
  const seen = f.seen as readonly Seen<number, CaseMark>[];
  const heightOf = (s: Seen<number, CaseMark>): bigint => BASE + BigInt(s.position ?? 0);
  let tip = BASE + 50n;
  if (seen.length > 0) tip = seen.reduce((t, s) => (heightOf(s) + CONF[s.mark] > t ? heightOf(s) + CONF[s.mark] : t), 0n);
  const own: World["txs"] = new Map();
  const ids = new Map<string, `0x${string}`>();
  const undecoded = f.undecoded ?? [];
  const valueRead = !(
    f.value === undefined &&
    undecoded.length === 0 &&
    (seen.length === 0 ? f.search.whole : seen.length === 1 && seen[0]!.result === "failed")
  );
  const spender = seen.find((s) => s.consumed);
  let ownId: `0x${string}` | undefined;
  const listed: World["listed"] = [];
  seen.forEach((s, n) => {
    const holder: Who = s.party === "payee" ? PAYEE : s.party;
    const isSpender = s === spender;
    const inputs = isSpender ? [REF_INPUT, inputN(n + 1)] : [inputN(n + 1)];
    const outputs: TxSpec["outputs"] = [];
    const coin = BigInt(s.moved?.[0]?.amount ?? "1");
    const asset = s.moved?.[0]?.asset;
    const value = asset !== undefined && asset !== "A" ? { coin: 0n, token: [TOKEN, coin] as [string, bigint] } : { coin };
    const lockOut = (seller: Uint8Array | "undecodable") => ({
      to: "escrow" as const,
      ...value,
      datum: seller === "undecodable" ? ("undecodable" as const) : masumiDatum(seller),
    });
    const sameKindLock = method === "masumi" ? s.kind === "same" : s.kind === "other";
    const placed = (s.moved ?? []).filter((m) => m.place !== undefined);
    if (placed.length > 0) {
      // Each transfer at the output its place names; the others pay the payer's own credential.
      const last = Math.max(...placed.map((m) => Number(m.place)));
      for (let i = 0; i <= last; i++) {
        const m = placed.find((x) => Number(x.place) === i);
        const amount = BigInt(m?.amount ?? "5");
        if (m === undefined) outputs.push({ to: "payer", coin: amount });
        else if (method === "masumi" && sameKindLock) outputs.push({ to: "escrow", coin: amount, datum: masumiDatum(CRED.payee) });
        else outputs.push(m.to === "payee" ? { to: PAYEE, coin: amount, ...deposit } : { to: "other", coin: amount });
      }
    } else if (method === "masumi" && sameKindLock) {
      outputs.push(lockOut(s.account === "payee" ? CRED.payee : s.account === "other" ? CRED.other : "undecodable"));
    } else {
      if (s.account === "payee") outputs.push({ to: PAYEE, ...value, ...deposit });
      if (s.account === "other") outputs.push({ to: "other", coin });
      if (sameKindLock) outputs.push(lockOut(CRED.other));
    }
    outputs.push({ to: "payer", coin: 5n });
    const tx = txOf({
      inputs,
      ...(isSpender && s.result === "failed" ? { collateral: [REF_INPUT] } : {}),
      outputs,
      ...(s.carries ? { h: H } : {}),
      valid: s.result === "succeeded",
    });
    ids.set(s.transaction, tx.id);
    const ledger: LedgerTx = {
      bytes: tx.bytes,
      height: heightOf(s),
      valid: s.result === "succeeded",
      holders: inputs.map((i) => (i === REF_INPUT ? "payer" : holder)),
    };
    if (s.position !== undefined) own.set(tx.id, ledger);
    if (!valueRead) ownId = tx.id;
    else if (!isSpender && s.position !== undefined) listed.push({ txId: tx.id, blockHeight: ledger.height });
  });
  // An item the search cannot decode: listed bytes that are no transaction, one block above the position it holds at.
  undecoded.forEach((u, n) => {
    const id = `0x${(n + 1).toString(16).padStart(2, "0").repeat(32)}` as `0x${string}`;
    const height = BASE + BigInt(u.at ?? 0) + 1n;
    ids.set(u.transaction, id);
    own.set(id, { bytes: Uint8Array.from([0x80]), height, valid: true, holders: [] });
    listed.push({ txId: id, blockHeight: height });
  });
  listed.sort((a, b) => (a.blockHeight < b.blockHeight ? -1 : a.blockHeight > b.blockHeight ? 1 : a.txId < b.txId ? -1 : 1));
  const presented = txOf({ inputs: [REF_INPUT], outputs: [{ to: "payee", coin: 1n }], h: H, ttl: 1n });
  const passed = f.value === undefined ? true : f.value.lapsed;
  const ttl = !passed ? (tip + 100n) * 20n : f.value !== undefined && f.value.mark !== "final" ? tip * 20n : (tip - K) * 20n;
  // The act whose case states presented `yes` is the body the reference names.
  const shown = seen.find((s) => s.presented === "yes");
  const ref = refFor(ownId ?? (shown === undefined ? presented.id : ids.get(shown.transaction)!), H, method, ttl);
  const consumed = spender !== undefined || f.value?.consumed === true || f.value?.head?.consumed === true;
  const world: World = {
    k: K,
    tip,
    held: BASE - 100n,
    genesis: f.history,
    txs: own,
    output: valueRead
      ? {
          address: bech(addressOf("payer")),
          ...(consumed ? { spentBy: spender === undefined ? null : ids.get(spender.transaction)! } : {}),
          // An indexer that held the tip when it answered, unless the case reads the value at the final mark alone.
          ...(f.value !== undefined && f.value.head === undefined ? {} : { slot: tip * 20n }),
        }
      : { notFound: true },
    listed,
    through: f.search.whole ? tip : tip - 1n,
    ...(f.unreadable === "transport" ? { fail: "transport" as const } : {}),
    ...(f.unreadable === "too-large" ? { fail: "too-large" as const } : {}),
    ...(f.unreadable === "unparseable" ? { fail: "malformed" as const } : {}),
    ...(f.unreadable === "chain-mismatch" ? { network: "cardano:preview" as const } : {}),
  };
  if (method === "script") ref.payee = bech(addressOf("escrow"));
  const q = c.query;
  const query = {
    act,
    finality: CONF[q.finality],
    ...(q.after === undefined ? {} : { after: BASE + BigInt(q.after) }),
    ...(q.others === undefined
      ? {}
      : { others: q.others.map((o) => ("transaction" in o ? { transaction: ids.get(o.transaction) ?? o.transaction } : o)) }),
  };
  const back = new Map([...ids].map(([k, v]) => [v, k]));
  const cred = (to: string): string => (to === credOf(PAYEE) ? "payee" : "elsewhere");
  return {
    run: async (): Promise<CaseAnswer> => {
      const a = (await status(ref, readerOf(world), query as never)) as unknown as Record<string, unknown> & { foreign: { transaction: string; reason: string; position?: bigint }[] };
      const out: Record<string, unknown> = { ...a };
      if (typeof a["transaction"] === "string") out["transaction"] = back.get(a["transaction"] as `0x${string}`) ?? a["transaction"];
      if (typeof a["position"] === "bigint") out["position"] = Number(a["position"] - BASE);
      if (typeof a["finality"] === "bigint") out["finality"] = markOf(a["finality"]);
      if (typeof a["search"] === "bigint") out["search"] = a["search"] === tip - 1n ? 42 : Number(a["search"] - BASE);
      if (Array.isArray(a["moved"])) {
        // A token travels with the lovelace of its output, which the case's one transfer does not name.
        const all = a["moved"] as { asset: string; amount: string; to: string; transaction?: string; place?: number }[];
        const withToken = new Set(all.filter((m) => m.asset !== "lovelace").map((m) => m.place));
        const moved = all.filter((m) => !(m.asset === "lovelace" && withToken.has(m.place)));
        out["moved"] = moved.map((m) => ({
          asset: m.asset === "lovelace" ? "A" : "B",
          amount: m.amount,
          to: cred(m.to),
          ...(m.transaction === undefined ? {} : { transaction: back.get(m.transaction as `0x${string}`) ?? m.transaction }),
          ...(m.place === undefined ? {} : { place: m.place }),
        }));
      }
      if (Array.isArray(a["undecoded"])) out["undecoded"] = (a["undecoded"] as `0x${string}`[]).map((t) => back.get(t) ?? t);
      out["foreign"] = a.foreign.map((x) => ({ ...x, transaction: back.get(x.transaction as `0x${string}`) ?? x.transaction }));
      return out as unknown as CaseAnswer;
    },
  };
}

/** The cases the reads cannot meet, each with its reason, as the profile `x402-exact-cardano` states them. */
export const ZERO =
  "On both pairings, *a payment act carrying H that transferred zero* and *an act carrying H that transferred zero*: " +
  "every output carries at least the ledger's smallest, (160 + the output's serialized bytes) x coinsPerUtxoByte " +
  "(x402's Cardano scheme, Minimum UTXO Value)";
export const NOPOS =
  "*an item the search could not decode that gives no position*: the credential listing names each transaction it " +
  "lists with its block's height";
export const UNSHOWN =
  "while no run has shown that a credential listing holds every transaction of the credential (Koios's " +
  "`credential_txs`, Blockfrost's address listing), the cases answering `instrument-unused`, `instrument-consumed` or " +
  "`transaction-failed`, each of which rests on that search";

/** The skipped cases: the zero-transfer cases by their opening words, then those resting on the search by their answers, each once. */
export const DECLARED: readonly Inapplicable[] = (() => {
  const zero = READ_STATUS.cases
    .filter((c) => c.case.startsWith("a payment act carrying H that transferred zero") || c.case.startsWith("an act carrying H that transferred zero"))
    .map((c): Inapplicable => ({ case: c.case, stated: ZERO }));
  const nopos = READ_STATUS.cases
    .filter((c) => c.case.startsWith("an item the search could not decode that gives no position"))
    .map((c): Inapplicable => ({ case: c.case, stated: NOPOS }));
  const gate = ["instrument-unused", "instrument-consumed", "transaction-failed"].flatMap((r) => answering(r, UNSHOWN));
  const out: Inapplicable[] = [...zero, ...nopos];
  for (const g of gate) {
    const taken = out.filter((d) => d.case === g.case).flatMap((d) => d.acts ?? ACTS);
    const acts = (g.acts ?? ACTS).filter((a) => !taken.includes(a));
    if (acts.length > 0) out.push({ case: g.case, acts, stated: UNSHOWN });
  }
  return out;
})();

/** The declaration that names the case on the act, where one does. */
export function declaredFor(c: ReadCase, act: Act): Inapplicable | undefined {
  return DECLARED.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
}

const formOn = (method: CardanoRef["method"]) => (c: ReadCase, act: Act) => {
  const d = declaredFor(c, act);
  return d === undefined ? arrangeOn(method, c, act) : { inapplicable: d.stated };
};

/** Whether the lock's case runs on the `script` lock too: where every act it holds is of its kind. */
export function runsOnScript(c: ReadCase): boolean {
  return !c.facts.seen.some((s) => s.kind === "other");
}

/** The cases and acts the lock form ran on the `script` lock, each answer held to the case's. */
export const SCRIPT_RAN = new Set<string>();

/** An answer held to the case's as the read kit holds it: the members it states, its foreign items, and which it names. */
function holdTo(answer: CaseAnswer, want: CaseAnswer, where: string): void {
  const foreign = (a: CaseAnswer) => a.foreign.map((x) => `${x.transaction}:${x.reason}`).sort();
  expect(answer, where).toMatchObject(want);
  expect(foreign(answer), where).toEqual(foreign(want));
  for (const key of ["transaction", "carries", "search", "undecoded"] as const) expect(key in answer, `${where}: ${key} in the answer`).toBe(key in want);
}

/** The lock pairing's form: each case on the Masumi lock, and, where its acts are each of their kind, on the `script` lock. */
const lockForm = (c: ReadCase, act: Act) => {
  const d = declaredFor(c, act);
  if (d !== undefined) return { inapplicable: d.stated };
  const masumi = arrangeOn("masumi", c, act);
  const script = runsOnScript(c) ? arrangeOn("script", c, act) : undefined;
  return {
    run: async (): Promise<CaseAnswer> => {
      if (script !== undefined) {
        holdTo(await script.run(), c.expect[act], `${c.case} (act ${act}) on the script lock`);
        SCRIPT_RAN.add(`${c.case} (act ${act})`);
      }
      return masumi.run();
    },
  };
};

export const forms: readonly DeclaredForm[] = [
  { form: { subject: "x402/exact/cardano", arrange: formOn("default") }, inapplicable: DECLARED },
  { form: { subject: "x402/exact/cardano/lock", arrange: lockForm }, inapplicable: DECLARED },
];
