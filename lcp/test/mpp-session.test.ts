// The session and subscription pairings against their vector files. Every expected value is the files', computed
// or read from Tempo Moderato; viem 2.57.4 is the independent tool for EIP-712, signatures, RLP and keccak.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  fromRlp,
  hashTypedData,
  isAddress,
  keccak256,
  parseAbi,
  parseSignature,
  recoverAddress,
  serializeCompactSignature,
  signatureToCompactSignature,
  toBytes,
  toHex,
  toRlp,
  type Hex as ViemHex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { Abis as TempoAbis, Transaction as TempoTransaction } from "viem/tempo";
import { TRANSFER_TOPIC, transferDigest, type EvmLog, type EvmReader } from "../src/evm.js";
import { KEY_AUTHORIZED_TOPIC } from "../src/internal/tempo.js";
import {
  challengeId,
  evmChannelId,
  pairingsOf,
  place,
  sessionEvm,
  sessionResume,
  sessionStatus,
  sessionTempo,
  subscriptionTempo,
  type MppChallenge,
  type MppCredential,
  type SessionRef,
  type SessionUnsigned,
} from "../src/mpp.js";
import {
  ACCOUNT_KEYCHAIN,
  CHANNEL_CLOSED_V1_TOPIC,
  CHANNEL_CLOSED_V2_TOPIC,
  CHANNEL_OPENED_V1_TOPIC,
  CHANNEL_OPENED_V2_TOPIC,
  KEY_AUTHORIZATION_WITNESS_TOPIC,
  KEY_REVOKED_TOPIC,
  OPEN_V1_SELECTOR,
  OPEN_V2_SELECTOR,
  TIP20_CHANNEL_RESERVE,
  decodeKeyAuthorization,
  decodeTempoTx,
  encodeKeyAuthorization,
  expiringNonceHash,
  tempoChannelId,
  witnessRecover,
  type KeyAuthorizationUnsigned,
  type TempoKeyAuthorization,
} from "../src/tempo.js";
import { H, challenge, link, load, readerFor, topicOf, withBigints, wordOf } from "./mpp-fixtures.js";

const E = load("mpp-session-evm.json");
const T = load("mpp-session-tempo.json");
const U = load("mpp-subscription-tempo.json");
/** The file's buyer B6 row's presented payment. */
const b6 = (V: { buyer: { rows: { name: string; input: { presented: unknown } }[] } }) => V.buyer.rows.find((r) => r.name === "B6")!.input.presented as MppCredential;

const H2 = E.fixed.H2 as `0x${string}`;
const payer = privateKeyToAccount(E.fixed.payerKey);
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const sha256 = (b: Uint8Array) => "0x" + createHash("sha256").update(b).digest("hex");
/** viem checks EIP-55 checksums; the vector's precompile spellings are not checksums, so the domain goes lowercase. */
const forViem = (td: unknown) => {
  const t = td as { domain?: { verifyingContract?: string } };
  const domain = t.domain?.verifyingContract === undefined ? t.domain : { ...t.domain, verifyingContract: t.domain.verifyingContract.toLowerCase() };
  return { ...(td as object), domain } as Parameters<typeof hashTypedData>[0];
};
const affix = (v: string, e: { prefix: string; suffix: string }) => {
  expect(v.startsWith(e.prefix), `${v} starts ${e.prefix}`).toBe(true);
  expect(v.endsWith(e.suffix), `${v} ends ${e.suffix}`).toBe(true);
};
const placed = (c: MppChallenge, h = H) => (place([c], h, link, c) as MppChallenge[])[0] as MppChallenge & { id: string };
const unsignedOf = (u: unknown) => {
  if (typeof u === "object" && u !== null && "refused" in u) throw new Error(JSON.stringify(u));
  return u as SessionUnsigned;
};
const num = (n: number | bigint) => (BigInt(n) === 0n ? "0x" : toHex(BigInt(n)));
const typeHash = (s: string) => keccak256(toBytes(s));
/**
 * EIP-2098's 64-byte form of a secp256k1 signature (viem's serializeCompactSignature). An ERC-1271 contract signature
 * has no fixed length either, so each `complete` takes a signature of 1 to 8192 bytes of hex.
 */
const compact = (s: ViemHex) => serializeCompactSignature(signatureToCompactSignature(parseSignature(s)));
const BAD_SIGNATURES = ["0x", `0x${"11".repeat(8193)}`] as const;
const malformed = { refused: true, code: "mpp/credential-malformed" };
/** A 65-byte secp256k1 signature, r ‖ s ‖ v with v 27 or 28. */
async function sig65(hash: ViemHex): Promise<ViemHex> {
  const s = await sign({ hash, privateKey: E.fixed.payerKey });
  return concat([s.r, s.s, toHex(Number(s.v), { size: 1 })]);
}

