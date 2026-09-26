/**
 * x402 v2 documents and the `x402/exact/eip155/eip3009` pairing: the ATR hash advertised in the challenge's
 * `extensions.legalContext`, signed by the payer as the EIP-3009 nonce, read back from the payment, and read from the
 * settlement.
 */
import {
  canonicalJson,
  digestJson,
  fromLegalContext,
  hash,
  isHashWithNonHttpsLink,
  isHttpsLink,
  isOtherSchemeLink,
  toLegalContext,
  type AtrHash,
  type Json,
} from "./core.js";
import {
  AUTHORIZATION_USED_TOPIC,
  DELEGATION_MANAGER,
  DELEGATION_MANAGER_CHAINS,
  ESCROW,
  EXACT_PERMIT2_PROXY,
  PAYMENT_AUTHORIZED_TOPIC,
  REDEEMED_DELEGATION_TOPIC,
  TRANSFER_TOPIC,
  UPTO_PERMIT2_PROXY,
  authorizationIdDigest,
  bindSalt,
  decodePermissionContext,
  eip3009Recover,
  eip3009Status,
  eip3009TypedData,
  evmStatus,
  paymentHash,
  permit2TypedData,
  receiveTypedData,
  redeemedLeafRecover,
  transferDigest,
  type Eip155,
  type Eip3009Ref,
  type Eip3009TypedData,
  type EvmReader,
  type EvmRef,
  type Field,
  type Hex,
  type PaymentInfo,
  type Permit2TypedData,
  type ReceiveTypedData,
} from "./evm.js";
import { bytesOf } from "./evm-abi.js";
import { chainIdOf, deepFreeze, isAddress, isObject, normalHash, uint256Of } from "./fields.js";
import { AGREEMENT_URL, agreementIn, agreementRefusal } from "./internal/agreement.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";

export type { Eip3009TypedData } from "./evm.js";

export type PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: { [k: string]: Json };
};

export type PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource: { url: string; [k: string]: Json };
  accepts: PaymentRequirements[];
  extensions?: { [id: string]: { info: Json; schema: Json } };
};

export type Eip3009Authorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

export type Permit2Authorization = {
  permitted: { token: string; amount: string };
  from: string;
  spender: string;
  nonce: string;
  deadline: string;
  witness?: { [k: string]: string };
};

/** The payload of each x402 EVM scheme this package carries; every member is a string. */
export type X402SchemePayload =
  | { signature: Hex; authorization: Eip3009Authorization }
  | { signature: Hex; permit2Authorization: Permit2Authorization }
  | { delegationManager: string; permissionContext: string; delegator: string }
  | { signature: Hex; authorization: Eip3009Authorization; salt: string; saltNonce?: string }
  | { signature: Hex; permit2Authorization: Permit2Authorization; salt: string; saltNonce?: string };

export type PaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: X402SchemePayload;
  extensions?: PaymentRequired["extensions"];
};

/** A payment of the `x402/exact/eip155/eip3009` pairing. */
export type Eip3009Payment = PaymentPayload & { payload: { signature: Hex; authorization: Eip3009Authorization } };

/** An HTTP request as received: the method token, the raw origin-form target and the body bytes. */
export interface HttpRequest {
  method: string;
  target: string;
  body: Uint8Array;
}

export type RequestCommitment = { method: string; path: string; query: string; bodyDigest: AtrHash };

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

export type LcpPattern = {
  pattern:
    | "native-field"
    | "overlay-contract"
    | "sidecar-attestation"
    | "opaque-challenge"
    | "id-reuse"
    | "protocol-extension"
    | "http-advisory"
    | "truncated-field";
  canonical: boolean;
  profile?: string;
  buyerSigns: boolean;
  onChain: boolean;
  zeroPartyRecoverable: boolean;
  forwardIndexable: boolean;
  publicProof: boolean;
  proves: string;
  /**
   * Where the buyer signs no hash, what identifies one payment. Absent: the pairing's `reference` for that payment.
   * `"landed"`: the buyer presents standing authority, redeemed once per payment, so a payment is the transfer that
   * lands, and the landed transaction is the instrument.
   */
  instrument?: "landed";
};

export interface X402Offer {
  required: PaymentRequired;
  options: readonly PaymentRequirements[];
}

export interface X402Choice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  from: Hex;
  now: number;
}

export interface Unsigned {
  typedData: Eip3009TypedData;
  complete(signature: Hex): PaymentPayload | Refusal;
}

const ID = "x402/exact/eip155/eip3009" as const;
const MAX_TARGET = 8192;
const MAX_BODY = 1_048_576;
const MAX_OPTIONS = 32;
const MAX_LINK = 2048;
const MAX_SIGNATURE_BYTES = 8192;
const MIN_SIGNED_BYTES = 65;
const HEX_BODY = /^0x[0-9a-fA-F]*$/;

/**
 * The commitment to the request a challenge answers: the method as received, the target split at its first `?`, and
 * SHA-256 over the body bytes exactly as received.
 */
export async function requestCommitment(r: HttpRequest): Promise<RequestCommitment | Refusal> {
  if (typeof r.method !== "string" || typeof r.target !== "string") return refusal("x402/request-target-invalid");
  if (!(r.body instanceof Uint8Array)) return refusal("x402/request-target-invalid");
  if (r.target.length > MAX_TARGET || r.body.length > MAX_BODY) return refusal("x402/request-too-large");
  if (!r.target.startsWith("/") || !isVisibleAscii(r.target)) return refusal("x402/request-target-invalid");
  const q = r.target.indexOf("?");
  const path = q === -1 ? r.target : r.target.slice(0, q);
  const query = q === -1 ? "" : r.target.slice(q + 1);
  return { method: r.method, path, query, bodyDigest: await hash(r.body) };
}

/** SHA-256 over the RFC 8785 form of an issued option or request commitment. */
export async function issuedDigest(v: PaymentRequirements | RequestCommitment): Promise<Hex | Refusal> {
  return digestJson(v);
}

/** The x402 EVM pairing an option names, or undefined. */
function evmPairingOf(option: PaymentRequirements): X402PairingId | undefined {
  const f = optionFilter(option);
  return typeof f === "string" ? f : undefined;
}

