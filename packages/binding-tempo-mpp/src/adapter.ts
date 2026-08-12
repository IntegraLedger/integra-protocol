/**
 * The Tempo TIP-20 memo binding adapter — thin logic over an injected `TempoReader` port, PURE (no chain
 * SDK: Tempo is EVM, but the memo needs no ABI decoder and `viem` is fenced to the `binding-evm-*`
 * packages, so the transport is the deployment's). It intentionally does NOT implement binding-core's
 * `WeldAdapter`: that port's `ChainReader` is shaped for `eth_getLogs` over an opaque query and returns
 * `unknown[]`, and its `observe` promises `LifecycleTransition[]` with chain time — neither of which this
 * binding needs to do its two jobs. A rail-native port states honestly what is required: one settlement's
 * logs, and a memo-topic query. Unifying the port shape across rails stays future work (the same note
 * binding-solana and binding-xrpl carry).
 *
 * - `propose`   — the `methodDetails.memo` the seller advertises AND the `transferWithMemo` call the buyer
 *                 makes, from ONE memo value computed once (MPP verifies the two against each other).
 * - `recover`   — the atrHash from a single settlement's logs, zero-party, from the tx hash alone.
 * - `observe`   — the settled transition.
 * - `enumerate` — every settlement bound to one reference, by indexed memo topic. Present, not absent,
 *                 because `forwardIndexable: true` is observed rather than hoped for.
 *
 * EVERY read path is scoped to ONE TIP-20 token, supplied at construction. That is not a convenience: any
 * address can create a TIP-20 token through the `TIP20Factory` precompile, every token emits the same
 * `TransferWithMemo`, and the memo accepts any 32 bytes — so without a token an attacker mints a worthless
 * token, calls `transferWithMemo(anyone, 1, atrHash)` on it, and every refusal below passes on a log
 * nobody paid for. The `0x20c0…` prefix is no help, since the forgery is inside the reserved range too.
 * Same shape as `binding-evm-x402`'s `config.asset` and `binding-evm-escrow`'s escrow address.
 *
 * Four refusals, all `verification-failure`, and each one exists because the alternative is a fabricated
 * weld: no memo event from the scoped token; a pinned `logIndex` that matches nothing; the only
 * memo-bearing movement being a mint or burn; and the memo being MPP's own attribution value. A fifth —
 * two DIFFERENT memos in one settlement — is refused rather than resolved: MPP splits emit up to eleven
 * transfers, the primary inheriting the top-level memo and each split carrying its own, and picking one of
 * two references would let a seller show different terms to different readers of the same transaction.
 * `ref.logIndex` is how a caller says which transfer it means.
 */
import type {
  BindingManifest,
  Outcome,
  WeldGrade,
} from "@integraledger/lcp-binding-core";
import { encodeTransferWithMemoCall, weldGradeForCall } from "./calls.js";
import { requireTip20Token } from "./constants.js";
import {
  parseTransferWithMemoLog,
  settlementRefOf,
  type TempoBlockRange,
  type TempoLogRange,
  type TempoLogView,
  type TempoSettlementRef,
  type TransferWithMemoEvent,
} from "./log.js";
import { encodeAtrMemo, requireMemo } from "./memo.js";
import { isMppAttributionMemo, mppMethodDetailsMemo } from "./mpp.js";

/**
 * Which TIP-20 token's `TransferWithMemo` counts as this rail's settlement. One token per adapter — a
 * seller accepting two tokens builds two adapters, exactly as `binding-evm-x402` requires one per asset.
 */
export interface TempoMppAdapterConfig {
  readonly token: string;
}

/** Reads one settlement's logs, and logs matching a memo topic. Implemented over any EVM transport. */
export interface TempoReader {
  /** The logs of ONE settlement — `eth_getTransactionReceipt(txHash).logs`. */
  settlementLogs(txHash: string): Promise<TempoLogView[]>;
  /** The forward index — `eth_getLogs` with the memo pinned as topic 3. */
  logsByMemo(memo: string, range: TempoLogRange): Promise<TempoLogView[]>;
}

/**
 * Where the payment goes and how much. The memo comes from the atrHash and the token from the adapter's
 * config — neither is a caller-supplied value here, so the advertisement cannot disagree with what
 * `recover` will accept.
 */
export interface TempoProposalContext {
  readonly to: string;
  /** Token base units. */
  readonly amount: bigint;
}

