// Runs x402-exact-stellar.json through the stellar and x402/exact/stellar entry points. Every expected value is the file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair, Networks, StrKey, authorizeEntry, buildAuthorizationEntryPreimage, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { ScVal, TransactionEnvelope } from "@stellar/stellar-sdk/xdr";
import { ReaderError } from "../src/evm.js";
import { pairingOf, type AtrHash } from "../src/index.js";
import type { StellarPaymentPayload } from "../src/internal/stellar.js";
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
import { exactStellar } from "../src/x402-exact-stellar.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { counting } from "./fixtures/counting-reader.js";
import { account, muxed, signed, simulated, type Case } from "./fixtures/stellar-signed-invocation.js";
import { rowsOf } from "./rows.js";
import type { TransactionEnvelopeWire } from "@stellar/stellar-sdk/xdr";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-stellar.json", import.meta.url), "utf8"));
const EVM = JSON.parse(readFileSync(new URL("../vectors/x402-exact-eip155-eip3009.json", import.meta.url), "utf8"));
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
    expect((m as string).length).toBe(V.V1.Mlength);
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
    for (const row of rowsOf(V.V4, "x402-exact-stellar.json V4")) {
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
    for (const row of rowsOf(V.V5.rows, "x402-exact-stellar.json V5.rows")) {
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

  // The forms `reference` writes (V3.expectReference, V5.ref): a 64-hex transaction hash, a 0x-prefixed 64-hex entry
  // digest with its u32 expiration ledger, a contract asset, an account toBase, the muxed id as a u64 in decimal, and a
  // u32 fromLedger. docs/guides/rails.md: a reference that lacks a field status reads, or holds it malformed, is pending
  // unreadable, with nothing read. The reader answers V5's row whose well-formed ref reads failed expired.
  it("V5: a ref field outside the form reference writes is pending unreadable, with nothing read", async () => {
    const expired = V.V5.rows.find(
      (r: { case: string }) => r.case === "the named transaction is not found; past the expiration ledger, the search is complete and lists nothing",
    );
    const ref = refOf(V.V5.ref) as StellarRef & { transaction: string };
    expect(await stellarStatus(ref, readerFor(expired))).toEqual({ state: "failed", why: "expired" });
    const { authDigest: _digest, ...noDigest } = V.V5.ref;
    const { expiration: _expiration, ...noExpiration } = V.V5.ref;
    const bad: readonly (readonly [string, Record<string, unknown>])[] = [
      ["transaction x", { ...V.V5.ref, transaction: "x" }],
      ["transaction with 0x", { ...V.V5.ref, transaction: `0x${V.V5.ref.transaction}` }],
      ["authDigest of 31 bytes", { ...V.V5.ref, authDigest: V.V5.ref.authDigest.slice(0, -2) }],
      ["authDigest without 0x", { ...V.V5.ref, authDigest: V.V5.ref.authDigest.slice(2) }],
      ["expiration without authDigest", noDigest],
      ["authDigest without expiration", noExpiration],
      ["expiration a string", { ...V.V5.ref, expiration: "1000" }],
      ["expiration 2^32", { ...V.V5.ref, expiration: 2 ** 32 }],
      ["asset x", { ...V.V5.ref, asset: "x" }],
      ["asset an account", { ...V.V5.ref, asset: V.V5.ref.toBase }],
      ["toBase the muxed form", { ...V.V5.ref, toBase: V.V1.M }],
      ["toId x", { ...V.V5.ref, toId: "x" }],
      ["toId -1", { ...V.V5.ref, toId: "-1" }],
      ["toId 2^64", { ...V.V5.ref, toId: "18446744073709551616" }],
      ["fromLedger a string", { ...V.V5.ref, fromLedger: "900" }],
      ["fromLedger -1", { ...V.V5.ref, fromLedger: -1 }],
    ];
    for (const [name, r] of bad) {
      const { reader, calls } = counting(readerFor(expired));
      expect([name, await stellarStatus(refOf(r) as StellarRef & { transaction: string }, reader), calls]).toEqual([
        name,
        { state: "pending", why: "unreadable" },
        [],
      ]);
    }
  });

  // As the status test above: stellarLocate's search keys are the ref's, so a key outside the form reference writes
  // names no search. The reader answers a complete search that lists nothing, which the well-formed ref reads complete.
  it("V5: stellarLocate with a ref field outside the form reference writes is incomplete, with nothing read", async () => {
    const expired = V.V5.rows.find(
      (r: { case: string }) => r.case === "the named transaction is not found; past the expiration ledger, the search is complete and lists nothing",
    );
    expect(await stellarLocate(refOf(V.V5.ref), readerFor(expired))).toEqual({ complete: true });
    const bad: readonly (readonly [string, Record<string, unknown>])[] = [
      ["authDigest of 31 bytes", { ...V.V5.ref, authDigest: V.V5.ref.authDigest.slice(0, -2) }],
      ["expiration a string", { ...V.V5.ref, expiration: "1000" }],
      ["asset x", { ...V.V5.ref, asset: "x" }],
      ["toBase the muxed form", { ...V.V5.ref, toBase: V.V1.M }],
      ["toId x", { ...V.V5.ref, toId: "x" }],
      ["fromLedger a string", { ...V.V5.ref, fromLedger: "900" }],
    ];
    for (const [name, r] of bad) {
      const { reader, calls } = counting(readerFor(expired));
      expect([name, await stellarLocate(refOf(r), reader), calls]).toEqual([name, { complete: false }, []]);
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

    it("@stellar/stellar-sdk 17.2.1 writes the row's envelope: V3's, with the payer's entry for an amount of 1, nonce 2, ahead", async () => {
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

  // SEP-41 names the event's first topic the symbol `transfer`, and CAP-67 the data map's key `to_muxed_id`; a symbol
  // led by EF BB BF (U+FEFF's UTF-8, Unicode §23.8) is another symbol. The two rows that hold one are row 0's event,
  // re-encoded with @stellar/stellar-sdk 17.2.1 with the one symbol changed.
  it("events: the rows whose symbol begins with a byte-order mark are row 0's event with that symbol changed", () => {
    const BOM = [0xef, 0xbb, 0xbf];
    const symbol = (b64: string) => {
      const v = xdr.ScVal.fromXdr(b64, "base64").toXdrObject();
      if (v.type !== 15) throw new Error("not a symbol");
      return [...v.sym.bytes];
    };
    const byCase = (prefix: string) => V.events.rows.find((r: { case?: string }) => r.case?.startsWith(prefix));
    const led = byCase("not a transfer event: the first topic is the symbol transfer led by a byte-order mark");
    const keyed = byCase("row 0's event with its data's key to_muxed_id led by a byte-order mark");
    const row0 = V.events.rows[0];
    expect(symbol(led.topic[0])).toEqual([...BOM, ...Buffer.from("transfer")]);
    expect([led.topic.slice(1), led.value]).toEqual([row0.topic.slice(1), row0.value]);
    expect(keyed.topic).toEqual(row0.topic);
    const data = (b64: string) => {
      const v = xdr.ScVal.fromXdr(b64, "base64").toXdrObject();
      if (v.type !== 17) throw new Error("not a map");
      return v.map!.map((e) => (e.key.type === 15 ? [...e.key.sym.bytes] : []));
    };
    expect(data(keyed.value)).toEqual(data(row0.value).map((k) => (Buffer.from(k).toString() === "to_muxed_id" ? [...BOM, ...k] : k)));
  });

  it("events: the transfer topic filter, and each event's recipient and muxed id", () => {
    expect(transferEventTopics(V.events.filterFor.toBase)).toEqual(V.events.filterFor.expect);
    for (const row of rowsOf(V.events.rows, "x402-exact-stellar.json events.rows")) {
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
    [
      "the operation and the invocation the payer's entry signs call transfer led by a byte-order mark (EF BB BF), another function",
      { ...agree, functionName: Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("transfer")]) },
    ],
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

  it("@stellar/stellar-sdk 17.2.1 reproduces V2's simulated envelope, V3's and V4's plain-G envelope, and every row built with it", async () => {
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
    for (const row of rowsOf(V.V4build.rows, "x402-exact-stellar.json V4build.rows", { exact: buildRows.length })) {
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

  // x402 v2's PaymentRequirements gives `amount` as the atomic amount in a string, and the filter holds it to the
  // canonical decimal of a positive integer (x402-option-amount.test.ts); x402-exact-stellar.json's agreed refusal for
  // an amount that is not a positive i128 is `x402/option-malformed`.
  it("an option whose amount is 0, -1 or 2^127 is not served: advertise and build refuse it, read and pairingOf do not offer it", async () => {
    const doc = exactStellar.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [V.fixed.option] }, H, V.fixed.link, V.fixed.option);
    if ("refused" in doc) throw new Error(doc.code);
    for (const amount of ["0", "-1", (1n << 127n).toString()]) {
      const o: PaymentRequirements = { ...V.fixed.option, amount };
      expect(exactStellar.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o), amount).toEqual(
        refused("x402/option-malformed"),
      );
      expect(exactStellar.read({ ...doc, accepts: [{ ...doc.accepts[0]!, amount }] }), amount).toEqual(refused("x402/no-payable-option"));
      expect(pairingOf(o), amount).toBeUndefined();
      const accepted = { ...doc.accepts[0]!, amount };
      const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
      const simulatedXdr = V.V2.simulatedXdr;
      expect(await exactStellar.build({ required, accepted, simulatedXdr, currentLedger: V.V2.currentLedger, payer: V.fixed.payer }, H), amount).toEqual(
        refused("x402/option-malformed"),
      );
    }
  });

  // The transfer's amount is an i128 (x402-foundation/x402 8228bd6d specs/schemes/exact/scheme_exact_stellar.md:121),
  // whose XDR is Int128Parts { int64 hi; uint64 lo; } (stellar-xdr, as @stellar/stellar-sdk 17.2.1 generates it): its
  // largest value is 2^127 - 1, which has 39 decimal digits, as 10^38 does. The SDK's nativeToScVal encodes 10^38 and
  // 2^127 - 1 as an i128 and throws RangeError for 2^127 and 10^39; an option asking for either of those is
  // x402-exact-stellar.json's agreed refusal for an amount that is not a positive i128.
  it("an option's amount is served up to 2^127 - 1, the largest i128, and refused from 2^127: advertise and build", async () => {
    for (const amount of [10n ** 38n, (1n << 127n) - 1n]) {
      const o: PaymentRequirements = { ...V.fixed.option, amount: amount.toString() };
      const doc = exactStellar.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o);
      if ("refused" in doc) throw new Error(`${amount}: ${doc.code}`);
      const accepted = doc.accepts[0]!;
      expect(accepted).toEqual({ ...V.V3.accepted, amount: amount.toString() });
      const simulatedXdr = simulated(V.V2.simulatedXdr, moved(amount));
      const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
      const u = await exactStellar.build({ required, accepted, simulatedXdr, currentLedger: V.V2.currentLedger, payer: V.fixed.payer }, H);
      if ("refused" in u) throw new Error(`${amount}: ${u.code}`);
      const env = xdr.TransactionEnvelope.fromXdr(simulatedXdr, "base64").toXdrObject();
      if (env.type !== 2 || env.v1.tx.operations[0]!.body.type !== 24) throw new Error("not an invocation");
      const entry = xdr.SorobanAuthorizationEntry.fromXdrObject(env.v1.tx.operations[0]!.body.invokeHostFunctionOp.auth[0]!);
      const preimage = buildAuthorizationEntryPreimage(entry, V.V2.expectExpiration, Networks.TESTNET).toXdr("raw");
      expect(sha256(u.request.preimage), amount.toString()).toBe(sha256(preimage));
    }
    for (const amount of [1n << 127n, 10n ** 39n]) {
      expect(() => nativeToScVal(amount, { type: "i128" })).toThrow(RangeError);
      const o: PaymentRequirements = { ...V.fixed.option, amount: amount.toString() };
      expect(exactStellar.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o), amount.toString()).toEqual(
        refused("x402/option-malformed"),
      );
      const accepted: PaymentRequirements = { ...V.V3.accepted, amount: amount.toString() };
      const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
      const choice = { required, accepted, simulatedXdr: V.V2.simulatedXdr, currentLedger: V.V2.currentLedger, payer: V.fixed.payer };
      expect(await exactStellar.build(choice, H), amount.toString()).toEqual(refused("x402/option-malformed"));
    }
  });
});

// An envelope's length is counted in UTF-16 code units, as JavaScript's String length counts it: the rows' strings end
// in U+10000, one code point of two code units.
describe("x402-exact-stellar.json agreedRefusals: an envelope string beyond the BMP at the 8192 bound", () => {
  const rows = rowsOf(V.agreedRefusals.rows as { case: string; transaction?: string; expect: string }[], "x402-exact-stellar.json agreedRefusals.rows", {
    exact: 2,
    keep: ["the rows with a transaction string", (r) => typeof r.transaction === "string"],
    leave: [
      "the rows without one, which state the refusal in words: the agreedRefusals runner at the end of this file runs them, but for the peer-missing row, which stellar-peer-missing.test.ts runs, and row 3, which the V5 two-entry test runs",
      (r) => r.transaction === undefined,
    ],
  });
  it("the rows are 8193 and 8192 UTF-16 code units", () => {
    expect(rows.map((r) => [r.transaction!.length, [...r.transaction!].length])).toEqual([[8193, 8192], [8192, 8191]]);
  });
  for (const r of rows) {
    it(`${r.case}: ${r.expect}`, async () => {
      expect(decodeStellarTx(r.transaction!, "stellar:testnet")).toEqual(refused(r.expect));
      const p = { x402Version: 2, accepted: V.V3.accepted, payload: { transaction: r.transaction! }, extensions: V.V3.extensions };
      expect(await exactStellar.bound(p as never)).toEqual(refused(r.expect));
    });
  }
});

// The agreedRefusals rows without a transaction string state a refusal in words. The peer-missing row runs in
// stellar-peer-missing.test.ts and row 3 in the V5 two-entry test above; each case below calls the entry points its row
// names, once for each condition the row lists, with inputs built from the file's V2 simulated envelope, V3's envelope,
// option and extensions, V4build's other token contract and payer, and the first events row, and every result is the
// row's code.
describe("x402-exact-stellar.json agreedRefusals: every row that states its refusal in words runs", () => {
  const accepted: PaymentRequirements = V.V3.accepted;
  const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [accepted] };
  const seller = StrKey.decodeEd25519PublicKey(V.fixed.seller);
  const M = muxed(seller, BigInt(V.V1.muxedId));
  const G = account(seller);
  const A = BigInt(V.fixed.option.amount);
  const agree: Case = { operation: { to: M, amount: A }, signed: { to: M, amount: A } };
  const seed = fromHex(V.fixed.payerSeed);

  /** build on V2's simulated envelope and ledger for V3's option, the payer and H, with any of them replaced. */
  const build = (x: { accepted?: PaymentRequirements; simulatedXdr?: string; payer?: string; h?: AtrHash } = {}) => {
    const option = x.accepted ?? accepted;
    return exactStellar.build(
      {
        required: { ...required, accepts: [option] },
        accepted: option,
        simulatedXdr: x.simulatedXdr ?? V.V2.simulatedXdr,
        currentLedger: V.V2.currentLedger,
        payer: x.payer ?? V.fixed.payer,
      },
      x.h ?? H,
    );
  };
  /** V3's payment, with its envelope or option replaced. */
  const payment = (x: { transaction?: string; accepted?: PaymentRequirements } = {}): StellarPaymentPayload => ({
    x402Version: 2,
    accepted: x.accepted ?? accepted,
    payload: { transaction: x.transaction ?? V.V3.envelope },
    extensions: V.V3.extensions,
  });
  const boundAndReference = async (p: unknown) => [await exactStellar.bound(p as never), await exactStellar.reference(p as never)];
  /** decodeStellarTx, bound and reference of V3's payment carrying `envelope`. */
  const read = async (envelope: string) => [decodeStellarTx(envelope, "stellar:testnet"), ...(await boundAndReference(payment({ transaction: envelope })))];
  /** The envelope decoded, changed, and encoded again. */
  const edited = (xdrB64: string, change: (e: TransactionEnvelopeWire) => TransactionEnvelopeWire | void): string => {
    const e = xdr.TransactionEnvelope.fromXdr(xdrB64, "base64").toXdrObject();
    return xdr.TransactionEnvelope.fromXdrObject(change(e) ?? e).toXdr("base64");
  };
  const v1Of = (e: TransactionEnvelopeWire) => {
    if (e.type !== 2) throw new Error("not a v1 envelope");
    return e.v1;
  };
  /** The envelope with Soroban data whose footprint lists `n` accounts read-only, a part the decoders do not read. */
  const withFootprint = (xdrB64: string, n: number) =>
    edited(xdrB64, (e) => {
      const readOnly = Array.from({ length: n }, (_, i) => ({ type: 0 as const, account: { accountId: { type: 0 as const, ed25519: new Uint8Array(32).fill(i) } } }));
      v1Of(e).tx.ext = {
        v: 1,
        sorobanData: {
          ext: { v: 0 },
          resources: { footprint: { readOnly, readWrite: [] }, instructions: 0, diskReadBytes: 0, writeBytes: 0 },
          resourceFee: 0n,
        },
      };
    });
  const symbol = (s: string) => nativeToScVal(s, { type: "symbol" }).toXdr("base64");

  const cases: Record<string, () => Promise<unknown[]>> = {
    "an envelope that is not strict base64 (RFC 4648 section 4's alphabet, padded to a multiple of 4, zero padding bits) of exactly one XDR v1 transaction or fee bump of one with no bytes after it, or a signature that is not 64 bytes":
      async () => {
        const envelope: string = V.V3.envelope;
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        // V3's envelope ends in one "=", so the base64 character before it carries two padding bits.
        expect(envelope.endsWith("=") && !envelope.endsWith("==")).toBe(true);
        const padBit = `${envelope.slice(0, -2)}${alphabet[alphabet.indexOf(envelope.at(-2)!) | 1]}=`;
        const trailing = Buffer.concat([Buffer.from(envelope, "base64"), Buffer.alloc(4)]).toString("base64");
        // V3's transaction as a v0 envelope: its source account's key, fee, sequence, memo, operation and signatures.
        const v0 = edited(envelope, (e) => {
          const { tx, signatures } = v1Of(e);
          if (tx.sourceAccount.type !== 0) throw new Error("not a plain source account");
          const body = { sourceAccountEd25519: tx.sourceAccount.ed25519, fee: tx.fee, seqNum: tx.seqNum, timeBounds: null, memo: tx.memo };
          return { type: 0, v0: { tx: { ...body, operations: tx.operations, ext: { v: 0 } }, signatures } };
        });
        const u = await build();
        if ("refused" in u) throw new Error(u.code);
        return [
          ...(await read(`-${envelope.slice(1)}`)),
          ...(await read(envelope.slice(0, -1))),
          ...(await read(padBit)),
          ...(await read(v0)),
          ...(await read(trailing)),
          u.complete(new Uint8Array(63)),
          u.complete(new Uint8Array(65)),
        ];
      },
    "an envelope over 8192 base64 characters": async () => {
      // One account fewer, each envelope is within the bound: bound reads V3's payment, and build builds.
      expect([withFootprint(V.V3.envelope, 136).length, withFootprint(V.V2.simulatedXdr, 140).length]).toEqual([8172, 8156]);
      expect(await exactStellar.bound(payment({ transaction: withFootprint(V.V3.envelope, 136) }))).toBe(H);
      expect("refused" in (await build({ simulatedXdr: withFootprint(V.V2.simulatedXdr, 140) }))).toBe(false);
      const envelope = withFootprint(V.V3.envelope, 137);
      const simulatedXdr = withFootprint(V.V2.simulatedXdr, 141);
      expect([envelope.length, simulatedXdr.length]).toEqual([8224, 8208]);
      return [...(await read(envelope)), await build({ simulatedXdr })];
    },
    "an operation that is not one transfer(from, to, amount), or an entry whose rootInvocation is not that same invocation byte for byte with no sub-invocations, checked after the carrier":
      async () => {
        const twoOperations = edited(V.V3.envelope, (e) => {
          const { tx } = v1Of(e);
          tx.operations = [tx.operations[0]!, tx.operations[0]!];
        });
        const approve = edited(V.V3.envelope, (e) => {
          const body = v1Of(e).tx.operations[0]!.body;
          if (body.type !== 24 || body.invokeHostFunctionOp.hostFunction.type !== 0) throw new Error("not an invocation");
          body.invokeHostFunctionOp.hostFunction.invokeContract.functionName = new xdr.XdrString("approve");
        });
        const otherAmount: Case = { operation: { to: M, amount: A }, signed: { to: M, amount: A + 1n } };
        const subInvocation: Case = { ...agree, subInvocation: true };
        return [
          ...(await read(twoOperations)),
          ...(await read(approve)),
          ...(await read(await signed(V.V2.simulatedXdr, otherAmount, seed, 1000))),
          ...(await read(await signed(V.V2.simulatedXdr, subInvocation, seed, 1000))),
          await build({ simulatedXdr: simulated(V.V2.simulatedXdr, otherAmount) }),
          await build({ simulatedXdr: simulated(V.V2.simulatedXdr, subInvocation) }),
        ];
      },
    "build when the option's payTo is not muxed with muxedId(h), or the simulated to is not the option's payTo": async () => [
      await build({ accepted: { ...accepted, payTo: V.fixed.seller } }),
      await build({ h: `0x${"11".repeat(32)}` }),
      await build({ simulatedXdr: simulated(V.V2.simulatedXdr, { operation: { to: G, amount: A }, signed: { to: G, amount: A } }) }),
    ],
    "build when the operation and the signed invocation agree but call a token contract other than the option's asset (x402 scheme_exact_stellar: the SEP-41 token of requirements.asset; MPP stellar charge: the contract matching currency), checked after the carrier and the one-transfer check":
      async () => [
        await build({ simulatedXdr: simulated(V.V2.simulatedXdr, { ...agree, asset: StrKey.decodeContract(V.V4build.otherAsset) }) }),
        await build({ accepted: { ...accepted, asset: V.V4build.otherAsset } }),
      ],
    "build when the agreed transfer's amount is not the option's amount (x402 scheme_exact_stellar: argument 2 MUST equal requirements.amount exactly, as i128; MPP stellar charge: the request's amount), checked after the asset":
      async () => [
        await build({ simulatedXdr: simulated(V.V2.simulatedXdr, { operation: { to: M, amount: A + 1n }, signed: { to: M, amount: A + 1n } }) }),
        await build({ accepted: { ...accepted, amount: (A + 1n).toString() } }),
      ],
    "build when the agreed transfer's from is not the choice's payer, the account whose key signs, checked after the amount": async () => [
      await build({ payer: V.V4build.otherPayer }),
      await build({ simulatedXdr: simulated(V.V2.simulatedXdr, { ...agree, from: StrKey.decodeEd25519PublicKey(V.V4build.otherPayer) }) }),
    ],
    "advertise or build with an amount that is not a positive i128 in decimal, or maxTimeoutSeconds not a positive integer": async () => {
      const amounts: unknown[] = ["0", "010", "-1", "1.5", "0x10", "1e7", (1n << 127n).toString(), 10_000_000];
      const timeouts: unknown[] = [0, -60, 1.5, "60"];
      const offered = [
        ...amounts.map((amount) => ({ amount })),
        ...timeouts.map((maxTimeoutSeconds) => ({ maxTimeoutSeconds })),
      ];
      const results: unknown[] = [];
      for (const x of offered) {
        const o = { ...V.fixed.option, ...x } as PaymentRequirements;
        results.push(exactStellar.advertise({ x402Version: 2, resource: V.fixed.resource, accepts: [o] }, H, V.fixed.link, o));
        results.push(await build({ accepted: { ...accepted, ...x } as PaymentRequirements }));
      }
      return results;
    },
    "a payment whose option fails the pairing's filter": async () => {
      const options = [
        { ...accepted, scheme: "upto" },
        { ...accepted, network: "eip155:8453" },
        { ...accepted, asset: V.fixed.seller },
        { ...accepted, payTo: V.fixed.asset },
        { ...accepted, extra: { areFeesSponsored: false } },
        { ...accepted, extra: {} },
      ];
      return (await Promise.all(options.map((o) => boundAndReference(payment({ accepted: o as PaymentRequirements }))))).flat();
    },
    "a payment without an echoed extensions.legalContext": async () => {
      const { extensions: _extensions, ...without } = payment();
      return [...(await boundAndReference(without)), ...(await boundAndReference({ ...payment(), extensions: {} }))];
    },
    "a transfer event whose topics or data are not a SEP-41 transfer (symbol transfer, an address to, and an i128 or a map for data), or over 1024 base64 characters":
      async () => {
        const { topic, value } = V.events.rows[0] as { topic: string[]; value: string };
        const [name, from, to, asset] = topic as [string, string, string, string];
        expect(name).toBe(symbol("transfer"));
        return [
          transferEventOf([symbol("approve"), from, to, asset], value),
          transferEventOf([nativeToScVal("transfer", { type: "string" }).toXdr("base64"), from, to, asset], value),
          transferEventOf([name, from, symbol("to"), asset], value),
          transferEventOf([name, from], value),
          transferEventOf([name, from, to, asset, asset], value),
          transferEventOf(topic, nativeToScVal(7n, { type: "u64" }).toXdr("base64")),
          transferEventOf(topic, "A".repeat(1028)),
          transferEventOf([name, from, to, "A".repeat(1028)], value),
        ];
      },
    // With the SDK here; stellar-peer-missing.test.ts reads the same row without it. The row's accepts, then that accepts
    // with x402-exact-eip155-eip3009.json's option added, which is another pairing's.
    "read of a challenge whose accepts holds no Stellar option, with @stellar/stellar-sdk and without it: here no option at all":
      async () => {
        const [row] = rowsOf(V.agreedRefusals.rows as { accepts?: PaymentRequirements[] }[], "x402-exact-stellar.json agreedRefusals.rows", {
          exact: 1,
          keep: ["the row with accepts", (r) => r.accepts !== undefined],
          leave: ["every other row", (r) => r.accepts === undefined],
        });
        const doc = (accepts: PaymentRequirements[]) => ({ x402Version: 2 as const, resource: V.fixed.resource, accepts, extensions: V.V3.extensions });
        return [exactStellar.read(doc(row!.accepts!)), exactStellar.read(doc([...row!.accepts!, EVM.fixed.O]))];
      },
  };

  const rows = rowsOf(V.agreedRefusals.rows as { case: string; transaction?: string; expect: string }[], "x402-exact-stellar.json agreedRefusals.rows", {
    exact: Object.keys(cases).length,
    keep: [
      "the rows that state the refusal in words, which the cases above run",
      (r, i) => r.transaction === undefined && r.expect !== "stellar/peer-missing" && i !== 3,
    ],
    leave: [
      "the peer-missing row, which stellar-peer-missing.test.ts runs; row 3, which the V5 two-entry test runs by its index and the build test below runs at build; and the rows with a transaction string, which the 8192-bound test above runs",
      (r, i) => r.expect === "stellar/peer-missing" || i === 3 || typeof r.transaction === "string",
    ],
  });

  it("names a case for every row, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });

  for (const row of rows) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }

  // Row 3 at build: V2's simulated envelope with two address entries for the payer, with none, and with its one entry
  // carrying sorobanCredentialsSourceAccount.
  it("row 3: build refuses an envelope without exactly one address entry for the payer", async () => {
    const withAuth = (change: (auth: unknown[]) => unknown[]) =>
      edited(V.V2.simulatedXdr, (e) => {
        const body = v1Of(e).tx.operations[0]!.body;
        if (body.type !== 24) throw new Error("not an invocation");
        body.invokeHostFunctionOp.auth = change(body.invokeHostFunctionOp.auth) as typeof body.invokeHostFunctionOp.auth;
      });
    const results = [
      await build({ simulatedXdr: withAuth((auth) => [auth[0], auth[0]]) }),
      await build({ simulatedXdr: withAuth(() => []) }),
      await build({ simulatedXdr: withAuth((auth) => [{ ...(auth[0] as object), credentials: { type: 0 } }]) }),
    ];
    for (const r of results) expect(r).toEqual(refused(V.agreedRefusals.rows[3].expect));
  });

  // The order the case texts state: a check "checked after" another answers second, so one input that fails both
  // answers the code of the check made first.
  it("each check a case states is made after another answers second when one input fails both", async () => {
    const code = (start: string) => rowsOf(rows, "x402-exact-stellar.json agreedRefusals.rows", {
      exact: 1,
      keep: [`the row whose case starts "${start}"`, (r) => r.case.startsWith(start)],
      leave: ["every other row", (r) => !r.case.startsWith(start)],
    })[0]!.expect;
    const carrier = code("build when the option's payTo is not muxed");
    const oneTransfer = code("an operation that is not one transfer");
    const asset = code("build when the operation and the signed invocation agree but call a token contract");
    const amount = code("build when the agreed transfer's amount");
    const subInvocation = simulated(V.V2.simulatedXdr, { ...agree, subInvocation: true });
    const other = V.V4build.otherAsset as string;
    const more = (A + 1n).toString();
    expect([
      await build({ accepted: { ...accepted, payTo: V.fixed.seller }, simulatedXdr: subInvocation }),
      await build({ accepted: { ...accepted, payTo: V.fixed.seller, asset: other } }),
      await build({ accepted: { ...accepted, asset: other }, simulatedXdr: subInvocation }),
      await build({ accepted: { ...accepted, asset: other, amount: more } }),
      await build({ accepted: { ...accepted, amount: more }, payer: V.V4build.otherPayer }),
    ]).toEqual([carrier, carrier, oneTransfer, asset, amount].map(refused));
  });
});
