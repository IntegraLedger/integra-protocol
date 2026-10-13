/** One bounded receipt read for the Tempo pieces, with every outcome a value. */
import { isReceipt, type EvmReader, type EvmReceipt, type Hex } from "./evm.js";
import { isLog } from "./internal/evm.js";
import { normalHash } from "./fields.js";
import { refusal, type Refusal } from "./refusal.js";

/**
 * Reads one receipt. A reader that is missing or for another network is `tempo/wrong-reader`, a failed read is
 * `tempo/unreadable`, no receipt is `tempo/not-found`, and a reverted transaction is `tempo/reverted`. One call.
 */
export async function readReceipt(network: string, transaction: Hex, reader: EvmReader): Promise<EvmReceipt | Refusal> {
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
  if (receipt.status === 0) return refusal("tempo/reverted");
  return receipt;
}
