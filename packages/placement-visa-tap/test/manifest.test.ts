import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import * as pkg from "../src/index.js";
import { VISA_TAP_PLACEMENT } from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("Visa TAP placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/visa-tap.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(VISA_TAP_PLACEMENT))).toEqual(
      vec.manifest,
    );
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(VISA_TAP_PLACEMENT)),
      ).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    expect(() => assertManifestHygiene(VISA_TAP_PLACEMENT)).not.toThrow();
  });

  it("declares tier A http-advisory — nothing here implies the header is bound", () => {
    expect(VISA_TAP_PLACEMENT.tier).toBe("A");
    expect(VISA_TAP_PLACEMENT.pattern).toBe("http-advisory");
  });

  it("is sha256-ONLY — a bare value carries no type tag, so the list must fix one type", () => {
    // Not conservatism: a header holds a scalar, and a second permitted type would leave a reader unable to
    // tell a hash from a URL. `url` is excluded so an uncovered header is never also an unattested target.
    expect(VISA_TAP_PLACEMENT.carrierTypes).toEqual(["sha256"]);
  });

  it("declares NO alias — TAP offers exactly one Tier A carrier and inventing a second would be a claim", () => {
    // Six of the ten Appendix C protocols carry two Tier A carriers; TAP is not one of them. §C.6's other
    // integration points all require coordination, so there is nothing to read besides the header.
    expect(VISA_TAP_PLACEMENT.readAlso).toBeUndefined();
    expect(VISA_TAP_PLACEMENT.termsUrlField).toBeUndefined();
  });

  it("exports NO helper that builds an unsigned sibling body object", () => {
    // The single worst thing this package could ship is a sibling carrying the reference WITHOUT its own
    // nonce/kid/alg/signature quartet: it does not inherit TAP's signature chain (the spec requires each body
    // object's nonce to MATCH the message signature's, so a mismatch invalidates the binding even when the
    // object's own signature verifies), is silently replaceable, and would look bound to a reader. The
    // anti-pattern must be unbuildable from this surface, not merely discouraged in a comment.
    // The export surface is PINNED, not pattern-matched: a regex only catches names someone guessed, while an
    // exact set catches ANY new export — including one added later under a name nobody thought to forbid.
    expect(Object.keys(pkg).sort()).toEqual([
      "VISA_TAP_PLACEMENT",
      "visaTapPlacement",
    ]);
  });
});
