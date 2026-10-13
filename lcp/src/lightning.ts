/**
 * BOLT11 invoices and the Lightning pairings on x402 and MPP. On `x402/exact/lnbtc` the seller's node writes the ATR hash as the
 * invoice's `m` field and signs it; on `x402/exact/lnbtc/invoice-named` the invoice carries no hash and the ATR's
 * `x402` slot names the invoice instead. On MPP the seller's node writes the ATR hash as the invoice's description hash `h`. The
 * payer signs nothing; it pays the invoice.
 */
import { canonicalJson, fromLegalContext, fromRawBytes, parseJson, type AtrHash, type Json } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { decode, FIELD, isLnOffer, isLnOption, lnbtcPairs, namedPairs, NETWORKS } from "./internal/lightning.js";
import { advertiseFor } from "./internal/x402.js";
import {
  b64uEncode,
  credentialOf,
  checkChallenge,
  decodeObject,
  echoedFor,
  place,
  read as mppRead,
  tie as mppTie,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  chosen,
  filterOf,
  paymentWith,
  readFor,
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

/** CAIP-2 for Lightning: `lnbtc:` and the first 32 hex digits of the Bitcoin network's genesis block hash. */
export type LnNetwork = "lnbtc:000000000019d6689c085ae165831e93" | "lnbtc:000000000933ea01ad0ee984209779ba";

export interface Bolt11 {
  currency: "bc" | "tb" | "tbs" | "bcrt";
  amountMsat: bigint | null;
  timestamp: number;
  expiry: number;
  paymentHash: Uint8Array;
  descriptionHash: Uint8Array | null;
  description: string | null;
  metadata: Uint8Array | null;
  /** Every tagged field's type, in invoice order. */
  tags: readonly number[];
}

/** The read keys `reference` returns: the invoice's payment hash as lowercase hex, and when the payment can land. */
export interface LnRef {
  network: string;
  paymentHash: string;
  settleBy: number;
}

export interface LnUnsigned {
  /** The payer's node pays exactly this invoice. */
  request: { kind: "bolt11-pay"; invoice: string };
  complete(preimage: string): LnPaymentPayload | Refusal;
}

export type LnPaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { preimage: string };
  extensions?: PaymentRequired["extensions"];
};

const MAX_ACCEPTS_READ = 32;
const MAX_ATR = 1_048_576;
const SKEW_SECONDS = 60;
const PAY_TO = /^[0-9a-f]{66}$/;
const REQUEST_HASH = /^[0-9a-f]{64}$/;
const PREIMAGE = /^[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]{0,77}$/;
/** The ATR's text: strict UTF-8 with a byte-order mark kept, so an ATR that begins with one is not one JSON object. */
const atrText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Decodes a BOLT11 invoice without its length limit, up to 8 KiB. The signature is not verified. */
export async function decodeBolt11(invoice: string): Promise<Bolt11 | Refusal> {
  return decode(invoice);
}

/** The one 32-byte `h` or `m` field of an invoice, as the hash it carries. */
export function invoiceH(b: Bolt11, field: "h" | "m"): AtrHash | Refusal {
  if (!isObject(b) || !Array.isArray(b.tags)) return refusal("ln/invoice-malformed");
  const type = FIELD[field];
  const count = b.tags.filter((t) => t === type).length;
  if (count === 0) return field === "h" ? refusal("ln/no-description-hash") : refusal("ln/no-metadata");
  if (count > 1) return refusal("ln/field-repeated");
  const bytes = field === "h" ? b.descriptionHash : b.metadata;
  const h = bytes === null ? null : fromRawBytes(bytes);
  return h ?? refusal("ln/field-length");
}

/**
 * True when the ATR's bytes are one JSON object in the core's layout whose `x402` slot's `accepts` holds, among its
 * first 32 entries, an option whose `extra.invoice` is exactly `invoice`. The object's first members are `atrVersion`,
 * `id` and `x402`, in that order, and no member name appears twice, so every JSON reader finds the same `x402` slot.
 * Only that slot is read.
 */