/** The EIP-3009 `exact` filter: this pairing's id for an option it can pay, or undefined. */
function eip3009Of(option: PaymentRequirements): typeof ID | undefined {
  if (!isObject(option)) return undefined;
  if (option.scheme !== "exact") return undefined;
  if (chainIdOf(option.network) === undefined) return undefined;
  const extra: unknown = option.extra;
  if (extra !== undefined && !isObject(extra)) return undefined;
  const method = extra?.["assetTransferMethod"];
  if (method !== undefined && method !== "eip3009") return undefined;
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization" && flow !== "upfront") return undefined;
  return ID;
}

/** The binding slot: every option the challenge offers, exactly as issued, and the request they answer. */
export function tie(
  accepts: readonly PaymentRequirements[],
  request: RequestCommitment,
): ["x402", { accepts: readonly PaymentRequirements[]; request: RequestCommitment }] {
  return ["x402", { accepts, request }];
}

/**
 * A pairing's option filter: `true` for an option the pairing serves, a refusal naming why an option of this pairing
 * cannot be served, and undefined for an option that is not this pairing's.
 */
export type OptionFilter = (option: PaymentRequirements) => true | Refusal | undefined;

/** An x402 v2 payment whose `payload` is the pairing's own. */
export type X402Payment<P> = Omit<PaymentPayload, "payload"> & { payload: P };

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

/** A pairing's `advertise`: the document with the legal context placed, and the agreement URL when one is given. */
export type X402Advertise = (
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
) => PaymentRequired | Refusal;

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
    if (!isLink(link)) return refusal(isOtherSchemeLink(link) ? "x402/link-not-https" : "x402/legal-context-malformed");
    const agreementFaulted = agreementRefusal("x402", agreementUrl);
    if (agreementFaulted !== undefined) return agreementFaulted;
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

/** What a pairing's `read` returns: the hash, the link, the agreement URL when the document carries one, the offer. */
export interface X402Read {
  h: AtrHash;
  link: string;
  agreement?: string;
  offer: X402Offer;
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
    if (typeof agreement === "object") return refusal(`x402/${agreement.fault}`);
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

/** The payment for the chosen option: the challenge's `resource` and `extensions` unchanged, omitted when absent. */
export function paymentWith<P>(required: PaymentRequired, accepted: PaymentRequirements, payload: P): X402Payment<P> {
  return {
    x402Version: 2,
    ...(required.resource !== undefined ? { resource: required.resource } : {}),
    accepted,
    payload,
    ...(required.extensions !== undefined ? { extensions: required.extensions } : {}),
  };
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

/** A copy of an option with `extra[key]` removed; `extra` itself is removed when that leaves it empty. */
export function withoutExtra(option: PaymentRequirements, key: string): PaymentRequirements {
  if (!isObject(option) || !isObject(option.extra) || !(key in option.extra)) return option;
  const { [key]: _, ...rest } = option.extra;
  const { extra: __, ...base } = option;
  return Object.keys(rest).length === 0 ? base : { ...base, extra: rest };
}

/** The filter of EVM pairing `id` at advertise: the option names `id`, and `build` can pay it. */
function evmServes(id: X402PairingId, payable: (o: PaymentRequirements) => boolean): OptionFilter {
  return (o) => {
    const f = optionFilter(o);
    if (isRefusal(f)) return o.scheme === schemeOf(id) ? f : undefined;
    if (f !== optionIdOf(id)) return undefined;
    return payable(o) ? true : refusal("x402/option-malformed");
  };
}

/** The filter of EVM pairing `id` at read: the option names `id`. */
function evmNames(id: X402PairingId): OptionFilter {
  return (o) => (evmPairingOf(o) === optionIdOf(id) ? true : undefined);
}

/** The `TransferWithAuthorization` the payer signs for the chosen option, with the hash as its nonce. */
async function build(choice: X402Choice, h: AtrHash): Promise<Unsigned | Refusal> {
  const { required, accepted, from, now } = choice;
  if (!isObject(required) || required.x402Version !== 2) return refusal("x402/not-v2");
  if (!Array.isArray(required.accepts) || required.accepts.length > MAX_OPTIONS) return refusal("x402/option-malformed");
  if (!isOffered(required.accepts, accepted)) return refusal("x402/option-not-in-document");
  if (evmPairingOf(accepted) !== ID) return refusal("x402/option-not-this-pairing");
  if (!isPayable(accepted)) return refusal("x402/option-malformed");
  if (!isAddress(from) || !Number.isSafeInteger(now) || now < 0) return refusal("x402/option-malformed");
  const nonce = normalHash(h);
  if (nonce === null) return refusal("x402/payload-malformed");

  const validBefore = BigInt(now) + BigInt(accepted.maxTimeoutSeconds);
  const typedData = eip3009TypedData({
    network: accepted.network as Eip155,
    asset: accepted.asset as Hex,
    name: accepted.extra!["name"] as string,
    version: accepted.extra!["version"] as string,
    from,
    to: accepted.payTo as Hex,
    value: accepted.amount,
    validAfter: 0n,
    validBefore,
    nonce,
  });
  if (isRefusal(typedData)) return typedData;

  const authorization = {
    from,
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: "0",
    validBefore: validBefore.toString(),
    nonce,
  };
  return {
    typedData,
    complete(signature: Hex): PaymentPayload | Refusal {
      if (!isSignature(signature, MIN_SIGNED_BYTES)) return refusal("x402/signature-malformed");
      return {
        x402Version: 2,
        ...(required.resource !== undefined ? { resource: required.resource } : {}),
        accepted,
        payload: { signature, authorization: { ...authorization } },
        ...(required.extensions !== undefined ? { extensions: required.extensions } : {}),
      };
    },
  };
}

/**
 * The hash inside what the payer signed: the authorization's nonce, lowercase. The signature is not verified here;
 * the token contract verifies it when it executes the transfer.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = paymentOf(presented);
  if (isRefusal(p)) return p;
  const nonce = normalHash(p.payload.authorization.nonce);
  if (nonce === null) return refusal("x402/payload-malformed");
  return nonce;
}

/**
 * The read keys for finding this payment on chain later: network, token, `validBefore`, the option's
 * `maxTimeoutSeconds` and the transfer's digest, and the same keys as an `EvmRef`: the `AuthorizationUsed` log carrying
 * H, the transfer's identity, and the nonce search.
 */
async function reference(presented: unknown): Promise<Eip3009Ref | Refusal> {
  const h = await bound(presented);
  if (isRefusal(h)) return h;
  const { accepted, payload } = presented as Eip3009Payment;
  const a = payload.authorization;
  const validBefore = uint256Of(a.validBefore);
  if (!isAddress(a.from) || !isAddress(a.to) || uint256Of(a.value) === undefined || validBefore === undefined) {
    return refusal("x402/payload-malformed");
  }
  const timeout = accepted.maxTimeoutSeconds;
  if (!isAddress(accepted.asset) || !Number.isSafeInteger(timeout) || timeout <= 0) return refusal("x402/option-malformed");
  const idDigest = await authorizationIdDigest(a.from, a.to, a.value);
  if (isRefusal(idDigest)) return idDigest;
  const asset = accepted.asset as Hex;
  return {
    network: accepted.network as Eip155,
    asset,
    validBefore: validBefore.toString(),
    maxTimeoutSeconds: timeout,
    idDigest,
    bindingLog: { address: asset, topic0: AUTHORIZATION_USED_TOPIC, index: 2, value: h },
    transferLog: { address: asset, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest: idDigest },
    search: { address: asset, topics: [AUTHORIZATION_USED_TOPIC, null, h] },
  };
}

/** The option unchanged: on this pairing the hash rides in the authorization, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: ID,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: true,
  publicProof: true,
  proves:
    "The payer signed an EIP-3009 transfer authorization whose nonce is this ATR's hash. The token contract verified " +
    "that signature when it executed the transfer, and the hash is on chain as the nonce topic of its " +
    "AuthorizationUsed event in the settlement transaction. This does not show that amount, payee, asset or timing " +
    "match the ATR's content.",
});

export const exactEip3009 = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseFor(evmServes(ID, isPayable)),
  read: readFor(evmNames(ID)),
  build,
  bound,
  reference,
  status: eip3009Status,
  recover: eip3009Recover,
});

/** The payment's shape as this pairing requires it, or the refusal that names what is wrong. */
function paymentOf(presented: unknown): Eip3009Payment | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isObject(accepted)) return refusal("x402/payload-malformed");
  if (evmPairingOf(accepted as PaymentRequirements) !== ID) return refusal("x402/option-not-this-pairing");
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  const a = payload["authorization"];
  if (!isObject(a)) return refusal("x402/payload-malformed");
  for (const k of ["from", "to", "value", "validAfter", "validBefore", "nonce"]) {
    if (typeof a[k] !== "string") return refusal("x402/payload-malformed");
  }
  if (!isSignature(payload["signature"], 1)) return refusal("x402/signature-malformed");
  return presented as Eip3009Payment;
}

