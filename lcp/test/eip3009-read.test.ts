// The EIP-3009 read that `x402/exact/eip155/eip3009` and `mpp/charge/evm/authorization` share, run through both on one
// constructed endpoint (evm-chain.ts): a use on another contract than the token, a page of the search the endpoint
// answers with a malformed reply, the state below the position given that the endpoint does not hold, and another act
// given by a reference that names its transaction. Signatures, calls and topics come from viem 2.57.4, an outside
// encoder: `signTypedData`, `encodeFunctionData` and `encodeEventTopics` over the EIP-3009 functions and events as
// FiatTokenV2_2 publishes them (circlefin/stablecoin-evm, contracts/v2/EIP3009.sol), EIP-5267's `eip712Domain()` answer
// by `encodeFunctionResult`, and an ERC-1271 account's check by `recoverAddress`.
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  recoverAddress,
  type Hex as ViemHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { ReaderError, type Hex } from "../src/evm.js";
import type { EvmQuery } from "../src/internal/evm.js";
import { evmAuthorization } from "../src/mpp.js";
import { exactEip3009 } from "../src/x402.js";
import { abiStringOf, readerOf, wordOf, type Chain, type ChainTx } from "./evm-chain.js";

const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const EIP5267_ABI = parseAbi([
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);
const ERC1271_ABI = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);
const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// Hardhat's first and second development keys: published test keys that hold nothing.
const payer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const other = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

const NETWORK = "eip155:84532" as const;
const CHAIN_ID = 84532;
const ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex;
const OTHER_TOKEN = "0x00000000000000000000000000000000000c0de1" as Hex;
const PAYEE = "0x209693bc6afc0c5328ba36faf03c514ef312287c" as Hex;
/** A contract account of the payer's, whose owner is the other key. */
const SMART = "0x0000000000000000000000000000000000005a5a" as Hex;
/** The nonce: H on x402, the challenge's digest on MPP; one word on both. */
const NONCE = `0x${"ba".repeat(32)}` as Hex;
const SALT = `0x${"5a".repeat(32)}` as Hex;
const VALUE = 10_000n;
const VALID_BEFORE = 1_790_000_060n;
const BASE = 1_000n;
const T1 = `0x${"11".repeat(32)}` as Hex;

const presented = (from: Hex) => ({ token: ASSET, from, to: PAYEE, value: VALUE.toString(), nonce: NONCE });

/** Each pairing's reference for the authorization from `from`, and its `status`. */
const READS = [
  {
    id: "x402/exact/eip155/eip3009",
    ref: (from: Hex) => ({ network: NETWORK, payee: PAYEE, h: NONCE, asset: ASSET, payer: from, validBefore: VALID_BEFORE.toString(), presented: presented(from) }),
    status: (ref: object, chain: Chain, q: EvmQuery<unknown>) => exactEip3009.status(ref as never, readerOf(chain), q),
  },
  {
    id: "mpp/charge/evm/authorization",
    ref: (from: Hex) => ({
      network: NETWORK,
      payee: PAYEE,
      payer: from,
      authorization: { at: ASSET, nonce: NONCE, deadline: VALID_BEFORE.toString() },
      presented: presented(from),
    }),
    status: (ref: object, chain: Chain, q: EvmQuery<unknown>) => evmAuthorization.status(ref as never, readerOf(chain) as never, q),
  },
] as const;

const PAYER = payer.address.toLowerCase() as Hex;
const query: EvmQuery<unknown> = { act: "payment", finality: "finalized", after: BASE };

/** The authorization from `from`, signed by `signer` in `domain`. */
async function signedIn(signer: typeof payer, from: Hex, domain: { name: string; version: string; chainId: number; verifyingContract: Hex; salt?: Hex }) {
  const message = { from: from as ViemHex, to: PAYEE, value: VALUE, validAfter: 0n, validBefore: VALID_BEFORE, nonce: NONCE };
  return { message, signature: await signer.signTypedData({ domain, types: TYPES, primaryType: "TransferWithAuthorization", message }) };
}

/** `transferWithAuthorization` in its `v, r, s` form, as viem encodes it. */
function vrsCall(m: Awaited<ReturnType<typeof signedIn>>): Hex {
  const sig = m.signature.slice(2);
  const { from, to, value, validAfter, validBefore, nonce } = m.message;
  return encodeFunctionData({
    abi: EIP3009_ABI,
    functionName: "transferWithAuthorization",
    args: [from, to, value, validAfter, validBefore, nonce, Number.parseInt(sig.slice(128, 130), 16), `0x${sig.slice(0, 64)}`, `0x${sig.slice(64, 128)}`],
  }) as Hex;
}

/** The two logs a use emits on `contract`: `AuthorizationUsed(from, nonce)` and `Transfer(from, payee, value)`. */
function useLogs(contract: Hex, from: Hex = PAYER) {
  const used = encodeEventTopics({ abi: EIP3009_ABI, eventName: "AuthorizationUsed", args: { authorizer: from, nonce: NONCE } });
  const transfer = encodeEventTopics({ abi: EIP3009_ABI, eventName: "Transfer", args: { from, to: PAYEE } });
  return [
    { address: contract, topics: used as Hex[], data: "0x" as Hex },
    { address: contract, topics: transfer as Hex[], data: encodeAbiParameters([{ type: "uint256" }], [VALUE]) as Hex },
  ];
}

/**
 * A ledger with heads at BASE+40/45/50, each block's time past `validBefore` where `lapsed`; the payer's nonce reads used
 * on the asset from block `usedFrom`, else never; other calls answered by `call`.
 */