describe("mpp-session-evm.json", () => {
  const f = E.fixed;
  const ES = challenge("evm", "session", f.request);
  const ch = placed(ES);
  const deposit = BigInt(f.deposit);
  const build = async (credentialType: "hash" | "authorization" | "permit2") =>
    unsignedOf(
      await sessionEvm.build({ challenge: ch, from: f.payer, now: f.now, deposit, credentialType, tokenDomain: f.tokenDomain }, H),
    );
  const voucherSig = async (u: SessionUnsigned, funded: ViemHex) => payer.signTypedData(forViem(u.voucher(funded)));

  it("ES1: the channel id, and viem's abi.encode agrees", () => {
    const c = { payer: f.payer, payee: f.recipient, token: f.usdc, salt: H, authorizedSigner: ZERO, escrow: f.escrow, chainId: f.chainId };
    expect(evmChannelId(c)).toBe(E.ES1.expectChannelId);
    const types = ["address", "address", "address", "bytes32", "address", "address", "uint256"].map((type) => ({ type }));
    expect(keccak256(encodeAbiParameters(types, [f.payer, f.recipient, f.usdc, H, ZERO, f.escrow, BigInt(f.chainId)]))).toBe(
      E.ES1.expectChannelId,
    );
    affix(evmChannelId({ ...c, salt: H2 }) as string, E.ES1.expectChannelIdH2);
    // ES1.expectChannelIdH2.whole is eth-abi's and eth-utils' computeChannelId with salt H2 (ES1's case); viem
    // re-derives it, and evmChannelId is held to it.
    expect(keccak256(encodeAbiParameters(types, [f.payer, f.recipient, f.usdc, H2, ZERO, f.escrow, BigInt(f.chainId)]))).toBe(
      E.ES1.expectChannelIdH2.whole,
    );
    expect(evmChannelId({ ...c, salt: H2 })).toBe(E.ES1.expectChannelIdH2.whole);
  });

  // ES2's calldata is eth-abi 6.0.0's approve(address,uint256) and draft-evm-session-00's open(address payee, address
  // token, uint128 deposit, bytes32 salt, address authorizedSigner) (tempoxyz/mpp-specs 08e7dd87, L494 and L517-523);
  // viem 2.57.4's encodeFunctionData re-derives each, and build's whole funding is held to them.
  it("ES2: the hash open's calls, byte for byte as eth-abi and viem encode approve and the escrow's open", async () => {
    const abi = parseAbi([
      "function approve(address spender, uint256 amount)",
      "function open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)",
    ]);
    expect(encodeFunctionData({ abi, functionName: "approve", args: [f.escrow, deposit] })).toBe(E.ES2.expectApproveCalldata);
    expect(encodeFunctionData({ abi, functionName: "open", args: [f.recipient, f.usdc, deposit, H, ZERO] })).toBe(
      E.ES2.expectOpenCalldata,
    );
    expect(E.ES9.cases[0].transaction.input).toBe(E.ES2.expectOpenCalldata);
    const u = await build("hash");
    expect(u.funding).toEqual({
      kind: "evm-calls",
      chainId: 84532,
      calls: [
        { to: f.usdc, data: E.ES2.expectApproveCalldata },
        { to: f.escrow, data: E.ES2.expectOpenCalldata },
      ],
      broadcast: true,
    });
    if (u.funding.kind !== "evm-calls") throw new Error("not evm-calls");
    const [approve, open] = u.funding.calls;
    expect(approve!.to).toBe(f.usdc);
    expect(approve!.data.slice(0, 10)).toBe(keccak256(toBytes("approve(address,uint256)")).slice(0, 10));
    expect(open!.to).toBe(f.escrow);
    expect(toBytes(open!.data).length).toBe(E.ES2.expectOpenLength);
    expect(open!.data.slice(0, 10)).toBe(E.ES2.expectOpenSelector);
    expect(open!.data.slice(2 + 8 + 128, 2 + 8 + 192)).toBe(wordOf(BigInt(E.ES2.expectDeposit)).slice(2));
    expect(open!.data.split(H.slice(2)).length - 1).toBe(E.ES2.expectHOccurrences);
  });

  it("ES3 and ES4: the receive authorization, its nonce, digest and signature, then bound", async () => {
    const u = await build("authorization");
    if (u.funding.kind !== "eip712") throw new Error("not eip712");
    const td = u.funding.typedData;
    expect(td.primaryType).toBe("ReceiveWithAuthorization");
    expect((td.message as { nonce: string }).nonce).toBe(E.ES3.expectNonce);
    const five = ["address", "address", "address", "bytes32", "address"].map((type) => ({ type }));
    expect(keccak256(encodeAbiParameters(five, [f.payer, f.recipient, f.usdc, H, ZERO]))).toBe(E.ES3.expectNonce);
    affix(typeHash(E.ES4.typeSignature), E.ES4.expectTypeHash);
    expect(hashTypedData(forViem(td))).toBe(E.ES4.expectDigest);
    const signature = await payer.signTypedData(forViem(td));
    affix(signature, E.ES4.expectSignature);
    const cred = u.complete(signature, await voucherSig(u, signature)) as MppCredential;
    // complete's credential is buyer B6's presented, whole; B6's note says how it is written by hand from the draft.
    expect(cred).toStrictEqual(b6(E));
    expect(JSON.stringify(cred.payload)).toBe(JSON.stringify(b6(E).payload));
    expect(cred.payload["salt"]).toBe(H);
    expect(cred.payload["authorizedSigner"]).toBe(ZERO);
    expect(await sessionEvm.bound(cred)).toBe(H);
    expect(sessionEvm.channel.kind(cred)).toBe("open");
    expect(await sessionEvm.channel.ref(cred)).toEqual({ network: "eip155:84532", channel: E.ES1.expectChannelId });
    const ref = (await sessionEvm.reference(cred)) as SessionRef;
    expect(ref.transferLog?.digest).toBe(E.ES7.expectIdentity);
    expect(JSON.parse(JSON.stringify(ref))).toMatchObject({
      network: "eip155:84532",
      settleBy: "1790000060",
      bindingLog: { address: f.usdc, index: 2, value: E.ES3.expectNonce },
      search: { address: f.usdc, topics: [expect.any(String), null, E.ES3.expectNonce] },
    });
  });

  it("ES5: the voucher", async () => {
    const u = await build("hash");
    const v = u.voucher(`0x${"44".repeat(32)}`);
    expect(v).toMatchObject({ domain: { name: "EVM Payment Channel", version: "1", chainId: 84532, verifyingContract: f.escrow } });
    expect(hashTypedData(forViem(v))).toBe(E.ES5.expectVoucherDigest);
  });

  it("ES6: the Permit2 opening", async () => {
    const u = await build("permit2");
    if (u.funding.kind !== "eip712") throw new Error("not eip712");
    const td = u.funding.typedData;
    affix(typeHash(E.ES6.typeSignature), E.ES6.expectTypeHash);
    expect((td.message as { nonce: bigint }).nonce.toString()).toBe(E.ES6.expectNonce);
    expect((td.message as { spender: string }).spender).toBe(f.escrow);
    expect(hashTypedData(forViem(td))).toBe(E.ES6.expectDigest);
    const signature = await payer.signTypedData(forViem(td));
    const cred = u.complete(signature, await voucherSig(u, signature)) as MppCredential;
    expect(await sessionEvm.bound(cred)).toBe(H);
    const ref = (await sessionEvm.reference(cred)) as SessionRef;
    expect(ref.transferLog?.digest).toBe(E.ES7.expectIdentity);
    expect(ref.settleBy).toBe("1790000060");
  });

  it("ES7: the hash opening's identity is payer to escrow", async () => {
    const u = await build("hash");
    const hash = `0x${"55".repeat(32)}` as ViemHex;
    const cred = u.complete(hash, await voucherSig(u, hash)) as MppCredential;
    expect(await sessionEvm.bound(cred)).toBe(H);
    // The payer broadcast the opening before the claim; the reference names the transaction the credential presents,
    // so the opening is read without the seller's report.
    const ref = (await sessionEvm.reference(cred)) as SessionRef;
    expect(ref.transferLog).toEqual({ address: f.usdc, topic0: TRANSFER_TOPIC, identity: "from,to", digest: E.ES7.expectFromTo });
    expect(ref.transaction).toBe(hash);
    expect(ref.settleBy).toBeUndefined();
    expect(sessionEvm.landedTx(cred)).toBe(hash);
    expect(sessionEvm.landedTx({ ...cred, payload: { ...cred.payload, type: "authorization" } })).toBeUndefined();
    expect(await transferDigest({ from: f.payer, to: f.escrow, value: deposit })).toBe(E.ES7.expectIdentity);
  });

  it("the openings' complete takes signatures of 1 to 8192 bytes: EIP-2098's 64-byte form", async () => {
    const a = await build("authorization");
    if (a.funding.kind !== "eip712") throw new Error("not eip712");
    const signature = compact(await payer.signTypedData(forViem(a.funding.typedData)));
    const voucher = compact(await voucherSig(a, signature));
    expect(toBytes(signature).length).toBe(64);
    expect(a.complete(signature, voucher)).toMatchObject({ payload: { signature, voucherSignature: voucher } });
    const u = await build("hash");
    const hash = `0x${"55".repeat(32)}` as ViemHex;
    const hashVoucher = compact(await voucherSig(u, hash));
    expect(u.complete(hash, hashVoucher)).toMatchObject({ payload: { hash, signature: hashVoucher } });
    for (const bad of BAD_SIGNATURES) {
      expect(a.complete(bad, voucher)).toEqual(malformed);
      expect(a.complete(signature, bad)).toEqual(malformed);
      expect(u.complete(hash, bad)).toEqual(malformed);
    }
  });

  it("ES8: refusals, the deposit merge, a voucher, and a named channel", async () => {
    const u = await build("hash");
    const hash = `0x${"55".repeat(32)}` as ViemHex;
    const cred = u.complete(hash, await voucherSig(u, hash)) as MppCredential;
    const idH2 = evmChannelId({ payer: f.payer, payee: f.recipient, token: f.usdc, salt: H2, authorizedSigner: ZERO, escrow: f.escrow, chainId: f.chainId });
    expect(await sessionEvm.bound({ ...cred, payload: { ...cred.payload, salt: H2, channelId: idH2 as string } })).toEqual(E.ES8.expectSaltH2);
    expect(await sessionEvm.bound({ ...cred, payload: { ...cred.payload, channelId: idH2 as string } })).toEqual(E.ES8.expectChannelH2);
    const { source: _source, ...noSource } = cred;
    expect(await sessionEvm.bound(noSource as MppCredential)).toEqual(E.ES8.expectNoSource);

    const a = await build("authorization");
    if (a.funding.kind !== "eip712") throw new Error("not eip712");
    const signature = await payer.signTypedData(forViem(a.funding.typedData));
    const opened = a.complete(signature, await voucherSig(a, signature)) as MppCredential;
    const p = opened.payload;
    const merged: MppCredential = {
      ...opened,
      payload: {
        action: "voucher",
        channelId: p["channelId"]!,
        cumulativeAmount: "0",
        signature: p["voucherSignature"]!,
        deposit: { action: "open", type: "authorization", authorization: p["authorization"]!, signature, salt: H },
      },
    };
    expect(sessionEvm.channel.kind(merged)).toBe(E.ES8.expectDepositKind);
    expect(await sessionEvm.bound(merged)).toBe(H);
    const voucher: MppCredential = { ...opened, payload: { action: "voucher", channelId: p["channelId"]!, cumulativeAmount: "10", signature: p["voucherSignature"]! } };
    expect(sessionEvm.channel.kind(voucher)).toBe(E.ES8.expectVoucherKind);
    expect(await sessionEvm.channel.boundWithin(voucher)).toEqual(E.ES8.expectBoundWithin);
    expect(await sessionEvm.bound(voucher)).toEqual({ refused: true, code: "mpp/not-an-opening" });
    expect(sessionEvm.channel.kind({ ...voucher, payload: { action: "close", channelId: p["channelId"]! } })).toBe("close");
    expect(sessionEvm.channel.kind({ ...voucher, payload: { action: "settle" } })).toEqual({ refused: true, code: "mpp/session-action" });
    expect(sessionEvm.channel.until(voucher)).toBeUndefined();
    const named = JSON.parse(f.request);
    named.methodDetails.channelId = E.ES1.expectChannelId;
    const resume = challenge("evm", "session", JSON.stringify(named));
    expect(pairingsOf(resume)).toEqual(E.ES8.expectChannelNamed);
    expect(sessionResume(resume)).toEqual({ network: "eip155:84532", channel: E.ES1.expectChannelId });
    // A challenge with no `channelId` is a new channel ("New channel (no `channelId`)", draft-hedera-session-00 L681, as
    // the EVM session draft reads): it names none.
    expect(sessionResume(ES)).toBeNull();
    expect(sessionEvm.closeRef(ES, E.ES1.expectChannelId)).toEqual({
      network: "eip155:84532",
      closes: { escrow: f.escrow.toLowerCase(), channel: E.ES1.expectChannelId.toLowerCase() },
    });
  });

  it("plant 3: an authorization nonce over another ATR's salt does not commit to this salt", async () => {
    const a = await build("authorization");
    if (a.funding.kind !== "eip712") throw new Error("not eip712");
    const signature = await payer.signTypedData(forViem(a.funding.typedData));
    const cred = a.complete(signature, await voucherSig(a, signature)) as MppCredential;
    const five = ["address", "address", "address", "bytes32", "address"].map((type) => ({ type }));
    const nonceH2 = keccak256(encodeAbiParameters(five, [f.payer, f.recipient, f.usdc, H2, ZERO]));
    affix(nonceH2, E.plant3.expectNonceH2);
    const planted = structuredClone(cred);
    (planted.payload["authorization"] as { nonce: string }).nonce = nonceH2;
    expect(planted.payload["salt"]).toBe(H);
    expect(await sessionEvm.bound(planted)).toEqual(E.plant3.expect);
  });

  // `permit2Contract` is the verifying contract the Permit2 opening signs (draft-evm-session-00 L942); an absent
  // `credentialTypes` defaults to `["hash"]` (L948). Its form is checked where `credentialTypes` lists `permit2`.
  it("pairingsOf checks permit2Contract only where credentialTypes lists permit2", () => {
    const r = JSON.parse(E.fixed.request);
    const { credentialTypes: _listed, ...unlisted } = r.methodDetails;
    const withDetails = (md: object) => challenge("evm", "session", JSON.stringify({ ...r, methodDetails: { ...unlisted, ...md } }));
    expect(pairingsOf(withDetails({ permit2Contract: "nope" }))).toEqual(["mpp/session/evm"]);
    expect(pairingsOf(withDetails({ credentialTypes: ["hash", "authorization"], permit2Contract: "nope" }))).toEqual(["mpp/session/evm"]);
    expect(pairingsOf(withDetails({ credentialTypes: ["hash", "permit2"], permit2Contract: "nope" }))).toEqual({
      refused: true,
      code: "mpp/request-malformed",
    });
  });

  it("the record", () => {
    expect(sessionEvm.pattern).toEqual(Object.fromEntries(Object.entries(E.pattern).filter(([k]) => k !== "claims")));
    expect(sessionEvm.claims).toBe(E.pattern.claims);
  });
});

