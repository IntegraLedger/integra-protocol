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

  /**
   * ⛔⛔ `Uint8Array.from` TRUNCATES INSTEAD OF REFUSING, so an element that is not a byte does not fail —
   * it becomes a different byte, and the caller receives a well-formed atrHash that no settlement carries.
   * Measured before the guard existed: `300` decoded to `0x2c…`, `-1` to `0xff…`, `1.5` to `0x01…`.
   * Each case is spelled out rather than derived, and each keeps 32 elements so it is the ELEMENT under
   * test and not the length.
   */
  it("returns null for a 32-element payment_id carrying anything that is not a byte", () => {
    const real = Array.from(encodeAtrPaymentId(ATR));
    for (const notAByte of [256, 300, -1, 1.5, Number.NaN]) {
      const corrupted = [...real];
      corrupted[0] = notAByte;
      expect(decodeAtrPaymentId(corrupted)).toBeNull();
    }
  });

  it("accepts BOTH ends of the byte range — 0 and 255 are bytes", () => {
    const low = Array.from(encodeAtrPaymentId(ATR));
    low[0] = 0;
    expect(decodeAtrPaymentId(low)).toBe(
      "0x0083b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
    );
    const high = Array.from(encodeAtrPaymentId(ATR));
    high[0] = 255;
    expect(decodeAtrPaymentId(high)).toBe(
      "0xff83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
    );
  });

  it("verifyAtrPaymentId REFUSES the hash a truncated payment_id would have spelled", () => {
    // The concrete false positive: `[300, 0x11 × 31]` used to decode to `0x2c1111…` and verify TRUE
    // against it — a payment_id accepted as carrying an atrHash whose bytes it does not contain.
    const corrupted = [300, ...new Array<number>(31).fill(0x11)];
    expect(
      verifyAtrPaymentId({
        paymentId: corrupted,
        atrHash: `0x2c${"11".repeat(31)}`,
      }),
    ).toBe(false);
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
