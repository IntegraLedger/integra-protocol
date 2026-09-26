/**
 * CEP-3009 on Casper and the `x402/exact/casper` pairing: the ATR hash as the authorization's 32-byte `nonce`,
 * written by the buyer's signer, read back from what the payer signed, and read from the executed call's arguments.
 */
import { fromRawBytes, hash, hashEquals, type AtrHash } from "./core.js";
import type { Field, Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash, UINT256_LIMIT, uint256Of } from "./fields.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
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

/** CAIP-2: `casper:` and the chainspec name. */
export type CasperNetwork = `casper:${string}`;
/** 66 hex digits, no prefix: tag `00` (account hash) or `01` (package hash), then 32 bytes. */
export type CasperAddress = string;
/** 64 hex digits, no prefix. */
export type PackageHash = string;

/** keccak256("EIP712Domain(string name,string version,string chain_name,bytes32 contract_package_hash)") */
export const CASPER_DOMAIN_TYPEHASH = "0xe20dd13933eeb9d6099b53d5ffd59cfd50fe774983038681a378371664fad4fb" as const;

export interface Cep3009TypedData {
  domain: { name: string; version: string; chain_name: CasperNetwork; contract_package_hash: PackageHash };
  types: { EIP712Domain: Field[]; TransferWithAuthorization: Field[] };
  primaryType: "TransferWithAuthorization";
  message: {
    from: CasperAddress;
    to: CasperAddress;
    value: bigint;
    validAfter: bigint;
    validBefore: bigint;
    /** 64 hex digits, no prefix. */
    nonce: string;
  };
}

/** One executed contract call, as the reader reports it. */
export interface CasperCall {
  executed: boolean;
  blockHeight: bigint | null;
  error: string | null;
  packageHash: PackageHash | null;
  entryPoint: string | null;
  args: { from?: CasperAddress; to?: CasperAddress; value?: bigint; nonce?: Uint8Array };
}

/** Bounded, read-only calls against one network's node. Every failure rejects with `ReaderError`. */
export interface CasperReader {
  readonly network: CasperNetwork;
  /** `info_get_transaction`, as a `Version1` transaction and then as a `Deploy`; null when the node knows neither. */
  transaction(hash: string): Promise<CasperCall | null>;
}

/** The read keys recorded at claim. */
export interface CasperRef {
  network: CasperNetwork;
  transaction?: string;
  asset: PackageHash;
  idDigest: Hex;
  settleBy: number;
}

export type CasperStatus =
  | { state: "settled"; finality: "finalized"; blockHeight: bigint }
  | { state: "pending"; why: "not-found" | "not-executed" | "unreadable" }
  | { state: "failed"; why: "reverted" | "not-this-instrument" };

export type CasperAuthorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

export type CasperPaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { authorization: CasperAuthorization; publicKey: string; signature: string };
  extensions?: PaymentRequired["extensions"];
};

export interface CasperChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  from: CasperAddress;
  now: number;
}

export interface CasperUnsigned {
  request: { kind: "casper-eip712"; typedData: Cep3009TypedData };
  /** Both arguments are hex with a one-byte algorithm tag: `01` ed25519, `02` secp256k1. */
  complete(publicKey: string, signature: string): CasperPaymentPayload | Refusal;
}

const ID = "x402/exact/casper" as const;
const NETWORK = /^casper:[a-z0-9-]{1,64}$/;
const PACKAGE = /^[0-9a-fA-F]{64}$/;
const ADDRESS = /^0[01][0-9a-fA-F]{64}$/;
const NONCE = /^(0x)?[0-9a-fA-F]{64}$/;
const TAGGED = /^0[12](?:[0-9a-fA-F]{2})+$/;
const MAX_NAME = 64;
const MAX_PUBLIC_KEY_HEX = 68;
const MAX_SIGNATURE_HEX = 132;
const CALLS = new Set(["transfer_with_authorization", "receive_with_authorization"]);

/** The CEP-3009 typed data for `TransferWithAuthorization`, with `validAfter` 0 and the hash as the nonce. */
export function cep3009TypedData(a: {
  network: CasperNetwork;
  asset: PackageHash;
  name: string;
  version: string;
  from: CasperAddress;
  to: CasperAddress;
  value: string;
  validBefore: bigint;
  nonce: AtrHash;
}): Cep3009TypedData | Refusal {
  if (typeof a.network !== "string" || !NETWORK.test(a.network)) return refusal("casper/network-malformed");
  if (typeof a.asset !== "string" || !PACKAGE.test(a.asset)) return refusal("casper/option-malformed");
  if (!isName(a.name) || !isName(a.version)) return refusal("casper/option-malformed");
  if (!isAddress(a.from) || !isAddress(a.to)) return refusal("casper/address-malformed");
  const value = uint256Of(a.value);
  if (value === undefined) return refusal("casper/amount-malformed");
  if (typeof a.validBefore !== "bigint" || a.validBefore < 0n || a.validBefore >= UINT256_LIMIT) {
    return refusal("casper/option-malformed");
  }
  const nonce = normalHash(a.nonce);
  if (nonce === null) return refusal("casper/payload-malformed");
  return {
    domain: { name: a.name, version: a.version, chain_name: a.network, contract_package_hash: a.asset },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chain_name", type: "string" },
        { name: "contract_package_hash", type: "bytes32" },
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { from: a.from, to: a.to, value, validAfter: 0n, validBefore: a.validBefore, nonce: nonce.slice(2) },
  };
}

