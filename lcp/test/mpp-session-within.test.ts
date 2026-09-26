// In-channel payments (`buildWithin`) for the five MPP session pairings: a voucher, or a close's final voucher, on the
// channel the held opening opened. Each expected digest or byte string is a vector file's value, or is recomputed here
// from the voucher's type definition in MPP's session drafts with an independent tool: viem 2.56.8 for EIP-712,
// @noble/curves 2.4.0 for Ed25519, @solana/kit 8.3.0 for the Solana opening's accounts, and ripple-binary-codec
// 2.11.0 for the XRPL claim.
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { encodeForSigningClaim } from "ripple-binary-codec";
import { describe, expect, it } from "vitest";
import { concat, hashTypedData, keccak256, recoverTypedDataAddress, toHex, toRlp, type Hex as ViemHex } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import {
  place,
  sessionEvm,
  sessionHedera,
  sessionSolana,
  sessionTempo,
  sessionXrpl,
  type MppChallenge,
  type MppCredential,
  type SessionUnsigned,
  type SessionWithin,
  type SessionWithinUnsigned,
} from "../src/mpp.js";
import { H, challenge, link, load } from "./mpp-fixtures.js";

const E = load("mpp-session-evm.json");
const T = load("mpp-session-tempo.json");
const R = JSON.parse(readFileSync(new URL("../vectors/mpp-session-hedera-solana-xrpl.json", import.meta.url), "utf8"));
const H2 = E.fixed.H2 as `0x${string}`;
const payer = privateKeyToAccount(E.fixed.payerKey);
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const refused = (code: string) => ({ refused: true, code });
const placed = (c: MppChallenge, h = H) => (place([c], h, link, c) as MppChallenge[])[0] as MppChallenge & { id: string };
const affix = (v: string, e: { prefix: string; suffix: string }) => {
  expect(v.startsWith(e.prefix), `${v} starts ${e.prefix}`).toBe(true);
  expect(v.endsWith(e.suffix), `${v} ends ${e.suffix}`).toBe(true);
};
/** viem checks EIP-55 checksums, so the domain's contract goes lowercase. */
const forViem = (td: unknown) => {
  const t = td as { domain: { verifyingContract: string } };
  return { ...(td as object), domain: { ...t.domain, verifyingContract: t.domain.verifyingContract.toLowerCase() } } as Parameters<
    typeof hashTypedData
  >[0];
};
/** The voucher of MPP's session drafts, `Voucher(bytes32 channelId,uint128 cumulativeAmount)` or its uint96 form. */
const draftVoucher = (name: string, width: "uint128" | "uint96", chainId: number, escrow: string, channelId: string, amount: bigint) =>
  hashTypedData({
    domain: { name, version: "1", chainId, verifyingContract: escrow.toLowerCase() as ViemHex },
    primaryType: "Voucher",
    types: { Voucher: [{ name: "channelId", type: "bytes32" }, { name: "cumulativeAmount", type: width }] },
    message: { channelId: channelId as ViemHex, cumulativeAmount: amount },
  });
const unsigned = (u: unknown) => {
  if (typeof u === "object" && u !== null && "refused" in u) throw new Error(JSON.stringify(u));
  return u as SessionWithinUnsigned;
};
const eip712Of = (u: SessionWithinUnsigned) => {
  const r = u.requests[0];
  if (u.requests.length !== 1 || r === undefined || r.kind !== "eip712") throw new Error("not one eip712 request");
  return r.typedData;
};
const num = (n: number | bigint) => (BigInt(n) === 0n ? "0x" : toHex(BigInt(n)));
async function sig65(hash: ViemHex): Promise<ViemHex> {
  const s = await sign({ hash, privateKey: E.fixed.payerKey });
  return concat([s.r, s.s, toHex(Number(s.v), { size: 1 })]);
}
/** A signed Tempo transaction with one open call to `escrow`, as the payer's signer returns it. */
async function openWire(escrow: string, calldata: ViemHex): Promise<ViemHex> {
  const fields = [num(42431), num(1), num(2), num(200000), [[escrow, "0x", calldata]], [], toHex((1n << 256n) - 1n), "0x", num(1790000060), "0x", T.fixed.pathUSD, "0x", []] as const;
  const signature = await sig65(keccak256(concat(["0x76", toRlp(fields as never)])));
  return concat(["0x76", toRlp([...fields, signature] as never)]);
}

