import { describe, expect, it } from "vitest";
import { decodeAtrMemo, encodeAtrMemo, verifyAtrMemo } from "../src/memo.js";
import { MAINNET_MEMO } from "./fixtures/mainnet-transfer-with-memo.js";

const ATR = `0x${"ab".repeat(32)}`;
const ATR_UPPER = `0x${"AB".repeat(32)}`;

describe("encodeAtrMemo", () => {
  it("emits the atrHash unchanged as the 32-byte memo — no padding, no wrapping", () => {
    // TIP-20's memo is exactly bytes32 and an atrHash is exactly 32 bytes, so the memo IS the atrHash.
    // Any transformation here would break zero-party recovery, which reads topic 3 raw.
    expect(encodeAtrMemo(ATR)).toBe(ATR);
  });

  it("normalizes an upper-case atrHash to lower case (ATR canon accepts any case, we emit one)", () => {
    expect(encodeAtrMemo(ATR_UPPER)).toBe(ATR);
  });

  it("throws on a value that is not a 32-byte hash — a short memo would be silently zero-padded", () => {
    expect(() => encodeAtrMemo("0x1234")).toThrow(/32-byte/);
  });

  it("throws on a bare (unprefixed) hash rather than guessing the prefix", () => {
    expect(() => encodeAtrMemo("ab".repeat(32))).toThrow(/32-byte/);
  });
});

describe("decodeAtrMemo", () => {
  it("reads back an encoded atrHash", () => {
    expect(decodeAtrMemo(encodeAtrMemo(ATR))).toBe(ATR);
  });

  it("accepts a BARE 32-byte hex memo — MPP's own parser strips an optional 0x prefix", () => {
    // mpp-rs `parse_memo_bytes_in_context` (src/protocol/methods/tempo/charge.rs) does
    // `memo.strip_prefix("0x").unwrap_or(memo)`, so both spellings are the host's declared input grammar.
    // Accepting both is conformance to that grammar, not a tolerant fallback.
    expect(decodeAtrMemo("ab".repeat(32))).toBe(ATR);
  });

  it("normalizes an upper-case on-chain memo to the lower-case form the stack compares", () => {
    expect(decodeAtrMemo(`0x${"AB".repeat(32)}`)).toBe(ATR);
  });

  it("returns null for a memo that is not 32 bytes (a scan skips it, it is not an error)", () => {
    expect(decodeAtrMemo("0x1234")).toBeNull();
    expect(decodeAtrMemo(`0x${"ab".repeat(33)}`)).toBeNull();
  });

  it("returns null for non-hex content", () => {
    expect(decodeAtrMemo(`0x${"zz".repeat(32)}`)).toBeNull();
  });

  it("returns null for an empty memo — MPP treats the empty string as absent", () => {
    expect(decodeAtrMemo("")).toBeNull();
    expect(decodeAtrMemo("0x")).toBeNull();
  });

  it("decodes the REAL mainnet memo structurally — shape alone cannot tell attribution from an atrHash", () => {
    // This is why the MPP attribution guard exists: the live memo is a perfectly well-formed 32-byte
    // value, so the codec accepts it and only the TAG discriminator distinguishes it.
    expect(decodeAtrMemo(MAINNET_MEMO)).toBe(MAINNET_MEMO);
  });
});

describe("verifyAtrMemo", () => {
  it("confirms a settlement memo carries exactly the advertised atrHash", () => {
    expect(verifyAtrMemo({ memo: ATR, atrHash: ATR })).toBe(true);
  });

  it("is case-insensitive on both sides", () => {
    expect(
      verifyAtrMemo({ memo: `0x${"AB".repeat(32)}`, atrHash: ATR_UPPER }),
    ).toBe(true);
  });

  it("rejects a different memo", () => {
    expect(verifyAtrMemo({ memo: `0x${"cd".repeat(32)}`, atrHash: ATR })).toBe(
      false,
    );
  });

  it("rejects a malformed memo", () => {
    expect(verifyAtrMemo({ memo: "0x1234", atrHash: ATR })).toBe(false);
  });

  it("rejects a malformed atrHash rather than comparing garbage", () => {
    expect(verifyAtrMemo({ memo: ATR, atrHash: "nope" })).toBe(false);
  });
});

describe("the guard names the function that refused", () => {
  // `encodeAtrMemo` delegates its shape guard to kernel's `canonicalAtrHash`, passing its own name as the
  // context. If that context is ever dropped, the seller gets a bare shape complaint with no indication of
  // which of this package's four encoders produced it.
  it("encodeAtrMemo's throw identifies encodeAtrMemo", () => {
    expect(() => encodeAtrMemo("0xnope")).toThrow(/encodeAtrMemo/);
  });
});
