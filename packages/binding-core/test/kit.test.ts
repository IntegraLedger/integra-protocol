import { describe, expect, it } from "vitest";
import {
  assertManifestHygiene,
  makePlacement,
  type PlacementManifest,
  readDeclaredPaths,
  readFromContainer,
  requireIntegrity,
  type WriteCondition,
  type WriteConditionTerm,
  writeConditionMet,
  writeToContainer,
} from "../src/index.js";

// The kit is tested EXHAUSTIVELY here, once, because it is what replaces eight near-identical package test
// suites. Each placement package then tests its own MANIFEST and its own PROTOCOL semantics — never these
// mechanics. A defect fixed here is fixed for every protocol at once, which is the whole argument for the kit.

const HASH =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER =
  "0x3f786850e387550fdab836ed7e6dc881de23001b3f786850e387550fdab836ed";
const REF = { type: "sha256", value: HASH } as const;
// Every manifest in this file declares no terms-URL slot, so every extract answers this absence — the
// protocol-level fact, distinct from a seller leaving a declared slot empty. The slot machinery has its
// own describe block below.
const NO_URL = { kind: "no-field-declared" } as const;

const objectPath: PlacementManifest = {
  protocol: "acp",
  pattern: "http-advisory",
  tier: "A",
  encoding: "lcp-string",
  container: { kind: "object-path" },
  field: "metadata.legal_context",
  carrierTypes: ["sha256"],
};

// UCP's links and Mastercard VI's constraints are the SAME rule with different data. Mastercard VI is used
// here because its carrier is a hash: a tagged array whose reference field is integrity-bearing.
const taggedArray: PlacementManifest = {
  protocol: "mastercard-vi",
  pattern: "http-advisory",
  tier: "A",
  encoding: "bare-value",
  container: {
    kind: "tagged-array",
    at: "constraints",
    tagField: "type",
    tag: "urn:example:lcp-terms-hash",
    valueField: "value",
  },
  field: "constraints[type=urn:example:lcp-terms-hash].value",
  carrierTypes: ["sha256"],
};

const headerMap: PlacementManifest = {
  protocol: "visa-tap",
  pattern: "http-advisory",
  tier: "A",
  encoding: "bare-value",
  container: { kind: "header-map" },
  field: "headers.x-lcp-hash",
  carrierTypes: ["sha256"],
};

const KINDS = [
  { name: "object-path", manifest: objectPath, empty: {} },
  { name: "tagged-array", manifest: taggedArray, empty: {} },
  { name: "header-map", manifest: headerMap, empty: {} },
] as const;

describe.each(KINDS)(
  "makePlacement — $name container",
  ({ manifest, empty }) => {
    const a = makePlacement(manifest);

    it("place → extract round-trips, and BOTH arms pin the discriminant", () => {
      const placed = a.place({ ref: REF }, empty);
      if ("refused" in placed)
        throw new Error(`expected a placement: ${placed.code}`);
      // `ok: true` is pinned explicitly, not inferred from `"refused" in placed` being false. A success arm
      // that returned `ok: false` alongside a correct value would satisfy every narrowing check here and
      // break every caller that discriminates on it — the same reason the ACP vectors pin the whole Outcome.
      expect(placed.ok).toBe(true);
      expect(a.extract(placed.value)).toEqual({
        ok: true,
        value: { ref: REF, termsUrl: NO_URL },
      });
    });

    it("creates the container when absent", () => {
      const placed = a.place({ ref: REF }, {});
      expect("refused" in placed).toBe(false);
    });

    it("is PURE — the input document is not mutated", () => {
      const doc = {
        existing: "keep",
        metadata: {},
        constraints: [],
        headers: {},
      };
      const before = JSON.stringify(doc);
      a.place({ ref: REF }, doc);
      expect(JSON.stringify(doc)).toBe(before);
    });

    it("preserves the host's own sibling keys", () => {
      const placed = a.place(
        { ref: REF },
        {
          id: "doc-1",
          merchant_ref: "SO-4417",
          metadata: { campaign: "spring" },
          constraints: [{ type: "mandate.payment.budget", value: "100" }],
          headers: { "content-type": "application/json" },
        },
      );
      if ("refused" in placed) throw new Error("expected a placement");
      const v = placed.value as Record<string, unknown>;
      expect(v["id"]).toBe("doc-1");
      expect(v["merchant_ref"]).toBe("SO-4417");
      // And the reference is still findable afterwards.
      expect(a.extract(placed.value)).toEqual({
        ok: true,
        value: { ref: REF, termsUrl: NO_URL },
      });
    });

    it("REPLACES rather than duplicating when placed twice", () => {
      const once = a.place({ ref: REF }, {});
      if ("refused" in once) throw new Error("expected a placement");
      const twice = a.place(
        { ref: { type: "sha256", value: OTHER } },
        once.value,
      );
      if ("refused" in twice) throw new Error("expected a placement");
      expect(a.extract(twice.value)).toEqual({
        ok: true,
        value: { ref: { type: "sha256", value: OTHER }, termsUrl: NO_URL },
      });
      // Nothing accumulated: the serialized form must not contain the superseded value anywhere.
      expect(JSON.stringify(twice.value)).not.toContain(HASH);
    });

    it("REFUSES a non-object document, and never repairs one", () => {
      for (const doc of [null, "s", 3, [], true]) {
        // haltClass is pinned, not just refused/code: it is part of the refusal CONTRACT that callers switch
        // on, unlike `detail`, which is prose the corpus deliberately omits.
        expect(a.place({ ref: REF }, doc)).toMatchObject({
          refused: true,
          haltClass: "verification-failure",
          code: `${manifest.protocol}/document-malformed`,
        });
        expect(a.extract(doc)).toMatchObject({
          refused: true,
          haltClass: "verification-failure",
          code: `${manifest.protocol}/document-malformed`,
        });
      }
    });

    it("REPLACES an unmergeable direct holder rather than spreading it", () => {
      // `placement-acp`'s ratified rule, generalized: spreading `metadata: "not-a-map"` would explode it into
      // {0:'n',1:'o',…}, and arrays are objects to `typeof` so `{...['a','b']}` would emit {0:'a',1:'b'}. A
      // placement declines to corrupt; it does not adjudicate the host's document.
      const at = (
        manifest.container.kind === "tagged-array"
          ? manifest.container.at
          : manifest.field.split(".")[0]
      ) as string;
      for (const junk of ["not-a-container", 7, true, ["a", "b"]]) {
        const placed = a.place({ ref: REF }, { id: "keep", [at]: junk });
        if ("refused" in placed)
          throw new Error(`expected a placement, got ${placed.code}`);
        expect((placed.value as Record<string, unknown>)["id"]).toBe("keep");
        expect(a.extract(placed.value)).toEqual({
          ok: true,
          value: { ref: REF, termsUrl: NO_URL },
        });
        // Nothing from the unmergeable value leaked in as numeric keys.
        expect(JSON.stringify(placed.value)).not.toContain('"0"');
      }
    });

    it("extract REFUSES on an absent reference — never a placeholder", () => {
      expect(a.extract({})).toMatchObject({
        refused: true,
        code: `${manifest.protocol}/reference-absent`,
      });
    });

    it("REFUSES a carrier type the manifest does not permit, on both members", () => {
      expect(
        a.place({ ref: { type: "url", value: "https://x.test/t" } }, {}),
      ).toMatchObject({
        refused: true,
        code: `${manifest.protocol}/carrier-type-not-permitted`,
      });
    });

    it("REFUSES a corrupt carrier value rather than minting one", () => {
      expect(
        a.place({ ref: { type: "sha256", value: HASH.slice(2) } }, {}),
      ).toMatchObject({
        refused: true,
        code: `${manifest.protocol}/reference-malformed`,
      });
    });

    it("extract REFUSES a present-but-unparseable value — distinct from absent", () => {
      // The field is THERE, so the absent path does not fire; the value simply does not decode. Two different
      // refusals with two different codes, and only a case that reaches the second proves it exists.
      const junk =
        manifest.encoding === "bare-value" ? "not-a-hash" : "not-a-reference";
      const doc = writeToContainer(
        {},
        manifest.container,
        manifest.field,
        junk,
      );
      expect(a.extract(doc)).toMatchObject({
        refused: true,
        haltClass: "verification-failure",
        code: `${manifest.protocol}/reference-malformed`,
      });
    });

    it("extract REFUSES a well-formed carrier of an unpermitted TYPE, where the wire carries a type", () => {
      // Only reachable for the type-TAGGED encodings. Under `bare-value` the type is fixed by the manifest
      // rather than read off the wire, so `decoded.type` is `carrierTypes[0]` by construction and can never
      // be unpermitted — a URL written there comes back as a malformed sha256 instead. That is not a gap in
      // the check; it is the bare-value contract, and asserting otherwise here would pin a fiction.
      if (manifest.encoding === "bare-value") return;
      const wide = makePlacement({
        ...manifest,
        carrierTypes: ["sha256", "url"],
      });
      const placed = wide.place(
        { ref: { type: "url", value: "https://x.test/t" } },
        {},
      );
      if ("refused" in placed) throw new Error("expected a placement");
      expect(a.extract(placed.value)).toMatchObject({
        refused: true,
        haltClass: "verification-failure",
        code: `${manifest.protocol}/carrier-type-not-permitted`,
      });
    });

    it("namespaces every refusal code from the manifest's protocol", () => {
      const out = a.extract({});
      expect(
        (out as { code: string }).code.startsWith(`${manifest.protocol}/`),
      ).toBe(true);
    });

    it("both members are TOTAL — a hostile document is a refusal, never a throw", () => {
      for (const doc of [null, undefined, 3, "s", [], true, { metadata: 7 }]) {
        expect(() => a.extract(doc)).not.toThrow();
        expect(() => a.place({ ref: REF }, doc)).not.toThrow();
      }
    });
  },
);

