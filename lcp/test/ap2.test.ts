// Runs ap2-checkout-mandate.json through the ap2 entry point. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assemble } from "../src/core.js";
import {
  checkoutBinding,
  checkoutJwtOf,
  checkoutMandate,
  issuedDigest,
  jwsPayload,
  readMandate,
  tie,
  type Payload,
} from "../src/ap2.js";
import { disclosureDigest } from "../src/sd-jwt.js";

const V = JSON.parse(readFileSync(new URL("../vectors/ap2-checkout-mandate.json", import.meta.url), "utf8"));
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sha256b64u = (s: string) => createHash("sha256").update(Buffer.from(s, "ascii")).digest("base64url");
const F = V.fixed;

// J, D and M, built from the fixed strings.
const J = `${b64u(F.jwtHeader)}.${b64u(F.V2Payload)}.${F.signature}`;
const D = b64u(F.disclosureTemplate.replace("<J>", J));
const M = `${b64u(F.mandateHeader)}.${b64u(F.mandatePayload)}.${F.signature}~${D}~`;

describe("ap2-checkout-mandate.json", () => {
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
    expect(A).not.toContain("legalContext");
    expect(A).not.toContain("checkout_jwt");
    expect(A).not.toContain(F.H.slice(2));
  });

  it("V2: advertise and read", () => {
    const a = V.V2.advertise;
    const payload = checkoutMandate.advertise(a.payload, a.h, a.link, a.offer);
    expect(payload).toEqual(V.V2.expectPayload);
    expect(Object.keys(payload as Payload)).toEqual(Object.keys(V.V2.expectPayload));
    const r = checkoutMandate.read(J);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, checkout: r.offer.checkout }).toEqual(V.V2.expectRead);
    expect(r.offer.checkoutJwt).toBe(J);
    expect(checkoutMandate.advertise(a.payload, a.h, V.V2.httpLink.link, a.offer)).toEqual(V.V2.httpLink.expect);
    const other = checkoutMandate.advertise(a.payload, a.h, V.V2.conflict.otherLink, a.offer) as Payload;
    expect(checkoutMandate.advertise(other, a.h, a.link, a.offer)).toEqual(V.V2.conflict.expect);
    expect(checkoutMandate.advertise(a.payload, a.h, a.link, V.V2.otherCheckout.offer)).toEqual(
      V.V2.otherCheckout.expect,
    );
  });

  it("V3: option digest", async () => {
    expect(await issuedDigest(V.V3.option)).toBe(V.V3.expectIssuedDigest);
  });

  it("V4: build", async () => {
    const r = checkoutMandate.read(J);
    if ("refused" in r) throw new Error(r.code);
    const u = await checkoutMandate.build(r.offer, F.H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.content).toEqual({ vct: V.V4.expectVct, checkout_jwt: J, checkout_hash: V.V4.expectCheckoutHash });
    expect(u.complete(M)).toEqual({ checkout_mandate: M, checkout_jwt: J });
    expect(await checkoutMandate.build(r.offer, V.V4.otherHash)).toEqual(V.V4.otherHashExpect);
  });

  it("V5: bound, seller side", async () => {
    expect(await disclosureDigest(D)).toBe(V.V5.expectDisclosureDigest);
    expect(await checkoutMandate.bound({ checkout_mandate: M, checkout_jwt: J })).toBe(V.V5.expectBound);
    expect(await checkoutMandate.bound({ checkout_mandate: V.V5.withoutDisclosure.mandate, checkout_jwt: J })).toBe(
      V.V5.withoutDisclosure.expect,
    );
    const irob = `${b64u(F.mandateHeader)}.${b64u(F.mandatePayload)}.${F.signature}~${V.V5.saltIroB.disclosure}~`;
    expect(await checkoutMandate.bound({ checkout_mandate: irob, checkout_jwt: J })).toEqual(V.V5.saltIroB.expect);
  });

  it("V6: AP2's published example", async () => {
    const token: string = V.V6.token;
    expect(Buffer.byteLength(token)).toBe(V.V6.tokenBytes);
    expect(createHash("sha256").update(token).digest("hex")).toBe(V.V6.tokenSha256);
    const disclosures = token.split("~").slice(1, -1);
    expect(await Promise.all(disclosures.map(disclosureDigest))).toEqual(V.V6.expectDisclosureDigests);
    const m = await readMandate(token);
    if ("refused" in m) throw new Error(m.code);
    expect(m.checkout_hash).toBe(V.V6.expectCheckoutHash);
    expect(m.checkout_jwt).toBe(V.V6.checkoutJwt);
    expect(V.V6.checkoutJwt.length).toBe(V.V6.expectCheckoutJwtLength);
    expect(sha256b64u(V.V6.checkoutJwt)).toBe(V.V6.expectCheckoutHash);
    expect(await checkoutJwtOf(token)).toBe(V.V6.checkoutJwt);
    const b = await checkoutBinding({ checkout_mandate: token, checkout_jwt: V.V6.checkoutJwt });
    if ("refused" in b) throw new Error(b.code);
    expect(b.payload["id"]).toBe(V.V6.expectCheckoutId);
    expect(await checkoutMandate.bound({ checkout_mandate: token, checkout_jwt: V.V6.checkoutJwt })).toEqual(
      V.V6.expectBound,
    );
  });

  it("plant: a re-issued checkout is not the one the mandate commits to", async () => {
    const reissued = `${b64u(F.jwtHeader)}.${b64u(F.V2Payload.replace("19900", "39800"))}.${F.signature}`;
    expect(reissued).toBe(V.plant.checkoutJwt);
    for (const mandate of [M, V.V5.withoutDisclosure.mandate]) {
      const r = await checkoutMandate.bound({ checkout_mandate: mandate, checkout_jwt: reissued });
      expect(r).toEqual(V.plant.expect);
      expect(r).not.toBe(F.H);
    }
  });

  describe("implementation rows", () => {
    for (const row of V.implementation) {
      it(`${row.name}: ${row.case}`, async () => {
        const i = row.input;
        switch (row.fn) {
          case "read": {
            const r = checkoutMandate.read(i.doc);
            const got = "refused" in r ? r : { h: r.h, link: r.link, checkout: r.offer.checkout };
            expect(got).toEqual(row.expect);
            break;
          }
          case "advertise":
            expect(checkoutMandate.advertise(i.payload, i.h, i.link, i.offer)).toEqual(row.expect);
            break;
          case "bound":
            expect(await checkoutMandate.bound(i)).toEqual(row.expect);
            break;
          case "checkoutJwtOf":
            expect(await checkoutJwtOf(i.m)).toEqual(row.expect);
            break;
          default:
            throw new Error(`unknown fn ${row.fn}`);
        }
      });
    }
  });

  it("jwsPayload never throws on non-string or oversized input", () => {
    expect(jwsPayload(undefined as unknown as string)).toEqual({ refused: true, code: "ap2/jws-malformed" });
    expect(jwsPayload("a".repeat(1_048_577))).toEqual({ refused: true, code: "ap2/too-large" });
  });

  it("pairing members", () => {
    expect(checkoutMandate.id).toBe("ap2/checkout-mandate");
    expect(checkoutMandate.claims).toBe(true);
    const o = { checkout: "chk_2" };
    expect(checkoutMandate.unplaced(o)).toBe(o);
    expect(checkoutMandate.pattern).toMatchObject({
      pattern: "opaque-challenge",
      canonical: true,
      profile: "ap2/checkout-mandate",
      buyerSigns: true,
      onChain: false,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
      publicProof: false,
    });
    expect(checkoutMandate.pattern).toEqual(V.pattern.expect);
    expect("status" in checkoutMandate).toBe(false);
  });
});

