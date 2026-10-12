// Runs vectors/x402-exact-casper.json through the casper entry point. Every expected value is the file's (C1–C4 and
// the plant, each naming its source there); the digest is also recomputed with the toolkit CEP-3009 names.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CASPER_DOMAIN_TYPES,
  hashDomainSeparator,
  hashStruct,
  hashTypedData,
  computeTypeHash,
  buildCanonicalTypeString,
  toHex,
} from "@casper-ecosystem/casper-eip-712";
import type { AtrHash } from "../src/index.js";
import { ReaderError } from "../src/evm.js";
import { counting } from "./fixtures/counting-reader.js";
import { LEGAL_CONTEXT_SCHEMA, type PaymentRequired, type PaymentRequirements } from "../src/x402.js";
import {
  CASPER_DOMAIN_TYPEHASH,
  exactCasper,
  type CasperCall,
  type CasperPaymentPayload,
  type CasperReader,
  type CasperUnsigned,
} from "../src/casper.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-casper.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const required = (o: PaymentRequirements = O): PaymentRequired => ({ x402Version: 2, resource: V.fixed.resource, accepts: [o] });
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

async function unsigned(): Promise<CasperUnsigned> {
  const u = await exactCasper.build({ required: required(), accepted: O, from: V.fixed.from, now: V.fixed.now }, H);
  if ("refused" in u) throw new Error(u.code);
  return u;
}

type FixtureCall = null | "reader-error" | {
  executed: boolean; blockHeight: string | null; error: string | null; packageHash: string | null;
  entryPoint: string | null; args: { from?: string; to?: string; value?: string; nonce?: string };
};
function readerFor(c: FixtureCall, network: string = V.C4.reader.network): CasperReader {
  return {
    network: network as CasperReader["network"],
    async transaction(): Promise<CasperCall | null> {
      if (c === "reader-error") throw new ReaderError("transport");
      if (c === null) return null;
      return {
        ...c,
        blockHeight: c.blockHeight === null ? null : BigInt(c.blockHeight),
        args: {
          ...(c.args.from !== undefined ? { from: c.args.from } : {}),
          ...(c.args.to !== undefined ? { to: c.args.to } : {}),
          ...(c.args.value !== undefined ? { value: BigInt(c.args.value) } : {}),
          ...(c.args.nonce !== undefined ? { nonce: fromHex(c.args.nonce) } : {}),
        },
      };
    },
  };
}
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

function mutate(base: unknown, changes: Record<string, unknown>): unknown {
  const copy = structuredClone(base) as Record<string, unknown>;
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    let at = copy as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    if (value === null) delete at[keys[keys.length - 1]!];
    else at[keys[keys.length - 1]!] = value;
  }
  return copy;
}

