import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The XRPL `InvoiceID` binding manifest.
 *
 * **pattern = "native-field"** — the atrHash rides `Payment.InvoiceID`, a native 256-bit XRPL field
 * exactly the width of an atrHash (canonical LCP §8.3.1). The buyer signs the `Payment` that carries it,
 * so the weld is **signature-grade**: the payer's signature commits to the InvoiceID atomically with the
 * payment.
 *
 * **THE WELD MOVED OFF `Memos` BECAUSE x402 DISQUALIFIES THEM.** Verified at `x402-foundation/x402` HEAD
 * 2026-08-08, the exact-XRPL scheme says twice over that a memo cannot carry this: §9 Safety Checks —
 * "The facilitator MUST reject transactions with: … `Memos` present" — and §8 Invoice Binding — "Memos
 * MUST NOT be used for invoice binding." A payment carrying the old memo weld could not settle through an
 * x402-XRPL facilitator at all, rejected before verification reached the amount. The memo path survives as
 * a READ-ONLY legacy branch for payments welded before the move; nothing emits one.
 *
 * **`protocol = "x402"`, and it is a scoping statement rather than a dependency.** The carrier is XRPL's
 * own field and works on bare XRPL — what x402 supplies is the constraint that made the memo unusable, and
 * the rule that leaves `InvoiceID` available. An absent `protocol` would be a positive claim of
 * protocol-neutrality, and this binding's carrier choice is not neutral: it was made by reading x402.
 *
 * **recovery.zeroPartyRecoverable = true, and this is why the DIRECT field was chosen over x402's hashed
 * route.** x402 defines a second binding — a seller sets `extra.invoiceId` and the chain carries
 * `InvoiceID = SHA-256(invoiceId)`, facilitator-enforced. Welding through that would make the on-chain
 * value a hash OF the atrHash, an §8.3.5 Id-Reuse binding whose only honest surface is confirming a
 * candidate the auditor already holds, because SHA-256 has no inverse. It would buy facilitator
 * enforcement and pay for it with recoverability — most of the reason an on-chain weld exists. Writing
 * the atrHash directly keeps the full 32 bytes readable by anyone with the ledger, and is legal because
 * the facilitator's MUST-reject on `InvoiceID` is conditioned on `invoiceId` being PRESENT.
 *
 * The cost is stated in `invoice-id.ts` rather than guarded away: a seller using x402 invoice binding for
 * its own invoicing has spent the field, and nothing on-chain distinguishes an atrHash from
 * `SHA-256("INV-2025-001")`. `propose` refuses at the one moment that information exists.
 *
 * **recovery.forwardIndexable = false** — XRPL has no native index over `InvoiceID`. `recover` reads it
 * from one validated transaction (zero-party, from the settlement alone); `enumerate` is a best-effort
 * **account transaction scan** (`account_tx` → read each Payment's InvoiceID), an O(history) scan, NOT an
 * O(1) forward index — hence `indexing: "tx-scan:invoice-id"` and `forwardIndexable: false` (honest: the
 * scan exists, the native index does not).
 */
export const XRPL_MANIFEST: BindingManifest = {
  rail: "xrpl",
  pattern: "native-field",
  protocol: "x402",
  nativeField: "InvoiceID",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  },
  assetBinding: "none", // envelope weld — recovery reads only InvoiceID; the asset never appears in the view
  successGate: "raw-field", // validated && engineResult === tesSUCCESS; a tec*/tef* result lands in the ledger
  indexing: "tx-scan:invoice-id",
  finality: {
    reversible: false,
    note: "final on validation (tesSUCCESS) — no on-rail reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "invoice-id": "signature", "tx-memo": "signature" }, // tx-memo is the read-only legacy carrier
  lifecycleStates: ["proposed", "settled"],
};
