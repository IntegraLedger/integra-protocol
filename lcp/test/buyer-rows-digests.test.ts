// The B6 payments of the files that record their signed payment only by a digest, a length and SHA-256, or a
// truncated value: each presented payment, read from its B6 row with viem alone, hashes to the value its file records,
// and its signatures recover the file's payer.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  concat,
  domainSeparator,
  fromRlp,
  hashTypedData,
  keccak256,
  recoverAddress,
  toBytes,
  toRlp,
  type Hex,
  type TypedDataDefinition,
} from "viem";

type Json = any;
type Rlp = Hex | Rlp[];
const load = (f: string): Json => JSON.parse(readFileSync(new URL(`../vectors/${f}`, import.meta.url), "utf8"));
const presented = (d: Json, pairing: string): Json => {
  const rows = d.buyer.rows.filter((r: Json) => r.name === "B6" && r.pairing === pairing);
  expect(rows.length).toBe(1);
  return rows[0].input.presented;
};
const sha256 = (b: Uint8Array): string => `0x${createHash("sha256").update(b).digest("hex")}`;
const affix = (v: string, r: { prefix: string; suffix: string }): void => {
  expect([v.slice(0, r.prefix.length), v.slice(-r.suffix.length)]).toEqual([r.prefix, r.suffix]);
};
const request = (challenge: Json): Json => JSON.parse(Buffer.from(challenge.request, "base64url").toString("utf8"));
const fields = (spec: string) => spec.split(",").map((x) => ({ name: x.split(" ")[1]!, type: x.split(" ")[0]! }));
const AUTH = "address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const TOKEN_PERMISSIONS = fields("address token,uint256 amount");
const lower = (a: string): Hex => a.toLowerCase() as Hex;
async function signedBy(hash: Hex, signature: Hex, payer: string): Promise<void> {
  expect(await recoverAddress({ hash, signature })).toBe(payer);
}

