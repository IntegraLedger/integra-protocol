/**
 * DRIFT GUARD — does the DEPLOYED escrow still match the source this package is pinned to?
 *
 * Every derivation in `calls.ts` is transcribed from `AuthCaptureEscrow` at
 * `base/commerce-payments @ 98b592b`, the pinned deployment. That transcription is only as good as its
 * premise: that the contract at that address still hashes the way the pinned source says it does. Nothing
 * else in this repository checks the premise — the unit suite proves the code is self-consistent, and a
 * self-consistent transcription of a contract that has moved is exactly the failure this catches.
 *
 * The four cases read the live chain and compare it against what this package computes. They assert the
 * SHIPPED functions — `PAYMENT_INFO_TYPEHASH`, `getHashOffchain`, `saltFromAtrHash` — not re-implementations
 * of them, so a green run is a statement about the code consumers install.
 *
 * WHY THIS IS NOT IN `test/`, and why the `.drift.ts` suffix is load-bearing.
 *
 * These are live `readContract` calls to Base mainnet and Base Sepolia, over public RPC. In `test/` they
 * would enter `pnpm -r test` → `pnpm verify` → `ci.yml` on every push, and then `mutation.yml`, where
 * Stryker runs `dir: packages/binding-evm-escrow` with `coverageAnalysis: "perTest"` and no file filter.
 * The guard imports from `src/`, so EVERY mutant would re-run all four network reads: hundreds of public-RPC
 * round-trips per mutation job. Rate-limiting is the expected outcome — and a rate-limited read that throws
 * is scored as a KILLED mutant, so the instrument would report a better number for a worse suite.
 *
 * So this file is reachable only through `pnpm drift`, which uses `vitest.drift.config.ts`. `vitest run`
 * (the `test` script) globs `test/**` and never sees it. Keep it that way: moving these cases into `test/`
 * silently converts a weekly network check into a per-push one and corrupts the mutation score on the way.
 *
 * It runs weekly rather than per-push because it guards against something that changes on the chain's
 * schedule, not on ours. A failure here is never caused by the commit that happened to trigger it.
 *
 * No key, no funds, no writes — four view calls. `http(undefined)` falls back to each chain's default public
 * endpoint, so this runs with no configuration; set `BASE_MAINNET_RPC_URL` / `BASE_SEPOLIA_RPC_URL` to a
 * keyed provider for higher rate limits.
 */
import { hashAtr } from "@integraledger/lcp-kernel";
import { createPublicClient, http, keccak256, toHex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import {
  AUTH_CAPTURE_ESCROW,
  getHashOffchain,
  PAYMENT_INFO_TYPEHASH,
  type PaymentInfo,
  saltFromAtrHash,
} from "../src/index.js";

// Deterministically deployed at the SAME address on Base mainnet and Base Sepolia — identical bytecode and
// typehash. The live reads ARE the fork check.
const ESCROW = AUTH_CAPTURE_ESCROW;

// The struct string as the pinned source declares it. `PAYMENT_INFO_TYPEHASH` is this, hashed; asserting the
// string here rather than importing the hash is deliberate — it is the one place the human-readable
// signature is written down, so a field reordered upstream fails against something a reader can compare.
const TYPEHASH_STRING =
  "PaymentInfo(address operator,address payer,address receiver,address token," +
  "uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry," +
  "uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)";

const TYPEHASH_ABI = [
  {
    name: "PAYMENT_INFO_TYPEHASH",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const PAYMENT_INFO_TUPLE = {
  type: "tuple",
  name: "paymentInfo",
  components: [
    { name: "operator", type: "address" },
    { name: "payer", type: "address" },
    { name: "receiver", type: "address" },
    { name: "token", type: "address" },
    { name: "maxAmount", type: "uint120" },
    { name: "preApprovalExpiry", type: "uint48" },
    { name: "authorizationExpiry", type: "uint48" },
    { name: "refundExpiry", type: "uint48" },
    { name: "minFeeBps", type: "uint16" },
    { name: "maxFeeBps", type: "uint16" },
    { name: "feeReceiver", type: "address" },
    { name: "salt", type: "uint256" },
  ],
} as const;

const GET_HASH_ABI = [
  {
    name: "getHash",
    type: "function",
    stateMutability: "view",
    inputs: [PAYMENT_INFO_TUPLE],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const mainnet = createPublicClient({
  chain: base,
  transport: http(process.env["BASE_MAINNET_RPC_URL"]),
});
const sepolia = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env["BASE_SEPOLIA_RPC_URL"]),
});

function sampleInfo(
  salt: bigint,
  fee?: { minFeeBps: number; maxFeeBps: number; feeReceiver: `0x${string}` },
): PaymentInfo {
  return {
    operator: "0x1111111111111111111111111111111111111111",
    payer: "0x2222222222222222222222222222222222222222",
    receiver: "0x3333333333333333333333333333333333333333",
    token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // USDC on Base Sepolia
    maxAmount: 1_000000n,
    preApprovalExpiry: 4102444800,
    authorizationExpiry: 4102444800,
    refundExpiry: 4102444800,
    minFeeBps: fee?.minFeeBps ?? 0,
    maxFeeBps: fee?.maxFeeBps ?? 0,
    feeReceiver:
      fee?.feeReceiver ?? "0x0000000000000000000000000000000000000000",
    salt,
  };
}

describe("fork/derivation — the deployed escrow against the pinned source", () => {
  it("the deployed PAYMENT_INFO_TYPEHASH matches this package's constant", async () => {
    const onchain = await mainnet.readContract({
      address: ESCROW,
      abi: TYPEHASH_ABI,
      functionName: "PAYMENT_INFO_TYPEHASH",
    });
    // Both directions: the shipped constant, and the human-readable string it is derived from.
    expect(onchain).toBe(PAYMENT_INFO_TYPEHASH);
    expect(onchain).toBe(keccak256(toHex(TYPEHASH_STRING)));
  });

  it("getHashOffchain equals the deployed getHash() for salt = uint256(atrHash)", async () => {
    const atrHash = await hashAtr(new TextEncoder().encode("# Terms\ndrift"));
    const info = sampleInfo(saltFromAtrHash(atrHash));
    const onchain = await mainnet.readContract({
      address: ESCROW,
      abi: GET_HASH_ABI,
      functionName: "getHash",
      args: [info],
    });
    expect(
      getHashOffchain({ chainId: base.id, escrow: ESCROW, paymentInfo: info }),
    ).toBe(onchain);
  });

  it("the fee-bearing derivation covers maxFeeBps and feeReceiver — the blast-radius fields", async () => {
    const atrHash = await hashAtr(
      new TextEncoder().encode("# Terms\nfee-bearing"),
    );
    const info = sampleInfo(saltFromAtrHash(atrHash), {
      minFeeBps: 25,
      maxFeeBps: 250,
      feeReceiver: "0x4444444444444444444444444444444444444444",
    });
    const onchain = await mainnet.readContract({
      address: ESCROW,
      abi: GET_HASH_ABI,
      functionName: "getHash",
      args: [info],
    });
    expect(
      getHashOffchain({ chainId: base.id, escrow: ESCROW, paymentInfo: info }),
    ).toBe(onchain);
  });

  it("Base Sepolia carries the same pinned contract — the testnet lane derives identically", async () => {
    const onchain = await sepolia.readContract({
      address: ESCROW,
      abi: TYPEHASH_ABI,
      functionName: "PAYMENT_INFO_TYPEHASH",
    });
    expect(onchain).toBe(PAYMENT_INFO_TYPEHASH);
    expect(baseSepolia.id).toBe(84532);
  });
});
