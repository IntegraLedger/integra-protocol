// Runs the MPP charge vector files for Hedera's placement, Solana, Stellar, XRPL and NEAR Intents through the mpp entry
// point. Every expected value is a vector file's.
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
import { canonicalJson, type AtrHash } from "../src/index.js";
import { ReaderError } from "../src/evm.js";
import {
  chargeHedera,
  chargeNearIntents,
  chargeSolana,
  chargeStellar,
  chargeXrpl,
  pairingsOf,
  type MppChallenge,
  type MppCredential,
} from "../src/mpp.js";
import { MEMO_V3 } from "../src/svm.js";
import type { SvmLanded, SvmReader } from "../src/svm.js";
import type { XrplReader } from "../src/xrpl.js";
import type { StellarReader } from "../src/stellar.js";

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
  return { ...c, request: b64u(canonicalJson(request as never) as string) };
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
    for (const row of HE.requests) {
      expect(pairingsOf({ ...c, request: b64u(canonicalJson(row.request) as string) }), row.case).toEqual(refused(row.expect));
    }
  });
});

describe("mpp-charge-solana.json", () => {
  const V = SO;
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

  it("V2: bound and reference of the vector's wire", async () => {
    const cr = credential(placed, { type: "transaction", transaction: V.V2.wireBase64 });
    expect(await chargeSolana.bound(cr)).toBe(V.V2.expectBound);
    const ref = await chargeSolana.reference(cr);
    expect(ref).toEqual(V.V2.expectReference);
    expect(roundTrip(ref)).toEqual(ref);
  });

  it("defaultComputeBudget: build without a compute unit limit or price writes the default prefix", async () => {
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
  });

  it("build gives V1's message; the payer's signature completes a credential that is bound", async () => {
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
    const sig = ed25519.sign(u.request.message, fromHex(XS.fixed.payerSeed));
    const cr = u.complete(sig);
    if ("refused" in cr) throw new Error(cr.code);
    expect(await chargeSolana.bound(cr)).toBe(H);
  });

  it("refusals", async () => {
    for (const row of V.refusals) {
      const challenge = row.externalId === undefined ? placed : withRequest(placed, { ...V.fixed.request, externalId: row.externalId });
      const payload = row.payload ?? { type: "transaction", transaction: row.wireBase64 };
      expect(await chargeSolana.bound(credential(challenge as never, payload)), row.case).toEqual(refused(row.expect));
    }
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

  it("push: fetchPresented reads the landed wire, then bound and reference; recover", async () => {
    const landed: SvmLanded = {
      wire: Uint8Array.from(Buffer.from(V.push.landedWireBase64, "base64")),
      err: null,
      loaded: { writable: [], readonly: [] },
      inner: [],
    };
    const reader: SvmReader = {
      network: V.push.network,
      transaction: async (sig) => (sig === V.push.txid ? landed : null),
      signatures: async () => [],
      blockhashValid: async () => true,
      firstAvailableBlock: async () => 0n,
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
    expect(await chargeSolana.recover({ network: V.push.network, transaction: V.push.txid }, reader)).toBe(V.recover.expect);
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

  it("refusals, and fetchPresented of a hash credential", async () => {
    expect(await chargeStellar.bound(credential(placed, V.refusals[0].payload))).toEqual(refused(V.refusals[0].expect));
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
      transfers: async () => ({ events: [], complete: true, oldestLedger: 1 }),
      latestLedger: async () => 1000,
    } as StellarReader;
    const fetched = await chargeStellar.fetchPresented(credential(placed, V.refusals[0].payload), reader);
    if ("refused" in fetched) throw new Error(fetched.code);
    expect(await chargeStellar.bound(fetched)).toBe(H);
    const ref = await chargeStellar.reference(fetched);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.transaction).toBe(V.refusals[0].payload.hash);
  });

  it("bound and build read the invocation the payer's entry signs (x402-exact-stellar.json's V4 and V4build rows)", async () => {
    const signedRows = XST.V4.filter((r: { case: string }) => r.case.includes("the payer's entry signs"));
    expect(signedRows.length).toBe(4);
    for (const row of signedRows) {
      const got = await chargeStellar.bound(credential(placed, { type: "transaction", transaction: row.envelope }));
      expect(got, row.case).toEqual(refused(row.expect));
    }
    const now = Date.parse(V.fixed.expires) / 1000 - 60;
    const agreeing = await chargeStellar.build({ challenge: placed, simulatedXdr: XST.V2.simulatedXdr, currentLedger: 988, now }, H);
    expect("refused" in agreeing).toBe(false);
    for (const row of XST.V4build.rows) {
      const u = await chargeStellar.build({ challenge: placed, simulatedXdr: row.simulatedXdr, currentLedger: 988, now }, H);
      expect(u, row.case).toEqual(refused(row.expect));
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
    const cr = u.complete(V.V3.blob);
    if ("refused" in cr) throw new Error(cr.code);
    expect(await chargeXrpl.bound(cr)).toBe(H);
    const memos = withRequest(placed, { ...V.fixed.request, methodDetails: { network: "testnet", invoiceId: V.fixed.invoiceId, memos: [] } });
    expect(await chargeXrpl.build({ challenge: memos as never, account: V.fixed.account, fee: "12", sequence: 7, lastLedgerSequence: 1000 }, H)).toEqual(
      refused(V.refusals[1].expect),
    );
  });

  it("push: fetchPresented reads the blob by hash; read-first before it", async () => {
    expect(await chargeXrpl.bound(credential(placed, V.refusals[0].payload))).toEqual(refused(V.refusals[0].expect));
    const reader: XrplReader = {
      network: "xrpl:1",
      tx: async () => ({ notFound: true, searchedAll: true }),
      txBlob: async (h) => (h === V.V3.expectReference.transaction ? V.V3.blob : null),
      validatedLedger: async () => 1000,
    };
    const fetched = await chargeXrpl.fetchPresented(credential(placed, V.refusals[0].payload), reader);
    if ("refused" in fetched) throw new Error(fetched.code);
    expect(await chargeXrpl.bound(fetched)).toBe(H);
  });

  it("plant: a memo carrying L without InvoiceID is refused, never H", async () => {
    expect(await chargeXrpl.bound(credential(placed, { type: "transaction", blob: V.plant.blob }))).toEqual(refused(V.plant.expect));
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

  it("bound of a hash credential gives H", async () => {
    expect(await chargeNearIntents.bound(credential(placed, V.bound.payload))).toBe(V.bound.expect);
  });

  it("plant: a transaction credential is refused, never H", async () => {
    expect(await chargeNearIntents.bound(credential(placed, V.plant.payload))).toEqual(refused(V.plant.expect));
  });
});
