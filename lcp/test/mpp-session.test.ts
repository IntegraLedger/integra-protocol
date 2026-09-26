// The session and subscription pairings against their vector files. Every expected value is the files', computed
// or read from Tempo Moderato; viem 2.56.8 is the independent tool for EIP-712, signatures, RLP and keccak.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  concat,
  encodeAbiParameters,
  fromRlp,
  hashTypedData,
  isAddress,
  keccak256,
  recoverAddress,
  toBytes,
  toHex,
  toRlp,
  type Hex as ViemHex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { Transaction as TempoTransaction } from "viem/tempo";
import { TRANSFER_TOPIC, transferDigest, type EvmLog } from "../src/evm.js";
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
  });

  it("ES2: the hash open's calls", async () => {
    const u = await build("hash");
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
    // Lowercase, so that a checksum-validating client accepts them: viem 2.56.8's isAddress.
    expect(isAddress(TIP20_CHANNEL_RESERVE)).toBe(true);
    expect(isAddress(ACCOUNT_KEYCHAIN)).toBe(true);
  });

  it("TS1-TS4: the v2 open, its wire, nonce hash, channel id, vouchers and bound", async () => {
    const ch = placed(V2);
    const u = unsignedOf(await sessionTempo.build({ challenge: ch, from: f.payer, now: f.now, deposit }, H));
    if (u.funding.kind !== "tempo-call") throw new Error("not a tempo call");
    expect(u.funding).toMatchObject({ chainId: 42431, call: { to: f.escrowV2 }, validBefore: 1790000060, broadcast: false });
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
    const cred = u.complete(toHex(wire), await payer.signTypedData(forViem(voucher))) as MppCredential;
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

  it("TS5: v1's channel id and voucher", async () => {
    expect(evmChannelId({ payer: f.payer, payee: f.recipient, token: f.pathUSD, salt: H, authorizedSigner: ZERO, escrow: f.escrowV1, chainId: 42431 }))
      .toBe(T.TS5.expectChannelId);
    const ch = placed(V1);
    const u = unsignedOf(await sessionTempo.build({ challenge: ch, from: f.payer, now: f.now, deposit }, H));
    if (u.funding.kind !== "tempo-call") throw new Error("not a tempo call");
    expect(u.funding.call.data.slice(0, 10)).toBe(OPEN_V1_SELECTOR);
    expect(toBytes(u.funding.call.data).length).toBe(164);
    const voucher = u.voucher(toHex(await openWire(u.funding.call.data)));
    expect(voucher).toMatchObject({ domain: { name: "Tempo Stream Channel" }, message: { channelId: T.TS5.expectChannelId } });
    affix(hashTypedData(forViem(voucher)), T.TS5.expectVoucher);
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
    expect(toBytes(cred.payload["signature"] as ViemHex).length).toBe(U.SUB1.expectSignedLength);
    expect(toHex(encodeKeyAuthorization(a, rootSignature) as Uint8Array)).toBe(toRlp([fromRlp(viemRlp), rootSignature] as never).toLowerCase());
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
      transferLog: { address: f.pathUSD, topic0: TRANSFER_TOPIC, identity: "to,value", digest: U.SUB3.expectTransferDigest },
      search: { address: ACCOUNT_KEYCHAIN, topics: [KEY_AUTHORIZATION_WITNESS_TOPIC, null, H] },
      // The key's read keys: the signed authorization's key id, the token, and the recipient's digest,
      // `printf 742d35Cc6634C0532925a3b844Bc9e7595f8fE00 | xxd -r -p | sha256sum`.
      accessKey: {
        keyId: f.accessKey.toLowerCase(),
        token: f.pathUSD,
        to: "0x89b2134890a170c97762b6aca097db78cad7a8e6d49f1436869aa987eb90eb2b",
      },
    });
    expect(subscriptionTempo.closeRef(SUB, U.SUB2.expectRefChannel)).toEqual({
      network: "eip155:42431",
      bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_REVOKED_TOPIC, index: 2, value: topicOf(f.accessKey) },
    });
    // Profile mpp/session rule 1: "a Tempo `subscription` challenge's id is exactly the base64url (no padding) of H".
    const positioned = { ...cred, challenge: { ...cred.challenge, id: challengeId(H, 0) as string } };
    expect(await subscriptionTempo.bound(positioned)).toEqual({ refused: true, code: "mpp/id-not-ours" });
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
    const digest = await transferDigest({ to: U.L2.transferTo, value: BigInt(U.L2.transferValue) });
    expect(digest).toBe(U.L2.expectTransferDigest);
    const status = await sessionStatus(
      {
        network: "eip155:42431",
        transaction: tx,
        bindingLog: { address: ACCOUNT_KEYCHAIN, topic0: KEY_AUTHORIZATION_WITNESS_TOPIC, index: 2, value: k.witness! },
        transferLog: { address: f.pathUSD, topic0: TRANSFER_TOPIC, identity: "to,value", digest: digest as `0x${string}` },
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
});
