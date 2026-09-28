// Runs x402-exact-stellar.json through the stellar and x402/exact/stellar entry points. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair, Networks, buildAuthorizationEntryPreimage, xdr } from "@stellar/stellar-sdk";
import { ScVal, TransactionEnvelope } from "@stellar/stellar-sdk/xdr";
import { ReaderError } from "../src/evm.js";
import type { AtrHash } from "../src/index.js";
import {
  PASSPHRASE,
  decodeStellarTx,
  muxedFor,
  muxedId,
  stellarLocate,
  stellarStatus,
  transferEventOf,
  transferEventTopics,
  type StellarReader,
  type StellarRef,
} from "../src/stellar.js";
import { exactStellar, pairingOf, type StellarPaymentPayload } from "../src/x402-exact-stellar.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { account, muxed, signed, simulated, type Case } from "./fixtures/stellar-signed-invocation.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.option;
const refused = (code: string) => ({ refused: true, code });
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "hex"));
const refOf = (r: Record<string, unknown>) => r as unknown as StellarRef;

type Answer = { status: string; envelope?: string; ledger?: number };
type Row = Answer & {
  latestLedger?: number;
  transfers?: { events: { txHash: string }[]; complete: boolean };
  candidate?: Answer;
};

/** A vector's envelope: the literal XDR, or the name of another vector's envelope. */
function envelopeOf(e: string | undefined): string | undefined {
  if (e === "plant") return V.plant.envelope;
  if (e === "rebuilt") return V.V5.rebuilt.envelope;
  return e;
}

/**
 * A reader answering `getTransaction` with the row's answer (a listed transaction with the row's candidate),
 * `getLatestLedger` with the row's latest ledger (2000 when unset), and one page of the row's transfer events, each
 * carrying V1's muxed id (none, complete, when unset).
 */
function readerFor(row: Row): StellarReader {
  const answer = (a: Answer) => {
    if (a.status === "reader-error") throw new ReaderError("transport");
    const envelope = envelopeOf(a.envelope);
    return {
      status: a.status as "SUCCESS",
      ...(envelope !== undefined ? { envelopeXdr: envelope } : {}),
      ...(a.ledger !== undefined ? { ledger: a.ledger } : {}),
      oldestLedger: 1,
    };
  };
  const listed = new Set((row.transfers?.events ?? []).map((e) => e.txHash));
  return {
    network: "stellar:testnet",
    transaction: async (hash) => answer(listed.has(hash) && row.candidate !== undefined ? row.candidate : row),
    transfers: async (f) => ({
      events: (row.transfers?.events ?? []).map((e) => ({ txHash: e.txHash, toMuxedId: BigInt(V.V1.muxedId) })),
      complete: row.transfers?.complete ?? true,
      oldestLedger: f.fromLedger,
    }),
    latestLedger: async () => row.latestLedger ?? 2000,
  };
}

