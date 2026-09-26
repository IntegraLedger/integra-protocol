/**
 * AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the
 * `legalContext` member of the merchant-signed `checkout_jwt` payload, committed to by the buyer's closed Checkout
 * Mandate through `checkout_hash`, and read back from inside the mandate. Nothing here verifies a signature.
 */
import {
  canonicalJson,
  digestJson,
  fromLegalContext,
  hashEquals,
  isHashWithNonHttpsLink,
  isHttpsLink,
  isOtherSchemeLink,
  toLegalContext,
  type AtrHash,
  type Json,
} from "./core.js";
import { deepFreeze, jsonBytes, normalHash, sameJson } from "./fields.js";
import type { LcpPattern } from "./index.js";
import { AGREEMENT_URL, agreementIn, agreementRefusal } from "./internal/agreement.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  decodeJsonSegment,
  disclosureDigest,
  isJsonObject,
  jwsSegments,
  readSdJwt,
  withinDepth,
  type SdJwtCodes,
} from "./sd-jwt.js";

export const CHECKOUT_VCT = "mandate.checkout.1";

/** A compact JWS: three base64url segments joined by ".". */
export type Jws = string;
/** The `checkout_jwt` payload: the commerce object. */
export type Payload = { [k: string]: Json };
/** The checkout's own `id`, 1–256 characters. */
export type CheckoutOption = { checkout: string };
export interface Ap2Offer {
  checkoutJwt: Jws;
  payload: Payload;
  checkout: string;
}
export interface Presented {
  /** The closed Checkout Mandate, an SD-JWT as presented. */
  checkout_mandate: string;
  /** The checkout JWT the presenter names as the latest. */
  checkout_jwt: Jws;
}
export interface MandateContent {
  checkout_hash: string;
  checkout_jwt?: Jws;
}
export interface Unsigned {
  content: { vct: typeof CHECKOUT_VCT; checkout_jwt: Jws; checkout_hash: string };
  complete(checkout_mandate: string): Presented;
}

const ID = "ap2/checkout-mandate" as const;
const MIB = 1_048_576;
const MAX_ID = 256;
const MAX_LINK = 2048;
const CHECKOUT_HASH = /^[A-Za-z0-9_-]{43}$/;
const MANDATE_CODES: SdJwtCodes = {
  malformed: "ap2/mandate-malformed",
  sdAlgUnsupported: "ap2/sd-alg-unsupported",
  unreferenced: "ap2/disclosure-unreferenced",
  tooLarge: "ap2/too-large",
};


/** The payload of a compact JWS, decoded as one JSON object. The signature is never verified. */
export function jwsPayload(j: Jws): Payload | Refusal {
  if (typeof j !== "string") return refusal("ap2/jws-malformed");
  if (j.length > MIB) return refusal("ap2/too-large");
  const segments = jwsSegments(j);
  if (segments === null) return refusal("ap2/jws-malformed");
  const payload = decodeJsonSegment(segments[1]);
  if (!isJsonObject(payload)) return refusal("ap2/jws-malformed");
  if (!withinDepth(payload)) return refusal("ap2/too-large");
  return payload;
}

/** The option digest the issuer keeps: SHA-256 over the RFC 8785 form. */
export const issuedDigest: typeof digestJson = digestJson;

/** The binding slot: the checkouts this ATR was minted for, each by its own `id`. */
export function tie(options: readonly CheckoutOption[]): ["ap2", { options: readonly CheckoutOption[] }] {
  return ["ap2", { options }];
}

/**
 * The closed Checkout Mandate inside an SD-JWT: exactly one resolved object whose `vct` is `mandate.checkout.1`, its
 * `checkout_hash`, and its `checkout_jwt` when disclosed.
 */
