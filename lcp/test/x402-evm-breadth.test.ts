// The EVM-breadth pairings against their vector files. Every expected value is the files'.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeFunctionData,
  domainSeparator,
  hashStruct,
  hashTypedData,
  keccak256,
  parseAbi,
  toBytes,
  toFunctionSelector,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AtrHash } from "../src/index.js";
import {
  ESCROW,
  EXACT_PERMIT2_PROXY,
  NONCE_BITMAP_SELECTOR,
  PERMIT2,
  PAYMENT_AUTHORIZED_TOPIC,
  PAYMENT_INFO_TYPEHASH,
  ReaderError,
  REDEEMED_DELEGATION_TOPIC,
  SALT_BINDING_TYPEHASH,
  TRANSFER_TOPIC,
  UPTO_PERMIT2_PROXY,
  bindSalt,
  evmStatus,
  paymentHash,
  permit2TypedData,
  transferDigest,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type Hex,
  type PaymentInfo,
} from "../src/evm.js";
import {
  LEGAL_CONTEXT_SCHEMA,
  authCaptureEip3009,
  authCapturePermit2,
  exactErc7710,
  exactErc7710Salt,
  exactPermit2,
  pairingOfPayment,
  uptoPermit2,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Unsigned,
} from "../src/x402.js";
import { pairingOf } from "../src/index.js";
import { rowsOf } from "./rows.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const P2 = load("x402-exact-eip155-permit2.json");
const UP = load("x402-upto-eip155-permit2.json");
const ERC7710 = load("x402-exact-eip155-erc7710.json");
const ES = load("x402-exact-eip155-erc7710-salt.json");
const A3 = load("x402-auth-capture-eip155-eip3009.json");
const AP = load("x402-auth-capture-eip155-permit2.json");
const H: AtrHash = P2.fixed.H;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const sha256 = (hex: string) => "0x" + createHash("sha256").update(Buffer.from(hex.slice(2), "hex")).digest("hex");
const matches = (v: string, p: { prefix: string; suffix: string }) => v.startsWith(p.prefix) && v.endsWith(p.suffix);

type Fixed = { option: PaymentRequirements; payer: Hex; payerKey: Hex; now: number; resource: { url: string }; link: string };
function documentOf(f: Fixed): PaymentRequired {
  return {
    x402Version: 2,
    resource: f.resource,
    accepts: [f.option],
    extensions: { legalContext: { info: { type: "sha256", value: H, legalContextUrl: f.link }, schema: LEGAL_CONTEXT_SCHEMA } },
  };
}
async function unsigned(b: { build: typeof exactPermit2.build }, f: Fixed, option = f.option): Promise<X402Unsigned> {
  const doc = { ...documentOf(f), accepts: [option] };
  const u = await b.build({ required: doc, accepted: option, from: f.payer, now: f.now }, H);
  if ("refused" in u) throw new Error(u.code);
  return u;
}
async function signed(b: { build: typeof exactPermit2.build }, f: Fixed, option = f.option): Promise<PaymentPayload> {
  const u = await unsigned(b, f, option);
  if (u.request.kind !== "eip712") throw new Error("not eip712");
  const sig = await privateKeyToAccount(f.payerKey).signTypedData(u.request.typedData as TypedDataDefinition);
  const p = (u.complete as (s: Hex) => PaymentPayload | { refused: true })(sig);
  if ("refused" in p) throw new Error("complete refused");
  return p;
}
type FixtureReceipt = { status: 0 | 1; blockNumber: string; logs: EvmReceipt["logs"] } | null;
/**
 * A reader answering one receipt and the finalized and safe marks. Each `eth_call` is recorded in `calls` and answered
 * with `word`; without one, or with "reader-error", it rejects.
 */
function readerFor(
  r: FixtureReceipt,
  at: { network: string; finalized: string; safe: string },
  word?: string,
  calls: { to: string; data: string; block: string }[] = [],
): EvmReader {
  return {
    network: at.network as `eip155:${string}`,
    receipt: async () => (r === null ? null : { status: r.status, blockNumber: BigInt(r.blockNumber), logs: r.logs }),
    blockNumber: async (tag) => BigInt(tag === "finalized" ? at.finalized : at.safe),
    transaction: async () => null,
    call: async (to, data, block) => {
      calls.push({ to, data, block: block.toString() });
      if (word === undefined || word === "reader-error") throw new ReaderError("transport");
      return word as Hex;
    },
  };
}
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

type Permit2Row = {
  receipt: FixtureReceipt;
  input?: string | null;
  nonceBitmap?: string;
  nonceBitmapBefore?: string;
  calls: number;
};
/**
 * A reader for a Permit2 status row: its receipt; its transaction, from the payer to `to`, whose input is the file's
 * `inputs[row.input]` (none for null, a rejection for "reader-error"); and Permit2's words, `nonceBitmap` at the
 * receipt's block and `nonceBitmapBefore` at the block before. Each `eth_call` is recorded in `calls`.
 */
function permit2Reader(
  row: Permit2Row,
  ev: { reader: { network: string; finalized: string; safe: string }; inputs: Record<string, string> },
  to: Hex,
  calls: { to: string; data: string; block: string }[],
): EvmReader {
  const base = readerFor(row.receipt, ev.reader);
  return {
    ...base,
    transaction: async () => {
      if (row.input === "reader-error") throw new ReaderError("transport");
      if (row.input === null || row.input === undefined) return null;
      return { from: P2.fixed.payer, to, input: ev.inputs[row.input] as Hex };
    },
    call: async (to, data, block) => {
      calls.push({ to, data, block: block.toString() });
      const at = row.receipt === null ? undefined : BigInt(row.receipt.blockNumber);
      const word = block === at ? row.nonceBitmap : row.nonceBitmapBefore;
      if (word === undefined || word === "reader-error") throw new ReaderError("transport");
      return word as Hex;
    },
  };
}
/** The byte offsets at which `input` holds the 32 bytes of `h`. */
function offsetsOf(input: string, h: string): number[] {
  const hay = input.slice(2).toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(h.slice(2)); i >= 0; i = hay.indexOf(h.slice(2), i + 1)) if (i % 2 === 0) out.push(i / 2);
  return out;
}
/** The x402 Permit2 proxies' `settle` (x402 contracts/evm/src/x402ExactPermit2Proxy.sol, x402UptoPermit2Proxy.sol). */
const PERMIT = {
  name: "permit",
  type: "tuple",
  components: [
    { name: "permitted", type: "tuple", components: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }] },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const SETTLE_EXACT = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      PERMIT,
      { name: "owner", type: "address" },
      { name: "witness", type: "tuple", components: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }] },
      { name: "signature", type: "bytes" },
    ],
  },
] as const;
const SETTLE_UPTO = [
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      PERMIT,
      { name: "amount", type: "uint256" },
      { name: "owner", type: "address" },
      {
        name: "witness",
        type: "tuple",
        components: [{ name: "to", type: "address" }, { name: "facilitator", type: "address" }, { name: "validAfter", type: "uint256" }],
      },
      { name: "signature", type: "bytes" },
    ],
  },
] as const;
const ERC20 = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
]);
const MULTICALL3 = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "function aggregate3(Call3[] calls) payable returns ((bool success, bytes returnData)[])",
]);

