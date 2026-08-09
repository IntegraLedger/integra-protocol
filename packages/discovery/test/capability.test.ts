import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  A2A_EXTENSION_ACTIVATION_HEADER,
  A2A_LCP_EXTENSION_URI,
  type AgentCardExtensionOptions,
  CapabilityError,
  emitAgentCardExtension,
  emitUcpCapability,
  LCP_CAPABILITY_AUTHORITY_ORIGIN,
  LCP_CAPABILITY_NAME,
  LCP_CAPABILITY_SCHEMA_URL,
  LCP_CAPABILITY_SPEC_URL,
  LCP_CAPABILITY_VERSION,
  type LcpCapabilityDeclaration,
  readAgentCard,
  readUcpProfile,
} from "../src/index.js";

const DECLARATION: LcpCapabilityDeclaration = {
  minimumLevel: 2,
  acceptedJurisdictions: ["New York, USA"],
  acceptedDisputeMethods: ["Commercial Arbitration Rules"],
};

type CapabilityCase = {
  name: string;
  input: {
    op: string;
    declaration?: unknown;
    options?: unknown;
    doc?: unknown;
  };
  expected?: unknown;
  error?: string;
};

const VECTORS = JSON.parse(
  readFileSync(
    new URL(
      "../../../vectors/discovery/capability-documents.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: CapabilityCase[] };

// The four ops this module owns. The vector tree carries one more case — an unknown op — which certifies the
// conformance subject's own dispatch rather than anything here; the count is pinned below so a later op
// cannot be added to the tree and silently skipped in this suite.
const OPS: readonly string[] = ["emit-a2a", "emit-ucp", "read-a2a", "read-ucp"];
const OWNED = VECTORS.cases.filter((c) => OPS.includes(c.input.op));

/** The same dispatch the conformance subject performs, over the same untyped case input. */
function run(input: CapabilityCase["input"]): unknown {
  if (input.op === "emit-a2a")
    return emitAgentCardExtension(
      input.declaration as LcpCapabilityDeclaration,
      input.options as AgentCardExtensionOptions | undefined,
    );
  if (input.op === "emit-ucp")
    return emitUcpCapability(input.declaration as LcpCapabilityDeclaration);
  if (input.op === "read-a2a") return readAgentCard(input.doc);
  return readUcpProfile(input.doc);
}

describe("the capability vector tree, run against source", () => {
  // The corpus runs these through the built `dist`, so it cannot reach a mutant in `src` (see
  // stryker.config.mjs). Driving the same tree here means the two doors certify the same behaviour and
  // neither can drift — the pattern `isLegalContextJson` already follows for legal-context/documents.json.
  it("covers every case except the subject-dispatch one", () => {
    expect(OWNED).toHaveLength(VECTORS.cases.length - 1);
  });

  it.each(OWNED.filter((c) => c.error === undefined))(
    "$name",
    ({ input, expected }) => {
      // JSON-string equality, not toEqual: the corpus runner compares with JSON.stringify and is therefore
      // order-sensitive, and key order is load-bearing here (proto field order on the A2A entry).
      expect(JSON.stringify(run(input))).toBe(JSON.stringify(expected));
    },
  );

  it.each(OWNED.filter((c) => c.error !== undefined))(
    "$name",
    ({ input, error }) => {
      try {
        run(input);
        expect.unreachable(`expected ${String(error)}`);
      } catch (e) {
        expect(e).toBeInstanceOf(CapabilityError);
        expect((e as CapabilityError).code).toBe(error);
      }
    },
  );
});

describe("capability identity — the namespace ruling, held shut in code", () => {
  it("publishes under com.integraledger and never the reserved LCP namespace", () => {
    // Ruled 2026-07-29: `org.legalcontextprotocol.*` is reserved for a TSC-ratified capability and is
    // never emitted. Every string that goes on the wire is checked, so a future edit cannot slip it in
    // through one constant while the others still read correctly.
    for (const value of [
      LCP_CAPABILITY_NAME,
      LCP_CAPABILITY_AUTHORITY_ORIGIN,
      LCP_CAPABILITY_SPEC_URL,
      LCP_CAPABILITY_SCHEMA_URL,
      A2A_LCP_EXTENSION_URI,
    ])
      expect(value).not.toContain("legalcontextprotocol");
    expect(LCP_CAPABILITY_NAME.startsWith("com.integraledger.")).toBe(true);
  });

  it("binds both UCP document URLs to the namespace authority's origin", () => {
    // The host's own MUST, applied to what WE emit rather than only to what we read: a platform validating
    // the binding rejects the capability outright if either origin drifts from the namespace authority.
    for (const url of [LCP_CAPABILITY_SPEC_URL, LCP_CAPABILITY_SCHEMA_URL])
      expect(new URL(url).origin).toBe(LCP_CAPABILITY_AUTHORITY_ORIGIN);
  });

  it("declares the capability version in the YYYY-MM-DD form UCP requires", () => {
    expect(LCP_CAPABILITY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the released A2A activation header, not the v0.3.0 spelling", () => {
    // Renamed between A2A v0.3.0 and v1.0. No shim reads the old name; a deployment on the superseded
    // version needs to know that, not to have it papered over.
    expect(A2A_EXTENSION_ACTIVATION_HEADER).toBe("A2A-Extensions");
    expect(A2A_EXTENSION_ACTIVATION_HEADER.startsWith("X-")).toBe(false);
  });

  it("carries a version segment in the A2A extension URI", () => {
    // A2A: "A new URI MUST be used when introducing a breaking change" — so the URI has to be versionable,
    // and it is versioned in the path from the first release rather than retrofitted at the first change.
    expect(A2A_LCP_EXTENSION_URI.endsWith("/v1")).toBe(true);
  });

  it("shares its reverse-domain authority with everything placement-ucp writes", () => {
    // These are TWO UCP surfaces, not one, and the difference is the point. The capability name is what a
    // seller ADVERTISES in /.well-known/ucp for negotiation; the placement writes a `policies[]` entry
    // whose `type` tag and reference key are separate identifiers, because UCP defines no `extensions` map
    // on a checkout for a capability key to be read back out of.
    //
    // What must not diverge is the AUTHORITY. UCP binds a capability's schema URL to the namespace in its
    // name, so a seller advertising under `com.integraledger` while writing a policy under some other
    // reverse domain would be making two claims a platform cannot reconcile. Read from placement-ucp's own
    // source rather than restated here: a copy would agree with itself while the packages diverged.
    const authority = LCP_CAPABILITY_NAME.split(".").slice(0, 2).join(".");
    expect(authority).toBe("com.integraledger");

    const manifest = readFileSync(
      new URL("../../placement-ucp/src/manifest.ts", import.meta.url),
      "utf8",
    );
    const identifiers = [...manifest.matchAll(/"(com\.[a-z0-9_.-]+)"/g)].map(
      (m) => m[1] ?? "",
    );
    expect(identifiers.length).toBeGreaterThan(0);
    for (const id of identifiers)
      expect(id.startsWith(`${authority}.`), id).toBe(true);
  });
});

describe("emitAgentCardExtension", () => {
  it("emits the four AgentExtension fields in proto field order", () => {
    const entry = emitAgentCardExtension(DECLARATION, {
      required: true,
      description: "Level 2 or better.",
    });
    expect(Object.keys(entry)).toEqual([
      "uri",
      "description",
      "required",
      "params",
    ]);
  });

  it("omits description entirely rather than emitting an empty proto default", () => {
    const entry = emitAgentCardExtension(DECLARATION);
    expect(Object.keys(entry)).toEqual(["uri", "required", "params"]);
    expect("description" in entry).toBe(false);
  });

  it("defaults required to false — true is the deployment's explicit choice", () => {
    expect(emitAgentCardExtension(DECLARATION).required).toBe(false);
    expect(emitAgentCardExtension(DECLARATION, {}).required).toBe(false);
    expect(
      emitAgentCardExtension(DECLARATION, { required: true }).required,
    ).toBe(true);
  });

  it("canonicalizes params key order regardless of the caller's", () => {
    const entry = emitAgentCardExtension({
      acceptedDisputeMethods: ["Expedited Commercial Arbitration Rules"],
      acceptedJurisdictions: ["California, USA"],
      minimumLevel: 3,
    });
    expect(Object.keys(entry.params)).toEqual([
      "minimumLevel",
      "acceptedJurisdictions",
      "acceptedDisputeMethods",
    ]);
  });

  it("copies the declaration rather than aliasing the caller's object", () => {
    const entry = emitAgentCardExtension(DECLARATION);
    expect(entry.params).not.toBe(DECLARATION);
    expect(entry.params).toEqual(DECLARATION);
  });

  it("copies the nested lists too — a published entry cannot change under the caller", () => {
    // `readonly string[]` is erased at runtime, so the shallow copy above proves nothing about the arrays
    // inside it. Handing back the caller's array would let a deployment push a jurisdiction into a
    // declaration it had already merged into a served Agent Card, and no reader would ever see the mutation.
    const source = {
      minimumLevel: 2 as const,
      acceptedJurisdictions: ["New York, USA"],
      acceptedDisputeMethods: ["Commercial Arbitration Rules"],
    };
    const entry = emitAgentCardExtension(source);
    expect(entry.params.acceptedJurisdictions).not.toBe(
      source.acceptedJurisdictions,
    );
    expect(entry.params.acceptedDisputeMethods).not.toBe(
      source.acceptedDisputeMethods,
    );
    source.acceptedJurisdictions.push("Nowhere");
    source.acceptedDisputeMethods.length = 0;
    expect(entry.params.acceptedJurisdictions).toEqual(["New York, USA"]);
    expect(entry.params.acceptedDisputeMethods).toEqual([
      "Commercial Arbitration Rules",
    ]);
  });

  it("refuses an unrecognized option instead of silently emitting required false", () => {
    // The realistic case is a deployment reading its options from a config file, where TypeScript's
    // excess-property check never fires. A misspelling that produced `required: false` would downgrade the
    // one interoperability flag this unit requires to be an explicit choice — silently.
    for (const bag of [{ requird: true }, { require: true }, { uri: "x" }])
      try {
        emitAgentCardExtension(
          DECLARATION,
          bag as unknown as AgentCardExtensionOptions,
        );
        expect.unreachable(`expected ${JSON.stringify(bag)} to refuse`);
      } catch (e) {
        expect(e).toBeInstanceOf(CapabilityError);
        expect((e as CapabilityError).code).toBe(
          "capability/unrecognized-option",
        );
      }
  });
});

describe("emitUcpCapability", () => {
  it("keys one array-valued declaration under the vendor capability name", () => {
    const entry = emitUcpCapability(DECLARATION);
    expect(Object.keys(entry)).toEqual([LCP_CAPABILITY_NAME]);
    const declarations = entry[LCP_CAPABILITY_NAME];
    expect(declarations).toHaveLength(1);
    expect(Object.keys(declarations?.[0] ?? {})).toEqual([
      "version",
      "spec",
      "schema",
      "config",
    ]);
  });

  it("declares no extends, so negotiation cannot prune it as an orphan", () => {
    // UCP: "Remove any capability where extends is set but none of its parent capabilities are in the
    // intersection." A requirement advertisement must not disappear because a vertical was not negotiated.
    const declaration =
      emitUcpCapability(DECLARATION)[LCP_CAPABILITY_NAME]?.[0];
    expect(declaration).toBeDefined();
    expect(declaration !== undefined && "extends" in declaration).toBe(false);
  });

  it("declares no required flag — UCP has no such notion to mirror", () => {
    const declaration =
      emitUcpCapability(DECLARATION)[LCP_CAPABILITY_NAME]?.[0];
    expect(declaration !== undefined && "required" in declaration).toBe(false);
  });
});

describe("round trip — what we emit is what we read", () => {
  it("survives the A2A Agent Card", () => {
    const card = {
      name: "Buyer Agent",
      capabilities: {
        streaming: true,
        extensions: [
          { uri: "https://example.com/ext/konami-code/v1", required: false },
          emitAgentCardExtension(DECLARATION, { required: true }),
        ],
      },
    };
    const requirement = readAgentCard(card);
    expect(requirement).toEqual({ required: true, declaration: DECLARATION });
    // The KEY, not just the value: an absent description must leave no `description` property behind.
    // JSON serialization drops an undefined value, so a reader that emitted the key with no value would
    // round-trip byte-identically and still hand a consumer `"description" in result === true`.
    expect(requirement !== null && "description" in requirement).toBe(false);
  });

  it("survives a stock proto3 serializer expanding the AgentExtension defaults", () => {
    // §7 gate item 3 — the field survives a round trip through the host's own encoding. `description` and
    // `required` have no presence tracking (a2a.proto 428/430), so a serializer with default emission prints
    // both scalar defaults. That document is a legal encoding of exactly what `emitAgentCardExtension`
    // produced, and a reader that refused it could not pre-filter a conformant counterparty at all.
    const emitted = emitAgentCardExtension(DECLARATION);
    const withDefaultsEmitted = {
      ...emitted,
      description: "",
      required: false,
    };
    const requirement = readAgentCard({
      capabilities: { extensions: [withDefaultsEmitted] },
    });
    expect(requirement).toEqual({ required: false, declaration: DECLARATION });
    expect(requirement !== null && "description" in requirement).toBe(false);
  });

  it("reads proto3 JSON's null as each field's default, never as bad data", () => {
    // proto3 JSON accepts `null` for any field as that field's default value. Refusing it would refuse a
    // conformant document over two fields that carry no requirement at all.
    const requirement = readAgentCard({
      capabilities: {
        extensions: [
          {
            uri: A2A_LCP_EXTENSION_URI,
            description: null,
            required: null,
            params: { minimumLevel: 2 },
          },
        ],
      },
    });
    expect(requirement).toEqual({
      required: false,
      declaration: { minimumLevel: 2 },
    });
  });

  it("still refuses a description or required that is neither a default nor its own type", () => {
    // The read side is tolerant of the host's encodings of "absent", not of bad data. `1` is not proto3's
    // encoding of a bool and an array is not a string.
    for (const [entry, code] of [
      [{ required: 1 }, "capability/required-not-a-boolean"],
      [{ description: 3 }, "capability/description-not-a-string"],
    ] as const)
      try {
        readAgentCard({
          capabilities: {
            extensions: [
              {
                uri: A2A_LCP_EXTENSION_URI,
                ...entry,
                params: { minimumLevel: 2 },
              },
            ],
          },
        });
        expect.unreachable(`expected ${code}`);
      } catch (e) {
        expect((e as CapabilityError).code).toBe(code);
      }
  });

  it("survives the UCP profile", () => {
    const profile = {
      ucp: {
        version: "2026-04-08",
        capabilities: {
          "dev.ucp.shopping.checkout": [
            {
              version: "2026-04-08",
              spec: "https://ucp.dev/2026-04-08/specification/checkout",
              schema:
                "https://ucp.dev/2026-04-08/schemas/shopping/checkout.json",
            },
          ],
          ...emitUcpCapability(DECLARATION),
        },
      },
    };
    expect(readUcpProfile(profile)).toEqual(DECLARATION);
  });
});

describe("both readers walk own properties only", () => {
  // binding-core's document walker states the rule for exactly this situation — "a document is
  // attacker-influenced input, and walking the prototype chain would let `constructor.name` answer as though
  // it were a placed reference" — and it is unconditional for a document walk. A JSON vector cannot express
  // a prototype chain, so the proof lives here.
  it("reads nothing out of an A2A card whose every field is inherited", () => {
    const inherited = Object.create({
      capabilities: {
        extensions: [
          { uri: A2A_LCP_EXTENSION_URI, params: { minimumLevel: 4 } },
        ],
      },
    }) as unknown;
    // A document with zero own properties declares nothing, so the host's REQUIRED `capabilities` is missing.
    expect(() => readAgentCard(inherited)).toThrow(/no capabilities object/);
  });

  it("reads nothing out of a UCP profile whose envelope is inherited", () => {
    const inherited = Object.create({
      ucp: { capabilities: { [LCP_CAPABILITY_NAME]: [] } },
    }) as unknown;
    expect(() => readUcpProfile(inherited)).toThrow(/no ucp object/);
  });

  it("does not accept an inherited requirement key inside params", () => {
    // The unrecognized-key whitelist enumerates OWN keys, so an inherited `minimumLevel` would pass it. The
    // read has to agree with the check: it reads as absent, and a declaration requiring nothing refuses.
    const params = Object.create({ minimumLevel: 2 }) as unknown;
    expect(() =>
      readAgentCard({
        capabilities: { extensions: [{ uri: A2A_LCP_EXTENSION_URI, params }] },
      }),
    ).toThrow(/minimumLevel must be one of the four/);
  });
});

describe("refusals carry a code, and the code is the contract", () => {
  it("throws CapabilityError with the code, not a bare Error", () => {
    // The corpus asserts codes through the subject's catch, which reads `.code` duck-typed. This pins the
    // class and the code together, so a refactor that dropped `code` would fail here and read as green
    // there for anything that happened to keep the message.
    try {
      emitAgentCardExtension({
        minimumLevel: 9,
      } as unknown as LcpCapabilityDeclaration);
      expect.unreachable("a level outside 1-4 must refuse");
    } catch (e) {
      expect(e).toBeInstanceOf(CapabilityError);
      expect((e as CapabilityError).code).toBe(
        "capability/minimum-level-invalid",
      );
      expect((e as CapabilityError).name).toBe("CapabilityError");
      expect((e as CapabilityError).message).toContain("minimumLevel");
    }
  });

  it("refuses a foreign origin under our capability name on both URL fields at once", () => {
    // Both fields wrong is the realistic spoof; the corpus pins each one alone. The message names which
    // field failed, so an operator reading the log is not left guessing — and since 2026-08-08 that field
    // is SCHEMA, not spec: a spec on `evil.example` is conformant on its own (https, any host), so the
    // spoof is caught by the one binding UCP actually defines.
    const profile = {
      ucp: {
        capabilities: {
          [LCP_CAPABILITY_NAME]: [
            {
              version: LCP_CAPABILITY_VERSION,
              spec: "https://evil.example/spec",
              schema: "https://evil.example/schema.json",
              config: { minimumLevel: 2 },
            },
          ],
        },
      },
    };
    expect(() => readUcpProfile(profile)).toThrow(/^schema must be/);
  });
});

/** The `code` a thrown CapabilityError carries — the contract, where the message is prose. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof CapabilityError ? e.code : `not-a-CapabilityError:${e}`;
  }
  return "did-not-throw";
}

describe("UCP binds authority to the SCHEMA url alone", () => {
  // Verified verbatim at universal-commerce-protocol/ucp HEAD, docs/specification/overview.md
  // §Namespace Governance → Authority Binding:
  //
  //   "The `spec` URL is documentation, not part of the machine trust path, so its origin is NOT
  //    authority-bound: it MUST be `https` but MAY be served from any host (e.g. a docs subdomain or
  //    third-party docs host). Only the `schema` URL carries the authority binding defined below."
  //
  // and "The authority is derived from the `schema` URL host." Binding BOTH refused a conformant
  // counterparty — and the host's own example of a permitted spec host is the case we rejected.
  const profile = (over: { spec?: string; schema?: string }) => ({
    ucp: {
      capabilities: {
        [LCP_CAPABILITY_NAME]: [
          {
            version: LCP_CAPABILITY_VERSION,
            spec: over.spec ?? LCP_CAPABILITY_SPEC_URL,
            schema: over.schema ?? LCP_CAPABILITY_SCHEMA_URL,
            config: { minimumLevel: 2 },
          },
        ],
      },
    },
  });

  it("accepts a conformant profile whose spec is served from a docs host", () => {
    expect(
      readUcpProfile(
        profile({
          spec: "https://docs.integraledger.io/lcp/ucp/legal-context",
        }),
      ),
    ).toEqual({ minimumLevel: 2 });
  });

  it("accepts a spec on a THIRD-PARTY docs host — the host's own other example", () => {
    expect(
      readUcpProfile(profile({ spec: "https://readthedocs.org/integra/lcp" })),
    ).toEqual({ minimumLevel: 2 });
  });

  it("still refuses a schema URL served off the namespace authority", () => {
    // The half that IS authority-bound, and the reason the reader enforces anything at all: it proves
    // the party asserting legal context controls the domain the capability is named for.
    expect(
      codeOf(() =>
        readUcpProfile(
          profile({
            schema: "https://evil.example.com/legal-context.schema.json",
          }),
        ),
      ),
    ).toBe("capability/authority-binding-violated");
  });

  it("refuses a plain-http spec URL — https is the host's own MUST", () => {
    // "A `spec` URL MUST be a valid `https` URL." The requirement survives on its own footing once the
    // origin check is lifted, and gets its own code so the two failures are distinguishable.
    expect(
      codeOf(() =>
        readUcpProfile(profile({ spec: "http://docs.integraledger.io/lcp" })),
      ),
    ).toBe("capability/spec-not-https");
  });

  it("refuses a spec that is not an absolute URL at all", () => {
    expect(codeOf(() => readUcpProfile(profile({ spec: "/lcp/ucp" })))).toBe(
      "capability/spec-not-https",
    );
  });
});
