/**
 * The x402 payment a Cardano payer presents. `../cardano.ts` returns it from `complete`, and the root names it among
 * the payments `Presented` covers; no entry point exports the name.
 */
import type { CardanoPayload } from "../cardano.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

export interface CardanoPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: CardanoPayload;
  extensions?: PaymentRequired["extensions"];
}