/** True for an option `build` can turn into typed data. */
function isPayable(o: PaymentRequirements): boolean {
  const extra = o.extra;
  return (
    isObject(extra) &&
    typeof extra["name"] === "string" &&
    extra["name"] !== "" &&
    typeof extra["version"] === "string" &&
    extra["version"] !== "" &&
    isAddress(o.asset) &&
    isAddress(o.payTo) &&
    uint256Of(o.amount) !== undefined &&
    Number.isSafeInteger(o.maxTimeoutSeconds) &&
    o.maxTimeoutSeconds > 0
  );
}

/** True when `offer` is one of `accepts`, by identity or by equal RFC 8785 form. */
function isOffered(accepts: readonly PaymentRequirements[], offer: PaymentRequirements): boolean {
  return accepts.some((a) => a === offer || sameJson(a, offer));
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false;
  const x = canonicalJson(a as Json);
  const y = canonicalJson(b as Json);
  return typeof x === "string" && x === y;
}

function isLink(s: unknown): s is string {
  return typeof s === "string" && s.length <= MAX_LINK && isHttpsLink(s);
}

/** `0x` and an even number of hex digits, from `minBytes` to 8 KiB. */
function isSignature(s: unknown, minBytes: number): s is Hex {
  if (typeof s !== "string" || s.length % 2 !== 0 || !HEX_BODY.test(s)) return false;
  const bytes = (s.length - 2) / 2;
  return bytes >= minBytes && bytes <= MAX_SIGNATURE_BYTES;
}

function isVisibleAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}


// ── EVM breadth: `exact` over Permit2 and ERC-7710, `upto` over Permit2, and `auth-capture` on the
// commerce-payments escrow.

export type X402PairingId =
  | typeof ID
  | "x402/exact/eip155/permit2"
  | "x402/exact/eip155/erc7710"
  | "x402/exact/eip155/erc7710-salt"
  | "x402/upto/eip155/permit2"
  | "x402/auth-capture/eip155/eip3009"
  | "x402/auth-capture/eip155/permit2";

const PERMIT2_EXACT = "x402/exact/eip155/permit2" as const;
const ERC7710 = "x402/exact/eip155/erc7710" as const;
const ERC7710_SALT = "x402/exact/eip155/erc7710-salt" as const;
const PERMIT2_UPTO = "x402/upto/eip155/permit2" as const;
const AC_EIP3009 = "x402/auth-capture/eip155/eip3009" as const;
const AC_PERMIT2 = "x402/auth-capture/eip155/permit2" as const;

const MAX_MEMBER = 256;
const NONCE_DECIMAL = /^[0-9]{1,78}$/;
const NONCE_HEX = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;
const AUTH_CAPTURE_REQUIRED = [
  "captureAuthorizer",
  "captureDeadline",
  "refundDeadline",
  "feeRecipient",
  "minFeeBps",
  "maxFeeBps",
  "name",
  "version",
] as const;

/** What a breadth pairing's `build` asks the buyer's signer for, and how the answer completes the payment. */
export type X402Unsigned =
  | {
      request: { kind: "eip712"; typedData: Permit2TypedData | Eip3009TypedData | ReceiveTypedData };
      complete(sig: Hex): PaymentPayload | Refusal;
    }
  | {
      request: { kind: "erc7710"; chainId: number; token: Hex; payTo: Hex; amount: bigint; salt: AtrHash };
      complete(d: { delegationManager: Hex; permissionContext: Hex; delegator: Hex }): PaymentPayload | Refusal;
    };

function schemeOf(id: X402PairingId): string {
  return id.split("/")[1]!;
}

/**
 * The pairing whose option a payment through `pairing` pays: a payment at the ERC-7710 salt level pays the `erc7710`
 * option (both levels share it); a payment through any other pairing pays an option of its own.
 */
export function optionPairingOf(pairing: string): string {
  return pairing === ERC7710_SALT ? ERC7710 : pairing;
}

/** The option-level pairing of an EVM pairing. */
function optionIdOf(id: X402PairingId): X402PairingId {
  return optionPairingOf(id) as X402PairingId;
}

