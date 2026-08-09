import { describe, expect, it } from "vitest";
import {
  type CardanoNetwork,
  getCardanoConfig,
  LCP_METADATA_LABEL,
} from "../src/constants.js";

describe("LCP_METADATA_LABEL", () => {
  it("is the dedicated CIP-10 label 8847, not CIP-20/674", () => {
    // The binding claims its own registered label rather than sharing the general message label, so a
    // metadata scan cannot confuse an LCP anchor with someone else's transaction note. Every record
    // already written is under this number — it is not free to revise.
    expect(LCP_METADATA_LABEL).toBe(8847);
  });
});

describe("getCardanoConfig", () => {
  const EXPECTED: Record<
    CardanoNetwork,
    { blockfrostUrl: string; explorerBase: string; caip2: string }
  > = {
    preprod: {
      blockfrostUrl: "https://cardano-preprod.blockfrost.io/api/v0",
      explorerBase: "https://preprod.cardanoscan.io",
      caip2: "cardano:preprod",
    },
    mainnet: {
      blockfrostUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
      explorerBase: "https://cardanoscan.io",
      caip2: "cardano:mainnet",
    },
  };

  it.each(Object.keys(EXPECTED) as CardanoNetwork[])(
    "%s carries its own Blockfrost host, explorer and CAIP-2 id",
    (network) => {
      expect(getCardanoConfig(network)).toEqual({
        network,
        ...EXPECTED[network],
      });
    },
  );

  it("the two networks are DISTINCT — mainnet is not a preprod fallback", () => {
    const p = getCardanoConfig("preprod");
    const m = getCardanoConfig("mainnet");
    // The Blockfrost host IS the network selector: a recovery read aimed at the wrong one returns
    // "no such transaction" for a settlement that exists, which reads as never-anchored.
    expect(p.blockfrostUrl).not.toBe(m.blockfrostUrl);
    expect(p.caip2).not.toBe(m.caip2);
    expect(p.explorerBase).not.toBe(m.explorerBase);
  });
});
