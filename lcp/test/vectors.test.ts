// Runs the vector files' rows through the entry points. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domainSeparator, hashStruct, hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hash, hashEquals, type AtrHash } from "../src/index.js";
import { ReaderError, type EvmReader, type EvmReceipt, type Hex } from "../src/evm.js";
import {
  exactEip3009,
  issuedDigest,
  requestCommitment,
  type Eip3009TypedData,
  type Eip3009Payment as PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "../src/x402.js";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../vectors/${name}`, import.meta.url), "utf8"));
const P = load("x402-exact-eip155-eip3009.json");
const B = load("buyer.json");
const fromHex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
const forViem = (td: Eip3009TypedData) => td as unknown as Parameters<typeof hashTypedData>[0];
const O: PaymentRequirements = P.fixed.O;
const H: AtrHash = P.fixed.H;

const asMessage = (m: Eip3009TypedData["message"]) => ({
  from: m.from,
  to: m.to,
  value: m.value.toString(),
  validAfter: m.validAfter.toString(),
  validBefore: m.validBefore.toString(),
  nonce: m.nonce,
});

type FixtureReceipt = { status: 0 | 1; blockNumber: string; logs: EvmReceipt["logs"] } | null | "reader-error";
function readerFor(r: FixtureReceipt): EvmReader {
  return {
    network: P.V6.reader.network,
    receipt: async () => {
      if (r === "reader-error") throw new ReaderError("transport");
      return r === null ? null : { status: r.status, blockNumber: BigInt(r.blockNumber), logs: r.logs };
    },
    blockNumber: async (tag) => BigInt(tag === "finalized" ? P.V6.reader.finalized : P.V6.reader.safe),
    transaction: async () => null,
  };
}
const withBigints = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

describe("x402-exact-eip155-eip3009.json", () => {
  const required: PaymentRequired = { x402Version: 2, resource: P.fixed.resource, accepts: [O] };
  const unsigned = async () => {
    const u = await exactEip3009.build({ required, accepted: O, from: P.fixed.payer, now: P.fixed.now }, H);
    if ("refused" in u) throw new Error(u.code);
    return u;
  };

  it("V1", async () => {
    const { typedData } = await unsigned();
    expect(typedData.domain).toEqual(P.V1.expectDomain);
    expect(asMessage(typedData.message)).toEqual(P.V1.expectMessage);
    expect(domainSeparator({ domain: typedData.domain })).toBe(P.V1.expectDomainSeparator);
    expect(hashStruct({ data: typedData.message, primaryType: typedData.primaryType, types: typedData.types })).toBe(
      P.V1.expectStructHash,
    );
    expect(hashTypedData(forViem(typedData))).toBe(P.V1.expectDigest);
    expect(await recoverTypedDataAddress({ ...forViem(typedData), signature: P.V1.expectSignature })).toBe(
      P.V1.expectRecovers,
    );
    expect(await privateKeyToAccount(P.fixed.payerKey).signTypedData(forViem(typedData))).toBe(P.V1.expectSignature);
  });

  it("V2", async () => {
    const payment = (await unsigned()).complete(P.V1.expectSignature) as PaymentPayload;
    expect(payment).toEqual(P.V2.expectPayload);
    expect(await exactEip3009.bound(payment)).toBe(P.V2.expectBound);
    const upper = structuredClone(payment);
    upper.payload.authorization.nonce = "0x" + H.slice(2).toUpperCase();
    expect(await exactEip3009.bound(upper)).toBe(P.V2.boundOfUpperCaseNonce);
    const permit2 = structuredClone(payment);
    permit2.accepted.extra = { ...permit2.accepted.extra, assetTransferMethod: "permit2" };
    expect(await exactEip3009.bound(permit2)).toEqual(P.V2.permit2.expect);
  });

  it("V3", async () => {
    for (const row of P.V3) {
      const c = await requestCommitment({
        method: row.method,
        target: row.target,
        body: new TextEncoder().encode(row.bodyUtf8),
      });
      expect(c).toEqual(row.expectCommitment);
      const d = await issuedDigest(c as never);
      if (row.expectIssuedDigest !== undefined) expect(d).toBe(row.expectIssuedDigest);
      if (row.expectIssuedDigestNot !== undefined) expect(d).not.toBe(row.expectIssuedDigestNot);
    }
  });

  it("V4", async () => {
    expect(await issuedDigest(P.V4.option)).toBe(P.V4.expectIssuedDigest);
    expect(await issuedDigest(P.V4.reordered)).toBe(P.V4.expectIssuedDigest);
  });

  it("V5", () => {
    const a = P.V5.advertise;
    const doc = exactEip3009.advertise(a.doc, a.h, a.link, a.offer);
    expect(doc).toEqual(P.V5.expectDocument);
    const r = exactEip3009.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect({ h: r.h, link: r.link, options: r.offer.options }).toEqual(P.V5.expectRead);
    expect(exactEip3009.advertise(a.doc, a.h, P.V5.httpLink.link, a.offer)).toEqual(P.V5.httpLink.expect);
    expect(exactEip3009.read(P.V5.readHttpLink.doc)).toEqual(P.V5.readHttpLink.expect);
    const malformed = structuredClone(P.V5.expectDocument);
    malformed.extensions.legalContext.info.value = P.V5.readMalformed.valueOverride;
    expect(exactEip3009.read(malformed)).toEqual(P.V5.readMalformed.expect);
    const other = exactEip3009.advertise(a.doc, a.h, a.link + "?v=other", a.offer) as PaymentRequired;
    expect(exactEip3009.advertise(other, a.h, a.link, a.offer)).toEqual(P.V5.conflict.expect);
  });

  it("V6", async () => {
    const ref = P.V6.ref;
    for (const row of P.V6.status) {
      expect(withBigints(await exactEip3009.status(ref, readerFor(row.receipt)))).toEqual(row.expect);
    }
    for (const row of P.V6.recover) {
      const tx = { network: ref.network, asset: ref.asset, transaction: ref.transaction };
      expect(await exactEip3009.recover(tx, readerFor(row.receipt))).toEqual(row.expect);
    }
  });

  it("plant", async () => {
    expect(withBigints(await exactEip3009.status(P.V6.ref, readerFor(P.plant.receipt)))).toEqual(P.plant.expect);
  });
});

describe("buyer.json: the rows the core and the binding can check", () => {
  const row = (name: string) => B.rows.find((r: { name: string }) => r.name === name);
  const A = fromHex(B.fixed.A);
  const C = fromHex(B.fixed.C);

  it("B1, and C's hash", async () => {
    expect(await hash(A)).toBe(row("B1").expect.h);
    expect(await hash(C)).toBe(B.fixed.hashC);
    expect(hashEquals(B.fixed.hashC, row("B1").expect.h)).toBe(false);
  });

  it("D is the V5 document for hash(A)", () => {
    const link = `https://atr.seller.example/${row("B1").expect.h}`;
    expect(exactEip3009.advertise({ x402Version: 2, resource: P.fixed.resource, accepts: [O] }, row("B1").expect.h, link, O))
      .toEqual(B.fixed.D);
  });

  it("B2b, B3 and B4 serve bytes whose hash is not the advertised one", async () => {
    const b2b = row("B2b");
    expect(hashEquals(await hash(fromHex(b2b.input.servesHex)), b2b.input.doc.extensions.legalContext.info.value)).toBe(
      false,
    );
    for (const name of ["B3", "B4"]) {
      const served = await hash(fromHex(row(name).input.servesHex));
      expect(served).toBe(row(name).servedHash);
      expect(hashEquals(served, B.fixed.D.extensions.legalContext.info.value)).toBe(false);
    }
  });

  it("B5: an upper-case advertised hash equals B1 by decoded bytes", async () => {
    expect(hashEquals(row("B5").input.stubRead.h, await hash(A))).toBe(true);
  });

  it("B6 and B7's binding half", async () => {
    const b6 = row("B6").expect;
    const r = exactEip3009.read(B.fixed.D);
    if ("refused" in r) throw new Error(r.code);
    const u = await exactEip3009.build(
      { required: r.offer.required, accepted: r.offer.options[0]!, from: B.fixed.account.split(":")[2] as Hex, now: B.fixed.now },
      r.h,
    );
    if ("refused" in u) throw new Error(u.code);
    expect(asMessage(u.typedData.message)).toEqual(b6.message);
    expect(hashTypedData(forViem(u.typedData))).toBe(b6.digest);
    expect(await recoverTypedDataAddress({ ...forViem(u.typedData), signature: b6.signature })).toBe(b6.recovers);
    const signed = u.complete(b6.signature) as PaymentPayload;
    expect(signed.payload.authorization.nonce).toBe(b6.signedNonce);
    expect(signed.payload.signature).toBe(b6.signature);
    const bound = await exactEip3009.bound(signed);
    expect(hashEquals(bound as string, await hash(A))).toBe(true);
    expect(hashEquals(bound as string, await hash(C))).toBe(false);
  });
});
