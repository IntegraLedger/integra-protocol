/**
 * Hedera network constants for the LCP transaction-memo binding. The atrHash rides the
 * `transactionMemo` field of an HTS (Hedera Token Service) `TransferTransaction` — the SAME transaction
 * that moves USDC from buyer to seller. The buyer's signature over that transaction covers the memo
 * atomically with the transfer (canonical LCP §8.3.1 Native Field per the LCP per-chain binding table;
 * memo-only — the Hedera Consensus Service (HCS) is NOT used in this binding).
 *
 * Recovery is a Mirror Node REST read: the mirror returns the transaction's `memo_base64`, which decodes
 * back to the atrHash. That is a per-transaction / per-account scan, NOT a native index on memo contents.
 *
 * Token ids and mirror endpoints are transcribed from the Hedera network definitions.
 */

/** The two networks this binding ships constants for. */
export type HederaNetwork = "testnet" | "mainnet";

/** Per-network constants. `mirrorBaseUrl` is the one recovery depends on: Hedera consensus nodes do not
 *  serve historical transactions, so reading a memo back is always a Mirror Node query, and mirrors lag
 *  consensus by a short interval. */
export interface HederaNetworkConfig {
  network: HederaNetwork;
  /** CAIP-2 chain identifier. */
  caip2: "hedera:testnet" | "hedera:mainnet";
  /** Mirror Node REST base (recovery reads go here). */
  mirrorBaseUrl: string;
  /** HashScan explorer base for this network. */
  explorerBase: string;
  /** Circle-issued USDC HTS token id on this network ("0.0.NNN"). */
  usdcTokenId: string;
}

const TESTNET: HederaNetworkConfig = {
  network: "testnet",
  caip2: "hedera:testnet",
  mirrorBaseUrl: "https://testnet.mirrornode.hedera.com/api/v1",
  explorerBase: "https://hashscan.io/testnet",
  usdcTokenId: "0.0.429274",
};

const MAINNET: HederaNetworkConfig = {
  network: "mainnet",
  caip2: "hedera:mainnet",
  mirrorBaseUrl: "https://mainnet-public.mirrornode.hedera.com/api/v1",
  explorerBase: "https://hashscan.io",
  usdcTokenId: "0.0.456858",
};

/** The constants for one network. Both are usable — the transaction memo is a ledger primitive, so nothing
 *  has to be deployed first. */
export function getHederaConfig(network: HederaNetwork): HederaNetworkConfig {
  return network === "testnet" ? TESTNET : MAINNET;
}

/** The maximum transactionMemo length in bytes on Hedera. "0x" + 64 hex = 66 bytes fits comfortably. */
export const HEDERA_MEMO_MAX_BYTES = 100;

/**
 * USDC on Hedera has 6 decimals — 1 USDC = 1_000_000 base units.
 *
 * RAIL-QUALIFIED ON PURPOSE. Four bindings publish a USDC decimal count and they are NOT all the same —
 * Stellar's is 7 where Hedera's, Solana's and Sui's are 6. A bare `USDC_DECIMALS` exported four times
 * from four packages is one name with two meanings, and the way that fails is silent: a consumer who reads
 * it from one rail and applies it on another is off by a factor of ten in an amount, at settlement rather
 * than at compile time. Each value is correct for its own chain, which is why no per-package test can
 * catch the clash; the prefix is what makes it impossible to import the wrong one by accident.
 */
export const HEDERA_USDC_DECIMALS = 6;
