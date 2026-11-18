/**
 * The Spend Permission exchange and the pairing `spend-permissions/eip155`: an account's approval, on the
 * SpendPermissionManager, of a Spend Permission whose `salt` is the ATR hash, as the sale's agreement.
 *
 * The offer in a `402` body, the typed data the account signs or the `approve` call it makes, the `Spend-Permission`
 * return header, the resource server's checks, the permission's hash as the manager computes it, and the read of the
 * approval by that hash, as the profile `spend-permissions/eip155` states them. No key is held, nothing is signed, and
 * nothing is read but through the reader a caller supplies.
 *
 * @module
 */
import { hashEquals, isHttpsLink, isOtherSchemeLink, toLegalContext, type AtrHash } from "./core.js";
import { hexOf, type Hex } from "./evm-abi.js";
import { chainIdOf, isAddress, isObject, jsonBytes, normalHash } from "./fields.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import { MAX_HEADER_BYTES, MAX_LINK_LENGTH } from "./internal/bounds.js";
import { broadcasterOf } from "./internal/broadcaster.js";
import { parseJson } from "./internal/core.js";
import { EIP155_X402 } from "./internal/data/eip155-x402.js";
import type { Eip155, EvmQuery, EvmReader, EvmStatus } from "./internal/evm.js";
import type { Act } from "./internal/read.js";
import type { Entry } from "./internal/registry.js";
import { base64UrlBytes, toBase64Url } from "./rail-bytes.js";
import {
  APPROVE_SELECTOR,
  SPEND_PERMISSION_DOMAIN,
  approvalIn,
  hashOf,
  managerRefuses,
  permissionCall,
  permissionOf,
  returnOf,
  saltHash,
  spendPermissionRead,
  wirePermission,
  type OfferedPermission,
  type Permission,
  type ReturnRead,
  type SpendPermission,
  type SpendPermissionRef,
  type SpendPermissionRoute,
  type WholePermission,
} from "./internal/spend-permissions.js";
import type { LcpPattern } from "./x402.js";

export {
  APPROVE_SELECTOR,
  APPROVE_WITH_SIGNATURE_SELECTOR,
  IS_APPROVED_SELECTOR,
  IS_REVOKED_SELECTOR,
  SPEND_PERMISSION_APPROVED_TOPIC,
  SPEND_PERMISSION_DOMAIN,
  SPEND_PERMISSION_REVOKED_TOPIC,
  SPEND_PERMISSION_TYPEHASH,
} from "./internal/spend-permissions.js";
export type { OfferedPermission, SpendPermission, SpendPermissionRef, SpendPermissionRoute } from "./internal/spend-permissions.js";
export type { Broadcaster } from "./internal/broadcaster.js";
export type { EvmReadRefBase } from "./internal/evm-x402.js";
export type { EvmMark, EvmQuery } from "./internal/evm.js";

const ID = "spend-permissions/eip155" as const;

/** The request header field that carries the return. */
export const SPEND_PERMISSION_HEADER = "Spend-Permission";

/** The codes a refused return is answered with, in the `402` body's `error` member. */
export type SpendPermissionError =
  | "spend-permissions/not-bound"
  | "spend-permissions/signature-invalid"
  | "spend-permissions/not-approved"
  | "spend-permissions/revoked"
  | "spend-permissions/ended"
  | "spend-permissions/header-malformed"
  | "spend-permissions/route-not-accepted"
  | "spend-permissions/account-is-spender";

const ERRORS: readonly string[] = [
  "spend-permissions/not-bound",
  "spend-permissions/signature-invalid",
  "spend-permissions/not-approved",
  "spend-permissions/revoked",
  "spend-permissions/ended",
  "spend-permissions/header-malformed",
  "spend-permissions/route-not-accepted",
  "spend-permissions/account-is-spender",
];

/** The offer the `402` body's `spendPermission` member holds. */
export interface SpendPermissionOffer {
  readonly network: Eip155;
  /** The SpendPermissionManager's address on `network`. */
  readonly manager: Hex;
  /** Every member of the permission but `account`, `salt` being H. */
  readonly permission: OfferedPermission;
  /** The routes the resource server takes, each once. */
  readonly accepts: readonly SpendPermissionRoute[];
  readonly legalContext: { readonly type: "sha256"; readonly value: AtrHash; readonly legalContextUrl: string };
}

/** The `402` body: the offer, and on a refused return the code that refused it. */
export interface SpendPermissionBody {
  readonly spendPermission: SpendPermissionOffer;
  readonly error?: SpendPermissionError;
}

