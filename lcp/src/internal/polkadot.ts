/**
 * The x402 payment a Polkadot payer presents. `../polkadot.ts` returns it from `complete`, and the root names it among
 * the payments `Presented` covers; no entry point exports the name.
 */
import type { Hex } from "../evm.js";
import type { X402Payment } from "./x402.js";

/** The x402 payload: the signed extrinsic and its call, lowercase hex. */
type PolkadotPayload = { extrinsic: Hex; call: Hex };

export type PolkadotPaymentPayload = X402Payment<PolkadotPayload>;
