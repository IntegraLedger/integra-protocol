// Runs x402-exact-stellar.json through the stellar and x402/exact/stellar entry points. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair, Networks, StrKey, authorizeEntry, buildAuthorizationEntryPreimage, xdr } from "@stellar/stellar-sdk";
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
/** A ref recorded from an authorization entry, naming its transaction. */
type EntryRef = StellarRef & { transaction: string; authDigest: `0x${string}`; expiration: number };

type Answer = { status: string; envelope?: string; ledger?: number };
type Row = Answer & {
  latestLedger?: number;
  transfers?: { events: { txHash: string }[]; complete: boolean; latestLedger?: number };
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
 * carrying V1's muxed id (none, complete, when unset), computed at the row's events ledger (its latest ledger when
 * unset).
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
      latestLedger: row.transfers?.latestLedger ?? row.latestLedger ?? 2000,
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
      { required, accepted, simulatedXdr: V.V2.simulatedXdr, currentLedger: V.V2.currentLedger, payer: V.fixed.payer },
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

  it("build refuses an H that is not a 32-byte hash as x402/payload-malformed (docs/reference/refusals.md)", async () => {
    const accepted: PaymentRequirements = V.V3.accepted;
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
    const choice = { required, accepted, simulatedXdr: V.V2.simulatedXdr, currentLedger: V.V2.currentLedger, payer: V.fixed.payer };
    for (const bad of [null, "0x12", H.slice(2), `lcp:sha256:${H}`]) {
      expect(await exactStellar.build(choice, bad as AtrHash), String(bad)).toEqual({ refused: true, code: "x402/payload-malformed" });
    }
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
    for (const row of V.V5.rows) {
      expect(await stellarStatus(ref, readerFor(row)), row.case).toEqual(row.expect);
      if (row.expectLocate !== undefined) expect(await stellarLocate(ref, readerFor(row)), row.case).toEqual(row.expectLocate);
    }
    const disabled: StellarReader = {
      ...readerFor(V.V5.rows[0]),
      transfers: async () => ({ events: [], complete: false, oldestLedger: 1, latestLedger: 1001 }),
    };
    expect(await stellarLocate(ref, disabled)).toEqual(V.V5.locateEventsDisabled.expect);
    const retention: StellarReader = {
      ...readerFor(V.V5.rows[0]),
      transfers: async () => ({ events: [], complete: true, oldestLedger: ref.fromLedger + 1, latestLedger: 1001 }),
    };
    expect(await stellarLocate(ref, retention)).toEqual(V.V5.locateOldestAboveFrom.expect);
    const behind: StellarReader = {
      ...readerFor(V.V5.rows[0]),
      transfers: async () => ({ events: [], complete: true, oldestLedger: ref.fromLedger, latestLedger: 999 }),
    };
    expect(await stellarLocate(ref, behind)).toEqual(V.V5.locateLatestBelowExpiration.expect);
    for (const latestLedger of [1000, 1001]) {
      const held: StellarReader = {
        ...readerFor(V.V5.rows[0]),
        transfers: async () => ({ events: [], complete: true, oldestLedger: ref.fromLedger, latestLedger }),
      };
      expect(await stellarLocate(ref, held)).toEqual({ complete: true });
    }
    for (const row of [V.V5.locateCandidateNotReadable, V.V5.locateCandidateNotThisInstrument]) {
      const listed: StellarReader = {
        ...readerFor({ status: row.status, ...(row.envelope === "plant" ? { envelope: V.plant.envelope, ledger: 990 } : {}) }),
        transfers: async () => ({
          events: [{ txHash: "bb".repeat(32), toMuxedId: BigInt(ref.toId) }],
          complete: true,
          oldestLedger: ref.fromLedger,
          latestLedger: 1001,
        }),
      };
      expect(await stellarLocate(ref, listed), row.case).toEqual(row.expect);
    }
  });

  // Stellar RPC's getEvents answers with latestLedger, the latest ledger the RPC held when it answered. A search whose
  // events index stands below the ledger getLatestLedger gave first cannot show the entry unused through that ledger,
  // so the payment stays pending until the index has caught up.
  it("V5: a search whose events index lags the ledger read first is pending, never expired", async () => {
    const ref = refOf(V.V5.ref) as StellarRef & { transaction: string };
    const nowhere = { status: "NOT_FOUND", latestLedger: 1001, transfers: { events: [], complete: true } };
    for (const [indexed, want] of [
      [990, { state: "pending", why: "not-found" }],
      [1000, { state: "pending", why: "not-found" }],
      [1001, { state: "failed", why: "expired" }],
      [1002, { state: "failed", why: "expired" }],
    ] as const) {
      const reader = readerFor({ ...nowhere, transfers: { ...nowhere.transfers, latestLedger: indexed } });
      expect([indexed, await stellarStatus(ref, reader)]).toEqual([indexed, want]);
    }
    const unnamed: StellarReader = {
      ...readerFor(nowhere),
      transfers: async () => ({ events: [], complete: true, oldestLedger: 1 }) as never,
    };
    expect(await stellarStatus(ref, unnamed)).toEqual({ state: "pending", why: "not-found" });
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

  describe("V5 two entries: a landed transaction is read by the payer's first entry that carries its transfer", () => {
    const row = V.V5.rows.find((r: { case: string }) => r.case.startsWith("the named transaction succeeded carrying two entries"));
    const ref = refOf(V.V5.ref) as StellarRef & { transaction: string };
    const payer = Keypair.fromRawEd25519Seed(Buffer.from(V.fixed.payerSeed, "hex"));

    /**
     * V3's envelope with another entry of the payer ahead of V3's signed entry: V3's transfer at `amount`, nonce `nonce`,
     * signed by `authorizeEntry` for expiration 1000 on testnet; and that entry's preimage digest, as the SDK builds it.
     */
    async function withEntryAhead(nonce: bigint, amount: bigint) {
      const env = xdr.TransactionEnvelope.fromXdr(V.V3.envelope, "base64").toXdrObject();
      if (env.type !== 2 || env.v1.tx.operations[0]!.body.type !== 24) throw new Error("not an invocation");
      const auth = env.v1.tx.operations[0]!.body.invokeHostFunctionOp.auth;
      const first = xdr.SorobanAuthorizationEntry.fromXdr(xdr.SorobanAuthorizationEntry.fromXdrObject(auth[0]!).toXdr()).toXdrObject();
      if (first.credentials.type !== 1 || first.rootInvocation.function.type !== 0) throw new Error("not an address entry");
      first.credentials.address.nonce = nonce;
      first.credentials.address.signature = { type: 1 };
      first.rootInvocation.function.contractFn.args[2] = { type: 10, i128: { hi: 0n, lo: amount } };
      const signed = await authorizeEntry(xdr.SorobanAuthorizationEntry.fromXdrObject(first), payer, 1000, Networks.TESTNET);
      const preimage = buildAuthorizationEntryPreimage(signed, 1000, Networks.TESTNET).toXdr("raw");
      env.v1.tx.operations[0]!.body.invokeHostFunctionOp.auth = [signed.toXdrObject(), auth[0]!];
      return { envelope: xdr.TransactionEnvelope.fromXdrObject(env).toXdr("base64"), digest: `0x${sha256(preimage)}` };
    }

    it("@stellar/stellar-sdk 17.1.0 writes the row's envelope: V3's, with the payer's entry for an amount of 1, nonce 2, ahead", async () => {
      expect(row).toBeDefined();
      expect((await withEntryAhead(2n, 1n)).envelope).toBe(row.envelope);
    });

    it("status and stellarLocate read it by V3's entry; before anything lands it is refused (agreedRefusals row 3)", async () => {
      expect(await stellarStatus(ref, readerFor(row))).toEqual(row.expect);
      const listed: StellarReader = {
        ...readerFor({ status: "NOT_FOUND" }),
        transaction: async (hash) => (hash === "bb".repeat(32) ? readerFor(row).transaction(hash) : { status: "NOT_FOUND", oldestLedger: 1 }),
        transfers: async () => ({
          events: [{ txHash: "bb".repeat(32), toMuxedId: BigInt(ref.toId) }],
          complete: true,
          oldestLedger: ref.fromLedger,
          latestLedger: 1001,
        }),
      };
      expect(await stellarLocate(ref, listed)).toEqual({ found: "bb".repeat(32), complete: true });
      const code = V.agreedRefusals.rows[3].expect;
      expect(decodeStellarTx(row.envelope, "stellar:testnet")).toEqual(refused(code));
      const p: StellarPaymentPayload = { x402Version: 2, accepted: V.V3.accepted, payload: { transaction: row.envelope }, extensions: V.V3.extensions };
      expect(await exactStellar.bound(p)).toEqual(refused(code));
      expect(await exactStellar.reference(p)).toEqual(refused(code));
    });

    // rs-soroban-env, soroban-env-host src/auth.rs, require_auth_enforcing: the host tries the entries in order, skips one
    // whose address or root invocation does not match, and authenticates the first that matches. A second signing of
    // V3's transfer, with no sub-invocations, ahead of V3's entry is then the entry the transaction used, and V3's entry
    // rides unused.
    it("a second signing of the same transfer ahead of V3's entry is the one read, so V3's ref is not this instrument", async () => {
      const ahead = await withEntryAhead(2n, 10_000_000n);
      expect(ahead.digest).not.toBe(ref.authDigest);
      const landed = { status: "SUCCESS", envelope: ahead.envelope, ledger: 990, latestLedger: 995 };
      expect(await stellarStatus(ref, readerFor(landed))).toEqual({ state: "pending", why: "not-this-instrument" });
      expect(await stellarStatus({ ...ref, authDigest: ahead.digest as `0x${string}` }, readerFor(landed))).toEqual({
        state: "settled",
        ledger: 990,
      });
    });
  });

  it("V3v2: sorobanCredentialsAddressV2 decodes, builds and settles", async () => {
    const accepted: PaymentRequirements = V.V3.accepted;
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
    const u = await exactStellar.build(
      { required, accepted, simulatedXdr: V.V3v2.simulatedXdr, currentLedger: V.V3v2.currentLedger, payer: V.fixed.payer },
      H,
    );
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

  // CAP-46-11: the entry's signature "is only considered valid until the signature expiration ledger (inclusive)", so a
  // payment can land in the expiration ledger itself. Stellar RPC getEvents (stellar-docs openrpc EndLedger: "end of
  // search window (exclusive)"; with a cursor, endLedger must be omitted; stellar-rpc get_events.go scans at most 10,000
  // ledgers per call and always returns a cursor).
  describe("StellarReader.transfers: fromLedger through toLedger, both inclusive", () => {
    const SCAN = 10_000;
    const listedTx = "bb".repeat(32);

    /**
     * getEvents over one transfer event at `landedIn`, the latest ledger being `latest`: `endLedger` exclusive, at most
     * SCAN ledgers a call, each event with its ledger, and the returned cursor the last ledger scanned.
     */
    function getEvents(landedIn: number, latest: number, q: { startLedger: number; endLedger: number } | { cursor: string }) {
      const start = "cursor" in q ? Number(q.cursor) + 1 : q.startLedger;
      const end = Math.min("cursor" in q ? Infinity : q.endLedger, start + SCAN, latest + 1);
      const ref = refOf(V.V5.ref);
      const events = landedIn >= start && landedIn < end ? [{ txHash: listedTx, toMuxedId: BigInt(ref.toId), ledger: landedIn }] : [];
      return { events, cursor: String(end - 1) };
    }

    /**
     * A reader over that getEvents whose window ends at `toLedger` (inclusive) or at `toLedger - 1` (`endLedger` set to
     * `toLedger`), returning a cursor until getEvents has scanned through the window's last ledger and keeping only the
     * events through it.
     */
    function readerOver(ref: EntryRef, landedIn: number, inclusive: boolean, calls: object[]): StellarReader {
      const latest = ref.expiration + 5;
      return {
        network: "stellar:testnet",
        transaction: async (hash) =>
          hash === listedTx
            ? { status: "SUCCESS", envelopeXdr: V.V3.envelope, ledger: landedIn, oldestLedger: 1 }
            : { status: "NOT_FOUND", oldestLedger: 1 },
        transfers: async (f) => {
          calls.push(f);
          const last = inclusive ? f.toLedger : f.toLedger - 1;
          const r = getEvents(landedIn, latest, f.cursor !== undefined ? { cursor: f.cursor } : { startLedger: f.fromLedger, endLedger: last + 1 });
          const events = r.events.filter((e) => e.ledger <= last).map(({ txHash, toMuxedId }) => ({ txHash, toMuxedId }));
          return { events, ...(Number(r.cursor) < last ? { cursor: r.cursor } : {}), complete: true, oldestLedger: 1, latestLedger: latest };
        },
        latestLedger: async () => latest,
      };
    }

    it("a payment in the expiration ledger settles through a reader that sends endLedger toLedger + 1 and pages by cursor", async () => {
      const ref = { ...refOf(V.V5.ref), fromLedger: 1, expiration: 25_000 } as EntryRef;
      const calls: { fromLedger?: number; toLedger?: number; cursor?: string }[] = [];
      expect(await stellarStatus(ref, readerOver(ref, ref.expiration, true, calls))).toEqual({ state: "settled", ledger: ref.expiration });
      expect([calls[0]!.fromLedger, calls[0]!.toLedger]).toEqual([ref.fromLedger, ref.expiration]);
      expect(calls.length).toBe(Math.ceil(ref.expiration / SCAN));
    });

    it("the same payment through a reader that sends endLedger toLedger reads failed expired", async () => {
      const ref = refOf(V.V5.ref) as EntryRef;
      const read = async (inclusive: boolean) => stellarStatus(ref, readerOver(ref, ref.expiration, inclusive, []));
      expect(await read(false)).toEqual({ state: "failed", why: "expired" });
      expect(await read(true)).toEqual({ state: "settled", ledger: ref.expiration });
    });
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
  const otherAsset = new Uint8Array(32).fill(7);
  const otherPayer = Keypair.fromRawEd25519Seed(Buffer.from("08".repeat(32), "hex"));
  const moved = (amount: bigint, x: Partial<Case> = {}): Case => ({ operation: { to: M, amount }, signed: { to: M, amount }, ...x });
  const buildRows: readonly Case[] = [
    { operation: { to: M, amount: A }, signed: { to: O, amount: A } },
    { operation: { to: M, amount: A }, signed: { to: M, amount: A + 1n } },
    { ...agree, subInvocation: true },
    moved(1_000_000_000_000n),
    moved(A, { asset: otherAsset }),
    moved(1_000_000_000_000n, { asset: otherAsset }),
    moved(A, { from: otherPayer.rawPublicKey() }),
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
    expect(StrKey.encodeContract(Buffer.from(otherAsset))).toBe(V.V4build.otherAsset);
    expect(otherPayer.publicKey()).toBe(V.V4build.otherPayer);
    expect(buildRows.length).toBe(V.V4build.rows.length);
    buildRows.forEach((c, i) => expect(simulated(V.V2.simulatedXdr, c)).toBe(V.V4build.rows[i].simulatedXdr));
  });

  it("build refuses a simulated envelope whose signed invocation is not the operation's, pays another account, or moves another amount or token, or from another payer, than the option names", async () => {
    const accepted: PaymentRequirements = V.V3.accepted;
    const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
    for (const row of V.V4build.rows) {
      const choice = { required, accepted, simulatedXdr: row.simulatedXdr, currentLedger: V.V4build.currentLedger, payer: V.fixed.payer };
      expect(await exactStellar.build(choice, H), row.case).toEqual(refused(row.expect));
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