describe("x402/exact/casper", () => {
  it("C1: build's typed data hashes to CEP-3009's digest under the toolkit", async () => {
    const { request } = await unsigned();
    expect(request.kind).toBe("casper-eip712");
    const td = request.typedData;
    expect(td.domain).toEqual(V.C1.expectDomain);
    expect(plain(td.message)).toEqual(V.C1.expectMessage);
    expect(td.types.EIP712Domain).toEqual(CASPER_DOMAIN_TYPES);
    const types = { TransferWithAuthorization: td.types.TransferWithAuthorization };
    const typeString = buildCanonicalTypeString("TransferWithAuthorization", types);
    expect(toHex(computeTypeHash(typeString))).toBe(V.C1.expectTypeHash);
    const domainTypeString = `EIP712Domain(${CASPER_DOMAIN_TYPES.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(toHex(computeTypeHash(domainTypeString))).toBe(V.C1.expectDomainTypeHash);
    expect(CASPER_DOMAIN_TYPEHASH).toBe(V.C1.expectDomainTypeHash);
    expect(toHex(hashDomainSeparator(td.domain, CASPER_DOMAIN_TYPES))).toBe(V.C1.expectDomainSeparator);
    const message = { ...td.message, nonce: `0x${td.message.nonce}` };
    expect(toHex(hashStruct("TransferWithAuthorization", types, message))).toBe(V.C1.expectStructHash);
    const digest = hashTypedData(td.domain, types, td.primaryType, message, { domainTypes: CASPER_DOMAIN_TYPES });
    expect(toHex(digest)).toBe(V.C1.expectDigest);
  });

  it("C2: complete, then bound gives H", async () => {
    const payment = (await unsigned()).complete(V.fixed.publicKey, V.fixed.signature) as CasperPaymentPayload;
    expect(payment).toEqual(V.C2.expectPayload);
    expect(await exactCasper.bound(payment)).toBe(V.C2.expectBound);
    const prefixed = mutate(payment, { "payload.authorization.nonce": H }) as CasperPaymentPayload;
    expect(await exactCasper.bound(prefixed)).toBe(V.C2.boundOfPrefixedNonce);
    const upper = mutate(payment, { "payload.authorization.nonce": H.slice(2).toUpperCase() }) as CasperPaymentPayload;
    expect(await exactCasper.bound(upper)).toBe(V.C2.boundOfUpperCaseNonce);
    expect((await unsigned()).complete(V.C2.tagMismatch.publicKey, V.C2.tagMismatch.signature)).toEqual(
      V.C2.tagMismatch.expect,
    );
  });

  it("C3: reference", async () => {
    const payment = (await unsigned()).complete(V.fixed.publicKey, V.fixed.signature) as CasperPaymentPayload;
    expect(await exactCasper.reference(payment)).toEqual(V.C3.expect);
  });

  describe("C3: settleBy for a validBefore past Number.MAX_SAFE_INTEGER", () => {
    type Row = { case: string; mutate: Record<string, string>; expect: { settleBy?: number } };
    for (const row of V.C3.rows as Row[]) {
      it(row.case, async () => {
        const payment = mutate(V.C2.expectPayload, row.mutate) as CasperPaymentPayload;
        expect(await exactCasper.reference(payment)).toEqual(row.expect);
      });
    }

    it("the rows' values: 2^53-1 is ECMAScript's Number.MAX_SAFE_INTEGER, and 2^64-1 and 2^64 bracket a u64", () => {
      const rows = V.C3.rows as Row[];
      const before = rows.map((r) => BigInt(r.mutate["payload.authorization.validBefore"]!));
      expect(before).toEqual([2n ** 53n - 1n, 2n ** 53n, 2n ** 64n - 1n, 2n ** 64n]);
      for (const r of rows.filter((r) => r.expect.settleBy !== undefined)) expect(r.expect.settleBy).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("build signs a validBefore past 2^53-1 for the largest maxTimeoutSeconds the filter admits, and reference records it", async () => {
      const o = { ...O, maxTimeoutSeconds: Number.MAX_SAFE_INTEGER };
      const u = await exactCasper.build({ required: required(o), accepted: o, from: V.fixed.from, now: V.fixed.now }, H);
      const payment = (u as CasperUnsigned).complete(V.fixed.publicKey, V.fixed.signature) as CasperPaymentPayload;
      expect(BigInt(payment.payload.authorization.validBefore)).toBe(BigInt(V.fixed.now) + BigInt(Number.MAX_SAFE_INTEGER));
      expect(await exactCasper.reference(payment)).toEqual({ ...V.C3.expect, settleBy: Number.MAX_SAFE_INTEGER });
    });
  });

  describe("C4: status and recover", () => {
    for (const row of V.C4.rows) {
      it(row.case, async () => {
        const reader = readerFor(row.call);
        expect(plain(await exactCasper.status(V.C4.ref, reader))).toEqual(row.expectStatus);
        const recovered = await exactCasper.recover(
          { network: V.C4.ref.network, asset: V.C4.ref.asset, transaction: V.C4.transaction },
          reader,
        );
        expect(recovered).toEqual(row.expectRecover);
      });
    }
    it("a reader for another network", async () => {
      const reader = readerFor(V.C4.rows[0].call, V.C4.wrongReader.network);
      expect(await exactCasper.status(V.C4.ref, reader)).toEqual(V.C4.wrongReader.expectStatus);
      expect(
        await exactCasper.recover({ network: V.C4.ref.network, asset: V.C4.ref.asset, transaction: V.C4.transaction }, reader),
      ).toEqual(V.C4.wrongReader.expectRecover);
    });
    // A missing or malformed ref field cannot name the landed call, so the read is pending, never failed
    // (docs/guides/rails.md, "Reading settlement"); a hash in either case is the same 32 bytes.
    it("a ref whose h, idDigest or asset is malformed is pending unreadable, with nothing read", async () => {
      const ref = V.C4.ref;
      const landed = V.C4.rows[0];
      const malformed = [
        { h: undefined }, { h: "0x12" }, { h: `0X${ref.h.slice(2)}` }, { h: ref.h.slice(2) },
        { idDigest: undefined }, { idDigest: ref.idDigest.slice(2) }, { idDigest: `0x${ref.idDigest.slice(4)}` },
        { asset: undefined }, { asset: `0x${ref.asset}` }, { asset: ref.asset.slice(2) },
      ];
      for (const change of malformed) {
        const { reader, calls } = counting(readerFor(landed.call));
        expect(await exactCasper.status({ ...ref, ...change }, reader)).toEqual({ state: "pending", why: "unreadable" });
        expect(calls).toEqual([]);
      }
      const upper = (s: string) => `0x${s.slice(2).toUpperCase()}`;
      for (const change of [{ h: upper(ref.h) }, { idDigest: upper(ref.idDigest) }, { asset: ref.asset.toUpperCase() }]) {
        expect(plain(await exactCasper.status({ ...ref, ...change }, readerFor(landed.call)))).toEqual(landed.expectStatus);
      }
    });
  });

  it("plant: an authorization call on another package is never the settlement", async () => {
    expect(await exactCasper.status(V.C4.ref, readerFor(V.plant.call))).toEqual(V.plant.expectStatus);
  });

  describe("refusal codes left to the implementation", () => {
    for (const row of V.refusals.rows) {
      it(row.case, async () => {
        if (row.fn === "bound" || row.fn === "reference") {
          const payment = mutate(V.C2.expectPayload, row.mutate) as CasperPaymentPayload;
          expect(await exactCasper[row.fn as "bound" | "reference"](payment)).toEqual(row.expect);
        } else if (row.fn === "build") {
          const option = { ...O, ...(row.optionMutate ?? {}) } as PaymentRequirements;
          const from = row.from ?? V.fixed.from;
          expect(await exactCasper.build({ required: required(option), accepted: option, from, now: V.fixed.now }, H)).toEqual(
            row.expect,
          );
        } else {
          expect((await unsigned()).complete(row.publicKey, row.signature)).toEqual(row.expect);
        }
      });
    }
  });

  it("advertise and read: the legal context in extensions.legalContext, accepts untouched", () => {
    const doc = exactCasper.advertise(required(), H, V.fixed.link, O);
    expect(doc).toEqual({
      ...required(),
      extensions: {
        legalContext: { info: { type: "sha256", value: H, legalContextUrl: V.fixed.link }, schema: LEGAL_CONTEXT_SCHEMA },
      },
    });
    const read = exactCasper.read(doc as PaymentRequired);
    expect(read).toEqual({ h: H, link: V.fixed.link, offer: { required: doc, options: [O] } });
    expect(exactCasper.advertise(required(), H, "http://atr.seller.example/x", O)).toEqual({
      refused: true,
      code: "x402/link-not-https",
    });
    const evm = { ...O, network: "eip155:84532" };
    expect(exactCasper.advertise(required(evm), H, V.fixed.link, evm)).toEqual({
      refused: true,
      code: "x402/option-not-this-pairing",
    });
  });

  it("unplaced is the identity", () => {
    expect(exactCasper.unplaced(O)).toBe(O);
  });
});
