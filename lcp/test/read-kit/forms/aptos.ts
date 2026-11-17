// The read kit's form of x402/exact/aptos: each case at coverage none arranged on a constructed Aptos REST endpoint (no
// node was read), its committed transaction the vector's real mainnet answer (x402-exact-aptos.json, fixed.committed,
// with its constructed deposit events and changes) under the case's version, hash and result, read through the
// pairing's own `status`; the answer is put back in the case's terms. The case's positions are ledger versions; a case
// that gives no position reads after version 0. The form skips exactly the cases the profile's rule 13 declares.
import { readFileSync } from "node:fs";
import { exactAptos, type AptosCommitted, type AptosReader, type AptosRef } from "../../../src/aptos.js";
import type { Act } from "../../../src/internal/read.js";
import type { CaseAnswer, DeclaredForm, Inapplicable, ReadCase } from "../form.js";
import { answering } from "../harness.js";

const V = JSON.parse(readFileSync(new URL("../../../vectors/x402-exact-aptos.json", import.meta.url), "utf8"));
const COMMITTED: AptosCommitted = V.fixed.committed;
const { transaction: _hint, ...REF } = V.V4.status[0].ref as AptosRef;
const ENTRY = "the profile x402-exact-aptos.md, rule 13: declared inapplicable to the read kit";

export const DECLARED: readonly Inapplicable[] = [
  ...answering("below-mark", `${ENTRY} (below-mark: one mark, a committed transaction is final)`),
  ...answering("not-found", `${ENTRY} (not-found, since the read reads the account's sequence number)`),
];

export const STATED: readonly Inapplicable[] = [
  {
    case: "at coverage none, a lookup read whole beside an item the search could not decode: search-incomplete, not not-found",
    stated: "the profile x402-exact-aptos.md, rule 13 (the read takes no search at coverage none, so it meets no item it cannot decode)",
  },
];

/** The case's transaction as a committed answer: the real one under the case's hash, version and result. */
function committed(s: ReadCase["facts"]["seen"][number]): AptosCommitted {
  const hash = "0x" + Buffer.from(s.transaction.padEnd(32, "\u0000")).toString("hex");
  return { ...COMMITTED, hash, version: String(s.position ?? 0), success: s.result === "succeeded", ...(s.result === "succeeded" ? {} : { events: [], changes: [] }) };
}

async function run(c: ReadCase, act: Act): Promise<CaseAnswer> {
  const f = c.facts;
  const at = f.seen.find((s) => s.consumed);
  const names = new Map<string, string>();
  const found = at === undefined ? undefined : committed(at);
  if (found !== undefined) names.set(found.hash, at!.transaction);
  const after = BigInt(c.query.after ?? 0);
  const expiry = BigInt(REF.expiresAt) * 1_000_000n;
  const lapsed = f.value?.lapsed ?? true;
  const floor = f.history ? 0n : after + 1n;
  const reader: AptosReader = {
    network: REF.network,
    async ledger() {
      return { chainId: 1, timestampUsecs: expiry };
    },
    async byHash() {
      return null;
    },
    async bySequence() {
      return found ?? { notFound: true, timestampUsecs: expiry, oldestVersion: floor };
    },
    async account() {
      const n = BigInt(REF.sequenceNumber) + (f.value?.consumed === true ? 1n : 0n);
      return { sequenceNumber: n, timestampUsecs: lapsed ? expiry : expiry - 1_000_000n, oldestVersion: floor };
    },
  };
  const query = { act, finality: "committed" as const, after };
  const a = await exactAptos.status(REF, reader, query);
  const out: Record<string, unknown> = { ...a, foreign: a.foreign.map((x) => ({ ...x, transaction: names.get(x.transaction) ?? x.transaction })) };
  if ("transaction" in a && a.transaction !== undefined) out["transaction"] = names.get(a.transaction) ?? a.transaction;
  if ("position" in a && a.position !== undefined) out["position"] = Number(a.position);
  if ("finality" in a && a.finality === "committed") out["finality"] = "final";
  if ("search" in a && a.search !== undefined) out["search"] = Number(a.search);
  return out as unknown as CaseAnswer;
}

const inapplicable = [...DECLARED, ...STATED];

export const forms: readonly DeclaredForm[] = [
  {
    form: {
      subject: "x402/exact/aptos",
      arrange: (c, act) => {
        const stated = inapplicable.find((d) => d.case === c.case && (d.acts === undefined || d.acts.includes(act)));
        return stated !== undefined ? { inapplicable: stated.stated } : { run: () => run(c, act) };
      },
    },
    inapplicable,
  },
];