/**
 * The option filter over every x402 EVM pairing: the pairing an option names, a refusal naming what is wrong with an
 * option of a scheme this package carries, or undefined for any other option.
 */
function optionFilter(option: PaymentRequirements): X402PairingId | Refusal | undefined {
  if (!isObject(option)) return undefined;
  const extra: unknown = option.extra;
  if (extra !== undefined && !isObject(extra)) return undefined;
  if (option.scheme === "exact") {
    const method = extra?.["assetTransferMethod"];
    if (method === undefined || method === "eip3009") return eip3009Of(option);
    if (chainIdOf(option.network) === undefined || !isAddress(option.asset) || !isAddress(option.payTo)) return undefined;
    const flow = extra?.["paymentFlow"];
    if (flow !== undefined && flow !== "authorization" && flow !== "upfront") return undefined;
    if (method === "permit2") return PERMIT2_EXACT;
    if (method === "erc7710") return ERC7710;
    return undefined;
  }
  if (option.scheme === "upto") {
    if (chainIdOf(option.network) === undefined || !isAddress(option.asset) || !isAddress(option.payTo)) return undefined;
    if (!isAddress(extra?.["facilitatorAddress"])) return refusal("x402/facilitator-missing");
    return PERMIT2_UPTO;
  }
  if (option.scheme === "auth-capture") {
    if (chainIdOf(option.network) === undefined || !isAddress(option.asset) || !isAddress(option.payTo)) return undefined;
    if (extra === undefined || AUTH_CAPTURE_REQUIRED.some((k) => extra[k] === undefined)) {
      return refusal("x402/option-malformed");
    }
    if (deploymentOf(extra) === undefined) return refusal("x402/escrow-not-canonical");
    const flow = extra["paymentFlow"];
    if (flow !== undefined && flow !== "escrow" && flow !== "authorization") return refusal("x402/flow-not-carried");
    if (extra["autoCapture"] === true) return refusal("x402/flow-not-carried");
    const method = extra["assetTransferMethod"];
    if (method === undefined || method === "eip3009") return AC_EIP3009;
    if (method === "permit2") return AC_PERMIT2;
    return undefined;
  }
  return undefined;
}

/** The escrow deployment an auth-capture option names: absent or v1.1's escrow gives v1.1, v1.0's gives v1.0. */
function deploymentOf(extra: Record<string, unknown>): (typeof ESCROW)["v1.1"] | undefined {
  const named = extra["authCaptureEscrow"];
  if (named === undefined) return ESCROW["v1.1"];
  if (typeof named !== "string") return undefined;
  for (const d of [ESCROW["v1.1"], ESCROW["v1.0"]]) if (named.toLowerCase() === d.escrow.toLowerCase()) return d;
  return undefined;
}

/**
 * The pairing that serves a presented payment: `pairingOf` of its `accepted`, except that an `erc7710` payment whose
 * delegation manager is MetaMask's reference DelegationManager, on a chain where it is deployed, is the salt level.
 */
export function pairingOfPayment(p: PaymentPayload): X402PairingId | undefined {
  if (!isObject(p) || !isObject(p.accepted)) return undefined;
  const id = evmPairingOf(p.accepted);
  if (id !== ERC7710) return id;
  const payload: unknown = p.payload;
  const manager = isObject(payload) ? payload["delegationManager"] : undefined;
  return isReferenceManager(manager, p.accepted.network) ? ERC7710_SALT : ERC7710;
}

function isReferenceManager(manager: unknown, network: unknown): boolean {
  const chainId = chainIdOf(network);
  return (
    typeof manager === "string" &&
    manager.toLowerCase() === DELEGATION_MANAGER.toLowerCase() &&
    chainId !== undefined &&
    DELEGATION_MANAGER_CHAINS.includes(chainId)
  );
}

/** An option `build` can use: its amount and time bound, and for auth-capture the token's EIP-712 name and version. */
function isBreadthPayable(id: X402PairingId) {
  return (o: PaymentRequirements): boolean =>
    isObject(o) &&
    uint256Of(o.amount) !== undefined &&
    Number.isSafeInteger(o.maxTimeoutSeconds) &&
    o.maxTimeoutSeconds > 0 &&
    (schemeOf(id) !== "auth-capture" ||
      (isObject(o.extra) && isNonEmpty(o.extra["name"]) && isNonEmpty(o.extra["version"])));
}

/** The checks every breadth `build` makes on the choice, giving the chain id, the `now + maxTimeoutSeconds` bound and H. */
function choiceOf(
  id: X402PairingId,
  choice: X402Choice,
  h: AtrHash,
): { chainId: number; deadline: bigint; h: AtrHash } | Refusal {
  const { required, accepted, from, now } = choice;
  if (!isObject(required) || required.x402Version !== 2) return refusal("x402/not-v2");
  if (!Array.isArray(required.accepts) || required.accepts.length > MAX_OPTIONS) return refusal("x402/option-malformed");
  if (!isOffered(required.accepts, accepted)) return refusal("x402/option-not-in-document");
  const f = optionFilter(accepted);
  if (isRefusal(f)) return f;
  if (f !== optionIdOf(id)) return refusal("x402/option-not-this-pairing");
  if (!isBreadthPayable(id)(accepted)) return refusal("x402/option-malformed");
  if (!isAddress(from) || !Number.isSafeInteger(now) || now < 0) return refusal("x402/option-malformed");
  const nonce = normalHash(h);
  if (nonce === null) return refusal("x402/payload-malformed");
  return { chainId: chainIdOf(accepted.network)!, deadline: BigInt(now) + BigInt(accepted.maxTimeoutSeconds), h: nonce };
}


/** A presented payment whose `accepted` names pairing `id`, with its payload as an object. */
function presentedAs(id: X402PairingId, presented: unknown): { p: PaymentPayload; payload: Record<string, unknown> } | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isObject(accepted)) return refusal("x402/payload-malformed");
  const f = optionFilter(accepted as PaymentRequirements);
  if (isRefusal(f)) return accepted["scheme"] === schemeOf(id) ? f : refusal("x402/option-not-this-pairing");
  if (f !== optionIdOf(id)) return refusal("x402/option-not-this-pairing");
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("x402/payload-malformed");
  return { p: presented as unknown as PaymentPayload, payload };
}

/** The string members named, each at most 256 characters, or undefined. */
function strings<K extends string>(o: unknown, keys: readonly K[]): { [k in K]: string } | undefined {
  if (!isObject(o)) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v !== "string" || v.length > MAX_MEMBER) return undefined;
  }
  return o as { [k in K]: string };
}

