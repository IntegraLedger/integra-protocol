import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { assertManifestHygiene } from "@integraledger/lcp-binding-core";
import { describe, expect, it } from "vitest";
import { ACP_PLACEMENT, acpPlacement } from "../src/index.js";

const vec = JSON.parse(
  readFileSync(
    new URL("../../../vectors/placement/acp.json", import.meta.url),
    "utf8",
  ),
) as {
  manifest: Record<string, unknown>;
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

describe("ACP placement — manifest matches the tree", () => {
  it("the shipped manifest equals the pinned manifest", () => {
    expect(JSON.parse(JSON.stringify(ACP_PLACEMENT))).toEqual(vec.manifest);
  });

  it("the pinned manifest validates against placement.schema.json", () => {
    // GP-3: the schema has a consumer. A manifest the tree schema would reject is a manifest the
    // conformance corpus certifies and the type system does not.
    const schema = JSON.parse(
      readFileSync(
        new URL(
          "../../../vectors/placement/placement.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as ConstructorParameters<typeof Validator>[0];
    expect(
      new Validator(schema, "2020-12", false).validate(vec.manifest).valid,
    ).toBe(true);
  });

  it("passes the hygiene guard — the coherence rules JSON Schema cannot express", () => {
    // The standing obligation on every placement package: the schema checks SHAPE, this checks COHERENCE,
    // and neither substitutes for the other. A manifest no test passes through the guard is unguarded —
    // draft 2020-12 cannot compare two properties of the same object, so "readAlso may not repeat field"
    // and "the reference field must permit an integrity-bearing carrier" live only here.
    expect(() => assertManifestHygiene(ACP_PLACEMENT)).not.toThrow();
  });
});

describe("ACP placement — cases", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      const { op, doc } = c.input;
      const ref = c.input.ref as {
        type: "sha256" | "ipfs" | "ar" | "url";
        value: string;
      };

      if (op === "place-purity") {
        const before = JSON.stringify(doc);
        acpPlacement.place(ref, doc);
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
          ? acpPlacement.extract(doc)
          : acpPlacement.place(ref, doc);
      if ("refused" in out) expect(out).toMatchObject(c.expected as object);
      else expect(out).toEqual(c.expected);
    });
  }
});

// `detail` is human-facing prose and the CORPUS deliberately omits it — the code is the
// cross-implementation contract and the sentence is not. But that convention is about what a FOREIGN
// subject must reproduce, not a licence for this package's own messages to be useless. Now that the
// object-shaped alias is read, a naive `${raw}` renders "[object Object]" and tells an operator nothing
// about which reference failed. These are package-local and assert only OUR phrasing.
describe("ACP placement — refusal detail stays legible across both carrier shapes", () => {
  const CORRUPT =
    "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

  it("names the offending value when the canonical string carrier is corrupt", () => {
    const out = acpPlacement.extract({
      metadata: { legal_context: `lcp:sha256:${CORRUPT}` },
    });
    expect(out).toMatchObject({ code: "acp/reference-malformed" });
    expect((out as { detail: string }).detail).toContain(CORRUPT);
  });

  it("SERIALIZES the offending value when the object-shaped alias is corrupt", () => {
    const out = acpPlacement.extract({
      metadata: { legalContext: { type: "sha256", value: CORRUPT } },
    });
    expect(out).toMatchObject({ code: "acp/reference-malformed" });
    const { detail } = out as { detail: string };
    expect(detail).toContain(CORRUPT);
    expect(detail).not.toContain("[object Object]");
  });

  it("names the ENCODING that failed to parse, so the alias and the canonical slot are told apart", () => {
    expect(
      acpPlacement.extract({
        metadata: { legal_context: "not-an-lcp-string" },
      }),
    ).toMatchObject({ detail: expect.stringContaining("lcp-string") });
    expect(
      acpPlacement.extract({ metadata: { legalContext: { nope: true } } }),
    ).toMatchObject({ detail: expect.stringContaining("reference-object") });
  });
});