describe("tagged-array — the rules that only an array can have", () => {
  const a = makePlacement(taggedArray);
  const c = taggedArray.container as Extract<
    PlacementManifest["container"],
    { kind: "tagged-array" }
  >;

  it("keeps a matching entry's OWN sibling keys when replacing its value", () => {
    const placed = a.place(
      { ref: REF },
      {
        constraints: [
          { type: c.tag, value: OTHER, note: "set by the host", extra: 1 },
        ],
      },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    const arr = (placed.value as { constraints: Record<string, unknown>[] })
      .constraints;
    expect(arr).toHaveLength(1);
    expect(arr[0]).toEqual({
      type: c.tag,
      value: HASH,
      note: "set by the host",
      extra: 1,
    });
  });

  it("APPENDS when no entry carries the tag, leaving the host's entries alone", () => {
    const placed = a.place(
      { ref: REF },
      {
        constraints: [{ type: "mandate.payment.budget", value: "100" }],
      },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    const arr = (placed.value as { constraints: unknown[] }).constraints;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toEqual({ type: "mandate.payment.budget", value: "100" });
    expect(arr[1]).toEqual({ type: c.tag, value: HASH });
  });

  it("creates an array holding EXACTLY the one entry when the container is absent", () => {
    const placed = a.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      constraints: [{ type: c.tag, value: HASH }],
    });
  });

  it("rewrites only the FIRST matching entry when a tag is duplicated", () => {
    // The read rule is first-wins, so the write rule must be too. Rewriting both would make the document
    // self-consistent by force and hide the host's duplicate; rewriting the second would change which record
    // the reader answers with.
    const placed = a.place(
      { ref: REF },
      {
        constraints: [
          { type: c.tag, value: OTHER, n: 1 },
          { type: c.tag, value: OTHER, n: 2 },
        ],
      },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    expect((placed.value as { constraints: unknown[] }).constraints).toEqual([
      { type: c.tag, value: HASH, n: 1 },
      { type: c.tag, value: OTHER, n: 2 },
    ]);
  });

  it("reads the FIRST matching entry — a duplicate tag never lets a later entry win", () => {
    expect(
      readFromContainer(
        {
          constraints: [
            { type: c.tag, value: HASH },
            { type: c.tag, value: OTHER },
          ],
        },
        c,
        taggedArray.field,
      ),
    ).toBe(HASH);
  });

  it("skips non-object entries instead of throwing on them", () => {
    expect(
      readFromContainer(
        { constraints: [null, "x", 3, { type: c.tag, value: HASH }] },
        c,
        taggedArray.field,
      ),
    ).toBe(HASH);
  });

  it("returns undefined when the matching entry lacks the value field", () => {
    expect(
      readFromContainer(
        { constraints: [{ type: c.tag }] },
        c,
        taggedArray.field,
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the container is not an array", () => {
    expect(
      readFromContainer({ constraints: { type: c.tag } }, c, taggedArray.field),
    ).toBeUndefined();
  });
});

describe("the malformed-container rule — replace the direct holder, refuse above it", () => {
  // Deep path so `outer` is an INTERMEDIATE and `inner` is the field's direct holder. ACP cannot evidence
  // this distinction — its path has exactly one segment above the field — so it is pinned here.
  const deep = makePlacement({
    ...objectPath,
    field: "outer.inner.legal_context",
  });

  it("REPLACES an unmergeable DIRECT HOLDER", () => {
    const placed = deep.place(
      { ref: REF },
      { outer: { inner: "junk", keep: 1 } },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      outer: {
        inner: { legal_context: `lcp:sha256:${HASH}` },
        keep: 1,
      },
    });
  });

  it("REFUSES an unmergeable INTERMEDIATE — replacing it would discard everything beneath", () => {
    expect(deep.place({ ref: REF }, { outer: "junk" })).toMatchObject({
      refused: true,
      code: "acp/document-malformed",
    });
  });

  it("creates every absent level on the way down", () => {
    const placed = deep.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      outer: { inner: { legal_context: `lcp:sha256:${HASH}` } },
    });
  });

  it("preserves siblings at EVERY level of a nested write, not just the innermost", () => {
    // The guarantee `placement-ack` depends on, proved here where it lives. ACK writes at
    // credentialSubject → metadata → leaf, so a two-level write that spread the wrong level would drop a
    // whole set of sibling keys — the receipt's payer id and payment claims, or ACK's own policyRef /
    // mandateRef / executionRef / settlementReference — while every other test in this file still passed.
    // That silence is why the case belongs to the kit and not only to the package that happens to use it.
    const placed = deep.place(
      { ref: REF },
      {
        top: "kept",
        outer: { mid: "kept", inner: { deepSibling: "kept" } },
      },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      top: "kept",
      outer: {
        mid: "kept",
        inner: { deepSibling: "kept", legal_context: `lcp:sha256:${HASH}` },
      },
    });
  });
});

