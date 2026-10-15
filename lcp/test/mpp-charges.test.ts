// Runs the MPP charge vector files for Hedera's placement, Solana, Stellar, XRPL and NEAR Intents through the mpp entry
// point. Every expected value is a vector file's.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransactionMessage,
  createTransactionMessage,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  isSignerRole,
  isWritableRole,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  blockhash,
} from "@solana/kit";
import { decode as decodeXrpl } from "ripple-binary-codec";
import { Keypair, Networks, TransactionBuilder, xdr as stellarXdr } from "@stellar/stellar-sdk";
import { canonicalJson, toLcpString, type AtrHash, type Json } from "../src/index.js";
import { ReaderError } from "../src/evm.js";
import {
  chargeHedera,
  chargeNearIntents,
  chargeSolana,
  chargeStellar,
  chargeXrpl,
  FETCHED,
  issuedDigest,
  network,
  pairingsOf,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { MEMO_V3 } from "../src/svm.js";
import type { SvmLanded, SvmReader } from "../src/svm.js";
import type { XrplReader } from "../src/xrpl.js";
import { networkIdHeld } from "../src/internal/xrpl.js";
import { stellarLocate, type StellarReader, type StellarRef } from "../src/stellar.js";
import { exactStellar } from "../src/x402-exact-stellar.js";
import { counting } from "./fixtures/counting-reader.js";
import { resigned } from "./fixtures/xrpl-resign.js";
import { readsOnlyFetched } from "./mpp-fixtures.js";
import { rowsOf } from "./rows.js";

const load = (n: string) => JSON.parse(readFileSync(new URL(`../vectors/${n}`, import.meta.url), "utf8"));
const MC = load("mpp-challenge.json");
const HE = load("mpp-charge-hedera.json");
const SO = load("mpp-charge-solana.json");
const XS = load("x402-exact-solana.json");
const ST = load("mpp-charge-stellar.json");
const XST = load("x402-exact-stellar.json");
const XR = load("mpp-charge-xrpl.json");
const NE = load("mpp-charge-nearintents.json");
const refused = (code: string) => ({ refused: true, code });
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

function withRequest(c: MppChallenge, request: unknown): MppChallenge {
  return { ...c, request: b64u(canonicalJson(request) as string) };
}
function placedOf(V: { place: { expect: MppChallenge & { id: string } } }): MppChallenge & { id: string } {
  return V.place.expect;
}
const credential = (challenge: MppChallenge & { id: string }, payload: MppCredential["payload"]): MppCredential => ({
  challenge,
  payload,
});
const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("mpp/charge/hedera through pairingsOf and place", () => {
  const c: MppChallenge = {
    realm: HE.fixed.realm,
    method: "hedera",
    intent: "charge",
    request: b64u(canonicalJson(HE.fixed.request) as string),
    expires: HE.fixed.expires,
  };
  it("pairingsOf names the Hedera charge, and advertise places MV1 and MV3 with the request unchanged", () => {
    expect(pairingsOf(c)).toEqual(["mpp/charge/hedera"]);
    const doc = chargeHedera.advertise([c], HE.fixed.H, HE.fixed.link, c);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc[0]!.id).toBe(MC.MV3.expectId);
    expect(doc[0]!.opaque).toBe(MC.MV3.expectOpaque);
    expect(doc[0]!.request).toBe(c.request);
  });
  it("the Hedera charge's request checks apply through pairingsOf", () => {
    for (const row of rowsOf(HE.requests, "mpp-charge-hedera.json requests")) {
      expect(pairingsOf({ ...c, request: b64u(canonicalJson(row.request) as string) }), row.case).toEqual(refused(row.expect));
    }
  });
});

