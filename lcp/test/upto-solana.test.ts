// Runs x402-upto-solana.json through the x402-upto-solana entry point. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  isSignerRole,
  isWritableRole,
} from "@solana/kit";
import { ReaderError } from "../src/evm.js";
import { hash, type AtrHash } from "../src/index.js";
import { channelPda, openInstructionData, type SvmLanded, type SvmReader, type SvmRef } from "../src/svm.js";
import { pairingOf, uptoSvm, type UptoSvmPaymentPayload } from "../src/x402-upto-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-upto-solana.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));
const refused = (code: string) => ({ refused: true, code });
const landed = (wire: Uint8Array, err: unknown = null): SvmLanded => ({ wire, err, loaded: { writable: [], readonly: [] }, inner: [] });

function readerFor(at: "finalized" | "confirmed" | null | "reader-error", l: SvmLanded, txid: string): SvmReader {
  return {
    network: V.EU5.ref.network,
    transaction: async (sig, commitment) => {
      if (at === "reader-error") throw new ReaderError("transport");
      if (sig !== txid || at === null) return null;
      if (at === "confirmed" && commitment === "finalized") return null;
      return l;
    },
    signatures: async () => [],
    blockhashValid: async () => true,
    firstAvailableBlock: async () => 0n,
  };
}

/** A payment carrying `wire` as its opening, with the vector's payload fields. */
const payment = (wire: string, accepted: PaymentRequirements): UptoSvmPaymentPayload => ({
  x402Version: 2,
  accepted,
  payload: {
    from: V.fixed.payer,
    maxAmount: "10000",
    expiresAt: V.fixed.now + 60,
    validAfter: V.fixed.now,
    nonce: V.fixed.nonce,
    openSlot: Number(V.fixed.openSlot),
    channelId: V.EU4.channelId,
    deposit: "10000",
    authorizedSigner: V.fixed.receiverAuthorizer,
    openTransaction: wire,
  },
});

describe("x402-upto-solana.json", () => {
  it("EU1 and EU2: the channel PDA and the open instruction's data", () => {
    expect(
      channelPda({
        payer: V.fixed.payer,
        payee: V.fixed.feePayer,
        mint: V.fixed.mint,
        signer: V.fixed.receiverAuthorizer,
        salt: BigInt(V.fixed.nonce),
        openSlot: BigInt(V.fixed.openSlot),
      }),
    ).toBe(V.EU1.channelPda);
    const data = openInstructionData({
      salt: 7n,
      deposit: 10000n,
      gracePeriod: 3600,
      openSlot: BigInt(V.fixed.openSlot),
      recipient: V.fixed.payTo,
    });
    expect(hex(data)).toBe(V.EU2.openInstructionData);
    expect(data.length).toBe(V.EU2.length);
  });

  it("EU3: the opening build compiles, decompiled, and the payer's signature over it", async () => {
    const doc = uptoSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(V.EU4.accepted);
    expect(uptoSvm.unplaced(doc.accepts[0]!)).toEqual(O);
    expect(pairingOf(O)).toBe("x402/upto/solana");
    const u = await uptoSvm.build(
      {
        required: doc,
        accepted: doc.accepts[0]!,
        payer: V.fixed.payer,
        nonce: BigInt(V.fixed.nonce),
        openSlot: BigInt(V.fixed.openSlot),
        now: V.fixed.now,
        tokenProgram: V.fixed.tokenProgram,
        recentBlockhash: V.fixed.blockhash,
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    const message = u.request.message;
    expect(message.length).toBe(V.EU3.messageLength);
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(message));
    expect(m.feePayer.address).toBe(V.EU3.feePayer);
    expect((m.lifetimeConstraint as { blockhash: string }).blockhash).toBe(V.EU3.blockhash);
    type Ix = { programAddress: string; accounts?: readonly { address: string; role: number }[]; data?: Uint8Array };
    const got = (m.instructions as readonly Ix[]).map((ix) => ({
      program: ix.programAddress,
      accounts: (ix.accounts ?? []).map((a) => [
        a.address,
        isSignerRole(a.role as Parameters<typeof isSignerRole>[0]),
        isWritableRole(a.role as Parameters<typeof isWritableRole>[0]),
      ]),
      data: hex(ix.data ?? new Uint8Array()),
    }));
    expect(got).toEqual(V.EU3.instructions);
    const sig = ed25519.sign(message, fromHex(V.fixed.payerSeed));
    const p = u.complete(sig);
    if ("refused" in p) throw new Error(p.code);
    expect(await uptoSvm.bound(p)).toBe(H);
    expect(p.payload.channelId).toBe(V.EU1.channelPda);
    console.log(
      `EU3: build's message SHA-256 ${(await hash(message)).slice(2)}; the vector's ${V.EU3.messageSha256}; ` +
        `signature ${hex(sig).slice(0, 8)}…${hex(sig).slice(-6)}; the vector's ${V.EU3.payerSignaturePrefix}…${V.EU3.payerSignatureSuffix}`,
    );
  });

  it("EU4: bound and reference of the vector's wire; advertise without a flow", async () => {
    expect(b64(V.EU3.wireBase64).length).toBe(V.EU3.wireLength);
    const p = payment(V.EU3.wireBase64, V.EU4.accepted);
    expect(await uptoSvm.bound(p)).toBe(V.EU4.expectBound);
    expect(await uptoSvm.reference(p)).toEqual(V.EU4.expectReference);
    const ref = await uptoSvm.reference(p);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const o: PaymentRequirements = V.EU4.noFlowOption;
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [o] };
    expect(uptoSvm.advertise(required, H, V.fixed.link, o)).toEqual(refused(V.EU4.noFlowAdvertise));
    const r = uptoSvm.read({ ...required, extensions: { legalContext: { info: { type: "sha256", value: H, legalContextUrl: V.fixed.link }, schema: {} } } });
    expect("refused" in r).toBe(false);
  });

  it("EU5: status, recover, and a transaction with no channel instruction", async () => {
    const wire = b64(V.EU5.landedWireBase64);
    const ref = { ...V.EU5.ref, fromSlot: "0" } as SvmRef & { transaction: string };
    for (const row of V.EU5.rows) {
      expect(await uptoSvm.status(ref, readerFor(row.at, landed(wire, row.err ?? null), V.EU5.txid)), JSON.stringify(row)).toEqual(
        row.expect,
      );
    }
    expect(await uptoSvm.recover(ref, readerFor("finalized", landed(wire), V.EU5.txid))).toBe(V.EU5.expectRecover);
    const nc = V.EU5.noChannel;
    const r = readerFor("finalized", landed(b64(nc.landedWireBase64)), "nc");
    expect(await uptoSvm.status({ ...ref, transaction: "nc", digest: nc.digest }, r)).toEqual(nc.expect);
  });

  it("plant: an opening whose carrier is not this ATR's hash is never bound", async () => {
    for (const row of V.plant) expect(await uptoSvm.bound(payment(row.wireBase64, row.accepted)), row.case).toEqual(refused(row.expect));
  });
});
