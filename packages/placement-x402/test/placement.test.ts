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
      op: "place" | "place-purity" | "extract" | "roundtrip";
      ref?: { type: string; value: string };
      termsUrl?: string;
      doc: unknown;
    };
    expected?: unknown;
  }[];
};

const H = "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const URL_ = "https://seller.example/.well-known/legal-context.json";
// The smallest document a complete x402 advertisement fits into: the alias and the extra-side terms slot
// live inside accepts[0], which the writer only ever ENTERS — the host builds its own list.
const challenge = () => ({ x402Version: 2, accepts: [{ scheme: "exact" }] });
const AD = { ref: { type: "sha256", value: H }, termsUrl: URL_ } as const;

describe("x402 placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc, termsUrl } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };
      const ad = { ref, ...(termsUrl === undefined ? {} : { termsUrl }) };

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        x402Placement.place(ad, doc);
        expect(JSON.stringify(doc)).toBe(before);
        return;
      }
      if (op === "roundtrip") {
        const placed = x402Placement.place(ad, doc);
        if ("refused" in placed)
          throw new Error(`roundtrip could not place: ${placed.code}`);
        expect(x402Placement.extract(placed.value)).toEqual(c.expected);
        return;
      }

      // Same convention as placement-acp and placement-ucp: successes are matched EXACTLY (the document a
      // placement emits IS the wire contract, so an extra or missing key must fail), refusals STRUCTURALLY
      // (`detail` is human-facing prose the vector deliberately omits).
      const out =
        op === "extract"
          ? x402Placement.extract(doc)
          : x402Placement.place(ad, doc);
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