export async function readMandate(m: unknown): Promise<MandateContent | Refusal> {
  const sd = await readSdJwt(m, MANDATE_CODES);
  if (isRefusal(sd)) return sd;
  const found: { [k: string]: Json }[] = [];
  const walk = (v: Json): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v as readonly Json[]) walk(x);
      return;
    }
    const o = v as { [k: string]: Json };
    if (o["vct"] === CHECKOUT_VCT) found.push(o);
    for (const x of Object.values(o)) walk(x);
  };
  walk(sd.resolved);
  if (found.length === 0) return refusal("ap2/no-checkout-mandate");
  if (found.length > 1) return refusal("ap2/mandate-ambiguous");
  const mandate = found[0]!;
  const checkoutHash = mandate["checkout_hash"];
  const checkoutJwt = mandate["checkout_jwt"];
  if (typeof checkoutHash !== "string" || !CHECKOUT_HASH.test(checkoutHash)) return refusal("ap2/mandate-malformed");
  if (checkoutJwt !== undefined && typeof checkoutJwt !== "string") return refusal("ap2/mandate-malformed");
  return checkoutJwt === undefined ? { checkout_hash: checkoutHash } : { checkout_hash: checkoutHash, checkout_jwt: checkoutJwt };
}

/**
 * AP2's merchant check: the mandate's `checkout_hash` is the hash of the presenter's latest `checkout_jwt`, and a
 * disclosed `checkout_jwt` is that JWT. Returns that JWT's payload.
 */
export async function checkoutBinding(p: unknown): Promise<{ payload: Payload } | Refusal> {
  if (!isJsonObject(p)) return refusal("ap2/mandate-malformed");
  const mandate = await readMandate(p.checkout_mandate);
  if (isRefusal(mandate)) return mandate;
  const jwt: unknown = p.checkout_jwt;
  if (typeof jwt !== "string") return refusal("ap2/jws-malformed");
  if (jwt.length > MIB) return refusal("ap2/too-large");
  if ((await disclosureDigest(jwt)) !== mandate.checkout_hash) return refusal("ap2/checkout-not-latest");
  if (mandate.checkout_jwt !== undefined && mandate.checkout_jwt !== jwt) return refusal("ap2/checkout-hash-mismatch");
  const payload = jwsPayload(jwt);
  if (isRefusal(payload)) return payload;
  return { payload };
}

/** The `checkout_jwt` the mandate discloses. */
export async function checkoutJwtOf(m: string): Promise<Jws | Refusal> {
  const mandate = await readMandate(m);
  if (isRefusal(mandate)) return mandate;
  if (mandate.checkout_jwt === undefined) return refusal("ap2/mandate-malformed");
  return mandate.checkout_jwt;
}

/**
 * A copy of the payload with the `legalContext` member appended after the others, carrying `legalContextAgreementUrl`
 * after the link when `agreementUrl` is given. The seller's stack signs the result as its `checkout_jwt`.
 */
function advertise(
  payload: Payload,
  h: AtrHash,
  link: string,
  offer: CheckoutOption,
  agreementUrl?: string,
): Payload | Refusal {
  if (!isOption(offer)) return refusal("ap2/option-malformed");
  if (!isJsonObject(payload)) return refusal("ap2/jws-malformed");
  const id = payload["id"];
  if (typeof id !== "string" || id.length === 0) return refusal("ap2/checkout-id-missing");
  if (id.length > MAX_ID) return refusal("ap2/too-large");
  if (id !== offer.checkout) return refusal("ap2/option-not-this-checkout");
  if (!isHttpsLink(link)) return refusal(isOtherSchemeLink(link) ? "ap2/link-not-https" : "ap2/legal-context-malformed");
  if (link.length > MAX_LINK) return refusal("ap2/legal-context-malformed");
  const agreementFaulted = agreementRefusal("ap2", agreementUrl);
  if (agreementFaulted !== undefined) return agreementFaulted;
  if (normalHash(h) === null) return refusal("ap2/legal-context-malformed");
  const camel = toLegalContext(h, link).legalContext;
  const info = agreementUrl === undefined ? camel : { ...camel, [AGREEMENT_URL]: agreementUrl };
  let out: Payload;
  if (Object.hasOwn(payload, "legalContext")) {
    if (!sameJson(payload["legalContext"], info)) return refusal("ap2/legal-context-conflict");
    out = { ...payload };
  } else {
    out = { ...payload, legalContext: info };
  }
  const size = jsonBytes(out);
  if (size === undefined) return refusal("ap2/jws-malformed");
  if (size > MIB) return refusal("ap2/too-large");
  return out;
}

/**
 * The buyer's reading of the merchant's `checkout_jwt`: the hash, the link and, when present, the agreement URL from
 * `legalContext`, and the checkout.
 */
