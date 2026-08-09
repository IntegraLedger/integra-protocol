import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  PlacementManifest,
  PlacementTier,
  ReferencePlacementAdapter,
} from "../src/placement.js";
import {
  assertManifestHygiene,
  INTEGRITY_CARRIER_TYPES,
  makePlacement,
} from "../src/placement.js";

const read = (rel: string): unknown =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const schema = read("../../../vectors/placement/placement.schema.json") as {
  properties: { protocol: { enum: string[] } };
};
const canonical = read(
  "../../../vectors/vocabulary/protocol-id.schema.json",
) as { enum: string[] };

const MANIFEST: PlacementManifest = {
  protocol: "acp",
  pattern: "protocol-extension",
  // Tier B, and not by preference: §8.3.6 makes protocol-extension Tier B by definition, and the vector
  // schema rejects the pairing with "A". A fixture that contradicted the schema would teach the wrong shape.
  tier: "B",
  encoding: "lcp-string",
  container: { kind: "object-path" },
  field: "test.field",
  carrierTypes: ["sha256"],
};

// A complete, real test double — an object literal that IS a placement, not a mock of one. It exercises
// the CONTRACT (both members total, refusals as values, place pure); the real ACP placement is Phase B.
const adapter: ReferencePlacementAdapter = {
  manifest: MANIFEST,
  place(ref, doc) {
    if (typeof doc !== "object" || doc === null)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "placement/document-malformed",
      };
    return {
      ok: true,
      value: {
        ...(doc as object),
        test: { field: `lcp:${ref.type}:${ref.value}` },
      },
    };
  },
  extract(doc) {
    const v = (doc as { test?: { field?: unknown } })?.test?.field;
    if (typeof v !== "string")
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "placement/absent",
      };
    return {
      ok: true,
      value: { type: "sha256", value: v.slice("lcp:sha256:".length) },
    };
  },
};

describe("ReferencePlacementAdapter", () => {
  it("place → extract round-trips the reference", () => {
    const placed = adapter.place(
      {
        type: "sha256",
        value:
          "0x3f786850e387550fdab836ed7e6dc881de23001b3f786850e387550fdab836ed",
      },
      {},
    );
    // Narrow with `in`, never `placed.ok` — Refusal has no `ok` property, and `if (out.refused)` would
    // hold even when it is false. The idiom is established in binding-evm-x402's permit2-filter test.
    if ("refused" in placed) throw new Error("expected a placement");
    expect(adapter.extract(placed.value)).toEqual({
      ok: true,
      value: {
        type: "sha256",
        value:
          "0x3f786850e387550fdab836ed7e6dc881de23001b3f786850e387550fdab836ed",
      },
    });
  });

  it("extract on a document with no reference REFUSES — it never returns a placeholder", () => {
    expect(adapter.extract({})).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "placement/absent",
    });
  });

  it("both members are TOTAL — a null document is a refusal, never a throw", () => {
    expect(() => adapter.extract(null)).not.toThrow();
    expect(adapter.extract(null)).toMatchObject({ refused: true });
    expect(
      adapter.place({ type: "sha256", value: "0x00" }, null),
    ).toMatchObject({
      refused: true,
    });
  });

  it("the manifest declares a protocol and a NON-settlement pattern", () => {
    expect(MANIFEST.protocol).toBe("acp");
    expect([
      "protocol-extension",
      "sidecar-attestation",
      "http-advisory",
      "opaque-challenge",
    ]).toContain(MANIFEST.pattern);
  });

  it("the schema's inlined protocol enum equals the canonical vocabulary schema exactly", () => {
    expect(schema.properties.protocol.enum).toEqual(canonical.enum);
  });
});

