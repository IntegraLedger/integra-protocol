/**
 * The settlement read of an EVM pairing whose reference always names the log that carries H or its commitment.
 */
import { sameBytes, type Hex } from "../evm-abi.js";
import type { EvmBreadthStatus, EvmReader, EvmRef } from "../evm.js";
import { isObject } from "../fields.js";
import { evmStatusOf, readEvm, unreadable, type EvmQuery, type EvmRead } from "./evm.js";
import type { Coverage } from "./registry.js";

/**
 * The `status` of a pairing at `coverage` whose reference always names a binding log under one of `events`, its
 * `topic0`: `evmStatus`'s read, answered at that coverage. A ref without such a binding log is not a reference the
 * pairing writes, and its check of H cannot be made: it is unreadable `unparseable`, and nothing is read.
 * `boundRead` answers it when the binding log is absent or under another `topic0`, and `evmStatus`'s read when it is
 * not well formed.
 */
export function boundStatus(
  events: readonly Hex[],
  coverage: Coverage,
): (ref: EvmRef & { transaction: Hex }, reader: EvmReader, query: EvmQuery<EvmRef & { transaction: Hex }>) => Promise<EvmBreadthStatus> {
  return evmStatusOf(boundRead(events), coverage);
}

/** `evmStatus`'s read of a ref that names a binding log under one of `events`; any other ref unreadable `unparseable`. */
export function boundRead(events: readonly Hex[]): (ref: EvmRef & { transaction: Hex }, reader: EvmReader) => Promise<EvmRead> {
  return async (ref, reader) => {
    const b: unknown = typeof ref === "object" && ref !== null ? ref.bindingLog : undefined;
    if (!isObject(b) || !events.some((e) => sameBytes(e, b["topic0"]))) return unreadable("unparseable");
    return readEvm(ref, reader);
  };
}
