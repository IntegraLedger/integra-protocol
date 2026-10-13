// Runs the Algorand vector file through the avm entry point. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha512_256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";
import { decodeAddress, decodeSignedTransaction, encodeMsgpack, LogicSig, SignedTransaction } from "algosdk";
import { pairingOf, type AtrHash } from "../src/index.js";
import { avmCarrier, avmStatus, exactAvm, type AvmParams, type AvmReader, type AvmUnsigned } from "../src/avm.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-algorand.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const params: AvmParams = {
  firstValid: BigInt(V.fixed.params.firstValid),
  genesisHash: V.fixed.params.genesisHash,
  genesisId: V.fixed.params.genesisId,
  minFee: BigInt(V.fixed.params.minFee),
  feePerByte: BigInt(V.fixed.params.feePerByte),
};
const txidOf = (toSign: Uint8Array) => base32.encode(sha512_256(toSign)).replace(/=+$/, "");
const publicKeyOf = (address: string) => base32.decode(address + "======").slice(0, 32);

type Answer = { currentRound: string; found: null | { confirmedRound: string } } | "reader-error";
function readerOf(byTxid: Record<string, Answer>, fallback: Answer, note = V.V4.note): AvmReader & { searchNote(): Promise<unknown> } {
  const toAnswer = (a: Answer) => {
    if (a === "reader-error") throw new Error("transport");
    return {
      currentRound: BigInt(a.currentRound),
      found: a.found === null ? null : { confirmedRound: BigInt(a.found.confirmedRound), note: Buffer.from(note, "base64") },
    };
  };
  return {
    network: V.V4.readerNetwork,
    search: async (txid) => toAnswer(byTxid[txid] ?? fallback),
    // A note-prefix search: what the Indexer answers for H's LCP string. Settlement never reads it.
    searchNote: async () => ({ txid: V.plant.otherTxid, ...toAnswer(V.plant.otherAnswer) }),
  };
}
const withStrings = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