describe("header-map — RFC 9110 case-insensitivity", () => {
  const a = makePlacement(headerMap);
  const c = headerMap.container;

  it("READS a header whose casing differs from the manifest's", () => {
    expect(
      readFromContainer(
        { headers: { "X-LCP-Hash": HASH } },
        c,
        headerMap.field,
      ),
    ).toBe(HASH);
    expect(
      readFromContainer(
        { headers: { "x-lcp-hash": HASH } },
        c,
        headerMap.field,
      ),
    ).toBe(HASH);
  });

  it("extract finds a differently-cased header end to end", () => {
    expect(a.extract({ headers: { "X-LCP-HASH": HASH } })).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });

  it("REUSES the existing key's casing rather than adding a second same-named header", () => {
    const placed = a.place({ ref: REF }, { headers: { "X-LCP-Hash": OTHER } });
    if ("refused" in placed) throw new Error("expected a placement");
    const h = (placed.value as { headers: Record<string, unknown> }).headers;
    expect(Object.keys(h)).toEqual(["X-LCP-Hash"]);
    expect(h["X-LCP-Hash"]).toBe(HASH);
  });

  it("writes the manifest's own casing when no header matches", () => {
    const out = writeToContainer({}, c, headerMap.field, HASH) as {
      headers: Record<string, unknown>;
    };
    expect(Object.keys(out.headers)).toEqual(["x-lcp-hash"]);
  });

  it("treats the DOCUMENT as the header map when the locator is a bare header name", () => {
    // Visa TAP's request headers ARE the document — there is no wrapper object to nest under. A locator with
    // no dot is the only thing that exercises that branch, and every other fixture here has one.
    const bare = makePlacement({ ...headerMap, field: "x-lcp-hash" });
    const placed = bare.place(
      { ref: REF },
      { "content-type": "application/json" },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      "content-type": "application/json",
      "x-lcp-hash": HASH,
    });
    expect(bare.extract({ "X-LCP-Hash": HASH })).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });

  it("REPLACES an unmergeable header map at a nested locator", () => {
    const placed = a.place({ ref: REF }, { headers: "junk", keep: 1 });
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({ keep: 1, headers: { "x-lcp-hash": HASH } });
  });
});

describe("object-path segments — a key containing literal dots", () => {
  // UCP capability keys follow [reverse-domain].{service}.{capability}: com.integraledger.legal-context is
  // ONE key under `extensions`, not four nested objects. `segments` is the machine-readable walk; `field`
  // stays human documentation, exactly as tagged-array divides the same labour.
  const dotted = makePlacement({
    protocol: "ucp",
    pattern: "http-advisory",
    tier: "A",
    encoding: "reference-object",
    container: {
      kind: "object-path",
      segments: ["extensions", "com.integraledger.legal-context"],
    },
    field: 'extensions["com.integraledger.legal-context"]',
    carrierTypes: ["sha256"],
  });

  it("round-trips through the dotted key as ONE key", () => {
    const placed = dotted.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      extensions: {
        "com.integraledger.legal-context": { type: "sha256", value: HASH },
      },
    });
    expect(dotted.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });

  it("does NOT read a nested spelling a dot-split would have found", () => {
    // The adversarial shape: a document nesting com → integraledger → legal-context. A dot-splitting walker
    // would find it and answer with a reference the manifest never declared readable.
    const nested = {
      extensions: {
        com: {
          integraledger: { "legal-context": { type: "sha256", value: HASH } },
        },
      },
    };
    expect(dotted.extract(nested)).toMatchObject({
      refused: true,
      code: "ucp/reference-absent",
    });
  });

  it("preserves sibling capabilities under extensions", () => {
    const placed = dotted.place(
      { ref: REF },
      {
        extensions: { "dev.ucp.checkout": { version: "1" } },
      },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      extensions: {
        "dev.ucp.checkout": { version: "1" },
        "com.integraledger.legal-context": { type: "sha256", value: HASH },
      },
    });
  });
});

describe("a MIXED-container manifest — UCP's actual shape", () => {
  // v1.37 §C.3, and a shape UCP turned out not to have — kept as a KIT fixture, not as UCP's. The canonical
  // capability was read as an object-path; the discovery carrier the spec advises publishing
  // alongside it is a tagged-array. One placement, two container kinds, and `write: true` on the alias so
  // both land — which is what the write flag was built for and could not express until the alias could
  // declare its own container.
  const ucp = makePlacement({
    protocol: "ucp",
    pattern: "http-advisory",
    tier: "A",
    encoding: "reference-object",
    container: { kind: "object-path" },
    field: "extensions.com-integraledger-legal-context",
    readAlso: [
      {
        path: "links[type=terms_of_service].url",
        encoding: "bare-value",
        bareType: "url",
        carrierClass: "discovery",
        write: true,
        container: {
          kind: "tagged-array",
          at: "links",
          tagField: "type",
          tag: "terms_of_service",
          valueField: "url",
        },
      },
    ],
    carrierTypes: ["sha256", "url"],
  });

  it("writes BOTH carriers, each through its own container kind", () => {
    const placed = ucp.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      extensions: {
        "com-integraledger-legal-context": { type: "sha256", value: HASH },
      },
      links: [{ type: "terms_of_service", url: HASH }],
    });
  });

  it("reads back the CAPABILITY, not the links entry, when both are present", () => {
    const placed = ucp.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error("expected a placement");
    expect(ucp.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });

  it("appends to a links array the host already populated, preserving its entries", () => {
    const placed = ucp.place(
      { ref: REF },
      {
        links: [{ type: "privacy_policy", url: "https://x.test/privacy" }],
      },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    expect((placed.value as { links: unknown[] }).links).toEqual([
      { type: "privacy_policy", url: "https://x.test/privacy" },
      { type: "terms_of_service", url: HASH },
    ]);
  });

  it("falls to the tagged-array alias when the capability was PRUNED, and labels it discovery", () => {
    // §C.3's actual failure mode: a vendor capability outside the negotiated intersection is silently
    // removed. The links carrier survives, and a reader must be told it is discovery — not integrity.
    const doc = {
      links: [{ type: "terms_of_service", url: "https://x.test/t" }],
    };
    const hit = readDeclaredPaths(doc, ucp.manifest);
    expect(hit?.carrierClass).toBe("discovery");
    expect(requireIntegrity(hit)).toBeUndefined();
    expect(ucp.extract(doc)).toEqual({
      ok: true,
      value: {
        ref: { type: "url", value: "https://x.test/t" },
        termsUrl: NO_URL,
      },
    });
  });

  it("passes the hygiene guard", () => {
    expect(() => assertManifestHygiene(ucp.manifest)).not.toThrow();
  });
});

describe("the own-property invariant holds on BOTH halves, not just on read", () => {
  // Found in review. `readAtPath` guarded inherited properties and had a test proving it; `writeAtPath` did
  // not, so `place` and `extract` disagreed about what a document contains. A document is attacker-influenced
  // input on the way IN as much as on the way OUT.
  const a = makePlacement(objectPath);

  it("place does not merge an INHERITED container into the document it emits", () => {
    const doc = Object.create({ metadata: { attacker: "controlled" } });
    expect(Object.keys(doc)).toEqual([]); // zero own properties
    const placed = a.place({ ref: REF }, doc);
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      metadata: { legal_context: `lcp:sha256:${HASH}` },
    });
    expect(JSON.stringify(placed.value)).not.toContain("attacker");
  });

  it("place and extract AGREE about presence on a prototype-backed document", () => {
    const doc = Object.create({
      metadata: { legal_context: `lcp:sha256:${OTHER}` },
    });
    // extract sees nothing, so place must not see a container either.
    expect(a.extract(doc)).toMatchObject({ code: "acp/reference-absent" });
    const placed = a.place({ ref: REF }, doc);
    if ("refused" in placed) throw new Error("expected a placement");
    expect(a.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });

  it("a tagged-array entry that only INHERITS the tag is not selected, on read or write", () => {
    const t = makePlacement(taggedArray);
    const c = taggedArray.container as Extract<
      PlacementManifest["container"],
      { kind: "tagged-array" }
    >;
    const inherited = Object.create({ type: c.tag, value: OTHER });
    expect(
      readFromContainer({ constraints: [inherited] }, c, taggedArray.field),
    ).toBeUndefined();
    // And the writer appends its own entry rather than rewriting one that never claimed the tag.
    const placed = t.place({ ref: REF }, { constraints: [inherited] });
    if ("refused" in placed) throw new Error("expected a placement");
    expect(
      (placed.value as { constraints: unknown[] }).constraints,
    ).toHaveLength(2);
    expect(t.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });
});

