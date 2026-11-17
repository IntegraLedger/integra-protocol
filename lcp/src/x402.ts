/**
 * x402 v2 documents, the request commitment, and the x402 pairings on eip155 chains: `exact` over EIP-3009, Permit2 and
 * ERC-7710 (with its salt level), `upto` over Permit2, `auth-capture` over EIP-3009 and Permit2, and `exact` in Circle
 * Gateway's batched domain. The ATR hash is
 * advertised in the challenge's `extensions.legalContext`; each pairing's `pattern` record states how the pairing binds
 * it.
 */
import { agreementValue, canonicalJson, digestJson, fromLegalContext, hash, type AtrHash, type Json } from "./core.js";
import {
  DELEGATION_MANAGER,
  DELEGATION_MANAGER_CHAINS,
  ESCROW,
  EXACT_PERMIT2_PROXY,
  PAYMENT_AUTHORIZED_TOPIC,
  PERMIT2,
  TRANSFER_TOPIC,
  UPTO_PERMIT2_PROXY,
  authorizationUsed,
  bindSalt,
  decodePermissionContext,
  eip3009Recover,
  eip3009TypedData,
  paymentHash,
  permit2TypedData,
  type Eip155,
  type Eip3009TypedData,
  type EvmReader,
  type EvmReceipt,
  type EvmRef,
  type EvmTransaction,
  type Field,
  type Hex,
  type PaymentInfo,
  type Permit2TypedData,
} from "./evm.js";
import { addressOfWord, bytesOf, hexOf, sameBytes, uintOf, wordAt } from "./evm-abi.js";
import { chainIdOf, deepFreeze, isAddress, isObject, normalHash, uint256Of } from "./fields.js";
import {
  failedAt,
  finalAt,
  isLog,
  isReceipt,
  receiveTypedData,
  redeemedLeafRecover,
  transferParts,
  type EvmQuery,
  type ReceiveTypedData,
  type EvmStatus,
} from "./internal/evm.js";
import type { Act, RecoverInput } from "./internal/read.js";
import {
  authCaptureRead,
  eip3009Read,
  erc7710Read,
  erc7710SaltRead,
  permit2ExactRead,
  permit2UptoRead,
  delegationHash,
  type AuthCaptureRef,
  type Eip3009Ref,
  type Erc7710Ref,
  type Permit2Ref,
} from "./internal/evm-x402-reads.js";
import type { Broadcaster } from "./internal/broadcaster.js";
import { x402Payee } from "./internal/payee.js";
import {
  LEGAL_CONTEXT,
  acceptedBy,
  advertiseFor,
  chosen,
  paymentWith,
  isAmount,
  isTimeoutSeconds,
  readFor,
  type OptionFilter,
  type X402Advertise,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { sameJson } from "./fields.js";
import { MAX_REQUEST_BYTES, MAX_SIGNATURE_BYTES } from "./internal/bounds.js";
import { EIP155_X402 } from "./internal/data/eip155-x402.js";
import { headerDigests, type HeaderDigest, type HeaderFields } from "./internal/request-headers.js";
import { isGatewayBatched } from "./internal/evm-gateway-batched.js";
import type { Entry, NoRead, PairingData } from "./internal/registry.js";
export type { Broadcaster } from "./internal/broadcaster.js";

export type { Eip3009TypedData } from "./evm.js";
export type { HeaderDigest, HeaderFields } from "./internal/request-headers.js";
export {
  exactGatewayBatched,
  type GatewayBatchedChoice,
  type GatewayBatchedPayment,
  type GatewayBatchedTypedData,
  type GatewayBatchedUnsigned,
} from "./internal/evm-gateway-batched.js";
export { LEGAL_CONTEXT, LEGAL_CONTEXT_SCHEMA } from "./internal/x402.js";
export {
  PAYMENT_REQUIRED,
  PAYMENT_RESPONSE,
  PAYMENT_SIGNATURE,
  decodePaymentRequired,
  decodePaymentResponse,
  decodePaymentSignature,
  encodeHeader,
  type SettlementResponse,
} from "./x402-headers.js";

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

type Eip3009Authorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

type Permit2Authorization = {
  permitted: { token: string; amount: string };
  from: string;
  spender: string;
  nonce: string;
  deadline: string;
  witness?: { [k: string]: string };
};

/** The payload of each x402 EVM scheme this package carries; every member is a string. */
type X402SchemePayload =
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

/**
 * An HTTP request as received: the method token, the raw origin-form target and the body bytes, and, where the
 * commitment names header fields, the request's header fields, each name with its lines in the order received.
 */
export interface HttpRequest {
  method: string;
  target: string;
  body: Uint8Array;
  headers?: HeaderFields;
}

/**
 * The commitment to an HTTP request: its method, path, query and body's digest, and, where the resource server names
 * header fields, `headers`: each named field's lower-cased name and SHA-256 of its value, never the value.
 */
export type RequestCommitment = {
  method: string;
  path: string;
  query: string;
  bodyDigest: AtrHash;
  headers?: readonly HeaderDigest[];
};

/** An MCP `tools/call` request's tool call, as received: its `params.name` and `params.arguments`. */
export interface ToolCall {
  name: string;
  arguments?: { [k: string]: Json };
}

/** The commitment to an MCP tool call: the tool's name, and SHA-256 over the RFC 8785 form of its arguments. */
export type ToolCallCommitment = { tool: string; argumentsDigest: Hex };

/**
 * A pairing's binding record: its binding pattern, absent where none of these names it; the profile that defines the
 * binding, where one does; whether the binding is visible on a public ledger; whether the hash can be recovered from
 * the chain alone; and whether the chain indexes it.
 */
export type LcpPattern = {
  pattern?:
    | "native-field"
    | "overlay-contract"
    | "sidecar-attestation"
    | "opaque-challenge"
    | "id-reuse"
    | "protocol-extension"
    | "http-advisory";
  profile?: string;
  onChain: boolean;
  zeroPartyRecoverable: boolean;
  forwardIndexable: boolean;
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
const MAX_BODY = MAX_REQUEST_BYTES;
const MIN_SIGNED_BYTES = 65;
const HEX_BODY = /^0x[0-9a-fA-F]*$/;

/**
 * The commitment to the request a challenge answers (x402-request-commitment.md): the method as received, the target
 * split at its first `?`, and SHA-256 over the body bytes exactly as received; and, where `fields` names request header
 * fields, `headers`: for each, in the order named, its lower-cased name and SHA-256 of its value as `r.headers` gives
 * it, the lines of a field given more than once joined by a comma and a space, `cookie`'s by a semicolon and a space,
 * and `null` for a field the request lacks. With no field named the commitment has no `headers` member. Names that are
 * not distinct field names, fields named with no `r.headers`, header fields that are not a record of strings or lists
 * of strings, two keys naming one named field, or a named field's value holding a character outside visible ASCII, the
 * space and the tab, are `x402/request-header-invalid`; a named field's value over 1 MiB is `x402/request-too-large`.
 */
export async function requestCommitment(r: HttpRequest, fields?: readonly string[]): Promise<RequestCommitment | Refusal> {
  if (!isObject(r) || typeof r.method !== "string" || typeof r.target !== "string") {
    return refusal("x402/request-target-invalid");
  }
  if (!(r.body instanceof Uint8Array)) return refusal("x402/request-target-invalid");
  if (r.target.length > MAX_TARGET || r.body.length > MAX_BODY) return refusal("x402/request-too-large");
  if (!r.target.startsWith("/") || !isVisibleAscii(r.target)) return refusal("x402/request-target-invalid");
  const q = r.target.indexOf("?");
  const path = q === -1 ? r.target : r.target.slice(0, q);
  const query = q === -1 ? "" : r.target.slice(q + 1);
  const commitment = { method: r.method, path, query, bodyDigest: await hash(r.body) };
  if (fields === undefined || (Array.isArray(fields) && fields.length === 0)) return commitment;
  const headers = await headerDigests(fields, r.headers);
  if (headers === "too-large") return refusal("x402/request-too-large");
  if (headers === "invalid") return refusal("x402/request-header-invalid");
  return { ...commitment, headers };
}

/**
 * The commitment to the MCP tool call a challenge answers (x402-request-commitment.md): the tool's `name` as received,
 * and SHA-256 over the RFC 8785 form of its `arguments`, absent read as `{}`. Nothing else of the request is read:
 * `params._meta`, where the payment rides, and the JSON-RPC envelope are not committed. A call that is not an object, a
 * name that is not a well-formed string of 1 to 8192 characters, or arguments that are not a JSON object, is
 * `x402/tool-call-malformed`; arguments over 1 MiB in that form are `x402/request-too-large`.
 */
export async function toolCallCommitment(call: ToolCall): Promise<ToolCallCommitment | Refusal> {
  if (!isObject(call) || carriesRefused(call)) return refusal("x402/tool-call-malformed");
  const name: unknown = call.name;
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_TARGET || !name.isWellFormed()) {
    return refusal("x402/tool-call-malformed");
  }
  const args: unknown = call.arguments === undefined ? {} : call.arguments;
  if (!isObject(args)) return refusal("x402/tool-call-malformed");
  const text = canonicalJson(args);
  if (typeof text !== "string") return refusal("x402/tool-call-malformed");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_BODY) return refusal("x402/request-too-large");
  return { tool: name, argumentsDigest: await hash(bytes) };
}