function chainWith(txs: ChainTx[], call?: Chain["call"], lapsed = true, usedFrom?: bigint): Chain {
  return {
    network: NETWORK,
    heads: { finalized: BASE + 40n, safe: BASE + 45n, latest: BASE + 50n },
    time: (b) => (lapsed ? VALID_BEFORE : 1_700_000_000n) + b,
    txs,
    call: async (to, data, block) => {
      if (data.startsWith("0xe94a0102")) return wordOf(usedFrom !== undefined && block >= usedFrom ? 1n : 0n);
      if (call !== undefined) return call(to, data, block);
      throw new Error("execution reverted");
    },
  };
}

const named = (name: string, version: string): Chain["call"] => async (_to, data) => {
  if (data === "0x06fdde03") return abiStringOf(name);
  if (data === "0x54fd4d50") return abiStringOf(version);
  throw new Error("execution reverted");
};

/** The other contract's answers where it states a domain with a salt by EIP-5267. */
const stating: Chain["call"] = async (to, data, block) =>
  data === "0x84b0196e"
    ? (encodeFunctionResult({
        abi: EIP5267_ABI,
        functionName: "eip712Domain",
        result: ["0x1f", "Other", "1", BigInt(CHAIN_ID), OTHER_TOKEN, SALT, []],
      }) as Hex)
    : named("Other", "1")!(to, data, block);

/** The contract account's ERC-1271 check: the magic value where its owner, the other key, signed the hash. */
async function smartAccount(data: Hex): Promise<Hex> {
  const { functionName, args } = decodeFunctionData({ abi: ERC1271_ABI, data });
  if (functionName !== "isValidSignature") throw new Error("execution reverted");
  const signer = await recoverAddress({ hash: args[0], signature: args[1] });
  return (signer === other.address ? "0x1626ba7e" + "00".repeat(28) : `0x${"ff".repeat(32)}`) as Hex;
}

describe.each(READS)("$id: the shared EIP-3009 read", (r) => {
  // Each ledger below reads the authorization lapsed, so that a use the read wrongly took for nothing would answer
  // `failed`, `instrument-unused`, for a payment that landed on another token.
  it("counts a use on another contract by the domain it states by EIP-5267 or by the payer's ERC-1271 check, and holds the search where it cannot verify the signature", async () => {
    const otherDomain = { name: "Other", version: "1", chainId: CHAIN_ID, verifyingContract: OTHER_TOKEN };
    const salted = await signedIn(payer, PAYER, { ...otherDomain, salt: SALT });
    const tx = (input: Hex, from: Hex = PAYER): ChainTx => ({ hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN, from), to: OTHER_TOKEN, input });
    expect(await r.status(r.ref(PAYER), chainWith([tx(vrsCall(salted))], stating), query)).toMatchObject({ state: "settled", transaction: T1, presented: "no" });

    const bySmart = await signedIn(other, SMART, otherDomain);
    const smartCall: Chain["call"] = async (to, data, block) => (to.toLowerCase() === SMART ? smartAccount(data) : named("Other", "1")!(to, data, block));
    expect(await r.status(r.ref(SMART), chainWith([tx(vrsCall(bySmart), SMART)], smartCall), query)).toMatchObject({
      state: "settled",
      transaction: T1,
      signer: SMART,
    });

    // The contract states no domain, and the payer's signature verifies only in the asset's: not shown to be another's.
    const inAsset = await signedIn(payer, PAYER, { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: ASSET });
    expect(await r.status(r.ref(PAYER), chainWith([tx(vrsCall(inAsset))], named("USDC", "2")), query)).toEqual({
      state: "pending",
      reason: "search-incomplete",
      search: BASE + 10n,
      undecoded: [T1],
      foreign: [],
    });
  });

  it("halves a page only for a range the endpoint refuses: a malformed answer to a page is unparseable", async () => {
    const chain = { ...chainWith([], undefined, false), logsFault: () => new ReaderError("malformed") };
    expect(await r.status(r.ref(PAYER), chain, query)).toEqual({ state: "unreadable", reason: "unparseable", foreign: [] });
  });

  it("answers history-gap where the endpoint does not hold the state below the position given that the nonce's first use needs", async () => {
    const call: Chain["call"] = async () => {
      throw new ReaderError("history");
    };
    const chain = chainWith([], undefined, false, BASE - 5n);
    const gap: Chain = { ...chain, call: async (to, data, block) => (block < BASE ? call(to, data, block) : chain.call!(to, data, block)) };
    expect(await r.status(r.ref(PAYER), gap, query)).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });

  it("takes the act in a transaction that another act's reference names as that act, whatever its members", async () => {
    const use: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(ASSET), to: ASSET };
    const given = { ...r.ref(PAYER), transaction: T1, presented: { ...presented(PAYER), value: "1" } };
    const q: EvmQuery<unknown> = { ...query, others: [{ ref: given }] };
    const alone = await r.status(r.ref(PAYER), chainWith([use], undefined, false, BASE + 10n), query);
    expect(alone).toMatchObject({ state: "settled", transaction: T1 });
    // The given act consumed the value: this act's payment cannot land, and the answer names the given act.
    expect(await r.status(r.ref(PAYER), chainWith([use], undefined, false, BASE + 10n), q)).toMatchObject({
      state: "failed",
      reason: "instrument-consumed",
      transaction: T1,
      carries: "given",
    });
  });
});
