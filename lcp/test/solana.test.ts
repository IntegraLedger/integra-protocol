// Runs x402-exact-solana.json through the svm and x402/exact/solana entry points. Every expected value is the file's,
// except where a block names another source.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  compileTransactionMessage,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  isSignerRole,
  isWritableRole,
} from "@solana/kit";
import { ReaderError } from "../src/evm.js";
import { hash, pairingOf, type AtrHash, type Refusal } from "../src/index.js";
import {
  MEMO_V3,
  buildSvmMessage,
  decodeSvmTx,
  svmCarrier,
  svmLocate,
  svmNonceMoved,
  svmRecover,
  svmStatus,
  type SvmLanded,
  type SvmReader,
  type SvmRef,
} from "../src/svm.js";
import { exactSvm, type SvmUnsigned } from "../src/x402-exact-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-solana.json", import.meta.url), "utf8"));
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const refused = (code: string) => ({ refused: true, code });
type Payment = Exclude<ReturnType<SvmUnsigned["complete"]>, Refusal>;

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
      if (sig !== txid || at === null) return { notFound: true, slot: null };
      if (at === "confirmed" && commitment === "finalized") return { notFound: true, slot: null };
      return l;
    },
    signatures: async () => [],
    blockhashValid: async () => ({ valid: true, slot: 0n }),
    firstAvailableBlock: async () => 0n,
    account: async () => {
      throw new Error("this reference names no nonce account");
    },
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

  it("build refuses an H that is not a 32-byte hash as x402/payload-malformed (docs/reference/refusals.md)", async () => {
    const doc = advertised();
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: V.fixed.payer,
      decimals: V.fixed.decimals,
      tokenProgram: V.fixed.tokenProgram,
      recentBlockhash: V.fixed.blockhash,
    };
    for (const bad of [null, "0x12", H.slice(2), `lcp:sha256:${H}`]) {
      expect(await exactSvm.build(choice, bad as AtrHash), String(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("agreedRefusals: build refuses a choice that is not an object, and V1's choice with an h that is not a hash", async () => {
    type Row = { case: string; choice?: unknown; h?: unknown; expect: string };
    const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-exact-solana.json agreedRefusals.rows", {
      exact: 5,
      keep: ["the rows that give build a choice or an h", (r) => "choice" in r || "h" in r],
      leave: [
        "the rows that carry only case and expect, which the agreedRefusals runner below runs by their case",
        (r) => Object.keys(r).every((k) => k === "case" || k === "expect"),
      ],
    });
    expect(rows.map((r) => ("choice" in r ? ["choice", r.choice] : ["h", r.h]))).toEqual([
      ["choice", null], ["choice", "x"], ["h", "abc"], ["h", `0X${H.slice(2)}`], ["h", null],
    ]);
    const doc = advertised();
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: V.fixed.payer,
      decimals: V.fixed.decimals,
      tokenProgram: V.fixed.tokenProgram,
      recentBlockhash: V.fixed.blockhash,
    };
    expect("refused" in (await exactSvm.build(choice, H))).toBe(false);
    for (const r of rows) {
      const out = "choice" in r ? await exactSvm.build(r.choice as never, H) : await exactSvm.build(choice, r.h as AtrHash);
      expect(out, r.case).toEqual({ refused: true, code: r.expect });
    }
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
    const p: Payment = { x402Version: 2, accepted: V.V2.accepted, payload: { transaction: V.V2.wireBase64 } };
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
    for (const row of rowsOf(V.V3, "x402-exact-solana.json V3")) {
      if (row.advertiseOption !== undefined) {
        const o: PaymentRequirements = row.advertiseOption;
        expect(exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o)).toEqual(
          refused(row.expect),
        );
        continue;
      }
      const p: Payment = { x402Version: 2, accepted: row.accepted, payload: { transaction: row.wireBase64 } };
      expect(await exactSvm.bound(p), row.case).toEqual(refused(row.expect));
    }
  });

  it("V4: status and recover", async () => {
    const wire = b64(V.V4.landedWireBase64);
    const ref = V.V4.ref as SvmRef & { transaction: string };
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of rowsOf(V.V4.rows, "x402-exact-solana.json V4.rows")) {
      const reader = readerFor(row.at, landed(wire, row.err ?? null));
      expect(await svmStatus(ref, reader), JSON.stringify(row)).toEqual(row.expect);
    }
    expect(await svmRecover(ref, readerFor("finalized", landed(wire)))).toBe(V.V4.expectRecover);
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    const { base58 } = await import("@scure/base");
    expect(base58.encode(tx.signatures[0]!)).toBe(V.V4.txid);
  });

  // SvmReader.transaction answers a landed transaction, or notFound with the node's slot; any other answer, such as
  // getTransaction's bare null passed through, is neither, and is a read to repeat.
  it("a transaction answer of neither documented shape is pending unreadable, and recover refuses it svm/unreadable", async () => {
    const ref = V.V4.ref as SvmRef & { transaction: string };
    const answering = (a: unknown): SvmReader => ({ ...readerFor("finalized", landed(new Uint8Array())), transaction: async () => a as never });
    for (const a of [null, undefined, {}, { notFound: false, slot: 1150n }, "landed"]) {
      expect(await svmStatus(ref, answering(a)), String(a)).toEqual({ state: "pending", why: "unreadable" });
      expect(await svmRecover(ref, answering(a)), String(a)).toEqual(refused("svm/unreadable"));
    }
    for (const slot of [1150n, null]) {
      expect(await svmStatus(ref, answering({ notFound: true, slot }))).toEqual({ state: "pending", why: "not-found" });
      expect(await svmRecover(ref, answering({ notFound: true, slot }))).toEqual(refused("svm/not-found"));
    }
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
        transaction: async (sig) =>
          c.candidateWire === "plant" && sig.startsWith("cand-") ? landed(plantWire) : { notFound: true as const, slot: null },
        signatures: async () => list,
        blockhashValid: async () => ({ valid: false, slot: 0n }),
        firstAvailableBlock: holds,
        account: async () => {
          throw new Error("this reference names no nonce account");
        },
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

describe("x402-exact-solana.json carrierSpelling", () => {
  const C = V.carrierSpelling;

  it("bound refuses the hash in upper-case hex, though the echoed extra.memo carries that spelling", async () => {
    const p: Payment = {
      x402Version: 2,
      accepted: C.bound.accepted,
      payload: { transaction: C.bound.wireBase64 },
    };
    expect(await exactSvm.bound(p)).toEqual(refused(C.bound.expect));
    expect(await exactSvm.reference(p)).toEqual(refused(C.bound.expect));
    const tx = decodeSvmTx(b64(C.bound.wireBase64));
    if ("refused" in tx) throw new Error(tx.code);
    expect(svmCarrier(tx)).toEqual(refused(C.bound.expect));
  });

  it("recover refuses the landed upper-case memo", async () => {
    const reader = readerFor("finalized", landed(b64(C.recover.landedWireBase64)), C.recover.txid);
    const ref = { network: V.V4.network, transaction: C.recover.txid };
    expect(await svmRecover(ref, reader)).toEqual(refused(C.recover.expect));
  });

  it("svmLocate finds the landed payment whatever the case of its memo", async () => {
    const fromSlot = BigInt(V.V5.fromSlot);
    const ref: SvmRef = {
      network: V.V4.network,
      digest: C.locate.digest,
      feePayer: V.fixed.feePayer,
      blockhash: V.fixed.blockhash,
      fromSlot: V.V5.fromSlot,
    };
    const reader: SvmReader = {
      ...readerFor("finalized", landed(b64(C.recover.landedWireBase64)), C.recover.txid),
      signatures: async () => [
        { signature: C.recover.txid, slot: fromSlot + 5n, memo: C.locate.memoRendering },
        { signature: "older", slot: fromSlot - 1n, memo: null },
      ],
      firstAvailableBlock: async () => BigInt(V.V5.firstAvailableBlock),
    };
    expect(await svmLocate(ref, reader, H)).toEqual(C.locate.expect);
  });
});

describe("x402-exact-solana.json durableNonce", () => {
  const D = V.durableNonce;
  const accountOf = (name: string | null): { owner: string; data: Uint8Array } | null =>
    name === null ? null : { owner: D.accounts[name].owner, data: b64(D.accounts[name].dataBase64) };

  it("reference records the nonce only for AdvanceNonceAccount naming the nonce accounts", async () => {
    for (const row of rowsOf(D.reference, "x402-exact-solana.json durableNonce.reference")) {
      const p: Payment = {
        x402Version: 2,
        accepted: V.V2.accepted,
        payload: { transaction: row.wireBase64 },
      };
      expect(await exactSvm.bound(p), row.case).toBe(H);
      const ref = await exactSvm.reference(p);
      expect(ref, row.case).toEqual(row.expect);
      expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    }
  });

  it("a message naming its nonce account through a lookup table is refused", async () => {
    const rows = rowsOf<any>(D.lookupTable.rows, "x402-exact-solana.json durableNonce.lookupTable.rows", {
      exact: 1,
      keep: ["the row with the refusal it expects", (r: { expect?: string }) => r.expect !== undefined],
      leave: ["the row with expectReference, which the next test runs", (r: { expectReference?: unknown }) => r.expectReference !== undefined],
    });
    expect(rows.length).toBe(1);
    for (const row of rows) {
      expect(row.instruction0Accounts[0], row.case).toBeGreaterThanOrEqual(row.staticKeys);
      const p: Payment = {
        x402Version: 2,
        accepted: V.V2.accepted,
        payload: { transaction: row.wireBase64 },
      };
      expect(await exactSvm.bound(p), row.case).toEqual(refused(row.expect));
      expect(await exactSvm.reference(p), row.case).toEqual(refused(row.expect));
    }
  });

  it("a static nonce account with its sysvar from a lookup table is durable: bound gives H, reference records the nonce", async () => {
    const rows = rowsOf<any>(D.lookupTable.rows, "x402-exact-solana.json durableNonce.lookupTable.rows", {
      exact: 1,
      keep: ["the row with expectReference", (r: { expectReference?: unknown }) => r.expectReference !== undefined],
      leave: ["the row with the refusal it expects, which the test above runs", (r: { expect?: string }) => r.expect !== undefined],
    });
    expect(rows.length).toBe(1);
    for (const row of rows) {
      expect(row.liteSvm, row.case).toBe("landed");
      expect(row.nonceMoved, row.case).toBe(true);
      expect(row.instruction0Accounts[0], row.case).toBeLessThan(row.staticKeys);
      expect(row.instruction0Accounts[1], row.case).toBeGreaterThanOrEqual(row.staticKeys);
      // @solana/kit decodes the same wire: the fee payer, the nonce account the instruction names, the nonce value in
      // the blockhash field and the message bytes whose SHA-256 the row records.
      const wire = b64(row.wireBase64);
      const signed = getTransactionDecoder().decode(wire);
      const m = getCompiledTransactionMessageDecoder().decode(signed.messageBytes);
      if (m.version !== 0) throw new Error("the row's wire is a v0 message");
      const ix0 = m.instructions[0]!;
      expect(m.staticAccounts.length).toBe(row.staticKeys);
      expect(ix0.accountIndices).toEqual(row.instruction0Accounts);
      expect(row.expectReference.feePayer).toBe(m.staticAccounts[0]);
      expect(row.expectReference.nonce.account).toBe(m.staticAccounts[ix0.accountIndices![0]!]);
      expect(row.expectReference.nonce.account).toBe(D.nonceAccount);
      expect(row.expectReference.nonce.value).toBe(m.lifetimeToken);
      expect(row.expectReference.nonce.value).toBe(D.movedValue);
      expect(row.expectReference.digest).toBe(`0x${row.messageSha256}`);
      expect(row.expectReference.digest).toBe(`0x${createHash("sha256").update(Uint8Array.from(signed.messageBytes)).digest("hex")}`);
      const p: Payment = {
        x402Version: 2,
        accepted: V.V2.accepted,
        payload: { transaction: row.wireBase64 },
      };
      expect(await exactSvm.bound(p), row.case).toBe(row.expectBound);
      const ref = await exactSvm.reference(p);
      expect(ref, row.case).toEqual(row.expectReference);
      expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    }
  });

  it("svmNonceMoved on that reference is null while the nonce account holds the value the message carries", async () => {
    const row = D.lookupTable.rows.find((r: { expectReference?: unknown }) => r.expectReference !== undefined);
    const ref: SvmRef = { ...row.expectReference, fromSlot: D.nonceMoved.fromSlot };
    const readerOf = (name: string | null): SvmReader => ({
      ...readerFor(null, landed(new Uint8Array())),
      account: async (address) => {
        expect(address).toBe(D.nonceAccount);
        return { slot: 1150n, value: accountOf(name) };
      },
    });
    expect(await svmNonceMoved(ref, readerOf("moved"))).toBe(null);
    expect(await svmNonceMoved(ref, readerOf("held"))).toBe(1150n);
    expect(await svmNonceMoved(ref, readerOf(null))).toBe(1150n);
  });

  it("LiteSVM landed only the durable message", () => {
    expect(D.liteSvm.results.durable).toBe("landed");
    for (const k of ["nonceReadonly", "shapeOnlyNonceValue", "noSigner", "noSysvar"]) {
      expect(D.liteSvm.results[k], k).not.toBe("landed");
    }
    expect(Buffer.from(D.accounts.held.dataBase64, "base64").length).toBe(80);
  });

  it("svmNonceMoved reads the nonce account at a slot at least 150 past fromSlot, and answers that read's slot", async () => {
    const ref: SvmRef = { ...D.reference[0].expect, fromSlot: D.nonceMoved.fromSlot };
    for (const row of rowsOf(D.nonceMoved.rows, "x402-exact-solana.json durableNonce.nonceMoved.rows")) {
      const reader: SvmReader = {
        ...readerFor(null, landed(new Uint8Array())),
        account: async (address) => {
          expect(address).toBe(D.nonceAccount);
          if (row.account === "reader-error") throw new ReaderError("transport");
          return { slot: BigInt(row.slot), value: accountOf(row.account) };
        },
      };
      expect(await svmNonceMoved(ref, reader), row.case).toBe(row.expect === null ? null : BigInt(row.expect));
    }
    const plain: SvmRef = { ...V.V4.ref, fromSlot: D.nonceMoved.fromSlot };
    delete (plain as { transaction?: string }).transaction;
    expect(await svmNonceMoved(plain, readerFor(null, landed(new Uint8Array())))).toBe(null);
  });

  // A lookup that finds nothing shows the transaction absent only up to the slot its node had reached: Solana's
  // getTransaction answers null for a transaction the node does not hold at that commitment, and getSlot names the
  // node's slot at a commitment. The nonce account read shows the nonce moved on as of its response's context slot
  // (getAccountInfo's context.slot). So the last read shows the message never landed only from a node at or past that
  // slot; one behind it, or one naming no slot, leaves the payment pending.
  it("status on the named durable message is nonce-moved once the nonce moved on and a last read at or past the nonce read finds nothing", async () => {
    const ref: SvmRef & { transaction: string } = {
      ...D.reference[0].expect,
      transaction: D.txid,
      fromSlot: D.status.fromSlot,
    };
    const wire = b64(D.status.landedWireBase64);
    for (const row of rowsOf(D.status.rows, "x402-exact-solana.json durableNonce.status.rows")) {
      const answers = [...row.transactions];
      let accountReads = 0;
      const reader: SvmReader = {
        network: V.V4.network,
        transaction: async (sig) => {
          expect(sig).toBe(D.txid);
          expect(answers.length, row.case).toBeGreaterThan(0);
          const answer = answers.shift();
          if (answer === "landed") return landed(wire);
          return { notFound: true, slot: answer.slot === null ? null : BigInt(answer.slot) };
        },
        signatures: async () => [],
        blockhashValid: async () => ({ valid: false, slot: 0n }),
        firstAvailableBlock: async () => BigInt(row.firstAvailableBlock),
        account: async () => {
          accountReads++;
          return { slot: 1150n, value: accountOf(row.account) };
        },
      };
      expect(await svmStatus(ref, reader), row.case).toEqual(row.expect);
      expect(answers, row.case).toEqual([]);
      expect(accountReads, row.case).toBe(row.accountReads);
    }
  });

  // getSignaturesForAddress takes minContextSlot, "The minimum slot that the request can be evaluated at"
  // (solana.com/docs/rpc/http/getsignaturesforaddress), and a node whose slot is below it fails the call (Agave v3.1.8,
  // rpc/src/rpc.rs get_signatures_for_address: MinContextSlotNotReached, JSON-RPC error -32016, "Minimum context slot
  // has not been reached"). The nonce account read shows the nonce moved on as of its context slot, 1150 here as in
  // the status rows, so only a search from a node at or past that slot shows the durable message never landed.
  describe("svmLocate given the nonce read's slot", () => {
    const ref: SvmRef = { ...D.reference[0].expect, fromSlot: D.status.fromSlot };
    const movedAt = 1150n;
    const wire = b64(D.status.landedWireBase64);
    const carrier: string = V.V5.memoRendering.carrier;
    type Sig = { signature: string; slot: bigint; memo: string | null };
    /** A node at slot `at` that lists `list`, as getSignaturesForAddress answers, and holds the durable message at finalized. */
    const nodeAt = (at: bigint, list: Sig[] = [], pages: unknown[] = []): SvmReader => ({
      network: V.V4.network,
      transaction: async (sig, commitment) =>
        sig === D.txid && commitment === "finalized" ? landed(wire) : { notFound: true, slot: at },
      signatures: async (_address, page) => {
        pages.push(page);
        if (page.minContextSlot !== undefined && at < page.minContextSlot) throw new ReaderError("transport");
        return list;
      },
      blockhashValid: async () => ({ valid: false, slot: at }),
      firstAvailableBlock: async () => 0n,
      account: async () => ({ slot: movedAt, value: accountOf("moved") }),
    });

    it("a node behind the nonce read fails the call, and the search is incomplete though it lists nothing", async () => {
      expect(await svmLocate(ref, nodeAt(movedAt - 1n), H, undefined, movedAt)).toEqual({ complete: false });
    });

    it("a node at or past the nonce read answers as it does with no slot given", async () => {
      const found = [
        { signature: D.txid, slot: 1100n, memo: carrier },
        { signature: "older", slot: 999n, memo: null },
      ];
      for (const at of [movedAt, movedAt + 1n]) {
        expect(await svmLocate(ref, nodeAt(at), H, undefined, movedAt), String(at)).toEqual({ complete: true });
        expect(await svmLocate(ref, nodeAt(at), H), String(at)).toEqual({ complete: true });
        expect(await svmLocate(ref, nodeAt(at, found), H, undefined, movedAt), String(at)).toEqual({ found: D.txid, complete: true });
        expect(await svmLocate(ref, nodeAt(at, found), H), String(at)).toEqual({ found: D.txid, complete: true });
      }
    });

    it("every page names the slot, and a node behind it on a later page leaves the search incomplete", async () => {
      const full: Sig[] = Array.from({ length: 1000 }, (_, i) => ({ signature: `other-${i}`, slot: 5000n - BigInt(i), memo: null }));
      const tail: Sig[] = [{ signature: "older", slot: 999n, memo: null }];
      const pages: unknown[] = [];
      let served = 0;
      const paged = (at: (page: number) => bigint): SvmReader => {
        const nodes = [nodeAt(at(0), full, pages), nodeAt(at(1), tail, pages)];
        return { ...nodes[0]!, signatures: (address, page) => nodes[Math.min(served++, 1)]!.signatures(address, page) };
      };
      expect(await svmLocate(ref, paged(() => movedAt), H, undefined, movedAt)).toEqual({ complete: true });
      expect(pages).toEqual([
        { limit: 1000, minContextSlot: movedAt },
        { before: "other-999", limit: 1000, minContextSlot: movedAt },
      ]);
      served = 0;
      expect(await svmLocate(ref, paged((p) => (p === 0 ? movedAt : movedAt - 1n)), H, undefined, movedAt)).toEqual({ complete: false });
    });

    it("with no slot given, no page names one", async () => {
      const pages: unknown[] = [];
      expect(await svmLocate(ref, nodeAt(movedAt - 1n, [], pages), H)).toEqual({ complete: true });
      expect(pages).toStrictEqual([{ limit: 1000 }]);
    });

    it("a slot that is not a u64 bigint is incomplete, with nothing read", async () => {
      for (const bad of [-1n, 2n ** 64n, 1150, "1150", null]) {
        const pages: unknown[] = [];
        let first = 0;
        const reader: SvmReader = {
          ...nodeAt(movedAt, [], pages),
          firstAvailableBlock: async () => {
            first++;
            return 0n;
          },
        };
        expect(await svmLocate(ref, reader, H, undefined, bad as never), String(bad)).toEqual({ complete: false });
        expect([pages.length, first], String(bad)).toEqual([0, 0]);
      }
    });

    it("the caller's sequence: svmNonceMoved's slot, passed to svmLocate, holds a lagging node's empty list incomplete", async () => {
      const at = await svmNonceMoved(ref, nodeAt(movedAt));
      expect(at).toBe(movedAt);
      expect(await svmLocate(ref, nodeAt(movedAt - 1n), H, undefined, at!)).toEqual({ complete: false });
    });
  });

  it("status on a reference without a nonce never reads a nonce account", async () => {
    const reader = readerFor(null, landed(new Uint8Array()));
    expect(await svmStatus(V.V4.ref, reader)).toEqual({ state: "pending", why: "not-found" });
  });
});

// isBlockhashValid answers an RpcResponse: its context is the "Slot and API version the node used to answer this
// request", and its value "Whether the blockhash is still valid at the evaluated slot"; the method's example result is
// { context: { slot: 2483 }, value: false } (solana.com/docs/rpc/http/isblockhashvalid). Agave v3.1.8 answers it with
// new_response(&bank, is_valid), whose context slot is bank.slot() (rpc/src/rpc.rs is_blockhash_valid, new_response),
// and a bank finds a blockhash only among the hashes it holds (accounts-db/src/blockhash_queue.rs
// get_hash_info_if_valid, self.hashes.get(hash)), so a node behind the blockhash's block also answers false.
describe("SvmReader.blockhashValid", () => {
  type Answer = { context: { slot: number }; value: boolean };
  type Sig = { signature: string; slot: bigint; memo: string | null };
  const example: Answer = { context: { slot: 2483 }, value: false };
  const ref: SvmRef = { ...V.V4.ref, fromSlot: "2333" };
  delete (ref as { transaction?: string }).transaction;
  const wire = b64(V.V4.landedWireBase64);
  const carrier: string = V.V5.memoRendering.carrier;
  const older: Sig = { signature: "older", slot: 2332n, memo: null };

  /** The blockhash read from a node answering `read`, and the signatures from a node at slot `listAt` listing `list`. */
  const nodes = (read: Answer, listAt: bigint, list: Sig[], pages: unknown[] = []): SvmReader => ({
    ...readerFor("finalized", landed(wire)),
    blockhashValid: async (blockhash) => {
      expect(blockhash).toBe(ref.blockhash);
      return { valid: read.value, slot: BigInt(read.context.slot) };
    },
    signatures: async (_address, page) => {
      pages.push(page);
      if (page.minContextSlot !== undefined && listAt < page.minContextSlot) throw new ReaderError("transport");
      return list;
    },
  });

  /** The guide's sequence: a false answer at a slot at least 150 past fromSlot, then svmLocate given that slot. */
  const neverLanded = async (reader: SvmReader): Promise<boolean> => {
    const read = await reader.blockhashValid(ref.blockhash);
    if (read.valid || read.slot < BigInt(ref.fromSlot) + 150n) return false;
    const search = await svmLocate(ref, reader, H, undefined, read.slot);
    return search.complete && search.found === undefined;
  };

  it("answers the response's value and its context slot", async () => {
    expectTypeOf<Awaited<ReturnType<SvmReader["blockhashValid"]>>>().toEqualTypeOf<{ valid: boolean; slot: bigint }>();
    expect(await nodes(example, 2483n, []).blockhashValid(ref.blockhash)).toEqual({ valid: false, slot: 2483n });
  });

  it("a false answer, then a search given its slot that is complete with nothing found, shows the message never landed", async () => {
    const pages: unknown[] = [];
    expect(await neverLanded(nodes(example, 2483n, [older], pages))).toBe(true);
    expect(pages).toEqual([{ limit: 1000, minContextSlot: 2483n }]);
  });

  it("a signatures node behind the blockhash read fails the call, though with no slot its empty list reads complete", async () => {
    const lagging = nodes(example, 2482n, [older]);
    expect(await svmLocate(ref, lagging, H)).toEqual({ complete: true });
    expect(await svmLocate(ref, lagging, H, undefined, 2483n)).toEqual({ complete: false });
    expect(await neverLanded(lagging)).toBe(false);
  });

  it("a search given the slot that finds the payment shows it landed", async () => {
    const reader = nodes(example, 2484n, [{ signature: V.V4.txid, slot: 2400n, memo: carrier }, older]);
    expect(await svmLocate(ref, reader, H, undefined, 2483n)).toEqual({ found: V.V4.txid, complete: true });
    expect(await neverLanded(reader)).toBe(false);
  });

  it("a valid blockhash, or a false answer below fromSlot + 150, starts no search", async () => {
    for (const read of [{ ...example, value: true }, { ...example, context: { slot: 2482 } }]) {
      const pages: unknown[] = [];
      expect(await neverLanded(nodes(read, 2483n, [older], pages)), JSON.stringify(read)).toBe(false);
      expect(pages, JSON.stringify(read)).toEqual([]);
    }
  });
});

// The agreedRefusals rows that carry only case and expect: each case names its calls, and each call here is one of
// them, made with the file's fixed data, V2's and V4's wires and V3's two-memo wire.
describe("x402-exact-solana.json agreedRefusals: the rows that carry only case and expect", () => {
  type Row = { case: string; choice?: unknown; h?: unknown; expect: string };
  const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-exact-solana.json agreedRefusals.rows", {
    keep: ["the rows that carry only case and expect", (r) => Object.keys(r).every((k) => k === "case" || k === "expect")],
    leave: ["the rows that give build a choice or an h, which the agreedRefusals build test above runs", (r) => "choice" in r || "h" in r],
  });
  const advertised = (o: PaymentRequirements = O): PaymentRequired => {
    const doc = exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o);
    if ("refused" in doc) throw new Error(doc.code);
    return doc;
  };
  /** V1's choice: the advertised option with fixed's payer, decimals, tokenProgram and blockhash as recentBlockhash. */
  const v1Choice = (doc: PaymentRequired = advertised()) => ({
    required: doc,
    accepted: doc.accepts[0]!,
    payer: V.fixed.payer as string,
    decimals: V.fixed.decimals as number,
    tokenProgram: V.fixed.tokenProgram as string,
    recentBlockhash: V.fixed.blockhash as string,
  });
  /** buildSvmMessage's input for V1's message: fixed's keys, amount, decimals and compute budget, with L as the memo. */
  const v1Message = {
    feePayer: V.fixed.feePayer as string,
    payer: V.fixed.payer as string,
    mint: V.fixed.mint as string,
    tokenProgram: V.fixed.tokenProgram as string,
    decimals: V.fixed.decimals as number,
    payTo: V.fixed.payTo as string,
    amount: BigInt(V.fixed.amount),
    recentBlockhash: V.fixed.blockhash as string,
    memo: V.fixed.L as string,
    computeUnitLimit: V.fixed.computeUnitLimit as number,
    computeUnitPrice: BigInt(V.fixed.computeUnitPrice),
  };
  const payment = (wire: Uint8Array | string, accepted: PaymentRequirements = V.V2.accepted): Payment => ({
    x402Version: 2,
    accepted,
    payload: { transaction: typeof wire === "string" ? wire : Buffer.from(wire).toString("base64") },
  });
  const decoded = (wire: Uint8Array) => {
    const tx = decodeSvmTx(wire);
    if ("refused" in tx) throw new Error(tx.code);
    return tx;
  };
  const wireV2 = b64(V.V2.wireBase64);
  const wireV4 = b64(V.V4.landedWireBase64);
  const twoMemos = (V.V3 as { case: string; wireBase64: string; accepted: PaymentRequirements }[]).find((r) => r.case === "two L memos")!;
  const named = { network: V.V4.network, transaction: V.V4.txid };
  /** V2's message with its Memo instruction taken out, compiled again by @solana/kit, with every signature slot zero. */
  const noMemo = (): Uint8Array => {
    const signed = getTransactionDecoder().decode(wireV2);
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(signed.messageBytes));
    const compiled = compileTransactionMessage({ ...m, instructions: m.instructions.filter((ix) => ix.programAddress !== MEMO_V3) });
    const message = new Uint8Array(getCompiledTransactionMessageEncoder().encode(compiled));
    const signers = compiled.header.numSignerAccounts;
    const wire = new Uint8Array(1 + 64 * signers + message.length);
    wire[0] = signers;
    wire.set(message, 1 + 64 * signers);
    return wire;
  };

  const cases: Record<string, () => Promise<unknown[]>> = {
    "svmCarrier (and so bound and recover) on a transaction with no top-level Memo instruction, or with two or more": async () => {
      const none = noMemo();
      const two = b64(twoMemos.wireBase64);
      return [
        svmCarrier(decoded(none)),
        svmCarrier(decoded(two)),
        await exactSvm.bound(payment(none)),
        await exactSvm.bound(payment(two, twoMemos.accepted)),
        await svmRecover(named, readerFor("finalized", landed(none))),
        await svmRecover(named, readerFor("finalized", landed(two))),
      ];
    },
    // x402's Solana mainnet network, beside the vectors' devnet.
    "recover with a reader for another network": async () => [
      await svmRecover(named, { ...readerFor("finalized", landed(wireV4)), network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }),
    ],
    "recover when the transaction is found at neither finalized nor confirmed": async () => [
      await svmRecover(named, readerFor(null, landed(wireV4))),
    ],
    "recover when the landed transaction's err is not null": async () => {
      const failed = (V.V4.rows as { err?: unknown }[]).find((r) => r.err !== undefined && r.err !== null)!;
      return [await svmRecover(named, readerFor("finalized", landed(wireV4, failed.err)))];
    },
    // A transaction answer whose wire is the base64 text, not its bytes, is not a landed transaction's shape.
    "recover when the reader fails or returns a malformed transaction": async () => [
      await svmRecover(named, readerFor("reader-error", landed(wireV4))),
      await svmRecover(named, readerFor("finalized", { ...landed(wireV4), wire: V.V4.landedWireBase64 })),
    ],
    "build or buildSvmMessage with a malformed key, token program, decimals, amount, compute budget or signature": async () => {
      const c = v1Choice();
      const u = await exactSvm.build(c, H);
      if ("refused" in u) throw new Error(u.code);
      return [
        await exactSvm.build({ ...c, payer: "x" }, H),
        await exactSvm.build({ ...c, tokenProgram: V.fixed.mint }, H),
        await exactSvm.build({ ...c, decimals: 256 }, H),
        await exactSvm.build({ ...c, computeUnitLimit: 2 ** 32 }, H),
        await exactSvm.build({ ...c, computeUnitPrice: 2n ** 64n }, H),
        u.complete(new Uint8Array(63)),
        await buildSvmMessage({ ...v1Message, payTo: "x" }),
        await buildSvmMessage({ ...v1Message, tokenProgram: V.fixed.mint }),
        await buildSvmMessage({ ...v1Message, decimals: -1 }),
        await buildSvmMessage({ ...v1Message, amount: 2n ** 64n }),
        await buildSvmMessage({ ...v1Message, computeUnitLimit: -1 }),
        await buildSvmMessage({ ...v1Message, computeUnitPrice: -1n }),
      ];
    },
    "advertise or build with an amount that is not a u64 in decimal": async () => {
      const doc = advertised();
      const placed = (amount: string) => ({ ...doc.accepts[0]!, amount });
      const build = (o: PaymentRequirements) => exactSvm.build({ ...v1Choice(doc), required: { ...doc, accepts: [o] }, accepted: o }, H);
      return [
        exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [{ ...O, amount: "1.5" }] }, H, V.fixed.link, { ...O, amount: "1.5" }),
        exactSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [{ ...O, amount: "18446744073709551616" }] }, H, V.fixed.link, { ...O, amount: "18446744073709551616" }),
        await build(placed("1.5")),
        await build(placed("18446744073709551616")),
      ];
    },
    "a payload whose transaction is not base64, or whose wire does not decode exactly, or whose signature count differs from the header's":
      async () => [
        await exactSvm.bound(payment(`*${V.V2.wireBase64.slice(1)}`)),
        await exactSvm.bound(payment(Uint8Array.of(...wireV2, 0))),
        await exactSvm.bound(payment(Uint8Array.of(1, ...wireV2.subarray(1 + 64)))),
      ],
    "a wire over 1232 bytes": async () => {
      const over = new Uint8Array(1233);
      over.set(wireV2);
      return [decodeSvmTx(over), await exactSvm.bound(payment(over))];
    },
    "a payment whose option fails the pairing's filter": async () => {
      const accepted = V.V2.accepted as PaymentRequirements;
      const { feePayer: _feePayer, ...noFeePayer } = accepted.extra!;
      return [
        await exactSvm.bound(payment(wireV2, { ...accepted, scheme: "upto" })),
        await exactSvm.bound(payment(wireV2, { ...accepted, extra: noFeePayer })),
        await exactSvm.bound(payment(wireV2, { ...accepted, extra: { ...accepted.extra, memo: "m".repeat(257) } })),
        await exactSvm.reference(payment(wireV2, { ...accepted, scheme: "upto" })),
      ];
    },
  };

  it("names a case for every row that carries only case and expect, and no other", () => {
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