describe("PlacementTier", () => {
  it("is a closed two-member axis", () => {
    const tiers: PlacementTier[] = ["A", "B"];
    expect(tiers).toHaveLength(2);
  });

  it("is required on a manifest — omitting it is a type error", () => {
    // @ts-expect-error tier is required: a placement that cannot state its wire compatibility is not a
    // placement, it is an unverifiable claim.
    const m: PlacementManifest = {
      protocol: "acp",
      pattern: "http-advisory",
      field: "metadata.legal_context",
      carrierTypes: ["sha256"],
    };
    expect(m).toBeDefined();
  });

  it("the schema's integrity-carrier enum equals INTEGRITY_CARRIER_TYPES exactly", () => {
    // The list that encodes Ruling B lives in TWO places — this constant and the schema's `contains` guard —
    // and the repo's convention is to guard a duplicated enum with a test (see the protocol-enum case above).
    // Without this, the two could drift: adding `url` to one side alone would let a URL-only "placement" pass
    // whichever gate was not updated, which is precisely what Ruling B exists to forbid.
    const s = schema as unknown as {
      allOf: {
        properties?: { carrierTypes?: { contains?: { enum: string[] } } };
      }[];
    };
    const fromSchema = s.allOf
      .map((a) => a.properties?.carrierTypes?.contains?.enum)
      .find((e): e is string[] => e !== undefined);
    expect(fromSchema).toEqual([...INTEGRITY_CARRIER_TYPES]);
    // And `url` is absent from both — it locates a document, it does not attest to its content.
    expect(INTEGRITY_CARRIER_TYPES).not.toContain("url");
  });

  it("the schema requires tier, and pins protocol-extension to Tier B", () => {
    const s = schema as unknown as {
      required: string[];
      allOf: {
        if: unknown;
        then: { properties: { tier: { const: string } } };
      }[];
    };
    expect(s.required).toContain("tier");
    expect(s.allOf[0]?.then.properties.tier.const).toBe("B");
  });
});

describe("writeCondition — the schema and the code hold the SAME rule", () => {
  // The axis is enforced twice on purpose: the vector schema guards manifests that appear in the corpus, and
  // assertManifestHygiene guards manifests authored in TypeScript, which never meet a schema. Two enforcement
  // points are two things that can drift, so the repo's convention is to pin the pair with a test — the same
  // reason the protocol enum and INTEGRITY_CARRIER_TYPES are pinned above.
  //
  // ONE rule is deliberately code-only: a tagged-array gate whose valueField IS its tagField can only return
  // `container.tag`, so `permits` must list it. JSON Schema cannot compare two sibling values, so there is no
  // schema half to pair — that rule is proven in kit.test.ts against assertManifestHygiene alone.
  const s = schema as unknown as {
    $defs: {
      writeCondition: {
        required: string[];
        properties: {
          container: { $ref: string };
          and: {
            minItems: number;
            items: { allOf: [{ $ref: string }, { not: unknown }] };
          };
        };
      };
    };
    properties: {
      readAlso: {
        items: {
          allOf: {
            if: { required: string[] };
            then: {
              required: string[];
              properties: { write: { const: boolean } };
            };
          }[];
        };
      };
    };
  };

  it("requires path, container and permits — the gate's container is never inherited", () => {
    expect(s.$defs.writeCondition.required).toEqual([
      "path",
      "container",
      "permits",
    ]);
  });

  it("resolves an `and` TERM through the same definition as the head, and forbids nesting", () => {
    // A second copy of the gate's shape is the drift the hoisting exists to prevent, so a term references
    // the head's own definition — and `not: {required: [and]}` is what keeps depth at exactly two, because a
    // gate whose terms carry gates is an expression language rather than data.
    expect(s.$defs.writeCondition.properties.and.minItems).toBe(1);
    expect(s.$defs.writeCondition.properties.and.items.allOf[0].$ref).toBe(
      "#/$defs/writeCondition",
    );
    expect(s.$defs.writeCondition.properties.and.items.allOf[1].not).toEqual({
      required: ["and"],
    });
    // And the code half throws on the two shapes JSON Schema cannot reach past `minItems`.
    const term = {
      path: "status",
      container: { kind: "object-path" } as const,
      permits: ["ready_for_payment"],
    };
    expect(() =>
      assertManifestHygiene({
        ...MANIFEST,
        writeCondition: { ...term, and: [{ ...term, permits: ["completed"] }] },
      }),
    ).toThrow(/repeat a path/);
    expect(() =>
      assertManifestHygiene({
        ...MANIFEST,
        writeCondition: { ...term, and: [] },
      }),
    ).toThrow(/empty and/);
  });

  it("resolves the gate's container through the SAME definition a carrier's does", () => {
    // A second copy of the closed set is a set that drifts — and a gate reading a kind no carrier supports
    // could not be resolved by readFromContainer, which is the reader both halves share.
    expect(s.$defs.writeCondition.properties.container.$ref).toBe(
      "#/$defs/container",
    );
  });

  it("pins an alias's condition to write: true, the rule assertManifestHygiene throws on", () => {
    const guard = s.properties.readAlso.items.allOf[0];
    expect(guard?.if.required).toEqual(["writeCondition"]);
    expect(guard?.then.required).toEqual(["write"]);
    expect(guard?.then.properties.write.const).toBe(true);
    // And the code half rejects exactly that pairing, so neither gate can be the only one that holds.
    expect(() =>
      assertManifestHygiene({
        ...MANIFEST,
        readAlso: [
          {
            path: "other.field",
            writeCondition: {
              path: "capabilities.extensions[name=com.integraledger.legal-context].name",
              container: {
                kind: "tagged-array",
                at: "capabilities.extensions",
                tagField: "name",
                tag: "com.integraledger.legal-context",
                valueField: "name",
              },
              permits: ["com.integraledger.legal-context"],
            },
          },
        ],
      }),
    ).toThrow(/inert/);
  });
});

