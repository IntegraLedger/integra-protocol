import { READS_TO_REPEAT } from "./internal/reads-to-repeat.js";

/** A refusal returned as a value. `code` is `<entry point>/<reason>`. */
export type Refusal = { refused: true; code: string };

/**
 * The mark every refusal carries: a non-enumerable own property keyed by this registered symbol, holding `true`.
 * `Symbol.for` gives every copy of the package in a process the same symbol, so a refusal one installed copy makes is a
 * refusal to every other. JSON carries no symbol, and a spread or a `structuredClone` copies no non-enumerable
 * property, so none of them makes a refusal. The mark is not a member: `JSON.stringify`, `Object.keys` and
 * `canonicalJson` do not read it.
 */
const MARK = Symbol.for("@integraledger/lcp/refusal");

/** A refusal with `code`, recognised by `isRefusal`. */
export function refusal<C extends string>(code: C): { refused: true; code: C } {
  const r = { refused: true as const, code };
  Object.defineProperty(r, MARK, { value: true });
  return r;
}

/**
 * True only for a refusal a copy of this package made: a value whose own property keyed by the registered symbol
 * `Symbol.for("@integraledger/lcp/refusal")` holds `true`, the mark `refusal` sets as a non-enumerable property. Every
 * installed copy of the package recognises the refusals of every other, as when two installs serve one process. A
 * caller's value shaped `{ refused: true, … }`, a value read from JSON, and a spread or `structuredClone` copy of a
 * refusal hold no mark, so none of them is a refusal, and no such input is ever passed on as one. `JSON.stringify`
 * writes a refusal as `{"refused":true,"code":…}`. Never throws.
 */
export function isRefusal(v: unknown): v is Refusal {
  if (typeof v !== "object" || v === null) return false;
  try {
    return Object.getOwnPropertyDescriptor(v, MARK)?.value === true;
  } catch {
    return false;
  }
}

/**
 * True when `code` is a read to repeat: a refusal whose answer rests on a read of the rail that may answer differently
 * later, with nothing the caller must change. The caller asks again later, since the payment may already have moved.
 * These are each reader's `<rail>/unreadable` (the reader failed, or answered out of its documented form) and
 * `<rail>/not-found` (the reader holds no landed transaction for the reference yet), and the codes of a transaction that
 * is not final yet: `casper/not-executed`, `ccd/not-finalized`, `xrpl/not-validated`, `evm/not-final` and
 * `hedera/not-final` (a revert, or a receipt without what the read looks for, in a block above the reader's `finalized`
 * mark, which can be replaced by one in which the transaction succeeds or holds other logs), `polkadot/not-final` (an
 * extrinsic not dispatched as the payment, in a block above the finalized height), `stacks/not-final` (a failure in a
 * Stacks block fewer than two tenures below the tip, which can be replaced), `starknet/not-final` (a revert, or no
 * single matching transfer, in a pre-confirmed block, which can change), `svm/not-final` (an error at Solana's
 * `confirmed`, with the transaction not found at `finalized`) and `tempo/not-final` (as `evm/not-final`, on Tempo). The
 * refusal code reference marks each of them.
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
