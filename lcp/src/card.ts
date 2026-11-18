/**
 * The `card` entry point: the ATR hash on a card checkout, on five paths: Visa TAP, Mastercard Agent Pay, Visa
 * Intelligent Commerce, Mastercard Verifiable Intent (Immediate and Autonomous) and the plain card checkout.
 *
 * - Visa TAP and Mastercard Agent Pay: the hash rides in what the agent's message signature covers: its `nonce`, the
 *   base64 of the hash followed by 32 random bytes, or the merchant's checkout path, whose last segment is the hash.
 * - Visa Intelligent Commerce: the hash is the `transactionReferenceId` the agent writes when it asks for the sale's
 *   credential, as unpadded base64url.
 * - Mastercard Verifiable Intent: the hash rides in the `checkout_jwt`, whose SHA-256 the user's L2 mandate
 *   (Immediate) or the agent's L3b mandate (Autonomous) signs as `checkout_hash`.
 * - The plain card checkout: nothing the buyer signs carries the hash. The seller shows it with the link before
 *   payment and places it in its processor reference.
 *
 * Pure: no I/O, no state. WebCrypto supplies SHA-256 and ES256. No function throws.
 *
 * @module
 */
import { fromLegalContext, hashEquals, isHttpsLink, toLcpString, type AtrHash, type Json } from "./core.js";
import { jsonBytes, normalHash, sameJson } from "./fields.js";
import { agreementIn, agreementUrlFault } from "./internal/agreement.js";
import { bytesOfHexDigits, fromBase64, fromBase64Url, hexOf, toBase64, toBase64Url } from "./rail-bytes.js";
import { broadcasts, broadcastsWithin, type Broadcaster } from "./internal/broadcaster.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";
import {
  decodeJsonSegment,
  disclosureDigest,
  jwsSegments,
  readSdJwt,
  withinDepth,
  type SdJwt,
  type SdJwtRefusals,
} from "./sd-jwt.js";
import { MAX_LINK_LENGTH } from "./internal/bounds.js";
import { CARD } from "./internal/data/card.js";
import { chargeOf, type ChargePresented, type ChargeRef } from "./internal/charge-reference.js";
import type { Entry, NoRead, PairingData } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export { MAX_CHARGE_REFERENCE, type ChargePresented, type ChargeRef } from "./internal/charge-reference.js";

export { disclosureDigest } from "./sd-jwt.js";

export type CardScheme = "visa-tap" | "mastercard-vi" | "seller-reference" | "visa-vic" | "mastercard-agent-pay";
/** One card option offered at a checkout. `checkout` is the seller's own id: 1–128 visible ASCII characters. */
export interface CardOption {
  scheme: CardScheme;
  checkout: string;
}
export type CardPairingId =
  | "card/visa-tap"
  | "card/mastercard-vi/immediate"
  | "card/mastercard-vi/autonomous"
  | "card/seller-reference"
  | "card/visa-vic"
  | "card/mastercard-agent-pay";

/**
 * The values the seller's own stack places: the legal context shown before payment, with the agreement URL after the
 * link when one is given, and the processor reference.
 */
export interface CardValues {
  legalContext: { type: "sha256"; value: AtrHash; legalContextUrl: string; legalContextAgreementUrl?: string };
  reference: string;
}

/**
 * A TAP or Agent Pay request as the merchant received it: its two signature fields and, where the merchant's checkout
 * path carries the hash, the request's absolute path without its query, as RFC 9421 §2.2.6 defines `@path`.
 */
export interface TapPresented {
  signatureInput: string;
  signature: string;
  path?: string;
}
/**
 * What the agent's own RFC 9421 signer places in every message signature of its checkout request: the `nonce`, the
 * padded base64 of the hash's 32 bytes followed by 32 random bytes.
 */
export interface TapUnsigned {
  nonce: string;
}
/** A VIC transaction reference as the merchant reads it from the credential payload Visa signs for the sale. */
export interface VicPresented {
  transactionReferenceId: string;
}
/** The transaction reference the agent writes into its VIC credential request: the hash as unpadded base64url. */
export interface VicUnsigned {
  transactionReferenceId: string;
}
/**
 * Immediate mode with a `checkout_jwt` the agent creates: the checkout payload it will sign, and the JSON the seller
 * showed, whose `legalContext` member `build` writes into the payload.
 */
export interface ViCheckoutChoice {
  checkout: { [k: string]: Json };
  shown: unknown;
}
/** The checkout payload with the seller's `legalContext` member, for the agent to sign as its `checkout_jwt`. */
export interface ViCheckoutUnsigned {
  checkout: { [k: string]: Json };
}
/** L2 as presented: its JWS, then its disclosures, `~`-separated, ending in `~`. */
export interface ViImmediate {
  l2: string;
}
/** The Autonomous chain. `l2` is exactly the presentation that L3b's `sd_hash` covers. */
export interface ViAutonomous {
  l1: string;
  l2: string;
  l3b: string;
}
/** The checkout mandate for the wallet (L2) or the agent (L3b) to sign, and the payment mandate's `transaction_id`. */
export interface ViUnsigned {
  checkoutMandate: { vct: "mandate.checkout.1"; checkout_jwt: string; checkout_hash: string };
  transactionId: string;
}

