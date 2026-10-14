// Runs the Polkadot vector file through the polkadot entry point. Every expected value is the file's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blake2b } from "@noble/hashes/blake2.js";
import { pairingOf, toLcpString, type AtrHash } from "../src/index.js";
import {
  decodeProfileCall,
  encodeProfileCall,
  exactPolkadotRemark,
  extrinsicHash,
  polkadotLocate,
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

  // SCALE's Compact<u32> and Compact<u128> hold unsigned values below 2^32 and 2^128, an AccountId32 is 32 bytes, and
  // profile rule 3's remark is 77 bytes: decodeProfileCall gives nothing else back, so the encoder takes nothing else.
  it("encodeProfileCall: V2's call from V2's values, and TypeError on a call outside the profile's types", () => {
    const remark = new TextEncoder().encode(toLcpString(H));
    const dest = ss58Decode(O.payTo) as Uint8Array;
    const ok = { assetId: Number(O.asset), dest, amount: BigInt(O.amount), remark };
    expect(toHex(encodeProfileCall(ok))).toBe(V.V2.expectCall);
    for (const edge of [{ assetId: 2 ** 32 - 1 }, { amount: 2n ** 128n - 1n }, { assetId: 0, amount: 0n }]) {
      const c = { ...ok, ...edge };
      const back = decodeProfileCall(encodeProfileCall(c));
      if ("refused" in back) throw new Error(back.code);
      expect([back.assetId, back.amount]).toEqual([c.assetId, c.amount]);
    }
    const outside: [string, unknown][] = [
      ["amount -1n", { ...ok, amount: -1n }],
      ["amount -64n", { ...ok, amount: -64n }],
      ["amount 2^128", { ...ok, amount: 2n ** 128n }],
      ["amount as a number", { ...ok, amount: 10000 }],
      ["assetId -1", { ...ok, assetId: -1 }],
      ["assetId 2^32", { ...ok, assetId: 2 ** 32 }],
      ["assetId 1.5", { ...ok, assetId: 1.5 }],
      ["dest of 31 bytes", { ...ok, dest: dest.subarray(1) }],
      ["remark of 76 bytes", { ...ok, remark: remark.subarray(1) }],
      ["null", null],
      ["{}", {}],
    ];
    for (const [name, c] of outside) expect(() => encodeProfileCall(c as never), name).toThrow(TypeError);
    // A member read twice could pass the check with one value and be encoded with another.
    let reads = 0;
    const shifting = { ...ok, get amount() { return reads++ === 0 ? 10000n : -1n; } };
    const once = decodeProfileCall(encodeProfileCall(shifting));
    if ("refused" in once) throw new Error(once.code);
    expect([once.amount, reads]).toEqual([10000n, 1]);
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

  // docs/reference/refusals.md: polkadot/extrinsic-too-large is an extrinsic, or the raw extrinsic a recovery reads,
  // longer than 4,096 bytes; polkadot/extrinsic-malformed is text that is not hex. The resized extrinsics keep V3's
  // signed preamble and its call, with zero bytes added before the call where the extensions sit, under a SCALE
  // Compact<u32> length prefix in its two-byte mode, ((n << 2) | 1) little-endian for n from 64 to 16,383.
  it("V3 resized: over 4,096 bytes is polkadot/extrinsic-too-large at bound, reference, complete and recover", async () => {
    const v3 = fromHex(V.V3.extrinsic);
    expect(v3[0]! & 3).toBe(1);
    const body = v3.subarray(2);
    const call = fromHex(V.V2.expectCall);
    const resized = (total: number) => {
      const n = total - 2;
      const out = new Uint8Array(total);
      out.set([((n << 2) | 1) & 0xff, n >> 6]);
      out.set(body.subarray(0, body.length - call.length), 2);
      out.set(call, total - call.length);
      return out;
    };
    const [at, over] = [resized(4096), resized(4097)];
    expect([at.length, over.length]).toEqual([4096, 4097]);
    // The vector rows that pin the bound for every runner are these two extrinsics.
    const overRow = V.V3.refusals.find((r: { case: string }) => r.case.startsWith("V3 resized to 4,097 bytes, one over"));
    expect([V.V3.atBound.extrinsic, overRow.extrinsic]).toEqual([toHex(at), toHex(over)]);
    expect(await exactPolkadotRemark.bound(presentedOf(V.V3.atBound.extrinsic, V.V3.atBound.call))).toBe(V.V3.atBound.expectBound);
    expect(await exactPolkadotRemark.bound(presentedOf(toHex(at), V.V2.expectCall))).toBe(V.V3.expectBound);
    const tooLarge = { refused: true, code: "polkadot/extrinsic-too-large" };
    const malformed = { refused: true, code: "polkadot/extrinsic-malformed" };
    expect(await exactPolkadotRemark.bound(presentedOf(toHex(over), V.V2.expectCall))).toEqual(tooLarge);
    expect(await exactPolkadotRemark.reference(presentedOf(toHex(over), V.V2.expectCall))).toEqual(tooLarge);
    expect((await unsigned()).complete(over)).toEqual(tooLarge);
    expect(await exactPolkadotRemark.bound(presentedOf(toHex(over).toUpperCase().replace("0X", "0x"), V.V2.expectCall))).toEqual(
      malformed,
    );

    const transaction = `${V.V4.block}-${V.V4.index}`;
    const recoverWith = (raw: string) => {
      const raws = [...V.V4.raw];
      raws[V.V4.index] = raw;
      const reader: PolkadotReader = { ...readerOf({ finalized: "100" }), rawExtrinsics: async () => raws };
      return exactPolkadotRemark.recover({ network: V.V4.readerNetwork, transaction }, reader);
    };
    expect(await recoverWith(toHex(over))).toEqual(tooLarge);
    expect(await recoverWith(toHex(over).toUpperCase().replace("0X", "0x"))).toEqual(tooLarge);
    expect(await recoverWith(`0x${"zz".repeat(4097)}`)).toEqual(malformed);
    expect(await recoverWith(toHex(at))).toEqual({ refused: true, code: "polkadot/hash-mismatch" });
  });

  // The genesis hash that names a network is implicit data of the signed payload (frame_system's CheckGenesis signed
  // extension), never a byte of the extrinsic: V3's bytes under a Westend Asset Hub option keep their hash and asset
  // and take the option's network.
  it("V3: reference takes the network from the accepted option, and the hash and asset from the signed bytes", async () => {
    const westend = { ...O, network: "polkadot:67f9723393ef76214df0118c34bbbd3d" };
    const presented = { x402Version: 2 as const, accepted: westend, payload: { extrinsic: V.V3.extrinsic, call: V.V2.expectCall } };
    expect(await exactPolkadotRemark.reference(presented as never)).toEqual({ ...V.V3.expectReference, network: westend.network });
  });

  // The pairing's proves states that the extrinsic's bytes end with the profile call, not that its call is the profile
  // call: bound reads the call as the bytes' suffix and decodes nothing before it. Here the extrinsic's own call is
  // pallet_utility's batch (call index [40, 0]) of a remark_with_event of the hash's LCP string, a
  // transfer_keep_alive of one unit to the signer, and a remark_with_event whose bytes are the profile call (SCALE
  // Vec<u8>: a Compact<u32> length, then the bytes). Its bytes still end with the profile call, so it binds.
  it("V3 nested: an extrinsic whose own call is another batch ending in the profile call's bytes binds H", async () => {
    const v3 = fromHex(V.V3.extrinsic);
    const call = fromHex(V.V2.expectCall);
    const split = splitSigned(v3);
    if ("refused" in split) throw new Error(split.code);
    const compact = (n: number) => (n < 64 ? [n << 2] : [((n << 2) | 1) & 0xff, n >> 6]);
    const remark = [...new TextEncoder().encode(toLcpString(H))];
    const signer = [...split.signer];
    const nested = [
      ...[40, 0, ...compact(3)],
      ...[0, 7, ...compact(remark.length), ...remark],
      ...[50, 9, ...compact(Number(O.asset)), 0x00, ...signer, ...compact(1)],
      ...[0, 7, ...compact(call.length)],
    ];
    const body = [...v3.subarray(2, v3.length - call.length), ...nested, ...call];
    const xt = toHex(Uint8Array.from([...compact(body.length), ...body]));
    expect(await exactPolkadotRemark.bound(presentedOf(xt, V.V2.expectCall))).toBe(V.V3.expectBound);
    const ref = await exactPolkadotRemark.reference(presentedOf(xt, V.V2.expectCall));
    expect(ref).toEqual({ ...V.V3.expectReference, extrinsicHash: extrinsicHash(fromHex(xt)) });
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

  it("V4: a ref whose extrinsic hash or asset id is not of the form reference writes is pending unreadable, with nothing read", async () => {
    const ref = { ...V.V4.reference, h: H, transaction: `${V.V4.block}-${V.V4.index}` };
    expect(withStrings(await polkadotStatus(ref, readerOf({ finalized: "100" })))).toEqual(V.V4.status[0].expect);
    for (const [k, v] of [["extrinsicHash", null], ["extrinsicHash", "0x12"], ["assetId", null], ["assetId", "1337"], ["assetId", -1]] as const) {
      let reads = 0;
      const counted = new Proxy(readerOf({ finalized: "100" }), {
        get: (t, p) => (p === "network" ? t.network : (...a: never[]) => (reads++, (t as never as Record<string, (...x: never[]) => unknown>)[p as string]!(...a))),
      });
      expect(await polkadotStatus({ ...ref, [k]: v } as never, counted), `${k} ${String(v)}`).toEqual({ state: "pending", why: "unreadable" });
      expect(reads, `${k} ${String(v)}`).toBe(0);
    }
  });

  it("V4: locate refuses a ref whose extrinsic hash is not 0x and 64 hex digits as polkadot/wrong-reader, with nothing read", async () => {
    const found = V.V4.locate[0];
    const range = [BigInt(found.from), BigInt(found.to)] as const;
    expect(await polkadotLocate(V.V4.reference, readerOf({ finalized: "100" }), ...range)).toBe(found.expect);
    for (const v of [undefined, null, 1, "0x12", V.V4.reference.extrinsicHash.slice(2)]) {
      let reads = 0;
      const counted = new Proxy(readerOf({ finalized: "100" }), {
        get: (t, p) => (p === "network" ? t.network : (...a: never[]) => (reads++, (t as never as Record<string, (...x: never[]) => unknown>)[p as string]!(...a))),
      });
      const got = await polkadotLocate({ ...V.V4.reference, extrinsicHash: v } as never, counted, ...range);
      expect(got, String(v)).toEqual({ refused: true, code: "polkadot/wrong-reader" });
      expect(reads, String(v)).toBe(0);
    }
  });

  it("V4: recover and locate", async () => {
    const reader = readerOf({ finalized: "100" });
    const transaction = `${V.V4.block}-${V.V4.index}`;
    expect(await exactPolkadotRemark.recover({ network: V.V4.readerNetwork, transaction }, reader)).toBe(V.V4.recover.expect);
    for (const row of V.V4.locate) {
      const got = await polkadotLocate(V.V4.reference, readerOf({ finalized: "100", ...row }), BigInt(row.from), BigInt(row.to));
      expect(got === null || typeof got === "string" ? got : got.code, row.case).toBe(row.expect);
    }
    for (const row of V.V4.recoverRefusals) {
      const raw = [...V.V4.raw];
      raw[V.V4.index] = row.raw;
      const upper: PolkadotReader = { ...reader, rawExtrinsics: async () => raw };
      expect(await exactPolkadotRemark.recover({ network: V.V4.readerNetwork, transaction }, upper), row.case).toEqual({
        refused: true,
        code: row.expect,
      });
    }
  });

  it("V4: recover reads the record status reads, and needs the profile call and a transfer of its asset", async () => {
    const transaction = `${V.V4.block}-${V.V4.index}`;
    expect(V.V4.recoverReads.length).toBeGreaterThan(0);
    for (const row of V.V4.recoverReads) {
      const raw = [...V.V4.raw];
      if (row.raw !== undefined) raw[V.V4.index] = row.raw;
      const reader: PolkadotReader = { ...readerOf(row), rawExtrinsics: async () => raw };
      const got = await exactPolkadotRemark.recover({ network: V.V4.readerNetwork, transaction }, reader);
      expect(typeof got === "string" ? got : got.code, row.case).toBe(row.expect);
    }
  });

  it("plant: a transfer of another asset at the named position is never the settlement", async () => {
    const ref = { ...V.V4.reference, h: H, transaction: `${V.V4.block}-${V.V4.index}` };
    expect(withStrings(await polkadotStatus(ref, readerOf({ finalized: "100", change: V.plant.change })))).toEqual(V.plant.expect);
  });

  it("the option filter, advertise and read", () => {
    expect(pairingOf(O)).toBe("x402/exact/polkadot/lcp-assets-remark");
    for (const row of V.options) {
      expect(pairingOf(row.option), row.case).toBeUndefined();
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
