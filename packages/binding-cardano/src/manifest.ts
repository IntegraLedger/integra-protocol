import type { BindingManifest } from "@integraledger/lcp-binding-core";
import { LCP_METADATA_LABEL } from "./constants.js";

/**
 * The Cardano LCP-metadata binding manifest.
 *
 * **pattern = "native-field"** — the atrHash rides Cardano's transaction-metadata facility (an existing
 * Cardano primitive for arbitrary auxiliary data, not an overlay contract), under a dedicated LCP label
 * (canonical LCP §8.3.1 per the LCP per-chain table). The buyer signs the transaction body, which commits to
 * the `auxiliary_data_hash` (tx-body key 7), which commits to the metadata — so the weld is
 * **signature-grade**: the payer's signature commits to the atrHash atomically with the ADA transfer.
 *
 * **nativeField = "tx-metadata-8847"** — the atrHash rides Cardano's tx `auxiliary_data.metadata[8847]`,
 * a dedicated LCP transaction-metadata label (8847), replacing the earlier CIP-20 label-674 piggyback per
 * the Cardano Foundation review (pending CIP-0010 registration). See constants.ts. The
 * mechanism is a dedicated label, explicitly NOT CIP-20 — the field name reflects the honest mechanism
 * (Cardano tx metadata), paralleling xrpl "tx-memo" / hedera "transaction-memo".
 *
 * **recovery.forwardIndexable = true** — UNLIKE Solana's memo (no native index), Cardano tx-metadata IS
 * natively indexed by label: an indexer (Blockfrost `GET /metadata/txs/labels/{label}`, and the same
 * capability in db-sync / Koios / Ogmios) returns every transaction carrying a given metadata label. So
 * settlements bearing the LCP label are forward-queryable by label (`indexing:
 * "metadata-label-index:8847"`), not merely recoverable per-tx. This is a metadata-label index at the
 * indexer layer — the standard, honest Cardano access pattern (Cardano nodes do not serve historical
 * label queries directly; an indexer does, which is why the integration is Blockfrost-gated).
 * `zeroPartyRecoverable` is also true: the full atrHash (not a truncation) rides the label value, so any
 * party can recover it from the settlement alone.
 *
 * **NO `protocol`, and the silence is now examined rather than default.** x402's `exact` scheme for Cardano
 * (read 2026-08-08) constrains the network, the recipient (`payTo`), the asset unit and the TTL, and says
 * nothing about `auxiliary_data`. The label-8847 metadatum therefore rides an x402-Cardano payment
 * untouched — the facilitator's checks are on value and destination, not on what else the transaction
 * carries. Neutral, and specifically neutral OF x402 rather than unaware of it.
 */
export const CARDANO_MANIFEST: BindingManifest = {
  rail: "cardano",
  pattern: "native-field",
  nativeField: "tx-metadata-8847",
  recovery: {
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: true,
  },
  assetBinding: "none", // envelope weld — recovery reads only the metadata label; the asset never appears in the view
  successGate: "raw-field", // Blockfrost valid_contract; a phase-2 failure lands on-chain with its metadata readable
  indexing: `metadata-label-index:${LCP_METADATA_LABEL}`,
  finality: {
    reversible: false,
    note: "final on settlement confirmation (native ADA transfer) — no on-rail reversal; recourse is the record's elected forum (PAY-3/RCS-5), never dispute resolution",
  },
  weldGrades: { "tx-metadata": "signature" },
  lifecycleStates: ["proposed", "settled"],
};
