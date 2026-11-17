/**
 * The Polkadot rail as the settler's modules: one for each configured network, for the scheme `exact` and the pairing
 * `x402/exact/polkadot/lcp-assets-remark`. Its checks, submission, wait and read are the rail's; the payer signs and
 * pays every fee, so the module holds no key. The record of which payments are settled is the settler's, keyed by
 * this module's instrument: the signer and the account nonce it signed, never the extrinsic's hash, which a re-signing
 * at the same nonce changes. The record also holds where lcp's read of the payment searches from, read before the
 * submission: the block the search starts after, and the head at which the chain answered the extrinsic valid, which
 * proves the era's last block, so that a later read, after a restart too, can answer the lapse.
 */
import { exactPolkadotRemark, LCP_ASSETS_REMARK, POLKADOT_BOUNDS, type PolkadotCursor } from "@integraledger/lcp/polkadot";
import { isRefusal } from "@integraledger/lcp/core";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { failed, invalid, readRequest, type FacilitatorRequest, type OperatorLog, type SettleAnswer } from "../../answers.js";
import { outcomeOf, type Module, type ModuleStarter, type X402Payment } from "../../module.js";
import { unexpectedSettle, unexpectedVerify } from "../../unexpected.js";
import { createPolkadot, type PolkadotNode, type PolkadotPosition } from "./rail.js";

export { BLOCK_READS, blockReads, createPolkadot, type PolkadotNode, type PolkadotPosition } from "./rail.js";

/**
 * The most milliseconds a block of Polkadot Asset Hub takes while the chain produces blocks: 12 s, a relay chain slot
 * of 6 s taken twice, as the settler takes it for the longest an era can keep a payment payable.
 */
const SLOW_BLOCK_MS = 12_000;

type PolkadotRail = ReturnType<typeof createPolkadot>;

/** The x402 facilitator request that carries `payload` and `requirements`, read by the rail's shared shape checks. */
function requestOf(payload: PaymentPayload, requirements: PaymentRequirements): ReturnType<typeof readRequest> {
  return readRequest({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
}

function settled(answer: SettleAnswer) {
  return { ...answer, network: answer.network as Network };
}

/** A read position as the record gives it back: each block number a `bigint`. */
function positionOf(v: unknown): PolkadotPosition | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { after, search } = v as Record<string, unknown>;
  if (typeof after !== "bigint" || typeof search !== "object" || search === null) return undefined;
  const { next, hits, validated } = search as Record<string, unknown>;
  if (typeof next !== "bigint" || !Array.isArray(hits) || !hits.every((h) => typeof h === "string")) return undefined;
  if (validated !== undefined && typeof validated !== "bigint") return undefined;
  const cursor: PolkadotCursor = { next, hits: hits as string[], ...(validated === undefined ? {} : { validated }) };
  return { after, search: cursor };
}

/** One module per network the rail serves. `log` is the operator log the rail was made with. */
export function polkadotModules(rail: PolkadotRail, log: OperatorLog): Module[] {
  /** The signer and the nonce it signed, from the signed bytes by lcp's `reference`; or the refusal. */
  async function keyed(r: FacilitatorRequest) {
    const l = await rail.local(r);
    if (typeof l === "string") return l;
    const ref = await exactPolkadotRemark.reference(r.paymentPayload as never, r.paymentRequirements as never);
    // An immortal era never lapses: the profile's extrinsic is mortal, and the rail submits no other.
    if (isRefusal(ref) || ref.era === "immortal") return "invalid_payload" as const;
    return { ...ref, era: ref.era };
  }
  return rail.networks.map((name): Module => {
    const network = name as Network;
    const facilitator: SchemeNetworkFacilitator = {
      scheme: "exact",
      caipFamily: "polkadot:*",
      getExtra: () => ({ assetTransferMethod: LCP_ASSETS_REMARK }),
      getSigners: () => [],
      async verify(payload, requirements) {
        const r = requestOf(payload, requirements);
        if (typeof r === "string") return invalid(r);
        try {
          return await rail.verify(r);
        } catch (e) {
          return invalid(unexpectedVerify(log, { event: "verify-error", network: r.paymentRequirements.network }, e));
        }
      },
      async settle(payload, requirements) {
        const r = requestOf(payload, requirements);
        if (typeof r === "string") return settled(failed(r, "", requirements.network));
        try {
          return settled(await rail.settle(r));
        } catch (e) {
          return settled(unexpectedSettle(log, { event: "settle-error", network: r.paymentRequirements.network }, e));
        }
      },
    };
    const request = (p: X402Payment): FacilitatorRequest | string => requestOf(p.payload, p.requirements);
    return {
      descriptor: {
        name: "polkadot",
        key: "none",
        pairings: [exactPolkadotRemark.id],
        // The assets pallet returns early on a transfer of zero and emits no `Transferred` event, so the smallest
        // amount is one base unit (polkadot-sdk `substrate/frame/assets/src/functions.rs`, `do_transfer`).
        acceptsZero: false,
      },
      network,
      facilitator,
      record: {
        async instrument(p) {
          const r = request(p);
          const k = typeof r === "string" ? r : await keyed(r);
          if (typeof k === "string") return { refused: k };
          // The extrinsic can land no later than its era's last block, and no later than BlockHashCount + 1 blocks
          // after its era's birth, which is at or below the head the chain validated it at before its submission.
          const blocks = Math.min(k.era.period, POLKADOT_BOUNDS.blockHashCount + 1);
          return {
            pairing: exactPolkadotRemark.id,
            instrument: { by: "single-use", network: k.network as Network, signer: k.signer, value: k.nonce },
            nonce: exactPolkadotRemark.data.nonce,
            keep: { until: "life", ms: blocks * SLOW_BLOCK_MS },
          };
        },
        async read(p, at) {
          const r = request(p);
          if (typeof r === "string") return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
          return outcomeOf(await rail.status(r, at.deadline, positionOf(at.from), at.search));
        },
        async position(p, at) {
          const r = request(p);
          return typeof r === "string" ? undefined : rail.position(r, at.deadline);
        },
      },
      fees: {
        paysFee: () => false,
        payerBroadcast: () => false,
      },
    };
  });
}

function trimmed(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The Polkadot module, started from the configuration's `polkadot` member: one JSON-RPC node per network, which serves
 * `state_call` and `author_submitExtrinsic`. Its metadata is loaded on the network's first request; `close` ends it.
 */
export const starter: ModuleStarter<readonly PolkadotNode[]> = {
  name: "polkadot",
  async start(nodes, core) {
    const rail = createPolkadot(
      nodes.map((n) => ({ ...n, rpc: trimmed(n.rpc) })),
      core.settleWaitMs,
      core.log,
    );
    return {
      registrations: polkadotModules(rail, core.log).map((module) => ({ network: module.network, module, own: [] })),
      close: () => rail.close(),
    };
  },
};
