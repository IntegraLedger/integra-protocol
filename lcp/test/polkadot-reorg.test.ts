// A timepoint whose block left the canonical chain, read from recorded Westend Asset Hub Sidecar answers
// (test/fixtures/westend-reorg.json). "moved": the canonical block at the named height holds the same extrinsic at the
// named index, so it counts, at the canonical timepoint. "gone": nothing is at that index on the canonical chain, so
// the answer asks for the payment to be located again from the claim position.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtrHash, Json } from "../src/core.js";
import { polkadotStatus, type PolkadotExtrinsic, type PolkadotReader } from "../src/polkadot.js";

type Case = { transaction: string; extrinsicHash: `0x${string}`; assetId: number; h: AtrHash; reads: Record<string, unknown> };
const F = JSON.parse(readFileSync(new URL("./fixtures/westend-reorg.json", import.meta.url), "utf8")) as { moved: Case; gone: Case };
const NETWORK = "polkadot:67f9723393ef76214df0118c34bbbd3d" as const;

/** Sidecar's `/blocks/{block}/extrinsics/{index}` body as the reader's extrinsic. */
function extrinsicOf(body: unknown): PolkadotExtrinsic | null {
  if (body === null) return null;
  const b = body as { at: { height: string; hash: `0x${string}` }; extrinsics: { hash: `0x${string}`; success: boolean; events: { method: { pallet: string; method: string }; data: Json[] }[] } };
  return {
    at: { height: BigInt(b.at.height), hash: b.at.hash },
    hash: b.extrinsics.hash,
    success: b.extrinsics.success,
    events: b.extrinsics.events.map((e) => ({ pallet: e.method.pallet, method: e.method.method, data: e.data })),
  };
}

function readerOf(c: Case): PolkadotReader {
  const get = (path: string) => {
    if (!(path in c.reads)) throw new Error(`not recorded: ${path}`);
    return c.reads[path];
  };
  return {
    network: NETWORK,
    extrinsic: async (block, index) => extrinsicOf(get(`/blocks/${block}/extrinsics/${index}`)),
    rawExtrinsics: async (block) => {
      throw new Error(`not recorded: /blocks/${block}/extrinsics-raw`);
    },
    finalizedHeight: async () => BigInt((get("/blocks/head/header") as { number: string }).number),
  };
}

const refOf = (c: Case) => ({ network: NETWORK, extrinsicHash: c.extrinsicHash, assetId: c.assetId, h: c.h, transaction: c.transaction });

describe("polkadotStatus on a named block that left the canonical chain (Westend, recorded)", () => {
  it("moved: the canonical extrinsic at the named height and index has the recorded hash, so it settles there", async () => {
    expect(await polkadotStatus(refOf(F.moved), readerOf(F.moved))).toEqual({
      state: "settled",
      finality: "finalized",
      height: 17735701n,
      transaction: "0x669e1f8d67457055c7d4516aeebec824922c1829001ed5264f4061a9ddef529f-2",
    });
  });

  it("gone: nothing at the named index on the canonical chain; the payment is to be located from the claim position", async () => {
    expect(await polkadotStatus(refOf(F.gone), readerOf(F.gone))).toEqual({ state: "pending", why: "not-located" });
  });

  it("a named block the finalized chain holds answers at the timepoint it was given", async () => {
    const c: Case = {
      ...F.moved,
      transaction: "0x669e1f8d67457055c7d4516aeebec824922c1829001ed5264f4061a9ddef529f-2",
      reads: {
        ...F.moved.reads,
        "/blocks/0x669e1f8d67457055c7d4516aeebec824922c1829001ed5264f4061a9ddef529f/extrinsics/2": F.moved.reads["/blocks/17735701/extrinsics/2"],
      },
    };
    expect(await polkadotStatus(refOf(c), readerOf(c))).toEqual({
      state: "settled",
      finality: "finalized",
      height: 17735701n,
      transaction: "0x669e1f8d67457055c7d4516aeebec824922c1829001ed5264f4061a9ddef529f-2",
    });
  });

  it("another extrinsic at the named index of the canonical block is not counted; the payment is to be located", async () => {
    const other = structuredClone(F.moved.reads["/blocks/17735701/extrinsics/2"]) as { extrinsics: { hash: string } };
    other.extrinsics.hash = "0x448c648dec59ba592b8e26230a72caa98e670b8b39b7f57e95a1f35a399a1030";
    const c: Case = { ...F.moved, reads: { ...F.moved.reads, "/blocks/17735701/extrinsics/2": other } };
    expect(await polkadotStatus(refOf(c), readerOf(c))).toEqual({ state: "pending", why: "not-located" });
  });
});