export function atrNamesInvoice(atr: Uint8Array, invoice: string): boolean {
  if (!(atr instanceof Uint8Array) || atr.length > MAX_ATR || typeof invoice !== "string") return false;
  let text: string;
  try {
    text = atrText.decode(atr);
  } catch {
    return false;
  }
  const parsed = parseJson(text);
  if (!isObject(parsed)) return false;
  const names = memberNames(text);
  if (names[0] !== "atrVersion" || names[1] !== "id" || names[2] !== "x402") return false;
  if (new Set(names).size !== names.length) return false;
  const slot = parsed["x402"];
  const accepts = isObject(slot) ? slot["accepts"] : undefined;
  if (!Array.isArray(accepts)) return false;
  return accepts.slice(0, MAX_ACCEPTS_READ).some((o: unknown) => {
    const extra = isObject(o) ? o["extra"] : undefined;
    return isObject(extra) && extra["invoice"] === invoice;
  });
}

/**
 * The member names of the JSON object `text` holds, decoded, in the order written. `text` is one JSON object that
 * `JSON.parse` has read, so the scan only walks it; each step moves forward, so the scan ends within its length.
 */
function memberNames(text: string): string[] {
  let i = 0;
  const space = (): void => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };
  const skipString = (): void => {
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
  };
  const skipValue = (): void => {
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        skipString();
        if (depth === 0) return;
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        if (depth === 0) return;
        depth--;
        i++;
        if (depth === 0) return;
        continue;
      } else if (c === "," && depth === 0) return;
      i++;
    }
  };
  const names: string[] = [];
  space();
  i++;
  space();
  while (i < text.length && text[i] === '"') {
    const start = i;
    skipString();
    names.push(JSON.parse(text.slice(start, i)) as string);
    space();
    i++;
    space();
    skipValue();
    space();
    if (text[i] !== ",") break;
    i++;
    space();
  }
  return names;
}

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/**
 * The x402 option checks both Lightning pairings make on the invoice and the option. `h` is the ATR hash the
 * invoice's `m` must carry, or null where `m` must be absent.
 */
function checkOption(o: PaymentRequirements & { extra: { invoice: string } }, h: AtrHash | null): Bolt11 | Refusal {
  const b = decode(o.extra.invoice);
  if (isRefusal(b)) return b;
  if (h !== null) {
    const m = invoiceH(b, "m");
    if (isRefusal(m)) return m;
    if (m !== normalHash(h)) return refusal("ln/no-metadata");
  } else if (b.tags.includes(FIELD.m)) {
    return refusal("ln/not-this-pairing");
  }
  const d = invoiceH(b, "h");
  if (isRefusal(d)) return d;
  const requestHash = o.extra["requestHash"];
  if (typeof requestHash !== "string" || !REQUEST_HASH.test(requestHash) || d !== `0x${requestHash}`) {
    return refusal("ln/request-hash-mismatch");
  }
  if (NETWORKS[o.network as LnNetwork] !== b.currency) return refusal("ln/currency-network");
  const malformed = optionFields(o);
  return malformed ?? b;
}

/** x402's client checks on the option's own fields: `paymentFlow`, `asset`, `payTo`, `amount`, `maxTimeoutSeconds`. */
function optionFields(o: PaymentRequirements): Refusal | null {
  if (
    !isObject(o.extra) ||
    o.extra["paymentFlow"] !== "upfront" ||
    o.asset !== "BTC" ||
    typeof o.payTo !== "string" ||
    !PAY_TO.test(o.payTo) ||
    typeof o.amount !== "string" ||
    !POSITIVE.test(o.amount) ||
    !Number.isSafeInteger(o.maxTimeoutSeconds) ||
    o.maxTimeoutSeconds <= 0
  ) {
    return refusal("x402/option-malformed");
  }
  return null;
}

