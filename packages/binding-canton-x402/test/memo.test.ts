/**
 * The x402 transfer-memo codec.
 *
 * The carrier is `PaymentRequirements.extra.memo` — "Seller-defined UTF-8 string, max 256 bytes. When
 * present, the client MUST include it in the transfer's metadata" — enforced by scheme safety check 12,
 * which rejects `invalid_exact_canton_memo_mismatch` unless the transfer metadata carries the identical
 * value under `x402.memo`.
 */
import { describe, expect, it } from "vitest";
import { CANTON_X402_MEMO_KEY } from "../src/constants.js";
import {
  decodeTransferMemo,
  encodeTransferMemo,
  readTransferMemoAtrHash,
  x402MemoRequirement,
} from "../src/memo.js";

const ATR = `0x${"ab".repeat(32)}`;

describe("encodeTransferMemo", () => {
  it("emits the canonical atrHash verbatim", () => {
    // The host compares the memo BYTE-FOR-BYTE against the transfer metadata, so any second spelling
    // would be a second wire value the facilitator would reject against the first.
    expect(encodeTransferMemo(ATR)).toBe(ATR);
  });

  it("canonicalizes an uppercase-digit spelling rather than emitting it", () => {
    expect(encodeTransferMemo(`0x${"AB".repeat(32)}`)).toBe(ATR);
  });

  it("throws on a malformed atrHash — never advertise a memo we could not verify", () => {
    for (const bad of ["", "0xdead", "ab".repeat(32), ATR.toUpperCase()])
      expect(() => encodeTransferMemo(bad), `should throw: ${bad}`).toThrow();
  });

  it("the throw names encodeTransferMemo", () => {
    // The guard is kernel's `canonicalAtrHash`, which takes the caller's name as its context. Without
    // this, dropping the context leaves a seller with a bare shape complaint and no idea which of this
    // package's surfaces produced it.
    expect(() => encodeTransferMemo("0xdead")).toThrow(/encodeTransferMemo/);
  });

  it("fits inside the host's 256-byte ceiling with room to spare", () => {
    // Why there is no runtime length check: a canonical atrHash is exactly 66 UTF-8 bytes, so a guard
    // could never fire. The fact about the host belongs here rather than as an unreachable branch.
    expect(new TextEncoder().encode(encodeTransferMemo(ATR)).length).toBe(66);
  });
});

describe("decodeTransferMemo", () => {
  it("round-trips", () => {
    expect(decodeTransferMemo(encodeTransferMemo(ATR))).toBe(ATR);
  });

  it("accepts an uppercase-digit memo and returns the canonical form", () => {
    expect(decodeTransferMemo(`0x${"AB".repeat(32)}`)).toBe(ATR);
  });

  it("returns null for a foreign memo rather than throwing", () => {
    // A scan over a party's transfers meets every memo any application wrote. A foreign one is a value
    // to skip, not an error to raise.
    for (const foreign of ["", "invoice-2024-001", "0xdead", "ab".repeat(32)])
      expect(decodeTransferMemo(foreign), foreign).toBeNull();
  });
});

describe("readTransferMemoAtrHash", () => {
  it("reads the host's key", () => {
    expect(readTransferMemoAtrHash({ [CANTON_X402_MEMO_KEY]: ATR })).toBe(ATR);
  });

  it("ignores our value under ANY other key", () => {
    // A metadata map carrying the atrHash somewhere else is a transfer no facilitator checked against
    // extra.memo, so treating it as a weld would assert a commitment nobody made.
    for (const key of ["memo", "x402_memo", "lcp.memo", "x402.Memo"])
      expect(readTransferMemoAtrHash({ [key]: ATR }), key).toBeNull();
  });

  it("returns null for absent metadata, an empty map, and a foreign memo", () => {
    expect(readTransferMemoAtrHash(undefined)).toBeNull();
    expect(readTransferMemoAtrHash({})).toBeNull();
    expect(
      readTransferMemoAtrHash({ [CANTON_X402_MEMO_KEY]: "invoice-2024-001" }),
    ).toBeNull();
  });

  it("reads ours out of a map carrying other keys alongside", () => {
    expect(
      readTransferMemoAtrHash({
        "some.other": "x",
        [CANTON_X402_MEMO_KEY]: ATR,
        "z.last": "y",
      }),
    ).toBe(ATR);
  });
});

describe("x402MemoRequirement", () => {
  it("is the extra fragment a seller merges into PaymentRequirements", () => {
    expect(x402MemoRequirement(ATR)).toEqual({ memo: ATR });
  });

  it("throws on a malformed atrHash at ADVERTISEMENT time", () => {
    // The seller commits to this value before payment; a malformed one would have the facilitator reject
    // the payment later, with the failure surfacing on the payer rather than on whoever wired it wrong.
    expect(() => x402MemoRequirement("0xdead")).toThrow();
  });
});
