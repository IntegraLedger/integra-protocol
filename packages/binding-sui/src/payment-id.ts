/**
 * The Pay402 `payment_id` atrHash codec — PURE, no Sui SDK. The atrHash is carried as the FULL 32 raw
 * bytes of the Move facilitator's `payment_id: vector<u8>` argument (per the reference
 * rail-sui: `paymentId = hexToBytes(atrHash)`, 32-byte assertion; `verify` maps the event's `payment_id`
 * number[] back to 0x-hex). No truncation — unlike Stellar's mux prefix, the whole hash fits.
 * `decodeAtrPaymentId` returns null for anything that is not a well-formed 32-byte payment_id (so a
 * settlement scan can skip non-LCP events without treating them as errors); `encodeAtrPaymentId` fails
 * LOUD on a malformed atrHash.
 */
import { bytesToHex, hexToBytes } from "@integraledger/lcp-binding-core";
import { atrHashEquals, canonicalAtrHash } from "@integraledger/lcp-kernel";

/** A Pay402 `payment_id` as the RPC surfaces it in a `PaymentSettled` event: a JSON array of byte values. */
export type PaymentIdBytes = Uint8Array | readonly number[];

/** Build the 32 raw `payment_id` bytes carrying `atrHash`. Throws on a malformed atrHash (fail-fast). */
export function encodeAtrPaymentId(atrHash: string): Uint8Array {
  // ⛔ THERE IS NO LENGTH CHECK HERE AND THERE MUST NOT BE. `canonicalAtrHash` refuses anything that is
  // not `0x` followed by exactly 64 hex digits (`isAtrHash`'s regex), and `hexToBytes` emits one byte per
  // pair, so 32 bytes is not a property this line could fail to have. The guard that used to follow was
  // UNREACHABLE, and the mutation report is what said so rather than an argument: its message was the one
  // string literal in this package with NO COVERAGE — a line no input can execute. Two rules about
  // atrHash shape, in two packages, one of which nothing can exercise, is how the pair silently drifts.
  return hexToBytes(canonicalAtrHash(atrHash, "encodeAtrPaymentId"));
}

/**
 * Decode a `payment_id` (raw bytes or the RPC's number[]) back to an atrHash, or null if it is not a
 * well-formed 32-byte payment_id.
 *
 * ⛔ EVERY ELEMENT MUST BE A BYTE, and the check is not defensive noise — `Uint8Array.from` TRUNCATES
 * silently rather than refusing, so a number outside 0..255 does not fail, it becomes a DIFFERENT byte.
 * Measured: `[300, …]` decoded to `0x2c…`, `[-1, …]` to `0xff…`, `[1.5, …]` to `0x01…`, and
 * `verifyAtrPaymentId` then answered **true** for a payment_id that does not spell that hash at all. A
 * codec that invents a well-formed answer out of a malformed input is worse than one that throws: the
 * caller receives an atrHash and has no way to know no settlement carries it. The docblock at the top of
 * this file has always promised null "for anything that is not a well-formed 32-byte payment_id"; this is
 * the half of that sentence the code did not keep. Null rather than a throw, per the same contract: a
 * settlement scan steps over a non-LCP event without treating it as an error.
 */
export function decodeAtrPaymentId(
  paymentId: PaymentIdBytes,
): `0x${string}` | null {
  if (
    !(paymentId instanceof Uint8Array) &&
    !paymentId.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
  )
    return null;
  const bytes =
    paymentId instanceof Uint8Array ? paymentId : Uint8Array.from(paymentId);
  if (bytes.length !== 32) return null;
  return bytesToHex(bytes) as `0x${string}`;
}

/** True iff `paymentId` carries exactly `atrHash` (verification-time check). */
export function verifyAtrPaymentId(inputs: {
  paymentId: PaymentIdBytes;
  atrHash: string;
}): boolean {
  const decoded = decodeAtrPaymentId(inputs.paymentId);
  if (decoded === null) return false;
  return atrHashEquals(decoded, inputs.atrHash);
}
