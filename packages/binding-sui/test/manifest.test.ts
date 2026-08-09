import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUI_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/sui-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("SUI_MANIFEST", () => {
  it("matches the published integra-sui-pay402-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-sui-pay402-v1");
    expect(SUI_MANIFEST).toEqual(rest);
  });

  it("is a signature-grade native-field binding with no forward index (event scan only)", () => {
    expect(SUI_MANIFEST.pattern).toBe("native-field");
    expect(SUI_MANIFEST.nativeField).toBe("pay402-payment-id");
    // Pay402 is an x402 facilitator, not a bare-rail primitive. Pinned because the field's contract is
    // `absent iff protocol-neutral`, so silence here would be a positive claim of neutrality.
    expect(SUI_MANIFEST.protocol).toBe("x402");
    expect(SUI_MANIFEST.weldGrades["pay402"]).toBe("signature");
    expect(SUI_MANIFEST.recovery.forwardIndexable).toBe(false);
    expect(SUI_MANIFEST.recovery.zeroPartyRecoverable).toBe(true);
    expect(SUI_MANIFEST.indexing).toBe("event-scan:PaymentSettled.payment_id");
    // Bound at PROPOSAL, blind at recovery — the fourth measured case.
    expect(SUI_MANIFEST.assetBinding).toBe("proposal-only");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail cannot produce a failed transaction that still carries a weld.
    expect(SUI_MANIFEST.successGate).toBe("structural");
  });
});