/** The vector's T for a v2 open call `calldata`, signed by the payer over keccak256(0x76 ‖ rlp(fields)). */
async function openWire(calldata: ViemHex): Promise<Uint8Array> {
  const fields = [
    num(42431),
    num(1),
    num(2),
    num(200000),
    [[T.fixed.escrowV2, "0x", calldata]],
    [],
    toHex((1n << 256n) - 1n),
    "0x",
    num(1790000060),
    "0x",
    T.fixed.pathUSD,
    "0x",
    [],
  ] as const;
  const signature = await sig65(keccak256(concat(["0x76", toRlp(fields as never)])));
  return toBytes(concat(["0x76", toRlp([...fields, signature] as never)]));
}

describe("mpp-session-tempo.json", () => {
  const f = T.fixed;
  const V2 = challenge("tempo", "session", f.requestV2);
  const V1 = challenge("tempo", "session", f.requestV1);
  const deposit = BigInt(f.deposit);
  const descriptor = (salt: `0x${string}`, nonceHash: `0x${string}`) => ({
    payer: f.payer,
    payee: f.recipient,
    operator: ZERO,
    token: f.pathUSD,
    salt,
    authorizedSigner: ZERO,
    expiringNonceHash: nonceHash,
  });

  it("the constants are the keccak of their signatures", () => {
    const c = T.constants;
    expect(typeHash(c.OPEN_V2).slice(0, 10)).toBe(OPEN_V2_SELECTOR);
    expect(typeHash(c.OPEN_V1).slice(0, 10)).toBe(OPEN_V1_SELECTOR);
    expect(typeHash(c.CHANNEL_OPENED_V2)).toBe(CHANNEL_OPENED_V2_TOPIC);
    expect(typeHash(c.CHANNEL_OPENED_V1)).toBe(CHANNEL_OPENED_V1_TOPIC);
    expect(typeHash(c.CHANNEL_CLOSED_V2)).toBe(CHANNEL_CLOSED_V2_TOPIC);
    expect(typeHash(c.CHANNEL_CLOSED_V1)).toBe(CHANNEL_CLOSED_V1_TOPIC);
    expect(typeHash(c.KEY_AUTHORIZATION_WITNESS)).toBe(KEY_AUTHORIZATION_WITNESS_TOPIC);
    expect(typeHash(c.KEY_REVOKED)).toBe(KEY_REVOKED_TOPIC);
    expect(TIP20_CHANNEL_RESERVE).toBe(c.expectTip20ChannelReserve);
    expect(ACCOUNT_KEYCHAIN).toBe(c.expectAccountKeychain);
    // Lowercase, so that a checksum-validating client accepts them: viem 2.57.4's isAddress.
    expect(isAddress(TIP20_CHANNEL_RESERVE)).toBe(true);
    expect(isAddress(ACCOUNT_KEYCHAIN)).toBe(true);
  });

  // TS1.expectCalldata is eth-abi 6.0.0's open(address,address,address,uint96,bytes32,address) in the order of viem
  // 2.57.4's tempo Abis.tip20ChannelReserve, whose encodeFunctionData re-derives it here; build's whole funding is held
  // to it.
  it("TS1-TS4: the v2 open, byte for byte as eth-abi and viem's channel reserve ABI encode it, its wire, nonce hash, channel id, vouchers and bound", async () => {
    expect(
      encodeFunctionData({
        abi: TempoAbis.tip20ChannelReserve,
        functionName: "open",
        args: [f.recipient.toLowerCase(), ZERO, f.pathUSD, deposit, H, ZERO],
      }),
    ).toBe(T.TS1.expectCalldata);
    const ch = placed(V2);
    const u = unsignedOf(await sessionTempo.build({ challenge: ch, from: f.payer, now: f.now, deposit }, H));
    expect(u.funding).toEqual({
      kind: "tempo-call",
      chainId: 42431,
      call: { to: f.escrowV2, data: T.TS1.expectCalldata },
      validBefore: 1790000060,
      broadcast: false,
    });
    if (u.funding.kind !== "tempo-call") throw new Error("not a tempo call");
    const data = u.funding.call.data;
    expect(toBytes(data).length).toBe(T.TS1.expectLength);
    expect(data.slice(0, 10)).toBe(T.TS1.expectSelector);
    const wire = await openWire(data);
    expect(wire.length).toBe(T.TS2.expectLength);
    expect(sha256(wire)).toBe(T.TS2.expectSha256);
    expect(expiringNonceHash(wire, f.payer)).toBe(T.TS2.expectNonceHash);
    const d = descriptor(H, T.TS2.expectNonceHash);
    expect(tempoChannelId({ ...d, escrow: f.escrowV2, chainId: 42431 })).toBe(T.TS3.expectChannelId);
    const nine = ["address", "address", "address", "address", "bytes32", "address", "bytes32", "address", "uint256"].map((type) => ({ type }));
    expect(keccak256(encodeAbiParameters(nine, [d.payer, d.payee.toLowerCase(), d.operator, d.token, d.salt, d.authorizedSigner, d.expiringNonceHash, f.escrowV2.toLowerCase(), 42431n])))
      .toBe(T.TS3.expectChannelId);
    const voucher = u.voucher(toHex(wire));
    expect(voucher).toMatchObject({ domain: { name: "TIP20 Channel Reserve", chainId: 42431, verifyingContract: f.escrowV2 } });
    expect(hashTypedData(forViem(voucher))).toBe(T.TS4.expectVoucher0);
    const v250 = { ...(voucher as object), message: { channelId: T.TS3.expectChannelId, cumulativeAmount: 250n } };
    affix(hashTypedData(forViem(v250)), T.TS4.expectVoucher250);
    expect(hashTypedData(forViem(v250))).toBe(T.TS4.expectVoucher250.whole);
    const cred = u.complete(toHex(wire), await payer.signTypedData(forViem(voucher))) as MppCredential;
    // complete's credential is buyer B6's presented, whole; B6's note says how it is written by hand from the draft.
    expect(cred).toStrictEqual(b6(T));
    expect(JSON.stringify(cred.payload)).toBe(JSON.stringify(b6(T).payload));
    expect(cred.payload["channelId"]).toBe(T.TS3.expectChannelId);
    expect(cred.payload["descriptor"]).toEqual(d);
    expect(await sessionTempo.bound(cred)).toBe(H);
    expect(sessionTempo.channel.kind(cred)).toBe("open");
    // The seller broadcasts the opening after the claim, so the reference carries the escrow's ChannelOpened filter
    // naming the channel in topic 1, and the opening is found without the seller's report.
    const ref = (await sessionTempo.reference(cred)) as SessionRef;
    expect(JSON.parse(JSON.stringify(ref))).toEqual({
      network: "eip155:42431",
      settleBy: "1790000060",
      search: { address: f.escrowV2, topics: [typeHash(T.constants.CHANNEL_OPENED_V2), T.TS3.expectChannelId] },
      opened: { address: f.escrowV2, version: "v2", channel: T.TS3.expectChannelId, h: H, chainId: 42431 },
    });

    const within = JSON.parse(f.requestV2);
    within.methodDetails.channelId = T.TS3.expectChannelId;
    const own = { ...challenge("tempo", "session", JSON.stringify(within)), id: "seller-own-id" };
    const v = (desc: object, channelId: string): MppCredential => ({
      challenge: own,
      payload: { action: "voucher", channelId, cumulativeAmount: "250", signature: "0x" + "66".repeat(65), descriptor: desc as never },
    });
    expect(sessionTempo.channel.kind(v(d, T.TS3.expectChannelId))).toBe("within");
    expect(await sessionTempo.channel.boundWithin(v(d, T.TS3.expectChannelId))).toBe(H);
    const dH2 = descriptor(H2, T.TS2.expectNonceHash);
    const idH2 = tempoChannelId({ ...dH2, escrow: f.escrowV2, chainId: 42431 }) as string;
    affix(idH2, T.TS4.expectChannelIdH2);
    // TS4.expectChannelIdH2.whole is eth-abi's and eth-utils' v2 channel id with salt H2 (TS4's case); viem re-derives
    // it, and tempoChannelId is held to it.
    expect(keccak256(encodeAbiParameters(nine, [dH2.payer, dH2.payee.toLowerCase(), dH2.operator, dH2.token, dH2.salt, dH2.authorizedSigner, dH2.expiringNonceHash, f.escrowV2.toLowerCase(), 42431n])))
      .toBe(T.TS4.expectChannelIdH2.whole);
    expect(idH2).toBe(T.TS4.expectChannelIdH2.whole);
    expect(await sessionTempo.channel.boundWithin(v(dH2, idH2))).toBe(H2);
    expect(await sessionTempo.channel.boundWithin(v(dH2, T.TS3.expectChannelId))).toEqual(T.TS4.expectMismatch);
    expect(await sessionTempo.channel.ref(v(d, T.TS3.expectChannelId))).toEqual({ network: "eip155:42431", channel: T.TS3.expectChannelId });
    expect(sessionResume(own)).toEqual({ network: "eip155:42431", channel: T.TS3.expectChannelId });
    expect(sessionTempo.closeRef(V2, T.TS3.expectChannelId)).toEqual(T.TS3.expectCloseRef);
    expect(T.TS3.expectCloseRef.bindingLog.topic0).toBe(CHANNEL_CLOSED_V2_TOPIC);
  });

  it("TS2: expiringNonceHash is keccak256 of ox's encodeForSigning and the sender, with and without a fee payer", async () => {
    const Tx = TempoTransaction.z_TxEnvelopeTempo;
    const u = unsignedOf(await sessionTempo.build({ challenge: placed(V2), from: f.payer, now: f.now, deposit }, H));
    if (u.funding.kind !== "tempo-call") throw new Error("not a tempo call");
    const wire = await openWire(u.funding.call.data);
    const env = Tx.deserialize(toHex(wire) as never);
    const expected = keccak256(concat([Tx.encodeForSigning(env), f.payer]));
    expect(expected).toBe(T.TS2.expectNonceHash);
    expect(expiringNonceHash(wire, f.payer)).toBe(expected);
    const sponsored = { ...env, feePayerSignature: { r: 3n, s: 4n, yParity: 1 } };
    const signed = Tx.serialize(sponsored as never, { signature: env.signature } as never);
    expect(expiringNonceHash(toBytes(signed), f.payer)).toBe(keccak256(concat([Tx.encodeForSigning(sponsored as never), f.payer])));
    expect(expiringNonceHash(toBytes(signed), f.payer)).not.toBe(expected);
  });

  // TS5.expectOpenCalldata is eth-abi 6.0.0's open(address payee, address token, uint128 deposit, bytes32 salt, address
  // authorizedSigner), the v1 escrow's (draft-tempo-session-00, tempoxyz/mpp-specs 08e7dd87, L429-435); viem 2.57.4's
  // encodeFunctionData re-derives it here, and build's whole funding is held to it.
  it("TS5: v1's open, byte for byte as eth-abi and viem encode it, channel id and voucher", async () => {
    const v1Open = parseAbi(["function open(address payee, address token, uint128 deposit, bytes32 salt, address authorizedSigner)"]);
    expect(encodeFunctionData({ abi: v1Open, functionName: "open", args: [f.recipient.toLowerCase(), f.pathUSD, deposit, H, ZERO] })).toBe(
      T.TS5.expectOpenCalldata,
    );
    expect(evmChannelId({ payer: f.payer, payee: f.recipient, token: f.pathUSD, salt: H, authorizedSigner: ZERO, escrow: f.escrowV1, chainId: 42431 }))
      .toBe(T.TS5.expectChannelId);
    const ch = placed(V1);
    const u = unsignedOf(await sessionTempo.build({ challenge: ch, from: f.payer, now: f.now, deposit }, H));
    expect(u.funding).toEqual({
      kind: "tempo-call",
      chainId: 42431,
      call: { to: f.escrowV1, data: T.TS5.expectOpenCalldata },
      validBefore: 1790000060,
      broadcast: false,
    });
    if (u.funding.kind !== "tempo-call") throw new Error("not a tempo call");
    expect(u.funding.call.data.slice(0, 10)).toBe(OPEN_V1_SELECTOR);
    expect(toBytes(u.funding.call.data).length).toBe(164);
    const voucher = u.voucher(toHex(await openWire(u.funding.call.data)));
    expect(voucher).toMatchObject({ domain: { name: "Tempo Stream Channel" }, message: { channelId: T.TS5.expectChannelId } });
    affix(hashTypedData(forViem(voucher)), T.TS5.expectVoucher);
    expect(hashTypedData(forViem(voucher))).toBe(T.TS5.expectVoucher.whole);
    expect(sessionTempo.closeRef(V1, T.TS5.expectChannelId)).toEqual(T.TS5.expectCloseRef);
    expect(T.TS5.expectCloseRef.bindingLog.topic0).toBe(CHANNEL_CLOSED_V1_TOPIC);
  });

  it("TS6: sessionStatus on fixture receipts", async () => {
    const opened = (address: string, salt: `0x${string}`): EvmLog => ({
      address: address as `0x${string}`,
      topics: [CHANNEL_OPENED_V2_TOPIC, T.TS3.expectChannelId, topicOf(f.payer), topicOf(f.recipient)],
      data: concat([wordOf(0n), topicOf(f.pathUSD), wordOf(0n), salt as ViemHex, T.TS2.expectNonceHash as ViemHex, wordOf(deposit)]) as ViemHex,
    });
    const ref = {
      network: "eip155:42431" as const,
      transaction: `0x${"77".repeat(32)}` as `0x${string}`,
      opened: { address: f.escrowV2, version: "v2" as const, channel: T.TS3.expectChannelId, h: H, chainId: 42431 },
    };
    const run = async (r: SessionRef & { transaction: `0x${string}` }, logs: EvmLog[]) =>
      withBigints(await sessionStatus(r, readerFor("eip155:42431", { status: 1, blockNumber: "100", logs })));
    expect(await run(ref, [opened(f.escrowV2, H)])).toEqual(T.TS6.expectSettled);
    expect(await run(ref, [opened(f.escrowV2, H2)])).toEqual(T.TS6.expectNotFound);
    expect(await run(ref, [opened("0x20c0000000000000000000000000000000000001", H)])).toEqual(T.TS6.expectNotFound);
    const v1: EvmLog = {
      address: f.escrowV1,
      topics: [CHANNEL_OPENED_V1_TOPIC, T.TS5.expectChannelId, topicOf(f.payer), topicOf(f.recipient)],
      data: concat([topicOf(f.pathUSD), wordOf(0n), wordOf(deposit)]),
    };
    const refV1 = { ...ref, opened: { address: f.escrowV1, version: "v1" as const, channel: T.TS5.expectChannelId, h: H, chainId: 42431 } };
    expect(await run(refV1, [v1])).toEqual(T.TS6.expectSettled);
    expect(await run({ ...refV1, opened: { ...refV1.opened, h: H2 } }, [v1])).toEqual(T.TS6.expectNotFound);
  });

  it("L1: a live v2 open on Moderato", async () => {
    const raw = toBytes(T.L1.raw);
    expect(raw.length).toBe(T.L1.expectLength);
    affix(sha256(raw), T.L1.expectSha256);
    const tx = decodeTempoTx(raw);
    if ("refused" in tx) throw new Error(tx.code);
    const opens = tx.calls.filter((c) => c.to === T.fixed.escrowV2.toLowerCase() && toHex(c.input.subarray(0, 4)) === OPEN_V2_SELECTOR);
    expect(opens.length).toBe(1);
    const salt = toHex(opens[0]!.input.subarray(4 + 128, 4 + 160));
    affix(salt, T.L1.expectSalt);
    const event = T.L1.receipt.logs.find((l: EvmLog) => l.topics[0] === CHANNEL_OPENED_V2_TOPIC) as EvmLog;
    const word = (i: number) => `0x${event.data.slice(2 + 64 * i, 2 + 64 * (i + 1))}`;
    expect(word(3)).toBe(salt);
    const nonceHash = expiringNonceHash(raw, T.L1.sender) as string;
    affix(nonceHash, T.L1.expectNonceHash);
    expect(nonceHash).toBe(word(4));
    const id = tempoChannelId({
      payer: `0x${event.topics[2]!.slice(26)}`,
      payee: `0x${event.topics[3]!.slice(26)}`,
      operator: `0x${word(0).slice(26)}`,
      token: `0x${word(1).slice(26)}`,
      salt,
      authorizedSigner: `0x${word(2).slice(26)}`,
      expiringNonceHash: nonceHash as `0x${string}`,
      escrow: T.fixed.escrowV2,
      chainId: 42431,
    }) as string;
    affix(id, T.L1.expectChannelId);
    expect(id).toBe(event.topics[1]);
    const block = BigInt(T.L1.receipt.blockNumber);
    const status = await sessionStatus(
      {
        network: "eip155:42431",
        transaction: "0x274c152568833e92246fdb8a01271e4af32c60edd2e561a53dcac3346865e1d1",
        opened: { address: T.fixed.escrowV2, version: "v2", channel: id as `0x${string}`, h: salt as `0x${string}`, chainId: 42431 },
      },
      readerFor("eip155:42431", T.L1.receipt, block, block),
    );
    expect(status.state).toBe("settled");
  });

  it("recover: the salt of the live v2 opening's ChannelOpened, the salt its signed open call carries", async () => {
    const block = BigInt(T.L1.receipt.blockNumber);
    const ref = { network: "eip155:42431", transaction: "0x274c152568833e92246fdb8a01271e4af32c60edd2e561a53dcac3346865e1d1" as `0x${string}` };
    const salt = (await sessionTempo.recover(ref, readerFor("eip155:42431", T.L1.receipt, block, block))) as string;
    affix(salt, T.L1.expectSalt);
    const tx = decodeTempoTx(toBytes(T.L1.raw));
    if ("refused" in tx) throw new Error(tx.code);
    const open = tx.calls.find((c) => toHex(c.input.subarray(0, 4)) === OPEN_V2_SELECTOR)!;
    expect(salt).toBe(toHex(open.input.subarray(4 + 128, 4 + 160)));
  });

  it("recover reads only the receipt: one call", async () => {
    const block = BigInt(T.L1.receipt.blockNumber);
    const ref = { network: "eip155:42431", transaction: "0x274c152568833e92246fdb8a01271e4af32c60edd2e561a53dcac3346865e1d1" as `0x${string}` };
    const live = readerFor("eip155:42431", T.L1.receipt, block, block);
    const seen: string[] = [];
    const counting: EvmReader = {
      network: live.network,
      receipt: async (tx) => (seen.push("receipt"), live.receipt(tx)),
      blockNumber: async (tag) => (seen.push("blockNumber"), live.blockNumber(tag)),
      transaction: async (tx) => (seen.push("transaction"), live.transaction(tx)),
      call: async (to, data, at) => (seen.push("call"), live.call(to, data, at)),
    };
    expect(await sessionTempo.recover(ref, counting)).toBe(await sessionTempo.recover(ref, live));
    expect(seen).toEqual(["receipt"]);
  });

  it("recover: only the channel reserve's ChannelOpened gives the salt; a v1 opening's event carries none", async () => {
    // ITIP20ChannelReserve's ChannelOpened (tempo tips/verify, TIP-1034): salt is data word 3. The v1 escrow's
    // ChannelOpened (draft-tempo-session-00) carries no salt.
    const opened = (address: string, salt: `0x${string}`): EvmLog => ({
      address: address as `0x${string}`,
      topics: [CHANNEL_OPENED_V2_TOPIC, T.TS3.expectChannelId, topicOf(f.payer), topicOf(f.recipient)],
      data: concat([wordOf(0n), topicOf(f.pathUSD), wordOf(0n), salt as ViemHex, T.TS2.expectNonceHash as ViemHex, wordOf(deposit)]) as ViemHex,
    });
    const v1: EvmLog = {
      address: f.escrowV1,
      topics: [CHANNEL_OPENED_V1_TOPIC, T.TS5.expectChannelId, topicOf(f.payer), topicOf(f.recipient)],
      data: concat([topicOf(f.pathUSD), wordOf(0n), wordOf(deposit)]),
    };
    const ref = { network: "eip155:42431", transaction: `0x${"77".repeat(32)}` as `0x${string}` };
    const run = (logs: EvmLog[], status: 0 | 1 = 1) => sessionTempo.recover(ref, readerFor("eip155:42431", { status, blockNumber: "100", logs }));
    expect(TIP20_CHANNEL_RESERVE.toLowerCase()).toBe(f.escrowV2.toLowerCase());
    expect(await run([opened(f.escrowV2, H)])).toBe(H);
    expect(await run([opened(f.escrowV2, H), opened(f.escrowV2, H)])).toBe(H);
    expect(await run([opened(f.escrowV2, H), opened(f.escrowV2, H2)])).toEqual({ refused: true, code: "tempo/ambiguous" });
    expect(await run([opened("0x20c0000000000000000000000000000000000001", H)])).toEqual({ refused: true, code: "tempo/open-not-found" });
    expect(await run([v1])).toEqual({ refused: true, code: "tempo/open-not-found" });
    expect(await run([opened(f.escrowV2, H)], 0)).toEqual({ refused: true, code: "tempo/reverted" });
    expect(await sessionTempo.recover(ref, readerFor("eip155:42431", null))).toEqual({ refused: true, code: "tempo/not-found" });
    // A reader for another network, and a ref that is not an object, answer as the subscription's recover does.
    const other = readerFor("eip155:4217", { status: 1, blockNumber: "100", logs: [opened(f.escrowV2, H)] });
    expect(await sessionTempo.recover(ref, other)).toEqual(await witnessRecover(ref, other));
    expect(await sessionTempo.recover(null as never, other)).toEqual(await witnessRecover(null as never, other));
  });

  it("complete takes a voucher signature of 1 to 8192 bytes: EIP-2098's 64-byte form", async () => {
    const u = unsignedOf(await sessionTempo.build({ challenge: placed(V2), from: f.payer, now: f.now, deposit }, H));
    if (u.funding.kind !== "tempo-call") throw new Error("not a tempo call");
    const wire = toHex(await openWire(u.funding.call.data));
    const voucher = compact(await payer.signTypedData(forViem(u.voucher(wire))));
    expect(toBytes(voucher).length).toBe(64);
    expect(u.complete(wire, voucher)).toMatchObject({ payload: { signature: voucher } });
    for (const bad of BAD_SIGNATURES) expect(u.complete(wire, bad)).toEqual(malformed);
  });

  it("plant 1: an opening whose signed salt is another ATR's hash", async () => {
    const ch = placed(V2);
    const u = unsignedOf(await sessionTempo.build({ challenge: ch, from: f.payer, now: f.now, deposit }, H));
    if (u.funding.kind !== "tempo-call") throw new Error("not a tempo call");
    const wire = await openWire(u.funding.call.data);
    const cred = u.complete(toHex(wire), `0x${"66".repeat(65)}`) as MppCredential;
    const plantedData = u.funding.call.data.replace(H.slice(2), H2.slice(2)) as ViemHex;
    const planted = { ...cred, payload: { ...cred.payload, transaction: toHex(await openWire(plantedData)) } };
    expect(await sessionTempo.bound(planted)).toEqual(T.plant1.expect);
  });

  it("the record", () => {
    expect(sessionTempo.pattern).toEqual(Object.fromEntries(Object.entries(T.pattern).filter(([k]) => k !== "claims")));
  });
});

