// The form of x402/exact/stellar/precondition: each case of read-status.json arranged as a Stellar RPC (a constructed
// fixture) and read through the pairing's own `status`. A transaction of the case is a transaction whose one operation
// is the buyer's `transfer`, built from x402-exact-stellar-precondition.json's signed envelope: one that carries H holds
// the signed-payload precondition of H and its entry's nonce; one of another kind holds H with another nonce; one the
// payee signed holds the payload under the payee's key, and one another account signed under a stranger's; one that
// consumed the value is signed over the reference's nonce, and one that did not over another; one whose signed message
// differs from the one presented has another expiration ledger. A transaction that succeeded emits one `transfer`
// event from the buyer for each transfer of what moved, its place the event's index; one included with a failed result
// emits none, as on Stellar, so the search does not meet it. A search held at a position is an events index that
// answers below the latest ledger; an item it could not decode is an event whose topics do not decode. Positions are
// ledger 100 + the case's number, at application order 1, and come back as the case's number; the mark `finalized`
// comes back as `final`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { ScValWire, TransactionEnvelopeWire } from "@stellar/stellar-sdk/xdr";
import { ReaderError } from "../../../src/evm.js";
import type { Act } from "../../../src/internal/read.js";
import { PASSPHRASE, stellarPosition, type StellarQuery, type StellarReader, type StellarRef } from "../../../src/stellar.js";
import { exactStellarPrecondition } from "../../../src/x402-exact-stellar.js";
import type { Arranged, CaseAnswer, CaseSeen, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { ACTS, READ_STATUS, answering, giving, opening } from "../harness.js";

const V = JSON.parse(readFileSync(new URL("../../../vectors/x402-exact-stellar-precondition.json", import.meta.url), "utf8"));
const PROFILE = "x402-exact-stellar-precondition.md, The read kit";

// ── The declarations, transcribed from the profile's statement (rule 21 there).

const MARK = `${PROFILE}: one mark, finalized, a transaction in a closed ledger, which is final and the latest head`;
const FAILED_NONCE = `${PROFILE}: a FAILED result consumes no nonce`;
const HOLDS = `${PROFILE}: every read holds the single-use value, the nonce, read by its search read through`;
const PLACED = `${PROFILE}: every transaction the read meets is in a closed ledger, at its position P`;
const BY_SEARCH = `${PROFILE}: the nonce is read only by the search read through`;
const GATE = `${PROFILE}: the search proves no absence until a run shows it holds every act of the buyer; such a case is pending search-incomplete`;

/** The cases at coverage full whose answer on the act the search's gate holds. */
const GATED = new Set(["instrument-unused", "instrument-consumed", "transaction-failed"]);
const gated: Inapplicable[] = READ_STATUS.cases.flatMap((c): Inapplicable[] => {
  if (c.coverage !== "full") return [];
  const acts = ACTS.filter((a) => c.expect[a].state === "failed" && "reason" in c.expect[a] && GATED.has(c.expect[a].reason));
  return acts.length === 0 ? [] : [{ case: c.case, acts, stated: GATE }];
});

/** Each case and act stated once: the first statement that names it. */
function once(lists: readonly (readonly Inapplicable[])[]): Inapplicable[] {
  const out: Inapplicable[] = [];
  for (const d of lists.flat()) {
    for (const act of d.acts ?? ACTS) {
      if (out.some((o) => o.case === d.case && (o.acts ?? ACTS).includes(act))) continue;
      out.push({ case: d.case, acts: [act], stated: d.stated });
    }
  }
  return out;
}

const DECLARED: readonly Inapplicable[] = once([
  answering("below-mark", MARK),
  answering("transaction-failed", FAILED_NONCE),
  opening("a failed result that consumed the value", FAILED_NONCE),
  answering("not-found", HOLDS),
  opening("an act read at the finality asked for, below the final mark", MARK),
  opening("a value unconsumed at the final mark and consumed at the latest head", MARK),
  opening("a value whose validity passed, unconsumed at the final mark and consumed at the latest head", MARK),
  opening("a read that did not read the value at the latest head", MARK),
  opening("a read with no means to read the single-use value", HOLDS),
  opening("an act the read cannot place against the position given", PLACED),
  opening("an item the search could not decode that gives no position", PLACED),
  opening("a value read consumed whose transaction the search has not found", BY_SEARCH),
  opening("instrument-live is answered before search-incomplete", BY_SEARCH),
  opening("instrument-live is answered before an item the search could not decode", BY_SEARCH),
  opening("an item the caller gave by its transaction holds no search though the read cannot decode it", BY_SEARCH),
  gated,
]);

// ── The ledger.

const BASE = 100;
const ledgerOf = (n: number): number => BASE + n;
const positionOf = (n: number): string => stellarPosition(ledgerOf(n), 1) as string;
const numberOf = (p: string): number => Number(BigInt(p) >> 32n) - BASE;
const hashOf = (name: string): string => createHash("sha256").update(name).digest("hex");
const key = (seed: number): Keypair => Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed));
const BUYER = key(5);
const PAYEE = key(4);
const STRANGER = key(9);
const ELSEWHERE = key(10);
const ASSETS: Record<string, string> = { A: V.fixed.asset, B: StrKey.encodeContract(Buffer.alloc(32, 7)) };
const REF: StellarRef = V.build.expectReference;
const NONCE = BigInt(REF.nonce);
const H = Buffer.from(V.fixed.H.slice(2), "hex");

