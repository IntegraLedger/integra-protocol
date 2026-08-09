import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANTON_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/canton-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("CANTON_MANIFEST", () => {
  it("matches the published integra-canton-overlay-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-canton-overlay-v1");
    expect(CANTON_MANIFEST).toEqual(rest);
  });

  it("is an overlay-contract binding with NO nativeField (the iff)", () => {
    expect(CANTON_MANIFEST.pattern).toBe("overlay-contract");
    expect(CANTON_MANIFEST.nativeField).toBeUndefined();
    expect("nativeField" in profile).toBe(false);
  });

  it("is tx-grade with a participant-query lookup and no global forward index", () => {
    expect(CANTON_MANIFEST.weldGrades["lcp-anchor"]).toBe("tx");
    expect(CANTON_MANIFEST.recovery.forwardIndexable).toBe(false);
    // FALSE: §8.3 asks whether an auditor can recover from the settlement reference ALONE, without
    // trusting either party. LcpAnchor is visible only to its stakeholders — buyer and seller — and the
    // reader needs a JWT authenticating one of them. No private key is required; a party's cooperation is.
    expect(CANTON_MANIFEST.recovery.zeroPartyRecoverable).toBe(false);
    expect(CANTON_MANIFEST.assetBinding).toBe("none");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail cannot produce a failed transaction that still carries a weld.
    expect(CANTON_MANIFEST.successGate).toBe("structural");
    expect(CANTON_MANIFEST.indexing).toBe(
      "participant-query:LcpAnchor.atrHash",
    );
    expect(CANTON_MANIFEST.lifecycleStates).toEqual(["proposed", "anchored"]);
    expect(CANTON_MANIFEST.finality.reversible).toBe(false);
  });
});
