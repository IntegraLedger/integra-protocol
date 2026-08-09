/**
 * The TIP-20 memo atrHash codec — PURE, CHAIN-LEVEL, MPP-free.
 *
 * TIP-20's memo is "always a fixed 32-byte field" that "accepts any byte value within its 32-byte
 * capacity" (live spec, 2026-07-30), and an atrHash is exactly 32 bytes. So the memo IS the atrHash: there
 * is nothing to pack, pad, tag or wrap, and any transformation here would break zero-party recovery, which
 * reads topic 3 raw. That exact fit is what makes Tempo the strongest Native Field realization available —
 * contrast Stellar, where only `atrHash[:8]` fits the CAP-67 mux id and the full hash is unrecoverable
 * on-chain.
 *
 * `encodeAtrMemo` fails LOUD on a malformed atrHash; `decodeAtrMemo` returns `null` for anything that is
 * not a well-formed 32-byte memo, so a settlement scan skips foreign memos without treating them as
 * errors. The decode side accepts a BARE (unprefixed) memo because that is the host's own grammar: MPP's
 * `parse_memo_bytes_in_context` strips an optional `0x` before requiring exactly 32 bytes. Accepting both
 * spellings is conformance to a declared input format, not a tolerant fallback.
 */
import { atrHashEquals, canonicalAtrHash } from "@integraledger/lcp-kernel";
import { isHexBytes, stripHexPrefix } from "./hex.js";

/** The atrHash as the 32-byte memo the buyer's `transferWithMemo` carries. Throws if malformed. */
export function encodeAtrMemo(atrHash: string): `0x${string}` {
  return canonicalAtrHash(atrHash, "encodeAtrMemo");
}

/** A 32-byte memo (prefixed or bare) as a lower-case `0x` value, or `null` if it is not one. */
export function decodeAtrMemo(memo: string): `0x${string}` | null {
  if (!isHexBytes(memo, 32)) return null;
  return `0x${stripHexPrefix(memo).toLowerCase()}`;
}

/** A 32-byte memo, normalized — throws naming `context` when it is not one. For the write paths. */
export function requireMemo(memo: string, context: string): `0x${string}` {
  const decoded = decodeAtrMemo(memo);
  if (decoded === null)
    throw new Error(
      `${context}: expected a 32-byte hex memo (with or without 0x), got "${memo}"`,
    );
  return decoded;
}

/**
 * True iff a settlement's memo carries exactly `atrHash` (the seller's verification-time check).
 *
 * Both sides are validated by `atrHashEquals`, which is why no separate `isAtrHash` guard appears here.
 * The decoded side cannot fail it — `decodeAtrMemo` only ever yields `0x` + 64 lower-case hex — but the
 * CALLER'S side can, and comparing decoded bytes (LCP §2.5) means a malformed caller value answers `false`
 * rather than being silently case-folded into a string comparison.
 */
export function verifyAtrMemo(inputs: {
  memo: string;
  atrHash: string;
}): boolean {
  const decoded = decodeAtrMemo(inputs.memo);
  return decoded !== null && atrHashEquals(decoded, inputs.atrHash);
}
