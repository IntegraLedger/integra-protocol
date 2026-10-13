/**
 * The seller's placement over an x402 pairing's option filter, which each x402 pairing's `advertise` is, with the
 * filter's type and the pieces it shares with `../x402.ts`: the legal context's extension key and schema, the bounds
 * on a document's options and on a link, and an option's match by RFC 8785 form. `../x402.ts` re-exports
 * `LEGAL_CONTEXT` and `LEGAL_CONTEXT_SCHEMA`; no entry point exports the other names.
 */
import { canonicalJson, isHttpsLink, isOtherSchemeLink, toLegalContext, type Json } from "../core.js";
import { deepFreeze, isObject, normalHash } from "../fields.js";
import { refusal, type Refusal } from "../refusal.js";
import type { PaymentRequired, PaymentRequirements, X402Advertise } from "../x402.js";
import { AGREEMENT_URL, agreementUrlFault } from "./agreement.js";

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
