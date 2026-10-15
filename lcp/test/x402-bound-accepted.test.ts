// Each x402 pairing's `bound` holds the presented `accepted` to the option filter its own `read` applies, and that filter
// takes in every check `build`, `bound` and `reference` make on the option alone. Every presented payment the x402
// vector files hold (x402-presentations.ts) is presented under every x402 option those files hold, and under its own
// option with its network, scheme or `extra.assetTransferMethod` changed to another the options use, or with one member
// changed: `maxTimeoutSeconds` 0, removed, "60", 1.5, 2^32, 5 × (2^32 − 1) + 1 or 2^48, `amount` "0", "abc", removed,
// 2^64, 2^120, 2^128 or 2^256, `payTo` and `asset` changed or removed, `extra` removed or null, and each member of
// `extra` removed, null, "", 0, "abc", 70000, the zero address or changed (x402 v2's PaymentRequirements,
// specs/x402-specification-v2.md at x402-foundation/x402 e95b06661e: `amount` a string of atomic units,
// `maxTimeoutSeconds` a number of seconds, `payTo` and `asset` strings, `extra` an object; the widths are the fields
// `build` writes them into: a TON wallet's `valid_until` and a Stellar entry's expiration ledger, `uint32`, and the
// commerce-payments escrow's `uint48` expiries and `uint120` amount). Under an option its `read` does not offer, each
// pairing's `bound` refuses the payment with the code its `advertise` gives that option. Under every option its `read`
// offers, a pairing whose `bound` binds the payment under its own option gives the same H again, and its `reference`
// gives read keys again, or each refuses with a code that compares what the payer signed with the option (a carrier, a
// channel id, a nonce or a salt); each such code is listed below with what it compares, and each is seen. Then each
// vector file's `boundAccepted` rows: the file's payment under an option the pairing's `read` does not offer, refused
// with the row's code.
import { beforeAll, describe, expect, it } from "vitest";
import { isRefusal, type AtrHash } from "../src/index.js";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { FILES, OPTIONS, PAYMENTS, X402, docOf, vector, type X402Pairing } from "./x402-presentations.js";

const LINK = "https://atr.seller.example/7c8acfa2-f800-4192-89e9-1cef9833180f";
/** SHA-256("abc"), FIPS 180-2. */
const H: AtrHash = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

/**
 * What a pairing's `bound` and `reference` compare between an option its `read` offers and what the payer signed, as
 * the refusal each gives when they differ.
 */
const SIGNED_AGAINST_THE_OPTION: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "x402/auth-capture/eip155/eip3009": {
    "x402/nonce-not-payment": "the signed nonce is the hash of the payment information, which holds the option's network, asset, payTo, amount and escrow terms",
    "x402/salt-not-bound": "the signed salt is the commitment to the option's receiver authorizer and policy, and carries no saltNonce where the option binds neither",
  },
  "x402/auth-capture/eip155/permit2": {
    "x402/nonce-not-payment": "the signed nonce is the hash of the payment information, which holds the option's network, asset, payTo, amount and escrow terms",
    "x402/salt-not-bound": "the signed salt is the commitment to the option's receiver authorizer and policy, and carries no saltNonce where the option binds neither",
  },
  "x402/batch-settlement/eip155": { "x402/channel-id-mismatch": "the voucher's channel id is the configuration's hash on the option's network" },
  "x402/batch-settlement/solana": {
    "svm/carrier-mismatch": "the opening's memo is the option's extra.memo",
    "svm/channel-id-mismatch": "the opening's channel is the one the option's extra.feePayer derives",
  },
  "x402/exact/solana": { "svm/carrier-mismatch": "the transaction's memo is the option's extra.memo" },
  "x402/exact/stellar": { "stellar/carrier-mismatch": "the transfer's destination is the option's payTo, muxed with H" },
  "x402/exact/tvm": { "tvm/carrier-mismatch": "the forward payload is the option's extra.forwardPayload" },
  "x402/exact/xrpl": {
    "xrpl/carrier-not-lcp": "H is the option's extra.invoiceId, which the signed InvoiceID carries",
    "xrpl/carrier-mismatch": "the signed InvoiceID is the digest of the option's extra.invoiceId",
  },
  "x402/upto/solana": { "svm/carrier-mismatch": "the opening's memo is the option's extra.memo" },
};

