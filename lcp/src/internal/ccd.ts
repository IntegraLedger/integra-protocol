/**
 * The x402 payment a Concordium payer presents. `../ccd.ts` returns it from `complete`, and the root names it among
 * the payments `Presented` covers; no entry point exports the name.
 */
import type { Json } from "../core.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

export type CcdPaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { signedTransaction: { [k: string]: Json } };
  extensions?: PaymentRequired["extensions"];
};