describe("mpp-charge-solana.json", () => {
  const V = SO;
  const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  /** V2's wire message decompiled (solders' compilation), with `data` in place of its first instructions' data, compiled by
   * @solana/kit: the message build writes, in @solana/kit's order. */
  const kitMessage = (data: readonly string[] = []) => {
    const wire = Buffer.from(V.V2.wireBase64 as string, "base64");
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(wire.subarray(1 + 64 * wire[0]!)));
    type Ix = (typeof m.instructions)[number];
    const instructions = (m.instructions as readonly Ix[]).map((ix, i) => (i < data.length ? { ...ix, data: fromHex(data[i]!) } : ix));
    return sha256(Uint8Array.from(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage({ ...m, instructions } as typeof m))));
  };
  const H: AtrHash = V.fixed.H;
  const placed = placedOf(V);

  it("pairingsOf, and advertise places id, opaque and externalId", () => {
    expect(pairingsOf(V.challenge)).toEqual(["mpp/charge/solana"]);
    expect(chargeSolana.advertise([V.challenge], H, V.fixed.link, V.challenge)).toEqual([V.place.expect]);
    const occupied = withRequest(V.challenge, V.occupied.request);
    expect(chargeSolana.advertise([occupied], H, V.fixed.link, occupied)).toEqual(refused(V.occupied.expect));
    const r = chargeSolana.read([placed]);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
  });

  it("unplaced gives the challenge as issued: its request without externalId", async () => {
    const issued = chargeSolana.unplaced(placed) as MppChallenge;
    expect(issued).toEqual({ ...placed, request: V.challenge.request });
    expect(await issuedDigest(issued)).toBe(await issuedDigest(V.challenge));
  });

  it("V2: bound and reference of the vector's wire", async () => {
    const cr = credential(placed, { type: "transaction", transaction: V.V2.wireBase64 });
    expect(await chargeSolana.bound(cr)).toBe(V.V2.expectBound);
    const ref = await chargeSolana.reference(cr);
    expect(ref).toEqual(V.V2.expectReference);
    expect(roundTrip(ref)).toEqual(ref);
  });

  it("defaultComputeBudget: build without a compute unit limit or price writes the default prefix, the message byte for byte as @solana/kit compiles it", async () => {
    const u = await chargeSolana.build({ challenge: placed, payer: V.fixed.payer }, H);
    if ("refused" in u) throw new Error(u.code);
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(u.request.message));
    type Ix = { programAddress: string; accounts?: readonly unknown[]; data?: Uint8Array };
    const got = (m.instructions as readonly Ix[]).slice(0, 2).map((ix) => ({
      program: ix.programAddress,
      accounts: ix.accounts ?? [],
      data: hex(ix.data ?? new Uint8Array()),
    }));
    expect(got).toEqual(V.defaultComputeBudget.instructions);
    const prefix = (V.defaultComputeBudget.instructions as { data: string }[]).map((ix) => ix.data);
    expect(kitMessage(prefix)).toBe(V.defaultComputeBudget.buildMessageSha256);
    expect(sha256(u.request.message)).toBe(V.defaultComputeBudget.buildMessageSha256);
  });

  it("build gives V1's message, byte for byte as @solana/kit compiles it; the payer's signature completes a credential that is bound", async () => {
    const u = await chargeSolana.build(
      {
        challenge: placed,
        payer: V.fixed.payer,
        computeUnitLimit: V.build.computeUnitLimit,
        computeUnitPrice: BigInt(V.build.computeUnitPrice),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(u.request.message));
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
    expect(m.feePayer.address).toBe(XS.V1.feePayer);
    expect(got).toEqual(XS.V1.instructions);
    expect(kitMessage()).toBe(V.build.buildMessageSha256);
    expect(sha256(u.request.message)).toBe(V.build.buildMessageSha256);
    const sig = ed25519.sign(u.request.message, fromHex(XS.fixed.payerSeed));
    const cr = u.complete(sig);
    if ("refused" in cr) throw new Error(cr.code);
    expect(await chargeSolana.bound(cr)).toBe(H);
    // The wire complete writes is held byte for byte to buildWireSha256, the Solana transaction format written by hand
    // in Python. The message and payer are x402-exact-solana.json V1's, whose test writes the same wire again from
    // @solana/kit's message, so the two values are one.
    expect(V.build.buildWireSha256).toBe(XS.V1.buildWireSha256);
    expect(sha256(Uint8Array.from(Buffer.from(cr.payload["transaction"] as string, "base64")))).toBe(V.build.buildWireSha256);
  });

  // sol's request names currency "sol": build writes a System Program transfer of the amount in lamports where a token
  // request has its TransferChecked. sol.expectMessageBase64 is the message written by hand from the Solana message
  // format, with no Solana library (sol's case), and build's message is held to it byte for byte.
  it("sol: build on a native SOL request gives the System transfer message written by hand from the message format, byte for byte", async () => {
    const challenge = withRequest(V.challenge, V.sol.request);
    const solPlaced = chargeSolana.advertise([challenge], H, V.fixed.link, challenge);
    if (!Array.isArray(solPlaced)) throw new Error(solPlaced.code);
    const u = await chargeSolana.build(
      {
        challenge: solPlaced[0] as MppChallenge & { id: string },
        payer: V.fixed.payer,
        computeUnitLimit: V.build.computeUnitLimit,
        computeUnitPrice: BigInt(V.build.computeUnitPrice),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(Buffer.from(u.request.message).toString("base64")).toBe(V.sol.expectMessageBase64);
  });

  it("refusals", async () => {
    for (const row of rowsOf(V.refusals, "mpp-charge-solana.json refusals")) {
      const challenge = row.externalId === undefined ? placed : withRequest(placed, { ...V.fixed.request, externalId: row.externalId });
      const payload = row.payload ?? { type: "transaction", transaction: row.wireBase64 };
      expect(await chargeSolana.bound(credential(challenge as never, payload)), row.case).toEqual(refused(row.expect));
    }
  });

  it("a durable message whose sysvar comes from a lookup table is bound, and reference records its nonce", async () => {
    const row = XS.durableNonce.lookupTable.rows.find((r: { expectReference?: unknown }) => r.expectReference !== undefined);
    const cr = credential(placed, { type: "transaction", transaction: row.wireBase64 });
    expect(await chargeSolana.bound(cr)).toBe(row.expectBound);
    expect(await chargeSolana.reference(cr)).toEqual(row.expectReference);
  });

  it("a split memo that is not an LCP string is not read", async () => {
    const wire = await twoMemoWire(V.fixed.L, V.split.splitMemo);
    expect(await chargeSolana.bound(credential(placed, { type: "transaction", transaction: wire }))).toBe(V.split.expectBound);
  });

  it("plant: two LCP memos are refused, never read as H", async () => {
    expect(await chargeSolana.bound(credential(placed, { type: "transaction", transaction: V.plant.wireBase64 }))).toEqual(
      refused(V.plant.expect),
    );
  });

  // The published profile's clause 6 states what a record of this pairing proves: the one memo bound is the LCP-form
  // one among the transaction's Memo instructions (clause 3), so the record says so.
  it("the record's proves is the profile's clause 6: one LCP-form Memo instruction", () => {
    const profile = readFileSync(new URL("../profiles/mpp-charge-solana.md", import.meta.url), "utf8");
    const clause = /^6\. What a record of this pairing proves: (.+)$/m.exec(profile)?.[1];
    if (clause === undefined) throw new Error("the profile has no clause 6");
    expect(chargeSolana.pattern.proves).toBe(clause[0]!.toUpperCase() + clause.slice(1));
    expect(chargeSolana.pattern.proves).toContain("whose one LCP-form Memo instruction carries this ATR's hash");
  });

  it("push: fetchPresented reads the landed wire, then bound and reference; recover", async () => {
    const landed: SvmLanded = {
      wire: Uint8Array.from(Buffer.from(V.push.landedWireBase64, "base64")),
      err: null,
      loaded: { writable: [], readonly: [] },
      inner: [],
    };
    const reader: SvmReader = {
      network: V.push.network,
      transaction: async (sig) => (sig === V.push.txid ? landed : { notFound: true as const, slot: null }),
      signatures: async () => [],
      blockhashValid: async () => ({ valid: true, slot: 0n }),
      firstAvailableBlock: async () => 0n,
      account: async () => {
        throw new Error("this reference names no nonce account");
      },
    };
    const cr = credential(placed, { type: "signature", signature: V.push.txid });
    const fetched = await chargeSolana.fetchPresented(cr, reader);
    if ("refused" in fetched) throw new Error(fetched.code);
    expect(await chargeSolana.bound(fetched)).toBe(V.push.expectBound);
    const ref = await chargeSolana.reference(fetched);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.transaction).toBe(V.push.expectReferenceTransaction);
    const failing: SvmReader = { ...reader, transaction: async () => { throw new ReaderError("transport"); } };
    expect(await chargeSolana.fetchPresented(cr, failing)).toEqual(refused("svm/unreadable"));
    // SvmReader.transaction answers a landed transaction, or notFound with the node's slot; a bare null is neither.
    const answering = (a: unknown): SvmReader => ({ ...reader, transaction: async () => a as never });
    const named = { network: V.push.network, transaction: V.push.txid };
    expect(await chargeSolana.fetchPresented(cr, answering({ notFound: true, slot: 1150n }))).toEqual(refused("svm/not-found"));
    expect(await chargeSolana.recover(named, answering({ notFound: true, slot: null }))).toEqual(refused("svm/not-found"));
    expect(await chargeSolana.fetchPresented(cr, answering(null))).toEqual(refused("svm/unreadable"));
    expect(await chargeSolana.recover(named, answering(null))).toEqual(refused("svm/unreadable"));
    // A wire one byte short of the landed one does not decode: a transaction the chain executed is a well-formed one
    // within Solana's 1232-byte packet (PACKET_DATA_SIZE), so a landed wire that does not decode is the reader's.
    const short = { ...landed, wire: landed.wire.subarray(0, landed.wire.length - 1) };
    expect(await chargeSolana.recover(named, answering(short))).toEqual(refused("svm/unreadable"));
    expect(await chargeSolana.recover({ network: V.push.network, transaction: V.push.txid }, reader)).toBe(V.recover.expect);
  });

  // The landed wire is read only from the member FETCHED keys, which fetchPresented writes and no wire form carries: a
  // signature credential the buyer sends with a payload transaction, the wire that would bind H, is svm/read-first, as
  // it is without one (refusals' last row), and one held with both is read by its FETCHED member alone.
  it("push: the landed wire is read only from fetchPresented's FETCHED member, never from a payload transaction", async () => {
    const landed: SvmLanded = {
      wire: Uint8Array.from(Buffer.from(V.push.landedWireBase64, "base64")),
      err: null,
      loaded: { writable: [], readonly: [] },
      inner: [],
    };
    const reader = {
      network: V.push.network,
      transaction: async (sig: string) => (sig === V.push.txid ? landed : { notFound: true as const, slot: null }),
    } as unknown as SvmReader;
    const sent = credential(placed, { type: "signature", signature: V.push.txid });
    const fetched = await chargeSolana.fetchPresented(sent, reader);
    const carrying = (wire: string) => (c: unknown) => ({ ...(c as MppCredential), payload: { ...(c as MppCredential).payload, transaction: wire } });
    await readsOnlyFetched(chargeSolana, sent, fetched, V.push.expectBound, carrying(V.push.landedWireBase64), carrying(V.plant.wireBase64), "svm/read-first");
    const row = V.refusals[V.refusals.length - 1];
    expect(row.payload).toEqual({ ...sent.payload, transaction: V.push.landedWireBase64 });
  });

  it("push: fetchPresented and recover refuse a landed transaction that carries an error at finalized", async () => {
    const row = V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === "svm/err");
    const landed: SvmLanded = {
      wire: Uint8Array.from(Buffer.from(V.push.landedWireBase64, "base64")),
      err: row.err,
      loaded: { writable: [], readonly: [] },
      inner: [],
    };
    const reader: SvmReader = {
      network: V.push.network,
      transaction: async (sig) => (sig === V.push.txid ? landed : { notFound: true as const, slot: null }),
      signatures: async () => [],
      blockhashValid: async () => ({ valid: true, slot: 0n }),
      firstAvailableBlock: async () => 0n,
      account: async () => {
        throw new Error("a push credential's read makes no account read");
      },
    };
    const cr = credential(placed, { type: "signature", signature: V.push.txid });
    expect(await chargeSolana.fetchPresented(cr, reader)).toEqual(refused(row.expect));
    expect(await chargeSolana.recover({ network: V.push.network, transaction: V.push.txid }, reader)).toEqual(refused(row.expect));
  });
});

/** A v0 transfer message signed by the vector's payer seed, with two Memo instructions: `first`, then `second`. */
async function twoMemoWire(first: string, second: string): Promise<string> {
  const f = XS.fixed;
  const i = XS.V1.instructions as { program: string; accounts: { address: string; signer: boolean; writable: boolean }[]; data: string }[];
  const role = (a: { signer: boolean; writable: boolean }) =>
    a.signer ? (a.writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER) : a.writable ? AccountRole.WRITABLE : AccountRole.READONLY;
  const ixs = i.slice(0, 3).map((x) => ({
    programAddress: address(x.program),
    accounts: x.accounts.map((a) => ({ address: address(a.address), role: role(a) })),
    data: fromHex(x.data),
  }));
  const memo = (s: string) => ({ programAddress: address(MEMO_V3), data: new TextEncoder().encode(s) });
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(f.feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(f.blockhash), lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions([...ixs, memo(first), memo(second)], m),
  );
  const bytes = new Uint8Array(getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(message)));
  const required = bytes[1]!;
  const wire = new Uint8Array(1 + 64 * required + bytes.length);
  wire[0] = required;
  wire.set(ed25519.sign(bytes, fromHex(f.payerSeed)), 1 + 64);
  wire.set(bytes, 1 + 64 * required);
  return Buffer.from(wire).toString("base64");
}