describe("x402-exact-algorand.json", () => {
  const required = (o: PaymentRequirements): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });
  const unsigned = async (o: PaymentRequirements) => {
    const u = await exactAvm.build({ required: required(o), accepted: o, payer: V.fixed.payer, params }, H);
    if ("refused" in u) throw new Error(u.code);
    return u as AvmUnsigned;
  };
  const completed = async () => {
    const payment = (await unsigned(O)).complete(Buffer.from(V.fixed.signature, "hex"));
    if ("refused" in payment) throw new Error(payment.code);
    return payment;
  };

  it("V1: standalone, the 268-byte axfer and its txid", async () => {
    const u = await unsigned(V.fixed.OStandalone);
    expect(u.request.kind).toBe("algorand-txn");
    expect(u.request.bytes.length - 2).toBe(V.V1.expectEncodedLength);
    expect(txidOf(u.request.bytes)).toBe(V.V1.expectTxid);
  });

  it("V2: with the fee payer, the payer's bytes, whose signature completes the two entries", async () => {
    const u = await unsigned(O);
    expect(hex(u.request.bytes)).toBe(V.V2.expectBytesToSign);
    expect(txidOf(u.request.bytes)).toBe(V.V2.expectPaymentTxid);
    const signature = Buffer.from(V.fixed.signature, "hex");
    expect(ed25519.verify(signature, u.request.bytes, publicKeyOf(V.fixed.payer))).toBe(true);
    const payment = u.complete(signature);
    if ("refused" in payment) throw new Error(payment.code);
    expect(payment.payload).toEqual({ paymentIndex: V.V2.expectPaymentIndex, paymentGroup: V.V2.expectPaymentGroup });
    expect(payment.accepted).toEqual(O);
    expect(u.complete(new Uint8Array(63))).toEqual({ refused: true, code: "avm/signature-malformed" });
  });

  it("V3: bound and reference, and the refusals", async () => {
    const payment = await completed();
    expect(await exactAvm.bound(payment)).toBe(V.V3.expectBound);
    const ref = await exactAvm.reference(payment);
    expect(ref).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of V.V3.refusals) {
      expect(avmCarrier({ paymentIndex: row.paymentIndex, paymentGroup: row.paymentGroup })).toEqual({
        refused: true,
        code: row.expect,
      });
      const presented = { ...payment, payload: { paymentIndex: row.paymentIndex, paymentGroup: row.paymentGroup } };
      expect(await exactAvm.bound(presented)).toEqual({ refused: true, code: row.expect });
    }
  });

  // bound and reference read the signed transaction and the echoed option's scheme, network, asset, payTo and extra,
  // never its amount or timeout. Each row presents V2's payment under an option whose amount or timeout no build could
  // use, and gives the file's H (FIPS 180-2's "abc") and V3's reference (computed with py-algorand-sdk from the signed
  // bytes). pairingOf, advertise, read and build, which need both, refuse each such option. An option that fails the
  // other checks (the file's option rows) is refused by bound and reference with the row's code.
  it("V3: bound and reference read no amount or timeout from the echoed option", async () => {
    const payment = await completed();
    const doc = exactAvm.advertise(required(O), H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(V.V3.presentedOptions).toHaveLength(5);
    for (const row of V.V3.presentedOptions) {
      const accepted: PaymentRequirements = row.accepted;
      const presented = { ...payment, accepted };
      expect(await exactAvm.bound(presented)).toBe(row.expectBound);
      expect(await exactAvm.reference(presented)).toEqual(row.expectReference);
      expect(pairingOf(accepted)).toBeUndefined();
      expect(exactAvm.advertise(required(accepted), H, V.fixed.link, accepted)).toEqual({ refused: true, code: "avm/option-malformed" });
      expect(exactAvm.read({ ...doc, accepts: [accepted] })).toEqual({ refused: true, code: "x402/no-payable-option" });
      expect(await exactAvm.build({ required: required(accepted), accepted, payer: V.fixed.payer, params }, H)).toEqual({
        refused: true,
        code: "avm/option-malformed",
      });
    }
    expect(V.options).toHaveLength(3);
    for (const row of V.options) {
      const presented = { ...payment, accepted: row.option };
      expect(await exactAvm.bound(presented)).toEqual({ refused: true, code: row.expect });
      expect(await exactAvm.reference(presented)).toEqual({ refused: true, code: row.expect });
    }
  });

  it("V4: status and recover", async () => {
    const ref = V.V4.reference;
    for (const row of V.V4.rows) {
      expect(withStrings(await avmStatus(ref, readerOf({}, row.answer)))).toEqual(row.expect);
    }
    expect(await exactAvm.recover(ref, readerOf({}, V.V4.recover.answer))).toBe(V.V4.recover.expect);
  });

  // An Algorand transaction id is the base32 of its SHA-512/256 hash, without padding: 52 characters (the file's
  // txids, from py-algorand-sdk). Each ref below holds V4's id or last valid round in another form, beside a reader
  // that answers V4's expired row for any id; none is read.
  it("V4: a ref whose txid or lastValid is not in the form reference writes is unreadable, with nothing read", async () => {
    const ref = V.V4.reference;
    const expired = V.V4.rows.find((r: { expect: { why: string } }) => r.expect.why === "expired");
    const searched: unknown[] = [];
    const reader: AvmReader = {
      network: V.V4.readerNetwork,
      search: async (txid) => {
        searched.push(txid);
        return readerOf({}, expired.answer).search(txid);
      },
    };
    // Ids in the written form are read: V4's, and the fee payer's, whose last character is Q.
    for (const txid of [ref.txid, V.V2.expectFeePayerTxid]) {
      expect(withStrings(await avmStatus({ ...ref, txid }, reader))).toEqual(expired.expect);
    }
    expect(searched).toEqual([ref.txid, V.V2.expectFeePayerTxid]);
    searched.length = 0;
    const digest = base32.decode(ref.txid + "====");
    const txids = [
      ref.txid.toLowerCase(),
      ref.txid.slice(0, 51),
      ref.txid + "A",
      ref.txid + "====",
      ref.txid.slice(0, 51) + "B",
      Buffer.from(digest).toString("hex"),
      Buffer.from(digest).toString("base64"),
      "",
      null,
      1,
    ];
    for (const txid of txids) {
      expect(await avmStatus({ ...ref, txid }, reader)).toEqual({ state: "pending", why: "unreadable" });
    }
    for (const lastValid of ["18446744073709551616", "99999999999999999999", "067634796", "-1", 67634796, null]) {
      expect(await avmStatus({ ...ref, lastValid }, reader)).toEqual({ state: "pending", why: "unreadable" });
    }
    expect(searched).toEqual([]);
  });

  // x402's Algorand scheme (x402-foundation/x402, specs/schemes/exact/scheme_exact_algo.md, "Signature Scheme") lets
  // a top-level transaction be authorized by an Ed25519 signature (sig), a k-of-n multisignature (msig) or a logic
  // signature (lsig). V2's payment transaction under each gives the file's H (FIPS 180-2's "abc") and V3's reference
  // (py-algorand-sdk's txid, which covers the transaction and not its authorization).
  it("bound and reference read the note under a signature, a multisignature or a logic signature", async () => {
    const payment = await completed();
    const [feePayerEntry, paymentEntry] = V.V2.expectPaymentGroup as string[];
    const { txn, sig } = decodeSignedTransaction(Buffer.from(paymentEntry!, "base64"));
    if (sig === undefined) throw new Error("V2's payment entry carries no sig");
    // A 1-of-2 multisignature: the payer's key with V2's signature, and payTo's key unsigned.
    const subsig = [{ pk: decodeAddress(V.fixed.payer).publicKey, s: sig }, { pk: decodeAddress(O.payTo).publicKey }];
    const msig = { v: 1, thr: 1, subsig };
    // A logic signature whose program, in TEAL version 6, pushes 1.
    const lsig = new LogicSig(Uint8Array.from([0x06, 0x81, 0x01]));
    for (const authorized of [new SignedTransaction({ txn, msig }), new SignedTransaction({ txn, lsig })]) {
      const entry = Buffer.from(encodeMsgpack(authorized)).toString("base64");
      const presented = { ...payment, payload: { paymentIndex: 1, paymentGroup: [feePayerEntry!, entry] } };
      expect(await exactAvm.bound(presented)).toBe(V.V3.expectBound);
      expect(await exactAvm.reference(presented)).toEqual(V.V3.expectReference);
    }
    expect(exactAvm.pattern.proves).toContain("with a signature, a multisignature or a logic signature");
    expect(exactAvm.pattern.proves).not.toContain("payer signed");
  });

  it("plant: a note search is never a settlement", async () => {
    const ref = V.V4.reference;
    const reader = readerOf({ [V.plant.otherTxid]: V.plant.otherAnswer, [ref.txid]: V.plant.claimedAnswer }, V.plant.claimedAnswer);
    expect(withStrings(await avmStatus(ref, reader))).toEqual(V.plant.expect);
  });

  it("the option filter, advertise and read", () => {
    expect(pairingOf(O)).toBe("x402/exact/algorand");
    for (const row of V.options) {
      expect(pairingOf(row.option)).toBeUndefined();
      expect(exactAvm.advertise(required(row.option), H, V.fixed.link, row.option)).toEqual({ refused: true, code: row.expect });
    }
    const doc = exactAvm.advertise(required(O), H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(O);
    const r = exactAvm.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect([r.h, r.link, r.offer.options]).toEqual([H, V.fixed.link, [O]]);
  });

  it("a genesis hash of another network is refused", async () => {
    const other = { ...params, genesisHash: "wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=" };
    expect(await exactAvm.build({ required: required(O), accepted: O, payer: V.fixed.payer, params: other }, H)).toEqual({
      refused: true,
      code: "avm/network-mismatch",
    });
  });
});