/**
 * SHA-256 over the RFC 8785 form of an issued option or request commitment. Takes any value and refuses one that is not
 * JSON as `core/content-not-json`, as `digestJson` does.
 */
export async function issuedDigest(v: unknown): Promise<Hex | Refusal> {
  return digestJson(v);
}

/** The x402 EVM pairing an option names, or undefined. */
function evmPairingOf(option: PaymentRequirements): X402PairingId | undefined {
  const f = optionFilter(option);
  return typeof f === "string" ? f : undefined;
}

/** The EIP-3009 `exact` filter: this pairing's id for an option it can pay, or undefined. */
function eip3009Of(option: PaymentRequirements): typeof ID | Refusal | undefined {
  if (!isObject(option)) return undefined;
  if (option.scheme !== "exact") return undefined;
  if (chainIdOf(option.network) === undefined) return undefined;
  const extra: unknown = option.extra;
  if (extra !== undefined && !isObject(extra)) return undefined;
  const method = extra?.["assetTransferMethod"];
  if (method !== undefined && method !== "eip3009") return undefined;
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization" && flow !== "upfront") return undefined;
  const splits = splitsRefused(extra);
  if (splits !== undefined) return splits;
  // Circle's batched option signs under the Gateway Wallet's domain, not the token's: not this pairing's to pay.
  if (extra?.["name"] === "GatewayWalletBatched") return refusal("x402/batched-not-eip3009");
  const verifying = extra?.["verifyingContract"];
  if (verifying !== undefined && !(typeof verifying === "string" && typeof option.asset === "string" && verifying.toLowerCase() === option.asset.toLowerCase())) {
    return refusal("x402/batched-not-eip3009");
  }
  return ID;
}

/** `exact` pays one payee: an option whose `extra.splits` is present and not an empty list is refused. */
function splitsRefused(extra: Record<string, unknown> | undefined): Refusal | undefined {
  const splits = extra?.["splits"];
  if (splits === undefined || (Array.isArray(splits) && splits.length === 0)) return undefined;
  return refusal("x402/splits-not-carried");
}

/**
 * The binding slot: every option the challenge offers, exactly as issued, and the request they answer, an HTTP request
 * (`requestCommitment`) or an MCP tool call (`toolCallCommitment`).
 */
export function tie(
  accepts: readonly PaymentRequirements[],
  request: RequestCommitment | ToolCallCommitment,
): ["x402", { accepts: readonly PaymentRequirements[]; request: RequestCommitment | ToolCallCommitment }] {
  return ["x402", { accepts, request }];
}

/**
 * The option filter of EVM pairing `id`, the one its `advertise`, `read`, `build`, `bound` and `reference` apply and
 * through which the root `pairingOf` names it: the option names `id`, and `build` can pay it. An option of `id`'s scheme
 * that the option filter refuses gives that refusal, one `build` cannot pay is `x402/option-malformed`, and any other
 * option is not this pairing's. So no EVM pairing's `read` offers an option its `build` or `bound` refuses on what the
 * option alone says.
 */
function evmFilter(id: X402PairingId): OptionFilter {
  const payable = id === ID ? isPayable : isBreadthPayable(id);
  return (o) => {
    const f = optionFilter(o);
    if (isRefusal(f)) return o.scheme === schemeOf(id) ? f : undefined;
    if (f !== optionIdOf(id)) return undefined;
    return payable(o) ? true : refusal("x402/option-malformed");
  };
}

/**
 * The `TransferWithAuthorization` the payer signs for the chosen option, with the hash as its nonce. H is checked
 * first, then the choice's `from` and `now`, then its document and option.
 */
async function build(choice: X402Choice, h: AtrHash, act?: Act): Promise<Unsigned | Refusal> {
  const atr = normalHash(h);
  if (atr === null) return refusal("x402/payload-malformed");
  const nonce = act === "agreement" ? await agreementValue(atr) : atr;
  if (!isObject(choice)) return refusal("x402/not-v2");
  const { required, accepted, from, now } = choice;
  if (!isAddress(from) || !Number.isSafeInteger(now) || now < 0) return refusal("x402/option-malformed");
  const wrong = chosen(required, accepted, evmFilter(ID));
  if (wrong !== true) return wrong;

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
async function bound(presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }): Promise<AtrHash | Refusal> {
  const p = paymentOf(presented);
  if (isRefusal(p)) return p;
  const nonce = normalHash(p.payload.authorization.nonce);
  if (nonce === null) return refusal("x402/payload-malformed");
  return carriedAs(nonce, given);
}

