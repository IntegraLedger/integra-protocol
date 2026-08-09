import { describe, expect, it } from "vitest";
import {
  atrHashToLedgerText,
  buildAnchorPayload,
  type LcpAnchorPayload,
  ledgerTextToAtrHash,
  readAnchorAtrHash,
  verifyAnchorAtrHash,
} from "../src/anchor.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const ATR_TEXT =
  "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("atrHashToLedgerText / ledgerTextToAtrHash", () => {
  it("stores the atrHash as 64-char lowercase hex WITHOUT the 0x prefix (the on-ledger form)", () => {
    const text = atrHashToLedgerText(ATR);
    expect(text).toBe(ATR_TEXT);
    expect(text.length).toBe(64);
    expect(ledgerTextToAtrHash(text)).toBe(ATR);
  });

  it("lowercases an uppercase atrHash (ATR canon) and round-trips", () => {
    const text = atrHashToLedgerText(ATR.toUpperCase().replace("0X", "0x"));
    expect(text).toBe(ATR_TEXT);
    expect(ledgerTextToAtrHash(text)).toBe(ATR);
  });

  it("reads a ledger Text field that already carries a 0x prefix", () => {
    expect(ledgerTextToAtrHash(ATR)).toBe(ATR);
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() => atrHashToLedgerText("0xdead")).toThrow(/32-byte/);
    expect(() => atrHashToLedgerText("not-hex")).toThrow();
  });

  it("returns null for a Text field that is not an atrHash (a query skips it, not errors)", () => {
    expect(ledgerTextToAtrHash("hello world")).toBeNull();
    expect(ledgerTextToAtrHash("dead")).toBeNull(); // wrong length
  });
});

describe("buildAnchorPayload", () => {
  it("carries the atrHash as a Text field and the parties, defaulting paymentRef", () => {
    const payload = buildAnchorPayload({
      buyer: "Buyer::1220abc",
      seller: "Seller::1220def",
      atrHash: ATR,
    });
    expect(payload).toEqual({
      buyer: "Buyer::1220abc",
      seller: "Seller::1220def",
      atrHash: ATR_TEXT,
      paymentRef: "",
    });
  });

  it("passes through a supplied paymentRef", () => {
    const payload = buildAnchorPayload({
      buyer: "Buyer::1220abc",
      seller: "Seller::1220def",
      atrHash: ATR,
      paymentRef: "invoice-42",
    });
    expect(payload.paymentRef).toBe("invoice-42");
  });

  it("fails loud on an empty party or a malformed atrHash", () => {
    expect(() =>
      buildAnchorPayload({ buyer: "", seller: "S", atrHash: ATR }),
    ).toThrow(/buyer/);
    expect(() =>
      buildAnchorPayload({ buyer: "B", seller: "", atrHash: ATR }),
    ).toThrow(/seller/);
    expect(() =>
      buildAnchorPayload({ buyer: "B", seller: "S", atrHash: "0xdead" }),
    ).toThrow(/32-byte/);
  });
});

describe("readAnchorAtrHash / verifyAnchorAtrHash", () => {
  const payload: LcpAnchorPayload = {
    buyer: "Buyer::1220abc",
    seller: "Seller::1220def",
    atrHash: ATR_TEXT,
    paymentRef: "",
  };

  it("reads the atrHash off a queried payload", () => {
    expect(readAnchorAtrHash(payload)).toBe(ATR);
  });

  it("returns null when the payload carries no well-formed atrHash", () => {
    expect(readAnchorAtrHash({ ...payload, atrHash: "not-an-atr" })).toBeNull();
  });

  it("confirms a matching anchor and rejects a mismatched one", () => {
    expect(verifyAnchorAtrHash({ payload, atrHash: ATR })).toBe(true);
    expect(
      verifyAnchorAtrHash({
        payload,
        atrHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });

  it("accepts an uppercase atrHash against the lowercase ledger form (ATR canon)", () => {
    expect(
      verifyAnchorAtrHash({
        payload,
        atrHash: ATR.toUpperCase().replace("0X", "0x"),
      }),
    ).toBe(true);
  });

  // Both arms of the guard reject independently, and each rejects a different kind of nonsense: a
  // contract that anchors nothing, and a caller asking about something that is not an atrHash. With
  // only one arm the other input reaches the comparison — where `null === "garbage"` is false by luck
  // rather than by rule, and an uppercase-normalised non-hash could be compared at all.
  it("rejects when the PAYLOAD carries no well-formed atrHash, even for a valid query", () => {
    expect(
      verifyAnchorAtrHash({
        payload: { ...payload, atrHash: "not-an-atr" },
        atrHash: ATR,
      }),
    ).toBe(false);
  });

  it("rejects when the QUERIED atrHash is malformed, even against a valid anchor", () => {
    expect(verifyAnchorAtrHash({ payload, atrHash: "0xdead" })).toBe(false);
    expect(verifyAnchorAtrHash({ payload, atrHash: "" })).toBe(false);
  });

  it("rejects when BOTH are malformed", () => {
    expect(
      verifyAnchorAtrHash({
        payload: { ...payload, atrHash: "not-an-atr" },
        atrHash: "0xdead",
      }),
    ).toBe(false);
  });
});