describe("x402-exact-stellar.json", () => {
  it("V1: the carrier", () => {
    expect(muxedId(H)).toBe(BigInt(V.V1.muxedId));
    expect(muxedId(H).toString(16)).toBe(V.V1.muxedIdHex);
    const m = muxedFor(V.fixed.seller, H);
    expect(m).toBe(V.V1.M);
    expect(m.length).toBe(V.V1.Mlength);
    const env = TransactionEnvelope.fromXdr(V.V3.envelope, "base64").toXdrObject();
    if (env.type !== 2) throw new Error("not a v1 envelope");
    const body = env.v1.tx.operations[0]!.body;
    if (body.type !== 24 || body.invokeHostFunctionOp.hostFunction.type !== 0) throw new Error("not an invocation");
    const to = body.invokeHostFunctionOp.hostFunction.invokeContract.args[1]!;
    expect(ScVal.fromXdrObject(to).toXdr("base64")).toBe(V.V1.toScValXdr);
    expect(sha256(PASSPHRASE["stellar:testnet"]).slice(0, 8)).toBe(V.V2.networkIdPrefix);
  });

  it("advertise sets payTo to the muxed carrier, read gives H, unplaced gives the option as issued", () => {
    const doc = exactStellar.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [O] }, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(V.V3.accepted);
    const r = exactStellar.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
    expect(exactStellar.unplaced(doc.accepts[0]!)).toEqual(O);
    expect(pairingOf(O)).toBe("x402/exact/stellar");
  });

  it("V2: build returns the vector's preimage; the payer's signature completes the vector's envelope", async () => {
    const accepted: PaymentRequirements = V.V3.accepted;
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
    const u = await exactStellar.build(
      { required, accepted, simulatedXdr: V.V2.simulatedXdr, currentLedger: V.V2.currentLedger },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.kind).toBe("stellar-auth");
    expect(u.request.preimage.length).toBe(V.V2.expectPreimageLength);
    expect(sha256(u.request.preimage)).toBe(V.V2.expectPreimageSha256);
    const sig = ed25519.sign(fromHex(sha256(u.request.preimage)), fromHex(V.fixed.payerSeed));
    const sigHex = Buffer.from(sig).toString("hex");
    expect(sigHex.startsWith(V.V2.expectSignaturePrefix)).toBe(true);
    expect(sigHex.endsWith(V.V2.expectSignatureSuffix)).toBe(true);
    expect(u.complete(sig)).toBe(V.V2.expectEnvelope);
  });

  it("V3: bound and reference", async () => {
    expect(Buffer.from(V.V3.envelope, "base64").length).toBe(V.V3.envelopeLength);
    const p: StellarPaymentPayload = {
      x402Version: 2,
      accepted: V.V3.accepted,
      payload: { transaction: V.V3.envelope },
      extensions: V.V3.extensions,
    };
    expect(await exactStellar.bound(p)).toBe(V.V3.expectBound);
    const r = await exactStellar.reference(p);
    expect(r).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("V4: refusals", async () => {
    for (const row of V.V4) {
      if (row.advertiseOption !== undefined) {
        const o: PaymentRequirements = row.advertiseOption;
        expect(exactStellar.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o)).toEqual(
          refused(row.expect),
        );
        continue;
      }
      const p: StellarPaymentPayload = {
        x402Version: 2,
        accepted: row.accepted,
        payload: { transaction: row.envelope },
        extensions: row.extensions,
      };
      expect(await exactStellar.bound(p), row.case).toEqual(refused(row.expect));
    }
  });

  it("V5: status and stellarLocate", async () => {
    const ref = refOf(V.V5.ref) as StellarRef & { transaction: string };
    for (const row of V.V5.rows) expect(await stellarStatus(ref, readerFor(row)), row.case).toEqual(row.expect);
    const disabled: StellarReader = {
      ...readerFor(V.V5.rows[0]),
      transfers: async () => ({ events: [], complete: false, oldestLedger: 1 }),
    };
    expect(await stellarLocate(ref, disabled)).toEqual(V.V5.locateEventsDisabled.expect);
    const retention: StellarReader = {
      ...readerFor(V.V5.rows[0]),
      transfers: async () => ({ events: [], complete: true, oldestLedger: ref.fromLedger + 1 }),
    };
    expect(await stellarLocate(ref, retention)).toEqual(V.V5.locateOldestAboveFrom.expect);
    const held: StellarReader = {
      ...readerFor(V.V5.rows[0]),
      transfers: async () => ({ events: [], complete: true, oldestLedger: ref.fromLedger }),
    };
    expect(await stellarLocate(ref, held)).toEqual({ complete: true });
    for (const row of [V.V5.locateCandidateNotReadable, V.V5.locateCandidateNotThisInstrument]) {
      const listed: StellarReader = {
        ...readerFor({ status: row.status, ...(row.envelope === "plant" ? { envelope: V.plant.envelope, ledger: 990 } : {}) }),
        transfers: async () => ({ events: [{ txHash: "bb".repeat(32), toMuxedId: BigInt(ref.toId) }], complete: true, oldestLedger: ref.fromLedger }),
      };
      expect(await stellarLocate(ref, listed), row.case).toEqual(row.expect);
    }
  });

  it("V5 rebuilt: V3's signed entry in another transaction is the same instrument", () => {
    const e = xdr.TransactionEnvelope.fromXdr(V.V3.envelope, "base64").toXdrObject();
    if (e.type !== 2) throw new Error("not a v1 envelope");
    e.v1.tx.sourceAccount = { type: 0, ed25519: new Uint8Array(32).fill(0x07) };
    e.v1.tx.seqNum = 424242n;
    e.v1.tx.fee = 5_000_000;
    e.v1.signatures = [];
    expect(xdr.TransactionEnvelope.fromXdrObject(e).toXdr("base64")).toBe(V.V5.rebuilt.envelope);
    const a = decodeStellarTx(V.V3.envelope, "stellar:testnet");
    const b = decodeStellarTx(V.V5.rebuilt.envelope, "stellar:testnet");
    if ("refused" in a || "refused" in b) throw new Error("decode");
    expect(b.auth.preimageHash).toBe(V.V3.expectReference.authDigest);
    expect([b.auth.preimageHash, b.toId]).toEqual([a.auth.preimageHash, a.toId]);
  });

  it("V3v2: sorobanCredentialsAddressV2 decodes, builds and settles", async () => {
    const accepted: PaymentRequirements = V.V3.accepted;
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
    const u = await exactStellar.build({ required, accepted, simulatedXdr: V.V3v2.simulatedXdr, currentLedger: V.V3v2.currentLedger }, H);
    if ("refused" in u) throw new Error(u.code);
    expect(u.request.preimage.length).toBe(V.V3v2.expectPreimageLength);
    expect(sha256(u.request.preimage)).toBe(V.V3v2.expectPreimageSha256);
    const sig = ed25519.sign(fromHex(sha256(u.request.preimage)), fromHex(V.fixed.payerSeed));
    expect(Buffer.from(sig).toString("hex")).toBe(V.V3v2.expectSignature);
    expect(u.complete(sig)).toBe(V.V3v2.envelope);
    expect(Buffer.from(V.V3v2.envelope, "base64").length).toBe(V.V3v2.envelopeLength);
    const p: StellarPaymentPayload = {
      x402Version: 2,
      accepted,
      payload: { transaction: V.V3v2.envelope },
      extensions: V.V3.extensions,
    };
    expect(await exactStellar.bound(p)).toBe(V.V3v2.expectBound);
    const r = await exactStellar.reference(p);
    expect(r).toEqual(V.V3v2.expectReference);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const ref = { ...V.V3v2.expectReference, transaction: "aa".repeat(32) } as StellarRef & { transaction: string };
    expect(await stellarStatus(ref, readerFor({ status: "SUCCESS", envelope: V.V3v2.envelope, ledger: 990 }))).toEqual(V.V3v2.expectStatus);
    const v1: StellarRef & { transaction: string } = { ...ref, authDigest: V.V3.expectReference.authDigest };
    expect(await stellarStatus(v1, readerFor({ status: "SUCCESS", envelope: V.V3v2.envelope, ledger: 990, latestLedger: 995 }))).toEqual({
      state: "pending",
      why: "not-this-instrument",
    });
  });

  it("events: the transfer topic filter, and each event's recipient and muxed id", () => {
    expect(transferEventTopics(V.events.filterFor.toBase)).toEqual(V.events.filterFor.expect);
    for (const row of V.events.rows) {
      const got = transferEventOf(row.topic, row.value);
      if (typeof row.expect === "string") {
        expect(got, row.case).toEqual(refused(row.expect));
        continue;
      }
      if ("refused" in got) throw new Error(got.code);
      expect({ toBase: got.toBase, toMuxedId: got.toMuxedId === null ? null : got.toMuxedId.toString() }).toEqual(row.expect);
    }
  });

  it("plant: the 8-byte id alone is never this payment", async () => {
    const ref = refOf(V.V5.ref) as StellarRef & { transaction: string };
    const r = readerFor({ status: "SUCCESS", envelope: V.plant.envelope, ledger: 990, latestLedger: V.plant.latestLedger });
    expect(await stellarStatus(ref, r)).toEqual(V.plant.expect);
  });
});

