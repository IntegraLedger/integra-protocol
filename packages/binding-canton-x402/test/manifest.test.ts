import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANTON_X402_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL(
      "../../../vectors/binding/canton-x402-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;

describe("CANTON_X402_MANIFEST", () => {
  it("matches the published integra-canton-x402-memo-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-canton-x402-memo-v1");
    expect(CANTON_X402_MANIFEST).toEqual(rest);
  });

  it("is a native-field binding WITH a nativeField (the iff, in the other direction)", () => {
    // Until 2026-08-08 this asserted the opposite, on the premise that "Daml has no native
    // arbitrary-bytes carrier on a transaction". x402's exact-Canton scheme defines one:
    // PaymentRequirements.extra.memo, echoed by the payer into the transfer metadata under `x402.memo`
    // and rejected by the facilitator on mismatch (safety check 12).
    expect(CANTON_X402_MANIFEST.pattern).toBe("native-field");
    expect(CANTON_X402_MANIFEST.nativeField).toBe("x402.memo");
    expect(profile["nativeField"]).toBe("x402.memo");
  });

  it("declares its protocol — the carrier is x402's, not Canton's own", () => {
    // An absent `protocol` is a positive claim of protocol-neutrality. This binding cannot make it: the
    // field, its 256-byte ceiling and its enforcement are all x402's, and a Canton Coin payment settled
    // outside x402 does not get this carrier.
    expect(CANTON_X402_MANIFEST.protocol).toBe("x402");
  });

  it("binds the asset, because the weld now rides the transfer that moves it", () => {
    // The overlay this replaced declared `assetBinding: "none"` and meant it — an LcpAnchor was a
    // SEPARATE contract, so recovery never observed what settled. The memo rides the
    // TransferFactory_Transfer itself, and CantonX402TransferView carries the receiver, amount and
    // instrument to the caller, which is the axis's actual test.
    expect(CANTON_X402_MANIFEST.assetBinding).toBe("carried");
  });

  it("is tx-grade, participant-scoped, and NOT zero-party recoverable", () => {
    expect(CANTON_X402_MANIFEST.weldGrades["x402-memo"]).toBe("tx");
    // Unchanged by the carrier move, and for the unchanged reason: Daml visibility is limited to
    // stakeholders, so a neutral verifier holding only a settlement reference sees nothing until a party
    // grants access. §8.3 asks whether an auditor can recover from the reference ALONE.
    expect(CANTON_X402_MANIFEST.recovery.zeroPartyRecoverable).toBe(false);
    expect(CANTON_X402_MANIFEST.recovery.forwardIndexable).toBe(false);
    expect(CANTON_X402_MANIFEST.recovery.onChain).toBe(true);
    // A transfer that did not commit produces no update, so there is no failed view whose memo could be
    // misread as a settlement.
    expect(CANTON_X402_MANIFEST.successGate).toBe("structural");
    expect(CANTON_X402_MANIFEST.indexing).toBe(
      "participant-updates:transfer.meta.x402.memo",
    );
    expect(CANTON_X402_MANIFEST.lifecycleStates).toEqual([
      "proposed",
      "settled",
    ]);
    expect(CANTON_X402_MANIFEST.finality.reversible).toBe(false);
  });
});
