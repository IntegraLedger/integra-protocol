/**
 * UCP checkouts and bookings, and four pairings: the ATR hash and link as one `links[]` entry of type
 * `legal_context` in the checkout response. The `ap2-mandate` pairings read the hash from the checkout inside the
 * buyer's checkout mandate, after AP2's `checkout_hash` check; the `unsigned` pairings have nothing signed to read.
 * Nothing here takes a key, signs or verifies a signature.
 */
import {
  digestJson,
  fromLcpString,
  hashEquals,
  isHttpsLink,
  isOtherSchemeLink,
  toLcpString,
  type AtrHash,
  type Json,
} from "./core.js";
import { deepFreeze, isObject, jsonBytes, normalHash } from "./fields.js";
import { checkoutBinding, checkoutJwtOf, type Presented } from "./ap2.js";
import type { LcpPattern } from "./index.js";
import { agreementFault, agreementRefusal, isAgreementUrl } from "./internal/agreement.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";

export const LINK_TYPE = "legal_context";
export const AGREEMENT_LINK_TYPE = "legal_context_agreement";

export type Link = { type: string; url: string; title?: string };
export type Checkout = {
  id: string;
  links?: Link[];
  ap2?: { merchant_authorization?: string } & { [k: string]: Json };
} & { [k: string]: Json };
/** A checkout's own `id`, 1–256 characters. */
export type CheckoutOption = { checkout: string };
/** A booking session's own `id`, 1–256 characters. */
export type BookingOption = { booking: string };
export interface UcpOffer {
  checkout: Checkout;
}
export interface Unsigned {
  checkout: Checkout;
  complete(checkout_mandate: string): Promise<Presented | Refusal>;
}

type Option = CheckoutOption | BookingOption;

const MIB = 1_048_576;
const MAX_LINKS = 64;
const MAX_ID = 256;
const MAX_LINK = 2048;
const MERCHANT_AUTHORIZATION = /^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+$/;


/** The hash and link of the checkout's one `legal_context` link. Nothing else of the checkout is read. */
export function legalContextLink(c: Checkout): { h: AtrHash; link: string } | Refusal {
  if (!isObject(c)) return refusal("ucp/checkout-malformed");
  const links: unknown = c["links"];
  if (links === undefined) return refusal("ucp/no-legal-context");
  if (!Array.isArray(links)) return refusal("ucp/checkout-malformed");
  if (links.length > MAX_LINKS) return refusal("ucp/too-large");
  const entries = links.filter((l: unknown) => isObject(l) && l["type"] === LINK_TYPE) as Record<string, unknown>[];
  if (entries.length === 0) return refusal("ucp/no-legal-context");
  if (entries.length > 1) return refusal("ucp/legal-context-conflict");
  const entry = entries[0]!;
  const title = entry["title"];
  const h = typeof title === "string" ? fromLcpString(title) : null;
  if (h === null) return refusal("ucp/legal-context-malformed");
  const url = entry["url"];
  if (!isHttpsLink(url)) return refusal(isOtherSchemeLink(url) ? "ucp/link-not-https" : "ucp/legal-context-malformed");
  if (url.length > MAX_LINK) return refusal("ucp/legal-context-malformed");
  return { h, link: url };
}

/**
 * The url of the checkout's one `legal_context_agreement` link, undefined when it has none. Two such links are
 * `ucp/legal-context-conflict`; a url that is not an agreement URL is `ucp/link-not-https` when it is at most 2048
 * characters and parses as an absolute URL with a scheme other than `https`, and `ucp/legal-context-malformed`
 * otherwise.
 */
function agreementLink(c: Checkout): string | undefined | Refusal {
  const links: unknown = c["links"];
  if (!Array.isArray(links)) return undefined;
  const entries = links.filter((l: unknown) => isObject(l) && l["type"] === AGREEMENT_LINK_TYPE) as Record<string, unknown>[];
  if (entries.length === 0) return undefined;
  if (entries.length > 1) return refusal("ucp/legal-context-conflict");
  const url = entries[0]!["url"];
  return isAgreementUrl(url) ? url : refusal(`ucp/${agreementFault(url).fault}`);
}

/** The option digest the issuer keeps: SHA-256 over the RFC 8785 form. */
export const issuedDigest: typeof digestJson = digestJson;

/** The binding slot: the checkouts or bookings this ATR was minted for, each by its own `id`. */
export function tie<O extends Option>(options: readonly O[]): ["ucp", { options: readonly O[] }] {
  return ["ucp", { options }];
}

export interface UcpBinding<Id extends string, O extends Option> {
  id: Id;
  pattern: LcpPattern;
  claims: boolean;
  unplaced(option: O): O;
  tie(options: readonly O[]): ["ucp", { options: readonly O[] }];
  advertise(doc: Checkout, h: AtrHash, link: string, offer: O, agreementUrl?: string): Checkout | Refusal;
  read(doc: Checkout): { h: AtrHash; link: string; agreement?: string; offer: UcpOffer } | Refusal;
  build(offer: UcpOffer, h: AtrHash): Promise<Unsigned | Refusal>;
  bound(presented: unknown): Promise<AtrHash | Refusal>;
}

