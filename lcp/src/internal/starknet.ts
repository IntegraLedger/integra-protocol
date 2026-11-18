/**
 * The x402 payment a Starknet payer presents. `../starknet.ts` returns it from `complete`, and the root names it among
 * the payments `Presented` covers; both export the name.
 */
import type { Felt, OutsideExecutionTypedData } from "../starknet.js";
import type { X402Payment } from "./x402.js";

export type StarknetPayment = X402Payment<{
  from: Felt;
  outsideExecution: { typedData: OutsideExecutionTypedData; signature: readonly Felt[] };
}>;
