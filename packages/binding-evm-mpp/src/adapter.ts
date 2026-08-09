/**
 * The MPP-EVM Id-Reuse WeldAdapter — the one member of the ten that differs at the weld.
 *
 * - `propose`         — `challenge.id = atrHash`, and the EIP-3009 nonce MPP's derivation then requires.
 * - `verifyCandidate` — THE PRIMARY VERIFY SURFACE: confirm a KNOWN atrHash against one settlement's
 *                       on-chain nonce. You bring the hash; the chain confirms it.
 * - `observe`         — a settlement's `AuthorizationUsed` events → `settled` lifecycle transitions.
 *
 * **Both read paths are scoped to MPP's `authorization` credential type, and both say so when they are out of
 * scope.** Only §5.3 puts the derived `challengeHash` on-chain; the RECOMMENDED `permit2` type signs the same
 * value into an off-chain EIP-712 witness and `transaction`/`hash` bind no challenge at all. A settlement in
 * any of those three moves the token and emits no `AuthorizationUsed`, so answering "no transitions" about it
 * would be a wrong answer, not an absence — see `credential-type.ts` for the specification reading and the
 * refusal both members return instead.
 * - `recover`         — REFUSES, always, `mpp-evm/not-recoverable-by-construction`. Present because a
 *                       generic `WeldAdapter` consumer will reach for it and must be told, loudly, that this
 *                       rail has no recovery; typed `Promise<Refusal>` so the impossibility is visible before
 *                       the call. It takes no arguments: there is no input a recovery could read.
 * - `enumerate`       — ABSENT. The port makes it optional and the manifest declares
 *                       `forwardIndexable: false`; absence is the declaration.
 *
 * **Why `verifyCandidate` and not a `recover` that re-derives.** A stored challenge would let this package
 * look up an atrHash by settlement and call the answer recovery. That is the service's own records
 * re-labelled, it would falsify `zeroPartyRecoverable: false`, and it is the single edit this package must
 * never accept. Verification needs no such store: the auditor supplies the candidate.
 *
 * viem appears here only through the `Log[]` the injected `ChainReader` hands back and the shared
 * `AuthorizationUsed` decoder in `binding-evm-common` — the same seam `binding-evm-x402` uses, so the event
 * ABI is known in exactly one place.
 */
import type {
  BindingManifest,
  LifecycleTransition,
  Outcome,
  Refusal,
  SettlementRef,
  VerifierPorts,
  WeldAdapter,
} from "@integraledger/lcp-binding-core";
import {
  assetWasTransferred,
  readAuthorizationUsed,
  refOf,
} from "@integraledger/lcp-binding-evm-common";
import type { Log } from "viem";
import { notAuthorizationCredentialType } from "./credential-type.js";
import {
  bindAtrHash,
  checkCandidate,
  type MppEvmCandidateConfirmation,
  type MppEvmChallengeBinding,
  notRecoverableByConstruction,
} from "./id-reuse.js";
import { MPP_EVM_MANIFEST } from "./manifest.js";

/** One chain + token + protection space this adapter binds. */
export interface MppEvmAdapterConfig {
  chainId: number;
  /** The payment token — the `AuthorizationUsed` emitter whose nonce carries the derivation. */
  asset: `0x${string}`;
  /**
   * `challenge.realm`, MPP's protection space. Not optional and not inferable: it is half the nonce
   * preimage, so an adapter without it cannot derive or confirm anything.
   */
  realm: string;
}

/**
 * The MPP-EVM surface. It IS a `WeldAdapter` on the EVM-shaped port — the rail is EVM and the types fit —
 * with two members narrowed to say what this rail can and cannot do, and `enumerate` left off.
 */
export interface MppEvmAdapter extends WeldAdapter {
  readonly manifest: BindingManifest;
  /** `ctx` is accepted for port compatibility and unused: the realm lives in the adapter config. */
  propose(
    atrHash: `0x${string}`,
    ctx?: unknown,
  ): Promise<Outcome<MppEvmChallengeBinding>>;
  /** Confirm a candidate atrHash against ONE settlement's on-chain nonce. */
  verifyCandidate(
    atrHash: string,
    ref: SettlementRef,
    ports: VerifierPorts,
  ): Promise<Outcome<MppEvmCandidateConfirmation>>;
  /** Always a refusal — see the module docblock. */
  recover(): Promise<Refusal>;
}