/**
 * H as a signed nonce carries it: the nonce itself for a payment; for the act `agreement`, given H, H where the nonce is
 * the agreement's own value (`agreementValue`), else `x402/nonce-not-agreement`. A given H that is not a hash is
 * `x402/payload-malformed`.
 */
async function carriedAs(nonce: AtrHash, given?: { readonly act: Act; readonly h: AtrHash }): Promise<AtrHash | Refusal> {
  if (given === undefined || !isObject(given) || given.act !== "agreement") return nonce;
  const h = normalHash(given.h);
  if (h === null) return refusal("x402/payload-malformed");
  return (await agreementValue(h)) === nonce ? h : refusal("x402/nonce-not-agreement");
}

/** A presented `accepted` that is not, by RFC 8785 form, the option `reference` is given is `x402/accepted-not-option`. */
function acceptedIs(presented: unknown, option: PaymentRequirements): Refusal | undefined {
  const accepted = isObject(presented) ? presented["accepted"] : undefined;
  return sameJson(accepted, option) ? undefined : refusal("x402/accepted-not-option");
}

/**
 * The read keys for finding this payment on chain later: network, token, `validBefore` and the transfer's digest, and
 * the same keys as an `EvmRef`: the `AuthorizationUsed` log carrying H, the transfer's identity, the nonce search, and
 * the authorization as the token records its use (nonce H, deadline `validBefore`); and the payee of `option`, the
 * issued option the payment answers (`x402Payee`). A refusal of the payment comes first, then the option's.
 */
async function reference(
  presented: unknown,
  option: PaymentRequirements,
  given?: { readonly act: Act; readonly h: AtrHash },
): Promise<Eip3009Ref | Refusal> {
  const keys = await eip3009Keys(presented, given);
  if (isRefusal(keys)) return keys;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  return acceptedIs(presented, option) ?? { ...keys, payee };
}

/**
 * The read keys of a presented EIP-3009 payment: the network, the token, the payer (`from`), `validBefore`, H, and the
 * members of the payment presented, which `status` compares with what landed: the token, `from`, `to`, `value` and
 * `nonce`, lowercase, the value in decimal.
 */
async function eip3009Keys(
  presented: unknown,
  given?: { readonly act: Act; readonly h: AtrHash },
): Promise<Omit<Eip3009Ref, "payee"> | Refusal> {
  const h = await bound(presented, given);
  if (isRefusal(h)) return h;
  const { accepted, payload } = presented as Eip3009Payment;
  const a = payload.authorization;
  const validBefore = uint256Of(a.validBefore);
  const value = uint256Of(a.value);
  if (!isAddress(a.from) || !isAddress(a.to) || value === undefined || validBefore === undefined) {
    return refusal("x402/payload-malformed");
  }
  const asset = (accepted.asset as string).toLowerCase() as Hex;
  return {
    network: accepted.network as Eip155,
    asset,
    payer: a.from.toLowerCase() as Hex,
    validBefore: validBefore.toString(),
    h,
    presented: {
      token: asset,
      from: a.from.toLowerCase(),
      to: a.to.toLowerCase(),
      value: value.toString(),
      nonce: normalHash(a.nonce)!,
    },
  };
}

/**
 * The account whose signature authorises the pull: the authorization's `from`, lowercase. EIP-3009's signed message
 * holds `from`, so the authorization can execute only from that account.
 */
async function authorizer(presented: unknown): Promise<Hex | Refusal> {
  const h = await bound(presented);
  if (isRefusal(h)) return h;
  const from = (presented as Eip3009Payment).payload.authorization.from;
  return isAddress(from) ? (from.toLowerCase() as Hex) : refusal("x402/payload-malformed");
}

/**
 * The option unchanged: no x402 EVM pairing carries the hash inside the option. An option that carries a `refused`
 * member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: true,
});

/**
 * `x402/exact/eip155/eip3009`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits
 * `transferWithAuthorization` with the authorization the payer signed, and names its transaction; `status` reads it.
 */
export const exactEip3009 = Object.freeze({
  id: ID,
  data: EIP155_X402[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise: advertiseFor(evmFilter(ID)),
  read: readFor(evmFilter(ID)),
  build,
  bound,
  broadcaster: x402Broadcaster("payee", { refused: () => refusal("x402/payload-malformed") }),
  reference,
  authorizer,
  status: eip3009Read,
  recover: eip3009Recover,
}) satisfies Entry<
  typeof ID,
  Eip3009Payment,
  Eip3009Ref,
  EvmReader,
  X402Forms & {
    choice: X402Choice;
    unsigned: Unsigned;
    landed: { transaction?: Hex };
    network: Eip155;
    query: EvmQuery<unknown>;
    answer: EvmStatus;
  }
>;

/** The payment's shape as this pairing requires it, or the refusal that names what is wrong. */
function paymentOf(presented: unknown): Eip3009Payment | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  if (carriesRefused(presented)) return refusal("x402/payload-malformed");
  const accepted = acceptedBy(presented["accepted"], evmFilter(ID));
  if (isRefusal(accepted)) return accepted;
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
    (isAmount(o.amount) || o.amount === EIP155_X402[ID].agreement!.floor) &&
    uint256Of(o.amount) !== undefined &&
    isTimeoutSeconds(o.maxTimeoutSeconds)
  );
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