describe("mpp-charge-stellar.json", () => {
  const V = ST;
  const H: AtrHash = V.fixed.H;
  const placed = placedOf(V);

  it("pairingsOf, and advertise places id, opaque and the muxed recipient", () => {
    expect(pairingsOf(V.challenge)).toEqual(["mpp/charge/stellar"]);
    expect(chargeStellar.advertise([V.challenge], H, V.fixed.link, V.challenge)).toEqual([V.place.expect]);
    const occupied = withRequest(V.challenge, V.occupied.request);
    expect(chargeStellar.advertise([occupied], H, V.fixed.link, occupied)).toEqual(refused(V.occupied.expect));
  });

  it("V3: bound and reference of the vector's envelope", async () => {
    const cr = credential(placed, { type: "transaction", transaction: V.V3.envelope });
    expect(await chargeStellar.bound(cr)).toBe(V.V3.expectBound);
    const ref = await chargeStellar.reference(cr);
    expect(ref).toEqual(V.V3.expectReference);
    expect(roundTrip(ref)).toEqual(ref);
  });

  it("issuedDigest keeps recipient's base account, so an echo naming another account gives another digest", async () => {
    const D = V.issuedDigest;
    expect(await issuedDigest(V.challenge)).toBe(D.expectIssued);
    expect(await issuedDigest(placed)).toBe(D.expectIssued);
    const issued = chargeStellar.unplaced(placed) as MppChallenge;
    expect(await issuedDigest(issued)).toBe(D.expectIssued);
    expect(issued).toEqual({ ...placed, request: V.challenge.request });
    expect(JSON.parse(Buffer.from(D.echoedRequest, "base64url").toString("utf8")).recipient).toBe(D.payerMuxed);
    const echoed = { ...placed, request: D.echoedRequest };
    expect(await issuedDigest(echoed)).toBe(D.expectEchoed);
    expect(await issuedDigest(chargeStellar.unplaced(echoed) as MppChallenge)).toBe(D.expectEchoed);
  });

  it("refusals, and fetchPresented of a hash credential", async () => {
    expect(await chargeStellar.bound(credential(V.sourceAccount.challenge, V.refusals[0].payload))).toEqual(refused(V.refusals[0].expect));
    const other = { ...placed, id: "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU.0" };
    const otherOpaque = b64u(
      canonicalJson({ legalContext: `lcp:sha256:${V.fixed.H2}`, legalContextUrl: V.fixed.link }) as string,
    );
    expect(
      await chargeStellar.bound(credential({ ...other, opaque: otherOpaque }, { type: "transaction", transaction: V.V3.envelope })),
    ).toEqual(refused(V.refusals[1].expect));
    const reader: StellarReader = {
      network: "stellar:testnet",
      transaction: async () => ({ status: "SUCCESS", envelopeXdr: V.V3.envelope, ledger: 990, oldestLedger: 1 }),
      transfers: async () => ({ events: [], complete: true, oldestLedger: 1, latestLedger: 1000 }),
      latestLedger: async () => 1000,
    } as StellarReader;
    // Pushed under the sourceAccount section's challenge: the place section's with feePayer false.
    const fetched = await chargeStellar.fetchPresented(credential(V.sourceAccount.challenge, V.refusals[0].payload), reader);
    if ("refused" in fetched) throw new Error(fetched.code);
    expect(await chargeStellar.bound(fetched)).toBe(H);
    const ref = await chargeStellar.reference(fetched);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.transaction).toBe(V.refusals[0].payload.hash);
  });

  // The landed envelope is read only from the member FETCHED keys, which fetchPresented writes and no wire form carries:
  // a hash credential the buyer sends with a payload transaction, the envelope that would bind H, is stellar/read-first,
  // as it is without one (refusals[2]), and one held with both is read by its FETCHED member alone.
  it("the landed envelope is read only from fetchPresented's FETCHED member, never from a hash credential's transaction", async () => {
    const reader = {
      network: "stellar:testnet",
      transaction: async () => ({ status: "SUCCESS", envelopeXdr: V.V3.envelope, ledger: 990, oldestLedger: 1 }),
    } as unknown as StellarReader;
    const sent = credential(V.sourceAccount.challenge, V.refusals[0].payload);
    const fetched = await chargeStellar.fetchPresented(sent, reader);
    const carrying = (xdr: string) => (c: unknown) => ({ ...(c as MppCredential), payload: { ...(c as MppCredential).payload, transaction: xdr } });
    const other = V.sourceAccount.refusals[2].envelope as string;
    await readsOnlyFetched(chargeStellar, sent, fetched, H, carrying(V.V3.envelope), carrying(other), "stellar/read-first");
    const row = V.refusals[2];
    expect(row.payload).toEqual({ ...V.refusals[0].payload, transaction: V.V3.envelope });
    expect(await chargeStellar.bound(credential(V.sourceAccount.challenge, row.payload))).toEqual(refused(row.expect));
    expect(await chargeStellar.reference(credential(V.sourceAccount.challenge, row.payload))).toEqual(refused(row.expect));
  });

  // "Push mode MUST NOT be used when `feePayer` is `true` in the challenge request. [...] Servers MUST reject
  // `type="hash"` credentials when the challenge specifies `feePayer: true`." (draft-stellar-charge-00 L364-367.) The
  // place section's challenge sets feePayer true; the sourceAccount section's is the same challenge with it false.
  it("push under feePayer true: fetchPresented, bound and reference refuse the hash credential mpp/credential-type", async () => {
    let reads = 0;
    const reader: StellarReader = {
      network: "stellar:testnet",
      transaction: async () => {
        reads++;
        return { status: "SUCCESS", envelopeXdr: V.V3.envelope, ledger: 990, oldestLedger: 1 };
      },
      transfers: async () => ({ events: [], complete: true, oldestLedger: 1, latestLedger: 1000 }),
      latestLedger: async () => 1000,
    };
    expect(await chargeStellar.fetchPresented(credential(placed, V.refusals[0].payload), reader)).toEqual(refused("mpp/credential-type"));
    expect(reads).toBe(0);
    const sponsored = credential(placed, { ...V.refusals[0].payload, transaction: V.V3.envelope });
    expect(await chargeStellar.bound(credential(placed, V.refusals[0].payload))).toEqual(refused("mpp/credential-type"));
    expect(await chargeStellar.bound(sponsored)).toEqual(refused("mpp/credential-type"));
    expect(await chargeStellar.reference(sponsored)).toEqual(refused("mpp/credential-type"));
    const pushed = await chargeStellar.fetchPresented(credential(V.sourceAccount.challenge, V.refusals[0].payload), reader);
    if ("refused" in pushed) throw new Error(pushed.code);
    expect(await chargeStellar.bound(pushed)).toBe(H);
    // The sponsored flow's own credential, a transaction the server submits, binds H under feePayer true.
    expect(await chargeStellar.bound(credential(placed, { type: "transaction", transaction: V.V3.envelope }))).toBe(H);
  });

  it("push: a landed transaction carrying another entry of the payer binds H by the entry it used (x402-exact-stellar.json V5's two-entry row)", async () => {
    const row = XST.V5.rows.find((r: { case: string }) => r.case.startsWith("the named transaction succeeded carrying two entries"));
    const reader: StellarReader = {
      network: "stellar:testnet",
      transaction: async () => ({ status: "SUCCESS", envelopeXdr: row.envelope, ledger: 990, oldestLedger: 1 }),
      transfers: async () => ({ events: [], complete: true, oldestLedger: 1, latestLedger: 995 }),
      latestLedger: async () => 995,
    };
    const fetched = await chargeStellar.fetchPresented(credential(V.sourceAccount.challenge, V.refusals[0].payload), reader);
    if ("refused" in fetched) throw new Error(fetched.code);
    expect(await chargeStellar.bound(fetched)).toBe(H);
    const ref = await chargeStellar.reference(fetched);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.authDigest).toBe(XST.V3.expectReference.authDigest);
    expect(await chargeStellar.status({ ...ref, transaction: ref.transaction! }, reader)).toEqual(row.expect);
    const pull = credential(placed, { type: "transaction", transaction: row.envelope });
    expect(await chargeStellar.bound(pull)).toEqual(refused(XST.agreedRefusals.rows[3].expect));
  });

  describe("sourceAccount: push where the payer is the transaction's source account", () => {
    const S = V.sourceAccount;
    const challengeOf = (name: string) => (name === "place" ? placed : S.challenge);
    /** A reader answering getTransaction for `hash` with `answer`, NOT_FOUND for any other hash, and `latest`. */
    const readerOf = (hash: string, answer: { status: string; envelope?: string; ledger?: number }, latest = 2000): StellarReader => ({
      network: "stellar:testnet",
      transaction: async (h) =>
        h === hash
          ? {
              status: answer.status as "SUCCESS",
              ...(answer.envelope !== undefined ? { envelopeXdr: answer.envelope } : {}),
              ...(answer.ledger !== undefined ? { ledger: answer.ledger } : {}),
              oldestLedger: 1,
            }
          : { status: "NOT_FOUND", oldestLedger: 1 },
      transfers: async () => ({ events: [], complete: true, oldestLedger: 1, latestLedger: latest }),
      latestLedger: async () => latest,
    });

    it("@stellar/stellar-sdk 17.2.1 writes each envelope from V3's as its write says, and the challenge is the place section's with feePayer false", () => {
      type Write = { source: string; operationSource?: string; subInvocation?: boolean };
      const key = (b: string) => Keypair.fromRawEd25519Seed(Buffer.from(b.repeat(32), "hex"));
      const write = (w: Write) => {
        const env = stellarXdr.TransactionEnvelope.fromXdr(XST.V3.envelope, "base64").toXdrObject();
        if (env.type !== 2 || env.v1.tx.operations[0]!.body.type !== 24) throw new Error("not an invocation");
        env.v1.tx.sourceAccount = { type: 0, ed25519: Uint8Array.from(key(w.source).rawPublicKey()) };
        const op = env.v1.tx.operations[0]!;
        if (w.operationSource !== undefined) op.sourceAccount = { type: 0, ed25519: Uint8Array.from(key(w.operationSource).rawPublicKey()) };
        if (op.body.type !== 24) throw new Error("not an invocation");
        const auth = op.body.invokeHostFunctionOp.auth;
        const root = auth[0]!.rootInvocation;
        const subInvocations = w.subInvocation === true ? [{ function: root.function, subInvocations: [] }] : [];
        auth[0] = { credentials: { type: 0 }, rootInvocation: { function: root.function, subInvocations } };
        const tx = TransactionBuilder.fromXDR(stellarXdr.TransactionEnvelope.fromXdrObject(env).toXdr("base64"), Networks.TESTNET);
        for (const b of new Set([w.source, ...(w.operationSource !== undefined ? [w.operationSource] : [])])) tx.sign(key(b));
        return { envelope: tx.toEnvelope().toXDR("base64"), hash: Buffer.from(tx.hash()).toString("hex") };
      };
      expect(S.write.source).toBe(XST.fixed.payerSeed.slice(0, 2));
      const written = [S, ...rowsOf(S.refusals, "mpp-charge-stellar.json sourceAccount.refusals", {
        exact: 3,
        keep: ["the rows that write their own envelope", (r) => r.write !== undefined],
        leave: [
          "the rows that present the section's own envelope, which the refusals test below runs",
          (r) => r.envelope === undefined,
        ],
      })];
      expect(written.length).toBe(4);
      for (const w of written) expect(write(w.write), w.case).toEqual({ envelope: w.envelope, hash: w.hash });
      const request = (c: MppChallenge) => JSON.parse(Buffer.from(c.request, "base64url").toString("utf8"));
      const { request: _r, ...rest } = S.challenge;
      expect({ ...placed, ...rest }).toEqual(placed);
      expect(request(S.challenge)).toEqual({ ...request(placed), methodDetails: { ...request(placed).methodDetails, feePayer: false } });
    });

    it("bound gives H; reference records the transaction, with no authDigest or expiration; status reads it", async () => {
      const reader = readerOf(S.hash, { status: "SUCCESS", envelope: S.envelope, ledger: 990 });
      const fetched = await chargeStellar.fetchPresented(credential(S.challenge, { type: "hash", hash: S.hash }), reader);
      if ("refused" in fetched) throw new Error(fetched.code);
      expect(await chargeStellar.bound(fetched)).toBe(S.expectBound);
      const ref = await chargeStellar.reference(fetched);
      expect(ref).toEqual(S.expectReference);
      expect(roundTrip(ref)).toEqual(ref);
      const named = S.expectReference as StellarRef & { transaction: string };
      for (const row of rowsOf(S.status, "mpp-charge-stellar.json sourceAccount.status")) {
        const envelope = row.envelope === "V3" ? XST.V3.envelope : S.envelope;
        const answer = { status: row.status, ...(row.status === "SUCCESS" ? { envelope, ledger: row.ledger } : {}) };
        expect(await chargeStellar.status(named, readerOf(S.hash, answer)), row.case).toEqual(row.expect);
      }
      const sourceLanded = { status: "SUCCESS", envelope: S.envelope, ledger: 990 };
      const listing: StellarReader = {
        ...readerOf(S.hash, sourceLanded),
        transfers: async () => ({
          events: [{ txHash: S.hash, toMuxedId: BigInt(named.toId) }],
          complete: true,
          oldestLedger: 0,
          latestLedger: 995,
        }),
      };
      expect(await stellarLocate(named, listing)).toEqual(S.expectLocate);
      expect(await chargeStellar.status(XST.V5.ref, readerOf(XST.V5.ref.transaction, sourceLanded, 995))).toEqual({
        state: "pending",
        why: "not-this-instrument",
      });
    });

    it("refusals: the sponsored flow, a transaction credential, another source account, a sub-invocation, a malformed hash, and x402", async () => {
      for (const row of rowsOf(S.refusals, "mpp-charge-stellar.json sourceAccount.refusals")) {
        const challenge = challengeOf(row.challenge);
        const envelope: string = row.envelope ?? S.envelope;
        const hash: string = row.hash ?? S.hash;
        let presented: MppCredential = credential(challenge, { type: "transaction", transaction: envelope });
        if (row.type === "hash" && row.carriesTransaction === true) {
          presented = { ...credential(challenge, { type: "hash", hash }), [FETCHED]: { transaction: envelope } } as MppCredential;
          const reader = readerOf(hash, { status: "SUCCESS", envelope, ledger: 990 });
          expect(await chargeStellar.fetchPresented(credential(challenge, { type: "hash", hash }), reader), row.case).toEqual(refused(row.expect));
        } else if (row.type === "hash") {
          const fetched = await chargeStellar.fetchPresented(
            credential(challenge, { type: "hash", hash }),
            readerOf(hash, { status: "SUCCESS", envelope, ledger: 990 }),
          );
          if ("refused" in fetched) throw new Error(fetched.code);
          presented = fetched;
        }
        expect(await chargeStellar.bound(presented), row.case).toEqual(refused(row.expect));
        expect(await chargeStellar.reference(presented), row.case).toEqual(refused(row.expect));
      }
      const x402 = { x402Version: 2, accepted: XST.V3.accepted, payload: { transaction: S.envelope }, extensions: XST.V3.extensions };
      expect(await exactStellar.bound(x402)).toEqual(refused(XST.agreedRefusals.rows[3].expect));
    });

    // The code advertise gives the same request (pairingsOf): an MPP Stellar charge's feePayer is absent or a boolean.
    it("a feePayer that is present and not a boolean is stellar/option-malformed, as advertise gives it", async () => {
      const reader = readerOf(S.hash, { status: "SUCCESS", envelope: S.envelope, ledger: 990 });
      for (const feePayer of ["true", 0, null]) {
        const request = JSON.parse(Buffer.from(S.challenge.request, "base64url").toString("utf8"));
        request.methodDetails.feePayer = feePayer;
        const challenge = { ...S.challenge, request: Buffer.from(canonicalJson(request) as string, "utf8").toString("base64url") };
        const { id: _id, opaque: _opaque, ...offer } = challenge;
        expect(pairingsOf(offer), JSON.stringify(feePayer)).toEqual(refused("stellar/option-malformed"));
        const presented = credential(challenge, { type: "hash", hash: S.hash });
        expect(await chargeStellar.fetchPresented(presented, reader), JSON.stringify(feePayer)).toEqual(refused("stellar/option-malformed"));
        expect(await chargeStellar.bound(presented), JSON.stringify(feePayer)).toEqual(refused("stellar/option-malformed"));
        expect(await chargeStellar.reference(presented), JSON.stringify(feePayer)).toEqual(refused("stellar/option-malformed"));
      }
    });
  });

  it("push: fetchPresented refuses a transaction the reader reports FAILED", async () => {
    const row = V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === "stellar/tx-failed");
    const reader: StellarReader = {
      network: "stellar:testnet",
      transaction: async () => ({ status: "FAILED", envelopeXdr: V.V3.envelope, ledger: 990, oldestLedger: 1 }),
      transfers: async () => ({ events: [], complete: true, oldestLedger: 1, latestLedger: 1000 }),
      latestLedger: async () => 1000,
    } as StellarReader;
    expect(await chargeStellar.fetchPresented(credential(V.sourceAccount.challenge, V.refusals[0].payload), reader)).toEqual(refused(row.expect));
  });

  it("bound and build read the invocation the payer's entry signs (x402-exact-stellar.json's V4 and V4build rows)", async () => {
    const signedRows = rowsOf(XST.V4, "x402-exact-stellar.json V4", {
      exact: 5,
      keep: ["the rows that name the invocation the payer's entry signs", (r) => r.case.includes("the payer's entry signs")],
      leave: [
        "the other rows, x402 refusals that stellar.test.ts's V4 test runs through the x402 pairing",
        (r) => !r.case.includes("the payer's entry signs"),
      ],
    });
    expect(signedRows.length).toBe(5);
    for (const row of signedRows) {
      const got = await chargeStellar.bound(credential(placed, { type: "transaction", transaction: row.envelope }));
      expect(got, row.case).toEqual(refused(row.expect));
    }
    const now = Date.parse(V.fixed.expires) / 1000 - 60;
    const payer: string = XST.fixed.payer;
    const agreeing = await chargeStellar.build({ challenge: placed, simulatedXdr: XST.V2.simulatedXdr, currentLedger: 988, now, payer }, H);
    if ("refused" in agreeing) throw new Error(agreeing.code);
    // build compiles x402-exact-stellar.json V2's authorization preimage (expiration 988 + 60 / 5 = 1000), and complete
    // writes V3's envelope, that file's V2.expectEnvelope: stellar-sdk 13.0.0's values.
    expect(agreeing.request.preimage.length).toBe(XST.V2.expectPreimageLength);
    const preimageDigest = createHash("sha256").update(agreeing.request.preimage).digest();
    expect(preimageDigest.toString("hex")).toBe(XST.V2.expectPreimageSha256);
    expect(V.V3.envelope).toBe(XST.V2.expectEnvelope);
    expect(agreeing.complete(ed25519.sign(preimageDigest, fromHex(XST.fixed.payerSeed)))).toStrictEqual({
      challenge: placed,
      payload: { type: "transaction", transaction: V.V3.envelope },
    });
    for (const row of rowsOf(XST.V4build.rows, "x402-exact-stellar.json V4build.rows")) {
      const u = await chargeStellar.build({ challenge: placed, simulatedXdr: row.simulatedXdr, currentLedger: 988, now, payer }, H);
      expect(u, row.case).toEqual(refused(row.expect));
    }
  });

  // V3source's simulation has the payer as its transaction source, not the all-zeros account. The vector's values are
  // written by hand from the XDR layout; @stellar/stellar-sdk's XDR re-derives them here by setting tx.sourceAccount of
  // V2's simulation and of V3's envelope.
  it("V3source: complete sets the all-zeros source when feePayer is true, and keeps the simulated source when it is false", async () => {
    const payerKey = Keypair.fromPublicKey(XST.fixed.payer).rawPublicKey();
    const sourced = (b64: string) => {
      const env = stellarXdr.TransactionEnvelope.fromXdr(b64, "base64").toXdrObject();
      if (env.type !== 2) throw new Error("not a v1 envelope");
      env.v1.tx.sourceAccount = { type: 0, ed25519: Uint8Array.from(payerKey) };
      return stellarXdr.TransactionEnvelope.fromXdrObject(env).toXdr("base64");
    };
    expect(sourced(XST.V2.simulatedXdr)).toBe(V.V3source.simulatedXdr);
    expect(sourced(V.V3.envelope)).toBe(V.V3source.expectEnvelopeFeePayerFalse);
    const now = Date.parse(V.fixed.expires) / 1000 - 60;
    const modes = [
      [placed, V.V3.envelope],
      [V.sourceAccount.challenge, V.V3source.expectEnvelopeFeePayerFalse],
    ] as const;
    for (const [challenge, envelope] of modes) {
      const u = await chargeStellar.build({ challenge, simulatedXdr: V.V3source.simulatedXdr, currentLedger: 988, now, payer: XST.fixed.payer }, H);
      if ("refused" in u) throw new Error(u.code);
      const digest = createHash("sha256").update(u.request.preimage).digest();
      expect(digest.toString("hex")).toBe(XST.V2.expectPreimageSha256);
      expect(u.complete(ed25519.sign(digest, fromHex(XST.fixed.payerSeed)))).toStrictEqual({ challenge, payload: { type: "transaction", transaction: envelope } });
    }
  });

  it("plant: a transfer to the plain seller account is refused, never H", async () => {
    expect(await chargeStellar.bound(credential(placed, { type: "transaction", transaction: V.plant.envelope }))).toEqual(
      refused(V.plant.expect),
    );
  });
});