describe("x402 placement — the rules that are x402's own, not the kit's", () => {
  it("never deletes or overwrites a sibling extension — x402's echo rule is not ours to break", () => {
    const doc = {
      ...challenge(),
      extensions: { someOther: { info: { a: 1 } } },
    };
    const placed = x402Placement.place(AD, doc);
    if (!("ok" in placed)) throw new Error("place refused");
    const ext = (placed.value as { extensions: Record<string, unknown> })
      .extensions;
    expect(ext["someOther"]).toEqual({ info: { a: 1 } });
  });

  it("does not merge an INHERITED extensions map into the challenge it emits", () => {
    // The own-property invariant, which binding-core states holds on BOTH halves and proves for its own
    // writer. A JSON vector cannot express this — JSON has no prototypes — so it is pinned here. `place`'s
    // document is exactly as attacker-influenced as `extract`'s: without the guard, a document with an
    // inherited `extensions` walks into the prototype's map and its entries land on the wire.
    const doc = Object.setPrototypeOf(JSON.parse(JSON.stringify(challenge())), {
      extensions: { attackerExt: { info: { evil: true } } },
    }) as Record<string, unknown>;
    const placed = x402Placement.place(AD, doc);
    if (!("ok" in placed)) throw new Error("place refused");
    expect(JSON.stringify(placed.value)).not.toContain("attackerExt");
    expect(
      (placed.value as { extensions: Record<string, unknown> }).extensions,
    ).toEqual({
      legalContext: {
        info: { type: "sha256", value: H, legalContextUrl: URL_ },
        schema: LEGAL_CONTEXT_SCHEMA,
      },
    });
  });

  it("place and extract AGREE about presence on a prototype-backed challenge", () => {
    // The statement the previous test's shape only implies: the two halves must not disagree about what the
    // document contains. The inherited map carries a DIFFERENT reference and a sibling entry — the sibling
    // is what proves the guard, since our own `legalContext` would be overwritten by the placement anyway.
    const doc = Object.setPrototypeOf(JSON.parse(JSON.stringify(challenge())), {
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
    const placed = x402Placement.place(AD, doc);
    if (!("ok" in placed)) throw new Error("place refused");
    expect(JSON.stringify(placed.value)).not.toContain("inheritedSibling");
    expect(x402Placement.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: AD.ref, termsUrl: { kind: "read", url: URL_ } },
    });
  });

  it("reads the bare-hash alias with the ALIAS's encoding, not the manifest's", () => {
    expect(
      x402Placement.extract({ accepts: [{ extra: { atrHash: H } }] }),
    ).toEqual({
      ok: true,
      value: {
        ref: { type: "sha256", value: H },
        termsUrl: {
          kind: "declared-fields-empty",
          fields: X402_PLACEMENT.termsUrlFields,
        },
      },
    });
  });

  it("wraps the reference in {info, schema} with the URL inside info — the whole wire shape at once", () => {
    const placed = x402Placement.place(AD, challenge());
    if (!("ok" in placed)) throw new Error("place refused");
    expect(placed.value).toEqual({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          extra: { atrHash: H, legalContextUrl: URL_ },
        },
      ],
      extensions: {
        legalContext: {
          info: { type: "sha256", value: H, legalContextUrl: URL_ },
          schema: LEGAL_CONTEXT_SCHEMA,
        },
      },
    });
  });

  it("round-trips place -> extract with the terms URL read back as one agreement", () => {
    const placed = x402Placement.place(AD, challenge());
    if (!("ok" in placed)) throw new Error("place refused");
    expect(x402Placement.extract(placed.value)).toEqual({
      ok: true,
      value: { ref: AD.ref, termsUrl: { kind: "read", url: URL_ } },
    });
  });

  it("REFUSES a sha256 advertisement with no terms URL — the defect a third party actually hit", () => {
    // integra-protocol#8's shape, closed at the source: the published buyer demands the locator, so an
    // emitter that omits it mints a challenge nothing accepts. The refusal happens here, at the seller,
    // where the missing datum is.
    expect(x402Placement.place({ ref: AD.ref }, challenge())).toMatchObject({
      refused: true,
      code: "x402/terms-url-missing",
    });
  });

  it("namespaces every refusal code from the protocol id", () => {
    const codes = [
      x402Placement.place({ ref: { type: "ipfs", value: "bafy" } }, {}),
      x402Placement.place(AD, null),
      x402Placement.place(
        { ref: { type: "sha256", value: H.slice(2) }, termsUrl: URL_ },
        challenge(),
      ),
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
  // The kit's members are closures, so a fresh `makePlacement` yields different function objects and a
  // pointer comparison is not available. The property that actually matters is behavioural — a later edit
  // must not fork the READ path — so it is asserted against a freshly built kit adapter over every extract
  // path this package has: canonical hit, alias hit, both, neither, malformed container, corrupt value,
  // unpermitted type, terms-URL mismatch, and a non-object document. One overridden member is composition;
  // two is a package that stopped using the kit.
  const kit = makePlacement(X402_PLACEMENT);

  it("extract is the KIT's read path, on every shape this package accepts or refuses", () => {
    const docs: unknown[] = [
      {
        extensions: {
          legalContext: {
            info: { type: "sha256", value: H, legalContextUrl: URL_ },
          },
        },
      },
      { accepts: [{ extra: { atrHash: H, legalContextUrl: URL_ } }] },
      {
        extensions: { legalContext: { info: { type: "sha256", value: H } } },
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
      // Two slots that disagree, and one slot that is malformed — the terms-URL refusals.
      {
        extensions: {
          legalContext: {
            info: { type: "sha256", value: H, legalContextUrl: URL_ },
          },
        },
        accepts: [{ extra: { legalContextUrl: "https://other.example/t" } }],
      },
      {
        extensions: {
          legalContext: {
            info: { type: "sha256", value: H, legalContextUrl: "ftp://x" },
          },
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
    // what a conformant x402 challenge is.
    const docs: unknown[] = [
      challenge(),
      { x402Version: 2, accepts: [] },
      { x402Version: 2 },
      { ...challenge(), extensions: "legalContext" },
      { ...challenge(), extensions: [{ someOther: { info: { a: 1 } } }] },
      { ...challenge(), extensions: 7 },
      { ...challenge(), extensions: null },
      { ...challenge(), extensions: true },
      {
        ...challenge(),
        extensions: { legalContext: "junk", someOther: { info: 1 } },
      },
      { ...challenge(), extensions: { legalContext: { foo: 1 } } },
      null,
      [],
      "not-a-challenge",
    ];
    const answer = (o: ReturnType<typeof x402Placement.place>) =>
      "refused" in o ? o.code : "placed";
    for (const doc of docs)
      expect([doc, answer(x402Placement.place(AD, doc))]).toEqual([
        doc,
        answer(kit.place(AD, doc)),
      ]);
    // The advertisement rules too — kit and override answer identically about the seller's own datum.
    for (const ad of [
      { ref: AD.ref },
      { ref: AD.ref, termsUrl: "http://cleartext.example/t" },
      { ref: { type: "url" as const, value: "https://x.test/t" } },
    ])
      expect(answer(x402Placement.place(ad, challenge()))).toBe(
        answer(kit.place(ad, challenge())),
      );
  });

  it("place is NOT the kit's — the kit cannot write the {info, schema} wrapper", () => {
    // The other half of the same statement: if these ever agreed, the override would be dead code, and the
    // reason it exists (x402's slot holds a wrapper, not the reference) would have stopped being true.
    const placed = x402Placement.place(AD, challenge());
    expect(placed).not.toEqual(kit.place(AD, challenge()));
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
      { ref: { type: "sha256", value: H.slice(2) }, termsUrl: URL_ },
      challenge(),
    );
    expect(out).toMatchObject({ code: "x402/reference-malformed" });
    expect((out as { detail: string }).detail).toContain(H.slice(2));
  });

  it("distinguishes an unmergeable extensions map from a non-object challenge", () => {
    // Both refuse `document-malformed`, and the code alone cannot tell an operator which happened: the
    // challenge here IS a well-formed object. The detail names the path that had no writable holder and
    // quotes the container it found, which is what locates the junk.
    const out = x402Placement.place(AD, {
      ...challenge(),
      extensions: [{ someOther: {} }],
    });
    expect(out).toMatchObject({ code: "x402/document-malformed" });
    const { detail } = out as { detail: string };
    expect(detail).toContain(X402_PLACEMENT.field);
    expect(detail).toContain("someOther");
  });

  it("names the permitted carrier types and the one it got", () => {
    const out = x402Placement.place(
      { ref: { type: "ipfs", value: "bafy" } },
      challenge(),
    );
    expect(out).toMatchObject({ code: "x402/carrier-type-not-permitted" });
    const { detail } = out as { detail: string };
    expect(detail).toContain("sha256");
    expect(detail).toContain("ipfs");
    expect(detail).toContain(X402_PLACEMENT.field);
  });

  it("names both slots and both values on a terms-URL mismatch", () => {
    const out = x402Placement.extract({
      extensions: {
        legalContext: {
          info: { type: "sha256", value: H, legalContextUrl: URL_ },
        },
      },
      accepts: [{ extra: { legalContextUrl: "https://other.example/terms" } }],
    });
    expect(out).toMatchObject({ code: "x402/terms-url-mismatch" });
    const { detail } = out as { detail: string };
    expect(detail).toContain(URL_);
    expect(detail).toContain("https://other.example/terms");
  });
});
