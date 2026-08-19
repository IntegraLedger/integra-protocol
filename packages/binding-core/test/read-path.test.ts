import { describe, expect, it } from "vitest";
import { CarrierError } from "../src/carrier.js";
import {
  assertManifestHygiene,
  decodeDeclaredRead,
  encodeForField,
  type PlacementManifest,
  readAtPath,
  readDeclaredPaths,
  requireIntegrity,
} from "../src/index.js";

const HASH =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("readAtPath", () => {
  it("reads a dotted path", () => {
    expect(
      readAtPath(
        { metadata: { legal_context: "x" } },
        "metadata.legal_context",
      ),
    ).toBe("x");
  });

  it("returns undefined for a missing path rather than throwing", () => {
    expect(
      readAtPath({ metadata: {} }, "metadata.legal_context"),
    ).toBeUndefined();
  });

  it("does not traverse arrays as objects", () => {
    expect(
      readAtPath(
        { metadata: [{ legal_context: "x" }] },
        "metadata.legal_context",
      ),
    ).toBeUndefined();
  });

  it("does not walk prototype keys — a document is attacker-influenced input", () => {
    expect(readAtPath({}, "constructor.name")).toBeUndefined();
    expect(readAtPath({}, "__proto__.polluted")).toBeUndefined();
    // A SINGLE inherited segment, and it is the case that actually proves the own-property guard. The two
    // above pass even without it: drop `Object.hasOwn` and `constructor` resolves to a function, which the
    // next iteration rejects on `typeof cur !== "object"` anyway. `__proto__` alone resolves to an OBJECT
    // and is returned, so only this assertion distinguishes the guard from its absence.
    expect(readAtPath({}, "__proto__")).toBeUndefined();
  });

  it("is total on every hostile shape", () => {
    for (const doc of [null, undefined, 3, "s", [], true]) {
      expect(() => readAtPath(doc, "a.b")).not.toThrow();
      expect(readAtPath(doc, "a.b")).toBeUndefined();
    }
  });
});

