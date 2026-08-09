import type { BindingManifest } from "@integraledger/lcp-binding-core";

/**
 * The Hedera transaction-memo binding manifest.
 *
 * **pattern = "native-field"** — the atrHash rides the HTS `TransferTransaction.transactionMemo`, an
 * existing Hedera primitive for an arbitrary transaction annotation (no Daml/overlay contract; canonical
 * LCP §8.3.1 per the LCP per-chain table). The buyer signs the transaction that carries BOTH the USDC HTS
 * transfer and the memo, so the weld is **signature-grade** — the payer's signature commits to the memo
 * atomically with the transfer.
 *
 * **HCS is not used.** Hedera exposes the Hedera Consensus Service as a public consensus-ordered log, but
 * this binding is memo-only; the transactionMemo alone is the LCP weld.
 *
 * **recovery.forwardIndexable = false** — Mirror Node returns a transaction's memo (`memo_base64`) when you
 * fetch that transaction, and lists an account's transactions, but it does NOT index by memo *contents*.
 * `recover` reads the memo from a single settled transaction (zero-party, from the settlement alone);
 * `enumerate` is a best-effort **account scan** (list transactions → decode each memo), an O(history) scan,
 * NOT an O(1) forward index — hence `indexing: "mirror-scan:memo"` and `forwardIndexable: false` (honest:
 * the Mirror REST scan exists, the native memo-content index does not).
 *
 * **NO `protocol`, and the silence is now examined rather than default.** x402's `exact` scheme for Hedera
 * (read 2026-08-08) constrains the transaction TYPE (`TransferTransaction` directly, never wrapped) and the
 * fee payer, and says nothing about `transactionMemo`. The memo weld therefore rides an x402-Hedera payment
 * untouched. The collision that DOES exist on this rail is MPP's, not x402's — see `memo.ts` — and it is
 * guarded rather than assumed away.
 */
export const HEDERA_MANIFEST: BindingManifest = {
  rail: "hedera",
  pattern: "native-field",
  nativeField: "transaction-memo",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  },
  assetBinding: "none", // envelope weld — recovery reads only the transactionMemo; the asset never appears in the view
  successGate: "raw-field", // Mirror Node result === SUCCESS; a tx can reach consensus and still fail post-consensus
  indexing: "mirror-scan:memo",
  finality: {
    reversible: false,
    note: "final on consensus (HTS transfer) — no on-rail reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "transaction-memo": "signature" },
  lifecycleStates: ["proposed", "settled"],
};
