// The x402 eip155 reads' own behaviour, one test per rule of how each finds the act, reads its lapse and compares the
// payment presented, on a constructed endpoint (evm-chain.ts). Signatures, calls and topics come from viem 2.57.4, an outside
// encoder: `signTypedData`, `encodeFunctionData` and `encodeEventTopics` over the EIP-3009 functions and events as
// FiatTokenV2_2 publishes them (circlefin/stablecoin-evm, contracts/v2/EIP3009.sol), EIP-5267's `eip712Domain()` answer
// by `encodeFunctionResult`, a domain separator by `domainSeparator`, and an ERC-1271 account's check by `recoverAddress`.
import {
  decodeFunctionData,
  domainSeparator,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  hashTypedData,
  parseAbi,
  recoverAddress,
  type Hex as ViemHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { authCaptureEip3009, exactEip3009, exactErc7710, exactPermit2 } from "../src/x402.js";
import { x402ExactPermit2ProxyABI } from "@x402/evm";
import { ESCROW, EXACT_PERMIT2_PROXY, PAYMENT_AUTHORIZED_TOPIC, ReaderError, type Hex } from "../src/evm.js";
import { SYSTEM_TRANSFER_EMITTER } from "../src/internal/evm-x402.js";
import { abiStringOf, readerOf, wordOf, type Chain, type ChainTx } from "./evm-chain.js";

const EIP3009_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** EIP-3009's `TransferWithAuthorization` type (circlefin/stablecoin-evm, contracts/v2/EIP3009.sol). */
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
/** EIP-5267's `eip712Domain()` and ERC-1271's `isValidSignature`, as the two standards define them. */
const EIP5267_ABI = parseAbi([
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
]);
const ERC1271_ABI = parseAbi(["function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"]);

// Hardhat's first and second development keys: published test keys that hold nothing.
const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const payer = privateKeyToAccount(PAYER_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const NETWORK = "eip155:84532" as const;
const CHAIN_ID = 84532;
const ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Hex;
const OTHER_TOKEN = "0x00000000000000000000000000000000000c0de1" as Hex;
const PAYEE = "0x209693bc6afc0c5328ba36faf03c514ef312287c" as Hex;
const H = `0x${"ba".repeat(32)}` as Hex;
const VALUE = 10_000n;
const VALID_BEFORE = 1_790_000_060n;
const BASE = 1_000n;
const T1 = `0x${"11".repeat(32)}` as Hex;

const ref = {
  network: NETWORK,
  payee: PAYEE,
  h: H,
  asset: ASSET,
  payer: payer.address.toLowerCase() as Hex,
  validBefore: VALID_BEFORE.toString(),
  presented: { token: ASSET, from: payer.address.toLowerCase(), to: PAYEE, value: VALUE.toString(), nonce: H },
};

/** The authorization's message, signed in the domain of `contract` under `name` and `version`. */
async function signed(signer: typeof payer, contract: Hex, name: string, version: string, chainId = CHAIN_ID) {
  const message = { from: payer.address, to: PAYEE, value: VALUE, validAfter: 0n, validBefore: VALID_BEFORE, nonce: H };
  const signature = await signer.signTypedData({
    domain: { name, version, chainId, verifyingContract: contract },
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  return { message, signature };
}

/** `transferWithAuthorization` in its `v, r, s` form, as viem encodes it. */
function vrsCall(m: Awaited<ReturnType<typeof signed>>): ViemHex {
  const sig = m.signature.slice(2);
  const r = `0x${sig.slice(0, 64)}` as ViemHex;
  const s = `0x${sig.slice(64, 128)}` as ViemHex;
  const v = Number.parseInt(sig.slice(128, 130), 16);
  const { from, to, value, validAfter, validBefore, nonce } = m.message;
  return encodeFunctionData({
    abi: EIP3009_ABI,
    functionName: "transferWithAuthorization",
    args: [from, to, value, validAfter, validBefore, nonce, v, r, s],
  });
}

/** The two logs a use emits on `contract`: `AuthorizationUsed(from, H)` and `Transfer(from, payee, value)`, `from` the payer's. */
function useLogs(contract: Hex, from: Hex = payer.address) {
  const used = encodeEventTopics({ abi: EIP3009_ABI, eventName: "AuthorizationUsed", args: { authorizer: from, nonce: H } });
  const transfer = encodeEventTopics({ abi: EIP3009_ABI, eventName: "Transfer", args: { from, to: PAYEE } });
  return [
    { address: contract, topics: used as Hex[], data: "0x" as Hex },
    { address: contract, topics: transfer as Hex[], data: encodeAbiParameters([{ type: "uint256" }], [VALUE]) as Hex },
  ];
}

/**
 * A ledger: the payer's nonce unconsumed on the asset throughout, the heads at BASE+40/45/50, and each block's time
 * before `validBefore`, or past it where `lapsed`, so that only a hold keeps a lapsed authorization from `failed`.
 */
function chainWith(txs: ChainTx[], call?: Chain["call"], lapsed = false): Chain {
  return {
    network: NETWORK,
    heads: { finalized: BASE + 40n, safe: BASE + 45n, latest: BASE + 50n },
    time: (b) => (lapsed ? VALID_BEFORE : 1_700_000_000n) + b,
    txs,
    call: async (to, data, block) => {
      if (data.startsWith("0xe94a0102")) return wordOf(0n); // authorizationState: unused on the asset
      if (call !== undefined) return call(to, data, block);
      throw new Error("execution reverted");
    },
  };
}

/** `name()` and `version()` of the other contract, as a token that publishes them answers. */
const namedOther = (name: string, version: string): Chain["call"] => async (_to, data) => {
  if (data === "0x06fdde03") return abiStringOf(name);
  if (data === "0x54fd4d50") return abiStringOf(version);
  throw new Error("execution reverted");
};

const query = { act: "payment", finality: "finalized", after: BASE } as const;

/** An EIP-712 domain of the other contract, the members viem's `signTypedData` takes. */
const otherDomain = { name: "Other", version: "1", chainId: CHAIN_ID, verifyingContract: OTHER_TOKEN } as const;
/** A domain `salt`, as some deployed tokens sign under one: a constructed word. */
const SALT = `0x${"5a".repeat(32)}` as Hex;
/** A contract account of the payer's, whose owner is the other key. */
const SMART = "0x0000000000000000000000000000000000005a5a" as Hex;

/** The authorization from `from`, signed by `signer` in `domain`. */
async function signedIn(signer: typeof payer, from: string, domain: Parameters<typeof hashTypedData>[0]["domain"]) {
  const message = { from: from as ViemHex, to: PAYEE, value: VALUE, validAfter: 0n, validBefore: VALID_BEFORE, nonce: H };
  return { message, signature: await signer.signTypedData({ domain: domain!, types: TYPES, primaryType: "TransferWithAuthorization", message }) };
}

/** The other contract's answers where it states its domain by EIP-5267, and, for a four-member domain, its name and version. */
function stating(domain: { name: string; version: string; chainId: number; verifyingContract: Hex; salt?: Hex }): Chain["call"] {
  const fields = domain.salt === undefined ? "0x0f" : "0x1f";
  const answer = encodeFunctionResult({
    abi: EIP5267_ABI,
    functionName: "eip712Domain",
    result: [fields, domain.name, domain.version, BigInt(domain.chainId), domain.verifyingContract, domain.salt ?? `0x${"00".repeat(32)}`, []],
  }) as Hex;
  return async (to, data, block) => (data === "0x84b0196e" ? answer : namedOther(domain.name, domain.version)!(to, data, block));
}

/** The other contract's answers where it publishes `DOMAIN_SEPARATOR()`, its four-member domain's, as FiatTokenV2_2 does. */
function publishing(name: string, version: string): Chain["call"] {
  const separator = domainSeparator({ domain: { name, version, chainId: CHAIN_ID, verifyingContract: OTHER_TOKEN } }) as Hex;
  return async (to, data, block) => (data === "0x3644e515" ? separator : namedOther(name, version)!(to, data, block));
}

/** The contract account's ERC-1271 `isValidSignature(hash, signature)`: the magic value where its owner signed `hash`. */
async function smartAccount(data: Hex): Promise<Hex> {
  const { functionName, args } = decodeFunctionData({ abi: ERC1271_ABI, data });
  if (functionName !== "isValidSignature") throw new Error("execution reverted");
  const signer = await recoverAddress({ hash: args[0], signature: args[1] });
  return (signer === other.address ? "0x1626ba7e" + "00".repeat(28) : `0x${"ff".repeat(32)}`) as Hex;
}


describe("x402/exact/eip155/eip3009: a use on another contract than the asset", () => {
  it("counts where the payer's signature verifies in that contract's own domain", async () => {
    const m = await signed(payer, OTHER_TOKEN, "Other", "1");
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], namedOther("Other", "1"))), query);
    // The payer's act carrying H that names the payee's account: settled, its token not the one presented.
    expect(a).toMatchObject({ state: "settled", transaction: T1, presented: "no" });
  });

  // The cases below read the authorization lapsed, so that a use the read wrongly took for nothing would let it answer
  // `failed`, `instrument-unused`, for a payment that landed on another token.
  it("holds the search, never failed, where the payer signed under a domain with a salt that the contract does not state", async () => {
    const m = await signedIn(payer, payer.address, { ...otherDomain, salt: SALT });
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], namedOther("Other", "1"), true)), query);
    expect(a).toEqual({ state: "pending", reason: "search-incomplete", search: BASE + 10n, undecoded: [T1], foreign: [] });
  });

  it("counts where the contract states that domain by EIP-5267's eip712Domain()", async () => {
    const m = await signedIn(payer, payer.address, { ...otherDomain, salt: SALT });
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], stating({ ...otherDomain, salt: SALT }), true)), query);
    expect(a).toMatchObject({ state: "settled", transaction: T1, presented: "no" });
  });

  it("counts where the payer is a contract account whose ERC-1271 check accepts the signature", async () => {
    // The account accepts its owner's ECDSA signature over the digest it is asked about; the owner is another key.
    const m = await signedIn(other, SMART, otherDomain);
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN, SMART), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    const call: Chain["call"] = async (to, data, block) => (to.toLowerCase() === SMART ? smartAccount(data) : namedOther("Other", "1")!(to, data, block));
    const smartRef = { ...ref, payer: SMART, presented: { ...ref.presented, from: SMART } };
    const a = await exactEip3009.status(smartRef as never, readerOf(chainWith([tx], call, true)), query);
    expect(a).toMatchObject({ state: "settled", transaction: T1, signer: SMART, presented: "no" });
  });

  it("holds the search where the signature verifies only in another domain, as the asset's, and the contract states none", async () => {
    const m = await signed(payer, ASSET, "USDC", "2");
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], namedOther("USDC", "2"), true)), query);
    expect(a).toEqual({ state: "pending", reason: "search-incomplete", search: BASE + 10n, undecoded: [T1], foreign: [] });
  });

  it("counts for nothing where the contract publishes its separator, the signature verifies only in the asset's domain, and the payer has no code", async () => {
    const m = await signed(payer, ASSET, "USDC", "2");
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], publishing("USDC", "2"), true)), query);
    expect(a).toEqual({ state: "failed", reason: "instrument-unused", finality: "finalized", foreign: [] });
  });

  it("counts for nothing where the contract's domain is known and another key signed it", async () => {
    const m = await signed(other, OTHER_TOKEN, "Other", "1");
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    expect(await exactEip3009.status(ref as never, readerOf(chainWith([tx], publishing("Other", "1"), true)), query)).toEqual({
      state: "failed",
      reason: "instrument-unused",
      finality: "finalized",
      foreign: [],
    });
    // Where the contract states nothing of its domain, the read cannot show it is not the payer's: it holds.
    expect(await exactEip3009.status(ref as never, readerOf(chainWith([tx], namedOther("Other", "1"), true)), query)).toMatchObject({
      state: "pending",
      reason: "search-incomplete",
      undecoded: [T1],
    });
  });

  it("holds the search where its signature is not 65 bytes, as a contract account's is", async () => {
    const { from, to, value, validAfter, validBefore, nonce } = (await signed(payer, OTHER_TOKEN, "Other", "1")).message;
    const input = encodeFunctionData({
      abi: EIP3009_ABI,
      functionName: "transferWithAuthorization",
      args: [from, to, value, validAfter, validBefore, nonce, `0x${"01".repeat(97)}`],
    });
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: input as Hex };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], namedOther("Other", "1"), true)), query);
    expect(a).toEqual({ state: "pending", reason: "search-incomplete", search: BASE + 10n, undecoded: [T1], foreign: [] });
  });

  it("holds the search where the contract answers no name()", async () => {
    const m = await signed(payer, OTHER_TOKEN, "Other", "1");
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: vrsCall(m) as Hex };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], undefined, true)), query);
    expect(a).toEqual({ state: "pending", reason: "search-incomplete", search: BASE + 10n, undecoded: [T1], foreign: [] });
  });

  it("holds the search where the transaction's input holds no call that consumed it", async () => {
    const tx: ChainTx = { hash: T1, block: BASE + 10n, status: 1, logs: useLogs(OTHER_TOKEN), to: OTHER_TOKEN, input: "0x" };
    const a = await exactEip3009.status(ref as never, readerOf(chainWith([tx], namedOther("Other", "1"), true)), query);
    expect(a).toMatchObject({ state: "pending", reason: "search-incomplete", undecoded: [T1] });
  });
});

