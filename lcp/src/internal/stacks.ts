/**
 * The Stacks memo argument that carries the ATR hash: `(some H)` as a 32-byte buffer. `../mpp-usdc.ts` checks a signed
 * `transfer` against it, and `../stacks.ts` reads a mined one against it; no entry point exports these names.
 */
import type { AtrHash } from "../core.js";
import type { Hex } from "../evm-abi.js";
import { normalHash } from "../fields.js";

/** The Clarity serialization of `(some <32-byte buffer>)` before its bytes: `0x0a`, `0x02`, then the length 32. */
export const MEMO_PREFIX = "0x0a0200000020";

/** The memo argument's serialization for `h`: `(some h)` as a 32-byte buffer, lowercase. */
export function memoArgument(h: AtrHash): Hex | undefined {
  const n = normalHash(h);
  return n === null ? undefined : (`${MEMO_PREFIX}${n.slice(2)}` as Hex);
}
