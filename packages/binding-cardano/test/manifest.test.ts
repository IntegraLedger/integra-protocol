import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARDANO_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/cardano-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("CARDANO_MANIFEST", () => {
  it("matches the published integra-cardano-metadata-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-cardano-metadata-v1");
    expect(CARDANO_MANIFEST).toEqual(rest);
  });

  it("is a signature-grade native-field binding with a native metadata-label forward index", () => {
    expect(CARDANO_MANIFEST.pattern).toBe("native-field");
    expect(CARDANO_MANIFEST.nativeField).toBe("tx-metadata-8847");
    expect(CARDANO_MANIFEST.weldGrades["tx-metadata"]).toBe("signature");
    // UNLIKE Solana (memo has no native index): Cardano metadata is label-indexable → forwardIndexable.
    expect(CARDANO_MANIFEST.recovery.forwardIndexable).toBe(true);
    expect(CARDANO_MANIFEST.recovery.zeroPartyRecoverable).toBe(true);
    expect(CARDANO_MANIFEST.indexing).toBe("metadata-label-index:8847");
    expect(CARDANO_MANIFEST.assetBinding).toBe("none");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail records failed transactions, so recovery must read the chain's outcome field.
    expect(CARDANO_MANIFEST.successGate).toBe("raw-field");
  });
});
