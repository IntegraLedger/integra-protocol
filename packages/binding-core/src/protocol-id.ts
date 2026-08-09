/**
 * The closed set of commerce protocols an LCP reference can be carried through.
 *
 * CLOSED, not an open string: an open type lets a typo mint a protocol, and the compatibility registry has
 * nothing to iterate over. Ordered settlement-first, then placements — the same order the schema enum
 * declares, which `KNOWN_PROTOCOL_IDS` preserves so a conformance runner and this module agree on ordering
 * as well as membership.
 *
 * NOT a protocol id: `escrow` (a settlement mechanism — several protocols can settle through it) and any
 * scheme id such as `evm:x402` (that is `BindingManifest.rail`, a different field with a different job).
 * Conflating the two is the bug `BindingManifest.protocol` exists to prevent.
 */
export type ProtocolId =
  | "x402"
  | "mpp"
  | "ap2"
  | "ack"
  | "acp"
  | "ucp"
  | "visa-tap"
  | "mastercard-vi"
  | "a2a"
  | "mcp";

/** Every {@link ProtocolId}, in the schema enum's declaration order — settlement protocols first, then
 *  placements. The order is part of the contract, not incidental: a conformance runner iterating this array
 *  and one reading the schema must produce the same sequence. */
export const KNOWN_PROTOCOL_IDS: readonly ProtocolId[] = [
  "x402",
  "mpp",
  "ap2",
  "ack",
  "acp",
  "ucp",
  "visa-tap",
  "mastercard-vi",
  "a2a",
  "mcp",
];

/** Narrow an arbitrary value to a {@link ProtocolId}. Because the set is CLOSED, a `false` here means the
 *  value is not a protocol at all — unlike the carrier-type guard, whose registry is open and whose
 *  `false` only means "not handled here". */
export function isKnownProtocolId(value: unknown): value is ProtocolId {
  return (
    typeof value === "string" &&
    (KNOWN_PROTOCOL_IDS as readonly string[]).includes(value)
  );
}
