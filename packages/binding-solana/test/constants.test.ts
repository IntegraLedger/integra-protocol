import { describe, expect, it } from "vitest";
import {
  getSolanaConfig,
  MEMO_PROGRAM_ID,
  type SolanaNetwork,
  TOKEN_PROGRAM_ID,
  USDC_DECIMALS,
} from "../src/constants.js";

describe("program ids are cluster-independent", () => {
  it("pins the SPL Memo and SPL Token program addresses", () => {
    // `recoverAtrHashFromMemoViews` skips every instruction whose programId is not this exact string,
    // so a wrong one makes every welded settlement read as un-welded — silently, on every cluster.
    expect(MEMO_PROGRAM_ID).toBe("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    expect(TOKEN_PROGRAM_ID).toBe(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    expect(MEMO_PROGRAM_ID).not.toBe(TOKEN_PROGRAM_ID);
  });
});

describe("getSolanaConfig", () => {
  const EXPECTED: Record<SolanaNetwork, { rpcUrl: string; usdcMint: string }> =
    {
      devnet: {
        rpcUrl: "https://api.devnet.solana.com",
        usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      },
      mainnet: {
        rpcUrl: "https://api.mainnet-beta.solana.com",
        usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      },
    };

  it.each(Object.keys(EXPECTED) as SolanaNetwork[])(
    "%s carries its own RPC and its own Circle-issued USDC mint",
    (network) => {
      expect(getSolanaConfig(network)).toEqual({
        network,
        ...EXPECTED[network],
        memoProgramId: MEMO_PROGRAM_ID,
        tokenProgramId: TOKEN_PROGRAM_ID,
      });
    },
  );

  it("the two clusters are DISTINCT — devnet is not a mainnet fallback", () => {
    // The mints differ per cluster; resolving mainnet to the devnet config would settle real value
    // against a test mint, or the reverse.
    expect(getSolanaConfig("devnet").usdcMint).not.toBe(
      getSolanaConfig("mainnet").usdcMint,
    );
    expect(getSolanaConfig("devnet").rpcUrl).not.toBe(
      getSolanaConfig("mainnet").rpcUrl,
    );
  });

  it("USDC on Solana is 6 decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