/** What the resource server offers before H is placed: the offer without `legalContext`, and `salt` absent or H. */
export interface SpendPermissionOfferInput {
  readonly network: Eip155;
  readonly manager: Hex;
  readonly permission: Omit<OfferedPermission, "salt"> & { readonly salt?: string };
  readonly accepts: readonly SpendPermissionRoute[];
}

/** The return a `Spend-Permission` header carries: the whole permission, and the account's signature or transaction. */
export type SpendPermissionReturn = {
  readonly network: Eip155;
  readonly manager: Hex;
  readonly permission: SpendPermission;
} & ({ readonly signature: Hex; readonly transaction?: never } | { readonly transaction: Hex; readonly signature?: never });

/** The buyer's inputs to `build`: the offer as `read` gave it, and the account that approves. */
export interface SpendPermissionChoice {
  readonly offer: SpendPermissionOffer;
  readonly account: Hex;
}

/** The EIP-712 typed data of the permission in the manager's domain, as a signer takes it. */
export interface SpendPermissionTypedData {
  readonly domain: { readonly name: string; readonly version: string; readonly chainId: number; readonly verifyingContract: Hex };
  readonly types: { readonly SpendPermission: readonly { readonly name: string; readonly type: string }[] };
  readonly primaryType: "SpendPermission";
  readonly message: {
    readonly account: Hex;
    readonly spender: Hex;
    readonly token: Hex;
    readonly allowance: bigint;
    readonly period: bigint;
    readonly start: bigint;
    readonly end: bigint;
    readonly salt: bigint;
    readonly extraData: Hex;
  };
}

/**
 * What `build` gives the account: the whole permission, its hash, the typed data it signs on `"signature"`, and the
 * manager's `approve` call it makes on `"transaction"`.
 */
export interface SpendPermissionUnsigned {
  readonly permission: SpendPermission;
  readonly hash: Hex;
  readonly typedData: SpendPermissionTypedData;
  readonly approve: { readonly to: Hex; readonly data: Hex };
}

const SPEND_PERMISSION_TYPE = Object.freeze([
  { name: "account", type: "address" },
  { name: "spender", type: "address" },
  { name: "token", type: "address" },
  { name: "allowance", type: "uint160" },
  { name: "period", type: "uint48" },
  { name: "start", type: "uint48" },
  { name: "end", type: "uint48" },
  { name: "salt", type: "uint256" },
  { name: "extraData", type: "bytes" },
] as const);

const ROUTES: readonly SpendPermissionRoute[] = ["signature", "transaction"];

/** A non-empty array of distinct routes, or undefined. */
function routesOf(v: unknown): readonly SpendPermissionRoute[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > ROUTES.length) return undefined;
  if (!v.every((r) => ROUTES.includes(r)) || new Set(v).size !== v.length) return undefined;
  return v as SpendPermissionRoute[];
}

/** The offer read whole, or the refusal that names what is wrong with it. */
interface OfferRead {
  readonly network: Eip155;
  readonly chainId: number;
  readonly manager: Hex;
  readonly permission: Permission;
  readonly accepts: readonly SpendPermissionRoute[];
  readonly h: AtrHash;
  readonly link: string;
}

/**
 * The offer as rule 3 of the profile states it, meeting the manager's refusals and with `salt` = H: its `legalContext`
 * decoding with an `https` link of at most 2048 characters, and no other member.
 */
function offerOf(v: unknown): OfferRead | Refusal {
  if (!isObject(v) || carriesRefused(v)) return refusal("spend-permissions/option-malformed");
  const keys = Object.keys(v);
  if (!keys.includes("legalContext")) return refusal("spend-permissions/legal-context-malformed");
  const names = ["network", "manager", "permission", "accepts", "legalContext"];
  if (keys.length !== names.length || !keys.every((k) => names.includes(k))) return refusal("spend-permissions/option-malformed");
  const lc = v["legalContext"];
  if (!isObject(lc) || Object.keys(lc).some((k) => !["type", "value", "legalContextUrl"].includes(k))) {
    return refusal("spend-permissions/legal-context-malformed");
  }
  const url = lc["legalContextUrl"];
  if (isOtherSchemeLink(url)) return refusal("spend-permissions/link-not-https");
  const h = normalHash(lc["value"]);
  if (lc["type"] !== "sha256" || h === null || typeof url !== "string" || url.length > MAX_LINK_LENGTH || !isHttpsLink(url)) {
    return refusal("spend-permissions/legal-context-malformed");
  }
  const chainId = chainIdOf(v["network"]);
  const permission = permissionOf(v["permission"], false);
  const accepts = routesOf(v["accepts"]);
  if (chainId === undefined || !isAddress(v["manager"]) || permission === undefined || accepts === undefined) {
    return refusal("spend-permissions/option-malformed");
  }
  if (managerRefuses(permission)) return refusal("spend-permissions/option-malformed");
  if (!hashEquals(saltHash(permission), h)) return refusal("spend-permissions/not-bound");
  return {
    network: v["network"] as Eip155,
    chainId,
    manager: (v["manager"] as string).toLowerCase() as Hex,
    permission,
    accepts,
    h,
    link: url,
  };
}

