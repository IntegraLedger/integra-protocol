import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeTerms } from "../src/terms.js";

type Case = { name: string; input: string; expected: string };
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/terms/normalize.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: Case[];
};

describe("normalizeTerms", () => {
  it.each(V.cases)("$name", ({ input, expected }) => {
    expect(normalizeTerms(input)).toBe(expected);
  });

  it("is idempotent for arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(normalizeTerms(normalizeTerms(s))).toBe(normalizeTerms(s));
      }),
    );
  });
});