/** What `propose` yields: the seller's advertisement and the buyer's call, sharing one memo. */
export interface TempoMemoProposal {
  /**
   * Merge into the MPP challenge's `methodDetails` (inside the MAC-protected request body). `memo` only —
   * `TempoMethodDetails` is `{ chainId?, feePayer?, memo?, splits?, supportedModes? }` (every member
   * OPTIONAL, `draft-tempo-charge-00` Method Details, read 2026-08-11) and has no token member, so the
   * token travels in the charge's own payment-method selection, not in a field LCP invented.
   */
  readonly methodDetails: { readonly memo: `0x${string}` };
  readonly call: {
    /** The TIP-20 token contract the transaction is sent TO — the adapter's scoped token. */
    readonly token: string;
    /** The recipient of the transfer, i.e. the call's first argument. */
    readonly to: string;
    readonly amount: bigint;
    readonly memo: `0x${string}`;
    readonly calldata: `0x${string}`;
  };
}

/** The Tempo MPP rail's surface. The memo is an INDEXED event topic, so `enumerate` is a real topic query
 *  rather than a scan — you choose the block window and the adapter pins the token. Two call paths reach
 *  the same event and they do not earn the same grade: `transferWithMemo` is payer-chosen,
 *  `transferFromWithMemo` is spender-chosen, and {@link TempoMppAdapter.weldGradeForCall} needs the
 *  CALLDATA to tell them apart because the log cannot. */
