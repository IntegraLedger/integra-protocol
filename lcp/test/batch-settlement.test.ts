// Runs x402-batch-settlement.json through the x402-batch-settlement and svm entry points, and the root pairingOf. Every
// expected value is the file's, except the pairingOf test's, which are the x402 SVM batch-settlement option table's, as
// its name says. A durable opening is the file's wire rewritten by @solana/kit (fixtures/svm-durable-nonce.ts), with
// x402-exact-solana.json's nonce; its digest is node:crypto's SHA-256 of kit's message.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  isSignerRole,
  isWritableRole,
} from "@solana/kit";
import { hashDomain, hashTypedData, keccak256, toBytes, toEventSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ReaderError, type EvmReader, type EvmReceipt, type Hex } from "../src/evm.js";
import { pairingOf, type AtrHash, type Refusal } from "../src/index.js";
import {
  PAYMENT_CHANNELS,
  channelPda,
  channelVoucherMessage,
  findPda,
  openInstructionData,
  svmLocate,
  type SvmLanded,
  type SvmReader,
  type SvmRef,
} from "../src/svm.js";
import {
  CHANNEL_CONFIG_TYPEHASH,
  CHANNEL_CREATED_TOPIC,
  DEPOSITED_TOPIC,
  batchChannelId,
  batchCloudflare,
  batchEvm,
  batchSvm,
  erc3009DepositNonce,
  type BatchUnsigned,
  type ChannelConfig,
} from "../src/x402-batch-settlement.js";
import * as batchSettlement from "../src/x402-batch-settlement.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { DURABLE, durableWire } from "./fixtures/svm-durable-nonce.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-batch-settlement.json", import.meta.url), "utf8"));
const E = V.fixed.evm;
const S = V.fixed.svm;
const H: AtrHash = V.fixed.H;
const H2: AtrHash = V.fixed.Hprime;
type Payment = Exclude<ReturnType<BatchUnsigned["complete"]>, Refusal>;
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));
const refused = (code: string) => ({ refused: true, code });
const forViem = (td: unknown) => JSON.parse(JSON.stringify(td, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const unwrap = <T,>(v: T | { refused: true; code: string }): T => {
  if (typeof v === "object" && v !== null && "refused" in v) throw new Error((v as { code: string }).code);
  return v as T;
};

const evmDoc = (): PaymentRequired => {
  const o: PaymentRequirements = E.option;
  return unwrap(batchEvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o));
};

async function evmOpening(method?: "permit2"): Promise<{ u: BatchUnsigned; payment: Payment }> {
  const doc = evmDoc();
  const accepted: PaymentRequirements =
    method === undefined ? doc.accepts[0]! : { ...doc.accepts[0]!, extra: { ...doc.accepts[0]!.extra, assetTransferMethod: method } };
  const required = { ...doc, accepts: [accepted] };
  const u = unwrap(
    await batchEvm.build(
      {
        required,
        accepted,
        from: E.payer,
        now: E.now,
        payerAuthorizer: E.payerAuthorizer,
        deposit: BigInt(E.deposit),
        authSalt: E.authSalt,
      },
      H,
    ),
  );
  const payer = privateKeyToAccount(E.payerKey);
  const authorizer = privateKeyToAccount(E.payerAuthorizerKey);
  const s1 = await payer.signTypedData(forViem(u.requests[0]!.kind === "eip712" ? u.requests[0]!.typedData : undefined));
  const s2 = await authorizer.signTypedData(forViem(u.requests[1]!.kind === "eip712" ? u.requests[1]!.typedData : undefined));
  return { u, payment: unwrap(u.complete([s1, s2])) };
}

function evmReaderFor(receipt: unknown): EvmReader {
  return {
    network: "eip155:84532",
    receipt: async () => {
      if (receipt === "reader-error") throw new ReaderError("transport");
      if (receipt === null) return null;
      const r = receipt as { status: 0 | 1; blockNumber: string; logs: EvmReceipt["logs"] };
      return { status: r.status, blockNumber: BigInt(r.blockNumber), logs: r.logs };
    },
    blockNumber: async (tag) => BigInt(tag === "finalized" ? V.EB7.reader.finalized : V.EB7.reader.safe),
    transaction: async () => null,
    call: async () => {
      throw new ReaderError("transport");
    },
  };
}

describe("x402-batch-settlement.json: EVM", () => {
  it("EB1: the channel id", () => {
    expect(keccak256(toBytes(E.channelConfigType))).toBe(CHANNEL_CONFIG_TYPEHASH);
    const config: ChannelConfig = E.config;
    expect(batchChannelId(84532, config)).toBe(V.EB1.channelId);
    expect(hashDomain({
      domain: { name: "x402 Batch Settlement", version: "1", chainId: 84532n, verifyingContract: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" },
      types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }] },
    })).toBe(V.EB1.domainSeparator);
    expect(batchChannelId(8453, config)).toBe(V.EB1.onBase8453);
    expect(batchChannelId(84532, { ...config, salt: H2 })).toBe(V.EB1.withHprime);
  });

  it("EB2 and EB3: the opening's ERC-3009 deposit and voucher", async () => {
    expect(erc3009DepositNonce(V.EB1.channelId, E.authSalt)).toBe(V.EB3.depositNonce);
    const { u, payment } = await evmOpening();
    const [auth, voucher] = u.requests;
    expect(hashTypedData(forViem(auth!.kind === "eip712" ? auth!.typedData : undefined))).toBe(V.EB3.digest);
    expect(hashTypedData(forViem(voucher!.kind === "eip712" ? voucher!.typedData : undefined))).toBe(V.EB2.digest);
    const p = payment.payload as Record<string, any>;
    expect(p["deposit"].authorization.erc3009Authorization.signature).toBe(V.EB3.signature);
    expect(p["voucher"].signature).toBe(V.EB2.signature);
    expect(p["voucher"].maxClaimableAmount).toBe(V.EB2.maxClaimableAmount);
    expect(p["deposit"].authorization.erc3009Authorization.validBefore).toBe(E.validBefore);
  });

  // ECMA-262 RegExp.prototype.test applies ToString to its argument, so ["0x…"] reads as its one element: each guard
  // reads the type first, and the array is refused as the number 42 is.
  it("EB3's authSalt, or a channelId or authSalt given to erc3009DepositNonce, as a one-element array is refused", async () => {
    const doc = evmDoc();
    const choice = { required: doc, accepted: doc.accepts[0]!, from: E.payer, now: E.now, payerAuthorizer: E.payerAuthorizer, deposit: BigInt(E.deposit) };
    const row = (V.agreedRefusals.rows as { case: string; expect: string }[]).find((r) => r.case.startsWith("EVM build with an authSalt"))!;
    for (const authSalt of [[E.authSalt], 42]) {
      expect(await batchEvm.build({ ...choice, authSalt } as never, H), String(authSalt)).toEqual(refused(row.expect));
    }
    expect(erc3009DepositNonce([V.EB1.channelId] as never, E.authSalt)).toEqual(refused("evm/field-malformed"));
    expect(erc3009DepositNonce(V.EB1.channelId, [E.authSalt] as never)).toEqual(refused("evm/field-malformed"));
  });

  it("EB4: the Permit2 deposit", async () => {
    const { u, payment } = await evmOpening("permit2");
    expect(hashTypedData(forViem(u.requests[0]!.kind === "eip712" ? u.requests[0]!.typedData : undefined))).toBe(V.EB4.digest);
    const a = (payment.payload as Record<string, any>)["deposit"].authorization.permit2Authorization;
    expect([a.nonce, a.deadline]).toEqual([V.EB4.nonce, V.EB4.deadline]);
    expect(await batchEvm.bound(payment)).toBe(H);
  });

  it("EB5: the event topics and the config's data", () => {
    expect(toEventSelector(V.EB5.channelCreatedDeclaration)).toBe(CHANNEL_CREATED_TOPIC);
    expect(V.EB5.depositedTopic).toBe(DEPOSITED_TOPIC);
    expect(createHash("sha256").update(fromHex(V.EB5.configData.slice(2))).digest("hex")).toBe(V.EB5.configDataSha256);
    expect(V.EB5.configData.slice(2 + 6 * 64)).toBe(H.slice(2));
  });

  it("EB6: bound and the channel members", async () => {
    const { payment } = await evmOpening();
    expect(await batchEvm.bound(payment)).toBe(V.EB6.expectBound);
    expect(batchEvm.channel.kind(payment)).toBe(V.EB6.expectKindDeposit);
    expect(await batchEvm.channel.ref(payment)).toEqual(V.EB6.expectRef);
    const p = payment.payload as Record<string, any>;
    const voucherPayment: Payment = { ...payment, payload: { type: "voucher", channelConfig: p["channelConfig"], voucher: p["voucher"] } };
    expect(batchEvm.channel.kind(voucherPayment)).toBe(V.EB6.expectKindVoucher);
    expect(await batchEvm.channel.boundWithin(voucherPayment)).toBe(V.EB6.expectBoundWithin);
    expect(batchEvm.channel.kind({ ...voucherPayment, payload: { ...voucherPayment.payload, type: "refund" } })).toBe(V.EB6.expectKindRefund);
    expect(
      batchEvm.channel.kind({ ...voucherPayment, payload: { ...voucherPayment.payload, type: "refund", amount: V.EB6.refundAmount } }),
    ).toBe(V.EB6.expectKindPartialRefund);
  });

  it("EB6 plant: a voucher under another agreement is never read as this channel's", async () => {
    const { payment } = await evmOpening();
    const p = payment.payload as Record<string, any>;
    const other = { ...payment, payload: { type: "voucher", channelConfig: { ...p["channelConfig"], salt: H2 }, voucher: p["voucher"] } };
    expect(await batchEvm.channel.ref(other)).toEqual(refused(V.EB6.plant.expect));
    expect(await batchEvm.channel.boundWithin(other)).toEqual(refused(V.EB6.plant.expect));
    const matched = { ...other, payload: { ...other.payload, voucher: { ...p["voucher"], channelId: V.EB6.plant.matchedChannelId } } };
    expect(await batchEvm.channel.boundWithin(matched)).toBe(V.EB6.plant.expectBoundWithinMatched);
    expect(await batchEvm.channel.boundWithin(matched)).not.toBe(H);
  });

  it("EB7: status on the opening's reference, and its plants", async () => {
    const { payment } = await evmOpening();
    const ref = unwrap(await batchEvm.reference(payment));
    expect(ref.transferLog?.digest).toBe(V.EB7.transferDigest);
    const tx = ("0x" + "ab".repeat(32)) as Hex;
    const settled = await batchEvm.status({ ...ref, transaction: tx }, evmReaderFor(V.EB7.receipt));
    expect(JSON.parse(JSON.stringify(settled, (_, v) => (typeof v === "bigint" ? v.toString() : v)))).toEqual(V.EB7.expect);
    expect(await batchEvm.status({ ...ref, transaction: tx }, evmReaderFor(V.EB7.plantGift.receipt))).toEqual(V.EB7.plantGift.expect);
    expect(await batchEvm.status({ ...ref, transaction: tx }, evmReaderFor(V.EB7.plantOtherContract.receipt))).toEqual(
      V.EB7.plantOtherContract.expect,
    );
    for (const row of [V.EB7.fullCall, V.EB7.plantGiftBesideDeposit, V.EB7.plantShortBesideDeposit]) {
      const s = await batchEvm.status({ ...ref, transaction: tx }, evmReaderFor(row.receipt));
      expect(JSON.parse(JSON.stringify(s, (_, v) => (typeof v === "bigint" ? v.toString() : v))), row.case).toEqual(row.expect);
    }
    expect(V.EB7.fullCall.receipt.logs[3]).toEqual(V.EB8.log);
    expect(V.EB7.fullCall.receipt.logs[0].topics[2]).toBe(V.EB3.depositNonce);
  });

  it("EB8: recover", async () => {
    const tx = ("0x" + "cd".repeat(32)) as Hex;
    const ok = evmReaderFor({ status: 1, blockNumber: "100", logs: [V.EB8.log] });
    expect(await batchEvm.recover({ network: "eip155:84532", transaction: tx }, ok)).toBe(V.EB8.expect);
    const bad = evmReaderFor({ status: 1, blockNumber: "100", logs: [V.EB8.word0Changed] });
    expect(await batchEvm.recover({ network: "eip155:84532", transaction: tx }, bad)).toEqual(refused(V.EB8.expectWord0));
  });
});