/** A Permit2 nonce as decimal digits or 0x + 64 hex, below 2^256, as 32 big-endian bytes. */
function nonceAsHash(n: string): AtrHash | undefined {
  if (NONCE_HEX.test(n)) return normalHash(n) ?? undefined;
  if (!NONCE_DECIMAL.test(n)) return undefined;
  const v = BigInt(n);
  if (v >= 1n << 256n) return undefined;
  return ("0x" + v.toString(16).padStart(64, "0")) as AtrHash;
}

// ── `exact` and `upto` over Permit2.

const WITNESS_EXACT: readonly Field[] = Object.freeze([
  { name: "to", type: "address" },
  { name: "validAfter", type: "uint256" },
]);
const WITNESS_UPTO: readonly Field[] = Object.freeze([
  { name: "to", type: "address" },
  { name: "facilitator", type: "address" },
  { name: "validAfter", type: "uint256" },
]);

function permit2Build(id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO) {
  return async (choice: X402Choice, h: AtrHash): Promise<X402Unsigned | Refusal> => {
    const c = choiceOf(id, choice, h);
    if (isRefusal(c)) return c;
    const { required, accepted, from } = choice;
    const upto = id === PERMIT2_UPTO;
    const spender = upto ? UPTO_PERMIT2_PROXY : EXACT_PERMIT2_PROXY;
    const facilitator = upto ? (accepted.extra!["facilitatorAddress"] as Hex) : undefined;
    const witness: { [k: string]: string } = upto
      ? { to: accepted.payTo, facilitator: facilitator!, validAfter: "0" }
      : { to: accepted.payTo, validAfter: "0" };
    const typedData = permit2TypedData({
      chainId: c.chainId,
      permitted: { token: accepted.asset as Hex, amount: BigInt(accepted.amount) },
      spender,
      nonce: BigInt(c.h),
      deadline: c.deadline,
      witness: { type: "Witness", fields: upto ? WITNESS_UPTO : WITNESS_EXACT, value: witness },
    });
    if (isRefusal(typedData)) return typedData;
    const permit2Authorization: Permit2Authorization = {
      permitted: { token: accepted.asset, amount: accepted.amount },
      from,
      spender,
      nonce: upto ? c.h : BigInt(c.h).toString(),
      deadline: c.deadline.toString(),
      witness,
    };
    return {
      request: { kind: "eip712", typedData },
      complete(signature: Hex): PaymentPayload | Refusal {
        if (!isSignature(signature, MIN_SIGNED_BYTES)) return refusal("x402/signature-malformed");
        return paymentWith(required, accepted, { signature, permit2Authorization: structuredClone(permit2Authorization) });
      },
    };
  };
}

/** The Permit2 authorization of a presented `exact` or `upto` payment, with H from its nonce. */
function permit2Presented(
  id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO,
  presented: unknown,
): { p: PaymentPayload; a: Permit2Authorization & { witness: { [k: string]: string } }; h: AtrHash } | Refusal {
  const got = presentedAs(id, presented);
  if (isRefusal(got)) return got;
  if (!isSignature(got.payload["signature"], 1)) return refusal("x402/signature-malformed");
  const a = strings(got.payload["permit2Authorization"], ["from", "spender", "nonce", "deadline"] as const);
  const permitted = strings(isObject(a) ? (a as Record<string, unknown>)["permitted"] : undefined, ["token", "amount"] as const);
  const witness = strings(isObject(a) ? (a as Record<string, unknown>)["witness"] : undefined, ["to"] as const);
  if (a === undefined || permitted === undefined || witness === undefined) return refusal("x402/payload-malformed");
  const proxy = id === PERMIT2_UPTO ? UPTO_PERMIT2_PROXY : EXACT_PERMIT2_PROXY;
  if (a.spender.toLowerCase() !== proxy.toLowerCase()) return refusal("x402/spender-not-proxy");
  if (id === PERMIT2_UPTO && strings(witness, ["facilitator"] as const) === undefined) {
    return refusal("x402/payload-malformed");
  }
  const h = nonceAsHash(a.nonce);
  if (h === undefined) return refusal("x402/nonce-malformed");
  return { p: got.p, a: a as Permit2Authorization & { witness: { [k: string]: string } }, h };
}

function permit2Bound(id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO) {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    const r = permit2Presented(id, presented);
    return isRefusal(r) ? r : r.h;
  };
}

function permit2Reference(id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO) {
  return async (presented: unknown): Promise<EvmRef | Refusal> => {
    const r = permit2Presented(id, presented);
    if (isRefusal(r)) return r;
    const { a, p } = r;
    const deadline = uint256Of(a.deadline);
    const value = uint256Of(a.permitted.amount);
    if (!isAddress(a.from) || !isAddress(a.witness["to"]) || deadline === undefined || value === undefined) {
      return refusal("x402/payload-malformed");
    }
    const upto = id === PERMIT2_UPTO;
    const digest = await transferDigest(
      upto ? { from: a.from, to: a.witness["to"] as Hex } : { from: a.from, to: a.witness["to"] as Hex, value },
    );
    if (isRefusal(digest)) return refusal("x402/payload-malformed");
    return {
      network: p.accepted.network as Eip155,
      settleBy: deadline.toString(),
      transferLog: { address: p.accepted.asset as Hex, topic0: TRANSFER_TOPIC, identity: upto ? "from,to" : "from,to,value", digest },
    };
  };
}

// ── `exact` over ERC-7710: the unsigned level and the salt level.

async function erc7710Build(choice: X402Choice, h: AtrHash): Promise<X402Unsigned | Refusal> {
  const c = choiceOf(ERC7710, choice, h);
  if (isRefusal(c)) return c;
  const { required, accepted } = choice;
  return {
    request: {
      kind: "erc7710",
      chainId: c.chainId,
      token: accepted.asset as Hex,
      payTo: accepted.payTo as Hex,
      amount: BigInt(accepted.amount),
      salt: c.h,
    },
    complete(d: { delegationManager: Hex; permissionContext: Hex; delegator: Hex }): PaymentPayload | Refusal {
      if (!isObject(d) || !isAddress(d.delegationManager) || !isAddress(d.delegator)) {
        return refusal("x402/payload-malformed");
      }
      if (bytesOf(d.permissionContext, MAX_CONTEXT) === undefined) return refusal("x402/permission-context-malformed");
      return paymentWith(required, accepted, {
        delegationManager: d.delegationManager,
        permissionContext: d.permissionContext,
        delegator: d.delegator,
      });
    },
  };
}