describe("writeToContainer — called directly, outside makePlacement's guards", () => {
  // `place` narrows the document before delegating, so these branches are unreachable through it. The
  // function is exported, so a caller can reach them and they must still be total.
  it("returns undefined for a non-object document, on every container kind", () => {
    for (const m of [objectPath, taggedArray, headerMap])
      for (const doc of [null, "s", 3, [], true])
        expect(
          writeToContainer(doc, m.container, m.field, HASH),
        ).toBeUndefined();
  });

  it("returns undefined for a locator with an empty leaf segment", () => {
    expect(
      writeToContainer({}, { kind: "object-path" }, "metadata.", HASH),
    ).toBeUndefined();
    expect(
      writeToContainer({}, { kind: "object-path" }, "", HASH),
    ).toBeUndefined();
  });

  it("returns undefined for a non-object document even on a BARE header locator", () => {
    // The nested-locator cases above all bottom out in writeAtPath, which rejects a non-object root anyway.
    // A bare locator returns the header map DIRECTLY without going through writeAtPath, so this is the only
    // shape where header-map's own document check is load-bearing.
    for (const doc of [null, "s", 3, [], true])
      expect(
        writeToContainer(doc, { kind: "header-map" }, "x-lcp-hash", HASH),
      ).toBeUndefined();
  });
});

describe("makePlacement — a write-alias onto a malformed path refuses the whole place", () => {
  const m = makePlacement({
    ...objectPath,
    readAlso: [{ path: "outer.inner.copy", write: true }],
  });

  it("refuses rather than emitting a document with only half the declared carriers", () => {
    // `outer` is an unmergeable INTERMEDIATE for the alias, so the alias write fails. The canonical write
    // already succeeded, and returning that partial document would put a reference on the wire while
    // silently dropping a carrier the manifest promises to populate.
    expect(m.place({ ref: REF }, { outer: "junk" })).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "acp/document-malformed",
    });
  });

  it("writes both carriers when the alias path is clean", () => {
    const placed = m.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      metadata: { legal_context: `lcp:sha256:${HASH}` },
      outer: { inner: { copy: `lcp:sha256:${HASH}` } },
    });
  });
});

describe("makePlacement — aliases", () => {
  const withAlias = makePlacement({
    ...objectPath,
    readAlso: [
      { path: "legal_context", encoding: "reference-object" },
      {
        path: "terms.url",
        encoding: "bare-value",
        bareType: "url",
        carrierClass: "discovery",
      },
    ],
    carrierTypes: ["sha256", "url"],
  });

  it("reads an alias in its OWN encoding, not the manifest's", () => {
    expect(
      withAlias.extract({ legal_context: { type: "sha256", value: HASH } }),
    ).toEqual({ ok: true, value: { ref: REF, termsUrl: NO_URL } });
  });

  it("prefers the canonical field over every alias", () => {
    expect(
      withAlias.extract({
        metadata: { legal_context: `lcp:sha256:${HASH}` },
        legal_context: { type: "sha256", value: OTHER },
      }),
    ).toEqual({ ok: true, value: { ref: REF, termsUrl: NO_URL } });
  });

  it("takes aliases in DECLARED order when several are present", () => {
    expect(
      withAlias.extract({
        legal_context: { type: "sha256", value: HASH },
        terms: { url: "https://x.test/t" },
      }),
    ).toEqual({ ok: true, value: { ref: REF, termsUrl: NO_URL } });
  });

  it("does NOT write an alias that lacks the write flag", () => {
    const placed = withAlias.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      metadata: { legal_context: `lcp:sha256:${HASH}` },
    });
  });
});