describe("the EVM and Tempo sessions' records", () => {
  // The record reads the opening, never a later voucher, so each proves states what the opening shows and none says
  // that later requests in the channel were paid under this ATR. Each voucher signs the channel id, which commits to the
  // salt, H, so each proves ends with that sentence, written word for word.
  it("each proves ends with the voucher's commitment, and none speaks of later requests", () => {
    for (const b of [sessionEvm, sessionTempo]) {
      expect(b.pattern.proves.endsWith(" Each voucher in this channel signs a commitment to this ATR's hash.")).toBe(true);
      expect(b.pattern.proves).not.toMatch(/later requests|paid under this ATR|did not meter/i);
    }
  });
});

describe("mpp-subscription-tempo.json", () => {
  const f = U.fixed;
  const SUB = challenge("tempo", "subscription", f.request);
  const ch = placed(SUB);
  const authOf = (a: typeof U.SUB1.authorization, witness: string): TempoKeyAuthorization => ({
    chainId: BigInt(a.chainId),
    keyType: a.keyType,
    keyId: a.keyId,
    expiry: BigInt(a.expiry),
    limits: a.limits.map((l: { token: `0x${string}`; limit: string; period: string }) => ({ token: l.token, limit: BigInt(l.limit), period: BigInt(l.period) })),
    allowedCalls: a.allowedCalls,
    witness: witness as `0x${string}`,
  });

  it("SUB1: the key authorization's RLP, digest and signed form", async () => {
    const a = authOf(U.SUB1.authorization, H);
    const unsigned = encodeKeyAuthorization(a) as Uint8Array;
    expect(unsigned.length).toBe(U.SUB1.expectUnsignedLength);
    expect(keccak256(unsigned)).toBe(U.SUB1.expectDigest);
    const viemRlp = toRlp([
      num(a.chainId),
      num(a.keyType),
      a.keyId,
      num(a.expiry),
      [[f.pathUSD, num(10000000), num(2592000)]],
      [[f.pathUSD, [["0x95777d59", [f.recipient]]]]],
      H,
    ] as never);
    expect(toHex(unsigned)).toBe(viemRlp.toLowerCase());
    expect(new Date(1797724800 * 1000).toISOString()).toBe("2026-12-20T00:00:00.000Z");
    const u = (await subscriptionTempo.build({ challenge: ch, from: f.payer, now: f.now }, H)) as KeyAuthorizationUnsigned;
    expect(withBigints(u.request.authorization)).toEqual(withBigints(a));
    expect(u.request.digest).toBe(U.SUB1.expectDigest);
    const rootSignature = await sig65(u.request.digest);
    expect(await recoverAddress({ hash: u.request.digest, signature: rootSignature })).toBe(f.payer);
    const cred = u.complete(rootSignature) as MppCredential;
    // complete's credential is buyer B6's presented, whole; B6's note says how it is written by hand from the draft.
    expect(cred).toStrictEqual(b6(U));
    expect(JSON.stringify(cred.payload)).toBe(JSON.stringify(b6(U).payload));
    expect(toBytes(cred.payload["signature"] as ViemHex).length).toBe(U.SUB1.expectSignedLength);
    expect(toHex(encodeKeyAuthorization(a, rootSignature) as Uint8Array)).toBe(toRlp([fromRlp(viemRlp), rootSignature] as never).toLowerCase());
  });

  it("complete takes a root signature of 1 to 8192 bytes: EIP-2098's 64-byte form, in viem's RLP", async () => {
    const u = (await subscriptionTempo.build({ challenge: ch, from: f.payer, now: f.now }, H)) as KeyAuthorizationUnsigned;
    const root = compact(await sig65(u.request.digest));
    expect(toBytes(root).length).toBe(64);
    const unsigned = toHex(encodeKeyAuthorization(authOf(U.SUB1.authorization, H)) as Uint8Array);
    expect(u.complete(root)).toMatchObject({ payload: { signature: toRlp([fromRlp(unsigned), root] as never).toLowerCase() } });
    for (const bad of BAD_SIGNATURES) expect(u.complete(bad)).toEqual(malformed);
  });

  it("SUB2 and SUB3: bound, the channel members and reference", async () => {
    expect(ch.id).toBe("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
    const u = (await subscriptionTempo.build({ challenge: ch, from: f.payer, now: f.now }, H)) as KeyAuthorizationUnsigned;
    const cred = u.complete(await sig65(u.request.digest)) as MppCredential;
    expect(await subscriptionTempo.bound(cred)).toBe(H);
    expect(subscriptionTempo.channel.kind(cred)).toBe("open");
    expect(await subscriptionTempo.channel.ref(cred)).toEqual({ network: "eip155:42431", channel: U.SUB2.expectRefChannel });
    expect(await subscriptionTempo.channel.boundWithin(cred)).toEqual({ refused: true, code: "mpp/not-bound-within" });
    expect(subscriptionTempo.channel.until(cred)).toBe(1797724800);
    const ref = (await subscriptionTempo.reference(cred)) as SessionRef;
    expect(ref).toEqual({
      network: "eip155:42431",
      bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: H },
      transferLog: { address: U.SUB3.expectToken, topic0: TRANSFER_TOPIC, identity: "to", digest: U.SUB3.expectTransferDigest },
      search: { address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, null, H] },
      // The key's read keys: the signed authorization's key id, its token and its recipient's digest.
      accessKey: { keyId: f.accessKey.toLowerCase(), token: U.SUB3.expectToken, to: U.SUB3.expectTransferDigest },
    });
    expect(subscriptionTempo.closeRef(SUB, U.SUB2.expectRefChannel, f.payer)).toEqual({
      network: "eip155:42431",
      revokes: { account: f.payer.toLowerCase(), keyId: f.accessKey.toLowerCase() },
    });
    expect(subscriptionTempo.closeRef(SUB, U.SUB2.expectRefChannel)).toEqual({ refused: true, code: "mpp/input-malformed" });
    // Profile mpp/session rule 1: "a Tempo `subscription` challenge's id is exactly the base64url (no padding) of H".
    const positioned = { ...cred, challenge: { ...cred.challenge, id: challengeId(H, 0) as string } };
    expect(await subscriptionTempo.bound(positioned)).toEqual({ refused: true, code: "mpp/id-not-ours" });
  });

  // Tempo's key authorization wire (tempoxyz/tempo, crates/primitives/src/transaction/key_authorization.rs): a limit is
  // `TokenLimitWire { token: Address, limit: U256, period: Option<NonZeroU64> }` under `#[rlp(trailing(canonical))]`, so a
  // one-time limit (period 0) is `[token, limit]`; Tempo's test `test_token_limit_legacy_decode_defaults_period_to_zero`
  // decodes `[token, limit]` with period 0.
  it("a limit encoded [token, limit] decodes with period 0, and bound gives H", async () => {
    const base = authOf(U.SUB1.authorization, H);
    const unsigned = encodeKeyAuthorization(base) as Uint8Array;
    const items = fromRlp(toHex(unsigned)) as (ViemHex | ViemHex[][])[];
    const [limit] = base.limits;
    items[4] = [[limit!.token, toHex(limit!.limit)]];
    const authorization = toRlp(items as never);
    const signed = toRlp([fromRlp(authorization) as never, await sig65(keccak256(authorization))]);
    const k = decodeKeyAuthorization(signed);
    if ("refused" in k) throw new Error(k.code);
    expect(k.limits).toEqual([{ token: limit!.token, limit: limit!.limit, period: 0n }]);
    const credential: MppCredential = { challenge: ch, source: `did:pkh:eip155:42431:${f.payer}`, payload: { type: "keyAuthorization", signature: signed } };
    expect(await subscriptionTempo.bound(credential)).toBe(H);
  });

  it("SUB1: the activation is identified by the token and recipient the payer signed, never the request's", async () => {
    const other = "0x7777777777777777777777777777777777777777" as const;
    const credentialOf = async (a: TempoKeyAuthorization): Promise<MppCredential> => {
      const unsigned = encodeKeyAuthorization(a) as Uint8Array;
      const signed = encodeKeyAuthorization(a, await sig65(keccak256(unsigned))) as Uint8Array;
      return { challenge: ch, source: `did:pkh:eip155:42431:${f.payer}`, payload: { type: "keyAuthorization", signature: toHex(signed) } };
    };
    const base = authOf(U.SUB1.authorization, H);
    const k = decodeKeyAuthorization(toHex(encodeKeyAuthorization(base, `0x${"11".repeat(65)}`) as Uint8Array));
    if ("refused" in k) throw new Error(k.code);
    const lower = (v: unknown) => JSON.parse(JSON.stringify(withBigints(v)).toLowerCase());
    expect(lower({ limits: k.limits, allowedCalls: k.allowedCalls })).toEqual(lower({ limits: base.limits, allowedCalls: base.allowedCalls }));
    // A recipient the payer signed other than the request's: the read keys follow the signature.
    const toOther = { ...base, allowedCalls: [{ target: f.pathUSD, selectorRules: [{ selector: "0x95777d59" as const, recipients: [other] }] }] };
    const ref = (await subscriptionTempo.reference(await credentialOf(toOther))) as SessionRef;
    const digest = await transferDigest({ to: other });
    expect(ref.transferLog).toEqual({ address: f.pathUSD, topic0: TRANSFER_TOPIC, identity: "to", digest });
    expect(ref.accessKey).toEqual({ keyId: f.accessKey.toLowerCase(), token: f.pathUSD, to: digest });
    // A transfer of any amount of the signed token to the signed recipient is the activation's.
    const transfer = { address: f.pathUSD, topics: [TRANSFER_TOPIC, topicOf(f.payer), topicOf(other)], data: wordOf(1n) };
    const witness = { address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, topicOf(f.payer), H], data: "0x" as const };
    const status = await sessionStatus(
      { ...ref, transaction: `0x${"77".repeat(32)}` },
      readerFor("eip155:42431", { status: 1, blockNumber: "90", logs: [witness, transfer] as EvmLog[] }),
    );
    expect(status).toMatchObject({ state: "settled" });
    // An authorization naming no single token, as its limit and its target, and no single recipient is not read.
    // Tempo's SelectorRule (crates/primitives/src/transaction/key_authorization.rs): "Recipient allowlist. Empty means no
    // recipient restriction", so a rule with no recipients beside one naming the request's recipient names no single one.
    const malformed = { refused: true, code: "tempo/key-authorization-malformed" };
    const anyRecipient = {
      ...base,
      allowedCalls: [
        {
          target: f.pathUSD,
          selectorRules: [
            { selector: "0xa9059cbb" as const, recipients: [] },
            { selector: "0x95777d59" as const, recipients: [f.recipient] },
          ],
        },
      ],
    };
    const twoRecipients = { ...base, allowedCalls: [{ target: f.pathUSD, selectorRules: [{ selector: "0x95777d59" as const, recipients: [f.recipient, other] }] }] };
    const otherTarget = { ...base, allowedCalls: [{ target: other, selectorRules: base.allowedCalls[0]!.selectorRules }] };
    const twoTokens = { ...base, limits: [...base.limits, { token: other, limit: 1n, period: 86400n }] };
    for (const a of [twoRecipients, otherTarget, twoTokens, anyRecipient, { ...base, limits: [] }, { ...base, allowedCalls: [] }]) {
      const c = await credentialOf(a);
      expect(await subscriptionTempo.bound(c)).toBe(H);
      expect(await subscriptionTempo.reference(c)).toEqual(malformed);
    }
  });

  // Tempo's subscription draft (tempoxyz/mpp-specs 50309c8, draft-tempo-subscription-00.md :276-285 and :470-481): the
  // key authorization's selector rules are `transfer(address,uint256)` (0xa9059cbb) and optionally
  // `transferWithMemo(address,uint256,bytes32)` (0x95777d59), each restricted to the challenge's recipient, and it "MUST NOT
  // authorize `approve` or any other non-transfer selector". So only those two rules name the recipient; ERC-20's
  // `approve(address,uint256)` (0x095ea7b3) names a spender. The transfer digest is SHA-256 over the recipient's 20 bytes.
  it("SUB1: the recipient is read from the transfer and transferWithMemo rules only", async () => {
    const spender = "0x7777777777777777777777777777777777777777" as const;
    const credentialOf = async (rules: { selector: `0x${string}`; recipients: `0x${string}`[] }[]): Promise<MppCredential> => {
      const a = { ...authOf(U.SUB1.authorization, H), allowedCalls: [{ target: f.pathUSD, selectorRules: rules }] };
      const signed = encodeKeyAuthorization(a, await sig65(keccak256(encodeKeyAuthorization(a) as Uint8Array))) as Uint8Array;
      return { challenge: ch, source: `did:pkh:eip155:42431:${f.payer}`, payload: { type: "keyAuthorization", signature: toHex(signed) } };
    };
    const toRecipient = { address: f.pathUSD, topic0: TRANSFER_TOPIC, identity: "to", digest: sha256(toBytes(f.recipient)) };
    const malformed = { refused: true, code: "tempo/key-authorization-malformed" };
    const cases: [{ selector: `0x${string}`; recipients: `0x${string}`[] }[], unknown][] = [
      [[{ selector: "0x095ea7b3", recipients: [spender] }], malformed],
      [[{ selector: "0x095ea7b3", recipients: [] }], malformed],
      [[{ selector: "0x95777d59", recipients: [] }], malformed],
      [[{ selector: "0x95777d59", recipients: [f.recipient] }, { selector: "0x095ea7b3", recipients: [spender] }], toRecipient],
      [[{ selector: "0x95777d59", recipients: [f.recipient] }, { selector: "0x095ea7b3", recipients: [] }], toRecipient],
      [[{ selector: "0xa9059cbb", recipients: [f.recipient] }, { selector: "0x95777d59", recipients: [f.recipient] }], toRecipient],
      [[{ selector: "0xa9059cbb", recipients: [f.recipient] }], toRecipient],
    ];
    for (const [rules, expected] of cases) {
      const c = await credentialOf(rules);
      expect(await subscriptionTempo.bound(c)).toBe(H);
      const ref = (await subscriptionTempo.reference(c)) as SessionRef | { refused: true };
      const read = "refused" in ref ? ref : ref.transferLog;
      expect(read, JSON.stringify(rules)).toEqual(expected);
    }
  });

  // Tempo's AccountKeychain precompile interface (IAccountKeychain): KeyAuthorizationWitness(address indexed account,
  // bytes32 indexed witness), KeyAuthorized(address indexed account, address indexed publicKey, ...) and
  // KeyRevoked(address indexed account, address indexed publicKey), each from the keychain precompile.
  it("the close is the keychain's KeyRevoked of the access key by the account the activation registered it for", async () => {
    const other = "0x7777777777777777777777777777777777777777" as const;
    const log = (topic0: string, ...topics: string[]): EvmLog => ({ address: ACCOUNT_KEYCHAIN, topics: [topic0, ...topics] as `0x${string}`[], data: "0x" });
    const activation = {
      status: 1 as const,
      blockNumber: 90n,
      logs: [
        log(KEY_AUTHORIZATION_WITNESS_TOPIC, topicOf(f.payer), H),
        log(KEY_AUTHORIZED_TOPIC, topicOf(f.payer), topicOf(f.accessKey)),
      ],
    };
    const u = (await subscriptionTempo.build({ challenge: ch, from: f.payer, now: f.now }, H)) as KeyAuthorizationUnsigned;
    const ref = (await subscriptionTempo.reference(u.complete(await sig65(u.request.digest)) as MppCredential)) as SessionRef;
    const found = subscriptionTempo.keySearch(ref, activation, H) as SessionRef;
    expect(found.accessKey?.account).toBe(f.payer.toLowerCase());
    const close = subscriptionTempo.closeRef(SUB, U.SUB2.expectRefChannel, found.accessKey!.account) as SessionRef;
    const statusOf = (...logs: EvmLog[]) =>
      sessionStatus({ ...close, transaction: `0x${"77".repeat(32)}` }, readerFor("eip155:42431", { status: 1, blockNumber: "90", logs }));
    expect(await statusOf(log(KEY_REVOKED_TOPIC, topicOf(f.payer), topicOf(f.accessKey)))).toMatchObject({ state: "settled" });
    for (const logs of [
      [log(KEY_REVOKED_TOPIC, topicOf(other), topicOf(f.accessKey))],
      [log(KEY_REVOKED_TOPIC, topicOf(f.payer), topicOf(other))],
      [{ ...log(KEY_REVOKED_TOPIC, topicOf(f.payer), topicOf(f.accessKey)), address: other }],
      [],
    ]) {
      expect(await statusOf(...logs)).toEqual({ state: "failed", why: "binding-log-not-found" });
    }
    expect(subscriptionTempo.closeRef(SUB, U.SUB2.expectRefChannel, "0x1234" as `0x${string}`)).toEqual({ refused: true, code: "mpp/input-malformed" });
  });

  // CONTRIBUTING.md, "Failures are values": status answers a caller's ref it cannot read as pending unreadable, as it
  // answers a ref that is not an object, and makes no reader call for it.
  it("a close ref whose revokes is not an account and a key address reads as pending unreadable, with no call made", async () => {
    const close = subscriptionTempo.closeRef(SUB, U.SUB2.expectRefChannel, f.payer) as SessionRef;
    const calls = { n: 0 };
    const settled = readerFor("eip155:42431", { status: 1, blockNumber: "90", logs: [] });
    const counting: EvmReader = {
      network: settled.network,
      receipt: async (tx) => (calls.n++, settled.receipt(tx)),
      blockNumber: async (tag) => (calls.n++, settled.blockNumber(tag)),
      transaction: async (tx) => (calls.n++, settled.transaction(tx)),
      call: async (to, data, block) => (calls.n++, settled.call(to, data, block)),
    };
    for (const revokes of [
      null,
      "0x7777777777777777777777777777777777777777",
      { account: f.payer },
      { keyId: "0x7777777777777777777777777777777777777777" },
    ]) {
      const ref = { ...close, revokes, transaction: `0x${"77".repeat(32)}` } as unknown as SessionRef & { transaction: `0x${string}` };
      expect(await sessionStatus(ref, counting), JSON.stringify(revokes)).toEqual({ state: "pending", why: "unreadable" });
    }
    expect(calls.n).toBe(0);
  });

  it("L2: a live key authorization on Moderato", async () => {
    const raw = toBytes(U.L2.raw);
    expect(raw.length).toBe(U.L2.expectLength);
    affix(sha256(raw), U.L2.expectSha256);
    const fields = fromRlp(toHex(raw.subarray(1))) as unknown[];
    const keyAuthorization = toRlp(fields[13] as never);
    const k = decodeKeyAuthorization(keyAuthorization);
    if ("refused" in k) throw new Error(k.code);
    affix(k.witness!, U.L2.expectWitness);
    affix(k.digest, U.L2.expectDigest);
    const block = BigInt(U.L2.receipt.blockNumber);
    const reader = readerFor("eip155:42431", U.L2.receipt, block, block);
    const tx = "0x6c1cdc57bf5a4a98961b7897cac3212636eea551540ab3b32038c45f9d3d8d1c" as const;
    expect(await witnessRecover({ network: "eip155:42431", transaction: tx }, reader)).toBe(k.witness);
    expect(await subscriptionTempo.recover({ network: "eip155:42431", transaction: tx }, reader)).toBe(k.witness);
    // The same receipt from a reader of another network (Ethereum mainnet) is not read: tempo/wrong-reader.
    const elsewhere = readerFor("eip155:1", U.L2.receipt, block, block);
    expect(await witnessRecover({ network: "eip155:42431", transaction: tx }, elsewhere)).toEqual({
      refused: true,
      code: "tempo/wrong-reader",
    });
    // The scope the payer signed: one limit token, the one allowed-call target, and one recipient across its rules.
    expect(new Set(k.limits.map((l) => l.token))).toEqual(new Set([U.L2.transferToken]));
    expect(new Set(k.allowedCalls.map((c) => c.target))).toEqual(new Set([U.L2.transferToken]));
    expect(new Set(k.allowedCalls.flatMap((c) => c.selectorRules.flatMap((r) => r.recipients)))).toEqual(new Set([U.L2.transferTo]));
    const digest = await transferDigest({ to: U.L2.transferTo });
    expect(digest).toBe(U.L2.expectTransferDigest);
    const status = await sessionStatus(
      {
        network: "eip155:42431",
        transaction: tx,
        bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: k.witness! },
        transferLog: { address: U.L2.transferToken, topic0: TRANSFER_TOPIC, identity: "to", digest: digest as `0x${string}` },
      },
      reader,
    );
    expect(status).toMatchObject(U.L2.expectSettled);
  });

  it("plant 2: a key authorization whose witness is another ATR's hash", async () => {
    const a = authOf(U.SUB1.authorization, H2);
    const unsigned = encodeKeyAuthorization(a) as Uint8Array;
    affix(keccak256(unsigned), U.plant2.expectDigestH2);
    const signed = encodeKeyAuthorization(a, await sig65(keccak256(unsigned))) as Uint8Array;
    const cred: MppCredential = { challenge: ch, source: `did:pkh:eip155:42431:${f.payer}`, payload: { type: "keyAuthorization", signature: toHex(signed) } };
    expect(await subscriptionTempo.bound(cred)).toEqual(U.plant2.expect);
  });

  it("refusals", async () => {
    const u = (await subscriptionTempo.build({ challenge: ch, from: f.payer, now: f.now }, H)) as KeyAuthorizationUnsigned;
    const cred = u.complete(await sig65(u.request.digest)) as MppCredential;
    expect(await subscriptionTempo.bound({ ...cred, payload: { type: "transaction", signature: "0x" } })).toEqual({ refused: true, code: "mpp/not-an-opening" });
    expect(await subscriptionTempo.bound({ ...cred, payload: { type: "keyAuthorization", signature: "0xc0" } })).toEqual({
      refused: true,
      code: "tempo/key-authorization-malformed",
    });
    const noWitness = toRlp([[num(42431), num(0), f.accessKey], `0x${"11".repeat(65)}`] as never);
    expect(await subscriptionTempo.bound({ ...cred, payload: { type: "keyAuthorization", signature: noWitness } })).toEqual({
      refused: true,
      code: "tempo/no-witness",
    });
    expect(place([SUB, { ...SUB, realm: "other" }], H, link, SUB)).toEqual({ refused: true, code: "mpp/witness-taken" });
    const noChain = JSON.parse(f.request);
    delete noChain.methodDetails.chainId;
    expect(pairingsOf(challenge("tempo", "subscription", JSON.stringify(noChain)))).toEqual({ refused: true, code: "mpp/chain-id-required" });
    const badKey = JSON.parse(f.request);
    badKey.methodDetails.accessKey.keyType = "ed25519";
    expect(pairingsOf(challenge("tempo", "subscription", JSON.stringify(badKey)))).toEqual({ refused: true, code: "mpp/access-key-malformed" });
    expect(subscriptionTempo.pattern).toEqual(Object.fromEntries(Object.entries(U.pattern).filter(([k]) => k !== "claims")));
  });

  // The record reads the activation, or through keySearch one transfer made under the key, and neither proves says
  // that later billing periods were paid under this ATR: each ends with what it does not show, the sentence written
  // word for word.
  it("proves and keyProves say nothing of later billing periods", () => {
    const end = "This does not show that amount, period, payee, asset or timing match the ATR's content.";
    for (const p of [subscriptionTempo.pattern.proves, subscriptionTempo.keyProves]) {
      expect(p.endsWith(` ${end}`)).toBe(true);
      expect(p).not.toMatch(/later billing|renewal|paid under this ATR/i);
    }
  });
});