export interface CardPairing<PairingId extends CardPairingId, U> {
  id: PairingId;
  data: PairingData;
  pattern: LcpPattern;
  claims: boolean;
  unplaced(option: CardOption): CardOption | Refusal;
  tie: typeof tie;
  advertise(doc: Record<string, never>, h: AtrHash, link: string, offer: CardOption, agreementUrl?: string): CardValues | Refusal;
  read(doc: unknown): { h: AtrHash; link: string; agreement?: string } | Refusal;
  build(doc: unknown, h: AtrHash): Promise<U | Refusal>;
  bound(presented: unknown): Promise<AtrHash | Refusal>;
  /** Who broadcasts what the payer presents: the seller, which completes the payment (`"payee"`). */
  broadcaster(presented: unknown): Promise<Broadcaster | Refusal>;
}

// lcp's own resource bounds on the card pairings: the largest input each decoder accepts. No specification of these
// forms fixes a size; each bounds the work a decoder does, and is the same for every caller, so a server sizes its own
// request limits from them.

/** The longest checkout id a card option names, in characters. */
export const MAX_CHECKOUT_ID = 128;
/** The longest TAP `Signature-Input` or `Signature` field lcp parses, in characters. */
export const MAX_TAP_FIELD = 8192;
/** The most members lcp parses in one TAP signature field, an RFC 9651 Dictionary. */
export const MAX_TAP_MEMBERS = 16;
/** The most items lcp parses in one inner list of a TAP signature field: a signature's covered components. */
export const MAX_TAP_COMPONENTS = 32;
/** The longest request path lcp reads from a TAP or Agent Pay request, in characters. */
export const MAX_TAP_PATH = 2048;
/** The longest Verifiable Intent layer, an SD-JWT with its disclosures, lcp reads, in characters. */
export const MAX_VI_LAYER = 65_536;
/** The longest `checkout_jwt` lcp reads, in characters. */
export const MAX_CHECKOUT_JWT = 16_384;
/** The most disclosures lcp reads in one Verifiable Intent layer. */
export const MAX_VI_DISCLOSURES = 32;
const SCHEMES: readonly CardScheme[] = ["visa-tap", "mastercard-vi", "seller-reference", "visa-vic", "mastercard-agent-pay"];
/** The `tag` of a TAP payment signature (TAP's field table, `tag`). */
const TAP_TAGS: readonly string[] = ["agent-payer-auth"];
/** Mastercard's two published spellings of Agent Pay's `tag` (its playbook, pages 21 and 24). */
const AGENT_PAY_TAGS: readonly string[] = ["Agent-pay-auth", "agent-pay-auth"];
/** The one parameter name admitted in a spelling RFC 9651 does not allow, as Visa's reference agent writes it. */
const KEY_ID_SPELLING = "keyId";
/** The bytes of a nonce that carries the hash: the hash, then 32 random bytes. */
const NONCE_BYTES = 64;
/**
 * The room `build` leaves within `MAX_CHECKOUT_JWT` for the agent's protected header and signature, in characters: an
 * ES256 signature's 86 and the two dots, and 936 for the header's base64url, a header of up to 702 bytes of JSON.
 */
const CHECKOUT_JWT_FRAME = 1024;
/**
 * The longest checkout payload `build` writes, in bytes of JSON: its base64url, with a header and signature within
 * `CHECKOUT_JWT_FRAME`, makes a `checkout_jwt` within `MAX_CHECKOUT_JWT`, which `read` and `bound` take.
 */
const MAX_CHECKOUT_PAYLOAD = ((MAX_CHECKOUT_JWT - CHECKOUT_JWT_FRAME) / 4) * 3;
const CHECKOUT_VCT = "mandate.checkout.1";
const PAYMENT_VCT = "mandate.payment.1";
const OPEN_CHECKOUT_VCT = "mandate.checkout.open.1";
const SD_JWT_REFUSALS: SdJwtRefusals = {
  malformed: () => refusal("card/vi-malformed"),
  sdAlgUnsupported: () => refusal("card/vi-malformed"),
  unreferenced: () => refusal("card/vi-disclosure-unreferenced"),
  tooLarge: () => refusal("card/too-large"),
};
const SD_JWT_BOUNDS = { maxBytes: MAX_VI_LAYER, maxDisclosures: MAX_VI_DISCLOSURES };

// ── Seller side ──

/** The binding slot: every card option offered at this checkout, exactly as issued. */
export function tie(options: readonly CardOption[]): ["card", { options: readonly CardOption[] }] {
  return ["card", { options }];
}

/**
 * The legal context, with `legalContextAgreementUrl` after the link when `agreementUrl` is given, and the
 * `lcp:sha256:0x…` reference for the seller to place. Equal for every card pairing.
 */
function advertise(
  _doc: Record<string, never>,
  h: AtrHash,
  link: string,
  offer: CardOption,
  agreementUrl?: string,
): CardValues | Refusal {
  if (!isOption(offer)) return refusal("card/option-malformed");
  if (!isHttpsLink(link)) return refusal("card/link-not-https");
  if (link.length > MAX_LINK_LENGTH) return refusal("card/legal-context-malformed");
  const agreementFaulted = agreementUrlFault(agreementUrl);
  if (agreementFaulted?.fault === "link-not-https") return refusal("card/link-not-https");
  if (agreementFaulted !== undefined) return refusal("card/legal-context-malformed");
  const value = normalHash(h);
  if (value === null) return refusal("card/legal-context-malformed");
  const legalContext: CardValues["legalContext"] =
    agreementUrl === undefined
      ? { type: "sha256", value, legalContextUrl: link }
      : { type: "sha256", value, legalContextUrl: link, legalContextAgreementUrl: agreementUrl };
  return { legalContext, reference: toLcpString(value) };
}

/**
 * The option unchanged: no card pairing carries the hash inside the option. An option that carries a `refused` member
 * is `card/option-malformed`.
 */
