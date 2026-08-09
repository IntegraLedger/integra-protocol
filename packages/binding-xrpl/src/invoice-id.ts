/**
 * The XRPL `InvoiceID` atrHash codec — PURE, no XRPL SDK.
 *
 * **WHY THE WELD MOVED HERE FROM `Memos`.** x402's `exact` scheme for XRPL, verified at
 * `x402-foundation/x402` HEAD 2026-08-08, makes memos disqualifying twice over:
 *
 * > §9 Safety Checks (MUST) — The facilitator MUST reject transactions with: … `Memos` present.
 *
 * > §8 Invoice Binding — … Memos MUST NOT be used for invoice binding.
 *
 * A payment carrying the old memo weld could not settle through an x402-XRPL facilitator at all — rejected
 * before verification ever reached the amount. `InvoiceID` is a native 256-bit XRPL field, exactly the
 * width of an atrHash, and it was unused.
 *
 * **THE ATRHASH RIDES `InvoiceID` DIRECTLY, AND THAT IS A DELIBERATE CHOICE OVER THE FACILITATOR-ENFORCED
 * ALTERNATIVE.** x402 defines a second, hashed route: a seller may set `extra.invoiceId` to a string, and
 * then `InvoiceID = SHA-256(invoiceId)` with the facilitator rejecting a mismatch. Welding through THAT
 * would make the on-chain value a hash OF the atrHash — an §8.3.5 Id-Reuse binding whose only honest
 * surface is confirming a candidate the auditor already holds, because SHA-256 has no inverse. It would
 * buy facilitator enforcement and pay for it with zero-party recoverability, which is most of the reason
 * an on-chain weld exists.
 *
 * Writing the atrHash straight into `InvoiceID` keeps the record recoverable by anyone who can read the
 * ledger, and it is legal: the facilitator's MUST-reject on `InvoiceID` is conditioned on `invoiceId`
 * being PRESENT (§8, quoted above), so a payment that declares no `extra.invoiceId` leaves the field to us.
 *
 * **THE COST, STATED RATHER THAN GUARDED AWAY.** The two uses are mutually exclusive per transaction. A
 * seller already using x402 invoice binding for its own invoicing has spent `InvoiceID`, and — unlike the
 * MPP attribution memo, which carries a four-byte tag — there is NOTHING on-chain to tell an atrHash apart
 * from `SHA-256("INV-2025-001")`. Both are 32 opaque bytes. So:
 *
 *   - `proposeInvoiceId` REFUSES when the seller also intends x402 invoice binding. That is the one moment
 *     the information exists, and refusing loudly beats emitting a weld that silently means something else.
 *   - `decodeInvoiceId` returns a CANDIDATE, and callers must treat it as one. A foreign `InvoiceID`
 *     decodes to a well-formed value that is simply not any atrHash anyone holds — which is why the
 *     verification walk's fingerprint step, not this codec, is what establishes the weld. `enumerate`
 *     matches on a known atrHash and so cannot be fooled at all.
 *
 * **SPELLING.** XRPL `Hash256` fields are unprefixed uppercase hex on the wire, and the scheme's own
 * comparison rule is case-insensitive (§8). This module emits that form and normalizes back to LCP's
 * canonical lowercase `0x` spelling on the way in, so the on-chain value has exactly one shape and the
 * in-memory value has exactly one shape.
 */
import { canonicalAtrHash, isAtrHash } from "@integraledger/lcp-kernel";

/**
 * The `InvoiceID` field value carrying `atrHash`. Throws on a malformed atrHash (fail-fast — never sign a
 * payment whose weld a verifier would reject).
 */
export function encodeInvoiceId(atrHash: string): string {
  return canonicalAtrHash(atrHash, "encodeInvoiceId").slice(2).toUpperCase();
}

/**
 * Decode an `InvoiceID` back to a CANDIDATE atrHash, or `null` if it is not a well-formed 256-bit value.
 *
 * A candidate, not a conclusion: any 32 opaque bytes decode here, including the `SHA-256(invoiceId)` an
 * x402 invoice binding would write. Nothing on-chain distinguishes them, and this module does not pretend
 * otherwise — the weld is established by matching against an atrHash the reader already has.
 */
export function decodeInvoiceId(invoiceId: string): `0x${string}` | null {
  // `0x` + the wire value IS the atrHash spelling, so `isAtrHash` is the whole check: it already fixes the
  // length at 32 bytes and accepts either digit case, which is exactly §8's own case-insensitive rule. An
  // extra `Hash256` regex here would restate it, and a `.toLowerCase()` would restate `canonicalAtrHash`.
  const candidate = `0x${invoiceId}`;
  return isAtrHash(candidate)
    ? canonicalAtrHash(candidate, "decodeInvoiceId")
    : null;
}

/** True iff `invoiceId` carries exactly `atrHash` (verification-time check, case-insensitive per §8). */
export function verifyInvoiceId(inputs: {
  invoiceId: string | undefined;
  atrHash: string;
}): boolean {
  if (inputs.invoiceId === undefined) return false;
  const decoded = decodeInvoiceId(inputs.invoiceId);
  return decoded !== null && decoded === canonicalAtrHashOrNull(inputs.atrHash);
}

/** `canonicalAtrHash` without the throw — a verification-time check answers false on malformed input. */
function canonicalAtrHashOrNull(atrHash: string): string | null {
  return isAtrHash(atrHash)
    ? canonicalAtrHash(atrHash, "verifyInvoiceId")
    : null;
}

/**
 * The seller's proposal: the `InvoiceID` to sign into the payment, refusing when x402 invoice binding is
 * also in play.
 *
 * `usesX402InvoiceBinding` is the seller's own answer to "am I setting `extra.invoiceId`?" — the one piece
 * of information that exists off-chain and can never be recovered from the ledger. Refusing here is the
 * only place the collision can be caught at all.
 */
export function proposeInvoiceId(inputs: {
  atrHash: string;
  usesX402InvoiceBinding?: boolean;
}): string {
  if (inputs.usesX402InvoiceBinding === true)
    throw new Error(
      "proposeInvoiceId: this payment already binds an x402 extra.invoiceId, which occupies InvoiceID as SHA-256(invoiceId) — the two welds are mutually exclusive per transaction and nothing on-chain tells them apart, so the LCP weld cannot ride this payment",
    );
  return encodeInvoiceId(inputs.atrHash);
}
