/**
 * AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the
 * `legalContext` member of the merchant-signed `checkout_jwt` payload, committed to by the buyer's closed Checkout
 * Mandate through `checkout_hash`, and read back from the checkout JWT presented beside the mandate. The mandate is
 * presented alone, or last in AP2's chain after the open mandate. In AP2's push funding, where the payer's side sends
 * the funds, the presentation also carries the confirmation of funds sent, `payment_receipt`. Nothing here verifies a
 * signature, a `cnf` delegation or a link between hops.
 *
 * @module
 */
import {
  canonicalJson,
  digestJson,
  fromLegalContext,
  hashEquals,
  isHttpsLink,
  toLegalContext,
  type AtrHash,
  type Json,
} from "./core.js";
import { chainIdOf, deepFreeze, isAddress, jsonBytes, normalHash, sameJson } from "./fields.js";
import type { LcpPattern } from "./index.js";
import { AGREEMENT_URL, agreementIn, agreementUrlFault } from "./internal/agreement.js";
import { broadcasterOf, broadcastsWithin, type Broadcaster } from "./internal/broadcaster.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  decodeJsonSegment,
  disclosureDigest,
  isJsonObject,
  jwsSegments,
  readSdJwt,
  withinDepth,
  type SdJwt,
  type SdJwtRefusals,
} from "./sd-jwt.js";
import { MAX_LINK_LENGTH } from "./internal/bounds.js";
import { keccak, type Hex } from "./evm-abi.js";
import {
  AUTHORIZATION_USED_TOPIC,
  TRANSFER_TOPIC,
  authorizationIdDigest,
  type Eip155,
  type EvmQuery,
  type EvmReader,
  type EvmRef,
  type EvmStatus,
  type PullAuthorization,
  type TransferLog,
} from "./internal/evm.js";
import { carriedEip3009Read, type Eip3009Ref } from "./internal/evm-x402-reads.js";
import { CARD } from "./internal/data/card.js";
import type { Entry, NoRead } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";

export const CHECKOUT_VCT = "mandate.checkout.1";
/** The `vct` of AP2's closed Payment Mandate. */
const PAYMENT_VCT = "mandate.payment.1";

/** A compact JWS: three base64url segments joined by ".". */
export type Jws = string;
/** The `checkout_jwt` payload: the commerce object. */
export type Payload = { [k: string]: Json };
/** The checkout's own `id`, 1–256 characters. */
export type CheckoutOption = { checkout: string };
/**
 * The offer `read` gives, and the buyer's input to `build`: the merchant's `checkout_jwt` (`checkoutJwt`), its decoded
 * payload, and the checkout's own `id` (`checkout`).
 */