/** The checkout's shape as the pairings read it: an object of at most 1 MiB as JSON, with an `id` of 1–256. */
function checkoutOf(doc: unknown): Checkout | Refusal {
  if (!isObject(doc)) return refusal("ucp/checkout-malformed");
  const size = jsonBytes(doc);
  if (size === undefined) return refusal("ucp/checkout-malformed");
  if (size > MIB) return refusal("ucp/too-large");
  const id = doc["id"];
  if (typeof id !== "string" || id.length === 0) return refusal("ucp/checkout-malformed");
  if (id.length > MAX_ID) return refusal("ucp/too-large");
  return doc as Checkout;
}

function isSigned(c: Checkout): boolean {
  const ap2: unknown = c["ap2"];
  return isObject(ap2) && ap2["merchant_authorization"] !== undefined;
}

/**
 * A copy of the checkout with the `legal_context` link appended to `links[]`, followed by a `legal_context_agreement`
 * link to `agreementUrl` when one is given, before the business signs it.
 */
function advertiseFor(key: "checkout" | "booking") {
  return (doc: Checkout, h: AtrHash, link: string, offer: Option, agreementUrl?: string): Checkout | Refusal => {
    if (!isOption(offer, key)) return refusal("ucp/option-malformed");
    const c = checkoutOf(doc);
    if (isRefusal(c)) return c;
    if (c.id !== (offer as unknown as Record<string, string>)[key]) return refusal("ucp/option-not-this-checkout");
    if (isSigned(c)) return refusal("ucp/already-signed");
    if (!isHttpsLink(link)) return refusal(isOtherSchemeLink(link) ? "ucp/link-not-https" : "ucp/legal-context-malformed");
    if (link.length > MAX_LINK) return refusal("ucp/legal-context-malformed");
    const agreementFaulted = agreementRefusal("ucp", agreementUrl);
    if (agreementFaulted !== undefined) return agreementFaulted;
    if (normalHash(h) === null) return refusal("ucp/legal-context-malformed");
    const title = toLcpString(h);
    const links: unknown = c["links"];
    if (links !== undefined && !Array.isArray(links)) return refusal("ucp/checkout-malformed");
    const present = ((links ?? []) as unknown[]).filter((l) => isObject(l) && l["type"] === LINK_TYPE);
    if (present.length > 1) return refusal("ucp/legal-context-conflict");
    const agreements = ((links ?? []) as unknown[]).filter((l) => isObject(l) && l["type"] === AGREEMENT_LINK_TYPE);
    if (agreementUrl !== undefined) {
      if (agreements.length > 1) return refusal("ucp/legal-context-conflict");
      const a = agreements[0] as Record<string, unknown> | undefined;
      if (a !== undefined && a["url"] !== agreementUrl) return refusal("ucp/legal-context-conflict");
      if (present.length === 1 && a === undefined) return refusal("ucp/legal-context-conflict");
    }
    if (present.length === 1) {
      const p = present[0] as Record<string, unknown>;
      if (p["url"] !== link || p["title"] !== title) return refusal("ucp/legal-context-conflict");
      return { ...c, links: [...(links as Link[])] };
    }
    const added: Link[] = [{ type: LINK_TYPE, url: link, title }];
    if (agreementUrl !== undefined && agreements.length === 0) added.push({ type: AGREEMENT_LINK_TYPE, url: agreementUrl });
    const next = [...((links ?? []) as Link[]), ...added];
    if (next.length > MAX_LINKS) return refusal("ucp/too-large");
    const out: Checkout = { ...c, links: next };
    const size = jsonBytes(out);
    if (size === undefined) return refusal("ucp/checkout-malformed");
    if (size > MIB) return refusal("ucp/too-large");
    return out;
  };
}

function readFor(requireAp2: boolean) {
  return (doc: Checkout): { h: AtrHash; link: string; offer: UcpOffer } | Refusal => {
    const c = checkoutOf(doc);
    if (isRefusal(c)) return c;
    const lc = legalContextLink(c);
    if (isRefusal(lc)) return lc;
    if (requireAp2) {
      const ap2: unknown = c["ap2"];
      const auth = isObject(ap2) ? ap2["merchant_authorization"] : undefined;
      if (typeof auth !== "string" || !MERCHANT_AUTHORIZATION.test(auth)) return refusal("ucp/ap2-not-active");
    }
    return { h: lc.h, link: lc.link, offer: { checkout: c } };
  };
}

const readAp2 = readFor(true);
const readUnsigned = readFor(false);

/** `base`, with the url of the checkout's `legal_context_agreement` link as `agreement` when it has one. */
function readShown(base: (doc: Checkout) => { h: AtrHash; link: string; offer: UcpOffer } | Refusal) {
  return (doc: Checkout): { h: AtrHash; link: string; agreement?: string; offer: UcpOffer } | Refusal => {
    const r = base(doc);
    if (isRefusal(r)) return r;
    const agreement = agreementLink(r.offer.checkout);
    if (agreement !== undefined && typeof agreement !== "string") return agreement;
    return agreement === undefined ? r : { h: r.h, link: r.link, agreement, offer: r.offer };
  };
}