/** The offer in its wire form. */
function wireOffer(o: OfferRead): SpendPermissionOffer {
  return {
    network: o.network,
    manager: o.manager,
    permission: wirePermission(o.permission),
    accepts: [...o.accepts],
    legalContext: { type: "sha256", value: o.h, legalContextUrl: o.link },
  };
}

/** A return, or the refusal its shape earns: `signature-invalid` where only its signature is malformed. */
function readReturn(presented: unknown): ReturnRead | Refusal {
  if (isObject(presented) && carriesRefused(presented)) return refusal("spend-permissions/header-malformed");
  const r = returnOf(presented);
  if (r === "signature") return refusal("spend-permissions/signature-invalid");
  return r === undefined ? refusal("spend-permissions/header-malformed") : r;
}

/** The return in its wire form. */
function wireReturn(r: ReturnRead): SpendPermissionReturn {
  const base = { network: r.network, manager: r.manager, permission: wirePermission(r.permission) };
  return r.route === "signature" ? { ...base, signature: r.signature! } : { ...base, transaction: r.transaction! };
}

/** Whether the return answers the offer: the same network and manager, and every offered member of the permission. */
function answers(r: ReturnRead, o: OfferRead): boolean {
  const a = wirePermission(r.permission);
  const b = wirePermission(o.permission);
  return (
    r.chainId === o.chainId &&
    r.manager === o.manager &&
    a.spender === b.spender &&
    a.token === b.token &&
    a.allowance === b.allowance &&
    a.period === b.period &&
    a.start === b.start &&
    a.end === b.end &&
    a.salt === b.salt &&
    a.extraData === b.extraData
  );
}

// ── The header.

/**
 * The `Spend-Permission` header's value: base64url without padding of the UTF-8 of `JSON.stringify` of the return,
 * which must be a return the profile's rule 8 takes, of at most `MAX_HEADER_BYTES` bytes; else
 * `spend-permissions/header-malformed`, or `spend-permissions/signature-invalid` for a malformed signature.
 */
export function encodeSpendPermissionHeader(value: SpendPermissionReturn): string | Refusal {
  const r = readReturn(value);
  if (isRefusal(r)) return r;
  const bytes = new TextEncoder().encode(JSON.stringify(wireReturn(r)));
  return bytes.length > MAX_HEADER_BYTES ? refusal("spend-permissions/header-malformed") : toBase64Url(bytes);
}

/**
 * The return a `Spend-Permission` header's value carries: base64url without padding in its canonical form (RFC 4648
 * §5), of at most `MAX_HEADER_BYTES` bytes, that are well-formed UTF-8 of one JSON object and nothing after it, at most
 * 64 levels deep, holding the members rule 8 names and no other; else `spend-permissions/header-malformed`, or
 * `spend-permissions/signature-invalid` where only its signature is malformed. Addresses and hex come back lowercase.
 */
export function decodeSpendPermissionHeader(header: unknown): SpendPermissionReturn | Refusal {
  const bytes = base64UrlBytes(header, MAX_HEADER_BYTES);
  if (typeof bytes === "string") return refusal("spend-permissions/header-malformed");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return refusal("spend-permissions/header-malformed");
  }
  const r = readReturn(parseJson(text));
  return isRefusal(r) ? r : wireReturn(r);
}

// ── The seller's half.

