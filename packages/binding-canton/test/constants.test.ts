import { describe, expect, it } from "vitest";
import {
  type CantonNetwork,
  getCantonConfig,
  LCP_ANCHOR_ENTITY,
  LCP_ANCHOR_MODULE,
  lcpAnchorTemplateId,
} from "../src/constants.js";

describe("lcpAnchorTemplateId", () => {
  it("is the fully-qualified <packageId>:Main:LcpAnchor of the deployed DAR", () => {
    expect(lcpAnchorTemplateId("1220deadbeef")).toBe(
      "1220deadbeef:Main:LcpAnchor",
    );
    expect(LCP_ANCHOR_MODULE).toBe("Main");
    expect(LCP_ANCHOR_ENTITY).toBe("LcpAnchor");
  });

  it("fails loud on an empty package id rather than building ':Main:LcpAnchor'", () => {
    // A participant would accept that string and match nothing, so an un-deployed DAR would read as
    // "no anchor exists" on every query instead of as a configuration error.
    expect(() => lcpAnchorTemplateId("")).toThrow(/packageId is empty/);
  });
});

describe("getCantonConfig", () => {
  // The rail's identity per network. `caip2` is what a settlement record names the ledger by, so a
  // wrong one mislabels which Canton a record was anchored on — and Canton has no canonical CAIP-2
  // namespace yet, which is exactly why the value is pinned here rather than derived.
  const EXPECTED: Record<
    CantonNetwork,
    { explorerBase: string; caip2: string }
  > = {
    sandbox: {
      explorerBase: "http://localhost:7500",
      caip2: "canton:sandbox",
    },
    devnet: {
      explorerBase: "https://scan.global.dev.sync.global",
      caip2: "canton:devnet",
    },
    mainnet: {
      explorerBase: "https://scan.sync.global",
      caip2: "canton:mainnet",
    },
  };

  it.each(Object.keys(EXPECTED) as CantonNetwork[])(
    "%s resolves to its own explorer and CAIP-2 identifier",
    (network) => {
      expect(getCantonConfig(network)).toEqual({
        network,
        ...EXPECTED[network],
      });
    },
  );

  it("gives each network a DISTINCT config (mainnet is not the sandbox fallback)", () => {
    const seen = (["sandbox", "devnet", "mainnet"] as const).map(
      (n) => getCantonConfig(n).caip2,
    );
    expect(new Set(seen).size).toBe(3);
  });
});
