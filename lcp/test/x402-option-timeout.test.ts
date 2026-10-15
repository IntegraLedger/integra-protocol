// Every x402 pairing's option filter holds `maxTimeoutSeconds` to a positive safe integer. x402 v2's PaymentRequirements
// (specs/x402-specification-v2.md at x402-foundation/x402 e95b06661e) gives `maxTimeoutSeconds` as a number of seconds,
// and its examples give 60. For each x402 pairing, an option the vector files hold, set to 60, is one its `read` offers;
// the same option set to 60.5 (not an integer), "60" (a string), 0 (not positive) or 2^53 (not a safe integer,
// Number.MAX_SAFE_INTEGER + 1) is not, and a document that holds all five offers the one set to 60 alone.
import { describe, expect, it } from "vitest";
import { isRefusal } from "../src/index.js";
import type { PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { OPTIONS, X402, docOf, type X402Pairing } from "./x402-presentations.js";

const OUTSIDE: readonly [string, unknown][] = [
  ["60.5", 60.5],
  ['"60"', "60"],
  ["0", 0],
  ["2^53", 2 ** 53],
];

const withTimeout = (o: PaymentRequirements, t: unknown): PaymentRequirements => ({ ...o, maxTimeoutSeconds: t }) as PaymentRequirements;
const offered = (b: X402Pairing, accepts: PaymentRequirements[]): unknown => {
  const r = b.read({ ...docOf(accepts[0]!), accepts });
  return isRefusal(r) ? r : (r as { offer: { options: unknown[] } }).offer.options;
};

/** Each x402 pairing, with the first option the vector files hold that its `read` offers once set to 60. */
const ROWS = rowsOf(
  X402.map((pairing) => {
    const found = OPTIONS.map(([where, o]) => [where, withTimeout(o, 60)] as const).find(([, o]) => !isRefusal(pairing.read(docOf(o))));
    return { pairing, where: found?.[0], option: found?.[1] };
  }),
  "BINDINGS, the x402 pairings, each with an option its read offers",
  { exact: 29 },
);

describe("every x402 pairing's read offers an option's maxTimeoutSeconds only as a positive safe integer", () => {
  it("each of the 29 x402 pairings offers an option from the vector files set to 60", () => {
    expect(ROWS.filter((r) => r.option === undefined).map((r) => r.pairing.id)).toEqual([]);
  });

  it.each(ROWS.map((r) => [`${r.pairing.id} (${r.where})`, r] as const))("%s", (_, { pairing, option }) => {
    expect(offered(pairing, [option!])).toEqual([option]);
    for (const [what, t] of OUTSIDE) {
      expect([what, offered(pairing, [withTimeout(option!, t)])]).toEqual([what, { refused: true, code: "x402/no-payable-option" }]);
    }
    const all = [...OUTSIDE.map(([, t]) => withTimeout(option!, t)), option!];
    expect(offered(pairing, all)).toEqual([option]);
  });

  it("29 options set to 60 are offered and 116 set outside are not", () => {
    const answers = ROWS.flatMap(({ pairing, option }) => [
      ["60", offered(pairing, [option!])],
      ...OUTSIDE.map(([what, t]) => [what, offered(pairing, [withTimeout(option!, t)])]),
    ]);
    const refused = rowsOf(answers, "each pairing's read of its option at each timeout", {
      exact: 116,
      keep: ["the options set outside a positive safe integer", ([what]) => what !== "60"],
      leave: ["the options set to 60", ([what]) => what === "60"],
    });
    expect(refused.every(([, a]) => isRefusal(a))).toBe(true);
    expect(answers.filter(([what, a]) => what === "60" && Array.isArray(a) && a.length === 1)).toHaveLength(29);
  });
});
