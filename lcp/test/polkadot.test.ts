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
  polkadotStatus,
  splitSigned,
  ss58Decode,
  type PolkadotExtrinsic,
  type PolkadotReader,
  type PolkadotUnsigned,
} from "../src/polkadot.js";
import type { PaymentRequired, PaymentRequirements } from "../src/x402.js";
import { rowsOf } from "./rows.js";
import { TypeRegistry } from "@polkadot/types";
import type { ExtrinsicSignatureV4 } from "@polkadot/types/interfaces";

/**
 * Polkadot Asset Hub's transaction extensions, in the runtime's order: the identifiers of the `TxExtensionV0` a signed v4
 * extrinsic carries (polkadot-fellows/runtimes at 30696143, system-parachains/asset-hubs/asset-hub-polkadot/src/lib.rs:3136-3148).
 */
const ASSET_HUB_EXTENSIONS = [
  "AuthorizeCall",
  "CheckNonZeroSender",
  "CheckSpecVersion",
  "CheckTxVersion",
  "CheckGenesis",
  "CheckMortality",
  "CheckNonce",
  "CheckWeight",
  "ChargeAssetTxPayment",
  "PrevalidateAttests",
  "CheckMetadataHash",
  "EthSetOrigin",
  "StorageWeightReclaim",
] as const;

const V = JSON.parse(readFileSync(new URL("../vectors/x402-exact-polkadot-lcp-assets-remark.json", import.meta.url), "utf8"));
const H: AtrHash = V.fixed.H;
const O: PaymentRequirements = V.fixed.O;
const toHex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));
const Q = { act: "payment", finality: "finalized" } as const;
const UNPARSEABLE = { state: "unreadable", reason: "unparseable", foreign: [] };
const withStrings = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

type Row = {
  finalized?: string;
  head?: string;
  nonceFinal?: string;
  nonceHead?: string;
  valid?: string;
  canonical?: string;
  canonicalExtrinsicHash?: `0x${string}`;
  canonicalMissing?: boolean;
  change?: Partial<PolkadotExtrinsic>;
  missing?: boolean;
  readerError?: boolean;
  raws?: string[];
  signer?: string;
};
/**
 * A reader of the file's fixtures: V4's raw extrinsics at block 100 (or the row's `raws`), and one bare item at every
 * other height from 90 to 120; V4's record at index 2 of block 100, as the row changes it; the row's heights, nonces and
 * validation. Sidecar answers a block by its hash or its height.
 */
function readerOf(row: Row): PolkadotReader {
  const base = V.V4.extrinsicAt;
  const height = BigInt(base.at.height);
  const named = (): PolkadotExtrinsic => ({
    ...base,
    at: { height, hash: base.at.hash },
    ...(row.change ?? {}),
  });
  const fail = () => {
    if (row.readerError) throw new Error("transport");
  };
  return {
    network: V.V4.readerNetwork,
    extrinsic: async (block, index) => {
      fail();
      if (index !== V.V4.index) return null;
      if (block === V.V4.block) return row.missing ? null : named();
      if (block === height) {
        if (row.canonicalMissing) return null;
        const at = { height, hash: row.canonical ?? V.V4.block };
        return { ...named(), at, ...(row.canonicalExtrinsicHash !== undefined ? { hash: row.canonicalExtrinsicHash } : {}) };
      }
      return null;
    },
    rawExtrinsics: async (block) => {
      fail();
      if (block === V.V4.block || block === height) return row.raws ?? V.V4.raw;
      // A bare v4 item: its length, the version byte 0x04 and a two-byte call; the search passes it.
      if (typeof block === "bigint" && block >= 90n && block <= 120n) return ["0x0c040000"];
      return null;
    },
    finalizedHeight: async () => (fail(), BigInt(row.finalized ?? "0")),
    headHeight: async () => (fail(), BigInt(row.head ?? row.finalized ?? "0")),
    accountNonce: async (_account, at) => (fail(), BigInt((at === "finalized" ? row.nonceFinal : row.nonceHead) ?? "0")),
    validate: async () => (fail(), row.valid === undefined || row.valid === "invalid" ? { valid: false, head: 0n } : { valid: true, head: BigInt(row.valid) }),
  };
}

