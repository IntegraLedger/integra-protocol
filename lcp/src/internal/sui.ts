/**
 * The x402 payment a Sui payer presents. `../sui.ts` returns it from `complete`, and the root names it among the
 * payments `Presented` covers; no entry point exports the name.
 */
import type { SuiPayload } from "../sui.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

export interface SuiPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: SuiPayload;
  extensions?: PaymentRequired["extensions"];
}
