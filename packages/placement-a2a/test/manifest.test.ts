import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { A2A_PLACEMENT } from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("A2A placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/a2a.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(A2A_PLACEMENT))).toEqual(vec.manifest);
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(A2A_PLACEMENT)),
      ).valid,
    ).toBe(true);
  });

  it("passes manifest hygiene", () => {
    expect(() => assertManifestHygiene(A2A_PLACEMENT)).not.toThrow();
  });

  it("declares ONE field — the Agent Card is discovery, not a second placement", () => {
    expect(A2A_PLACEMENT.field).toBe("metadata.legalContext");
    expect(Object.keys(A2A_PLACEMENT)).not.toContain("fields");
  });

  it("canonical is camelCase because A2A's house style is, not because ours is", () => {
    expect(A2A_PLACEMENT.field.endsWith("legalContext")).toBe(true);
    expect(A2A_PLACEMENT.readAlso?.[0]?.path).toBe("metadata.legal_context");
  });

  it("the snake_case alias is INTEGRITY and is never written — a spelling is not a guarantee", () => {
    // The class axis separates carriers, not spellings: the alias IS the reference field under a second
    // name, so it holds whatever that field holds — a `url` included, which `carrierTypes` permits and which
    // the canonical path is labelled `integrity` for too. And `place` writes one field, so a second copy of
    // the same fact never reaches the wire. Both are defaults, which is exactly why they are pinned: a
    // default that nothing asserts is a default that can drift.
    expect(A2A_PLACEMENT.readAlso).toHaveLength(1);
    expect(A2A_PLACEMENT.readAlso?.[0]?.carrierClass).toBeUndefined();
    expect(A2A_PLACEMENT.readAlso?.[0]?.write).toBeUndefined();
  });

  it("permits the WHOLE §8.2 carrier registry — A2A imposes no length budget on a metadata value", () => {
    expect([...A2A_PLACEMENT.carrierTypes].sort()).toEqual([
      "ar",
      "ipfs",
      "sha256",
      "url",
    ]);
  });

  it("models no terms URL — A2A has no field for one, so a parser must not demand it", () => {
    expect(A2A_PLACEMENT.termsUrlFields).toBeUndefined();
  });
});