describe("x402/exact/eip155/erc7710: the transaction a report names, read with no single-use value", () => {
  const delegator = payer.address.toLowerCase() as Hex;
  const ref7710 = { network: NETWORK, payee: PAYEE, h: H, payer: delegator, asset: ASSET, transaction: T1 };
  const transfer = (to: Hex) => useLogs(ASSET).slice(1).map((l) => ({ ...l, topics: [l.topics[0]!, l.topics[1]!, `0x${"00".repeat(12)}${to.slice(2)}` as Hex] }));
  const ledger = (tx: ChainTx): Chain => ({ ...chainWith([tx]), heads: { finalized: BASE + 40n, safe: BASE + 40n, latest: BASE + 50n } });
  const read = (tx: ChainTx, q: object = { act: "payment", finality: "finalized", after: BASE }) =>
    exactErc7710.status!(ref7710 as never, readerOf(ledger(tx)), q as never);

  it("is settled where it holds a Transfer from the delegator to the payee's account", async () => {
    expect(await read({ hash: T1, block: BASE + 10n, status: 1, logs: transfer(PAYEE) })).toMatchObject({ state: "settled", transaction: T1 });
  });

  it("is pending search-incomplete where it reverted, its redemption's transfer to the payee's account, never instrument-live", async () => {
    // The ERC-20 transfer the delegation's execution carries, as viem encodes it inside the redemption's calldata.
    const execution = encodeFunctionData({ abi: parseAbi(["function transfer(address to, uint256 value)"]), functionName: "transfer", args: [PAYEE, VALUE] });
    const input = `0xcafe0000${execution.slice(2)}` as Hex;
    expect(await read({ hash: T1, block: BASE + 10n, status: 0, logs: [], input })).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
  });

  it("is pending not-found where it holds no transfer to the payee's account", async () => {
    expect(await read({ hash: T1, block: BASE + 10n, status: 1, logs: transfer("0x00000000000000000000000000000000000e15e1" as Hex) })).toEqual({
      state: "pending",
      reason: "not-found",
      foreign: [],
    });
  });

  it("is pending not-found where the caller gave it as another act", async () => {
    const q = { act: "payment", finality: "finalized", after: BASE, others: [{ transaction: T1 }] };
    expect(await read({ hash: T1, block: BASE + 10n, status: 1, logs: transfer(PAYEE) }, q)).toEqual({ state: "pending", reason: "not-found", foreign: [] });
  });

  it("is pending not-found where the caller gave another act by a reference that names it", async () => {
    // The agreement's reference, which names the transaction its settler reported: that transaction is the agreement's.
    const q = { act: "payment", finality: "finalized", after: BASE, others: [{ ref: { ...ref7710, transaction: T1 } }] };
    expect(await read({ hash: T1, block: BASE + 10n, status: 1, logs: transfer(PAYEE) }, q)).toEqual({ state: "pending", reason: "not-found", foreign: [] });
  });
});

