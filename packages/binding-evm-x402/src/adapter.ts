/**
 * The x402 `exact` / EIP-3009 WeldAdapter (LCP `LCP-X402-EVM-NONCE-1`). Built on the live
 * (`lcp-x402-reference`, 114 tests) onto binding-core's `WeldAdapter` contract, with the typed-data
 * machinery reused from `binding-evm-common` (viem is confined to the EVM packages, and `depcruise`
 * holds it there — it reaches no non-EVM binding and no placement).
 *
 * - `propose`  — build the EIP-3009 authorization + typed-data with `nonce = atrHash` (after the Permit2
 *                filter); the payer signs the returned `typedData`.
 * - `recover`  — read the committed nonce back out of ONE settlement's `AuthorizationUsed` log (= atrHash).
 * - `observe`  — map a settlement's `AuthorizationUsed` events to `welded-settled` lifecycle transitions.
 * - `enumerate`— forward-index by the indexed nonce topic (`AuthorizationUsed(_, indexed nonce)`).
 */

import type {
  LifecycleTransition,
  Outcome,
  SettlementRef,
  VerifierPorts,
  WeldAdapter,
} from "@integraledger/lcp-binding-core";
import {
  AUTHORIZATION_USED_ABI,
  assetWasTransferred,
  buildEip3009TypedData,
  type Eip3009Authorization,
  type Eip3009TypedData,
  readAuthorizationUsed,
  refOf,
} from "@integraledger/lcp-binding-evm-common";
import { canonicalAtrHash } from "@integraledger/lcp-kernel";
import type { Log } from "viem";
import { filterAssetTransferMethod } from "./asset-transfer-method-filter.js";
import { X402_MANIFEST } from "./manifest.js";

/** One chain + token this adapter binds. `tokenName`/`tokenVersion` pin the EIP-712 domain of `asset`. */
export interface X402AdapterConfig {
  chainId: number;
  /** The payment token — the EIP-712 `verifyingContract` and the `AuthorizationUsed` emitter. */
  asset: `0x${string}`;
  tokenName: string;
  tokenVersion: string;
  /** Enumeration lower bound; defaults to the full history (`earliest`). */
  fromBlock?: bigint;
}

/** The per-payment proposal inputs (the token/chain identity lives in the adapter config). */
export interface X402ProposalContext {
  from: string;
  payTo: string;
  /** Amount in token base units (decimal string). */
  amount: string;
  validAfter: string;
  validBefore: string;
  /** The x402 offer's asset-transfer method; anything but `eip3009` is refused (Permit2 filter). */
  assetTransferMethod?: string;
}

/** What `propose` yields: the wire authorization + the typed-data the payer signs. */
export interface X402Proposal {
  authorization: Eip3009Authorization;
  typedData: Eip3009TypedData;
}