function unplaced(option: CardOption): CardOption | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("card/option-malformed");
  return option;
}

// ── Buyer side: read and build ──

/** The hash, the link and, when present, the agreement URL from the JSON the seller showed: its `legalContext` member. */
function readShown(doc: unknown): { h: AtrHash; link: string; agreement?: string } | Refusal {
  if (!isObject(doc) || doc["legalContext"] === undefined) return refusal("card/no-legal-context");
  return withAgreement(doc, legalContextOf(doc));
}

/** The hash, the link and, when present, the agreement URL from the payload of a `checkout_jwt`. */
function readCheckoutShown(doc: unknown): { h: AtrHash; link: string; agreement?: string } | Refusal {
  const payload = checkoutPayload(doc);
  if (isRefusal(payload)) return payload;
  return withAgreement(payload, legalContextOf(payload));
}

/** The hash and link from the payload of a `checkout_jwt`. */
function readCheckout(doc: unknown): { h: AtrHash; link: string } | Refusal {
  const payload = checkoutPayload(doc);
  if (isRefusal(payload)) return payload;
  return legalContextOf(payload);
}

/**
 * The payload of a `checkout_jwt`, its second segment base64url-decoded and JSON-parsed, with a `legalContext`. Each
 * segment is base64url without padding in its canonical form (RFC 4648 §3.5), or the JWT is `card/vi-malformed`.
 */
function checkoutPayload(doc: unknown): Record<string, unknown> | Refusal {
  if (typeof doc !== "string") return refusal("card/vi-malformed");
  if (doc.length > MAX_CHECKOUT_JWT) return refusal("card/too-large");
  const parts = jwsSegments(doc);
  if (parts === null) return refusal("card/vi-malformed");
  const payload = decodeJsonSegment(parts[1]);
  if (!isObject(payload)) return refusal("card/vi-malformed");
  if (!withinDepth(payload)) return refusal("card/too-large");
  if (payload["legalContext"] === undefined) return refusal("card/no-legal-context");
  return payload;
}

function legalContextOf(o: Record<string, unknown>): { h: AtrHash; link: string } | Refusal {
  const d = fromLegalContext(o);
  if (d === null) return refusal("card/legal-context-malformed");
  if (d.url.length > MAX_LINK_LENGTH) return refusal("card/legal-context-malformed");
  return { h: d.h, link: d.url };
}

/** `r` with the agreement URL from `o.legalContext` when one is present. */
function withAgreement(
  o: Record<string, unknown>,
  r: { h: AtrHash; link: string } | Refusal,
): { h: AtrHash; link: string; agreement?: string } | Refusal {
  if (isRefusal(r)) return r;
  const agreement = agreementIn(o["legalContext"]);
  if (typeof agreement === "object") return refusal("card/legal-context-malformed");
  return agreement === undefined ? r : { ...r, agreement };
}

/**
 * Immediate mode: the hash, the link and, when present, the agreement URL from a `checkout_jwt`, or from the JSON the
 * seller showed where the agent creates the `checkout_jwt` itself.
 */
function readViImmediate(doc: unknown): { h: AtrHash; link: string; agreement?: string } | Refusal {
  return typeof doc === "string" ? readCheckoutShown(doc) : readShown(doc);
}

/** The hash's 32 bytes. */
function hashBytes(h: AtrHash): Uint8Array {
  return bytesOfHexDigits(h.slice(2))!;
}

/**
 * The nonce for the agent's signer to place in every message signature of its checkout request: the padded base64 of
 * the hash's 32 bytes followed by 32 bytes drawn at random.
 */
async function tapBuild(_doc: unknown, h: AtrHash): Promise<TapUnsigned | Refusal> {
  const value = normalHash(h);
  if (value === null) return refusal("card/legal-context-malformed");
  const bytes = new Uint8Array(NONCE_BYTES);
  bytes.set(hashBytes(value), 0);
  crypto.getRandomValues(bytes.subarray(32));
  return { nonce: toBase64(bytes) };
}

/** The transaction reference for the agent to write into its VIC credential request: the hash as unpadded base64url. */
async function vicBuild(_doc: unknown, h: AtrHash): Promise<VicUnsigned | Refusal> {
  const value = normalHash(h);
  if (value === null) return refusal("card/legal-context-malformed");
  return { transactionReferenceId: toBase64Url(hashBytes(value)) };
}

/**
 * Immediate mode: on a `checkout_jwt`, the checkout mandate as `viBuild` gives it; on a checkout payload the agent
 * creates, the payload with the seller's `legalContext` member written into it, last, for the agent to sign as its
 * `checkout_jwt`. The shown legal context's hash must be `h`, and a payload that already holds a `legalContext` must
 * hold that one.
 */
async function viImmediateBuild(doc: unknown, h: AtrHash): Promise<ViUnsigned | ViCheckoutUnsigned | Refusal> {
  if (typeof doc === "string") return viBuild(doc, h);
  if (!isObject(doc) || !isObject(doc["checkout"])) return refusal("card/vi-malformed");
  const shown = readShown(doc["shown"]);
  if (isRefusal(shown)) return shown;
  if (!hashEquals(shown.h, h)) return refusal("card/vi-legal-context-conflict");
  const legalContext = (doc["shown"] as Record<string, Json>)["legalContext"]!;
  const checkout = doc["checkout"] as { [k: string]: Json };
  if (Object.hasOwn(checkout, "legalContext") && !sameJson(checkout["legalContext"], legalContext)) {
    return refusal("card/vi-legal-context-conflict");
  }
  const out: { [k: string]: Json } = Object.hasOwn(checkout, "legalContext") ? { ...checkout } : { ...checkout, legalContext };
  const size = jsonBytes(out);
  if (size === undefined) return refusal("card/vi-malformed");
  if (size > MAX_CHECKOUT_PAYLOAD || !withinDepth(out)) return refusal("card/too-large");
  return { checkout: out };
}

