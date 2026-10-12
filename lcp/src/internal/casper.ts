/**
 * The x402 payment a Casper payer presents, with the CEP-3009 authorization it carries. `../casper.ts` returns the
 * payment from `complete`, and the root names it among the payments `Presented` covers; no entry point exports
 * either name.
 */
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

export type CasperAuthorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

export type CasperPaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { authorization: CasperAuthorization; publicKey: string; signature: string };
  extensions?: PaymentRequired["extensions"];
};