describe("makePlacement — the write flag, which is what UCP §C.3 needs", () => {
  // §C.3: a vendor capability is SILENTLY pruned from the negotiated intersection when the counterparty has
  // not declared it, so a deployment requiring legal context regardless publishes at the links level too.
  const writeBoth = makePlacement({
    ...objectPath,
    protocol: "ucp",
    encoding: "reference-object",
    field: "extensions.legal-context",
    readAlso: [
      {
        path: "fallback.terms_hash",
        encoding: "bare-value",
        bareType: "sha256",
        write: true,
      },
    ],
  });

  it("writes BOTH carriers, each in its own encoding", () => {
    const placed = writeBoth.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error("expected a placement");
    expect(placed.value).toEqual({
      extensions: { "legal-context": { type: "sha256", value: HASH } },
      fallback: { terms_hash: HASH },
    });
  });

  it("still prefers the canonical carrier on the way back out", () => {
    const placed = writeBoth.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error("expected a placement");
    expect(writeBoth.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });

  it("reads the written fallback when the canonical carrier was pruned", () => {
    // Exactly the §C.3 scenario: the capability never survived negotiation, and only the fallback remains.
    expect(writeBoth.extract({ fallback: { terms_hash: HASH } })).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
// writeCondition — the conditional-write axis.
//
// Certified HERE as well as in `placement-acp` — which now ships the alias half and forces it through 15
// corpus cases — because the kit implements rules no shipped manifest exercises: a manifest-level gate that
// REFUSES (Ruling A's declared-extension placement, a second ACP placement the registry defers), the
// ordering against carrier-type and encoding checks, and the conjunction's authoring guards. That is the same
// reason the malformed-INTERMEDIATE rule is pinned in this file. A rule the kit implements is a rule the kit
// proves.
//
// THE GATE IS READ FROM THE HOST SPEC, NOT FROM LCP'S APPENDIX. ACP negotiates extensions per checkout
// session: the agent's request carries `capabilities.extensions` as an array of identifier STRINGS, and the
// session response carries an array of declaration OBJECTS (name / extends / schema / spec) for those active
// in the session (agenticcommerce.dev/docs/concepts/extensions, read 2026-07-30; v1.37 §C.2). The reading
// was that because `CheckoutSessionBase` is additionalProperties:false, the declaration whose `extends`
// names `$.CheckoutSession.legal_context` IS what authorizes that field — so the gate read the
// authorization for the field it was about to write, and a session without it rejected entirely.
//
// v1.38 §C.2 WITHDREW THAT PATH: "That declaration does not make a new top-level field valid." The
// released schema was measured INVALID for such a session, `placement-acp` retired the write, and no
// shipped manifest declares a writeCondition today. The gate is certified here because the KIT still
// implements the axis — see the note above — not because ACP still exercises it.
//
// MASTERCARD VI IS THE SECOND CONSUMER, and its gate is certified in `placement-mastercard-vi` and the
// `placement.mastercard-vi` corpus area rather than here — an axis consumer that ships as a package proves the
// axis where it is used. Its constraints specification (verifiableintent.dev/spec/constraints/, read
// 2026-07-30) puts the `constraints` array solely in Autonomous L2 open mandates and states outright:
// "Constraints do NOT appear in Immediate mode credentials (`vct: \"mandate.checkout.1\"` and
// `vct: \"mandate.payment.1\"`)" — the only two non-open values — so its gate compares `vct` against the two
// open ones and needs the SET that ACP's degenerate single-value gate does not. What that gate does not carry
// is the tier: in the open mandates "Regardless of strictness mode, verifiers MUST reject open mandates
// containing unknown constraint types", so a custom LCP type has no home against a stock verifier, which the
// package declares as `tier: "B"`. v1.37 §C.7's Tier A rested on closed mandates carrying constraints and on
// a `stage` field the live spec does not have; v1.38 §C.7 retired it — "Tier B — there is no Tier A
// carrier" — so this is the appendix's reading now, not drift from it.

// ACP's session gate. A tagged array whose valueField IS its tagField: the entry that identifies itself, so
// the reader can only ever return the tag, and `permits` must list it (assertManifestHygiene holds that).
// Namespace is com.integraledger.* — the reverse domain this deployment controls (ruled 2026-07-29).
const extensionGate: WriteCondition = {
  path: "capabilities.extensions[name=com.integraledger.legal-context].name",
  container: {
    kind: "tagged-array",
    at: "capabilities.extensions",
    tagField: "name",
    tag: "com.integraledger.legal-context",
    valueField: "name",
  },
  permits: ["com.integraledger.legal-context"],
};

const negotiated = {
  capabilities: {
    extensions: [
      {
        name: "com.integraledger.legal-context",
        extends: ["$.CheckoutSession.legal_context"],
      },
    ],
  },
};

describe("writeCondition on the MANIFEST — the reference field itself is gated", () => {
  // Ruling A's declared-extension placement: the top-level field IS the placement, so an unmet gate leaves
  // nothing placed and `place` must refuse rather than succeed emptily.
  const declared = makePlacement({
    protocol: "acp",
    pattern: "http-advisory",
    tier: "A",
    encoding: "reference-object",
    container: { kind: "object-path" },
    field: "legal_context",
    carrierTypes: ["sha256"],
    writeCondition: extensionGate,
  });

  it("places into a session that declares the extension active", () => {
    const placed = declared.place({ ref: REF }, negotiated);
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      capabilities: {
        extensions: [
          {
            name: "com.integraledger.legal-context",
            extends: ["$.CheckoutSession.legal_context"],
          },
        ],
      },
      legal_context: { type: "sha256", value: HASH },
    });
  });

  it("REFUSES a stock session — the field is unauthorized, so nothing was placed", () => {
    expect(declared.place({ ref: REF }, { id: "checkout_1" })).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "acp/write-condition-unmet",
    });
  });

  it("REFUSES a session that negotiated SOMEONE ELSE's extension", () => {
    expect(
      declared.place(
        { ref: REF },
        {
          capabilities: { extensions: [{ name: "discount" }] },
        },
      ),
    ).toMatchObject({ refused: true, code: "acp/write-condition-unmet" });
  });

  it("REFUSES the REQUEST shape — a bare identifier array is not a declaration", () => {
    // The documented limit of the axis, pinned rather than asserted: the agent's request carries identifier
    // strings, and this gate resolves declaration objects. Fail-closed is the only safe reading — writing on
    // the strength of what an agent said it understands, before the seller declared anything, is the
    // rejection the gate exists to prevent.
    expect(
      declared.place(
        { ref: REF },
        {
          capabilities: { extensions: ["com.integraledger.legal-context"] },
        },
      ),
    ).toMatchObject({ refused: true, code: "acp/write-condition-unmet" });
  });

  it("refuses rather than emitting a document — a refusal carries no partial value", () => {
    expect("value" in declared.place({ ref: REF }, { id: "checkout_1" })).toBe(
      false,
    );
  });

  it("REFUSES when the gate path is wholly ABSENT — fail-closed, never write-and-hope", () => {
    // Treating absence as permission is exactly the fail-open the allow-list exists to prevent.
    expect(declared.place({ ref: REF }, {})).toMatchObject({
      refused: true,
      code: "acp/write-condition-unmet",
    });
  });

  it("REFUSES a non-string value where the declaration's name belongs", () => {
    expect(
      declared.place(
        { ref: REF },
        { capabilities: { extensions: [{ name: 1 }] } },
      ),
    ).toMatchObject({ refused: true, code: "acp/write-condition-unmet" });
  });

  it("does NOT gate extract — a reference already on the wire is read either way", () => {
    // The condition says what WE may write, never what a counterparty did. A document carrying a reference
    // carries it; refusing to read one because the session declared nothing discards evidence that exists.
    expect(
      declared.extract({ legal_context: { type: "sha256", value: HASH } }),
    ).toEqual({ ok: true, value: { ref: REF, termsUrl: NO_URL } });
  });

  it("a MALFORMED document refuses document-malformed, not write-condition-unmet", () => {
    // Ordering, pinned: there is no gate to read out of a non-object, and answering with the gate's code
    // would misreport a broken document as a permitted-but-declined write.
    expect(declared.place({ ref: REF }, null)).toMatchObject({
      refused: true,
      code: "acp/document-malformed",
    });
  });

  it("an unpermitted CARRIER TYPE outranks the gate — that check is about the ref alone", () => {
    expect(
      declared.place({ ref: { type: "url", value: "https://x.test/t" } }, {}),
    ).toMatchObject({
      refused: true,
      code: "acp/carrier-type-not-permitted",
    });
  });

  it("the gate precedes ENCODING — an unmet gate is reported even when the ref is also corrupt", () => {
    // Otherwise a seller fixing the reported error would fix the value and hit the gate second, having been
    // told the document was acceptable when it was not.
    expect(
      declared.place({ ref: { type: "sha256", value: "not-a-hash" } }, {}),
    ).toMatchObject({
      refused: true,
      code: "acp/write-condition-unmet",
    });
  });

  it("passes the hygiene guard", () => {
    expect(() => assertManifestHygiene(declared.manifest)).not.toThrow();
  });
});

describe("writeCondition on an ALIAS — one carrier is gated, the placement stands", () => {
  // `placement-acp` as it will ship: the SAME gate as the declared-extension placement above, on the same
  // top-level field, but here beside an unconditional `metadata.legal_context`. The metadata carrier requires
  // nothing of the counterparty, so an unmet gate must leave the placement standing rather than refuse it.
  const acp = makePlacement({
    ...objectPath,
    readAlso: [
      {
        path: "legal_context",
        encoding: "reference-object",
        write: true,
        writeCondition: extensionGate,
      },
    ],
  });

  it("writes BOTH carriers when the extension is active in the session", () => {
    const placed = acp.place({ ref: REF }, negotiated);
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      capabilities: {
        extensions: [
          {
            name: "com.integraledger.legal-context",
            extends: ["$.CheckoutSession.legal_context"],
          },
        ],
      },
      metadata: { legal_context: `lcp:sha256:${HASH}` },
      legal_context: { type: "sha256", value: HASH },
    });
  });

  it("writes ONLY the canonical carrier on a stock session, and still succeeds", () => {
    // The whole reason the condition sits on the alias. Refusing here would mean no legal context could be
    // recorded against any counterparty that has not adopted the extensions framework — most of them today —
    // and writing it anyway would have stock ACP reject the session.
    const placed = acp.place({ ref: REF }, { id: "checkout_1" });
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      id: "checkout_1",
      metadata: { legal_context: `lcp:sha256:${HASH}` },
    });
  });

  it("declines the gated carrier when the session negotiated SOMEONE ELSE's extension", () => {
    const placed = acp.place(
      { ref: REF },
      {
        capabilities: { extensions: [{ name: "discount" }] },
      },
    );
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      capabilities: { extensions: [{ name: "discount" }] },
      metadata: { legal_context: `lcp:sha256:${HASH}` },
    });
  });

  it("mints nothing on the way past a declined carrier — no empty containers", () => {
    const placed = acp.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      metadata: { legal_context: `lcp:sha256:${HASH}` },
    });
  });

  it("reads the gated carrier back out whether or not we could have written it", () => {
    // extract is ungated on an alias for the same reason it is ungated on the field: the counterparty's
    // document is evidence, not a permission question.
    expect(
      acp.extract({ legal_context: { type: "sha256", value: HASH } }),
    ).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: NO_URL },
    });
  });

  it("the gate reads the INPUT document, never the one we are part-way through writing", () => {
    // A gate satisfied by our own canonical write would be self-certifying: the alias would land because we
    // put the value there, not because the counterparty declared anything.
    const selfGated = makePlacement({
      ...objectPath,
      readAlso: [
        {
          path: "mirror.copy",
          write: true,
          writeCondition: {
            path: "metadata.legal_context",
            container: { kind: "object-path" },
            permits: [`lcp:sha256:${HASH}`],
          },
        },
      ],
    });
    const placed = selfGated.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      metadata: { legal_context: `lcp:sha256:${HASH}` },
    });
  });

  it("an alias with NO condition is untouched by the axis", () => {
    const plain = makePlacement({
      ...objectPath,
      readAlso: [{ path: "mirror.copy", write: true }],
    });
    const placed = plain.place({ ref: REF }, {});
    if ("refused" in placed) throw new Error(`refused: ${placed.code}`);
    expect(placed.value).toEqual({
      metadata: { legal_context: `lcp:sha256:${HASH}` },
      mirror: { copy: `lcp:sha256:${HASH}` },
    });
  });

  it("a manifest-level refusal writes NOTHING, not even an alias whose own gate is met", () => {
    const both = makePlacement({
      ...objectPath,
      field: "legal_context",
      encoding: "reference-object",
      writeCondition: extensionGate,
      readAlso: [
        {
          path: "mirror.copy",
          write: true,
          writeCondition: {
            path: "mode",
            container: { kind: "object-path" },
            permits: ["permissive"],
          },
        },
      ],
    });
    expect(both.place({ ref: REF }, { mode: "permissive" })).toMatchObject({
      refused: true,
      code: "acp/write-condition-unmet",
    });
  });

  it("passes the hygiene guard", () => {
    expect(() => assertManifestHygiene(acp.manifest)).not.toThrow();
  });
});

