/**
 * The settlement read of an EVM pairing whose reference always names the log that carries H or its commitment.
 */
import { bytesOf, sameBytes, type Hex } from "../evm-abi.js";
import { evmStatus, type EvmBreadthStatus, type EvmReader, type EvmRef } from "../evm.js";
import { isAddress } from "../fields.js";

/**
 * `evmStatus` for a pairing whose reference always names a binding log under one of `events`, its `topic0`. A ref
 * without such a binding log, or with one that is not well formed, is not a reference the pairing writes, and its
 * check of H cannot be made: it is pending `unreadable`, never failed, and nothing is read.
 */
export function boundStatus(
  events: readonly Hex[],
): (ref: EvmRef & { transaction: Hex }, reader: EvmReader) => Promise<EvmBreadthStatus> {
  return async (ref, reader) => {
    const b: unknown = typeof ref === "object" && ref !== null ? ref.bindingLog : undefined;
    if (!isBindingLog(b) || !events.some((e) => sameBytes(e, b.topic0))) return { state: "pending", why: "unreadable" };
    return evmStatus(ref, reader);
  };
}

/** True for a binding log with an address, a 32-byte `topic0` and `value`, and a topic index 1–3 or a data word. */
function isBindingLog(b: unknown): b is NonNullable<EvmRef["bindingLog"]> {
  if (typeof b !== "object" || b === null) return false;
  const r = b as Record<string, unknown>;
  const word = r["dataWord"];
  const at = "index" in r ? [1, 2, 3].includes(r["index"] as number) : Number.isSafeInteger(word) && (word as number) >= 0;
  return isAddress(r["address"]) && bytesOf(r["topic0"])?.length === 32 && bytesOf(r["value"])?.length === 32 && at;
}