/** The option without `extra.invoice`, the dynamic field that carries the hash on `x402/exact/lnbtc`. */
function withoutInvoice(option: PaymentRequirements): PaymentRequirements {
  if (!isObject(option) || !isObject(option.extra) || !Object.hasOwn(option.extra, "invoice")) return option;
  const { invoice: _, ...extra } = option.extra;
  return { ...option, extra };
}

function completeFor(required: PaymentRequired, accepted: PaymentRequirements): (preimage: string) => LnPaymentPayload | Refusal {
  return (preimage) => {
    if (typeof preimage !== "string" || !PREIMAGE.test(preimage)) return refusal("ln/preimage-malformed");
    return paymentWith(required, accepted, { preimage });
  };
}

/** The read keys: the network, the invoice's payment hash, and its timestamp plus expiry plus x402's 60 s skew. */
async function x402Reference(presented: unknown, want: boolean): Promise<LnRef | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isLnOption(accepted)) return refusal("x402/option-not-this-pairing");
  const b = decode(accepted.extra.invoice);
  if (isRefusal(b)) return b;
  if (b.tags.includes(FIELD.m) !== want) return want ? refusal("ln/no-metadata") : refusal("ln/not-this-pairing");
  return { network: accepted.network, paymentHash: hex(b.paymentHash), settleBy: b.timestamp + b.expiry + SKEW_SECONDS };
}

const X1_OPENING =
  "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
  "recorded in <transaction>. ";
/** What the record shows of the payment itself: the seller's report, and the invoice and preimage the parties hold. */
const REPORT =
  "Settlement is the seller's report; the invoice and its preimage, which the parties hold, are the proof of the " +
  "payment. No public ledger shows it. This does not show that amount, payee or timing match the ATR's content.";
/** On the pairings whose invoice carries the hash: no signature is verified here, and the payer signs nothing. */
const UNVERIFIED = "Its signature is not verified here, and the payer signed nothing that carries the hash. " + REPORT;

// ── x402/exact/lnbtc ──

const LNBTC = "x402/exact/lnbtc" as const;
const lnbtcShared = advertiseFor(filterOf(isLnOption));

/**
 * The x402 entry point's legal-context placement, then the invoice's checks: its `m` is `h`, its `h` is the request
 * hash.
 */
function lnbtcAdvertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = lnbtcShared(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const b = checkOption(offer as PaymentRequirements & { extra: { invoice: string } }, h);
  return isRefusal(b) ? b : placed;
}

const lnbtcBeforeShared = advertiseFor(filterOf(isLnOffer));

/**
 * `advertise` for the offer the seller sends before its node writes the invoice: the legal-context placement and the
 * option's own checks (a 64-hex-digit `requestHash`, x402's client checks). The invoice, its `m` and its `h` are not
 * read.
 */
function lnbtcAdvertiseBeforeCarrier(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = lnbtcBeforeShared(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const requestHash = (offer.extra as { [k: string]: Json })["requestHash"];
  if (typeof requestHash !== "string" || !REQUEST_HASH.test(requestHash)) return refusal("ln/request-hash-mismatch");
  return optionFields(offer) ?? placed;
}

async function lnbtcBuild(c: { required: PaymentRequired; accepted: PaymentRequirements }, h: AtrHash): Promise<LnUnsigned | Refusal> {
  if (!isObject(c)) return refusal("x402/not-v2");
  const wrong = chosen(c.required, c.accepted, filterOf(isLnOption));
  if (wrong !== true) return wrong;
  const accepted = c.accepted as PaymentRequirements & { extra: { invoice: string } };
  const b = checkOption(accepted, h);
  if (isRefusal(b)) return b;
  return { request: { kind: "bolt11-pay", invoice: accepted.extra.invoice }, complete: completeFor(c.required, c.accepted) };
}

/** The hash in the invoice the payer paid: its `m` field. No signature is verified here. */
async function lnbtcBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isLnOption(accepted)) return refusal("x402/option-not-this-pairing");
  const b = decode(accepted.extra.invoice);
  if (isRefusal(b)) return b;
  return invoiceH(b, "m");
}

