import { bytesEqual, hexToBytes } from "./hex.js";
import { sha256Hex } from "./sha256.js";

/** Branded lowercase-emitted, any-case-validated SHA-256 hex with 0x prefix. */
export type AtrHash = `0x${string}` & { readonly __brand: "AtrHash" };

const ATR_HASH_RE = /^0x[0-9a-fA-F]{64}$/; // case-INSENSITIVE, per ATR canon

/** Is this a well-formed atrHash? **Case-INSENSITIVE on the hex digits**, per the ATR canon: a decode path
 *  consumes what a counterparty sent and an uppercase hash is the same hash. The `0x` prefix itself must be
 *  lowercase. This is a shape check and nothing more — it says the string COULD be an atrHash, never that
 *  any document hashes to it. */
export function isAtrHash(v: string): v is AtrHash {
  return ATR_HASH_RE.test(v);
}

/** Recompute over received bytes EXACTLY as received — never re-assembled, never canonicalized. Emits lowercase. */
export async function hashAtr(bytes: Uint8Array): Promise<AtrHash> {
  return `0x${await sha256Hex(bytes)}` as AtrHash;
}

/**
 * The canonical spelling of an atrHash — lowercase digits under the lowercase `0x` prefix — together with
 * the validation that is what makes canonicalizing it meaningful.
 *
 * LCP §2.5 RECOMMENDS emitting lowercase, so every write path wants this. The two halves are one rule and
 * belong in one place: before 2026-08-08 eleven encoders each opened with `if (!isAtrHash(v)) throw …`
 * followed by `v.toLowerCase()`, which is this function inlined eleven times, in five spellings, with the
 * `.toLowerCase()` left over as the thing a reader had to notice was a canonicalization and not a
 * comparison. Now nothing in the tree case-folds an atrHash except this file.
 *
 * THROWS rather than refusing, and that is the caller's contract not an oversight: an EMIT path holding a
 * value that is not an atrHash has a wiring defect, and writing a canonical form of a non-hash would put a
 * fabricated reference on a wire. Compare `atrHashEquals`, which answers `false` — a READ path meets
 * malformed data as a matter of course, and refusing is the honest answer there.
 *
 * `context` is the caller's own name, so the thrown message reads the way each rail's did before. `rider`
 * is for the one rail whose message must say more than the shape: `binding-evm-mpp` welds the atrHash to
 * MPP's `challenge.id`, where the EIP-3009 nonce is DERIVED rather than occupied, and a seller who reads
 * x402's "must be 32 bytes to ride as the nonce" here has been handed the wrong mental model at the worst
 * moment. The shape requirement stays uniform; what differs is what the value is FOR.
 */
export function canonicalAtrHash(
  atrHash: string,
  context: string,
  rider?: string,
): AtrHash {
  if (!isAtrHash(atrHash))
    throw new Error(
      `${context}: atrHash must be a 0x-prefixed 32-byte value, got "${atrHash}"${
        rider === undefined ? "" : ` — ${rider}`
      }`,
    );
  return atrHash.toLowerCase() as AtrHash;
}

/**
 * Equality per LCP §2.5: "Two `atrHash` values are equal when their decoded 32-byte values are equal, so
 * implementations MUST compare the decoded bytes rather than the strings."
 *
 * BOTH INPUTS ARE VALIDATED, and that is the substance of the change rather than defensive noise. The prior
 * implementation was `a.toLowerCase() === b.toLowerCase()`: correct for two well-formed values, and
 * meaningless for anything else — `atrHashEquals("hello", "HELLO")` answered `true`. A predicate that
 * reports two non-hashes equal is a string comparison wearing a hash comparison's name. It had zero
 * production callers, which is why nothing caught it.
 *
 * `isAtrHash` runs first because `hexToBytes` THROWS on a malformed input, and an equality predicate that
 * throws is a worse contract than one that answers `false`. So `0X…` — an uppercase prefix, which
 * `ATR_HASH_RE` has never admitted — is `false`, not an exception. Uppercase DIGITS are a legal spelling of
 * the same bytes and compare equal, which is the whole point of comparing decoded bytes.
 */
export function atrHashEquals(a: string, b: string): boolean {
  if (!isAtrHash(a) || !isAtrHash(b)) return false;
  return bytesEqual(hexToBytes(a), hexToBytes(b));
}
