// Every x402 pairing's option filter holds `amount` to the canonical decimal string of a positive integer. x402 v2's
// PaymentRequirements (specs/x402-specification-v2.md at x402-foundation/x402 e95b06661e) gives `amount` as a string of
// atomic token units, and its examples give "10000". For each x402 pairing, an option the vector files hold, set to "10",
// is one its `read` offers; the same option set to "0" (zero), "010" (a leading zero), "1.5" (not an integer), "-1"
// (negative), "" (empty) or 10000 (a number, not a string) is not, and a document that holds all seven offers the one
// set to "10" alone. Two schemes define the member otherwise, and their pairings keep that definition:
// - batch-settlement on EVM and Solana takes a zero price: "`requirements.amount` ... the facilitator MUST validate it as
//   a non-negative base-10 integer string" (specs/schemes/batch-settlement/scheme_batch_settlement_evm.md, "Not below
//   claimed"), and both scheme texts name "a zero-price route" (scheme_batch_settlement_svm.md, "Monotonic amount"), so
//   those two pairings' `read` offers "0" and refuses the other five; the EVM pairing's opening `build` refuses it
//   (below);
// - XRPL `exact` gives an issued currency's `amount` as "the exact XRPL issued-currency `value` string", with "10.5" and
//   "0.01" as examples (specs/schemes/exact/scheme_exact_xrpl.md, "IOU (Issued Currency)"), so an issued-currency option
//   takes that value, in the canonical decimal form of a positive STAmount value (below).
import { readFileSync } from "node:fs";
import { decode, encode } from "ripple-binary-codec";
import { describe, expect, it } from "vitest";
import { isRefusal, type AtrHash } from "../src/index.js";
import { batchEvm, batchSvm } from "../src/x402-batch-settlement.js";
import { exactXrpl } from "../src/x402-exact-xrpl.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
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

/** SHA-256("abc"), FIPS 180-2. */
const H: AtrHash = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const LINK = "https://atr.seller.example/7c8acfa2-f800-4192-89e9-1cef9833180f";
const MALFORMED = { refused: true, code: "x402/option-malformed" };
const placedBy = (b: { advertise(doc: PaymentRequired, h: AtrHash, link: string, offer: PaymentRequirements): unknown }, o: PaymentRequirements) =>
  b.advertise({ x402Version: 2, resource: { url: "https://api.seller.example/v1/quote" }, accepts: [o] }, H, LINK, o);

