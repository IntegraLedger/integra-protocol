// The one JSON nesting cap: vectors/core-vectors.json `jsonDepth` (64 levels), run on the core reader and on the
// entry points that read JSON text. At 64 each reads on; at 65 each refuses with its own code for JSON it cannot read.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paymentRequest } from "../src/ack.js";
import { viImmediate } from "../src/card.js";
import { jsonWithinDepth, MAX_JSON_DEPTH, parseJson } from "../src/core.js";
import { parse as parseDiscovery } from "../src/discovery.js";
import { atrNamesInvoice } from "../src/lightning.js";
import { usdcRequestHash } from "../src/mpp-usdc.js";

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
