// Each x402 pairing's `bound` holds the presented `accepted` to the option filter its own `read` applies. Every presented
// payment the x402 vector files hold (x402-presentations.ts) is presented under every x402 option those files hold, and
// under its own option with its network, scheme or `extra.assetTransferMethod` changed to another the options use, or
// with one member changed: `maxTimeoutSeconds` 0, removed, "60" or 1.5, and `amount` "0", "abc" or removed, `payTo` and
// `asset` changed or removed, `extra` removed or null (x402 v2's PaymentRequirements, specs/x402-specification-v2.md at
// x402-foundation/x402 e95b06661e: `amount` a string of atomic units, `maxTimeoutSeconds` a number of seconds, `payTo`
// and `asset` strings, `extra` an object). Under an option its `read` does not offer, each pairing's `bound` refuses the
// payment with the code its `advertise` gives that option. Under every option its `read` offers, a pairing whose
// `bound` binds the payment under its own option gives H again, or refuses with a code that compares what the payer
// signed with the option, or reads a member of the option that `bound` needs; each such code is listed below with what
// it reads, and each is seen. Then each vector file's `boundAccepted` rows: the file's payment under an option the
// pairing's `read` does not offer, refused with the row's code.
import { beforeAll, describe, expect, it } from "vitest";
import { isRefusal, type AtrHash } from "../src/index.js";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { FILES, OPTIONS, PAYMENTS, X402, docOf, vector, type X402Pairing } from "./x402-presentations.js";

const LINK = "https://atr.seller.example/7c8acfa2-f800-4192-89e9-1cef9833180f";
/** SHA-256("abc"), FIPS 180-2. */
const H: AtrHash = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/**
 * What a pairing's `bound` reads of an option its `read` offers, as the refusal it gives when the option's member does
 * not match what the payer signed, or is not one `bound` can read.
 */
const READS_OF_THE_OPTION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "x402/auth-capture/eip155/eip3009": {
    "x402/nonce-not-payment": "the signed nonce is the hash of the payment information, which holds the option's network, asset, payTo and amount",
    "x402/option-malformed": "the payment information holds the option's amount, a uint256",
  },
  "x402/auth-capture/eip155/permit2": {
    "x402/nonce-not-payment": "the signed nonce is the hash of the payment information, which holds the option's network, asset, payTo and amount",
    "x402/option-malformed": "the payment information holds the option's amount, a uint256",
  },
  "x402/batch-settlement/eip155": { "x402/channel-id-mismatch": "the voucher's channel id is the configuration's hash on the option's network" },
  "x402/batch-settlement/solana": { "svm/carrier-mismatch": "the opening's memo is the option's extra.memo" },
  "x402/exact/lnbtc": { "ln/currency-network": "the invoice's currency is the one x402 gives the option's network" },
  "x402/exact/lnbtc/invoice-named": {
    "ln/currency-network": "the invoice's currency is the one x402 gives the option's network",
    "x402/option-malformed": "x402's client checks on the option's own fields, which advertise and build make",
  },
  "x402/exact/solana": { "svm/carrier-mismatch": "the transaction's memo is the option's extra.memo" },
  "x402/exact/stellar": { "stellar/carrier-mismatch": "the transfer's destination is the option's payTo, muxed with H" },
  "x402/exact/tvm": { "tvm/carrier-mismatch": "the forward payload is the option's extra.forwardPayload" },
  "x402/exact/xrpl": { "xrpl/carrier-not-lcp": "H is the option's extra.invoiceId, which the signed InvoiceID carries" },
  "x402/upto/solana": { "svm/carrier-mismatch": "the opening's memo is the option's extra.memo" },
};

const set = (o: PaymentRequirements, key: string, value: unknown): PaymentRequirements => {
  const copy = structuredClone(o) as Record<string, unknown>;
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy as PaymentRequirements;
};
const other = (s: unknown): unknown => (typeof s === "string" ? s.slice(0, -1) + (s.endsWith("1") ? "2" : "1") : "x");
const NETWORKS = [...new Set(OPTIONS.map(([, o]) => o.network))];
const SCHEMES = [...new Set(OPTIONS.map(([, o]) => o.scheme))];
const METHODS = [...new Set(OPTIONS.map(([, o]) => (o.extra as Record<string, unknown> | undefined)?.["assetTransferMethod"]))];