/**
 * The resource server's checks of a return before it submits or serves, in the profile's order (rule 9): the return
 * as rule 8 takes it (`header-malformed`, `signature-invalid`); `network`, `manager` and every offered member of the
 * permission equal to the offer's, `salt` being H (`not-bound`); a route the offer accepts (`route-not-accepted`);
 * `account` not `spender` (`account-is-spender`); and `end` later than `now`, the caller's clock in Unix seconds
 * (`ended`). The offer is the `spendPermission` the resource server issued (`offer-malformed`, or as `read` refuses its
 * legal context, where it is not one); a `now` that is not a non-negative safe integer is `choice-malformed`. Whether
 * `salt` is an H the resource server issued for this request and has not seen used is its own record's.
 */
export function checkReturn(presented: unknown, offer: SpendPermissionOffer, now: number): SpendPermissionReturn | Refusal {
  const o = offerOf(offer);
  if (isRefusal(o)) return o;
  if (!Number.isSafeInteger(now) || now < 0) return refusal("spend-permissions/choice-malformed");
  const r = readReturn(presented);
  if (isRefusal(r)) return r;
  if (!answers(r, o)) return refusal("spend-permissions/not-bound");
  if (!o.accepts.includes(r.route)) return refusal("spend-permissions/route-not-accepted");
  if (r.permission.account === r.permission.spender) return refusal("spend-permissions/account-is-spender");
  if (r.permission.end <= BigInt(now)) return refusal("spend-permissions/ended");
  return wireReturn(r);
}

/**
 * The read of the transaction that should hold the approval: on `"transaction"` the one the return names, and on
 * `"signature"` the resource server's own submission of `approveWithSignature`, given as `transaction`. It gives the
 * block of a transaction whose receipt's `status` is 1 and that holds the manager's `SpendPermissionApproved` for the
 * permission's hash, the permission whole; otherwise `spend-permissions/revoked` where the manager reads the permission
 * revoked in the state after its block, and `spend-permissions/not-approved`. The return is read as rule 8 takes it.
 * `evm/wrong-reader` for a reader of another network, `evm/not-found` where the reader holds no receipt yet and
 * `evm/unreadable` where a read failed or answered out of its form, each before anything is decided.
 */
export async function approvedIn(
  presented: unknown,
  reader: EvmReader,
  transaction?: Hex,
): Promise<{ readonly transaction: Hex; readonly block: bigint } | Refusal> {
  const r = readReturn(presented);
  if (isRefusal(r)) return r;
  const tx = normalHash(transaction ?? r.transaction);
  if (tx === null) return refusal("spend-permissions/header-malformed");
  const a = await approvalIn(r, tx as Hex, reader);
  switch (a) {
    case "wrong-reader":
      return refusal("evm/wrong-reader");
    case "missing":
      return refusal("evm/not-found");
    case "unreadable":
      return refusal("evm/unreadable");
    case "revoked":
      return refusal("spend-permissions/revoked");
    case "none":
      return refusal("spend-permissions/not-approved");
    default:
      return { transaction: tx as Hex, block: a.approved };
  }
}

/**
 * The permission's hash as the SpendPermissionManager's `getHash` computes it: the EIP-712 digest of the whole
 * permission in the manager's domain on the network, the digest the account signs and the approval event's topic.
 * `spend-permissions/header-malformed` where the permission, the network or the manager is not in the wire form.
 */
export function permissionHash(permission: SpendPermission, network: Eip155, manager: Hex): Hex | Refusal {
  const p = permissionOf(permission, true);
  const chainId = chainIdOf(network);
  if (p === undefined || chainId === undefined || !isAddress(manager)) return refusal("spend-permissions/header-malformed");
  return hashOf(p, chainId, manager.toLowerCase() as Hex);
}

/**
 * The offer as the resource server gave it to `advertise`, before H was placed: without `legalContext` and `salt`. A
 * value that is not an offer `read` takes is handed back as it is; one that carries a `refused` member is
 * `option-malformed`.
 */
function unplaced(option: SpendPermissionOffer): SpendPermissionOfferInput | SpendPermissionOffer | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("spend-permissions/option-malformed");
  const o = offerOf(option);
  if (isRefusal(o)) return option;
  const { salt: _salt, ...permission } = wirePermission(o.permission);
  return { network: o.network, manager: o.manager, permission, accepts: [...o.accepts] };
}

/** The ATR's binding slot: the offer exactly as issued. */
export function tie(offer: SpendPermissionOffer): ["spendPermission", SpendPermissionOffer] {
  return ["spendPermission", offer];
}

/**
 * The `402` body: the offer with `salt` = H and `legalContext` placed, and, where given, `error`, one of the codes a
 * refused return is answered with. `salt` absent from the offer is written; one present must already be H
 * (`not-bound`). An offer the manager refuses, or not of the profile's form, `account` among its members, is
 * `offer-malformed`; a link that is not `https` is `link-not-https`; an invalid H or a link over 2048 characters is
 * `legal-context-malformed`.
 */
