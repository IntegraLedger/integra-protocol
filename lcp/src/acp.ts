/**
 * ACP checkout sessions and delegate-payment allowances, and the pairings `acp/checkout/delegated` and
 * `acp/checkout/undelegated`: the ATR hash as the checkout session's `id`, with the link beside it in the session's
 * `metadata.legal_context`, and, where the handler requires `delegate_payment`, as the allowance's
 * `checkout_session_id`. Pure; no I/O. Nothing here signs or verifies a signature.
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
import { isObject, jsonBytes, normalHash, sameJson } from "./fields.js";
import { AGREEMENT_URL_SNAKE, agreementIn, agreementRefusal } from "./internal/agreement.js";
import { refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";

export const METADATA_KEY = "legal_context";

/** A CheckoutSession. Every member other than `id` and `metadata.legal_context` is carried untouched. */
export type Session = { id?: string; metadata?: { [k: string]: Json } } & { [k: string]: Json };

/** The kind of payment handler a session offers: ACP's own `requires_delegate_payment` flag. */
export type HandlerOption = { requires_delegate_payment: boolean };

/** ACP's Allowance: six members, closed. */
export type Allowance = {
  reason: "one_time";
  max_amount: number;
  currency: string;
  checkout_session_id: string;
  merchant_id: string;
  expires_at: string;
};

/** The buyer's own values for the allowance, and the session it pays. */
export interface AcpChoice {
  session: Session;
  max_amount: number;
  currency: string;
  merchant_id: string;
  expires_at: string;
}

/** The `delegate_payment` request as the agent signs it. */
export type Presented = { allowance: Allowance } & { [k: string]: Json };

export interface Unsigned {
  allowance: Allowance;
  complete(request: Presented): Presented | Refusal;
}

export interface AcpBinding<Id extends string> {
  id: Id;
  pattern: LcpPattern;
  claims: boolean;
  unplaced(option: HandlerOption): HandlerOption;
  tie: typeof tie;
  advertise(doc: Session, h: AtrHash, link: string, offer: HandlerOption, agreementUrl?: string): Session | Refusal;
  read(doc: Session): { h: AtrHash; link: string; agreement?: string; offer: { session: Session } } | Refusal;
  build(choice: AcpChoice, h: AtrHash): Promise<Unsigned | Refusal>;
  bound(presented: unknown): Promise<AtrHash | Refusal>;
}

const MAX_SESSION_BYTES = 1_048_576;
const HASH_LENGTH = 66;
const MAX_LINK = 2048;
const MAX_MERCHANT_ID = 256;
const MAX_EXPIRES_AT = 64;
const CURRENCY = /^[a-z]{3}$/;
const ALLOWANCE_MEMBERS = ["reason", "max_amount", "currency", "checkout_session_id", "merchant_id", "expires_at"];

/** SHA-256 over the RFC 8785 form of an issued handler option. */
export const issuedDigest: typeof digestJson = digestJson;

/** The binding slot: one option per kind of payment handler the session offers, and nothing from the checkout. */
export function tie(options: readonly HandlerOption[]): ["acp", { options: readonly HandlerOption[] }] {
  return ["acp", { options }];
}

/**
 * A copy of the session with `id` = h and `metadata.legal_context` = `{type, value, legal_context_url}`, followed by
 * `legal_context_agreement_url` when `agreementUrl` is given. Other metadata members and every other member are kept.
 * With the same values already present it returns an equal session.
 */