export const exactLnbtc = Object.freeze({
  id: LNBTC,
  pattern: deepFreeze({
    pattern: "native-field",
    canonical: true,
    profile: LNBTC,
    buyerSigns: false,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves:
      X1_OPENING +
      "The seller's node's BOLT11 invoice has this ATR's hash as its payment metadata and x402's request hash as its " +
      "description hash. " +
      UNVERIFIED,
  } satisfies LcpPattern) as LcpPattern,
  claims: true as boolean,
  carrier: "extra.invoice#m" as const,
  unplaced: withoutInvoice,
  tie,
  advertise: lnbtcAdvertise,
  advertiseBeforeCarrier: lnbtcAdvertiseBeforeCarrier,
  read: readFor(filterOf(lnbtcPairs)) as (doc: PaymentRequired) => X402Read | Refusal,
  build: lnbtcBuild,
  bound: lnbtcBound,
  reference: (presented: unknown) => x402Reference(presented, true),
});

// ── x402/exact/lnbtc/invoice-named ──

const NAMED = "x402/exact/lnbtc/invoice-named" as const;
const namedShared = advertiseFor(filterOf(isLnOption));

/** The invoice's checks with `m` forbidden, then the x402 entry point's legal-context placement. */
function namedAdvertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  if (isLnOption(offer)) {
    const b = checkOption(offer, null);
    if (isRefusal(b)) return b;
  }
  return namedShared(doc, h, link, offer, agreementUrl);
}

/**
 * The option unchanged: the invoice carries no hash, so the option as issued is what the ATR names. An option that
 * carries a `refused` member is `x402/option-malformed`.
 */
function namedUnplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/** Pays only an invoice that the ATR's own `x402` slot names. */
async function namedBuild(
  c: { required: PaymentRequired; accepted: PaymentRequirements; atr: Uint8Array },
  h: AtrHash,
): Promise<LnUnsigned | Refusal> {
  if (!isObject(c)) return refusal("x402/not-v2");
  const wrong = chosen(c.required, c.accepted, filterOf(isLnOption));
  if (wrong !== true) return wrong;
  const accepted = c.accepted as PaymentRequirements & { extra: { invoice: string } };
  const b = checkOption(accepted, null);
  if (isRefusal(b)) return b;
  if (!atrNamesInvoice(c.atr, accepted.extra.invoice)) return refusal("ln/invoice-not-named");
  return { request: { kind: "bolt11-pay", invoice: accepted.extra.invoice }, complete: completeFor(c.required, c.accepted) };
}

/**
 * The candidate hash: the echoed legal context's value. The paid invoice carries none; the seller's digest over the option
 * it issued, invoice included, is what ties this payment to the ATR.
 */
async function namedBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isLnOption(accepted)) return refusal("x402/option-not-this-pairing");
  const b = checkOption(accepted, null);
  if (isRefusal(b)) return b;
  const extensions = presented["extensions"];
  const lc = isObject(extensions) ? extensions["legalContext"] : undefined;
  const decoded = isObject(lc) ? fromLegalContext({ legalContext: lc["info"] }) : null;
  return decoded === null ? refusal("ln/no-legal-context") : decoded.h;
}

export const exactLnbtcNamed = Object.freeze({
  id: NAMED,
  pattern: deepFreeze({
    pattern: "http-advisory",
    canonical: true,
    buyerSigns: false,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves:
      X1_OPENING +
      "The ATR names this payment: its binding slot holds the payment option as issued, including the seller node's " +
      "signed BOLT11 invoice, whose description hash is x402's request hash. The invoice does not carry this ATR's " +
      "hash, and the payer signed nothing that does. " +
      REPORT,
  } satisfies LcpPattern) as LcpPattern,
  claims: true as boolean,
  carrier: null,
  unplaced: namedUnplaced,
  tie,
  advertise: namedAdvertise,
  read: readFor(filterOf(namedPairs)) as (doc: PaymentRequired) => X402Read | Refusal,
  build: namedBuild,
  bound: namedBound,
  reference: (presented: unknown) => x402Reference(presented, false),
});