function advertise(
  _doc: Record<string, never>,
  h: AtrHash,
  link: string,
  offer: SpendPermissionOfferInput,
  error?: SpendPermissionError,
): SpendPermissionBody | Refusal {
  const nh = normalHash(h);
  if (nh === null) return refusal("spend-permissions/legal-context-malformed");
  if (!isHttpsLink(link)) return refusal("spend-permissions/link-not-https");
  if (link.length > MAX_LINK_LENGTH) return refusal("spend-permissions/legal-context-malformed");
  if (!isObject(offer) || carriesRefused(offer) || !isObject(offer.permission)) return refusal("spend-permissions/option-malformed");
  if (Object.keys(offer).some((k) => !["network", "manager", "permission", "accepts"].includes(k))) {
    return refusal("spend-permissions/option-malformed");
  }
  const salt = BigInt(nh).toString();
  const given = (offer.permission as { salt?: unknown }).salt;
  if (given !== undefined && given !== salt) return refusal("spend-permissions/not-bound");
  if (error !== undefined && !ERRORS.includes(error)) return refusal("spend-permissions/option-malformed");
  const o = offerOf({ ...offer, permission: { ...offer.permission, salt }, legalContext: toLegalContext(nh, link).legalContext });
  if (isRefusal(o)) return o;
  return error === undefined ? { spendPermission: wireOffer(o) } : { spendPermission: wireOffer(o), error };
}

/**
 * The buyer's reading of a `402` body: H and the link from the offer's `legalContext`, the offer, which must meet the
 * manager's refusals and carry `salt` = H (`not-bound`), and the body's `error` where it holds one. A body over
 * `MAX_HEADER_BYTES` bytes as JSON, or holding a member but `spendPermission` and `error`, or an `error` that is not one
 * of the exchange's codes, is `offer-malformed`.
 */
function read(doc: SpendPermissionBody): { h: AtrHash; link: string; offer: SpendPermissionOffer; error?: SpendPermissionError } | Refusal {
  if (!isObject(doc) || carriesRefused(doc)) return refusal("spend-permissions/option-malformed");
  const size = jsonBytes(doc);
  if (size === undefined || size > MAX_HEADER_BYTES) return refusal("spend-permissions/option-malformed");
  if (Object.keys(doc).some((k) => k !== "spendPermission" && k !== "error")) return refusal("spend-permissions/option-malformed");
  const error: unknown = doc["error"];
  if (error !== undefined && (typeof error !== "string" || !ERRORS.includes(error))) return refusal("spend-permissions/option-malformed");
  const o = offerOf(doc["spendPermission"]);
  if (isRefusal(o)) return o;
  const offer = wireOffer(o);
  return error === undefined
    ? { h: o.h, link: o.link, offer }
    : { h: o.h, link: o.link, offer, error: error as SpendPermissionError };
}

/**
 * What the account signs or calls, with H in `salt`: the offer must carry `salt` = H and `legalContext.value` = H, H
 * being the hash the client computed of the ATR it fetched (`not-bound`); `account` an address (`choice-malformed`)
 * that is not `spender` (`account-is-spender`). It gives the whole permission, its hash, the EIP-712 typed data of
 * rule 6 and the `approve` call of rule 7. The act changes nothing: the pairing's one act is the agreement.
 */
async function build(choice: SpendPermissionChoice, h: AtrHash): Promise<SpendPermissionUnsigned | Refusal> {
  if (!isObject(choice)) return refusal("spend-permissions/choice-malformed");
  const o = offerOf(choice.offer);
  if (isRefusal(o)) return o;
  const nh = normalHash(h);
  if (nh === null || !hashEquals(o.h, nh) || !hashEquals(saltHash(o.permission), nh)) return refusal("spend-permissions/not-bound");
  if (!isAddress(choice.account)) return refusal("spend-permissions/choice-malformed");
  const account = choice.account.toLowerCase() as Hex;
  if (account === o.permission.spender) return refusal("spend-permissions/account-is-spender");
  const p: WholePermission = { ...o.permission, account };
  const permission = wirePermission(p);
  return {
    permission,
    hash: hashOf(p, o.chainId, o.manager),
    typedData: {
      domain: { ...SPEND_PERMISSION_DOMAIN, chainId: o.chainId, verifyingContract: o.manager },
      types: { SpendPermission: SPEND_PERMISSION_TYPE },
      primaryType: "SpendPermission",
      message: {
        account,
        spender: p.spender,
        token: p.token,
        allowance: p.allowance,
        period: p.period,
        start: p.start,
        end: p.end,
        salt: p.salt,
        extraData: hexOf(p.extraData),
      },
    },
    approve: { to: o.manager, data: permissionCall(APPROVE_SELECTOR, p) },
  };
}