const set = (o: PaymentRequirements, key: string, value: unknown): PaymentRequirements => {
  const copy = structuredClone(o) as Record<string, unknown>;
  if (value === undefined) delete copy[key];
  else copy[key] = value;
  return copy as PaymentRequirements;
};
const setExtra = (o: PaymentRequirements, key: string, value: unknown): PaymentRequirements => {
  const copy = structuredClone(o) as PaymentRequirements;
  const extra = copy.extra as Record<string, unknown>;
  if (value === undefined) delete extra[key];
  else extra[key] = value;
  return copy;
};
const other = (s: unknown): unknown => (typeof s === "string" ? s.slice(0, -1) + (s.endsWith("1") ? "2" : "1") : "x");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** Each `extra` member's changes: removed, null, "", 0, "abc", 70000, the zero address, changed. */
const EXTRA_CHANGES: readonly [string, (v: unknown) => unknown][] = [
  ["removed", () => undefined],
  ["null", () => null],
  ['""', () => ""],
  ["0", () => 0],
  ['"abc"', () => "abc"],
  ["70000", () => 70000],
  ["the zero address", () => ZERO_ADDRESS],
  ["changed", (v) => other(v)],
];
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
        ["maxTimeoutSeconds 2^32", set(o, "maxTimeoutSeconds", 2 ** 32)],
        ["maxTimeoutSeconds 5 × (2^32 − 1) + 1", set(o, "maxTimeoutSeconds", 5 * (2 ** 32 - 1) + 1)],
        ["maxTimeoutSeconds 2^48", set(o, "maxTimeoutSeconds", 2 ** 48)],
        ['amount "0"', set(o, "amount", "0")],
        ['amount "abc"', set(o, "amount", "abc")],
        ["amount removed", set(o, "amount", undefined)],
        ["amount 2^64", set(o, "amount", (2n ** 64n).toString())],
        ["amount 2^120", set(o, "amount", (2n ** 120n).toString())],
        ["amount 2^128", set(o, "amount", (2n ** 128n).toString())],
        ["amount 2^256", set(o, "amount", (2n ** 256n).toString())],
        ["payTo changed", set(o, "payTo", other(o.payTo))],
        ["payTo removed", set(o, "payTo", undefined)],
        ["asset changed", set(o, "asset", other(o.asset))],
        ["asset removed", set(o, "asset", undefined)],
        ["extra removed", set(o, "extra", undefined)],
        ["extra null", set(o, "extra", null)],
        ...Object.keys((o.extra as Record<string, unknown> | undefined) ?? {}).flatMap((key) =>
          EXTRA_CHANGES.map(([what, to]) => [`extra.${key} ${what}`, setExtra(o, key, to((o.extra as Record<string, unknown>)[key]))]),
        ),
      ] as [string, PaymentRequirements][]
    ).map(([what, changed]) => [`${where}: ${what}`, changed] as [string, PaymentRequirements]),
  ];
}

/**
 * The counts this file's inputs give: the presentations; the answers under an option the pairing's `read` does not
 * offer; those under one it offers, for a payment its `bound` binds under its own option; and of those, the bindings,
 * the refusals, and the bindings whose `reference` gives read keys.
 */
const PRESENTED = 22425;
const NOT_OFFERED = 640549;
const OFFERED_OWN_BINDS = 1302;
const OFFERED_COUNTS = [1210, 92, 1129];

const PRESENTATIONS = rowsOf(
  PAYMENTS.flatMap(([where, p]) =>
    [...OPTIONS, ...presentedOptions(where, p.accepted)].map(([what, accepted]) => ({ where, what, payment: p, accepted })),
  ),
  "each presented payment under every option the files hold and under its own option changed",
  { exact: PRESENTED },
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
  /** Under an option `read` offers: the pairing's `reference`, when it has one and gives read keys under the payment's own option. */
  reference?: unknown;
  advertised: unknown;
}
const answers: Answer[] = [];