const MAX_CONTEXT = 32_768;

/** The ERC-7710 payload of a presented payment. */
function erc7710Presented(
  id: typeof ERC7710 | typeof ERC7710_SALT,
  presented: unknown,
): { p: PaymentPayload; d: { delegationManager: string; permissionContext: string; delegator: string } } | Refusal {
  const got = presentedAs(id, presented);
  if (isRefusal(got)) return got;
  const d = strings(got.payload, ["delegationManager", "delegator"] as const);
  const ctx = got.payload["permissionContext"];
  if (d === undefined || typeof ctx !== "string" || ctx.length > 2 + 2 * MAX_CONTEXT) {
    return refusal("x402/payload-malformed");
  }
  return { p: got.p, d: { delegationManager: d.delegationManager, delegator: d.delegator, permissionContext: ctx } };
}

/** The unsigned level: H from the echoed `extensions.legalContext.info`. */
async function erc7710Bound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = erc7710Presented(ERC7710, presented);
  if (isRefusal(r)) return r;
  const lc = isObject(r.p.extensions) ? r.p.extensions[LEGAL_CONTEXT] : undefined;
  const decoded = fromLegalContext({ legalContext: isObject(lc) ? lc["info"] : undefined });
  return decoded === null ? refusal("x402/no-legal-context") : decoded.h;
}

/** The salt level: H is the signed salt of the permission context's leaf delegation. */
async function erc7710SaltBound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = erc7710Presented(ERC7710_SALT, presented);
  if (isRefusal(r)) return r;
  if (!isReferenceManager(r.d.delegationManager, r.p.accepted.network)) return refusal("x402/manager-not-reference");
  const delegations = decodePermissionContext(r.d.permissionContext as Hex);
  if (isRefusal(delegations)) return refusal("x402/permission-context-malformed");
  if (delegations.length === 0) return refusal("x402/delegation-empty");
  return delegations[0]!.salt;
}

/**
 * The read keys: the network, and the token's `Transfer` from the delegator to the option's `payTo`; at the salt level
 * also the manager's `RedeemedDelegation` whose leaf salt is H.
 */
function erc7710Reference(id: typeof ERC7710 | typeof ERC7710_SALT) {
  return async (presented: unknown): Promise<EvmRef | Refusal> => {
    const h = await (id === ERC7710 ? erc7710Bound(presented) : erc7710SaltBound(presented));
    if (isRefusal(h)) return h;
    const { p, d } = erc7710Presented(id, presented) as { p: PaymentPayload; d: { delegator: string } };
    if (!isAddress(d.delegator) || !isAddress(p.accepted.payTo)) return refusal("x402/payload-malformed");
    const digest = await transferDigest({ from: d.delegator, to: p.accepted.payTo });
    if (isRefusal(digest)) return refusal("x402/payload-malformed");
    const ref: EvmRef = {
      network: p.accepted.network as Eip155,
      transferLog: { address: p.accepted.asset as Hex, topic0: TRANSFER_TOPIC, identity: "from,to", digest },
    };
    if (id === ERC7710_SALT) {
      ref.bindingLog = { address: DELEGATION_MANAGER, topic0: REDEEMED_DELEGATION_TOPIC, dataWord: 5, value: h };
    }
    return ref;
  };
}

// ── `auth-capture` on the commerce-payments escrow.

interface AuthCaptureTerms {
  chainId: number;
  deployment: (typeof ESCROW)["v1.1"];
  bound: boolean;
  receiverAuthorizer: Hex;
  policy: Hex;
  flow: "escrow" | "authorization";
  info: (payer: Hex, salt: Hex, preApprovalExpiry: bigint) => PaymentInfo;
}

/** The escrow terms an auth-capture option fixes, or `x402/option-malformed`. */
function authCaptureTerms(o: PaymentRequirements): AuthCaptureTerms | Refusal {
  const extra = o.extra as Record<string, unknown>;
  const deployment = deploymentOf(extra)!;
  const address = (k: string, fallback?: Hex): Hex | undefined => {
    const v = extra[k] ?? fallback;
    return isAddress(v) ? v : undefined;
  };
  const operator = address("captureAuthorizer");
  const feeReceiver = address("feeRecipient");
  const receiverAuthorizer = address("receiverAuthorizer", ZERO_ADDRESS);
  const policy = address("policy", ZERO_ADDRESS);
  const authorizationExpiry = uintMember(extra["captureDeadline"]);
  const refundExpiry = uintMember(extra["refundDeadline"]);
  const minFeeBps = uintMember(extra["minFeeBps"]);
  const maxFeeBps = uintMember(extra["maxFeeBps"]);
  const maxAmount = uint256Of(o.amount);
  if (operator === undefined || feeReceiver === undefined || receiverAuthorizer === undefined || policy === undefined) {
    return refusal("x402/option-malformed");
  }
  if (authorizationExpiry === undefined || refundExpiry === undefined || maxAmount === undefined) {
    return refusal("x402/option-malformed");
  }
  if (minFeeBps === undefined || maxFeeBps === undefined || minFeeBps > 65535n || maxFeeBps > 65535n) {
    return refusal("x402/option-malformed");
  }
  const zero = (a: Hex) => a.toLowerCase() === ZERO_ADDRESS;
  return {
    chainId: chainIdOf(o.network)!,
    deployment,
    bound: !zero(receiverAuthorizer) || !zero(policy),
    receiverAuthorizer,
    policy,
    flow: extra["paymentFlow"] === "authorization" ? "authorization" : "escrow",
    info: (payer, salt, preApprovalExpiry) => ({
      operator,
      payer,
      receiver: o.payTo as Hex,
      token: o.asset as Hex,
      maxAmount,
      preApprovalExpiry,
      authorizationExpiry,
      refundExpiry,
      minFeeBps: Number(minFeeBps),
      maxFeeBps: Number(maxFeeBps),
      feeReceiver,
      salt,
    }),
  };
}

/** A non-negative safe integer, or its decimal string, as a bigint. */
function uintMember(v: unknown): bigint | undefined {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : undefined;
  return uint256Of(v);
}