function advertise(doc: Session, h: AtrHash, link: string, offer: HandlerOption, agreementUrl?: string): Session | Refusal {
  if (!isObject(doc)) return refusal("acp/session-malformed");
  const size = jsonBytes(doc);
  if (size === undefined) return refusal("acp/session-malformed");
  if (size > MAX_SESSION_BYTES) return refusal("acp/too-large");
  if (!isObject(offer) || typeof offer["requires_delegate_payment"] !== "boolean") {
    return refusal("acp/option-malformed");
  }
  const id = normalHash(h);
  if (id === null) return refusal("acp/legal-context-malformed");
  if (!isHttpsLink(link)) return refusal(isOtherSchemeLink(link) ? "acp/link-not-https" : "acp/legal-context-malformed");
  if (link.length > MAX_LINK) return refusal("acp/legal-context-malformed");
  const agreementFaulted = agreementRefusal("acp", agreementUrl);
  if (agreementFaulted !== undefined) return agreementFaulted;
  const present = doc["id"];
  if (present !== undefined && !(typeof present === "string" && hashEquals(present, id))) {
    return refusal("acp/id-conflict");
  }
  const metadata: unknown = doc["metadata"];
  if (metadata !== undefined && !isObject(metadata)) return refusal("acp/session-malformed");
  const snake = toLegalContext(id, link, "snake").legalContext;
  const legalContext = (agreementUrl === undefined ? snake : { ...snake, [AGREEMENT_URL_SNAKE]: agreementUrl }) as Json;
  const existing = metadata?.[METADATA_KEY];
  if (existing !== undefined && !sameJson(existing, legalContext)) return refusal("acp/legal-context-conflict");
  const { id: _replaced, ...rest } = doc;
  return { id, ...rest, metadata: { ...(metadata as { [k: string]: Json } | undefined), [METADATA_KEY]: legalContext } };
}

/**
 * The buyer's reading of a session: the hash from `id`, and the link and, when present, the agreement URL from
 * `metadata.legal_context`, whose value must decode to the same 32 bytes. No other place is read.
 */
function read(doc: Session): { h: AtrHash; link: string; agreement?: string; offer: { session: Session } } | Refusal {
  if (!isObject(doc)) return refusal("acp/session-malformed");
  const size = jsonBytes(doc);
  if (size === undefined) return refusal("acp/session-malformed");
  if (size > MAX_SESSION_BYTES) return refusal("acp/too-large");
  const id: unknown = doc["id"];
  if (typeof id === "string" && id.length > HASH_LENGTH) return refusal("acp/too-large");
  const h = normalHash(id);
  if (h === null) return refusal("acp/id-not-hash");
  const metadata: unknown = doc["metadata"];
  const lc = isObject(metadata) ? metadata[METADATA_KEY] : undefined;
  if (lc === undefined) return refusal("acp/no-legal-context");
  const decoded = fromLegalContext({ legalContext: lc });
  if (decoded === null) {
    return isHashWithNonHttpsLink(lc) ? refusal("acp/link-not-https") : refusal("acp/legal-context-malformed");
  }
  if (decoded.url.length > MAX_LINK) return refusal("acp/legal-context-malformed");
  if (!hashEquals(decoded.h, h)) return refusal("acp/legal-context-conflict");
  const agreement = agreementIn(lc);
  if (typeof agreement === "object") return refusal(`acp/${agreement.fault}`);
  return agreement === undefined
    ? { h, link: decoded.url, offer: { session: doc } }
    : { h, link: decoded.url, agreement, offer: { session: doc } };
}

/**
 * The allowance the agent's `delegate_payment` request carries: the buyer's own values, in ACP's order, with
 * `checkout_session_id` = h. `complete` returns the request only when its allowance is the one built.
 */
async function buildDelegated(choice: AcpChoice, h: AtrHash): Promise<Unsigned | Refusal> {
  if (!isObject(choice)) return refusal("acp/choice-malformed");
  const session: unknown = choice["session"];
  const sessionId = isObject(session) ? session["id"] : undefined;
  const nh = normalHash(h);
  if (nh === null || typeof sessionId !== "string" || !hashEquals(sessionId, nh)) {
    return refusal("acp/hash-not-session");
  }
  const { max_amount, currency, merchant_id, expires_at } = choice as unknown as Record<string, unknown>;
  if (typeof merchant_id === "string" && merchant_id.length > MAX_MERCHANT_ID) return refusal("acp/too-large");
  if (typeof expires_at === "string" && expires_at.length > MAX_EXPIRES_AT) return refusal("acp/too-large");
  if (
    typeof max_amount !== "number" ||
    !Number.isSafeInteger(max_amount) ||
    max_amount < 0 ||
    typeof currency !== "string" ||
    !CURRENCY.test(currency) ||
    typeof merchant_id !== "string" ||
    merchant_id.length < 1 ||
    typeof expires_at !== "string" ||
    !isRfc3339DateTime(expires_at)
  ) {
    return refusal("acp/choice-malformed");
  }
  const built: Allowance = {
    reason: "one_time",
    max_amount,
    currency,
    checkout_session_id: nh,
    merchant_id,
    expires_at,
  };
  const kept = canonicalJson(built);
  return {
    allowance: { ...built },
    complete(request: Presented): Presented | Refusal {
      if (!isObject(request)) return refusal("acp/allowance-changed");
      const given = canonicalJson(request["allowance"] as Json);
      if (typeof given !== "string" || given !== kept) return refusal("acp/allowance-changed");
      return request;
    },
  };
}

