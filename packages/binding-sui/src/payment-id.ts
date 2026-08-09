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
  const bytes = hexToBytes(canonicalAtrHash(atrHash, "encodeAtrPaymentId"));
  if (bytes.length !== 32)
    throw new Error(
      `encodeAtrPaymentId: atrHash must decode to 32 bytes (got ${bytes.length})`,
    );
  return bytes;
}

/** Decode a `payment_id` (raw bytes or the RPC's number[]) back to an atrHash, or null if not 32 bytes. */
export function decodeAtrPaymentId(
  paymentId: PaymentIdBytes,
): `0x${string}` | null {
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
