/**
 * BOLT11 invoices and the Lightning pairings. On x402 (`x402/exact/lnbtc/payment-hash`) the ATR commits the option's
 * `extra.paymentHash`, the payment hash of the invoice the seller's node issues after the agreement. On MPP the
 * seller's node writes the ATR hash as the invoice's description hash `h`. The payer signs nothing; it pays the invoice.
 *
 * @module
 */
import { hashEquals, type AtrHash, type Json } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import {
  decode,
  fieldHash,
  hexOf,
  isLnbtc,
  offerChecks,
  optionChecks,
  preimageCheck,
  requestHash,
  SKEW_SECONDS,
  validate,
  type ExactLnbtcValidation,
  type LnbtcRequest,
} from "./internal/lightning.js";
import {
  advertiseFor,
  chosen,
  legalContextOf,
  paymentWith,
  presentedWith,
  readFor,
  sameJson,
  x402Broadcaster,
  type OptionFilter,
  type X402Forms,
  type X402Read,
} from "./internal/x402.js";
import type { Broadcaster } from "./internal/broadcaster.js";
import {
  credentialOf,
  checkChallenge,
  chosenHeld,
  decodeObject,
  echoedFor,
  measured,
  measuring,
  measuringAsync,
  mppBroadcaster,
  place,
  read as mppRead,
  sessionBroadcaster,
  tie as mppTie,
  unplacedChallenge,
  type MppChallenge,
  type MppCredential,
  type MppForms,
} from "./mpp-challenge.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { tie as x402Tie, type LcpPattern, type PaymentRequired, type PaymentRequirements } from "./x402.js";
import { LIGHTNING } from "./internal/data/lightning.js";
import type { Act } from "./internal/read.js";
import type { Entry, NoRead } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { ExactLnbtcReason, ExactLnbtcValidation, LnbtcRequest, LnHeaderFields } from "./internal/lightning.js";

/**
 * x402's `lnbtc` network ids, in CAIP-2 form: `lnbtc:` and the first 32 hex digits of the genesis block hash of
 * Bitcoin mainnet or testnet3. `lnbtc` is x402's own namespace.
 */
export type LnNetwork = "lnbtc:000000000019d6689c085ae165831e93" | "lnbtc:000000000933ea01ad0ee984209779ba";

/**
 * A decoded BOLT11 invoice. `B` is what its bytes are backed by: `decodeBolt11` gives `Bolt11<ArrayBuffer>`, each byte
 * field in its own fresh `ArrayBuffer`, and a function that reads one takes any backing.
 */
export interface Bolt11<B extends ArrayBufferLike = ArrayBufferLike> {
  currency: "bc" | "tb" | "tbs" | "bcrt";
  amountMsat: bigint | null;
  timestamp: number;
  expiry: number;
  paymentHash: Uint8Array<B>;
  descriptionHash: Uint8Array<B> | null;
  /** The `d` field as strict UTF-8, a leading byte-order mark kept as a character; null when the invoice has none. */
  description: string | null;
  metadata: Uint8Array<B> | null;
  /** Every tagged field's type, in invoice order. */
  tags: readonly number[];
  /**
   * The compressed secp256k1 public key that signed the invoice, as 66 lowercase hex digits: the `n` field's key where
   * the invoice has one, and otherwise the key recovered from the signature.
   */
  signer: string;
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

const PREIMAGE = /^[0-9a-f]{64}$/;

/**
 * Decodes a BOLT11 invoice of up to 8,192 characters strictly, past Bech32's 90-character limit, which BOLT 11 lets an
 * invoice exceed: exactly one `p` and one `s` field, at most one `n` field, and a signature that verifies, by the `n`
 * key where the invoice has one (a low `s` required) and otherwise by public-key recovery; `signer` is that key. An
 * invoice that fails is `ln/invoice-malformed`; one of more characters, or of more than 64 tagged fields, is
 * `ln/invoice-too-large`.
 */
export async function decodeBolt11(invoice: string): Promise<Bolt11<ArrayBuffer> | Refusal> {
  return decode(invoice);
}

/** The one 32-byte `h` or `m` field of an invoice, as the hash it carries. */
export function invoiceH(b: Bolt11, field: "h" | "m"): AtrHash | Refusal {
  return fieldHash(b, field);
}

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

// ── x402/exact/lnbtc/payment-hash ──

const LNBTC = "x402/exact/lnbtc/payment-hash" as const;

/** The buyer's choice: the 402 document, the option it pays, its validation time in Unix seconds, and its own request. */
export interface LnChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  now: number;
  /** The request the buyer means to make, from which `build` computes the scheme's request hash. */
  request: LnbtcRequest;
}

