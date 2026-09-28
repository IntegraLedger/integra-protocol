/**
 * The `card` entry point: the ATR hash on a card checkout, on three paths.
 *
 * - Visa TAP: the agent sends the hash in an `lcp-hash` field and lists that field among the covered components of
 *   its `agent-payer-auth` message signature.
 * - Mastercard Verifiable Intent: the hash rides in the merchant's `checkout_jwt`, whose SHA-256 the user's L2
 *   mandate (Immediate) or the agent's L3b mandate (Autonomous) signs as `checkout_hash`.
 * - The plain card checkout: nothing the buyer signs carries the hash. The seller shows it with the link before
 *   payment and places it in its processor reference.
 *
 * Pure: no I/O, no state. WebCrypto supplies SHA-256 and ES256. No function throws.
 */
import { fromLegalContext, hashEquals, isHashWithNonHttpsLink, isHttpsLink, isOtherSchemeLink, toLcpString, type AtrHash } from "./core.js";
import { normalHash } from "./fields.js";
import { agreementIn, agreementRefusal } from "./internal/agreement.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import type { LcpPattern } from "./x402.js";
import { decodeJsonSegment, disclosureDigest, jwsSegments, readSdJwt, b64urlDecode, withinDepth, type SdJwt } from "./sd-jwt.js";

export { disclosureDigest } from "./sd-jwt.js";

export type CardScheme = "visa-tap" | "mastercard-vi" | "seller-reference";
/** One card option offered at a checkout. `checkout` is the seller's own id: 1–128 visible ASCII characters. */
export interface CardOption {
  scheme: CardScheme;
  checkout: string;
}
export type CardPairingId =
  | "card/visa-tap"
  | "card/mastercard-vi/immediate"
  | "card/mastercard-vi/autonomous"
  | "card/seller-reference";

/**
 * The values the seller's own stack places: the legal context shown before payment, with the agreement URL after the
 * link when one is given, and the processor reference.
 */
export interface CardValues {
  legalContext: { type: "sha256"; value: AtrHash; legalContextUrl: string; legalContextAgreementUrl?: string };
  reference: string;
}

