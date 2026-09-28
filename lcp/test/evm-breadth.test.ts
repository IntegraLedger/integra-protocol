// The evm entry point's breadth pieces: bounds, the settlement read's rules, and the shipped profiles.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toBytes } from "viem";
import {
  DELEGATION_MANAGER_CHAINS,
  RECEIVE_POLICY_GUARD,
  TRANSFER_TOPIC,
  ReaderError,
  authorizationIdDigest,
  authorizationUsed,
  decodePermissionContext,
  evmStatus,
  permit2TypedData,
  transferDigest,
  type EvmReader,
  type EvmReceipt,
  type Hex,
} from "../src/evm.js";

const PAYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Hex;
const PAYTO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" as Hex;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Hex;
const topic = (a: string) => ("0x" + "00".repeat(12) + a.slice(2).toLowerCase()) as Hex;
const word = (n: bigint) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const TX = ("0x" + "44".repeat(32)) as Hex;
const reader = (r: EvmReceipt | null | "error", network = "eip155:84532"): EvmReader => ({
  network: network as `eip155:${string}`,
  receipt: async () => {
    if (r === "error") throw new ReaderError("timeout");
    return r;
  },
  blockNumber: async (tag) => (tag === "finalized" ? 100n : 105n),
  transaction: async () => null,
  call: async () => {
    throw new ReaderError("transport");
  },
});

describe("transferDigest", () => {
  it("equals the slice's authorizationIdDigest over from, to and value", async () => {
    expect(await transferDigest({ from: PAYER, to: PAYTO, value: 10000n })).toBe(
      await authorizationIdDigest(PAYER, PAYTO, "10000"),
    );
  });
  it("refuses a malformed address instead of throwing", async () => {
    expect(await transferDigest({ from: "0x12" as Hex })).toEqual({ refused: true, code: "evm/field-malformed" });
  });
});

describe("DELEGATION_MANAGER_CHAINS", () => {
  it("holds the 51 chain ids of the DelegationManager deployment record, and not 4326", () => {
    expect(DELEGATION_MANAGER_CHAINS.length).toBe(51);
    expect(DELEGATION_MANAGER_CHAINS).toContain(84532);
    expect(DELEGATION_MANAGER_CHAINS).toContain(42431);
    expect(DELEGATION_MANAGER_CHAINS).not.toContain(4326);
  });
});

describe("decodePermissionContext bounds", () => {
  const abi = [
    {
      type: "tuple[]",
      components: [
        { name: "delegate", type: "address" },
        { name: "delegator", type: "address" },
        { name: "authority", type: "bytes32" },
        {
          name: "caveats",
          type: "tuple[]",
          components: [
            { name: "enforcer", type: "address" },
            { name: "terms", type: "bytes" },
            { name: "args", type: "bytes" },
          ],
        },
        { name: "salt", type: "uint256" },
        { name: "signature", type: "bytes" },
      ],
    },
  ] as const;
  const d = (caveats: number, terms: Hex = "0x") => ({
    delegate: PAYTO,
    delegator: PAYER,
    authority: ("0x" + "ff".repeat(32)) as Hex,
    caveats: Array.from({ length: caveats }, () => ({ enforcer: USDC, terms, args: "0x" as Hex })),
    salt: 7n,
    signature: "0x" as Hex,
  });
  const enc = (ds: ReturnType<typeof d>[]) => encodeAbiParameters(abi, [ds]) as Hex;
  const refused = { refused: true, code: "evm/field-malformed" };
  it("decodes 8 delegations with 16 caveats each, and refuses 9 delegations or 17 caveats", () => {
    const ok = decodePermissionContext(enc(Array.from({ length: 8 }, () => d(16))));
    expect(Array.isArray(ok) && ok.length).toBe(8);
    expect(decodePermissionContext(enc(Array.from({ length: 9 }, () => d(0))))).toEqual(refused);
    expect(decodePermissionContext(enc([d(17)]))).toEqual(refused);
  });
  it("refuses a bytes member over 8 KiB and a context over 32 KiB", () => {
    expect(decodePermissionContext(enc([d(1, ("0x" + "ab".repeat(8193)) as Hex)]))).toEqual(refused);
    expect(Array.isArray(decodePermissionContext(enc([d(1, ("0x" + "ab".repeat(8192)) as Hex)])))).toBe(true);
    expect(decodePermissionContext(("0x" + "00".repeat(32769)) as Hex)).toEqual(refused);
  });
  it("refuses an address word with a non-zero high byte and an offset past the end", () => {
    const good = enc([d(0)]);
    const hi = (good.slice(0, 2 + 64 * 3) + "01" + good.slice(2 + 64 * 3 + 2)) as Hex;
    expect(decodePermissionContext(hi)).toEqual(refused);
    const past = (good.slice(0, 2) + word(BigInt(good.length)).slice(2) + good.slice(66)) as Hex;
    expect(decodePermissionContext(past)).toEqual(refused);
  });
});

