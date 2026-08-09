import { describe, expect, it } from "vitest";
import {
  getHederaConfig,
  HEDERA_MEMO_MAX_BYTES,
  type HederaNetwork,
  USDC_DECIMALS,
} from "../src/constants.js";

describe("getHederaConfig", () => {
  // Transcribed from the Hedera network definitions. The mirror base is where every
  // recovery read goes and the token id names the asset a settlement moves — a wrong one on either
  // side reads a different ledger, or a different token, than the one the record claims.
  const EXPECTED: Record<
    HederaNetwork,
    {
      caip2: string;
      mirrorBaseUrl: string;
      explorerBase: string;
      usdcTokenId: string;
    }
  > = {
    testnet: {
      caip2: "hedera:testnet",
      mirrorBaseUrl: "https://testnet.mirrornode.hedera.com/api/v1",
      explorerBase: "https://hashscan.io/testnet",
      usdcTokenId: "0.0.429274",
    },
    mainnet: {
      caip2: "hedera:mainnet",
      mirrorBaseUrl: "https://mainnet-public.mirrornode.hedera.com/api/v1",
      explorerBase: "https://hashscan.io",
      usdcTokenId: "0.0.456858",
    },
  };

  it.each(Object.keys(EXPECTED) as HederaNetwork[])(
    "%s carries its own mirror node, explorer, CAIP-2 id and USDC token id",
    (network) => {
      expect(getHederaConfig(network)).toEqual({
        network,
        ...EXPECTED[network],
      });
    },
  );

  it("the two networks are DISTINCT — mainnet is not a testnet fallback", () => {
    const t = getHederaConfig("testnet");
    const m = getHederaConfig("mainnet");
    expect(t.mirrorBaseUrl).not.toBe(m.mirrorBaseUrl);
    expect(t.usdcTokenId).not.toBe(m.usdcTokenId);
    expect(t.caip2).not.toBe(m.caip2);
  });
});

describe("ledger limits", () => {
  it("the memo ceiling leaves room for a 0x-prefixed atrHash", () => {
    // 66 bytes of memo against Hedera's 100-byte transactionMemo limit. The check in encodeMemoAtrHash
    // is what stops a build-time overflow becoming a rejected transaction at settlement time.
    expect(HEDERA_MEMO_MAX_BYTES).toBe(100);
    expect(HEDERA_MEMO_MAX_BYTES).toBeGreaterThan(66);
  });

  it("USDC on Hedera is 6 decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
});
