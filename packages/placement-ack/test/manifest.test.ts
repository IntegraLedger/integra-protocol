import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { ACK_PLACEMENT } from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("ACK placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/ack.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(ACK_PLACEMENT))).toEqual(vec.manifest);
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(ACK_PLACEMENT)),
      ).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    expect(() => assertManifestHygiene(ACK_PLACEMENT)).not.toThrow();
  });

  it("the field is TWO levels deep and the alias is an INTEGRITY spelling, not a discovery carrier", () => {
    // The two facts that distinguish this manifest from every placement shipped before it, as data. The
    // two-level path is what makes ACK the first protocol to evidence both halves of the kit's
    // malformed-container rule; the alias carrying no carrierClass and no write flag is what says the
    // snake_case spelling is the same guarantee under a different key, read but never written.
    expect(ACK_PLACEMENT.field.split(".")).toHaveLength(3);
    expect(ACK_PLACEMENT.readAlso?.[0]?.carrierClass).toBeUndefined();
    expect(ACK_PLACEMENT.readAlso?.[0]?.write).toBeUndefined();
    // ACK's receipt models no terms URL, so a parser must not be told to demand one.
    expect(ACK_PLACEMENT.termsUrlField).toBeUndefined();
  });
});