// An XRPL issued-currency `amount` is the `value` of the Payment's Amount and SendMax, which rippled 3.4.1
// (XRPLF/rippled 00e64075) reads with partsFromString (src/libxrpl/protocol/STNumber.cpp:159-216): no leading zero,
// and the digits with the point removed read as a uint64 (:192, :198) that STAmount::iou casts to int64
// (src/libxrpl/protocol/STAmount.cpp:291). An STAmount value is 10^15 to 10^16 - 1 at an offset of -96 to 80
// (include/xrpl/protocol/STAmount.h:35-40, 61-68); IOUAmount rounds past 16 significant digits and reads a value below
// 10^-81 as zero (src/libxrpl/protocol/IOUAmount.cpp:29-36, 58-68). So the pairing offers the canonical decimal of a
// positive STAmount value, which rippled reads exactly: no leading zero, a fraction that ends in a non-zero digit, at
// most 16 significant digits, at least 10^-81, and digits below 2^63. For each value it offers, ripple-binary-codec, the
// payer's encoder, encodes the Payment build writes and decodes the same value text.
describe("x402/exact/xrpl: an issued-currency option's amount is the canonical decimal of a positive STAmount value", () => {
  // The issued-currency option of specs/schemes/exact/scheme_exact_xrpl.md (x402-foundation/x402 e95b06661e), without
  // its `extra.invoiceId`, which the pairing's `advertise` places, and with x402-exact-xrpl.json's destination as
  // `payTo`: the example's payTo, rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9, fails the classic address checksum.
  const IOU: PaymentRequirements = {
    scheme: "exact",
    network: "xrpl:0",
    asset: "524C555344000000000000000000000000000000",
    payTo: "rpjfAeE3DeeHPFnN2PgGFW5YxnZFAjrEyN",
    amount: "10.5",
    maxTimeoutSeconds: 600,
    extra: { areFeesSponsored: false, assetTransferMethod: "ticketSequence", issuer: "rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q" },
  };
  const xrpl = X402.find((b) => b.id === "x402/exact/xrpl")!;
  const z = (n: number): string => "0".repeat(n);
  /** Each value as [label, amount, why]. */
  const OFFERED: readonly [string, string, string][] = [
    ['"10.5"', "10.5", "the scheme's example"],
    ['"0.01"', "0.01", "the scheme's example"],
    ['"1"', "1", "one"],
    ['"9999999999999999"', "9999999999999999", "16 significant digits"],
    ['"1234567890.123456"', "1234567890.123456", "16 significant digits with a fraction"],
    ['"9223372036854775000"', "9223372036854775000", "the largest value of 16 significant digits whose digits are below 2^63"],
    ['"0." + 80 zeros + "1"', `0.${z(80)}1`, "10^-81, the smallest positive STAmount value"],
  ];
  const REFUSED: readonly [string, string, string][] = [
    ['"0"', "0", "zero"],
    ['"0.0"', "0.0", "zero"],
    ['"0.00"', "0.00", "zero"],
    ['"-1"', "-1", "negative"],
    ['"010"', "010", "a leading zero"],
    ['"010.5"', "010.5", "a leading zero"],
    ['"00.5"', "00.5", "two zeros before the point"],
    ['"10.50"', "10.50", "a fraction that ends in a zero"],
    ['"1.0"', "1.0", "a fraction that is a bare zero"],
    ['"0.10"', "0.10", "a fraction that ends in a zero"],
    ['".5"', ".5", "no digit before the point"],
    ['"5."', "5.", "no digit after the point"],
    ['"1e3"', "1e3", "an exponent"],
    ['"+1"', "+1", "a sign"],
    ['"12345678901234567"', "12345678901234567", "17 significant digits"],
    ['"1.2345678901234567"', "1.2345678901234567", "17 significant digits"],
    ['"9223372036854775807"', "9223372036854775807", "2^63 - 1, 19 significant digits"],
    ['"99999999999999999" + 79 zeros', `99999999999999999${z(79)}`, "17 significant digits at offset 80"],
    ['"0." + 81 zeros + "1"', `0.${z(81)}1`, "10^-82, below the smallest positive STAmount value"],
    ['"9223372036854776000"', "9223372036854776000", "16 significant digits whose digits are not below 2^63"],
    ['"9300000000000000000"', "9300000000000000000", "digits from 2^63 to 2^64 - 1, which rippled reads as negative"],
    ['"1" + 20 zeros', `1${z(20)}`, "10^20, digits not below 2^64, which rippled cannot read"],
    ['"9999999999999999" + 80 zeros', `9999999999999999${z(80)}`, "the largest STAmount value written in full"],
    ['"1" + 95 zeros', `1${z(95)}`, "10^95"],
    ['"1" + 96 zeros', `1${z(96)}`, "10^96, past the largest offset, 80"],
    ['"1" + 200 zeros', `1${z(200)}`, "10^200"],
  ];

  it.each(OFFERED.map(([label, amount, why]) => [`${label}, ${why}`, amount] as const))("offers %s, and build's Payment encodes and decodes with that value", async (_, amount) => {
    const o = withAmount(IOU, amount);
    expect(offered(xrpl, [o])).toEqual([o]);
    const placed = placedBy(exactXrpl, o) as PaymentRequired;
    const u = await exactXrpl.build(
      { required: placed, accepted: placed.accepts[0]!, account: "r3sNTMefq5gsRumMYsNznnX6yzzxVH6dTC", fee: "12", sequence: 0, ticketSequence: 7, lastLedgerSequence: 1000 },
      H,
    );
    if (isRefusal(u)) throw new Error(u.code);
    const tx = u.request.txJson;
    expect([tx.Amount, tx.SendMax]).toEqual([
      { currency: IOU.asset, issuer: "rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q", value: amount },
      { currency: IOU.asset, issuer: "rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q", value: amount },
    ]);
    const back = decode(encode({ ...tx, SigningPubKey: "" } as never)) as unknown as { Amount: { value: string }; SendMax: { value: string } };
    expect([back.Amount.value, back.SendMax.value]).toEqual([amount, amount]);
  });

  it.each(REFUSED.map(([label, amount, why]) => [`${label}, ${why}`, amount] as const))("does not offer %s, and advertise refuses it with x402/option-malformed", (_, amount) => {
    const o = withAmount(IOU, amount);
    expect(offered(xrpl, [o])).toEqual(NOT_OFFERED);
    expect(placedBy(exactXrpl, o)).toEqual(MALFORMED);
  });

  // More than 19 digits, leading zeros aside, the width of 2^63, are refused before any further step reads them, so each
  // answer takes time linear in the amount's length. This value is 1,000,002 characters long.
  it('does not offer "1" + 1,000,000 zeros + "1", and advertise, bound and reference refuse it with x402/option-malformed', async () => {
    const amount = `1${z(1_000_000)}1`;
    expect(offered(xrpl, [withAmount(IOU, amount)])).toEqual(NOT_OFFERED);
    expect(placedBy(exactXrpl, withAmount(IOU, amount))).toEqual(MALFORMED);
    // x402-exact-xrpl.json's payment, presented under its own option made this issued currency.
    const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-xrpl.json", import.meta.url), "utf8"));
    const payment = V.buyer.rows[1].input.presented;
    const presented = { ...payment, accepted: { ...payment.accepted, asset: IOU.asset, amount, extra: { ...payment.accepted.extra, issuer: IOU.extra!["issuer"] } } };
    expect(await exactXrpl.bound(presented)).toEqual(MALFORMED);
    expect(await exactXrpl.reference(presented)).toEqual(MALFORMED);
  });
});

