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
  batchChannelCreated,
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
import { rowsOf } from "./rows.js";

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
    expect(rowsOf(Array.from(wire.subarray(1, 65)), "the wire's first signature slot, the fee payer's, bytes 1 to 64", { exact: 64 }).every((b) => b === 0)).toBe(true);
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
    for (const row of rowsOf(V.ES8.rows, "x402-batch-settlement.json ES8.rows", { exact: 4 })) {
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
    const rows = rowsOf(
      V.ES9.rows as { maxTimeoutSeconds?: unknown; expectPairing: string | null; expectAdvertise: string | null }[],
      "x402-batch-settlement.json ES9.rows",
      { exact: 9 },
    );
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
    for (const row of rowsOf(V.ES5.rows, "x402-batch-settlement.json ES5.rows")) {
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
  type Row = {
    case: string;
    pairing?: string;
    call?: "build" | "buildWithin";
    calls?: ("bound" | "reference" | "channel.ref" | "buildWithin")[];
    choice?: unknown;
    h?: unknown;
    depositAmount?: string;
    validBeforeOrDeadline?: string;
    configMembers?: Record<string, unknown>[];
    zeroMembers?: ("from" | "payTo" | "asset")[];
    expect: string;
  };
  const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-batch-settlement.json agreedRefusals.rows", {
    keep: ["the rows that name their pairing and what they call", (r) => r.pairing !== undefined],
    leave: [
      "the rows that carry only case and expect: the agreedRefusals runner below runs them by their case, and the EB3 authSalt test above runs the authSalt row",
      (r) => Object.keys(r).every((k) => k === "case" || k === "expect"),
    ],
  });
  const pairings = { "x402/batch-settlement/eip155": batchEvm, "x402/batch-settlement/solana": batchSvm, "x402/batch-settlement/cloudflare": batchCloudflare } as const;
  /** The members a row carries its input in. Each row carries exactly one, and one test below runs the rows of each. */
  const INPUTS = ["choice", "h", "depositAmount", "validBeforeOrDeadline", "configMembers", "zeroMembers"] as const;
  const inputOf = (r: Row) => INPUTS.filter((k) => k in r);
  const carrying = (input: (typeof INPUTS)[number], exact: number, pairing?: string) => {
    const kept = (r: Row) => inputOf(r)[0] === input && (pairing === undefined || r.pairing === pairing);
    return rowsOf(rows, "x402-batch-settlement.json agreedRefusals.rows that name their pairing and what they call", {
      exact,
      keep: [`the rows with ${input}${pairing === undefined ? "" : ` for ${pairing}`}`, kept],
      leave: ["the rows with another input or pairing, which another test in this block runs", (r) => !kept(r)],
    });
  };

  it("each row carries its input in exactly one member", () => {
    for (const r of rows) expect(inputOf(r), r.case).toHaveLength(1);
    expect(rows.filter((r) => "configMembers" in r).map((r) => r.pairing)).toEqual(["x402/batch-settlement/eip155"]);
  });

  /** EB2 and EB3's opening, with its ERC-3009 and with a Permit2 deposit authorization. */
  const openings = async () => [
    ["eip3009", (await evmOpening()).payment],
    ["permit2", (await evmOpening("permit2")).payment],
  ] as const;
  /** The channel id of an EVM channel configuration on Base Sepolia, by viem's EIP-712 typed-data hash. */
  const viemChannelId = (config: Record<string, unknown>) =>
    hashTypedData({
      domain: { name: "x402 Batch Settlement", version: "1", chainId: 84532, verifyingContract: "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003" },
      types: {
        ChannelConfig: [
          { name: "payer", type: "address" },
          { name: "payerAuthorizer", type: "address" },
          { name: "receiver", type: "address" },
          { name: "receiverAuthorizer", type: "address" },
          { name: "token", type: "address" },
          { name: "withdrawDelay", type: "uint40" },
          { name: "salt", type: "bytes32" },
        ],
      },
      primaryType: "ChannelConfig",
      message: config as never,
    });

  it("each pairing's build, and the EVM and SVM buildWithin, refuse a null choice and a string choice", async () => {
    const choices = carrying("choice", 10);
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
    const hs = carrying("h", 3);
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

  // The channel contract's deposit takes its amount as a uint128 and refuses 0 (x402-foundation/x402 751590a2,
  // contracts/evm/src/x402BatchSettlement.sol L202 and L213), so 1 and 2^128 - 1, the least and the largest, are read.
  // The reference's transfer digest for each is node:crypto's SHA-256 over the payer, the deposit's recipient and that
  // amount as a 32-byte word: the ERC-3009 collector, or the channel contract for Permit2, at the addresses the scheme
  // gives (scheme_batch_settlement_evm.md L684-686 at the same commit).
  it("the EVM bound and reference refuse EB2 and EB3's opening whose deposit amount is 2^128 or 0, and read 1 and 2^128 - 1", async () => {
    const amounts = carrying("depositAmount", 2);
    expect(amounts.map((r) => [r.pairing, r.calls, BigInt(r.depositAmount!)])).toEqual([
      ["x402/batch-settlement/eip155", ["bound", "reference"], 2n ** 128n],
      ["x402/batch-settlement/eip155", ["bound", "reference"], 0n],
    ]);
    const word = (v: bigint): Uint8Array => fromHex(v.toString(16).padStart(64, "0"));
    const recipients = [
      [undefined, "0x4020806089470a89826cB9fB1f4059150b550004"],
      ["permit2", "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003"],
    ] as const;
    for (const [method, to] of recipients) {
      const { payment } = await evmOpening(method);
      const p = payment.payload as Record<string, any>;
      const withAmount = (amount: string) => ({ ...payment, payload: { ...p, deposit: { ...p["deposit"], amount } } });
      const form = method ?? "eip3009";
      for (const r of amounts) {
        const b = pairings[r.pairing as keyof typeof pairings] as unknown as Record<string, (p: unknown) => Promise<unknown>>;
        for (const call of r.calls!) {
          expect(await b[call]!(withAmount(r.depositAmount!)), `${form} ${call} ${r.depositAmount}`).toEqual(refused(r.expect));
        }
      }
      for (const amount of [1n, 2n ** 128n - 1n]) {
        expect(await batchEvm.bound(withAmount(amount.toString())), `${form} ${amount}`).toBe(H);
        const ref = unwrap(await batchEvm.reference(withAmount(amount.toString())));
        const digest = createHash("sha256").update(Buffer.concat([fromHex(E.payer.slice(2)), fromHex(to.slice(2)), word(amount)]));
        expect(ref.transferLog?.digest, `${form} ${amount}`).toBe(`0x${digest.digest("hex")}`);
      }
    }
  });

  // The deposit collectors decode the ERC-3009 validBefore and the Permit2 deadline as uint256 (x402-foundation/x402
  // 751590a2, contracts/evm/src/periphery/ERC3009DepositCollector.sol L41-42 and Permit2DepositCollector.sol L83-84), so
  // 2^256 - 1, the largest, is read, and the reference's settleBy carries it in decimal.
  it("the EVM bound and reference refuse EB2 and EB3's opening whose validBefore or deadline is 2^256, and read 2^256 - 1", async () => {
    const bounds = carrying("validBeforeOrDeadline", 1);
    expect(bounds.map((r) => [r.pairing, r.calls, BigInt(r.validBeforeOrDeadline!)])).toEqual([
      ["x402/batch-settlement/eip155", ["bound", "reference"], 2n ** 256n],
    ]);
    const largest = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(BigInt(largest)).toBe(2n ** 256n - 1n);
    const reads: Record<string, (p: unknown) => Promise<unknown>> = { bound: batchEvm.bound, reference: batchEvm.reference };
    for (const [form, payment] of await openings()) {
      const p = payment.payload as Record<string, any>;
      const a = p["deposit"].authorization;
      const withBound = (v: string) => {
        const authorization =
          form === "eip3009"
            ? { erc3009Authorization: { ...a.erc3009Authorization, validBefore: v } }
            : { permit2Authorization: { ...a.permit2Authorization, deadline: v } };
        return { ...payment, payload: { ...p, deposit: { ...p["deposit"], authorization } } };
      };
      for (const r of bounds) {
        for (const call of r.calls!) expect(await reads[call]!(withBound(r.validBeforeOrDeadline!)), `${form} ${call}`).toEqual(refused(r.expect));
      }
      expect(await batchEvm.bound(withBound(largest)), form).toBe(H);
      expect(unwrap(await batchEvm.reference(withBound(largest))).settleBy, form).toBe(largest);
    }
  });

  // The channel contract's deposit reverts InvalidChannel on a configuration whose payer, receiver, receiverAuthorizer
  // or token is the zero address, and WithdrawDelayOutOfRange on a withdrawDelay outside 900 to 2592000
  // (x402-foundation/x402 751590a2, contracts/evm/src/x402BatchSettlement.sol L85-86 and L206-212). It takes a zero
  // payerAuthorizer: the payer then signs the vouchers (L530-538; scheme_batch_settlement_evm.md L21 at the same commit).
  // Each configuration's voucher carries its channel id, viem's typed-data hash of it, so only its form decides.
  it("the EVM bound, reference, channel.ref and buildWithin refuse a channelConfig the channel contract's deposit refuses, and read its edges", async () => {
    const configs = carrying("configMembers", 1, "x402/batch-settlement/eip155");
    const ZERO = "0x0000000000000000000000000000000000000000";
    expect(configs.map((r) => [r.calls, r.configMembers])).toEqual([
      [
        ["bound", "reference", "channel.ref", "buildWithin"],
        [{ payer: ZERO }, { receiver: ZERO }, { receiverAuthorizer: ZERO }, { token: ZERO }, { withdrawDelay: 899 }, { withdrawDelay: 2592001 }],
      ],
    ]);
    const doc = evmDoc();
    for (const [form, payment] of await openings()) {
      const p = payment.payload as Record<string, any>;
      const withConfig = (members: Record<string, unknown>) => {
        const config = { ...p["channelConfig"], ...members };
        const payment2 = { ...payment, payload: { ...p, channelConfig: config, voucher: { ...p["voucher"], channelId: viemChannelId(config) } } };
        const runs: Record<string, () => Promise<unknown>> = {
          bound: () => batchEvm.bound(payment2),
          reference: () => batchEvm.reference(payment2),
          "channel.ref": () => batchEvm.channel.ref(payment2),
          buildWithin: () =>
            batchEvm.buildWithin({ required: doc, accepted: doc.accepts[0]!, channelConfig: config, maxClaimableAmount: BigInt(V.EB2.maxClaimableAmount) }, H),
        };
        return { config, runs };
      };
      for (const r of configs) {
        for (const members of r.configMembers!) {
          const { runs } = withConfig(members);
          for (const call of r.calls!) expect(await runs[call]!(), `${form} ${call} ${JSON.stringify(members)}`).toEqual(refused(r.expect));
        }
      }
      for (const members of [{ withdrawDelay: 900 }, { withdrawDelay: 2592000 }, { payerAuthorizer: ZERO }]) {
        const { config, runs } = withConfig(members);
        const label = `${form} ${JSON.stringify(members)}`;
        const id = viemChannelId(config).toLowerCase();
        expect(await runs["bound"]!(), label).toBe(H);
        expect((unwrap(await runs["reference"]!()) as { bindingLog: { value: string } }).bindingLog.value, label).toBe(id);
        expect(await runs["channel.ref"]!(), label).toEqual({ network: "eip155:84532", channel: id });
        expect("refused" in (unwrap(await runs["buildWithin"]!()) as object), label).toBe(false);
      }
    }
  });

  it("the EVM build refuses a from, or an option's payTo or asset, that is the zero address, and builds with a zero payerAuthorizer", async () => {
    const zeros = carrying("zeroMembers", 1);
    expect(zeros.map((r) => [r.pairing, r.call, r.zeroMembers])).toEqual([["x402/batch-settlement/eip155", "build", ["from", "payTo", "asset"]]]);
    const ZERO = "0x0000000000000000000000000000000000000000";
    const choiceWith = (option: PaymentRequirements, inChoice: Record<string, unknown>) => {
      const doc = unwrap(batchEvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [option] }, H, V.fixed.link, option));
      const base = { required: doc, accepted: doc.accepts[0]!, from: E.payer, now: E.now, payerAuthorizer: E.payerAuthorizer, deposit: BigInt(E.deposit), authSalt: E.authSalt };
      return { ...base, ...inChoice };
    };
    for (const r of zeros) {
      for (const member of r.zeroMembers!) {
        const option: PaymentRequirements = member === "from" ? E.option : { ...E.option, [member]: ZERO };
        const choice = choiceWith(option, member === "from" ? { from: ZERO } : {});
        expect(await batchEvm.build(choice, H), member).toEqual(refused(r.expect));
      }
    }
    expect("refused" in (await batchEvm.build(choiceWith(E.option, { payerAuthorizer: ZERO }), H))).toBe(false);
  });
});