const svmPayment = (payload: Record<string, unknown>): Payment => ({
  x402Version: 2,
  accepted: V.ES4.accepted,
  payload: payload as Payment["payload"],
});
const landed = (wire: Uint8Array, err: unknown = null): SvmLanded => ({ wire, err, loaded: { writable: [], readonly: [] }, inner: [] });
function svmReaderFor(at: "finalized" | null, l: SvmLanded, txid: string): SvmReader {
  return {
    network: V.ES5.ref.network,
    transaction: async (sig) => (sig === txid && at !== null ? l : { notFound: true as const, slot: null }),
    signatures: async () => [],
    blockhashValid: async () => ({ valid: true, slot: 0n }),
    firstAvailableBlock: async () => 0n,
    account: async () => {
      throw new Error("this reference names no nonce account");
    },
  };
}

describe("x402-batch-settlement.json: SVM", () => {
  /** A compiled message decompiled: fee payer, blockhash, and each instruction's program, accounts and data. */
  const decoded = (message: Uint8Array) => {
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(message));
    type Ix = { programAddress: string; accounts?: readonly { address: string; role: number }[]; data?: Uint8Array };
    return {
      feePayer: m.feePayer.address as string,
      blockhash: (m.lifetimeConstraint as { blockhash: string }).blockhash,
      instructions: (m.instructions as readonly Ix[]).map((ix) => ({
        program: ix.programAddress,
        accounts: (ix.accounts ?? []).map((a) => ({
          address: a.address,
          signer: isSignerRole(a.role as Parameters<typeof isSignerRole>[0]),
          writable: isWritableRole(a.role as Parameters<typeof isWritableRole>[0]),
        })),
        data: hex(ix.data ?? new Uint8Array()),
      })),
    };
  };

  it("ES6: a full refund carries the voucher, and the request_close only on the retry (x402 751590a2, scheme_batch_settlement_svm.md L626-636; steward client/channel.ts:281-312)", async () => {
    const S6 = V.ES6;
    const withMemo = V.ES4.accepted as PaymentRequirements;
    const { memo: _memo, ...noMemoExtra } = withMemo.extra as Record<string, unknown>;
    const withoutMemo = { ...withMemo, extra: noMemoExtra } as PaymentRequirements;
    const seed = Uint8Array.from(Buffer.from(V.fixed.svm.payerSeed, "hex"));
    const within = (accepted: PaymentRequirements, extra: Record<string, unknown> = {}) =>
      batchSvm.buildWithin(
        {
          required: { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] },
          accepted,
          channelConfig: V.ES4.config,
          maxClaimableAmount: 1000n,
          refund: {},
          ...extra,
        },
        V.fixed.H,
      );

    const c = await within(withMemo);
    if ("refused" in c) throw new Error(c.code);
    expect(c.requests.map((r) => r.kind)).toEqual(["ed25519-raw"]);
    const vr = c.requests[0]!;
    if (vr.kind !== "ed25519-raw") throw new Error(vr.kind);
    expect(hex(vr.message)).toBe(V.ES3.message);
    expect(vr.signer).toBe(V.ES4.config.payerAuthorizer);
    const vs = ed25519.sign(vr.message, seed);
    const cp = c.complete([base58.encode(vs)]);
    if ("refused" in cp) throw new Error(cp.code);
    expect(Object.keys(cp.payload).sort()).toEqual(S6.cooperative.payloadMembers);
    expect(cp.payload["type"]).toBe("refund");
    expect(cp.payload["channelConfig"]).toEqual(V.ES4.config);
    expect(cp.payload["voucher"]).toEqual({ channelId: V.ES1.channelPda, maxClaimableAmount: "1000", expiresAt: 0, signature: base58.encode(vs) });
    expect(batchSvm.channel.kind(cp)).toBe(S6.cooperative.expectKind);
    expect(await batchSvm.channel.ref(cp)).toEqual(V.ES4.expectRef);

    const u = await within(withMemo, { recentBlockhash: V.fixed.svm.blockhash });
    if ("refused" in u) throw new Error(u.code);
    expect(u.requests.map((r) => r.kind)).toEqual(["solana-message", "ed25519-raw"]);
    const req = u.requests[0]!;
    if (req.kind !== "solana-message") throw new Error(req.kind);
    const solders = b64(V.ES4.closeWireBase64);
    expect(decoded(req.message)).toEqual(decoded(solders.subarray(1 + 64 * solders[0]!)));
    const sig = ed25519.sign(req.message, seed);
    const p = u.complete([base58.encode(sig), base58.encode(vs)]);
    if ("refused" in p) throw new Error(p.code);
    expect(Object.keys(p.payload).sort()).toEqual(S6.withMemo.payloadMembers);
    expect(p.payload["type"]).toBe("refund");
    expect(p.payload["channelConfig"]).toEqual(V.ES4.config);
    expect(p.payload["voucher"]).toEqual(cp.payload["voucher"]);
    const wire = b64(p.payload["transaction"] as string);
    expect(wire[0]).toBe(2);
    expect(wire.subarray(1, 65).every((b) => b === 0)).toBe(true);
    expect(hex(wire.subarray(65, 129))).toBe(hex(sig));
    expect(hex(wire.subarray(129))).toBe(hex(req.message));
    expect(batchSvm.channel.kind(p)).toBe(S6.withMemo.expectKind);
    expect(await batchSvm.channel.ref(p)).toEqual(V.ES4.expectRef);
    expect(u.complete([base58.encode(sig)])).toEqual(refused("svm/input-malformed"));

    const v = await within(withoutMemo, { recentBlockhash: V.fixed.svm.blockhash });
    if ("refused" in v) throw new Error(v.code);
    const wr = v.requests[0]!;
    if (wr.kind !== "solana-message") throw new Error(wr.kind);
    const d = decoded(wr.message);
    expect(d.feePayer).toBe(V.fixed.svm.feePayer);
    expect(d.blockhash).toBe(V.fixed.svm.blockhash);
    expect(d.instructions).toEqual(S6.withoutMemo.instructions);

    expect(await within(withMemo, { refund: { amount: 5n } })).toEqual(refused(S6.refundWithAmount.expect));

    const lone = { ...withMemo, extra: { ...withMemo.extra, memo: S6.loneSurrogateMemo.memo } } as PaymentRequirements;
    expect((S6.loneSurrogateMemo.memo as string).isWellFormed()).toBe(false);
    expect(await within(lone, { recentBlockhash: V.fixed.svm.blockhash })).toEqual(refused(S6.loneSurrogateMemo.expect));
    // The cooperative refund writes no memo, so the same option builds its voucher.
    const coop = await within(lone);
    if ("refused" in coop) throw new Error(coop.code);
    expect(coop.requests.map((r) => r.kind)).toEqual(["ed25519-raw"]);
  });

  it("ES1: PDAs", () => {
    const pda = (salt: bigint) =>
      channelPda({ payer: S.payer, payee: S.feePayer, mint: S.mint, signer: S.payer, salt, openSlot: BigInt(S.openSlot) });
    expect(pda(42n)).toBe(V.ES1.channelPda);
    expect(pda(43n)).toBe(V.ES1.salt43);
    expect(findPda([new TextEncoder().encode("event_authority")], PAYMENT_CHANNELS)).toEqual({
      address: V.ES1.eventAuthority,
      bump: V.ES1.eventAuthorityBump,
    });
    expect(V.ES1.eventAuthority).not.toBe(V.ES1.wrongCurveTest);
  });

  it("ES2 and ES3: the opening build, decompiled with its seller memo then binding memo (steward payment-channels/open.ts:464-467 at 751590a2), and the voucher", async () => {
    expect(
      hex(openInstructionData({ salt: 42n, deposit: 100000n, gracePeriod: 3600, openSlot: BigInt(S.openSlot), recipient: S.payTo })),
    ).toBe(V.ES2.openInstructionData);
    const o: PaymentRequirements = S.option;
    const doc = unwrap(batchSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o));
    expect(doc.accepts[0]).toEqual(V.ES4.accepted);
    expect(batchSvm.unplaced(doc.accepts[0]!)).toEqual(o);
    const u = unwrap(
      await batchSvm.build(
        {
          required: doc,
          accepted: doc.accepts[0]!,
          payer: S.payer,
          payerAuthorizer: S.payer,
          deposit: BigInt(S.deposit),
          salt: 42n,
          openSlot: BigInt(S.openSlot),
          tokenProgram: S.tokenProgram,
          recentBlockhash: S.blockhash,
        },
        H,
      ),
    );
    const [txReq, voucherReq] = u.requests;
    if (txReq?.kind !== "solana-message" || voucherReq?.kind !== "ed25519-raw") throw new Error("request kinds");
    expect(txReq.message.length).toBe(V.ES2.messageLength);
    const expected = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(
      (() => {
        const w = b64(V.ES2.wireBase64);
        return w.subarray(1 + 64 * w[0]!);
      })(),
    ));
    const got = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(txReq.message));
    type Ix = { programAddress: string; accounts?: readonly { address: string; role: number }[]; data?: Uint8Array };
    const shape = (m: typeof got) =>
      (m.instructions as readonly Ix[]).map((ix) => ({
        program: ix.programAddress,
        accounts: (ix.accounts ?? []).map((a) => [
          a.address,
          isSignerRole(a.role as Parameters<typeof isSignerRole>[0]),
          isWritableRole(a.role as Parameters<typeof isWritableRole>[0]),
        ]),
        data: hex(ix.data ?? new Uint8Array()),
      }));
    expect(got.feePayer.address).toBe(expected.feePayer.address);
    expect(shape(got)).toEqual(shape(expected));
    expect(hex(voucherReq.message)).toBe(V.ES3.message);
    expect(hex(channelVoucherMessage(V.ES1.channelPda, 1000n, 0n))).toBe(V.ES3.message);
    const seed = fromHex(S.payerSeed);
    const vs = ed25519.sign(voucherReq.message, seed);
    expect(hex(vs).startsWith(V.ES3.signaturePrefix) && hex(vs).endsWith(V.ES3.signatureSuffix)).toBe(true);
    expect(ed25519.verify(vs, voucherReq.message, ed25519.getPublicKey(seed))).toBe(true);
    const payment = unwrap(u.complete([base58.encode(ed25519.sign(txReq.message, seed)), base58.encode(vs)]));
    expect(payment.payload["channelConfig"]).toEqual(V.ES4.config);
    expect(await batchSvm.bound(payment)).toBe(H);
  });

  it("ES4: bound, the members, and the plants", async () => {
    const voucher = { channelId: V.ES1.channelPda, maxClaimableAmount: "1000", expiresAt: 0, signature: "x" };
    const deposit = (wire: string) => svmPayment({ type: "deposit", channelConfig: V.ES4.config, voucher, deposit: { amount: S.deposit, transaction: wire } });
    const opening = deposit(V.ES2.wireBase64);
    expect(await batchSvm.bound(opening)).toBe(V.ES4.expectBound);
    expect(batchSvm.channel.kind(opening)).toBe(V.ES4.expectKind);
    expect(await batchSvm.channel.ref(opening)).toEqual(V.ES4.expectRef);
    const ref = await batchSvm.reference(opening);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    expect(batchSvm.channel.kind(deposit(V.ES4.topUpWireBase64))).toBe(V.ES4.expectTopUpKind);
    expect(await batchSvm.bound(deposit(V.ES4.topUpWireBase64))).toEqual(refused("x402/not-an-opening"));
    const close = svmPayment({ type: "refund", channelConfig: V.ES4.config, transaction: V.ES4.closeWireBase64 });
    expect(batchSvm.channel.kind(close)).toBe(V.ES4.expectCloseKind);
    expect(await batchSvm.channel.ref(close)).toEqual(V.ES4.expectRef);
    expect(await batchSvm.channel.boundWithin(opening)).toEqual(refused(V.ES4.expectBoundWithin));
    expect(await batchSvm.bound(deposit(V.ES4.plantNonce.wireBase64))).toEqual(refused(V.ES4.plantNonce.expect));
    const salt43 = svmPayment({ type: "voucher", channelConfig: { ...V.ES4.config, salt: "43" }, voucher });
    expect(await batchSvm.channel.ref(salt43)).toEqual(refused(V.ES4.plantSalt43.expect));
  });

  it("ES2's opening made durable: a sysvar from a lookup table is bound and recorded; a nonce account from one is refused", async () => {
    const voucher = { channelId: V.ES1.channelPda, maxClaimableAmount: "1000", expiresAt: 0, signature: "x" };
    const deposit = (wire: string) => svmPayment({ type: "deposit", channelConfig: V.ES4.config, voucher, deposit: { amount: S.deposit, transaction: wire } });
    const sysvar = durableWire(V.ES2.wireBase64, [DURABLE.sysvar]);
    expect(sysvar.instruction0Accounts[0]).toBeLessThan(sysvar.staticKeys);
    expect(sysvar.instruction0Accounts[1]).toBeGreaterThanOrEqual(sysvar.staticKeys);
    expect(await batchSvm.bound(deposit(sysvar.wireBase64))).toBe(V.ES4.expectBound);
    expect(await batchSvm.reference(deposit(sysvar.wireBase64))).toMatchObject({
      network: V.ES4.accepted.network,
      digest: sysvar.digest,
      blockhash: "",
      nonce: { account: DURABLE.nonceAccount, value: DURABLE.value },
    });
    const both = durableWire(V.ES2.wireBase64, [DURABLE.nonceAccount, DURABLE.sysvar]);
    expect(both.instruction0Accounts[0]).toBeGreaterThanOrEqual(both.staticKeys);
    expect(await batchSvm.bound(deposit(both.wireBase64))).toEqual(refused("svm/nonce-account-not-static"));
    expect(await batchSvm.reference(deposit(both.wireBase64))).toEqual(refused("svm/nonce-account-not-static"));
  });

  it("ES7: svmLocate reads each candidate through the pairing's own status", async () => {
    const wire = b64(V.ES5.landedWireBase64);
    const { transaction: _named, ...unnamed } = V.ES5.ref as SvmRef & { transaction: string };
    const ref: SvmRef = { ...unnamed, fromSlot: V.ES7.fromSlot };
    const fromSlot = BigInt(V.ES7.fromSlot);
    const reader: SvmReader = {
      ...svmReaderFor("finalized", landed(wire), V.ES5.txid),
      firstAvailableBlock: async () => BigInt(V.ES7.firstAvailableBlock),
      signatures: async () => [
        { signature: V.ES5.txid, slot: fromSlot + 5n, memo: V.ES7.memo },
        { signature: "older", slot: fromSlot - 1n, memo: null },
      ],
    };
    expect(await svmLocate(ref, reader, H, batchSvm.status)).toEqual(V.ES7.expectChannelStatus);
    expect(await svmLocate(ref, reader, H)).toEqual(V.ES7.expectTransferTest);
  });

  it("ES8: the opening's memos, exactly one binding memo and one other, read by bound and recover (x402 751590a2, scheme_batch_settlement_svm.md L1320-1325, L1346-1348; steward test/unit/batch.receiverAuthorizer.test.ts)", async () => {
    const voucher = { channelId: V.ES1.channelPda, maxClaimableAmount: "1000", expiresAt: 0, signature: "x" };
    const ref = { network: V.ES5.ref.network, transaction: V.ES5.txid };
    expect(V.ES8.rows.length).toBe(4);
    for (const row of V.ES8.rows) {
      const opening = svmPayment({ type: "deposit", channelConfig: V.ES4.config, voucher, deposit: { amount: S.deposit, transaction: row.wireBase64 } });
      const expected = row.expect.startsWith("0x") ? row.expect : refused(row.expect);
      expect(await batchSvm.bound(opening), row.case).toEqual(expected);
      const recovered = await batchSvm.recover(ref, svmReaderFor("finalized", landed(b64(row.wireBase64)), V.ES5.txid));
      expect(recovered, row.case).toEqual(expected);
    }
  });

  it("the root pairingOf: a Solana option names extra.receiverAuthorizer and client voucher signing (x402 751590a2, scheme_batch_settlement_svm.md L244-246)", () => {
    const o: PaymentRequirements = S.option;
    const extra = o.extra!;
    const { receiverAuthorizer: _ra, ...noAuthorizer } = extra;
    expect(pairingOf(o)).toBe("x402/batch-settlement/solana");
    expect(pairingOf({ ...o, extra: { ...extra, voucherSigner: "client" } })).toBe("x402/batch-settlement/solana");
    expect(pairingOf({ ...o, extra: noAuthorizer })).toBeUndefined();
    expect(pairingOf({ ...o, extra: { ...extra, receiverAuthorizer: "not-a-key" } })).toBeUndefined();
    expect(pairingOf({ ...o, extra: { ...extra, voucherSigner: "server", operator: S.receiverAuthorizer } })).toBeUndefined();
  });

  it("ES9: withdrawDelay is compared with a maxTimeoutSeconds that is a number, and never with a converted one", () => {
    const rows = V.ES9.rows as { maxTimeoutSeconds?: unknown; expectPairing: string | null; expectAdvertise: string | null }[];
    expect(rows.length).toBe(9);
    const { maxTimeoutSeconds: _, ...bare } = S.option as PaymentRequirements;
    for (const row of rows) {
      const given = "maxTimeoutSeconds" in row;
      const o = (given ? { ...bare, maxTimeoutSeconds: row.maxTimeoutSeconds } : bare) as PaymentRequirements;
      const label = given ? JSON.stringify(row.maxTimeoutSeconds) : "absent";
      expect(o.extra!["withdrawDelay"], label).toBe(3600);
      expect(pairingOf(o) ?? null, label).toBe(row.expectPairing);
      const doc = batchSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o);
      expect("refused" in doc ? (doc as Refusal).code : null, label).toBe(row.expectAdvertise);
    }
  });

  it("ES5: svmChannelStatus, and a transaction with no channel instruction", async () => {
    const wire = b64(V.ES5.landedWireBase64);
    const ref = { ...V.ES5.ref, fromSlot: "0" } as SvmRef & { transaction: string };
    for (const row of V.ES5.rows) {
      expect(await batchSvm.status(ref, svmReaderFor(row.at, landed(wire, row.err ?? null), V.ES5.txid)), JSON.stringify(row)).toEqual(row.expect);
    }
    expect(await batchSvm.recover(ref, svmReaderFor("finalized", landed(wire), V.ES5.txid))).toBe(H);
    const nc = V.ES5.plantNoChannel;
    const r = svmReaderFor("finalized", landed(b64(nc.landedWireBase64)), "nc");
    expect(await batchSvm.status({ ...ref, transaction: "nc", digest: nc.digest }, r)).toEqual(nc.expect);
  });
});

