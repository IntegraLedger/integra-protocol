import { describe, expect, it } from "vitest";
import {
  DROPS_PER_XRP,
  getXrplConfig,
  LCP_MEMO_FORMAT,
  LCP_MEMO_TYPE,
  type XrplNetwork,
} from "../src/constants.js";

describe("the LCP memo discriminator", () => {
  it("pins the MemoType and MemoFormat tags", () => {
    // MemoType is what a settlement scan matches on to tell an LCP memo from any other memo on the
    // same Payment. Change it and every existing on-chain weld stops being recognisable — the records
    // are already written, so this string is not free to revise.
    expect(LCP_MEMO_TYPE).toBe("lcp/atrHash");
    expect(LCP_MEMO_FORMAT).toBe("application/octet-stream");
  });
});

describe("getXrplConfig", () => {
  const EXPECTED: Record<
    XrplNetwork,
    { rpcUrl: string; explorerBase: string; caip2: string }
  > = {
    testnet: {
      rpcUrl: "https://s.altnet.rippletest.net:51234/",
      explorerBase: "https://testnet.xrpl.org",
      caip2: "xrpl:1",
    },
    mainnet: {
      rpcUrl: "https://xrplcluster.com/",
      explorerBase: "https://xrpl.org",
      caip2: "xrpl:0",
    },
  };

  it("testnet carries its own endpoints, its CAIP-2 id, and a faucet", () => {
    expect(getXrplConfig("testnet")).toEqual({
      network: "testnet",
      ...EXPECTED.testnet,
      faucetUrl: "https://faucet.altnet.rippletest.net/accounts",
    });
  });

  it("mainnet carries no faucet — there is nothing to fund from", () => {
    expect(getXrplConfig("mainnet")).toEqual({
      network: "mainnet",
      ...EXPECTED.mainnet,
    });
    expect(getXrplConfig("mainnet").faucetUrl).toBeUndefined();
  });

  it("the two networks are DISTINCT — mainnet is not a testnet fallback", () => {
    const t = getXrplConfig("testnet");
    const m = getXrplConfig("mainnet");
    expect(t.rpcUrl).not.toBe(m.rpcUrl);
    expect(t.caip2).not.toBe(m.caip2);
    // xrpl:1 is testnet and xrpl:0 is mainnet — the counter-intuitive direction, and the one a
    // settlement record names its ledger by, so it is pinned rather than inferred.
    expect(t.caip2).toBe("xrpl:1");
    expect(m.caip2).toBe("xrpl:0");
  });
});

describe("ledger units", () => {
  it("1 XRP is 1_000_000 drops (the base unit of Payment.Amount)", () => {
    expect(DROPS_PER_XRP).toBe(1_000_000);
  });
});
