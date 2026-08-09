/**
 * The `InvoiceID` codec — the carrier the weld moved to on 2026-08-08.
 *
 * x402's exact-XRPL scheme disqualifies memos twice (§9 "The facilitator MUST reject transactions with:
 * … `Memos` present"; §8 "Memos MUST NOT be used for invoice binding"), so the old carrier could not
 * settle through a facilitator at all. `InvoiceID` is a native 256-bit field of exactly the atrHash's
 * width.
 */
import { describe, expect, it } from "vitest";
import {
  decodeInvoiceId,
  encodeInvoiceId,
  proposeInvoiceId,
  verifyInvoiceId,
} from "../src/invoice-id.js";

const ATR = `0x${"ab".repeat(32)}`;
const ON_WIRE = "AB".repeat(32);

describe("encodeInvoiceId", () => {
  it("emits unprefixed UPPERCASE hex — the XRPL Hash256 wire form", () => {
    expect(encodeInvoiceId(ATR)).toBe(ON_WIRE);
  });

  it("accepts either spelling of the same atrHash and emits one form", () => {
    expect(encodeInvoiceId(`0x${"AB".repeat(32)}`)).toBe(ON_WIRE);
  });

  it("throws on a malformed atrHash — never sign a weld a verifier would reject", () => {
    for (const bad of ["", "0xdead", "ab".repeat(32), ATR.toUpperCase()])
      expect(() => encodeInvoiceId(bad), bad).toThrow();
  });

  it("the throw names encodeInvoiceId", () => {
    expect(() => encodeInvoiceId("0xdead")).toThrow(/encodeInvoiceId/);
  });
});

describe("decodeInvoiceId", () => {
  it("round-trips to LCP's canonical lowercase 0x spelling", () => {
    expect(decodeInvoiceId(encodeInvoiceId(ATR))).toBe(ATR);
  });

  it("is case-insensitive, as §8's own comparison rule is", () => {
    expect(decodeInvoiceId("ab".repeat(32))).toBe(ATR);
  });

  it("returns null for anything that is not a 256-bit value", () => {
    for (const bad of [
      "",
      "DEAD",
      "AB".repeat(31),
      `0x${ON_WIRE}`,
      `${ON_WIRE}00`,
    ])
      expect(decodeInvoiceId(bad), bad).toBeNull();
  });

  it("returns a CANDIDATE — a foreign InvoiceID decodes too, and that is stated not hidden", () => {
    // Unlike the MPP attribution memo, which carries a four-byte tag, nothing on-chain separates an
    // atrHash from SHA-256("INV-2025-001"). Both are 32 opaque bytes. The weld is established by matching
    // against an atrHash the reader already holds — the fingerprint step, not this codec.
    const foreign = "1".repeat(64);
    expect(decodeInvoiceId(foreign)).toBe(`0x${foreign}`);
  });
});

describe("verifyInvoiceId", () => {
  it("confirms a matching weld, either spelling", () => {
    expect(verifyInvoiceId({ invoiceId: ON_WIRE, atrHash: ATR })).toBe(true);
    expect(verifyInvoiceId({ invoiceId: "ab".repeat(32), atrHash: ATR })).toBe(
      true,
    );
  });

  it("refuses when BOTH sides are malformed — two nulls are not a match", () => {
    // Without the explicit null guard, `decoded === canonicalAtrHashOrNull(atrHash)` is `null === null`
    // and answers TRUE: a garbage InvoiceID would confirm a garbage atrHash. The same class of defect as
    // the old `atrHashEquals("hello","HELLO")`.
    expect(verifyInvoiceId({ invoiceId: "garbage", atrHash: "garbage" })).toBe(
      false,
    );
    expect(verifyInvoiceId({ invoiceId: "", atrHash: "" })).toBe(false);
  });

  it("names verifyInvoiceId nowhere it can throw — it answers false instead", () => {
    // A verification-time check meets malformed data as a matter of course, so it must never throw.
    expect(() =>
      verifyInvoiceId({ invoiceId: "garbage", atrHash: "garbage" }),
    ).not.toThrow();
  });

  it("refuses a different hash, an absent field, and a malformed candidate", () => {
    expect(verifyInvoiceId({ invoiceId: "CD".repeat(32), atrHash: ATR })).toBe(
      false,
    );
    expect(verifyInvoiceId({ invoiceId: undefined, atrHash: ATR })).toBe(false);
    expect(verifyInvoiceId({ invoiceId: ON_WIRE, atrHash: "0xdead" })).toBe(
      false,
    );
  });
});

describe("proposeInvoiceId", () => {
  it("returns the wire value when the field is ours to use", () => {
    expect(proposeInvoiceId({ atrHash: ATR })).toBe(ON_WIRE);
    expect(
      proposeInvoiceId({ atrHash: ATR, usesX402InvoiceBinding: false }),
    ).toBe(ON_WIRE);
  });

  it("REFUSES when the seller also binds an x402 extra.invoiceId", () => {
    // The one moment the information exists. On-chain the two are indistinguishable, so a silent weld
    // here would mean something different from what it claims, forever.
    expect(() =>
      proposeInvoiceId({ atrHash: ATR, usesX402InvoiceBinding: true }),
    ).toThrow(/mutually exclusive/);
  });
});
