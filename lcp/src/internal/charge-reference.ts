/**
 * The seller's own reference for a charge, the key by which a seller keeps a payment through a pairing whose payer
 * presents nothing signed: `card/seller-reference`, `acp/checkout/undelegated` and `ucp/checkout/unsigned`. Their payer
 * signs nothing that carries H, so the payment is named by the processor's identifier of it, as the seller names it.
 */
import { isObject } from "../fields.js";

/**
 * The longest charge reference lcp reads, in characters: a resource bound on what the seller presents, the bound lcp's
 * Stripe subscription key takes for a Stripe ID (`mpp-card-stripe.ts`), which an Adyen `pspReference` (16 characters)
 * is well within.
 */
export const MAX_CHARGE_REFERENCE = 255;

/** What the seller presents of a charge: its own reference for it, the processor's identifier of the payment. */
export interface ChargePresented {
  /** 1 to 255 visible ASCII characters: a Stripe PaymentIntent's `id`, an Adyen `pspReference`. */
  charge: string;
}

/** The reference of a charge: the checkout of the option it answers, where the option names one, and the charge. */
export interface ChargeRef {
  checkout?: string;
  charge: string;
}

const VISIBLE = /^[\x21-\x7e]+$/;

/** The charge reference presented, or undefined where the value is not an object whose `charge` has that form. */
export function chargeOf(presented: unknown): string | undefined {
  if (!isObject(presented)) return undefined;
  const c = presented["charge"];
  return typeof c === "string" && c.length >= 1 && c.length <= MAX_CHARGE_REFERENCE && VISIBLE.test(c) ? c : undefined;
}
