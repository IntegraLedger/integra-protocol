// The one JSON nesting cap: vectors/core-vectors.json `jsonDepth` (64 levels), run on the core reader, on the entry
// points that read JSON text, and on those that measure a JSON value they are given. At 64 each reads on; at 65 each
// refuses: a reader of text with its own code for JSON it cannot read, a measure with its own code for too large.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { read as readA2a, A2A_EXTENSION_URIS } from "../src/a2a.js";
import { fromReceipt, paymentRequest } from "../src/ack.js";
import { delegated } from "../src/acp.js";
import { checkoutMandate } from "../src/ap2.js";
import { viImmediate } from "../src/card.js";
import { jsonWithinDepth, MAX_JSON_DEPTH, parseJson } from "../src/core.js";
import { parse as parseDiscovery } from "../src/discovery.js";
import { atrNamesInvoice } from "../src/lightning.js";
import { usdcRequestHash } from "../src/mpp-usdc.js";
import { unsigned } from "../src/ucp.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const D = load("core-vectors.json").jsonDepth as { max: number; rows: { name: string; case: string; text: string; accept: boolean }[] };
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const nest = (n: number, inner: string) => "[".repeat(n) + inner + "]".repeat(n);
const refused = (code: string) => ({ refused: true, code });
const H = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const L = `https://atr.seller.example/${H}`;
const jws = (payload: string) => `${b64u('{"alg":"ES256"}')}.${b64u(payload)}.${"A".repeat(86)}`;

describe("the cap is one constant, 64", () => {
  it("MAX_JSON_DEPTH is the vectors' max", () => {
    expect(MAX_JSON_DEPTH).toBe(64);
    expect(D.max).toBe(MAX_JSON_DEPTH);
  });
  for (const r of D.rows) {
    it(`${r.name}: ${r.case} → ${r.accept ? "read" : "refused"}`, () => {
      expect(jsonWithinDepth(r.text)).toBe(r.accept);
      if (r.accept) expect(parseJson(r.text)).toEqual(JSON.parse(r.text));
      else expect(parseJson(r.text)).toBeUndefined();
    });
  }
  it("text that is not JSON is undefined", () => {
    expect(parseJson("[1,")).toBeUndefined();
  });
});

describe("each entry point that reads JSON text reads 64 levels and refuses 65", () => {
  it("discovery: a document member nested to 64 levels is read; 65 is discovery/not-json-object", () => {
    const doc = (n: number) => new TextEncoder().encode(`{"terms":"https://seller.example/t.md","x-deep":${nest(n - 1, "")}}`);
    expect("refused" in parseDiscovery(doc(64))).toBe(false);
    expect(parseDiscovery(doc(65))).toEqual(refused("discovery/not-json-object"));
  });

  it("usdc requestHash: a JCS request nested to 64 levels hashes; 65 is mpp/request-malformed", async () => {
    const request = (n: number) => `{"a":${nest(n - 1, "")}}`;
    expect(await usdcRequestHash(b64u(request(64)))).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await usdcRequestHash(b64u(request(65)))).toEqual(refused("mpp/request-malformed"));
  });

  it("the ATR's named invoice: an ATR nested to 64 levels is read; 65 is not", () => {
    const atr = (n: number) =>
      new TextEncoder().encode(
        `{"atrVersion":"1","id":"1b4e28ba-2fa1-41d2-883f-0016d3cca427","x402":{"accepts":[{"extra":{"invoice":"lnbc1"}}]},"seller":${nest(n - 1, "")}}`,
      );
    expect(atrNamesInvoice(atr(64), "lnbc1")).toBe(true);
    expect(atrNamesInvoice(atr(65), "lnbc1")).toBe(false);
  });

  it("ACK: a token payload nested to 64 levels is read; 65 is ack/token-malformed", () => {
    const body = (n: number) => ({
      paymentRequestToken: jws(`{"id":"lcp:sha256:${H}","paymentOptions":[],"x":${nest(n - 1, "")}}`),
      legalContext: { type: "sha256", value: H, legalContextUrl: L },
    });
    expect(paymentRequest.read(body(64) as never)).toEqual({ h: H, link: L, offer: { options: [] } });
    expect(paymentRequest.read(body(65) as never)).toEqual(refused("ack/token-malformed"));
  });

  it("card checkout JWT: a payload nested to 64 levels is read; 65 is card/too-large", () => {
    const token = (n: number) => jws(`{"legalContext":{"type":"sha256","value":"${H}","legalContextUrl":"${L}"},"x":${nest(n - 1, "")}}`);
    expect(viImmediate.read(token(64) as never)).toEqual({ h: H, link: L });
    expect(viImmediate.read(token(65) as never)).toEqual(refused("card/too-large"));
  });
});

// A value given in code is measured as JSON.stringify writes it. Objects with numeric member names, as JSON.parse
// builds them, are what V8 writes by recursion, so past some depth the host's stack, not a rule, would answer. Each
// entry point counts the levels as it writes, and stops at the 65th.
describe("each entry point that measures a JSON value measures 64 levels and refuses 65 as too large", () => {
  const value = (n: number) => JSON.parse('{"1":'.repeat(n - 1) + "[]" + "}".repeat(n - 1));
  const token = jws(`{"id":"lcp:sha256:${H}","paymentOptions":[]}`);
  const lc = { type: "sha256", value: H, legalContextUrl: L };
  const session = delegated.advertise({ currency: "usd" }, H, L, { requires_delegate_payment: true });
  const checkout = (x: unknown) => ({ id: "chk_1", links: [{ type: "legal_context", url: L, title: `lcp:sha256:${H}` }], x });
  // Each case puts the deep value one level inside what the entry point measures: n counts every level measured.
  const cases: [string, string, (x: unknown) => unknown][] = [
    ["acp read", "acp/too-large", (x) => delegated.read({ ...session, x } as never)],
    ["acp advertise", "acp/too-large", (x) => delegated.advertise({ currency: "usd", x } as never, H, L, { requires_delegate_payment: true })],
    ["ack read", "ack/too-large", (x) => paymentRequest.read({ paymentRequestToken: token, legalContext: lc, x } as never)],
    ["ack fromReceipt", "ack/too-large", (x) => fromReceipt({ paymentRequestToken: token, x })],
    ["ucp read", "ucp/too-large", (x) => unsigned.read(checkout(x) as never)],
    ["ucp advertise", "ucp/too-large", (x) => unsigned.advertise({ id: "chk_1", x } as never, H, L, { checkout: "chk_1" })],
    ["ap2 advertise", "ap2/too-large", (x) => checkoutMandate.advertise({ id: "chk_1", x } as never, H, L, { checkout: "chk_1" })],
    ["a2a read", "a2a/too-large", (x) => readA2a({ id: "t1", metadata: { [A2A_EXTENSION_URIS[0]!]: { ...lc, x } } } as never)],
  ];
  for (const [name, code, f] of cases) {
    it(`${name}: 64 levels are measured; 65, 1,000 and 100,000 are ${code}`, () => {
      const at64 = f(value(63));
      expect(at64).not.toEqual(refused(code));
      expect(typeof at64 === "object" && at64 !== null && "refused" in at64).toBe(false);
      for (const n of [65, 1000, 100_000]) expect(f(value(n - 1))).toEqual(refused(code));
    });
  }
});
