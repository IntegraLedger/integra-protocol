/**
 * ACK Payment Requests and receipts, and the pairing `ack/payment-request`: the ATR hash as the `id` of the
 * seller-signed Payment Request, in LCP's string form, with the link beside the request in the 402 body. ACK defines
 * no payer signature, so `build` and `bound` always refuse. Pure; no I/O. No token or receipt signature is verified
 * here.
 */
import {
  fromLcpString,
  fromLegalContext,
  hashEquals,
  isHttpsLink,
  toLcpString,
  toLegalContext,
  type AtrHash,
  type Json,
} from "./core.js";
import { isObject, jsonBytes, normalHash } from "./fields.js";
import { agreementIn, agreementUrlFault } from "./internal/agreement.js";
import { broadcasts } from "./internal/broadcaster.js";
import { carriesRefused, refusal, type Refusal } from "./refusal.js";
import { decodeJsonSegment, jwsSegments, withinDepth } from "./sd-jwt.js";
import type { LcpPattern } from "./x402.js";
export type { Broadcaster } from "./internal/broadcaster.js";

/** An ACK payment option as the seller wrote it. */
export interface AckPaymentOption {
  id: string;
  [k: string]: Json;
}

/**
 * What the seller's stack places: the Payment Request's `id`, and the legal context beside the request, with the
 * agreement URL after the link when one is given.
 */
export interface AckValues {
  paymentRequestId: string;
  legalContext: { type: "sha256"; value: AtrHash; legalContextUrl: string; legalContextAgreementUrl?: string };
}

/** The 402 body. */
export interface AckBody {
  paymentRequestToken: string;
  legalContext: Json;
  paymentRequest?: Json;
}

const ID = "ack/payment-request" as const;
const MAX_BODY_BYTES = 65_536;
const MAX_TOKEN = 16_384;
const MAX_OPTIONS = 16;
const MAX_LINK = 2048;
const MAX_CREDENTIAL_SUBJECT_BYTES = 65_536;

/** The binding slot: the Payment Request's options exactly as issued. */
export function tie(options: readonly AckPaymentOption[]): ["ack", { paymentOptions: readonly AckPaymentOption[] }] {
  return ["ack", { paymentOptions: options }];
}

/**
 * The Payment Request `id` (`lcp:sha256:H`) and the legal context the seller's stack places beside the request, with
 * `legalContextAgreementUrl` after the link when `agreementUrl` is given.
 */
function advertise(
  _doc: Record<string, never>,
  h: AtrHash,
  link: string,
  offer: AckPaymentOption,
  agreementUrl?: string,
): AckValues | Refusal {
  if (!isObject(offer) || typeof offer["id"] !== "string" || offer["id"] === "") return refusal("ack/option-malformed");
  const nh = normalHash(h);
  if (nh === null) return refusal("ack/legal-context-malformed");
  if (!isHttpsLink(link)) return refusal("ack/link-not-https");
  if (link.length > MAX_LINK) return refusal("ack/legal-context-malformed");
  const agreementFaulted = agreementUrlFault(agreementUrl);
  if (agreementFaulted?.fault === "link-not-https") return refusal("ack/link-not-https");
  if (agreementFaulted !== undefined) return refusal("ack/legal-context-malformed");
  const lc = toLegalContext(nh, link).legalContext;
  return {
    paymentRequestId: toLcpString(nh),
    legalContext:
      agreementUrl === undefined
        ? { type: "sha256", value: lc.value, legalContextUrl: link }
        : { type: "sha256", value: lc.value, legalContextUrl: link, legalContextAgreementUrl: agreementUrl },
  };
}

/**
 * The buyer's reading of a 402 body: the hash from the signed token's `id`, which the body's `legalContext` must
 * match, the link and, when present, the agreement URL from `legalContext`, and the token's payment options. The
 * unsigned `paymentRequest` copy is never read.
 */
