import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APTOS_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/aptos-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("APTOS_MANIFEST", () => {
  it("matches the published integra-aptos-overlay-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-aptos-overlay-v1");
    expect(APTOS_MANIFEST).toEqual(rest);
  });

  it("is a signature-grade overlay-contract binding with NO nativeField (the iff) and no forward index", () => {
    expect(APTOS_MANIFEST.pattern).toBe("overlay-contract");
    // overlay-contract → NO nativeField (profile.schema.json enforces the iff both ways).
    expect("nativeField" in APTOS_MANIFEST).toBe(false);
    expect(APTOS_MANIFEST.weldGrades["settle-payment"]).toBe("signature");
    expect(APTOS_MANIFEST.recovery.forwardIndexable).toBe(false);
    expect(APTOS_MANIFEST.indexing).toBe(
      "candidate-set:payment::PaymentSettled",
    );
    // Bound at PROPOSAL, blind at recovery — the fourth measured case.
    expect(APTOS_MANIFEST.assetBinding).toBe("proposal-only");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail records failed transactions, so recovery must read the chain's outcome field.
    expect(APTOS_MANIFEST.successGate).toBe("raw-field");
  });

  it("declares finality as never dispute resolution (PAY-3/RCS-5)", () => {
    expect(APTOS_MANIFEST.finality.reversible).toBe(false);
    expect(APTOS_MANIFEST.finality.note).toMatch(/never dispute resolution/);
  });
});
