/**
 * Cardano network constants for the LCP metadata binding.
 *
 * The atrHash rides a dedicated LCP transaction-metadata label on the buyer's native ADA transfer
 * (canonical LCP §8.3.1 Native Field per the LCP per-chain binding table). The buyer's signature covers the
 * transaction body, which commits to the `auxiliary_data_hash` (tx-body key 7), which in turn commits to
 * the metadata — so the weld is signature-grade.
 *
 * **The label is 8847 — a dedicated LCP transaction-metadata label**, replacing the earlier CIP-20
 * label-674 piggyback per the Cardano Foundation review: a dedicated label is cleanly
 * indexable and semantically honest, and the payload drops the redundant CIP-20 `msg` string. The
 * mechanism is a dedicated label, explicitly NOT CIP-20 — the established LCP Cardano metadata label,
 * carried forward unchanged so every LCP writer and reader agrees on one integer. 8847 is PROVISIONAL, pending CIP-0010 registration (confirmed free in the
 * 8414→10297 registry gap). This is the single source of truth for the on-chain label;
 * never hardcode the integer elsewhere.
 */

/**
 * The dedicated LCP transaction-metadata label. Replaces the CIP-20 label-674 piggyback.
 * PROVISIONAL — pending CIP-0010 registration with the Cardano Foundation.
 */
export const LCP_METADATA_LABEL = 8847;

/**
 * The LCP spec version this binding conforms to, stamped into the metadata payload's `v` field and so
 * WRITTEN ON-CHAIN. Re-exported from `kernel` rather than declared here: it was a fourth independent copy
 * of one fact and drifted to `0.1.36` while the rest of the tree reconciled to v1.37. The export is kept
 * because `v` is this binding's own wire concern and callers reach for it here — but the value now has one
 * definition, and `kernel/src/spec-version.ts` documents what it means and when it moves. It stamps
 * `0.1.38` today — LCP v1.38.
 *
 * `propose` takes it as a DEFAULT, not a constant, so a deployment stamping a different version is a
 * supported act rather than a fork.
 */
export { LCP_SPEC_VERSION } from "@integraledger/lcp-kernel";

/** The two networks this binding ships constants for — Cardano's public testnet is `preprod`. */
export type CardanoNetwork = "preprod" | "mainnet";

/** Per-network constants. `blockfrostUrl` is only the endpoint: this package performs no HTTP and holds no
 *  credential — recovery takes the Blockfrost-shaped metadata as a PORT, so Blockfrost, db-sync or Koios
 *  all satisfy it. A node's own API has no metadata-by-label query, which is why an indexer is in the
 *  picture at all. */
export interface CardanoNetworkConfig {
  network: CardanoNetwork;
  blockfrostUrl: string;
  explorerBase: string;
  /** CAIP-2 (informal convention pending formal namespace registration). */
  caip2: string;
}

const PREPROD: CardanoNetworkConfig = {
  network: "preprod",
  blockfrostUrl: "https://cardano-preprod.blockfrost.io/api/v0",
  explorerBase: "https://preprod.cardanoscan.io",
  caip2: "cardano:preprod",
};

const MAINNET: CardanoNetworkConfig = {
  network: "mainnet",
  blockfrostUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
  explorerBase: "https://cardanoscan.io",
  caip2: "cardano:mainnet",
};

/** The constants for one network. Both networks are usable — unlike the overlay rails, nothing here has to
 *  be deployed first, because label 8847 rides a plain ADA transfer. */
export function getCardanoConfig(
  network: CardanoNetwork,
): CardanoNetworkConfig {
  return network === "preprod" ? PREPROD : MAINNET;
}
