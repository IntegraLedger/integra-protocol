// The ap2 and ucp pairings are registered at the package root.
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/index.js";
import { checkoutMandate } from "../src/ap2.js";
import { ap2Mandate, bookingAp2Mandate, bookingUnsigned, unsigned } from "../src/ucp.js";

describe("BINDINGS: ap2 and ucp", () => {
  it("holds each ap2 and ucp pairing once", () => {
    const ids = BINDINGS.map((b) => b.id);
    for (const [id, b] of [
      ["ap2/checkout-mandate", checkoutMandate],
      ["ucp/checkout/ap2-mandate", ap2Mandate],
      ["ucp/checkout/unsigned", unsigned],
      ["ucp/booking/ap2-mandate", bookingAp2Mandate],
      ["ucp/booking/unsigned", bookingUnsigned],
    ] as const) {
      expect(ids.filter((x) => x === id)).toHaveLength(1);
      expect(BINDINGS.find((x) => x.id === id)).toBe(b);
    }
  });
});
