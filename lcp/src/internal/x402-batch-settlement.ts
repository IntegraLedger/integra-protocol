/**
 * The x402 payments a batch-settlement payer presents. `../x402-batch-settlement.ts` returns the EVM and Solana
 * payment from `complete` and takes it in the channel members, and returns the Cloudflare payment from that pairing's
 * `build`; the root names both among the payments `Presented` covers, and no entry point exports either name.
 */
import type { Json } from "../core.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

export interface BatchPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { type: string; [k: string]: Json };
  extensions?: PaymentRequired["extensions"];
}

/** The request's payment document: the option's amount and asset, with the challenge's `extensions` echoed. */
export interface CloudflarePaymentPayload {
  x402Version: 2;
  payload: { amount: string; asset: string };
  accepted: PaymentRequirements;
  extensions: NonNullable<PaymentRequired["extensions"]>;
}
