/** One bounded receipt read for the Tempo pieces, with every outcome a value. */
import type { EvmReader, EvmReceipt, Hex } from "./evm.js";
import { failedAt, isLog, isReceipt } from "./internal/evm.js";
import { normalHash } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";

/**
 * Reads one receipt. A reader that is missing or for another network is `tempo/wrong-reader`, a failed read is
 * `tempo/unreadable`, no receipt is `tempo/not-found`, and a reverted transaction is `tempo/reverted`. One call.
 */
export async function readReceipt(network: string, transaction: Hex, reader: EvmReader): Promise<EvmReceipt | Refusal> {
  const receipt = await landedReceipt(network, transaction, reader);
  if (isRefusal(receipt)) return receipt;
  if (receipt.status === 0) return refusal("tempo/reverted");
  return receipt;
}

/**
 * Reads one receipt as `readReceipt` does, except that a reverted transaction is `tempo/reverted` only where the
 * receipt's block is at or below the reader's `finalized` mark. Above that mark, or where it cannot be read, a reverted
 * transaction is `tempo/not-final`, a read to repeat: a block above the mark can be replaced by one in which the same
 * transaction succeeds. The mark is read only for a reverted transaction. At most two calls.
 */
export async function readReceiptAtMark(network: string, transaction: Hex, reader: EvmReader): Promise<EvmReceipt | Refusal> {
  const receipt = await landedReceipt(network, transaction, reader);
  if (isRefusal(receipt)) return receipt;
  if (receipt.status === 0) {
    const read = await failedAt(receipt.blockNumber, "reverted", reader);
    return read.state === "failed" ? refusal("tempo/reverted") : refusal("tempo/not-final");
  }
  return receipt;
}

/** The well-formed receipt of `transaction`, reverted or not, or the refusal `readReceipt` gives before the status. */
async function landedReceipt(network: string, transaction: Hex, reader: EvmReader): Promise<EvmReceipt | Refusal> {
  if (typeof reader !== "object" || reader === null || reader.network !== network) return refusal("tempo/wrong-reader");
  const tx = normalHash(transaction);
  if (tx === null) return refusal("tempo/not-found");
  let receipt: EvmReceipt | null;
  try {
    receipt = await reader.receipt(tx);
  } catch {
    return refusal("tempo/unreadable");
  }
  if (receipt === null) return refusal("tempo/not-found");
  if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return refusal("tempo/unreadable");
  return receipt;
}
