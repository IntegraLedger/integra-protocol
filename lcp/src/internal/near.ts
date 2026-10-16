/**
 * The x402 payment a NEAR payer presents, and the NEP-461 prefix a delegate's key signs under. `../near.ts` returns the
 * payment from `complete`, and the root names it among the payments `Presented` covers; no entry point exports the
 * name. `../near.ts` re-exports `NEP461_DELEGATE` from here rather than from `./near-delegate.ts`, whose declarations
 * name the optional borsh peer's types, so no entry point's declarations import borsh.
 */
import type { X402Payment } from "./x402.js";

export type NearPayment = X402Payment<{ signedDelegateAction: string }>;

/** The NEP-461 prefix for a delegate action: (1 << 30) + 366. */
export const NEP461_DELEGATE = 1073742190;