/** Construct the MPP-EVM adapter for one chain, token and realm. */
export function createMppEvmAdapter(
  config: MppEvmAdapterConfig,
): MppEvmAdapter {
  if (config.realm === "")
    throw new Error(
      "MppEvmAdapterConfig.realm must be non-empty — challenge.realm is half the EIP-3009 nonce preimage (draft-evm-charge-00 §5.3.1)",
    );

  /**
   * One settlement's logs, and the `AuthorizationUsed` events the configured token emitted among them.
   *
   * The raw logs travel alongside the decoded events because an EMPTY event set is ambiguous on this rail:
   * only the logs distinguish "this transaction moved none of the asset" from "it settled under a credential
   * type whose challengeHash is not on-chain". Both read members need that distinction, so both read it here.
   */
  async function settlement(
    ref: SettlementRef,
    ports: VerifierPorts,
  ): Promise<{
    logs: Log[];
    events: { nonce: `0x${string}`; logIndex: number | null }[];
  }> {
    const logs = (await ports.chain.getTransactionLogs(ref)) as Log[];
    return { logs, events: readAuthorizationUsed(logs, config.asset) };
  }

  return {
    manifest: MPP_EVM_MANIFEST,

    async propose(
      atrHash: `0x${string}`,
    ): Promise<Outcome<MppEvmChallengeBinding>> {
      // bindAtrHash throws (fail-fast) on a malformed atrHash — a seller-side wiring defect, not a policy
      // outcome. There is no value-level refusal on this path: MPP constrains nothing we are choosing here.
      return { ok: true, value: bindAtrHash(atrHash, config.realm) };
    },

    async verifyCandidate(
      atrHash: string,
      ref: SettlementRef,
      ports: VerifierPorts,
    ): Promise<Outcome<MppEvmCandidateConfirmation>> {
      const { logs, events } = await settlement(ref, ports);
      // Out of scope BEFORE out of luck: a settlement that moved the token under any of MPP's other three
      // credential types is answered by naming that type, never by the pinned-index or absence refusals below.
      if (events.length === 0 && assetWasTransferred(logs, config.asset))
        return notAuthorizationCredentialType(config.asset);
      // An empty set reaches checkCandidate, which owns the `no-settlement-event` refusal — one place, so a
      // caller holding nonces from its own indexer gets the identical answer.
      if (ref.logIndex === undefined || events.length === 0)
        return checkCandidate(
          atrHash,
          config.realm,
          events.map((e) => e.nonce),
        );
      // A pinned logIndex that matches NO event is a failure, never a silent fall back to another event in
      // the same transaction — that could confirm a candidate against a different settlement leg.
      const pinned = events.filter((e) => e.logIndex === ref.logIndex);
      if (pinned.length === 0)
        return {
          refused: true,
          haltClass: "verification-failure",
          code: "mpp-evm/log-index-not-found",
          detail: `no AuthorizationUsed at logIndex ${ref.logIndex} for asset ${config.asset}`,
        };
      return checkCandidate(
        atrHash,
        config.realm,
        pinned.map((e) => e.nonce),
      );
    },

    async observe(
      ref: SettlementRef,
      ports: VerifierPorts,
    ): Promise<Outcome<LifecycleTransition[]>> {
      const { logs, events } = await settlement(ref, ports);
      // Settlement is the only on-chain state MPP-EVM exposes; `proposed` is off-chain and pre-settlement.
      if (events.length === 0) {
        // The token moved and no authorization accompanied it: the transaction DID settle, under a credential
        // type this binding cannot read. An empty transition list would assert the opposite.
        if (assetWasTransferred(logs, config.asset))
          return notAuthorizationCredentialType(config.asset);
        // The token did not move either, so there is no settlement of this asset to report — an answer, not
        // a refusal, and one reached without reading a block.
        return { ok: true, value: [] };
      }
      const at = await ports.chain.blockTime(ref);
      return {
        ok: true,
        value: events.map((e) => ({
          state: "settled",
          at,
          ref: refOf(ref.chainId, ref.txHash, e.logIndex),
        })),
      };
    },

    async recover(): Promise<Refusal> {
      return notRecoverableByConstruction();
    },
  };
}