function authCaptureBuild(id: typeof AC_EIP3009 | typeof AC_PERMIT2) {
  return async (choice: X402Choice, h: AtrHash): Promise<X402Unsigned | Refusal> => {
    const c = choiceOf(id, choice, h);
    if (isRefusal(c)) return c;
    const { required, accepted, from } = choice;
    const t = authCaptureTerms(accepted);
    if (isRefusal(t)) return t;
    const salt = t.bound ? bindSalt(t.receiverAuthorizer, t.policy, c.h) : c.h;
    if (isRefusal(salt)) return refusal("x402/option-malformed");
    const signatureNonce = paymentHash(t.chainId, t.deployment.escrow, t.info(ZERO_ADDRESS, salt, c.deadline));
    if (isRefusal(signatureNonce)) return refusal("x402/option-malformed");
    const salts = t.bound ? { salt, saltNonce: c.h } : { salt };
    if (id === AC_EIP3009) {
      const typedData = receiveTypedData({
        network: accepted.network as Eip155,
        asset: accepted.asset as Hex,
        name: accepted.extra!["name"] as string,
        version: accepted.extra!["version"] as string,
        from,
        to: t.deployment.eip3009Collector,
        value: accepted.amount,
        validAfter: 0n,
        validBefore: c.deadline,
        nonce: signatureNonce,
      });
      if (isRefusal(typedData)) return typedData;
      const authorization: Eip3009Authorization = {
        from,
        to: t.deployment.eip3009Collector,
        value: accepted.amount,
        validAfter: "0",
        validBefore: c.deadline.toString(),
        nonce: signatureNonce,
      };
      return {
        request: { kind: "eip712", typedData },
        complete(signature: Hex): PaymentPayload | Refusal {
          if (!isSignature(signature, MIN_SIGNED_BYTES)) return refusal("x402/signature-malformed");
          return paymentWith(required, accepted, { signature, authorization: { ...authorization }, ...salts });
        },
      };
    }
    const typedData = permit2TypedData({
      chainId: t.chainId,
      permitted: { token: accepted.asset as Hex, amount: BigInt(accepted.amount) },
      spender: t.deployment.permit2Collector,
      nonce: BigInt(signatureNonce),
      deadline: c.deadline,
    });
    if (isRefusal(typedData)) return typedData;
    const permit2Authorization: Permit2Authorization = {
      permitted: { token: accepted.asset, amount: accepted.amount },
      from,
      spender: t.deployment.permit2Collector,
      nonce: BigInt(signatureNonce).toString(),
      deadline: c.deadline.toString(),
    };
    return {
      request: { kind: "eip712", typedData },
      complete(signature: Hex): PaymentPayload | Refusal {
        if (!isSignature(signature, MIN_SIGNED_BYTES)) return refusal("x402/signature-malformed");
        return paymentWith(required, accepted, {
          signature,
          permit2Authorization: structuredClone(permit2Authorization),
          ...salts,
        });
      },
    };
  };
}

/**
 * A presented auth-capture payment: H (the salt when unbound, the saltNonce when bound, whose commitment must be the
 * salt), the payer, and the signed nonce checked against the `signatureNonce` recomputed with payer zero.
 */
function authCapturePresented(
  id: typeof AC_EIP3009 | typeof AC_PERMIT2,
  presented: unknown,
): { h: AtrHash; p: PaymentPayload; t: AuthCaptureTerms; payer: Hex; salt: Hex; preApprovalExpiry: bigint } | Refusal {
  const got = presentedAs(id, presented);
  if (isRefusal(got)) return got;
  const { p, payload } = got;
  if (!isSignature(payload["signature"], 1)) return refusal("x402/signature-malformed");
  const t = authCaptureTerms(p.accepted);
  if (isRefusal(t)) return t;
  const salt = saltOf(payload["salt"]);
  if (salt === undefined) return refusal("x402/salt-malformed");
  let h: AtrHash = salt;
  if (t.bound) {
    const saltNonce = saltOf(payload["saltNonce"]);
    if (saltNonce === undefined) return refusal("x402/salt-malformed");
    const commitment = bindSalt(t.receiverAuthorizer, t.policy, saltNonce);
    if (isRefusal(commitment) || commitment !== salt) return refusal("x402/salt-not-bound");
    h = saltNonce;
  }
  let payer: string;
  let signed: AtrHash | undefined;
  let expiry: bigint | undefined;
  if (id === AC_EIP3009) {
    const a = strings(payload["authorization"], ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const);
    if (a === undefined) return refusal("x402/payload-malformed");
    payer = a.from;
    signed = normalHash(a.nonce) ?? undefined;
    expiry = uint256Of(a.validBefore);
  } else {
    const a = strings(payload["permit2Authorization"], ["from", "spender", "nonce", "deadline"] as const);
    if (a === undefined) return refusal("x402/payload-malformed");
    payer = a.from;
    signed = nonceAsHash(a.nonce);
    expiry = uint256Of(a.deadline);
  }
  if (!isAddress(payer) || expiry === undefined || expiry >= 1n << 48n) return refusal("x402/payload-malformed");
  if (signed === undefined) return refusal("x402/nonce-not-payment");
  const signatureNonce = paymentHash(t.chainId, t.deployment.escrow, t.info(ZERO_ADDRESS, salt, expiry));
  if (isRefusal(signatureNonce) || signatureNonce !== signed) return refusal("x402/nonce-not-payment");
  return { h, p, t, payer, salt, preApprovalExpiry: expiry };
}

/** 0x and 64 hex digits, zero-padded to the full width, lowercase. */
function saltOf(v: unknown): AtrHash | undefined {
  return typeof v === "string" && NONCE_HEX.test(v) ? (normalHash(v) ?? undefined) : undefined;
}

function authCaptureBound(id: typeof AC_EIP3009 | typeof AC_PERMIT2) {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    const r = authCapturePresented(id, presented);
    return isRefusal(r) ? r : r.h;
  };
}