describe("readAtPath array indices", () => {
  it("traverses an array when the segment is a canonical non-negative integer", () => {
    expect(
      readAtPath(
        { accepts: [{ extra: { atrHash: "0xab" } }] },
        "accepts.0.extra.atrHash",
      ),
    ).toBe("0xab");
  });

  it("returns undefined for an out-of-range index rather than throwing", () => {
    expect(readAtPath({ accepts: [] }, "accepts.0.extra")).toBeUndefined();
  });

  it("does NOT accept a non-canonical integer — '01' and '1.0' are not index 1", () => {
    expect(readAtPath({ a: [0, 9] }, "a.01")).toBeUndefined();
    expect(readAtPath({ a: [0, 9] }, "a.1.0")).toBeUndefined();
  });

  it("does NOT accept a negative index", () => {
    expect(readAtPath({ a: [0, 9] }, "a.-1")).toBeUndefined();
  });

  it("refuses a non-canonical spelling even when the array OWNS that property", () => {
    // The case that pins `INDEX` independently of the own-property guard, and the only kind that does. On a
    // plain array the two rules agree by accident — JS canonicalizes numeric keys, so `Object.hasOwn` already
    // answers false for "01" and "-1" — and every assertion above therefore passes with `INDEX` deleted. An
    // array carrying those keys as REAL own properties separates them: `hasOwn` says yes, and only `INDEX`
    // says index 1 has one spelling. That is the manifest-collision hazard `INDEX` exists to prevent.
    const a: unknown[] = [0, 9];
    Object.assign(a, { "01": "second-spelling", "-1": "before-the-start" });
    expect(Object.hasOwn(a, "01")).toBe(true);
    expect(Object.hasOwn(a, "-1")).toBe(true);
    expect(readAtPath({ a }, "a.01")).toBeUndefined();
    expect(readAtPath({ a }, "a.-1")).toBeUndefined();
  });

  it("accepts a MULTI-DIGIT index — canonical means no leading zero, not single-digit", () => {
    // The only assertion that separates `[1-9][0-9]*` from `[1-9]` followed by anything-but-a-digit: every
    // index above is 0 or 1, so a regex that rejected "10" would pass all of them.
    expect(
      readAtPath({ a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "ten"] }, "a.10"),
    ).toBe("ten");
  });

  it("still refuses a NON-numeric segment against an array — the S2 rule is otherwise intact", () => {
    expect(
      readAtPath(
        { metadata: [{ legal_context: "x" }] },
        "metadata.legal_context",
      ),
    ).toBeUndefined();
  });

  it("does not read array properties as if they were data", () => {
    expect(readAtPath({ a: [1, 2] }, "a.length")).toBeUndefined();
  });

  it("indexes a nested array — the relaxation is not one level deep", () => {
    // `accepts.0` is the only index x402 needs, but the rule is stated about SEGMENTS, not about depth, and
    // a guard that only relaxed the first array encountered would pass every case above.
    expect(readAtPath({ a: [[7, 8]] }, "a.0.1")).toBe(8);
  });

  it("reads a hole in a sparse array as absent, not as a crash", () => {
    // A HOLE is the shape under test, so `delete` is the only way to build it — assigning `undefined` would
    // leave an own property behind and prove nothing about the missing-element path.
    const sparse: unknown[] = [1, 2];
    delete sparse[0];
    expect(readAtPath({ a: sparse }, "a.0")).toBeUndefined();
    expect(readAtPath({ a: sparse }, "a.1")).toBe(2);
  });

  it("does not read an INHERITED numeric index as an element", () => {
    // The array branch relaxes WHICH segments traverse, never the own-property invariant. Without the guard a
    // polluted `Array.prototype["0"]` answers `accepts.0.extra.atrHash` on an EMPTY `accepts` — an
    // attacker-chosen reference reported as a successful read by every placement in the set, since they all
    // delegate here. The two assertions above pass either way: a hole and an inherited index are the same
    // read, and only a populated prototype tells them apart.
    Object.defineProperty(Array.prototype, "0", {
      value: { extra: { atrHash: HASH } },
      configurable: true,
      enumerable: false,
      writable: true,
    });
    try {
      expect(
        readAtPath({ accepts: [] }, "accepts.0.extra.atrHash"),
      ).toBeUndefined();
      // The same read on a sparse HOLE, which is where the prototype is actually consulted.
      const sparse: unknown[] = [1, 2];
      delete sparse[0];
      expect(readAtPath({ a: sparse }, "a.0")).toBeUndefined();
      // Own elements still resolve — the guard narrows nothing that was reachable.
      expect(readAtPath({ a: [{ extra: { atrHash: HASH } }] }, "a.0")).toEqual({
        extra: { atrHash: HASH },
      });
    } finally {
      Reflect.deleteProperty(Array.prototype, "0");
    }
  });
});

const manifest = {
  field: "metadata.legal_context",
  encoding: "lcp-string" as const,
  container: { kind: "object-path" } as const,
  carrierTypes: ["sha256"] as const,
  readAlso: [
    { path: "metadata.legalContext", encoding: "reference-object" as const },
  ],
};