describe("B6 payments built from their inputs where the file records the signed payment by its digest", () => {
  it("mpp/charge/usdc/evm: the authorization's EIP-712 digest is M3.expectDigest", async () => {
    const d = load("mpp-charge-usdc-evm.json");
    const p = presented(d, "mpp/charge/usdc/evm");
    const r = request(p.challenge);
    const a = p.payload;
    const digest = hashTypedData({
      domain: { ...d.fixed.tokenDomain, chainId: r.methodDetails.evm.chainId, verifyingContract: r.currency },
      types: { TransferWithAuthorization: fields(AUTH) },
      primaryType: "TransferWithAuthorization",
      message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    } as TypedDataDefinition);
    expect(digest).toBe(d.M3.expectDigest);
    await signedBy(digest, a.signature, d.fixed.payer);
  });

  it("mpp/charge/usdc/gateway: the burn intent's domain separator is M5's, and its digest has M5's prefix and suffix", async () => {
    const d = load("mpp-charge-usdc-gateway.json");
    const t = presented(d, "mpp/charge/usdc/gateway").payload.authorization.transfer;
    const b = t.burnIntent;
    const bytes32 = ["sourceContract", "destinationContract", "sourceToken", "destinationToken", "sourceDepositor", "destinationRecipient", "sourceSigner", "destinationCaller"];
    const td = {
      domain: { name: "GatewayWallet", version: "1" },
      types: {
        TransferSpec: [
          ...fields("uint32 version,uint32 sourceDomain,uint32 destinationDomain"),
          ...bytes32.map((name) => ({ name, type: "bytes32" })),
          ...fields("uint256 value,bytes32 salt,bytes hookData"),
        ],
        BurnIntent: fields("uint256 maxBlockHeight,uint256 maxFee,TransferSpec spec"),
      },
      primaryType: "BurnIntent",
      message: { maxBlockHeight: BigInt(b.maxBlockHeight), maxFee: BigInt(b.maxFee), spec: { ...b.spec, value: BigInt(b.spec.value) } },
    } as TypedDataDefinition;
    expect(domainSeparator({ domain: td.domain! })).toBe(d.M5.expectDomainSeparator);
    const digest = hashTypedData(td);
    affix(digest, d.M5.expectDigest);
    await signedBy(digest, t.signature, d.fixed.payer);
  });

  it("mpp/session/evm: the open's digest is ES4.expectDigest, its signature ES4's, and the zero voucher's digest ES5's", async () => {
    const d = load("mpp-session-evm.json");
    const f = d.fixed;
    const p = presented(d, "mpp/session/evm").payload;
    const a = p.authorization;
    const digest = hashTypedData({
      domain: { ...f.tokenDomain, chainId: f.chainId, verifyingContract: f.usdc },
      types: { ReceiveWithAuthorization: fields(AUTH) },
      primaryType: "ReceiveWithAuthorization",
      message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    } as TypedDataDefinition);
    expect(digest).toBe(d.ES4.expectDigest);
    affix(p.signature, d.ES4.expectSignature);
    await signedBy(digest, p.signature, f.payer);
    const voucher = hashTypedData({
      domain: { name: "EVM Payment Channel", version: "1", chainId: f.chainId, verifyingContract: f.escrow },
      types: { Voucher: fields("bytes32 channelId,uint128 cumulativeAmount") },
      primaryType: "Voucher",
      message: { channelId: p.channelId, cumulativeAmount: BigInt(p.cumulativeAmount) },
    } as TypedDataDefinition);
    expect(voucher).toBe(d.ES5.expectVoucherDigest);
    await signedBy(voucher, p.voucherSignature, f.payer);
  });

  it("mpp/charge/tempo/memo: the wire's length and SHA-256 are MV7's", () => {
    const d = load("mpp-charge-tempo-memo.json");
    const wire = toBytes(presented(d, "mpp/charge/tempo/memo").payload.signature);
    expect(wire.length).toBe(d.MV7.expectWireLength);
    expect(sha256(wire)).toBe(d.MV7.expectWireSha256);
  });

  it("mpp/session/tempo: the open's wire has TS2's length and SHA-256, and the zero voucher's digest is TS4's", async () => {
    const d = load("mpp-session-tempo.json");
    const f = d.fixed;
    const p = presented(d, "mpp/session/tempo").payload;
    const wire = toBytes(p.transaction);
    expect(wire.length).toBe(d.TS2.expectLength);
    expect(sha256(wire)).toBe(d.TS2.expectSha256);
    expect(wire[0]).toBe(0x76);
    const list = fromRlp(wire.subarray(1), "hex") as Rlp[];
    const unsigned = concat(["0x76", toRlp(list.slice(0, -1))]);
    await signedBy(keccak256(unsigned), list.at(-1) as Hex, f.payer);
    const voucher = hashTypedData({
      domain: { name: "TIP20 Channel Reserve", version: "1", chainId: f.chainId, verifyingContract: lower(f.escrowV2) },
      types: { Voucher: fields("bytes32 channelId,uint96 cumulativeAmount") },
      primaryType: "Voucher",
      message: { channelId: p.channelId, cumulativeAmount: BigInt(p.cumulativeAmount) },
    } as TypedDataDefinition);
    expect(voucher).toBe(d.TS4.expectVoucher0);
    await signedBy(voucher, p.signature, f.payer);
  });

  it("mpp/subscription/tempo: the key authorization's unsigned length and digest, and its signed length, are SUB1's", async () => {
    const d = load("mpp-subscription-tempo.json");
    const signed = toBytes(presented(d, "mpp/subscription/tempo").payload.signature);
    expect(signed.length).toBe(d.SUB1.expectSignedLength);
    const [authorization, signature] = fromRlp(signed, "hex") as [Rlp[], Hex];
    const unsigned = toBytes(toRlp(authorization));
    expect(unsigned.length).toBe(d.SUB1.expectUnsignedLength);
    expect(keccak256(unsigned)).toBe(d.SUB1.expectDigest);
    await signedBy(d.SUB1.expectDigest, signature, d.fixed.payer);
  });

  it("x402/auth-capture/eip155/permit2: the Permit2 digest is EV4.expectDigest", async () => {
    const d = load("x402-auth-capture-eip155-permit2.json");
    const p = presented(d, "x402/auth-capture/eip155/permit2").payload;
    const a = p.permit2Authorization;
    const digest = hashTypedData({
      domain: { name: "Permit2", chainId: 84532, verifyingContract: PERMIT2 },
      types: { TokenPermissions: TOKEN_PERMISSIONS, PermitTransferFrom: fields("TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline") },
      primaryType: "PermitTransferFrom",
      message: { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) }, spender: a.spender, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) },
    } as TypedDataDefinition);
    expect(digest).toBe(d.EV4.expectDigest);
    await signedBy(digest, p.signature, d.fixed.payer);
  });

  it("x402/upto/eip155/permit2: the Permit2 witness digest is EV2.expectDigest", async () => {
    const d = load("x402-upto-eip155-permit2.json");
    const p = presented(d, "x402/upto/eip155/permit2").payload;
    const a = p.permit2Authorization;
    const digest = hashTypedData({
      domain: { name: "Permit2", chainId: 84532, verifyingContract: PERMIT2 },
      types: {
        TokenPermissions: TOKEN_PERMISSIONS,
        Witness: fields("address to,address facilitator,uint256 validAfter"),
        PermitWitnessTransferFrom: fields("TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,Witness witness"),
      },
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) },
        spender: a.spender,
        nonce: BigInt(a.nonce),
        deadline: BigInt(a.deadline),
        witness: { ...a.witness, validAfter: BigInt(a.witness.validAfter) },
      },
    } as TypedDataDefinition);
    expect(digest).toBe(d.EV2.expectDigest);
    await signedBy(digest, p.signature, d.fixed.payer);
  });
});