describe("x402/exact/eip155/erc7710 on Arc: the asset contract's own Transfer, never the system log", () => {
  // Arc's documentation, *USDC system events* (read on 2026-11-16): a USDC transfer emits the system emitter's
  // `Transfer`, in 18 decimals and first, beside the USDC contract's own in 6; a plain native send emits it alone.
  const ARC = "eip155:5042002" as const;
  const USDC = "0x3600000000000000000000000000000000000000" as Hex;
  const delegator = payer.address.toLowerCase() as Hex;
  const topics = encodeEventTopics({ abi: EIP3009_ABI, eventName: "Transfer", args: { from: payer.address, to: PAYEE } }) as Hex[];
  const amount = (n: bigint) => encodeAbiParameters([{ type: "uint256" }], [n]) as Hex;
  const system = { address: SYSTEM_TRANSFER_EMITTER, topics, data: amount(VALUE * 10n ** 12n) };
  const own = { address: USDC, topics, data: amount(VALUE) };
  const read = (logs: ChainTx["logs"]) =>
    exactErc7710.status!(
      { network: ARC, payee: PAYEE, h: H, payer: delegator, asset: USDC, transaction: T1 } as never,
      readerOf({ ...chainWith([{ hash: T1, block: BASE + 10n, status: 1, logs }]), network: ARC }),
      query as never,
    );

  it("records the USDC contract's own Transfer alone as what moved, and takes a native send's system log as no transfer", async () => {
    expect(await read([system, own])).toEqual({
      state: "settled",
      transaction: T1,
      finality: "finalized",
      position: BASE + 10n,
      signer: delegator,
      foreign: [],
      moved: [{ asset: USDC, amount: VALUE.toString(), to: PAYEE, transaction: T1, place: 1 }],
    });
    expect(await read([system])).toEqual({ state: "pending", reason: "not-found", foreign: [] });
  });
});

