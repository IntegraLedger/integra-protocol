import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeMastercardViPlacement } from "../src/index.js";

const HASH =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

/** The vectors' namespace, and the conformance registry's — this deployment's own (2026-07-29). */
const ours = makeMastercardViPlacement("com.integraledger");

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/mastercard-vi.json", import.meta.url),
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

describe("Mastercard VI placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc, termsUrl } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "roundtrip") {
        const placed = ours.place(
          { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
          doc,
        );
        if ("refused" in placed)
          throw new Error(`roundtrip could not place: ${placed.code}`);
        expect(ours.extract(placed.value)).toEqual(c.expected);
        return;
      }

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        ours.place(
          { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
          doc,
        );
        expect(JSON.stringify(doc)).toBe(before);
        return;
      }

      // The vector pins the whole `Outcome` on BOTH arms and for BOTH members — the same shape the
      // conformance area certifies, so the unit test and the corpus cannot disagree about what this package
      // returns. Refusals are matched STRUCTURALLY (refused/haltClass/code) because `detail` is human-facing
      // prose the vector deliberately omits; successes are matched EXACTLY, because the document a placement
      // emits IS the wire contract and an extra or missing key there must fail.
      const out =
        op === "extract"
          ? ours.extract(doc)
          : ours.place(
              { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
              doc,
            );
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

describe("Mastercard VI placement — the namespace rules the corpus cannot pin", () => {
  it("two deployments do not read each other's constraints", () => {
    // The namespace is a required argument rather than a package default precisely so a constraint can
    // never be attributed to the wrong party's credential. Written by hand now that `place` refuses —
    // which is the point: this is the shape a counterparty emits, and `extract` is what reads it.
    const theirs = makeMastercardViPlacement("com.example");
    const mandate = {
      vct: "mandate.checkout.open.1",
      constraints: [{ type: "com.integraledger.lcp_terms_hash", value: HASH }],
    };
    expect(ours.extract(mandate)).toEqual({
      ok: true,
      value: {
        ref: { type: "sha256", value: HASH },
        termsUrl: { kind: "no-field-declared" },
      },
    });
    expect(theirs.extract(mandate)).toMatchObject({
      code: "mastercard-vi/reference-absent",
    });
  });

  it("place refuses legibly, naming the rule and the surface that still works", () => {
    // The corpus omits `detail` because the CODE is the cross-implementation contract; that is no licence
    // for a message an operator cannot act on. This is now the ONLY refusal `place` produces, and it is
    // most likely to be hit by a correct integration that simply expected a writer — so it has to say why
    // there is none and what to use instead.
    const out = ours.place(
      { ref: { type: "sha256", value: HASH } },
      { vct: "mandate.checkout.open.1", constraints: [] },
    );
    expect(out).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "mastercard-vi/tier-b-not-writable",
    });
    const detail = (out as { detail: string }).detail;
    expect(detail).toContain("§C.7");
    expect(detail).toContain("extract");
  });

  it("refuses on EVERY mandate shape, including the two it used to write into", () => {
    // Declaration-only means unconditional. If a writeCondition ever returns, these are the documents it
    // would permit, and this fails.
    for (const doc of [
      { vct: "mandate.checkout.open.1", constraints: [] },
      { vct: "mandate.payment.open.1", constraints: [] },
      { vct: "mandate.checkout.1" },
      {},
      null,
    ])
      expect(
        ours.place({ ref: { type: "sha256", value: HASH } }, doc),
        JSON.stringify(doc),
      ).toMatchObject({ code: "mastercard-vi/tier-b-not-writable" });
  });

  it("refuses legibly on a corrupt value too — the operator sees what tripped the codec", () => {
    const out = ours.extract({
      vct: "mandate.checkout.open.1",
      constraints: [
        { type: "com.integraledger.lcp_terms_hash", value: "not-a-hash" },
      ],
    });
    expect(out).toMatchObject({ code: "mastercard-vi/reference-malformed" });
    expect((out as { detail: string }).detail).toContain("not-a-hash");
  });
});
