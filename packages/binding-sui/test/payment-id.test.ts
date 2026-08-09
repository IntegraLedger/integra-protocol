import { describe, expect, it } from "vitest";
import {
  decodeAtrPaymentId,
  encodeAtrPaymentId,
  verifyAtrPaymentId,
} from "../src/payment-id.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("encodeAtrPaymentId / decodeAtrPaymentId", () => {
  it("carries the FULL 32-byte atrHash in payment_id (no truncation)", () => {
    const bytes = encodeAtrPaymentId(ATR);
    expect(bytes.length).toBe(32);
    expect(decodeAtrPaymentId(bytes)).toBe(ATR);
  });

  it("decodes the RPC's number[] form (a PaymentSettled event's payment_id)", () => {
    const bytes = encodeAtrPaymentId(ATR);
    const asNumberArray = Array.from(bytes);
    expect(decodeAtrPaymentId(asNumberArray)).toBe(ATR);
  });

  it("lowercases an uppercase atrHash (ATR any-case canon)", () => {
    const bytes = encodeAtrPaymentId(ATR.toUpperCase().replace("0X", "0x"));
    expect(decodeAtrPaymentId(bytes)).toBe(ATR);
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() => encodeAtrPaymentId("0xdead")).toThrow(/32-byte/);
    expect(() => encodeAtrPaymentId("not-hex")).toThrow();
  });

  it("returns null for a payment_id that is not 32 bytes (a scan skips it, not errors)", () => {
    expect(decodeAtrPaymentId([1, 2, 3])).toBeNull();
    expect(decodeAtrPaymentId(new Uint8Array(64))).toBeNull();
  });
});

describe("verifyAtrPaymentId", () => {
  it("confirms a matching payment_id and rejects a mismatched one", () => {
    const bytes = encodeAtrPaymentId(ATR);
    expect(verifyAtrPaymentId({ paymentId: bytes, atrHash: ATR })).toBe(true);
    expect(
      verifyAtrPaymentId({
        paymentId: bytes,
        atrHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });

  it("verifies the number[] form too", () => {
    const bytes = Array.from(encodeAtrPaymentId(ATR));
    expect(verifyAtrPaymentId({ paymentId: bytes, atrHash: ATR })).toBe(true);
  });

  it("rejects an UPPERCASE-0X prefix even though the bytes match", () => {
    // The canon requires the `0x` prefix lowercase (hex digits are any-case) — the same rule the carrier
    // corpus pins as an uppercase-0X REJECT vector. `0X…` must not verify, and the comparison alone
    // cannot see that: `.toLowerCase()` on the claimed hash would make the bytes agree. Only the
    // `isAtrHash` guard rejects it, so this is what proves that guard is load-bearing.
    const bytes = encodeAtrPaymentId(ATR);
    expect(
      verifyAtrPaymentId({ paymentId: bytes, atrHash: `0X${ATR.slice(2)}` }),
    ).toBe(false);
  });

  it("accepts an uppercase-HEX atrHash (digits are case-insensitive)", () => {
    const bytes = encodeAtrPaymentId(ATR);
    expect(
      verifyAtrPaymentId({
        paymentId: bytes,
        atrHash: `0x${ATR.slice(2).toUpperCase()}`,
      }),
    ).toBe(true);
  });

  it("rejects a claimed atrHash that is not an atrHash at all", () => {
    const bytes = encodeAtrPaymentId(ATR);
    expect(verifyAtrPaymentId({ paymentId: bytes, atrHash: "0xdead" })).toBe(
      false,
    );
    expect(verifyAtrPaymentId({ paymentId: bytes, atrHash: "" })).toBe(false);
  });

  it("rejects a payment_id that is not 32 bytes against a valid atrHash", () => {
    expect(verifyAtrPaymentId({ paymentId: [1, 2, 3], atrHash: ATR })).toBe(
      false,
    );
  });
});
