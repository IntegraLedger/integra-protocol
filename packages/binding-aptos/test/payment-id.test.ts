import { describe, expect, it } from "vitest";
import {
  decodePaymentIdBytes,
  encodePaymentId,
  encodePaymentIdArg,
  readPaymentId,
  verifyPaymentId,
} from "../src/payment-id.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("encodePaymentId / decodePaymentIdBytes", () => {
  it("encodes the atrHash as the 32 raw payment_id bytes", () => {
    const bytes = encodePaymentId(ATR);
    expect(bytes.length).toBe(32);
    expect(decodePaymentIdBytes(bytes)).toBe(ATR);
  });

  it("encodePaymentIdArg is the number[] Move-call argument form", () => {
    const arg = encodePaymentIdArg(ATR);
    expect(Array.isArray(arg)).toBe(true);
    expect(arg.length).toBe(32);
    expect(decodePaymentIdBytes(Uint8Array.from(arg))).toBe(ATR);
  });

  it("lowercases an uppercase atrHash (ATR any-case canon)", () => {
    const bytes = encodePaymentId(ATR.toUpperCase().replace("0X", "0x"));
    expect(decodePaymentIdBytes(bytes)).toBe(ATR);
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() => encodePaymentId("0xdead")).toThrow(/32-byte/);
    expect(() => encodePaymentId("not-hex")).toThrow();
    expect(() => encodePaymentIdArg("0xdead")).toThrow(/32-byte/);
  });

  it("returns null for payment_id bytes of the wrong length (a scan skips it, not errors)", () => {
    expect(decodePaymentIdBytes(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("readPaymentId (fullnode hex-string OR raw-bytes form)", () => {
  it("reads the 0x-hex STRING an Aptos fullnode emits for a vector<u8> event field", () => {
    expect(readPaymentId(ATR)).toBe(ATR);
    // fullnode may emit an uppercase / mixed-case hex string — any-case canon holds
    expect(readPaymentId(ATR.toUpperCase().replace("0X", "0x"))).toBe(ATR);
  });

  it("reads the raw 32 bytes (Move-call argument form)", () => {
    expect(readPaymentId(encodePaymentId(ATR))).toBe(ATR);
  });

  it("returns null for a non-LCP payment_id (a scan skips it)", () => {
    expect(readPaymentId("0xdead")).toBeNull();
    expect(readPaymentId("not a hash")).toBeNull();
    expect(readPaymentId(new Uint8Array(31))).toBeNull();
  });
});

describe("verifyPaymentId", () => {
  it("confirms a matching payment_id and rejects a mismatched one", () => {
    expect(verifyPaymentId({ paymentId: ATR, atrHash: ATR })).toBe(true);
    expect(
      verifyPaymentId({ paymentId: encodePaymentId(ATR), atrHash: ATR }),
    ).toBe(true);
    expect(
      verifyPaymentId({
        paymentId: ATR,
        atrHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });

  // Each arm of the guard rejects a different kind of nonsense, and each must reject on its own.
  it("rejects an unreadable payment_id even against a well-formed atrHash", () => {
    expect(verifyPaymentId({ paymentId: "not-an-atr", atrHash: ATR })).toBe(
      false,
    );
    expect(
      verifyPaymentId({ paymentId: new Uint8Array(31), atrHash: ATR }),
    ).toBe(false);
  });

  it("rejects a malformed atrHash argument even against a well-formed payment_id", () => {
    expect(verifyPaymentId({ paymentId: ATR, atrHash: "0xdead" })).toBe(false);
    expect(verifyPaymentId({ paymentId: ATR, atrHash: "" })).toBe(false);
  });

  it("matches case-insensitively, as the ATR canon requires", () => {
    expect(
      verifyPaymentId({
        paymentId: ATR,
        atrHash: `0x${ATR.slice(2).toUpperCase()}`,
      }),
    ).toBe(true);
  });
});
