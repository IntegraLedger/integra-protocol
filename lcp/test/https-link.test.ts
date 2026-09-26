// The one https-link rule, from vectors/core-vectors.json `links` (RFC 3986 §3.1 and §3.2, RFC 1123 labels), run on
// the core function and on each entry point's link check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { place as placeA2a, read as readA2a } from "../src/a2a.js";
import { visaTap } from "../src/card.js";
import { fromLegalContext, isHashWithNonHttpsLink, isHttpsLink, toLegalContext } from "../src/core.js";
import { parse as parseDiscovery } from "../src/discovery.js";
import { place, read as readMpp } from "../src/mpp.js";
import { exactEip3009, legalContextOf, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import { C_E } from "./mpp-fixtures.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const rows = load("core-vectors.json").links.rows as {
  name: string;
  case: string;
  link: string;
  accept: boolean;
  refusedAs: "accepted" | "link-not-https" | "legal-context-malformed";
}[];
const X = load("x402-exact-eip155-eip3009.json").fixed as {
  H: `0x${string}`;
  O: PaymentRequirements;
  resource: PaymentRequired["resource"];
  link: string;
};
const C = load("card.json").C1.advertise as { offer: never };
const A2A = load("a2a-legal-context.json");
const H = X.H;
const refused = (code: string) => ({ refused: true, code });

describe("core links rows: isHttpsLink", () => {
  it("has the seven cases the rule names, and more", () => {
    const cases = rows.map((r) => r.case);
    for (const c of ["a space inside the path", "a tab inside the host", "a backslash after the host", "an upper-case scheme",
      "a numeric IPv4 host", "userinfo before the host", "no host: the authority is empty"]) {
      expect(cases).toContain(c);
    }
  });
  for (const r of rows) {
    it(`${r.name}: ${r.case} → ${r.accept ? "accepted" : "refused"}`, () => {
      expect(isHttpsLink(r.link)).toBe(r.accept);
    });
  }
  it("a non-string is refused", () => {
    expect(isHttpsLink(undefined)).toBe(false);
    expect(isHttpsLink(42)).toBe(false);
  });
});

describe("an https link over 2048 characters", () => {
  const long = `https://atr.seller.example/${"a".repeat(2049 - "https://atr.seller.example/".length)}`;
  it("is legal-context-malformed at A2A's place and read", () => {
    expect(long.length).toBe(2049);
    expect(placeA2a(A2A.A2.task, A2A.fixed.H, long)).toEqual(refused("a2a/legal-context-malformed"));
    const placed = JSON.parse(JSON.stringify(A2A.A2.expectPlaced).replaceAll(A2A.fixed.L, long));
    expect(readA2a(placed)).toEqual(refused("a2a/legal-context-malformed"));
  });
});

describe("every entry point's link check is the core rule", () => {
  for (const r of rows) {
    it(`${r.name}: the structured form, x402, MPP, card, A2A and discovery agree`, () => {
      const lc = { legalContext: { type: "sha256", value: H, legalContextUrl: r.link } };
      expect(fromLegalContext(lc) !== null).toBe(r.accept);
      if (r.accept) expect(toLegalContext(H, r.link).legalContext.legalContextUrl).toBe(r.link);
      else expect(() => toLegalContext(H, r.link)).toThrow(TypeError);

      const doc: PaymentRequired = { x402Version: 2, resource: X.resource, accepts: [X.O] };
      const x = exactEip3009.advertise(doc, H, r.link, X.O);
      if (r.accept) expect("refused" in x).toBe(false);
      else expect(x).toEqual(refused(`x402/${r.refusedAs}`));
      const xa = exactEip3009.advertise(doc, H, X.link, X.O, r.link);
      if (r.refusedAs === "accepted") expect("refused" in xa).toBe(false);
      else expect(xa).toEqual(refused(`x402/${r.refusedAs}`));
      const xr = legalContextOf({ legalContext: { info: { type: "sha256", value: H, legalContextUrl: r.link } } });
      if (r.accept) expect(xr).toEqual({ h: H, link: r.link });
      else expect(xr).toEqual(refused(`x402/${r.refusedAs}`));
      expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legal_context_url: r.link })).toBe(
        r.refusedAs === "link-not-https",
      );

      const m = place([C_E], H, r.link, C_E);
      if (r.accept) expect(Array.isArray(m)).toBe(true);
      else expect(m).toEqual(refused(`mpp/${r.refusedAs}`));

      const k = visaTap.advertise({}, H, r.link, C.offer);
      if (r.accept) expect("refused" in k).toBe(false);
      else expect(k).toEqual(refused(`card/${r.refusedAs}`));

      const a = placeA2a(A2A.A2.task, A2A.fixed.H, r.link);
      if (r.accept) expect("refused" in a).toBe(false);
      else expect(a).toEqual(refused(`a2a/${r.refusedAs}`));
      const placedA2a = JSON.parse(JSON.stringify(A2A.A2.expectPlaced).replaceAll(A2A.fixed.L, JSON.stringify(r.link).slice(1, -1)));
      const ar = readA2a(placedA2a);
      if (r.accept) expect(ar).toEqual({ h: A2A.fixed.H, link: r.link });
      else expect(ar).toEqual(refused(`a2a/${r.refusedAs}`));

      const d = parseDiscovery(new TextEncoder().encode(JSON.stringify({ terms: r.link })));
      if (r.accept) expect("refused" in d).toBe(false);
      else expect(d).toEqual(refused("discovery/terms-not-https"));
    });
  }
});