describe("readDeclaredPaths", () => {
  it("prefers the canonical field when both are present, and reports ITS encoding", () => {
    const doc = {
      metadata: {
        legal_context: "canonical",
        legalContext: { type: "sha256", value: HASH },
      },
    };
    expect(readDeclaredPaths(doc, manifest)).toEqual({
      raw: "canonical",
      encoding: "lcp-string",
      carrierClass: "integrity",
    });
  });

  it("falls to a declared alias and reports the ALIAS's encoding, not the manifest's", () => {
    const alias = { type: "sha256", value: HASH };
    expect(
      readDeclaredPaths({ metadata: { legalContext: alias } }, manifest),
    ).toEqual({
      raw: alias,
      encoding: "reference-object",
      carrierClass: "integrity",
    });
  });

  it("returns undefined when no declared path is present", () => {
    expect(readDeclaredPaths({ metadata: { other: "x" } }, manifest)).toBe(
      undefined,
    );
  });

  it("reads only DECLARED paths — an undeclared spelling is not accepted", () => {
    expect(readDeclaredPaths({ metadata: { legal_ctx: "x" } }, manifest)).toBe(
      undefined,
    );
  });

  it("reports a discovery alias AS discovery — it is never promoted to integrity", () => {
    const m = {
      field: "extensions.legal-context",
      encoding: "reference-object" as const,
      container: { kind: "object-path" } as const,
      carrierTypes: ["sha256"] as const,
      readAlso: [
        {
          path: "links.terms_of_service",
          encoding: "bare-value" as const,
          bareType: "url" as const,
          carrierClass: "discovery" as const,
        },
      ],
    };
    const hit = readDeclaredPaths(
      { links: { terms_of_service: "https://example.com/terms" } },
      m,
    );
    expect(hit).toEqual({
      raw: "https://example.com/terms",
      encoding: "bare-value",
      carrierClass: "discovery",
      bareType: "url",
    });
    // The downgrade LCP §C.2 rules out: a located document standing in for an attested one. v1.37 put it
    // normatively — a policy page "MUST NOT be substituted for one" — and v1.38 states it as fact rather
    // than obligation: it "is not a substitute for one". The kit's behaviour predates both and is unchanged
    // by the modality; `binding-core/src/placement.ts` records why the distinction is worth keeping.
    expect(requireIntegrity(hit)).toBeUndefined();
  });

  it("requireIntegrity passes an integrity hit through unchanged", () => {
    const hit = readDeclaredPaths(
      { metadata: { legal_context: `lcp:sha256:${HASH}` } },
      manifest,
    );
    expect(requireIntegrity(hit)).toBe(hit);
  });

  it("requireIntegrity is total on an absent hit — a miss is not a crash", () => {
    expect(requireIntegrity(undefined)).toBeUndefined();
  });

  it("REFUSES a url-typed value sitting in the canonical slot (audit R-C)", () => {
    // THE HOLE. `carrierClass` is declared per SLOT, and the canonical slot's label is "integrity" because
    // the MANIFEST must permit at least one content-addressed type — which says nothing about the value
    // that actually turned up. Four shipped manifests permit `url` alongside `sha256` (ACP, UCP, x402,
    // ACK), so a url reference in the canonical slot read back `carrierClass: "integrity"` and satisfied
    // `requireIntegrity`. That is the §C.2 substitution the class axis exists to prevent, arriving through
    // the one field nobody was checking.
    const m = {
      field: "metadata.legal_context",
      encoding: "reference-object" as const,
      container: { kind: "object-path" } as const,
      carrierTypes: ["sha256", "url"] as const,
    };
    const hit = readDeclaredPaths(
      {
        metadata: {
          legal_context: { type: "url", value: "https://example.com/terms" },
        },
      },
      m,
    );
    // The slot still REPORTS its declared strength — that is what the label means and it stays honest…
    expect(hit?.carrierClass).toBe("integrity");
    // …but the question `requireIntegrity` asks is about the VALUE, and this value locates, it does not attest.
    expect(requireIntegrity(hit)).toBeUndefined();
  });

  it("still passes a sha256 value in that same permissive slot", () => {
    // The gate must narrow on the value, not on the slot permitting `url` at all — otherwise closing the
    // hole would refuse every honest reference in the four manifests that permit both types.
    const m = {
      field: "metadata.legal_context",
      encoding: "reference-object" as const,
      container: { kind: "object-path" } as const,
      carrierTypes: ["sha256", "url"] as const,
    };
    const hit = readDeclaredPaths(
      {
        metadata: {
          legal_context: { type: "sha256", value: `0x${"ab".repeat(32)}` },
        },
      },
      m,
    );
    expect(requireIntegrity(hit)).toBe(hit);
  });

  it("a DECLARED-discovery alias holding a hash is still refused", () => {
    // Both conditions must hold, and this is the half that is not about the hole. UCP declares its `links`
    // alias `discovery` because that carrier holds a terms URL by design. A hash appearing there does not
    // promote it: the deployment said what that slot is for, and a value cannot overrule the declaration.
    const m = {
      field: "metadata.legal_context",
      encoding: "lcp-string" as const,
      container: { kind: "object-path" } as const,
      carrierTypes: ["sha256"] as const,
      readAlso: [
        {
          path: "links.terms_of_service",
          encoding: "bare-value" as const,
          bareType: "sha256" as const,
          carrierClass: "discovery" as const,
        },
      ],
    };
    const hit = readDeclaredPaths(
      { links: { terms_of_service: `0x${"cd".repeat(32)}` } },
      m,
    );
    expect(hit?.carrierClass).toBe("discovery");
    expect(requireIntegrity(hit)).toBeUndefined();
  });

  it("reports bareType when the CANONICAL field is bare-value, not only when an alias is", () => {
    const bare = {
      field: "methodDetails.atrHash",
      encoding: "bare-value" as const,
      container: { kind: "object-path" } as const,
      carrierTypes: ["sha256"] as const,
    };
    expect(
      readDeclaredPaths({ methodDetails: { atrHash: HASH } }, bare),
    ).toEqual({
      raw: HASH,
      encoding: "bare-value",
      carrierClass: "integrity",
      bareType: "sha256",
    });
  });

  it("omits bareType when the canonical field is NOT bare-value", () => {
    const hit = readDeclaredPaths(
      { metadata: { legal_context: `lcp:sha256:${HASH}` } },
      manifest,
    );
    expect(hit).not.toHaveProperty("bareType");
  });
});

