/**
 * The x402 payment a TON payer presents. `../tvm.ts` returns it from `complete`, and the root names it among the
 * payments `Presented` covers; no entry point exports the name.
 */
import type { X402Payment } from "../x402.js";

export type TvmPayment = X402Payment<{ settlementBoc: string; asset: string }>;