describe("mpp-charge-xrpl.json", () => {
  const V = XR;
  const H: AtrHash = V.fixed.H;
  const placed = placedOf(V);

  it("pairingsOf, and advertise places id, opaque and methodDetails.invoiceId", () => {
    expect(pairingsOf(V.challenge)).toEqual(["mpp/charge/xrpl"]);
    expect(chargeXrpl.advertise([V.challenge], H, V.fixed.link, V.challenge)).toEqual([V.place.expect]);
    const occupied = withRequest(V.challenge, V.occupied.request);
    expect(chargeXrpl.advertise([occupied], H, V.fixed.link, occupied)).toEqual(refused(V.occupied.expect));
    const noNetwork = withRequest(V.challenge, { ...V.fixed.request, methodDetails: {} });
    expect(pairingsOf(noNetwork)).toEqual(refused(V.refusals[2].expect));
  });

  it("unplaced gives the challenge as issued: its request without methodDetails.invoiceId", async () => {
    const issued = chargeXrpl.unplaced(placed) as MppChallenge;
    expect(issued).toEqual({ ...placed, request: V.challenge.request });
    expect(await issuedDigest(issued)).toBe(await issuedDigest(V.challenge));
  });

  it("V3: bound and reference of the vector's MPP blob; V4: the x402 blob is refused", async () => {
    const cr = credential(placed, { type: "transaction", blob: V.V3.blob });
    expect(await chargeXrpl.bound(cr)).toBe(V.V3.expectBound);
    const ref = await chargeXrpl.reference(cr);
    expect(ref).toEqual(V.V3.expectReference);
    expect(roundTrip(ref)).toEqual(ref);
    expect(await chargeXrpl.bound(credential(placed, { type: "transaction", blob: V.V4.blob }))).toEqual(refused(V.V4.expect));
  });

  it("build gives V3's decoded fields other than the signature", async () => {
    const u = await chargeXrpl.build(
      { challenge: placed, account: V.fixed.account, fee: V.build.fee, sequence: V.build.sequence, lastLedgerSequence: V.build.lastLedgerSequence },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    const decoded = decodeXrpl(V.V3.blob) as Record<string, unknown>;
    delete decoded["SigningPubKey"];
    delete decoded["TxnSignature"];
    expect(u.request.txJson).toEqual(decoded);
    const cr = await u.complete(V.V3.blob);
    if ("refused" in cr) throw new Error(cr.code);
    expect(await chargeXrpl.bound(cr)).toBe(H);
    const memos = withRequest(placed, { ...V.fixed.request, methodDetails: { network: "testnet", invoiceId: V.fixed.invoiceId, memos: [] } });
    expect(await chargeXrpl.build({ challenge: memos as never, account: V.fixed.account, fee: "12", sequence: 7, lastLedgerSequence: 1000 }, H)).toEqual(
      refused(V.refusals[1].expect),
    );
  });

  // An issued currency's Amount and SendMax are its {currency, issuer, value} amount, and the request's tags ride as
  // DestinationTag and SourceTag; an MPT's Amount is its {mpt_issuance_id, value} amount, with no SendMax. Each
  // expectTxJson is written by hand from xrpl.org's Payment fields (the rows' cases), and build's txJson is held to it.
  it("build.issued and build.mpt: an issued currency's SendMax and tags, and an MPT's amount, as written by hand", async () => {
    for (const row of [V.build.issued, V.build.mpt]) {
      const challenge = withRequest(V.challenge, row.request);
      const rowPlaced = chargeXrpl.advertise([challenge], H, V.fixed.link, challenge);
      if (!Array.isArray(rowPlaced)) throw new Error(rowPlaced.code);
      const u = await chargeXrpl.build(
        {
          challenge: rowPlaced[0] as MppChallenge & { id: string },
          account: V.fixed.account,
          fee: V.build.fee,
          sequence: V.build.sequence,
          lastLedgerSequence: V.build.lastLedgerSequence,
        },
        H,
      );
      if ("refused" in u) throw new Error(u.code);
      expect(u.request.txJson).toStrictEqual(row.expectTxJson);
    }
  });

  it("push: fetchPresented reads the blob by hash; read-first before it", async () => {
    expect(await chargeXrpl.bound(credential(placed, V.refusals[0].payload))).toEqual(refused(V.refusals[0].expect));
    const landed = { validated: true, result: "tesSUCCESS", ledgerIndex: 990, transactionType: "Payment" };
    const reader: XrplReader = {
      network: "xrpl:1",
      tx: async (h) => (h === V.V3.expectReference.transaction ? landed : { notFound: true, searchedAll: true }),
      txBlob: async (h) => (h === V.V3.expectReference.transaction ? V.V3.blob : null),
      validatedLedger: async () => 1000,
    };
    const fetched = await chargeXrpl.fetchPresented(credential(placed, V.refusals[0].payload), reader);
    if ("refused" in fetched) throw new Error(fetched.code);
    expect(await chargeXrpl.bound(fetched)).toBe(H);
  });

  // The blob read by hash is read only from the member FETCHED keys, which fetchPresented writes and no wire form
  // carries: a hash credential the buyer sends with a payload blob, the one that would bind H, is xrpl/read-first, as it
  // is without one (refusals[3]), and one held with both is read by its FETCHED member alone.
  it("push: the blob is read only from fetchPresented's FETCHED member, never from a hash credential's blob", async () => {
    const landed = { validated: true, result: "tesSUCCESS", ledgerIndex: 990, transactionType: "Payment" };
    const reader: XrplReader = {
      network: "xrpl:1",
      tx: async (h) => (h === V.V3.expectReference.transaction ? landed : { notFound: true, searchedAll: true }),
      txBlob: async (h) => (h === V.V3.expectReference.transaction ? V.V3.blob : null),
      validatedLedger: async () => 1000,
    };
    const sent = credential(placed, V.refusals[0].payload);
    const fetched = await chargeXrpl.fetchPresented(sent, reader);
    const carrying = (blob: string) => (c: unknown) => ({ ...(c as MppCredential), payload: { ...(c as MppCredential).payload, blob } });
    await readsOnlyFetched(chargeXrpl, sent, fetched, H, carrying(V.V3.blob), carrying(V.plant.blob), "xrpl/read-first");
    const row = V.refusals[3];
    expect(row.payload).toEqual({ ...V.refusals[0].payload, blob: V.V3.blob });
    expect(await chargeXrpl.bound(credential(placed, row.payload))).toEqual(refused(row.expect));
    expect(await chargeXrpl.reference(credential(placed, row.payload))).toEqual(refused(row.expect));
  });

  it("push: fetchPresented refuses a transaction not yet validated, and a validated result other than tesSUCCESS", async () => {
    const row = (code: string) => V.agreedRefusals.rows.find((r: { expect: string }) => r.expect === code);
    const readerOf = (landed: { validated: boolean; result: string }): XrplReader => ({
      network: "xrpl:1",
      tx: async () => ({ ...landed, ledgerIndex: 990, transactionType: "Payment" }),
      txBlob: async () => V.V3.blob,
      validatedLedger: async () => 1000,
    });
    const push = credential(placed, V.refusals[0].payload);
    const pending = row("xrpl/not-validated");
    expect(await chargeXrpl.fetchPresented(push, readerOf({ validated: false, result: "tesSUCCESS" }))).toEqual(
      refused(pending.expect),
    );
    const failed = row("xrpl/not-success");
    expect(await chargeXrpl.fetchPresented(push, readerOf({ validated: true, result: failed.result }))).toEqual(
      refused(failed.expect),
    );
    const missing: XrplReader = { ...readerOf({ validated: true, result: "tesSUCCESS" }), tx: async () => ({ notFound: true, searchedAll: false }) };
    expect(await chargeXrpl.fetchPresented(push, missing)).toEqual(refused("xrpl/not-found"));
  });

  // recover gives the validated tesSUCCESS Payment's InvoiceID, which MPP's charge sets to H itself. A transaction's
  // identifying hash is 64 hex digits (xrpl.org, Basic Data Types, "Hashes"), hex digits name the same bytes in
  // either case, and decodeBlob writes the hash in upper case. This reader holds V3's Payment under that upper-case
  // hash only, so recover settles on the transaction status settles on.
  it("recover looks the Payment up in upper case, as status does, and reads nothing for a malformed transaction", async () => {
    const ref = V.V3.expectReference;
    const landed = { validated: true, result: "tesSUCCESS", ledgerIndex: 990, transactionType: "Payment", invoiceId: ref.expect };
    const holding: XrplReader = {
      network: "xrpl:1",
      tx: async (h) => (h === ref.transaction ? landed : { notFound: true, searchedAll: true }),
      txBlob: async () => null,
      validatedLedger: async () => 1001,
    };
    for (const transaction of [ref.transaction, ref.transaction.toLowerCase()]) {
      expect(await chargeXrpl.status({ ...ref, fromLedger: 980, transaction }, holding)).toEqual({ state: "settled", ledgerIndex: 990 });
      expect(await chargeXrpl.recover({ network: ref.network, transaction }, holding)).toBe(V.V3.expectBound);
    }
    for (const transaction of [undefined, 7, `0x${ref.transaction}`, ref.transaction.slice(2)]) {
      const { reader, calls } = counting(holding);
      const malformed = { network: ref.network, transaction } as { network: "xrpl:1"; transaction: string };
      expect([transaction, await chargeXrpl.recover(malformed, reader)]).toEqual([transaction, refused("xrpl/wrong-reader")]);
      expect(calls).toEqual([]);
    }
  });

  it("multisigned: bound and reference refuse a blob that carries Signers", async () => {
    for (const row of rowsOf(V.multisigned.rows, "mpp-charge-xrpl.json multisigned.rows")) {
      const cr = credential(placed, { type: "transaction", blob: row.blob });
      expect(await chargeXrpl.bound(cr), row.case).toEqual(refused(row.expect));
      expect(await chargeXrpl.reference(cr), row.case).toEqual(refused(row.expect));
      expect((decodeXrpl(row.blob) as { InvoiceID: string }).InvoiceID, row.case).toBe(V.fixed.invoiceId);
    }
  });

  it("plant: a memo carrying L without InvoiceID is refused, never H", async () => {
    expect(await chargeXrpl.bound(credential(placed, { type: "transaction", blob: V.plant.blob }))).toEqual(refused(V.plant.expect));
  });

  // rippled 3.4.1's preflight0 (src/libxrpl/tx/Transactor.cpp L73-93): a network whose id is at most 1024 takes a
  // transaction without NetworkID only; one above 1024 takes one whose NetworkID is its own id only. Each network
  // MPP's XRPL methods name is at most 1024, so the pairings reach the first branch; the second is read here.
  it("networkIdHeld reads NetworkID as rippled does, on both sides of 1024", () => {
    const tx = decodeXrpl(V.V3.blob) as { TransactionType: string; Account: string };
    expect([0, 1, 1024].map((id) => networkIdHeld(tx, `xrpl:${id}`))).toEqual([true, true, true]);
    expect([0, 1, 1024, 1025].map((n) => networkIdHeld({ ...tx, NetworkID: n }, "xrpl:1"))).toEqual([false, false, false, false]);
    expect(networkIdHeld({ ...tx, NetworkID: 1024 }, "xrpl:1024")).toBe(false);
    expect(networkIdHeld(tx, "xrpl:1025")).toBe(false);
    expect(networkIdHeld({ ...tx, NetworkID: 1025 }, "xrpl:1025")).toBe(true);
    expect([1026, 21337, 1].map((n) => networkIdHeld({ ...tx, NetworkID: n }, "xrpl:1025"))).toEqual([false, false, false]);
  });
});

describe("mpp-charge-nearintents.json", () => {
  const V = NE;
  const H: AtrHash = V.fixed.H;
  const placed = placedOf(V);

  it("pairingsOf, and advertise places id, opaque and externalId", () => {
    expect(pairingsOf(V.challenge)).toEqual(["mpp/charge/nearintents"]);
    expect(chargeNearIntents.advertise([V.challenge], H, V.fixed.link, V.challenge)).toEqual([V.place.expect]);
    const occupied = withRequest(V.challenge, V.occupied.request);
    expect(chargeNearIntents.advertise([occupied], H, V.fixed.link, occupied)).toEqual(refused(V.occupied.expect));
    expect(chargeNearIntents.claims).toBe(false);
    expect(chargeNearIntents.pattern.publicProof).toBe(false);
  });

  it("unplaced gives the challenge as issued: its request without externalId", async () => {
    const issued = chargeNearIntents.unplaced(placed) as MppChallenge;
    expect(issued).toEqual({ ...placed, request: V.challenge.request });
    expect(await issuedDigest(issued)).toBe(await issuedDigest(V.challenge));
  });

  // pairingsOf reads the two request members the pairing uses: methodDetails.originNetwork, "CAIP-2 identifier of the
  // origin chain" (draft-nearintents-charge-01, Method Details), which network returns, and externalId, "string |
  // OPTIONAL" (Shared Fields), where H rides. The other members describe the seller's quote and deposit, which the
  // package does not judge, so a challenge with one of them malformed still names the pairing on its origin network.
  type Edit = (request: { [k: string]: Json }) => void;
  const edited = (edit: Edit): MppChallenge => {
    const request = structuredClone(V.fixed.request) as { [k: string]: Json };
    edit(request);
    return withRequest(V.challenge, request);
  };
  const md = (request: { [k: string]: Json }) => request["methodDetails"] as { [k: string]: Json };

  it("pairingsOf refuses an originNetwork that is not CAIP-2, or an externalId that is not a string (agreed row)", () => {
    const row = V.agreedRefusals.rows.find((r: { case: string }) => r.case.startsWith("pairingsOf with originNetwork"));
    const rows: [string, Edit][] = [
      ["originNetwork \"near\"", (r) => (md(r)["originNetwork"] = "near")],
      ["originNetwork 42161", (r) => (md(r)["originNetwork"] = 42161)],
      ["originNetwork absent", (r) => delete md(r)["originNetwork"]],
      ["externalId 5", (r) => (r["externalId"] = 5)],
    ];
    for (const [name, edit] of rows) {
      expect(pairingsOf(edited(edit)), name).toEqual(refused(row.expect));
      expect(network(edited(edit)), name).toEqual(refused(row.expect));
    }
  });

  it("pairingsOf names the pairing whatever the request's other members hold", () => {
    const rows: [string, Edit][] = [
      ["amount \"abc\"", (r) => (r["amount"] = "abc")],
      ["currency absent", (r) => delete r["currency"]],
      ["recipient of 257 characters", (r) => (r["recipient"] = "x".repeat(257))],
      ["amountOut \"abc\"", (r) => (md(r)["amountOut"] = "abc")],
      ["minAmountIn absent", (r) => delete md(r)["minAmountIn"]],
      ["destinationAsset \"\"", (r) => (md(r)["destinationAsset"] = "")],
      ["destinationRecipient 5", (r) => (md(r)["destinationRecipient"] = 5)],
      ["refundTo of 257 characters", (r) => (md(r)["refundTo"] = "x".repeat(257))],
      ["destinationNetwork \"near\"", (r) => (md(r)["destinationNetwork"] = "near")],
      ["depositMemo 5", (r) => (md(r)["depositMemo"] = 5)],
      ["credentialTypes [\"transaction\"]", (r) => (md(r)["credentialTypes"] = ["transaction"])],
    ];
    for (const [name, edit] of rows) {
      expect(pairingsOf(edited(edit)), name).toEqual(["mpp/charge/nearintents"]);
      expect(network(edited(edit)), name).toBe(V.fixed.request.methodDetails.originNetwork);
    }
  });

  it("bound of a hash credential gives H", async () => {
    expect(await chargeNearIntents.bound(credential(placed, V.bound.payload))).toBe(V.bound.expect);
  });

  it("plant: a transaction credential is refused, never H", async () => {
    expect(await chargeNearIntents.bound(credential(placed, V.plant.payload))).toEqual(refused(V.plant.expect));
  });
});

// The agreedRefusals rows of the four files above: a case for each row, keyed by its text, gives every call the row
// names, with inputs from the file's own fixed data and sections; each call is refused with the row's code.
type AgreedRow = { case: string; expect: string };
type RequestEdit = (request: { [k: string]: Json }, details: { [k: string]: Json }) => void;

/** `challenge` with its request decoded, changed by `edit` (the request, then its methodDetails), and re-encoded. */
function editedRequest<C extends MppChallenge>(challenge: C, edit: RequestEdit): C {
  const request = JSON.parse(Buffer.from(challenge.request, "base64url").toString("utf8"));
  edit(request, request.methodDetails);
  return withRequest(challenge, request) as C;
}

/**
 * One test that `cases` names every row of `rows` and no other, and one test per row: each call is refused with the
 * row's code. An expect of two codes, "a or b", gives one call per code, in the order the case names its conditions.
 */
function agreedRows(rows: AgreedRow[], cases: Record<string, () => Promise<unknown[]>>): void {
  it("names a case for every row, and no other", () => {
    expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
  });
  for (const row of rows) {
    it(row.case, async () => {
      const results = await cases[row.case]!();
      expect(results.length).toBeGreaterThan(0);
      const codes = row.expect.split(" or ");
      if (codes.length > 1) expect(results).toEqual(codes.map((code) => refused(code)));
      else for (const r of results) expect(r).toEqual(refused(row.expect));
    });
  }
}

describe("mpp-charge-solana.json agreedRefusals: every row runs", () => {
  const V = SO;
  const H: AtrHash = V.fixed.H;
  const placed = placedOf(V);
  const transaction = (wire: string) => ({ type: "transaction", transaction: wire });
  const push = credential(placed, { type: "signature", signature: V.push.txid });
  /** A reader on the push section's network whose getTransaction answers `answer`. */
  const readerOf = (answer: SvmReader["transaction"]): SvmReader => ({
    network: V.push.network,
    transaction: answer,
    signatures: async () => [],
    blockhashValid: async () => ({ valid: true, slot: 0n }),
    firstAvailableBlock: async () => 0n,
    account: async () => {
      throw new Error("a push credential's read makes no account read");
    },
  });
  const landed: SvmLanded = {
    wire: Uint8Array.from(Buffer.from(V.push.landedWireBase64, "base64")),
    err: null,
    loaded: { writable: [], readonly: [] },
    inner: [],
  };
  const build = (challenge: MppChallenge & { id: string }, payer: string = V.fixed.payer) =>
    chargeSolana.build({ challenge, payer }, H);

  const cases: Record<string, () => Promise<unknown[]>> = {
    "pairingsOf with methodDetails.network other than mainnet, devnet or localnet": async () => [
      pairingsOf(editedRequest(V.challenge, (_, d) => (d["network"] = "testnet"))),
      pairingsOf(editedRequest(V.challenge, (_, d) => (d["network"] = V.push.network))),
    ],
    "pairingsOf with amount not a positive u64, currency neither sol nor a key, recipient not a key, externalId over 566 bytes, or feePayer true without feePayerKey":
      async () => [
        pairingsOf(editedRequest(V.challenge, (r) => (r["amount"] = "0"))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["amount"] = (1n << 64n).toString()))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["currency"] = "usdc"))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["recipient"] = "seller"))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["externalId"] = "x".repeat(567)))),
        pairingsOf(editedRequest(V.challenge, (_, d) => delete d["feePayerKey"])),
      ],
    // Memo instructions whose data is the split section's label, or H's hex without the LCP prefix.
    "a credential with no LCP memo among its Memo instructions": async () => [
      await chargeSolana.bound(credential(placed, transaction(await twoMemoWire(V.split.splitMemo, V.split.splitMemo)))),
      await chargeSolana.bound(credential(placed, transaction(await twoMemoWire(H, V.split.splitMemo)))),
    ],
    // The plant's two L memos, and L with H2's LCP string.
    "a credential with two or more LCP memos": async () => [
      await chargeSolana.bound(credential(placed, transaction(V.plant.wireBase64))),
      await chargeSolana.bound(credential(placed, transaction(await twoMemoWire(V.fixed.L, toLcpString(V.fixed.H2))))),
    ],
    "reference on localnet, which has no CAIP-2 network here": async () => [
      await chargeSolana.reference(credential(editedRequest(placed, (_, d) => (d["network"] = "localnet")), transaction(V.V2.wireBase64))),
    ],
    // The reader throws; then it holds the landed wire at finalized and nothing at confirmed, the commitment read.
    "fetchPresented when the reader fails, or finds nothing at confirmed": async () => [
      await chargeSolana.fetchPresented(push, readerOf(async () => {
        throw new ReaderError("transport");
      })),
      await chargeSolana.fetchPresented(push, readerOf(async (_, at) => (at === "confirmed" ? { notFound: true, slot: null } : landed))),
    ],
    // Solana's commitment levels: a block at `confirmed` has a supermajority's votes but is not finalized, and a block
    // that is not finalized can be replaced. The reader holds the transaction, with the error row's err, at confirmed
    // only: fetchPresented reads confirmed, then finalized once it reads the error; recover reads finalized, then
    // confirmed.
    "fetchPresented or recover when the transaction carries an error at confirmed and is not found at finalized": async () => {
      const err = (V.agreedRefusals.rows as (AgreedRow & { err?: Json })[]).find((r) => r.err !== undefined)!.err;
      const reader = readerOf(async (_, at) => (at === "finalized" ? { notFound: true, slot: null } : { ...landed, err }));
      return [
        await chargeSolana.fetchPresented(push, reader),
        await chargeSolana.recover({ network: V.push.network, transaction: V.push.txid }, reader),
      ];
    },
    "build with splits or confidential in the request, a malformed payer, or no decimals and tokenProgram for a mint": async () => [
      await build(editedRequest(placed, (r, d) => (d["splits"] = [{ amount: "1", recipient: r["recipient"]! }]))),
      await build(editedRequest(placed, (_, d) => (d["confidential"] = true))),
      await build(placed, "payer"),
      await build(editedRequest(placed, (_, d) => {
        delete d["decimals"];
        delete d["tokenProgram"];
      })),
      await build(editedRequest(placed, (_, d) => delete d["decimals"])),
      await build(editedRequest(placed, (_, d) => delete d["tokenProgram"])),
    ],
    "a payload type other than transaction, signature or bundle": async () => [
      await chargeSolana.bound(credential(placed, { type: "hash", transaction: V.V2.wireBase64 })),
      await chargeSolana.reference(credential(placed, { type: "hash", transaction: V.V2.wireBase64 })),
    ],
  };

  agreedRows(
    rowsOf(V.agreedRefusals.rows as (AgreedRow & { err?: Json })[], "mpp-charge-solana.json agreedRefusals.rows", {
      keep: ["the rows the cases above run", (r) => r.err === undefined],
      leave: [
        "the row that carries a landed transaction's err, which \"push: fetchPresented refuses a landed transaction that carries an error\" runs",
        (r) => r.err !== undefined,
      ],
    }),
    cases,
  );
});

