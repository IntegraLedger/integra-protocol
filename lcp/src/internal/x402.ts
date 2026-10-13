/**
 * The pieces the x402 pairings share: the option filter's type, the seller's placement over a filter (each x402
 * pairing's `advertise`), the legal context's extension key and schema, the bounds on a document's options and on a
 * link, an option's match by RFC 8785 form, and the other types and helpers the pairings' modules are built from.
 * `../x402.ts` re-exports `LEGAL_CONTEXT` and `LEGAL_CONTEXT_SCHEMA`; no entry point exports the other names.
 */
import {
  canonicalJson,
  fromLegalContext,
  isHashWithNonHttpsLink,
  isHttpsLink,
  isOtherSchemeLink,
  toLegalContext,
  type AtrHash,
  type Json,
} from "../core.js";
import { deepFreeze, isObject, normalHash } from "../fields.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, X402Offer } from "../x402.js";
import { AGREEMENT_URL, agreementIn, agreementUrlFault } from "./agreement.js";

export const LEGAL_CONTEXT = "legalContext";

export const LEGAL_CONTEXT_SCHEMA: Json = deepFreeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    type: { const: "sha256" },
    value: { type: "string", pattern: "^0x[0-9a-f]{64}$" },
    legalContextUrl: { type: "string", pattern: "^https://" },
  },
  required: ["type", "value", "legalContextUrl"],
});

export const MAX_OPTIONS = 32;
export const MAX_LINK = 2048;

/**
 * A pairing's option filter: `true` for an option the pairing serves, a refusal naming why an option of this pairing
 * cannot be served, and undefined for an option that is not this pairing's.
 */
export type OptionFilter = (option: PaymentRequirements) => true | Refusal | undefined;

/** An x402 v2 payment whose `payload` is the pairing's own. */
export type X402Payment<P> = Omit<PaymentPayload, "payload"> & { payload: P };

/** A pairing's `advertise`: the document with the legal context placed, and the agreement URL when one is given. */
export type X402Advertise = (
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
) => PaymentRequired | Refusal;

/** What a pairing's `read` returns: the hash, the link, the agreement URL when the document carries one, the offer. */
export interface X402Read {
  h: AtrHash;
  link: string;
  agreement?: string;
  offer: X402Offer;
}

/**
 * The seller's placement over a pairing's filter: a copy of `doc` whose `extensions.legalContext` carries the hash, the link and, when
 * given, the agreement URL after the link. The legal context is one per document, so each pairing placing the same
 * values into it leaves it as it is. Other extensions are kept and `accepts` is untouched. It refuses an `offer` outside
 * `doc.accepts` or refused by the filter, a link or an agreement URL as `read` refuses it, and a legal context already
 * present with other values.
 */
export function advertiseFor(filter: OptionFilter): X402Advertise {
  return (doc, h, link, offer, agreementUrl) => {
    if (!isObject(doc) || doc.x402Version !== 2) return refusal("x402/not-v2");
    if (!Array.isArray(doc.accepts) || doc.accepts.length > MAX_OPTIONS) return refusal("x402/option-malformed");
    if (!isOffered(doc.accepts, offer)) return refusal("x402/option-not-in-document");
    const f = isObject(offer) ? filter(offer) : undefined;
    if (f === undefined) return refusal("x402/option-not-this-pairing");
    if (f !== true) return f;
    if (!isLink(link)) {
      return isOtherSchemeLink(link) ? refusal("x402/link-not-https") : refusal("x402/legal-context-malformed");
    }
    const agreementFaulted = agreementUrlFault(agreementUrl);
    if (agreementFaulted?.fault === "link-not-https") return refusal("x402/link-not-https");
    if (agreementFaulted !== undefined) return refusal("x402/legal-context-malformed");
    if (normalHash(h) === null) return refusal("x402/legal-context-malformed");
    const lc = toLegalContext(h, link).legalContext;
    const info = agreementUrl === undefined ? lc : { ...lc, [AGREEMENT_URL]: agreementUrl };
    const extensions: unknown = doc.extensions;
    if (extensions !== undefined && !isObject(extensions)) return refusal("x402/legal-context-malformed");
    const present = extensions?.[LEGAL_CONTEXT];
    if (present !== undefined && !sameJson(isObject(present) ? present["info"] : undefined, info)) {
      return refusal("x402/legal-context-conflict");
    }
    return {
      ...doc,
      extensions: { ...(extensions ?? {}), [LEGAL_CONTEXT]: { info, schema: LEGAL_CONTEXT_SCHEMA } } as NonNullable<
        PaymentRequired["extensions"]
      >,
    };
  };
}

/**
 * The filter for the options `pairs` accepts: those that `payable` also accepts (every one, without it) are served,
 * and the rest are refused `x402/option-malformed`.
 */
export function filterOf(
  pairs: (option: PaymentRequirements) => boolean,
  payable?: (option: PaymentRequirements) => boolean,
): OptionFilter {
  return (o) => (!pairs(o) ? undefined : payable === undefined || payable(o) ? true : refusal("x402/option-malformed"));
}

