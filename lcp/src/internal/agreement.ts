/**
 * The agreement URL: an https link of at most 2048 characters, placed beside the link to the seller's copy of the ATR
 * in the same object.
 */
import { isHttpsLink, isOtherSchemeLink } from "../core.js";
import { refusal, type Refusal } from "../refusal.js";

const MAX_LINK = 2048;

/** The member beside `legalContextUrl`. */
export const AGREEMENT_URL = "legalContextAgreementUrl";
/** The member beside `legal_context_url`. */
export const AGREEMENT_URL_SNAKE = "legal_context_agreement_url";

export function isAgreementUrl(s: unknown): s is string {
  return typeof s === "string" && s.length <= MAX_LINK && isHttpsLink(s);
}

/** Why a value in the agreement URL's place is refused, as the suffix of the pairing's refusal code. */
export interface AgreementFault {
  fault: "link-not-https" | "legal-context-malformed";
}

/**
 * The fault of a value that is not an agreement URL: a string of at most 2048 characters that parses as an absolute
 * URL whose scheme is not `https` is `link-not-https`; every other value (not a string, empty, unparseable, longer
 * than 2048 characters, or an `https` URL the link rule refuses) is `legal-context-malformed`.
 */
export function agreementFault(url: unknown): AgreementFault {
  return { fault: isOtherSchemeLink(url) ? "link-not-https" : "legal-context-malformed" };
}

/** Undefined for no agreement URL or an agreement URL; otherwise `<ns>/` and the value's `agreementFault`. */
export function agreementRefusal(ns: string, url: unknown): Refusal | undefined {
  return url === undefined || isAgreementUrl(url) ? undefined : refusal(`${ns}/${agreementFault(url).fault}`);
}

/**
 * The agreement URL in a legal context object, in either spelling: undefined when neither is present; the fault when
 * the two spellings disagree (`legal-context-malformed`) or the value is not an agreement URL (`agreementFault`).
 */
export function agreementIn(lc: unknown): string | undefined | AgreementFault {
  if (!isObject(lc)) return undefined;
  const camel = lc[AGREEMENT_URL];
  const snake = lc[AGREEMENT_URL_SNAKE];
  if (camel === undefined && snake === undefined) return undefined;
  if (camel !== undefined && snake !== undefined && camel !== snake) return { fault: "legal-context-malformed" };
  const url = camel ?? snake;
  return isAgreementUrl(url) ? url : agreementFault(url);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
