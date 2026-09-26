/**
 * Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing
 * one token `transfer`; its `Nonce` is the ATR hash's low 250 bits. Settlement is read from the executed call's trace
 * through a bounded reader. The chain holds 250 of the hash's bits, so a holder of the ATR confirms the hash from it
 * but nothing recovers the hash.
 */
import { fromLegalContext, hash, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { bytesOfHexDigits, decimalBelow } from "./rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  LEGAL_CONTEXT,
  paymentWith,
  presentedWith,
  readFor,
  tie,
  type LcpPattern,
  type OptionFilter,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
  type X402Payment,
} from "./x402.js";

export type StarknetNetwork = "starknet:SN_MAIN" | "starknet:SN_SEPOLIA";
/** Lowercase `0x` hex with no leading zero digit, below FELT_P. */
export type Felt = `0x${string}`;
export const FELT_P = 2n ** 251n + 17n * 2n ** 192n + 1n;
export const MASK_250 = 2n ** 250n - 1n;
/** The SNIP-9 any-caller sentinel, the short string `ANY_CALLER`. */
export const ANY_CALLER = "0x414e595f43414c4c4552";
/** sn_keccak("transfer") */
export const SELECTOR_TRANSFER = "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e";
/** sn_keccak("execute_from_outside_v2") */
export const SELECTOR_EXECUTE_FROM_OUTSIDE_V2 = "0x34cc13b274446654ca3233ed2c1620d4c5d1d32fd20b47146a3371064bdc57d";

export interface Field {
  name: string;
  type: string;
}

/** SNIP-12 revision 1, SNIP-9 v2, as x402's Starknet scheme prints it. */
export interface OutsideExecutionTypedData {
  types: { StarknetDomain: Field[]; OutsideExecution: Field[]; Call: Field[] };
  primaryType: "OutsideExecution";
  domain: { name: "Account.execute_from_outside"; version: 2; chainId: Felt; revision: 1 };
  message: {
    Caller: Felt;
    Nonce: Felt;
    "Execute After": "1";
    "Execute Before": string;
    Calls: [{ To: Felt; Selector: typeof SELECTOR_TRANSFER; Calldata: [Felt, Felt, Felt] }];
  };
}

export interface StarknetReceipt {
  finality: "PRE_CONFIRMED" | "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  execution: "SUCCEEDED" | "REVERTED";
  blockNumber: bigint | null;
}

export interface StarknetInvocation {
  contract: Felt;
  selector: Felt;
  calldata: readonly Felt[];
  reverted: boolean;
  calls: readonly StarknetInvocation[];
}

/** Bounded, read-only calls against one network's JSON-RPC node. Every failure rejects with `ReaderError`. */
export interface StarknetReader {
  readonly network: StarknetNetwork;
  /** `starknet_getTransactionReceipt`; null: unknown hash. */
  receipt(tx: Felt): Promise<StarknetReceipt | null>;
  /** `starknet_traceTransaction`'s `execute_invocation`; null: none. */
  trace(tx: Felt): Promise<StarknetInvocation | null>;
}

/** The read keys recorded at claim; `transaction` is added when the facilitator names it. */
export interface StarknetRef {
  network: StarknetNetwork;
  transaction?: Felt;
  /** The payer's account: the contract whose outside-execution nonce is `nonce`. */
  from: Felt;
  asset: Felt;
  nonce: Felt;
  idDigest: Hex;
  settleBy: number;
}

