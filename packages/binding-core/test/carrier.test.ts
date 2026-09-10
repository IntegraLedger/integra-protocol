import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CarrierError, type CarrierOp, carrierOp } from "../src/carrier.js";

type Case = {
  name: string;
  input: CarrierOp;
  expected?: unknown;
  error?: string;
};
const load = (f: string): Case[] =>
  (
    JSON.parse(
      readFileSync(
        new URL(`../../../vectors/carrier/${f}`, import.meta.url),
        "utf8",
      ),
    ) as { cases: Case[] }
  ).cases;

for (const file of [
  "string-parse.json",
  "type-registry.json",
  "round-trip.json",
]) {
  describe(`carrier: ${file}`, () => {
    const cases = load(file);
    const ok = cases.filter((c) => c.error === undefined);
    const bad = cases.filter((c) => c.error !== undefined);

    it.each(ok)("$name", ({ input, expected }) => {
      expect(carrierOp(input)).toEqual(expected);
    });
    it.each(bad)("$name rejects with $error", ({ input, error }) => {
      let thrown: unknown;
      try {
        carrierOp(input);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(CarrierError);
      expect((thrown as CarrierError).code).toBe(error);
    });
  });
}

/**
 * ⛔⛔ **A `url` REFERENCE ACCEPTED `javascript:` AND `file:`.**
 *
 * The only rule on a `url` value was non-empty, so `lcp:url:javascript:alert(1)` and
 * `lcp:url:file:///etc/passwd` decoded to well-formed references and travelled on as the located terms of
 * a transaction. Meanwhile the kit's own terms-URL slot has been scheme-gated all along, for a reason that
 * applies here word for word — "a locator a buyer must not follow … is worse than none". The two halves of
 * one document carried the same kind of value under two different rules, and the ungated half was the
 * REFERENCE: the one a record cites.
 *
 * ⭐ Package-local rather than a corpus vector: these cases pin this implementation's line, and the
 * conformance corpus is another owner's to extend.
 */
describe("a url carrier must be a retrievable web location", () => {
  const urlRef = (value: string) => ({ type: "url" as const, value });

  it.each([
    ["javascript:", "javascript:alert(document.cookie)"],
    ["file:", "file:///etc/passwd"],
    ["data:", "data:text/html;base64,PHNjcmlwdD4="],
    ["a bare path", "/terms/v3.md"],
    ["a scheme-relative url", "//seller.example/terms"],
    ["a host with no scheme", "seller.example/terms"],
  ])("⛔ REFUSES %s on decode", (_why, value) => {
    let thrown: unknown;
    try {
      carrierOp({ op: "decodeString", arg: `lcp:url:${value}` });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CarrierError);
    expect((thrown as CarrierError).code).toBe("carrier/bad-url");
  });

  it("the refusal NAMES the offending value — 'bad-url' alone tells an operator nothing", () => {
    // Same reason `placement-ucp` pins its own https message: a document may carry several references,
    // and a code with no value in it cannot say which one tripped.
    let thrown: unknown;
    try {
      carrierOp({ op: "decodeString", arg: "lcp:url:javascript:alert(1)" });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as CarrierError).message).toContain("javascript:alert(1)");
  });

  it("⛔ and on ENCODE, so this codec cannot mint what it will not read", () => {
    // Refusing on decode alone would make the round trip fail on bytes we wrote ourselves — the exact
    // asymmetry `placement-ucp` had to correct in its own https rule.
    expect(() =>
      carrierOp({ op: "encodeString", arg: urlRef("javascript:alert(1)") }),
    ).toThrow(CarrierError);
    expect(() =>
      carrierOp({ op: "encodeJson", arg: urlRef("file:///etc/passwd") }),
    ).toThrow(CarrierError);
  });

  it("⛔ and through the JSON carrier, which is a different door to the same check", () => {
    let thrown: unknown;
    try {
      carrierOp({
        op: "decodeJson",
        arg: { legalContext: urlRef("javascript:alert(1)") },
      });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as CarrierError).code).toBe("carrier/bad-url");
  });

  it("⭐ https and http still pass — the rule is about being a locator at all", () => {
    // `http:` is a real locator whose weakness is a matter of degree, and it is ruled on one layer up:
    // `placement-ucp` refuses it as its own protocol semantics and `placement-ack` records the decision
    // not to make that kit-wide. This codec does not relitigate it.
    expect(
      carrierOp({ op: "decodeString", arg: "lcp:url:https://s.example/t" }),
    ).toEqual({ type: "url", value: "https://s.example/t" });
    expect(
      carrierOp({ op: "decodeString", arg: "lcp:url:http://s.example/t" }),
    ).toEqual({ type: "url", value: "http://s.example/t" });
  });

  it("⭐ the SCHEME is matched case-insensitively, and the rest of the URL is untouched", () => {
    // A scheme is case-insensitive per RFC 3986; a path and query are not, and folding them would name a
    // different document — which is why `emitValue` scopes its lowercasing to `sha256`.
    expect(
      carrierOp({
        op: "decodeString",
        arg: "lcp:url:HTTPS://Seller.Example/Terms?Ref=AbC",
      }),
    ).toEqual({ type: "url", value: "HTTPS://Seller.Example/Terms?Ref=AbC" });
  });

  it("⛔ a scheme that merely CONTAINS https is not a match", () => {
    // The check is a prefix, so `x-https://` must not slip through on a substring.
    let thrown: unknown;
    try {
      carrierOp({ op: "decodeString", arg: "lcp:url:x-https://s.example/t" });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as CarrierError).code).toBe("carrier/bad-url");
  });

  it("an EMPTY url is still empty-value, not bad-url — the first fault named is the first one", () => {
    let thrown: unknown;
    try {
      carrierOp({ op: "decodeJson", arg: { legalContext: urlRef("") } });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as CarrierError).code).toBe("carrier/empty-value");
  });

  it("⭐ and ipfs / ar values are untouched — they are not web locators and have their own types", () => {
    expect(
      carrierOp({
        op: "decodeString",
        arg: "lcp:ipfs:QmYwAPJzv5CZsnAztbCQ1vYUuNoLFTnVQ4kWmZpqL8X2cD",
      }),
    ).toEqual({
      type: "ipfs",
      value: "QmYwAPJzv5CZsnAztbCQ1vYUuNoLFTnVQ4kWmZpqL8X2cD",
    });
  });
});