describe("x402-exact-stellar.json: what the payer signs is the entry's rootInvocation", () => {
  const seller = fromHex("ca93ac1705187071d67b83c7ff0efe8108e8ec4530575d7726879333dbdabe7c");
  const other = Keypair.fromRawEd25519Seed(Buffer.from("07".repeat(32), "hex"));
  const M = muxed(seller, BigInt(V.V1.muxedId));
  const G = account(seller);
  const O = account(other.rawPublicKey());
  const A = 10_000_000n;
  const seed = fromHex(V.fixed.payerSeed);
  const agree: Case = { operation: { to: M, amount: A }, signed: { to: M, amount: A } };
  const rows: readonly (readonly [string, Case])[] = [
    ["the operation pays V1's M; the invocation the payer's entry signs pays the plain seller G", { operation: { to: M, amount: A }, signed: { to: G, amount: A } }],
    ["the invocation the payer's entry signs pays V1's M; the operation pays the plain seller G", { operation: { to: G, amount: A }, signed: { to: M, amount: A } }],
    ["the invocation the payer's entry signs has amount 10000001; the operation has 10000000", { operation: { to: M, amount: A }, signed: { to: M, amount: A + 1n } }],
    ["the invocation the payer's entry signs carries a sub-invocation", { ...agree, subInvocation: true }],
  ];
  const buildRows: readonly Case[] = [
    { operation: { to: M, amount: A }, signed: { to: O, amount: A } },
    { operation: { to: M, amount: A }, signed: { to: M, amount: A + 1n } },
    { ...agree, subInvocation: true },
  ];

  it("@stellar/stellar-sdk 17.1.0 reproduces V2's simulated envelope, V3's and V4's plain-G envelope, and every row built with it", async () => {
    expect(simulated(V.V2.simulatedXdr, agree)).toBe(V.V2.simulatedXdr);
    expect(await signed(V.V2.simulatedXdr, agree, seed, 1000)).toBe(V.V3.envelope);
    const plain: Case = { operation: { to: G, amount: A }, signed: { to: G, amount: A } };
    expect(await signed(V.V2.simulatedXdr, plain, seed, 1000)).toBe(V.V4[0].envelope);
    for (const [name, c] of rows) {
      const row = V.V4.find((r: { case: string }) => r.case === name);
      expect(row, name).toBeDefined();
      expect(await signed(V.V2.simulatedXdr, c, seed, 1000), name).toBe(row.envelope);
    }
    expect(other.publicKey()).toBe(V.V4build.other);
    buildRows.forEach((c, i) => expect(simulated(V.V2.simulatedXdr, c)).toBe(V.V4build.rows[i].simulatedXdr));
  });

  it("build refuses a simulated envelope whose signed invocation is not the operation's, or pays another account", async () => {
    const accepted: PaymentRequirements = V.V3.accepted;
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
    for (const row of V.V4build.rows) {
      const u = await exactStellar.build({ required, accepted, simulatedXdr: row.simulatedXdr, currentLedger: V.V4build.currentLedger }, H);
      expect(u, row.case).toEqual(refused(row.expect));
    }
  });

  it("reference's authDigest is SHA-256 of the HashIDPreimage the SDK builds, and the payer's signature verifies over it", async () => {
    const p: StellarPaymentPayload = { x402Version: 2, accepted: V.V3.accepted, payload: { transaction: V.V3.envelope }, extensions: V.V3.extensions };
    const r = await exactStellar.reference(p);
    if ("refused" in r) throw new Error(r.code);
    const env = xdr.TransactionEnvelope.fromXdr(V.V3.envelope, "base64").toXdrObject();
    if (env.type !== 2 || env.v1.tx.operations[0]!.body.type !== 24) throw new Error("not an invocation");
    const wire = env.v1.tx.operations[0]!.body.invokeHostFunctionOp.auth[0]!;
    const entry = xdr.SorobanAuthorizationEntry.fromXdrObject(wire);
    const preimage = buildAuthorizationEntryPreimage(entry, 1000, Networks.TESTNET).toXdr("raw");
    expect(r.authDigest).toBe(`0x${sha256(preimage)}`);
    if (wire.credentials.type !== 1 || wire.credentials.address.signature.type !== 16) throw new Error("not an account signature");
    const map = wire.credentials.address.signature.vec![0]!;
    if (map.type !== 17) throw new Error("not a signature map");
    const sig = map.map!.find((e) => e.key.type === 15 && e.key.sym.toString() === "signature")!.val;
    if (sig.type !== 13) throw new Error("not bytes");
    expect(ed25519.verify(sig.bytes, fromHex(sha256(preimage)), Keypair.fromRawEd25519Seed(Buffer.from(seed)).rawPublicKey())).toBe(true);
  });
});
