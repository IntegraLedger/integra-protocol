import { readFileSync } from "node:fs";
import { makePlacement } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import {
  LEGAL_CONTEXT_SCHEMA,
  X402_PLACEMENT,
  x402Placement,
} from "../src/index.js";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/x402.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    input: {
      op: "place" | "place-purity" | "extract";
      ref?: { type: string; value: string };
      doc: unknown;
    };
    expected?: unknown;
  }[];
};

const H = "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("x402 placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        x402Placement.place(ref, doc);
        expect(JSON.stringify(doc)).toBe(before);
        return;
      }

      // Same convention as placement-acp and placement-ucp: successes are matched EXACTLY (the document a
      // placement emits IS the wire contract, so an extra or missing key must fail), refusals STRUCTURALLY
      // (`detail` is human-facing prose the vector deliberately omits).
      const out =
        op === "extract"
          ? x402Placement.extract(doc)
          : x402Placement.place(ref, doc);
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

describe("x402 placement — the rules that are x402's own, not the kit's", () => {
  it("never deletes or overwrites a sibling extension — x402's echo rule is not ours to break", () => {
    const doc = { extensions: { someOther: { info: { a: 1 } } } };
    const placed = x402Placement.place({ type: "sha256", value: H }, doc);
    if (!("ok" in placed)) throw new Error("place refused");
    const ext = (placed.value as { extensions: Record<string, unknown> })
      .extensions;
    expect(ext["someOther"]).toEqual({ info: { a: 1 } });
  });

  it("does not merge an INHERITED extensions map into the challenge it emits", () => {
    // The own-property invariant, which binding-core states holds on BOTH halves and proves for its own
    // writer. A JSON vector cannot express this — JSON has no prototypes — so it is pinned here. `place`'s
    // document is exactly as attacker-influenced as `extract`'s: without the guard, a document with ZERO own
    // properties walks into the prototype's `extensions` and its entries land on the wire.
    const doc = Object.create({
      extensions: { attackerExt: { info: { evil: true } } },
    });
    expect(Object.keys(doc)).toEqual([]); // zero own properties
    const placed = x402Placement.place({ type: "sha256", value: H }, doc);
    if (!("ok" in placed)) throw new Error("place refused");
    expect(placed.value).toEqual({
      extensions: {
        legalContext: {
          info: { type: "sha256", value: H },
          schema: LEGAL_CONTEXT_SCHEMA,
        },
      },
    });
    expect(JSON.stringify(placed.value)).not.toContain("attackerExt");
  });

  it("place and extract AGREE about presence on a prototype-backed challenge", () => {
    // The statement the previous test's shape only implies: the two halves must not disagree about what the
    // document contains. `extract` reports absent, so `place` must see no map to merge either.
    // A prototype set on a parsed document rather than `Object.create`, because that is the shape a real
    // `JSON.parse` reviver or a polluted `Object.prototype` produces: own data AND an inherited container.
    // The inherited map carries a DIFFERENT reference and a sibling entry — the sibling is what proves the
    // guard, since our own `legalContext` would be overwritten by the placement either way.
    const doc = Object.setPrototypeOf(JSON.parse('{"x402Version":2}'), {
      extensions: {
        legalContext: {
          info: {
            type: "sha256",
            value:
              "0x3f786850e387550fdab836ed7e6dc881de23001b3f786850e387550fdab836ed",
          },
        },
        inheritedSibling: { info: 1 },
      },
    }) as Record<string, unknown>;
    expect(x402Placement.extract(doc)).toMatchObject({
      code: "x402/reference-absent",
    });
    const placed = x402Placement.place({ type: "sha256", value: H }, doc);
    if (!("ok" in placed)) throw new Error("place refused");
    expect(placed.value).toEqual({
      x402Version: 2,
      extensions: {
        legalContext: {
          info: { type: "sha256", value: H },
          schema: LEGAL_CONTEXT_SCHEMA,
        },
      },
    });
    expect(x402Placement.extract(placed.value)).toEqual({
      ok: true,
      value: { type: "sha256", value: H },
    });
  });

  it("reads the bare-hash alias with the ALIAS's encoding, not the manifest's", () => {
    expect(
      x402Placement.extract({ accepts: [{ extra: { atrHash: H } }] }),
    ).toEqual({ ok: true, value: { type: "sha256", value: H } });
  });

  it("wraps the reference in {info, schema} — the wrapper no container kind models", () => {
    const placed = x402Placement.place({ type: "sha256", value: H }, {});
    if (!("ok" in placed)) throw new Error("place refused");
    expect(placed.value).toEqual({
      extensions: {
        legalContext: {
          info: { type: "sha256", value: H },
          schema: LEGAL_CONTEXT_SCHEMA,
        },
      },
    });
  });

  it("round-trips place -> extract", () => {
    const ref = { type: "sha256", value: H } as const;
    const placed = x402Placement.place(ref, { x402Version: 2, accepts: [] });
    if (!("ok" in placed)) throw new Error("place refused");
    expect(x402Placement.extract(placed.value)).toEqual({
      ok: true,
      value: ref,
    });
  });

  it("namespaces every refusal code from the protocol id", () => {
    const codes = [
      x402Placement.place({ type: "ipfs", value: "bafy" }, {}),
      x402Placement.place({ type: "sha256", value: H }, null),
      x402Placement.place({ type: "sha256", value: H.slice(2) }, {}),
      x402Placement.extract({}),
      x402Placement.extract(null),
    ].map((o) => ("refused" in o ? o.code : "NOT REFUSED"));
    expect(codes).toEqual([
      "x402/carrier-type-not-permitted",
      "x402/document-malformed",
      "x402/reference-malformed",
      "x402/reference-absent",
      "x402/document-malformed",
    ]);
  });
});