// The XRPL exact scheme gives `payTo` as an "XRPL classic address receiving the payment" and `extra.issuer` as the
// "Classic address of the IOU issuer" (specs/schemes/exact/scheme_exact_xrpl.md, "Field Definitions"): base58 with the
// XRPL alphabet of version 0, a 20-byte AccountID, and a 4-byte checksum, the first 4 bytes of the double SHA-256 of the
// two. The scheme's own example payTo, rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9, fails that checksum. rippled 3.4.1
// (XRPLF/rippled 00e64075) refuses AccountID 0, rrrrrrrrrrrrrrrrrrrrrhoLvTp, as any Payment's Destination
// (src/libxrpl/tx/transactors/payment/Payment.cpp:178-184) and as an issuer (src/libxrpl/protocol/STAmount.cpp:155-158).
// The payment engine that every issued-currency Payment runs through (Payment.cpp:611-613, :638) refuses AccountID 1,
// rrrrrrrrrrrrrrrrrrrrBZbvji, rippled's noAccount(), as the destination or the issuer
// (src/libxrpl/tx/paths/PaySteps.cpp:188-190). The XRP Payment build writes, with no SendMax or paths, does not run
// through that engine (Payment.cpp:611, :756-758), so an XRP payTo may be AccountID 1.
describe("x402/exact/xrpl: payTo and an issued currency's extra.issuer are classic addresses whose checksum holds and whose AccountID rippled takes there", () => {
  const xrpl = X402.find((b) => b.id === "x402/exact/xrpl")!;
  const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-xrpl.json", import.meta.url), "utf8"));
  const XRP: PaymentRequirements = V.fixed.option;
  const IOU: PaymentRequirements = {
    ...XRP,
    asset: "524C555344000000000000000000000000000000",
    amount: "10.5",
    extra: { areFeesSponsored: false, issuer: "rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2q" },
  };
  const withExtra = (o: PaymentRequirements, extra: Record<string, unknown>) => ({ ...o, extra }) as PaymentRequirements;
  const ACCOUNT_ZERO = "rrrrrrrrrrrrrrrrrrrrrhoLvTp";
  const ACCOUNT_ONE = "rrrrrrrrrrrrrrrrrrrrBZbvji";
  const REFUSED: readonly [string, PaymentRequirements][] = [
    ["payTo rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9, the scheme's example, whose checksum fails", { ...XRP, payTo: "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9" }],
    ["payTo rpjfAeE3DeeHPFnN2PgGFW5YxnZFAjrEyM, the file's destination with its last character changed", { ...XRP, payTo: "rpjfAeE3DeeHPFnN2PgGFW5YxnZFAjrEyM" }],
    ["payTo T776755V6AJXyATM72Jk5jWeR6z1NhUFJdqSgjCYdD7CgN7, the file's destination as a testnet X-address", { ...XRP, payTo: "T776755V6AJXyATM72Jk5jWeR6z1NhUFJdqSgjCYdD7CgN7" }],
    ["payTo rpjfAeE3DeeHPFnN2PgGFW5YxnZFAjrEyN with a trailing space", { ...XRP, payTo: "rpjfAeE3DeeHPFnN2PgGFW5YxnZFAjrEyN " }],
    ["payTo 0x0000000000000000000000000000000000000000, an EVM address", { ...XRP, payTo: "0x0000000000000000000000000000000000000000" }],
    ["an issued currency with payTo rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9", { ...IOU, payTo: "rN7n3473SaZBCG4dFL83w7a1RXtXtbk2D9" }],
    ["an issued currency with extra.issuer rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2r, whose checksum fails", withExtra(IOU, { areFeesSponsored: false, issuer: "rMwjYedjc7qqtKYVLiAccJSmCwih4LnE2r" })],
    ["an issued currency with no extra.issuer", withExtra(IOU, { areFeesSponsored: false })],
    ["an issued currency with extra.issuer 1, a number", withExtra(IOU, { areFeesSponsored: false, issuer: 1 })],
    ["payTo rrrrrrrrrrrrrrrrrrrrrhoLvTp, AccountID 0", { ...XRP, payTo: ACCOUNT_ZERO }],
    ["an issued currency with payTo rrrrrrrrrrrrrrrrrrrrrhoLvTp, AccountID 0", { ...IOU, payTo: ACCOUNT_ZERO }],
    ["an issued currency with payTo rrrrrrrrrrrrrrrrrrrrBZbvji, AccountID 1", { ...IOU, payTo: ACCOUNT_ONE }],
    ["an issued currency with extra.issuer rrrrrrrrrrrrrrrrrrrrrhoLvTp, AccountID 0", withExtra(IOU, { areFeesSponsored: false, issuer: ACCOUNT_ZERO })],
    ["an issued currency with extra.issuer rrrrrrrrrrrrrrrrrrrrBZbvji, AccountID 1", withExtra(IOU, { areFeesSponsored: false, issuer: ACCOUNT_ONE })],
  ];

  it("offers the file's XRP option and the issued-currency option with the scheme's example issuer", () => {
    expect(offered(xrpl, [XRP])).toEqual([XRP]);
    expect(offered(xrpl, [IOU])).toEqual([IOU]);
  });

  it("rrrrrrrrrrrrrrrrrrrrrhoLvTp and rrrrrrrrrrrrrrrrrrrrBZbvji are AccountIDs 0 and 1, as ripple-binary-codec encodes them", () => {
    // An Account field: its header 0x81, the length 20, and the AccountID.
    expect([encode({ Account: ACCOUNT_ZERO }), encode({ Account: ACCOUNT_ONE })]).toEqual([`8114${"00".repeat(20)}`, `8114${"00".repeat(19)}01`]);
  });

  it("offers the file's XRP option with payTo rrrrrrrrrrrrrrrrrrrrBZbvji, AccountID 1, which an XRP Payment may pay", () => {
    const o = { ...XRP, payTo: ACCOUNT_ONE };
    expect(offered(xrpl, [o])).toEqual([o]);
  });

  it.each(REFUSED)("does not offer the option with %s, and advertise refuses it with x402/option-malformed", (_, o) => {
    expect(offered(xrpl, [o])).toEqual(NOT_OFFERED);
    expect(placedBy(exactXrpl, o)).toEqual(MALFORMED);
  });
});

