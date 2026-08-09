import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOLANA_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/solana-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("SOLANA_MANIFEST", () => {
  it("matches the published integra-solana-memo-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-solana-memo-v1");
    expect(SOLANA_MANIFEST).toEqual(rest);
  });

  it("is a signature-grade native-field binding with no forward index (scan only)", () => {
    expect(SOLANA_MANIFEST.pattern).toBe("native-field");
    expect(SOLANA_MANIFEST.nativeField).toBe("spl-memo");
    expect(SOLANA_MANIFEST.weldGrades["spl-memo"]).toBe("signature");
    expect(SOLANA_MANIFEST.recovery.forwardIndexable).toBe(false);
    expect(SOLANA_MANIFEST.indexing).toBe("signature-scan:memo");
    expect(SOLANA_MANIFEST.assetBinding).toBe("none");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail records failed transactions, so recovery must read the chain's outcome field.
    expect(SOLANA_MANIFEST.successGate).toBe("raw-field");
  });
});
