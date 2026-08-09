import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEDERA_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/hedera-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("HEDERA_MANIFEST", () => {
  it("matches the published integra-hedera-memo-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-hedera-memo-v1");
    expect(HEDERA_MANIFEST).toEqual(rest);
  });

  it("is a signature-grade native-field binding with no forward index (mirror scan only)", () => {
    expect(HEDERA_MANIFEST.pattern).toBe("native-field");
    expect(HEDERA_MANIFEST.nativeField).toBe("transaction-memo");
    expect(HEDERA_MANIFEST.weldGrades["transaction-memo"]).toBe("signature");
    expect(HEDERA_MANIFEST.recovery.forwardIndexable).toBe(false);
    expect(HEDERA_MANIFEST.indexing).toBe("mirror-scan:memo");
    expect(HEDERA_MANIFEST.assetBinding).toBe("none");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail records failed transactions, so recovery must read the chain's outcome field.
    expect(HEDERA_MANIFEST.successGate).toBe("raw-field");
  });
});
