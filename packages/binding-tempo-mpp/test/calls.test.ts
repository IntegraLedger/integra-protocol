import { describe, expect, it } from "vitest";
import {
  encodeTransferWithMemoCall,
  selectorOf,
  weldGradeForCall,
} from "../src/calls.js";
import {
  MAINNET_AMOUNT,
  MAINNET_CALLDATA,
  MAINNET_MEMO,
  MAINNET_RECIPIENT,
} from "./fixtures/mainnet-transfer-with-memo.js";

const ATR = `0x${"ab".repeat(32)}`;

describe("encodeTransferWithMemoCall", () => {
  it("reproduces a REAL mainnet transferWithMemo calldata byte for byte", () => {
    // The oracle is the chain, not this encoder: `calls[0].input` of tx 0x45dfbd26… on Tempo mainnet.
    // Getting the memo's placement wrong (left-padding it like a value type, say) would still produce
    // 100 valid-looking bytes, and only a real call proves the layout.
    expect(
      encodeTransferWithMemoCall({
        to: MAINNET_RECIPIENT,
        amount: MAINNET_AMOUNT,
        memo: MAINNET_MEMO,
      }),
    ).toBe(MAINNET_CALLDATA);
  });

  it("lays out selector ‖ left-padded address ‖ uint256 ‖ RAW bytes32 memo (100 bytes)", () => {
    const data = encodeTransferWithMemoCall({
      to: "0x1111111111111111111111111111111111111111",
      amount: 1n,
      memo: ATR,
    });
    expect(data).toBe(
      "0x95777d59" +
        `${"00".repeat(12)}${"11".repeat(20)}` +
        `${"00".repeat(31)}01` +
        "ab".repeat(32),
    );
    expect((data.length - 2) / 2).toBe(4 + 32 * 3);
  });

  it("accepts an upper-case address and emits the lower-case padded word", () => {
    const data = encodeTransferWithMemoCall({
      to: MAINNET_RECIPIENT.toUpperCase(),
      amount: MAINNET_AMOUNT,
      memo: MAINNET_MEMO,
    });
    expect(data).toBe(MAINNET_CALLDATA);
  });

  it("throws on a malformed recipient rather than emitting a truncated word", () => {
    expect(() =>
      encodeTransferWithMemoCall({ to: "0x1234", amount: 1n, memo: ATR }),
    ).toThrow(/20-byte address/);
  });

  it("throws on a malformed memo", () => {
    expect(() =>
      encodeTransferWithMemoCall({
        to: MAINNET_RECIPIENT,
        amount: 1n,
        memo: "0x1234",
      }),
    ).toThrow(/32-byte/);
  });

  it("encodes a ZERO amount — MPP's zero-dollar proof flow is a real charge shape", () => {
    const data = encodeTransferWithMemoCall({
      to: MAINNET_RECIPIENT,
      amount: 0n,
      memo: ATR,
    });
    expect(data.slice(74, 138)).toBe("00".repeat(32));
  });

  it("accepts a BARE 40-char address (the prefix is optional, as it is on the memo)", () => {
    expect(
      encodeTransferWithMemoCall({
        to: MAINNET_RECIPIENT.slice(2),
        amount: MAINNET_AMOUNT,
        memo: MAINNET_MEMO,
      }),
    ).toBe(MAINNET_CALLDATA);
  });

  it("throws on an address ONE byte too long — no trailing garbage accepted", () => {
    expect(() =>
      encodeTransferWithMemoCall({
        to: `0x${"11".repeat(21)}`,
        amount: 1n,
        memo: ATR,
      }),
    ).toThrow(/20-byte address/);
  });

  it("throws on garbage BEFORE 40 hex chars — no leading garbage accepted", () => {
    expect(() =>
      encodeTransferWithMemoCall({
        to: `zz${"11".repeat(20)}`,
        amount: 1n,
        memo: ATR,
      }),
    ).toThrow(/20-byte address/);
  });

  it("throws on a negative amount — uint256 has no sign", () => {
    expect(() =>
      encodeTransferWithMemoCall({
        to: MAINNET_RECIPIENT,
        amount: -1n,
        memo: ATR,
      }),
    ).toThrow(/uint256/);
  });

  it("throws on an amount above uint256 max", () => {
    expect(() =>
      encodeTransferWithMemoCall({
        to: MAINNET_RECIPIENT,
        amount: 2n ** 256n,
        memo: ATR,
      }),
    ).toThrow(/uint256/);
  });

  it("encodes uint256 max exactly at the boundary", () => {
    const data = encodeTransferWithMemoCall({
      to: MAINNET_RECIPIENT,
      amount: 2n ** 256n - 1n,
      memo: ATR,
    });
    expect(data.slice(74, 138)).toBe("ff".repeat(32));
  });
});

describe("selectorOf", () => {
  it("reads the 4-byte selector from real calldata", () => {
    expect(selectorOf(MAINNET_CALLDATA)).toBe("0x95777d59");
  });

  it("lower-cases the selector so comparisons are exact", () => {
    expect(selectorOf("0x95777D5900")).toBe("0x95777d59");
  });

  it("reads a selector with no arguments at all (exactly 4 bytes)", () => {
    expect(selectorOf("0x95777d59")).toBe("0x95777d59");
  });

  it("returns null for calldata shorter than a selector", () => {
    expect(selectorOf("0x9577")).toBeNull();
    expect(selectorOf("0x")).toBeNull();
  });
});

describe("weldGradeForCall", () => {
  it("grades a real transferWithMemo call as signature — the payer signed this calldata", () => {
    expect(weldGradeForCall(MAINNET_CALLDATA)).toBe("signature");
  });

  it("grades transferFromWithMemo as tx — the SPENDER picks the memo, not the token owner", () => {
    expect(weldGradeForCall(`0x929c2539${"00".repeat(128)}`)).toBe("tx");
  });

  it("returns null for a call that carries no memo at all (plain ERC-20 transfer)", () => {
    // Grading an unrelated call would let a plain `transfer` be reported as a welded settlement.
    expect(weldGradeForCall(`0xa9059cbb${"00".repeat(64)}`)).toBeNull();
  });

  it("returns null for calldata too short to carry a selector", () => {
    expect(weldGradeForCall("0x")).toBeNull();
  });

  it("agrees with the manifest's two declared weld grades and nothing else", () => {
    const grades = new Set(
      [
        weldGradeForCall(MAINNET_CALLDATA),
        weldGradeForCall(`0x929c2539${"00".repeat(128)}`),
      ].filter((g) => g !== null),
    );
    expect([...grades].sort()).toEqual(["signature", "tx"]);
  });
});
