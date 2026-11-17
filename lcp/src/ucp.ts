/**
 * UCP checkouts and bookings, and four pairings: the ATR hash and link as one `links[]` entry of type
 * `legal_context` in the checkout response. The `ap2-mandate` pairings read the hash from the checkout JWT presented
 * beside the buyer's checkout mandate, after AP2's `checkout_hash` check, the mandate presented alone or last in AP2's
 * chain after the open mandate; the `unsigned` pairings have nothing signed to read. Nothing here takes a key, signs,
 * or verifies a signature, a `cnf` delegation or a link between chained mandates.
 */
import {
  canonicalJson,
  digestJson,
  fromLcpString,
  hash,
  hashEquals,
  isHttpsLink,
  isOtherSchemeLink,
  toBase64,
  toLcpString,
  type AtrHash,
  type Json,
} from "./core.js";
import { deepFreeze, isObject, jsonBytes, normalHash } from "./fields.js";
import { CHECKOUT_VCT, checkoutBinding, type Presented } from "./ap2.js";
import type { LcpPattern } from "./index.js";
import { agreementFault, agreementUrlFault, isAgreementUrl } from "./internal/agreement.js";
import { broadcasts, broadcastsWithin, type Broadcaster } from "./internal/broadcaster.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { toBase64Url } from "./rail-bytes.js";
import { disclosureDigest } from "./sd-jwt.js";
import { MAX_LINK_LENGTH } from "./internal/bounds.js";
import { CARD } from "./internal/data/card.js";
import { chargeOf, type ChargePresented, type ChargeRef } from "./internal/charge-reference.js";
import { withinDepth } from "./sd-jwt.js";
import type { Entry, NoRead, PairingData } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { ChargePresented, ChargeRef } from "./internal/charge-reference.js";

export const LINK_TYPE = "legal_context";
const AGREEMENT_LINK_TYPE = "legal_context_agreement";

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
/**
 * The checkout as the business signed it, and the claims the buyer's checkout mandate carries for it: the checkout JWT
 * (`checkoutJwt`) and its hash. `complete` takes the signed mandate and returns it beside that JWT.
 */
export interface Unsigned {
  checkout: Checkout;
  content: { vct: typeof CHECKOUT_VCT; checkout_jwt: string; checkout_hash: string };
  complete(checkout_mandate: string): Promise<Presented | Refusal>;
}

type Option = CheckoutOption | BookingOption;

const MIB = 1_048_576;
const MAX_LINKS = 64;
const MAX_ID = 256;
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
  if (!isHttpsLink(url)) {
    return isOtherSchemeLink(url) ? refusal("ucp/link-not-https") : refusal("ucp/legal-context-malformed");
  }
  if (url.length > MAX_LINK_LENGTH) return refusal("ucp/too-large");
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
  if (isAgreementUrl(url)) return url;
  if (agreementFault(url).fault === "link-not-https") return refusal("ucp/link-not-https");
  return refusal("ucp/legal-context-malformed");
}

/** The option digest the issuer keeps: SHA-256 over the RFC 8785 form. */
export const issuedDigest: typeof digestJson = digestJson;

/** The binding slot: the checkouts or bookings this ATR was minted for, each by its own `id`. */
export function tie<O extends Option>(options: readonly O[]): ["ucp", { options: readonly O[] }] {
  return ["ucp", { options }];
}

export interface UcpBinding<Id extends string, O extends Option> {
  id: Id;
  data: PairingData;
  pattern: LcpPattern;
  claims: boolean;
  unplaced(option: O): O | Refusal;
  tie(options: readonly O[]): ["ucp", { options: readonly O[] }];
  advertise(doc: Checkout, h: AtrHash, link: string, offer: O, agreementUrl?: string): Checkout | Refusal;
  read(doc: Checkout): { h: AtrHash; link: string; agreement?: string; offer: UcpOffer } | Refusal;
  build(offer: UcpOffer, h: AtrHash): Promise<Unsigned | Refusal>;
  bound(presented: unknown): Promise<AtrHash | Refusal>;
  /** Who broadcasts what the payer presents: the seller, which completes the payment (`"payee"`). */
  broadcaster(presented: unknown): Promise<Broadcaster | Refusal>;
}