describe("writeConditionMet — the predicate a caller can ask BEFORE placing", () => {
  it("answers ACP's gate without provoking a refusal", () => {
    expect(writeConditionMet(negotiated, extensionGate)).toBe(true);
    expect(
      writeConditionMet(
        { capabilities: { extensions: [{ name: "discount" }] } },
        extensionGate,
      ),
    ).toBe(false);
  });

  it("is false when the gate value is absent or the document is not one", () => {
    expect(writeConditionMet({}, extensionGate)).toBe(false);
    expect(writeConditionMet(null, extensionGate)).toBe(false);
    expect(writeConditionMet("a session", extensionGate)).toBe(false);
  });

  it("matches ANY permitted value, not just the first", () => {
    // The kit's own contract, on a synthetic gate: `permits` is a set, so every member must count. The set is
    // load-bearing at both ends. ACP's DECLARATION term is the degenerate single-value case, its tagged-array
    // reader having already filtered on `container.tag`; its DOCUMENT-KIND term enumerates all eleven values of
    // `CheckoutSessionBase.status`, because that closed enum is what distinguishes a session response from a
    // request. The set is also why an object-path gate is safe at all — presence alone would fail open.
    const twoValued: WriteCondition = {
      path: "mode",
      container: { kind: "object-path" },
      permits: ["permissive", "advisory"],
    };
    expect(writeConditionMet({ mode: "permissive" }, twoValued)).toBe(true);
    expect(writeConditionMet({ mode: "advisory" }, twoValued)).toBe(true);
    expect(writeConditionMet({ mode: "strict" }, twoValued)).toBe(false);
    expect(writeConditionMet({ mode: 1 }, twoValued)).toBe(false);
  });

  it("resolves the gate through the container it declares, not the document's shape", () => {
    const headerGate: WriteCondition = {
      path: "headers.x-lcp-negotiated",
      container: { kind: "header-map" },
      permits: ["com.integraledger.legal-context"],
    };
    // RFC 9110 folding applies to the gate exactly as it applies to a carrier — the same reader resolves both.
    expect(
      writeConditionMet(
        { headers: { "X-LCP-Negotiated": "com.integraledger.legal-context" } },
        headerGate,
      ),
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────────────────
// `and` — a gate is a CONJUNCTION, and ACP is the reason.
//
// An extension declaration authorizes a field on the ONE schema its `extends` target names: ACP's own core
// `discount` extension enumerates `$.CheckoutSessionCreateRequest.discounts`,
// `$.CheckoutSessionUpdateRequest.discounts` and `$.CheckoutSession.discounts` as three separate targets
// (schema.extension.json, live spec read 2026-07-30). Ours names `$.CheckoutSession.legal_context` — the
// RESPONSE and nothing else. But `Capabilities` is ONE definition shared by request and response, and its
// `extensions` `oneOf` is UNDISCRIMINATED, so a schema-valid `CheckoutSessionCreateRequest` may carry
// declaration OBJECTS and satisfy the declaration term. Validated against the live schema: with that term
// alone, a valid create request goes in and an INVALID one comes out — `legal_context` against
// `additionalProperties: false`, named by nothing. So the second fact is load-bearing, and `status` carries
// it: REQUIRED on `CheckoutSessionBase`, a closed eleven-value enum, and absent from every request schema.
const sessionKind: WriteConditionTerm = {
  path: "status",
  container: { kind: "object-path" },
  permits: ["ready_for_payment", "completed"],
};
const gatedBoth: WriteCondition = { ...extensionGate, and: [sessionKind] };
const sessionResponse = {
  ...negotiated,
  status: "ready_for_payment",
};

describe("writeCondition `and` — every term holds, or the write declines", () => {
  it("is met when BOTH the declaration and the document kind answer", () => {
    expect(writeConditionMet(sessionResponse, gatedBoth)).toBe(true);
  });

  it("is UNMET on the create-request shape — declared, but not the schema the declaration extends", () => {
    // `negotiated` carries the declaration and no `status`, which is exactly the shape that measured
    // valid-in/invalid-out before the second term existed.
    expect(writeConditionMet(negotiated, gatedBoth)).toBe(false);
  });

  it("is UNMET when the document kind answers but the declaration does not", () => {
    expect(writeConditionMet({ status: "ready_for_payment" }, gatedBoth)).toBe(
      false,
    );
  });

  it("is UNMET on a status outside the enumerated set — fail-closed, never fail-open", () => {
    expect(
      writeConditionMet({ ...negotiated, status: "awaiting_x" }, gatedBoth),
    ).toBe(false);
  });

  it("declines the ALIAS and leaves the placement standing, exactly as one term does", () => {
    const acp = makePlacement({
      ...objectPath,
      readAlso: [
        {
          path: "legal_context",
          encoding: "reference-object",
          write: true,
          writeCondition: gatedBoth,
        },
      ],
    });
    const declined = acp.place({ ref: REF }, negotiated);
    if ("refused" in declined) throw new Error(`refused: ${declined.code}`);
    expect(declined.value).toEqual({
      ...negotiated,
      metadata: { legal_context: `lcp:sha256:${HASH}` },
    });
    const written = acp.place({ ref: REF }, sessionResponse);
    if ("refused" in written) throw new Error(`refused: ${written.code}`);
    expect(written.value).toEqual({
      ...sessionResponse,
      metadata: { legal_context: `lcp:sha256:${HASH}` },
      legal_context: { type: "sha256", value: HASH },
    });
  });

  it("names EVERY term in a manifest-level refusal, not just the one listed first", () => {
    // A caller told only about the declaration would fix that, place again, and be refused for a reason it
    // was never given — which is the write-and-hope loop the exported predicate exists to prevent.
    const declared = makePlacement({
      ...objectPath,
      field: "legal_context",
      encoding: "reference-object",
      writeCondition: gatedBoth,
    });
    const refused = declared.place({ ref: REF }, negotiated);
    if (!("refused" in refused)) throw new Error("expected a refusal");
    expect(refused.code).toBe("acp/write-condition-unmet");
    expect(refused.detail).toContain("status is one of");
    expect(refused.detail).toContain(
      "capabilities.extensions[name=com.integraledger.legal-context].name is one of",
    );
  });

  it("THROWS on an EMPTY and — a conjunction naming no further term is the single-term gate", () => {
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        writeCondition: { ...extensionGate, and: [] },
      }),
    ).toThrow(/empty and/);
  });

  it("THROWS when two terms read the SAME path — the looser copy would decide the gate", () => {
    // No schema half: JSON Schema cannot compare two sibling values, so this rule lives only here.
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        writeCondition: {
          ...sessionKind,
          and: [{ ...sessionKind, permits: ["completed"] }],
        },
      }),
    ).toThrow(/repeat a path/);
  });

  it("holds every TERM to the rules the head term meets, and names which term is wrong", () => {
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        writeCondition: {
          ...extensionGate,
          and: [{ ...sessionKind, permits: [] }],
        },
      }),
    ).toThrow(/and\[0\] declares a writeCondition permitting nothing/);
  });

  it("accepts the ACP manifest shape whole", () => {
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        readAlso: [
          { path: "legal_context", write: true, writeCondition: gatedBoth },
        ],
      }),
    ).not.toThrow();
  });
});

