import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { LEGAL_CONTEXT_SCHEMA, X402_PLACEMENT } from "../src/index.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

describe("x402 placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    const vec = read("../../../vectors/placement/x402.json") as {
      manifest: Record<string, unknown>;
    };
    expect(JSON.parse(JSON.stringify(X402_PLACEMENT))).toEqual(vec.manifest);
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    const schema = read(
      "../../../vectors/placement/placement.schema.json",
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(
        JSON.parse(JSON.stringify(X402_PLACEMENT)),
      ).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    expect(() => assertManifestHygiene(X402_PLACEMENT)).not.toThrow();
  });

  it("the alias declares its OWN encoding — the one placement where alias and canonical shapes differ", () => {
    // The whole reason `PlacementAlias` carries an `encoding` at all. The canonical slot holds a §8.1
    // object; the alias holds a bare hash, because that is what seller-x402 emits and what x402
    // integrators read.
    expect(X402_PLACEMENT.encoding).toBe("reference-object");
    expect(X402_PLACEMENT.readAlso?.[0]?.encoding).toBe("bare-value");
    expect(X402_PLACEMENT.readAlso?.[0]?.bareType).toBe("sha256");
  });

  it("no alias declares `write` — the override writes ONE carrier and would ignore a second", () => {
    // Load-bearing, not decorative: `place` here is hand-written and does not loop `readAlso`, so an alias
    // that declared `write` would be silently dropped. Whoever adds one must change the override too, and
    // this is the assertion that tells them.
    expect(X402_PLACEMENT.readAlso?.every((a) => a.write === undefined)).toBe(
      true,
    );
  });

  it("declares the terms-URL half, distinct from the reference field", () => {
    // x402 is the protocol whose wire carries both halves — binding-core's own contract says so — so the
    // URL path is declared rather than left as a second private convention inside seller-x402 (G-C).
    expect(X402_PLACEMENT.termsUrlField).toBe(
      "extensions.legalContext.info.legalContextUrl",
    );
    expect(X402_PLACEMENT.termsUrlField).not.toBe(X402_PLACEMENT.field);
  });

  it("the exported schema is the one the vectors pin — the seller cannot drift from it", () => {
    // `schema` is a REQUIRED x402 member, so this literal is on the wire of every challenge. It was a
    // `$ref` at a URL that returned 404 until 2026-08-08; inlining removes a hosting dependency the
    // deployment does not meet, and matches all nine extensions published in the x402 repository — one of
    // which, Bazaar, forbids an external `$ref` outright. See the manifest docblock.
    const vec = read("../../../vectors/placement/x402.json") as {
      cases: { expected?: unknown }[];
    };
    const placed = vec.cases[0]?.expected as {
      value: {
        extensions: { legalContext: { schema: Record<string, unknown> } };
      };
    };
    expect(placed.value.extensions.legalContext.schema).toEqual(
      LEGAL_CONTEXT_SCHEMA,
    );
  });

  it("the inlined schema is a self-contained JSON Schema, not a pointer", () => {
    // The whole point of the change: a counterparty can validate `info` from what the challenge carries.
    expect(LEGAL_CONTEXT_SCHEMA["$ref"]).toBeUndefined();
    expect(LEGAL_CONTEXT_SCHEMA["$schema"]).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(LEGAL_CONTEXT_SCHEMA["required"]).toEqual(["type", "value"]);
  });

  it("it describes the §8.1 reference object this placement actually writes", () => {
    // A schema that did not match the emitted `info` would be worse than no schema — it would invite a
    // counterparty to reject a conformant challenge.
    const props = LEGAL_CONTEXT_SCHEMA["properties"] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["type", "value"]);
    expect((props["type"] as { enum: string[] }).enum).toEqual(
      X402_PLACEMENT.carrierTypes.length > 0
        ? ["sha256", "url", "ipfs", "ar"]
        : [],
    );
  });
});