/**
 * The hash inside what the agent signed: the allowance's `checkout_session_id`, lowercase. No signature is
 * verified here.
 */
async function boundDelegated(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented)) return refusal("acp/allowance-malformed");
  const a: unknown = presented["allowance"];
  if (!isAllowance(a)) return refusal("acp/allowance-malformed");
  const h = normalHash(a.checkout_session_id);
  if (h === null) return refusal("acp/id-not-hash");
  return h;
}

/** The option unchanged: the session id carries the hash, and the option does not. */
function unplaced(option: HandlerOption): HandlerOption {
  return option;
}

const PROFILE = "acp/checkout/session-id";
const AGREEMENT_SENTENCE =
  "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
  "recorded in <transaction>. ";

const delegatedPattern: LcpPattern = Object.freeze({
  pattern: "native-field",
  canonical: true,
  profile: PROFILE,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    AGREEMENT_SENTENCE +
    "The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's " +
    "link in metadata. The payment handler required delegate_payment, so ACP has the buyer's agent obtain a vault " +
    "token whose allowance names this session as checkout_session_id, in a request the agent signs (a MUST in one " +
    "section of ACP and RECOMMENDED in another) and the PSP SHOULD verify. The seller neither saw nor verified " +
    "that allowance or its signature, and ACP does not require the PSP to hold the token to that session. The seller " +
    "tied the payment to the hash in its report. This does not show that amount, payee or timing match the ATR's " +
    "content.",
});

const undelegatedPattern: LcpPattern = Object.freeze({
  pattern: "http-advisory",
  canonical: true,
  profile: PROFILE,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    AGREEMENT_SENTENCE +
    "The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's " +
    "link in metadata. The payment handler did not require delegate_payment, so nothing the buyer signed for the " +
    "payment names the hash. The seller tied the payment to the hash in its report.",
});

export const delegated: AcpBinding<"acp/checkout/delegated"> = Object.freeze({
  id: "acp/checkout/delegated",
  pattern: delegatedPattern,
  claims: false,
  unplaced,
  tie,
  advertise,
  read,
  build: buildDelegated,
  bound: boundDelegated,
});

export const undelegated: AcpBinding<"acp/checkout/undelegated"> = Object.freeze({
  id: "acp/checkout/undelegated",
  pattern: undelegatedPattern,
  claims: false,
  unplaced,
  tie,
  advertise,
  read,
  build: async (): Promise<Refusal> => refusal("acp/nothing-to-sign"),
  bound: async (): Promise<Refusal> => refusal("acp/not-buyer-signed"),
});

/** Exactly ACP's six allowance members, with `reason` "one_time", strings, and a non-negative safe integer amount. */
function isAllowance(a: unknown): a is Allowance {
  if (!isObject(a)) return false;
  const keys = Object.keys(a);
  if (keys.length !== ALLOWANCE_MEMBERS.length || !ALLOWANCE_MEMBERS.every((k) => keys.includes(k))) return false;
  const amount = a["max_amount"];
  return (
    a["reason"] === "one_time" &&
    typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= 0 &&
    typeof a["currency"] === "string" &&
    typeof a["checkout_session_id"] === "string" &&
    typeof a["merchant_id"] === "string" &&
    typeof a["expires_at"] === "string"
  );
}

/** RFC 3339 `date-time`: full-date "T" full-time, with a time offset, and each field in its range. */
function isRfc3339DateTime(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(s);
  if (m === null) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return false;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 60) return false;
  if (m[9] !== undefined && (Number(m[10]) > 23 || Number(m[11]) > 59)) return false;
  return true;
}

function daysIn(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

