import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";
import { makeChainReader } from "../src/client.js";

const TX =
  "0x53e6fa3a0000000000000000000000000000000000000000000000000000000000ade3b0" as const;

/**
 * A structural stand-in for viem's `PublicClient` — the adapter calls exactly four methods, so the four
 * are all that need to exist. Casting through `unknown` keeps the fake honest: it is the adapter's own
 * dependency surface, not a re-declaration of viem's type.
 */
function fakeClient(over: Partial<Record<string, unknown>> = {}): PublicClient {
  return {
    getLogs: vi.fn(async () => [{ id: "range" }]),
    getTransactionReceipt: vi.fn(async () => ({
      logs: [{ id: "a" }, { id: "b" }],
      blockNumber: 44_313_745n,
    })),
    readContract: vi.fn(async () => "read-result"),
    getBlock: vi.fn(async () => ({ timestamp: 1_763_000_000n })),
    ...over,
  } as unknown as PublicClient;
}

describe("makeChainReader — the viem→ChainReader port adapter", () => {
  it("getTransactionLogs returns the receipt's logs for the given txHash", async () => {
    const client = fakeClient();
    const logs = await makeChainReader(client).getTransactionLogs({
      chainId: 84532,
      txHash: TX,
    });
    expect(logs).toEqual([{ id: "a" }, { id: "b" }]);
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash: TX });
  });

  it("getTransactionLogs FAILS LOUD when the ref carries no txHash", async () => {
    // The seller-x402 middleware once observed with `{chainId}` alone and no txHash. This throw is what
    // turned that into a visible failure instead of a silently empty recover — it must stay a throw.
    await expect(
      makeChainReader(fakeClient()).getTransactionLogs({ chainId: 84532 }),
    ).rejects.toThrow(/txHash/);
  });

  it("blockTime reads the timestamp of the block the settlement landed in", async () => {
    const client = fakeClient();
    const at = await makeChainReader(client).blockTime({
      chainId: 84532,
      txHash: TX,
    });
    expect(at).toBe(1_763_000_000n);
    expect(client.getTransactionReceipt).toHaveBeenCalledWith({ hash: TX });
    // The block is looked up BY THE RECEIPT'S blockNumber — not "latest", which would date every
    // as-of-settlement check (EAS validity, status lists) to verification time instead.
    expect(client.getBlock).toHaveBeenCalledWith({ blockNumber: 44_313_745n });
  });

  it("blockTime FAILS LOUD when the ref carries no txHash", async () => {
    await expect(
      makeChainReader(fakeClient()).blockTime({ chainId: 84532 }),
    ).rejects.toThrow(/txHash/);
  });

  it("getLogs and readContract pass the query through to viem and return its result", async () => {
    const client = fakeClient();
    const reader = makeChainReader(client);
    const query = { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
    expect(await reader.getLogs(query)).toEqual([{ id: "range" }]);
    expect(client.getLogs).toHaveBeenCalledWith(query);
    expect(await reader.readContract(query)).toBe("read-result");
    expect(client.readContract).toHaveBeenCalledWith(query);
  });
});
