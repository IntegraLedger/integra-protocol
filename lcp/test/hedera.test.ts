// Runs the Hedera vector files through the hedera entry point. Every expected value is the files'.
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toLcpString, type AtrHash } from "../src/index.js";
import {
  decodeHederaTx,
  exactHedera,
  exactHederaExecutor,
  executorStatus,
  hederaIdDigest,
  hederaNetworkOfChainId,
  hederaPairingOf,
  hederaStatus,
  txIdMirror,
  txIdText,
  type HederaReader,
  type HederaUnsigned,
  type MirrorEntry,
} from "../src/hedera.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const V = load("x402-exact-hedera.json");
const X = load("x402-exact-hedera-transfer-executor.json");
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const fromB64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

function readerOf(entries: MirrorEntry[] | null | "reader-error", network = "hedera:testnet"): HederaReader {
  return {
    network: network as HederaReader["network"],
    transactions: async () => {
      if (entries === "reader-error") throw new Error("transport");
      return entries;
    },
  };
}

function presentedOf(transaction: string, accepted: PaymentRequirements = O) {
  return { x402Version: 2 as const, resource: V.fixed.resource, accepted, payload: { transaction } };
}

describe("x402-exact-hedera.json", () => {
  const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
  const unsigned = async (accepted = O, decimals?: number) => {
    const u = await exactHedera.build(
      {
        required: { ...required, accepts: [accepted] },
        accepted,
        payer: V.fixed.payer,
        node: V.fixed.node,
        validStart: { seconds: BigInt(V.fixed.validStart.seconds), nanos: V.fixed.validStart.nanos },
        maxFee: BigInt(V.fixed.maxFee),
        ...(decimals !== undefined ? { decimals } : {}),
      },
      H,
    );
    if ("refused" in u) throw new Error(u.code);
    return u as HederaUnsigned;
  };

  it("V1: the memo is H's LCP string, 77 bytes, and its memo_base64", () => {
    const memo = toLcpString(H);
    expect(memo).toBe(V.V1.expectMemo);
    expect(Buffer.byteLength(memo, "utf8")).toBe(V.fixed.Lbytes);
    expect(Buffer.from(memo, "utf8").toString("base64")).toBe(V.V1.expectMemoBase64);
  });

  it("V2: build gives the 131 body bytes; the signature over them completes the 241-byte transaction", async () => {
    const u = await unsigned();
    expect(u.request.kind).toBe("hedera-body");
    expect(hex(u.request.bodyBytes)).toBe(V.V2.expectBodyBytes);
    expect(u.request.bodyBytes.length).toBe(V.V2.expectBodyLength);
    const publicKey = fromHex(V.fixed.publicKey);
    const signature = fromHex(V.fixed.signature);
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") }, format: "jwk" });
    expect(verify(null, u.request.bodyBytes, key, signature)).toBe(true);
    const tx = u.complete({ publicKey, signature, type: "ed25519" });
    expect(tx).toBe(V.V2.expectTransactionBase64);
    expect(fromB64(tx as string).length).toBe(V.V2.expectTransactionLength);
  });

  it("V2: bound, reference and the two id forms", async () => {
    const p = presentedOf(V.V2.expectTransactionBase64);
    expect(await exactHedera.bound(p)).toBe(V.V2.expectBound);
    const ref = await exactHedera.reference(p);
    expect(ref).toEqual(V.V2.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    const decoded = decodeHederaTx(fromB64(V.V2.expectTransactionBase64));
    if ("refused" in decoded) throw new Error(decoded.code);
    expect(txIdText(decoded.bodies[0]!.id)).toBe(V.V2.expectTxIdText);
    expect(txIdMirror(decoded.bodies[0]!.id)).toBe(V.V2.expectReference.transactionId);
  });

  it("V3: the list form gives H; an inconsistent list is refused", async () => {
    expect(await exactHedera.bound(presentedOf(V.V3.listBase64))).toBe(V.V3.expectBound);
    expect(await exactHedera.bound(presentedOf(V.V3.inconsistentListBase64))).toEqual({
      refused: true,
      code: V.V3.expectInconsistent,
    });
  });

  it("V4 under x402: the attribution memo is not an LCP string", async () => {
    expect(await exactHedera.bound(presentedOf(V.V4x.transactionBase64))).toEqual({
      refused: true,
      code: V.V4x.expectRefusal,
    });
  });

  it("V5: status for each reader answer, and recover", async () => {
    for (const row of V.V5.rows) {
      expect(await hederaStatus(V.V5.reference, readerOf(row.entries))).toEqual(row.expect);
    }
    expect(await exactHedera.recover(V.V5.reference, readerOf(V.V5.recover.entries))).toBe(V.V5.recover.expect);
  });

  it("status of a reader for another network is pending unreadable", async () => {
    expect(await hederaStatus(V.V5.reference, readerOf(V.V5.rows[0].entries, "hedera:mainnet"))).toEqual({
      state: "pending",
      why: "unreadable",
    });
  });

  it("plant 1: a duplicate read first never hides the settled entry", async () => {
    const plant = V.plants.duplicateFirst;
    expect(await hederaStatus(V.V5.reference, readerOf(plant.entries))).toEqual(plant.expect);
  });

  it("plant 2: a transfer with no memo is refused before anything is sent, though it echoes the extension", async () => {
    const plant = V.plants.noMemo;
    const doc = exactHedera.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    const echoed = { ...presentedOf(plant.transactionBase64), extensions: doc.extensions };
    expect(await exactHedera.bound(echoed)).toEqual({
      refused: true,
      code: plant.expectRefusal,
    });
  });

  it("the refusal rows", async () => {
    for (const row of V.refusals) {
      if (row.transactionBase64 !== undefined) {
        expect(await exactHedera.bound(presentedOf(row.transactionBase64))).toEqual({ refused: true, code: row.expect });
      } else {
        expect(hederaPairingOf(row.option)).toEqual({ refused: true, code: row.expect });
        const doc = { ...required, accepts: [row.option] };
        expect(exactHedera.advertise(doc, H, V.fixed.link, row.option)).toEqual({ refused: true, code: row.expect });
      }
    }
  });

  it("token build: expected_decimals is written when given, even zero", async () => {
    const token = { ...O, asset: V.tokenBuild.asset };
    expect(hex((await unsigned(token, 6)).request.bodyBytes)).toBe(V.tokenBuild.expectBodyBytesDecimals6);
    expect(hex((await unsigned(token, 0)).request.bodyBytes)).toBe(V.tokenBuild.expectBodyBytesDecimals0);
  });

  it("advertise places the legal context and leaves the option; read gives it back", () => {
    const doc = exactHedera.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(O);
    expect(doc.extensions?.["legalContext"]?.info).toEqual({ type: "sha256", value: H, legalContextUrl: V.fixed.link });
    const r = exactHedera.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect(r.h).toBe(H);
    expect(r.link).toBe(V.fixed.link);
    expect(r.offer.options).toEqual([O]);
    expect(exactHedera.unplaced(O)).toBe(O);
  });

  it("MPP chain ids map to the two networks named, and nothing else", () => {
    expect(hederaNetworkOfChainId(295)).toBe("hedera:mainnet");
    expect(hederaNetworkOfChainId(296)).toBe("hedera:testnet");
    expect(hederaNetworkOfChainId(297)).toEqual({ refused: true, code: "hedera/chain-id-unnamed" });
  });
});

describe("x402-exact-hedera-transfer-executor.json", () => {
  const OX: PaymentRequirements = X.fixed.O;
  const required: PaymentRequired = { x402Version: 2, resource: X.fixed.resource, accepts: [OX] };
  const advertised = () => {
    const doc = exactHederaExecutor.advertise(required, H, X.fixed.link, OX);
    if ("refused" in doc) throw new Error(doc.code);
    return doc;
  };
  const built = async () => {
    const b = await exactHederaExecutor.build({ required: advertised(), accepted: OX, now: X.fixed.now }, H);
    if ("refused" in b) throw new Error(b.code);
    return b;
  };

  it("pairingOf", () => {
    for (const row of X.pairingOf) {
      const got = hederaPairingOf(row.option);
      expect(typeof got === "string" ? got : got?.code).toBe(row.expect);
    }
  });

  it("build's request, and complete", async () => {
    const b = await built();
    expect(b.request).toEqual(X.build.expectRequest);
    const payment = b.complete(X.fixed.payload);
    if ("refused" in payment) throw new Error(payment.code);
    expect(payment.payload).toEqual(X.fixed.payload);
    expect(payment.accepted).toEqual(OX);
    for (const row of X.complete) {
      const { expect: code, source: _, ...change } = row;
      expect(b.complete({ ...X.fixed.payload, ...change })).toEqual({ refused: true, code });
    }
  });

  it("bound reads the echoed extension; reference gives the digest", async () => {
    const payment = (await built()).complete(X.fixed.payload);
    if ("refused" in payment) throw new Error(payment.code);
    expect(await exactHederaExecutor.bound(payment)).toBe(X.bound.expectWithExtension);
    const { extensions: _, ...bare } = payment;
    expect(await exactHederaExecutor.bound(bare)).toEqual({ refused: true, code: X.bound.expectWithoutExtension });
    const ref = await exactHederaExecutor.reference(payment);
    if ("refused" in ref) throw new Error(ref.code);
    expect(ref.idDigest).toBe(X.reference.expectIdDigest);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    expect(await hederaIdDigest("0.0.5001", "0.0.4001", "100000000")).toBe(X.reference.expectIdDigest);
  });

  it("executorStatus", async () => {
    for (const row of X.status.rows) {
      expect(await executorStatus(X.status.reference, readerOf(row.entries))).toEqual(row.expect);
    }
  });

  it("plant: a hostile executor that pays another account settles nothing", async () => {
    expect(await executorStatus(X.status.reference, readerOf(X.plant.entries))).toEqual(X.plant.expect);
  });

  it("the record states the agreement step and no public proof", () => {
    expect(exactHederaExecutor.pattern.publicProof).toBe(false);
    expect(exactHederaExecutor.claims).toBe(false);
    expect(exactHedera.pattern.publicProof).toBe(true);
    expect(exactHedera.claims).toBe(true);
  });
});