// ── mpp/charge/lightning and mpp/session/lightning ──

type LnMppPairing = typeof LN_CHARGE | typeof LN_SESSION;
const LN_CHARGE = "mpp/charge/lightning" as const;
const LN_SESSION = "mpp/session/lightning" as const;
const MPP_NETWORKS: { readonly [n: string]: Bolt11["currency"] } = { mainnet: "bc", signet: "tbs", regtest: "bcrt" };
const CURRENCY_NETWORK: { readonly [c in Bolt11["currency"]]: string } = {
  bc: "mainnet",
  tb: "testnet",
  tbs: "signet",
  bcrt: "regtest",
};
const OPEN = "open";

export interface LnMppChoice {
  challenge: MppChallenge & { id: string };
  /** session only: the payer's return invoice, a BOLT11 invoice with no amount, which the open action registers. */
  returnInvoice?: string;
}

export interface LnMppUnsigned {
  request: { kind: "bolt11-pay"; invoice: string };
  complete(preimage: string): MppCredential | Refusal;
}

/** Where a pairing's invoice and payment hash sit in the decoded request. */
function lnFields(pairing: LnMppPairing, request: { [k: string]: Json }): { invoice: unknown; paymentHash: unknown } {
  if (pairing === LN_SESSION) return { invoice: request["depositInvoice"], paymentHash: request["paymentHash"] };
  const d = request["methodDetails"];
  return isObject(d) ? { invoice: d["invoice"], paymentHash: d["paymentHash"] } : { invoice: undefined, paymentHash: undefined };
}

/**
 * `ln/currency-network` unless the challenge's `network`, when it names one, is a network MPP Lightning defines whose
 * currency is the invoice's.
 */
function networkRefused(details: { [k: string]: Json }, b: Bolt11): Refusal | null {
  const network = details["network"];
  if (network === undefined) return null;
  const named = typeof network === "string" && Object.hasOwn(MPP_NETWORKS, network);
  return named && MPP_NETWORKS[network] === b.currency ? null : refusal("ln/currency-network");
}

/**
 * The checks of what the seller's node wrote: the invoice decodes, its one `h` is `h`, it has no `d`, the request has
 * no `description`, its payment hash is the request's, its currency is the one the challenge's `network` names, when it
 * names one (a network MPP Lightning defines), and `expires`, when the challenge carries one, is no later than the
 * invoice's own expiry.
 */
function lnChallengeChecks(pairing: LnMppPairing, c: MppChallenge, h: AtrHash, placed: boolean): Bolt11 | Refusal {
  const checked = checkChallenge(c, placed);
  if (isRefusal(checked)) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  const { invoice, paymentHash } = lnFields(pairing, checked.request);
  if (typeof invoice !== "string") return refusal("ln/invoice-malformed");
  const b = decode(invoice);
  if (isRefusal(b)) return b;
  const d = invoiceH(b, "h");
  if (isRefusal(d) || d !== normalHash(h)) return refusal("mpp/carrier-not-challenge");
  if (b.tags.includes(FIELD.d)) return refusal("ln/description-inline");
  if (checked.request["description"] !== undefined) return refusal("ln/description-present");
  if (paymentHash !== hex(b.paymentHash)) return refusal("ln/payment-hash-mismatch");
  const network = networkRefused(checked.details, b);
  if (network !== null) return network;
  if (checked.expires !== undefined && checked.expires > b.timestamp + b.expiry) return refusal("ln/expires-after-invoice");
  return b;
}

