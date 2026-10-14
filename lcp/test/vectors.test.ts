// Runs the vector files' rows through the entry points. Every expected value is the file's.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domainSeparator, hashStruct, hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hash, hashEquals, type AtrHash } from "../src/index.js";
import { AUTHORIZATION_USED_TOPIC, ReaderError, evmStatus, type EvmReader, type EvmReceipt, type Hex } from "../src/evm.js";
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
    call: async () => {
      throw new ReaderError("transport");
    },
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

  it("V6: a named transaction that is not this payment is failed", async () => {
    for (const row of P.V6.notThisPayment.rows) {
      expect(withBigints(await exactEip3009.status(P.V6.ref, readerFor(row.receipt))), row.case).toEqual(row.expect);
    }
  });

  it("V6: each use of H pairs with the transfer the token emits for it", async () => {
    const ref = P.V6.ref;
    const bindingLog = { address: ref.asset, topic0: AUTHORIZATION_USED_TOPIC, index: 2 as const, value: ref.h };
    const asEvmRef = { network: ref.network, transaction: ref.transaction, bindingLog, transferLog: ref.transferLog };
    for (const row of P.V6.pairing.rows) {
      expect(withBigints(await exactEip3009.status(ref, readerFor(row.receipt))), row.name).toEqual(row.expect);
      expect(withBigints(await evmStatus(asEvmRef, readerFor(row.receipt))), row.name).toEqual(row.expect);
    }
    expect(P.V6.pairing.rows.map((r: { name: string }) => r.name)).toEqual([
      "secondSignature",
      "plainBeside",
      "batch",
      "transferFirst",
      "transferFirstBatch",
      "transferFirstTwoPayers",
      "transferBeforeAnotherUse",
    ]);
  });

  it("plant", async () => {
    expect(withBigints(await exactEip3009.status(P.V6.ref, readerFor(P.plant.receipt)))).toEqual(P.plant.expect);
  });

  // The rows that carry their input, as the agreedRefusals about states: build's choice; read of V5's document with its
  // legal context's info, its legal context or its accepts replaced; build of V1's choice with another option.
  it("agreedRefusals: each row that carries its input", async () => {
    type Row = { case: string; expect: string } & Partial<Record<"choice" | "info" | "legalContext" | "accepts" | "accepted", unknown>>;
    const rows = (P.agreedRefusals.rows as Row[]).filter((r) => Object.keys(r).length > 2);
    expect(rows.map((r) => Object.keys(r).filter((k) => k !== "case" && k !== "expect"))).toEqual([
      ["choice"], ["choice"], ["info"], ["info"], ["legalContext"], ["info"], ["info"], ["accepts"], ["accepted"],
    ]);
    const answer = async (r: Row): Promise<unknown> => {
      if ("choice" in r) return exactEip3009.build(r.choice as never, H);
      if ("accepted" in r) {
        const accepted = r.accepted as PaymentRequirements;
        const req: PaymentRequired = { x402Version: 2, resource: P.fixed.resource, accepts: [accepted] };
        return exactEip3009.build({ required: req, accepted, from: P.fixed.payer, now: P.fixed.now }, H);
      }
      const doc = structuredClone(P.V5.expectDocument);
      if ("info" in r) doc.extensions.legalContext.info = r.info;
      if ("legalContext" in r) doc.extensions.legalContext = r.legalContext;
      if ("accepts" in r) doc.accepts = r.accepts;
      return exactEip3009.read(doc);
    };
    for (const r of rows) expect(await answer(r), r.case).toEqual({ refused: true, code: r.expect });
  });

  it("agreedRefusals: the long links are 2049 UTF-16 code units and 2048 code points, and 2048 units reads", () => {
    const info = (P.agreedRefusals.rows as { info?: { legalContextUrl?: string; legalContextAgreementUrl?: string } }[])
      .map((r) => r.info)
      .filter((i) => i !== undefined);
    const long = [info[2]!.legalContextUrl!, info[3]!.legalContextAgreementUrl!];
    for (const l of long) {
      expect(l.length).toBe(2049);
      expect([...l].length).toBe(2048);
    }
    // The same link one ASCII letter shorter, 2048 UTF-16 code units: H and the link read back.
    const prefix = "https://atr.seller.example/";
    expect(long[0]!.startsWith(`${prefix}a`)).toBe(true);
    const at2048 = prefix + long[0]!.slice(prefix.length + 1);
    expect(at2048.length).toBe(2048);
    const doc = structuredClone(P.V5.expectDocument);
    doc.extensions.legalContext.info.legalContextUrl = at2048;
    const r = exactEip3009.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect([r.h, r.link]).toEqual([H, at2048]);
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

  it("D is the V5 document for hash(A) at the fixed link, a path that does not hold the hash", () => {
    // The seller guide's "Serving the link": build the link from a random token, not from H.
    const link: string = B.fixed.link;
    expect(link.startsWith("https://atr.seller.example/")).toBe(true);
    expect(link.toLowerCase()).not.toContain(row("B1").expect.h.slice(2));
    expect(exactEip3009.advertise({ x402Version: 2, resource: P.fixed.resource, accepts: [O] }, row("B1").expect.h, link, O))
      .toEqual(B.fixed.D);
    for (const doc of [B.fixed.agreement.required, B.fixed.agreement.requiredMixed]) {
      expect(doc.extensions.legalContext.info.legalContextUrl).toBe(link);
    }
  });

  it("the agreement URL is a path that does not hold the hash, and each agreement challenge names it as its resource", () => {
    // The seller guide's "The agreement URL": its unpaid 402 advertises the link, so it is built from a random token too.
    const url: string = B.fixed.agreement.url;
    expect(url.startsWith("https://api.seller.example/agreement/")).toBe(true);
    expect(url.toLowerCase()).not.toContain(row("B1").expect.h.slice(2));
    const { required, requiredMixed, requiredOtherHash } = B.fixed.agreement;
    for (const doc of [required, requiredMixed, requiredOtherHash]) expect(doc.resource.url).toBe(url);
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

// docs/concepts/vectors.md: refusal codes are this package's own, and a file's agreedRefusals rows hold the codes for
// checks its specification leaves to the implementation. An about that says some rows are marked with a member names a
// member a row carries as true, and a row carries no marker its file's about does not explain.
describe("every vector file's about names only the markers its rows carry", () => {
  const dir = new URL("../vectors/", import.meta.url);
  const files = readdirSync(dir).filter((n) => n.endsWith(".json"));
  const values = (v: unknown, key: string, out: unknown[] = []): unknown[] => {
    if (Array.isArray(v)) for (const x of v) values(x, key, out);
    else if (typeof v === "object" && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if (k === key) out.push(x);
        values(x, key, out);
      }
    }
    return out;
  };

  it("reads every file", () => {
    expect(files.length).toBeGreaterThan(60);
  });

  it("each marker an about names is carried as true by a row, and no row carries an implementationCode the about does not name", () => {
    const wrong: string[] = [];
    for (const n of files) {
      const d = JSON.parse(readFileSync(new URL(n, dir), "utf8")) as { about?: string };
      const named = [...String(d.about).matchAll(/\bmarked (\w+)/g)].map((m) => m[1]!);
      for (const marker of named) if (!values(d, marker).includes(true)) wrong.push(`${n}: no row is marked ${marker}`);
      if (values(d, "implementationCode").length > 0 && !named.includes("implementationCode")) {
        wrong.push(`${n}: a row carries implementationCode, which the about does not name`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