export const TAP_FIELD = "lcp-hash";
/** A TAP payment request as received: the two signature fields and every `lcp-hash` field line. */
export interface TapPresented {
  signatureInput: string;
  signature: string;
  lcpHash: readonly string[];
}
/** What the agent's own RFC 9421 signer adds: the field, its value, and the component it lists. */
export interface TapUnsigned {
  field: "lcp-hash";
  value: AtrHash;
  component: "lcp-hash";
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

export interface CardPairing<Id extends CardPairingId, U> {
  id: Id;
  pattern: LcpPattern;
  claims: boolean;
  unplaced(option: CardOption): CardOption;
  tie: typeof tie;
  advertise(doc: Record<string, never>, h: AtrHash, link: string, offer: CardOption, agreementUrl?: string): CardValues | Refusal;
  read(doc: unknown): { h: AtrHash; link: string; agreement?: string } | Refusal;
  build(doc: unknown, h: AtrHash): Promise<U | Refusal>;
  bound(presented: unknown): Promise<AtrHash | Refusal>;
}

const MAX_CHECKOUT_ID = 128;
const MAX_LINK = 2048;
const MAX_TAP_FIELD = 8192;
const MAX_TAP_MEMBERS = 16;
const MAX_TAP_COMPONENTS = 32;
const MAX_TAP_HASH_LINES = 4;
const MAX_TAP_HASH_LINE = 256;
const MAX_VI_LAYER = 65_536;
const MAX_CHECKOUT_JWT = 16_384;
const MAX_VI_DISCLOSURES = 32;
const SCHEMES: readonly CardScheme[] = ["visa-tap", "mastercard-vi", "seller-reference"];
const PAYER_TAG = "agent-payer-auth";
const CHECKOUT_VCT = "mandate.checkout.1";
const PAYMENT_VCT = "mandate.payment.1";
const OPEN_CHECKOUT_VCT = "mandate.checkout.open.1";
const SD_JWT_CODES = {
  malformed: "card/vi-malformed",
  sdAlgUnsupported: "card/vi-malformed",
  unreferenced: "card/vi-disclosure-unreferenced",
  tooLarge: "card/too-large",
};
const SD_JWT_BOUNDS = { maxBytes: MAX_VI_LAYER, maxDisclosures: MAX_VI_DISCLOSURES };

// ── Seller side ──

/** The binding slot: every card option offered at this checkout, exactly as issued. */
export function tie(options: readonly CardOption[]): ["card", { options: readonly CardOption[] }] {
  return ["card", { options }];
}

/** The pairings a well-formed option can be paid through: Verifiable Intent has two. Anything else has none. */
export function pairingsOf(o: CardOption): readonly CardPairingId[] {
  if (!isOption(o)) return [];
  switch (o.scheme) {
    case "visa-tap":
      return ["card/visa-tap"];
    case "mastercard-vi":
      return ["card/mastercard-vi/immediate", "card/mastercard-vi/autonomous"];
    case "seller-reference":
      return ["card/seller-reference"];
  }
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
  if (!isHttpsLink(link)) return refusal(isOtherSchemeLink(link) ? "card/link-not-https" : "card/legal-context-malformed");
  if (link.length > MAX_LINK) return refusal("card/legal-context-malformed");
  const agreementFaulted = agreementRefusal("card", agreementUrl);
  if (agreementFaulted !== undefined) return agreementFaulted;
  const value = normalHash(h);
  if (value === null) return refusal("card/legal-context-malformed");
  const legalContext: CardValues["legalContext"] =
    agreementUrl === undefined
      ? { type: "sha256", value, legalContextUrl: link }
      : { type: "sha256", value, legalContextUrl: link, legalContextAgreementUrl: agreementUrl };
  return { legalContext, reference: toLcpString(value) };
}

/** The option unchanged: no card pairing carries the hash inside the option. */
function unplaced(option: CardOption): CardOption {
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

/** The payload of a `checkout_jwt`, its second segment base64url-decoded and JSON-parsed, with a `legalContext`. */
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
  if (d === null) {
    return isHashWithNonHttpsLink(o["legalContext"])
      ? refusal("card/link-not-https")
      : refusal("card/legal-context-malformed");
  }
  if (d.url.length > MAX_LINK) return refusal("card/legal-context-malformed");
  return { h: d.h, link: d.url };
}

/** `r` with the agreement URL from `o.legalContext` when one is present. */
function withAgreement(
  o: Record<string, unknown>,
  r: { h: AtrHash; link: string } | Refusal,
): { h: AtrHash; link: string; agreement?: string } | Refusal {
  if (isRefusal(r)) return r;
  const agreement = agreementIn(o["legalContext"]);
  if (typeof agreement === "object") return refusal(`card/${agreement.fault}`);
  return agreement === undefined ? r : { ...r, agreement };
}

/** The field for the agent's signer to add and list in its `agent-payer-auth` signature. */
async function tapBuild(_doc: unknown, h: AtrHash): Promise<TapUnsigned | Refusal> {
  const value = normalHash(h);
  if (value === null) return refusal("card/legal-context-malformed");
  return { field: TAP_FIELD, value, component: TAP_FIELD };
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
 * The hash from a TAP payment request: the one `lcp-hash` line, when every `agent-payer-auth` signature lists
 * `"lcp-hash"` without parameters and one of them has its `Signature` member, so whichever payer signature the
 * seller's recognition verifies covers the hash. No signature, key, window or nonce is verified.
 */
async function tapBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented)) return refusal("card/tap-signature-input-malformed");
  const { signatureInput, signature, lcpHash } = presented as unknown as Record<string, unknown>;

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

  const payers = [...inputs].filter(([, m]) => isPayerTag(m.params.get("tag")));
  if (payers.length === 0) return refusal("card/tap-no-payer-signature");
  if (!payers.every(([, m]) => (m as InnerList).list.some(isBareHashComponent))) return refusal("card/tap-hash-not-covered");
  if (!payers.some(([label]) => signatures.has(label))) return refusal("card/tap-signature-missing");

  if (!Array.isArray(lcpHash)) return refusal("card/tap-field-malformed");
  if (lcpHash.length === 0) return refusal("card/tap-field-missing");
  if (lcpHash.length > 1) return refusal("card/tap-field-repeated");
  const line: unknown = lcpHash[0];
  if (typeof line !== "string") return refusal("card/tap-field-malformed");
  if (line.length > MAX_TAP_HASH_LINE) return refusal("card/too-large");
  const h = normalHash(trimSpHtab(line));
  if (h === null) return refusal("card/tap-field-malformed");
  return h;
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
  const issued = await readSdJwt(l1, SD_JWT_CODES, SD_JWT_BOUNDS);
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
  const layer = await readSdJwt(s, SD_JWT_CODES, SD_JWT_BOUNDS);
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
 * JWK. A key WebCrypto will not import is `card/vi-key-malformed`; any other failure is `card/vi-signature-invalid`.
 */
async function verifyEs256(jws: string, jwk: Record<string, unknown>): Promise<true | Refusal> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk["x"] as string, y: jwk["y"] as string },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return refusal("card/vi-key-malformed");
  }
  const cut = jws.lastIndexOf(".");
  const signature = b64urlDecode(jws.slice(cut + 1));
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