export interface Ap2Offer {
  checkoutJwt: Jws;
  payload: Payload;
  checkout: string;
}
export interface Presented {
  /**
   * The closed Checkout Mandate as presented: one SD-JWT, or AP2's chain of the open mandate's SD-JWT and the closed
   * mandate's, joined by `~~`.
   */
  checkout_mandate: string;
  /**
   * The checkout JWT presented beside the mandate. For AP2's latest-checkout check, the seller passes the one it last
   * sent for this checkout; the buyer's copy shows only that the mandate and that JWT agree.
   */
  checkout_jwt: Jws;
  /**
   * Present only in AP2's push funding, where the payment method pushes funds to the merchant and the merchant receives
   * confirmation of funds sent instead of a payment credential: that confirmation, AP2's Payment Receipt as the payer's
   * side gives it, a JSON object carried whole and read by nothing here. Absent where the merchant initiates the charge.
   */
  payment_receipt?: { [k: string]: Json };
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
const MAX_HOPS = 2;
const MAX_ID = 256;
const CHECKOUT_HASH = /^[A-Za-z0-9_-]{43}$/;
const MANDATE_REFUSALS: SdJwtRefusals = {
  malformed: () => refusal("ap2/mandate-malformed"),
  sdAlgUnsupported: () => refusal("ap2/sd-alg-unsupported"),
  unreferenced: () => refusal("ap2/disclosure-unreferenced"),
  tooLarge: () => refusal("ap2/too-large"),
};
const PAYMENT_REFUSALS: SdJwtRefusals = { ...MANDATE_REFUSALS, malformed: () => refusal("ap2/payment-malformed") };


/**
 * The payload of a compact JWS, decoded as one JSON object. Each segment is base64url without padding in its canonical
 * form (RFC 7515 §2, RFC 4648 §3.5); a JWS with a segment in another form is `ap2/jws-malformed`. The signature is
 * never verified.
 */
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
 * The SD-JWT that holds the closed Checkout Mandate. A presentation without `~~` is that SD-JWT. AP2's chained
 * presentation joins the open mandate's SD-JWT and the closed mandate's with `~~`, in the compact serialization of
 * the Delegate SD-JWT draft: every hop before the last is an SD-JWT written without its trailing `~`, and the hop after
 * it stands in its Key Binding JWT's place. A chain has at most two hops, as AP2's checkout chain does. Every hop must
 * read as an SD-JWT presentation; only the last is returned. No hop's signature, `cnf` key, `sd_hash` or
 * `issuer_jwt_hash` is verified.
 */
async function closedHop(m: unknown, refusals: SdJwtRefusals = MANDATE_REFUSALS): Promise<SdJwt | Refusal> {
  if (typeof m !== "string") return refusals.malformed();
  if (m.length > MIB) return refusal("ap2/too-large");
  const hops = m.split("~~", MAX_HOPS + 1);
  if (hops.length > MAX_HOPS) return refusals.malformed();
  for (const hop of hops.slice(0, -1)) {
    const open = await readSdJwt(`${hop}~`, refusals);
    if (isRefusal(open)) return open;
  }
  return readSdJwt(hops[hops.length - 1], refusals);
}

/** Every object, at any depth of a resolved SD-JWT payload, whose `vct` is the one given. */
function objectsOf(resolved: Json, vct: string): { [k: string]: Json }[] {
  const found: { [k: string]: Json }[] = [];
  const walk = (v: Json): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v as readonly Json[]) walk(x);
      return;
    }
    const o = v as { [k: string]: Json };
    if (o["vct"] === vct) found.push(o);
    for (const x of Object.values(o)) walk(x);
  };
  walk(resolved);
  return found;
}

/**
 * The closed Checkout Mandate in a presentation, one SD-JWT or AP2's chain of the open and closed mandates joined by
 * `~~` (at most these two hops, each an SD-JWT): exactly one resolved object of the last SD-JWT whose `vct` is
 * `mandate.checkout.1`, its `checkout_hash`, and its `checkout_jwt` when disclosed. No signature is verified, nor the
 * open mandate's `cnf` delegation to the closed mandate's signer, nor the closed mandate's `sd_hash` or
 * `issuer_jwt_hash` link to the open one; the open mandate's constraints are not read. Each segment of each hop's
 * issuer-signed JWT and each disclosure is base64url without padding in its canonical form (RFC 4648 §3.5), or the
 * mandate is `ap2/mandate-malformed`; the last hop's Key Binding JWT is not read. A hop whose payload, with each
 * disclosed value where its reference sits, nests more than 64 levels is `ap2/too-large`.
 */
