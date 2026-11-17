// x402-headers.json: x402's three HTTP headers, decoded and encoded as the specification's examples and its stock
// clients write them, an extension lcp does not declare carried verbatim beside the legalContext extension it
// composes, and the values no stock client writes refused. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PAYMENT_REQUIRED,
  PAYMENT_RESPONSE,
  PAYMENT_SIGNATURE,
  decodePaymentRequired,
  decodePaymentResponse,
  decodePaymentSignature,
  encodeHeader,
  exactEip3009,
  type PaymentRequired,
} from "../src/x402.js";
import { isRefusal } from "../src/index.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-headers.json", import.meta.url), "utf8"));
const DECODE: { [kind: string]: (v: unknown) => unknown } = {
  required: decodePaymentRequired,
  signature: decodePaymentSignature,
  response: decodePaymentResponse,
};
const HEADER: { [kind: string]: string } = { required: PAYMENT_REQUIRED, signature: PAYMENT_SIGNATURE, response: PAYMENT_RESPONSE };

describe("x402-headers.json", () => {
  for (const row of rowsOf(V.spec, "x402-headers.json spec", { exact: 4 })) {
    it(`${row.case}: decodes to the specification's object, and encodes back byte for byte`, () => {
      expect(HEADER[row.kind]).toBe(row.header);
      const decoded = DECODE[row.kind]!(row.value);
      expect(decoded).toEqual(row.decoded);
      expect(encodeHeader(decoded as PaymentRequired)).toBe(row.value);
    });
  }

  for (const row of rowsOf(V.stock, "x402-headers.json stock", { exact: 2 })) {
    it(`${row.case}: decodes to the specification's object`, () => {
      expect(DECODE[row.kind]!(row.value)).toEqual(row.decoded);
    });
  }

  it(V.composed.case, () => {
    const c = V.composed;
    const advertised = exactEip3009.advertise(c.required, c.h, c.link, c.required.accepts[0]);
    expect(advertised).toEqual(c.expectAdvertised);
    if (isRefusal(advertised)) return;
    const header = encodeHeader(advertised);
    expect(header).toBe(c.expectHeader);
    expect(decodePaymentRequired(header)).toEqual(c.expectAdvertised);
  });

  for (const row of rowsOf(V.refusals, "x402-headers.json refusals", { exact: 16 })) {
    it(`refuses ${row.case}`, () => {
      expect(DECODE[row.kind]!(row.value)).toEqual(row.expect);
    });
  }

  it("encodeHeader refuses a value that is not a JSON object", () => {
    for (const v of [null, [], "x", { n: 1n }, { f: () => 1 }]) {
      expect(encodeHeader(v as never)).toEqual({ refused: true, code: "x402/header-malformed" });
    }
  });
});