function authCaptureReference(id: typeof AC_EIP3009 | typeof AC_PERMIT2) {
  return async (presented: unknown): Promise<EvmRef | Refusal> => {
    const r = authCapturePresented(id, presented);
    if (isRefusal(r)) return r;
    const { t, p, payer, salt, preApprovalExpiry } = r;
    const paymentId = paymentHash(t.chainId, t.deployment.escrow, t.info(payer as Hex, salt, preApprovalExpiry));
    if (isRefusal(paymentId)) return refusal("x402/payload-malformed");
    const topic0 = t.flow === "authorization" ? t.deployment.chargedTopic : PAYMENT_AUTHORIZED_TOPIC;
    const ref: EvmRef = {
      network: p.accepted.network as Eip155,
      settleBy: preApprovalExpiry.toString(),
      bindingLog: { address: t.deployment.escrow, topic0, index: 1, value: paymentId },
    };
    if (id === AC_EIP3009) {
      const signatureNonce = paymentHash(t.chainId, t.deployment.escrow, t.info(ZERO_ADDRESS, salt, preApprovalExpiry));
      const digest = await transferDigest({
        from: payer as Hex,
        to: t.deployment.eip3009Collector,
        value: BigInt(p.accepted.amount),
      });
      if (isRefusal(signatureNonce) || isRefusal(digest)) return refusal("x402/payload-malformed");
      ref.transferLog = { address: p.accepted.asset as Hex, topic0: TRANSFER_TOPIC, identity: "from,to,value", digest };
      ref.search = { address: p.accepted.asset as Hex, topics: [AUTHORIZATION_USED_TOPIC, null, signatureNonce] };
    } else {
      ref.search = { address: t.deployment.escrow, topics: [topic0, paymentId] };
    }
    return ref;
  };
}

// ── The records and the bindings.

const PERMIT2_PROVES =
  "The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 proxy as " +
  "spender and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the " +
  "hash is in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show " +
  "that amount, payee, asset or timing match the ATR's content.";

const AUTH_CAPTURE_PROVES =
  "The payer signed a token authorization whose nonce commits, through the escrow's PaymentInfo, to a salt that is " +
  "this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy when bound. The token " +
  "contract or Permit2 verified the signature when the escrow collected the payment, and the escrow's event carries " +
  "the salt. A holder of the ATR can confirm the hash from the salt; the chain alone does not reveal it. This record " +
  "covers that first collection; capture, void, refund and reclaim are the operator's and the payer's.";

function record(p: LcpPattern): LcpPattern {
  return deepFreeze(p);
}

type BreadthBinding<Id extends X402PairingId> = {
  readonly id: Id;
  readonly pattern: LcpPattern;
  readonly claims: boolean;
  readonly unplaced: (option: PaymentRequirements) => PaymentRequirements;
  readonly tie: typeof tie;
  readonly advertise: X402Advertise;
  readonly read: (doc: unknown) => X402Read | Refusal;
  readonly build: (choice: X402Choice, h: AtrHash) => Promise<X402Unsigned | Refusal>;
  readonly bound: (presented: unknown) => Promise<AtrHash | Refusal>;
  readonly reference: (presented: unknown) => Promise<EvmRef | Refusal>;
  readonly status: typeof evmStatus;
  readonly recover?: (ref: { network: Eip155; transaction: Hex }, reader: EvmReader) => Promise<AtrHash | Refusal>;
};

function binding<Id extends X402PairingId>(
  id: Id,
  pattern: LcpPattern,
  claims: boolean,
  build: BreadthBinding<Id>["build"],
  bound: BreadthBinding<Id>["bound"],
  reference: BreadthBinding<Id>["reference"],
  recover?: BreadthBinding<Id>["recover"],
): BreadthBinding<Id> {
  return Object.freeze({
    id,
    pattern,
    claims,
    unplaced,
    tie,
    advertise: advertiseFor(evmServes(id, isBreadthPayable(id))),
    read: readFor(evmNames(id)),
    build,
    bound,
    reference,
    status: evmStatus,
    ...(recover !== undefined ? { recover } : {}),
  });
}

export const exactPermit2 = binding(
  PERMIT2_EXACT,
  record({
    pattern: "native-field",
    canonical: false,
    profile: PERMIT2_EXACT,
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: true,
    proves: PERMIT2_PROVES,
  }),
  true,
  permit2Build(PERMIT2_EXACT),
  permit2Bound(PERMIT2_EXACT),
  permit2Reference(PERMIT2_EXACT),
);

export const uptoPermit2 = binding(
  PERMIT2_UPTO,
  record({
    pattern: "native-field",
    canonical: false,
    profile: PERMIT2_UPTO,
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: true,
    proves: PERMIT2_PROVES + " The amount settled is the facilitator's, at most the signed maximum.",
  }),
  true,
  permit2Build(PERMIT2_UPTO),
  permit2Bound(PERMIT2_UPTO),
  permit2Reference(PERMIT2_UPTO),
);

const erc7710 = binding(
  ERC7710,
  record({
    pattern: "http-advisory",
    canonical: true,
    buyerSigns: false,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    instrument: "landed",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
      "recorded in <transaction>. The ATR was assembled, written to the seller's storage and linked in the challenge " +
      "before approval, and the buyer's payment payload echoed this ATR's hash in the x402 legalContext extension. " +
      "The buyer's delegation does not sign the hash, and the settlement transaction does not carry it.",
  }),
  false,
  erc7710Build,
  erc7710Bound,
  erc7710Reference(ERC7710),
);

export const exactErc7710 = erc7710;

export const exactErc7710Salt = binding(
  ERC7710_SALT,
  record({
    pattern: "native-field",
    canonical: false,
    profile: ERC7710_SALT,
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
    publicProof: true,
    proves:
      "The leaf delegation of the permission context redeemed for this payment, made through MetaMask's " +
      "DelegationManager, carries this ATR's hash as its signed salt. The manager verified every delegation's " +
      "signature when it redeemed them, and the leaf, with its salt, is in a RedeemedDelegation event in the " +
      "settlement transaction. The leaf's signer is its delegator, which may be an account the paying account " +
      "authorised rather than the paying account itself. This does not show that amount, payee, asset or timing " +
      "match the ATR's content.",
  }),
  true,
  erc7710Build,
  erc7710SaltBound,
  erc7710Reference(ERC7710_SALT),
  redeemedLeafRecover,
);

export const authCaptureEip3009 = binding(
  AC_EIP3009,
  record({
    pattern: "id-reuse",
    canonical: false,
    profile: "x402/auth-capture/eip155",
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: true,
    proves: AUTH_CAPTURE_PROVES,
  }),
  true,
  authCaptureBuild(AC_EIP3009),
  authCaptureBound(AC_EIP3009),
  authCaptureReference(AC_EIP3009),
);

export const authCapturePermit2 = binding(
  AC_PERMIT2,
  record({
    pattern: "id-reuse",
    canonical: false,
    profile: "x402/auth-capture/eip155",
    buyerSigns: true,
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: true,
    proves: AUTH_CAPTURE_PROVES,
  }),
  true,
  authCaptureBuild(AC_PERMIT2),
  authCaptureBound(AC_PERMIT2),
  authCaptureReference(AC_PERMIT2),
);

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v !== "";
}