describe("x402/auth-capture/eip155/eip3009: the escrow's event counts through the deployment's collector alone", () => {
  // The escrow's `PaymentAuthorized(bytes32 indexed paymentInfoHash, PaymentInfo, uint256 amount, address tokenCollector)`
  // (base/commerce-payments `AuthCaptureEscrow.sol`), its data encoded by viem: `PaymentInfo`'s twelve words, the
  // amount and the collector. The payment hash is a constructed word: the read compares it, never recomputes it.
  const d = ESCROW["v1.1"];
  const delegator = payer.address.toLowerCase() as Hex;
  const id = `0x${"1d".repeat(32)}` as Hex;
  const INFO = ["address", "address", "address", "address", "uint120", "uint48", "uint48", "uint48", "uint16", "uint16", "address", "uint256"];
  const authorized = (collector: string, salt: Hex = H) => ({
    address: d.escrow.toLowerCase() as Hex,
    topics: [PAYMENT_AUTHORIZED_TOPIC as Hex, id],
    data: encodeAbiParameters(
      [...INFO, "uint256", "address"].map((type) => ({ type })),
      [PAYEE, delegator, PAYEE, ASSET, VALUE, 1_790_000_000, 1_790_000_001, 1_790_000_002, 0, 0, `0x${"00".repeat(20)}`, BigInt(salt), VALUE, collector],
    ) as Hex,
  });
  const refAc = {
    network: NETWORK, payee: PAYEE, h: H, scheme: "eip3009", asset: ASSET, payer: delegator, escrow: d.escrow.toLowerCase(),
    event: PAYMENT_AUTHORIZED_TOPIC, paymentId: id, signatureNonce: `0x${"2e".repeat(32)}`, salt: H, expiry: "1790000000",
  };
  const read = (collector: string) =>
    authCaptureEip3009.status!(refAc as never, readerOf(chainWith([{ hash: T1, block: BASE + 10n, status: 1, logs: [authorized(collector)] }])), query as never);

  it("settles on the deployment's EIP-3009 collector, and names one through another collector as an act of another kind", async () => {
    expect(await read(d.eip3009Collector)).toMatchObject({ state: "settled", transaction: T1, presented: "yes" });
    expect(await read(d.permit2Collector)).toMatchObject({ state: "pending", foreign: [{ transaction: T1, reason: "other-kind" }] });
  });

  it("fetches no receipt for an escrow event of another payment: the search keeps only the entries whose salt is the reference's", async () => {
    // Every user's payments emit the escrow's events; a search reads them by topic, and tests each entry's salt
    // (PaymentInfo word 11) before it reads that transaction.
    const T2 = `0x${"22".repeat(32)}` as Hex;
    const others = Array.from({ length: 5 }, (_, i): ChainTx => ({
      hash: `0x${(0x30 + i).toString(16).repeat(32)}` as Hex,
      block: BASE + 1n + BigInt(i),
      status: 1,
      logs: [authorized(d.eip3009Collector, `0x${"77".repeat(31)}${(0x10 + i).toString(16)}` as Hex)],
    }));
    const undecodable: ChainTx = { hash: T2, block: BASE + 20n, status: 1, logs: [{ ...authorized(d.eip3009Collector), data: "0x" }] };
    const r = readerOf(chainWith([...others, { hash: T1, block: BASE + 10n, status: 1, logs: [authorized(d.eip3009Collector)] }, undecodable]));
    const a = await authCaptureEip3009.status!(refAc as never, r, query as never);
    // The event whose data the read cannot decode is kept, and holds the search.
    expect(a).toMatchObject({ state: "settled", transaction: T1 });
    expect(r.asked.filter((x) => x.startsWith("receipt"))).toEqual([`receipt ${T1}`, `receipt ${T2}`]);
  });
});

