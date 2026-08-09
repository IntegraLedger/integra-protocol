import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { X402_MANIFEST } from "../src/manifest.js";

// The published named-profile document (also a `binding.profiles` conformance case, validated against
// vectors/binding/profile.schema.json). This test closes the drift between the TS manifest and the
// published JSON artifact: the profile IS the manifest plus its named-profile `profile` identifier.
const PROFILE = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/x402-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("X402_MANIFEST ↔ published profile", () => {
  it("the profile equals the manifest plus the named-profile id", () => {
    const { profile, ...manifest } = PROFILE;
    expect(manifest).toEqual(X402_MANIFEST);
    expect(profile).toBe("integra-x402-nonce-v1");
    expect(X402_MANIFEST.offCanonical?.profile).toBe(profile);
  });

  it("declares native-field with the eip3009.nonce as its bound field, not id-reuse", () => {
    expect(X402_MANIFEST.pattern).toBe("native-field");
    expect(X402_MANIFEST.nativeField).toBe("eip3009.nonce");
    expect(X402_MANIFEST.assetBinding).toBe("filtered");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail cannot produce a failed transaction that still carries a weld.
    expect(X402_MANIFEST.successGate).toBe("structural");
    // The WLD-3 triple: the nonce is on-chain, zero-party recoverable, and forward-indexable.
    expect(X402_MANIFEST.recovery).toEqual({
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: true,
    });
  });
});