describe("tagged-array constants — host-required siblings on a created entry", () => {
  /** A minimal manifest whose canonical carrier is a tagged array carrying host-required constants. */
  const withConstants = (
    constants: Record<string, unknown>,
  ): PlacementManifest => ({
    protocol: "ucp",
    pattern: "http-advisory",
    tier: "A",
    encoding: "reference-object",
    container: {
      kind: "tagged-array",
      at: "policies",
      tagField: "type",
      tag: "com.example.policy.terms",
      valueField: "com.example.terms",
      constants,
    },
    field: "policies[type=com.example.policy.terms]",
    carrierTypes: ["sha256"],
  });
  const DESC = { description: { plain: "Terms of sale." } };
  const REF = { type: "sha256" as const, value: `0x${"ab".repeat(32)}` };

  it("writes the constants onto a NEWLY created entry", () => {
    // UCP's policy schema is required:[type,description], so an entry without one is an invalid document
    // — and a placement that emits an invalid document is asserting a shape the host rejects.
    const out = makePlacement(withConstants(DESC)).place(REF, { policies: [] });
    expect(out).toEqual({
      ok: true,
      value: {
        policies: [
          {
            description: { plain: "Terms of sale." },
            type: "com.example.policy.terms",
            "com.example.terms": REF,
          },
        ],
      },
    });
  });

  it("creates the array when it is absent entirely", () => {
    const out = makePlacement(withConstants(DESC)).place(REF, { id: "c1" });
    expect(out).toMatchObject({
      ok: true,
      value: { policies: [expect.objectContaining(DESC)] },
    });
  });

  it("does NOT apply them when merging into an entry that already exists", () => {
    // A counterparty's own prose is theirs. Overwriting it in order to place our reference would be an
    // edit to their document nobody asked for.
    const out = makePlacement(withConstants(DESC)).place(REF, {
      policies: [
        {
          type: "com.example.policy.terms",
          description: { plain: "Our own wording, thanks." },
        },
      ],
    });
    expect(out).toEqual({
      ok: true,
      value: {
        policies: [
          {
            type: "com.example.policy.terms",
            description: { plain: "Our own wording, thanks." },
            "com.example.terms": REF,
          },
        ],
      },
    });
  });

  it("a manifest with NO constants writes exactly the tag and the value, as before", () => {
    // Built explicitly rather than spread from `withConstants`: `exactOptionalPropertyTypes` forbids
    // `constants: undefined`, and a spread over the container union widens it out of `tagged-array`.
    const noConstants: PlacementManifest = {
      protocol: "ucp",
      pattern: "http-advisory",
      tier: "A",
      encoding: "reference-object",
      container: {
        kind: "tagged-array",
        at: "policies",
        tagField: "type",
        tag: "com.example.policy.terms",
        valueField: "com.example.terms",
      },
      field: "policies[type=com.example.policy.terms]",
      carrierTypes: ["sha256"],
    };
    expect(makePlacement(noConstants).place(REF, { policies: [] })).toEqual({
      ok: true,
      value: {
        policies: [
          { type: "com.example.policy.terms", "com.example.terms": REF },
        ],
      },
    });
  });

  it("hygiene REFUSES a constant that names the tag field", () => {
    // The writer spreads constants first, so a collision could never corrupt the reference at runtime —
    // but a manifest declaring one is stating something it does not mean, and silently dropping it is how
    // a reader comes to believe a host-required sibling is written when it is not.
    expect(() =>
      assertManifestHygiene(withConstants({ type: "com.example.other" })),
    ).toThrow(/tagField/);
  });

  it("hygiene REFUSES a constant that names the value field", () => {
    expect(() =>
      assertManifestHygiene(withConstants({ "com.example.terms": "x" })),
    ).toThrow(/valueField/);
  });

  it("hygiene accepts a constant that names neither", () => {
    expect(() => assertManifestHygiene(withConstants(DESC))).not.toThrow();
  });

  it("hygiene ignores containers that are not tagged arrays", () => {
    // The guard is scoped, and the scoping is what keeps every other manifest in the tree unaffected.
    expect(() =>
      assertManifestHygiene({
        protocol: "acp",
        pattern: "http-advisory",
        tier: "A",
        encoding: "lcp-string",
        container: { kind: "object-path" },
        field: "metadata.legal_context",
        carrierTypes: ["sha256"],
      }),
    ).not.toThrow();
  });

  it("hygiene checks a WRITEABLE alias's container too", () => {
    expect(() =>
      assertManifestHygiene({
        protocol: "ucp",
        pattern: "http-advisory",
        tier: "A",
        encoding: "reference-object",
        container: { kind: "object-path" },
        field: "metadata.legal_context",
        carrierTypes: ["sha256"],
        readAlso: [
          {
            path: "policies[type=com.example.policy.terms]",
            write: true,
            container: {
              kind: "tagged-array",
              at: "policies",
              tagField: "type",
              tag: "com.example.policy.terms",
              valueField: "com.example.terms",
              constants: { type: "collides" },
            },
          },
        ],
      }),
    ).toThrow(/tagField/);
  });
});