describe("x402-exact-eip155-permit2.json", () => {
  const f: Fixed = P2.fixed;
  it("pairingOf names the pairing", () => expect(pairingOf(f.option)).toBe("x402/exact/eip155/permit2"));
  // EV1's digest is eth-account's, over types written from Permit2's PermitHash.sol and EIP712.sol (Uniswap/permit2
  // cc56ad0f) and the x402 exact proxy's Witness (x402 751590a2, scheme_exact_evm.md L378-383). viem re-derives it from
  // the same types written here, and build's typed data is held to it.
  it("EV1: the typed data, its digest as Permit2's witness types give it, and the Anvil key's signature", async () => {
    const written = {
      domain: { name: "Permit2", chainId: 84532, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      types: {
        TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
        Witness: [{ name: "to", type: "address" }, { name: "validAfter", type: "uint256" }],
        PermitWitnessTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "witness", type: "Witness" },
        ],
      },
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: f.option.asset, amount: BigInt(f.option.amount) },
        spender: P2.EV1.expectSpender,
        nonce: BigInt(H),
        deadline: BigInt(f.now + f.option.maxTimeoutSeconds),
        witness: { to: f.option.payTo, validAfter: 0n },
      },
    } as TypedDataDefinition;
    expect(hashTypedData(written)).toBe(P2.EV1.expectDigest);
    expect(await privateKeyToAccount(f.payerKey).signTypedData(written)).toBe(P2.EV1.expectSignature);
    const u = await unsigned(exactPermit2, f);
    if (u.request.kind !== "eip712") throw new Error("kind");
    const td = u.request.typedData as any;
    expect(hashTypedData(td as TypedDataDefinition)).toBe(P2.EV1.expectDigest);
    expect(td.message.spender).toBe(P2.EV1.expectSpender);
    expect(td.message.nonce.toString()).toBe(P2.EV1.expectNonceDecimal);
    expect(td.message.deadline.toString()).toBe(P2.EV1.expectDeadline);
    const typeString =
      "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline," +
      P2.EV1.witnessTypeString;
    expect(matches(keccak256(toBytes(typeString)), P2.EV1.expectTypeHash)).toBe(true);
    expect(matches(keccak256(toBytes("Witness(address to,uint256 validAfter)")), P2.EV1.expectWitnessTypeHash)).toBe(true);
    const p = await signed(exactPermit2, f);
    expect((p.payload as { signature: string }).signature).toBe(P2.EV1.expectSignature);
  });
  it("EV1: bound gives H for the decimal nonce and its 0x spelling; the upto proxy as spender is refused", async () => {
    const p = await signed(exactPermit2, f);
    expect(await exactPermit2.bound(p)).toBe(P2.EV1.expectBound);
    const hex = structuredClone(p) as any;
    hex.payload.permit2Authorization.nonce = H;
    expect(await exactPermit2.bound(hex)).toBe(P2.EV1.boundOfHexNonce);
    const upto = structuredClone(p) as any;
    upto.payload.permit2Authorization.spender = P2.EV1.uptoProxyAsSpender.spender;
    expect(await exactPermit2.bound(upto)).toEqual(P2.EV1.uptoProxyAsSpender.expect);
    const bad = structuredClone(p) as any;
    bad.payload.permit2Authorization.nonce = P2.EV1.nonceMalformed.nonce;
    expect(await exactPermit2.bound(bad)).toEqual(P2.EV1.nonceMalformed.expect);
    const ref = (await exactPermit2.reference(p)) as EvmRef;
    expect(ref.transferLog?.digest).toBe(P2.EV1.expectReferenceDigest);
    expect(ref.bindingLog).toBeUndefined();
    expect(ref.search).toBeUndefined();
  });
  it("EV1: the reference names Permit2's record of the nonce, and authorizer the payer", async () => {
    const p = await signed(exactPermit2, f);
    const ref = (await exactPermit2.reference(p)) as EvmRef;
    expect(ref.authorization).toEqual({
      scheme: "permit2",
      at: P2.EV6.expectCall.to,
      nonce: H,
      deadline: P2.EV1.expectDeadline,
      asset: f.option.asset,
    });
    expect(await exactPermit2.authorizer(p)).toBe(f.payer.toLowerCase());
    const bad = structuredClone(p) as any;
    bad.payload.permit2Authorization.spender = P2.EV1.uptoProxyAsSpender.spender;
    expect(await exactPermit2.authorizer(bad)).toEqual(P2.EV1.uptoProxyAsSpender.expect);
  });
  it("EV6: the inputs are the exact proxy's settle call, a batch around it and a plain transfer, as viem encodes them", async () => {
    const p = await signed(exactPermit2, f);
    const a = (p.payload as any).permit2Authorization;
    const settle = encodeFunctionData({
      abi: SETTLE_EXACT,
      functionName: "settle",
      args: [
        { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
        a.from,
        { to: a.witness.to, validAfter: BigInt(a.witness.validAfter) },
        (p.payload as any).signature,
      ],
    });
    expect(P2.EV6.inputs.settle).toBe(settle);
    const approve = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [PERMIT2, 2n ** 256n - 1n] });
    const batched = encodeFunctionData({
      abi: MULTICALL3,
      functionName: "aggregate3",
      args: [[
        { target: f.option.asset as Hex, allowFailure: false, callData: approve },
        { target: EXACT_PERMIT2_PROXY, allowFailure: false, callData: settle },
      ]],
    });
    expect(P2.EV6.inputs.batched).toBe(batched);
    expect(P2.EV6.inputs.plainTransfer).toBe(encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [f.option.payTo as Hex, 10000n] }));
    expect(offsetsOf(settle, H)).toEqual([68]);
    expect(offsetsOf(batched, H)).toEqual([552]);
    expect((552 - 4) % 32).not.toBe(0);
    expect(offsetsOf(P2.EV6.inputs.plainTransfer, H)).toEqual([]);
  });
  it("EV6 and the emitter plant: status of EV1's reference reads the transaction carrying the permit's nonce and Permit2's record of it", async () => {
    const ref = (await exactPermit2.reference(await signed(exactPermit2, f))) as EvmRef;
    const tx = P2.EV6.transaction as Hex;
    const names = [
      "transferAt100",
      "batched",
      "nonceUnused",
      "usedBefore",
      "plainTransfer",
      "callFails",
      "transactionNone",
      "transactionFails",
      "value9999",
      "reverted",
      "none",
    ];
    for (const row of [...names.map((n) => P2.EV6[n]), P2.plantEmitter]) {
      const calls: { to: string; data: string; block: string }[] = [];
      const reader = permit2Reader(row, P2.EV6, EXACT_PERMIT2_PROXY, calls);
      expect(plain(await exactPermit2.status({ ...ref, transaction: tx }, reader)), row.case).toEqual(row.expect);
      expect(calls, row.case).toEqual([P2.EV6.expectCall, P2.EV6.expectCallBefore].slice(0, row.calls));
    }
    const selector = toFunctionSelector("function nonceBitmap(address owner, uint256 wordPos)");
    expect(P2.EV6.expectCall.data.startsWith(selector)).toBe(true);
    expect(P2.EV6.expectCallBefore.data).toBe(P2.EV6.expectCall.data);
    expect(NONCE_BITMAP_SELECTOR).toBe(selector);
  });
  it("status is pending unreadable for a ref without Permit2's record or a transfer naming from", async () => {
    const ref = (await exactPermit2.reference(await signed(exactPermit2, f))) as EvmRef;
    const tx = P2.EV6.transaction as Hex;
    const reader = readerFor(P2.EV6.transferAt100.receipt, P2.EV6.reader, P2.EV6.transferAt100.nonceBitmap);
    const unreadable = { state: "pending", why: "unreadable" };
    const { authorization: _, ...bare } = ref;
    expect(await exactPermit2.status({ ...bare, transaction: tx }, reader)).toEqual(unreadable);
    const eip3009 = { ...ref, authorization: { ...ref.authorization!, scheme: "eip3009" as const } };
    expect(await exactPermit2.status({ ...eip3009, transaction: tx }, reader)).toEqual(unreadable);
    const toOnly = { ...ref, transferLog: { ...ref.transferLog!, identity: "to,value" as const } };
    expect(await exactPermit2.status({ ...toOnly, transaction: tx }, reader)).toEqual(unreadable);
  });
});

