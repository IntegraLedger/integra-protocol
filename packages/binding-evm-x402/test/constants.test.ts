/**
 * The deployment registry is CRYPTOGRAPHY, not configuration: `tokenName`/`tokenVersion`/`chainId`/`asset`
 * are the four inputs to the EIP-712 domain separator the payer's authorization is signed against. A wrong
 * value does not fail loudly — it produces a well-formed signature that recovers to nobody, so the seller
 * sees a valid-looking payment that the token refuses. These tests therefore pin each deployment against
 * the `DOMAIN_SEPARATOR()` READ FROM ITS OWN LIVE CONTRACT (2026-07-30), which is the only authority that
 * can contradict us.
 *
 * The separator is recomputed here from first principles (typehash ‖ keccak(name) ‖ keccak(version) ‖
 * chainId ‖ address) rather than through `hashEip712`, deliberately: the production path builds typed data
 * with viem's `hashTypedData`, and a test that reuses the same helper would agree with a shared bug. This
 * is the contract's own formula, written out.
 */
import {
  type BuildEip3009Input,
  buildEip3009TypedData,
} from "@integraledger/lcp-binding-evm-common";
import { encodeAbiParameters, type Hex, keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import type { X402AdapterConfig } from "../src/adapter.js";
import {
  getX402Deployment,
  type X402DeploymentName,
  x402DeploymentNames,
} from "../src/constants.js";

/**
 * `DOMAIN_SEPARATOR()` as returned by each USDC contract on 2026-07-30. Reproduce with:
 *   cast call <asset> "DOMAIN_SEPARATOR()(bytes32)" --rpc-url <rpc>
 * These are on-chain facts. If one of these assertions fails, the registry is wrong — not the pin.
 */
const ON_CHAIN_DOMAIN_SEPARATOR: Record<X402DeploymentName, Hex> = {
  base: "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f",
  "base-sepolia":
    "0x71f17a3b2ff373b803d70a5a07c046c1a2bc8e89c09ef722fcb047abe94c9818",
  avalanche:
    "0xbbea200329a938bc3438984a49cb0732e66d66d7bd59c127abacc1710e77f7b3",
  monad: "0xfe22123edc0dd4aeb912eb7948c5f0e531592c2053b3067612f427db342c93c6",
};

const DOMAIN_TYPEHASH = keccak256(
  toHex(
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
  ),
);

/** The EIP-712 domain separator, computed the way the token contract computes it. */
function domainSeparator(d: {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        DOMAIN_TYPEHASH,
        keccak256(toHex(d.name)),
        keccak256(toHex(d.version)),
        BigInt(d.chainId),
        d.verifyingContract,
      ],
    ),
  );
}

/** A payment whose values are irrelevant to the domain — only the deployment config moves the separator. */
const MESSAGE: Omit<
  BuildEip3009Input,
  "chainId" | "tokenName" | "tokenVersion" | "verifyingContract"
> = {
  atrHash: "0x03e07ab3d8d98adf1d01c7fbb965a199d6d3df2634c846dc9a8398810885b62c",
  from: "0x5555555555555555555555555555555555555555",
  to: "0x6666666666666666666666666666666666666666",
  value: "1500000",
  validAfter: "0",
  validBefore: "4102444800",
};

function typedDataDomainOf(config: X402AdapterConfig) {
  const { typedData } = buildEip3009TypedData({
    ...MESSAGE,
    chainId: config.chainId,
    tokenName: config.tokenName,
    tokenVersion: config.tokenVersion,
    verifyingContract: config.asset,
  });
  return typedData.domain;
}

/**
 * The expected deployment names, written out rather than taken from `x402DeploymentNames()`. Deriving the
 * case list from the code under test is circular — `it.each` would then iterate whatever the function
 * happens to return — and it is worse than circular at module scope: if the getter returned `undefined`,
 * `it.each` throws during COLLECTION, the file reports "no tests", and a suite that ran nothing looks
 * green. The literal keeps a broken getter a failed assertion instead of a silent zero.
 */
const NAMES: X402DeploymentName[] = [
  "base",
  "base-sepolia",
  "avalanche",
  "monad",
];

