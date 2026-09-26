// Runs x402-exact-solana.json through the svm and x402/exact/solana entry points. Every expected value is the file's.
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
import { decodeSvmTx, svmCarrier, svmLocate, svmRecover, svmStatus, type SvmLanded, type SvmReader, type SvmRef } from "../src/svm.js";
import { exactSvm, pairingOf, type SvmPaymentPayload } from "../src/x402-exact-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-solana.json", import.meta.url), "utf8"));
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const refused = (code: string) => ({ refused: true, code });

const landed = (wire: Uint8Array, err: unknown = null): SvmLanded => ({
  wire,
  err,
  loaded: { writable: [], readonly: [] },
  inner: [],
});

/** A reader that holds one transaction at one commitment. */
function readerFor(
  at: "finalized" | "confirmed" | null | "reader-error",
  l: SvmLanded,
  txid: string = V.V4.txid,
): SvmReader {
  return {
    network: V.V4.network,
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

describe("x402-exact-solana.json", () => {
  const advertised = (): PaymentRequired => {
    const doc = exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    return doc;
  };

  it("advertise places L in extra.memo, read gives H, and unplaced gives the option as issued", () => {
    const doc = advertised();
    expect(doc.accepts[0]).toEqual(V.V2.accepted);
    const r = exactSvm.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
    expect(r.link).toBe(V.fixed.link);
    expect(exactSvm.unplaced(doc.accepts[0]!)).toEqual(O);
    expect(pairingOf(O)).toBe("x402/exact/solana");
  });

  it("defaultComputeBudget: build without a compute unit limit or price writes the default prefix", async () => {
    const doc = advertised();
    const u = await exactSvm.build(
      {
        required: doc,
        accepted: doc.accepts[0]!,
        payer: V.fixed.payer,
        decimals: V.fixed.decimals,
        tokenProgram: V.fixed.tokenProgram,
        recentBlockhash: V.fixed.blockhash,
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(u.request.message));
    type Ix = { programAddress: string; accounts?: readonly unknown[]; data?: Uint8Array };
    const got = (m.instructions as readonly Ix[]).slice(0, 2).map((ix) => ({
      program: ix.programAddress,
      accounts: ix.accounts ?? [],
      data: hex(ix.data ?? new Uint8Array()),
    }));
    expect(got).toEqual(V.defaultComputeBudget.instructions);
  });

  it("V1: the message build compiles, decompiled, and the payer's signature over it", async () => {
    const doc = advertised();
    const u = await exactSvm.build(
      {
        required: doc,
        accepted: doc.accepts[0]!,
        payer: V.fixed.payer,
        decimals: V.fixed.decimals,
        tokenProgram: V.fixed.tokenProgram,
        recentBlockhash: V.fixed.blockhash,
        computeUnitLimit: V.fixed.computeUnitLimit,
        computeUnitPrice: BigInt(V.fixed.computeUnitPrice),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("solana-message");
    const message = u.request.message;
    expect(message.length).toBe(V.V1.messageLength);
    expect(message[0]).toBe(V.V1.messageFirstByte);
    const compiled = getCompiledTransactionMessageDecoder().decode(message);
    const m = decompileTransactionMessage(compiled);
    expect(m.feePayer.address).toBe(V.V1.feePayer);
    expect((m.lifetimeConstraint as { blockhash: string }).blockhash).toBe(V.V1.blockhash);
    type Ix = { programAddress: string; accounts?: readonly { address: string; role: number }[]; data?: Uint8Array };
    const got = (m.instructions as readonly Ix[]).map((ix) => ({
      program: ix.programAddress,
      accounts: (ix.accounts ?? []).map((a) => ({
        address: a.address,
        signer: isSignerRole(a.role as Parameters<typeof isSignerRole>[0]),
        writable: isWritableRole(a.role as Parameters<typeof isWritableRole>[0]),
      })),
      data: hex(ix.data ?? new Uint8Array()),
    }));
    expect(got).toEqual(V.V1.instructions);
    const sig = ed25519.sign(message, fromHex(V.fixed.payerSeed));
    expect(ed25519.verify(sig, message, ed25519.getPublicKey(fromHex(V.fixed.payerSeed)))).toBe(true);
    const payment = u.complete(sig);
    if ("refused" in payment) throw new Error(payment.code);
    expect(await exactSvm.bound(payment)).toBe(H);
    console.log(
      `V1: build's message SHA-256 ${(await hash(message)).slice(2)}; the vector's ${V.V1.messageSha256}; ` +
        `signature ${hex(sig).slice(0, 8)}…${hex(sig).slice(-6)}; the vector's ${V.V1.payerSignaturePrefix}…${V.V1.payerSignatureSuffix}`,
    );
  });

  it("V1: L is 77 bytes and its hex is the vector's", () => {
    expect(new TextEncoder().encode(V.fixed.L).length).toBe(V.V1.Lbytes);
    expect(hex(new TextEncoder().encode(V.fixed.L))).toBe(V.fixed.Lhex);
  });

  it("V2: bound and reference of the partially signed wire", async () => {
    const wire = b64(V.V2.wireBase64);
    expect(wire.length).toBe(V.V2.wireLength);
    const p: SvmPaymentPayload = { x402Version: 2, accepted: V.V2.accepted, payload: { transaction: V.V2.wireBase64 } };
    expect(await exactSvm.bound(p)).toBe(V.V2.expectBound);
    expect(await exactSvm.reference(p)).toEqual(V.V2.expectReference);
    const ref = await exactSvm.reference(p);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    expect(hex(tx.signatures[1]!).slice(0, 8)).toBe(V.V1.payerSignaturePrefix);
    expect(svmCarrier(tx)).toEqual({ h: H, memo: V.fixed.L });
  });

  it("V3: refusals", async () => {
    for (const row of V.V3) {
      if (row.advertiseOption !== undefined) {
        const o: PaymentRequirements = row.advertiseOption;
        expect(exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o)).toEqual(
          refused(row.expect),
        );
        continue;
      }
      const p: SvmPaymentPayload = { x402Version: 2, accepted: row.accepted, payload: { transaction: row.wireBase64 } };
      expect(await exactSvm.bound(p), row.case).toEqual(refused(row.expect));
    }
  });

  it("V4: status and recover", async () => {
    const wire = b64(V.V4.landedWireBase64);
    const ref = V.V4.ref as SvmRef & { transaction: string };
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of V.V4.rows) {
      const reader = readerFor(row.at, landed(wire, row.err ?? null));
      expect(await svmStatus(ref, reader), JSON.stringify(row)).toEqual(row.expect);
    }
    expect(await svmRecover(ref, readerFor("finalized", landed(wire)))).toBe(V.V4.expectRecover);
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    const { base58 } = await import("@scure/base");
    expect(base58.encode(tx.signatures[0]!)).toBe(V.V4.txid);
  });

  it("V5: svmLocate", async () => {
    const fromSlot = BigInt(V.V5.fromSlot);
    const ref: SvmRef = { ...V.V4.ref, fromSlot: V.V5.fromSlot };
    const holds = async () => BigInt(V.V5.firstAvailableBlock);
    delete (ref as { transaction?: string }).transaction;
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const wire = b64(V.V4.landedWireBase64);
    const carrier: string = V.V5.memoRendering.carrier;
    const other: string = V.V5.memoRendering.other;
    type Sig = { signature: string; slot: bigint; memo: string | null };
    const pages = (n: number, tail: Sig[]) => {
      let served = 0;
      return async (): Promise<readonly Sig[]> => {
        served++;
        if (served <= n) {
          return Array.from({ length: 1000 }, (_, i) => ({
            signature: `other-${served}-${i}`,
            slot: fromSlot + 100_000n - BigInt(i),
            memo: i % 2 === 0 ? other : null,
          }));
        }
        return tail;
      };
    };
    let reads = 0;
    const counted = (r: SvmReader): SvmReader => ({
      ...r,
      transaction: async (sig, c) => {
        reads++;
        return r.transaction(sig, c);
      },
    });
    const none = counted({ ...readerFor("finalized", landed(wire)), signatures: pages(1000, []), firstAvailableBlock: holds });
    expect(await svmLocate(ref, none, H)).toEqual(V.V5.tenFullPagesNoMatch.expect);
    expect(reads).toBe(0);
    const second: SvmReader = {
      ...readerFor("finalized", landed(wire)),
      firstAvailableBlock: holds,
      signatures: pages(1, [
        { signature: V.V4.txid, slot: fromSlot + 5n, memo: carrier },
        { signature: "older", slot: fromSlot - 1n, memo: carrier },
      ]),
    };
    expect(await svmLocate(ref, second, H)).toEqual(V.V5.secondPageReachesFromSlot.expect);
    const plantWire = b64(V.plant.landedWireBase64);
    for (const c of [V.V5.candidateCap, V.V5.candidatesWithinCap, V.V5.candidatesNotReadable]) {
      const list: Sig[] = Array.from({ length: c.candidates }, (_, i) => ({ signature: `cand-${i}`, slot: fromSlot + 10n, memo: carrier }));
      list.push({ signature: "older", slot: fromSlot - 1n, memo: null });
      expect(c.candidateWire === "plant" || c.candidateWire === null, c.case).toBe(true);
      const r: SvmReader = {
        network: V.V4.network,
        transaction: async (sig) => (c.candidateWire === "plant" && sig.startsWith("cand-") ? landed(plantWire) : null),
        signatures: async () => list,
        blockhashValid: async () => false,
        firstAvailableBlock: holds,
      };
      expect(await svmLocate(ref, r, H), c.case).toEqual(c.expect);
    }
    for (const c of [V.V5.firstAvailableAboveFromSlot, V.V5.firstAvailableAtFromSlot]) {
      const r: SvmReader = {
        ...readerFor("finalized", landed(wire)),
        signatures: async () => [{ signature: "older", slot: fromSlot - 1n, memo: null }],
        firstAvailableBlock: async () => BigInt(c.firstAvailableBlock),
      };
      expect(await svmLocate(ref, r, H), c.case).toEqual(c.expect);
    }
  });

  it("plant: a memo-only transaction is never settled", async () => {
    const wire = b64(V.plant.landedWireBase64);
    const txid = "plant";
    const reader = readerFor("finalized", landed(wire), txid);
    const base = { ...V.V4.ref, transaction: txid } as SvmRef & { transaction: string };
    expect(await svmStatus({ ...base, digest: V.plant.ownDigest.digest }, reader)).toEqual(V.plant.ownDigest.expect);
    expect(await svmStatus({ ...base, digest: V.plant.v1Digest.digest }, reader)).toEqual(V.plant.v1Digest.expect);
  });
});