/**
 * The checkout mandate over `checkout_jwt`, whose `legalContext.value` must be `h` by decoded bytes. `checkout_hash`
 * and `transactionId` are both `disclosureDigest(checkout_jwt)`.
 */
async function viBuild(doc: unknown, h: AtrHash): Promise<ViUnsigned | Refusal> {
  const r = readCheckout(doc);
  if (isRefusal(r)) return r;
  if (!hashEquals(r.h, h)) return refusal("card/vi-legal-context-conflict");
  const checkoutJwt = doc as string;
  const digest = await disclosureDigest(checkoutJwt);
  return {
    checkoutMandate: { vct: CHECKOUT_VCT, checkout_jwt: checkoutJwt, checkout_hash: digest },
    transactionId: digest,
  };
}

async function noSignedPlace(): Promise<Refusal> {
  return refusal("card/no-signed-place");
}

// ── The one check: bound ──

/**
 * The hash from a TAP or Agent Pay request: every signature whose `tag` is one of `tags` carries it, by `@path`, listed
 * with no parameters, where the request's path ends in a segment that is the hash, the nonce then not read, since a
 * stock agent draws its nonce at random and may draw 64 bytes; or otherwise by its `nonce`, the padded base64 of 64
 * bytes whose first 32 are the hash. Each such signature carries the same hash, and one of them has its `Signature`
 * member, so whichever the merchant's recognition verifies covers the hash. No signature, key, window or nonce use is
 * verified.
 */
function tapBoundFor(tags: readonly string[]): (presented: unknown) => Promise<AtrHash | Refusal> {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    if (!isObject(presented)) return refusal("card/tap-signature-input-malformed");
    const { signatureInput, signature, path } = presented;

    if (typeof signatureInput !== "string") return refusal("card/tap-signature-input-malformed");
    if (signatureInput.length > MAX_TAP_FIELD) return refusal("card/too-large");
    const inputs = parseDictionary(signatureInput);
    if (inputs === TOO_LARGE) return refusal("card/too-large");
    if (inputs === null || !isSignatureInput(inputs)) return refusal("card/tap-signature-input-malformed");

    if (typeof signature !== "string") return refusal("card/tap-signature-malformed");
    if (signature.length > MAX_TAP_FIELD) return refusal("card/too-large");
    const signatures = parseDictionary(signature);
    if (signatures === TOO_LARGE) return refusal("card/too-large");
    if (signatures === null || !isSignatureSet(signatures)) return refusal("card/tap-signature-malformed");

    let byPathHash: AtrHash | null = null;
    if (path !== undefined) {
      if (typeof path !== "string") return refusal("card/tap-path-malformed");
      if (path.length > MAX_TAP_PATH) return refusal("card/too-large");
      if (!path.startsWith("/") || !isVisibleAscii(path)) return refusal("card/tap-path-malformed");
      byPathHash = hashInPath(path);
    }

    const payers = [...inputs].filter(([, m]) => isTag(m.params.get("tag"), tags)) as [string, InnerList][];
    if (payers.length === 0) return refusal("card/tap-no-payer-signature");
    let h: AtrHash | null = null;
    for (const [, m] of payers) {
      const nonce = m.params.get("nonce");
      if (nonce !== undefined && nonce.t !== "string") return refusal("card/tap-nonce-malformed");
      const byPath = byPathHash !== null && m.list.some(isBarePathComponent) ? byPathHash : null;
      const carried = byPath ?? (nonce === undefined ? null : hashInNonce(nonce.v as string));
      if (carried === null) return refusal("card/tap-hash-not-covered");
      if (h !== null && carried !== h) return refusal("card/tap-hash-conflict");
      h = carried;
    }
    if (!payers.some(([label]) => signatures.has(label))) return refusal("card/tap-signature-missing");
    return h!;
  };
}

/** The hash a nonce carries: the first 32 of the 64 bytes it is the padded base64 of, or null for any other nonce. */
function hashInNonce(nonce: string): AtrHash | null {
  const bytes = fromBase64(nonce);
  return bytes === null || bytes.length !== NONCE_BYTES ? null : (hexOf(bytes.subarray(0, 32)) as AtrHash);
}

/** The hash a path carries: its last segment where that is `0x` and 64 lowercase hex digits, or null. */
function hashInPath(path: string): AtrHash | null {
  const last = path.slice(path.lastIndexOf("/") + 1);
  return /^0x[0-9a-f]{64}$/.test(last) ? (last as AtrHash) : null;
}

/** The hash from a VIC transaction reference: exactly 43 characters of unpadded base64url of 32 bytes. */
async function vicBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented)) return refusal("card/vic-reference-malformed");
  const reference = presented["transactionReferenceId"];
  if (typeof reference !== "string" || reference.length !== 43) return refusal("card/vic-reference-malformed");
  const bytes = fromBase64Url(reference);
  if (bytes === null || bytes.length !== 32) return refusal("card/vic-reference-malformed");
  return hexOf(bytes) as AtrHash;
}

/**
 * Immediate mode: the hash in the `checkout_jwt` of the one checkout mandate the user's L2 references. Its
 * `checkout_hash`, and a referenced payment mandate's `transaction_id`, must be that `checkout_jwt`'s digest. No
 * signature is verified.
 */