type X402PairingId =
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
const UINT48_LIMIT = 2 ** 48;
const UINT120_LIMIT = 1n << 120n;
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
function optionPairingOf(pairing: string): string {
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
    if ((method === "permit2" || method === "erc7710") && splitsRefused(extra) !== undefined) return splitsRefused(extra);
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
 * The eip155 pairing of this entry point that serves a presented payment: the `exact`, `upto` or `auth-capture` pairing
 * its `accepted` names, Circle Gateway's batched `exact` option being `x402/exact/eip155/gateway-batched`, except that an `erc7710` payment is the salt level only where its delegation manager is
 * `DELEGATION_MANAGER`, on a chain in `DELEGATION_MANAGER_CHAINS`, and the leaf delegation of its permission context
 * carries as its salt the H its echoed `extensions.legalContext.info` names. Every other delegation, a stock client's
 * whose leaf salt is drawn at random among them, or one whose context or extension does not decode, is the level that
 * signs no H. Undefined for any other option, an option on another rail included; the root `pairingOf` names the x402
 * pairing of an option on any rail.
 */
export function pairingOfPayment(p: PaymentPayload): X402PairingId | "x402/exact/eip155/gateway-batched" | undefined {
  if (!isObject(p) || !isObject(p.accepted)) return undefined;
  if (isGatewayBatched(p.accepted)) return "x402/exact/eip155/gateway-batched";
  const id = evmPairingOf(p.accepted);
  if (id !== ERC7710) return id;
  const payload: unknown = p.payload;
  const manager = isObject(payload) ? payload["delegationManager"] : undefined;
  if (!isReferenceManager(manager, p.accepted.network)) return ERC7710;
  const ctx = isObject(payload) ? payload["permissionContext"] : undefined;
  const delegations = typeof ctx === "string" ? decodePermissionContext(ctx as Hex) : undefined;
  const leaf = delegations === undefined || isRefusal(delegations) ? undefined : delegations[0];
  const lc = isObject(p.extensions) ? p.extensions[LEGAL_CONTEXT] : undefined;
  const echoed = fromLegalContext({ legalContext: isObject(lc) ? lc["info"] : undefined });
  return leaf !== undefined && echoed !== null && normalHash(leaf.salt) === echoed.h ? ERC7710_SALT : ERC7710;
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

/**
 * An option `build` can use: its amount and time bound; for auth-capture also the token's EIP-712 name and version, the
 * escrow terms `authCaptureTerms` reads, and a `maxTimeoutSeconds` below 2^48, since `now` plus it is the payment's
 * `preApprovalExpiry`, a `uint48`.
 */
function isBreadthPayable(id: X402PairingId) {
  const escrow = schemeOf(id) === "auth-capture";
  return (o: PaymentRequirements): boolean =>
    isObject(o) &&
    isAmount(o.amount) &&
    uint256Of(o.amount) !== undefined &&
    isTimeoutSeconds(o.maxTimeoutSeconds) &&
    (!escrow ||
      (isObject(o.extra) &&
        isNonEmpty(o.extra["name"]) &&
        isNonEmpty(o.extra["version"]) &&
        o.maxTimeoutSeconds < UINT48_LIMIT &&
        !isRefusal(authCaptureTerms(o))));
}

/**
 * The checks every breadth `build` makes: H first, then the choice's `from` and `now`, then its document and option.
 * Gives the chain id, the `now + maxTimeoutSeconds` bound and H.
 */
function choiceOf(
  id: X402PairingId,
  choice: X402Choice,
  h: AtrHash,
): { chainId: number; deadline: bigint; h: AtrHash } | Refusal {
  const nonce = normalHash(h);
  if (nonce === null) return refusal("x402/payload-malformed");
  if (!isObject(choice)) return refusal("x402/not-v2");
  const { required, accepted, from, now } = choice;
  if (!isAddress(from) || !Number.isSafeInteger(now) || now < 0) return refusal("x402/option-malformed");
  const wrong = chosen(required, accepted, evmFilter(id));
  if (wrong !== true) return wrong;
  return { chainId: chainIdOf(accepted.network)!, deadline: BigInt(now) + BigInt(accepted.maxTimeoutSeconds), h: nonce };
}


/** A presented payment whose `accepted` its `read` offers (`evmFilter`), with its payload as an object. */
function presentedAs(id: X402PairingId, presented: unknown): { p: PaymentPayload; payload: Record<string, unknown> } | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = acceptedBy(presented["accepted"], evmFilter(id));
  if (isRefusal(accepted)) return accepted;
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
  return async (choice: X402Choice, h: AtrHash, act?: Act): Promise<X402Unsigned | Refusal> => {
    const atr = normalHash(h);
    const signedNonce = atr !== null && act === "agreement" && id === PERMIT2_EXACT ? await agreementValue(atr) : h;
    const c = choiceOf(id, choice, signedNonce);
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
      nonce: BigInt(c.h).toString(),
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
  return async (presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }): Promise<AtrHash | Refusal> => {
    const r = permit2Presented(id, presented);
    if (isRefusal(r)) return r;
    return id === PERMIT2_EXACT ? carriedAs(r.h, given) : r.h;
  };
}

function permit2Reference(id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO) {
  const keys = permit2Keys(id);
  return async (
    presented: unknown,
    option: PaymentRequirements,
    given?: { readonly act: Act; readonly h: AtrHash },
  ): Promise<Permit2Ref | Refusal> => {
    const k = await keys(presented, given);
    if (isRefusal(k)) return k;
    const payee = x402Payee(option);
    if (isRefusal(payee)) return payee;
    return acceptedIs(presented, option) ?? { ...k, payee };
  };
}

/**
 * The read keys of a presented Permit2 payment: the network, the token, the owner, `deadline`, H, and the members of
 * the payment presented: the permit's `token`, `amount`, `nonce` and `deadline`, its `spender`, the `owner`, and the
 * witness's `to` and `validAfter`, with `facilitator` on `upto`, lowercase, numbers in decimal.
 */
function permit2Keys(id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO) {
  const bound = permit2Bound(id);
  return async (presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }): Promise<Omit<Permit2Ref, "payee"> | Refusal> => {
    const h = await bound(presented, given);
    if (isRefusal(h)) return h;
    const r = permit2Presented(id, presented) as Exclude<ReturnType<typeof permit2Presented>, Refusal>;
    const { a, p } = r;
    const deadline = uint256Of(a.deadline);
    const amount = uint256Of(a.permitted.amount);
    const validAfter = uint256Of(a.witness["validAfter"] ?? "0");
    const upto = id === PERMIT2_UPTO;
    const facilitator = a.witness["facilitator"];
    if (!isAddress(a.from) || !isAddress(a.witness["to"]) || !isAddress(a.permitted.token) || deadline === undefined) {
      return refusal("x402/payload-malformed");
    }
    if (amount === undefined || validAfter === undefined || (upto && !isAddress(facilitator))) {
      return refusal("x402/payload-malformed");
    }
    return {
      network: p.accepted.network as Eip155,
      asset: (p.accepted.asset as string).toLowerCase() as Hex,
      payer: a.from.toLowerCase() as Hex,
      deadline: deadline.toString(),
      h,
      presented: {
        token: a.permitted.token.toLowerCase(),
        amount: amount.toString(),
        nonce: r.h,
        deadline: deadline.toString(),
        spender: a.spender.toLowerCase(),
        owner: a.from.toLowerCase(),
        to: a.witness["to"].toLowerCase(),
        validAfter: validAfter.toString(),
        ...(upto ? { facilitator: (facilitator as string).toLowerCase() } : {}),
      },
    };
  };
}

/**
 * The account the permit names as its owner, `permit2Authorization.from`, lowercase. Permit2's signature does not
 * cover the owner: the permit executes only as the account its signature recovers to, or, for a contract account, the
 * account whose ERC-1271 check accepts it.
 */
function permit2Authorizer(id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO) {
  return async (presented: unknown): Promise<Hex | Refusal> => {
    const r = permit2Presented(id, presented);
    if (isRefusal(r)) return r;
    return isAddress(r.a.from) ? (r.a.from.toLowerCase() as Hex) : refusal("x402/payload-malformed");
  };
}

/**
 * The calls through which each scheme's x402 proxy spends a permit (x402's `x402ExactPermit2Proxy` and
 * `x402UptoPermit2Proxy`): the selector, the argument word where the permit (`token`, `amount`, `nonce`, `deadline`)
 * starts, and the owner's argument word. `settleWithPermit` puts the EIP-2612 permit's five words first; the `upto`
 * proxy puts the settled amount after the permit.
 */