// "00" is zero written with a leading zero. The EVM and Solana batch-settlement pairings take a zero price only as "0",
// and the Cloudflare pairing takes none, so no batch-settlement pairing offers "00".
describe('x402/batch-settlement: no pairing offers amount "00"', () => {
  const BATCH = ROWS.filter((r) => r.pairing.id.startsWith("x402/batch-settlement/"));

  it("the three batch-settlement pairings each offer an option from the vector files", () => {
    expect(BATCH.map((r) => r.pairing.id).sort()).toEqual(["x402/batch-settlement/cloudflare", "x402/batch-settlement/eip155", "x402/batch-settlement/solana"]);
  });

  it.each(BATCH.map((r) => [r.pairing.id, r] as const))('%s does not offer its option with amount "00", and advertise refuses it with x402/option-malformed', (_, { pairing, option }) => {
    const o = withAmount(option!, "00");
    expect(offered(pairing, [o])).toEqual(NOT_OFFERED);
    expect(placedBy(pairing, o)).toEqual(MALFORMED);
  });
});

// On the EVM batch-settlement pairing a zero price is paid within a channel, never by its opening. The facilitator's
// "Not below claimed" check, for "voucher and deposit payloads", requires the voucher's `maxClaimableAmount` to be
// "strictly greater than `totalClaimed`", which is 0 on a new channel, and the server's "Verify" step requires a deposit's
// voucher to equal `chargedCumulativeAmount + paymentRequirements.amount`, which is 0 there
// (specs/schemes/batch-settlement/scheme_batch_settlement_evm.md). So the opening's `build` refuses an option whose
// amount is "0", while `read` offers it and `buildWithin` writes a later voucher under it. The Solana text's strict
// floor names voucher verify and the top-up deposit only ("Monotonic amount", scheme_batch_settlement_svm.md), so the
// Solana opening's `build` takes "0".
describe("x402/batch-settlement: a zero price opens no EVM channel", () => {
  const V = JSON.parse(readFileSync(new URL("../vectors/x402-batch-settlement.json", import.meta.url), "utf8"));
  const E = V.fixed.evm;
  const S = V.fixed.svm;
  const evmOpening = (doc: PaymentRequired) =>
    batchEvm.build(
      { required: doc, accepted: doc.accepts[0]!, from: E.payer, now: E.now, payerAuthorizer: E.payerAuthorizer, deposit: BigInt(E.deposit), authSalt: E.authSalt },
      H,
    );

  it("the EVM opening's build refuses amount \"0\" with x402/option-malformed and builds amount \"1\"; read offers \"0\" and buildWithin writes a voucher of 1 under it", async () => {
    const zero = placedBy(batchEvm, { ...E.option, amount: "0" }) as PaymentRequired;
    const one = placedBy(batchEvm, { ...E.option, amount: "1" }) as PaymentRequired;
    expect(isRefusal(batchEvm.read(zero))).toBe(false);
    expect(await evmOpening(zero)).toEqual(MALFORMED);
    expect(isRefusal(await evmOpening(one))).toBe(false);
    const within = await batchEvm.buildWithin({ required: zero, accepted: zero.accepts[0]!, channelConfig: E.config, maxClaimableAmount: 1n }, H);
    if (isRefusal(within)) throw new Error(within.code);
    expect(within.requests).toHaveLength(1);
  });

  it("the Solana opening's build takes amount \"0\"", async () => {
    const zero = placedBy(batchSvm, { ...S.option, amount: "0" }) as PaymentRequired;
    const u = await batchSvm.build(
      {
        required: zero,
        accepted: zero.accepts[0]!,
        payer: S.payer,
        payerAuthorizer: S.payer,
        deposit: BigInt(S.deposit),
        salt: 42n,
        openSlot: BigInt(S.openSlot),
        tokenProgram: S.tokenProgram,
        recentBlockhash: S.blockhash,
      },
      H,
    );
    expect(isRefusal(u)).toBe(false);
  });
});
