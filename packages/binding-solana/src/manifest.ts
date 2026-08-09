import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Solana SPL-Memo binding manifest.
 *
 * **pattern = "native-field"** — the atrHash rides the SPL Memo program's instruction data, an existing
 * Solana primitive for arbitrary bytes (no Anchor overlay; canonical LCP §8.3.1 per the LCP per-chain table).
 * The buyer signs the transaction that carries BOTH the `transferChecked` and the memo instruction, so the
 * weld is **signature-grade** — the payer's signature commits to the memo atomically with the transfer.
 *
 * **recovery.forwardIndexable = false** — Solana does not index memo contents. `recover` reads the memo
 * from a single confirmed transaction (zero-party, from the settlement alone); `enumerate` is a best-effort
 * **account scan** (`getSignaturesForAddress` → parse each memo), which is an O(history) scan, NOT an
 * O(1) forward index — hence `indexing: "signature-scan:memo"` and `forwardIndexable: false` (honest: the
 * scan exists, the native index does not).
 *
 * **NO `protocol`, and x402 ACTIVELY SUPPORTS this carrier — which is why the field stays absent rather
 * than becoming `x402`.** x402's `exact` scheme for SVM (read 2026-08-08) defines `extra.memo`: "A
 * seller-defined UTF-8 string to include in the transaction's Memo instruction. When present, the client
 * MUST use this value as the Memo instruction data instead of a random nonce. Maximum 256 bytes." That is
 * the seller's route to set exactly the memo this binding encodes, and §2.1's forward-compatibility note
 * lists memos among the auxiliary instructions a facilitator tolerates.
 *
 * So the carrier works on bare Solana AND through x402, which is what protocol-neutrality means here. A
 * `protocol: "x402"` declaration would narrow a binding that is genuinely wider — the opposite of the
 * error the axis exists to catch.
 */
export const SOLANA_MANIFEST: BindingManifest = {
  rail: "solana",
  pattern: "native-field",
  nativeField: "spl-memo",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  },
  assetBinding: "none", // envelope weld — recovery reads only memo instructions, never the transferChecked
  successGate: "raw-field", // meta.err — only an explicit null is success; absent meta refuses
  indexing: "signature-scan:memo",
  finality: {
    reversible: false,
    note: "final on confirmation (SPL transfer) — no on-rail reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "spl-memo": "signature" },
  lifecycleStates: ["proposed", "settled"],
};