async function viImmediateBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented)) return refusal("card/vi-malformed");
  const user = await readLayer((presented as unknown as Record<string, unknown>)["l2"], "kb-sd-jwt");
  if (isRefusal(user)) return user;
  return checkoutHash(user);
}

/**
 * Autonomous mode: the hash in L3b's checkout mandate, with L3b bound to L2 by `sd_hash` and signed under the key
 * L2's open checkout mandate delegates, and L2 bound to L1 by `sd_hash` and signed under L1's `cnf.jwk`. L1's
 * issuer signature is not verified.
 */
async function viAutonomousBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented)) return refusal("card/vi-malformed");
  const { l1, l2, l3b } = presented as unknown as Record<string, unknown>;

  const agent = await readLayer(l3b, "kb-sd-jwt");
  if (isRefusal(agent)) return agent;
  const kid = agent.header["kid"];
  if (typeof kid !== "string") return refusal("card/vi-typ");
  const h = await checkoutHash(agent);
  if (isRefusal(h)) return h;

  if (typeof l2 !== "string") return refusal("card/vi-malformed");
  if (l2.length > MAX_VI_LAYER) return refusal("card/too-large");
  if (agent.payload["sd_hash"] !== (await disclosureDigest(l2))) return refusal("card/vi-sd-hash-mismatch");
  const user = await readLayer(l2, "kb-sd-jwt+kb");
  if (isRefusal(user)) return user;
  const open = mandates(user).filter((m) => m["vct"] === OPEN_CHECKOUT_VCT);
  const agentKey = open.length === 1 ? jwkOf(open[0]!["cnf"]) : null;
  if (agentKey === null || typeof agentKey["kid"] !== "string") return refusal("card/vi-key-malformed");
  if (agentKey["kid"] !== kid) return refusal("card/vi-kid-mismatch");
  const agentSigned = await verifyEs256(agent.jwt, agentKey);
  if (agentSigned !== true) return agentSigned;

  if (typeof l1 !== "string") return refusal("card/vi-malformed");
  if (l1.length > MAX_VI_LAYER) return refusal("card/too-large");
  if (user.payload["sd_hash"] !== (await disclosureDigest(l1))) return refusal("card/vi-sd-hash-mismatch");
  const issued = await readSdJwt(l1, SD_JWT_REFUSALS, SD_JWT_BOUNDS);
  if (isRefusal(issued)) return issued;
  const userKey = jwkOf(issued.payload["cnf"]);
  if (userKey === null) return refusal("card/vi-key-malformed");
  const userSigned = await verifyEs256(user.jwt, userKey);
  if (userSigned !== true) return userSigned;
  return h;
}

/**
 * One Verifiable Intent L2 or L3 layer: a JWS, one or more disclosures and an empty last part, read through the
 * SD-JWT reader, with header `alg` ES256 and the given `typ`, `_sd_alg` `sha-256`, and a `delegate_payload` array of
 * `{"...": digest}` entries.
 */
async function readLayer(s: unknown, typ: string): Promise<SdJwt | Refusal> {
  if (typeof s !== "string") return refusal("card/vi-malformed");
  if (s.length > MAX_VI_LAYER) return refusal("card/too-large");
  const parts = s.split("~");
  if (parts.length < 3 || parts[parts.length - 1] !== "") return refusal("card/vi-malformed");
  if (parts.length - 2 > MAX_VI_DISCLOSURES) return refusal("card/too-large");
  const layer = await readSdJwt(s, SD_JWT_REFUSALS, SD_JWT_BOUNDS);
  if (isRefusal(layer)) return layer;
  if (layer.header["alg"] !== "ES256" || layer.header["typ"] !== typ) return refusal("card/vi-typ");
  const delegated = layer.payload["delegate_payload"];
  if (layer.payload["_sd_alg"] !== "sha-256" || !Array.isArray(delegated)) return refusal("card/vi-malformed");
  for (const d of delegated) {
    if (!isObject(d) || Object.keys(d).length !== 1 || typeof d["..."] !== "string") {
      return refusal("card/vi-malformed");
    }
  }
  return layer;
}

/** The mandate objects a layer's `delegate_payload` resolves to: only disclosures its signed payload references. */
function mandates(layer: SdJwt): Record<string, unknown>[] {
  const resolved = layer.resolved["delegate_payload"];
  return Array.isArray(resolved) ? resolved.filter(isObject) : [];
}

/** The hash from a layer's one referenced `mandate.checkout.1`, after its binding checks. */
async function checkoutHash(layer: SdJwt): Promise<AtrHash | Refusal> {
  const all = mandates(layer);
  const checkouts = all.filter((m) => m["vct"] === CHECKOUT_VCT);
  if (checkouts.length !== 1) return refusal("card/vi-no-checkout-mandate");
  const mandate = checkouts[0]!;
  const checkoutJwt = mandate["checkout_jwt"];
  const r = readCheckout(checkoutJwt);
  if (isRefusal(r)) return r;
  const digest = await disclosureDigest(checkoutJwt as string);
  if (mandate["checkout_hash"] !== digest) return refusal("card/vi-checkout-hash-mismatch");
  for (const m of all) {
    if (m["vct"] === PAYMENT_VCT && m["transaction_id"] !== digest) return refusal("card/vi-transaction-id-mismatch");
  }
  return r.h;
}

/** An EC P-256 public JWK from `cnf`'s `jwk` member, or null. */
function jwkOf(cnf: unknown): Record<string, unknown> | null {
  const k = isObject(cnf) ? cnf["jwk"] : undefined;
  if (!isObject(k) || k["kty"] !== "EC" || k["crv"] !== "P-256") return null;
  if (typeof k["x"] !== "string" || typeof k["y"] !== "string") return null;
  return k;
}

