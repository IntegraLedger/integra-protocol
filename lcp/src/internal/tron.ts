/**
 * The x402 payment a Tron payer presents. `../tron.ts` returns it from `complete`, and the root names it among the
 * payments `Presented` covers; both export the name.
 */
import type { X402Payment } from "./x402.js";

export type TronPayment = X402Payment<{ transaction: string }>;