/** The checkout unchanged, for the buyer's mandate issuer, once its link carries `h`. */
async function buildAp2(offer: UcpOffer, h: AtrHash): Promise<Unsigned | Refusal> {
  if (!isObject(offer)) return refusal("ucp/checkout-malformed");
  const r = readAp2(offer.checkout);
  if (isRefusal(r)) return r;
  if (!hashEquals(r.h, h)) return refusal("ucp/hash-not-in-checkout");
  const checkout = offer.checkout;
  return {
    checkout,
    async complete(checkout_mandate: string): Promise<Presented | Refusal> {
      const checkout_jwt = await checkoutJwtOf(checkout_mandate);
      if (isRefusal(checkout_jwt)) return checkout_jwt;
      return { checkout_mandate, checkout_jwt };
    },
  };
}

/** The hash in the checkout inside the buyer's mandate, after AP2's `checkout_hash` check. No signature is verified. */
async function boundAp2(presented: unknown): Promise<AtrHash | Refusal> {
  const b = await checkoutBinding(presented);
  if (isRefusal(b)) return b;
  const lc = legalContextLink(b.payload as Checkout);
  if (isRefusal(lc)) return lc;
  return lc.h;
}

async function buildUnsigned(): Promise<Unsigned | Refusal> {
  return refusal("ucp/nothing-to-sign");
}

async function boundUnsigned(): Promise<AtrHash | Refusal> {
  return refusal("ucp/not-buyer-signed");
}

function unplaced<O extends Option>(option: O): O {
  return option;
}

const AGREEMENT =
  "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
  "recorded in <transaction>. ";

function ap2Pattern(noun: "checkout" | "booking"): LcpPattern {
  return deepFreeze({
    pattern: "opaque-challenge",
    canonical: true,
    profile: "ucp/checkout/legal-context",
    buyerSigns: true,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves:
      AGREEMENT +
      `The ${noun} response carried this ATR's hash and link as its legal_context link before the business signed it ` +
      "(ap2.merchant_authorization, the seller's signature). The buyer's checkout mandate, issued by the platform or " +
      "the user's credential under UCP's AP2 Mandates extension, carries checkout_hash, the SHA-256 of that signed " +
      `${noun}, and the seller read the hash from the ${noun} inside it. The seller did not verify the ` +
      `mandate's signature; the PSP verifies the payment mandate over the same ${noun} hash. The seller reported the ` +
      "payment. This does not show that amount, payee or timing match the ATR's content.",
  });
}

function unsignedPattern(noun: "checkout" | "booking"): LcpPattern {
  return deepFreeze({
    pattern: "http-advisory",
    canonical: true,
    profile: "ucp/checkout/legal-context",
    buyerSigns: false,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves:
      AGREEMENT +
      `The ${noun} response the platform received carried this ATR's hash and link as its legal_context link before ` +
      `the buyer completed the ${noun}, and the ATR was in the seller's storage before that. UCP without the AP2 ` +
      "Mandates extension defines no buyer signature, so the buyer's approval, given in the platform's interface, did " +
      "not sign the hash. The seller tied the payment to the hash in its report.",
  });
}

export const ap2Mandate: UcpBinding<"ucp/checkout/ap2-mandate", CheckoutOption> = Object.freeze({
  id: "ucp/checkout/ap2-mandate",
  pattern: ap2Pattern("checkout"),
  claims: true,
  unplaced,
  tie,
  advertise: advertiseFor("checkout"),
  read: readShown(readAp2),
  build: buildAp2,
  bound: boundAp2,
});

export const unsigned: UcpBinding<"ucp/checkout/unsigned", CheckoutOption> = Object.freeze({
  id: "ucp/checkout/unsigned",
  pattern: unsignedPattern("checkout"),
  claims: false,
  unplaced,
  tie,
  advertise: advertiseFor("checkout"),
  read: readShown(readUnsigned),
  build: buildUnsigned,
  bound: boundUnsigned,
});

export const bookingAp2Mandate: UcpBinding<"ucp/booking/ap2-mandate", BookingOption> = Object.freeze({
  id: "ucp/booking/ap2-mandate",
  pattern: ap2Pattern("booking"),
  claims: true,
  unplaced,
  tie,
  advertise: advertiseFor("booking"),
  read: readShown(readAp2),
  build: buildAp2,
  bound: boundAp2,
});

export const bookingUnsigned: UcpBinding<"ucp/booking/unsigned", BookingOption> = Object.freeze({
  id: "ucp/booking/unsigned",
  pattern: unsignedPattern("booking"),
  claims: false,
  unplaced,
  tie,
  advertise: advertiseFor("booking"),
  read: readShown(readUnsigned),
  build: buildUnsigned,
  bound: boundUnsigned,
});

function isOption(o: unknown, key: "checkout" | "booking"): boolean {
  if (!isObject(o)) return false;
  const v = o[key];
  return Object.keys(o).length === 1 && typeof v === "string" && v.length >= 1 && v.length <= MAX_ID;
}

