import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { AP2_PLACEMENT } from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("AP2 placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/ap2.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(AP2_PLACEMENT))).toEqual(vec.manifest);
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(AP2_PLACEMENT)),
      ).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    expect(() => assertManifestHygiene(AP2_PLACEMENT)).not.toThrow();
  });

  it("the declared field is the TRANSPORT's metadata map, never a path into the mandate", () => {
    // The mandate boundary as data. `object-path` at `metadata.legalContext` cannot reach a mandate no
    // matter what document it is handed, which is why the tier-B shape is unreachable by construction
    // rather than by discipline. A future edit that widened this locator fails here first.
    expect(AP2_PLACEMENT.container).toEqual({ kind: "object-path" });
    expect(AP2_PLACEMENT.field).toBe("metadata.legalContext");
    for (const path of [
      AP2_PLACEMENT.field,
      ...(AP2_PLACEMENT.readAlso ?? []).map((a) => a.path),
    ])
      expect(path.startsWith("metadata.")).toBe(true);
  });

  it("the snake_case alias is the same datum — integrity class, and never written", () => {
    // Contrast UCP, whose alias is a url-typed DISCOVERY carrier in a different container. Here the alias
    // is one spelling of the same reference object, so it takes both defaults, and pinning that keeps the
    // defaults a decision rather than an omission.
    expect(AP2_PLACEMENT.readAlso).toEqual([
      { path: "metadata.legal_context" },
    ]);
    expect(AP2_PLACEMENT.readAlso?.[0]?.carrierClass).toBeUndefined();
    expect(AP2_PLACEMENT.readAlso?.[0]?.write).toBeUndefined();
  });

  it("declares no termsUrlField — AP2 has no room for one on the transport envelope", () => {
    // Absent means a parser MUST NOT demand one. The envelope's metadata map holds the reference; there is
    // no protocol-native slot for a human-readable terms URL beside it, and a url-typed reference is how a
    // deployment that only has a link says so.
    expect(AP2_PLACEMENT.termsUrlFields).toBeUndefined();
  });
});
