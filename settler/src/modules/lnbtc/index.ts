/**
 * The Lightning module: x402's `exact` scheme on the `lnbtc` networks, for lcp's pairing `x402/exact/lnbtc/payment-hash`,
 * written to x402's scheme text (`specs/schemes/exact/scheme_exact_lnbtc.md`) and lcp's profile
 * `x402-exact-lnbtc-payment-hash.md`.
 * The buyer's node paid the invoice before the preimage reached the buyer, so settling moves nothing. The module makes
 * the scheme's whole validation through lcp's `validateExactLnbtc`, the export a resource server also runs before it
 * settles: the invoice's signature, its signer against `payTo`, its `h` against the request hash, its `p` against
 * `extra.paymentHash`, the preimage against `p`, and the paid-but-expired window. It answers the invoice's payment hash
 * as the transaction and names no payer, since Lightning shows none.
 *
 * The settler's record holds the network and the payment hash, the scheme's consumption key, once: a second settle of
 * one hash is answered from the record, never with a second success. The module holds no key, submits nothing and pays
 * no fee. No public ledger shows a Lightning payment and lcp gives the pairing no read, so the module reads nothing: a
 * success is final at once, and the record is what remembers it.
 *
 * x402's scheme forbids `/verify` for this flow; the module's `verify` is the scheme's validation, which `/settle` makes
 * before the record's claim.
 */
import { isRefusal } from "@integraledger/lcp";
import {
  decodeBolt11,
  exactLnbtcPaymentHash,
  validateExactLnbtc,
  type ExactLnbtcValidation,
  type LnNetwork,
} from "@integraledger/lcp/lightning";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { isObject } from "../../answers.js";
import type { ChainRead, Instrumented, Keep, Module, ModuleStarter, Refused, Registration, X402Payment } from "../../module.js";

/** One network the module settles on. */
export interface LnbtcNetworkConfig {
  /** x402's `lnbtc` id of Bitcoin mainnet or testnet3. */
  readonly network: LnNetwork;
}

/** The module's member of the configuration: one entry per network. */
export type LnbtcConfig = readonly LnbtcNetworkConfig[];

/** The networks lcp's `lnbtc` codec admits, held to its type so that one it adds is a compile error here. */
const NETWORKS = {
  "lnbtc:000000000019d6689c085ae165831e93": true,
  "lnbtc:000000000933ea01ad0ee984209779ba": true,
} as const satisfies Record<LnNetwork, true>;

/**
 * x402's clock-skew allowance, in seconds, which `validateExactLnbtc` applies by default: a proof passes until the
 * invoice's end plus this (the scheme's Paid-but-expired Policy).
 */
const SKEW_SECONDS = 60;

const HASH = /^[0-9a-f]{64}$/;

/**
 * lcp gives this pairing no read: no public ledger shows the payment and no node is asked. The read finds nothing, so a
 * claim the record holds stays live and is never sent again.
 */
const NOTHING_READ: ChainRead = { outcome: "live", answer: { state: "pending", reason: "not-found", foreign: [] } };

/** The scheme's validation at the settler's clock, in Unix seconds. */
function validated(payload: PaymentPayload, requirements: PaymentRequirements): ExactLnbtcValidation {
  const v = validateExactLnbtc(payload, requirements, { now: Math.floor(Date.now() / 1000) });
  // Refused only for a time that is not a non-negative safe integer, which the clock never gives.
  if (isRefusal(v)) throw new TypeError(`the scheme's validation refused its time: ${v.code}`);
  return v;
}

/**
 * The latest time the scheme accepts the accepted invoice's proof, its creation time plus its expiry plus the skew, in
 * Unix milliseconds. An invoice that does not decode is refused by the validation before any claim, so no row is kept
 * for it.
 */
async function keepOf(payload: PaymentPayload): Promise<Keep> {
  const invoice = isObject(payload.accepted?.extra) ? payload.accepted.extra["invoice"] : undefined;
  const b = typeof invoice === "string" ? await decodeBolt11(invoice) : undefined;
  if (b === undefined || isRefusal(b)) return { until: "settler" };
  return { until: "lapse", at: (b.timestamp + b.expiry + SKEW_SECONDS) * 1000 };
}

const facilitator: SchemeNetworkFacilitator = {
  scheme: "exact",
  caipFamily: "lnbtc:*",
  getExtra: () => undefined,
  getSigners: () => [],
  async verify(payload, requirements): Promise<VerifyResponse> {
    const v = validated(payload, requirements);
    return v.valid ? { isValid: true } : { isValid: false, invalidReason: v.reason };
  },
  async settle(payload, requirements): Promise<SettleResponse> {
    const v = validated(payload, requirements);
    return v.valid
      ? { success: true, transaction: v.paymentHash, network: v.network }
      : { success: false, errorReason: v.reason, transaction: "", network: requirements.network };
  },
};

const record: Module["record"] = {
  /**
   * The payment hash the requirements commit, on their network: x402's consumption key. Requirements without one are
   * not this pairing's, whose option always carries it.
   */
  async instrument({ payload, requirements }: X402Payment): Promise<Instrumented | Refused> {
    const hash = isObject(requirements.extra) ? requirements.extra["paymentHash"] : undefined;
    if (typeof hash !== "string" || !HASH.test(hash)) return { refused: "invalid_payment_requirements" };
    return {
      pairing: exactLnbtcPaymentHash.id,
      instrument: { by: "transaction", network: requirements.network, transaction: hash },
      nonce: exactLnbtcPaymentHash.data.nonce,
      keep: await keepOf(payload),
    };
  },
  read: async () => NOTHING_READ,
};

function moduleOn(network: Network): Module {
  return {
    descriptor: { name: "lnbtc", key: "none", pairings: [exactLnbtcPaymentHash.id], acceptsZero: false, verifyForbidden: true },
    network,
    facilitator,
    record,
    // The payer's node paid the invoice; the module sends nothing.
    fees: { paysFee: () => false, payerBroadcast: () => true },
  };
}

export const starter: ModuleStarter<LnbtcConfig> = {
  name: "lnbtc",
  async start(config) {
    const registrations: Registration[] = config.map(({ network }) => {
      if (!Object.hasOwn(NETWORKS, network)) throw new TypeError(`lnbtc: ${String(network)} is not an lnbtc network`);
      return { network, module: moduleOn(network), own: [] };
    });
    return { registrations };
  },
};