describe("x402 placement — the override stays ONE member", () => {
  // The plan asks for `x402Placement.extract === base.extract`, and that identity is not observable from
  // outside: the kit's members are closures, so a fresh `makePlacement` yields different function objects,
  // and exporting the base adapter only so a test could compare pointers would widen this package's API for
  // a test's convenience. The property that actually matters is behavioural — a later edit must not fork the
  // READ path — so it is asserted against a freshly built kit adapter over every extract path this package
  // has: canonical hit, alias hit, both, neither, malformed container, corrupt value, unpermitted type, and
  // a non-object document. One overridden member is composition; two is a package that stopped using the kit.
  const kit = makePlacement(X402_PLACEMENT);

  it("extract is the KIT's read path, on every shape this package accepts or refuses", () => {
    const docs: unknown[] = [
      { extensions: { legalContext: { info: { type: "sha256", value: H } } } },
      { accepts: [{ extra: { atrHash: H } }] },
      {
        extensions: {
          legalContext: { info: { type: "url", value: "https://x.example/t" } },
        },
        accepts: [{ extra: { atrHash: H } }],
      },
      { x402Version: 2, accepts: [{ scheme: "exact" }] },
      { accepts: { extra: { atrHash: H } } },
      { accepts: [{ extra: { atrHash: H.slice(2) } }] },
      {
        extensions: {
          legalContext: { info: { type: "ipfs", value: "bafybeigdyrzt5" } },
        },
      },
      null,
      [],
      "not-a-challenge",
    ];
    for (const doc of docs)
      expect(x402Placement.extract(doc)).toEqual(kit.extract(doc));
  });

  it("place REFUSES exactly what the kit refuses for this manifest — same inputs, same codes", () => {
    // The property that makes the manifest an artifact rather than a description. The override changes the
    // SHAPE it writes, not which documents it will write into: a stranger holding only the published manifest
    // and the kit must compute the same accept/refuse answer this package computes, or the two disagree about
    // what a conformant x402 challenge is. Found in review — the override used to emit a document for a
    // present-but-unmergeable `extensions`, which the kit refuses because `extensions` sits one level ABOVE
    // the declared field's direct holder and replacing an intermediate discards everything beneath it.
    const ref = { type: "sha256", value: H } as const;
    const docs: unknown[] = [
      { x402Version: 2, accepts: [] },
      { x402Version: 2, extensions: "legalContext" },
      { x402Version: 2, extensions: [{ someOther: { info: { a: 1 } } }] },
      { x402Version: 2, extensions: 7 },
      { x402Version: 2, extensions: null },
      { x402Version: 2, extensions: true },
      { extensions: { legalContext: "junk", someOther: { info: 1 } } },
      { extensions: { legalContext: { foo: 1 } } },
      null,
      [],
      "not-a-challenge",
    ];
    const answer = (o: ReturnType<typeof x402Placement.place>) =>
      "refused" in o ? o.code : "placed";
    for (const doc of docs)
      expect([doc, answer(x402Placement.place(ref, doc))]).toEqual([
        doc,
        answer(kit.place(ref, doc)),
      ]);
  });

  it("place is NOT the kit's — the kit cannot write the {info, schema} wrapper", () => {
    // The other half of the same statement: if these ever agreed, the override would be dead code, and the
    // reason it exists (x402's slot holds a wrapper, not the reference) would have stopped being true.
    const placed = x402Placement.place({ type: "sha256", value: H }, {});
    expect(placed).not.toEqual(kit.place({ type: "sha256", value: H }, {}));
  });

  it("carries the kit's manifest, unaltered", () => {
    expect(x402Placement.manifest).toBe(X402_PLACEMENT);
  });
});

// The corpus omits `detail` because the CODE is the cross-implementation contract, but that is no licence for
// this package's own messages to be useless: an operator staring at `reference-malformed` with no value
// cannot tell which of a challenge's two carriers tripped it.
describe("x402 placement — refusals stay legible", () => {
  it("names the offending reference value on a corrupt place", () => {
    const out = x402Placement.place(
      { type: "sha256", value: H.slice(2) },
      { x402Version: 2 },
    );
    expect(out).toMatchObject({ code: "x402/reference-malformed" });
    expect((out as { detail: string }).detail).toContain(H.slice(2));
  });

  it("distinguishes an unmergeable extensions map from a non-object challenge", () => {
    // Both refuse `document-malformed`, and the code alone cannot tell an operator which happened: the
    // challenge here IS a well-formed object. The detail has to name the offending container and its value,
    // for the same reason the two above name theirs.
    const out = x402Placement.place(
      { type: "sha256", value: H },
      { x402Version: 2, extensions: [{ someOther: {} }] },
    );
    expect(out).toMatchObject({ code: "x402/document-malformed" });
    const { detail } = out as { detail: string };
    expect(detail).toContain("extensions");
    expect(detail).toContain(X402_PLACEMENT.field);
    expect(detail).toContain("someOther");
  });

  it("names the permitted carrier types and the one it got", () => {
    const out = x402Placement.place({ type: "ipfs", value: "bafy" }, {});
    expect(out).toMatchObject({ code: "x402/carrier-type-not-permitted" });
    const { detail } = out as { detail: string };
    expect(detail).toContain("sha256/url");
    expect(detail).toContain("ipfs");
    expect(detail).toContain(X402_PLACEMENT.field);
  });
});
