// The card and Stripe charges (M1, M2), and the Stripe subscription's carrier. Expected values are the vector files'.
import { describe, expect, it } from "vitest";
import {
  chargeCard,
  chargeStripe,
  issuedDigest,
  pairingsOf,
  read,
  subscriptionStripe,
  type MppChallenge,
} from "../src/mpp.js";
import { b64u, fromB64u, load } from "./mpp-fixtures.js";

const CARD = load("mpp-charge-card.json");
const STRIPE = load("mpp-charge-stripe.json");
const SUB = load("mpp-subscription-stripe.json");
const F = CARD.fixed;

const issued = (method: string, intent: string, request: unknown): MppChallenge => ({
  realm: F.realm,
  method,
  intent,
  request: b64u(JSON.stringify(request)),
  expires: F.expires,
});
const requestOf = (c: MppChallenge) => JSON.parse(fromB64u(c.request));
type Advertises = { advertise(d: MppChallenge[], h: string, l: string, o: MppChallenge, a?: string): unknown };
const placed = (b: Advertises, c: MppChallenge, agreementUrl?: string): MppChallenge => {
  const doc = b.advertise([c], F.H, F.link, c, agreementUrl);
  if (!Array.isArray(doc)) throw new Error(JSON.stringify(doc));
  return doc[0]!;
};
const credential = (c: MppChallenge) => ({ challenge: c as MppChallenge & { id: string }, payload: { type: "token" } });

describe("mpp/charge/card (M1)", () => {
  const c = issued("card", "charge", CARD.M1.request);

  it("offers the pairing", () => {
    expect(pairingsOf(c)).toEqual(["mpp/charge/card"]);
  });

  it("advertise sets the id, the opaque reference and externalId = L", () => {
    const p = placed(chargeCard, c);
    expect(p.id).toBe(F.MV1);
    expect(requestOf(p).externalId).toBe(CARD.M1.expectExternalId);
    expect(new TextEncoder().encode(requestOf(p).externalId).length).toBe(CARD.M1.expectExternalIdLength);
    const r = read([p]);
    expect(r).toMatchObject({ h: F.H, link: F.link });
  });

  it("the issued digest of unplaced, and of the echo carrying externalId, are the vector's", async () => {
    const p = placed(chargeCard, c);
    expect(await issuedDigest(chargeCard.unplaced(c))).toBe(CARD.M1.expectDigest);
    expect(await issuedDigest(p)).toBe(CARD.M1.expectDigest);
    expect(await issuedDigest(chargeCard.unplaced(p))).toBe(CARD.M1.expectDigest);
    expect(requestOf(chargeCard.unplaced(p)).externalId).toBeUndefined();
  });

  it("build and bound refuse: nothing the buyer signs has a place for H", async () => {
    const p = placed(chargeCard, c);
    expect(await chargeCard.build({ challenge: p as MppChallenge & { id: string }, from: "0x", now: 0 }, F.H)).toEqual(
      CARD.M1.expectBuild,
    );
    expect(await chargeCard.bound(credential(p))).toEqual(CARD.M1.expectBound);
    expect(chargeCard.claims).toBe(false);
  });

  it.each(CARD.refusals.rows as { case: string; externalId: string; expect: unknown }[])("$case", (row) => {
    const occupied = issued("card", "charge", { ...CARD.M1.request, externalId: row.externalId });
    expect(chargeCard.advertise([occupied], F.H, F.link, occupied)).toEqual(row.expect);
  });

  it("the agreement URL rides in opaque", () => {
    const p = placed(chargeCard, c, F.agreementUrl);
    expect(read([p])).toMatchObject({ agreement: F.agreementUrl });
  });

  it("states what it proves", () => {
    expect({ ...chargeCard.pattern, claims: chargeCard.claims }).toEqual(CARD.pattern);
  });
});

describe("mpp/charge/stripe (M2)", () => {
  const c = issued("stripe", "charge", STRIPE.M2.request);

  it("advertise sets methodDetails.metadata.legal_context = L, and the digest is the vector's", async () => {
    const p = placed(chargeStripe, c);
    expect(requestOf(p).methodDetails.metadata).toEqual({ [STRIPE.fixed.metadataKey]: F.L });
    expect(await issuedDigest(c)).toBe(STRIPE.M2.expectDigest);
    expect(await issuedDigest(p)).toBe(STRIPE.M2.expectDigest);
    const u = chargeStripe.unplaced(p);
    expect(requestOf(u).methodDetails.metadata).toBeUndefined();
    expect(await issuedDigest(u)).toBe(STRIPE.M2.expectDigest);
  });

  it("build and bound refuse", async () => {
    const p = placed(chargeStripe, c);
    expect(await chargeStripe.build({ challenge: p as MppChallenge & { id: string }, from: "0x", now: 0 }, F.H)).toEqual(
      STRIPE.M2.expectBuild,
    );
    expect(await chargeStripe.bound(credential(p))).toEqual(STRIPE.M2.expectBound);
  });

  it.each(STRIPE.refusals.rows as { case: string; metadata?: Record<string, string>; metadataKeys?: number; expect: unknown }[])(
    "$case",
    (row) => {
      const metadata =
        row.metadata ?? Object.fromEntries(Array.from({ length: row.metadataKeys! }, (_, i) => [`k${i}`, "v"]));
      const r = { ...STRIPE.M2.request, methodDetails: { ...STRIPE.M2.request.methodDetails, metadata } };
      const o = issued("stripe", "charge", r);
      expect(chargeStripe.advertise([o], F.H, F.link, o)).toEqual(row.expect);
    },
  );

  it("states what it proves", () => {
    expect({ ...chargeStripe.pattern, claims: chargeStripe.claims }).toEqual(STRIPE.pattern);
  });
});

describe("mpp/subscription/stripe", () => {
  const c = issued("stripe", "subscription", SUB.S1.request);

  it("offers the pairing, and advertise keeps the seller's metadata beside L", async () => {
    expect(pairingsOf(c)).toEqual(["mpp/subscription/stripe"]);
    const p = placed(subscriptionStripe, c);
    expect(requestOf(p).methodDetails.metadata).toEqual(SUB.S1.expectMetadata);
    expect(await issuedDigest(p)).toBe(await issuedDigest(c));
    expect(requestOf(subscriptionStripe.unplaced(p)).methodDetails.metadata).toEqual({ plan: "gold" });
  });

  it("build and bound refuse", async () => {
    const p = placed(subscriptionStripe, c);
    expect(
      await subscriptionStripe.build({ challenge: p as MppChallenge & { id: string }, from: "0x", now: 0 }, F.H),
    ).toEqual(SUB.S1.expectBuild);
    expect(await subscriptionStripe.bound(credential(p))).toEqual(SUB.S1.expectBound);
  });

  it("a charge offer is not this pairing's", () => {
    const charge = issued("stripe", "charge", STRIPE.M2.request);
    expect(subscriptionStripe.advertise([charge], F.H, F.link, charge)).toEqual({
      refused: true,
      code: "mpp/not-this-pairing",
    });
  });

  it("states what it proves", () => {
    expect({ ...subscriptionStripe.pattern, claims: subscriptionStripe.claims }).toEqual(SUB.pattern);
  });
});
