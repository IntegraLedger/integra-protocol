/**
 * Solana network constants for the LCP SPL-Memo binding. The atrHash rides the data of an SPL
 * Memo-program instruction in the SAME transaction as the SPL `transferChecked` — the buyer's signature
 * covers both instructions atomically (canonical LCP §8.3.1 Native Field per the LCP per-chain binding table;
 * the SPL Memo program, not an Anchor overlay). Program IDs are identical on all clusters.
 */

/** The SPL Memo program (all clusters). */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** The SPL Token program (all clusters). */
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** The two clusters this binding ships constants for. Testnet is absent deliberately — it carries no
 *  Circle-issued USDC mint, so there is nothing for the binding's settlement half to reference. */
export type SolanaNetwork = "devnet" | "mainnet";

/** The per-cluster constants an adapter and its caller both need. The two program ids are the same on
 *  every cluster; only `rpcUrl` and `usdcMint` actually vary. */
export interface SolanaNetworkConfig {
  network: SolanaNetwork;
  rpcUrl: string;
  /** Circle-issued USDC SPL mint on this cluster. */
  usdcMint: string;
  memoProgramId: string;
  tokenProgramId: string;
}

const DEVNET: SolanaNetworkConfig = {
  network: "devnet",
  rpcUrl: "https://api.devnet.solana.com",
  usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  memoProgramId: MEMO_PROGRAM_ID,
  tokenProgramId: TOKEN_PROGRAM_ID,
};

const MAINNET: SolanaNetworkConfig = {
  network: "mainnet",
  rpcUrl: "https://api.mainnet-beta.solana.com",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  memoProgramId: MEMO_PROGRAM_ID,
  tokenProgramId: TOKEN_PROGRAM_ID,
};

/** The constants for one cluster. The public RPC endpoints are rate-limited and are a starting point, not
 *  a production choice — substitute your own `rpcUrl` before building a `SolanaReader` against it. */
export function getSolanaConfig(network: SolanaNetwork): SolanaNetworkConfig {
  return network === "devnet" ? DEVNET : MAINNET;
}

/** USDC on Solana has 6 decimals — 1 USDC = 1_000_000 base units. */
export const USDC_DECIMALS = 6;
