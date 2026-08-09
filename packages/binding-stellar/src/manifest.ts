import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Stellar CAP-67 muxed-address binding manifest.
 *
 * **pattern = "native-field"** — the binding rides `mux_id` inside a CAP-67 muxed M-address (an existing
 * Stellar account primitive), not an overlay contract (canonical LCP §8.3.1 per the LCP per-chain table). The
 * buyer signs the Soroban SAC `transfer` whose `to` is that M-address, so the weld is **signature-grade** —
 * the payer's signature commits the mux id atomically with the transfer.
 *
 * **★ recovery.zeroPartyRecoverable = false AND recovery.forwardIndexable = false — deliberately honest.**
 * A CAP-67 muxed id is exactly **8 bytes**, so only `atrHash[:8]` rides on-chain; the FULL 32-byte atrHash
 * does NOT fit. From a settlement alone you can recover only the 8-byte prefix, which is not the atrHash —
 * so the binding CONFIRMS a known atrHash's prefix-8 against the on-chain mux id (`verifyMuxedBinding`), it
 * does NOT reconstruct the full hash from the chain (that comes from off-chain `extensions.legalContext.info`). Hence
 * `zeroPartyRecoverable: false` (a party with only the settlement cannot derive the atrHash) and
 * `forwardIndexable: false` (no native index over mux prefixes; `enumerate` is a best-effort account scan,
 * `indexing: "account-scan:mux-prefix8"`). The prefix-8 truncation is stated in `finality.note` too.
 *
 * **NO `protocol`, and here is precisely what it is neutral OF.** This binding welds into the destination
 * of a CLASSIC Stellar payment. x402's `exact` scheme for Stellar (read 2026-08-08) is a different flow
 * entirely: "This spec covers SEP-41-compliant Soroban tokens **only**. Classic Stellar assets are not
 * supported", and the payment is an `invokeHostFunction` calling `transfer(from, to, amount)` where
 * "Argument 1 (to): MUST equal `requirements.payTo` exactly".
 *
 * A muxed destination cannot appear in that call — there is no classic payment to mux, and an `M…` address
 * would not equal `payTo` exactly. So a deployment settling through an x402-Stellar facilitator does not
 * get this carrier. That is a scoping fact, not a defect: the binding has never declared `protocol`, and
 * the mux weld is correct on the rail it targets. Stated here so the absence is a measured claim rather
 * than an unexamined default.
 */
export const STELLAR_MANIFEST: BindingManifest = {
  rail: "stellar",
  pattern: "native-field",
  nativeField: "cap67-mux-id",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  },
  assetBinding: "none", // envelope weld — the mux id carries atrHash[:8] only; the asset never appears in the view
  successGate: "raw-field", // Horizon successful; a txFAILED tx keeps its M-address in the envelope
  indexing: "account-scan:mux-prefix8",
  finality: {
    reversible: false,
    note: "final on ledger close (Soroban SAC transfer) — no on-rail reversal; only atrHash[:8] rides in the CAP-67 mux id, so settlement alone confirms the prefix-8 match but does NOT recover the full hash (the full atrHash comes from off-chain extensions.legalContext.info); recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "cap67-mux": "signature" },
  lifecycleStates: ["proposed", "settled"],
};
