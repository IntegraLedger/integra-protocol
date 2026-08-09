/**
 * The internal hex primitives. They are not exported from the barrel — this suite exists because they are
 * where a silent misread would live: a prefix stripped from the middle of a value, a word truncated instead
 * of refused, a topic's address taken from the wrong end.
 */
import { describe, expect, it } from "vitest";
import {
  addressFromTopic,
  isHexBytes,
  quantityToNumber,
  stripHexPrefix,
  toWord,
  uint256FromData,
} from "../src/hex.js";
import {
  MAINNET_MEMO_LOG,
  MAINNET_PAYER,
} from "./fixtures/mainnet-transfer-with-memo.js";

describe("stripHexPrefix", () => {
  it("strips a lower-case and an upper-case prefix", () => {
    expect(stripHexPrefix("0xabcd")).toBe("abcd");
    expect(stripHexPrefix("0Xabcd")).toBe("abcd");
  });

  it("leaves an unprefixed value alone", () => {
    expect(stripHexPrefix("abcd")).toBe("abcd");
  });

  it("only strips at the START — a '0x' in the middle is data, not a prefix", () => {
    expect(stripHexPrefix("ab0xcd")).toBe("ab0xcd");
  });
});

describe("isHexBytes", () => {
  it("accepts an exact-width value with or without the prefix", () => {
    expect(isHexBytes(`0x${"ab".repeat(32)}`, 32)).toBe(true);
    expect(isHexBytes("ab".repeat(32), 32)).toBe(true);
  });

  it("rejects one byte short and one byte long", () => {
    expect(isHexBytes("ab".repeat(31), 32)).toBe(false);
    expect(isHexBytes("ab".repeat(33), 32)).toBe(false);
  });

  it("rejects non-hex characters at full width", () => {
    expect(isHexBytes("zz".repeat(32), 32)).toBe(false);
  });
});

describe("toWord", () => {
  it("left-pads to a 32-byte word", () => {
    expect(toWord("1")).toBe(`${"0".repeat(63)}1`);
  });

  it("leaves an exactly-full word alone", () => {
    expect(toWord("f".repeat(64))).toBe("f".repeat(64));
  });

  it("THROWS on 65 chars rather than truncating — a truncated value would encode a wrong amount", () => {
    expect(() => toWord("f".repeat(65))).toThrow(/exceed one 32-byte word/);
  });
});

describe("addressFromTopic", () => {
  it("takes the LAST 20 bytes of a real indexed-address topic", () => {
    expect(addressFromTopic(MAINNET_MEMO_LOG.topics[1] ?? "")).toBe(
      MAINNET_PAYER,
    );
  });

  it("lower-cases the result", () => {
    expect(addressFromTopic(`0x${"00".repeat(12)}${"AB".repeat(20)}`)).toBe(
      `0x${"ab".repeat(20)}`,
    );
  });

  it("returns null for anything that is not a 32-byte word", () => {
    expect(addressFromTopic(`0x${"ab".repeat(20)}`)).toBeNull();
    expect(addressFromTopic("0x")).toBeNull();
  });
});

describe("uint256FromData", () => {
  it("reads the amount from a real log's data", () => {
    expect(uint256FromData(MAINNET_MEMO_LOG.data)).toBe(37424n);
  });

  it("reads only the FIRST word when data carries several", () => {
    expect(uint256FromData(`0x${"00".repeat(31)}01${"ff".repeat(32)}`)).toBe(
      1n,
    );
  });

  it("reads uint256 max", () => {
    expect(uint256FromData(`0x${"ff".repeat(32)}`)).toBe(2n ** 256n - 1n);
  });

  it("returns null when data is shorter than one word", () => {
    expect(uint256FromData("0x00")).toBeNull();
    expect(uint256FromData("0x")).toBeNull();
  });

  it("returns null for a full-width word that is not hex", () => {
    expect(uint256FromData(`0x${"zz".repeat(32)}`)).toBeNull();
  });
});

describe("quantityToNumber", () => {
  it("parses a JSON-RPC hex quantity", () => {
    expect(quantityToNumber("0x1ee51fc")).toBe(32395772);
    expect(quantityToNumber("0x0")).toBe(0);
  });

  it("passes an integer through", () => {
    expect(quantityToNumber(3)).toBe(3);
  });

  it("returns null for a non-integer number rather than rounding a log index", () => {
    expect(quantityToNumber(1.5)).toBeNull();
  });

  it("returns null when the value is absent", () => {
    expect(quantityToNumber(undefined)).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(quantityToNumber("0xzz")).toBeNull();
    expect(quantityToNumber("")).toBeNull();
  });
});
