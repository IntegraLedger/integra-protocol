/**
 * The Tron rail as the settler's modules: one for each configured network, for the scheme `exact` and the pairing
 * `x402/exact/tron/lcp-trc20-memo`. Its checks, broadcast, wait and read are the rail's; the payer signs and pays every
 * fee, so the module holds no key. The record of which payments are settled is the settler's, keyed by this module's
 * instrument, the transaction id, and holding where lcp's read of the payment searches from: the last solidified block
 * read before the broadcast.
 */
import { exactTronMemo, LCP_TRC20_MEMO, type TronCursor } from "@integraledger/lcp/tron";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { failed, invalid, readRequest, type FacilitatorRequest, type OperatorLog, type SettleAnswer } from "../../answers.js";
import { outcomeOf, type Module, type ModuleStarter, type X402Payment } from "../../module.js";
import { unexpectedSettle, unexpectedVerify } from "../../unexpected.js";
import { createTron, type TronNode } from "./rail.js";

export { createTron, type TronNode } from "./rail.js";

type TronRail = ReturnType<typeof createTron>;

/** The x402 facilitator request that carries `payload` and `requirements`, read by the rail's shared shape checks. */
function requestOf(payload: PaymentPayload, requirements: PaymentRequirements): ReturnType<typeof readRequest> {
  return readRequest({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
}

function settled(answer: SettleAnswer) {
  return { ...answer, network: answer.network as Network };
}

/** A search position as the record gives it back: the block number and its `blockID`. */
function cursorOf(v: unknown): TronCursor | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { number, blockId } = v as Record<string, unknown>;
  if (typeof number !== "bigint" || typeof blockId !== "string" || !/^0x[0-9a-f]{64}$/.test(blockId)) return undefined;
  return { number, blockId: blockId as TronCursor["blockId"] };
}

/** One module per network the rail serves. `log` is the operator log the rail was made with. */
export function tronModules(rail: TronRail, log: OperatorLog): Module[] {
  return rail.networks.map((name): Module => {
    const network = name as Network;
    const facilitator: SchemeNetworkFacilitator = {
      scheme: "exact",
      caipFamily: "tron:*",
      getExtra: () => ({ assetTransferMethod: LCP_TRC20_MEMO }),
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
        name: "tron",
        key: "none",
        pairings: [exactTronMemo.id],
        // The profile's floor is 1 base unit until a run shows a contract's transfer(to, 0) succeeding with a Transfer
        // log (rule 1); no contract is so shown, so no payment of zero is settled.
        acceptsZero: [],
      },
      network,
      facilitator,
      record: {
        async instrument(p) {
          const r = request(p);
          const c = typeof r === "string" ? r : await rail.check(r);
          if (typeof c === "string") return { refused: c };
          return {
            pairing: exactTronMemo.id,
            // The id is the SHA-256 of the signed raw_data, which holds no signature (profile rule 7: the replay
            // primitive), so a payment signed by other keys of the same permission is the same instrument.
            instrument: { by: "transaction", network: c.network as Network, transaction: c.txid },
            nonce: exactTronMemo.data.nonce,
            keep: { until: "lapse", at: Number(c.raw.expiration) },
          };
        },
        async read(p, at) {
          const r = request(p);
          if (typeof r === "string") return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
          return outcomeOf(await rail.status(r, at.deadline, cursorOf(at.from), at.search));
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
 * The Tron module, started from the configuration's `tron` member: one FullNode and its Solidity node per network.
 * The FullNode keeps the whole block history, as lcp's read of a payment requires of it.
 */
export const starter: ModuleStarter<readonly TronNode[]> = {
  name: "tron",
  async start(nodes, core) {
    const rail = createTron(
      nodes.map((n) => ({ ...n, fullNode: trimmed(n.fullNode), solidityNode: trimmed(n.solidityNode) })),
      core.settleWaitMs,
      core.log,
    );
    return { registrations: tronModules(rail, core.log).map((module) => ({ network: module.network, module, own: [] })) };
  },
};
