// Runs the vector files' rows through the entry points. Every expected value is the file's.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domainSeparator, hashStruct, hashTypedData, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hash, hashEquals, isHttpsLink, type AtrHash } from "../src/index.js";
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
import { rowsOf } from "./rows.js";

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

  // V2's payload is x402 v2's PaymentPayload written by hand from the specification (x402 751590a2,
  // specs/x402-specification-v2.md §5.2 and specs/schemes/exact/scheme_exact_evm.md §1): its signature is V1's, from
  // eth-account, and its authorization V1's message. complete's payload is held to it whole, as JSON text.
  it("V2: complete gives x402's PaymentPayload as the specification writes it from V1's signature and message", async () => {
    const byHand = {
      x402Version: 2,
      resource: P.fixed.resource,
      accepted: O,
      payload: { signature: P.V1.expectSignature, authorization: P.V1.expectMessage },
    };
    expect(P.V2.expectPayload).toStrictEqual(byHand);
    const payment = (await unsigned()).complete(P.V1.expectSignature) as PaymentPayload;
    expect(payment.payload.signature).toBe(P.V1.expectSignature);
    expect(payment.payload.authorization).toStrictEqual(P.V1.expectMessage);
    expect(JSON.stringify(payment)).toBe(JSON.stringify(P.V2.expectPayload));
    expect(await exactEip3009.bound(payment)).toBe(P.V2.expectBound);
    const upper = structuredClone(payment);
    upper.payload.authorization.nonce = "0x" + H.slice(2).toUpperCase();
    expect(await exactEip3009.bound(upper)).toBe(P.V2.boundOfUpperCaseNonce);
    const permit2 = structuredClone(payment);
    permit2.accepted.extra = { ...permit2.accepted.extra, assetTransferMethod: "permit2" };
    expect(await exactEip3009.bound(permit2)).toEqual(P.V2.permit2.expect);
  });

  it("V3", async () => {
    for (const row of rowsOf(P.V3, "x402-exact-eip155-eip3009.json V3")) {
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
    for (const row of rowsOf(P.V6.status, "x402-exact-eip155-eip3009.json V6.status")) {
      expect(withBigints(await exactEip3009.status(ref, readerFor(row.receipt)))).toEqual(row.expect);
    }
    for (const row of rowsOf(P.V6.recover, "x402-exact-eip155-eip3009.json V6.recover")) {
      const tx = { network: ref.network, asset: ref.asset, transaction: ref.transaction };
      expect(await exactEip3009.recover(tx, readerFor(row.receipt))).toEqual(row.expect);
    }
  });

  it("V6: a named transaction that is not this payment is failed", async () => {
    for (const row of rowsOf(P.V6.notThisPayment.rows, "x402-exact-eip155-eip3009.json V6.notThisPayment.rows")) {
      expect(withBigints(await exactEip3009.status(P.V6.ref, readerFor(row.receipt))), row.case).toEqual(row.expect);
    }
  });

  it("V6: each use of H pairs with the transfer the token emits for it", async () => {
    const ref = P.V6.ref;
    const bindingLog = { address: ref.asset, topic0: AUTHORIZATION_USED_TOPIC, index: 2 as const, value: ref.h };
    const asEvmRef = { network: ref.network, transaction: ref.transaction, bindingLog, transferLog: ref.transferLog };
    for (const row of rowsOf(P.V6.pairing.rows, "x402-exact-eip155-eip3009.json V6.pairing.rows", { exact: 7 })) {
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
    const rows = rowsOf(P.agreedRefusals.rows as Row[], "x402-exact-eip155-eip3009.json agreedRefusals.rows", {
      exact: 9,
      keep: ["the rows that carry their input", (r) => Object.keys(r).length > 2],
      leave: [
        'the rows of only case and expect, which "agreedRefusals: each row of only case and expect" runs',
        (r) => Object.keys(r).length === 2,
      ],
    });
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

  // The rows of only case and expect: each runs every condition its case names, on V5's document, V1's choice, V1's
  // unsigned payment and V2's payment, each with the one member the condition names changed.
  describe("agreedRefusals: each row of only case and expect", () => {
    type Row = { case: string; expect: string };
    const rows = rowsOf(P.agreedRefusals.rows as Row[], "x402-exact-eip155-eip3009.json agreedRefusals.rows", {
      keep: ["the rows of only case and expect", (r) => Object.keys(r).length === 2],
      leave: [
        'the rows that carry their input, which "agreedRefusals: each row that carries its input" runs',
        (r) => Object.keys(r).length > 2,
      ],
    });
    const choice = { required, accepted: O, from: P.fixed.payer as Hex, now: P.fixed.now as number };
    /** V5's document with the members of its legal context's info that `info` names replaced. */
    const withInfo = (info: Record<string, unknown>) => {
      const doc = structuredClone(P.V5.expectDocument);
      doc.extensions.legalContext.info = { ...doc.extensions.legalContext.info, ...info };
      return doc;
    };
    /** V1's choice with V1's option changed as `over` says, as the one entry of required.accepts and as accepted. */
    const withOption = (over: Record<string, unknown>) => {
      const accepted = { ...O, ...over } as PaymentRequirements;
      return exactEip3009.build({ ...choice, required: { ...required, accepts: [accepted] }, accepted }, H);
    };
    /** V2's payment with its signature replaced. */
    const withSignature = (signature: string) =>
      ({ ...P.V2.expectPayload, payload: { ...P.V2.expectPayload.payload, signature } }) as PaymentPayload;
    const over32 = Array.from({ length: 33 }, () => O);
    const longLink = (link: string) => link + "a".repeat(2049 - link.length);
    const signature: string = P.V1.expectSignature;

    const cases: Record<string, () => Promise<unknown[]>> = {
      "read or build with accepts not a list, or over 32 options": async () => [
        exactEip3009.read({ ...structuredClone(P.V5.expectDocument), accepts: O }),
        exactEip3009.read({ ...structuredClone(P.V5.expectDocument), accepts: over32 }),
        await exactEip3009.build({ ...choice, required: { ...required, accepts: O as never } }, H),
        await exactEip3009.build({ ...choice, required: { ...required, accepts: over32 } }, H),
      ],
      "read with a legalContext link over 2048 characters": async () => [
        exactEip3009.read(withInfo({ legalContextUrl: longLink(P.fixed.link) })),
        exactEip3009.read(withInfo({ legalContextAgreementUrl: longLink(P.MX.advertise.agreementUrl) })),
      ],
      "read with legalContextUrl and legal_context_url present and different": async () => [
        exactEip3009.read(withInfo({ legal_context_url: `${P.fixed.link}?v=other` })),
      ],
      "build with a malformed from, asset, payTo, maxTimeoutSeconds or now, or an amount of 2^256 or more": async () => [
        await exactEip3009.build({ ...choice, from: "0x1234" }, H),
        await withOption({ asset: "0x1234" }),
        await withOption({ payTo: "0x1234" }),
        await withOption({ maxTimeoutSeconds: 1.5 }),
        await exactEip3009.build({ ...choice, now: -1 }, H),
        await withOption({ amount: (2n ** 256n).toString() }),
      ],
      "build with a nonce that is not 0x and 64 hex digits": async () => [
        await exactEip3009.build(choice, H.slice(2) as AtrHash),
        await exactEip3009.build(choice, H.slice(0, -1) as AtrHash),
        await exactEip3009.build(choice, `${H.slice(0, -1)}g` as AtrHash),
      ],
      "complete with a signature outside 65 to 8192 decoded bytes": async () => {
        const u = await unsigned();
        return [u.complete(`0x${"11".repeat(64)}`), u.complete(`0x${"11".repeat(8193)}`)];
      },
      "bound with a signature over 8192 decoded bytes, or not 0x and an even number of hex digits": async () => [
        await exactEip3009.bound(withSignature(`0x${"11".repeat(8193)}`)),
        await exactEip3009.bound(withSignature(signature.slice(2))),
        await exactEip3009.bound(withSignature(signature.slice(0, -1))),
        await exactEip3009.bound(withSignature(`${signature.slice(0, -1)}g`)),
      ],
    };

    it("names a case for every row, and no other", () => {
      expect(Object.keys(cases).sort()).toEqual(rows.map((r) => r.case).sort());
    });

    for (const row of rows) {
      it(row.case, async () => {
        // Each row's expect is one refusal code.
        expect(row.expect).toMatch(/^x402\/[a-z0-9-]+$/);
        const results = await cases[row.case]!();
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) expect(r).toEqual({ refused: true, code: row.expect });
      });
    }
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

  // The rows below run the parts of the gate's row that this package implements: the hash compared, the read, the
  // bound and the build. Each outcome is the row's own expect, less the counts of fetches and signer calls, which are
  // the gate's.
  const account = B.fixed.account.split(":")[2] as Hex;
  /** The read of `doc`, and the build of its first option for the fixed account and time with the H read. */
  const built = async (doc: unknown) => {
    const read = exactEip3009.read(doc);
    if ("refused" in read) throw new Error(read.code);
    const u = await exactEip3009.build(
      { required: read.offer.required, accepted: read.offer.options[0]!, from: account, now: B.fixed.now },
      read.h,
    );
    if ("refused" in u) throw new Error(u.code);
    return { read, u };
  };
  /** The gate's comparison of a hash it holds with the H it compared: that H when they are equal, else the decline. */
  const compared = (got: string, h: string, decline: string) => (hashEquals(got, h) ? { h } : { decline });

  it("B2: C, which the link serves, does not hash to the H that D advertises: hash-mismatch", async () => {
    const r = row("B2");
    const { read } = await built(B.fixed[r.input.doc]);
    const served = await hash(fromHex(B.fixed[r.input.serves]));
    expect(compared(served, read.h, "hash-mismatch")).toEqual({ decline: r.expect.decline });
  });

  it("B7: the B6 payment checked against A gives A's hash, and against C is signed-not-bound", async () => {
    const r = row("B7");
    const { u } = await built(B.fixed.D);
    const presented = u.complete(row("B6").expect.signature) as PaymentPayload;
    const got = [];
    for (const c of rowsOf(r.input.check as { bytes: string; presented: string }[], "buyer.json B7 input.check")) {
      expect(c.presented).toBe("B6 signed");
      got.push(compared((await exactEip3009.bound(presented)) as string, await hash(fromHex(B.fixed[c.bytes])), "signed-not-bound"));
    }
    expect(got).toEqual(r.expect);
  });

  it("B9: a payment bound to C's hash is not bound to the H compared, A's: signed-not-bound", async () => {
    const r = row("B9");
    expect(compared(B.fixed[r.input.stubBound], await hash(A), "signed-not-bound")).toEqual({ decline: r.expect.decline });
  });

  it("B10: D with an http link is refused at read with the row's detail, and an http link is not an https link", () => {
    const r = row("B10");
    expect(r.input[0].doc).toBe("D with an http:// link");
    const doc = structuredClone(B.fixed.D);
    doc.extensions.legalContext.info.legalContextUrl = B.fixed.link.replace("https:", "http:");
    const read = exactEip3009.read(doc);
    const first = "refused" in read ? { decline: "offer-unreadable", detail: read.code } : { h: read.h };
    const link: string = r.input[1].stubRead.link;
    const second = isHttpsLink(link) ? { link } : { decline: "link-not-https" };
    expect([first, second]).toEqual(r.expect.map(({ fetches: _, ...e }: { fetches: number }) => e));
  });

  it("B12: a body of 1 MiB, the most the gate reads, does not hash to the H that D advertises: hash-mismatch", async () => {
    const r = row("B12");
    const { read } = await built(B.fixed[r.input.doc]);
    expect(r.input.bodyLength).toBe(1_048_576);
    expect(compared(await hash(new Uint8Array(r.input.bodyLength)), read.h, "hash-mismatch")).toEqual(r.expect);
  });

  it("BA2: the agreement challenge requiredOtherHash advertises C's hash, not the H that D advertises: hash-mismatch", async () => {
    const r = row("BA2");
    expect(r.input.agreement).toEqual([{ status: 402, paymentRequired: "requiredOtherHash" }]);
    const { read } = await built(B.fixed.D);
    const other = await built(B.fixed.agreement[r.input.agreement[0].paymentRequired]);
    expect(other.read.h).toBe(await hash(C));
    expect(compared(other.read.h, read.h, "hash-mismatch")).toEqual({ decline: r.expect.decline });
  });

  it("BA6: D with the agreement URL after its link reads through the pairing, whose payment is a public proof, and builds B6", async () => {
    const r = row("BA6");
    const doc = structuredClone(B.fixed.D);
    doc.extensions.legalContext.info = { ...doc.extensions.legalContext.info, legalContextAgreementUrl: B.fixed.agreement.url };
    expect(Object.keys(doc.extensions.legalContext.info)).toEqual(["type", "value", "legalContextUrl", "legalContextAgreementUrl"]);
    const { read, u } = await built(doc);
    expect([read.h, read.link, read.agreement]).toEqual([await hash(A), B.fixed.link, B.fixed.agreement.url]);
    const b6 = row("B6").expect;
    const signed = u.complete(b6.signature) as PaymentPayload;
    const isB6 = hashTypedData(forViem(u.typedData)) === b6.digest && signed.payload.signature === b6.signature;
    // The gate pays the agreement URL only where the pairing's payment is not itself a public proof of H.
    const outcome = { agreementFetches: exactEip3009.pattern.publicProof ? 0 : 1, paymentSignature: isB6 ? "B6" : signed.payload.signature };
    expect(outcome).toEqual({ agreementFetches: r.expect.agreementFetches, paymentSignature: r.expect.paymentSignature });
  });

  // docs/concepts/vectors.md: the suite runs the parts of a buyer row this package implements, and the buyer packages run
  // every row whole. The rows below are the gate's in every step, so no test here runs them.
  const GATE_ONLY: Record<string, string> = {
    B8: "the payment-identifier extension, which this package neither reads nor writes",
    B11: "the gate's fetch of the link and the answers it declines",
    B13: "the gate's bound on the bytes it reads from the link",
    B14: "the gate's deadline on the fetch",
    B15: "the signer's refusal to sign",
    B16: "the match of the buyer's accounts to the options' networks",
    B17: "the gate's check that it implements the pairing the binding names",
    B18: "the payment-identifier extension, which this package neither reads nor writes",
    BE2: "the content codings of the agreement exchange",
  };
  // The rows this file and buyer-vectors.test.ts run, by name, in the file's order.
  const RUN = [
    "B1", "B2", "B2b", "B3", "B4", "B5", "B6", "B7", "B9", "B10", "B12",
    "BA1", "BA2", "BA3", "BA4", "BA5", "BA6", "BA7", "BA8", "BA9", "BA10", "BA11", "BA12", "BA13", "BA14",
    "BE1", "BS1", "BS2", "BX1", "BW1", "BW2", "B19", "B20", "BA15", "BA16", "BA17", "BA18", "BW3", "BW4", "B21", "B22", "BA19",
  ];
  it("every row is one a test here runs a part of, or one whose every step is the gate's", () => {
    const run = rowsOf(B.rows as { name: string }[], "buyer.json rows", {
      exact: RUN.length,
      keep: ["the rows a test here runs a part of", (r) => RUN.includes(r.name)],
      leave: ["the rows whose every step is the gate's, which the buyer packages run whole", (r) => r.name in GATE_ONLY],
    });
    expect(run.map((r) => r.name)).toEqual(RUN);
    expect((B.rows as { name: string }[]).filter((r) => r.name in GATE_ONLY).map((r) => r.name)).toEqual(Object.keys(GATE_ONLY));
  });
});

// docs/concepts/vectors.md: refusal codes are this package's own, and a file's agreedRefusals rows hold the codes for
// checks its specification leaves to the implementation. An about that says some rows are marked with a member names a
// member a row carries as true, and a row carries no marker its file's about does not explain.
describe("every vector file's about names only the markers its rows carry", () => {
  const dir = new URL("../vectors/", import.meta.url);
  const files = rowsOf(readdirSync(dir).filter((n) => n.endsWith(".json")), "vectors/, the .json files", {
    exact: readdirSync(dir).length,
  });
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
