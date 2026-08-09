import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Bounds, isWithin } from "../src/bounds.js";

const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/authority/attenuation.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    input: { child: Bounds; parent: Bounds };
    expected: boolean;
  }[];
};

describe("isWithin — ATA-2 attenuation (the net-new vector, authored from the semantics)", () => {
  it.each(V.cases)("$name", ({ input, expected }) => {
    expect(isWithin(input.child, input.parent)).toBe(expected);
  });

  it("the inverted direction is not subset — a subset-for-both impl fails the dropped-category case", () => {
    // child forbids {a}, parent forbids {a,b}: subset({a},{a,b}) === true, but the RULE is superset → reject.
    expect(
      isWithin(
        { forbiddenClauseCategories: ["a"] },
        { forbiddenClauseCategories: ["a", "b"] },
      ),
    ).toBe(false);
    expect(
      isWithin(
        { forbiddenClauseCategories: ["a", "b"] },
        { forbiddenClauseCategories: ["a"] },
      ),
    ).toBe(true);
  });
});

/**
 * The corpus pins the fully-empty child `{}` against a restricting parent — the forged link that was a
 * CRITICAL hole here once. It does not pin the PARTIAL forgery: a child that dutifully restricts one
 * dimension while omitting another. Only `jurisdictions` was covered; a child could drop caps,
 * disputeMethods or forbiddenClauseCategories and the suite would not have noticed. An absent dimension
 * is UNBOUNDED — the widest possible — so each omission has to be rejected on its own.
 */
describe("isWithin — an absent child dimension never escapes a restricting parent", () => {
  it("rejects a child that restricts jurisdictions but omits caps entirely", () => {
    expect(
      isWithin(
        { jurisdictions: ["US-NY"] },
        { jurisdictions: ["US-NY"], caps: { USD: "1000" } },
      ),
    ).toBe(false);
  });

  it("rejects a child that omits disputeMethods under a parent that restricts them", () => {
    expect(
      isWithin(
        { jurisdictions: ["US-NY"] },
        { jurisdictions: ["US-NY"], disputeMethods: ["arbitration"] },
      ),
    ).toBe(false);
  });

  it("rejects a child that omits forbiddenClauseCategories under a parent that forbids something", () => {
    // The inverted dimension: forbidding nothing is the WIDEST child, so an absent list cannot inherit
    // the parent's prohibitions by silence.
    expect(
      isWithin(
        { jurisdictions: ["US-NY"] },
        { jurisdictions: ["US-NY"], forbiddenClauseCategories: ["arb-waiver"] },
      ),
    ).toBe(false);
  });

  it("accepts an EXPLICIT empty caps object — no currency authorized is narrower, not wider", () => {
    // The counterpart that keeps the rule from being "any missing key rejects": `caps: {}` is a real,
    // maximally-restrictive statement, unlike an absent `caps`.
    expect(isWithin({ caps: {} }, { caps: { USD: "1000" } })).toBe(true);
  });

  it("rejects a child cap in a currency the parent never authorized", () => {
    expect(isWithin({ caps: { EUR: "1" } }, { caps: { USD: "1000" } })).toBe(
      false,
    );
  });
});