export async function readMandate(m: unknown): Promise<MandateContent | Refusal> {
  const sd = await closedHop(m);
  if (isRefusal(sd)) return sd;
  const found = objectsOf(sd.resolved, CHECKOUT_VCT);
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
 * The shape gate `bound` applies first: a JSON object, else `ap2/mandate-malformed`; and a `payment_receipt`, where
 * present, a JSON object, else `ap2/receipt-malformed`.
 */
function mandateShape(p: unknown): true | Refusal {
  if (!isJsonObject(p)) return refusal("ap2/mandate-malformed");
  const receipt = p["payment_receipt"];
  return receipt === undefined || isJsonObject(receipt) ? true : refusal("ap2/receipt-malformed");
}

/**
 * Who sends the payment of a presentation within `bound`'s shape gate: its payer's side in push funding, where the
 * presentation carries the confirmation of funds sent, `payment_receipt`; the merchant's processor otherwise.
 */
function whoSends(p: unknown): Broadcaster | Refusal {
  const shaped = mandateShape(p);
  if (isRefusal(shaped)) return shaped;
  return (p as Record<string, unknown>)["payment_receipt"] === undefined ? "payee" : "payer";
}

/**
 * AP2's merchant check: the mandate's `checkout_hash` is the hash of the presented `checkout_jwt`, and a disclosed
 * `checkout_jwt` is that JWT. Returns that JWT's payload. It checks that the mandate commits to the latest checkout
 * when the seller presents the `checkout_jwt` it last sent for this checkout; with the buyer's copy, it checks only
 * that the mandate and that JWT agree.
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
 * after the link when `agreementUrl` is given. The seller's stack signs the result as its `checkout_jwt`. A payload
 * that carries a `refused` member is `ap2/jws-malformed`, before any other check.
 */
function advertise(
  payload: Payload,
  h: AtrHash,
  link: string,
  offer: CheckoutOption,
  agreementUrl?: string,
): Payload | Refusal {
  if (isJsonObject(payload) && carriesRefused(payload)) return refusal("ap2/jws-malformed");
  if (!isOption(offer)) return refusal("ap2/option-malformed");
  if (!isJsonObject(payload)) return refusal("ap2/jws-malformed");
  const id = payload["id"];
  if (typeof id !== "string" || id.length === 0) return refusal("ap2/checkout-id-missing");
  if (id.length > MAX_ID) return refusal("ap2/too-large");
  if (id !== offer.checkout) return refusal("ap2/option-not-this-checkout");
  if (!isHttpsLink(link)) return refusal("ap2/link-not-https");
  if (link.length > MAX_LINK_LENGTH) return refusal("ap2/too-large");
  const agreementFaulted = agreementUrlFault(agreementUrl);
  if (agreementFaulted?.fault === "link-not-https") return refusal("ap2/link-not-https");
  if (agreementFaulted !== undefined) return refusal("ap2/legal-context-malformed");
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
  if (typeof agreement === "object") return refusal("ap2/legal-context-malformed");
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
  if (lc === null) return refusal("ap2/legal-context-malformed");
  if (lc.url.length > MAX_LINK_LENGTH) return refusal("ap2/too-large");
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

/**
 * The hash in the checkout the buyer's closed mandate commits to, lowercase, the mandate presented alone or last in
 * AP2's chain. No signature, `cnf` delegation or link between hops is verified.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const shaped = mandateShape(presented);
  if (isRefusal(shaped)) return shaped;
  const b = await checkoutBinding(presented);
  if (isRefusal(b)) return b;
  if (!Object.hasOwn(b.payload, "legalContext")) return refusal("ap2/no-legal-context");
  const lc = fromLegalContext(b.payload);
  if (lc === null) return refusal("ap2/legal-context-malformed");
  if (lc.url.length > MAX_LINK_LENGTH) return refusal("ap2/too-large");
  return lc.h;
}

/**
 * The option unchanged: on this pairing the hash rides in the checkout payload, not in the option. An option that
 * carries a `refused` member is `ap2/option-malformed`.
 */
function unplaced(option: CheckoutOption): CheckoutOption | Refusal {
  if (isJsonObject(option) && carriesRefused(option)) return refusal("ap2/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "opaque-challenge",
  profile: ID,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/** The AP2 pairing's family descriptor. No public ledger records the payment, so nothing is read back. */
type Ap2Family = NoRead & {
  doc: Jws;
  offered: { h: AtrHash; link: string; agreement?: string; offer: Ap2Offer };
  placedIn: Payload;
  offer: CheckoutOption;
  rest: [agreementUrl?: string];
  advertised: Payload;
  choice: Ap2Offer;
  unsigned: Unsigned;
  option: never;
};

/**
 * `ap2/checkout-mandate`. Where the merchant initiates the charge, the payee broadcasts (`broadcaster` answers
 * `"payee"`): the seller's payment processor executes the payment the closed Checkout Mandate authorizes. In AP2's
 * push funding the presentation carries `payment_receipt` and the payer broadcasts (`"payer"`): its side sent the funds
 * before the merchant saw them. Nothing here reads the payment. A value outside `bound`'s shape gate gets the refusal
 * `bound` gives it.
 */
export const checkoutMandate = Object.freeze({
  id: ID,
  data: CARD[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: broadcasterOf(whoSends),
}) satisfies Entry<typeof ID, Presented, never, never, Ap2Family>;

function isOption(o: unknown): o is CheckoutOption {
  if (!isJsonObject(o)) return false;
  const keys = Object.keys(o);
  const c = o["checkout"];
  return keys.length === 1 && typeof c === "string" && c.length >= 1 && c.length <= MAX_ID;
}


// ── ap2/checkout-mandate/x402: the checkout paid with AP2's x402 payment credential ──

/**
 * AP2's x402 payment method, as the merchant names it in the checkout's `accepted_payment_methods`, with the token the
 * authorization moves, which AP2's method does not name.
 */
export interface X402Method {
  type: "x402";
  /** The account the payment pays. */
  address: string;
  /** The network: an `eip155:<chain id>` CAIP-2 id, or an x402 v1 EVM network name as AP2 writes it (`base-sepolia`). */
  network: string;
  /**
   * The token under whose EIP-712 domain the authorization is signed, a 20-byte address: the merchant's own
   * configuration of the method, as x402's option names it `asset`.
   */
  asset: string;
  [k: string]: Json;
}
/** The EIP-3009 `TransferWithAuthorization` AP2's x402 credential carries, its numbers as decimal strings. */
export interface X402Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  /** keccak-256 of the payment mandate chain's UTF-8 text, as 64 hex digits, with or without `0x`. */
  nonce: string;
}
/** AP2's x402 payment credential: the payment mandate chain, its nonce, and the signed EIP-3009 authorization. */
export interface X402Bundle {
  payment_mandate_chain: string;
  payment_nonce: string;
  eip_3009_payload: { signature: string; authorization: X402Authorization };
}
/** The checkout mandate as `ap2/checkout-mandate` takes it, with the x402 credential the merchant received. */
export interface X402Presented extends Presented {
  payment: X402Bundle;
}
/**
 * The read keys of the x402 credential: the keys of `x402/exact/eip155/eip3009`'s reference, the authorization's own
 * nonce standing where that pairing's reference has H, so that the carried pairing's `status` reads the payment; and
 * the authorization's members as presented. The authorization's `nonce` is its single-use value.
 */
export type X402Ref = Eip3009Ref &
  Omit<EvmRef, "network" | "payee" | "transaction"> & {
  idDigest: Hex;
  transferLog: TransferLog;
  authorization: PullAuthorization;
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

const X402_ID = "ap2/checkout-mandate/x402" as const;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NONCE = /^(0x)?[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;
const HEX = /^(0x)?[0-9a-fA-F]*$/;
const MAX_SIGNATURE = 8192;
const MAX_NETWORK = 128;
const AUTHORIZATION_MEMBERS = ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const;

/**
 * AP2's x402 credential, as its reference credential provider writes it: a payment mandate chain of at most 1 MiB, a
 * payment nonce, and an EIP-3009 authorization of exactly six members, two addresses, three decimal integers and a
 * 32-byte nonce, with a hex signature.
 */
function bundleOf(b: unknown): X402Bundle | Refusal {
  if (!isJsonObject(b)) return refusal("ap2/payment-malformed");
  const chain = b["payment_mandate_chain"];
  const paymentNonce = b["payment_nonce"];
  const eip = b["eip_3009_payload"];
  if (typeof chain === "string" && chain.length > MIB) return refusal("ap2/too-large");
  if (typeof chain !== "string" || chain.length === 0 || typeof paymentNonce !== "string") return refusal("ap2/payment-malformed");
  if (!isJsonObject(eip)) return refusal("ap2/payment-malformed");
  const signature = eip["signature"];
  const a = eip["authorization"];
  if (typeof signature !== "string" || signature.length > MAX_SIGNATURE || !HEX.test(signature)) {
    return refusal("ap2/payment-malformed");
  }
  if (!isJsonObject(a) || Object.keys(a).length !== AUTHORIZATION_MEMBERS.length) return refusal("ap2/payment-malformed");
  for (const k of AUTHORIZATION_MEMBERS) if (typeof a[k] !== "string") return refusal("ap2/payment-malformed");
  const auth = a as unknown as X402Authorization;
  if (!ADDRESS.test(auth.from) || !ADDRESS.test(auth.to) || !NONCE.test(auth.nonce)) return refusal("ap2/payment-malformed");
  if (!UINT.test(auth.value) || !UINT.test(auth.validAfter) || !UINT.test(auth.validBefore)) {
    return refusal("ap2/payment-malformed");
  }
  return b as unknown as X402Bundle;
}

/** The 32 bytes of a nonce of 64 hex digits, with or without `0x`. */
function nonceBytes(n: string): Uint8Array {
  const hex = n.startsWith("0x") ? n.slice(2) : n;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/**
 * The `transaction_id` of the closed Payment Mandate in AP2's payment mandate chain, read as the checkout mandate is
 * (the chain's last hop, its disclosures resolved): exactly one object whose `vct` is `mandate.payment.1`. A chain
 * that is not an SD-JWT presentation of at most two hops is `ap2/payment-malformed`, as is one with two such objects;
 * one with none, or whose closed mandate names no `transaction_id` string, binds no checkout, `ap2/payment-not-bound`.
 */
async function transactionIdOf(chain: string): Promise<string | Refusal> {
  const sd = await closedHop(chain, PAYMENT_REFUSALS);
  if (isRefusal(sd)) return sd;
  const found = objectsOf(sd.resolved, PAYMENT_VCT);
  if (found.length > 1) return refusal("ap2/payment-malformed");
  const id = found[0]?.["transaction_id"];
  return typeof id === "string" ? id : refusal("ap2/payment-not-bound");
}

/**
 * The hash in the checkout the buyer's closed mandate commits to, as `ap2/checkout-mandate` reads it, once the x402
 * credential is bound to this checkout: the authorization's `nonce` is keccak-256 of the payment mandate chain's UTF-8
 * text, compared as 32 bytes, as AP2's payment processor checks it; and the chain's closed Payment Mandate names this
 * checkout, its `transaction_id` equal to the checkout mandate's `checkout_hash`, both the base64url hash of the
 * `checkout_jwt` (AP2 binds the payment mandate to its checkout so). Either failing is `ap2/payment-not-bound`. No
 * signature is verified.
 */
async function boundX402(presented: unknown): Promise<AtrHash | Refusal> {
  const h = await bound(presented);
  if (isRefusal(h)) return h;
  const p = presented as Record<string, unknown>;
  const b = bundleOf(p["payment"]);
  if (isRefusal(b)) return b;
  const expected = keccak(b.payment_mandate_chain);
  const given = nonceBytes(b.eip_3009_payload.authorization.nonce);
  if (!expected.every((v, i) => v === given[i])) return refusal("ap2/payment-not-bound");
  const transactionId = await transactionIdOf(b.payment_mandate_chain);
  if (isRefusal(transactionId)) return transactionId;
  const mandate = await readMandate(p["checkout_mandate"]);
  if (isRefusal(mandate)) return mandate;
  if (transactionId !== mandate.checkout_hash) return refusal("ap2/payment-not-bound");
  return h;
}

/**
 * x402's v1 EVM network names and their chain ids, as `@x402/evm` 2.31.0 maps them (`EVM_NETWORK_CHAIN_ID_MAP`, its
 * `src/constants.ts`, exported from `@x402/evm/v1`). AP2's x402 method names its network so (`base-sepolia`,
 * `merchant_agent_mcp/server.py:763` at AP2 `e1ea56d`).
 */
const X402_V1_NETWORKS: Readonly<Record<string, number>> = Object.freeze({
  ethereum: 1,
  sepolia: 11155111,
  abstract: 2741,
  "abstract-testnet": 11124,
  "base-sepolia": 84532,
  base: 8453,
  "avalanche-fuji": 43113,
  avalanche: 43114,
  iotex: 4689,
  sei: 1329,
  "sei-testnet": 1328,
  polygon: 137,
  "polygon-amoy": 80002,
  peaq: 3338,
  story: 1514,
  educhain: 41923,
  "skale-base-sepolia": 324705682,
  megaeth: 4326,
  monad: 143,
  "monad-testnet": 10143,
  stable: 988,
  "stable-testnet": 2201,
  celo: 42220,
  flare: 14,
  hemi: 43111,
  "hemi-testnet": 743111,
});

/** The CAIP-2 id of a method's network: an `eip155:<chain id>` id as given, or an x402 v1 EVM name mapped; else none. */
function caip2Of(network: unknown): Eip155 | undefined {
  if (typeof network !== "string" || network.length === 0 || network.length > MAX_NETWORK) return undefined;
  if (chainIdOf(network) !== undefined) return network as Eip155;
  return Object.hasOwn(X402_V1_NETWORKS, network) ? `eip155:${X402_V1_NETWORKS[network]!}` : undefined;
}

/**
 * AP2's x402 method with its token: `type` `x402`, a 20-byte `address`, a `network` that is an `eip155` CAIP-2 id or an
 * x402 v1 EVM name, and a 20-byte `asset`.
 */
function isX402Method(o: unknown): o is X402Method {
  if (!isJsonObject(o)) return false;
  const { type, address, network, asset } = o;
  return type === "x402" && isAddress(address) && caip2Of(network) !== undefined && isAddress(asset);
}

/**
 * The read keys of the x402 credential the merchant received, against the method it answers: the keys
 * `x402/exact/eip155/eip3009`'s `reference` gives for the same authorization under an option of that network, token and
 * payee (the network in CAIP-2, the token, `validBefore`, the digest of `from`, `to` and `value`, the token's
 * `AuthorizationUsed` and `Transfer` logs and the search by the nonce), the authorization's nonce standing where that
 * pairing has H; the payee the method's `address`; and the authorization's members as presented. None is judged against
 * the method.
 */
async function referenceX402(presented: unknown, option: X402Method): Promise<X402Ref | Refusal> {
  if (!isJsonObject(presented)) return refusal("ap2/mandate-malformed");
  const b = bundleOf(presented["payment"]);
  if (isRefusal(b)) return b;
  if (!isX402Method(option)) return refusal("ap2/option-malformed");
  const a = b.eip_3009_payload.authorization;
  const nonce = normalHash(a.nonce.startsWith("0x") ? a.nonce : `0x${a.nonce}`);
  if (nonce === null) return refusal("ap2/payment-malformed");
  const idDigest = await authorizationIdDigest(a.from as Hex, a.to as Hex, a.value);
  if (isRefusal(idDigest)) return refusal("ap2/payment-malformed");
  const asset = option.asset as Hex;
  return {
    network: caip2Of(option.network)!,
    asset: asset.toLowerCase() as Hex,
    validBefore: a.validBefore,
    // x402/exact/eip155/eip3009's read keys, the authorization's own nonce standing where H stands there.
    h: nonce,
    payer: a.from.toLowerCase() as Hex,
    presented: { token: asset.toLowerCase(), from: a.from.toLowerCase(), to: a.to.toLowerCase(), value: a.value, nonce },
    idDigest,
    bindingLog: { address: asset, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: nonce },
    transferLog: { address: asset, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: idDigest },
    search: { address: asset, topics: [AUTHORIZATION_USED_TOPIC, null, nonce] },
    authorization: { scheme: "eip3009", at: asset, nonce, deadline: a.validBefore, asset },
    payee: option.address,
    from: a.from,
    to: a.to,
    value: a.value,
    validAfter: a.validAfter,
    nonce: a.nonce,
  };
}

const x402Pattern: LcpPattern = deepFreeze({
  pattern: "opaque-challenge",
  profile: X402_ID,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/**
 * The AP2 x402 route's family descriptor: AP2's, with the x402 method its `reference` takes, and the read of the
 * carried EIP-3009 payment, which `status` makes.
 */
type Ap2X402Family = Omit<Ap2Family, "option" | "landed" | "query" | "answer"> & {
  option: X402Method;
  landed: { transaction?: Hex };
  query: EvmQuery<unknown>;
  answer: EvmStatus;
};

/**
 * `ap2/checkout-mandate/x402`. The payee broadcasts (`broadcaster` answers `"payee"`): the merchant forwards AP2's x402
 * credential to its payment processor, which submits the authorization. `status` reads it by this pairing's
 * `reference` as `x402/exact/eip155/eip3009`'s read does, at coverage `none`, the authorization's own nonce standing
 * where that pairing has H. A value that is not a JSON object gets `ap2/mandate-malformed`, as `bound` refuses it.
 */
export const checkoutMandateX402 = Object.freeze({
  id: X402_ID,
  data: CARD[X402_ID],
  pattern: x402Pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound: boundX402,
  reference: referenceX402,
  broadcaster: broadcastsWithin(mandateShape, "payee"),
  status: carriedEip3009Read,
}) satisfies Entry<typeof X402_ID, X402Presented, X402Ref, EvmReader, Ap2X402Family>;