/** The payment's own option, then that option with one thing changed. */
function presentedOptions(where: string, o: PaymentRequirements): [string, PaymentRequirements][] {
  const method = (o.extra as Record<string, unknown> | undefined)?.["assetTransferMethod"];
  return [
    [`${where}: its own option`, o],
    ...NETWORKS.filter((n) => n !== o.network).map((n) => [`${where}: network ${n}`, { ...o, network: n }] as [string, PaymentRequirements]),
    ...SCHEMES.filter((s) => s !== o.scheme).map((s) => [`${where}: scheme ${s}`, { ...o, scheme: s }] as [string, PaymentRequirements]),
    ...METHODS.filter((m) => m !== method).map((m) => {
      const extra = { ...((o.extra as Record<string, unknown> | undefined) ?? {}) };
      if (m === undefined) delete extra["assetTransferMethod"];
      else extra["assetTransferMethod"] = m;
      return [`${where}: assetTransferMethod ${String(m)}`, { ...o, extra }] as [string, PaymentRequirements];
    }),
    ...(
      [
        ["maxTimeoutSeconds 0", set(o, "maxTimeoutSeconds", 0)],
        ["maxTimeoutSeconds removed", set(o, "maxTimeoutSeconds", undefined)],
        ['maxTimeoutSeconds "60"', set(o, "maxTimeoutSeconds", "60")],
        ["maxTimeoutSeconds 1.5", set(o, "maxTimeoutSeconds", 1.5)],
        ['amount "0"', set(o, "amount", "0")],
        ['amount "abc"', set(o, "amount", "abc")],
        ["amount removed", set(o, "amount", undefined)],
        ["payTo changed", set(o, "payTo", other(o.payTo))],
        ["payTo removed", set(o, "payTo", undefined)],
        ["asset changed", set(o, "asset", other(o.asset))],
        ["asset removed", set(o, "asset", undefined)],
        ["extra removed", set(o, "extra", undefined)],
        ["extra null", set(o, "extra", null)],
      ] as [string, PaymentRequirements][]
    ).map(([what, changed]) => [`${where}: ${what}`, changed] as [string, PaymentRequirements]),
  ];
}

const PRESENTATIONS = rowsOf(
  PAYMENTS.flatMap(([where, p]) =>
    [...OPTIONS, ...presentedOptions(where, p.accepted)].map(([what, accepted]) => ({ where, what, payment: p, accepted })),
  ),
  "each presented payment under every option the files hold and under its own option changed",
  { exact: 15951 },
);

/** A pairing's answers to one presentation. */
interface Answer {
  pairing: X402Pairing;
  where: string;
  what: string;
  offered: boolean;
  bound: unknown;
  /** What the pairing's `bound` gives the payment under its own option. */
  own: unknown;
  advertised: unknown;
}
const answers: Answer[] = [];

describe("each x402 pairing's bound holds accepted to the filter its read applies", () => {
  beforeAll(async () => {
    const own = new Map<PaymentPayload, Map<string, unknown>>();
    for (const [, p] of PAYMENTS) {
      const answered = new Map<string, unknown>();
      for (const b of X402) answered.set(b.id, await b.bound(p));
      own.set(p, answered);
    }
    const offered = new Map<string, Set<string>>();
    for (const { where, what, payment, accepted } of PRESENTATIONS) {
      const key = JSON.stringify(accepted);
      if (!offered.has(key)) offered.set(key, new Set(X402.filter((b) => !isRefusal(b.read(docOf(accepted)))).map((b) => b.id)));
      for (const pairing of X402) {
        const isOffered = offered.get(key)!.has(pairing.id);
        const doc: PaymentRequired = { x402Version: 2, resource: { url: "https://pairing.invalid/" }, accepts: [accepted] };
        answers.push({
          pairing,
          where,
          what,
          offered: isOffered,
          bound: await pairing.bound({ ...payment, accepted }),
          own: own.get(payment)!.get(pairing.id),
          advertised: isOffered ? undefined : pairing.advertise(doc, H, LINK, accepted),
        });
      }
    }
  }, 0);

  it("each presentation is answered by each of the 29 x402 pairings", () => {
    rowsOf(X402, "BINDINGS, the x402 pairings", { exact: 29 });
    expect(answers.length).toBe(PRESENTATIONS.length * 29);
  });

  it("under an option its read does not offer, each pairing's bound refuses the payment with the code its advertise gives", () => {
    const refused = rowsOf(answers, "every pairing's answer to every presentation", {
      exact: 454244,
      keep: ["the options the pairing's read does not offer", (a) => !a.offered],
      leave: ["the options the pairing's read offers", (a) => a.offered],
    });
    const differ = refused.filter((a) => !isRefusal(a.bound) || JSON.stringify(a.bound) !== JSON.stringify(a.advertised));
    expect(differ.map((a) => [a.pairing.id, a.where, a.what, a.bound, a.advertised])).toEqual([]);
  }, 0);

  it("under every option its read offers, a pairing that binds the payment gives H, or a refusal naming what bound reads of the option", () => {
    const offered = rowsOf(answers, "every pairing's answer to every presentation", {
      exact: 886,
      keep: ["the options the pairing's read offers, for a payment its bound binds under its own option", (a) => a.offered && !isRefusal(a.own)],
      leave: ["the others", (a) => !(a.offered && !isRefusal(a.own))],
    });
    const seen = new Set<string>();
    let bindings = 0;
    for (const a of offered) {
      if (!isRefusal(a.bound)) {
        expect([a.pairing.id, a.where, a.what, a.bound]).toEqual([a.pairing.id, a.where, a.what, a.own]);
        bindings++;
        continue;
      }
      const code = (a.bound as { code: string }).code;
      expect([a.pairing.id, a.where, a.what, code in (READS_OF_THE_OPTION[a.pairing.id] ?? {})]).toEqual([a.pairing.id, a.where, a.what, true]);
      seen.add(`${a.pairing.id} ${code}`);
    }
    expect([bindings, offered.length - bindings]).toEqual([827, 59]);
    const listed = Object.entries(READS_OF_THE_OPTION).flatMap(([id, codes]) => Object.keys(codes).map((c) => `${id} ${c}`));
    expect([...seen].sort()).toEqual(listed.sort());
  }, 0);
});