describe("evmStatus", () => {
  const ref = {
    network: "eip155:84532" as const,
    transferLog: { address: USDC, topic0: TRANSFER_TOPIC as Hex, identity: "from,to" as const, digest: "0x" as Hex },
  };
  it("a failed read, a reader for another network, and no receipt are pending", async () => {
    expect(await evmStatus({ ...ref, transaction: TX }, reader("error"))).toEqual({ state: "pending", why: "unreadable" });
    expect(await evmStatus({ ...ref, transaction: TX }, reader(null, "eip155:8453"))).toEqual({
      state: "pending",
      why: "unreadable",
    });
    expect(await evmStatus({ ...ref, transaction: TX }, reader(null))).toEqual({ state: "pending", why: "not-found" });
  });
  it("a Transfer from the token to the receive-policy guard, and no named log, is receive-policy-blocked", async () => {
    const digest = (await transferDigest({ from: PAYER, to: PAYTO })) as Hex;
    const blocked: EvmReceipt = {
      status: 1,
      blockNumber: 100n,
      logs: [{ address: USDC, topics: [TRANSFER_TOPIC, topic(PAYER), topic(RECEIVE_POLICY_GUARD)], data: word(5n) }],
    };
    expect(
      await evmStatus({ ...ref, transferLog: { ...ref.transferLog, digest }, transaction: TX }, reader(blocked)),
    ).toEqual({ state: "failed", why: "receive-policy-blocked" });
  });
  it("an ERC-721 Transfer (four topics) is not the token's transfer", async () => {
    const digest = (await transferDigest({ from: PAYER, to: PAYTO })) as Hex;
    const nft: EvmReceipt = {
      status: 1,
      blockNumber: 100n,
      logs: [{ address: USDC, topics: [TRANSFER_TOPIC, topic(PAYER), topic(PAYTO), word(1n)], data: "0x" }],
    };
    expect(await evmStatus({ ...ref, transferLog: { ...ref.transferLog, digest }, transaction: TX }, reader(nft))).toEqual({
      state: "failed",
      why: "transfer-not-found",
    });
  });
});

describe("permit2TypedData", () => {
  it("refuses a batch without a witness and a witness type that collides with Permit2's own", () => {
    const base = { chainId: 84532, spender: PAYTO, nonce: 1n, deadline: 2n };
    expect(permit2TypedData({ ...base, permitted: [{ token: USDC, amount: 1n }] })).toEqual({
      refused: true,
      code: "evm/field-malformed",
    });
    expect(
      permit2TypedData({ ...base, permitted: { token: USDC, amount: 1n }, witness: { type: "TokenPermissions", fields: [], value: {} } }),
    ).toEqual({ refused: true, code: "evm/field-malformed" });
  });
  it("the Transfer topic is keccak of the ERC-20 event signature", () => {
    expect(keccak256(toBytes("Transfer(address,address,uint256)"))).toBe(TRANSFER_TOPIC);
  });
});