describe("x402/exact/eip155/eip3009: the search's pages", () => {
  // The payer's use on the asset at block 20,000, searched from block 1: pages of 10,000 blocks, halved where the
  // endpoint refuses a range, as a public endpoint does above 10,000 blocks.
  const deep = async (maxRange: bigint, lowest?: bigint) => {
    const m = await signed(payer, ASSET, "USDC", "2");
    const tx: ChainTx = { hash: T1, block: 20_000n, status: 1, logs: useLogs(ASSET), to: ASSET, input: vrsCall(m) as Hex };
    const r = readerOf({ ...chainWith([tx]), heads: { finalized: 25_000n, safe: 25_000n, latest: 25_000n }, maxRange, ...(lowest === undefined ? {} : { lowest }) });
    return { answer: await exactEip3009.status(ref as never, r, { act: "payment", finality: "finalized", after: 0n } as never), asked: r.asked.filter((a) => a.startsWith("logs")) };
  };

  it("halves a page the endpoint refuses until it takes one, and finds the act beyond it", async () => {
    const { answer, asked } = await deep(3_000n);
    expect(answer).toMatchObject({ state: "settled", transaction: T1, position: 20_000n });
    expect(asked.slice(0, 3)).toEqual(["logs * 1-10000", "logs * 1-5000", "logs * 1-2500"]);
  });

  it("reads a range refused at one block as unreadable transport, never as absence", async () => {
    expect((await deep(0n)).answer).toEqual({ state: "unreadable", reason: "transport", foreign: [] });
  });

  it("reads a range below the endpoint's lowest block as a history gap", async () => {
    expect((await deep(10_000n, 5_000n)).answer).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });
});