// The rule a PDA candidate meets (findPda's isPoint): ed25519.Point.fromBytes(bytes, true), decompression only. The
// rows' point values are Python's integer arithmetic; noble, the decoder findPda calls, agrees on each.
describe("x402-batch-settlement.json ES10: the Ed25519 point rule", () => {
  for (const r of rowsOf(V.ES10.rows as { case: string; bytesHex: string; point: boolean }[], "x402-batch-settlement.json ES10.rows")) {
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
  for (const r of rowsOf(
    V.EB9.rows as { case: string; refund?: { amount?: string | null } | null; expect: Record<string, unknown> }[],
    "x402-batch-settlement.json EB9.rows",
  )) {
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

// The agreedRefusals rows that carry only case and expect, but the authSalt row: each case names its calls, and each
// call here is one of them, made with the file's fixed data, the EVM opening EB2 and EB3 sign, ES2's Solana opening and
// ES4's config, the EB7 and EB8 receipts and logs, and EC1's Cloudflare option.
describe("x402-batch-settlement.json agreedRefusals: the rows that carry only case and expect", () => {
  type Row = { case: string; pairing?: string; call?: string; choice?: unknown; h?: unknown; expect: string };
  const authSalt = (r: Row) => r.case.startsWith("EVM build with an authSalt");
  const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-batch-settlement.json agreedRefusals.rows", {
    keep: [
      "the rows that carry only case and expect, but the authSalt row",
      (r) => Object.keys(r).every((k) => k === "case" || k === "expect") && !authSalt(r),
    ],
    leave: [
      "the rows that name their pairing and what they call, which the tests of the rows that carry their input above run, and the authSalt row, which the EB3 authSalt test above runs",
      (r) => r.pairing !== undefined || authSalt(r),
    ],
  });
  const tx = ("0x" + "cd".repeat(32)) as Hex;
  const named = { network: "eip155:84532" as const, transaction: tx };
  const svmDoc = (): PaymentRequired => {
    const o: PaymentRequirements = S.option;
    return unwrap(batchSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o));
  };
  /** ES2's choice: the advertised Solana option with the svm payer as payer and payerAuthorizer, deposit, salt 42, openSlot, tokenProgram and blockhash. */
  const es2Choice = (doc: PaymentRequired = svmDoc()) => ({
    required: doc,
    accepted: doc.accepts[0]!,
    payer: S.payer as string,
    payerAuthorizer: S.payer as string,
    deposit: BigInt(S.deposit),
    salt: 42n,
    openSlot: BigInt(S.openSlot),
    tokenProgram: S.tokenProgram as string,
    recentBlockhash: S.blockhash as string,
  });
  const svmVoucher = { channelId: V.ES1.channelPda, maxClaimableAmount: "1000", expiresAt: 0, signature: "x" };
  /** ES2's opening as ES4 presents it, with `config` as its channelConfig. */
  const svmOpening = (config: unknown) =>
    svmPayment({ type: "deposit", channelConfig: config, voucher: svmVoucher, deposit: { amount: S.deposit, transaction: V.ES2.wireBase64 } });
  const svmVoucherPayment = (config: unknown) => svmPayment({ type: "voucher", channelConfig: config, voucher: svmVoucher });

  const cases: Record<string, () => Promise<unknown[]>> = {
    // The EVM bound and reference read the deposit amount: the reference's transfer digest holds it, and the channel
    // contract's deposit takes it as a uint128 and refuses 0 (x402BatchSettlement.sol L202 and L213 at x402 751590a2).
    // channel.ref reads no deposit, and the Solana pairing reads the opening's deposit from its transaction.
    "bound, reference or ref with a channelConfig member missing or malformed, or EVM bound or reference with a deposit amount that is not decimal, is 0, or is 2^128 or more": async () => {
      const { payment } = await evmOpening();
      const p = payment.payload as Record<string, any>;
      const { salt: _salt, ...evmNoSalt } = p["channelConfig"];
      const evmDelayText = { ...p["channelConfig"], withdrawDelay: String(p["channelConfig"].withdrawDelay) };
      const evmOpeningWith = (config: unknown) => ({ ...payment, payload: { ...p, channelConfig: config } });
      const evmVoucher = (config: unknown) => ({ ...payment, payload: { type: "voucher", channelConfig: config, voucher: p["voucher"] } });
      const notDecimal = { ...payment, payload: { ...p, deposit: { ...p["deposit"], amount: "1e5" } } };
      const pastU128 = { ...payment, payload: { ...p, deposit: { ...p["deposit"], amount: "9".repeat(39) } } };
      const zero = { ...payment, payload: { ...p, deposit: { ...p["deposit"], amount: "0" } } };
      const { payer: _payer, ...svmNoPayer } = V.ES4.config;
      const svmSaltText = { ...V.ES4.config, salt: "forty-two" };
      return [
        await batchEvm.bound(evmOpeningWith(evmNoSalt)),
        await batchEvm.bound(evmOpeningWith(evmDelayText)),
        await batchEvm.bound(notDecimal),
        await batchEvm.bound(pastU128),
        await batchEvm.bound(zero),
        await batchEvm.reference(evmOpeningWith(evmNoSalt)),
        await batchEvm.reference(evmOpeningWith(evmDelayText)),
        await batchEvm.reference(notDecimal),
        await batchEvm.reference(pastU128),
        await batchEvm.reference(zero),
        await batchEvm.channel.ref(evmVoucher(evmNoSalt)),
        await batchEvm.channel.ref(evmVoucher(evmDelayText)),
        await batchSvm.bound(svmOpening(svmNoPayer)),
        await batchSvm.bound(svmOpening(svmSaltText)),
        await batchSvm.reference(svmOpening(svmNoPayer)),
        await batchSvm.reference(svmOpening(svmSaltText)),
        await batchSvm.channel.ref(svmVoucherPayment(svmNoPayer)),
        await batchSvm.channel.ref(svmVoucherPayment(svmSaltText)),
      ];
    },
    // EB7's receipt holds a transfer and a Deposited log; its other-contract plant holds the same with the Deposited
    // log from another address; the last receipt holds EB8's ChannelCreated log from that other address.
    "recover when no ChannelCreated log from the channel contract is in the receipt": async () => {
      const other = V.EB7.plantOtherContract.receipt.logs[1].address as string;
      return [
        await batchEvm.recover(named, evmReaderFor(V.EB7.receipt)),
        await batchEvm.recover(named, evmReaderFor(V.EB7.plantOtherContract.receipt)),
        await batchEvm.recover(named, evmReaderFor({ status: 1, blockNumber: "100", logs: [{ ...V.EB8.log, address: other }] })),
      ];
    },
    "recover when several are": async () => [
      await batchEvm.recover(named, evmReaderFor({ status: 1, blockNumber: "100", logs: [V.EB8.log, V.EB8.log] })),
      await batchEvm.recover(named, evmReaderFor({ status: 1, blockNumber: "100", logs: [V.EB8.log, V.EB8.word0Changed] })),
    ],
    // EB8's log data is seven words: payer, payerAuthorizer, receiver, receiverAuthorizer, token, withdrawDelay, salt.
    "batchChannelId or batchChannelCreated with a malformed config or data": async () => {
      const { salt: _salt, ...noSalt } = E.config;
      const data = V.EB8.log.data as string;
      const word = (i: number, w: string) => `0x${data.slice(2, 2 + 64 * i)}${w}${data.slice(2 + 64 * (i + 1))}`;
      return [
        batchChannelId(84532, { ...E.config, salt: "0x12" }),
        batchChannelId(84532, noSalt as never),
        batchChannelCreated({ ...V.EB8.log, data: data.slice(0, -2) }, 84532),
        batchChannelCreated({ ...V.EB8.log, data: word(0, "f".repeat(64)) }, 84532),
        batchChannelCreated({ ...V.EB8.log, data: word(5, "f".repeat(64)) }, 84532),
      ];
    },
    // The EVM completes, the opening's and buildWithin's.
    "EVM complete with a signature count other than the requests', or a signature that is not 0x hex": async () => {
      const { u } = await evmOpening();
      const doc = evmDoc();
      const within = unwrap(
        await batchEvm.buildWithin(
          { required: doc, accepted: doc.accepts[0]!, channelConfig: E.config, maxClaimableAmount: BigInt(V.EB2.maxClaimableAmount) },
          H,
        ),
      );
      const [s1, s2] = [V.EB3.signature as string, V.EB2.signature as string];
      return [
        u.complete([s1]),
        u.complete([s1, s2, s2]),
        u.complete([s1.slice(2), s2]),
        u.complete([s1, `0x${"zz".repeat(65)}`]),
        within.complete([]),
        within.complete([s2, s2]),
        within.complete([s2.slice(2)]),
      ];
    },
    // The opening asks for two signatures and the voucher for one.
    "SVM complete with a signature count other than the requests', or a signature that is not 64 bytes of base58, or a build input out of range": async () => {
      const doc = svmDoc();
      const c = es2Choice(doc);
      const u = unwrap(await batchSvm.build(c, H));
      const within = { required: doc, accepted: doc.accepts[0]!, channelConfig: V.ES4.config, maxClaimableAmount: 1000n };
      const w = unwrap(await batchSvm.buildWithin(within, H));
      const sig = base58.encode(new Uint8Array(64).fill(1));
      expect([u.requests.length, w.requests.length]).toEqual([2, 1]);
      return [
        u.complete([sig]),
        u.complete([sig, sig, sig]),
        w.complete([]),
        w.complete([sig, sig]),
        u.complete(["x", sig]),
        u.complete([sig, base58.encode(new Uint8Array(63).fill(1))]),
        u.complete([`0x${"ab".repeat(64)}`, sig]),
        w.complete([base58.encode(new Uint8Array(65).fill(1))]),
        await batchSvm.build({ ...c, deposit: 0n }, H),
        await batchSvm.build({ ...c, deposit: 2n ** 64n }, H),
        await batchSvm.build({ ...c, salt: 2n ** 64n }, H),
        await batchSvm.build({ ...c, openSlot: 2n ** 53n }, H),
        await batchSvm.build({ ...c, computeUnitLimit: 2 ** 32 }, H),
        await batchSvm.buildWithin({ ...within, maxClaimableAmount: -1n }, H),
      ];
    },
    "Cloudflare build when the challenge's legalContext hash is not h": async () => {
      const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [V.EC1.payload.accepted] };
      const doc = unwrap(batchCloudflare.advertise(required, H, V.fixed.link, V.EC1.payload.accepted));
      return [await batchCloudflare.build({ required: doc, accepted: doc.accepts[0]! }, H2)];
    },
  };

  it("names a case for every row that carries only case and expect, but the authSalt row, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      expect(row.expect, "one refusal code").toMatch(/^[a-z0-9]+\/[a-z0-9-]+$/);
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }
});
