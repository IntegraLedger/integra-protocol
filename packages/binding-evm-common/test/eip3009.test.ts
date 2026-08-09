import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashEip712 } from "../src/eip712.js";
import {
  type BuildEip3009Input,
  buildEip3009TypedData,
  type Eip3009Authorization,
  eip155ChainId,
} from "../src/eip3009.js";

type Case = {
  name: string;
  input: BuildEip3009Input;
  expected: { authorization: Eip3009Authorization; digest: `0x${string}` };
};
const V = JSON.parse(
  readFileSync(
    new URL(
      "../../../vectors/binding/eip3009-typed-data.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { cases: Case[] };

const BASE: Omit<BuildEip3009Input, "atrHash"> = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  value: "1",
  validAfter: "0",
  validBefore: "4102444800",
  chainId: 8453,
  tokenName: "USD Coin",
  tokenVersion: "2",
  verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};
const hexChar = fc.constantFrom(..."0123456789abcdefABCDEF".split(""));
const hex64 = fc
  .array(hexChar, { minLength: 64, maxLength: 64 })
  .map((a) => `0x${a.join("")}`);

describe("buildEip3009TypedData", () => {
  it.each(V.cases)(
    "$name — authorization + EIP-712 digest are pinned",
    ({ input, expected }) => {
      const { authorization, typedData } = buildEip3009TypedData(input);
      expect(authorization).toEqual(expected.authorization);
      expect(hashEip712(typedData)).toBe(expected.digest);
    },
  );

  it("nonce is the lowercased atrHash for any valid 32-byte hash (fast-check)", () => {
    fc.assert(
      fc.property(hex64, (atr) => {
        const { authorization, typedData } = buildEip3009TypedData({
          ...BASE,
          atrHash: atr,
        });
        expect(authorization.nonce).toBe(atr.toLowerCase());
        expect(typedData.message.nonce).toBe(atr.toLowerCase());
      }),
    );
  });

  it.each([
    ["too short", "0xdead"],
    ["one hex digit short", `0x${"a".repeat(63)}`],
    // Both anchors carry weight: without `$` a 33-byte value rides as the nonce and the trailing byte
    // is silently dropped on-chain; without `^` any string merely ENDING in a 32-byte hex is accepted.
    ["one hex digit long", `0x${"a".repeat(65)}`],
    ["trailing junk after a valid hash", `0x${"a".repeat(64)}!`],
    ["a valid hash with anything in front", `zz0x${"a".repeat(64)}`],
    ["missing the 0x prefix", "a".repeat(64)],
    ["non-hex digits", `0x${"g".repeat(64)}`],
  ])("rejects an atrHash with %s", (_why, atrHash) => {
    expect(() => buildEip3009TypedData({ ...BASE, atrHash })).toThrow(
      /32-byte/,
    );
  });
});

describe("eip155ChainId", () => {
  it.each([
    ["eip155:8453", 8453],
    ["eip155:84532", 84532],
    ["eip155:1", 1],
  ] as const)("%s -> %i", (net, id) => {
    expect(eip155ChainId(net)).toBe(id);
  });
  it.each([
    "8453",
    "base",
    "eip155:",
    "eip155:abc",
    "eip155:0x1",
    // Anchored at BOTH ends: the chain id binds the EIP-712 domain, so accepting a namespace that
    // merely ends in `eip155:<id>` would sign an authorization against the wrong chain's domain.
    "solana:eip155:1",
    "xeip155:1",
    "eip155:1 ",
    "eip155:1x",
  ])("rejects %s (never defaults)", (net) => {
    expect(() => eip155ChainId(net)).toThrow();
  });
});