describe("x402/exact/eip155/permit2: a proxy call wrapped in another contract's call", () => {
  // The `exact` proxy's `settle`, as `@x402/evm` 2.31.0's `x402ExactPermit2ProxyABI` encodes it, inside a call to
  // another contract; the payer's Permit2 bit for H (word H >> 8, bit H & 0xff) set from the transaction's block.
  const owner = payer.address.toLowerCase() as Hex;
  const proxy = EXACT_PERMIT2_PROXY.toLowerCase() as Hex;
  const WRAPPER = "0x000000000000000000000000000000000000a9a9" as Hex;
  const settle = encodeFunctionData({
    abi: x402ExactPermit2ProxyABI,
    functionName: "settle",
    args: [{ permitted: { token: ASSET, amount: VALUE }, nonce: BigInt(H), deadline: VALID_BEFORE }, owner, { to: PAYEE, validAfter: 0n }, `0x${"11".repeat(65)}`],
  } as never);
  const input = `0xdeadbeef${"00".repeat(28)}${settle.slice(2)}` as Hex;
  const transfer = encodeEventTopics({ abi: EIP3009_ABI, eventName: "Transfer", args: { from: payer.address, to: PAYEE } }) as Hex[];
  const paid = { address: ASSET, topics: transfer, data: encodeAbiParameters([{ type: "uint256" }], [VALUE]) as Hex };
  const presented = { token: ASSET, amount: VALUE.toString(), nonce: H, deadline: VALID_BEFORE.toString(), spender: proxy, owner, to: PAYEE, validAfter: "0" };
  const bit: Chain["call"] = async (_to, data, block) => {
    if (!data.startsWith("0x4fe02b44")) throw new Error("execution reverted");
    return wordOf(block >= BASE + 10n ? 1n << (BigInt(H) & 0xffn) : 0n);
  };
  const read = (logs: ChainTx["logs"], p: object = presented) =>
    exactPermit2.status!(
      { network: NETWORK, payee: PAYEE, h: H, asset: ASSET, payer: owner, deadline: VALID_BEFORE.toString(), presented: p } as never,
      readerOf(chainWith([{ hash: T1, block: BASE + 10n, status: 1, logs, from: PAYEE, to: WRAPPER, input }], bit)),
      query as never,
    );

  it("holds on a transaction with two calls of the owner over one nonce that differ, though each has its transfer", async () => {
    const ELSE = "0x00000000000000000000000000000000000e15e1" as Hex;
    const second = encodeFunctionData({
      abi: x402ExactPermit2ProxyABI,
      functionName: "settle",
      args: [{ permitted: { token: ASSET, amount: VALUE }, nonce: BigInt(H), deadline: VALID_BEFORE }, owner, { to: ELSE, validAfter: 0n }, `0x${"11".repeat(65)}`],
    } as never);
    const both = `${input}${second.slice(2)}` as Hex;
    const toElse = { ...paid, topics: [paid.topics[0]!, paid.topics[1]!, `0x${"00".repeat(12)}${ELSE.slice(2)}` as Hex] };
    const a = await exactPermit2.status!(
      { network: NETWORK, payee: PAYEE, h: H, asset: ASSET, payer: owner, deadline: VALID_BEFORE.toString(), presented } as never,
      readerOf(chainWith([{ hash: T1, block: BASE + 10n, status: 1, logs: [paid, toElse], from: PAYEE, to: WRAPPER, input: both }], bit)),
      query as never,
    );
    // The bit is H's own carrier and reads consumed; the transaction that consumed it is not shown.
    expect(a).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
    // A copy of the one call is that call.
    expect(
      await exactPermit2.status!(
        { network: NETWORK, payee: PAYEE, h: H, asset: ASSET, payer: owner, deadline: VALID_BEFORE.toString(), presented } as never,
        readerOf(chainWith([{ hash: T1, block: BASE + 10n, status: 1, logs: [paid], from: PAYEE, to: WRAPPER, input: `${input}${settle.slice(2)}` as Hex }], bit)),
        query as never,
      ),
    ).toMatchObject({ state: "settled", transaction: T1 });
  });

  it("reads presented from the transfer and the bit where the transaction holds one of each, and unshown beside a second transfer", async () => {
    expect(await read([paid])).toMatchObject({ state: "settled", transaction: T1, presented: "yes" });
    expect(await read([paid], { ...presented, amount: (VALUE + 1n).toString() })).toMatchObject({ state: "settled", presented: "no" });
    expect(await read([paid, paid])).toMatchObject({ state: "settled", transaction: T1, presented: "unshown" });
  });
});