describe("mpp/session/evm: buildWithin", async () => {
  const f = E.fixed;
  const ch = placed(challenge("evm", "session", f.request));
  const u = (await sessionEvm.build({ challenge: ch, from: f.payer, now: f.now, deposit: BigInt(f.deposit), credentialType: "hash" }, H)) as SessionUnsigned;
  const funded = `0x${"55".repeat(32)}` as ViemHex;
  const opening = u.complete(funded, await payer.signTypedData(forViem(u.voucher(funded)))) as MppCredential;
  const within = { ...challenge("evm", "session", f.request), id: "seller-own-id" };
  const w = (cumulativeAmount: bigint, action: string = "voucher"): SessionWithin =>
    ({ challenge: within, opening, cumulativeAmount, action }) as SessionWithin;

  it("the voucher under \"EVM Payment Channel\", from the opening's channel, escrow and chain; ES5 at 0", async () => {
    const zero = unsigned(await sessionEvm.buildWithin(w(0n), H));
    expect(hashTypedData(forViem(eip712Of(zero)))).toBe(E.ES5.expectVoucherDigest);
    const at = unsigned(await sessionEvm.buildWithin(w(250n), H));
    const td = eip712Of(at);
    expect(hashTypedData(forViem(td))).toBe(draftVoucher("EVM Payment Channel", "uint128", 84532, f.escrow, E.ES1.expectChannelId, 250n));
    const signature = await payer.signTypedData(forViem(td));
    expect(await recoverTypedDataAddress({ ...forViem(td), signature })).toBe(f.payer);
    // The draft's voucher payload: exactly action, channelId, cumulativeAmount and signature.
    expect(at.complete([signature])).toEqual({
      challenge: within,
      payload: { action: "voucher", channelId: E.ES1.expectChannelId, cumulativeAmount: "250", signature },
    });
    const close = unsigned(await sessionEvm.buildWithin(w(250n, "close"), H));
    expect(close.complete([signature])).toMatchObject({ payload: { action: "close", cumulativeAmount: "250" } });
    expect(at.complete(["0x12"])).toEqual(refused("mpp/credential-malformed"));
    expect(at.complete([signature, signature])).toEqual(refused("mpp/credential-malformed"));
  });

  it("refuses a top-up, an unknown action, another ATR's opening and another method's challenge", async () => {
    expect(await sessionEvm.buildWithin(w(1n, "topUp"), H)).toEqual(refused("mpp/within-action-not-built"));
    expect(await sessionEvm.buildWithin(w(1n, "pay"), H)).toEqual(refused("mpp/session-action"));
    expect(await sessionEvm.buildWithin(w(1n), H2)).toEqual(refused("mpp/id-not-ours"));
    expect(await sessionEvm.buildWithin(w(1n << 128n), H)).toEqual(refused("mpp/input-malformed"));
    expect(await sessionEvm.buildWithin({ ...w(1n), challenge: { ...within, method: "tempo" } }, H)).toEqual(refused("mpp/not-this-pairing"));
  });
});