const PROXY_SETTLES: { readonly [id in typeof PERMIT2_EXACT | typeof PERMIT2_UPTO]: readonly ProxySettle[] } = {
  [PERMIT2_EXACT]: [
    // settle(((address,uint256),uint256,uint256),address,(address,uint256),bytes)
    { selector: "0x13cd3b53", permit: 0, owner: 4 },
    // settleWithPermit((uint256,uint256,bytes32,bytes32,uint8),((address,uint256),uint256,uint256),address,(address,uint256),bytes)
    { selector: "0xfa340378", permit: 5, owner: 9 },
  ],
  [PERMIT2_UPTO]: [
    // settle(((address,uint256),uint256,uint256),uint256,address,(address,address,uint256),bytes)
    { selector: "0xff11e7b4", permit: 0, owner: 5 },
    // settleWithPermit((uint256,uint256,bytes32,bytes32,uint8),((address,uint256),uint256,uint256),uint256,address,(address,address,uint256),bytes)
    { selector: "0x016c1748", permit: 5, owner: 10 },
  ],
};

type ProxySettle = { selector: Hex; permit: number; owner: number };

/**
 * Recovers H from a Permit2 settlement transaction alone: the Permit2 nonce of the scheme's proxy call that spent the
 * permit. It reads the transaction's input by `eth_getTransactionByHash` and finds the call at any byte offset, as the
 * pairing's `status` finds it: at offset 0 for a direct call to the proxy and further in for a batched call or an
 * ERC-4337 bundle, by its selector, with an address in its permit's `token` word and in its
 * owner word. A call counts only where the receipt holds a `Transfer` log emitted by that token whose `from` is that
 * owner: the proxy settles only through Permit2's transfer of a non-zero amount from the owner, and the log's recipient
 * and value are not compared. Exactly one such call (by nonce and owner) must be there, else `evm/no-permit2-settle`
 * for none and `evm/ambiguous` for more; and, as the pairing's `status` requires, `nonceBitmap(owner, nonce >> 8)` on
 * Permit2 must have bit `nonce & 0xff` set at the receipt's block and unset at the block before, else
 * `evm/nonce-not-used`. No
 * signature is checked, and Permit2's bitmap shows only that the owner's nonce was used in that block, by a settlement
 * or by the owner's `invalidateUnorderedNonces`, not in which transaction: any transaction of that block, the owner's
 * cancelling one included, whose input carries a call with the same nonce and owner, and whose receipt holds a
 * `Transfer` from that owner emitted by the contract that call names as its token, gives H. `status` with the ATR's
 * reference tells which transaction paid. The option is not read. A reader for another network, an input or reader
 * that is not an object, or an input whose `tx` is not a 32-byte hash, is `evm/wrong-reader`, with nothing read; no
 * receipt or no transaction
 * is `evm/not-found`; a reverted one is `evm/reverted`; a failed read, a malformed receipt or `nonceBitmap` answer, or
 * an input that is not hex bytes is `evm/unreadable`. A revert, `evm/no-permit2-settle`, `evm/ambiguous` and
 * `evm/nonce-not-used` are given only where the receipt's block is at or below the reader's `finalized` mark: above it,
 * or where that mark cannot be read, each is `evm/not-final`, a read to repeat, since a block above the mark can be
 * replaced by one in which the transaction succeeds, holds other logs or leaves Permit2 another bitmap. The mark is read
 * only for those. At most five calls.
 */
function permit2Recover(id: typeof PERMIT2_EXACT | typeof PERMIT2_UPTO) {
  const settles = PROXY_SETTLES[id];
  return async (input: RecoverInput<Eip155, PaymentRequirements>, reader: EvmReader): Promise<AtrHash | Refusal> => {
    if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("evm/wrong-reader");
    if (normalHash(input.tx) === null) return refusal("evm/wrong-reader");
    const ref = { network: input.network, transaction: input.tx as Hex };
    let receipt: EvmReceipt | null;
    let tx: EvmTransaction | null;
    try {
      receipt = await reader.receipt(ref.transaction);
    } catch {
      return refusal("evm/unreadable");
    }
    if (receipt === null) return refusal("evm/not-found");
    if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return refusal("evm/unreadable");
    if (receipt.status === 0) {
      const read = await failedAt(receipt.blockNumber, "reverted", reader);
      return read.state === "failed" ? refusal("evm/reverted") : refusal("evm/not-final");
    }
    try {
      tx = await reader.transaction(ref.transaction);
    } catch {
      return refusal("evm/unreadable");
    }
    if (tx === null) return refusal("evm/not-found");
    const calldata = isObject(tx) ? bytesOf(tx.input) : undefined;
    if (calldata === undefined) return refusal("evm/unreadable");
    const logs = receipt.logs;
    const anchored = proxySettlesIn(calldata, settles).filter((c) =>
      logs.some((l) => {
        const t = transferParts(l, c.token, TRANSFER_TOPIC);
        return t !== undefined && sameBytes(t.from, c.owner);
      }),
    );
    const found = [...new Map(anchored.map((c) => [`${c.nonce}${c.owner}`, c] as const)).values()];
    if (found.length !== 1 && !(await finalAt(receipt.blockNumber, reader))) return refusal("evm/not-final");
    if (found.length === 0) return refusal("evm/no-permit2-settle");
    if (found.length > 1) return refusal("evm/ambiguous");
    const { nonce, owner, token, deadline } = found[0]!;
    const used = { network: ref.network, authorization: { scheme: "permit2" as const, at: PERMIT2, nonce, deadline, asset: token } };
    const block = receipt.blockNumber;
    const after = await authorizationUsed(used, owner, block, reader);
    if (isRefusal(after)) return refusal("evm/unreadable");
    if (after) {
      const before = block === 0n ? false : await authorizationUsed(used, owner, block - 1n, reader);
      if (isRefusal(before)) return refusal("evm/unreadable");
      if (!before) return nonce;
    }
    return (await finalAt(block, reader)) ? refusal("evm/nonce-not-used") : refusal("evm/not-final");
  };
}