/**
 * The buyer's reading over a pairing's filter: the hash, the link, the agreement URL when `extensions.legalContext` carries one, and
 * the options the filter serves, in document order. A link or agreement URL of at most 2048 characters that parses as
 * an absolute URL with a scheme other than `https` is `x402/link-not-https`; any other value that is not a link, or two
 * spellings that disagree, is `x402/legal-context-malformed`.
 */
export function readFor(filter: OptionFilter): (doc: unknown) => X402Read | Refusal {
  return (doc) => {
    if (!isObject(doc) || doc["x402Version"] !== 2) return refusal("x402/not-v2");
    const accepts = doc["accepts"];
    if (!Array.isArray(accepts) || accepts.length > MAX_OPTIONS) return refusal("x402/option-malformed");
    const extensions = doc["extensions"];
    const lc = legalContextOf(extensions);
    if (isRefusal(lc)) return lc;
    const present = isObject(extensions) ? extensions[LEGAL_CONTEXT] : undefined;
    const agreement = agreementIn(isObject(present) ? present["info"] : undefined);
    if (typeof agreement === "object" && agreement.fault === "link-not-https") return refusal("x402/link-not-https");
    if (typeof agreement === "object") return refusal("x402/legal-context-malformed");
    const options = (accepts as PaymentRequirements[]).filter((o) => isObject(o) && filter(o) === true);
    if (options.length === 0) return refusal("x402/no-payable-option");
    const offer = { required: doc as PaymentRequired, options };
    return agreement === undefined ? { h: lc.h, link: lc.link, offer } : { h: lc.h, link: lc.link, agreement, offer };
  };
}

/** The hash and link in a document's `extensions.legalContext`, or the refusal that names what is wrong. */
export function legalContextOf(extensions: unknown): { h: AtrHash; link: string } | Refusal {
  const lc = isObject(extensions) ? extensions[LEGAL_CONTEXT] : undefined;
  if (lc === undefined) return refusal("x402/no-legal-context");
  const info = isObject(lc) ? lc["info"] : undefined;
  const decoded = fromLegalContext({ legalContext: info });
  if (decoded === null) {
    return isHashWithNonHttpsLink(info) ? refusal("x402/link-not-https") : refusal("x402/legal-context-malformed");
  }
  if (decoded.url.length > MAX_LINK) return refusal("x402/legal-context-malformed");
  return { h: decoded.h, link: decoded.url };
}

/**
 * The checks `build` makes on the buyer's choice before anything pairing-specific: the document is x402 v2 with at
 * most 32 options, the chosen option is one it offers, and the filter serves it.
 */
export function chosen(required: unknown, accepted: unknown, filter: OptionFilter): true | Refusal {
  if (!isObject(required) || required["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepts = required["accepts"];
  if (!Array.isArray(accepts) || accepts.length > MAX_OPTIONS) return refusal("x402/option-malformed");
  if (!isOffered(accepts as PaymentRequirements[], accepted as PaymentRequirements)) {
    return refusal("x402/option-not-in-document");
  }
  const f = isObject(accepted) ? filter(accepted as PaymentRequirements) : undefined;
  return f ?? refusal("x402/option-not-this-pairing");
}

/** A presented payment's `accepted`, served by the filter, its `payload` object and its `extensions`. */
export function presentedWith(
  presented: unknown,
  filter: OptionFilter,
): { accepted: PaymentRequirements; payload: Record<string, unknown>; extensions: unknown } | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isObject(accepted)) return refusal("x402/payload-malformed");
  const f = filter(accepted as PaymentRequirements);
  if (f === undefined) return refusal("x402/option-not-this-pairing");
  if (f !== true) return f;
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  return { accepted: accepted as PaymentRequirements, payload, extensions: presented["extensions"] };
}

/** The index of the first of `accepts` that is `offer`, by identity or by equal RFC 8785 form, or -1. */
export function offeredAt(accepts: readonly PaymentRequirements[], offer: PaymentRequirements): number {
  return accepts.findIndex((a) => a === offer || sameJson(a, offer));
}

/** The document with option `at` replaced. */
export function withOption(doc: PaymentRequired, at: number, option: PaymentRequirements): PaymentRequired {
  const accepts = doc.accepts.slice();
  accepts[at] = option;
  return { ...doc, accepts };
}

/** A copy of an option with `extra[key] = value`. */
export function withExtra(option: PaymentRequirements, key: string, value: Json): PaymentRequirements {
  return { ...option, extra: { ...(option.extra ?? {}), [key]: value } };
}

/** True when `offer` is one of `accepts`, by identity or by equal RFC 8785 form. */
export function isOffered(accepts: readonly PaymentRequirements[], offer: PaymentRequirements): boolean {
  return accepts.some((a) => a === offer || sameJson(a, offer));
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false;
  const x = canonicalJson(a as Json);
  const y = canonicalJson(b as Json);
  return typeof x === "string" && x === y;
}

function isLink(s: unknown): s is string {
  return typeof s === "string" && s.length <= MAX_LINK && isHttpsLink(s);
}