function read(
  doc: AckBody,
): { h: AtrHash; link: string; agreement?: string; offer: { options: readonly Json[] } } | Refusal {
  if (!isObject(doc)) return refusal("ack/token-malformed");
  const size = jsonBytes(doc);
  if (size === undefined) return refusal("ack/token-malformed");
  if (size > MAX_BODY_BYTES) return refusal("ack/too-large");
  const token: unknown = doc["paymentRequestToken"];
  if (typeof token === "string" && token.length > MAX_TOKEN) return refusal("ack/too-large");
  const payload = tokenPayload(token);
  if (payload === null) return refusal("ack/token-malformed");
  const id = payload["id"];
  const signed = typeof id === "string" ? fromLcpString(id) : null;
  if (signed === null) return refusal("ack/id-not-lcp");
  const lc: unknown = doc["legalContext"];
  if (lc === undefined) return refusal("ack/no-legal-context");
  const decoded = fromLegalContext({ legalContext: lc });
  if (decoded === null) return refusal("ack/legal-context-malformed");
  if (decoded.url.length > MAX_LINK) return refusal("ack/legal-context-malformed");
  if (!hashEquals(signed, decoded.h)) return refusal("ack/legal-context-conflict");
  const agreement = agreementIn(lc);
  if (typeof agreement === "object") return refusal("ack/legal-context-malformed");
  const options = payload["paymentOptions"];
  if (!Array.isArray(options)) return refusal("ack/token-malformed");
  if (options.length > MAX_OPTIONS) return refusal("ack/too-large");
  return agreement === undefined
    ? { h: signed, link: decoded.url, offer: { options: options as Json[] } }
    : { h: signed, link: decoded.url, agreement, offer: { options: options as Json[] } };
}

/**
 * The hash in a receipt: the `id` of the Payment Request token embedded in its `credentialSubject`. Verifies nothing;
 * a party calls it on a receipt it has verified.
 */
export function fromReceipt(credentialSubject: unknown): AtrHash | Refusal {
  if (!isObject(credentialSubject)) return refusal("ack/receipt-malformed");
  const size = jsonBytes(credentialSubject);
  if (size === undefined) return refusal("ack/receipt-malformed");
  if (size > MAX_CREDENTIAL_SUBJECT_BYTES) return refusal("ack/too-large");
  const payload = tokenPayload(credentialSubject["paymentRequestToken"]);
  const id = payload?.["id"];
  const h = typeof id === "string" ? fromLcpString(id) : null;
  return h === null ? refusal("ack/receipt-malformed") : h;
}

/**
 * The option unchanged: the Payment Request's `id` carries the hash, and the option does not. An option that carries a
 * `refused` member is `ack/option-malformed`.
 */
function unplaced(option: AckPaymentOption): AckPaymentOption | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("ack/option-malformed");
  return option;
}

const pattern: LcpPattern = Object.freeze({
  pattern: "native-field",
  canonical: true,
  profile: ID,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
    "recorded in <transaction>. This ATR's hash is the id of the seller's ACK Payment Request token, with the link " +
    "beside it; a receipt for that request embeds the token. The token's signature is not verified here. ACK defines " +
    "no payer signature, so nothing the buyer signed carries the hash, and settlement is the seller's report. This " +
    "does not show that the buyer's approval carried the hash.",
});

/**
 * `ack/payment-request`. The payer broadcasts (`broadcaster` answers `"payer"`): it pays the Payment Request through
 * its payment service before presenting the receipt. Settlement is the seller's report: the seller verifies the
 * receipt, and `fromReceipt` reads the hash from it; no `fetchPresented`, `status` or `recover` reads it.
 */
export const paymentRequest = Object.freeze({
  id: ID,
  pattern,
  claims: false as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build: async (_doc: unknown, _h: AtrHash): Promise<Refusal> => refusal("ack/no-signed-place"),
  bound: async (_presented: unknown): Promise<Refusal> => refusal("ack/no-signed-place"),
  broadcaster: broadcasts("payer"),
});

/**
 * The JSON object in a compact JWS's second segment, decoded as base64url without padding, fatal UTF-8 and JSON, or
 * null for anything else, a segment not in canonical base64url form (RFC 4648 §3.5) included. The signature is not
 * checked.
 */
function tokenPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN) return null;
  const segments = jwsSegments(token);
  if (segments === null) return null;
  const v = decodeJsonSegment(segments[1]);
  return isObject(v) && withinDepth(v) ? v : null;
}