describe("the x402 deployment registry binds the real EIP-712 domain", () => {
  it.each(NAMES)(
    "%s — the config drives buildEip3009TypedData to the contract's own DOMAIN_SEPARATOR",
    (name) => {
      const config = getX402Deployment(name);
      const domain = typedDataDomainOf(config);
      // Assert through the BUILT typed data, not the raw config: this proves the whole path
      // (registry → buildEip3009TypedData → domain) lands on the on-chain value, so a builder that
      // dropped or reordered a domain field would fail here too.
      expect(
        domainSeparator({
          name: String(domain.name),
          version: String(domain.version),
          chainId: Number(domain.chainId),
          verifyingContract: domain.verifyingContract as `0x${string}`,
        }),
      ).toBe(ON_CHAIN_DOMAIN_SEPARATOR[name]);
    },
  );

  it("every deployment has a DISTINCT domain separator", () => {
    // The invariant a copy-pasted row would break: two entries sharing a domain means an authorization
    // signed for one chain would verify on the other — a cross-chain replay, not a config typo.
    const seen = NAMES.map((n) =>
      domainSeparator({
        name: getX402Deployment(n).tokenName,
        version: getX402Deployment(n).tokenVersion,
        chainId: getX402Deployment(n).chainId,
        verifyingContract: getX402Deployment(n).asset,
      }),
    );
    expect(new Set(seen).size).toBe(NAMES.length);
  });

  it("the two Base deployments do NOT share an EIP-712 name", () => {
    // The specific trap this file exists for. Base mainnet is "USD Coin"; Base Sepolia — the chain the
    // weld is live-proven on — is "USDC". Copying the proven config to mainnet breaks every signature,
    // so this asymmetry is asserted rather than left as a comment.
    expect(getX402Deployment("base").tokenName).toBe("USD Coin");
    expect(getX402Deployment("base-sepolia").tokenName).toBe("USDC");
  });

  it("Avalanche and Monad likewise differ in name, matching their own contracts", () => {
    expect(getX402Deployment("avalanche").tokenName).toBe("USD Coin");
    expect(getX402Deployment("monad").tokenName).toBe("USDC");
  });

  it("pins each deployment's chain id and asset", () => {
    // chainId and asset are the other two domain inputs; the separator assertions above would catch a
    // change, but only this states WHICH chain each name means.
    expect(NAMES.map((n) => getX402Deployment(n).chainId)).toEqual([
      8453, 84532, 43114, 143,
    ]);
    expect(getX402Deployment("avalanche").asset).toBe(
      "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    );
    expect(getX402Deployment("monad").asset).toBe(
      "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    );
  });

  it("every deployment pins tokenVersion 2 — the FiatToken EIP-712 version", () => {
    for (const n of NAMES) expect(getX402Deployment(n).tokenVersion).toBe("2");
  });

  it("declares no fromBlock — an enumeration bound is the caller's, never a default", () => {
    for (const n of NAMES)
      expect(getX402Deployment(n).fromBlock).toBeUndefined();
  });
});

describe("getX402Deployment fails fast", () => {
  it.each([
    ["an unknown chain", "arbitrum"],
    ["an empty name", ""],
    ["a chain id instead of a name", "43114"],
    // Not a deployment name — and `Object.hasOwn` is what stops it resolving to Object.prototype.
    ["a prototype key", "toString"],
    ["a prototype constructor", "constructor"],
    ["case drift on a real name", "Avalanche"],
    ["whitespace drift on a real name", "monad "],
  ])("throws on %s", (_why, name) => {
    expect(() => getX402Deployment(name)).toThrow(/unknown x402 deployment/);
  });

  it("names the known deployments in the refusal, so the caller can correct it", () => {
    expect(() => getX402Deployment("arbitrum")).toThrow(
      /base, base-sepolia, avalanche, monad/,
    );
  });

  it("tells the caller HOW to get a correct config, not just that this one is wrong", () => {
    // The advisory half of the refusal is the half that prevents the NEXT wrong config: it names the two
    // contract calls that yield a correct domain. Asserted because the message can be silently emptied
    // without any behavioural test noticing — the throw would still happen, just uselessly.
    expect(() => getX402Deployment("arbitrum")).toThrow(
      /name\(\)\/version\(\)/,
    );
    expect(() => getX402Deployment("arbitrum")).toThrow(
      /wrong EIP-712 domain and unverifiable signatures/,
    );
  });

  it("returns every name it advertises", () => {
    // x402DeploymentNames() and getX402Deployment() must not drift apart: an advertised name that does
    // not resolve would be a lie the type system cannot catch, since the getter takes a plain string.
    for (const n of NAMES)
      expect(getX402Deployment(n).chainId).toBeGreaterThan(0);
  });

  it("x402DeploymentNames returns exactly the expected names, freshly, on every call", () => {
    expect(x402DeploymentNames()).toEqual(NAMES);
    // A fresh array per call — a caller that sorts or splices the result must not reorder the registry
    // for the next one.
    x402DeploymentNames().push("arbitrum" as X402DeploymentName);
    expect(x402DeploymentNames()).toEqual(NAMES);
  });
});
