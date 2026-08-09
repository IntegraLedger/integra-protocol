/**
 * The Aptos `payment_id` atrHash codec — PURE, no Aptos SDK. On Aptos the atrHash rides as the
 * `payment_id: vector<u8>` argument of the `lcp_payment::payment::settle_payment<Coin>` Move entry call
 * Unlike the native-field rails (Solana memo, XRPL memo), this
 * is an **overlay-contract** binding — `payment_id` is an argument to a bespoke deployed Move module, not a
 * stock chain field — but the codec itself is identical in spirit: atrHash ⇄ 32 carrier bytes.
 *
 * `encodePaymentId` fails LOUD on a malformed atrHash (fail-fast — never mint a settle call the verifier
 * would reject). The read helpers return `null` for anything that is not a well-formed 32-byte atrHash so a
 * settlement scan can skip a non-LCP artifact without treating it as an error.
 *
 * Two on-the-wire forms are handled on the read side: the raw 32 bytes (the Move-call argument /
 * `Array<number>` form) and the 0x-prefixed hex STRING an Aptos fullnode emits for a `vector<u8>` event
 * field. `readPaymentId` accepts either.
 */
import { bytesToHex, hexToBytes } from "@integraledger/lcp-binding-core";
import {
  atrHashEquals,
  canonicalAtrHash,
  isAtrHash,
} from "@integraledger/lcp-kernel";

/** Build the 32 `payment_id` bytes carrying `atrHash`. Throws on a malformed atrHash (fail-fast). */
export function encodePaymentId(atrHash: string): Uint8Array {
  return hexToBytes(canonicalAtrHash(atrHash, "encodePaymentId"));
}

/**
 * Build the `functionArguments` form of `payment_id` — a plain `number[]` of the 32 bytes, the shape the
 * Aptos SDK's Move-call `functionArguments` expects for a `vector<u8>`. Throws on a malformed atrHash.
 */
export function encodePaymentIdArg(atrHash: string): number[] {
  return Array.from(encodePaymentId(atrHash));
}

/** Decode raw 32-byte `payment_id` bytes back to an atrHash, or `null` if they are not a 32-byte value. */
export function decodePaymentIdBytes(
  paymentId: Uint8Array,
): `0x${string}` | null {
  if (paymentId.length !== 32) return null;
  return bytesToHex(paymentId) as `0x${string}`;
}

/**
 * Read a `payment_id` from either on-chain form — the raw 32 bytes (Move-call argument) or the 0x-prefixed
 * hex string an Aptos fullnode emits for a `vector<u8>` event field. Returns the atrHash, or `null` if the
 * value is not a well-formed 32-byte atrHash (a scan skips it, it does not error).
 */
export function readPaymentId(
  paymentId: Uint8Array | string,
): `0x${string}` | null {
  if (typeof paymentId !== "string") return decodePaymentIdBytes(paymentId);
  if (!isAtrHash(paymentId)) return null;
  return paymentId.toLowerCase() as `0x${string}`;
}

/** True iff `paymentId` carries exactly `atrHash` (verification-time check). */
export function verifyPaymentId(inputs: {
  paymentId: Uint8Array | string;
  atrHash: string;
}): boolean {
  const read = readPaymentId(inputs.paymentId);
  if (read === null) return false;
  return atrHashEquals(read, inputs.atrHash);
}
