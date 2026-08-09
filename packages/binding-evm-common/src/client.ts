import type {
  ChainReader,
  SettlementRef,
} from "@integraledger/lcp-binding-core";
import type { PublicClient } from "viem";

/**
 * Adapt a viem `PublicClient` into binding-core's `ChainReader` port (viem lives here and in the two
 * EVM adapters, nowhere else). Imperative shell over viem — the pure verifier logic reads through the port.
 */
export function makeChainReader(client: PublicClient): ChainReader {
  return {
    getLogs: (q) => client.getLogs(q as never),
    getTransactionLogs: async (ref: SettlementRef): Promise<unknown[]> => {
      if (ref.txHash === undefined)
        throw new Error(
          "getTransactionLogs requires a txHash on the SettlementRef",
        );
      const receipt = await client.getTransactionReceipt({ hash: ref.txHash });
      return [...receipt.logs];
    },
    readContract: (c) => client.readContract(c as never),
    blockTime: async (ref: SettlementRef): Promise<bigint> => {
      if (ref.txHash === undefined)
        throw new Error("blockTime requires a txHash on the SettlementRef");
      const receipt = await client.getTransactionReceipt({ hash: ref.txHash });
      const block = await client.getBlock({ blockNumber: receipt.blockNumber });
      return block.timestamp;
    },
  };
}