describe("x402-upto-eip155-permit2.json", () => {
  const f: Fixed = UP.fixed;
  it("EV2: digest, witness, bound and the from,to identity", async () => {
    expect(pairingOf(f.option)).toBe("x402/upto/eip155/permit2");
    const u = await unsigned(uptoPermit2, f);
    if (u.request.kind !== "eip712") throw new Error("kind");
    expect(hashTypedData(u.request.typedData as TypedDataDefinition)).toBe(UP.EV2.expectDigest);
    expect((u.request.typedData.message as any).spender).toBe(UP.EV2.expectSpender);
    expect(
      matches(keccak256(toBytes("Witness(address to,address facilitator,uint256 validAfter)")), UP.EV2.expectWitnessTypeHash),
    ).toBe(true);
    const p = await signed(uptoPermit2, f);
    const a = (p.payload as any).permit2Authorization;
    expect(a.nonce).toBe(UP.EV2.expectNonceHex);
    expect(a.deadline).toBe(UP.EV2.expectDeadline);
    expect(await uptoPermit2.bound(p)).toBe(UP.EV2.expectBound);
    const ref = plain(await uptoPermit2.reference(p));
    expect(ref.transferLog.identity).toBe(UP.EV2.expectReference.identity);
    expect(ref.transferLog.digest).toBe(UP.EV2.expectReference.digest);
    expect(ref.settleBy).toBe(UP.EV2.expectReference.settleBy);
    expect(ref.authorization).toEqual({
      scheme: "permit2",
      at: UP.EV6.expectCall.to,
      nonce: H,
      deadline: UP.EV2.expectDeadline,
      asset: f.option.asset,
    });
    expect(await uptoPermit2.authorizer(p)).toBe(f.payer.toLowerCase());
  });
  it("EV6: the inputs are the upto proxy's settle call for one unit and a plain transfer above the cap, as viem encodes them", async () => {
    const p = await signed(uptoPermit2, f);
    const a = (p.payload as any).permit2Authorization;
    const settle = encodeFunctionData({
      abi: SETTLE_UPTO,
      functionName: "settle",
      args: [
        { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
        1n,
        a.from,
        { to: a.witness.to, facilitator: a.witness.facilitator, validAfter: BigInt(a.witness.validAfter) },
        (p.payload as any).signature,
      ],
    });
    expect(UP.EV6.inputs.settle).toBe(settle);
    expect(offsetsOf(settle, H)).toEqual([68]);
    const above = BigInt(f.option.amount) + 1n;
    expect(UP.EV6.inputs.plainAboveCap).toBe(encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [f.option.payTo as Hex, above] }));
    expect(BigInt(UP.EV6.aboveCapPlain.receipt.logs[0].data)).toBe(above);
    expect(offsetsOf(UP.EV6.inputs.plainAboveCap, H)).toEqual([]);
  });
  it("EV6: a transfer of any amount is this payment's only in the transaction that spends the permit carrying nonce H", async () => {
    const ref = (await uptoPermit2.reference(await signed(uptoPermit2, f))) as EvmRef;
    for (const row of [UP.EV6.oneUnitUsed, UP.EV6.oneUnitUnused, UP.EV6.aboveCapPlain]) {
      const calls: { to: string; data: string; block: string }[] = [];
      const reader = permit2Reader(row, UP.EV6, UPTO_PERMIT2_PROXY, calls);
      expect(plain(await uptoPermit2.status({ ...ref, transaction: UP.EV6.transaction }, reader)), row.case).toEqual(row.expect);
      expect(calls, row.case).toEqual([UP.EV6.expectCall, UP.EV6.expectCallBefore].slice(0, row.calls));
    }
  });
  it("an upto option without facilitatorAddress is refused", async () => {
    const o = structuredClone(f.option) as any;
    delete o.extra.facilitatorAddress;
    const doc = { ...documentOf(f), accepts: [o] };
    expect(uptoPermit2.advertise(doc, H, f.link, o)).toEqual(UP.facilitatorMissing.expect);
    expect(pairingOf(o)).toBeUndefined();
  });
});

// `recover` on the Permit2 pairings reads the transactions EV6 names. The settle and settleWithPermit calls are viem's
// encodings of the proxies' functions (x402 contracts/evm/src/x402ExactPermit2Proxy.sol, x402UptoPermit2Proxy.sol), and
// H is the files' (SHA-256 of "abc", FIPS 180-2).
const SETTLE_WITH_PERMIT_EXACT = [
  {
    type: "function",
    name: "settleWithPermit",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      {
        name: "permit2612",
        type: "tuple",
        components: [
          { name: "value", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "r", type: "bytes32" },
          { name: "s", type: "bytes32" },
          { name: "v", type: "uint8" },
        ],
      },
      ...SETTLE_EXACT[0].inputs,
    ],
  },
] as const;
const SETTLE_WITH_PERMIT_UPTO = [
  { ...SETTLE_WITH_PERMIT_EXACT[0], inputs: [SETTLE_WITH_PERMIT_EXACT[0].inputs[0], ...SETTLE_UPTO[0].inputs] },
] as const;