export interface TempoMppAdapter {
  readonly manifest: BindingManifest;
  propose(atrHash: string, ctx: TempoProposalContext): TempoMemoProposal;
  recover(
    ref: TempoSettlementRef,
    reader: TempoReader,
  ): Promise<Outcome<`0x${string}`>>;
  observe(
    ref: TempoSettlementRef,
    reader: TempoReader,
  ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>>;
  /** The caller chooses the block window; the adapter pins the token. */
  enumerate(
    atrHash: string,
    range: TempoBlockRange,
    reader: TempoReader,
  ): Promise<TempoSettlementRef[]>;
  /** The weld grade an observed call earns — `null` when the call carries no memo (see `calls.ts`). */
  weldGradeForCall(calldata: string): WeldGrade | null;
}

function refuse(
  code: string,
  detail: string,
): {
  refused: true;
  haltClass: "verification-failure";
  code: string;
  detail: string;
} {
  return { refused: true, haltClass: "verification-failure", code, detail };
}

/** Construct the Tempo MPP adapter. **The manifest is injected, not baked in** — pass this package's own
 *  `TEMPO_MPP_MANIFEST`; a manifest whose `rail` is not `"tempo:mpp"` throws. `config.token` is REQUIRED
 *  and is the rail's forgery defence, not configuration: TIP-20 creation is permissionless and every token
 *  emits the same `TransferWithMemo`, so an adapter that did not pin one token could be shown an
 *  attacker's log. A token outside the TIP-20 range throws here rather than refusing later. This is the
 *  package's entry point. */
export function createTempoMppAdapter(
  manifest: BindingManifest,
  config: TempoMppAdapterConfig,
): TempoMppAdapter {
  // Fail-fast: an adapter constructed over another rail's manifest would report that rail's claims as
  // this one's. The EVM adapters bake their module const in; the injectable factories refuse instead.
  // Stryker disable next-line all: the guard runs during test-module load (the repository's
  // test suite constructs the adapter at describe scope), so its mutants are 'static' — outside the vitest
  // runner's per-test attribution and unkillable by any test that in fact kills them behaviorally
  // (each rail pins both arms: valid manifest constructs, wrong rail throws by message).
  if (manifest.rail !== "tempo:mpp")
    throw new Error(
      `createTempoMppAdapter: manifest.rail "${manifest.rail}" is not "tempo:mpp"`,
    );
  // Throws rather than refusing: an unverifiable token is a deployment error, and an adapter that cannot
  // say which token it verifies must not exist at all.
  const token = requireTip20Token(config.token, "createTempoMppAdapter");

  // A closure rather than `this` so the returned methods stay destructure-safe.
  async function doRecover(
    ref: TempoSettlementRef,
    reader: TempoReader,
  ): Promise<Outcome<`0x${string}`>> {
    const logs = await reader.settlementLogs(ref.txHash);
    // Built with a loop, not map+filter: `filter` does not narrow the element type, so the downstream
    // reads would need `?.` on a value that is never null — an optional chain no test could ever exercise.
    const found: Array<{ event: TransferWithMemoEvent; log: TempoLogView }> =
      [];
    for (const log of logs) {
      const event = parseTransferWithMemoLog(log);
      if (event === null) continue;
      // The token scope, applied FIRST: a foreign token's log is not this rail's settlement, so it must
      // not reach the ambiguity check either (where it could grief a good settlement into a refusal).
      if (event.address !== token) continue;
      found.push({ event, log });
    }
    if (found.length === 0)
      return refuse(
        "tempo-mpp/no-memo-event",
        `no TransferWithMemo log from token ${token} in settlement ${ref.txHash}`,
      );

    const scoped =
      ref.logIndex === undefined
        ? found
        : found.filter((e) => settlementRefOf(e.log).logIndex === ref.logIndex);
    if (scoped.length === 0)
      return refuse(
        "tempo-mpp/log-index-mismatch",
        `settlement ${ref.txHash} has no TransferWithMemo at logIndex ${ref.logIndex}`,
      );

    const transfers = scoped.filter((e) => e.event.movement === "transfer");
    if (transfers.length === 0)
      return refuse(
        "tempo-mpp/memo-not-a-transfer",
        `the memo-bearing movements in ${ref.txHash} are mints or burns, not transfers — a memo on an issuance is not a settlement weld`,
      );

    const memos = [...new Set(transfers.map((e) => e.event.memo))];
    if (memos.length > 1)
      return refuse(
        "tempo-mpp/ambiguous-memos",
        `settlement ${ref.txHash} carries ${memos.length} different memos (${memos.join(", ")}) — pin one with ref.logIndex rather than choosing for the caller`,
      );

    const memo = memos[0];
    if (memo === undefined)
      throw new Error(
        "createTempoMppAdapter.recover: unreachable — a non-empty transfer set yielded no memo",
      );
    if (isMppAttributionMemo(memo))
      return refuse(
        "tempo-mpp/memo-is-mpp-attribution",
        `the memo on ${ref.txHash} is MPP's own attribution memo (${memo}), not a reference the seller advertised`,
      );
    return { ok: true, value: memo };
  }

  return {
    manifest,

    propose(atrHash: string, ctx: TempoProposalContext): TempoMemoProposal {
      const memo = encodeAtrMemo(atrHash);
      return {
        methodDetails: mppMethodDetailsMemo(atrHash),
        call: {
          token,
          to: ctx.to,
          amount: ctx.amount,
          memo,
          calldata: encodeTransferWithMemoCall({
            to: ctx.to,
            amount: ctx.amount,
            memo,
          }),
        },
      };
    },

    recover(
      ref: TempoSettlementRef,
      reader: TempoReader,
    ): Promise<Outcome<`0x${string}`>> {
      return doRecover(ref, reader);
    },

    async observe(
      ref: TempoSettlementRef,
      reader: TempoReader,
    ): Promise<Outcome<{ state: "settled"; atrHash: `0x${string}` }>> {
      const recovered = await doRecover(ref, reader);
      if ("refused" in recovered) return recovered;
      return {
        ok: true,
        value: { state: "settled", atrHash: recovered.value },
      };
    },

    async enumerate(
      atrHash: string,
      range: TempoBlockRange,
      reader: TempoReader,
    ): Promise<TempoSettlementRef[]> {
      // No attribution guard here, deliberately, and the asymmetry with `recover` is the point: `recover`
      // INFERS a reference from the chain, where mistaking attribution bytes for an atrHash would invent a
      // weld; `enumerate` is handed the value to look for, so returning the settlements that carry it
      // invents nothing. It is also what lets the live-chain proof of `forwardIndexable` run against real
      // mainnet traffic, where the memos in circulation are attribution memos.
      const want = requireMemo(atrHash, "enumerate");
      const scopedRange: TempoLogRange = {
        address: token,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      };
      const logs = await reader.logsByMemo(want, scopedRange);
      const refs: TempoSettlementRef[] = [];
      for (const log of logs) {
        const event = parseTransferWithMemoLog(log);
        // A node should never return a log outside the filter; if one does, it must not be attributed to
        // this reference. Re-checking the token here is what makes the scope a property of the adapter
        // rather than of the provider's filter handling.
        if (event === null || event.movement !== "transfer") continue;
        if (event.address !== token) continue;
        if (event.memo !== want) continue;
        refs.push(settlementRefOf(log));
      }
      return refs;
    },

    weldGradeForCall,
  };
}