describe("x402-batch-settlement.json: Cloudflare", () => {
  it("EC1: bound, and a payload without extensions", async () => {
    expect(JSON.stringify(V.EC1.payload).length).toBe(V.EC1.payloadLength);
    expect(pairingOf(V.EC1.payload.accepted)).toBe(V.EC1.expectPairing);
    expect(await batchCloudflare.bound(V.EC1.payload)).toBe(V.EC1.expectBound);
    const { extensions: _, ...bare } = V.EC1.payload;
    expect(await batchCloudflare.bound(bare)).toEqual(refused(V.EC1.withoutExtensions));
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [V.EC1.payload.accepted] };
    const doc = unwrap(batchCloudflare.advertise(required, H, V.fixed.link, V.EC1.payload.accepted));
    const built = unwrap(await batchCloudflare.build({ required: doc, accepted: doc.accepts[0]! }, H));
    expect(built.payload).toEqual(V.EC1.payload.payload);
    expect(await batchCloudflare.bound(built)).toBe(H);
  });
});

describe("the x402-batch-settlement entry point", () => {
  it("exports no pairingOf of its own: the root pairingOf names the three pairings", () => {
    expect("pairingOf" in batchSettlement).toBe(false);
  });
});

describe("x402-batch-settlement.json: the agreedRefusals rows that carry their input", () => {
  type Row = { case: string; pairing?: string; call?: "build" | "buildWithin"; choice?: unknown; h?: unknown; expect: string };
  const rows = (V.agreedRefusals.rows as Row[]).filter((r) => r.pairing !== undefined);
  const pairings = { "x402/batch-settlement/eip155": batchEvm, "x402/batch-settlement/solana": batchSvm, "x402/batch-settlement/cloudflare": batchCloudflare } as const;

  it("each pairing's build, and the EVM and SVM buildWithin, refuse a null choice and a string choice", async () => {
    const choices = rows.filter((r) => "choice" in r);
    expect(choices.map((r) => `${r.pairing} ${r.call} ${String(r.choice)}`)).toEqual([
      "x402/batch-settlement/eip155 build null",
      "x402/batch-settlement/eip155 build x",
      "x402/batch-settlement/eip155 buildWithin null",
      "x402/batch-settlement/eip155 buildWithin x",
      "x402/batch-settlement/solana build null",
      "x402/batch-settlement/solana build x",
      "x402/batch-settlement/solana buildWithin null",
      "x402/batch-settlement/solana buildWithin x",
      "x402/batch-settlement/cloudflare build null",
      "x402/batch-settlement/cloudflare build x",
    ]);
    for (const r of choices) {
      const b = pairings[r.pairing as keyof typeof pairings] as unknown as Record<string, (c: unknown, h: AtrHash) => Promise<unknown>>;
      expect(await b[r.call!]!(r.choice, H), r.case).toEqual(refused(r.expect));
    }
  });

  it("the Solana build refuses ES2's choice with an h that is not a hash", async () => {
    const hs = rows.filter((r) => "h" in r);
    expect(hs.map((r) => r.h)).toEqual(["abc", `0X${H.slice(2)}`, null]);
    const o: PaymentRequirements = S.option;
    const doc = unwrap(batchSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o));
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: S.payer,
      payerAuthorizer: S.payer,
      deposit: BigInt(S.deposit),
      salt: 42n,
      openSlot: BigInt(S.openSlot),
      tokenProgram: S.tokenProgram,
      recentBlockhash: S.blockhash,
    };
    expect("refused" in (await batchSvm.build(choice, H))).toBe(false);
    for (const r of hs) expect(await batchSvm.build(choice, r.h as AtrHash), r.case).toEqual(refused(r.expect));
  });
});