/**
 * The checkout's shape as the pairings read it: an object of at most 1 MiB as JSON, nested at most 64 levels, with an
 * `id` of 1–256.
 */
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
 * link to `agreementUrl` when one is given, before the business signs it. A checkout that carries a `refused` member
 * is `ucp/checkout-malformed`, before any other check.
 */
function advertiseFor(key: "checkout" | "booking") {
  return (doc: Checkout, h: AtrHash, link: string, offer: Option, agreementUrl?: string): Checkout | Refusal => {
    if (isObject(doc) && carriesRefused(doc)) return refusal("ucp/checkout-malformed");
    if (!isOption(offer, key)) return refusal("ucp/option-malformed");
    const c = checkoutOf(doc);
    if (isRefusal(c)) return c;
    if (c.id !== (offer as unknown as Record<string, string>)[key]) return refusal("ucp/option-not-this-checkout");
    if (isSigned(c)) return refusal("ucp/already-signed");
    if (!isHttpsLink(link)) return refusal("ucp/link-not-https");
    if (link.length > MAX_LINK_LENGTH) return refusal("ucp/too-large");
    const agreementFaulted = agreementUrlFault(agreementUrl);
    if (agreementFaulted?.fault === "link-not-https") return refusal("ucp/link-not-https");
    if (agreementFaulted !== undefined) return refusal("ucp/legal-context-malformed");
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

/**
 * The checkout JWT a buyer's checkout mandate commits to, for a checkout the business signed: its detached
 * `ap2.merchant_authorization` with the payload reinserted, `header.payload.signature`, the payload being the base64url
 * of the RFC 8785 form of the checkout without its `ap2` member, the bytes that signature covers (UCP 2026-08-25, the
 * AP2 Mandates extension, *Business Authorization*). UCP does not say which bytes are the checkout JWT; this is the
 * second of the two readings its open issue 905 sets out, and the profile states it as provisional. A checkout with no
 * `ap2.merchant_authorization` of the form `header..signature` is `ucp/ap2-not-active`; one with no RFC 8785 form is
 * `ucp/checkout-malformed`. No signature is verified.
 */
export function checkoutJwt(c: Checkout): string | Refusal {
  const checkout = checkoutOf(c);
  if (isRefusal(checkout)) return checkout;
  const ap2: unknown = checkout["ap2"];
  const auth = isObject(ap2) ? ap2["merchant_authorization"] : undefined;
  if (typeof auth !== "string" || !MERCHANT_AUTHORIZATION.test(auth)) return refusal("ucp/ap2-not-active");
  const { ap2: _signature, ...covered } = checkout;
  const payload = canonicalJson(covered);
  if (typeof payload !== "string") return refusal("ucp/checkout-malformed");
  const [header, , signature] = auth.split(".");
  return `${header}.${toBase64Url(new TextEncoder().encode(payload))}.${signature}`;
}

/**
 * The claims the buyer's checkout mandate carries for a checkout the business signed, once its link carries `h`: the
 * checkout JWT `checkoutJwt` gives, and its hash. `complete` returns the signed mandate beside that JWT, and refuses a
 * mandate that commits to another JWT as `bound` would, so it never hands back a presentation `bound` refuses for that.
 */
async function buildAp2(offer: UcpOffer, h: AtrHash): Promise<Unsigned | Refusal> {
  if (!isObject(offer)) return refusal("ucp/checkout-malformed");
  const r = readAp2(offer.checkout);
  if (isRefusal(r)) return r;
  if (!hashEquals(r.h, h)) return refusal("ucp/hash-not-in-checkout");
  const checkout = offer.checkout;
  const checkout_jwt = checkoutJwt(checkout);
  if (isRefusal(checkout_jwt)) return checkout_jwt;
  const checkout_hash = await disclosureDigest(checkout_jwt);
  return {
    checkout,
    content: { vct: CHECKOUT_VCT, checkout_jwt, checkout_hash },
    async complete(checkout_mandate: string): Promise<Presented | Refusal> {
      const presented: Presented = { checkout_mandate, checkout_jwt };
      const b = await checkoutBinding(presented);
      return isRefusal(b) ? b : presented;
    },
  };
}

/**
 * The hash in the checkout JWT presented beside the buyer's closed mandate, after AP2's `checkout_hash` check, the
 * mandate presented alone or last in AP2's chain. No signature, `cnf` delegation or link between chained mandates is
 * verified.
 */
async function boundAp2(presented: unknown): Promise<AtrHash | Refusal> {
  const b = await checkoutBinding(presented);
  if (isRefusal(b)) return b;
  const lc = legalContextLink(b.payload as Checkout);
  if (isRefusal(lc)) return lc;
  return lc.h;
}

/** The shape gate `checkoutBinding` applies first, as `boundAp2` does: an object, else `ap2/mandate-malformed`. */
function mandateShape(presented: unknown): true | Refusal {
  return isObject(presented) ? true : refusal("ap2/mandate-malformed");
}

async function buildUnsigned(): Promise<Unsigned | Refusal> {
  return refusal("ucp/nothing-to-sign");
}

async function boundUnsigned(): Promise<AtrHash | Refusal> {
  return refusal("ucp/not-buyer-signed");
}

/**
 * The option unchanged: the checkout's link carries the hash, and the option does not. An option that carries a
 * `refused` member is `ucp/option-malformed`.
 */
function unplaced<O extends Option>(option: O): O | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("ucp/option-malformed");
  return option;
}

function ap2Pattern(noun: "checkout" | "booking"): LcpPattern {
  return deepFreeze({
    pattern: "opaque-challenge",
    profile: "ucp/checkout/legal-context",
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  });
}

function unsignedPattern(noun: "checkout" | "booking"): LcpPattern {
  return deepFreeze({
    pattern: "http-advisory",
    profile: "ucp/checkout/legal-context",
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  });
}

/**
 * A UCP pairing's family descriptor, by the option it is offered on. No public ledger records the payment, so nothing
 * is read back.
 */
type UcpFamily<O extends Option> = NoRead & {
  doc: Checkout;
  offered: { h: AtrHash; link: string; agreement?: string; offer: UcpOffer };
  placedIn: Checkout;
  offer: O;
  rest: [agreementUrl?: string];
  advertised: Checkout;
  choice: UcpOffer;
  unsigned: Unsigned;
  option: never;
};

/**
 * `ucp/checkout/ap2-mandate`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
 * executes the payment the buyer's checkout mandate authorizes; nothing here reads it. A value that is not a JSON
 * object gets `ap2/mandate-malformed`, as `bound` refuses it.
 */
export const ap2Mandate: UcpBinding<"ucp/checkout/ap2-mandate", CheckoutOption> = Object.freeze({
  id: "ucp/checkout/ap2-mandate",
  data: CARD["ucp/checkout/ap2-mandate"],
  pattern: ap2Pattern("checkout"),
  claims: true,
  unplaced,
  tie,
  advertise: advertiseFor("checkout"),
  read: readShown(readAp2),
  build: buildAp2,
  bound: boundAp2,
  broadcaster: broadcastsWithin(mandateShape, "payee"),
}) satisfies Entry<"ucp/checkout/ap2-mandate", Presented, never, never, UcpFamily<CheckoutOption>>;

/**
 * The reference of a `ucp/checkout/unsigned` charge: the checkout of the option it answers and the seller's own
 * reference for the charge, `{checkout, charge}`. What is presented is `{charge}`, 1 to 255 visible ASCII characters,
 * else `ucp/charge-reference-malformed`; then an option that is not `{checkout}` of 1 to 256 characters is
 * `ucp/option-malformed`. Nothing the charge moved is compared with the option.
 */
async function unsignedReference(presented: unknown, option: CheckoutOption): Promise<ChargeRef | Refusal> {
  const charge = chargeOf(presented);
  if (charge === undefined) return refusal("ucp/charge-reference-malformed");
  if (!isOption(option, "checkout")) return refusal("ucp/option-malformed");
  return { checkout: option.checkout, charge };
}

/**
 * `ucp/checkout/unsigned`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
 * executes the payment the checkout completed; nothing here reads it. `reference` names the charge by the seller's own
 * reference for it.
 */
export const unsigned: UcpBinding<"ucp/checkout/unsigned", CheckoutOption> & {
  reference(presented: unknown, option: CheckoutOption): Promise<ChargeRef | Refusal>;
} = Object.freeze({
  id: "ucp/checkout/unsigned",
  data: CARD["ucp/checkout/unsigned"],
  pattern: unsignedPattern("checkout"),
  claims: false,
  unplaced,
  tie,
  advertise: advertiseFor("checkout"),
  read: readShown(readUnsigned),
  build: buildUnsigned,
  bound: boundUnsigned,
  broadcaster: broadcasts("payee"),
  reference: unsignedReference,
}) satisfies Entry<"ucp/checkout/unsigned", ChargePresented, ChargeRef, never, Omit<UcpFamily<CheckoutOption>, "option"> & { option: CheckoutOption }>;

/**
 * `ucp/booking/ap2-mandate`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
 * executes the payment the buyer's checkout mandate authorizes; nothing here reads it. A value that is not a JSON
 * object gets `ap2/mandate-malformed`, as `bound` refuses it.
 */
export const bookingAp2Mandate: UcpBinding<"ucp/booking/ap2-mandate", BookingOption> = Object.freeze({
  id: "ucp/booking/ap2-mandate",
  data: CARD["ucp/booking/ap2-mandate"],
  pattern: ap2Pattern("booking"),
  claims: true,
  unplaced,
  tie,
  advertise: advertiseFor("booking"),
  read: readShown(readAp2),
  build: buildAp2,
  bound: boundAp2,
  broadcaster: broadcastsWithin(mandateShape, "payee"),
}) satisfies Entry<"ucp/booking/ap2-mandate", Presented, never, never, UcpFamily<BookingOption>>;

/**
 * `ucp/booking/unsigned`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
 * executes the payment the booking completed; nothing here reads it.
 */
export const bookingUnsigned: UcpBinding<"ucp/booking/unsigned", BookingOption> = Object.freeze({
  id: "ucp/booking/unsigned",
  data: CARD["ucp/booking/unsigned"],
  pattern: unsignedPattern("booking"),
  claims: false,
  unplaced,
  tie,
  advertise: advertiseFor("booking"),
  read: readShown(readUnsigned),
  build: buildUnsigned,
  bound: boundUnsigned,
  broadcaster: broadcasts("payee"),
}) satisfies Entry<"ucp/booking/unsigned", Presented, never, never, UcpFamily<BookingOption>>;

function isOption(o: unknown, key: "checkout" | "booking"): boolean {
  if (!isObject(o)) return false;
  const v = o[key];
  return Object.keys(o).length === 1 && typeof v === "string" && v.length >= 1 && v.length <= MAX_ID;
}


// ── ucp/checkout/agent-signed: H in a member of the platform's signed request ──

/** The member the platform writes into the request that completes the checkout, before it signs the request. */
export interface AgentSignedUnsigned {
  legal_context: { type: "sha256"; value: AtrHash };
}
/** The platform's signed request as the business received it: its body, as text, and its `Content-Digest` value. */
export interface AgentSignedPresented {
  body: string;
  contentDigest: string;
}

const REQUEST_MEMBER = "legal_context";

/** The member for the platform to write into its request body, once the checkout's link carries `h`. */
async function buildAgentSigned(offer: UcpOffer, h: AtrHash): Promise<AgentSignedUnsigned | Refusal> {
  if (!isObject(offer)) return refusal("ucp/checkout-malformed");
  const r = readUnsigned(offer.checkout);
  if (isRefusal(r)) return r;
  if (!hashEquals(r.h, h)) return refusal("ucp/hash-not-in-checkout");
  return { legal_context: { type: "sha256", value: r.h } };
}

/**
 * The hash in the platform's signed request: the body's one `legal_context` member, once the `Content-Digest` value is
 * exactly `sha-256=:` and the standard base64 of the SHA-256 of the body's UTF-8 bytes and `:`, the comparison UCP's
 * request verification makes. No signature is verified and no key is read: the business verifies the platform's
 * signature, which covers `content-digest`, as UCP defines.
 */
async function boundAgentSigned(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented)) return refusal("ucp/request-malformed");
  const { body, contentDigest } = presented;
  if (typeof body !== "string" || typeof contentDigest !== "string") return refusal("ucp/request-malformed");
  if (body.length > MIB || contentDigest.length > MAX_LINK_LENGTH) return refusal("ucp/too-large");
  const bytes = new TextEncoder().encode(body);
  if (bytes.length > MIB) return refusal("ucp/too-large");
  const digest = await hash(bytes);
  const expected = `sha-256=:${toBase64(hexBytes(digest))}:`;
  if (contentDigest !== expected) return refusal("ucp/content-digest-mismatch");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return refusal("ucp/request-malformed");
  }
  if (!isObject(parsed) || !withinDepth(parsed as Json)) return refusal("ucp/request-malformed");
  const lc = parsed[REQUEST_MEMBER];
  if (lc === undefined) return refusal("ucp/no-legal-context");
  if (!isObject(lc) || Object.keys(lc).length !== 2 || lc["type"] !== "sha256") return refusal("ucp/legal-context-malformed");
  const h = normalHash(lc["value"]);
  if (h === null) return refusal("ucp/legal-context-malformed");
  return h;
}

