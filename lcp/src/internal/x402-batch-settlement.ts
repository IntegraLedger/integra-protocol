/**
 * The x402 payment a batch-settlement payer presents on EVM or Solana. `../x402-batch-settlement.ts` returns it from
 * `complete` and takes it in the channel members, and the root names it among the payments `Presented` covers; no
 * entry point exports the name.
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
