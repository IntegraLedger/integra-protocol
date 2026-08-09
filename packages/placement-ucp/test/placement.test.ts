import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ucpPlacement } from "../src/index.js";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/ucp.json", import.meta.url),
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

describe("UCP placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        ucpPlacement.place(ref, doc);
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
          ? ucpPlacement.extract(doc)
          : ucpPlacement.place(ref, doc);
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

// Same convention as placement-acp: the corpus omits `detail` because the CODE is the cross-implementation
// contract, but that is no licence for this package's own messages to be useless. The https wrap is the one
// piece of logic this package adds, so its refusal must name the offending URL — an operator staring at
// "insecure-terms-url" with no URL cannot tell which of a checkout's links tripped it.
describe("UCP placement — the https refusal stays legible", () => {
  it("names the offending URL", () => {
    const out = ucpPlacement.extract({
      links: [{ type: "terms_of_service", url: "http://seller.example/terms" }],
    });
    expect(out).toMatchObject({ code: "ucp/insecure-terms-url" });
    expect((out as { detail: string }).detail).toContain(
      "http://seller.example/terms",
    );
  });

  it("applies to a url-typed reference riding the POLICY entry too — the scope is by type, not by carrier", () => {
    // The manifest permits `url` in the canonical slot, and an http: URL there is exactly as rewritable
    // as one in `links`. Package-local because the corpus pins the links spelling; this pins the scope.
    const out = ucpPlacement.extract({
      policies: [
        {
          type: "com.integraledger.policy.legal_context",
          description: { plain: "Terms of sale." },
          "com.integraledger.legal_context": {
            type: "url",
            value: "http://seller.example/terms",
          },
        },
      ],
    });
    expect(out).toMatchObject({ code: "ucp/insecure-terms-url" });
    expect((out as { detail: string }).detail).toContain(
      "http://seller.example/terms",
    );
  });

  it("a url-typed https reference passes the wrap untouched", () => {
    expect(
      ucpPlacement.extract({
        links: [
          { type: "terms_of_service", url: "https://seller.example/terms" },
        ],
      }),
    ).toEqual({
      ok: true,
      value: { type: "url", value: "https://seller.example/terms" },
    });
  });
});
