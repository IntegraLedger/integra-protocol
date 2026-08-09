/**
 * PRS-4 — the settlement event's chain inclusion is the PRIMARY temporal anchor for a record. The block
 * that includes the welded settlement fixes "when" without a separate timestamping authority: the same
 * chain that carries the weld carries the time. A record MAY additionally carry a secondary anchor (e.g.
 * an RFC-3161 token) but never in place of the settlement inclusion — that is the ground truth here.
 */
import type { SettlementRef } from "@integraledger/lcp-binding-core";

/** A record's PRIMARY temporal anchor: the block that included the welded settlement. `blockTime` is CHAIN
 *  time in seconds, read from the including block — not a wall clock and not this process's notion of now,
 *  which is the point. A secondary anchor (an RFC-3161 token, say) may accompany one; it never replaces it. */
export interface SettlementAnchor {
  kind: "settlement-inclusion";
  chainId: number;
  txHash?: `0x${string}`;
  /** Chain-anchored time (seconds) — the including block's timestamp, read via `ChainReader.blockTime`. */
  blockTime: bigint;
}

/** Build the PRS-4 primary anchor from a settlement ref and its chain-anchored block time. */
export function settlementAnchor(
  ref: SettlementRef,
  blockTime: bigint,
): SettlementAnchor {
  return {
    kind: "settlement-inclusion",
    chainId: ref.chainId,
    ...(ref.txHash !== undefined ? { txHash: ref.txHash } : {}),
    blockTime,
  };
}
