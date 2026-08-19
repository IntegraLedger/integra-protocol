import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mppPlacement } from "../src/index.js";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/mpp.json", import.meta.url),
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

describe("MPP placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc, termsUrl } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "roundtrip") {
        const placed = mppPlacement.place(
          { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
          doc,
        );
        if ("refused" in placed)
          throw new Error(`roundtrip could not place: ${placed.code}`);
        expect(mppPlacement.extract(placed.value)).toEqual(c.expected);
        return;
      }

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        mppPlacement.place(
          { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
          doc,
        );
        expect(JSON.stringify(doc)).toBe(before);
        return;
      }

      // The vector pins the whole `Outcome` on BOTH arms and for BOTH members — the same shape the
      // conformance area certifies, so the unit test and the corpus cannot disagree about what this package
      // returns. Refusals are matched STRUCTURALLY (refused/haltClass/code) because `detail` is human-facing
      // prose the vector deliberately omits; successes are matched EXACTLY, because the body a placement
      // emits is what gets JCS-serialized into the challenge binding and an extra or missing key there
      // changes the bound input.
      const out =
        op === "extract"
          ? mppPlacement.extract(doc)
          : mppPlacement.place(
              { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
              doc,
            );
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

// Same convention as placement-acp and placement-ucp: the corpus omits `detail` because the CODE is the
// cross-implementation contract, but that is no licence for this package's own messages to be useless. A
// bare-value slot gives an operator nothing to go on — there is no `lcp:` prefix and no `{type,value}`
// wrapper to eyeball — so the refusal has to carry the offending value and the field that rejected it.
describe("MPP placement — the bare-slot refusals stay legible", () => {
  it("names the offending value when methodDetails.atrHash is corrupt", () => {
    const out = mppPlacement.extract({
      amount: "1500",
      methodDetails: { atrHash: "0xnot-a-hash" },
    });
    expect(out).toMatchObject({ code: "mpp/reference-malformed" });
    expect((out as { detail: string }).detail).toContain("0xnot-a-hash");
  });

  it("SERIALIZES the offending value when an object was written into the bare slot", () => {
    // A non-string value interpolates as "[object Object]" and would tell an operator nothing about which
    // shape arrived. The kit serializes instead — pinned here because the bare encoding is the one where a
    // wrapper object is the likely mistake.
    const out = mppPlacement.extract({
      methodDetails: { atrHash: { type: "sha256", value: "0x00" } },
    });
    expect(out).toMatchObject({ code: "mpp/reference-malformed" });
    expect((out as { detail: string }).detail).toContain(
      '{"type":"sha256","value":"0x00"}',
    );
  });

  it("names the FIELD that permits only sha256 when a url ref is offered", () => {
    const out = mppPlacement.place(
      { ref: { type: "url", value: "https://seller.example/terms.json" } },
      { amount: "1500" },
    );
    expect(out).toMatchObject({ code: "mpp/carrier-type-not-permitted" });
    expect((out as { detail: string }).detail).toContain(
      "methodDetails.atrHash",
    );
    expect((out as { detail: string }).detail).toContain("sha256");
  });
});