/** The challenge without its invoice, `request` re-encoded as base64url of its JCS form. */
function lnUnplaced(pairing: LnMppPairing): (c: MppChallenge) => MppChallenge {
  return (c) => {
    const request = isObject(c) && typeof c.request === "string" ? decodeObject(c.request) : undefined;
    if (request === undefined) return c;
    let rest: { [k: string]: Json };
    if (pairing === LN_SESSION) {
      const { depositInvoice: _, ...r } = request;
      rest = r;
    } else {
      const d = request["methodDetails"];
      if (!isObject(d)) return c;
      const { invoice: _, ...details } = d as { [k: string]: Json };
      rest = { ...request, methodDetails: details };
    }
    const text = canonicalJson(rest);
    return typeof text === "string" ? { ...c, request: b64uEncode(new TextEncoder().encode(text)) } : c;
  };
}

function lnAdvertise(pairing: LnMppPairing) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const b = lnChallengeChecks(pairing, offer, h, false);
    if (isRefusal(b)) return b;
    return place(doc, h, link, offer, agreementUrl);
  };
}

/**
 * The checks `advertise` makes that do not read the invoice: the challenge is one of this pairing, carries its payment
 * hash, has no request `description`, and names, when it names one, a network MPP Lightning defines.
 */
function lnOfferChecks(pairing: LnMppPairing, c: MppChallenge): Refusal | null {
  const checked = checkChallenge(c, false);
  if (isRefusal(checked)) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  if (checked.request["description"] !== undefined) return refusal("ln/description-present");
  const network = checked.details["network"];
  if (network !== undefined) {
    if (typeof network !== "string" || !Object.hasOwn(MPP_NETWORKS, network)) return refusal("ln/currency-network");
  }
  return null;
}

/** `advertise` for the challenge the seller sends before its node writes the invoice; the invoice is not read. */
function lnAdvertiseBeforeCarrier(pairing: LnMppPairing) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const refused = lnOfferChecks(pairing, offer);
    return refused ?? place(doc, h, link, offer, agreementUrl);
  };
}

function lnBuild(pairing: LnMppPairing) {
  return async (choice: LnMppChoice, h: AtrHash): Promise<LnMppUnsigned | Refusal> => {
    if (!isObject(choice) || !isObject(choice.challenge) || typeof choice.challenge.id !== "string") {
      return refusal("mpp/credential-malformed");
    }
    const b = lnChallengeChecks(pairing, choice.challenge, h, true);
    if (isRefusal(b)) return b;
    const returnInvoice = choice.returnInvoice;
    if (pairing === LN_SESSION && !amountless(returnInvoice)) return refusal("ln/return-invoice-malformed");
    const { invoice } = lnFields(pairing, decodeObject(choice.challenge.request)!);
    const challenge = choice.challenge;
    return {
      request: { kind: "bolt11-pay", invoice: invoice as string },
      complete(preimage: string): MppCredential | Refusal {
        if (typeof preimage !== "string" || !PREIMAGE.test(preimage)) return refusal("ln/preimage-malformed");
        if (pairing === LN_CHARGE) return { challenge, payload: { preimage } };
        return { challenge, payload: { action: OPEN, preimage, returnInvoice: returnInvoice as string } };
      },
    };
  };
}

/** Whether `v` is a BOLT11 invoice with no amount in its human-readable part. */
function amountless(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const b = decode(v);
  return !isRefusal(b) && b.amountMsat === null;
}

/**
 * The echoed challenge's hash, held to the invoice the payer paid, whose currency must be the one the challenge's
 * `network` names, when it names one, as `advertise` checks it; a `methodDetails` that is not an object is
 * `mpp/request-malformed`, as `advertise` gives it. On the session, only the open action is the session's payment. No
 * signature is verified here.
 */
async function lnPaid(pairing: LnMppPairing, input: unknown): Promise<{ h: AtrHash; b: Bolt11 } | Refusal> {
  const echoed = echoedFor(input, pairing);
  if (isRefusal(echoed)) return echoed;
  const { invoice, paymentHash } = lnFields(pairing, echoed.checked.request);
  const b = typeof invoice === "string" ? decode(invoice) : refusal("ln/invoice-malformed");
  if (isRefusal(b)) return b;
  const d = invoiceH(b, "h");
  if (isRefusal(d) || d !== echoed.h) return refusal("mpp/carrier-not-challenge");
  if (paymentHash !== hex(b.paymentHash)) return refusal("ln/payment-hash-mismatch");
  const network = networkRefused(echoed.checked.details, b);
  if (network !== null) return network;
  if (pairing === LN_SESSION && echoed.payload["action"] !== OPEN) return refusal("ln/no-payment-in-action");
  return { h: echoed.h, b };
}

