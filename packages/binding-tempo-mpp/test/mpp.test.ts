import { describe, expect, it } from "vitest";
import {
  isMppAttributionMemo,
  MPP_ATTRIBUTION_TAG,
  MPP_ATTRIBUTION_VERSION,
  mppMethodDetailsMemo,
} from "../src/mpp.js";
import { MAINNET_MEMO } from "./fixtures/mainnet-transfer-with-memo.js";

const ATR = `0x${"ab".repeat(32)}`;

describe("MPP attribution memo recognition", () => {
  // Derived independently: `cast keccak "mpp"` -> 0xef1ed712f6f2… so TAG = keccak256("mpp")[0..3] =
  // 0xef1ed712, and mpp-rs `src/tempo/attribution.rs` documents the layout
  //   TAG(4) ‖ version(1) ‖ serverId fp(10) ‖ clientId fp(10) ‖ challenge nonce(7) = 32 bytes.
  it("pins the tag and version the host SDK writes", () => {
    expect(MPP_ATTRIBUTION_TAG).toBe("0xef1ed712");
    expect(MPP_ATTRIBUTION_VERSION).toBe(1);
  });

  it("recognizes the REAL mainnet memo as MPP attribution, not an LCP reference", () => {
    // The whole reason this guard exists: every TransferWithMemo sampled on mainnet on 2026-07-30 carried
    // one of these. Returning those 32 bytes as an atrHash would be a fabricated weld.
    expect(isMppAttributionMemo(MAINNET_MEMO)).toBe(true);
  });

  it("confirms the observed layout: tag ‖ version ‖ 10-byte server fp ‖ 10 zero bytes ‖ 7-byte nonce", () => {
    expect(MAINNET_MEMO.slice(0, 10)).toBe(MPP_ATTRIBUTION_TAG);
    expect(MAINNET_MEMO.slice(10, 12)).toBe("01");
    expect(MAINNET_MEMO.slice(12, 32)).toBe("27a6b6ab68afb53d3802");
    expect(MAINNET_MEMO.slice(32, 52)).toBe("00".repeat(10)); // anonymous client
    expect(MAINNET_MEMO.slice(52, 66)).toBe("66689448d5d103");
  });

  it("does NOT claim an atrHash-shaped memo is attribution", () => {
    expect(isMppAttributionMemo(ATR)).toBe(false);
  });

  it("requires the TAG too — version 0x01 at byte 4 is not enough on its own", () => {
    // An atrHash whose fifth byte happens to be 0x01 must not be mistaken for attribution.
    expect(isMppAttributionMemo(`0x0000000001${"ab".repeat(27)}`)).toBe(false);
  });

  it("requires the version byte too — the tag alone is not enough", () => {
    expect(isMppAttributionMemo(`0xef1ed71299${"00".repeat(27)}`)).toBe(false);
  });

  it("accepts a bare (unprefixed) memo, matching MPP's own optional-0x grammar", () => {
    expect(isMppAttributionMemo(MAINNET_MEMO.slice(2))).toBe(true);
  });

  it("is case-insensitive on the tag", () => {
    expect(isMppAttributionMemo(MAINNET_MEMO.toUpperCase())).toBe(true);
  });

  it("returns false for a memo that is not 32 bytes", () => {
    expect(isMppAttributionMemo("0xef1ed71201")).toBe(false);
  });
});

describe("mppMethodDetailsMemo", () => {
  it("produces the methodDetails fragment the seller adds to the MPP challenge", () => {
    // `methodDetails` rides inside the MAC-protected request body (slot 3 of the seven-slot
    // canonicalization), so the seller's own HMAC commits them to this value before payment.
    expect(mppMethodDetailsMemo(ATR)).toEqual({ memo: ATR });
  });

  it("emits the lower-case 0x form", () => {
    expect(mppMethodDetailsMemo(`0x${"AB".repeat(32)}`)).toEqual({ memo: ATR });
  });

  it("throws on a malformed atrHash rather than advertising a memo MPP will reject", () => {
    expect(() => mppMethodDetailsMemo("0x1234")).toThrow(/32-byte/);
  });
});
