import { readFileSync } from "node:fs";
import { KNOWN_PROTOCOL_IDS } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { MPP_EVM_MANIFEST } from "../src/manifest.js";

const read = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<
    string,
    unknown
  >;

// The published profile document — also the `binding.profiles` conformance case pinned in
// vectors/binding/profile-documents.json, validated against vectors/binding/profile.schema.json. This test
// closes the drift between the TS manifest and the published JSON artifact.
const PROFILE = read("../../../vectors/binding/mpp-evm-profile.json");

describe("MPP_EVM_MANIFEST ↔ published profile", () => {
  it("the profile equals the manifest plus the named-profile id", () => {
    const { profile, ...manifest } = PROFILE;
    expect(manifest).toEqual(MPP_EVM_MANIFEST);
    expect(profile).toBe("mpp-evm-derived-v1");
  });

  it("the corpus case for this profile carries the SAME document — one profile, one truth", () => {
    const { cases } = JSON.parse(
      readFileSync(
        new URL(
          "../../../vectors/binding/profile-documents.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { cases: { input: { profile?: string }; expected: unknown }[] };
    const pinned = cases.filter(
      (c) => c.input.profile === "mpp-evm-derived-v1",
    );
    // Exactly one, or a second copy could drift from this one unnoticed — which is the failure this test
    // exists to prevent, not merely the inequality below.
    expect(pinned).toHaveLength(1);
    expect(pinned[0]?.input).toEqual(PROFILE);
    expect(pinned[0]?.expected).toBe(true);
  });
});

describe("what the manifest declares, and what it must never claim", () => {
  it("is id-reuse on evm:mpp for the mpp protocol", () => {
    expect(MPP_EVM_MANIFEST.pattern).toBe("id-reuse");
    expect(MPP_EVM_MANIFEST.rail).toBe("evm:mpp");
    expect(MPP_EVM_MANIFEST.protocol).toBe("mpp");
    expect(KNOWN_PROTOCOL_IDS).toContain("mpp");
  });

  it("carries NO nativeField — the schema's iff, and the substance: nothing of ours occupies a protocol field", () => {
    // The EIP-3009 nonce is a derivation MUST (draft-evm-charge-00 §5.3.1) and the Permit2 witness type
    // string is fixed (§5.2.3), so there is no field on this rail we are free to fill. Declaring one would
    // read as the x402 binding, which genuinely does occupy the nonce.
    expect(MPP_EVM_MANIFEST.nativeField).toBeUndefined();
  });

  it("carries NO offCanonical profile — id-reuse is fully spec-compliant, not an off-canonical variant", () => {
    // §8.3.1's off-canonical escape hatch belongs to Native Field, where a field specified as
    // client-chosen is repurposed. Id-Reuse executes the host's own derivation, so there is nothing to
    // opt into and a named off-canonical profile would misdescribe it.
    expect(MPP_EVM_MANIFEST.offCanonical).toBeUndefined();
  });

  it("declares the WLD-3 triple: on-chain, NOT zero-party recoverable, NOT forward-indexable", () => {
    expect(MPP_EVM_MANIFEST.recovery).toEqual({
      onChain: true,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
    });
    // `indexing` must agree with the triple: a binding that is not forward-indexable has no index to name.
    expect(MPP_EVM_MANIFEST.indexing).toBe("none");
    expect(MPP_EVM_MANIFEST.assetBinding).toBe("filtered");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail cannot produce a failed transaction that still carries a weld.
    expect(MPP_EVM_MANIFEST.successGate).toBe("structural");
  });

  it("grades the weld under ONE credential type — the only one of MPP's four that reaches the chain", () => {
    // The key is MPP's own credential-type name (draft-evm-charge-00 §5.3), not a coinage: it is what scopes
    // `recovery.onChain: true` to the mode that actually puts the challengeHash on-chain. `permit2` (§5.2,
    // RECOMMENDED) signs the same derived value off-chain and `transaction`/`hash` (§5.4/§5.5) bind nothing,
    // so a grade for any of the three would be declared from the spec rather than from this binding.
    expect(MPP_EVM_MANIFEST.weldGrades).toEqual({ authorization: "signature" });
  });

  it("declares finality without dressing it as dispute resolution (PAY-3/RCS-5)", () => {
    expect(MPP_EVM_MANIFEST.finality.reversible).toBe(false);
    expect(MPP_EVM_MANIFEST.finality.note).toMatch(/PAY-3\/RCS-5/);
    // The finality note cites the HOST specification's own section, not LCP's informative appendix.
    expect(MPP_EVM_MANIFEST.finality.note).toMatch(/draft-evm-charge-00/);
  });

  it("the finality note carries the credential-type scope, so the profile document carries it too", () => {
    // `weldGrades` is the machine-readable scope; the note is the half a human reads out of the published
    // profile. Both must say it, or a consumer reading only the profile JSON sees an unscoped `onChain: true`.
    expect(MPP_EVM_MANIFEST.finality.note).toMatch(
      /`authorization` credential type \(§5\.3\)/,
    );
  });

  it("has exactly two lifecycle states — proposed off-chain, settled on-chain, and no third to invent", () => {
    expect(MPP_EVM_MANIFEST.lifecycleStates).toEqual(["proposed", "settled"]);
  });
});
