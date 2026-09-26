// Runs the Polkadot vector file through the polkadot entry point. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blake2b } from "@noble/hashes/blake2.js";
import { toLcpString, type AtrHash } from "../src/index.js";
import {
  exactPolkadotRemark,
  extrinsicHash,
  polkadotLocate,
  polkadotPairingOf,
  polkadotStatus,
  splitSigned,
  ss58Decode,
  type PolkadotExtrinsic,
  type PolkadotReader,
  type PolkadotUnsigned,
} from "../src/polkadot.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-polkadot-lcp-assets-remark.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const toHex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));
const withStrings = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

type Row = {
  finalized?: string;
  canonical?: string;
  canonicalExtrinsicHash?: `0x${string}`;
  canonicalMissing?: boolean;
  change?: Partial<PolkadotExtrinsic>;
  missing?: boolean;
  readerError?: boolean;
};
function readerOf(row: Row): PolkadotReader {
  const base = V.V4.extrinsicAt;
  const named = (): PolkadotExtrinsic => ({
    ...base,
    at: { height: BigInt(base.at.height), hash: base.at.hash },
    ...(row.change ?? {}),
  });
  return {
    network: V.V4.readerNetwork,
    extrinsic: async (block, index) => {
      if (row.readerError) throw new Error("transport");
      if (index !== V.V4.index) return null;
      if (block === V.V4.block) return row.missing ? null : named();
      if (block === BigInt(base.at.height)) {
        if (row.canonicalMissing) return null;
        const at = { height: BigInt(base.at.height), hash: row.canonical ?? V.V4.block };
        return { ...named(), at, ...(row.canonicalExtrinsicHash !== undefined ? { hash: row.canonicalExtrinsicHash } : {}) };
      }
      return null;
    },
    rawExtrinsics: async (block) => {
      if (row.readerError) throw new Error("transport");
      if (block === V.V4.block || block === BigInt(base.at.height)) return V.V4.raw;
      if (typeof block === "bigint" && block >= 90n && block <= 110n) return ["0x00"];
      return null;
    },
    finalizedHeight: async () => {
      if (row.readerError) throw new Error("transport");
      return BigInt(row.finalized ?? "0");
    },
  };
}

describe("x402-exact-polkadot-lcp-assets-remark.json", () => {
  const required: PaymentRequired = { x402Version: 2, resource: V.fixed.resource, accepts: [O] };
  const unsigned = async () => {
    const u = await exactPolkadotRemark.build({ required, accepted: O }, H);
    if ("refused" in u) throw new Error(u.code);
    return u as PolkadotUnsigned;
  };
  const presentedOf = (extrinsic: string, call: string) => ({ x402Version: 2 as const, accepted: O, payload: { extrinsic, call } }) as never;

  it("V1: a real extrinsic's hash and signer; its assets.transfer call is not the profile", async () => {
    const xt = fromHex(V.V1.extrinsic);
    expect(extrinsicHash(xt)).toBe(V.V1.expectHash);
    const split = splitSigned(xt);
    if ("refused" in split) throw new Error(split.code);
    expect(toHex(split.signer)).toBe(V.V1.expectSigner);
    const call = toHex(xt.subarray(xt.length - V.V1.callBytes));
    expect(await exactPolkadotRemark.bound(presentedOf(V.V1.extrinsic, call))).toEqual({ refused: true, code: V.V1.expectBound });
  });

  it("V2: build's call, and the payee's account", async () => {
    const u = await unsigned();
    expect(u.request.kind).toBe("substrate-call");
    expect(u.request.network).toBe(O.network);
    expect(toHex(u.request.call)).toBe(V.V2.expectCall);
    expect(u.request.call.length).toBe(V.V2.expectCallLength);
    expect(toHex(ss58Decode(O.payTo) as Uint8Array)).toBe(V.V2.expectDest);
  });

  it("V3: complete, bound and reference of the accepted extrinsic, and the refusals", async () => {
    const xt = fromHex(V.V3.extrinsic);
    expect(xt.length).toBe(V.V3.expectLength);
    expect(extrinsicHash(xt)).toBe(V.V3.expectHash);
    const payment = (await unsigned()).complete(xt);
    if ("refused" in payment) throw new Error(payment.code);
    expect(payment.payload).toEqual({ extrinsic: V.V3.extrinsic, call: V.V2.expectCall });
    expect(await exactPolkadotRemark.bound(payment)).toBe(V.V3.expectBound);
    const ref = await exactPolkadotRemark.reference(payment);
    expect(ref).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of V.V3.refusals) {
      expect(await exactPolkadotRemark.bound(presentedOf(row.extrinsic, row.call))).toEqual({ refused: true, code: row.expect });
    }
  });

  it("V4: the remark hash", () => {
    const remark = new TextEncoder().encode(toLcpString(H));
    expect(toHex(blake2b(remark, { dkLen: 32 }))).toBe(V.V4.expectRemarkHash);
  });

  it("V4: status for each fixture", async () => {
    for (const row of V.V4.status) {
      const ref = {
        ...V.V4.reference,
        ...(row.refHash !== undefined ? { extrinsicHash: row.refHash } : {}),
        h: H,
        transaction: row.transaction ?? `${V.V4.block}-${V.V4.index}`,
      };
      expect(withStrings(await polkadotStatus(ref, readerOf(row))), row.case).toEqual(row.expect);
    }
  });

  it("V4: recover and locate", async () => {
    const reader = readerOf({ finalized: "100" });
    const transaction = `${V.V4.block}-${V.V4.index}`;
    expect(await exactPolkadotRemark.recover({ network: V.V4.readerNetwork, transaction }, reader)).toBe(V.V4.recover.expect);
    for (const row of V.V4.locate) {
      const got = await polkadotLocate(V.V4.reference, reader, BigInt(row.from), BigInt(row.to));
      expect(typeof got === "string" ? got : got?.code).toBe(row.expect);
    }
  });

  it("plant: a transfer of another asset at the named position is never the settlement", async () => {
    const ref = { ...V.V4.reference, h: H, transaction: `${V.V4.block}-${V.V4.index}` };
    expect(withStrings(await polkadotStatus(ref, readerOf({ finalized: "100", change: V.plant.change })))).toEqual(V.plant.expect);
  });

  it("the option filter, advertise and read", () => {
    expect(polkadotPairingOf(O)).toBe("x402/exact/polkadot/lcp-assets-remark");
    for (const row of V.options) {
      const doc = { ...required, accepts: [row.option] };
      expect(exactPolkadotRemark.advertise(doc, H, V.fixed.link, row.option), row.case).toEqual({ refused: true, code: row.expect });
    }
    const doc = exactPolkadotRemark.advertise(required, H, V.fixed.link, O);
    if ("refused" in doc) throw new Error(doc.code);
    expect(doc.accepts[0]).toEqual(O);
    const r = exactPolkadotRemark.read(doc);
    if ("refused" in r) throw new Error(r.code);
    expect([r.h, r.link, r.offer.options]).toEqual([H, V.fixed.link, [O]]);
  });
});