describe("mpp/session/tempo: buildWithin", async () => {
  const f = T.fixed;
  const deposit = BigInt(f.deposit);
  const open = async (request: string, escrow: string) => {
    const ch = placed(challenge("tempo", "session", request));
    const u = (await sessionTempo.build({ challenge: ch, from: f.payer, now: f.now, deposit }, H)) as SessionUnsigned;
    const wire = await openWire(escrow, (u.funding as { call: { data: ViemHex } }).call.data);
    return u.complete(wire, await payer.signTypedData(forViem(u.voucher(wire)))) as MppCredential;
  };
  const v2 = await open(f.requestV2, f.escrowV2);
  const v1 = await open(f.requestV1, f.escrowV1);
  const w = (opening: MppCredential, request: string, cumulativeAmount: bigint, action = "voucher"): SessionWithin =>
    ({ challenge: { ...challenge("tempo", "session", request), id: "seller-own-id" }, opening, cumulativeAmount, action }) as SessionWithin;

  it("v2: under \"TIP20 Channel Reserve\" with uint96, TS4's digests, and the opening's descriptor", async () => {
    expect(hashTypedData(forViem(eip712Of(unsigned(await sessionTempo.buildWithin(w(v2, f.requestV2, 0n), H)))))).toBe(T.TS4.expectVoucher0);
    const at = unsigned(await sessionTempo.buildWithin(w(v2, f.requestV2, 250n), H));
    const td = eip712Of(at);
    affix(hashTypedData(forViem(td)), T.TS4.expectVoucher250);
    expect(hashTypedData(forViem(td))).toBe(draftVoucher("TIP20 Channel Reserve", "uint96", 42431, f.escrowV2, T.TS3.expectChannelId, 250n));
    const signature = await payer.signTypedData(forViem(td));
    const done = at.complete([signature]) as MppCredential;
    // The draft's v2 voucher payload: action, channelId, cumulativeAmount, signature, and the descriptor, "REQUIRED for v2".
    expect(done.payload).toEqual({
      action: "voucher",
      channelId: T.TS3.expectChannelId,
      cumulativeAmount: "250",
      signature,
      descriptor: v2.payload["descriptor"],
    });
    expect(await sessionTempo.channel.boundWithin(done)).toBe(H);
    expect(await sessionTempo.buildWithin(w(v2, f.requestV2, 1n << 96n), H)).toEqual(refused("mpp/input-malformed"));
  });

  it("v1: under \"Tempo Stream Channel\" with uint128, TS5's digest at 0, and no descriptor", async () => {
    const zero = unsigned(await sessionTempo.buildWithin(w(v1, f.requestV1, 0n, "close"), H));
    const td = eip712Of(zero);
    affix(hashTypedData(forViem(td)), T.TS5.expectVoucher);
    expect(hashTypedData(forViem(td))).toBe(draftVoucher("Tempo Stream Channel", "uint128", 42431, f.escrowV1, T.TS5.expectChannelId, 0n));
    const signature = await payer.signTypedData(forViem(td));
    expect((zero.complete([signature]) as MppCredential).payload).toEqual({
      action: "close",
      channelId: T.TS5.expectChannelId,
      cumulativeAmount: "0",
      signature,
    });
    expect(await sessionTempo.buildWithin(w(v1, f.requestV1, 1n, "topUp"), H)).toEqual(refused("mpp/within-action-not-built"));
    expect(await sessionTempo.buildWithin(w(v1, f.requestV1, 1n), H2)).toEqual(refused("mpp/id-not-ours"));
  });
});

describe("mpp/session/hedera: buildWithin", () => {
  const C_H: MppChallenge & { id: string } = R.SS1.hedera.placed;
  const opening: MppCredential = {
    challenge: C_H,
    payload: { action: "open", channelId: R.HS1.expectChannelId, txHash: R.HS3.txHash, cumulativeAmount: "0", signature: "0x00" },
  };
  const within = { ...R.SS1.hedera.challenge, id: "seller-own-id" };
  const w = (cumulativeAmount: bigint, action = "voucher") => ({ challenge: within, opening, cumulativeAmount, action }) as SessionWithin;

  it("hederaVoucher under \"Hedera Stream Channel\": HS2's digest at 0, and the draft's payload", async () => {
    expect(hashTypedData(forViem(eip712Of(unsigned(await sessionHedera.buildWithin(w(0n), H)))))).toBe(R.HS2.expectVoucherDigest);
    const at = unsigned(await sessionHedera.buildWithin(w(25n, "close"), H));
    const td = eip712Of(at);
    expect(hashTypedData(forViem(td))).toBe(draftVoucher("Hedera Stream Channel", "uint128", 296, R.fixed.escrow, R.HS1.expectChannelId, 25n));
    const signature = await payer.signTypedData(forViem(td));
    expect(at.complete([signature])).toEqual({
      challenge: within,
      payload: { action: "close", channelId: R.HS1.expectChannelId, cumulativeAmount: "25", signature },
    });
    expect(await sessionHedera.buildWithin(w(1n, "topUp"), H)).toEqual(refused("mpp/within-action-not-built"));
    expect(await sessionHedera.buildWithin(w(1n), H2)).toEqual(refused("mpp/id-not-ours"));
  });
});