/**
 * The option filter: an `exact` option on an `lnbtc` network is served where it carries its invoice and passes the
 * checks of the option and its invoice (`optionChecks`), and refused with their refusal otherwise.
 */
const filter: OptionFilter = (o) => {
  if (!isLnbtc(o)) return undefined;
  const s = optionChecks(o);
  return isRefusal(s) ? s : true;
};

/** The filter of the offer before its invoice: the option's own checks, no `extra.invoice` (`offerChecks`). */
const offerFilter: OptionFilter = (o) => (!isLnbtc(o) ? undefined : (offerChecks(o) ?? true));

/** True when `t` is a non-negative safe integer: a time or an allowance in seconds. */
function isSeconds(t: unknown): t is number {
  return Number.isSafeInteger(t) && (t as number) >= 0;
}

/**
 * The option without `extra.invoice`, the member the seller's node writes after the agreement, so the ATR's slot holds
 * the option with its `extra.paymentHash` and no invoice. An option that carries a `refused` member is
 * `x402/option-malformed`; a value that is not an object, or an option with no invoice, comes back as it is.
 */
function withoutInvoice(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  if (!isObject(option) || !isObject(option.extra) || !Object.hasOwn(option.extra, "invoice")) return option;
  const { invoice: _, ...extra } = option.extra;
  return { ...option, extra };
}

/**
 * What the buyer's node pays, after the scheme's client checks: H is a valid ATR hash (`x402/payload-malformed`);
 * `now` is a non-negative safe integer (`ln/time-malformed`); the option is the document's and passes the filter; H is
 * the document's (`x402/legal-context-conflict`); the
 * request hash computed from `request` is `extra.requestHash` (`requestHash`'s refusals); the invoice's creation time
 * is no later than `now` plus 60 s (`ln/created-in-future`) and its creation time plus its expiry is later than `now`
 * (`ln/invoice-expired`). `complete` takes the preimage the node returned and refuses one that is not 64 lowercase hex
 * digits (`ln/preimage-malformed`) or does not hash to the invoice's `p` (`ln/preimage-mismatch`).
 */
async function lnbtcBuild(c: LnChoice, h: AtrHash): Promise<LnUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/not-v2");
  if (!isSeconds(c.now)) return refusal("ln/time-malformed");
  const ok = chosen(c.required, c.accepted, filter);
  if (ok !== true) return ok;
  const lc = legalContextOf(c.required.extensions);
  if (isRefusal(lc)) return lc;
  if (lc.h !== nh) return refusal("x402/legal-context-conflict");
  const accepted = c.accepted;
  const s = optionChecks(accepted) as Bolt11;
  const extra = accepted.extra as { [k: string]: Json };
  const want = requestHash(extra["requestBindingProfile"], extra["requestBindingParams"], c.request, c.required.resource?.url);
  if (isRefusal(want)) return want;
  if (want !== extra["requestHash"]) return refusal("ln/request-hash-mismatch");
  if (s.timestamp > c.now + SKEW_SECONDS) return refusal("ln/created-in-future");
  if (s.timestamp + s.expiry <= c.now) return refusal("ln/invoice-expired");
  const paymentHash = hexOf(s.paymentHash);
  return {
    request: { kind: "bolt11-pay", invoice: extra["invoice"] as string },
    complete(preimage: string): LnPaymentPayload | Refusal {
      const checked = preimageCheck(preimage, paymentHash);
      return isRefusal(checked) ? checked : paymentWith(c.required, accepted, { preimage });
    },
  };
}