/** The status query of a V4 row: its act, the act payment where it names none, at its finality, after its position. */
const queryOf = (row: { act?: string; finality?: string; after?: string }) =>
  ({
    ...Q,
    act: (row.act ?? "payment") as "payment",
    finality: (row.finality ?? "finalized") as "finalized",
    ...(row.after === undefined ? {} : { after: BigInt(row.after) }),
  });

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
    const ref = await exactPolkadotRemark.reference(payment, O);
    expect(ref).toEqual(V.V3.expectReference);
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref);
    for (const row of rowsOf(V.V3.refusals, "x402-exact-polkadot-lcp-assets-remark.json V3.refusals")) {
      expect(await exactPolkadotRemark.bound(presentedOf(row.extrinsic, row.call))).toEqual({ refused: true, code: row.expect });
    }
  });

  // docs/reference/refusals.md: polkadot/extrinsic-too-large is an extrinsic, or the raw extrinsic a recovery reads,
  // longer than 4,096 bytes; polkadot/extrinsic-malformed is text that is not hex. The resized extrinsics keep V3's
  // signed preamble and its call, with zero bytes added before the call where the extensions sit, under a SCALE
  // Compact<u32> length prefix in its two-byte mode, ((n << 2) | 1) little-endian for n from 64 to 16,383. recover reads
  // a raw extrinsic only when the chain's record of it has its BLAKE2b-256 as its hash (the Polkadot SDK hashes an
  // extrinsic's SCALE bytes with BlakeTwo256), so the record here carries the raw's hash; Sidecar answers each raw
  // extrinsic as hex, so raw text that is not hex, or bytes whose hash is not the record's, is the reader's answer out
  // of its documented form.
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
    expect(await exactPolkadotRemark.reference(presentedOf(toHex(over), V.V2.expectCall), O)).toEqual(tooLarge);
    expect((await unsigned()).complete(over)).toEqual(tooLarge);
    expect(await exactPolkadotRemark.bound(presentedOf(toHex(over).toUpperCase().replace("0X", "0x"), V.V2.expectCall))).toEqual(
      malformed,
    );

    const transaction = `${V.V4.block}-${V.V4.index}`;
    const recoverWith = (raw: string, recordHash?: string) => {
      const raws = [...V.V4.raw];
      raws[V.V4.index] = raw;
      const change = recordHash === undefined ? {} : { change: { hash: recordHash as `0x${string}` } };
      const reader: PolkadotReader = { ...readerOf({ finalized: "100", ...change }), rawExtrinsics: async () => raws };
      return exactPolkadotRemark.recover({ network: V.V4.readerNetwork, tx: transaction, option: O }, reader);
    };
    const unreadable = { refused: true, code: "polkadot/unreadable" };
    const b2 = (b: Uint8Array) => toHex(blake2b(b, { dkLen: 32 }));
    expect(await recoverWith(toHex(over), b2(over))).toEqual(tooLarge);
    expect(await recoverWith(toHex(over).toUpperCase().replace("0X", "0x"), b2(over))).toEqual(tooLarge);
    expect(await recoverWith(`0x${"zz".repeat(4097)}`)).toEqual(unreadable);
    expect(await recoverWith(toHex(at), b2(at))).toBe(V.V3.atBound.expectBound);
    expect(await recoverWith(toHex(over))).toEqual(unreadable);
    expect(await recoverWith(toHex(at))).toEqual(unreadable);
  });

  // The genesis hash that names a network is implicit data of the signed payload (frame_system's CheckGenesis signed
  // extension), never a byte of the extrinsic: V3's bytes under a Westend Asset Hub option keep their hash and asset
  // and take the option's network.
  it("V3: reference takes the network from the accepted option, and the hash and asset from the signed bytes", async () => {
    const westend = { ...O, network: "polkadot:67f9723393ef76214df0118c34bbbd3d" };
    const presented = { x402Version: 2 as const, accepted: westend, payload: { extrinsic: V.V3.extrinsic, call: V.V2.expectCall } };
    expect(await exactPolkadotRemark.reference(presented as never, westend)).toEqual({ ...V.V3.expectReference, network: westend.network });
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
    const ref = await exactPolkadotRemark.reference(presentedOf(xt, V.V2.expectCall), O);
    expect(ref).toEqual({ ...V.V3.expectReference, extrinsic: xt });
  });

  it("V4: the remark hash", () => {
    const remark = new TextEncoder().encode(toLcpString(H));
    expect(toHex(blake2b(remark, { dkLen: 32 }))).toBe(V.V4.expectRemarkHash);
  });

  it("V4: status for each fixture", async () => {
    for (const row of rowsOf(V.V4.status, "x402-exact-polkadot-lcp-assets-remark.json V4.status")) {
      // A row may name the reference's signer, the account its extrinsic's call runs as.
      const signer = row.signer === undefined ? {} : { signer: row.signer as `0x${string}` };
      const ref = { ...V.V4.reference, ...signer, h: H, ...(row.hint ? { transaction: `${V.V4.block}-${V.V4.index}` } : {}) };
      expect(withStrings(await polkadotStatus(ref, readerOf(row), queryOf(row))), row.case).toEqual(row.expect);
    }
  });

  it("eraNonce: the signer, era and nonce @polkadot/types decodes under the runtime's extensions, and reference reads the same", async () => {
    // The independent decoding: @polkadot/types 17.0.1's ExtrinsicSignatureV4, under Polkadot Asset Hub's extensions in the
    // runtime's order (the file's eraNonce about), read from the byte after the version byte.
    const registry = new TypeRegistry();
    const none = { extrinsic: {}, payload: {} };
    registry.setSignedExtensions([...ASSET_HUB_EXTENSIONS], { AuthorizeCall: none, EthSetOrigin: none, StorageWeightReclaim: none });
    let referenced = 0;
    for (const row of rowsOf(V.eraNonce.rows, "x402-exact-polkadot-lcp-assets-remark.json eraNonce", { exact: 6 })) {
      const xt: string = row.extrinsic.startsWith("0x") ? row.extrinsic : V[row.extrinsic].extrinsic;
      const bytes = fromHex(xt);
      const at = registry.createType("Compact<u32>", bytes).encodedLength;
      expect(bytes[at], row.case).toBe(0x84);
      const sig = registry.createType<ExtrinsicSignatureV4>("ExtrinsicSignatureV4", bytes.subarray(at + 1), { isSigned: true });
      const era = sig.era.isMortalEra ? { period: sig.era.asMortalEra.period.toNumber(), phase: sig.era.asMortalEra.phase.toNumber() } : "immortal";
      expect({ signer: toHex(sig.signer.toU8a().subarray(1)), era, nonce: sig.nonce.toString() }, row.case).toEqual(row.expect);
      expect(toHex(bytes.subarray(at + 1 + sig.encodedLength)), row.case).toBe(row.call);
      const split = splitSigned(bytes);
      if ("refused" in split) throw new Error(split.code);
      expect(toHex(split.signer), row.case).toBe(row.expect.signer);
      if (row.call !== V.V2.expectCall) continue;
      // lcp's own reading of the same bytes: reference, from what the payer signed.
      const ref = await exactPolkadotRemark.reference(presentedOf(xt, row.call), O);
      expect(ref, row.case).toMatchObject(row.expect);
      referenced++;
    }
    expect(referenced).toBe(5);
  });

  it("V4: a ref whose signer, nonce, era or extrinsic is not of the form reference writes is unreadable unparseable, with nothing read", async () => {
    const ref = { ...V.V4.reference, h: H };
    const row = V.V4.status[0];
    expect(withStrings(await polkadotStatus(ref, readerOf(row), queryOf(row)))).toEqual(row.expect);
    for (const [k, v] of [["signer", null], ["signer", "0x12"], ["nonce", 1], ["nonce", "01"], ["era", { period: 3, phase: 0 }], ["extrinsic", "0xZZ"], ["transaction", "x"]] as const) {
      let reads = 0;
      const counted = new Proxy(readerOf(row), {
        get: (t, p) => (p === "network" ? t.network : (...a: never[]) => (reads++, (t as never as Record<string, (...x: never[]) => unknown>)[p as string]!(...a))),
      });
      expect(await polkadotStatus({ ...ref, [k]: v } as never, counted, queryOf(row)), `${k} ${String(v)}`).toEqual(UNPARSEABLE);
      expect(reads, `${k} ${String(v)}`).toBe(0);
    }
  });

  it("V4: recover", async () => {
    const reader = readerOf({ finalized: "100" });
    const transaction = `${V.V4.block}-${V.V4.index}`;
    expect(await exactPolkadotRemark.recover({ network: V.V4.readerNetwork, tx: transaction, option: O }, reader)).toBe(V.V4.recover.expect);
    for (const row of rowsOf(V.V4.recoverRefusals, "x402-exact-polkadot-lcp-assets-remark.json V4.recoverRefusals")) {
      const raw = [...V.V4.raw];
      raw[V.V4.index] = row.raw;
      const upper: PolkadotReader = { ...readerOf({ finalized: "100", ...row }), rawExtrinsics: async () => raw };
      expect(await exactPolkadotRemark.recover({ network: V.V4.readerNetwork, tx: transaction, option: O }, upper), row.case).toEqual({
        refused: true,
        code: row.expect,
      });
    }
  });

  it("V4: recover reads the record status reads, and needs the profile call and a transfer of its asset", async () => {
    const transaction = `${V.V4.block}-${V.V4.index}`;
    expect(V.V4.recoverReads.length).toBeGreaterThan(0);
    for (const row of rowsOf(V.V4.recoverReads, "x402-exact-polkadot-lcp-assets-remark.json V4.recoverReads")) {
      const raw = [...(row.raws ?? V.V4.raw)];
      if (row.raw !== undefined) raw[V.V4.index] = row.raw;
      const reader: PolkadotReader = { ...readerOf(row), rawExtrinsics: async () => raw };
      const got = await exactPolkadotRemark.recover({ network: V.V4.readerNetwork, tx: transaction, option: O }, reader);
      expect(typeof got === "string" ? got : got.code, row.case).toBe(row.expect);
    }
  });

  // Sidecar answers /blocks/{block}/extrinsics-raw with the block's extrinsics as an array of hex strings, and
  // /blocks/{block}/extrinsics/{index} with the extrinsic's record, whose hash is the BLAKE2b-256 of its SCALE bytes
  // (the Polkadot SDK's BlakeTwo256). An answer out of that form is unreadable, a read to repeat (docs/guides/rails.md,
  // "Reading settlement"); a block or a record the reader does not have yet is not-found; each is answered before the
  // raw bytes are decoded.
  it("V4: recover refuses an answer out of Sidecar's form as polkadot/unreadable, and one it does not have as polkadot/not-found", async () => {
    const transaction = `${V.V4.block}-${V.V4.index}`;
    const recoverWith = (raws: unknown, record: (r: PolkadotReader) => PolkadotReader["extrinsic"] = (r) => r.extrinsic) => {
      const base = readerOf({ finalized: "100" });
      const reader: PolkadotReader = { ...base, rawExtrinsics: async () => raws as readonly `0x${string}`[] | null, extrinsic: record(base) };
      return exactPolkadotRemark.recover({ network: V.V4.readerNetwork, tx: transaction, option: O }, reader);
    };
    const withRaw = (raw: unknown) => V.V4.raw.map((r: string, i: number) => (i === V.V4.index ? raw : r));
    const unreadable = { refused: true, code: "polkadot/unreadable" };
    const notFound = { refused: true, code: "polkadot/not-found" };
    expect(await recoverWith(V.V4.raw)).toBe(V.V4.recover.expect);
    expect(await recoverWith({ 2: V.V4.raw[V.V4.index] })).toEqual(unreadable);
    expect(await recoverWith(withRaw(7))).toEqual(unreadable);
    expect(await recoverWith(withRaw(V.V4.raw[V.V4.index].slice(2)))).toEqual(unreadable);
    expect(await recoverWith(withRaw(`${V.V4.raw[V.V4.index]}0`))).toEqual(unreadable);
    expect(await recoverWith(V.V4.raw, () => async () => ({ hash: V.V4.extrinsicAt.hash }) as never)).toEqual(unreadable);
    const other = { ...V.V4.extrinsicAt, at: { ...V.V4.extrinsicAt.at, height: 100n }, hash: `0x${"cc".repeat(32)}` };
    expect(await recoverWith(V.V4.raw, () => async () => other)).toEqual(unreadable);
    expect(await recoverWith(null)).toEqual(notFound);
    expect(await recoverWith(V.V4.raw, () => async () => null)).toEqual(notFound);
  });

  it("plant: a record with no Remarked event is never the settlement", async () => {
    const ref = { ...V.V4.reference, h: H };
    expect(withStrings(await polkadotStatus(ref, readerOf(V.plant), queryOf(V.plant)))).toEqual(V.plant.expect);
  });

  it("status on the act agreement, and against a reader of another network", async () => {
    const ref = { ...V.V4.reference, h: H };
    const row = V.V4.status[0];
    const reader = readerOf(row);
    expect(withStrings(await polkadotStatus(ref, reader, { ...queryOf(row), act: "agreement" }))).toEqual(row.expect);
    const other = { ...reader, network: "polkadot:67f9723393ef76214df0118c34bbbd3d" as const };
    expect(await polkadotStatus(ref, other, queryOf(row))).toEqual({ state: "unreadable", reason: "chain-mismatch", foreign: [] });
    expect(await polkadotStatus(ref, reader, { ...Q, finality: "final" } as never)).toEqual(UNPARSEABLE);
    // A presented `accepted` that is not the option the reference is given is refused.
    const pay = presentedOf(V.V3.extrinsic, V.V2.expectCall);
    expect(await exactPolkadotRemark.reference(pay, { ...O, amount: "1" })).toEqual({ refused: true, code: "x402/accepted-not-option" });
  });

  it("the option filter, advertise and read", () => {
    expect(pairingOf(O)).toBe("x402/exact/polkadot/lcp-assets-remark");
    for (const row of rowsOf(V.options, "x402-exact-polkadot-lcp-assets-remark.json options")) {
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