/** Construct the x402 WeldAdapter for one chain + token. */
export function createX402Adapter(config: X402AdapterConfig): WeldAdapter {
  return {
    manifest: X402_MANIFEST,

    async propose(
      atrHash: `0x${string}`,
      ctx: unknown,
    ): Promise<Outcome<X402Proposal>> {
      const c = ctx as X402ProposalContext;
      const refusal = filterAssetTransferMethod(c.assetTransferMethod);
      if (refusal !== null) return refusal;
      // buildEip3009TypedData throws (fail-fast) on a malformed atrHash — a programming error, not a
      // policy outcome; the Permit2 refusal above is the only value-level Refusal on this path.
      const { authorization, typedData } = buildEip3009TypedData({
        atrHash,
        from: c.from,
        to: c.payTo,
        value: c.amount,
        validAfter: c.validAfter,
        validBefore: c.validBefore,
        chainId: config.chainId,
        tokenName: config.tokenName,
        tokenVersion: config.tokenVersion,
        verifyingContract: config.asset,
      });
      return { ok: true, value: { authorization, typedData } };
    },

    async recover(
      ref: SettlementRef,
      ports: VerifierPorts,
    ): Promise<Outcome<`0x${string}`>> {
      const logs = (await ports.chain.getTransactionLogs(ref)) as Log[];
      const events = readAuthorizationUsed(logs, config.asset);
      if (events.length === 0)
        return {
          refused: true,
          haltClass: "verification-failure",
          code: "x402/no-settlement-event",
          detail: `no AuthorizationUsed for asset ${config.asset} in this settlement`,
        };
      // Disambiguate by logIndex when the ref pins one — but a pinned index that matches NO event is a
      // failure, never a silent fallback to events[0] (that could recover a DIFFERENT settlement's
      // atrHash — a fail-fast violation). events.length > 0 guarantees events[0] is defined.
      if (ref.logIndex !== undefined) {
        const match = events.find((e) => e.logIndex === ref.logIndex);
        if (match === undefined)
          return {
            refused: true,
            haltClass: "verification-failure",
            code: "x402/log-index-not-found",
            detail: `no AuthorizationUsed at logIndex ${ref.logIndex} for asset ${config.asset}`,
          };
        return { ok: true, value: match.nonce };
      }
      // UNPINNED, and more than one DISTINCT nonce in the transaction: the caller has not said which
      // settlement it is asking about, and this function must not choose for it. It used to answer
      // `events[0]` — the silent fallback the comment three lines above already calls a fail-fast
      // violation, committed in the branch that comment did not cover. Distinctness is what makes it an
      // ambiguity: several `AuthorizationUsed` logs carrying the SAME nonce are one weld observed more
      // than once, and refusing those would break a legitimate batch. Same shape as tempo-mpp's
      // `ambiguous-memos`, for the same reason.
      const distinct = new Set(events.map((e) => e.nonce.toLowerCase()));
      if (distinct.size > 1)
        return {
          refused: true,
          haltClass: "verification-failure",
          code: "x402/ambiguous-settlement",
          detail: `settlement ${ref.txHash} carries ${distinct.size} AuthorizationUsed events with different nonces for asset ${config.asset} — pin one with ref.logIndex rather than choosing for the caller`,
        };
      return { ok: true, value: (events[0] as (typeof events)[number]).nonce };
    },

    async observe(
      ref: SettlementRef,
      ports: VerifierPorts,
    ): Promise<Outcome<LifecycleTransition[]>> {
      const logs = (await ports.chain.getTransactionLogs(ref)) as Log[];
      const events = readAuthorizationUsed(logs, config.asset);
      if (events.length === 0) {
        // An empty transition list is a POSITIVE claim: this transaction settled nothing of this asset.
        // That is true only when the token did not move. If it did, the payment settled through a path
        // this binding cannot read the weld from. x402's exact-EVM scheme defines two such paths, not one:
        // `permit2` (settled through `x402ExactPermit2Proxy`) and `erc7710` (smart-account delegation,
        // verified by simulation). Neither exposes a payer-controlled nonce, which is exactly why
        // `filterAssetTransferMethod` refuses both on the propose side. Answering `[]` here would let the
        // observe side quietly assert the opposite of what the propose side refuses to allow.
        if (assetWasTransferred(logs, config.asset))
          return {
            refused: true,
            haltClass: "verification-failure",
            code: "x402/not-eip3009-settlement",
            detail: `token ${config.asset} was transferred by settlement ${ref.txHash} but it emitted no EIP-3009 AuthorizationUsed — the atrHash weld rides only on the payer-controlled nonce of transferWithAuthorization, so a settlement reached by any other path (x402's permit2 and erc7710 asset-transfer methods among them) carries no on-chain weld this binding can report`,
          };
        return { ok: true, value: [] };
      }
      // The only on-chain state x402 exposes is settlement itself (proposed is off-chain, pre-settlement).
      const at = await ports.chain.blockTime(ref);
      return {
        ok: true,
        value: events.map((e) => ({
          state: "welded-settled",
          at,
          ref: refOf(ref.chainId, ref.txHash, e.logIndex),
        })),
      };
    },

    async enumerate(
      atrHash: `0x${string}`,
      ports: VerifierPorts,
    ): Promise<SettlementRef[]> {
      const logs = (await ports.chain.getLogs({
        address: config.asset,
        event: AUTHORIZATION_USED_ABI[0],
        args: { nonce: canonicalAtrHash(atrHash, "enumerate") },
        fromBlock: config.fromBlock ?? "earliest",
        toBlock: "latest",
      })) as Log[];
      return logs.map((l) =>
        refOf(config.chainId, l.transactionHash ?? undefined, l.logIndex),
      );
    },
  };
}