describe("the x402 eip155 reads refuse a reference they cannot read, with nothing read", () => {
  it("a network that is not eip155 and a chain id: unreadable unparseable, whatever the reader's network", async () => {
    const odd = "eip155:base" as `eip155:${string}`;
    const delegator = payer.address.toLowerCase() as Hex;
    const refs: [string, (r: never, reader: never, q: never) => Promise<unknown>, object][] = [
      ["eip3009", exactEip3009.status as never, ref],
      ["permit2", exactPermit2.status as never, { network: NETWORK, payee: PAYEE, h: H, asset: ASSET, payer: delegator, deadline: "1", presented: { token: ASSET, amount: "1", nonce: H, deadline: "1", spender: ASSET, owner: delegator, to: PAYEE, validAfter: "0" } }],
      ["auth-capture", authCaptureEip3009.status as never, { network: NETWORK, payee: PAYEE, h: H, scheme: "eip3009", asset: ASSET, payer: delegator, escrow: ESCROW["v1.1"].escrow, event: PAYMENT_AUTHORIZED_TOPIC, paymentId: H, signatureNonce: H, salt: H, expiry: "1" }],
      ["erc7710", exactErc7710.status as never, { network: NETWORK, payee: PAYEE, h: H, payer: delegator, asset: ASSET, transaction: T1 }],
    ];
    for (const [name, status, r] of refs) {
      const reader = readerOf({ ...chainWith([]), network: odd });
      expect([name, await status({ ...r, network: odd } as never, reader as never, query as never)]).toEqual([name, { state: "unreadable", reason: "unparseable", foreign: [] }]);
      expect([name, reader.asked]).toEqual([name, []]);
    }
  });
});