describe("mpp-charge-stellar.json agreedRefusals: every row runs", () => {
  const V = ST;
  const H: AtrHash = V.fixed.H;
  const placed = placedOf(V);
  const S = V.sourceAccount;
  // Push credentials naming the sourceAccount section's hash, under its challenge (feePayer false) and under the same
  // challenge with feePayer absent.
  const pushes = [S.challenge, editedRequest(S.challenge, (_, d) => delete d["feePayer"])].map((c) =>
    credential(c, { type: "hash", hash: S.hash }),
  );
  const readerOf = (answer: StellarReader["transaction"]): StellarReader => ({
    network: "stellar:testnet",
    transaction: answer,
    transfers: async () => ({ events: [], complete: true, oldestLedger: 1, latestLedger: 1000 }),
    latestLedger: async () => 1000,
  });
  const fetched = (answer: StellarReader["transaction"]) =>
    Promise.all(pushes.map((p) => chargeStellar.fetchPresented(p, readerOf(answer))));
  /** The seller's account with the last character of its checksum changed: G and 55 base32 characters, not a valid strkey. */
  const badAccount = `${V.fixed.request.recipient.slice(0, -1)}${V.fixed.request.recipient.endsWith("A") ? "B" : "A"}`;

  const cases: Record<string, () => Promise<unknown[]>> = {
    "pairingsOf with a network other than stellar:pubnet or stellar:testnet, a currency not a C strkey, a recipient neither G nor M, or amount not decimal":
      async () => [
        pairingsOf(editedRequest(V.challenge, (_, d) => (d["network"] = "stellar:futurenet"))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["currency"] = V.fixed.request.recipient))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["recipient"] = V.fixed.request.currency))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["amount"] = "10.5"))),
      ],
    "advertise on a recipient that is not a valid G strkey": async () => {
      const offer = editedRequest(V.challenge, (r) => (r["recipient"] = badAccount));
      return [chargeStellar.advertise([offer], H, V.fixed.link, offer)];
    },
    "fetchPresented under a challenge whose feePayer is false or absent, when the reader fails": () =>
      fetched(async () => {
        throw new ReaderError("transport");
      }),
    "fetchPresented under a challenge whose feePayer is false or absent, when the transaction is not found or has no envelope":
      async () => [
        ...(await fetched(async () => ({ status: "NOT_FOUND", oldestLedger: 1 }))),
        ...(await fetched(async () => ({ status: "SUCCESS", ledger: 990, oldestLedger: 1 }))),
      ],
    "a payload type other than transaction or hash": async () => [
      await chargeStellar.bound(credential(placed, { type: "signature", transaction: V.V3.envelope })),
      await chargeStellar.reference(credential(placed, { type: "signature", transaction: V.V3.envelope })),
    ],
  };

  agreedRows(
    rowsOf(V.agreedRefusals.rows as AgreedRow[], "mpp-charge-stellar.json agreedRefusals.rows", {
      keep: ["the rows the cases above run", (r) => r.expect !== "stellar/tx-failed"],
      leave: [
        "the stellar/tx-failed row, which \"push: fetchPresented refuses a transaction the reader reports FAILED\" runs",
        (r) => r.expect === "stellar/tx-failed",
      ],
    }),
    cases,
  );
});

