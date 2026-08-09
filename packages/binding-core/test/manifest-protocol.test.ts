import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isKnownProtocolId } from "../src/protocol-id.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const profile = read("../../../vectors/binding/x402-profile.json") as {
  rail: string;
  protocol?: string;
};

const schema = read("../../../vectors/binding/profile.schema.json") as {
  required?: string[];
  properties: { protocol: { enum: string[] } };
};

// The canonical enum lives in vocabulary/protocol-id.schema.json. This schema INLINES it (no cross-file
// $ref — the runner passes schemas inline and the subject's validator has no file resolver), so the copy
// is guarded here instead. Same union-equals-tree discipline as protocol-id.test.ts.
const canonical = read(
  "../../../vectors/vocabulary/protocol-id.schema.json",
) as { enum: string[] };

// Every profile that must NOT declare a protocol: escrow is a mechanism, and the seven bare rails bind no
// protocol at all. Their omission is the designed state, not an oversight, and the schema's non-required
// `protocol` is what makes it legal.
//
// `sui` is NOT in this list, and the reason is the field's contract rather than a preference. Pay402 is an
// x402 facilitator — Move module `x402_payment`, a `facilitator_fee` parameter — so under `absent iff
// protocol-neutral` its silence was a false claim of neutrality, and it made "which rails settle x402?"
// answer `evm:x402` alone. Moving it here again would reinstate that.
const PROTOCOL_NEUTRAL_PROFILES = [
  "escrow",
  "aptos",
  "canton",
  "cardano",
  "hedera",
  "solana",
  "stellar",
];

describe("BindingManifest.protocol", () => {
  it("the x402 profile declares its protocol", () => {
    expect(profile.protocol).toBe("x402");
    expect(isKnownProtocolId(profile.protocol)).toBe(true);
  });

  it("protocol is never required — a protocol-neutral binding legitimately omits it", () => {
    expect(schema.required ?? []).not.toContain("protocol");
  });

  it("rail stays the scheme id and is NOT the protocol id", () => {
    expect(profile.rail).toBe("evm:x402");
    expect(isKnownProtocolId(profile.rail)).toBe(false);
  });

  it("the inlined protocol enum equals the canonical vocabulary schema exactly", () => {
    expect(schema.properties.protocol.enum).toEqual(canonical.enum);
  });

  for (const name of PROTOCOL_NEUTRAL_PROFILES) {
    it(`the ${name} profile declares NO protocol — absence is the designed state`, () => {
      const p = read(`../../../vectors/binding/${name}-profile.json`) as {
        protocol?: string;
      };
      expect(p.protocol).toBeUndefined();
    });
  }
});

// Each published profile exists TWICE — as `vectors/binding/<rail>-profile.json`, which the rail's own
// manifest test compares its manifest against, and as a `profile-documents.json` case asserting the
// schema accepts it. Nothing related the two copies, and they had drifted: the case named "the published
// integra-x402-nonce-v1" was missing the `protocol` field its own profile carries. A case that calls
// itself the published profile and is not it certifies the wrong bytes, so the relation is a gate now
// rather than a convention.
describe("published profiles and their corpus copies", () => {
  const docs = read("../../../vectors/binding/profile-documents.json") as {
    cases: { name: string; input: Record<string, unknown> }[];
  };
  // Only the ACCEPTING cases can certify published bytes; the rejection cases deliberately carry mangled
  // copies and reuse profile ids, so they are not candidates.
  const accepted = docs.cases
    .filter((c) => (c as { expected?: unknown }).expected === true)
    .map((c) => c.input);

  // Read off the directory, never hand-kept: a profile added without a corpus case fails here rather than
  // being skipped by a loop that was never told about it. This is the same rule the publishable set follows
  // — derive the property, do not restate it.
  const profileFiles = readdirSync(
    new URL("../../../vectors/binding/", import.meta.url),
  ).filter((f) => f.endsWith("-profile.json"));

  it("finds every published profile file", () => {
    // 12 -> 13 on 2026-08-08: Canton gained a SECOND rail. `canton` keeps the LcpAnchor overlay for
    // deployments x402's exact-Canton scheme cannot reach (it settles Canton Coin only), and
    // `canton:x402` binds the scheme's own `extra.memo`. One chain, two carriers, two profiles — the
    // shape EVM has had since it grew evm:escrow and evm:mpp beside evm:x402, because a manifest can
    // honestly describe exactly one carrier.
    expect(profileFiles).toHaveLength(13);
  });

  it.each(profileFiles)(
    "%s is certified by the corpus with its published bytes",
    (file) => {
      const publishedFile = read(`../../../vectors/binding/${file}`);
      expect(accepted).toContainEqual(publishedFile);
    },
  );
});