function lnBound(pairing: LnMppPairing) {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    const p = await lnPaid(pairing, presented);
    return isRefusal(p) ? p : p.h;
  };
}

/**
 * The read keys: the network of the invoice's currency, which is the network the challenge names when it names one;
 * the invoice's payment hash; and its timestamp plus expiry.
 */
function lnReference(pairing: LnMppPairing) {
  return async (presented: unknown): Promise<LnRef | Refusal> => {
    const p = await lnPaid(pairing, presented);
    if (isRefusal(p)) return p;
    const { b } = p;
    return { network: CURRENCY_NETWORK[b.currency], paymentHash: hex(b.paymentHash), settleBy: b.timestamp + b.expiry };
  };
}

const MPP_LN_PROVES =
  X1_OPENING +
  "The seller's node's BOLT11 invoice's description hash is this ATR's hash, and the ATR commits its payment hash. " +
  UNVERIFIED;

function lnMppBinding<P extends LnMppPairing>(id: P, carrier: string, proves: string = MPP_LN_PROVES) {
  return Object.freeze({
    id,
    pattern: deepFreeze({
      pattern: "native-field",
      canonical: true,
      profile: "mpp/charge",
      buyerSigns: false,
      onChain: false,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
      publicProof: false,
      proves,
    } satisfies LcpPattern) as LcpPattern,
    claims: true as boolean,
    carrier,
    unplaced: lnUnplaced(id),
    tie: mppTie,
    read: mppRead,
    advertise: lnAdvertise(id),
    advertiseBeforeCarrier: lnAdvertiseBeforeCarrier(id),
    build: lnBuild(id),
    bound: lnBound(id),
    reference: lnReference(id),
  });
}

export const chargeLightning = lnMppBinding(LN_CHARGE, "request.methodDetails.invoice#h");
/** The one network name every Lightning session channel key carries: a bearer or close challenge names no invoice. */
const SESSION_CHANNEL_NETWORK = "lightning";
const PAYMENT_HASH = /^[0-9a-fA-F]{64}$/;

/** The session action: open opens the channel, bearer and topUp are within it, close ends it. */
function sessionKind(presented: unknown): "open" | "within" | "close" | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  const a = c.payload["action"];
  if (a === OPEN) return "open";
  if (a === "bearer" || a === "topUp") return "within";
  if (a === "close") return "close";
  return refusal("mpp/session-action");
}

/** The session's id: the open's challenge `paymentHash`, else the payload's `sessionId`, as lowercase hex. */
async function sessionRef(presented: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const k = sessionKind(presented);
  if (isRefusal(k)) return k;
  const c = presented as MppCredential;
  const request = typeof c.challenge.request === "string" ? decodeObject(c.challenge.request) : undefined;
  const id = k === "open" ? request?.["paymentHash"] : c.payload["sessionId"];
  if (typeof id !== "string" || !PAYMENT_HASH.test(id)) return refusal("mpp/credential-malformed");
  return { network: SESSION_CHANNEL_NETWORK, channel: id.toLowerCase() };
}

/** A bearer proof carries no hash; a topUp is within the session and is found by `ref`. */
async function sessionBoundWithin(_presented: unknown): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

const MPP_LN_SESSION_PROVES = MPP_LN_PROVES + " The close is the seller's report.";

export const sessionLightning = Object.freeze({
  ...lnMppBinding(LN_SESSION, "request.depositInvoice#h", MPP_LN_SESSION_PROVES),
  channel: Object.freeze({
    kind: sessionKind,
    ref: sessionRef,
    boundWithin: sessionBoundWithin,
    until: (_presented: unknown): number | undefined => undefined,
  }),
});
