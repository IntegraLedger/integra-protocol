import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import * as pkg from "../src/index.js";
import {
  LCP_TERMS_HASH_SUFFIX,
  makeMastercardViPlacement,
  mastercardViManifest,
} from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

/** The namespace the vectors and the conformance registry both use — this deployment's own (2026-07-29). */
const OURS = "com.integraledger";

describe("Mastercard VI placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/mastercard-vi.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(mastercardViManifest(OURS)))).toEqual(
      vec.manifest,
    );
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(mastercardViManifest(OURS))),
      ).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    expect(() =>
      assertManifestHygiene(mastercardViManifest(OURS)),
    ).not.toThrow();
  });

  it("declares tier B — a stock verifier REJECTS the mandate, it does not skip the constraint", () => {
    // The correction this unit lands. The completion plan specced Tier A on §C.7's closed-mandate reading;
    // the live specification carries constraints only in open mandates and requires verifiers to reject
    // open mandates carrying unknown types regardless of strictness mode.
    expect(mastercardViManifest(OURS).tier).toBe("B");
  });

  it("is opaque-challenge — committed to a signed structure, never on-chain", () => {
    // NOT sidecar-attestation (no anchored on-chain transaction exists) and NOT protocol-extension (no VI
    // verifier is atrHash-aware, and the registered type's name is the TWG's to assign).
    expect(mastercardViManifest(OURS).pattern).toBe("opaque-challenge");
  });

  it("REFUSES to build without a namespace — there is no default", () => {
    expect(() => mastercardViManifest("")).toThrow(/no default/);
    expect(() => makeMastercardViPlacement("   ")).toThrow(/no default/);
  });

  it("REFUSES a namespace that is not a lowercase reverse domain", () => {
    // A bare label is not collision-resistant; an upper-cased or colon-bearing spelling is a SECOND spelling
    // of one namespace, and the constraint `type` the host compares is never case-folded.
    //
    // The last two cases exist for the END anchor specifically, and they are the ones a real deployment hits:
    // a namespace whose PREFIX is a valid reverse domain and whose tail is not. Without the anchor,
    // `"com.example "` would build the tag `com.example .lcp_terms_hash` — a wire spelling with a space in it
    // that no counterparty could ever match — and the trailing-junk spellings would each mint a distinct
    // carrier under what reads as one namespace.
    for (const bad of [
      "nonsense",
      "com.Example",
      "urn:example",
      "com.",
      ".com",
      "com example",
      " com.example",
      "com.example ",
      "com.exampleX",
    ])
      expect(() => mastercardViManifest(bad)).toThrow(/reverse-domain/);
  });

  it("ACCEPTS the digits and hyphens a real reverse domain carries", () => {
    // Guards the character class from the other side: a namespace this factory should build must not be
    // refused, or the guard would be narrowing what a deployment may own.
    expect(() => mastercardViManifest("com.integra-ledger2.eu")).not.toThrow();
  });

  it("REFUSES the namespace reserved for a TSC-ratified capability", () => {
    expect(() => mastercardViManifest("org.legalcontextprotocol")).toThrow(
      /reserved/,
    );
    expect(() => mastercardViManifest("org.legalcontextprotocol.demo")).toThrow(
      /reserved/,
    );
  });

  it("puts the namespace in the tag, the locator and nowhere else", () => {
    const m = mastercardViManifest("com.example");
    if (m.container.kind !== "tagged-array")
      throw new Error("the container is a tagged array");
    expect(m.container.tag).toBe(`com.example.${LCP_TERMS_HASH_SUFFIX}`);
    expect(m.field).toBe(`constraints[type=com.example.lcp_terms_hash].value`);
    expect(m.container.at).toBe("constraints");
    expect(m.container.tagField).toBe("type");
    expect(m.container.valueField).toBe("value");
  });

  it("declares NO writeCondition — there is no write for one to gate", () => {
    // It carried one until 2026-08-08, permitting the two OPEN mandates. That was the correct reading of
    // where a constraint could sit, and `binding-core` acted on it — place() gates on writeCondition alone
    // and never reads `tier`, so `tier: "B"` was a label rather than a gate. LCP v1.38 §C.7 withdrew the
    // write entirely, which leaves a writeCondition inert: a reader meeting one would infer the placement
    // writes under some condition, and it never writes at all.
    expect(mastercardViManifest(OURS).writeCondition).toBeUndefined();
  });

  it("is sha256-ONLY — a bare value carries no type tag, so the list must fix one type", () => {
    expect(mastercardViManifest(OURS).carrierTypes).toEqual(["sha256"]);
  });

  it("declares NO alias — the eight registered constraint types are not LCP carriers", () => {
    // VI offers one carrier for legal context and inventing a second would be a claim about the host. The
    // registered types carry the consumer's authorization bounds, not the merchant's terms.
    expect(mastercardViManifest(OURS).readAlso).toBeUndefined();
    expect(mastercardViManifest(OURS).termsUrlFields).toBeUndefined();
  });

  it("exports a factory and nothing that could carry a default namespace", () => {
    // The export surface is PINNED, not pattern-matched: a regex only catches names someone guessed, while an
    // exact set catches ANY new export — including a convenience singleton built on an Integra-owned
    // namespace, which is the one thing this package must not offer.
    expect(Object.keys(pkg).sort()).toEqual([
      "LCP_TERMS_HASH_SUFFIX",
      "makeMastercardViPlacement",
      "mastercardViManifest",
    ]);
  });
});