describe("mpp-charge-xrpl.json agreedRefusals: every row runs", () => {
  const V = XR;
  const H: AtrHash = V.fixed.H;
  const placed = placedOf(V);
  const push = credential(placed, { type: "hash", hash: V.V3.expectReference.transaction });
  const landed = { validated: true, result: "tesSUCCESS", ledgerIndex: 990, transactionType: "Payment" };
  const fails = async (): Promise<never> => {
    throw new ReaderError("transport");
  };
  const readerOf = (tx: XrplReader["tx"], txBlob: XrplReader["txBlob"] = async () => V.V3.blob): XrplReader => ({
    network: "xrpl:1",
    tx,
    txBlob,
    validatedLedger: async () => 1000,
  });
  const choice = {
    challenge: placed,
    account: V.fixed.account,
    fee: V.build.fee,
    sequence: V.build.sequence,
    lastLedgerSequence: V.build.lastLedgerSequence,
  };
  /** The row whose blobs carry NetworkID: V3's Payment, each with one of its networkIds, signed again by V3's payer. */
  const networkRow = (V.agreedRefusals.rows as (AgreedRow & { networkIds?: number[]; blobs?: string[] })[]).find(
    (r) => r.networkIds !== undefined,
  )!;

  const cases: Record<string, () => Promise<unknown[]>> = {
    // The blobs are V3's Payment re-signed with the row's NetworkID, and the same steps without one give V3's blob.
    // build's complete reads each as bound does, so each call is refused.
    [networkRow.case]: async () => {
      expect(resigned(V.V3.blob)).toBe(V.V3.blob);
      expect(networkRow.networkIds!.map((n) => resigned(V.V3.blob, n))).toEqual(networkRow.blobs);
      const u = await chargeXrpl.build(choice, H);
      if ("refused" in u) throw new Error(u.code);
      const out: unknown[] = [];
      for (const blob of networkRow.blobs!) {
        const cr = credential(placed, { type: "transaction", blob });
        out.push(await chargeXrpl.bound(cr), await chargeXrpl.reference(cr), await u.complete(blob));
      }
      return out;
    },
    "pairingsOf with methodDetails.network other than mainnet, testnet or devnet": async () => [
      pairingsOf(editedRequest(V.challenge, (_, d) => (d["network"] = "betanet"))),
      pairingsOf(editedRequest(V.challenge, (_, d) => (d["network"] = "xrpl:1"))),
    ],
    "pairingsOf with a recipient not shaped as a classic address (r and 24 to 34 base58 characters), a currency neither XRP nor an issued currency nor an MPT, an amount not a positive decimal (whole drops for XRP), an invoiceId not 64 hex digits, or a tag not uint32":
      async () => [
        pairingsOf(editedRequest(V.challenge, (r) => (r["recipient"] = `x${V.fixed.request.recipient.slice(1)}`))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["currency"] = "USD"))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["amount"] = "0"))),
        pairingsOf(editedRequest(V.challenge, (r) => (r["amount"] = "1.5"))),
        pairingsOf(editedRequest(V.challenge, (_, d) => (d["invoiceId"] = "0x12"))),
        pairingsOf(editedRequest(V.challenge, (_, d) => (d["destinationTag"] = -1))),
        pairingsOf(editedRequest(V.challenge, (_, d) => (d["sourceTag"] = 2 ** 32))),
      ],
    // The first read throws; then the transaction is found and the blob read throws.
    "fetchPresented when the reader fails": async () => [
      await chargeXrpl.fetchPresented(push, readerOf(fails)),
      await chargeXrpl.fetchPresented(push, readerOf(async () => landed, fails)),
    ],
    "fetchPresented when the transaction or its blob is not found": async () => [
      await chargeXrpl.fetchPresented(push, readerOf(async () => ({ notFound: true, searchedAll: true }))),
      await chargeXrpl.fetchPresented(push, readerOf(async () => landed, async () => null)),
    ],
    // The challenge placed under H2, its invoiceId then set to H's: V3's signed InvoiceID is that invoiceId, and the
    // challenge's id and opaque name H2.
    "a signed InvoiceID that is the request's invoiceId but not the echoed challenge's hash": async () => {
      const underH2 = chargeXrpl.advertise([V.challenge], V.fixed.H2, V.fixed.link, V.challenge);
      if (!Array.isArray(underH2)) throw new Error(underH2.code);
      const c = editedRequest(underH2[0]!, (_, d) => (d["invoiceId"] = V.fixed.invoiceId));
      const cr = credential(c as never, { type: "transaction", blob: V.V3.blob });
      return [await chargeXrpl.bound(cr), await chargeXrpl.reference(cr)];
    },
    "build with an account that is not a string, or a malformed fee, sequence or lastLedgerSequence": async () => [
      await chargeXrpl.build({ ...choice, account: 7 as unknown as string }, H),
      await chargeXrpl.build({ ...choice, fee: "1.5" }, H),
      await chargeXrpl.build({ ...choice, sequence: -1 }, H),
      await chargeXrpl.build({ ...choice, lastLedgerSequence: 2 ** 32 }, H),
    ],
  };

  agreedRows(
    rowsOf(V.agreedRefusals.rows as AgreedRow[], "mpp-charge-xrpl.json agreedRefusals.rows", {
      keep: ["the rows the cases above run", (r) => r.expect !== "xrpl/not-validated" && r.expect !== "xrpl/not-success"],
      leave: [
        "the xrpl/not-validated and xrpl/not-success rows, which \"push: fetchPresented refuses a transaction not yet validated, and a validated result other than tesSUCCESS\" runs",
        (r) => r.expect === "xrpl/not-validated" || r.expect === "xrpl/not-success",
      ],
    }),
    cases,
  );
});

