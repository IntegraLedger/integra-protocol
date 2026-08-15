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
 * **NO `protocol`, and the reason is that the carrier genuinely works on both sides — CORRECTED
 * 2026-08-15.** An earlier revision of this paragraph said the opposite: that the binding welds into a
 * CLASSIC Stellar payment, that x402's `exact` scheme for Stellar was "a different flow entirely", and
 * that "a deployment settling through an x402-Stellar facilitator does not get this carrier". Every step of
 * that was wrong, and it contradicted this same file — `finality.note` below says "Soroban SAC transfer",
 * the paragraph above says the buyer signs the Soroban SAC `transfer`, and `adapter.ts` types the field it
 * reads as "the `to` destination of the SAC transfer". There was never a classic payment here to mux.
 *
 * Re-read against the live sources on 2026-08-15:
 *
 * - **x402's `exact` scheme for Stellar** (`x402-foundation/x402` HEAD `167a828e8319`) is Soroban SEP-41
 *   token transfers — an `invokeHostFunction` calling `transfer(from, to, amount)`. That is the SAME
 *   operation this binding welds into, not a different flow.
 * - Its only rule on the destination is "**Argument 1 (to)**: MUST equal `requirements.payTo` exactly". The
 *   scheme places **no format constraint on `payTo` anywhere**; its example happens to show a `G…` address,
 *   and an example is not a constraint. A seller advertising their `M…` address as `payTo` satisfies the
 *   rule by construction.
 * - **CAP-67** (`stellar/stellar-protocol`, `core/cap-0067.md`) exists precisely to permit this: "Add memo
 *   support to Soroban by adding a `SC_ADDRESS_TYPE_MUXED_ACCOUNT` and allow the SAC to take in this type
 *   in the `transfer` function call."
 *
 * ⛔ **What IS limited, and it is narrower and different: CAP-67 extended the SAC, not Soroban generally.**
 * The same CAP: "`MuxedAddressObject` … is not implicitly compatible with `AddressObject`. Thus the
 * contracts that expect the regular `AddressObject` as an input argument **will fail** if
 * `ScAddress::SC_ADDRESS_TYPE_MUXED_ACCOUNT` is passed to them." So the carrier depends on which contract
 * the payment invokes:
 *
 * - the **SAC** — the built-in contract for a classic asset — accepts a muxed `to`, and the weld rides;
 * - a **custom SEP-41 token contract** rejects it, and the invocation FAILS rather than degrading.
 *
 * A deployment therefore gets this carrier through x402 when, and only when, the scheme's `asset` is the
 * SAC. `protocol` stays absent because that is a genuine statement of neutrality — the carrier serves bare
 * Soroban and x402 alike — rather than, as the earlier text had it, because x402 could not reach it.
 *
 * ⚠️ **Two things deliberately NOT claimed here, because they were not verified.** Whether a given x402
 * facilitator independently rejects an `M…` `payTo` (the scheme does not require it to), and CAP-67's
 * activation status on any particular network. Both are deployment-time facts a seller must establish for
 * themselves; asserting either from this file would be the kind of unmeasured claim the correction above
 * exists to remove.
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