export type StarknetStatus =
  | { state: "settled"; finality: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1"; blockNumber: bigint }
  | { state: "pending"; why: "not-found" | "pre-confirmed" | "unreadable" }
  | { state: "failed"; why: "reverted" | "not-this-instrument" };

export type StarknetPayment = X402Payment<{
  from: Felt;
  outsideExecution: { typedData: OutsideExecutionTypedData; signature: readonly Felt[] };
}>;

export interface StarknetUnsigned {
  /** The typed data the account's key signs; SNIP-12 hashes the account in. */
  request: { kind: "starknet-snip12"; typedData: OutsideExecutionTypedData; account: Felt };
  /** Takes the signature as 1 to 32 felts. */
  complete(signature: readonly Felt[]): StarknetPayment | Refusal;
}

const ID = "x402/exact/starknet" as const;
const NETWORKS: readonly string[] = ["starknet:SN_MAIN", "starknet:SN_SEPOLIA"];
const U128 = 1n << 128n;
const U256_LIMIT = 1n << 256n;
const MAX_SIGNATURE_FELTS = 32;
const MAX_TYPED_DATA_CHARS = 16_384;
const MAX_DEPTH = 16;
const MAX_INVOCATIONS = 512;
const FELT_TEXT = /^0x[0-9a-fA-F]{1,64}$/;
const DECIMAL = /^[0-9]{1,78}$/;

/** The value of `0x` and 1 to 64 hex digits below FELT_P, or undefined. */
function feltValue(s: unknown): bigint | undefined {
  if (typeof s !== "string" || !FELT_TEXT.test(s)) return undefined;
  const v = BigInt(s);
  return v < FELT_P ? v : undefined;
}

function feltOf(v: bigint): Felt {
  return `0x${v.toString(16)}`;
}

/**
 * The hash's low 250 bits as a felt: the way Starknet fits a 256-bit hash into a felt. A value that is not a 32-byte
 * hash is `x402/payload-malformed`.
 */
export function snNonce(h: AtrHash): Felt | Refusal {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  return feltOf(BigInt(nh) & MASK_250);
}

/** The network's reference as a short-string felt. */
export function chainIdFelt(n: StarknetNetwork): Felt {
  return feltOf(shortString(n.slice("starknet:".length))!);
}

/** A short string of at most 31 ASCII characters as a felt, or undefined. */
function shortString(s: string): bigint | undefined {
  if (s.length === 0 || s.length > 31) return undefined;
  let v = 0n;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) return undefined;
    v = (v << 8n) | BigInt(c);
  }
  return v;
}

/** A chain id as x402 allows it: hex, decimal or the short string. */
function chainIdValue(v: unknown): bigint | undefined {
  if (typeof v !== "string") return undefined;
  if (FELT_TEXT.test(v)) return feltValue(v);
  if (DECIMAL.test(v)) return BigInt(v);
  return shortString(v);
}

/** x402's `OutsideExecution` for one `transfer(payTo, amount)` on `asset`, with the fee payer as `Caller`. */
export function outsideExecution(a: {
  network: StarknetNetwork;
  feePayer: Felt;
  asset: Felt;
  payTo: Felt;
  amount: bigint;
  executeBefore: number;
  nonce: Felt;
}): OutsideExecutionTypedData | Refusal {
  if (!NETWORKS.includes(a.network)) return refusal("starknet/network-malformed");
  const feePayer = feltValue(a.feePayer);
  const asset = feltValue(a.asset);
  const payTo = feltValue(a.payTo);
  const nonce = feltValue(a.nonce);
  if (feePayer === undefined || asset === undefined || payTo === undefined || nonce === undefined) {
    return refusal("starknet/felt-malformed");
  }
  if (typeof a.amount !== "bigint" || a.amount < 0n || a.amount >= U256_LIMIT) return refusal("starknet/option-malformed");
  if (!Number.isSafeInteger(a.executeBefore) || a.executeBefore < 2) return refusal("starknet/option-malformed");
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      OutsideExecution: [
        { name: "Caller", type: "ContractAddress" },
        { name: "Nonce", type: "felt" },
        { name: "Execute After", type: "u128" },
        { name: "Execute Before", type: "u128" },
        { name: "Calls", type: "Call*" },
      ],
      Call: [
        { name: "To", type: "ContractAddress" },
        { name: "Selector", type: "selector" },
        { name: "Calldata", type: "felt*" },
      ],
    },
    primaryType: "OutsideExecution",
    domain: { name: "Account.execute_from_outside", version: 2, chainId: chainIdFelt(a.network), revision: 1 },
    message: {
      Caller: feltOf(feePayer),
      Nonce: feltOf(nonce),
      "Execute After": "1",
      "Execute Before": String(a.executeBefore),
      Calls: [
        {
          To: feltOf(asset),
          Selector: SELECTOR_TRANSFER,
          Calldata: [feltOf(payTo), feltOf(a.amount % U128), feltOf(a.amount / U128)],
        },
      ],
    },
  };
}

/** the core's `hash` over `from`, `to` and `amount` as three 32-byte big-endian words: the identity of one transfer. */
export async function starknetIdDigest(from: Felt, to: Felt, amount: bigint): Promise<Hex | Refusal> {
  const f = feltValue(from);
  const t = feltValue(to);
  if (f === undefined || t === undefined) return refusal("starknet/felt-malformed");
  if (typeof amount !== "bigint" || amount < 0n || amount >= U256_LIMIT) return refusal("starknet/option-malformed");
  const out = new Uint8Array(96);
  [f, t, amount].forEach((v, k) => out.set(word(v), 32 * k));
  return hash(out);
}