/** The 32 bytes of a hash written `0x` and 64 hex digits. */
function hexBytes(h: AtrHash): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

/** The shape gate `boundAgentSigned` applies first: an object, else `ucp/request-malformed`. */
function requestShape(presented: unknown): true | Refusal {
  return isObject(presented) ? true : refusal("ucp/request-malformed");
}

/** The agent-signed pairing's family descriptor: the unsigned pairing's, with the member `build` gives. */
type AgentSignedFamily = Omit<UcpFamily<CheckoutOption>, "unsigned"> & { unsigned: AgentSignedUnsigned };

/**
 * `ucp/checkout/agent-signed`. The payee broadcasts (`broadcaster` answers `"payee"`): the business's payment handler
 * executes the payment the signed request completes; nothing here reads it. A value that is not an object gets
 * `ucp/request-malformed`, as `bound` refuses it.
 */
export const agentSigned = Object.freeze({
  id: "ucp/checkout/agent-signed" as const,
  data: CARD["ucp/checkout/agent-signed"],
  pattern: deepFreeze({
    pattern: "protocol-extension",
    profile: "ucp/checkout/agent-signed",
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  }) as LcpPattern,
  claims: true as boolean,
  unplaced: unplaced<CheckoutOption>,
  tie: tie<CheckoutOption>,
  advertise: advertiseFor("checkout"),
  read: readShown(readUnsigned),
  build: buildAgentSigned,
  bound: boundAgentSigned,
  broadcaster: broadcastsWithin(requestShape, "payee"),
}) satisfies Entry<"ucp/checkout/agent-signed", AgentSignedPresented, never, never, AgentSignedFamily>;
