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

  it("the bare-hash alias IS WRITTEN — §C.4's illustration is a reader some counterparty built", () => {
    // The reversal the manifest docblock records: `extra` stopped being wholly scheme-private when §6.1
    // reserved names inside it, LCP v1.38 §C.4's Tier A illustration carries the pair there, and the
    // shipped buyer parser reconciles both carriers so a mirror cannot drift silently. An unwritten alias
    // beside two written terms-URL slots would emit a challenge whose `extra` carries the URL and not the
    // hash — half of §C.4's shape, which is the worst of both.
    expect(X402_PLACEMENT.readAlso?.[0]?.write).toBe(true);
  });

  it("declares BOTH terms-URL slots the wire carries, distinct from the reference paths", () => {
    // Singular `termsUrlField` was the defect integra-protocol#8 grew from: one slot declared, neither
    // written. Both slots the published buyer reconciles are declared, so the kit writes both and a
    // stranger holding only the manifest knows the whole wire shape.
    expect(X402_PLACEMENT.termsUrlFields).toEqual([
      "extensions.legalContext.info.legalContextUrl",
      "accepts.0.extra.legalContextUrl",
    ]);
    for (const slot of X402_PLACEMENT.termsUrlFields ?? []) {
      expect(slot).not.toBe(X402_PLACEMENT.field);
      expect(slot).not.toBe(X402_PLACEMENT.readAlso?.[0]?.path);
    }
  });

  it("the exported schema is the one the vectors pin — the seller cannot drift from it", () => {
    // `schema` is a REQUIRED x402 member, so this literal is on the wire of every challenge. Inlined
    // rather than referenced because Bazaar forbids an external `$ref` outright; see the manifest
    // docblock. The vector case named here is the canonical write, so the wire copy and the export are
    // the same bytes.
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
    // The whole point of inlining: a counterparty can validate `info` from what the challenge carries.
    expect(LEGAL_CONTEXT_SCHEMA["$ref"]).toBeUndefined();
    expect(LEGAL_CONTEXT_SCHEMA["$id"]).toBeUndefined();
    expect(LEGAL_CONTEXT_SCHEMA["$defs"]).toBeUndefined();
    expect(LEGAL_CONTEXT_SCHEMA["$schema"]).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("REQUIRES the locator beside the reference — the rule every shipped reader already enforced", () => {
    // `required` carrying only ["type","value"] while the authority document required three members was
    // the two-definitions defect (integra-protocol#8). The conformance suite holds the full
    // schema-equality gate against the authority file; this pins the half that was wrong, so a regression
    // here fails in this package's own run and not only in the cross-package one.
    expect(LEGAL_CONTEXT_SCHEMA["required"]).toEqual([
      "type",
      "value",
      "legalContextUrl",
    ]);
    expect(LEGAL_CONTEXT_SCHEMA["additionalProperties"]).toBe(false);
  });

  it("it describes exactly what this placement writes — const sha256, no wider", () => {
    // A schema that did not match the emitted `info` would be worse than no schema — it would invite a
    // counterparty to reject a conformant challenge. The manifest permits sha256 alone (the url admission
    // is withdrawn; see the docblock), and the schema's const says the same thing on the wire.
    const props = LEGAL_CONTEXT_SCHEMA["properties"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(props).sort()).toEqual([
      "legalContextUrl",
      "type",
      "value",
    ]);
    expect(props["type"]?.["const"]).toBe("sha256");
    expect(X402_PLACEMENT.carrierTypes).toEqual(["sha256"]);
  });
});
