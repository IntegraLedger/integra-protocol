// Runs x402-upto-solana.json through the x402-upto-solana entry point. Every expected value is the file's. A durable
// opening is the file's wire rewritten by @solana/kit (fixtures/svm-durable-nonce.ts), with x402-exact-solana.json's
// nonce; its digest is node:crypto's SHA-256 of kit's message.
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
import { hash, pairingOf, type AtrHash, type Refusal } from "../src/index.js";
import { TOKEN_2022, channelPda, openInstructionData, type SvmLanded, type SvmReader, type SvmRef } from "../src/svm.js";
import { uptoSvm } from "../src/x402-upto-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { DURABLE, durableWire } from "./fixtures/svm-durable-nonce.js";
import { rowsOf } from "./rows.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-upto-solana.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const b64 = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "base64"));
const refused = (code: string) => ({ refused: true, code });
type Unsigned = Exclude<Awaited<ReturnType<typeof uptoSvm.build>>, Refusal>;
type Payment = Exclude<ReturnType<Unsigned["complete"]>, Refusal>;
const landed = (wire: Uint8Array, err: unknown = null): SvmLanded => ({ wire, err, loaded: { writable: [], readonly: [] }, inner: [] });

function readerFor(at: "finalized" | "confirmed" | null | "reader-error", l: SvmLanded, txid: string): SvmReader {
  return {
    network: V.EU5.ref.network,
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

/** A payment carrying `wire` as its opening, with the vector's payload fields. */
const payment = (wire: string, accepted: PaymentRequirements): Payment => ({
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

  it("build refuses an H that is not a 32-byte hash as x402/payload-malformed (docs/reference/refusals.md)", async () => {
    const doc = uptoSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: V.fixed.payer,
      nonce: BigInt(V.fixed.nonce),
      openSlot: BigInt(V.fixed.openSlot),
      now: V.fixed.now,
      tokenProgram: V.fixed.tokenProgram,
      recentBlockhash: V.fixed.blockhash,
    };
    for (const bad of [null, "0x12", H.slice(2), `lcp:sha256:${H}`]) {
      expect(await uptoSvm.build(choice, bad as AtrHash), String(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
  });

  it("agreedRefusals: build refuses a choice that is not an object, and EU3's choice with an h that is not a hash", async () => {
    type Row = { case: string; choice?: unknown; h?: unknown; expect: string };
    const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-upto-solana.json agreedRefusals.rows", {
      exact: 5,
      keep: ["the rows that give build a choice or an h", (r) => "choice" in r || "h" in r],
      leave: [
        "the rows that carry only case and expect, which the agreedRefusals runner below runs by their case, and the openSlot row, which the openSlot test below runs",
        (r) => Object.keys(r).every((k) => k === "case" || k === "expect") || "openSlot" in r,
      ],
    });
    expect(rows.map((r) => ("choice" in r ? ["choice", r.choice] : ["h", r.h]))).toEqual([
      ["choice", null], ["choice", "x"], ["h", "abc"], ["h", `0X${H.slice(2)}`], ["h", null],
    ]);
    const doc = uptoSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    const choice = {
      required: doc,
      accepted: doc.accepts[0]!,
      payer: V.fixed.payer,
      nonce: BigInt(V.fixed.nonce),
      openSlot: BigInt(V.fixed.openSlot),
      now: V.fixed.now,
      tokenProgram: V.fixed.tokenProgram,
      recentBlockhash: V.fixed.blockhash,
    };
    expect("refused" in (await uptoSvm.build(choice, H))).toBe(false);
    for (const r of rows) {
      const out = "choice" in r ? await uptoSvm.build(r.choice as never, H) : await uptoSvm.build(choice, r.h as AtrHash);
      expect(out, r.case).toEqual(refused(r.expect));
    }
  });

  // The payload carries openSlot as a JSON number, and RFC 8259 §6 makes integers in [-(2^53)+1, 2^53-1] interoperable:
  // readers agree exactly on their values. The file's agreedRefusals row gives the slot above that range (2^53 + 1)
  // and its code.
  it("build refuses an openSlot above 2^53-1 with the agreedRefusals row's code, and writes 2^53-1 exactly", async () => {
    const row = V.agreedRefusals.rows.find((r: { openSlot?: string }) => r.openSlot !== undefined);
    expect(row.openSlot).toBe("9007199254740993");
    const doc = uptoSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    const choice = (openSlot: bigint) => ({
      required: doc,
      accepted: doc.accepts[0]!,
      payer: V.fixed.payer,
      nonce: BigInt(V.fixed.nonce),
      openSlot,
      now: V.fixed.now,
      tokenProgram: V.fixed.tokenProgram,
      recentBlockhash: V.fixed.blockhash,
    });
    for (const openSlot of [BigInt(row.openSlot), 2n ** 53n, 2n ** 64n - 1n]) {
      expect(await uptoSvm.build(choice(openSlot), H), String(openSlot)).toEqual(refused(row.expect));
    }
    const u = await uptoSvm.build(choice(2n ** 53n - 1n), H);
    if ("refused" in u) throw new Error(u.code);
    const p = u.complete(ed25519.sign(u.request.message, fromHex(V.fixed.payerSeed)));
    if ("refused" in p) throw new Error(p.code);
    expect(p.payload.openSlot).toBe(9007199254740991);
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
    for (const row of rowsOf(V.EU5.rows, "x402-upto-solana.json EU5.rows")) {
      expect(await uptoSvm.status(ref, readerFor(row.at, landed(wire, row.err ?? null), V.EU5.txid)), JSON.stringify(row)).toEqual(
        row.expect,
      );
    }
    expect(await uptoSvm.recover(ref, readerFor("finalized", landed(wire), V.EU5.txid))).toBe(V.EU5.expectRecover);
    const nc = V.EU5.noChannel;
    const r = readerFor("finalized", landed(b64(nc.landedWireBase64)), "nc");
    expect(await uptoSvm.status({ ...ref, transaction: "nc", digest: nc.digest }, r)).toEqual(nc.expect);
  });

  it("EU3's opening made durable: a sysvar from a lookup table is bound and recorded; a nonce account from one is refused", async () => {
    const sysvar = durableWire(V.EU3.wireBase64, [DURABLE.sysvar]);
    expect(sysvar.instruction0Accounts[0]).toBeLessThan(sysvar.staticKeys);
    expect(sysvar.instruction0Accounts[1]).toBeGreaterThanOrEqual(sysvar.staticKeys);
    const p = payment(sysvar.wireBase64, V.EU4.accepted);
    expect(await uptoSvm.bound(p)).toBe(V.EU4.expectBound);
    expect(await uptoSvm.reference(p)).toEqual({
      ...V.EU4.expectReference,
      digest: sysvar.digest,
      blockhash: "",
      nonce: { account: DURABLE.nonceAccount, value: DURABLE.value },
    });
    const both = durableWire(V.EU3.wireBase64, [DURABLE.nonceAccount, DURABLE.sysvar]);
    expect(both.instruction0Accounts[0]).toBeGreaterThanOrEqual(both.staticKeys);
    const q = payment(both.wireBase64, V.EU4.accepted);
    expect(await uptoSvm.bound(q)).toEqual(refused("svm/nonce-account-not-static"));
    expect(await uptoSvm.reference(q)).toEqual(refused("svm/nonce-account-not-static"));
  });

  it("plant: an opening whose carrier is not this ATR's hash is never bound", async () => {
    for (const row of rowsOf(V.plant, "x402-upto-solana.json plant")) expect(await uptoSvm.bound(payment(row.wireBase64, row.accepted)), row.case).toEqual(refused(row.expect));
  });
});

// The agreedRefusals rows that carry only case and expect: each case names its calls, and each call here is one of
// them, made with the file's fixed data, EU3's wire and EU5's transaction with no channel instruction.
describe("x402-upto-solana.json agreedRefusals: the rows that carry only case and expect", () => {
  type Row = { case: string; choice?: unknown; h?: unknown; openSlot?: string; expect: string };
  const rows = rowsOf(V.agreedRefusals.rows as Row[], "x402-upto-solana.json agreedRefusals.rows", {
    keep: ["the rows that carry only case and expect", (r) => Object.keys(r).every((k) => k === "case" || k === "expect")],
    leave: [
      "the rows that give build a choice or an h, which the agreedRefusals build test above runs, and the openSlot row, which the openSlot test above runs",
      (r) => "choice" in r || "h" in r || "openSlot" in r,
    ],
  });
  const advertised = (o: PaymentRequirements = O): PaymentRequired => {
    const doc = uptoSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o);
    if ("refused" in doc) throw new Error(doc.code);
    return doc;
  };
  /** EU3's choice: the advertised option with fixed's payer, nonce, openSlot, now, tokenProgram and blockhash as recentBlockhash. */
  const eu3Choice = (doc: PaymentRequired = advertised()) => ({
    required: doc,
    accepted: doc.accepts[0]!,
    payer: V.fixed.payer as string,
    nonce: BigInt(V.fixed.nonce),
    openSlot: BigInt(V.fixed.openSlot),
    now: V.fixed.now as number,
    tokenProgram: V.fixed.tokenProgram as string,
    recentBlockhash: V.fixed.blockhash as string,
  });
  /** EU3's wire with the first byte of its open instruction's data, EU2's bytes, set to `discriminator`. */
  const reopened = (discriminator: number): string => {
    const wire = Buffer.from(V.EU3.wireBase64, "base64");
    const data = Buffer.from(V.EU2.openInstructionData, "hex");
    const at = wire.indexOf(data);
    if (at === -1 || wire.indexOf(data, at + 1) !== -1) throw new Error("EU3's wire holds EU2's open instruction data once");
    wire[at] = discriminator;
    return wire.toString("base64");
  };

  const cases: Record<string, () => Promise<unknown[]>> = {
    // The payment-channels program's top_up (3) and request_close (5) discriminators in place of open's (1).
    "bound when the transaction's one payment-channels instruction is not an open, or there is none": async () => [
      await uptoSvm.bound(payment(reopened(3), V.EU4.accepted)),
      await uptoSvm.bound(payment(reopened(5), V.EU4.accepted)),
      await uptoSvm.bound(payment(V.EU5.noChannel.landedWireBase64, V.EU4.accepted)),
    ],
    "build when the choice's tokenProgram differs from extra.tokenProgram, or now is not a non-negative integer": async () => {
      const c = eu3Choice();
      return [
        await uptoSvm.build({ ...c, tokenProgram: TOKEN_2022 }, H),
        await uptoSvm.build({ ...c, now: -1 }, H),
        await uptoSvm.build({ ...c, now: 1.5 }, H),
        await uptoSvm.build({ ...c, now: String(V.fixed.now) as never }, H),
      ];
    },
    "advertise or build with an amount that is not a u64 in decimal or a non-positive maxTimeoutSeconds": async () => {
      const advertise = (o: PaymentRequirements) => uptoSvm.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o);
      const doc = advertised();
      const build = (o: PaymentRequirements) => uptoSvm.build({ ...eu3Choice(doc), required: { ...doc, accepts: [o] }, accepted: o }, H);
      return [
        advertise({ ...O, amount: "1.5" }),
        advertise({ ...O, maxTimeoutSeconds: 0 }),
        await build({ ...doc.accepts[0]!, amount: "18446744073709551616" }),
        await build({ ...doc.accepts[0]!, maxTimeoutSeconds: -1 }),
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