/**
 * ES256 over the ASCII `header.payload` of a compact JWS, with a 64-byte r‖s signature, under an EC P-256 public
 * JWK. The JWK's `x` and `y` must each be base64url without padding of exactly 32 bytes, the full size of a P-256
 * coordinate (RFC 7518 §6.2.1.2-3), in its canonical form (RFC 4648 §3.5), and the key is imported from those bytes as
 * the uncompressed point, so no runtime's JWK decoder decides which keys pass. Coordinates of another form, a last
 * character carrying a bit past the 32 bytes included, or a point WebCrypto will not import, are
 * `card/vi-key-malformed`; any other failure is `card/vi-signature-invalid`.
 */
async function verifyEs256(jws: string, jwk: Record<string, unknown>): Promise<true | Refusal> {
  const x = fromBase64Url(jwk["x"]);
  const y = fromBase64Url(jwk["y"]);
  if (x === null || y === null || x.length !== 32 || y.length !== 32) return refusal("card/vi-key-malformed");
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", point, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    return refusal("card/vi-key-malformed");
  }
  const cut = jws.lastIndexOf(".");
  const signature = fromBase64Url(jws.slice(cut + 1));
  if (cut < 0 || signature === null || signature.length !== 64) return refusal("card/vi-signature-invalid");
  const signed = new TextEncoder().encode(jws.slice(0, cut));
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature as Uint8Array<ArrayBuffer>,
    signed,
  );
  return ok ? true : refusal("card/vi-signature-invalid");
}

// ── The pairings ──