const account = (k: Keypair): ScValWire => ({ type: 18, address: { type: 0, accountId: { type: 0, ed25519: k.rawPublicKey() } } });
const sym = (s: string): string => xdr.ScVal.fromXdrObject({ type: 15, sym: new xdr.XdrString(s) }).toXdr("base64");

/** The envelope of a transaction of the case. */
function envelopeOf(s: CaseSeen, payeeAccount: string): string {
  const env = xdr.TransactionEnvelope.fromXdr(V.build.expectEnvelope, "base64").toXdrObject() as TransactionEnvelopeWire;
  if (env.type !== 2) throw new Error("not a v1 envelope");
  const op = env.v1.tx.operations[0]!.body;
  if (op.type !== 24 || op.invokeHostFunctionOp.hostFunction.type !== 0) throw new Error("not an invocation");
  const entry = op.invokeHostFunctionOp.auth[0]!;
  if (entry.credentials.type !== 1 || entry.rootInvocation.function.type !== 0) throw new Error("not an address entry");
  // The built envelope pays the payee: another recipient is written only where the case names one.
  const to = s.account === "payee" ? (payeeAccount === BUYER.publicKey() ? BUYER : null) : ELSEWHERE;
  if (to !== null) {
    for (const args of [op.invokeHostFunctionOp.hostFunction.invokeContract.args, entry.rootInvocation.function.contractFn.args]) {
      args[1] = account(to);
    }
  }
  const nonce = s.consumed ? NONCE : NONCE + 1n;
  entry.credentials.address.nonce = nonce;
  if (s.presented === "no") entry.credentials.address.signatureExpirationLedger -= 1;
  const signer = s.party === "payee" ? PAYEE : s.party === "other" ? STRANGER : BUYER;
  const payload = Buffer.alloc(40);
  H.copy(payload, 0);
  payload.writeBigInt64BE(s.kind === "other" ? nonce + 7n : nonce, 32);
  if (env.v1.tx.cond.type !== 2) throw new Error("no precondition");
  env.v1.tx.cond.v2.extraSigners = s.carries ? [{ type: 3, ed25519SignedPayload: { ed25519: signer.rawPublicKey(), payload } }] : [];
  return xdr.TransactionEnvelope.fromXdrObject(env).toXdr("base64");
}

interface Tx {
  readonly hash: string;
  readonly ledger: number;
  readonly status: "SUCCESS" | "FAILED";
  readonly envelope: string;
}
interface Ev {
  readonly id: string;
  readonly ledger: number;
  readonly txHash: string;
  readonly contractId: string;
  readonly topic: readonly string[];
  readonly value: string;
}