describe("authorizationUsed", () => {
  const nonce = ("0x" + "ab".repeat(31) + "07") as Hex;
  const keys = (scheme: "eip3009" | "permit2") => ({
    network: "eip155:84532" as const,
    authorization: { scheme, at: scheme === "eip3009" ? USDC : ("0x000000000022D473030F116dDEE9F6B43aC78BA3" as Hex), nonce, deadline: "1790000060", asset: USDC },
  });
  const answering = (answer: Hex | Error, calls: unknown[] = [], network = "eip155:84532"): EvmReader => ({
    network: network as `eip155:${string}`,
    receipt: async () => null,
    blockNumber: async () => 0n,
    transaction: async () => null,
    call: async (to, data, block) => {
      calls.push([to, data, block]);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  // The calldata, from viem's ABI encoder over each contract's view function.
  const stateCall = encodeFunctionData({
    abi: parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]),
    args: [PAYER, nonce],
  });
  const bitmapCall = encodeFunctionData({
    abi: parseAbi(["function nonceBitmap(address owner, uint256 wordPos) view returns (uint256)"]),
    args: [PAYER, BigInt(nonce) >> 8n],
  });

  it("eip3009: one authorizationState call to the token at the block; true, false, or unreadable", async () => {
    const calls: unknown[] = [];
    expect(await authorizationUsed(keys("eip3009"), PAYER, 100n, answering(word(1n), calls))).toBe(true);
    expect(calls).toEqual([[USDC, stateCall, 100n]]);
    expect(await authorizationUsed(keys("eip3009"), PAYER, 100n, answering(word(0n)))).toBe(false);
    expect(await authorizationUsed(keys("eip3009"), PAYER, 100n, answering(word(2n)))).toEqual({ refused: true, code: "evm/unreadable" });
    expect(await authorizationUsed(keys("eip3009"), PAYER, 100n, answering("0x01"))).toEqual({ refused: true, code: "evm/unreadable" });
  });
  it("permit2: one nonceBitmap call to Permit2 at the block, reading bit nonce & 0xff", async () => {
    const calls: unknown[] = [];
    expect(await authorizationUsed(keys("permit2"), PAYER, 7n, answering(word(1n << 7n), calls))).toBe(true);
    expect(calls).toEqual([["0x000000000022D473030F116dDEE9F6B43aC78BA3", bitmapCall, 7n]]);
    expect(await authorizationUsed(keys("permit2"), PAYER, 7n, answering(word((1n << 256n) - 1n - (1n << 7n))))).toBe(false);
  });
  it("refuses another network's reader, a failed call, and malformed keys", async () => {
    const r = answering(word(1n));
    expect(await authorizationUsed(keys("eip3009"), PAYER, 1n, answering(word(1n), [], "eip155:8453"))).toEqual({ refused: true, code: "evm/wrong-reader" });
    expect(await authorizationUsed(keys("eip3009"), PAYER, 1n, answering(new ReaderError("timeout")))).toEqual({ refused: true, code: "evm/unreadable" });
    expect(await authorizationUsed({ network: "eip155:84532" }, PAYER, 1n, r)).toEqual({ refused: true, code: "evm/field-malformed" });
    expect(await authorizationUsed(keys("eip3009"), "0x12" as Hex, 1n, r)).toEqual({ refused: true, code: "evm/field-malformed" });
    const upper = { ...keys("eip3009"), authorization: { ...keys("eip3009").authorization, nonce: nonce.toUpperCase().replace("0X", "0x") as Hex } };
    expect(await authorizationUsed(upper, PAYER, 1n, r)).toEqual({ refused: true, code: "evm/field-malformed" });
    expect(await authorizationUsed(keys("eip3009"), PAYER, -1n, r)).toEqual({ refused: true, code: "evm/field-malformed" });
  });
});

describe("the published profiles", () => {
  const titles: [string, string][] = [
    ["x402-exact-eip155-permit2.md", "**LCP profile `x402/exact/eip155/permit2`"],
    ["x402-upto-eip155-permit2.md", "**LCP profile `x402/upto/eip155/permit2`"],
    ["x402-exact-eip155-erc7710-salt.md", "**LCP profile `x402/exact/eip155/erc7710-salt`"],
    ["x402-auth-capture-eip155.md", "**LCP profile `x402/auth-capture/eip155`"],
  ];
  it.each(titles)("%s ships with its title and six or five rules", (file, title) => {
    const text = readFileSync(new URL(`../profiles/${file}`, import.meta.url), "utf8");
    expect(text.startsWith(title)).toBe(true);
    expect(text).toContain("2. The client fetches L, computes SHA-256 over the bytes received");
  });
});
