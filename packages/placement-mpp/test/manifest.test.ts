import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import {
  assertManifestHygiene,
  INTEGRITY_CARRIER_TYPES,
  KNOWN_PROTOCOL_IDS,
} from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { MPP_PLACEMENT } from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("MPP placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/mpp.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(MPP_PLACEMENT))).toEqual(vec.manifest);
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(MPP_PLACEMENT)),
      ).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    expect(() => assertManifestHygiene(MPP_PLACEMENT)).not.toThrow();
  });
});

describe("MPP placement — the manifest guards its own claims", () => {
  it("is a placement, not a binding — no settlement claim rides this manifest", () => {
    // NOT `expect(MPP_PLACEMENT).not.toHaveProperty("recovery")` — `PlacementManifest` cannot carry that
    // field and the schema sets additionalProperties:false, so such an assertion would test the type system
    // rather than the code. What is worth pinning is the SEPARATION: the MPP placement and the two MPP
    // bindings (binding-evm-mpp, binding-tempo-mpp) describe different things, and only the bindings may
    // claim a weld. `http-advisory` is the pattern that says so.
    expect(MPP_PLACEMENT.pattern).toBe("http-advisory");
    expect(MPP_PLACEMENT.protocol).toBe("mpp");
    expect(KNOWN_PROTOCOL_IDS).toContain("mpp");
  });

  it("the bare slot is capped at ONE integrity-bearing carrier type", () => {
    // The cap is what makes `bare-value` readable at all: nothing in `methodDetails.atrHash` tags the type,
    // so the field's own contract has to fix it. Pinned here as well as in the schema because it is also the
    // reason the next test can be stated at all.
    expect(MPP_PLACEMENT.encoding).toBe("bare-value");
    expect(MPP_PLACEMENT.carrierTypes).toEqual(["sha256"]);
    expect(INTEGRITY_CARRIER_TYPES).toContain(MPP_PLACEMENT.carrierTypes[0]);
  });

  it("declares NO discovery alias — the cap forbids one, and that is the correct answer", () => {
    // A url-typed `readAlso` would need a second permitted carrier type and the cap refuses it. So the terms
    // URL is declared as `termsUrlField` — labelled as the different datum it is — and never as a fallback
    // the reference read could silently descend to. LCP §C.2 rules out exactly that substitution — v1.37
    // as a MUST NOT, v1.38 as a statement of fact ("is not a substitute for one").
    expect(MPP_PLACEMENT.readAlso).toBeUndefined();
    expect(MPP_PLACEMENT.termsUrlFields).toEqual([
      "methodDetails.legalContextUrl",
    ]);
    expect(MPP_PLACEMENT.termsUrlFields).not.toContain(MPP_PLACEMENT.field);
  });

  it("both declared locators sit INSIDE methodDetails — the challenge-bound part of the body", () => {
    // The package's central claim, as data. `methodDetails` is a member of the `request` body, which is slot
    // 3 of the challenge binding; a locator that drifted to the outer challenge would be unbound (Tier B)
    // while still reading as Tier A on this manifest.
    expect(MPP_PLACEMENT.field).toBe("methodDetails.atrHash");
    for (const locator of [
      MPP_PLACEMENT.field,
      ...(MPP_PLACEMENT.termsUrlFields ?? []),
    ])
      expect(locator).toMatch(/^methodDetails\./);
  });
});