// A well-formed legal context whose link is not https: the pairing's refusal codes list `link-not-https`, and `read` and
// `bound` give it for the same checkout JWT (RFC 9901 §4 builds the closed mandate's disclosure).
describe("a non-https link gives one code on read and bound", () => {
  const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const sha256b64u = (s: string) => createHash("sha256").update(Buffer.from(s, "ascii")).digest("base64url");
  const HX = "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  const payload = { id: "chk_2", legalContext: { type: "sha256", value: HX, legalContextUrl: `http://atr.seller.example/${HX}` } };
  const J = `${b64u('{"alg":"ES256","typ":"JWT"}')}.${b64u(JSON.stringify(payload))}.${"A".repeat(86)}`;
  const D = b64u(JSON.stringify(["c2FsdA", "checkout_jwt", J]));
  const M =
    `${b64u('{"alg":"ES256","typ":"dc+sd-jwt"}')}.` +
    `${b64u(JSON.stringify({ vct: "mandate.checkout.1", checkout_hash: sha256b64u(J), _sd: [sha256b64u(D)], _sd_alg: "sha-256" }))}.` +
    `${"A".repeat(86)}~${D}~`;

  it("read gives ap2/link-not-https", () => {
    expect(checkoutMandate.read(J)).toEqual({ refused: true, code: "ap2/link-not-https" });
  });

  it("bound gives ap2/link-not-https", async () => {
    expect(await checkoutMandate.bound({ checkout_mandate: M, checkout_jwt: J })).toEqual({
      refused: true,
      code: "ap2/link-not-https",
    });
  });
});