function word(v: bigint): Uint8Array {
  return bytesOfHexDigits(v.toString(16).padStart(64, "0"))!;
}

// ── Settlement.

/**
 * Reads the named transaction's receipt, then walks its trace for exactly one non-reverted
 * `execute_from_outside_v2` whose calldata carries this nonce and whose direct, non-reverted call is `transfer` on
 * `ref.asset` with this transfer's identity. A failed read, or a reader for another network, is pending. Two calls.
 */
export async function starknetStatus(ref: StarknetRef & { transaction: Felt }, reader: StarknetReader): Promise<StarknetStatus> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  let receipt: StarknetReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (receipt === null) return { state: "pending", why: "not-found" };
  if (!isReceipt(receipt)) return { state: "pending", why: "unreadable" };
  if (receipt.finality === "PRE_CONFIRMED" || receipt.blockNumber === null) return { state: "pending", why: "pre-confirmed" };
  if (receipt.execution === "REVERTED") return { state: "failed", why: "reverted" };
  const found = await matches(ref, reader);
  if (found === "unreadable" || found.length > 1) return { state: "pending", why: "unreadable" };
  if (found.length === 0) return { state: "failed", why: "not-this-instrument" };
  return { state: "settled", finality: receipt.finality, blockNumber: receipt.blockNumber };
}

/**
 * The nonce that landed in the named transaction for this transfer, for a party holding the ATR to compare with the
 * hash's low 250 bits. It is found by the transfer's identity on `ref.asset`, not by the recorded nonce.
 */
export async function starknetLandedNonce(ref: StarknetRef & { transaction: Felt }, reader: StarknetReader): Promise<Felt | Refusal> {
  if (reader.network !== ref.network) return refusal("starknet/wrong-reader");
  let receipt: StarknetReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return refusal("starknet/unreadable");
  }
  if (receipt === null) return refusal("starknet/not-found");
  if (!isReceipt(receipt)) return refusal("starknet/unreadable");
  if (receipt.execution === "REVERTED") return refusal("starknet/reverted");
  const found = await matches({ ...ref, nonce: undefined }, reader);
  if (found === "unreadable") return refusal("starknet/unreadable");
  if (found.length === 0) return refusal("starknet/not-found");
  const nonces = new Set(found.map((n) => feltOf(n)));
  if (nonces.size > 1) return refusal("starknet/ambiguous");
  return [...nonces][0]!;
}

/**
 * The nonces of the non-reverted `execute_from_outside_v2` invocations in the trace whose direct, non-reverted
 * `transfer` call on `asset` has the reference's identity digest, filtered to `nonce` when it is given.
 */
async function matches(
  ref: { transaction: Felt; asset: Felt; idDigest: Hex; nonce: Felt | undefined },
  reader: StarknetReader,
): Promise<bigint[] | "unreadable"> {
  let root: StarknetInvocation | null;
  try {
    root = await reader.trace(ref.transaction);
  } catch {
    return "unreadable";
  }
  if (root === null) return "unreadable";
  const asset = feltValue(ref.asset);
  const nonce = ref.nonce === undefined ? undefined : feltValue(ref.nonce);
  if (asset === undefined || (ref.nonce !== undefined && nonce === undefined)) return "unreadable";
  const execute = BigInt(SELECTOR_EXECUTE_FROM_OUTSIDE_V2);
  const transfer = BigInt(SELECTOR_TRANSFER);
  const found: bigint[] = [];
  const stack: { inv: StarknetInvocation; depth: number }[] = [{ inv: root, depth: 1 }];
  let visited = 0;
  while (stack.length > 0) {
    const { inv, depth } = stack.pop()!;
    if (!isInvocation(inv) || depth > MAX_DEPTH || ++visited > MAX_INVOCATIONS) return "unreadable";
    if (!inv.reverted && feltValue(inv.selector) === execute) {
      const landed = feltValue(inv.calldata[1]);
      if (landed !== undefined && (nonce === undefined || landed === nonce)) {
        for (const call of inv.calls) {
          if (!isInvocation(call) || call.reverted) continue;
          if (feltValue(call.contract) !== asset || feltValue(call.selector) !== transfer) continue;
          const [to, low, high] = call.calldata.map(feltValue);
          if (to === undefined || low === undefined || high === undefined || low >= U128 || high >= U128) continue;
          const digest = await starknetIdDigest(inv.contract, feltOf(to), low + high * U128);
          if (!isRefusal(digest) && digest === ref.idDigest) found.push(landed);
        }
      }
    }
    for (const c of inv.calls) stack.push({ inv: c, depth: depth + 1 });
  }
  return found;
}