describe("mpp/session/solana: buildWithin", () => {
  const C_S: MppChallenge & { id: string } = R.SS1.solana.placed;
  const opening: MppCredential = { challenge: C_S, payload: { action: "open", channelId: R.SV2.channel, transaction: R.SV2.wireBase64 } };
  const within = { ...R.SS1.solana.challenge, id: "seller-own-id" };
  const w = (cumulativeAmount: bigint, action = "voucher") => ({ challenge: within, opening, cumulativeAmount, action }) as SessionWithin;
  /** The open instruction's authorized signer (account 4), read by @solana/kit from SV2's wire. */
  const authorized = (() => {
    const tx = getTransactionDecoder().decode(Uint8Array.from(Buffer.from(R.SV2.wireBase64, "base64")));
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
      staticAccounts: readonly string[];
      instructions: readonly { programAddressIndex: number; accountIndices?: readonly number[] }[];
    };
    const ix = msg.instructions.find((i) => msg.staticAccounts[i.programAddressIndex] === "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX")!;
    return msg.staticAccounts[ix.accountIndices![4]!]!;
  })();

  it("one ed25519-raw request over SV3's 50 bytes, for the opening's signer, and the draft's voucher payload", async () => {
    const u = unsigned(await sessionSolana.buildWithin(w(100n), H));
    expect(u.requests.length).toBe(1);
    const r = u.requests[0]!;
    if (r.kind !== "ed25519-raw") throw new Error(r.kind);
    expect(Buffer.from(r.message).toString("hex")).toBe(R.SV3.expectVoucher);
    expect(r.signer).toBe(authorized);
    const seed = new Uint8Array(32).fill(1);
    expect(base58.encode(ed25519.getPublicKey(seed))).toBe(authorized);
    const signature = ed25519.sign(r.message, seed);
    affix(Buffer.from(signature).toString("hex"), { prefix: "e4504793", suffix: "11e00e" });
    expect(u.complete([base58.encode(signature)])).toEqual({
      challenge: within,
      payload: {
        action: "voucher",
        channelId: R.SV2.channel,
        voucher: {
          voucher: { channelId: R.SV2.channel, cumulativeAmount: "100" },
          signer: authorized,
          signature: base58.encode(signature),
          signatureType: "ed25519",
        },
      },
    });
    expect(u.complete(["not-base58-0OIl"])).toEqual(refused("mpp/credential-malformed"));
  });

  it("an operator channel's vouchers, a use and another ATR's opening are refused", async () => {
    const request = JSON.parse(Buffer.from(C_S.request, "base64url").toString("utf8"));
    request.methodDetails.voucherSigner = "operator";
    request.methodDetails.operator = request.methodDetails.feePayerKey;
    const operatorOpening = { ...opening, challenge: placed({ ...R.SS1.solana.challenge, request: Buffer.from(JSON.stringify(request)).toString("base64url") }) };
    expect(await sessionSolana.buildWithin({ ...w(1n), opening: operatorOpening }, H)).toEqual(refused("mpp/within-action-not-built"));
    expect(await sessionSolana.buildWithin(w(1n, "use"), H)).toEqual(refused("mpp/within-action-not-built"));
    expect(await sessionSolana.buildWithin(w(1n), H2)).toEqual(refused("mpp/id-not-ours"));
    expect(await sessionSolana.buildWithin(w(1n << 64n), H)).toEqual(refused("mpp/input-malformed"));
  });
});

describe("mpp/session/xrpl: buildWithin", () => {
  const C_X: MppChallenge & { id: string } = R.SS1.xrpl.placed;
  const opening: MppCredential = { challenge: C_X, payload: { action: "open", transaction: R.XS2.blob, amount: "100", signature: "00" } };
  const within = { ...R.SS1.xrpl.challenge, id: "seller-own-id" };
  const w = (cumulativeAmount: bigint, action = "voucher") => ({ challenge: within, opening, cumulativeAmount, action }) as SessionWithin;

  it("one xrpl-claim request: XS3's bytes at 100 drops, and the draft's payload with the cumulative amount", async () => {
    const u = unsigned(await sessionXrpl.buildWithin(w(100n), H));
    const r = u.requests[0]!;
    if (u.requests.length !== 1 || r.kind !== "xrpl-claim") throw new Error("not one xrpl-claim");
    expect(r.channelId).toBe(R.XS2.expectChannel);
    expect(r.drops).toBe(100n);
    expect(Buffer.from(r.bytes).toString("hex").toUpperCase()).toBe(R.XS3.expect);
    expect(Buffer.from(r.bytes).toString("hex").toUpperCase()).toBe(encodeForSigningClaim({ channel: R.XS2.expectChannel, amount: "100" }));
    const signature = "C0".repeat(64);
    expect(unsigned(await sessionXrpl.buildWithin(w(200n, "close"), H)).complete([signature])).toEqual({
      challenge: within,
      payload: { action: "close", channelId: R.XS2.expectChannel, amount: "200", signature },
    });
    expect(u.complete(["zz"])).toEqual(refused("mpp/credential-malformed"));
    expect(await sessionXrpl.buildWithin(w(1n), H2)).toEqual(refused("mpp/id-not-ours"));
    expect(await sessionXrpl.buildWithin(w(1n, "topUp"), H)).toEqual(refused("mpp/within-action-not-built"));
  });
});