describe("a value read consumed whose transaction the search after the position given did not meet", () => {
  // The payer's nonce consumed on the asset by a use at block 500, below the position given, 900.
  const USED_AT = 500n;
  const below = { act: "payment", finality: "finalized", after: 900n } as const;
  const used = (lowest = 0n, txs: ChainTx[] = [{ hash: T1, block: USED_AT, status: 1, logs: useLogs(ASSET), from: payer.address.toLowerCase() as Hex, to: ASSET }]): Chain => ({
    ...chainWith(txs),
    call: async (_to, data, block) => {
      if (!data.startsWith("0xe94a0102")) throw new Error("execution reverted");
      if (block < lowest) throw new ReaderError("history");
      return wordOf(block >= USED_AT ? 1n : 0n);
    },
  });

  it("names the use in the first block the nonce reads consumed at, found by halving below the position: before-position", async () => {
    const reader = readerOf(used());
    expect(await exactEip3009.status!(ref as never, reader, below as never)).toMatchObject({
      state: "failed",
      reason: "before-position",
      transaction: T1,
      finality: "finalized",
      position: USED_AT,
      signer: payer.address.toLowerCase(),
      foreign: [],
    });
    // The asset's own logs of the payer's nonce, in that one block.
    expect(reader.asked.filter((x) => x.startsWith("logs ") && x.endsWith(` ${USED_AT}-${USED_AT}`))).toEqual([`logs ${ASSET} ${USED_AT}-${USED_AT}`, `logs ${ASSET} ${USED_AT}-${USED_AT}`]);
  });

  it("answers search-incomplete where that block holds no log naming the use, and history-gap where a halving's block is not held", async () => {
    expect(await exactEip3009.status!(ref as never, readerOf(used(0n, [])), below as never)).toEqual({ state: "pending", reason: "search-incomplete", foreign: [] });
    expect(await exactEip3009.status!(ref as never, readerOf(used(700n)), below as never)).toEqual({ state: "unreadable", reason: "history-gap", foreign: [] });
  });
});