/**
 * H as the return carries it: the permission's `salt`, as a 32-byte hash. Given H, a `salt` that is not it is
 * `not-bound`. A return of another shape is refused as `decodeSpendPermissionHeader` refuses it.
 */
async function bound(presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }): Promise<AtrHash | Refusal> {
  const r = readReturn(presented);
  if (isRefusal(r)) return r;
  const h = saltHash(r.permission);
  if (given !== undefined && !hashEquals(h, typeof given === "object" && given !== null ? given.h : "")) {
    return refusal("spend-permissions/not-bound");
  }
  return h;
}

/**
 * The read keys of a return: the network, the manager, H, the permission's hash, the permission whole, its `spender` as
 * the option's payee, and on `"transaction"` the transaction the return names. A return whose `network`, `manager` or
 * offered permission members differ from `option`, the offer it answers, is `not-bound`, as is one whose `salt` is not
 * the H given.
 */
async function reference(
  presented: unknown,
  option: SpendPermissionOffer,
  given?: { readonly act: Act; readonly h: AtrHash },
): Promise<SpendPermissionRef | Refusal> {
  const o = offerOf(option);
  if (isRefusal(o)) return o;
  const r = readReturn(presented);
  if (isRefusal(r)) return r;
  if (!answers(r, o)) return refusal("spend-permissions/not-bound");
  const h = saltHash(r.permission);
  if (given !== undefined && !hashEquals(h, typeof given === "object" && given !== null ? given.h : "")) {
    return refusal("spend-permissions/not-bound");
  }
  return {
    network: r.network,
    payee: r.permission.spender,
    h,
    manager: r.manager,
    hash: hashOf(r.permission, r.chainId, r.manager),
    permission: wirePermission(r.permission),
    ...(r.transaction === undefined ? {} : { transaction: r.transaction }),
  };
}

const QUERY_UNPARSEABLE: EvmStatus = Object.freeze({ state: "unreadable", reason: "unparseable", foreign: [] });

/**
 * The read of the approval, the act `agreement`, as the profile's rules 14 to 20 state it. The pairing has no act
 * `payment`: asked about one, it answers `unreadable`, `unparseable`, with nothing read.
 */
async function status(ref: SpendPermissionRef & { transaction?: Hex }, reader: EvmReader, query: EvmQuery<unknown>): Promise<EvmStatus> {
  if (isObject(query) && query["act"] === "payment") return QUERY_UNPARSEABLE;
  return spendPermissionRead(ref, reader, query);
}

const pattern: LcpPattern = Object.freeze({
  pattern: "native-field",
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/** The family's types, as the registry names them. */
interface SpendPermissionFamily {
  doc: SpendPermissionBody;
  offered: { h: AtrHash; link: string; offer: SpendPermissionOffer; error?: SpendPermissionError };
  placedIn: Record<string, never>;
  offer: SpendPermissionOfferInput;
  rest: [error?: SpendPermissionError];
  advertised: SpendPermissionBody;
  choice: SpendPermissionChoice;
  unsigned: SpendPermissionUnsigned;
  option: SpendPermissionOffer;
  landed: { transaction?: Hex };
  network: never;
  query: EvmQuery<unknown>;
  answer: EvmStatus;
}

/**
 * `spend-permissions/eip155`. On `"signature"` the resource server submits the approval (`broadcaster` answers
 * `"payee"`); on `"transaction"` the account has already made it (`"payer"`). `status` reads the approval by the
 * permission's hash; `approvedIn` reads the transaction that should hold it.
 */
export const spendPermissionsEip155 = Object.freeze({
  id: ID,
  data: EIP155_X402[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: broadcasterOf((presented) => {
    const r = readReturn(presented);
    return isRefusal(r) ? r : r.route === "signature" ? "payee" : "payer";
  }),
  reference,
  status,
}) satisfies Entry<typeof ID, SpendPermissionReturn, SpendPermissionRef, EvmReader, SpendPermissionFamily>;

