/**
 * The x402 payment an Aptos payer presents. `../aptos.ts` returns it from `complete`, and the root names it among the
 * payments `Presented` covers; no entry point exports the name.
 */
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

export interface AptosPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string };
  extensions?: PaymentRequired["extensions"];
}
