import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STELLAR_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/stellar-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("STELLAR_MANIFEST", () => {
  it("matches the published integra-stellar-mux-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-stellar-mux-v1");
    expect(STELLAR_MANIFEST).toEqual(rest);
  });

  it("is a signature-grade native-field binding that is HONEST about prefix-8 (confirm-not-recover)", () => {
    expect(STELLAR_MANIFEST.pattern).toBe("native-field");
    expect(STELLAR_MANIFEST.nativeField).toBe("cap67-mux-id");
    expect(STELLAR_MANIFEST.weldGrades["cap67-mux"]).toBe("signature");
    // ★ the whole point: only atrHash[:8] rides on-chain, so neither recoverable-from-settlement-alone
    // nor forward-indexable is claimed.
    expect(STELLAR_MANIFEST.recovery.zeroPartyRecoverable).toBe(false);
    expect(STELLAR_MANIFEST.recovery.forwardIndexable).toBe(false);
    expect(STELLAR_MANIFEST.indexing).toBe("account-scan:mux-prefix8");
    expect(STELLAR_MANIFEST.assetBinding).toBe("none");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail records failed transactions, so recovery must read the chain's outcome field.
    expect(STELLAR_MANIFEST.successGate).toBe("raw-field");
    expect(STELLAR_MANIFEST.finality.note).toMatch(/atrHash\[:8\]/);
    expect(STELLAR_MANIFEST.finality.note).toMatch(
      /does NOT recover the full hash/,
    );
  });
});
