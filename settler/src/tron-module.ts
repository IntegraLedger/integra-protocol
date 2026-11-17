/**
 * The Tron rail as the settler's modules: one for each configured network, for the scheme `exact` and the pairing
 * `x402/exact/tron/lcp-trc20-memo`. Its verification and settlement are the rail's, unchanged; the payer signs and pays
 * every fee, so the module holds no key.
 */
import { exactTronMemo, LCP_TRC20_MEMO } from "@integraledger/lcp/tron";
import type { Network, PaymentPayload, PaymentRequirements, SchemeNetworkFacilitator } from "@x402/core/types";
import { failed, invalid, readRequest, type FacilitatorRequest, type OperatorLog, type SettleAnswer } from "./answers.js";
import { outcomeOf, type Module, type X402Payment } from "./module.js";
import type { createTron } from "./tron.js";
import { unexpectedSettle, unexpectedVerify } from "./unexpected.js";

type TronRail = ReturnType<typeof createTron>;

/** The x402 facilitator request that carries `payload` and `requirements`, read by the rail's shared shape checks. */
function requestOf(payload: PaymentPayload, requirements: PaymentRequirements): ReturnType<typeof readRequest> {
  return readRequest({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements });
}

function settled(answer: SettleAnswer) {
  return { ...answer, network: answer.network as Network };
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
        // lcp's Tron agreement floor is 1: no payment of zero is settled.
        acceptsZero: false,
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
            // The id is the SHA-256 of the signed raw_data, which holds no signature.
            instrument: { by: "transaction", network: c.network as Network, transaction: c.txid },
            nonce: exactTronMemo.data.nonce,
            keep: { until: "lapse", at: Number(c.raw.expiration) },
          };
        },
        async read(p, at) {
          const r = request(p);
          if (typeof r === "string") return outcomeOf({ state: "unreadable", reason: "unparseable", foreign: [] });
          return outcomeOf(await rail.status(r, at.deadline, at.search));
        },
      },
      fees: {
        paysFee: () => false,
        payerBroadcast: () => false,
      },
    };
  });
}