describe("a malformed reference refuses on the ALIAS write path too", () => {
  // The canonical field's carrier-error path is covered; the alias one was not, and the two are separate
  // `try`/`catch` blocks. An alias write that threw a raw CarrierError instead of refusing would break the
  // family's central contract — "a refusal is a returned value, never a thrown exception" — on the one
  // path nobody was exercising.
  const m: PlacementManifest = {
    protocol: "mastercard-vi",
    pattern: "http-advisory",
    tier: "A",
    encoding: "lcp-string",
    container: { kind: "object-path" },
    field: "metadata.legal_context",
    carrierTypes: ["sha256"],
    readAlso: [
      {
        path: "constraints[type=com.example.lcp-terms-hash].value",
        write: true,
        encoding: "reference-object",
        container: {
          kind: "tagged-array",
          at: "constraints",
          tagField: "type",
          tag: "com.example.lcp-terms-hash",
          valueField: "value",
        },
      },
    ],
  };

  it("refuses rather than throwing, and quotes the offending value", () => {
    const out = makePlacement(m).place(
      { type: "sha256", value: "not-a-hash" },
      { metadata: {} },
    );
    expect(out).toMatchObject({
      refused: true,
      code: "mastercard-vi/reference-malformed",
    });
    expect("refused" in out ? (out.detail ?? "") : "").toContain("not-a-hash");
  });

  it("a well-formed reference still lands in both the field and the alias", () => {
    // The companion positive: without it, the guard above could be satisfied by refusing everything.
    const ref = { type: "sha256" as const, value: `0x${"ab".repeat(32)}` };
    expect(makePlacement(m).place(ref, { metadata: {} })).toMatchObject({
      ok: true,
      value: {
        constraints: [{ type: "com.example.lcp-terms-hash", value: ref }],
      },
    });
  });
});