describe("assertManifestHygiene — a condition on a carrier that is never written", () => {
  it("THROWS when an alias declares a writeCondition without write", () => {
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        readAlso: [{ path: "legal_context", writeCondition: extensionGate }],
      }),
    ).toThrow(/writeCondition/);
  });

  it("THROWS when the alias declares write: false explicitly", () => {
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        readAlso: [
          {
            path: "legal_context",
            write: false,
            writeCondition: extensionGate,
          },
        ],
      }),
    ).toThrow(/writeCondition/);
  });

  it("accepts the same condition once the alias declares write", () => {
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        readAlso: [
          { path: "legal_context", write: true, writeCondition: extensionGate },
        ],
      }),
    ).not.toThrow();
  });

  it("accepts a manifest-level condition, which gates a field that is always written", () => {
    expect(() =>
      assertManifestHygiene({ ...objectPath, writeCondition: extensionGate }),
    ).not.toThrow();
  });
});

describe("assertManifestHygiene — a condition NO document could satisfy", () => {
  // The other half of the axis's authoring guard. The vector schema holds the first four of these on any
  // manifest that appears in the corpus; a manifest authored in TypeScript never meets that schema, so the
  // code must hold them too, and BOTH sites are the enforcement point. An unsatisfiable gate is the same
  // defect the corpus rejects `permits: []` for — it refuses forever on the manifest and, on an alias,
  // declines with no signal at all, which is the shape of a fallback path.
  const gate = (over: Partial<WriteCondition>): PlacementManifest => ({
    ...objectPath,
    writeCondition: { ...extensionGate, ...over },
  });

  it('THROWS on an empty path — that resolves to the "" key, which a hostile document can carry', () => {
    expect(() => assertManifestHygiene(gate({ path: "" }))).toThrow(
      /empty path/,
    );
  });

  it("THROWS on empty permits — a gate naming no value refuses every document forever", () => {
    expect(() => assertManifestHygiene(gate({ permits: [] }))).toThrow(
      /permitting nothing/,
    );
  });

  it("THROWS on an empty-string permit even where another entry is sound", () => {
    // Two entries, one empty: ANY empty entry is the defect, not only an all-empty list. A gate that let the
    // sound entry excuse the empty one would pass a value no wire can carry into the allow-list.
    expect(() =>
      assertManifestHygiene(
        gate({ permits: ["com.integraledger.legal-context", ""] }),
      ),
    ).toThrow(/empty string/);
  });

  it("THROWS on repeated permits", () => {
    expect(() =>
      assertManifestHygiene(gate({ permits: ["a.b", "a.b"] })),
    ).toThrow(/repeat/);
  });

  it("THROWS when a tagged-array gate reads its own tag field and permits omits the tag", () => {
    // The rule with NO schema half: JSON Schema cannot compare two sibling values. It is the one that catches
    // a one-line rename — the reader matched the entry ON the tag, so the tag is the only value it can return.
    expect(() =>
      assertManifestHygiene(gate({ permits: ["com.integraledger.legal-ctx"] })),
    ).toThrow(/only value it can ever see/);
  });

  it("does NOT impose that rule on an object-path gate — it is tagged-array only", () => {
    // The rule is about what a tagged-array READER can return. An object-path gate has no tag to compare
    // against, so applying it there would reject every scalar gate ever written.
    expect(() =>
      assertManifestHygiene(
        gate({
          path: "mode",
          container: { kind: "object-path" },
          permits: ["permissive"],
        }),
      ),
    ).not.toThrow();
  });

  it("does NOT impose that rule where valueField differs from tagField", () => {
    // There the reader returns some other property of the matched entry, so permits is genuinely open.
    expect(() =>
      assertManifestHygiene(
        gate({
          container: {
            kind: "tagged-array",
            at: "constraints",
            tagField: "type",
            tag: "urn:example:lcp-terms-hash",
            valueField: "value",
          },
          permits: ["anything"],
        }),
      ),
    ).not.toThrow();
  });

  it("catches the same defects on an ALIAS gate, where an unmet condition is silent", () => {
    expect(() =>
      assertManifestHygiene({
        ...objectPath,
        readAlso: [
          {
            path: "legal_context",
            write: true,
            writeCondition: {
              ...extensionGate,
              permits: ["com.integraledger.legal-ctx"],
            },
          },
        ],
      }),
    ).toThrow(/alias legal_context/);
  });
});

