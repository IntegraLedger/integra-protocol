// The settler's Solana reader as lcp calls it: lcp's coverage-full search passes `minContextSlot` as a bigint
// (`SvmReader.signatures`'s page), which the reader must send to the node as a JSON number. A node stub records each
// JSON-RPC request and answers an empty signature list.
import { afterEach, describe, expect, it } from "vitest";
import { svmReader } from "../src/modules/solana/reader.js";
import { stub, type Stub } from "./support.js";

const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const ADDRESS = "11111111111111111111111111111111";
let node: Stub | undefined;

afterEach(async () => {
  await node?.close();
  node = undefined;
});

async function reader() {
  node = await stub(() => ({ jsonrpc: "2.0", id: 1, result: [] }));
  return svmReader(NETWORK, node.url, performance.now() + 10_000);
}
const sent = () => node!.calls.map((c) => (c.body as { method: string; params: unknown[] }).params);

describe("the Solana reader's signatures", () => {
  it("sends lcp's bigint minContextSlot as a JSON number, and the page's other members as given", async () => {
    const r = await reader();
    expect(await r.signatures(ADDRESS, { limit: 1000, commitment: "confirmed", minContextSlot: 9_007_199_254_740_991n, until: "x" })).toEqual([]);
    expect(sent()).toEqual([[ADDRESS, { limit: 1000, commitment: "confirmed", until: "x", minContextSlot: 9_007_199_254_740_991 }]]);
  });

  it("sends a page without minContextSlot unchanged", async () => {
    const r = await reader();
    expect(await r.signatures(ADDRESS, { limit: 1000, commitment: "finalized" })).toEqual([]);
    expect(sent()).toEqual([[ADDRESS, { limit: 1000, commitment: "finalized" }]]);
  });

  it("refuses a minContextSlot past the slots it reads, malformed, and sends nothing", async () => {
    const r = await reader();
    await expect(r.signatures(ADDRESS, { limit: 1000, commitment: "confirmed", minContextSlot: 9_007_199_254_740_992n })).rejects.toMatchObject({
      code: "malformed",
    });
    await expect(r.signatures(ADDRESS, { limit: 1000, commitment: "confirmed", minContextSlot: -1n })).rejects.toMatchObject({ code: "malformed" });
    expect(sent()).toEqual([]);
  });
});
