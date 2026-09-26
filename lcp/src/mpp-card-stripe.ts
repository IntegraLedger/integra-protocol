/**
 * `mpp/charge/card`, `mpp/charge/stripe` and `mpp/subscription/stripe`: the ATR hash in the MPP challenge the seller's
 * server binds, and in the method's reference field (the card request's `externalId`, or the Stripe
 * `methodDetails.metadata.legal_context` that settlement copies into the PaymentIntent). Nothing the buyer's card or
 * Stripe token signs carries the hash, so `build` and `bound` refuse `mpp/no-signed-place`. The subscription is a
 * channel: one ATR covers every billing period, and its key is the Stripe subscription the activation receipt names.
 */
import { toLcpString, type AtrHash, type Json } from "./core.js";
import {
  credentialOf,
  decodeObject,
  deepFreeze,
  echoedFor,
  isObject,
  placeCarrier,
  read,
  tie,
  withoutCarrier,
  type MppChallenge,
  type MppChoice,
  type MppPairing,
} from "./mpp-challenge.js";
import { stripeMetadataValid } from "./mpp-method-checks.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

/** The Stripe metadata key the seller places H under: at most 40 characters, no square brackets. */
export const LEGAL_CONTEXT_METADATA_KEY = "legal_context";

type ConfirmOnly = "mpp/charge/card" | "mpp/charge/stripe" | "mpp/subscription/stripe";

const PROVES =
  "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
  "recorded in <transaction>. The ATR was in the seller's storage before payment. The seller's MPP challenge carried " +
  "this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the " +
  "buyer's credential echoed that challenge. The seller also placed the hash in the method's reference field " +
  "(externalId for card; the PaymentIntent's metadata for Stripe). Nothing the buyer or its card or Stripe token " +
  "signed carries the hash, and the seller checked nothing the buyer signed. Settlement is the seller's report. " +
  "This record does not show that the buyer's approval carried the hash.";

const SUBSCRIPTION_PROVES =
  PROVES +
  " Later billing periods were paid under this ATR by renewal invoices the seller did not read. The close is the " +
  "seller's report.";

function patternOf(proves: string): LcpPattern {
  return deepFreeze({
    pattern: "opaque-challenge",
    canonical: true,
    buyerSigns: false,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves,
  });
}

const pattern = patternOf(PROVES);

/**
 * MPP's `place`, with the agreement URL when given, then the carrier set to H's LCP string. An issued carrier holding
 * another value is `mpp/carrier-occupied`. On Stripe, metadata that could not take one more key within Stripe's bounds
 * is `mpp/metadata-malformed`.
 */
function advertiseAs(pairing: ConfirmOnly) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    if (!isObject(offer) || offer.intent !== pairing.split("/")[1] || offer.method !== pairing.split("/")[2]) {
      return refusal("mpp/not-this-pairing");
    }
    if (offer.method === "stripe") {
      const request = typeof offer.request === "string" ? decodeObject(offer.request) : undefined;
      const details = request?.["methodDetails"];
      const metadata = isObject(details) ? details["metadata"] : undefined;
      const missing = isObject(metadata) && Object.hasOwn(metadata, LEGAL_CONTEXT_METADATA_KEY) ? 0 : 1;
      const ok = stripeMetadataValid(metadata, missing);
      if (ok !== true) return ok;
    }
    let value: string;
    try {
      value = toLcpString(h);
    } catch {
      return refusal("mpp/challenge-malformed");
    }
    return placeCarrier(
      doc,
      h,
      link,
      offer,
      (issued: Json | undefined) => (issued === undefined || issued === value ? value : refusal("mpp/carrier-occupied")),
      agreementUrl,
    );
  };
}

/** Nothing the buyer signs has a place for H. */
async function build(_choice: MppChoice, _h: AtrHash): Promise<Refusal> {
  return refusal("mpp/no-signed-place");
}

/** The echoed challenge is checked as this pairing's; nothing the buyer signed carries H. */
function boundAs(pairing: ConfirmOnly) {
  return async (input: unknown): Promise<AtrHash | Refusal> => {
    const credential = credentialOf(input);
    if (isRefusal(credential)) return credential;
    const e = echoedFor(credential, pairing as MppPairing);
    if (isRefusal(e)) return e;
    return refusal("mpp/no-signed-place");
  };
}

function pairingOf<Id extends ConfirmOnly>(id: Id, carrier: string, p: LcpPattern = pattern) {
  return Object.freeze({
    id,
    pattern: p,
    claims: false as boolean,
    carrier,
    unplaced: withoutCarrier,
    tie,
    advertise: advertiseAs(id),
    read,
    build,
    bound: boundAs(id),
  });
}

export const chargeCard = pairingOf("mpp/charge/card", "request.externalId");
export const chargeStripe = pairingOf("mpp/charge/stripe", "request.methodDetails.metadata.legal_context");
/**
 * The Stripe subscription's activation receipt, the `Payment-Receipt` payload decoded from its base64url JSON (or the
 * MCP transport's receipt object as given). The seller passes it when it reports the opening paid.
 */
export interface StripeSubscriptionReceipt {
  method: "stripe";
  /** The Stripe invoice whose payment activated the subscription. */
  reference: string;
  status: "success";
  /** The seller's own identifier for the subscription. */
  subscriptionId: string;
  /** The Stripe subscription ID. */
  stripeSubscription: string;
  timestamp: string;
  externalId?: string;
}

/** The network name every Stripe subscription channel key carries. */
const SUBSCRIPTION_CHANNEL_NETWORK = "stripe";
/** A Stripe ID: 1 to 255 visible ASCII characters. */
const STRIPE_ID = /^[\x21-\x7e]{1,255}$/;

/**
 * The channel's key from the activation receipt: `{network: "stripe", channel: stripeSubscription}`. The presented
 * credential is not read. No receipt is `mpp/receipt-missing`; one that is not a successful Stripe receipt with a
 * Stripe subscription ID is `mpp/receipt-malformed`.
 */
async function subscriptionRef(
  _presented: unknown,
  receipt?: StripeSubscriptionReceipt,
): Promise<{ network: string; channel: string } | Refusal> {
  if (receipt === undefined) return refusal("mpp/receipt-missing");
  if (!isObject(receipt) || receipt.method !== "stripe" || receipt.status !== "success") {
    return refusal("mpp/receipt-malformed");
  }
  const id: unknown = receipt.stripeSubscription;
  if (typeof id !== "string" || !STRIPE_ID.test(id)) return refusal("mpp/receipt-malformed");
  return { network: SUBSCRIPTION_CHANNEL_NETWORK, channel: id };
}

/** Renewal invoices are Stripe's own off-session charges: none carries the hash. */
async function subscriptionBoundWithin(_presented: unknown): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

export const subscriptionStripe = Object.freeze({
  ...pairingOf("mpp/subscription/stripe", "request.methodDetails.metadata.legal_context", patternOf(SUBSCRIPTION_PROVES)),
  channel: Object.freeze({
    /** Every payment the seller reports on this pairing is the activation, which opens the subscription. */
    kind: (_presented: unknown): "open" => "open",
    ref: subscriptionRef,
    boundWithin: subscriptionBoundWithin,
    /** The subscription request carries no expiry: the draft refuses `subscriptionExpires`. */
    until: (_presented: unknown): number | undefined => undefined,
  }),
});