describe("decodeDeclaredRead", () => {
  it("decodes the lcp-string form", () => {
    expect(
      decodeDeclaredRead({
        raw: `lcp:sha256:${HASH}`,
        encoding: "lcp-string",
        carrierClass: "integrity",
      }),
    ).toEqual({ type: "sha256", value: HASH });
  });

  it("decodes the bare {type,value} object form — the shape Appendix C illustrates", () => {
    expect(
      decodeDeclaredRead({
        raw: { type: "sha256", value: HASH },
        encoding: "reference-object",
        carrierClass: "integrity",
      }),
    ).toEqual({ type: "sha256", value: HASH });
  });

  it("decodes a bare value against the type its manifest fixed", () => {
    expect(
      decodeDeclaredRead({
        raw: HASH,
        encoding: "bare-value",
        carrierClass: "integrity",
        bareType: "sha256",
      }),
    ).toEqual({ type: "sha256", value: HASH });
  });

  it("ignores an unknown carrier type on every encoding — LCP §8.2 says ignore, not error", () => {
    expect(
      decodeDeclaredRead({
        raw: { type: "sha512", value: "0xdead" },
        encoding: "reference-object",
        carrierClass: "integrity",
      }),
    ).toBeUndefined();
    expect(
      decodeDeclaredRead({
        raw: `lcp:sha512:0xdead`,
        encoding: "lcp-string",
        carrierClass: "integrity",
      }),
    ).toBeUndefined();
  });

  it("THROWS on a corrupt value, on the object path as on the string path", () => {
    // A bare-digits sha256 is corrupt, not absent — the same fault the string decoder throws on.
    expect(() =>
      decodeDeclaredRead({
        raw: { type: "sha256", value: HASH.slice(2) },
        encoding: "reference-object",
        carrierClass: "integrity",
      }),
    ).toThrow(CarrierError);
  });

  it("returns undefined when a bare-value read has no type to decode against", () => {
    expect(
      decodeDeclaredRead({
        raw: HASH,
        encoding: "bare-value",
        carrierClass: "integrity",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when an lcp-string read landed on a NON-string — never hands it to the codec", () => {
    expect(
      decodeDeclaredRead({
        raw: { type: "sha256", value: HASH },
        encoding: "lcp-string",
        carrierClass: "integrity",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when a bare-value read landed on a non-string, even with a bareType", () => {
    expect(
      decodeDeclaredRead({
        raw: 42,
        encoding: "bare-value",
        carrierClass: "integrity",
        bareType: "sha256",
      }),
    ).toBeUndefined();
  });
});

describe("encodeForField", () => {
  const ref = { type: "sha256", value: HASH } as const;

  it("round-trips through every encoding", () => {
    for (const encoding of [
      "lcp-string",
      "reference-object",
      "bare-value",
    ] as const) {
      const raw = encodeForField(ref, encoding);
      expect(
        decodeDeclaredRead({
          raw,
          encoding,
          carrierClass: "integrity",
          bareType: "sha256",
        }),
      ).toEqual(ref);
    }
  });

  it("emits the bare hash for bare-value — NOT an lcp: string our own x402 seller would not recognize", () => {
    expect(encodeForField(ref, "bare-value")).toBe(HASH);
  });

  it("emits the unwrapped {type,value} object for reference-object", () => {
    expect(encodeForField(ref, "reference-object")).toEqual({
      type: "sha256",
      value: HASH,
    });
  });

  it("throws rather than minting a corrupt carrier", () => {
    expect(() =>
      encodeForField({ type: "sha256", value: HASH.slice(2) }, "bare-value"),
    ).toThrow(CarrierError);
  });
});

const base: PlacementManifest = {
  protocol: "acp",
  pattern: "http-advisory",
  tier: "A",
  encoding: "lcp-string",
  container: { kind: "object-path" },
  field: "metadata.legal_context",
  carrierTypes: ["sha256"],
};

describe("assertManifestHygiene", () => {
  it("accepts a coherent manifest", () => {
    expect(() =>
      assertManifestHygiene({
        ...base,
        readAlso: [{ path: "metadata.legalContext" }],
      }),
    ).not.toThrow();
  });

  it("rejects an alias that repeats the canonical field", () => {
    expect(() =>
      assertManifestHygiene({ ...base, readAlso: [{ path: base.field }] }),
    ).toThrow(/duplicate, not an alias/);
  });

  it("rejects a termsUrlFields entry equal to the reference field", () => {
    expect(() =>
      assertManifestHygiene({ ...base, termsUrlFields: [base.field] }),
    ).toThrow(/different objects/);
  });

  it("rejects protocol-extension claiming Tier A", () => {
    expect(() =>
      assertManifestHygiene({ ...base, pattern: "protocol-extension" }),
    ).toThrow(/Tier B by definition/);
  });

  it("rejects a reference field that can hold only a URL — Ruling B, in code", () => {
    expect(() =>
      assertManifestHygiene({
        ...base,
        encoding: "bare-value",
        carrierTypes: ["url"],
      }),
    ).toThrow(/discovery, not a placement/);
  });

  it("rejects bare-value with an ambiguous carrier type", () => {
    expect(() =>
      assertManifestHygiene({
        ...base,
        encoding: "bare-value",
        carrierTypes: ["sha256", "url"],
      }),
    ).toThrow(/exactly one carrierType/);
  });

  it("rejects a bare-value alias nothing fixes the type of", () => {
    expect(() =>
      assertManifestHygiene({
        ...base,
        carrierTypes: ["sha256", "url"],
        readAlso: [{ path: "metadata.atrHash", encoding: "bare-value" }],
      }),
    ).toThrow(/nothing fixes its type/);
  });

  it("accepts a bare-value alias whose OWN bareType fixes the type", () => {
    expect(() =>
      assertManifestHygiene({
        ...base,
        carrierTypes: ["sha256", "url"],
        readAlso: [
          {
            path: "metadata.atrHash",
            encoding: "bare-value",
            bareType: "sha256",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts a distinct termsUrlFields list — declaring slots is not itself the fault", () => {
    // The fault is a slot EQUAL to the field or an alias. A guard that threw on any declared terms URL
    // would make the shipped ACP manifest unbuildable, so the passing case is as load-bearing as the
    // failing ones (which live with the rest of the slot machinery in kit.test.ts).
    expect(() =>
      assertManifestHygiene({
        ...base,
        termsUrlFields: ["metadata.legal_context_url"],
      }),
    ).not.toThrow();
  });

  it("accepts protocol-extension AT Tier B — the pairing is only incoherent at Tier A", () => {
    expect(() =>
      assertManifestHygiene({
        ...base,
        pattern: "protocol-extension",
        tier: "B",
      }),
    ).not.toThrow();
  });

  it("accepts bare-value with exactly one carrier type", () => {
    expect(() =>
      assertManifestHygiene({
        ...base,
        encoding: "bare-value",
        carrierTypes: ["sha256"],
      }),
    ).not.toThrow();
  });

  it("catches an alias repeating the field when it is NOT the only alias", () => {
    // `some`, not `every`: a manifest whose aliases are mostly fine still has the duplicate, and a guard
    // written with `every` would pass this and reject the single-alias case — which no single-element
    // fixture can tell apart.
    expect(() =>
      assertManifestHygiene({
        ...base,
        readAlso: [{ path: "metadata.legalContext" }, { path: base.field }],
      }),
    ).toThrow(/duplicate, not an alias/);
  });
});
