import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visaTapPlacement } from "../src/index.js";

const HASH =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/visa-tap.json", import.meta.url),
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

describe("Visa TAP placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        visaTapPlacement.place(ref, doc);
        expect(JSON.stringify(doc)).toBe(before);
        return;
      }

      // The vector pins the whole `Outcome` on BOTH arms and for BOTH members — the same shape the
      // conformance area certifies, so the unit test and the corpus cannot disagree about what this
      // package returns. Refusals are matched STRUCTURALLY (refused/haltClass/code) because `detail` is
      // human-facing prose the vector deliberately omits; successes are matched EXACTLY, because the
      // document a placement emits IS the wire contract and an extra or missing key there must fail.
      const out =
        op === "extract"
          ? visaTapPlacement.extract(doc)
          : visaTapPlacement.place(ref, doc);
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

describe("Visa TAP placement — the header-map rules the corpus cannot pin", () => {
  it("answers with the FIRST fold-matching key when a document carries two spellings at once", () => {
    // `X-LCP-Hash` and `x-lcp-hash` are distinct JSON keys but one HTTP field (RFC 9110), so a document
    // carrying both is malformed at the HTTP layer and the reader must still be deterministic.
    // PACKAGE-LOCAL, deliberately: pinning first-wins in the corpus would oblige a foreign subject to
    // iterate its header map in insertion order, which a Go implementation's map cannot promise. The
    // vector file's own $comment records the omission and this test records the behaviour.
    const out = visaTapPlacement.extract({
      headers: { "X-LCP-Hash": HASH, "x-lcp-hash": `0x${"ab".repeat(32)}` },
    });
    expect(out).toEqual({ ok: true, value: { type: "sha256", value: HASH } });
  });

  it("does NOT repair a document that already carries two spellings — the write half, pinned not endorsed", () => {
    // The write half of the same input, and the limit of what `place` claims. The kit's ratified rule
    // updates the FIRST key that folds to `x-lcp-hash`, so a document arriving with both spellings — already
    // malformed at the HTTP layer before this placement sees it — leaves with both, the unmatched one still
    // stale. Which spelling wins is POSITIONAL, not a preference for the lowercase form: reversing the
    // insertion order moves the fresh value to the other key. That matters because an HTTP stack which
    // canonicalizes field names (Go's textproto.CanonicalMIMEHeaderKey, Node's incoming-header lowercasing)
    // collapses the two JSON keys into one field carrying two values, and our own fold-matching `extract`
    // reads the fresh one and never notices. Repairing it is a binding-core decision for every header-map
    // protocol at once, not this package's; leaving it unpinned would let it change without anyone deciding.
    const stale = `0x${"ab".repeat(32)}`;
    const ref = { type: "sha256", value: HASH } as const;

    const upperFirst = visaTapPlacement.place(ref, {
      headers: { "X-LCP-Hash": stale, "x-lcp-hash": stale },
    });
    if ("refused" in upperFirst) throw new Error("place refused");
    expect(upperFirst.value).toEqual({
      headers: { "X-LCP-Hash": HASH, "x-lcp-hash": stale },
    });

    const lowerFirst = visaTapPlacement.place(ref, {
      headers: { "x-lcp-hash": stale, "X-LCP-Hash": stale },
    });
    if ("refused" in lowerFirst) throw new Error("place refused");
    expect(lowerFirst.value).toEqual({
      headers: { "x-lcp-hash": HASH, "X-LCP-Hash": stale },
    });

    // The read half agrees with the write half by construction — both take the first fold match — which is
    // exactly why neither half surfaces the duplicate.
    expect(visaTapPlacement.extract(upperFirst.value)).toEqual({
      ok: true,
      value: { type: "sha256", value: HASH },
    });
  });

  it("round-trips place -> extract through a differently-cased existing header", () => {
    // The write half preserves `X-LCP-Hash` and the read half folds to find it: two rules that must agree,
    // or a placement would emit a document it cannot read back.
    const placed = visaTapPlacement.place(
      { type: "sha256", value: HASH },
      { headers: { "X-LCP-Hash": `0x${"ab".repeat(32)}` } },
    );
    if ("refused" in placed) throw new Error("place refused");
    expect(visaTapPlacement.extract(placed.value)).toEqual({
      ok: true,
      value: { type: "sha256", value: HASH },
    });
  });

  it("refuses legibly — an operator sees which value tripped the codec", () => {
    // The corpus omits `detail` because the CODE is the cross-implementation contract; that is no licence
    // for a message an operator cannot act on. An uncovered header is the one carrier most likely to arrive
    // rewritten, so the offending value has to appear in the refusal.
    const out = visaTapPlacement.extract({
      headers: { "x-lcp-hash": "not-a-hash" },
    });
    expect(out).toMatchObject({ code: "visa-tap/reference-malformed" });
    expect((out as { detail: string }).detail).toContain("not-a-hash");
  });
});
