// The EVM-breadth pairings against their vector files. Every expected value is the files'.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  domainSeparator,
  hashStruct,
  hashTypedData,
  keccak256,
  toBytes,
  toFunctionSelector,
  type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AtrHash } from "../src/index.js";
import {
  ESCROW,
  NONCE_BITMAP_SELECTOR,
  PAYMENT_AUTHORIZED_TOPIC,
  PAYMENT_INFO_TYPEHASH,
  ReaderError,
  REDEEMED_DELEGATION_TOPIC,
  SALT_BINDING_TYPEHASH,
  TRANSFER_TOPIC,
  bindSalt,
  evmStatus,
  paymentHash,
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

describe("x402-exact-eip155-permit2.json", () => {
  const f: Fixed = P2.fixed;
  it("pairingOf names the pairing", () => expect(pairingOf(f.option)).toBe("x402/exact/eip155/permit2"));
  it("EV1: the typed data, its digest and the Anvil key's signature", async () => {
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
  it("EV6 and the emitter plant: status of EV1's reference reads Permit2's record of the nonce", async () => {
    const ref = (await exactPermit2.reference(await signed(exactPermit2, f))) as EvmRef;
    const tx = P2.EV6.transaction as Hex;
    const rows = [P2.EV6.transferAt100, P2.EV6.nonceUnused, P2.EV6.callFails, P2.EV6.value9999, P2.EV6.reverted];
    for (const row of [...rows, P2.EV6.none, P2.plantEmitter]) {
      const calls: { to: string; data: string; block: string }[] = [];
      const reader = readerFor(row.receipt, P2.EV6.reader, row.nonceBitmap, calls);
      expect(plain(await exactPermit2.status({ ...ref, transaction: tx }, reader))).toEqual(row.expect);
      const reaches = row.nonceBitmap !== undefined;
      expect(calls).toEqual(reaches ? [P2.EV6.expectCall] : []);
    }
    const selector = toFunctionSelector("function nonceBitmap(address owner, uint256 wordPos)");
    expect(P2.EV6.expectCall.data.startsWith(selector)).toBe(true);
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
  it("EV6: a transfer of any amount is this payment's only where Permit2 records nonce H used", async () => {
    const ref = (await uptoPermit2.reference(await signed(uptoPermit2, f))) as EvmRef;
    for (const row of [UP.EV6.oneUnitUsed, UP.EV6.oneUnitUnused]) {
      const calls: { to: string; data: string; block: string }[] = [];
      const reader = readerFor(row.receipt, UP.EV6.reader, row.nonceBitmap, calls);
      expect(plain(await uptoPermit2.status({ ...ref, transaction: UP.EV6.transaction }, reader)), row.case).toEqual(row.expect);
      expect(calls).toEqual([UP.EV6.expectCall]);
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
    for (const c of ES.EV8.malformedContext.cases) {
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
    expect("recover" in exactPermit2).toBe(false);
  });
});
