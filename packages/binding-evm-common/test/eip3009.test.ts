import { readFileSync } from "node:fs";
import fc from "fast-check";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { hashEip712 } from "../src/eip712.js";
import {
  type BuildEip3009Input,
  buildEip3009TypedData,
  type Eip3009Authorization,
  eip155ChainId,
  verifyEip3009Signature,
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

/**
 * `verifyEip3009Signature` — the check the TOKEN makes, made before the money moves.
 *
 * `FiatTokenV2.transferWithAuthorization` recovers the signer from the EIP-712 digest and compares it to
 * `from`. A seller that accepts an authorization without doing the same has accepted a payment the chain
 * will reject, after it has already served the resource.
 */
describe("verifyEip3009Signature", () => {
  // Anvil account #1 — a well-known deterministic test key (RFC 6979 ECDSA → stable signatures).
  const KEY =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const account = privateKeyToAccount(KEY);
  const ATR = `0x${"ab".repeat(32)}`;

  /** Built inside each test, never at module scope: a fixture built once swallows the mutants that make
   *  construction throw, which Stryker then records as survived. */
  const signed = async (
    over: Partial<BuildEip3009Input> = {},
  ): Promise<{
    typedData: ReturnType<typeof buildEip3009TypedData>["typedData"];
    signature: `0x${string}`;
  }> => {
    const { typedData } = buildEip3009TypedData({
      ...BASE,
      ...over,
      atrHash: ATR,
      from: account.address,
    });
    return { typedData, signature: await account.signTypedData(typedData) };
  };

  it("⭐ accepts a signature the claimed signer actually made", async () => {
    const { typedData, signature } = await signed();
    expect(
      await verifyEip3009Signature(typedData, signature, account.address),
    ).toBe(true);
  });

  it("⭐ compares DECODED addresses — the payer's own lowercase spelling is the same payer", async () => {
    const { typedData, signature } = await signed();
    const lower = account.address.toLowerCase();
    expect(lower).not.toBe(account.address);
    expect(await verifyEip3009Signature(typedData, signature, lower)).toBe(
      true,
    );
  });

  it("⛔ refuses a signature by someone else", async () => {
    const { typedData, signature } = await signed();
    expect(
      await verifyEip3009Signature(
        typedData,
        signature,
        "0x0000000000000000000000000000000000000009",
      ),
    ).toBe(false);
  });

  it("⛔ refuses when ANY signed field is altered after signing", async () => {
    // The point of a signature: the domain and every message member are covered. Each of these is a value
    // a counterparty could edit between signing and presenting.
    const { typedData, signature } = await signed();
    const altered = [
      { ...typedData, message: { ...typedData.message, value: 2n } },
      { ...typedData, message: { ...typedData.message, validBefore: 1n } },
      {
        ...typedData,
        message: {
          ...typedData.message,
          to: "0x0000000000000000000000000000000000000009" as `0x${string}`,
        },
      },
      { ...typedData, domain: { ...typedData.domain, chainId: 1 } },
      { ...typedData, domain: { ...typedData.domain, version: "1" } },
    ];
    for (const td of altered)
      expect(await verifyEip3009Signature(td, signature, account.address)).toBe(
        false,
      );
  });

  it("⛔ ANSWERS FALSE rather than throwing on a malformed signature or signer", async () => {
    // A predicate that throws is a worse contract than one that answers — `atrHashEquals` says the same
    // about itself. The caller here holds an untrusted credential and needs a value it can put on the wire.
    const { typedData, signature } = await signed();
    for (const bad of ["", "0x", "not-a-signature", `${signature}ff`])
      expect(
        await verifyEip3009Signature(typedData, bad, account.address),
      ).toBe(false);
    for (const who of [
      "",
      "0x",
      "not-an-address",
      account.address.slice(0, -1),
      // ⭐ Both ends of the shape, and each needs its own case. A value that merely ENDS in an address
      // (`junk0x…`) passes an unanchored-left check; one that merely STARTS with an address (`0x…ff`)
      // passes an unanchored-right one. Every other input here is refused by both mutants, so without
      // these two the anchors could be deleted with the suite green.
      `junk${account.address}`,
      `${account.address}ff`,
    ])
      expect(await verifyEip3009Signature(typedData, signature, who)).toBe(
        false,
      );
  });

  it("⛔ does NOT fall back to ERC-1271 — a contract wallet cannot sign one of these", async () => {
    // The token has no `isValidSignature` call in `transferWithAuthorization`, so accepting a contract
    // signature here would accept a payment the chain rejects. A signature over the right digest by the
    // wrong key is refused whoever the claimed signer is.
    const { typedData } = await signed();
    const other = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const bySomeoneElse = await other.signTypedData(typedData);
    expect(
      await verifyEip3009Signature(typedData, bySomeoneElse, account.address),
    ).toBe(false);
    // ...and it is accepted for the account that DID sign it, so the case above fails for the right reason.
    expect(
      await verifyEip3009Signature(typedData, bySomeoneElse, other.address),
    ).toBe(true);
  });
});
