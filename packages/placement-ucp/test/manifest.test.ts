import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { UCP_PLACEMENT } from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("UCP placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/ucp.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(UCP_PLACEMENT))).toEqual(vec.manifest);
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(UCP_PLACEMENT)),
      ).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    expect(() => assertManifestHygiene(UCP_PLACEMENT)).not.toThrow();
  });

  it("the capability is the canonical carrier and the links entry is DISCOVERY — Ruling B, as data", () => {
    // The re-cut's whole point, pinned: integrity first, discovery declared as what it is.
    expect(UCP_PLACEMENT.carrierTypes).toContain("sha256");
    expect(UCP_PLACEMENT.readAlso?.[0]?.carrierClass).toBe("discovery");
    expect(UCP_PLACEMENT.readAlso?.[0]?.write).toBeUndefined();
  });
});