function arrange(c: ReadCase, act: Act): Arranged | { inapplicable: string } {
  const declared = DECLARED.find((d) => d.case === c.case && (d.acts ?? ACTS).includes(act));
  if (declared !== undefined) return { inapplicable: declared.stated };
  const f = c.facts;
  const payeeOnly = f.seen.length > 0 && f.seen.every((s) => s.party === "payee");
  const payee = payeeOnly ? BUYER.publicKey() : PAYEE.publicKey();
  const ref = { ...REF, payee, fromLedger: BASE };
  const names = new Map<string, string>();
  const name = (n: string): string => {
    const h = hashOf(n);
    names.set(h, n);
    return h;
  };
  const txs = new Map<string, Tx>();
  const events: Ev[] = [];
  for (const s of f.seen) {
    const hash = name(s.transaction);
    const ledger = ledgerOf(s.position ?? 0);
    txs.set(hash, { hash, ledger, status: s.result === "succeeded" ? "SUCCESS" : "FAILED", envelope: envelopeOf(s, payee) });
    if (s.result !== "succeeded") continue;
    const moved = s.moved ?? [{ asset: "A", amount: "1", to: s.account === "payee" ? "payee" : "elsewhere" }];
    moved.forEach((m, k) => {
      const place = typeof m.place === "number" ? m.place : k;
      const to = m.to === "payee" ? (payeeOnly ? BUYER : PAYEE) : ELSEWHERE;
      events.push({
        id: `${(BigInt(stellarPosition(ledger, 1) as string) + 1n).toString().padStart(19, "0")}-${String(place).padStart(10, "0")}`,
        ledger,
        txHash: hash,
        contractId: ASSETS[m.asset] ?? ASSETS["A"]!,
        topic: [sym("transfer"), xdr.ScVal.fromXdrObject(account(BUYER)).toXdr("base64"), xdr.ScVal.fromXdrObject(account(to)).toXdr("base64")],
        value: nativeToScVal(BigInt(m.amount), { type: "i128" }).toXDR("base64"),
      });
    });
  }
  for (const u of f.undecoded ?? []) {
    const ledger = ledgerOf(u.at ?? 0);
    const hash = name(u.transaction);
    events.push({ id: `${(BigInt(stellarPosition(ledger, 1) as string) + 1n).toString().padStart(19, "0")}-0000000000`, ledger, txHash: hash, contractId: ASSETS["A"]!, topic: ["AAAA", "AAAA"], value: "AAAA" });
  }
  events.sort((a, b) => a.id.localeCompare(b.id));
  const lapsed = f.value?.lapsed === true;
  const latest = lapsed ? REF.expiration + 1 : REF.expiration - 1;
  // A search held at a position: the events index answers through the ledger below it.
  const indexed = f.search.whole || f.search.at === undefined ? latest : ledgerOf(f.search.at) - 1;
  const oldest = !f.history && f.value === undefined ? BASE + 1 : BASE;
  const fail = (): never => {
    if (f.unreadable === "too-large") throw new ReaderError("too-large");
    throw new Error("transport");
  };
  const reader: StellarReader = {
    passphrase: async () => (f.unreadable === "chain-mismatch" ? PASSPHRASE["stellar:pubnet"] : PASSPHRASE["stellar:testnet"]),
    latestLedger: async () => {
      if (f.unreadable === "transport" || f.unreadable === "too-large") fail();
      return f.unreadable === "unparseable" ? ({ sequence: "x" } as never) : { sequence: latest };
    },
    transaction: async (hash) => {
      const t = txs.get(hash);
      return t === undefined
        ? { status: "NOT_FOUND", oldestLedger: oldest, latestLedger: latest }
        : { status: t.status, envelopeXdr: t.envelope, ledger: t.ledger, applicationOrder: 1, oldestLedger: oldest, latestLedger: latest };
    },
    events: async (q) => ({
      events: events.filter((e) => e.ledger >= q.fromLedger && e.ledger <= Math.min(q.toLedger, indexed)),
      oldestLedger: oldest,
      latestLedger: indexed,
    }),
  };
  const others = (c.query.others ?? []).map((o) =>
    "transaction" in o ? { transaction: name(o.transaction) } : { ref: { ...ref, authDigest: `0x${"00".repeat(32)}` } },
  );
  const query = {
    act,
    finality: "finalized" as const,
    ...(c.query.after === undefined ? {} : { after: ledgerOf(c.query.after) }),
    ...(c.query.search === undefined ? {} : { search: positionOf(c.query.search) }),
    ...(others.length === 0 ? {} : { others }),
  };
  const back = (h: string): string => names.get(h) ?? h;
  const movedBack = (m: readonly { asset: string; amount: string; to: string; transaction?: string; place?: number | string }[]) =>
    m.map((x) => ({
      asset: Object.entries(ASSETS).find(([, v]) => v === x.asset)?.[0] ?? x.asset,
      amount: x.amount,
      to: x.to === ELSEWHERE.publicKey() ? "elsewhere" : "payee",
      ...(x.transaction === undefined ? {} : { transaction: back(x.transaction) }),
      ...(x.place === undefined ? {} : { place: Number(String(x.place).slice(20)) }),
    }));
  return {
    run: async () => {
      const a = (await exactStellarPrecondition.status(ref, reader, query as StellarQuery)) as unknown as Record<string, unknown> & {
        foreign: { transaction: string; reason: string; position?: string }[];
      };
      const { signer: _s, ...rest } = a;
      const out: Record<string, unknown> = { ...rest };
      if (typeof a["transaction"] === "string") out["transaction"] = back(a["transaction"]);
      if (typeof a["finality"] === "string") out["finality"] = "final";
      if (typeof a["position"] === "string") out["position"] = numberOf(a["position"]);
      if (typeof a["search"] === "string") out["search"] = numberOf(a["search"]);
      if (Array.isArray(a["undecoded"])) out["undecoded"] = (a["undecoded"] as string[]).map(back);
      if (Array.isArray(a["moved"])) out["moved"] = movedBack(a["moved"] as never);
      out["foreign"] = a.foreign.map((x) => ({
        transaction: back(x.transaction),
        reason: x.reason,
        ...(x.position === undefined ? {} : { position: numberOf(x.position) }),
      }));
      return out as unknown as CaseAnswer;
    },
  };
}


export const forms: readonly DeclaredForm[] = [{ form: { subject: "x402/exact/stellar/precondition", arrange }, inapplicable: DECLARED }];