/**
 * The payment presented, held to the filter, with the invoice it accepted decoded and its preimage checked: the
 * preimage is 64 lowercase hex digits (`ln/preimage-malformed`) whose SHA-256 is the invoice's `p`
 * (`ln/preimage-mismatch`), which the filter holds equal to the echoed `extra.paymentHash`.
 */
function paid(presented: unknown): { accepted: PaymentRequirements; extensions: unknown; s: Bolt11 } | Refusal {
  const p = presentedWith(presented, filter);
  if (isRefusal(p)) return p;
  const s = optionChecks(p.accepted) as Bolt11;
  const checked = preimageCheck(p.payload["preimage"], hexOf(s.paymentHash));
  return isRefusal(checked) ? checked : { accepted: p.accepted, extensions: p.extensions, s };
}

/**
 * The H the payment's echoed `extensions.legalContext` names, once `paid` holds: the echoed H only locates the sale,
 * whose ATR commits the echoed `extra.paymentHash`. No ledger is read.
 */
async function lnbtcBound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = paid(presented);
  if (isRefusal(p)) return p;
  const lc = legalContextOf(p.extensions);
  return isRefusal(lc) ? lc : lc.h;
}

/**
 * The payment's keys: the option's network, the invoice's payment hash, and the latest time the scheme accepts its
 * proof, the invoice's creation time plus its expiry plus 60 s. A payment whose `accepted`, without its invoice, is not
 * `option` without its invoice is `x402/accepted-not-option`.
 */
async function lnbtcReference(presented: unknown, option: PaymentRequirements): Promise<LnRef | Refusal> {
  const p = paid(presented);
  if (isRefusal(p)) return p;
  if (!isObject(option) || !sameJson(withoutInvoice(p.accepted), withoutInvoice(option))) return refusal("x402/accepted-not-option");
  const b = p.s;
  return { network: p.accepted.network, paymentHash: hexOf(b.paymentHash), settleBy: b.timestamp + b.expiry + SKEW_SECONDS };
}

/**
 * `x402/exact/lnbtc/payment-hash`. The payer broadcasts (`broadcaster` answers `"payer"`): its node pays the invoice
 * before the preimage is presented. No ledger shows the payment, and no `status` reads it. `advertiseBeforeCarrier`
 * places the offer the seller issues before its node writes the invoice; `advertise` the option with the invoice.
 */
export const exactLnbtcPaymentHash = Object.freeze({
  id: LNBTC,
  data: LIGHTNING[LNBTC],
  pattern: deepFreeze({
    pattern: "native-field",
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  } satisfies LcpPattern) as LcpPattern,
  claims: true as boolean,
  unplaced: withoutInvoice,
  tie: x402Tie,
  advertise: advertiseFor(filter),
  advertiseBeforeCarrier: advertiseFor(offerFilter),
  read: (doc: PaymentRequired): X402Read | Refusal => readFor(filter)(doc),
  build: lnbtcBuild,
  bound: lnbtcBound,
  broadcaster: x402Broadcaster("payer"),
  reference: lnbtcReference,
}) satisfies Entry<
  typeof LNBTC,
  LnPaymentPayload,
  LnRef,
  never,
  X402Forms & NoRead & { choice: LnChoice; unsigned: LnUnsigned }
>;

/**
 * The preimage check: `true` where `preimage` is 64 lowercase hex digits whose SHA-256 is `paymentHash`, itself 64
 * lowercase hex digits; else `ln/preimage-malformed`, `ln/payment-hash-required` or `ln/preimage-mismatch`, in that
 * order. A resource server makes it before it serves a Lightning payment.
 */
export function checkPreimage(preimage: string, paymentHash: string): true | Refusal {
  return preimageCheck(preimage, paymentHash);
}