function isReceipt(r: unknown): r is StarknetReceipt {
  if (!isObject(r)) return false;
  const { finality, execution, blockNumber } = r;
  return (
    (finality === "PRE_CONFIRMED" || finality === "ACCEPTED_ON_L2" || finality === "ACCEPTED_ON_L1") &&
    (execution === "SUCCEEDED" || execution === "REVERTED") &&
    (blockNumber === null || typeof blockNumber === "bigint")
  );
}

function isInvocation(v: unknown): v is StarknetInvocation {
  if (!isObject(v)) return false;
  return (
    typeof v["contract"] === "string" &&
    typeof v["selector"] === "string" &&
    Array.isArray(v["calldata"]) &&
    typeof v["reverted"] === "boolean" &&
    Array.isArray(v["calls"])
  );
}

// ── The pairing.

const check: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact") return refusal("x402/option-not-this-pairing");
  if (typeof o.network !== "string" || !o.network.startsWith("starknet:")) return refusal("x402/option-not-this-pairing");
  const extra: unknown = o.extra;
  if (!isObject(extra)) return refusal("starknet/option-malformed");
  const method = extra["assetTransferMethod"];
  if (method !== undefined && method !== "default") return refusal("x402/option-not-this-pairing");
  const flow = extra["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  if (!NETWORKS.includes(o.network)) return refusal("starknet/network-malformed");
  const feePayer = feltValue(extra["feePayer"]);
  if (feltValue(o.asset) === undefined || feltValue(o.payTo) === undefined || feePayer === undefined) {
    return refusal("starknet/felt-malformed");
  }
  if (feePayer === 0n || feePayer === BigInt(ANY_CALLER)) return refusal("starknet/caller-forbidden");
  if (decimalBelow(o.amount, U256_LIMIT) === undefined) return refusal("starknet/option-malformed");
  if (!Number.isSafeInteger(o.maxTimeoutSeconds) || o.maxTimeoutSeconds < 1) return refusal("starknet/option-malformed");
  return true;
};

/** This pairing's id for an option it can pay, or undefined. */
export function pairingOf(option: PaymentRequirements): typeof ID | undefined {
  return check(option) === true ? ID : undefined;
}

function advertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  return advertiseFor(check)(doc, h, link, offer, agreementUrl);
}

function read(doc: PaymentRequired): X402Read | Refusal {
  return readFor(check)(doc);
}

/** x402's typed data for the chosen option, with `Nonce` the hash's low 250 bits. */
async function build(
  c: { required: PaymentRequired; accepted: PaymentRequirements; from: Felt; now: number },
  h: AtrHash,
): Promise<StarknetUnsigned | Refusal> {
  if (!isObject(c)) return refusal("starknet/option-malformed");
  const { required, accepted, from, now } = c;
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  const account = feltValue(from);
  if (account === undefined) return refusal("starknet/felt-malformed");
  const feePayer = accepted.extra!["feePayer"] as Felt;
  if (account === feltValue(feePayer)) return refusal("starknet/caller-forbidden");
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!Number.isSafeInteger(now) || now < 0) return refusal("starknet/option-malformed");
  const nonce = snNonce(nh);
  if (isRefusal(nonce)) return nonce;
  const typedData = outsideExecution({
    network: accepted.network as StarknetNetwork,
    feePayer,
    asset: accepted.asset as Felt,
    payTo: accepted.payTo as Felt,
    amount: BigInt(accepted.amount),
    executeBefore: now + accepted.maxTimeoutSeconds,
    nonce,
  });
  if (isRefusal(typedData)) return typedData;
  const payer = feltOf(account);
  return {
    request: { kind: "starknet-snip12", typedData, account: payer },
    complete(signature: readonly Felt[]): StarknetPayment | Refusal {
      if (!Array.isArray(signature) || signature.length < 1 || signature.length > MAX_SIGNATURE_FELTS) {
        return refusal("starknet/signature-malformed");
      }
      if (!signature.every((s) => feltValue(s) !== undefined)) return refusal("starknet/signature-malformed");
      return paymentWith(required, accepted, {
        from: payer,
        outsideExecution: { typedData, signature: [...signature] },
      });
    },
  };
}