describe("each x402 pairing's bound holds accepted to the filter its read applies", () => {
  beforeAll(async () => {
    const own = new Map<PaymentPayload, Map<string, unknown>>();
    const ownReference = new Map<PaymentPayload, Map<string, unknown>>();
    for (const [, p] of PAYMENTS) {
      const answered = new Map<string, unknown>();
      const keys = new Map<string, unknown>();
      for (const b of X402) answered.set(b.id, await b.bound(p));
      for (const b of X402) if (b.reference !== undefined) keys.set(b.id, await b.reference(p));
      own.set(p, answered);
      ownReference.set(p, keys);
    }
    const offered = new Map<string, Set<string>>();
    for (const { where, what, payment, accepted } of PRESENTATIONS) {
      const key = JSON.stringify(accepted);
      if (!offered.has(key)) offered.set(key, new Set(X402.filter((b) => !isRefusal(b.read(docOf(accepted)))).map((b) => b.id)));
      for (const pairing of X402) {
        const isOffered = offered.get(key)!.has(pairing.id);
        const doc: PaymentRequired = { x402Version: 2, resource: { url: "https://pairing.invalid/" }, accepts: [accepted] };
        const keys = ownReference.get(payment)!.get(pairing.id);
        const keyed = isOffered && pairing.reference !== undefined && keys !== undefined && !isRefusal(keys);
        answers.push({
          pairing,
          where,
          what,
          offered: isOffered,
          bound: await pairing.bound({ ...payment, accepted }),
          own: own.get(payment)!.get(pairing.id),
          ...(keyed ? { reference: await pairing.reference!({ ...payment, accepted }) } : {}),
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
    const differ = answers.filter((a) => !a.offered && (!isRefusal(a.bound) || JSON.stringify(a.bound) !== JSON.stringify(a.advertised)));
    expect(differ.map((a) => [a.pairing.id, a.where, a.what, a.bound, a.advertised])).toEqual([]);
    rowsOf(answers, "every pairing's answer to every presentation", {
      exact: NOT_OFFERED,
      keep: ["the options the pairing's read does not offer", (a) => !a.offered],
      leave: ["the options the pairing's read offers", (a) => a.offered],
    });
  }, 0);

  it("under every option its read offers, a pairing that binds the payment gives the same H and read keys, or a refusal comparing what the payer signed with the option", () => {
    const offered = answers.filter((a) => a.offered && !isRefusal(a.own));
    const seen = new Set<string>();
    const outside: string[] = [];
    const compared = (a: Answer, step: string, answer: unknown): void => {
      const code = (answer as { code: string }).code;
      if (code in (SIGNED_AGAINST_THE_OPTION[a.pairing.id] ?? {})) seen.add(`${a.pairing.id} ${code}`);
      else outside.push(`${a.pairing.id} ${step} ${code}`);
    };
    let bindings = 0;
    let keyed = 0;
    for (const a of offered) {
      if (!isRefusal(a.bound)) {
        if (a.bound !== a.own) outside.push(`${a.pairing.id} bound another H`);
        bindings++;
        if (a.reference === undefined) continue;
        if (isRefusal(a.reference)) compared(a, "reference", a.reference);
        else keyed++;
        continue;
      }
      compared(a, "bound", a.bound);
    }
    expect([...new Set(outside)].sort()).toEqual([]);
    rowsOf(offered, "every pairing's answer under an option its read offers, for a payment its bound binds under its own option", { exact: OFFERED_OWN_BINDS });
    expect([bindings, offered.length - bindings, keyed]).toEqual(OFFERED_COUNTS);
    const listed = Object.entries(SIGNED_AGAINST_THE_OPTION).flatMap(([id, codes]) => Object.keys(codes).map((c) => `${id} ${c}`));
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
  { exact: 141 },
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

// The auth-capture EVM scheme (specs/schemes/auth-capture/scheme_auth_capture_evm.md at x402-foundation/x402
// e95b06661e, "Payment identity"): absent `receiverAuthorizer` and `policy` read as the zero address; with both zero the
// payload's `salt` is the client's random 32 bytes and it carries no `saltNonce`; with either non-zero the payload adds
// `saltNonce` and `salt` is its commitment to both. A payment made for a binding option, presented under that option
// with no receiver authorizer, is one `read` offers; `bound` and `reference` refuse it rather than give its salt, which
// is not the H the payer signed.
describe("auth-capture: a bound payment under its option with the receiver authorizer removed", () => {
  it.each([
    ["x402-auth-capture-eip155-eip3009.json", "x402/auth-capture/eip155/eip3009"],
    ["x402-auth-capture-eip155-permit2.json", "x402/auth-capture/eip155/permit2"],
  ])("%s unboundSaltNonce", async (file, id) => {
    const v = vector(file) as { unboundSaltNonce: { payment: string; accepted: PaymentRequirements; expect: string } };
    const row = v.unboundSaltNonce;
    const payment = at(v, row.payment) as PaymentPayload;
    const pairing = X402.find((b) => b.id === id)!;
    expect(typeof (await pairing.bound(payment))).toBe("string");
    expect(isRefusal(pairing.read(docOf(row.accepted)))).toBe(false);
    expect(await pairing.bound({ ...payment, accepted: row.accepted })).toEqual({ refused: true, code: row.expect });
    expect(await pairing.reference!({ ...payment, accepted: row.accepted })).toEqual({ refused: true, code: row.expect });
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