/** The distinct (nonce, owner, token) proxy calls among `settles` that start at any offset of `input`. */
function proxySettlesIn(
  input: Uint8Array,
  settles: readonly ProxySettle[],
): { nonce: AtrHash; owner: Hex; token: Hex; deadline: string }[] {
  const out = new Map<string, { nonce: AtrHash; owner: Hex; token: Hex; deadline: string }>();
  const selectors = settles.map((x) => bytesOf(x.selector)!);
  for (let at = 0; at + 4 <= input.length; at++) {
    const i = selectors.findIndex((sel) => sel.every((b, j) => input[at + j] === b));
    if (i < 0) continue;
    const s = settles[i]!;
    const args = input.subarray(at + 4);
    const tokenWord = wordAt(args, s.permit);
    const nonceWord = wordAt(args, s.permit + 2);
    const deadlineWord = wordAt(args, s.permit + 3);
    const ownerWord = wordAt(args, s.owner);
    const token = tokenWord === undefined ? undefined : addressOfWord(tokenWord);
    const owner = ownerWord === undefined ? undefined : addressOfWord(ownerWord);
    if (token === undefined || owner === undefined || nonceWord === undefined || deadlineWord === undefined) continue;
    const nonce = hexOf(nonceWord) as AtrHash;
    out.set(`${nonce}${owner}${token}`, { nonce, owner, token, deadline: uintOf(deadlineWord).toString() });
  }
  return [...out.values()];
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
 * The read keys: the network, and the token's `Transfer` from the delegator, identified by the delegator alone, since
 * the delegation signs no payee; at the salt level also the manager's `RedeemedDelegation` whose leaf salt is H.
 */
function erc7710Reference(id: typeof ERC7710 | typeof ERC7710_SALT) {
  const keys = erc7710Keys(id);
  return async (presented: unknown, option: PaymentRequirements): Promise<Erc7710Ref | Refusal> => {
    const k = await keys(presented);
    if (isRefusal(k)) return k;
    const payee = x402Payee(option);
    if (isRefusal(payee)) return payee;
    return acceptedIs(presented, option) ?? { ...k, payee };
  };
}

/**
 * The read keys of a presented ERC-7710 payment: the network, the token, H, and the payer: the payment's `delegator`
 * at the level that signs no H, and at the salt level the root delegator, the last delegation's, whose account the
 * manager executes the transfer from and by which the search finds its redemptions.
 */
function erc7710Keys(id: typeof ERC7710 | typeof ERC7710_SALT) {
  return async (presented: unknown): Promise<Omit<Erc7710Ref, "payee"> | Refusal> => {
    const h = await (id === ERC7710 ? erc7710Bound(presented) : erc7710SaltBound(presented));
    if (isRefusal(h)) return h;
    const { p, d } = erc7710Presented(id, presented) as { p: PaymentPayload; d: { delegator: string; permissionContext: string } };
    if (!isAddress(d.delegator) || !isAddress(p.accepted.asset)) return refusal("x402/payload-malformed");
    let payer = d.delegator.toLowerCase() as Hex;
    // The payment presented: the leaf delegation whole, by its EIP-712 hash, which status compares with the leaf a
    // `RedeemedDelegation` log carries. At the level that signs no H, a context that does not decode as the reference
    // manager's presents no member.
    const delegations = decodePermissionContext(d.permissionContext as Hex);
    const leafPresented = isRefusal(delegations) || delegations.length === 0 ? undefined : { delegation: delegationHash(delegations[0]!) };
    if (id === ERC7710_SALT) {
      if (isRefusal(delegations) || delegations.length === 0) return refusal("x402/permission-context-malformed");
      payer = delegations[delegations.length - 1]!.delegator.toLowerCase() as Hex;
    }
    return {
      network: p.accepted.network as Eip155,
      asset: p.accepted.asset.toLowerCase() as Hex,
      payer,
      h,
      ...(leafPresented === undefined ? {} : { presented: leafPresented }),
    };
  };
}

/**
 * At the salt level, the account whose signature authorises the pull: the delegator of the permission context's root
 * delegation (its last), whose account the DelegationManager executes the transfer from, lowercase.
 */
async function erc7710SaltAuthorizer(presented: unknown): Promise<Hex | Refusal> {
  const h = await erc7710SaltBound(presented);
  if (isRefusal(h)) return h;
  const { d } = erc7710Presented(ERC7710_SALT, presented) as { d: { permissionContext: string } };
  const delegations = decodePermissionContext(d.permissionContext as Hex);
  if (isRefusal(delegations) || delegations.length === 0) return refusal("x402/permission-context-malformed");
  return delegations[delegations.length - 1]!.delegator;
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

/**
 * The escrow terms an auth-capture option fixes, or `x402/option-malformed`: `captureAuthorizer` and `feeRecipient`
 * addresses, `receiverAuthorizer` and `policy` addresses when present (absent reads as the zero address), the amount
 * below 2^120 (`PaymentInfo.maxAmount`, a `uint120`), `captureDeadline` and `refundDeadline` below 2^48 (`uint48`), and
 * `minFeeBps` and `maxFeeBps` at most 65,535 (`uint16`). An option whose `paymentFlow` is `authorization` settles as the
 * escrow's `charge`, which the auth-capture EVM scheme allows only with a non-zero `receiverAuthorizer`. The option
 * filter (`isBreadthPayable`) applies this, so `build`, `bound` and `reference` read the terms of an option it serves.
 */
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
  if (maxAmount >= UINT120_LIMIT || authorizationExpiry >= UINT48_LIMIT || refundExpiry >= UINT48_LIMIT) {
    return refusal("x402/option-malformed");
  }
  if (minFeeBps === undefined || maxFeeBps === undefined || minFeeBps > 65535n || maxFeeBps > 65535n) {
    return refusal("x402/option-malformed");
  }
  const zero = (a: Hex) => a.toLowerCase() === ZERO_ADDRESS;
  const flow = extra["paymentFlow"] === "authorization" ? "authorization" : "escrow";
  if (flow === "authorization" && zero(receiverAuthorizer)) return refusal("x402/option-malformed");
  return {
    chainId: chainIdOf(o.network)!,
    deployment,
    bound: !zero(receiverAuthorizer) || !zero(policy),
    receiverAuthorizer,
    policy,
    flow,
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
    const t = authCaptureTerms(accepted) as AuthCaptureTerms;
    const salt = t.bound ? (bindSalt(t.receiverAuthorizer, t.policy, c.h) as Hex) : c.h;
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
 * salt), the payer, and the signed nonce checked against the `signatureNonce` recomputed with payer zero. Under an
 * option that binds neither a receiver authorizer nor a policy, the scheme's payload carries no `saltNonce`; a payload
 * that carries one is a binding option's payment, whose H is that `saltNonce` and not the salt, so it is
 * `x402/salt-not-bound`.
 */
function authCapturePresented(
  id: typeof AC_EIP3009 | typeof AC_PERMIT2,
  presented: unknown,
): { h: AtrHash; p: PaymentPayload; t: AuthCaptureTerms; payer: Hex; salt: Hex; preApprovalExpiry: bigint } | Refusal {
  const got = presentedAs(id, presented);
  if (isRefusal(got)) return got;
  const { p, payload } = got;
  if (!isSignature(payload["signature"], 1)) return refusal("x402/signature-malformed");
  const t = authCaptureTerms(p.accepted) as AuthCaptureTerms;
  const salt = saltOf(payload["salt"]);
  if (salt === undefined) return refusal("x402/salt-malformed");
  let h: AtrHash = salt;
  if (t.bound) {
    const saltNonce = saltOf(payload["saltNonce"]);
    if (saltNonce === undefined) return refusal("x402/salt-malformed");
    const commitment = bindSalt(t.receiverAuthorizer, t.policy, saltNonce);
    if (isRefusal(commitment) || commitment !== salt) return refusal("x402/salt-not-bound");
    h = saltNonce;
  } else if (payload["saltNonce"] !== undefined) {
    return refusal("x402/salt-not-bound");
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
  const keys = authCaptureKeys(id);
  return async (presented: unknown, option: PaymentRequirements): Promise<AuthCaptureRef | Refusal> => {
    const k = await keys(presented);
    if (isRefusal(k)) return k;
    const payee = x402Payee(option);
    if (isRefusal(payee)) return payee;
    return acceptedIs(presented, option) ?? { ...k, payee };
  };
}

/**
 * The read keys of a presented `auth-capture` payment: the network, the token and the way it is pulled, the payer, the
 * escrow deployment and its event for the option's flow, the payment hash of the presented `PaymentInfo` and that hash
 * with payer zero (the signed nonce, the single-use value), the salt, `preApprovalExpiry`, and H.
 */
function authCaptureKeys(id: typeof AC_EIP3009 | typeof AC_PERMIT2) {
  return async (presented: unknown): Promise<Omit<AuthCaptureRef, "payee"> | Refusal> => {
    const r = authCapturePresented(id, presented);
    if (isRefusal(r)) return r;
    const { t, p, payer, salt, preApprovalExpiry } = r;
    const paymentId = paymentHash(t.chainId, t.deployment.escrow, t.info(payer as Hex, salt, preApprovalExpiry));
    if (isRefusal(paymentId)) return refusal("x402/payload-malformed");
    const event = t.flow === "authorization" ? t.deployment.chargedTopic : PAYMENT_AUTHORIZED_TOPIC;
    const signatureNonce = paymentHash(t.chainId, t.deployment.escrow, t.info(ZERO_ADDRESS, salt, preApprovalExpiry));
    if (isRefusal(signatureNonce)) return refusal("x402/payload-malformed");
    return {
      network: p.accepted.network as Eip155,
      scheme: id === AC_EIP3009 ? "eip3009" : "permit2",
      asset: (p.accepted.asset as string).toLowerCase() as Hex,
      payer: payer.toLowerCase() as Hex,
      escrow: t.deployment.escrow.toLowerCase() as Hex,
      event: event.toLowerCase() as Hex,
      paymentId: paymentId.toLowerCase() as Hex,
      signatureNonce: signatureNonce.toLowerCase() as Hex,
      salt: salt.toLowerCase() as Hex,
      expiry: preApprovalExpiry.toString(),
      h: r.h,
    };
  };
}

/**
 * The payer of a presented auth-capture payment, lowercase: the token authorization's `from`, which the escrow's
 * payment hash commits to and the collector pulls from.
 */
function authCaptureAuthorizer(id: typeof AC_EIP3009 | typeof AC_PERMIT2) {
  return async (presented: unknown): Promise<Hex | Refusal> => {
    const r = authCapturePresented(id, presented);
    return isRefusal(r) ? r : (r.payer.toLowerCase() as Hex);
  };
}

/**
 * Recovers the value an `auth-capture` transaction carries in H's place: the `PaymentInfo.salt` of the escrow's
 * `PaymentAuthorized` or `PaymentCharged` logs, emitted by the escrow of the deployment the option names (its
 * `extra.authCaptureEscrow`, v1.1's where absent) and naming as their token collector that deployment's collector for
 * the pairing's scheme, the one that redeems the authorization the payer signed (`@x402/evm` 2.31.0
 * `src/auth-capture/constants.ts`). That salt is H itself where the option binds neither a receiver authorizer nor a
 * policy; otherwise it is the commitment over the two and H, `bindSalt(receiverAuthorizer, policy, H)`, which a holder of
 * the ATR computes from the option and its own H and compares, since a commitment is not read back to H. The escrow's
 * event data is `PaymentInfo`'s twelve words, the amount and the collector; an event of the escrow with those topics
 * whose data holds fewer words is `evm/unreadable`. Exactly one distinct salt must be there: none is
 * `evm/no-escrow-payment` and more than one `evm/ambiguous`. A reverted transaction is `evm/reverted`. A revert,
 * `evm/no-escrow-payment` and `evm/ambiguous` are given only at or below the reader's `finalized` mark, and above it, or
 * where that mark cannot be read, each is `evm/not-final`, as `eip3009Recover` answers; the mark is read only for those.
 * An input or reader that is not an object, a reader for another network, a `tx` that is not a 32-byte hash, or an
 * option that names no deployment of the escrow, is `evm/wrong-reader`, with nothing read. At most two calls.
 */
function authCaptureRecover(id: typeof AC_EIP3009 | typeof AC_PERMIT2) {
  return async (input: RecoverInput<Eip155, PaymentRequirements>, reader: EvmReader): Promise<AtrHash | Refusal> => {
    if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("evm/wrong-reader");
    if (normalHash(input.tx) === null) return refusal("evm/wrong-reader");
    const extra = isObject(input.option) && isObject(input.option.extra) ? input.option.extra : undefined;
    const d = extra === undefined ? undefined : deploymentOf(extra);
    if (d === undefined) return refusal("evm/wrong-reader");
    let receipt: EvmReceipt | null;
    try {
      receipt = await reader.receipt(input.tx as Hex);
    } catch {
      return refusal("evm/unreadable");
    }
    if (receipt === null) return refusal("evm/not-found");
    if (!isReceipt(receipt) || !receipt.logs.every(isLog)) return refusal("evm/unreadable");
    if (receipt.status === 0) {
      const read = await failedAt(receipt.blockNumber, "reverted", reader);
      return read.state === "failed" ? refusal("evm/reverted") : refusal("evm/not-final");
    }
    const collector = id === AC_EIP3009 ? d.eip3009Collector : d.permit2Collector;
    const salts = new Set<AtrHash>();
    for (const l of receipt.logs) {
      if (!sameBytes(l.address, d.escrow) || l.topics.length !== 2) continue;
      if (!sameBytes(l.topics[0], PAYMENT_AUTHORIZED_TOPIC) && !sameBytes(l.topics[0], d.chargedTopic)) continue;
      const data = bytesOf(l.data);
      const salt = data === undefined ? undefined : wordAt(data, 11);
      const through = data === undefined ? undefined : wordAt(data, 13);
      if (salt === undefined || through === undefined) return refusal("evm/unreadable");
      if (!sameBytes(hexOf(through.subarray(12)), collector) || through.subarray(0, 12).some((b) => b !== 0)) continue;
      salts.add(hexOf(salt) as AtrHash);
    }
    if (salts.size !== 1 && !(await finalAt(receipt.blockNumber, reader))) return refusal("evm/not-final");
    if (salts.size === 0) return refusal("evm/no-escrow-payment");
    if (salts.size > 1) return refusal("evm/ambiguous");
    return [...salts][0]!;
  };
}

// ── The records and the bindings.

function record(p: LcpPattern): LcpPattern {
  return deepFreeze(p);
}

/** The x402 EVM breadth pairings: those with data in the EVM family's module but EIP-3009 `exact`. */
type BreadthId = Exclude<
  keyof typeof EIP155_X402,
  typeof ID | "x402/batch-settlement/eip155" | "x402/batch-settlement/cloudflare" | "x402/exact/eip155/gateway-batched"
>;

/** The members every x402 EVM breadth pairing shares. */
type BreadthBase<Id extends BreadthId> = {
  readonly id: Id;
  readonly data: PairingData;
  readonly pattern: LcpPattern;
  readonly claims: boolean;
  readonly unplaced: (option: PaymentRequirements) => PaymentRequirements | Refusal;
  readonly tie: typeof tie;
  readonly advertise: X402Advertise;
  readonly read: (doc: unknown) => X402Read | Refusal;
  readonly broadcaster: (presented: unknown) => Promise<Broadcaster | Refusal>;
};

/** The family descriptor of an x402 EVM breadth pairing that `status` reads. */
type BreadthFamily = X402Forms & {
  choice: X402Choice;
  unsigned: X402Unsigned;
  landed: { transaction?: Hex };
  network: Eip155;
  query: EvmQuery<unknown>;
  answer: EvmStatus;
};

/** The members each x402 EVM breadth pairing gives itself. */
type BreadthMembers = {
  readonly build: (choice: X402Choice, h: AtrHash, act?: Act) => Promise<X402Unsigned | Refusal>;
  readonly bound: (presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }) => Promise<AtrHash | Refusal>;
  readonly reference: (presented: unknown, option: PaymentRequirements, given?: { readonly act: Act; readonly h: AtrHash }) => Promise<object | Refusal>;
  readonly authorizer?: (presented: unknown) => Promise<Hex | Refusal>;
  readonly status?: (ref: never, reader: EvmReader, query: EvmQuery<unknown>) => Promise<EvmStatus>;
  readonly recover?: (input: RecoverInput<Eip155, PaymentRequirements>, reader: EvmReader) => Promise<AtrHash | Refusal>;
};

function binding<Id extends BreadthId, M extends BreadthMembers>(
  id: Id,
  pattern: LcpPattern,
  claims: boolean,
  members: M,
): BreadthBase<Id> & M {
  return Object.freeze({
    id,
    data: EIP155_X402[id],
    pattern,
    claims,
    unplaced,
    tie,
    advertise: advertiseFor(evmFilter(id)),
    read: readFor(evmFilter(id)),
    broadcaster: x402Broadcaster("payee"),
    ...members,
  });
}

/**
 * `x402/exact/eip155/permit2`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator
 * submits the Permit2 transfer the payer signed, and names its transaction; `status` reads it.
 */
export const exactPermit2 = binding(
  PERMIT2_EXACT,
  record({
    pattern: "native-field",
    profile: PERMIT2_EXACT,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  }),
  true,
  {
    build: permit2Build(PERMIT2_EXACT),
    bound: permit2Bound(PERMIT2_EXACT),
    reference: permit2Reference(PERMIT2_EXACT),
    authorizer: permit2Authorizer(PERMIT2_EXACT),
    status: permit2ExactRead,
    recover: permit2Recover(PERMIT2_EXACT),
  },
) satisfies Entry<typeof PERMIT2_EXACT, PaymentPayload, Permit2Ref, EvmReader, BreadthFamily>;

/**
 * `x402/upto/eip155/permit2`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator,
 * the witness's `facilitator`, submits the Permit2 transfer the payer signed for the amount it settles, and names its
 * transaction; `status` reads it.
 */
export const uptoPermit2 = binding(
  PERMIT2_UPTO,
  record({
    pattern: "native-field",
    profile: PERMIT2_UPTO,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  }),
  true,
  {
    build: permit2Build(PERMIT2_UPTO),
    bound: permit2Bound(PERMIT2_UPTO),
    reference: permit2Reference(PERMIT2_UPTO),
    authorizer: permit2Authorizer(PERMIT2_UPTO),
    status: permit2UptoRead,
    recover: permit2Recover(PERMIT2_UPTO),
  },
) satisfies Entry<typeof PERMIT2_UPTO, PaymentPayload, Permit2Ref, EvmReader, BreadthFamily>;

/**
 * `x402/exact/eip155/erc7710`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator redeems
 * the delegation the payer signed. Nothing the delegator signed carries H, so a read of the chain alone never settles
 * it: its `status` reads the transaction the caller names, after the position of the agreement's own settlement, which
 * the caller gives, and holds it to a `Transfer` from the payment's `delegator` to the option's payee.
 */
export const exactErc7710 = binding(
  ERC7710,
  record({
    pattern: "http-advisory",
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  }),
  false,
  { build: erc7710Build, bound: erc7710Bound, reference: erc7710Reference(ERC7710), status: erc7710Read },
) satisfies Entry<typeof ERC7710, PaymentPayload, Erc7710Ref, EvmReader, BreadthFamily>;

/**
 * `x402/exact/eip155/erc7710-salt`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
 * facilitator redeems the delegation the payer signed, and names its transaction; `status` reads it.
 */
export const exactErc7710Salt = binding(
  ERC7710_SALT,
  record({
    pattern: "native-field",
    profile: ERC7710_SALT,
    onChain: true,
    zeroPartyRecoverable: true,
    forwardIndexable: false,
  }),
  true,
  {
    build: erc7710Build,
    bound: erc7710SaltBound,
    reference: erc7710Reference(ERC7710_SALT),
    authorizer: erc7710SaltAuthorizer,
    status: erc7710SaltRead,
    recover: redeemedLeafRecover,
  },
) satisfies Entry<typeof ERC7710_SALT, PaymentPayload, Erc7710Ref, EvmReader, BreadthFamily>;

/**
 * `x402/auth-capture/eip155/eip3009`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
 * facilitator submits the escrow call that executes the authorization the payer signed, and names its transaction;
 * `status` reads it.
 */
export const authCaptureEip3009 = binding(
  AC_EIP3009,
  record({
    pattern: "id-reuse",
    profile: "x402/auth-capture/eip155",
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  }),
  true,
  {
    build: authCaptureBuild(AC_EIP3009),
    bound: authCaptureBound(AC_EIP3009),
    reference: authCaptureReference(AC_EIP3009),
    authorizer: authCaptureAuthorizer(AC_EIP3009),
    status: authCaptureRead,
    recover: authCaptureRecover(AC_EIP3009),
  },
) satisfies Entry<typeof AC_EIP3009, PaymentPayload, AuthCaptureRef, EvmReader, BreadthFamily>;

/**
 * `x402/auth-capture/eip155/permit2`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
 * facilitator submits the escrow call that executes the Permit2 transfer the payer signed, and names its transaction;
 * `status` reads it.
 */
export const authCapturePermit2 = binding(
  AC_PERMIT2,
  record({
    pattern: "id-reuse",
    profile: "x402/auth-capture/eip155",
    onChain: true,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
  }),
  true,
  {
    build: authCaptureBuild(AC_PERMIT2),
    bound: authCaptureBound(AC_PERMIT2),
    reference: authCaptureReference(AC_PERMIT2),
    authorizer: authCaptureAuthorizer(AC_PERMIT2),
    status: authCaptureRead,
    recover: authCaptureRecover(AC_PERMIT2),
  },
) satisfies Entry<typeof AC_PERMIT2, PaymentPayload, AuthCaptureRef, EvmReader, BreadthFamily>;

function isNonEmpty(v: unknown): v is string {
  return typeof v === "string" && v !== "";
}
