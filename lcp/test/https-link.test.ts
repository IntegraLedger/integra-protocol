// The one https-link rule, from vectors/core-vectors.json `links` (RFC 3986 §3.1 and §3.2, RFC 1123 labels), run on
// the core function and on each entry point's link check.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { place as placeA2a, read as readA2a } from "../src/a2a.js";
import { visaTap } from "../src/card.js";
import { fromLegalContext, isHashWithNonHttpsLink, isHttpsLink, toLegalContext } from "../src/internal/core.js";
import { parse as parseDiscovery } from "../src/discovery.js";
import { place, read as readMpp } from "../src/mpp.js";
import { exactEip3009, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import { legalContextOf } from "../src/internal/x402.js";
import { C_E } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const rows = rowsOf(load("core-vectors.json").links.rows, "core-vectors.json links.rows", { exact: 32 }) as {
  name: string;
  case: string;
  link: string;
  accept: boolean;
  refusedAs: "accepted" | "link-not-https" | "legal-context-malformed";
  placedAs: "accepted" | "link-not-https";
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

describe("a link whose authority is longer than any the rule accepts", () => {
  // RFC 1035 §2.3.4 bounds a domain name to 255 octets, 253 characters in text; RFC 1123 §2.1 bounds a label to 63.
  const n253 = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  const n254 = `${n253}d`;
  it("answers at the longest name, with its final dot and a port, and at the longest IPv6 literal", () => {
    expect(n253.length).toBe(253);
    const links = [
      `https://${n253}/`,
      `https://${n253}./`,
      `https://${n253}.:65535/`,
      `https://${n254}/`,
      `https://${n254}.:1/`,
    ];
    expect(links.map((l) => isHttpsLink(l))).toEqual([true, true, true, false, false]);
    expect(isHttpsLink("https://[ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255]:65535/")).toBe(true);
  });
  it("is refused as a value, however long, at the core rule and at a placement", () => {
    // Ten million characters of short labels, the last one "-", which no DNS label ends with. The test has no time
    // bound (0): the rule reads the link in one pass, and how long that takes depends only on the machine.
    const long = `https://${"ab-c.".repeat(2_000_000)}-/p`;
    expect(isHttpsLink(long)).toBe(false);
    expect(placeA2a(A2A.A2.task, A2A.fixed.H, long)).toEqual(refused("a2a/link-not-https"));
  }, 0);
});

describe("a link that is not a string", () => {
  it("is link-not-https at each placement, as the link or as the agreement URL (core links rows, placedAs)", () => {
    const doc: PaymentRequired = { x402Version: 2, resource: X.resource, accepts: [X.O] };
    for (const v of [42, null, {}] as never[]) {
      expect(exactEip3009.advertise(doc, H, v, X.O)).toEqual(refused("x402/link-not-https"));
      expect(exactEip3009.advertise(doc, H, X.link, X.O, v)).toEqual(refused("x402/link-not-https"));
      expect(place([C_E], H, v, C_E)).toEqual(refused("mpp/link-not-https"));
      expect(visaTap.advertise({}, H, v, C.offer)).toEqual(refused("card/link-not-https"));
      expect(placeA2a(A2A.A2.task, A2A.fixed.H, v)).toEqual(refused("a2a/link-not-https"));
    }
  });
});

// A placement refuses every link the rule refuses as `<ns>/link-not-https` (`placedAs`), since the link MUST be
// `https://` (LCP §8.1); a reading refuses as `refusedAs` says.
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
      else expect(x).toEqual(refused(`x402/${r.placedAs}`));
      const xa = exactEip3009.advertise(doc, H, X.link, X.O, r.link);
      if (r.placedAs === "accepted") expect("refused" in xa).toBe(false);
      else expect(xa).toEqual(refused(`x402/${r.placedAs}`));
      const xr = legalContextOf({ legalContext: { info: { type: "sha256", value: H, legalContextUrl: r.link } } });
      if (r.accept) expect(xr).toEqual({ h: H, link: r.link });
      else expect(xr).toEqual(refused(`x402/${r.refusedAs}`));
      expect(isHashWithNonHttpsLink({ type: "sha256", value: H, legal_context_url: r.link })).toBe(
        r.refusedAs === "link-not-https",
      );

      const m = place([C_E], H, r.link, C_E);
      if (r.accept) expect(Array.isArray(m)).toBe(true);
      else expect(m).toEqual(refused(`mpp/${r.placedAs}`));

      const k = visaTap.advertise({}, H, r.link, C.offer);
      if (r.accept) expect("refused" in k).toBe(false);
      else expect(k).toEqual(refused(`card/${r.placedAs}`));

      const a = placeA2a(A2A.A2.task, A2A.fixed.H, r.link);
      if (r.accept) expect("refused" in a).toBe(false);
      else expect(a).toEqual(refused(`a2a/${r.placedAs}`));
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