describe("mpp-charge-nearintents.json agreedRefusals: every row runs", () => {
  const V = NE;
  const placed = placedOf(V);
  /** The bound section's hash credential under the placed challenge with `externalId` echoed as given. */
  const echoing = (externalId: Json) => credential(editedRequest(placed, (r) => (r["externalId"] = externalId)), V.bound.payload);

  const cases: Record<string, () => Promise<unknown[]>> = {
    // A label, and H's hex without the LCP prefix.
    "bound when the echoed externalId is not an LCP string": async () => [
      await chargeNearIntents.bound(echoing("invoice 7")),
      await chargeNearIntents.bound(echoing(V.fixed.H)),
    ],
    "bound when the echoed externalId names another hash than the challenge id": async () => [
      await chargeNearIntents.bound(echoing(toLcpString(V.fixed.H2))),
    ],
  };

  agreedRows(
    rowsOf(V.agreedRefusals.rows as AgreedRow[], "mpp-charge-nearintents.json agreedRefusals.rows", {
      keep: ["the bound rows", (r) => r.case.startsWith("bound ")],
      leave: [
        "the pairingsOf row, which \"pairingsOf refuses an originNetwork that is not CAIP-2, or an externalId that is not a string (agreed row)\" runs",
        (r) => r.case.startsWith("pairingsOf "),
      ],
    }),
    cases,
  );
});
