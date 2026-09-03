import type { BindingManifest } from "@integraledger/lcp-binding-core";
import { EIP3009_TRANSFER_METHOD } from "./asset-transfer-method-filter.js";

/**
 * The x402 `exact` / EIP-3009 binding manifest (LCP `LCP-X402-EVM-NONCE-1`).
 *
 * **pattern = "native-field"** — the atrHash rides the EIP-3009 `nonce`, an EXISTING protocol field
 * the payer signs over; there is no derivation and no overlay contract. Off-canonical Native Field per
 * LCP §8.3.1 / Appendix B.1. This is authored fresh and correct — an archived
 * declaration says `id-reuse` / non-recoverable / non-indexable, a KNOWN-BAD artifact: it read MPP-EVM's
 * Appendix-C.1 derivation-MUST (a property of MPP's method spec) onto the x402 path, where no derivation
 * exists. Do NOT reconcile these values against that archive — "fixing" them reintroduces the bug.
 */
export const X402_MANIFEST: BindingManifest = {
  rail: "evm:x402",
  protocol: "x402",
  pattern: "native-field",
  nativeField: "eip3009.nonce",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: true,
  },
  assetBinding: "filtered", // recover reads the token's own AuthorizationUsed log — the record proves THIS asset moved
  successGate: "structural", // a reverted tx emits no logs, so the AuthorizationUsed weld event cannot exist
  indexing: "nonce-topic:AuthorizationUsed",
  finality: {
    reversible: false,
    note: "instant, final settlement (EIP-3009) — no on-rail reversal; recourse is the record's elected forum, and finality is never represented as dispute resolution (PAY-3/RCS-5). The atrHash welded as the EIP-3009 nonce MUST be per-transaction: an EIP-3009 nonce is one-time use, so one payer paying twice under the same ATR reproduces the same authorization and the token rejects the second with no LCP-level diagnostic. LCP §6.1 wants a per-transaction ATR anyway.",
  },
  // The payer's EIP-3009 signature commits to the nonce (= atrHash): signature-grade weld.
  //
  // ⛔ KEYED OFF THIS PACKAGE'S OWN CONSTANT, and it said `ERC3009` until 2026-09-03. Every other rail
  // keys `weldGrades` in its host's vocabulary — `spl-memo`, `invoice-id`, `cap67-mux`, `tx-metadata` —
  // and this rail's is x402's `assetTransferMethod` token, which this package exports as
  // `EIP3009_TRANSFER_METHOD = "eip3009"` and x402's exact-EVM scheme spells the same way. `ERC3009` is
  // the escrow sibling's COLLECTOR name, where it is right and where it came from; here it named nothing,
  // so a consumer's `weldGrades[assetTransferMethod]` lookup answered `undefined` — the grade absent
  // rather than wrong, which reads as a rail that declares no weld grade at all.
  weldGrades: { [EIP3009_TRANSFER_METHOD]: "signature" },
  offCanonical: { profile: "integra-x402-nonce-v1" }, // named profile
  // "welded-settled", not "settled": on this rail the two are one event. The nonce IS the atrHash, so the
  // settlement that fires `AuthorizationUsed` welds in the same log — there is no settled-but-unwelded
  // state to name. Other rails say "settled" because their weld is a payload a settlement can lack.
  lifecycleStates: ["proposed", "welded-settled"],
};
