// `mpp/subscription/stripe` and `mpp/session/lightning` as channel pairings. Expected values come from the Stripe
// subscription draft (draft-stripe-subscription-00, blob 5a3d6c8d06: the activation receipt's `stripeSubscription`,
// "Stripe subscription ID"; "Servers MUST reject request objects that include `recipient` or `subscriptionExpires`";
// its example receipt), from the Lightning session draft, and from the proves sentences written word for word below.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sessionLightning } from "../src/lightning.js";
import { chargeStripe, subscriptionStripe } from "../src/mpp.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const refused = (code: string) => ({ refused: true, code });

/** The draft's example activation receipt, decoded from its `Payment-Receipt` header. */
const RECEIPT = {
  method: "stripe",
  reference: "in_1QabdK2eZvKYlo2C0L9n4321",
  status: "success",
  subscriptionId: "c3ViX3N0cmlwZV8wMQ",
  stripeSubscription: "sub_1Qabd52eZvKYlo2CgP0Lm789",
  timestamp: "2026-01-15T12:03:10Z",
};
/** The draft's example credential payload, under any challenge. */
const PRESENTED = { challenge: { id: "x", realm: "api.seller.example", method: "stripe", intent: "subscription", request: "e30" }, payload: { paymentMethod: "pm_1Qabc32eZvKYlo2C7b8H1234", customer: "cus_S7x1Pq5R9n2Lm4" } };

const SUBSCRIPTION_SENTENCE =
  "Later billing periods were paid under this ATR by renewal invoices the seller did not read. The close is the " +
  "seller's report.";
const SESSION_SENTENCE =
  "Later requests in this session were paid under this ATR from its deposit, by bearer proofs the seller did not " +
  "meter. The close is the seller's report.";

describe("mpp/subscription/stripe's channel members", () => {
  const ch = (subscriptionStripe as unknown as { channel: Record<string, (...a: unknown[]) => unknown> }).channel;

  it("has the members, and no closeRef", () => {
    expect(typeof ch?.["kind"]).toBe("function");
    expect(typeof ch?.["ref"]).toBe("function");
    expect(typeof ch?.["boundWithin"]).toBe("function");
    expect(typeof ch?.["until"]).toBe("function");
    expect("closeRef" in subscriptionStripe).toBe(false);
    expect("channel" in chargeStripe).toBe(false);
  });

  it("kind is always open", () => {
    expect(ch["kind"]!(PRESENTED)).toBe("open");
    expect(ch["kind"]!(undefined)).toBe("open");
  });

  it("ref is the activation receipt's stripeSubscription on the network stripe", async () => {
    expect(await ch["ref"]!(PRESENTED, RECEIPT)).toEqual({ network: "stripe", channel: "sub_1Qabd52eZvKYlo2CgP0Lm789" });
  });

  it("ref without a receipt, or with one that is not a Stripe subscription receipt, is refused", async () => {
    expect(await ch["ref"]!(PRESENTED)).toEqual(refused("mpp/receipt-missing"));
    for (const bad of [
      "eyJtZXRob2QiOiJzdHJpcGUifQ",
      { ...RECEIPT, method: "card" },
      { ...RECEIPT, status: "failed" },
      { ...RECEIPT, stripeSubscription: "" },
      { ...RECEIPT, stripeSubscription: "sub 1" },
      { ...RECEIPT, stripeSubscription: 7 },
      { ...RECEIPT, stripeSubscription: `sub_${"a".repeat(252)}` },
      (({ stripeSubscription: _s, ...rest }) => rest)(RECEIPT),
    ]) {
      expect(await ch["ref"]!(PRESENTED, bad)).toEqual(refused("mpp/receipt-malformed"));
    }
    expect(await ch["ref"]!(PRESENTED, { ...RECEIPT, stripeSubscription: `sub_${"a".repeat(251)}` })).toEqual({
      network: "stripe",
      channel: `sub_${"a".repeat(251)}`,
    });
  });

  it("boundWithin refuses mpp/not-bound-within; until is undefined", async () => {
    expect(await ch["boundWithin"]!(PRESENTED)).toEqual(refused("mpp/not-bound-within"));
    expect(ch["until"]!(PRESENTED)).toBeUndefined();
  });

  it("proves ends with the subscription's sentence; the charge's proves does not carry it", () => {
    expect(subscriptionStripe.pattern.proves.endsWith(` ${SUBSCRIPTION_SENTENCE}`)).toBe(true);
    expect(chargeStripe.pattern.proves.includes(SUBSCRIPTION_SENTENCE)).toBe(false);
    expect(load("mpp-subscription-stripe.json").pattern.proves).toBe(subscriptionStripe.pattern.proves);
  });
});

describe("mpp/session/lightning's proves", () => {
  it("ends with the session's sentence", () => {
    expect(sessionLightning.pattern.proves.endsWith(` ${SESSION_SENTENCE}`)).toBe(true);
  });
});
