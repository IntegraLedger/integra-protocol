/**
 * On-chain event helpers for the EIP-3009 binding: the `AuthorizationUsed` ABI and the transport-free
 * atrHash-recovery scan (the caller fetches the receipt with its own viem client and passes `{ logs }`).
 */

import type { SettlementRef } from "@integraledger/lcp-binding-core";
import { atrHashEquals } from "@integraledger/lcp-kernel";
import { decodeEventLog, type Hex, type Log } from "viem";

/** Build a `SettlementRef` without materializing absent fields — `exactOptionalPropertyTypes` forbids
 *  `txHash: undefined`, so the spreads keep the ref exactly as sparse as the caller's knowledge. Shared
 *  by the EVM adapters (it was byte-identical in two of them and inlined in the third). */
export function refOf(
  chainId: number,
  txHash: `0x${string}` | undefined,
  logIndex: number | null,
): SettlementRef {
  return {
    chainId,
    ...(txHash !== undefined ? { txHash } : {}),
    ...(logIndex !== null ? { logIndex } : {}),
  };
}

/** USDC `AuthorizationUsed(authorizer, nonce)` — both indexed; the on-chain artifact of every EIP-3009
 *  settlement. `nonce` carries the atrHash (WLD-3: recoverable, forward-indexable on the nonce topic). */
export const AUTHORIZATION_USED_ABI = [
  {
    type: "event",
    name: "AuthorizationUsed",
    inputs: [
      { name: "authorizer", type: "address", indexed: true },
      { name: "nonce", type: "bytes32", indexed: true },
    ],
    anonymous: false,
  },
] as const;

/** The answer to one question: did this settlement transaction commit this atrHash as an EIP-3009 nonce?
 *  `ok` is the whole verdict and `onChainNonce` is the matched value for a report to quote. It proves the
 *  NONCE matched — it says nothing about which token moved, or how much, which is a separate check. */
export interface OnChainAtrHashProof {
  /** True iff the settlement tx emitted `AuthorizationUsed` with `nonce === atrHash`. */
  ok: boolean;
  /** The on-chain nonce that matched (lowercase 0x hex), or `null` if none did. */
  onChainNonce: Hex | null;
}

/** A decoded `AuthorizationUsed` occurrence: the nonce it committed and where it sat in the tx. */
export interface AuthorizationUsedEvent {
  /** The committed nonce (lowercase 0x hex) — the atrHash on the x402 binding. */
  nonce: Hex;
  /** The authorizing account (lowercase 0x hex) — EIP-3009's `authorizer`, the account the executed
   *  transfer draws from. Faithful decoding of the event's first indexed argument, NOT an identity
   *  attestation: who the counterparty IS remains the acceptance/authority layer's claim. Carried so a
   *  consumer can pair this authorization with the `Transfer` it executed in the same settlement. */
  authorizer: Hex;
  /** The log's position in the transaction, or `null` if the source log carried none. */
  logIndex: number | null;
  /** The emitting contract (lowercase 0x hex) — the payment token. */
  address: Hex;
}

/**
 * Decode every `AuthorizationUsed(authorizer, indexed nonce)` in a set of logs (a single settlement's
 * logs, from `ChainReader.getTransactionLogs`, or a range query). This is the EXTRACT path (recover the
 * committed nonce), distinct from `verifyAtrHashOnChain`'s CHECK path (assert a known nonce is present).
 * When `asset` is supplied only that token's events are read; otherwise every AuthorizationUsed is decoded.
 */
export function readAuthorizationUsed(
  logs: readonly Log[],
  asset?: string,
): AuthorizationUsedEvent[] {
  const want = asset?.toLowerCase();
  const out: AuthorizationUsedEvent[] = [];
  for (const log of logs) {
    const address = log.address.toLowerCase() as Hex;
    if (want !== undefined && address !== want) continue;
    try {
      const decoded = decodeEventLog({
        abi: AUTHORIZATION_USED_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "AuthorizationUsed")
        out.push({
          nonce: decoded.args.nonce.toLowerCase() as Hex,
          authorizer: decoded.args.authorizer.toLowerCase() as Hex,
          logIndex: log.logIndex,
          address,
        });
    } catch {
      // Not an AuthorizationUsed log from this ABI — ignore.
    }
  }
  return out;
}

/**
 * Confirm the atrHash was committed on-chain: scan a settlement tx receipt for the token's
 * `AuthorizationUsed(authorizer, indexed nonce)` event and assert `nonce === atrHash` (case-insensitive).
 */
export function verifyAtrHashOnChain(
  receipt: { logs: readonly Log[] },
  params: { asset: string; atrHash: string },
): OnChainAtrHashProof {
  const asset = params.asset.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== asset) continue;
    try {
      const decoded = decodeEventLog({
        abi: AUTHORIZATION_USED_ABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "AuthorizationUsed") {
        const nonce = decoded.args.nonce.toLowerCase() as Hex;
        if (atrHashEquals(nonce, params.atrHash))
          return { ok: true, onChainNonce: nonce };
      }
    } catch {
      // Not an AuthorizationUsed log from this ABI — ignore.
    }
  }
  return { ok: false, onChainNonce: null };
}