// ─── The terms-URL slots — the write path integra-protocol#8 measured as absent ──────────────────────────
//
// The manifest below is x402's SHAPE without x402's wrapper: a reference-object canonical field, a written
// bare-hash alias inside an existing array element, and two terms-URL slots — one nested inside the
// canonical carrier, one beside the alias. Every rule the member declares is pinned here once, so the
// placement packages test their manifests and never these mechanics.
describe("termsUrlFields — the advertisement is one act, and half of one refuses", () => {
  const URL_ = "https://seller.example/.well-known/legal-context.json";
  const twoSlots: PlacementManifest = {
    protocol: "x402",
    pattern: "http-advisory",
    tier: "A",
    encoding: "reference-object",
    container: { kind: "object-path" },
    field: "extensions.legalContext.info",
    readAlso: [
      {
        path: "accepts.0.extra.atrHash",
        encoding: "bare-value",
        bareType: "sha256",
        write: true,
      },
    ],
    termsUrlFields: [
      "extensions.legalContext.info.legalContextUrl",
      "accepts.0.extra.legalContextUrl",
    ],
    carrierTypes: ["sha256"],
  };
  const a = makePlacement(twoSlots);
  // Variants built by OMISSION — `exactOptionalPropertyTypes` rightly refuses `readAlso: undefined`.
  const { readAlso: _dropAlias, ...slotsNoAlias } = twoSlots;
  const { termsUrlFields: _dropSlots, ...noSlotsBase } = slotsNoAlias;
  // The host structure the array-descend rule requires: the element must already exist.
  const challenge = () => ({ accepts: [{ scheme: "exact" }] });

  it("writes the URL at EVERY declared slot, and extract reads it back as one agreement", () => {
    const placed = a.place({ ref: REF, termsUrl: URL_ }, challenge());
    if ("refused" in placed)
      throw new Error(`expected a placement: ${placed.code}`);
    const doc = placed.value as {
      extensions: { legalContext: { info: Record<string, unknown> } };
      accepts: { scheme: string; extra: Record<string, unknown> }[];
    };
    expect(doc.extensions.legalContext.info["legalContextUrl"]).toBe(URL_);
    expect(doc.accepts[0]?.extra["legalContextUrl"]).toBe(URL_);
    expect(doc.accepts[0]?.extra["atrHash"]).toBe(HASH);
    expect(doc.accepts[0]?.scheme).toBe("exact"); // sibling keys inside the descended element survive
    expect(a.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: REF, termsUrl: { kind: "read", url: URL_ } },
    });
  });

  it("REFUSES an integrity-bearing advertisement with no URL — a hash nobody can resolve is unverifiable", () => {
    expect(a.place({ ref: REF }, challenge())).toMatchObject({
      refused: true,
      code: "x402/terms-url-missing",
    });
  });

  it("REFUSES a URL the manifest has no slot for — dropping it silently would under-advertise", () => {
    const none = makePlacement(noSlotsBase);
    expect(none.place({ ref: REF, termsUrl: URL_ }, challenge())).toMatchObject(
      {
        refused: true,
        code: "x402/terms-url-unplaceable",
      },
    );
  });

  it("REFUSES a cleartext URL on the write side — minting a challenge every buyer refuses is not success", () => {
    expect(
      a.place(
        { ref: REF, termsUrl: "http://seller.example/terms" },
        challenge(),
      ),
    ).toMatchObject({ refused: true, code: "x402/terms-url-malformed" });
  });

  it("REFUSES when a slot's host structure is absent — the manifest declared what a complete advertisement is", () => {
    // No accepts[0] to descend into: the nested slot lands but the mirror cannot, and half an
    // advertisement must not ship as a whole one. The alias is dropped from the manifest so the
    // terms-URL write is the one that fails — with it, the alias's own write refuses first as
    // document-malformed, which the next case pins.
    const noAlias = makePlacement(slotsNoAlias);
    expect(noAlias.place({ ref: REF, termsUrl: URL_ }, {})).toMatchObject({
      refused: true,
      code: "x402/terms-url-slot-unwritable",
    });
  });

  it("a written ALIAS whose host structure is absent refuses as document-malformed — the ratified container rule", () => {
    expect(a.place({ ref: REF, termsUrl: URL_ }, {})).toMatchObject({
      refused: true,
      code: "x402/document-malformed",
    });
  });

  it("a url-type reference is its own locator — the mandate applies to attestation, not location", () => {
    const wide = makePlacement({
      ...slotsNoAlias,
      carrierTypes: ["sha256", "url"],
    });
    const placed = wide.place(
      { ref: { type: "url", value: "https://x.test/t" } },
      challenge(),
    );
    expect("refused" in placed).toBe(false);
  });

  it("extract REFUSES two slots that disagree — a seller must not advertise different terms to different readers", () => {
    const placed = a.place({ ref: REF, termsUrl: URL_ }, challenge());
    if ("refused" in placed) throw new Error("expected a placement");
    const doc = JSON.parse(JSON.stringify(placed.value)) as {
      accepts: { extra: Record<string, unknown> }[];
    };
    (doc.accepts[0] as { extra: Record<string, unknown> }).extra[
      "legalContextUrl"
    ] = "https://other.example/terms";
    expect(a.extract(doc)).toMatchObject({
      refused: true,
      code: "x402/terms-url-mismatch",
    });
  });

  it("extract REFUSES a malformed slot even when the other slot reads cleanly", () => {
    const placed = a.place({ ref: REF, termsUrl: URL_ }, challenge());
    if ("refused" in placed) throw new Error("expected a placement");
    const doc = JSON.parse(JSON.stringify(placed.value)) as {
      accepts: { extra: Record<string, unknown> }[];
    };
    (doc.accepts[0] as { extra: Record<string, unknown> }).extra[
      "legalContextUrl"
    ] = 7;
    expect(a.extract(doc)).toMatchObject({
      refused: true,
      code: "x402/terms-url-malformed",
    });
  });

  it("a document with empty declared slots is a VALUE, never a refusal — the gate decides, not the reader", () => {
    // A counterparty's pre-fix emission: reference present, no URL anywhere. Still evidence.
    expect(
      a.extract({
        extensions: { legalContext: { info: { type: "sha256", value: HASH } } },
      }),
    ).toEqual({
      ok: true,
      value: {
        ref: REF,
        termsUrl: {
          kind: "declared-fields-empty",
          fields: twoSlots.termsUrlFields,
        },
      },
    });
  });

  it("place is PURE with the URL writes exactly as without them", () => {
    const doc = challenge();
    const before = JSON.stringify(doc);
    a.place({ ref: REF, termsUrl: URL_ }, doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("the array descent NEVER mints an element — a second requirement is the host's to add, not ours", () => {
    // accepts exists but is empty: index 0 names an element the host never put there. The written alias
    // is the first to hit it and refuses under the container rule; the no-alias variant pins the
    // terms-URL write refusing the same document under its own code.
    expect(
      a.place({ ref: REF, termsUrl: URL_ }, { accepts: [] }),
    ).toMatchObject({
      refused: true,
      code: "x402/document-malformed",
    });
    const noAlias2 = makePlacement(slotsNoAlias);
    expect(
      noAlias2.place({ ref: REF, termsUrl: URL_ }, { accepts: [] }),
    ).toMatchObject({ refused: true, code: "x402/terms-url-slot-unwritable" });
  });

  it("the array descent preserves SIBLING elements untouched, in order", () => {
    const placed = a.place(
      { ref: REF, termsUrl: URL_ },
      { accepts: [{ scheme: "exact" }, { scheme: "upto", keep: 1 }] },
    );
    if ("refused" in placed) throw new Error("expected a placement");
    const doc = placed.value as { accepts: Record<string, unknown>[] };
    expect(doc.accepts[1]).toEqual({ scheme: "upto", keep: 1 });
  });

  it("a polluted Array.prototype element is NOT a place to write", () => {
    // The write-side twin of the read rule: an inherited "0" must not stand in for an element.
    try {
      // biome-ignore lint/suspicious/noExplicitAny: prototype pollution requires the cast
      (Array.prototype as any)[0] = { extra: {} };
      expect(
        a.place({ ref: REF, termsUrl: URL_ }, { accepts: [] }),
      ).toMatchObject({
        refused: true,
      });
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: prototype pollution requires the cast
      delete (Array.prototype as any)[0];
    }
  });

  it("hygiene: an EMPTY termsUrlFields is a claim with nothing behind it", () => {
    expect(() =>
      assertManifestHygiene({ ...twoSlots, termsUrlFields: [] }),
    ).toThrow(/declared and empty/);
  });

  it("hygiene: a repeated slot is one slot declared as two", () => {
    expect(() =>
      assertManifestHygiene({
        ...twoSlots,
        termsUrlFields: ["a.b", "a.b"],
      }),
    ).toThrow(/repeats a path/);
  });

  it("hygiene: a slot may not BE the reference field or any alias", () => {
    expect(() =>
      assertManifestHygiene({ ...twoSlots, termsUrlFields: [twoSlots.field] }),
    ).toThrow(/names field/);
    expect(() =>
      assertManifestHygiene({
        ...twoSlots,
        termsUrlFields: ["accepts.0.extra.atrHash"],
      }),
    ).toThrow(/names alias path/);
  });
});