describe("recover on the Permit2 pairings", () => {
  const ref = { network: P2.EV6.reader.network as `eip155:${string}`, transaction: P2.EV6.transaction as Hex };
  const recoverRow = async (b: typeof exactPermit2 | typeof uptoPermit2, row: Permit2Row, ev: any, to: Hex) => {
    const calls: { to: string; data: string; block: string }[] = [];
    const got = await b.recover({ ...ref, network: ev.reader.network, transaction: ev.transaction }, permit2Reader(row, ev, to, calls));
    return { got, calls };
  };

  it("EV6: H from the settle call in the transaction, directly or in a batch, where status settles; a refusal that names why where it does not", async () => {
    const statusRef = (await exactPermit2.reference(await signed(exactPermit2, P2.fixed))) as EvmRef;
    const expectations: [string, string | { refused: true; code: string }, number][] = [
      ["transferAt100", H, 2],
      ["batched", H, 2],
      ["nonceUnused", { refused: true, code: "evm/nonce-not-used" }, 1],
      ["usedBefore", { refused: true, code: "evm/nonce-not-used" }, 2],
      ["plainTransfer", { refused: true, code: "evm/no-permit2-settle" }, 0],
      ["callFails", { refused: true, code: "evm/unreadable" }, 1],
      ["transactionNone", { refused: true, code: "evm/not-found" }, 0],
      ["transactionFails", { refused: true, code: "evm/unreadable" }, 0],
      ["reverted", { refused: true, code: "evm/reverted" }, 0],
      ["none", { refused: true, code: "evm/not-found" }, 0],
    ];
    for (const [name, expected, n] of expectations) {
      const row = P2.EV6[name];
      const { got, calls } = await recoverRow(exactPermit2, row, P2.EV6, EXACT_PERMIT2_PROXY);
      expect(got, row.case ?? name).toEqual(expected);
      expect(calls, row.case ?? name).toEqual([P2.EV6.expectCall, P2.EV6.expectCallBefore].slice(0, n));
      if (["transferAt100", "batched", "nonceUnused", "usedBefore", "plainTransfer"].includes(name)) {
        const s = await exactPermit2.status({ ...statusRef, transaction: ref.transaction }, permit2Reader(row, P2.EV6, EXACT_PERMIT2_PROXY, []));
        expect(s.state === "settled", name).toBe(got === H);
      }
    }
  });

  it("EV6 upto: H from the upto proxy's settle call; a plain transfer above the cap carries none", async () => {
    const cases: [string, string | { refused: true; code: string }][] = [
      ["oneUnitUsed", H],
      ["oneUnitUnused", { refused: true, code: "evm/nonce-not-used" }],
      ["aboveCapPlain", { refused: true, code: "evm/no-permit2-settle" }],
    ];
    for (const [name, expected] of cases) {
      const { got } = await recoverRow(uptoPermit2, UP.EV6[name], UP.EV6, UPTO_PERMIT2_PROXY);
      expect(got, UP.EV6[name].case).toEqual(expected);
    }
  });

  it("each pairing reads only its own proxy's calls: the exact settle is not the upto pairing's, nor the upto settle the exact pairing's", async () => {
    const asUpto = { ...UP.EV6.oneUnitUsed, input: "exactSettle" };
    const exactInput = { ...UP.EV6, inputs: { ...UP.EV6.inputs, exactSettle: P2.EV6.inputs.settle } };
    expect((await recoverRow(uptoPermit2, asUpto, exactInput, UPTO_PERMIT2_PROXY)).got).toEqual({ refused: true, code: "evm/no-permit2-settle" });
    const asExact = { ...P2.EV6.transferAt100, input: "uptoSettle" };
    const uptoInput = { ...P2.EV6, inputs: { ...P2.EV6.inputs, uptoSettle: UP.EV6.inputs.settle } };
    expect((await recoverRow(exactPermit2, asExact, uptoInput, EXACT_PERMIT2_PROXY)).got).toEqual({ refused: true, code: "evm/no-permit2-settle" });
  });

  it("settleWithPermit: the nonce is read after the EIP-2612 permit's five words", async () => {
    const p = await signed(exactPermit2, P2.fixed);
    const a = (p.payload as any).permit2Authorization;
    const input = encodeFunctionData({
      abi: SETTLE_WITH_PERMIT_EXACT,
      functionName: "settleWithPermit",
      args: [
        { value: BigInt(a.permitted.amount), deadline: BigInt(a.deadline), r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: 27 },
        { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
        a.from,
        { to: a.witness.to, validAfter: BigInt(a.witness.validAfter) },
        (p.payload as any).signature,
      ],
    });
    expect(offsetsOf(input, H)).toEqual([4 + 7 * 32]);
    const ev = { ...P2.EV6, inputs: { ...P2.EV6.inputs, withPermit: input } };
    const { got, calls } = await recoverRow(exactPermit2, { ...P2.EV6.transferAt100, input: "withPermit" }, ev, EXACT_PERMIT2_PROXY);
    expect(got).toBe(H);
    expect(calls).toEqual([P2.EV6.expectCall, P2.EV6.expectCallBefore]);
  });

  // x402UptoPermit2Proxy.sol :89-96 (f8f83309): settleWithPermit(EIP2612Permit, PermitTransferFrom, uint256 amount,
  // address owner, Witness, bytes), so the nonce is argument word 7 and the owner word 10.
  it("upto settleWithPermit: the nonce is read after the EIP-2612 permit's five words, the owner after the settled amount", async () => {
    const p = await signed(uptoPermit2, UP.fixed);
    const a = (p.payload as any).permit2Authorization;
    const input = encodeFunctionData({
      abi: SETTLE_WITH_PERMIT_UPTO,
      functionName: "settleWithPermit",
      args: [
        { value: BigInt(a.permitted.amount), deadline: BigInt(a.deadline), r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, v: 27 },
        { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
        1n,
        a.from,
        { to: a.witness.to, facilitator: a.witness.facilitator, validAfter: BigInt(a.witness.validAfter) },
        (p.payload as any).signature,
      ],
    });
    expect(offsetsOf(input, H)).toEqual([4 + 7 * 32]);
    const ev = { ...UP.EV6, inputs: { ...UP.EV6.inputs, withPermit: input } };
    const { got, calls } = await recoverRow(uptoPermit2, { ...UP.EV6.oneUnitUsed, input: "withPermit" }, ev, UPTO_PERMIT2_PROXY);
    expect(got).toBe(H);
    expect(calls).toEqual([UP.EV6.expectCall, UP.EV6.expectCallBefore]);
  });

  /** The exact proxy's `settle` of EV1's signed permit, with `nonce`, `owner` and `token` in place of its own. */
  const settleWith = async (nonce: bigint, owner?: Hex, token?: Hex) => {
    const p = await signed(exactPermit2, P2.fixed);
    const a = (p.payload as any).permit2Authorization;
    return encodeFunctionData({
      abi: SETTLE_EXACT,
      functionName: "settle",
      args: [
        { permitted: { token: token ?? a.permitted.token, amount: BigInt(a.permitted.amount) }, nonce, deadline: BigInt(a.deadline) },
        owner ?? a.from,
        { to: a.witness.to, validAfter: BigInt(a.witness.validAfter) },
        (p.payload as any).signature,
      ],
    });
  };
  /** Multicall3's `aggregate3` over the exact proxy, each call with its `allowFailure`. */
  const batch = (calls: [Hex, boolean][]) =>
    encodeFunctionData({
      abi: MULTICALL3,
      functionName: "aggregate3",
      args: [calls.map(([callData, allowFailure]) => ({ target: EXACT_PERMIT2_PROXY, allowFailure, callData }))],
    });

  it("a batch spending two permits with different nonces is ambiguous; the same call twice is one", async () => {
    const [h, h1] = [await settleWith(BigInt(H)), await settleWith(BigInt(H) ^ 1n)];
    const ev = { ...P2.EV6, inputs: { two: batch([[h, false], [h1, false]]), same: batch([[h, false], [h, false]]) } };
    const two = await recoverRow(exactPermit2, { ...P2.EV6.transferAt100, input: "two" }, ev, EXACT_PERMIT2_PROXY);
    expect(two).toEqual({ got: { refused: true, code: "evm/ambiguous" }, calls: [] });
    expect((await recoverRow(exactPermit2, { ...P2.EV6.transferAt100, input: "same" }, ev, EXACT_PERMIT2_PROXY)).got).toBe(H);
  });

  // x402's proxy settles only through Permit2: `_settle` refuses a zero amount and a zero owner and calls
  // `permitWitnessTransferFrom` (x402 contracts/evm/src/x402BasePermit2Proxy.sol :117-136, f8f83309), which uses the
  // owner's nonce and calls the permit token's `transferFrom(owner, to, amount)` (Uniswap permit2
  // src/SignatureTransfer.sol :51-68, cc56ad0f); an ERC-20 token emits `Transfer(from, to, value)` for every transfer
  // (EIP-20, "Transfer"). A transaction that only carries the call's bytes holds no such log.
  const used = P2.EV6.transferAt100;
  const fromWord = (a: string) => `0x${"0".repeat(24)}${a.slice(2).toLowerCase()}` as Hex;
  const OTHER_OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Hex;
  const withLogs = (logs: EvmReceipt["logs"], input: string) => ({ ...used, receipt: { ...used.receipt, logs }, input });

  it("a copy of the settle call whose receipt holds no Transfer of its token from its owner is evm/no-permit2-settle, where status finds no transfer", async () => {
    const statusRef = (await exactPermit2.reference(await signed(exactPermit2, P2.fixed))) as EvmRef;
    const payerTransfer = used.receipt.logs[0];
    const anything = encodeFunctionData({ abi: parseAbi(["function anything(bytes blob)"]), functionName: "anything", args: [P2.EV6.inputs.settle] });
    const settled = { address: EXACT_PERMIT2_PROXY, topics: [keccak256(toBytes("Settled()"))], data: "0x" as Hex };
    const ev = { ...P2.EV6, inputs: { ...P2.EV6.inputs, anything } };
    const rows: [string, Permit2Row][] = [
      ["the call's bytes sent in another transaction, with no logs", withLogs([], "settle")],
      ["the call's bytes inside another call's bytes argument", withLogs([], "anything")],
      [
        "beside a settlement of another owner's permit through the proxy",
        withLogs([{ ...payerTransfer, topics: [TRANSFER_TOPIC, fromWord(OTHER_OWNER), payerTransfer.topics[2]] }, settled], "settle"),
      ],
      ["with the owner's Transfer of another token", withLogs([{ ...payerTransfer, address: `0x${"ee".repeat(20)}` }], "settle")],
    ];
    for (const [name, row] of rows) {
      expect(await recoverRow(exactPermit2, row, ev, EXACT_PERMIT2_PROXY), name).toEqual({
        got: { refused: true, code: "evm/no-permit2-settle" },
        calls: [],
      });
      const s = await exactPermit2.status({ ...statusRef, transaction: ref.transaction }, permit2Reader(row, ev, EXACT_PERMIT2_PROXY, []));
      expect(s, name).toEqual({ state: "failed", why: "transfer-not-found" });
    }
  });

  // Permit2's `invalidateUnorderedNonces(wordPos, mask)` sets the caller's bits and emits
  // `UnorderedNonceInvalidation(address indexed owner, uint256 word, uint256 mask)` (Uniswap permit2
  // src/SignatureTransfer.sol :129-134, src/interfaces/ISignatureTransfer.sol :19, cc56ad0f): the nonce reads used at
  // that block, and no permit is spent.
  it("the cancelling transaction of a permit, carrying the settle call with no Transfer from the owner, is evm/no-permit2-settle, though Permit2's bit is set in its block", async () => {
    const wordPos = BigInt(H) >> 8n;
    const mask = 1n << (BigInt(H) & 0xffn);
    expect(BigInt(used.nonceBitmap)).toBe(mask);
    const cancel = encodeFunctionData({
      abi: parseAbi(["function invalidateUnorderedNonces(uint256 wordPos, uint256 mask)"]),
      functionName: "invalidateUnorderedNonces",
      args: [wordPos, mask],
    });
    const invalidation = {
      address: PERMIT2,
      topics: [keccak256(toBytes("UnorderedNonceInvalidation(address,uint256,uint256)")), fromWord(P2.fixed.payer)],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [wordPos, mask]),
    };
    const ev = { ...P2.EV6, inputs: { ...P2.EV6.inputs, cancel: cancel + P2.EV6.inputs.settle.slice(2) } };
    const got = await recoverRow(exactPermit2, withLogs([invalidation], "cancel"), ev, EXACT_PERMIT2_PROXY);
    expect(got).toEqual({ got: { refused: true, code: "evm/no-permit2-settle" }, calls: [] });
  });

  // Multicall3's `aggregate3` with `allowFailure` catches a failing call (mds1/multicall src/Multicall3.sol), so a
  // batch can carry a settle-shaped call that spent nothing.
  it("a settle call of another owner beside the settlement, with no Transfer from that owner, is not read: H, where status settles", async () => {
    const statusRef = (await exactPermit2.reference(await signed(exactPermit2, P2.fixed))) as EvmRef;
    const decoy = await settleWith(BigInt(H) ^ 1n, `0x${"dd".repeat(20)}`);
    const ev = { ...P2.EV6, inputs: { ...P2.EV6.inputs, decoy: batch([[await settleWith(BigInt(H)), false], [decoy, true]]) } };
    const row = { ...used, input: "decoy" };
    expect(await recoverRow(exactPermit2, row, ev, EXACT_PERMIT2_PROXY)).toEqual({ got: H, calls: [P2.EV6.expectCall, P2.EV6.expectCallBefore] });
    const s = await exactPermit2.status({ ...statusRef, transaction: ref.transaction }, permit2Reader(row, ev, EXACT_PERMIT2_PROXY, []));
    expect(s.state).toBe("settled");
  });

  it("a call with the settlement's nonce and owner but another token word, after the settlement in a batch, does not hide it: H, where status settles", async () => {
    const statusRef = (await exactPermit2.reference(await signed(exactPermit2, P2.fixed))) as EvmRef;
    const otherToken = await settleWith(BigInt(H), undefined, `0x${"ee".repeat(20)}`);
    const ev = { ...P2.EV6, inputs: { ...P2.EV6.inputs, after: batch([[await settleWith(BigInt(H)), false], [otherToken, true]]) } };
    const row = { ...used, input: "after" };
    expect(await recoverRow(exactPermit2, row, ev, EXACT_PERMIT2_PROXY)).toEqual({ got: H, calls: [P2.EV6.expectCall, P2.EV6.expectCallBefore] });
    const s = await exactPermit2.status({ ...statusRef, transaction: ref.transaction }, permit2Reader(row, ev, EXACT_PERMIT2_PROXY, []));
    expect(s.state).toBe("settled");
  });

  it("a malformed receipt is evm/unreadable: a block number below zero, or a log entry that is not a log", async () => {
    const rows: [string, Permit2Row][] = [
      ["block number -1", { ...used, receipt: { ...used.receipt, blockNumber: "-1" } }],
      ["a null log entry", withLogs([...used.receipt.logs, null as never], "settle")],
    ];
    for (const [name, row] of rows) {
      const got = await recoverRow(exactPermit2, row, P2.EV6, EXACT_PERMIT2_PROXY);
      expect(got, name).toEqual({ got: { refused: true, code: "evm/unreadable" }, calls: [] });
    }
  });

  it("reads the receipt, the transaction and Permit2's word at two blocks: at most four calls", async () => {
    const seen: string[] = [];
    const r = permit2Reader(P2.EV6.transferAt100, P2.EV6, EXACT_PERMIT2_PROXY, []);
    const counted: EvmReader = {
      network: r.network,
      receipt: async (h) => (seen.push("receipt"), r.receipt(h)),
      blockNumber: async (t) => (seen.push("blockNumber"), r.blockNumber(t)),
      transaction: async (h) => (seen.push("transaction"), r.transaction(h)),
      call: async (to, data, block) => (seen.push("call"), r.call(to, data, block)),
    };
    expect(await exactPermit2.recover(ref, counted)).toBe(H);
    expect(seen).toEqual(["receipt", "transaction", "call", "call"]);
  });

  it("a reader for another network, or a ref or reader that is not an object, is evm/wrong-reader, with nothing read", async () => {
    const reader = permit2Reader(P2.EV6.transferAt100, P2.EV6, EXACT_PERMIT2_PROXY, []);
    const wrong = { refused: true, code: "evm/wrong-reader" };
    expect(await exactPermit2.recover({ ...ref, network: "eip155:1" }, reader)).toEqual(wrong);
    expect(await exactPermit2.recover(null as never, reader)).toEqual(wrong);
    expect(await uptoPermit2.recover(ref, null as never)).toEqual(wrong);
  });
});

describe("x402-exact-eip155-erc7710.json and x402-exact-eip155-erc7710-salt.json", () => {
  const f: Fixed = ES.fixed;
  const L = ES.fixed.leaf;
  const delegationTypes = {
    Delegation: [
      { name: "delegate", type: "address" },
      { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" },
      { name: "caveats", type: "Caveat[]" },
      { name: "salt", type: "uint256" },
    ],
    Caveat: [
      { name: "enforcer", type: "address" },
      { name: "terms", type: "bytes" },
    ],
  } as const;
  const delegationAbi = [
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
  const encode = (ds: any[]) =>
    encodeAbiParameters(delegationAbi, [ds.map((d) => ({ ...d, salt: BigInt(d.salt) }))]) as Hex;
  const leafMessage = { ...L, salt: BigInt(L.salt) };
  const sign = () =>
    privateKeyToAccount(f.payerKey).signTypedData({
      domain: ES.fixed.delegationDomain,
      types: delegationTypes,
      primaryType: "Delegation",
      message: leafMessage,
    });
  async function payment(context: Hex, manager: Hex): Promise<PaymentPayload> {
    const u = await unsigned(exactErc7710Salt, f);
    if (u.request.kind !== "erc7710") throw new Error("kind");
    expect(u.request.salt).toBe(H);
    const complete = u.complete as (d: { delegationManager: Hex; permissionContext: Hex; delegator: Hex }) => PaymentPayload | { refused: true; code: string };
    const p = complete({ delegationManager: manager, permissionContext: context, delegator: f.payer });
    if ("refused" in p) throw new Error(p.code);
    return p;
  }

  it("EV8: the leaf's struct hash, digest and signature; the 672-byte context", async () => {
    expect(hashStruct({ data: leafMessage, primaryType: "Delegation", types: delegationTypes })).toBe(ES.EV8.expectStructHash);
    expect(domainSeparator({ domain: ES.fixed.delegationDomain })).toBe(ES.EV8.expectDomainHash);
    expect(
      hashTypedData({ domain: ES.fixed.delegationDomain, types: delegationTypes, primaryType: "Delegation", message: leafMessage }),
    ).toBe(ES.EV8.expectDigest);
    const signature = await sign();
    expect(signature).toBe(ES.EV8.expectSignature);
    const ctx = encode([{ ...L, signature }]);
    expect((ctx.length - 2) / 2).toBe(ES.EV8.expectContextBytes);
    expect(sha256(ctx)).toBe(ES.EV8.expectContextSha256);
  });
  it("EV8: pairingOfPayment names the level; bound gives H at the salt level and refuses another manager", async () => {
    const ctx = encode([{ ...L, signature: ES.EV8.expectSignature }]);
    const p = await payment(ctx, ES.fixed.delegationManager);
    expect(pairingOfPayment(p)).toBe(ES.EV8.expectPairingOfPayment);
    expect(await exactErc7710Salt.bound(p)).toBe(ES.EV8.expectBound);
    const other = await payment(ctx, ES.EV8.otherManager.manager);
    expect(pairingOfPayment(other)).toBe(ES.EV8.otherManager.expectPairingOfPayment);
    expect(await exactErc7710Salt.bound(other)).toEqual(ES.EV8.otherManager.expectSaltBound);
    expect(await exactErc7710Salt.bound(await payment(ES.EV8.emptyContext.context, ES.fixed.delegationManager))).toEqual(
      ES.EV8.emptyContext.expect,
    );
    for (const c of rowsOf(ES.EV8.malformedContext.cases, "x402-exact-eip155-erc7710-salt.json EV8.malformedContext.cases")) {
      expect(await exactErc7710Salt.bound(await payment(c, ES.fixed.delegationManager))).toEqual(ES.EV8.malformedContext.expect);
    }
  });
  it("EV7: the unsigned level reads H from the echoed extension, and its record claims nothing", async () => {
    const ctx = encode([{ ...L, signature: ES.EV8.expectSignature }]);
    const p = await payment(ctx, ERC7710.EV7.otherManager);
    expect(pairingOfPayment(p)).toBe(ERC7710.EV7.expectPairingOfPayment);
    expect(await exactErc7710.bound(p)).toBe(ERC7710.EV7.expectBound);
    const bare = structuredClone(p);
    delete bare.extensions;
    expect(await exactErc7710.bound(bare)).toEqual(ERC7710.EV7.withoutExtension.expect);
    const ref = (await exactErc7710.reference(p)) as EvmRef;
    expect(ref.transferLog?.identity).toBe(ERC7710.EV7.expectReference.identity);
    expect(ref.transferLog?.digest).toBe(ERC7710.EV7.expectReference.digest);
    expect(exactErc7710.claims).toBe(ERC7710.EV7.claims);
    expect(exactErc7710.pattern.publicProof).toBe(false);
  });
  it("EV7: the unsigned level has no status and no authorizer, since no read of the chain alone ties a transfer to it", async () => {
    const ctx = encode([{ ...L, signature: ES.EV8.expectSignature }]);
    const p = await payment(ctx, ERC7710.EV7.otherManager);
    const ref = (await exactErc7710.reference(p)) as EvmRef;
    expect("status" in exactErc7710).toBe(ERC7710.EV7.expectMembers.status);
    expect("authorizer" in exactErc7710).toBe(ERC7710.EV7.expectMembers.authorizer);
    expect(ref.search).toBeUndefined();
    expect(ref.bindingLog).toBeUndefined();
    expect(ref.authorization).toBeUndefined();
  });
  it("EV8: at the salt level, authorizer is the root delegation's delegator; the reference names no nonce record", async () => {
    const ctx = encode([{ ...L, signature: ES.EV8.expectSignature }]);
    const p = await payment(ctx, ES.fixed.delegationManager);
    expect(await exactErc7710Salt.authorizer(p)).toBe(L.delegator.toLowerCase());
    const root = { ...L, delegate: L.delegator, delegator: "0x2096" + "00".repeat(18), caveats: [], salt: "1", signature: "0x" };
    expect(await exactErc7710Salt.authorizer(await payment(encode([{ ...L, signature: ES.EV8.expectSignature }, root]), ES.fixed.delegationManager))).toBe(root.delegator);
    expect(await exactErc7710Salt.authorizer(await payment(ctx, ES.EV8.otherManager.manager))).toEqual(ES.EV8.otherManager.expectSaltBound);
    expect(((await exactErc7710Salt.reference(p)) as EvmRef).authorization).toBeUndefined();
  });
  it("EV9: the event topic, its data words, the settlement read and recover", async () => {
    expect(keccak256(toBytes(ES.EV9.eventSignature))).toBe(ES.EV9.expectTopic);
    expect(REDEEMED_DELEGATION_TOPIC).toBe(ES.EV9.expectTopic);
    const data = encodeAbiParameters([{ type: "tuple", components: delegationAbi[0].components }], [
      { ...L, salt: BigInt(L.salt), signature: ES.EV8.expectSignature },
    ]) as Hex;
    const words = Array.from({ length: 6 }, (_, i) => "0x" + data.slice(2 + 64 * i, 66 + 64 * i));
    expect(words).toEqual(ES.EV9.expectDataWords);
    const ctx = encode([{ ...L, signature: ES.EV8.expectSignature }]);
    const ref = (await exactErc7710Salt.reference(await payment(ctx, ES.fixed.delegationManager))) as EvmRef;
    const topic = (a: string) => ("0x" + "00".repeat(12) + a.slice(2).toLowerCase()) as Hex;
    const receipt: FixtureReceipt = {
      status: 1,
      blockNumber: "100",
      logs: [
        { address: ES.fixed.delegationManager, topics: [REDEEMED_DELEGATION_TOPIC, topic(f.payer), topic(L.delegate)], data },
        { address: f.option.asset as Hex, topics: [TRANSFER_TOPIC, topic(f.payer), topic(f.option.payTo)], data: ("0x" + (10000).toString(16).padStart(64, "0")) as Hex },
      ],
    };
    const reader = readerFor(receipt, { network: "eip155:84532", finalized: "100", safe: "105" });
    const tx = ("0x" + "33".repeat(32)) as Hex;
    expect(plain(await exactErc7710Salt.status({ ...ref, transaction: tx }, reader))).toEqual(ES.EV9.expectStatus);
    expect(await exactErc7710Salt.recover!({ network: "eip155:84532", transaction: tx }, reader)).toBe(ES.EV9.expectRecover);
  });
  it("EV9 plants: status binds only a leaf carrying H and counts a transfer from that leaf's root delegator, as recover reads leaves", async () => {
    const ctx = encode([{ ...L, signature: ES.EV8.expectSignature }]);
    const ref = (await exactErc7710Salt.reference(await payment(ctx, ES.fixed.delegationManager))) as EvmRef;
    expect(ref.transferLog?.identity).toBe("from");
    const T = ES.plantsEV9;
    const account = (name: string): Hex =>
      name === "payer" ? f.payer : name === "payTo" ? (f.option.payTo as Hex) : ((T.accounts[name] ?? name) as Hex);
    const salt = (name: string) => (name === "H" ? H : name === "H2" ? T.H2 : name);
    const topic = (a: string) => ("0x" + "00".repeat(12) + a.slice(2).toLowerCase()) as Hex;
    const tx = ("0x" + "44".repeat(32)) as Hex;
    for (const row of rowsOf(T.rows, "x402-exact-eip155-erc7710-salt.json plantsEV9.rows")) {
      const logs = row.logs.map((l: any) => {
        if (l.redeemed !== undefined) {
          const r = l.redeemed;
          const delegation = { ...L, delegate: account(r.delegate), delegator: account(r.delegator), salt: BigInt(salt(r.salt)), signature: ES.EV8.expectSignature };
          const data = encodeAbiParameters([{ type: "tuple", components: delegationAbi[0].components }], [delegation]) as Hex;
          return { address: ES.fixed.delegationManager, topics: [REDEEMED_DELEGATION_TOPIC, topic(account(r.rootDelegator)), topic(account(r.redeemer))], data };
        }
        const t = l.transfer;
        return { address: f.option.asset as Hex, topics: [TRANSFER_TOPIC, topic(account(t.from)), topic(account(t.to))], data: ("0x" + (10000).toString(16).padStart(64, "0")) as Hex };
      });
      const reader = readerFor({ status: 1, blockNumber: "100", logs }, { network: "eip155:84532", finalized: "100", safe: "105" });
      expect(plain(await exactErc7710Salt.status({ ...ref, transaction: tx }, reader)), row.name).toEqual(row.expectStatus);
      expect(await exactErc7710Salt.recover!({ network: "eip155:84532", transaction: tx }, reader), row.name).toBe(row.expectRecover);
    }
    expect(T.rows.map((r: any) => r.name)).toEqual(["nonLeaf", "otherRoot", "anyPayee", "wildcard"]);
  });
  it("plant: the leaf's salt, never the root's", async () => {
    const root = { ...L, delegate: f.payer, delegator: "0x2096" + "00".repeat(18), caveats: [], salt: H, signature: "0x" };
    const leaf = { ...L, salt: ES.plantLeafNotRoot.leafSalt, signature: ES.EV8.expectSignature };
    const p = await payment(encode([leaf, root]), ES.fixed.delegationManager);
    expect(await exactErc7710Salt.bound(p)).toBe(ES.plantLeafNotRoot.expectBound);
    expect(await exactErc7710Salt.bound(p)).not.toBe(H);
  });
});

describe("x402-auth-capture-eip155-eip3009.json and x402-auth-capture-eip155-permit2.json", () => {
  const f: Fixed = A3.fixed;
  const x = f.option.extra as any;
  const info = (payer: Hex, salt: Hex): PaymentInfo => ({
    operator: x.captureAuthorizer,
    payer,
    receiver: f.option.payTo as Hex,
    token: f.option.asset as Hex,
    maxAmount: BigInt(f.option.amount),
    preApprovalExpiry: BigInt(f.now + f.option.maxTimeoutSeconds),
    authorizationExpiry: BigInt(x.captureDeadline),
    refundExpiry: BigInt(x.refundDeadline),
    minFeeBps: x.minFeeBps,
    maxFeeBps: x.maxFeeBps,
    feeReceiver: x.feeRecipient,
    salt,
  });

  it("EV3: bindSalt, signatureNonce and the payment hash, bound and unbound; the two type hashes", () => {
    const esc = A3.EV3.escrow as Hex;
    const s = bindSalt(x.receiverAuthorizer, ZERO, H) as Hex;
    expect(s).toBe(A3.EV3.expectBindSalt);
    expect(paymentHash(84532, esc, info(ZERO, s))).toBe(A3.EV3.bound.expectSignatureNonce);
    expect(paymentHash(84532, esc, info(f.payer, s))).toBe(A3.EV3.bound.expectPaymentHash);
    expect(matches(paymentHash(84532, esc, info(ZERO, H)) as string, A3.EV3.unbound.expectSignatureNonce)).toBe(true);
    expect(matches(paymentHash(84532, esc, info(f.payer, H)) as string, A3.EV3.unbound.expectPaymentHash)).toBe(true);
    expect(PAYMENT_INFO_TYPEHASH).toBe(A3.EV3.expectPaymentInfoTypeHash);
    expect(
      keccak256(
        toBytes(
          "PaymentInfo(address operator,address payer,address receiver,address token,uint120 maxAmount,uint48 preApprovalExpiry,uint48 authorizationExpiry,uint48 refundExpiry,uint16 minFeeBps,uint16 maxFeeBps,address feeReceiver,uint256 salt)",
        ),
      ),
    ).toBe(PAYMENT_INFO_TYPEHASH);
    expect(
      keccak256(toBytes("x402AuthCaptureSaltBinding(address receiverAuthorizer,address policy,uint256 saltNonce)")),
    ).toBe(SALT_BINDING_TYPEHASH);
  });
  it("EV4 eip3009: the receive authorization, its signature, bound and the reference", async () => {
    expect(pairingOf(f.option)).toBe("x402/auth-capture/eip155/eip3009");
    const u = await unsigned(authCaptureEip3009, f);
    if (u.request.kind !== "eip712") throw new Error("kind");
    const td = u.request.typedData as any;
    expect(td.primaryType).toBe("ReceiveWithAuthorization");
    expect(td.message.to).toBe(A3.EV4.expectTo);
    expect(td.message.nonce).toBe(A3.EV3.bound.expectSignatureNonce);
    expect(hashTypedData(td)).toBe(A3.EV4.expectDigest);
    expect(
      matches(
        keccak256(
          toBytes("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"),
        ),
        A3.EV4.expectTypeHash,
      ),
    ).toBe(true);
    const p = await signed(authCaptureEip3009, f);
    expect((p.payload as any).signature).toBe(A3.EV4.expectSignature);
    expect((p.payload as any).saltNonce).toBe(H);
    expect((p.payload as any).salt).toBe(A3.EV3.expectBindSalt);
    expect(await authCaptureEip3009.bound(p)).toBe(A3.EV4.expectBound);
    const ref = (await authCaptureEip3009.reference(p)) as EvmRef;
    expect(ref.transferLog?.digest).toBe(A3.EV4.expectTransferDigest);
    expect(ref.bindingLog).toEqual({ address: A3.EV3.escrow, topic0: PAYMENT_AUTHORIZED_TOPIC, index: 1, value: A3.EV3.bound.expectPaymentHash });
    expect(ref.search?.topics[2]).toBe(A3.EV3.bound.expectSignatureNonce);
    expect(await transferDigest({ from: f.payer, to: ESCROW["v1.1"].eip3009Collector, value: 10000n })).toBe(A3.EV4.expectTransferDigest);
    expect(ref.authorization).toEqual({
      scheme: "eip3009",
      at: f.option.asset,
      nonce: A3.EV3.bound.expectSignatureNonce,
      deadline: String(f.now + f.option.maxTimeoutSeconds),
      asset: f.option.asset,
    });
    expect(await authCaptureEip3009.authorizer(p)).toBe(f.payer.toLowerCase());
  });
  it("EV4 permit2: the collector's PermitTransferFrom, bound and the escrow search", async () => {
    const g: Fixed = AP.fixed;
    expect(pairingOf(g.option)).toBe("x402/auth-capture/eip155/permit2");
    const u = await unsigned(authCapturePermit2, g);
    if (u.request.kind !== "eip712") throw new Error("kind");
    expect(u.request.typedData.primaryType).toBe("PermitTransferFrom");
    expect((u.request.typedData.message as any).spender).toBe(AP.EV4.expectSpender);
    expect(hashTypedData(u.request.typedData as TypedDataDefinition)).toBe(AP.EV4.expectDigest);
    const p = await signed(authCapturePermit2, g);
    expect(await authCapturePermit2.bound(p)).toBe(AP.EV4.expectBound);
    const ref = (await authCapturePermit2.reference(p)) as EvmRef;
    expect(ref.search).toEqual(AP.EV4.expectSearch);
    expect(ref.transferLog).toBeUndefined();
    // The option's PaymentInfo terms are the eip3009 file's, so the signed nonce is that file's signatureNonce.
    expect(ref.authorization).toEqual({
      scheme: "permit2",
      at: P2.EV6.expectCall.to,
      nonce: A3.EV3.bound.expectSignatureNonce,
      deadline: String(g.now + g.option.maxTimeoutSeconds),
      asset: g.option.asset,
    });
    expect(await authCapturePermit2.authorizer(p)).toBe(g.payer.toLowerCase());
  });
  it("EV5: the escrow topics are the events' signatures", () => {
    for (const k of ["paymentAuthorized", "paymentChargedV11", "paymentChargedV10"] as const) {
      expect(keccak256(toBytes(A3.EV5.signatures[k]))).toBe(A3.EV5[k]);
    }
    expect(PAYMENT_AUTHORIZED_TOPIC).toBe(A3.EV5.paymentAuthorized);
    expect(ESCROW["v1.1"].chargedTopic).toBe(A3.EV5.paymentChargedV11);
    expect(ESCROW["v1.0"].chargedTopic).toBe(A3.EV5.paymentChargedV10);
  });
  it("EV6: the first collection's event and the transfer settle; the charge flow needs PaymentCharged", async () => {
    const p = await signed(authCaptureEip3009, f);
    const ref = (await authCaptureEip3009.reference(p)) as EvmRef;
    const tx = A3.EV6.transaction as Hex;
    const receipt: FixtureReceipt = { status: 1, blockNumber: "100", logs: A3.EV6.authorizedAndTransfer.logs };
    expect(plain(await evmStatus({ ...ref, transaction: tx }, readerFor(receipt, A3.EV6.reader)))).toEqual(
      A3.EV6.authorizedAndTransfer.expect,
    );
    const charge = structuredClone(f.option) as any;
    charge.extra.paymentFlow = A3.EV6.authorizationFlowOnlyAuthorized.paymentFlow;
    const pc = await signed(authCaptureEip3009, f, charge);
    const refc = (await authCaptureEip3009.reference(pc)) as EvmRef;
    const only: FixtureReceipt = { status: 1, blockNumber: "100", logs: [A3.EV6.authorizedAndTransfer.logs[0]] };
    expect(plain(await evmStatus({ ...refc, transaction: tx }, readerFor(only, A3.EV6.reader)))).toEqual(
      A3.EV6.authorizationFlowOnlyAuthorized.expect,
    );
  });
  it("plant: a signed nonce committing to another salt is not this payment", async () => {
    const p = (await signed(authCaptureEip3009, f)) as any;
    const unboundNonce = paymentHash(84532, A3.EV3.escrow, info(ZERO, H));
    p.payload.authorization.nonce = unboundNonce;
    expect(await authCaptureEip3009.bound(p)).toEqual(A3.plantNonceNotPayment.expect);
  });
  it("the auth-capture refusals: salt-not-bound, salt-malformed, escrow-not-canonical, flow-not-carried", async () => {
    const p = (await signed(authCaptureEip3009, f)) as any;
    const q = structuredClone(p);
    q.payload.salt = H;
    expect(await authCaptureEip3009.bound(q)).toEqual(A3.saltNotBound.expect);
    const r = structuredClone(p);
    r.payload.salt = A3.saltMalformed.salt;
    expect(await authCaptureEip3009.bound(r)).toEqual(A3.saltMalformed.expect);
    const doc = documentOf(f);
    const esc = structuredClone(f.option) as any;
    esc.extra.authCaptureEscrow = A3.escrowNotCanonical.authCaptureEscrow;
    expect(authCaptureEip3009.advertise({ ...doc, accepts: [esc] }, H, f.link, esc)).toEqual(A3.escrowNotCanonical.expect);
    const auto = structuredClone(f.option) as any;
    auto.extra.autoCapture = true;
    expect(authCaptureEip3009.advertise({ ...doc, accepts: [auto] }, H, f.link, auto)).toEqual(A3.autoCapture.expect);
  });
});

describe("every reference is JSON", () => {
  it("round-trips each breadth pairing's reference through JSON unchanged", async () => {
    const refs = [
      await exactPermit2.reference(await signed(exactPermit2, P2.fixed)),
      await uptoPermit2.reference(await signed(uptoPermit2, UP.fixed)),
      await authCaptureEip3009.reference(await signed(authCaptureEip3009, A3.fixed)),
      await authCapturePermit2.reference(await signed(authCapturePermit2, AP.fixed)),
    ];
    for (const r of refs) {
      expect("refused" in r).toBe(false);
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
  });
});

describe("the records", () => {
  it("claims and publicProof per pairing", () => {
    for (const b of [exactPermit2, uptoPermit2, exactErc7710Salt, authCaptureEip3009, authCapturePermit2]) {
      expect(b.claims).toBe(true);
      expect(b.pattern.publicProof).toBe(true);
      expect(b.pattern.canonical).toBe(false);
    }
    expect(exactErc7710.claims).toBe(false);
    expect(exactErc7710.pattern.proves.startsWith("Before this payment, the buyer signed and paid an agreement transaction")).toBe(true);
    expect(exactErc7710Salt.recover).toBeDefined();
    for (const b of [exactPermit2, uptoPermit2]) {
      expect(b.recover, b.id).toBeDefined();
      expect(b.pattern.zeroPartyRecoverable, b.id).toBe(true);
    }
  });
});

// Each breadth file's agreedRefusals rows, run from the rows' own inputs: a choice that is not an object is x402/not-v2
// at build, and a permitted that is not an object or a list of objects is evm/field-malformed at permit2TypedData, over
// EV1's other inputs.
describe("each breadth file's agreedRefusals rows", () => {
  const files = [
    ["x402-exact-eip155-permit2.json", P2, exactPermit2],
    ["x402-exact-eip155-erc7710.json", ERC7710, exactErc7710],
    ["x402-exact-eip155-erc7710-salt.json", ES, exactErc7710Salt],
    ["x402-upto-eip155-permit2.json", UP, uptoPermit2],
    ["x402-auth-capture-eip155-eip3009.json", A3, authCaptureEip3009],
    ["x402-auth-capture-eip155-permit2.json", AP, authCapturePermit2],
  ] as const;
  type Row = { case: string; choice?: unknown; permitted?: unknown; expect: string };
  for (const [name, file, pairing] of files) {
    const rows = file.agreedRefusals.rows as Row[];
    it(`${name}: build refuses a null choice and a string choice`, async () => {
      const built = rowsOf(rows.filter((r) => "choice" in r), `${name} agreedRefusals.rows, the rows with a choice`, { exact: 2 });
      expect(built.map((r) => r.choice)).toEqual([null, "x"]);
      for (const r of built) {
        expect(await pairing.build(r.choice as never, file.fixed.H as AtrHash), r.case).toEqual({ refused: true, code: r.expect });
      }
    });
  }

  it("x402-exact-eip155-permit2.json: permit2TypedData refuses a permitted of null, [null] and 42", () => {
    const rows = rowsOf(P2.agreedRefusals.rows as Row[], "x402-exact-eip155-permit2.json agreedRefusals.rows", {
      exact: 3,
      keep: ["the rows with a permitted", (r) => "permitted" in r],
      leave: ["the rows with a choice, which the build test above runs", (r) => "choice" in r],
    });
    expect(rows.map((r) => r.permitted)).toEqual([null, [null], 42]);
    const base = {
      chainId: 84532,
      spender: P2.EV1.expectSpender as Hex,
      nonce: BigInt(P2.EV1.expectNonceDecimal),
      deadline: BigInt(P2.EV1.expectDeadline),
    };
    const good = permit2TypedData({ ...base, permitted: { token: P2.fixed.option.asset as Hex, amount: 10000n } });
    expect("refused" in good).toBe(false);
    for (const r of rows) {
      expect(permit2TypedData({ ...base, permitted: r.permitted as never }), r.case).toEqual({ refused: true, code: r.expect });
    }
  });
});
