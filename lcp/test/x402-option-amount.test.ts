// Every x402 pairing's option filter holds `amount` to the canonical decimal string of a positive integer. x402 v2's
// PaymentRequirements (specs/x402-specification-v2.md at x402-foundation/x402 e95b06661e) gives `amount` as a string of
// atomic token units, and its examples give "10000". For each x402 pairing, an option the vector files hold, set to "10",
// is one its `read` offers; the same option set to "0" (zero), "010" (a leading zero), "1.5" (not an integer), "-1"
// (negative), "" (empty) or 10000 (a number, not a string) is not, and a document that holds all seven offers the one
// set to "10" alone. Two schemes define the member otherwise, and their pairings keep that definition:
// - batch-settlement on EVM and Solana takes a zero price: "`requirements.amount` ... the facilitator MUST validate it as
//   a non-negative base-10 integer string" (specs/schemes/batch-settlement/scheme_batch_settlement_evm.md, "Not below
//   claimed"), and both scheme texts name "a zero-price route" (scheme_batch_settlement_svm.md, "Monotonic amount"), so
//   those two pairings' `read` offers "0" and refuses the other five;
// - XRPL `exact` gives an issued currency's `amount` as "the exact XRPL issued-currency `value` string", with "10.5" and
//   "0.01" as examples (specs/schemes/exact/scheme_exact_xrpl.md, "IOU (Issued Currency)"), so an issued-currency option
//   takes a decimal value above zero.
import { describe, expect, it } from "vitest";
import { isRefusal } from "../src/index.js";
import type { PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { OPTIONS, X402, docOf, type X402Pairing } from "./x402-presentations.js";

const OUTSIDE: readonly [string, unknown][] = [
  ['"0"', "0"],
  ['"010"', "010"],
  ['"1.5"', "1.5"],
  ['"-1"', "-1"],
  ['""', ""],
  ["10000", 10000],
];

/** The pairings whose scheme takes a zero price, so their `read` offers an option whose amount is "0". */
const ZERO_PRICE = ["x402/batch-settlement/eip155", "x402/batch-settlement/solana"];

const withAmount = (o: PaymentRequirements, amount: unknown): PaymentRequirements => ({ ...o, amount }) as PaymentRequirements;
const offered = (b: X402Pairing, accepts: PaymentRequirements[]): unknown => {
  const r = b.read({ ...docOf(accepts[0]!), accepts });
  return isRefusal(r) ? r : (r as { offer: { options: unknown[] } }).offer.options;
};
const NOT_OFFERED = { refused: true, code: "x402/no-payable-option" };

/** Each x402 pairing, with the first option the vector files hold that its `read` offers once set to "10". */
const ROWS = rowsOf(
  X402.map((pairing) => {
    const found = OPTIONS.map(([where, o]) => [where, withAmount(o, "10")] as const).find(([, o]) => !isRefusal(pairing.read(docOf(o))));
    return { pairing, where: found?.[0], option: found?.[1] };
  }),
  "BINDINGS, the x402 pairings, each with an option its read offers",
  { exact: 29 },
);

describe("every x402 pairing's read offers an option's amount only as the canonical decimal of a positive integer", () => {
  it("each of the 29 x402 pairings offers an option from the vector files set to \"10\"", () => {
    expect(ROWS.filter((r) => r.option === undefined).map((r) => r.pairing.id)).toEqual([]);
  });

  it.each(ROWS.map((r) => [`${r.pairing.id} (${r.where})`, r] as const))("%s", (_, { pairing, option }) => {
    expect(offered(pairing, [option!])).toEqual([option]);
    const zero = ZERO_PRICE.includes(pairing.id);
    for (const [what, amount] of OUTSIDE) {
      const changed = withAmount(option!, amount);
      const expected = zero && amount === "0" ? [changed] : NOT_OFFERED;
      expect([what, offered(pairing, [changed])]).toEqual([what, expected]);
    }
    const all = [...OUTSIDE.map(([, amount]) => withAmount(option!, amount)), option!];
    expect(offered(pairing, all)).toEqual(zero ? [withAmount(option!, "0"), option] : [option]);
  });

  it("29 options set to \"10\" are offered, 172 set outside are not, and 2 set to \"0\" on a zero-price scheme are", () => {
    const answers = ROWS.flatMap(({ pairing, option }) => [
      [pairing.id, '"10"', offered(pairing, [option!])],
      ...OUTSIDE.map(([what, amount]) => [pairing.id, what, offered(pairing, [withAmount(option!, amount)])]),
    ]);
    const refused = rowsOf(answers, "each pairing's read of its option at each amount", {
      exact: 172,
      keep: ["the options its read does not offer", ([, , a]) => isRefusal(a)],
      leave: ["the options its read offers", ([, , a]) => !isRefusal(a)],
    });
    expect(refused.every(([, what]) => what !== '"10"')).toBe(true);
    expect(answers.filter(([, what, a]) => what === '"10"' && Array.isArray(a) && a.length === 1)).toHaveLength(29);
    expect(answers.filter(([, what, a]) => what !== '"10"' && !isRefusal(a)).map(([id, what]) => [id, what])).toEqual(
      ZERO_PRICE.map((id) => [id, '"0"']),
    );
  });
});

describe("x402/exact/xrpl: an issued-currency option's amount is a decimal value above zero", () => {
  // The issued-currency option of specs/schemes/exact/scheme_exact_xrpl.md (x402-foundation/x402 e95b06661e), without
  // its `extra.invoiceId`, which the pairing's `advertise` places.
  const IOU: PaymentRequirements = {
    scheme: "exact",
    network: "xrpl:0",
    asset: "524C555344000000000000000000000000000000",
    payTo: "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9",
    amount: "10.5",
    maxTimeoutSeconds: 600,
    extra: { areFeesSponsored: false, assetTransferMethod: "ticketSequence", issuer: "rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q" },
  };
  const xrpl = X402.find((b) => b.id === "x402/exact/xrpl")!;

  it("offers the scheme's examples \"10.5\" and \"0.01\", and not \"0\", \"0.0\" or \"0.00\"", () => {
    for (const amount of ["10.5", "0.01"]) expect([amount, offered(xrpl, [withAmount(IOU, amount)])]).toEqual([amount, [withAmount(IOU, amount)]]);
    for (const amount of ["0", "0.0", "0.00"]) expect([amount, offered(xrpl, [withAmount(IOU, amount)])]).toEqual([amount, NOT_OFFERED]);
  });
});