const AFTER_AGREEMENT =
  "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
  "recorded in <transaction>. ";

const visaTapPattern: LcpPattern = deepFreeze({
  pattern: "protocol-extension",
  canonical: false,
  profile: "card/visa-tap",
  buyerSigns: true,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    AFTER_AGREEMENT +
    "The buyer's agent sent this ATR's hash in the lcp-hash field and listed that field among the covered components " +
    "of every TAP agent-payer-auth message signature in the request. The seller checked that listing and did not " +
    "verify a signature here, which belongs to its TAP recognition step. The card authorization itself does not carry " +
    "the hash. " +
    "This does not show that amount, payee or timing match the ATR's content.",
});

const viImmediatePattern: LcpPattern = deepFreeze({
  pattern: "id-reuse",
  canonical: true,
  profile: "card/mastercard-vi",
  buyerSigns: true,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    AFTER_AGREEMENT +
    "The user's Verifiable Intent L2 mandate lists a checkout mandate whose checkout_hash is the SHA-256 of a " +
    "checkout_jwt carrying this ATR's hash, and the payment mandate's transaction_id, where disclosed, equals it. The " +
    "seller checked those values and did not verify the user's signature, which Verifiable Intent has the payment " +
    "network validate before authorization. The card authorization itself does not carry the hash. This does not " +
    "show that amount, payee or timing match the ATR's content.",
});

const viAutonomousPattern: LcpPattern = deepFreeze({
  pattern: "id-reuse",
  canonical: true,
  profile: "card/mastercard-vi",
  buyerSigns: true,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    AFTER_AGREEMENT +
    "The buyer's agent signed a Verifiable Intent L3b checkout mandate whose checkout_hash is the SHA-256 of a " +
    "checkout_jwt carrying this ATR's hash, with the key the user's L2 mandate delegates to it. The seller " +
    "verified both ES256 signatures and the sd_hash links, but not the L1 issuer's signature. The user's own " +
    "signature does not cover the hash, and the seller did not see the L3a payment mandate the network received, " +
    "whose transaction_id Verifiable Intent requires to equal this checkout_hash. This does not show that amount, " +
    "payee or timing match the ATR's content.",
});

const sellerReferencePattern: LcpPattern = deepFreeze({
  pattern: "http-advisory",
  canonical: true,
  buyerSigns: false,
  onChain: false,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: false,
  proves:
    AFTER_AGREEMENT +
    "The ATR was in the seller's storage before payment, and its hash and link were given to the seller to show the " +
    "buyer and to place in its processor reference. Nothing the buyer signed carries the hash. The seller checked " +
    "nothing the buyer signed, and settlement is the seller's report. This record does not show that the buyer's " +
    "approval carried the hash.",
});

export const visaTap: CardPairing<"card/visa-tap", TapUnsigned> = Object.freeze({
  id: "card/visa-tap",
  pattern: visaTapPattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readShown,
  build: tapBuild,
  bound: tapBound,
});

export const viImmediate: CardPairing<"card/mastercard-vi/immediate", ViUnsigned> = Object.freeze({
  id: "card/mastercard-vi/immediate",
  pattern: viImmediatePattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readCheckoutShown,
  build: viBuild,
  bound: viImmediateBound,
});

export const viAutonomous: CardPairing<"card/mastercard-vi/autonomous", ViUnsigned> = Object.freeze({
  id: "card/mastercard-vi/autonomous",
  pattern: viAutonomousPattern,
  claims: true,
  unplaced,
  tie,
  advertise,
  read: readCheckoutShown,
  build: viBuild,
  bound: viAutonomousBound,
});

export const sellerReference: CardPairing<"card/seller-reference", never> = Object.freeze({
  id: "card/seller-reference",
  pattern: sellerReferencePattern,
  claims: false,
  unplaced,
  tie,
  advertise,
  read: readShown,
  build: noSignedPlace,
  bound: noSignedPlace,
});

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
 * String fails. A repeated key overwrites the earlier value. Null when the text does not parse; TOO_LARGE past 16
 * members or 32 items in an inner list.
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
    while (s[i] === ";") {
      i++;
      sp();
      const k = key();
      if (k === null) return null;
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

function isPayerTag(v: Bare | undefined): boolean {
  return v !== undefined && v.t === "string" && v.v === PAYER_TAG;
}

/** The String `lcp-hash` with no parameters. */
function isBareHashComponent(it: Item): boolean {
  return it.item.t === "string" && it.item.v === TAP_FIELD && it.params.size === 0;
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