type Signed = { accepted: PaymentRequirements; from: Felt; nonce: bigint; message: Record<string, unknown>; h: AtrHash };

/** The signed typed data's checks and the candidate hash from the echoed legal context, bound by the nonce. */
function signed(presented: unknown): Signed | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const from = p.payload["from"];
  if (feltValue(from) === undefined) return refusal("starknet/felt-malformed");
  const oe = p.payload["outsideExecution"];
  const td = isObject(oe) ? oe["typedData"] : undefined;
  if (!isObject(td) || JSON.stringify(td).length > MAX_TYPED_DATA_CHARS) return refusal("starknet/typed-data-malformed");
  const domain = td["domain"];
  const message = td["message"];
  if (td["primaryType"] !== "OutsideExecution" || !isObject(domain) || !isObject(message)) {
    return refusal("starknet/typed-data-malformed");
  }
  if (domain["name"] !== "Account.execute_from_outside") return refusal("starknet/typed-data-malformed");
  if ((domain["version"] !== 2 && domain["version"] !== "2") || (domain["revision"] !== 1 && domain["revision"] !== "1")) {
    return refusal("starknet/typed-data-malformed");
  }
  const chain = chainIdValue(domain["chainId"]);
  if (chain === undefined || chain !== BigInt(chainIdFelt(p.accepted.network as StarknetNetwork))) {
    return refusal("starknet/typed-data-malformed");
  }
  const nonce = feltValue(message["Nonce"]);
  if (nonce === undefined) return refusal("starknet/typed-data-malformed");
  const ext = p.extensions;
  const lc = isObject(ext) ? ext[LEGAL_CONTEXT] : undefined;
  const decoded = fromLegalContext({ legalContext: isObject(lc) ? lc["info"] : undefined });
  if (decoded === null) return refusal("starknet/no-legal-context");
  if ((BigInt(decoded.h) & MASK_250) !== nonce) return refusal("starknet/nonce-not-bound");
  return { accepted: p.accepted, from: from as Felt, nonce, message, h: decoded.h };
}

/**
 * The echoed hash whose low 250 bits are the nonce the payer signed. The signature is not verified here; the payer's
 * account contract verifies it at execution.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const s = signed(presented);
  return isRefusal(s) ? s : s.h;
}

/** The read keys: the payer's account, the token, the signed nonce, the transfer's identity digest and `Execute Before`. */
async function reference(presented: unknown): Promise<StarknetRef | Refusal> {
  const s = signed(presented);
  if (isRefusal(s)) return s;
  const calls = s.message["Calls"];
  const call = Array.isArray(calls) && calls.length === 1 && isObject(calls[0]) ? calls[0] : undefined;
  const data = call?.["Calldata"];
  if (!Array.isArray(data) || data.length !== 3) return refusal("starknet/typed-data-malformed");
  const [to, low, high] = (data as Json[]).map(feltValue);
  if (to === undefined || low === undefined || high === undefined || low >= U128 || high >= U128) {
    return refusal("starknet/typed-data-malformed");
  }
  const before = s.message["Execute Before"];
  const settleBy = typeof before === "string" && DECIMAL.test(before) ? Number(before) : NaN;
  if (!Number.isSafeInteger(settleBy)) return refusal("starknet/typed-data-malformed");
  const idDigest = await starknetIdDigest(s.from, feltOf(to), low + high * U128);
  if (isRefusal(idDigest)) return idDigest;
  return {
    network: s.accepted.network as StarknetNetwork,
    from: feltOf(feltValue(s.from)!),
    asset: feltOf(feltValue(s.accepted.asset)!),
    nonce: feltOf(s.nonce),
    idDigest,
    settleBy,
  };
}

/** The option unchanged: on this pairing the hash rides in the signed nonce, not in the option. */
function unplaced(option: PaymentRequirements): PaymentRequirements {
  return option;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "truncated-field",
  canonical: false,
  profile: ID,
  buyerSigns: true,
  onChain: true,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
  publicProof: true,
  proves:
    "The payer signed a SNIP-12 outside execution whose nonce is the low 250 bits of this ATR's hash. The payer's " +
    "account contract verified that signature when it executed the transfer call, and the nonce is in the settlement " +
    "transaction's calldata. A holder of the ATR can confirm the hash from the nonce; the chain alone does not reveal " +
    "all of it, and no event indexes it. This does not show that amount, payee, asset or timing match the ATR's " +
    "content.",
});

export const exactStarknet = Object.freeze({
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
  status: starknetStatus,
});