function read(doc: Jws): { h: AtrHash; link: string; agreement?: string; offer: Ap2Offer } | Refusal {
  const r = readCheckout(doc);
  if (isRefusal(r)) return r;
  const agreement = agreementIn(r.offer.payload["legalContext"]);
  if (typeof agreement === "object") return refusal(`ap2/${agreement.fault}`);
  return agreement === undefined ? r : { h: r.h, link: r.link, agreement, offer: r.offer };
}

/** The hash and link from the `checkout_jwt`'s `legalContext`, and the checkout. */
function readCheckout(doc: Jws): { h: AtrHash; link: string; offer: Ap2Offer } | Refusal {
  const payload = jwsPayload(doc);
  if (isRefusal(payload)) return payload;
  const id = payload["id"];
  if (typeof id !== "string" || id.length === 0) return refusal("ap2/checkout-id-missing");
  if (id.length > MAX_ID) return refusal("ap2/too-large");
  if (!Object.hasOwn(payload, "legalContext")) return refusal("ap2/no-legal-context");
  const lc = fromLegalContext(payload);
  if (lc === null) {
    return isHashWithNonHttpsLink(payload["legalContext"])
      ? refusal("ap2/link-not-https")
      : refusal("ap2/legal-context-malformed");
  }
  if (lc.url.length > MAX_LINK) return refusal("ap2/legal-context-malformed");
  return { h: lc.h, link: lc.url, offer: { checkoutJwt: doc, payload, checkout: id } };
}

/** The closed Checkout Mandate's required claims, for the buyer's mandate signer. */
async function build(offer: Ap2Offer, h: AtrHash): Promise<Unsigned | Refusal> {
  if (!isJsonObject(offer)) return refusal("ap2/jws-malformed");
  const checkoutJwt = offer.checkoutJwt;
  const r = readCheckout(checkoutJwt);
  if (isRefusal(r)) return r;
  if (!hashEquals(r.h, h)) return refusal("ap2/hash-not-in-checkout");
  const checkout_hash = await disclosureDigest(checkoutJwt);
  return {
    content: { vct: CHECKOUT_VCT, checkout_jwt: checkoutJwt, checkout_hash },
    complete(checkout_mandate: string): Presented {
      return { checkout_mandate, checkout_jwt: checkoutJwt };
    },
  };
}

/** The hash in the checkout the buyer's mandate commits to, lowercase. No signature is verified. */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const b = await checkoutBinding(presented);
  if (isRefusal(b)) return b;
  if (!Object.hasOwn(b.payload, "legalContext")) return refusal("ap2/no-legal-context");
  const lc = fromLegalContext(b.payload);
  if (lc === null) {
    return isHashWithNonHttpsLink(b.payload["legalContext"])
      ? refusal("ap2/link-not-https")
      : refusal("ap2/legal-context-malformed");
  }
  if (lc.url.length > MAX_LINK) return refusal("ap2/legal-context-malformed");
  return lc.h;
}

/** The option unchanged: on this pairing the hash rides in the checkout payload, not in the option. */
function unplaced(option: CheckoutOption): CheckoutOption {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "opaque-challenge",
  canonical: true,
  profile: ID,
  buyerSigns: true,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
    "recorded in <transaction>. The buyer's closed AP2 Checkout Mandate carries checkout_hash, the SHA-256 of the " +
    "checkout JWT the seller last sent, and that JWT's payload carries this ATR's hash as its legalContext member. The " +
    "seller read both from inside the mandate. The mandate's signer is the user's trusted surface, or the agent " +
    "under the user's open mandate. The seller did not verify that signature: AP2 has the Credential Provider " +
    "verify the Payment Mandate, whose transaction_id is the same hash, before a payment credential issues. The seller " +
    "reported the payment. This does not show that amount, payee or timing match the ATR's content.",
});

export const checkoutMandate = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
});

function isOption(o: unknown): o is CheckoutOption {
  if (!isJsonObject(o)) return false;
  const keys = Object.keys(o);
  const c = o["checkout"];
  return keys.length === 1 && typeof c === "string" && c.length >= 1 && c.length <= MAX_ID;
}