/** SHA-256 over the 33 + 33 bytes of the two addresses and the value as a 32-byte big-endian integer. */
export async function casperIdDigest(from: CasperAddress, to: CasperAddress, value: bigint): Promise<Hex | Refusal> {
  if (!isAddress(from) || !isAddress(to)) return refusal("casper/address-malformed");
  if (typeof value !== "bigint" || value < 0n || value >= UINT256_LIMIT) return refusal("casper/amount-malformed");
  const packed = new Uint8Array(98);
  packed.set(hexBytes(from), 0);
  packed.set(hexBytes(to), 33);
  let rest = value;
  for (let i = 97; i >= 66; i--) {
    packed[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return hash(packed);
}

/**
 * Reads the named transaction. Settled, at the height of its block, when it executed without error as a call to
 * `ref.asset`'s `transfer_with_authorization` or `receive_with_authorization` whose `nonce` argument is `h` and whose
 * `from`, `to` and `value` hash to `ref.idDigest`. A failed read, or a reader for another network, is pending.
 */
export async function casperStatus(
  ref: CasperRef & { transaction: string; h: AtrHash },
  reader: CasperReader,
): Promise<CasperStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  let call: CasperCall | null;
  try {
    call = await reader.transaction(ref.transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (call === null) return { state: "pending", why: "not-found" };
  if (!isCall(call)) return { state: "pending", why: "unreadable" };
  if (!call.executed) return { state: "pending", why: "not-executed" };
  if (call.error !== null) return { state: "failed", why: "reverted" };
  if (call.blockHeight === null) return { state: "pending", why: "unreadable" };
  const nonce = authorizationNonce(call, ref.asset);
  if (nonce === null || !hashEquals(nonce, ref.h)) return { state: "failed", why: "not-this-instrument" };
  const { from, to, value } = call.args;
  if (from === undefined || to === undefined || value === undefined) {
    return { state: "failed", why: "not-this-instrument" };
  }
  const digest = await casperIdDigest(from, to, value);
  if (isRefusal(digest) || !hashEquals(digest, ref.idDigest)) return { state: "failed", why: "not-this-instrument" };
  return { state: "settled", finality: "finalized", blockHeight: call.blockHeight };
}

/** The hash from a settlement transaction alone: the `nonce` argument of the executed authorization call on `asset`. */
export async function casperRecover(
  ref: { network: CasperNetwork; asset: PackageHash; transaction: string },
  reader: CasperReader,
): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("casper/wrong-reader");
  let call: CasperCall | null;
  try {
    call = await reader.transaction(ref.transaction);
  } catch {
    return refusal("casper/unreadable");
  }
  if (call === null) return refusal("casper/not-found");
  if (!isCall(call)) return refusal("casper/unreadable");
  if (!call.executed) return refusal("casper/not-executed");
  if (call.error !== null) return refusal("casper/reverted");
  const nonce = authorizationNonce(call, ref.asset);
  if (nonce === null) return refusal("casper/no-authorization-call");
  return nonce;
}

/** The `nonce` argument of a CEP-3009 authorization call on `asset`, or null for any other call. */
function authorizationNonce(call: CasperCall, asset: PackageHash): AtrHash | null {
  if (call.packageHash === null || typeof asset !== "string") return null;
  if (call.packageHash.toLowerCase() !== asset.toLowerCase()) return null;
  if (call.entryPoint === null || !CALLS.has(call.entryPoint)) return null;
  const n = call.args.nonce;
  return n instanceof Uint8Array ? fromRawBytes(n) : null;
}

function isCall(c: unknown): c is CasperCall {
  if (!isObject(c)) return false;
  const { executed, blockHeight, error, packageHash, entryPoint, args } = c;
  return (
    typeof executed === "boolean" &&
    (blockHeight === null || typeof blockHeight === "bigint") &&
    (error === null || typeof error === "string") &&
    (packageHash === null || typeof packageHash === "string") &&
    (entryPoint === null || typeof entryPoint === "string") &&
    isObject(args)
  );
}

/** The pairing's filter: an `exact` option on a `casper:` network that `build` can turn into typed data. */
export function casperOption(o: unknown): o is PaymentRequirements {
  if (!isObject(o)) return false;
  const extra = o["extra"];
  const timeout = o["maxTimeoutSeconds"];
  return (
    o["scheme"] === "exact" &&
    typeof o["network"] === "string" &&
    NETWORK.test(o["network"]) &&
    typeof o["asset"] === "string" &&
    PACKAGE.test(o["asset"]) &&
    isAddress(o["payTo"]) &&
    uint256Of(o["amount"]) !== undefined &&
    isObject(extra) &&
    isName(extra["name"]) &&
    isName(extra["version"]) &&
    typeof timeout === "number" &&
    Number.isSafeInteger(timeout) &&
    timeout > 0
  );
}

const advertise = advertiseFor(filterOf(casperOption));
const read: (doc: PaymentRequired) => X402Read | Refusal = readFor(filterOf(casperOption));

/** The CEP-3009 authorization the payer signs for the chosen option, with the hash as its nonce. */
async function build(c: CasperChoice, h: AtrHash): Promise<CasperUnsigned | Refusal> {
  const wrong = chosen(c.required, c.accepted, filterOf(casperOption));
  if (wrong !== true) return wrong;
  const { required, accepted, from, now } = c;
  if (!isAddress(from)) return refusal("casper/address-malformed");
  if (!Number.isSafeInteger(now) || now < 0) return refusal("casper/option-malformed");
  const validBefore = BigInt(now) + BigInt(accepted.maxTimeoutSeconds);
  const typedData = cep3009TypedData({
    network: accepted.network as CasperNetwork,
    asset: accepted.asset,
    name: accepted.extra!["name"] as string,
    version: accepted.extra!["version"] as string,
    from,
    to: accepted.payTo,
    value: accepted.amount,
    validBefore,
    nonce: h,
  });
  if (isRefusal(typedData)) return typedData;
  const authorization: CasperAuthorization = {
    from,
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: "0",
    validBefore: validBefore.toString(),
    nonce: typedData.message.nonce,
  };
  return {
    request: { kind: "casper-eip712", typedData },
    complete(publicKey: string, signature: string): CasperPaymentPayload | Refusal {
      if (!isTagged(publicKey, MAX_PUBLIC_KEY_HEX) || !isTagged(signature, MAX_SIGNATURE_HEX)) {
        return refusal("casper/signature-malformed");
      }
      if (publicKey.slice(0, 2) !== signature.slice(0, 2)) return refusal("casper/key-tag-mismatch");
      return paymentWith(required, accepted, { authorization: { ...authorization }, publicKey, signature });
    },
  };
}

/**
 * The hash inside what the payer signed: the authorization's nonce, lowercase. The signature is not verified here;
 * the token contract verifies it, and that the key is the payer's, when it executes the transfer.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const p = paymentOf(presented);
  if (isRefusal(p)) return p;
  const n = p.payload.authorization.nonce;
  return normalHash(n.startsWith("0x") ? n : `0x${n}`)!;
}

/** The read keys for finding this payment later: network, token package, `validBefore` and the transfer's digest. */
async function reference(presented: unknown): Promise<CasperRef | Refusal> {
  const p = paymentOf(presented);
  if (isRefusal(p)) return p;
  const a = p.payload.authorization;
  const value = uint256Of(a.value);
  const settleBy = Number(a.validBefore);
  if (value === undefined || !/^[0-9]{1,16}$/.test(a.validBefore) || !Number.isSafeInteger(settleBy)) {
    return refusal("casper/payload-malformed");
  }
  const idDigest = await casperIdDigest(a.from, a.to, value);
  if (isRefusal(idDigest)) return refusal("casper/payload-malformed");
  return {
    network: p.accepted.network as CasperNetwork,
    asset: p.accepted.asset.toLowerCase(),
    idDigest,
    settleBy,
  };
}

/** The option unchanged: on this pairing the hash rides in the authorization, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

/** The payment's shape as this pairing requires it, or `casper/payload-malformed`. */
function paymentOf(presented: unknown): CasperPaymentPayload | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("casper/payload-malformed");
  if (!casperOption(presented["accepted"])) return refusal("casper/payload-malformed");
  const payload = presented["payload"];
  if (!isObject(payload)) return refusal("casper/payload-malformed");
  const a = payload["authorization"];
  if (!isObject(a)) return refusal("casper/payload-malformed");
  for (const k of ["from", "to", "value", "validAfter", "validBefore", "nonce"]) {
    if (typeof a[k] !== "string") return refusal("casper/payload-malformed");
  }
  if (!NONCE.test(a["nonce"] as string)) return refusal("casper/payload-malformed");
  if (!isTagged(payload["publicKey"], MAX_PUBLIC_KEY_HEX) || !isTagged(payload["signature"], MAX_SIGNATURE_HEX)) {
    return refusal("casper/payload-malformed");
  }
  return presented as CasperPaymentPayload;
}

function isAddress(s: unknown): s is CasperAddress {
  return typeof s === "string" && ADDRESS.test(s);
}

function isName(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && s.length <= MAX_NAME;
}

function isTagged(s: unknown, maxHex: number): s is string {
  return typeof s === "string" && s.length <= maxHex && TAGGED.test(s);
}

function hexBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  canonical: false,
  profile: ID,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a CEP-3009 transfer authorization whose nonce is this ATR's hash. The token contract verified " +
    "that signature, and that the signing key is the payer's, when it executed the transfer, and the hash is on chain " +
    "as the nonce argument of that call. This does not show that amount, payee, asset or timing match the ATR's " +
    "content.",
});

export const exactCasper = Object.freeze({
  id: ID,
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  reference,
  status: casperStatus,
  recover: casperRecover,
});