/** The value at a JSON Pointer (RFC 6901) into `doc`. */
function at(doc: unknown, pointer: string): unknown {
  return pointer
    .split("/")
    .slice(1)
    .reduce((o, k) => (o as Record<string, unknown>)[k.replaceAll("~1", "/").replaceAll("~0", "~")], doc);
}

interface BoundAcceptedRow {
  case: string;
  pairing: string;
  payment: string;
  accepted: PaymentRequirements;
  expect: string;
}
const X402_FILES = rowsOf(
  FILES,
  "the x402 vector files",
  { exact: 27, keep: ["the x402 vector files", (f) => f.startsWith("x402-")], leave: ["buyer.json", (f) => f === "buyer.json"] },
);
const ROWS = rowsOf(
  X402_FILES.flatMap((f) => {
    const v = vector(f) as { boundAccepted: { rows: BoundAcceptedRow[] } };
    return rowsOf(v.boundAccepted.rows, `${f} boundAccepted.rows`).map((row, i) => ({ file: f, i, row, payment: at(v, row.payment) as PaymentPayload }));
  }),
  "every x402 vector file's boundAccepted rows",
  { exact: 64 },
);

describe("the x402 vector files' boundAccepted rows", () => {
  it("every x402 pairing has a row", () => {
    expect([...new Set(ROWS.map((r) => r.row.pairing))].sort()).toEqual(X402.map((b) => b.id).sort());
  });

  it.each(ROWS.map((r) => [`${r.file} boundAccepted.rows[${r.i}]: ${r.row.case}`, r] as const))("%s", async (_, { row, payment }) => {
    const pairing = X402.find((b) => b.id === row.pairing)!;
    const doc: PaymentRequired = { x402Version: 2, resource: { url: "https://pairing.invalid/" }, accepts: [row.accepted] };
    expect(isRefusal(await pairing.bound(payment))).toBe(false);
    expect(await pairing.bound({ ...payment, accepted: row.accepted })).toEqual({ refused: true, code: row.expect });
    expect(pairing.read(docOf(row.accepted))).toEqual({ refused: true, code: "x402/no-payable-option" });
    expect(pairing.advertise(doc, H, LINK, row.accepted)).toEqual({ refused: true, code: row.expect });
  });
});

// x402 v2's PaymentPayload carries `accepted`, the PaymentRequirements object the payer chose
// (specs/x402-specification-v2.md at x402-foundation/x402 e95b06661e), and docs/reference/refusals.md gives
// `x402/payload-malformed` for a presented payment whose `accepted` is not an object. Each pairing is given a vector
// payment its `bound` binds, with `accepted` replaced by each value that is not an object, or removed.
const NOT_AN_OBJECT: [string, unknown][] = [
  ["null", null],
  ["a string", "exact"],
  ["a number", 2],
  ["an array", []],
  ["removed", undefined],
];

describe("a presented payment whose accepted is not an object", () => {
  it.each(X402.map((b) => [b.id, b] as const))("%s: bound and reference refuse it with x402/payload-malformed", async (_, pairing) => {
    let payment: PaymentPayload | undefined;
    for (const [, p] of PAYMENTS) {
      if (!isRefusal(await pairing.bound(p))) {
        payment = p;
        break;
      }
    }
    expect(payment).toBeDefined();
    for (const [what, accepted] of NOT_AN_OBJECT) {
      const presented: Record<string, unknown> = { ...payment! };
      if (accepted === undefined) delete presented["accepted"];
      else presented["accepted"] = accepted;
      expect([what, await pairing.bound(presented)]).toEqual([what, { refused: true, code: "x402/payload-malformed" }]);
      if (pairing.reference !== undefined) {
        expect([what, await pairing.reference(presented)]).toEqual([what, { refused: true, code: "x402/payload-malformed" }]);
      }
    }
  });
});
