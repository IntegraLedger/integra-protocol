// Runs ucp.json through the ucp entry point. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assemble } from "../src/core.js";
import { disclosureDigest } from "../src/sd-jwt.js";
import {
  ap2Mandate,
  bookingAp2Mandate,
  bookingUnsigned,
  issuedDigest,
  legalContextLink,
  tie,
  unsigned,
  type Checkout,
} from "../src/ucp.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const V = load("ucp.json");
const AP2 = load("ap2-checkout-mandate.json");
const F = V.fixed;
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sha256b64u = (s: string) => createHash("sha256").update(Buffer.from(s, "ascii")).digest("base64url");

// J from V2's checkout, then D and M, built from the fixed strings.
const J = `${b64u(F.jwtHeader)}.${b64u(JSON.stringify(V.V2.expectCheckout))}.${F.signature}`;
const D = b64u(F.disclosureTemplate.replace("<J>", J));
const M = `${b64u(F.mandateHeader)}.${b64u(F.mandatePayload)}.${F.signature}~${D}~`;
const PAIRINGS = { ap2Mandate, unsigned, bookingAp2Mandate, bookingUnsigned } as const;
const byId = Object.fromEntries(Object.values(PAIRINGS).map((p) => [p.id, p]));

describe("ucp.json", () => {
  it("builds the same J, D and M as the file", () => {
    expect(J).toBe(V.built.J);
    expect(D).toBe(V.built.D);
    expect(M).toBe(V.built.M);
    expect(J.length).toBe(V.V2.expectJLength);
  });

  it("V1: the slot", async () => {
    const slot = tie(V.V1.options);
    expect(slot[0]).toBe(V.V1.expectSlotName);
    expect(JSON.stringify(slot[1])).toBe(V.V1.expectSlotBytes);
    const A: string = F.A;
    const parsed = JSON.parse(A);
    const enc = new TextEncoder();
    const r = await assemble(parsed.id, slot, [
      ["line_items", enc.encode(JSON.stringify(parsed.line_items))],
      ["totals", enc.encode(JSON.stringify(parsed.totals))],
    ]);
    if ("refused" in r) throw new Error(r.code);
    expect(new TextDecoder().decode(r.bytes)).toBe(A);
    expect(r.atrHash).toBe(F.H);
    expect(A).not.toContain("links");
    expect(A).not.toContain("legal_context");
    expect(A).not.toContain(F.H.slice(2));
  });

  it("V2: advertise and read", () => {
    const a = V.V2.advertise;
    for (const p of [ap2Mandate, unsigned]) {
      expect(p.advertise(a.doc, a.h, a.link, a.offer)).toEqual(V.V2.expectCheckout);
    }
    const doc = unsigned.advertise(a.doc, a.h, a.link, a.offer) as Checkout;
    const r = unsigned.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link }).toEqual(V.V2.expectRead);
    expect(ap2Mandate.read(doc)).toEqual(V.V2.expectAp2Read);
    const signed = { ...doc, ap2: { merchant_authorization: F.merchantAuthorization } } as Checkout;
    const s = ap2Mandate.read(signed);
    if ("refused" in s) throw new Error(s.code);
    expect({ h: s.h, link: s.link }).toEqual(V.V2.expectRead);
    for (const p of [ap2Mandate, unsigned]) {
      expect(p.advertise(signed, a.h, a.link, a.offer)).toEqual(V.V2.expectAlreadySigned);
      expect(p.advertise(doc, V.V2.otherH, a.link, a.offer)).toEqual(V.V2.expectConflict);
    }
  });

  it("V2b: booking advertise and read", () => {
    const a = V.V2b.advertise;
    for (const p of [bookingAp2Mandate, bookingUnsigned]) {
      expect(p.advertise(V.V2b.B0, a.h, a.link, a.offer)).toEqual(V.V2b.expectBooking);
      expect(p.advertise(V.V2b.B0, a.h, a.link, V.V2b.otherBooking.offer)).toEqual(V.V2b.otherBooking.expect);
    }
    const r = bookingUnsigned.read(bookingUnsigned.advertise(V.V2b.B0, a.h, a.link, a.offer) as Checkout);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link }).toEqual(V.V2b.expectRead);
  });

  it("V3 and V3b: option digests", async () => {
    expect(await issuedDigest(V.V3.option)).toBe(V.V3.expectIssuedDigest);
    expect(await issuedDigest(V.V3b.option)).toBe(V.V3b.expectIssuedDigest);
  });

  it("V4: bound, seller side", async () => {
    expect(sha256b64u(J)).toBe(V.V4.expectCheckoutHash);
    expect(await disclosureDigest(D)).toBe(V.V4.expectDisclosureDigest);
    const presented = { checkout_mandate: M, checkout_jwt: J };
    expect(await ap2Mandate.bound(presented)).toBe(V.V4.expectBound);
    expect(await bookingAp2Mandate.bound(presented)).toBe(V.V4.expectBound);
    expect(bookingAp2Mandate.bound).toBe(ap2Mandate.bound);
    expect(await unsigned.bound(presented)).toEqual(V.V4.expectUnsignedBound);
    const signed = { ...V.V2.expectCheckout, ap2: { merchant_authorization: F.merchantAuthorization } };
    expect(await unsigned.build({ checkout: signed }, F.H)).toEqual(V.V4.expectUnsignedBuild);
  });

  it("V4: build and complete, buyer side", async () => {
    const signed = { ...V.V2.expectCheckout, ap2: { merchant_authorization: F.merchantAuthorization } } as Checkout;
    const r = ap2Mandate.read(signed);
    if ("refused" in r) throw new Error(r.code);
    const u = await ap2Mandate.build(r.offer, F.H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.checkout).toBe(signed);
    const p = await u.complete(M);
    expect(p).toEqual({ checkout_mandate: M, checkout_jwt: J });
    expect(await ap2Mandate.bound(p as never)).toBe(V.V4.expectBound);
  });

  it("V5: AP2's published example as a UCP checkout", async () => {
    const token: string = AP2.V6.token;
    const jwt: string = AP2.V6.checkoutJwt;
    expect(sha256b64u(jwt)).toBe(V.V5.expectCheckoutHash);
    expect(await ap2Mandate.bound({ checkout_mandate: token, checkout_jwt: jwt })).toEqual(V.V5.expectBound);
  });

  it("V6: names", () => {
    for (const doc of [V.V6.policies, V.V6.presentation]) {
      expect(legalContextLink(doc)).toEqual(V.V6.expect);
      expect(unsigned.read(doc)).toEqual(V.V6.expect);
    }
  });

  it("plant: a caller's re-issued checkout is not the one the mandate commits to", async () => {
    const A2: string = V.plant.A2;
    expect(`0x${createHash("sha256").update(A2).digest("hex")}`).toBe(V.plant.H2);
    const J2: string = V.plant.checkoutJwt;
    expect(sha256b64u(J2)).toBe(V.plant.expectJ2Hash);
    const withoutDisclosure = M.slice(0, M.indexOf("~") + 1);
    for (const mandate of [M, withoutDisclosure]) {
      const r = await ap2Mandate.bound({ checkout_mandate: mandate, checkout_jwt: J2 });
      expect(r).toEqual(V.plant.expect);
      expect(r).not.toBe(V.plant.H2);
    }
  });

  describe("implementation rows", () => {
    for (const row of V.implementation) {
      it(`${row.name}: ${row.case}`, async () => {
        const p = byId[row.pairing]!;
        const i = row.input;
        switch (row.fn) {
          case "advertise":
            expect(p.advertise(i.doc, i.h, i.link, i.offer)).toEqual(row.expect);
            break;
          case "read": {
            const r = p.read(i.doc);
            expect("refused" in r ? r : { h: r.h, link: r.link }).toEqual(row.expect);
            break;
          }
          case "build":
            expect(await p.build({ checkout: i.checkout }, i.h)).toEqual(row.expect);
            break;
          default:
            throw new Error(`unknown fn ${row.fn}`);
        }
      });
    }
  });

  it("pairing members", () => {
    const common = { canonical: true, profile: "ucp/checkout/legal-context", onChain: false, zeroPartyRecoverable: false,
      forwardIndexable: false, publicProof: false };
    for (const p of [ap2Mandate, bookingAp2Mandate]) {
      expect(p.claims).toBe(true);
      expect(p.pattern).toMatchObject({ ...common, pattern: "opaque-challenge", buyerSigns: true });
    }
    for (const p of [unsigned, bookingUnsigned]) {
      expect(p.claims).toBe(false);
      expect(p.pattern).toMatchObject({ ...common, pattern: "http-advisory", buyerSigns: false });
    }
    expect(Object.values(PAIRINGS).map((p) => p.id)).toEqual([
      "ucp/checkout/ap2-mandate",
      "ucp/checkout/unsigned",
      "ucp/booking/ap2-mandate",
      "ucp/booking/unsigned",
    ]);
    for (const p of Object.values(PAIRINGS)) {
      expect(p.pattern).toEqual(V.pattern[p.id]);
      const o = { checkout: "chk_1" };
      expect((p.unplaced as (x: unknown) => unknown)(o)).toBe(o);
      expect("status" in p).toBe(false);
    }
  });
});
