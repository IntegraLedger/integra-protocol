/**
 * The settlement read of an EVM pairing whose reference always names the log that carries H or its commitment.
 */
import { sameBytes, type Hex } from "../evm-abi.js";
import { evmStatus, type EvmBreadthStatus, type EvmReader, type EvmRef } from "../evm.js";
import { isObject } from "../fields.js";

/**
 * `evmStatus` for a pairing whose reference always names a binding log under one of `events`, its `topic0`. A ref
 * without such a binding log, or with one that is not well formed, is not a reference the pairing writes, and its
 * check of H cannot be made: it is pending `unreadable`, never failed, and nothing is read. `boundStatus` answers it
 * when the binding log is absent or under another `topic0`, and `evmStatus` when it is not well formed.
 */
export function boundStatus(
  events: readonly Hex[],
): (ref: EvmRef & { transaction: Hex }, reader: EvmReader) => Promise<EvmBreadthStatus> {
  return async (ref, reader) => {
    const b: unknown = typeof ref === "object" && ref !== null ? ref.bindingLog : undefined;
    if (!isObject(b) || !events.some((e) => sameBytes(e, b["topic0"]))) return { state: "pending", why: "unreadable" };
    return evmStatus(ref, reader);
  };
}