// The rule a PDA candidate meets (findPda's isPoint): ed25519.Point.fromBytes(bytes, true), decompression only. The
// rows' point values are Python's integer arithmetic; noble, the decoder findPda calls, agrees on each.
describe("x402-batch-settlement.json ES10: the Ed25519 point rule", () => {
  for (const r of V.ES10.rows as { case: string; bytesHex: string; point: boolean }[]) {
    it(`${r.case}: ${r.point ? "a point" : "not a point"}`, () => {
      let point: boolean;
      try {
        ed25519.Point.fromBytes(fromHex(r.bytesHex), true);
        point = true;
      } catch {
        point = false;
      }
      expect(point).toBe(r.point);
    });
  }
});

describe("x402-batch-settlement.json EB9: the EVM within's refund", () => {
  for (const r of V.EB9.rows as { case: string; refund?: { amount?: string | null } | null; expect: Record<string, unknown> }[]) {
    it(r.case, async () => {
      const doc = evmDoc();
      const refund = r.refund === undefined || r.refund === null ? r.refund : {
        ...r.refund,
        ...(typeof r.refund.amount === "string" ? { amount: BigInt(r.refund.amount) } : {}),
      };
      const u = await batchEvm.buildWithin(
        {
          required: doc,
          accepted: doc.accepts[0]!,
          channelConfig: E.config,
          maxClaimableAmount: BigInt(V.EB2.maxClaimableAmount),
          ...(r.refund !== undefined ? { refund: refund as never } : {}),
        },
        H,
      );
      if ("refused" in u) {
        expect(u, r.case).toEqual(r.expect);
        return;
      }
      const p = unwrap(u.complete([V.EB2.signature]));
      const payload = p.payload as { type: string; amount?: string; voucher: { signature: string } };
      expect(payload.voucher.signature).toBe(V.EB2.signature);
      expect({ type: payload.type, ...(payload.amount !== undefined ? { amount: payload.amount } : {}) }).toEqual(r.expect);
    });
  }
});
