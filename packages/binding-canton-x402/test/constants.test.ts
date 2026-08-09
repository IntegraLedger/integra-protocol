import { describe, expect, it } from "vitest";
import {
  CANTON_X402_MEMO_KEY,
  CANTON_X402_MEMO_MAX_BYTES,
  type CantonX402Network,
  getCantonX402Config,
} from "../src/constants.js";

describe("the x402 memo carrier constants", () => {
  it("names the host's own metadata key, exactly", () => {
    // Scheme safety check 12: "the transfer metadata MUST carry the identical value under `x402.memo`".
    // A metadata map carrying our value under any other key is a transfer no facilitator checked, so the
    // key is read exactly rather than matched loosely.
    expect(CANTON_X402_MEMO_KEY).toBe("x402.memo");
  });

  it("carries the scheme's own ceiling, with room for an atrHash", () => {
    // "Seller-defined UTF-8 string, max 256 bytes." A canonical atrHash is 66 UTF-8 bytes, so the check
    // in `encodeTransferMemo` is a defensive invariant rather than a live branch.
    expect(CANTON_X402_MEMO_MAX_BYTES).toBe(256);
    expect(
      new TextEncoder().encode(`0x${"ab".repeat(32)}`).length,
    ).toBeLessThan(CANTON_X402_MEMO_MAX_BYTES);
  });
});

describe("getCantonX402Config", () => {
  // The rail's identity per network. `caip2` is what a settlement record names the ledger by, so a
  // wrong one mislabels which Canton a record was anchored on — and Canton has no canonical CAIP-2
  // namespace yet, which is exactly why the value is pinned here rather than derived.
  const EXPECTED: Record<
    CantonX402Network,
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

  it.each(Object.keys(EXPECTED) as CantonX402Network[])(
    "%s resolves to its own explorer and CAIP-2 identifier",
    (network) => {
      expect(getCantonX402Config(network)).toEqual({
        network,
        ...EXPECTED[network],
      });
    },
  );

  it("gives each network a DISTINCT config (mainnet is not the sandbox fallback)", () => {
    const seen = (["sandbox", "devnet", "mainnet"] as const).map(
      (n) => getCantonX402Config(n).caip2,
    );
    expect(new Set(seen).size).toBe(3);
  });
});
