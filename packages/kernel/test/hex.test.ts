import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bytesEqual, bytesToHex, hexToBytes } from "../src/hex.js";

type Case = { name: string; input: string; expected?: string; error?: string };
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/sha256/hex-codec.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: Case[];
};
const ok = V.cases.filter((c) => c.error === undefined);
const bad = V.cases.filter((c) => c.error !== undefined);

describe("hex codec", () => {
  it.each(ok)("$name roundtrips", ({ input, expected }) => {
    expect(bytesToHex(hexToBytes(input))).toBe(expected);
  });
  it.each(bad)("$name rejects", ({ input }) => {
    expect(() => hexToBytes(input)).toThrow();
  });
});

describe("bytesEqual", () => {
  // `atrHashEquals` gates both sides through `isAtrHash` first, so via that path the length branch is
  // unreachable — which is exactly why it needs testing HERE. `bytesEqual` is exported as a general
  // primitive, and an exported function whose only coverage comes through one guarded caller has a branch
  // nothing exercises.
  it("is true for identical contents", () => {
    expect(
      bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
    ).toBe(true);
  });

  it("is true for two empty arrays", () => {
    expect(bytesEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it("is FALSE for different lengths, including a common prefix", () => {
    // A prefix-vs-whole pair is the case that separates a length check from a content loop: without the
    // length branch, [1,2] vs [1,2,3] compares equal on every index the shorter one has.
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(
      false,
    );
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(
      false,
    );
    expect(bytesEqual(new Uint8Array(), new Uint8Array([0]))).toBe(false);
  });

  it("is false for same length, differing content — first byte, last byte, middle", () => {
    expect(
      bytesEqual(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
    expect(
      bytesEqual(new Uint8Array([1, 9, 3]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
    expect(
      bytesEqual(new Uint8Array([1, 2, 9]), new Uint8Array([1, 2, 3])),
    ).toBe(false);
  });
});