const visaTapPattern: LcpPattern = deepFreeze({
  pattern: "protocol-extension",
  profile: "card/visa-tap",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

const viImmediatePattern: LcpPattern = deepFreeze({
  pattern: "id-reuse",
  profile: "card/mastercard-vi",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

const viAutonomousPattern: LcpPattern = deepFreeze({
  pattern: "id-reuse",
  profile: "card/mastercard-vi",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

const visaVicPattern: LcpPattern = deepFreeze({
  pattern: "protocol-extension",
  profile: "card/visa-vic",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

const agentPayPattern: LcpPattern = deepFreeze({
  pattern: "protocol-extension",
  profile: "card/mastercard-agent-pay",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

const sellerReferencePattern: LcpPattern = deepFreeze({
  pattern: "http-advisory",
  profile: "card/seller-reference",
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/**
 * A card pairing's family descriptor, by what its `build` gives. No public ledger records the payment, so nothing is
 * read back.
 */
type CardFamily<U> = NoRead & {
  doc: unknown;
  offered: { h: AtrHash; link: string; agreement?: string };
  placedIn: Record<string, never>;
  offer: CardOption;
  rest: [agreementUrl?: string];
  advertised: CardValues;
  choice: unknown;
  unsigned: U;
  option: never;
};

/**
 * `card/visa-tap`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card payment to its
 * processor; nothing here reads it. A value that is not an object gets `card/tap-signature-input-malformed`, as
 * `bound` refuses it.
 */
export const visaTap: CardPairing<"card/visa-tap", TapUnsigned> = Object.freeze({
  id: "card/visa-tap",
  data: CARD["card/visa-tap"],
  pattern: visaTapPattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readShown,
  build: tapBuild,
  bound: tapBoundFor(TAP_TAGS),
  broadcaster: broadcastsWithin(tapShape, "payee"),
}) satisfies Entry<"card/visa-tap", TapPresented, never, never, CardFamily<TapUnsigned>>;

/**
 * `card/mastercard-agent-pay`. TAP's carrier under Mastercard's two published `tag` spellings. The payee broadcasts
 * (`broadcaster` answers `"payee"`): the seller submits the card payment to its processor; nothing here reads it. A
 * value that is not an object gets `card/tap-signature-input-malformed`, as `bound` refuses it.
 */
export const agentPay: CardPairing<"card/mastercard-agent-pay", TapUnsigned> = Object.freeze({
  id: "card/mastercard-agent-pay",
  data: CARD["card/mastercard-agent-pay"],
  pattern: agentPayPattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readShown,
  build: tapBuild,
  bound: tapBoundFor(AGENT_PAY_TAGS),
  broadcaster: broadcastsWithin(tapShape, "payee"),
}) satisfies Entry<"card/mastercard-agent-pay", TapPresented, never, never, CardFamily<TapUnsigned>>;

/**
 * `card/visa-vic`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card payment with the
 * credential Visa issued for the sale to its processor; nothing here reads it. A value that is not an object gets
 * `card/vic-reference-malformed`, as `bound` refuses it.
 */
export const visaVic: CardPairing<"card/visa-vic", VicUnsigned> = Object.freeze({
  id: "card/visa-vic",
  data: CARD["card/visa-vic"],
  pattern: visaVicPattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readShown,
  build: vicBuild,
  bound: vicBound,
  broadcaster: broadcastsWithin(vicShape, "payee"),
}) satisfies Entry<"card/visa-vic", VicPresented, never, never, CardFamily<VicUnsigned>>;

/**
 * `card/mastercard-vi/immediate`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card
 * payment the mandate authorizes to its processor; nothing here reads it. A value that is not an object gets
 * `card/vi-malformed`, as `bound` refuses it.
 */
export const viImmediate: CardPairing<"card/mastercard-vi/immediate", ViUnsigned | ViCheckoutUnsigned> = Object.freeze({
  id: "card/mastercard-vi/immediate",
  data: CARD["card/mastercard-vi/immediate"],
  pattern: viImmediatePattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readViImmediate,
  build: viImmediateBuild,
  bound: viImmediateBound,
  broadcaster: broadcastsWithin(viShape, "payee"),
}) satisfies Entry<"card/mastercard-vi/immediate", ViImmediate, never, never, CardFamily<ViUnsigned | ViCheckoutUnsigned>>;

/**
 * `card/mastercard-vi/autonomous`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card
 * payment the mandates authorize to its processor; nothing here reads it. A value that is not an object gets
 * `card/vi-malformed`, as `bound` refuses it.
 */
export const viAutonomous: CardPairing<"card/mastercard-vi/autonomous", ViUnsigned> = Object.freeze({
  id: "card/mastercard-vi/autonomous",
  data: CARD["card/mastercard-vi/autonomous"],
  pattern: viAutonomousPattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readCheckoutShown,
  build: viBuild,
  bound: viAutonomousBound,
  broadcaster: broadcastsWithin(viShape, "payee"),
}) satisfies Entry<"card/mastercard-vi/autonomous", ViAutonomous, never, never, CardFamily<ViUnsigned>>;

/**
 * The reference of a `card/seller-reference` charge: the checkout of the card option it answers and the seller's own
 * reference for the charge, `{checkout, charge}`. What is presented is `{charge}`, 1 to 255 visible ASCII characters,
 * else `card/charge-reference-malformed`; then an option that is not a card option of the `seller-reference` scheme is
 * `card/option-malformed`. Nothing the charge moved is compared with the option.
 */
async function sellerReferenceOf(presented: unknown, option: CardOption): Promise<ChargeRef | Refusal> {
  const charge = chargeOf(presented);
  if (charge === undefined) return refusal("card/charge-reference-malformed");
  if (!isOption(option) || option.scheme !== "seller-reference") return refusal("card/option-malformed");
  return { checkout: option.checkout, charge };
}

/**
 * `card/seller-reference`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller submits the card payment
 * to its processor, with H in its processor reference; nothing here reads it. `reference` names the charge by the
 * seller's own reference for it.
 */
export const sellerReference: CardPairing<"card/seller-reference", never> & {
  reference(presented: unknown, option: CardOption): Promise<ChargeRef | Refusal>;
} = Object.freeze({
  id: "card/seller-reference",
  data: CARD["card/seller-reference"],
  pattern: sellerReferencePattern,
  claims: false,
  unplaced,
  tie,
  advertise,
  read: readShown,
  build: noSignedPlace,
  bound: noSignedPlace,
  broadcaster: broadcasts("payee"),
  reference: sellerReferenceOf,
}) satisfies Entry<"card/seller-reference", ChargePresented, ChargeRef, never, Omit<CardFamily<never>, "option"> & { option: CardOption }>;

// ── RFC 9651: the subset TAP's two signature fields need ──

type Bare =
  | { t: "integer"; v: number }
  | { t: "string"; v: string }
  | { t: "token"; v: string }
  | { t: "boolean"; v: boolean }
  | { t: "bytes"; v: string };
type Params = Map<string, Bare>;
type Item = { item: Bare; params: Params };
type InnerList = { list: Item[]; params: Params };
type Member = Item | InnerList;

const TOO_LARGE = Symbol("too-large");

/**
 * An RFC 9651 Dictionary, with Integer, String, Token, Boolean and Byte Sequence items; a Decimal, Date or Display
 * String fails. A repeated key overwrites the earlier value. One parameter name is also admitted as `keyId`, the
 * spelling Visa's reference agent writes, and read as `keyid`; parameters that name both spellings fail. Null when the
 * text does not parse; TOO_LARGE past 16 members or 32 items in an inner list.
 */
function parseDictionary(s: string): Map<string, Member> | null | typeof TOO_LARGE {
  let i = 0;
  const n = s.length;
  const out = new Map<string, Member>();
  let members = 0;

  const sp = (): void => {
    while (i < n && s[i] === " ") i++;
  };
  const ows = (): void => {
    while (i < n && (s[i] === " " || s[i] === "\t")) i++;
  };
  const key = (): string | null => {
    const first = s[i];
    if (first === undefined || !(isLcAlpha(first) || first === "*")) return null;
    const start = i++;
    while (i < n && isKeyChar(s[i]!)) i++;
    return s.slice(start, i);
  };
  const bare = (): Bare | null => {
    const c = s[i];
    if (c === undefined) return null;
    if (c === "-" || isDigit(c)) {
      const start = i;
      if (c === "-") i++;
      const digitsAt = i;
      while (i < n && isDigit(s[i]!)) i++;
      const count = i - digitsAt;
      if (count === 0 || count > 15 || s[i] === ".") return null;
      return { t: "integer", v: Number(s.slice(start, i)) };
    }
    if (c === '"') {
      i++;
      let v = "";
      while (i < n) {
        const d = s[i++]!;
        if (d === "\\") {
          const e = s[i++];
          if (e !== '"' && e !== "\\") return null;
          v += e;
        } else if (d === '"') {
          return { t: "string", v };
        } else {
          const code = d.charCodeAt(0);
          if (code < 0x20 || code > 0x7e) return null;
          v += d;
        }
      }
      return null;
    }
    if (isAlpha(c) || c === "*") {
      const start = i++;
      while (i < n && isTokenChar(s[i]!)) i++;
      return { t: "token", v: s.slice(start, i) };
    }
    if (c === ":") {
      const start = ++i;
      while (i < n && isBase64Char(s[i]!)) i++;
      if (s[i] !== ":") return null;
      return { t: "bytes", v: s.slice(start, i++) };
    }
    if (c === "?") {
      const b = s[i + 1];
      if (b !== "0" && b !== "1") return null;
      i += 2;
      return { t: "boolean", v: b === "1" };
    }
    return null;
  };
  const params = (): Params | null => {
    const p: Params = new Map();
    let keyIdSpelled: string | undefined;
    while (s[i] === ";") {
      i++;
      sp();
      let k: string | null;
      if (s.startsWith(KEY_ID_SPELLING, i) && !isKeyChar(s[i + KEY_ID_SPELLING.length] ?? " ")) {
        i += KEY_ID_SPELLING.length;
        k = KEY_ID_SPELLING;
      } else {
        k = key();
      }
      if (k === null) return null;
      if (k === "keyid" || k === KEY_ID_SPELLING) {
        if (keyIdSpelled !== undefined && keyIdSpelled !== k) return null;
        keyIdSpelled = k;
        k = "keyid";
      }
      let v: Bare | null = { t: "boolean", v: true };
      if (s[i] === "=") {
        i++;
        v = bare();
        if (v === null) return null;
      }
      p.set(k, v);
    }
    return p;
  };
  const item = (): Item | null => {
    const b = bare();
    if (b === null) return null;
    const p = params();
    return p === null ? null : { item: b, params: p };
  };
  const innerList = (): InnerList | null | typeof TOO_LARGE => {
    i++;
    const list: Item[] = [];
    while (i < n) {
      sp();
      if (s[i] === ")") {
        i++;
        const p = params();
        return p === null ? null : { list, params: p };
      }
      if (list.length >= MAX_TAP_COMPONENTS) return TOO_LARGE;
      const it = item();
      if (it === null) return null;
      list.push(it);
      if (s[i] !== " " && s[i] !== ")") return null;
    }
    return null;
  };

  sp();
  while (i < n) {
    if (members >= MAX_TAP_MEMBERS) return TOO_LARGE;
    members++;
    const k = key();
    if (k === null) return null;
    let m: Member | null | typeof TOO_LARGE;
    if (s[i] === "=") {
      i++;
      m = s[i] === "(" ? innerList() : item();
    } else {
      const p = params();
      m = p === null ? null : { item: { t: "boolean", v: true }, params: p };
    }
    if (m === null || m === TOO_LARGE) return m;
    out.set(k, m);
    ows();
    if (i >= n) return out;
    if (s[i] !== ",") return null;
    i++;
    ows();
    if (i >= n) return null;
  }
  return out;
}

/** Every member an Inner List of Strings; every parameter an Integer, String, Token or Boolean. */
function isSignatureInput(d: Map<string, Member>): d is Map<string, InnerList> {
  for (const m of d.values()) {
    if (!("list" in m) || !plainParams(m.params)) return false;
    for (const it of m.list) if (it.item.t !== "string" || !plainParams(it.params)) return false;
  }
  return true;
}

/** Every member a Byte Sequence. */
function isSignatureSet(d: Map<string, Member>): boolean {
  for (const m of d.values()) if ("list" in m || m.item.t !== "bytes") return false;
  return true;
}

function plainParams(p: Params): boolean {
  for (const v of p.values()) if (v.t === "bytes") return false;
  return true;
}

/** A `tag` parameter that is a String and one of `tags`. */
function isTag(v: Bare | undefined, tags: readonly string[]): boolean {
  return v !== undefined && v.t === "string" && tags.includes(v.v);
}

/** The String `@path` with no parameters. */
function isBarePathComponent(it: Item): boolean {
  return it.item.t === "string" && it.item.v === "@path" && it.params.size === 0;
}

function isLcAlpha(c: string): boolean {
  return c >= "a" && c <= "z";
}
function isAlpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}
function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}
function isKeyChar(c: string): boolean {
  return isLcAlpha(c) || isDigit(c) || c === "_" || c === "-" || c === "." || c === "*";
}
function isTokenChar(c: string): boolean {
  return isAlpha(c) || isDigit(c) || ":/!#$%&'*+-.^_`|~".includes(c);
}
function isBase64Char(c: string): boolean {
  return isAlpha(c) || isDigit(c) || c === "+" || c === "/" || c === "=";
}

// ── Shared helpers ──

function isOption(o: unknown): o is CardOption {
  if (!isObject(o)) return false;
  const { scheme, checkout } = o;
  return (
    SCHEMES.includes(scheme as CardScheme) &&
    typeof checkout === "string" &&
    checkout.length >= 1 &&
    checkout.length <= MAX_CHECKOUT_ID &&
    isVisibleAscii(checkout)
  );
}

function trimSpHtab(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === " " || s[a] === "\t")) a++;
  while (b > a && (s[b - 1] === " " || s[b - 1] === "\t")) b--;
  return s.slice(a, b);
}

function isVisibleAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

/** The shape gate the TAP and Agent Pay `bound` applies first: an object, else `card/tap-signature-input-malformed`. */
function tapShape(presented: unknown): true | Refusal {
  return isObject(presented) ? true : refusal("card/tap-signature-input-malformed");
}

/** The shape gate `vicBound` applies first: an object, else `card/vic-reference-malformed`. */
function vicShape(presented: unknown): true | Refusal {
  return isObject(presented) ? true : refusal("card/vic-reference-malformed");
}

/** The shape gate the VI `bound`s apply first: an object, else `card/vi-malformed`. */
function viShape(presented: unknown): true | Refusal {
  return isObject(presented) ? true : refusal("card/vi-malformed");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
