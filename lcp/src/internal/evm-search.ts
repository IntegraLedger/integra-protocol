/**
 * The reads an EVM search needs beyond `EvmReader`: a log query over a block range, a block's number and time by mark
 * or number, and a transaction's signed bytes. The MPP pairings on EVM chains and on Tempo read through it; `../mpp.ts`
 * exports the types.
 */
import type { Hex } from "../evm-abi.js";
import type { EvmLog, EvmReader } from "../evm.js";

/** A log as `eth_getLogs` gives it: the log, the transaction that emitted it, its block and its index in that block. */
export interface EvmLogEntry extends EvmLog {
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
}

/**
 * An `EvmReader` that also answers a log query, a block by mark or number, and a transaction's signed bytes. Every
 * failure rejects, as `EvmReader`'s do: a range the endpoint refuses rejects, and is never read as an empty answer.
 */
export interface EvmSearchReader extends EvmReader {
  /**
   * `eth_getLogs` over `[fromBlock, toBlock]`: `address` absent reads every contract, and each topic is matched by its
   * position, `null` matching any.
   */
  logs(filter: {
    address?: Hex;
    topics: readonly (Hex | null)[];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<readonly EvmLogEntry[]>;
  /** `eth_getBlockByNumber(at, false)`: the block's number and its timestamp, in seconds. */
  block(at: "latest" | "safe" | "finalized" | bigint): Promise<{ number: bigint; timestamp: bigint }>;
  /** `eth_getRawTransactionByHash`: the signed transaction's bytes; null when the node holds none. */
  raw(tx: Hex): Promise<Hex | null>;
}