/**
 * x402's validation of `exact` on `lnbtc` (the scheme's Facilitator Validation, checks 1 to 7 and its Paid-but-expired
 * Policy), in the scheme's order, with this form's one check added at the end of check 5: the accepted invoice's `p`
 * is `requirements.extra.paymentHash` (`invalid_exact_lnbtc_invoice_payment_hash_mismatch`). `payload` is the payment
 * presented; `requirements` the ones the resource server built from its own record of the sale; `now` the validation
 * time and `skew` the clock-skew allowance, in seconds, 60 by default. A failure answers the scheme's `errorReason`; a
 * success answers the network and the payment hash of the scheme's consumption key. It moves nothing, reads nothing,
 * and records nothing: the resource server or a settler records the key once after it. A `now` or `skew` that is not a
 * non-negative safe integer is `ln/time-malformed`.
 */
export function validateExactLnbtc(
  payload: unknown,
  requirements: unknown,
  at: { now: number; skew?: number },
): ExactLnbtcValidation | Refusal {
  const skew = isObject(at) ? (at.skew ?? SKEW_SECONDS) : undefined;
  if (!isObject(at) || !isSeconds(at.now) || !isSeconds(skew)) return refusal("ln/time-malformed");
  return validate(payload, requirements, at.now, skew);
}

// ── mpp/charge/lightning and mpp/session/lightning ──

type LnMppPairingId = typeof LN_CHARGE | typeof LN_SESSION;
const LN_CHARGE = "mpp/charge/lightning" as const;
const LN_SESSION = "mpp/session/lightning" as const;
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
  /**
   * The credential for the paid invoice's preimage. A credential over the credential size bound, 64 KiB, its echoed
   * challenge included, is `mpp/credential-malformed`, as `bound` refuses it, and is read first; a preimage that is not
   * 64 lowercase hex digits is `ln/preimage-malformed`.
   */
  complete(preimage: string): MppCredential | Refusal;
}

/** A pairing's invoice in the decoded request: `methodDetails.invoice` on the charge, `depositInvoice` on the session. */
function lnInvoice(pairing: LnMppPairingId, request: { [k: string]: Json }): unknown {
  if (pairing === LN_SESSION) return request["depositInvoice"];
  const d = request["methodDetails"];
  return isObject(d) ? d["invoice"] : undefined;
}

/**
 * The checks of what the seller's node wrote: the challenge offers the pairing, which holds the invoice to `pairingsOf`'s
 * Lightning checks (it decodes, has one `h` and no `d`, carries the request's payment hash, is on the network the
 * challenge names, and expires no earlier than the challenge), and the invoice's `h` is `h`.
 */
function lnChallengeChecks(pairing: LnMppPairingId, c: MppChallenge, h: AtrHash, placed: boolean): Bolt11 | Refusal {
  const checked = checkChallenge(c, placed);
  if (isRefusal(checked)) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  const invoice = lnInvoice(pairing, checked.request);
  if (typeof invoice !== "string") return refusal("ln/invoice-malformed");
  const b = decode(invoice);
  if (isRefusal(b)) return b;
  const d = invoiceH(b, "h");
  if (isRefusal(d) || d !== normalHash(h)) return refusal("mpp/carrier-not-challenge");
  return b;
}

/**
 * The challenge without its invoice, as `unplacedChallenge` gives it. A challenge that carries a `refused` member is
 * `mpp/challenge-malformed`; a value that is not an object comes back as it is.
 */
function lnUnplaced(c: MppChallenge): MppChallenge | Refusal {
  if (isObject(c) && carriesRefused(c)) return refusal("mpp/challenge-malformed");
  return unplacedChallenge(c);
}

function lnAdvertise(pairing: LnMppPairingId) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    position: number | null,
    act?: Act,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const b = lnChallengeChecks(pairing, offer, h, false);
    if (isRefusal(b)) return b;
    return place(doc, h, link, offer, position, act, agreementUrl);
  };
}

/**
 * `advertise` for the challenge the seller sends before its node writes the invoice: `pairingsOf` names the pairing
 * for it (the challenge carries its payment hash, has no request `description`, and names, when it names one, a network
 * MPP Lightning defines), and its invoice, which the node writes after `place`, is not compared with H.
 */
function lnAdvertiseBeforeCarrier(pairing: LnMppPairingId) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    position: number | null,
    act?: Act,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const checked = checkChallenge(offer, false);
    if (isRefusal(checked)) return checked;
    if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
    return place(doc, h, link, offer, position, act, agreementUrl);
  };
}

