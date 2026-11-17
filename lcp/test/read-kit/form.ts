// The read kit's form: what a pairing gives the read kit so that the cases common to every pairing's read
// (vectors/read-status.json) run through its own reader.
import type { PairingId } from "../../src/index.js";
import type { Act, Facts, Presented, Seen, StatusAnswer, StatusQuery } from "../../src/internal/read.js";

/** A mark of the cases: their order is the vector file's `marks`. */
export type CaseMark = "included" | "safe" | "final";

/** A transaction of a case: it states `presented` only in the cases about the comparison. */
export type CaseSeen = Omit<Seen<number, CaseMark>, "presented"> & { readonly presented?: Presented };

/** What a case's read observed, its transactions as the case states them. */
export type CaseFacts = Omit<Facts<number, CaseMark, number>, "seen"> & { readonly seen: readonly CaseSeen[] };

/** One case of read-status.json. */
export interface ReadCase {
  readonly case: string;
  readonly rules: string;
  readonly coverage: "full" | "none";
  readonly facts: CaseFacts;
  readonly query: Omit<StatusQuery<never, number, CaseMark, number>, "act">;
  readonly expect: { readonly payment: CaseAnswer; readonly agreement: CaseAnswer };
}

/** An answer in the cases' terms: their transaction names, integer positions and marks. */
export type CaseAnswer = StatusAnswer<number, CaseMark, number>;

/** A case made on a pairing's ledger for one act: the call of its `status`, with the answer put back in the cases' terms. */
export interface Arranged {
  readonly run: () => Promise<CaseAnswer>;
}

/** A pairing's share of the read kit. */
export interface ReadKitForm {
  /** The pairing whose `status` the cases run through, or `decide`, the machinery every pairing's `status` answers with. */
  readonly subject: PairingId | "decide";
  /** The case made for the act on this ledger, or the statement of why it cannot arise there. */
  readonly arrange: (c: ReadCase, act: Act) => Arranged | { readonly inapplicable: string };
}

/**
 * A case the pairing's profile states cannot arise on its ledger: the case by its name in read-status.json, the acts
 * the statement covers (both where absent), and where the profile states it.
 */
export interface Inapplicable {
  readonly case: string;
  readonly acts?: readonly Act[];
  readonly stated: string;
}

/** A form with the cases its pairing's profile states cannot arise on its ledger, the only cases the form may skip. */
export interface DeclaredForm {
  readonly form: ReadKitForm;
  readonly inapplicable: readonly Inapplicable[];
}
