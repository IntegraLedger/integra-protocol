import { READS_TO_REPEAT } from "./internal/reads-to-repeat.js";

/** A refusal returned as a value. `code` is `<entry point>/<reason>`. */
export type Refusal = { refused: true; code: string };

/** Every refusal this package makes. Membership, not shape, is what makes a value a refusal. */
const made = new WeakSet<object>();

/** A refusal with `code`, recognised by `isRefusal`. */
export function refusal<C extends string>(code: C): { refused: true; code: C } {
  const r = { refused: true as const, code };
  made.add(r);
  return r;
}

/**
 * True only for a value `refusal` made. A caller's value shaped `{ refused: true, … }` is not a refusal, so no input is
 * ever passed on as one.
 */
export function isRefusal(v: unknown): v is Refusal {
  return typeof v === "object" && v !== null && made.has(v);
}

/**
 * True when `code` is a read to repeat: a refusal whose answer rests on a read of the rail that may answer differently
 * later, with nothing the caller must change. The caller asks again later, since the payment may already have moved.
 * These are each reader's `<rail>/unreadable` (the reader failed, or answered out of its documented form) and
 * `<rail>/not-found` (the reader holds no landed transaction for the reference yet), and the codes of a transaction that
 * is not final yet: `casper/not-executed`, `ccd/not-finalized`, `xrpl/not-validated`, `tempo/not-final` and
 * `hedera/not-final` (a revert in a block above the reader's `finalized` mark, which can be replaced by one in which the
 * transaction succeeds), and `svm/not-final` (an error at Solana's `confirmed`, with the transaction not found at
 * `finalized`). The refusal code reference marks each of them.
 *
 * False for every other string. A verdict is not a read to repeat: a later read gives the same answer. Nor is a call the
 * caller must change before it can succeed: `<rail>/wrong-reader` (a reader for another network, or a ref the rail
 * cannot read) and `<rail>/read-first` (`bound` or `reference` on a push credential before `fetchPresented` has read
 * it), a missing peer dependency, and malformed input. A string the package does not return is false.
 */
export function readToRepeat(code: string): boolean {
  return READS_TO_REPEAT.has(code);
}

/** True when a payment, credential or option handed in carries a `refused` member, the member refusals use. */
export function carriesRefused(v: Record<string, unknown>): boolean {
  return Object.hasOwn(v, "refused");
}