/**
 * The payment of the chosen challenge's invoice. A choice that is not an object is `mpp/credential-malformed`. The
 * challenge is held as `bound` holds an echoed one, with `bound`'s code for each fault, in `bound`'s order
 * (`chosenHeld`), then its invoice as `bound` reads it (`lnChallengeChecks`), whose `h` must be the hash the
 * challenge's id derives from (`mpp/carrier-not-challenge`); an id that derives from a hash other than `h` is then
 * `mpp/id-not-ours`. The challenge is read from the snapshot `chosenHeld` returns, which the credential carries.
 */
function lnBuild(pairing: LnMppPairingId) {
  return async (choice: LnMppChoice, h: AtrHash): Promise<LnMppUnsigned | Refusal> => {
    if (!isObject(choice)) return refusal("mpp/credential-malformed");
    const held = chosenHeld(choice.challenge, pairing);
    if (isRefusal(held)) return held;
    const challenge = held.checked.challenge;
    const b = lnChallengeChecks(pairing, challenge, held.h, true);
    if (isRefusal(b)) return b;
    if (typeof h !== "string" || !hashEquals(held.h, h)) return refusal("mpp/id-not-ours");
    const returnInvoice = choice.returnInvoice;
    if (pairing === LN_SESSION && !amountless(returnInvoice)) return refusal("ln/return-invoice-malformed");
    const invoice = lnInvoice(pairing, held.checked.request);
    return {
      request: { kind: "bolt11-pay", invoice: invoice as string },
      complete(preimage: string): MppCredential | Refusal {
        const credential = measured(
          pairing === LN_CHARGE
            ? { challenge, payload: { preimage } }
            : { challenge, payload: { action: OPEN, preimage, returnInvoice: returnInvoice as string } },
        );
        if (isRefusal(credential)) return credential;
        return typeof preimage === "string" && PREIMAGE.test(preimage) ? credential : refusal("ln/preimage-malformed");
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
 * The echoed challenge's hash, held to the invoice the payer paid: the echoed challenge is held to the pairing's filter
 * (`echoedFor`), which checks the invoice as `build` does, and the invoice's `h` is the hash the challenge's id derives
 * from. On the session, only the open action is the session's payment.
 */
async function lnPaid(pairing: LnMppPairingId, input: unknown): Promise<{ h: AtrHash; b: Bolt11 } | Refusal> {
  const echoed = echoedFor(input, pairing);
  if (isRefusal(echoed)) return echoed;
  const invoice = lnInvoice(pairing, echoed.checked.request);
  const b = decode(invoice as string);
  if (isRefusal(b)) return b;
  const d = invoiceH(b, "h");
  if (isRefusal(d) || d !== echoed.h) return refusal("mpp/carrier-not-challenge");
  if (pairing === LN_SESSION && echoed.payload["action"] !== OPEN) return refusal("ln/no-payment-in-action");
  return { h: echoed.h, b };
}

function lnBound(pairing: LnMppPairingId) {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    const p = await lnPaid(pairing, presented);
    return isRefusal(p) ? p : p.h;
  };
}

/**
 * The read keys: the network of the invoice's currency, which is the network the challenge names when it names one;
 * the invoice's payment hash; and its timestamp plus expiry. The echoed challenge is held to the pairing's filter, as
 * `bound` holds it.
 */
function lnReference(pairing: LnMppPairingId) {
  return async (presented: unknown): Promise<LnRef | Refusal> => {
    const p = await lnPaid(pairing, presented);
    if (isRefusal(p)) return p;
    const { b } = p;
    return { network: CURRENCY_NETWORK[b.currency], paymentHash: hex(b.paymentHash), settleBy: b.timestamp + b.expiry };
  };
}

function lnMppBinding<P extends LnMppPairingId>(id: P) {
  return Object.freeze({
    id,
    data: LIGHTNING[id],
    pattern: deepFreeze({
      pattern: "native-field",
      profile: "mpp/charge",
      onChain: false,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
    } satisfies LcpPattern) as LcpPattern,
    claims: true as boolean,
    unplaced: lnUnplaced,
    tie: mppTie,
    read: mppRead,
    advertise: lnAdvertise(id),
    advertiseBeforeCarrier: lnAdvertiseBeforeCarrier(id),
    build: lnBuild(id),
    bound: lnBound(id),
    broadcaster: mppBroadcaster(() => "payer"),
    reference: lnReference(id),
  });
}

/**
 * `mpp/charge/lightning`. The payer broadcasts (`broadcaster` answers `"payer"`): its node pays the invoice before the
 * preimage is presented. The seller's node, which received the payment, confirms it; `reference` names the invoice,
 * and no `status` reads it.
 */
export const chargeLightning = lnMppBinding(LN_CHARGE) satisfies Entry<
  typeof LN_CHARGE,
  MppCredential,
  LnRef,
  never,
  MppForms & NoRead & { choice: LnMppChoice; unsigned: LnMppUnsigned }
>;
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

/**
 * The session's id: the open's challenge `paymentHash`, else the payload's `sessionId`, as lowercase hex. The open is
 * held as `bound` holds it (`echoedFor`), whose refusal it gives: H from the echoed challenge's id, the challenge's
 * intent and method, which must be the session's, and the pairing's filter. A bearer, top-up or close payment is read
 * from its payload alone.
 */
async function sessionRef(presented: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const k = sessionKind(presented);
  if (isRefusal(k)) return k;
  const c = presented as MppCredential;
  if (k === "open") {
    const held = echoedFor(c, LN_SESSION);
    if (isRefusal(held)) return held;
  }
  const request = typeof c.challenge.request === "string" ? decodeObject(c.challenge.request) : undefined;
  const id = k === "open" ? request?.["paymentHash"] : c.payload["sessionId"];
  if (typeof id !== "string" || !PAYMENT_HASH.test(id)) return refusal("mpp/credential-malformed");
  return { network: SESSION_CHANNEL_NETWORK, channel: id.toLowerCase() };
}

/**
 * Who sends a Lightning session payment, by its action, as draft-lightning-session-00 has it: the payer's node the
 * deposit an opening presents the preimage of, and a top-up's new deposit; a bearer proof moves nothing, and draws on
 * the deposit the payer sent; the seller's node the close's refund of the unspent balance to the return invoice. Any
 * other action is `ln/no-payment-in-action`, as `bound` refuses it.
 */
function sessionBroadcasts(credential: MppCredential): Broadcaster | Refusal {
  const a = credential.payload["action"];
  if (a === OPEN || a === "bearer" || a === "topUp") return "payer";
  return a === "close" ? "payee" : refusal("ln/no-payment-in-action");
}

/** A bearer proof carries no hash; a topUp is within the session and is found by `ref`. */
async function sessionBoundWithin(_presented: unknown): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

/**
 * `mpp/session/lightning`. `broadcaster` answers by the payment's action (`sessionBroadcasts`), for the actions
 * `channel.kind` takes. `"payer"`: the opening and a top-up, whose deposits the payer's node paid, and a bearer proof,
 * which draws on them; the seller's node, which received each deposit, confirms it, and no `status` reads it.
 * `"payee"`: the close, whose refund the seller's node pays. Any other action gets `ln/no-payment-in-action`, as `bound`
 * refuses it.
 */
export const sessionLightning = Object.freeze({
  ...lnMppBinding(LN_SESSION),
  broadcaster: sessionBroadcaster(sessionKind, sessionBroadcasts, () => refusal("ln/no-payment-in-action")),
  channel: Object.freeze({
    kind: measuring(sessionKind),
    ref: measuringAsync(sessionRef),
    boundWithin: measuringAsync(sessionBoundWithin),
    until: (_presented: unknown): number | undefined => undefined,
  }),
}) satisfies Entry<
  typeof LN_SESSION,
  MppCredential,
  LnRef,
  never,
  MppForms & NoRead & { choice: LnMppChoice; unsigned: LnMppUnsigned }
>;
