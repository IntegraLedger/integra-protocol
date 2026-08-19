import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ap2Placement } from "../src/index.js";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/ap2.json", import.meta.url),
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

describe("AP2 placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc, termsUrl } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "roundtrip") {
        const placed = ap2Placement.place(
          { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
          doc,
        );
        if ("refused" in placed)
          throw new Error(`roundtrip could not place: ${placed.code}`);
        expect(ap2Placement.extract(placed.value)).toEqual(c.expected);
        return;
      }

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        ap2Placement.place(
          { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
          doc,
        );
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
          ? ap2Placement.extract(doc)
          : ap2Placement.place(
              { ref, ...(termsUrl === undefined ? {} : { termsUrl }) },
              doc,
            );
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

// THE MANDATE BOUNDARY. This package's distinguishing invariant, and the one place in the completion plan
// with a live internal counter-example doing the opposite. Three tests, stated as consequences a reader
// cares about rather than as properties of the implementation — so they would still fail loudly if some
// future edit widened the write path or the read set.
describe("AP2 placement — the mandate boundary", () => {
  it("returns the mandate byte-identical — a placement never writes inside an AP2 mandate", () => {
    const mandate =
      "eyJhbGciOiJFUzI1NiIsInR5cCI6ImtiK3NkLWp3dCJ9.eyJ2Y3QiOiJtYW5kYXRlLmNoZWNrb3V0LjEifQ.<signature>~";
    const parts = [
      { kind: "data", data: { "ap2.mandates.CheckoutMandateSdJwt": mandate } },
    ];
    const placed = ap2Placement.place(
      { ref: { type: "sha256", value: H } },
      { parts },
    );
    if (!("ok" in placed)) throw new Error("place refused");
    expect((placed.value as { parts: unknown }).parts).toEqual(parts);
  });

  it("does NOT read a reference embedded in the mandate — that shape is tier B", () => {
    // The live counter-example's exact shape (AP2 v0.1 `CartMandate`). Reading it would bless a placement we
    // cannot emit against a stock counterparty, so it reports the reference ABSENT.
    const doc = {
      mandate: { credentialSubject: { paymentMethod: { atrHash: H } } },
    };
    expect(ap2Placement.extract(doc)).toMatchObject({
      code: "ap2/reference-absent",
    });
  });

  it("place's ONLY change to the envelope is the metadata map", () => {
    // The structural statement of the same rule: whatever else the transport is carrying — the mandate
    // DataParts, the routing ids, a sibling `risk_data` — comes back untouched, and no top-level key is
    // added or removed but `metadata`. A widened write path fails here even if it wrote a shape no vector
    // happens to name.
    const doc = {
      kind: "message",
      messageId: "m-1",
      role: "agent",
      contextId: "ctx-1",
      parts: [
        { kind: "data", data: { "ap2.mandates.PaymentMandateSdJwt": "eyJ9~" } },
        { kind: "data", data: { risk_data: "" } },
      ],
    };
    const placed = ap2Placement.place(
      { ref: { type: "sha256", value: H } },
      doc,
    );
    if (!("ok" in placed)) throw new Error("place refused");
    const value = placed.value as Record<string, unknown>;
    expect(Object.keys(value)).toEqual([...Object.keys(doc), "metadata"]);
    const { metadata: _metadata, ...rest } = value;
    expect(rest).toEqual(doc);
  });
});

// The adapter surface, pinned. The hard boundary this repo carries is that we record and verify and never
// operate; the completion plan names AP2 as the most likely place a driving verb returns under a new name,
// because a mandate reads like an instruction. `ReferencePlacementAdapter` has exactly three members, and
// a fourth appearing here is a design change that must be argued, not a diff that slips through.
describe("AP2 placement — the adapter surface", () => {
  it("exposes a manifest and two pure members, and nothing that acts", () => {
    expect(Object.keys(ap2Placement).sort()).toEqual([
      "extract",
      "manifest",
      "place",
    ]);
  });
});
