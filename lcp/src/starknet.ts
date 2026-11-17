/**
 * Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing
 * one token `transfer`; its `Nonce` is the ATR hash's low 250 bits, or on an agreement the agreement value's. The read
 * is of that nonce on the payer's account, as state, and of the asset's `Transfer` events, receipts and traces, through
 * a bounded reader. The chain holds 250 of the hash's bits, so a holder of the ATR confirms the hash from it but nothing
 * recovers the hash.
 */
import { fromLegalContext, hash, hashEquals, type AtrHash, type Json } from "./core.js";
import type { Hex } from "./evm.js";
import { deepFreeze, isObject, jsonBytes, normalHash } from "./fields.js";
import type { StarknetPayment } from "./internal/starknet.js";
import {
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  paymentWith,
  presentedWith,
  readFor,
  sameJson,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { bytesOfHexDigits, decimalBelow } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  LEGAL_CONTEXT,
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { STARKNET } from "./internal/data/starknet.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import { agreementValue } from "./internal/core.js";
import {
  decide,
  type Act,
  type Facts,
  type Moved,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type Undecoded,
  type UnreadableReason,
} from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

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
/** sn_keccak("Transfer"): the first key of a SNIP-2 token's `Transfer` event. */
export const EVENT_TRANSFER = "0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9";

/**
 * The most felts of a signature lcp takes, x402's Starknet scheme's suggested bound: an account's signature is one
 * or a few felts, a multisig's one pair per signer.
 */
export const STARKNET_MAX_SIGNATURE_FELTS = 32;
/** The largest presented typed data lcp reads, in bytes of its JSON; one call's typed data is under 2 KiB. */
export const STARKNET_MAX_TYPED_DATA_BYTES = 16_384;
/**
 * The deepest trace lcp walks, in levels, the root being 1: a forwarder, the payer's account, a proxy's library call
 * and the token's transfer sit well within it. A deeper trace is beyond the read's bound.
 */
export const STARKNET_MAX_TRACE_DEPTH = 16;
/** The most invocations of one trace lcp walks. A larger trace is beyond the read's bound. */
export const STARKNET_MAX_TRACE_INVOCATIONS = 512;
/** The most events lcp reads in one receipt, and in one page of `starknet_getEvents`. More are beyond the read's bound. */
export const STARKNET_MAX_EVENTS = 1024;
/**
 * The most pages of `starknet_getEvents` one `status` call reads. A range's size is the chain's; a search cut short
 * returns its position, from which the next call resumes.
 */
export const STARKNET_MAX_EVENT_PAGES = 8;
/**
 * The most candidate transactions, each a receipt and a trace, one `status` call reads. A search cut short returns
 * its position, from which the next call resumes. It is also the most other acts a caller gives by their transaction,
 * each read the same way; a query that gives more is `unreadable`, `too-large`, with nothing read.
 */
export const STARKNET_MAX_CANDIDATES = 16;
/** The longest continuation token, in characters, lcp carries in a search position. */
export const STARKNET_MAX_CONTINUATION = 1024;
/**
 * The JSON-RPC error codes with which `starknet_call` answers a nonce read on an account that runs no outside
 * execution at that block: `CONTRACT_NOT_FOUND` (20), an account not deployed, and `ENTRYPOINT_NOT_FOUND` (21), an
 * account with no SNIP-9 entry point (Starknet JSON-RPC's `starknet_call` errors, as `@starknet-io/types-js` 0.10.3
 * types them). Its nonce reads unconsumed there.
 */
const NO_OUTSIDE_EXECUTION: readonly unknown[] = [20, 21];

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

/** One event of a receipt: the emitting contract, its keys and its data. */
export interface StarknetEvent {
  fromAddress: Felt;
  keys: readonly Felt[];
  data: readonly Felt[];
}

/** One event of `starknet_getEvents`: the event, the transaction that emitted it and that transaction's block. */
export interface StarknetEmittedEvent extends StarknetEvent {
  transaction: Felt;
  blockNumber: bigint | null;
}

/** One page of `starknet_getEvents`: its events in the chain's order, and the token of the next page, null at the end. */
export interface StarknetEventPage {
  events: readonly StarknetEmittedEvent[];
  continuation: string | null;
}

/** What one page of `starknet_getEvents` asks: the emitting contract, the keys, the blocks (both included) and the page. */
export interface StarknetEventQuery {
  address: Felt;
  keys: readonly (readonly Felt[])[];
  from: bigint;
  to: bigint;
  continuation?: string;
}

export interface StarknetReceipt {
  finality: "PRE_CONFIRMED" | "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  execution: "SUCCEEDED" | "REVERTED";
  blockNumber: bigint | null;
  /** The receipt's `events`. A call that failed, and every call under it, leaves none here. */
  events: readonly StarknetEvent[];
}

export interface StarknetInvocation {
  contract: Felt;
  selector: Felt;
  calldata: readonly Felt[];
  reverted: boolean;
  calls: readonly StarknetInvocation[];
}

/** The read's marks, lowest first: `ACCEPTED_ON_L2`, the newest block (`latest`), and `ACCEPTED_ON_L1`, the final one. */
export type StarknetMark = "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";

/** The newest block at a mark: its number, and its own timestamp in Unix seconds. */
export interface StarknetHead {
  number: bigint;
  timestamp: bigint;
}

/**
 * Bounded, read-only calls against one network's JSON-RPC node. Every failure rejects, for example with `ReaderError`
 * from `@integraledger/lcp/evm`; any rejection reads as unreadable.
 */
export interface StarknetReader {
  readonly network: StarknetNetwork;
  /** `starknet_getTransactionReceipt`, with its events; null: unknown hash. */
  receipt(tx: Felt): Promise<StarknetReceipt | null>;
  /** `starknet_traceTransaction`'s `execute_invocation`; null: none. */
  trace(tx: Felt): Promise<StarknetInvocation | null>;
  /** The newest block at `mark`: `ACCEPTED_ON_L2` the block `latest` names, `ACCEPTED_ON_L1` the newest accepted on L1. */
  head(mark: StarknetMark): Promise<StarknetHead>;
  /**
   * `is_valid_outside_execution_nonce(nonce)` on `account`, by `starknet_call` at the block numbered `block`: true where
   * the nonce is unused there, false where it is used, null where the node does not serve that block's state. Where the
   * node answers the call with a JSON-RPC error, it rejects with an error whose `code` member is that error's code, as
   * starknet.js's `RpcError` does: `CONTRACT_NOT_FOUND` (20) and `ENTRYPOINT_NOT_FOUND` (21) read as an account that
   * runs no outside execution at that block, its nonce unconsumed there.
   */
  nonceValid(account: Felt, nonce: Felt, block: bigint): Promise<boolean | null>;
  /** One page of `starknet_getEvents`; null where the node does not hold the range. */
  events(query: StarknetEventQuery): Promise<StarknetEventPage | null>;
}

/** One call of an outside execution: the contract, the selector and the calldata, each a felt. */
export interface StarknetCall {
  to: Felt;
  selector: Felt;
  calldata: readonly Felt[];
}

/** An outside execution as the payer signed it, its signature apart, every member a felt in its shortest spelling. */
export interface StarknetOutsideExecution {
  caller: Felt;
  nonce: Felt;
  executeAfter: Felt;
  executeBefore: Felt;
  calls: readonly StarknetCall[];
}

/**
 * The read keys `reference` returns: the network, the payer's account (the contract whose outside-execution nonce is
 * `nonce`), the asset, which is the event search's key, the signed nonce (H's low 250 bits on a payment, the agreement
 * value's on an agreement), `settleBy`, which is `Execute Before`, the payee, the `payTo` of the option the payment
 * answers, and the outside execution as presented, for `presented`.
 */
export interface StarknetRef {
  network: StarknetNetwork;
  from: Felt;
  asset: Felt;
  nonce: Felt;
  payee: string;
  settleBy: number;
  presented: StarknetOutsideExecution;
}

/**
 * The search's position: the blocks it reads (`from` to `to`, both included; `to` absent where the nonce has not been
 * read consumed), the continuation of the page to read, and the events of that page already read.
 */
export interface StarknetCursor {
  readonly from: bigint;
  readonly to?: bigint;
  readonly continuation?: string;
  readonly skip?: number;
}

/**
 * The answer of `starknetStatus`, as the profile `read-status` gives it. Its marks are `ACCEPTED_ON_L2` and
 * `ACCEPTED_ON_L1`, in that order, its position the block number, and its search position a `StarknetCursor`. Each
 * transfer it names carries its transaction and its `place`: a `Transfer` its event's index among its receipt's
 * `events`, a number; a transfer call of zero the indexes of the calls that lead to it from the trace's root, joined by
 * `.`, a string.
 */
export type StarknetStatus = StatusAnswer<bigint, StarknetMark, StarknetCursor>;

export interface StarknetUnsigned {
  /** The typed data the account's key signs; SNIP-12 hashes the account in. */
  request: { kind: "starknet-snip12"; typedData: OutsideExecutionTypedData; account: Felt };
  /** Takes the signature as 1 to 32 felts. */
  complete(signature: readonly Felt[]): StarknetPayment | Refusal;
}

const ID = "x402/exact/starknet" as const;
const NETWORKS: readonly string[] = ["starknet:SN_MAIN", "starknet:SN_SEPOLIA"];
const U64_LIMIT = 1n << 64n;
const U128 = 1n << 128n;
const U256_LIMIT = 1n << 256n;
const MAX_DEPTH = STARKNET_MAX_TRACE_DEPTH;
const MAX_INVOCATIONS = STARKNET_MAX_TRACE_INVOCATIONS;
const FELT_TEXT = /^0x[0-9a-fA-F]{1,64}$/;
const DECIMAL = /^[0-9]{1,78}$/;
const TRANSFER_KEY = BigInt(EVENT_TRANSFER);
const TRANSFER = BigInt(SELECTOR_TRANSFER);
const EXECUTE = BigInt(SELECTOR_EXECUTE_FROM_OUTSIDE_V2);
const FINAL = "ACCEPTED_ON_L1" as const;
const MARKS: readonly StarknetMark[] = ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"];

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

/** The network's reference as a short-string felt. Throws TypeError on a network that is not a `StarknetNetwork`. */
export function chainIdFelt(n: StarknetNetwork): Felt {
  if (!NETWORKS.includes(n)) throw new TypeError("not a Starknet network");
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

/** A `u64` of the typed data, written as a decimal or as a felt, or undefined. */
function u64Value(v: unknown): bigint | undefined {
  if (typeof v !== "string") return undefined;
  const n = FELT_TEXT.test(v) ? feltValue(v) : DECIMAL.test(v) ? BigInt(v) : undefined;
  return n !== undefined && n < U64_LIMIT ? n : undefined;
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
  if (!isObject(a) || !NETWORKS.includes(a.network)) return refusal("starknet/network-malformed");
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

// ── The read.

/**
 * The reference `status` reads with: the read keys, H, which the caller adds, and the transaction a settler named; the
 * outside execution as presented where the caller has it, without which the read compares nothing with it.
 */
type StarknetRefRead = Omit<StarknetRef, "presented"> & { presented?: StarknetOutsideExecution; h: AtrHash; transaction?: Felt };

/** An outside execution as numbers: its `Caller`, `Nonce`, window and calls. */
interface Execution {
  readonly caller: bigint;
  readonly nonce: bigint;
  readonly after: bigint;
  readonly before: bigint;
  readonly calls: readonly { readonly to: bigint; readonly selector: bigint; readonly calldata: readonly bigint[] }[];
}

/** A reference as the read takes it, its felts as numbers, and the two values under H. */
interface Keys {
  readonly network: StarknetNetwork;
  readonly from: bigint;
  readonly asset: bigint;
  readonly payee: bigint;
  readonly nonce: bigint;
  /** H's other value: the agreement value's low bits where the act's nonce is H's, and H's where it is the agreement value's. */
  readonly other: bigint;
  /** `Execute Before`, `settleBy`. */
  readonly before: bigint;
  readonly presented?: Execution;
  readonly transaction?: bigint;
}

/** The ledger: its two marks, and block numbers in their order. */
const LEDGER = ledgerOf<bigint, StarknetMark>(STARKNET[ID].coverage, MARKS, bigintOrder);

/**
 * The read keys of a reference for the act asked about, or undefined where one is malformed: the network, the payer, the
 * asset and the payee, each a felt; the signed nonce, the low 250 bits of the value that act carries (H on a payment,
 * the agreement's value on an agreement), and H; `settleBy`, a safe integer; and the outside execution as presented and
 * the named transaction, where the caller gives them.
 */
async function keysOf(ref: unknown, act: Act): Promise<Keys | undefined> {
  if (!isObject(ref)) return undefined;
  const { network, transaction } = ref;
  if (typeof network !== "string" || !NETWORKS.includes(network)) return undefined;
  const from = feltValue(ref["from"]);
  const asset = feltValue(ref["asset"]);
  const payee = feltValue(ref["payee"]);
  const nonce = feltValue(ref["nonce"]);
  const h = normalHash(ref["h"]);
  if (from === undefined || asset === undefined || payee === undefined || nonce === undefined || h === null) return undefined;
  const own = BigInt(h) & MASK_250;
  const agreed = BigInt(await agreementValue(h)) & MASK_250;
  if (nonce !== (act === "agreement" ? agreed : own)) return undefined;
  const settleBy = ref["settleBy"];
  if (!Number.isSafeInteger(settleBy) || (settleBy as number) < 0) return undefined;
  const presented = ref["presented"] === undefined ? undefined : presentedKeys(ref["presented"]);
  if (ref["presented"] !== undefined && presented === undefined) return undefined;
  const named = transaction === undefined ? undefined : feltValue(transaction);
  if (transaction !== undefined && named === undefined) return undefined;
  return {
    network: network as StarknetNetwork,
    from,
    asset,
    payee,
    nonce,
    other: nonce === own ? agreed : own,
    before: BigInt(settleBy as number),
    ...(presented === undefined ? {} : { presented }),
    ...(named === undefined ? {} : { transaction: named }),
  };
}

/** The outside execution as presented, as numbers, or undefined where a member is not a felt. */
function presentedKeys(p: unknown): Execution | undefined {
  if (!isObject(p) || !Array.isArray(p["calls"])) return undefined;
  const caller = feltValue(p["caller"]);
  const nonce = feltValue(p["nonce"]);
  const after = feltValue(p["executeAfter"]);
  const before = feltValue(p["executeBefore"]);
  if (caller === undefined || nonce === undefined || after === undefined || before === undefined) return undefined;
  const calls: Execution["calls"][number][] = [];
  for (const c of p["calls"] as unknown[]) {
    if (!isObject(c) || !Array.isArray(c["calldata"])) return undefined;
    const to = feltValue(c["to"]);
    const selector = feltValue(c["selector"]);
    const calldata = (c["calldata"] as unknown[]).map(feltValue);
    if (to === undefined || selector === undefined || calldata.some((d) => d === undefined)) return undefined;
    calls.push({ to, selector, calldata: calldata as bigint[] });
  }
  return { caller, nonce, after, before, calls };
}

function isCursor(c: unknown): c is StarknetCursor {
  if (!isObject(c)) return false;
  const { from, to, continuation, skip } = c;
  if (typeof from !== "bigint" || from < 0n) return false;
  if (to === undefined) return continuation === undefined && skip === undefined;
  if (typeof to !== "bigint" || to < 0n) return false;
  if (continuation !== undefined) {
    if (typeof continuation !== "string" || continuation.length === 0 || continuation.length > STARKNET_MAX_CONTINUATION) return false;
  }
  return skip === undefined || (Number.isSafeInteger(skip) && (skip as number) >= 0);
}

/** A read that cannot go on: the reason, its facts holding nothing. */
class Stop {
  constructor(readonly reason: UnreadableReason) {}
}

/** The reason of a rejected read: a `ReaderError` by its kind, and any other rejection `transport`. */
function rejected(e: unknown): UnreadableReason {
  if (e instanceof Stop) return e.reason;
  const kind = isObject(e) && e["name"] === "ReaderError" ? e["kind"] : undefined;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/** One `execute_from_outside_v2` the trace walk met, with the transfer calls under it. */
interface Executed {
  readonly account: bigint;
  readonly calldata: readonly unknown[];
  readonly nonce: bigint | undefined;
  /** Each `transfer` call under it: its contract, its calldata's `to` and amount where they are felts, and its path. */
  readonly transfers: { readonly token: bigint; readonly to?: bigint; readonly amount?: bigint; readonly path: readonly number[] }[];
}

/**
 * The `execute_from_outside_v2` invocations of a trace, at any depth, in the trace's order, each with the `transfer`
 * calls under it and not under an execution nested below it. A reverted invocation's whole subtree is skipped: a failed
 * call's descendants keep `is_reverted: false`, and their effects are rolled back with it. A call below a `transfer` is
 * the token's own execution of it (a library call repeats the frame) and is no transfer of its own. An invocation that
 * is not well formed is `malformed`; a trace nested deeper than `STARKNET_MAX_TRACE_DEPTH` levels or holding more than
 * `STARKNET_MAX_TRACE_INVOCATIONS` invocations is `beyond`, read no further.
 */
function executionsOf(root: unknown): Executed[] | "malformed" | "beyond" {
  const out: Executed[] = [];
  type Frame = { inv: unknown; depth: number; path: readonly number[]; under: Executed | undefined; inTransfer: boolean };
  const stack: Frame[] = [{ inv: root, depth: 1, path: [], under: undefined, inTransfer: false }];
  let visited = 0;
  while (stack.length > 0) {
    const { inv, depth, path, under, inTransfer } = stack.pop()!;
    if (depth > MAX_DEPTH || ++visited > MAX_INVOCATIONS) return "beyond";
    if (!isInvocation(inv)) return "malformed";
    if (inv.reverted) continue;
    const contract = feltValue(inv.contract);
    const selector = feltValue(inv.selector);
    if (contract === undefined || selector === undefined) return "malformed";
    let below = under;
    let transferBelow = inTransfer;
    if (selector === EXECUTE) {
      below = { account: contract, calldata: inv.calldata, nonce: feltValue(inv.calldata[1]), transfers: [] };
      out.push(below);
      transferBelow = false;
    } else if (selector === TRANSFER && !inTransfer) {
      if (under !== undefined) {
        const [to, low, high] = inv.calldata.map(feltValue);
        const amount = inv.calldata.length === 3 && low !== undefined && high !== undefined && low < U128 && high < U128 ? low + high * U128 : undefined;
        under.transfers.push({ token: contract, ...(to === undefined ? {} : { to }), ...(amount === undefined ? {} : { amount }), path });
      }
      transferBelow = true;
    }
    for (let i = inv.calls.length - 1; i >= 0; i--) {
      stack.push({ inv: inv.calls[i], depth: depth + 1, path: [...path, i], under: below, inTransfer: transferBelow });
    }
  }
  return out;
}

/** The outside execution an `execute_from_outside_v2` calldata carries, its signature apart, or undefined where it does not show it whole. */
function executionOf(calldata: readonly unknown[]): Execution | undefined {
  const v = calldata.map(feltValue);
  if (v.length < 6 || v.some((x) => x === undefined)) return undefined;
  const f = v as bigint[];
  const [caller, nonce, after, before, count] = f as [bigint, bigint, bigint, bigint, bigint];
  if (count > BigInt(f.length)) return undefined;
  const calls: Execution["calls"][number][] = [];
  let i = 5;
  for (let c = 0n; c < count; c++) {
    if (i + 3 > f.length || f[i + 2]! > BigInt(f.length)) return undefined;
    const end = i + 3 + Number(f[i + 2]!);
    if (end > f.length) return undefined;
    calls.push({ to: f[i]!, selector: f[i + 1]!, calldata: f.slice(i + 3, end) });
    i = end;
  }
  if (i >= f.length || BigInt(i + 1) + f[i]! !== BigInt(f.length)) return undefined;
  return { caller, nonce, after, before, calls };
}

/** Whether two outside executions are equal, member by member. */
function sameExecution(a: Execution, b: Execution): boolean {
  return (
    a.caller === b.caller &&
    a.nonce === b.nonce &&
    a.after === b.after &&
    a.before === b.before &&
    a.calls.length === b.calls.length &&
    a.calls.every((c, i) => {
      const d = b.calls[i]!;
      return c.to === d.to && c.selector === d.selector && c.calldata.length === d.calldata.length && c.calldata.every((x, j) => x === d.calldata[j]);
    })
  );
}

/** A standard `Transfer` of a receipt or a page: its token, sender, recipient and amount. */
interface Transfer {
  readonly token: bigint;
  readonly from: bigint;
  readonly to: bigint;
  readonly amount: bigint;
}

/**
 * The `Transfer` an event is, where its first key is `EVENT_TRANSFER`: in either standard layout, keyed (keys
 * `[selector, from, to]`, data `[low, high]`) or unkeyed (keys `[selector]`, data `[from, to, low, high]`), each limb
 * below 2^128. `neither` for an event with that key in neither layout, a member that is not a felt among them; undefined
 * for an event whose first key is another.
 */
function transferOf(e: StarknetEvent): Transfer | "neither" | undefined {
  if (feltValue(e.keys[0]) !== TRANSFER_KEY) return undefined;
  const token = feltValue(e.fromAddress);
  const keys = e.keys.map(feltValue);
  const data = e.data.map(feltValue);
  if (token === undefined || keys.includes(undefined) || data.includes(undefined)) return "neither";
  const [from, to, low, high] =
    keys.length === 3 && data.length === 2 ? [keys[1], keys[2], data[0], data[1]] : keys.length === 1 && data.length === 4 ? data : [];
  if (from === undefined || to === undefined || low === undefined || high === undefined || low >= U128 || high >= U128) return "neither";
  return { token, from, to, amount: low + high * U128 };
}

/** A transaction as the read classified it: what it saw there, `presented` stated on the act that consumed the nonce. */
interface Classified {
  readonly seen: Seen<bigint, StarknetMark>[];
}

/**
 * The read of one transaction: its receipt, and where it succeeded at a mark, its trace. Each outside execution under
 * either of H's values is seen: its signer against the reference's `from` and the payee, `same` where it carries the
 * act's own nonce, consumed only where that nonce is executed on the reference's account, what moved (each `Transfer`
 * of the receipt from its signer, by its event's index, and each `transfer` call of zero under it for which its token
 * emitted no `Transfer`, by its call path), the account that names against the payee; and on the act that consumed
 * the nonce, where the reference holds the outside execution as presented, `presented`, the landed one against it. A receipt that is `PRE_CONFIRMED`,
 * names no block, or is `REVERTED` decides nothing: its nonce use is rolled back. `unknown` where the node knows no
 * such transaction, `no-trace` where it gives no trace, `malformed` where an answer is not well formed or where the act
 * that consumed the nonce on a payment names no payee's account beside a `Transfer`-keyed event of neither layout, and
 * `beyond` past lcp's bounds.
 */
async function classify(
  k: Keys,
  query: StatusQuery<unknown, bigint, StarknetMark, StarknetCursor>,
  reader: StarknetReader,
  tx: bigint,
): Promise<Classified | "unknown" | "no-trace" | "malformed" | "beyond"> {
  const receipt = await reader.receipt(feltOf(tx));
  if (receipt === null) return "unknown";
  if (!isReceipt(receipt)) return "malformed";
  if (receipt.events.length > STARKNET_MAX_EVENTS) return "beyond";
  if (receipt.finality === "PRE_CONFIRMED" || receipt.blockNumber === null || receipt.execution !== "SUCCEEDED") return { seen: [] };
  const trace = await reader.trace(feltOf(tx));
  if (trace === null) return "no-trace";
  const executions = executionsOf(trace);
  if (typeof executions === "string") return executions;
  const transfers = receipt.events.map(transferOf);
  const neither = transfers.includes("neither");
  const seen: Seen<bigint, StarknetMark>[] = [];
  for (const e of executions) {
    if (e.nonce !== k.nonce && e.nonce !== k.other) continue;
    const signer = e.account;
    const fromSigner = transfers.flatMap((t, event) => (t !== undefined && t !== "neither" && t.from === signer ? [{ t, event }] : []));
    const moved: Moved[] = [
      ...fromSigner.map(({ t, event }) => ({
        asset: feltOf(t.token),
        amount: t.amount.toString(),
        to: feltOf(t.to),
        transaction: feltOf(tx),
        place: event,
      })),
      ...e.transfers
        .filter((z) => z.amount === 0n && z.to !== undefined)
        .filter((z) => !fromSigner.some(({ t }) => t.token === z.token && t.to === z.to && t.amount === 0n))
        .map((z) => ({ asset: feltOf(z.token), amount: "0", to: feltOf(z.to!), transaction: feltOf(tx), place: z.path.join(".") })),
    ];
    const same = e.nonce === k.nonce;
    const consumed = same && signer === k.from;
    const account = moved.some((m) => BigInt(m.to) === k.payee) ? "payee" : moved.length > 0 ? "other" : "none";
    if (consumed && neither && account !== "payee" && query.act === "payment") return "malformed";
    const landed = consumed && k.presented !== undefined ? executionOf(e.calldata) : undefined;
    const presented = landed === undefined ? "unshown" : sameExecution(landed, k.presented!) ? "yes" : "no";
    const given = (query.others ?? []).some(
      (o) => "ref" in o && isObject(o.ref) && feltValue(o.ref["from"]) === signer && feltValue(o.ref["nonce"]) === e.nonce,
    );
    seen.push({
      transaction: feltOf(tx),
      position: receipt.blockNumber,
      mark: receipt.finality,
      result: "succeeded",
      consumed,
      carries: true,
      party: signer === k.payee ? "payee" : signer === k.from ? "payer" : "other",
      kind: same ? "same" : "other",
      account,
      ...(given ? { given: true } : {}),
      ...(consumed && k.presented !== undefined ? { presented } : {}),
      moved,
      signer: feltOf(signer),
    });
  }
  return { seen };
}

/** What the read observed. */
interface StarknetRead {
  readonly facts: Facts<bigint, StarknetMark, StarknetCursor>;
}

/**
 * The read (profile rules 13 to 18): the named transaction first, and each other act the caller gave by its
 * transaction, which holds no search, one the read cannot decode being named `given`; then the nonce, as state, at the
 * newest `ACCEPTED_ON_L1` block and at the newest block, an account the node answers `CONTRACT_NOT_FOUND` or
 * `ENTRYPOINT_NOT_FOUND` for running no outside execution at that block, so its nonce valid there. Valid at both, those two reads are the search for H, read whole
 * (rule 26 of the profile `read-status`), lapsed where the final block's own timestamp is at or past `Execute Before`,
 * and, where only the newest block's is, lapsed as read below the final mark; a search position the caller gave comes
 * back past the newest block. Consumed, and its transaction not yet found: the
 * asset's `Transfer` events from the position given, or from the search position, to the block at which the nonce was
 * read consumed, a page at a time, each `Transfer` from the payer naming a candidate whose receipt and trace are read;
 * an event of neither layout, or a candidate the read cannot decode, held as an item the search could not decode. The
 * transaction that consumed the nonce, once found, makes the search whole, the nonce admitting no other.
 */
async function readStarknet(
  k: Keys,
  reader: StarknetReader,
  query: StatusQuery<unknown, bigint, StarknetMark, StarknetCursor>,
): Promise<StarknetRead> {
  const seen: Seen<bigint, StarknetMark>[] = [];
  const visited = new Set<bigint>();
  const undecoded: Undecoded<StarknetCursor>[] = [];
  const givenUndecoded: Undecoded<StarknetCursor>[] = [];
  const held = new Set<bigint>();
  let found = false;
  const take = (c: Classified): void => {
    for (const s of c.seen) {
      seen.push(s);
      if (s.consumed) found = true;
    }
  };
  if (k.transaction !== undefined) {
    visited.add(k.transaction);
    const c = await classify(k, query, reader, k.transaction);
    if (c === "malformed") throw new Stop("unparseable");
    if (c === "beyond") throw new Stop("too-large");
    if (c === "no-trace") throw new Stop("history-gap");
    if (c !== "unknown") take(c);
  }
  // Each other act given by its transaction is read as a named one is; it holds no search, and one the read cannot
  // decode is named `given` (read-status rule 19). One the node does not know is left to the search, if it meets it.
  for (const tx of givenTransactions(query)) {
    if (visited.has(tx) || held.has(tx)) continue;
    const c = await classify(k, query, reader, tx);
    if (c === "unknown") continue;
    if (typeof c === "string") {
      held.add(tx);
      givenUndecoded.push({ transaction: feltOf(tx) });
    } else {
      visited.add(tx);
      take(c);
    }
  }
  const final = await headAt(reader, FINAL);
  const latest = await headAt(reader, "ACCEPTED_ON_L2");
  // An account not deployed, or with no SNIP-9 entry point, at that block runs no outside execution there, so the nonce
  // reads unconsumed; any other error rejects, and the read establishes nothing.
  const validAt = async (block: bigint): Promise<boolean> => {
    const v = await reader.nonceValid(feltOf(k.from), feltOf(k.nonce), block).catch((e: unknown) => {
      if (isObject(e) && NO_OUTSIDE_EXECUTION.includes(e["code"])) return true;
      throw e;
    });
    if (v === null) throw new Stop("history-gap");
    if (typeof v !== "boolean") throw new Stop("unparseable");
    return v;
  };
  const validFinal = await validAt(final.number);
  const validLatest = latest.number === final.number ? validFinal : await validAt(latest.number);
  // Valid at both, and the newest block's own timestamp at or past `Execute Before` while the final block's is before
  // it: the validity passed as read below the final mark, which the final mark has not yet shown.
  const lapsedBelow = validFinal && validLatest && final.timestamp < k.before && latest.timestamp >= k.before;
  const value = lapsedBelow
    ? { consumed: false, lapsed: true, mark: "ACCEPTED_ON_L2" as const, head: { consumed: false } }
    : { consumed: !validFinal, lapsed: final.timestamp >= k.before, mark: FINAL, head: { consumed: !validLatest } };
  const read = (search: { whole: boolean; at?: StarknetCursor }): StarknetRead => {
    const items = [...givenUndecoded, ...undecoded];
    return { facts: { seen, value, search, ...(items.length === 0 ? {} : { undecoded: items }), history: true } };
  };
  if (validFinal && validLatest) return read({ whole: true, ...(query.search === undefined ? {} : { at: { from: latest.number + 1n } }) });
  if (found) return read({ whole: true });
  const cursor = query.search;
  const from = cursor?.from ?? query.after ?? 0n;
  const to = cursor?.to ?? (validFinal ? latest.number : final.number);
  let continuation = cursor?.continuation;
  let skip = cursor?.skip ?? 0;
  let candidates = 0;
  const hold = (tx: bigint, at: StarknetCursor): void => {
    held.add(tx);
    undecoded.push({ transaction: feltOf(tx), at });
  };
  for (let pages = 0; ; pages++) {
    const here: StarknetCursor = { from, to, ...(continuation === undefined ? {} : { continuation }) };
    if (pages === STARKNET_MAX_EVENT_PAGES) return read({ whole: false, at: here });
    const page = await reader.events({ address: feltOf(k.asset), keys: [[EVENT_TRANSFER]], from, to, ...(continuation === undefined ? {} : { continuation }) });
    if (page === null) throw new Stop("history-gap");
    if (!isPage(page)) throw new Stop("unparseable");
    if (page.events.length > STARKNET_MAX_EVENTS) throw new Stop("too-large");
    // The consumer, once found, makes the search whole: no candidate after it is read, so no bound cuts it short.
    for (let i = skip; i < page.events.length && !found; i++) {
      const e = page.events[i]!;
      if (!isEmitted(e)) throw new Stop("unparseable");
      const t = transferOf(e);
      if (t === undefined || feltValue(e.fromAddress) !== k.asset || (t !== "neither" && t.from !== k.from)) continue;
      const tx = feltValue(e.transaction)!;
      if (visited.has(tx) || held.has(tx)) continue;
      const at: StarknetCursor = { ...here, skip: i };
      if (t === "neither") {
        hold(tx, at);
        continue;
      }
      if (candidates === STARKNET_MAX_CANDIDATES) return read({ whole: false, at });
      candidates++;
      visited.add(tx);
      const c = await classify(k, query, reader, tx);
      if (typeof c === "string") hold(tx, at);
      else take(c);
    }
    skip = 0;
    if (found) {
      undecoded.length = 0;
      return read({ whole: true });
    }
    if (page.continuation === null) return read({ whole: true });
    if (page.continuation === continuation) throw new Stop("unparseable");
    continuation = page.continuation;
  }
}

/** The other acts the caller gave by their transaction, as felts, in the order given. */
function givenTransactions(query: StatusQuery<unknown, bigint, StarknetMark, StarknetCursor>): bigint[] {
  return (query.others ?? []).flatMap((o) => {
    const tx = "transaction" in o ? feltValue(o.transaction) : undefined;
    return tx === undefined ? [] : [tx];
  });
}

/** The newest block at a mark, or a stop where the answer is not one. */
async function headAt(reader: StarknetReader, mark: StarknetMark): Promise<StarknetHead> {
  const h: unknown = await reader.head(mark);
  if (!isObject(h) || typeof h["number"] !== "bigint" || h["number"] < 0n || typeof h["timestamp"] !== "bigint" || h["timestamp"] < 0n) {
    throw new Stop("unparseable");
  }
  return h as unknown as StarknetHead;
}

/**
 * The read of the act the query asks about, as the profile `read-status` answers it through the profile
 * `x402/exact/starknet`'s rules 12 to 22: the named transaction, the nonce as state, and the event search. A query, a
 * reference or a search position that is not one is `unreadable`, `unparseable`, with nothing read, a reader for
 * another network `chain-mismatch`, and a query that gives more than `STARKNET_MAX_CANDIDATES` other acts by their
 * transaction `too-large`. Felts compare as numbers, and transactions are named in their shortest lowercase spelling.
 * On `settled` the answer states `presented`.
 */
export async function starknetStatus(
  ref: StarknetRefRead,
  reader: StarknetReader,
  query: StatusQuery<StarknetRefRead, bigint, StarknetMark, StarknetCursor>,
): Promise<StarknetStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint" && p >= 0n) || (query.search !== undefined && !isCursor(query.search))) {
    return UNPARSEABLE;
  }
  const k = await keysOf(ref, query.act);
  if (k === undefined) return UNPARSEABLE;
  if (!isObject(reader) || reader.network !== k.network) return { state: "unreadable", reason: "chain-mismatch", foreign: [] };
  const others = query.others?.map((o) => {
    const tx = "transaction" in o ? feltValue(o.transaction) : undefined;
    return tx === undefined ? o : { transaction: feltOf(tx) };
  });
  const q = { ...query, ...(others === undefined ? {} : { others }) };
  if (givenTransactions(q).length > STARKNET_MAX_CANDIDATES) return { state: "unreadable", reason: "too-large", foreign: [] };
  let read: StarknetRead;
  try {
    read = await readStarknet(k, reader, q);
  } catch (e) {
    return { state: "unreadable", reason: rejected(e), foreign: [] };
  }
  return decide(read.facts, q, LEDGER);
}

/**
 * The value a settlement transaction carries in H's place, from the transaction alone (profile rule 23): the nonce of
 * its executed outside execution whose calls reach a `transfer` on the token the option names, `option.asset`, as `0x`
 * and 64 hex digits; H's low 250 bits on a payment, the agreement value's on an agreement, which a holder of the ATR
 * compares with the same bits of its own H, or of `agreementValue` of it. A reader for another network, or an input whose
 * `tx` or option's `asset` is not a felt, is `starknet/wrong-reader`, with nothing read. A failed read, a receipt that is
 * not well formed, or a trace that is missing, holds an invocation that is not well formed, or is beyond lcp's bounds,
 * which it reads no further, is `starknet/unreadable`, and no receipt `starknet/not-found`. A receipt at
 * `ACCEPTED_ON_L2` or `ACCEPTED_ON_L1` gives the verdict: a reverted transaction is `starknet/reverted`; a trace that
 * holds no such execution `starknet/no-transfer`; and executions under more than one nonce `starknet/ambiguous`. A
 * `PRE_CONFIRMED` receipt, or one with no block number, gives each of these as `starknet/not-final`. Two calls.
 */
export async function starknetRecover(
  input: RecoverInput<StarknetNetwork, PaymentRequirements | MppChallenge>,
  reader: StarknetReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("starknet/wrong-reader");
  const tx = feltValue(input.tx);
  const asset = feltValue(isObject(input.option) ? input.option["asset"] : undefined);
  if (tx === undefined || asset === undefined) return refusal("starknet/wrong-reader");
  let receipt: StarknetReceipt | null;
  let trace: StarknetInvocation | null;
  try {
    receipt = await reader.receipt(feltOf(tx));
    if (receipt === null) return refusal("starknet/not-found");
    if (!isReceipt(receipt) || receipt.events.length > STARKNET_MAX_EVENTS) return refusal("starknet/unreadable");
    const accepted = receipt.finality !== "PRE_CONFIRMED" && receipt.blockNumber !== null;
    if (receipt.execution === "REVERTED") return accepted ? refusal("starknet/reverted") : refusal("starknet/not-final");
    trace = await reader.trace(feltOf(tx));
  } catch {
    return refusal("starknet/unreadable");
  }
  if (trace === null) return refusal("starknet/unreadable");
  const accepted = receipt.finality !== "PRE_CONFIRMED" && receipt.blockNumber !== null;
  const executions = executionsOf(trace);
  if (executions === "malformed") return refusal("starknet/unreadable");
  // A trace beyond lcp's bounds is a read it did not make whole, and no verdict on the transaction.
  if (executions === "beyond") return refusal("starknet/unreadable");
  const nonces = [...new Set(executions.filter((e) => e.nonce !== undefined && e.transfers.some((t) => t.token === asset)).map((e) => e.nonce!))];
  if (nonces.length === 0) return accepted ? refusal("starknet/no-transfer") : refusal("starknet/not-final");
  if (nonces.length > 1) return accepted ? refusal("starknet/ambiguous") : refusal("starknet/not-final");
  return `0x${nonces[0]!.toString(16).padStart(64, "0")}`;
}

/**
 * The nonce that landed in the named transaction for this transfer, for a party holding the ATR to compare with the
 * hash's low 250 bits: the nonce of the `execute_from_outside_v2` below which, at any depth, a `transfer` call on
 * `ref.asset` has this payment's identity, the digest of its sender, recipient and amount (`starknetIdDigest`). It is
 * found by that identity, not by a recorded nonce. A ref or reader that is not an object, a reader for another network,
 * or a ref whose `transaction` or `asset` is not a felt or whose `idDigest` is not a 32-byte hash, is
 * `starknet/wrong-reader`, with nothing read. A failed read, a receipt that is not well formed, or a trace that is
 * missing or holds an invocation that is not well formed, is `starknet/unreadable`, and no receipt `starknet/not-found`.
 * A receipt at `ACCEPTED_ON_L2` or `ACCEPTED_ON_L1` gives the verdict: a reverted transaction is `starknet/reverted`; a
 * trace that holds no such transfer, or that is nested deeper than 16 levels or holds more than 512 invocations, which
 * it reads no further, is `starknet/no-transfer`; and transfers under more than one nonce are `starknet/ambiguous`. A
 * `PRE_CONFIRMED` receipt, or one with no block number, gives each of these as `starknet/not-final`, since a
 * pre-confirmed block can change. Two calls.
 */
export async function starknetLandedNonce(
  ref: { network: StarknetNetwork; transaction: Felt; asset: Felt; idDigest: Hex },
  reader: StarknetReader,
): Promise<Felt | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("starknet/wrong-reader");
  if (feltValue(ref.transaction) === undefined || feltValue(ref.asset) === undefined || normalHash(ref.idDigest) === null) {
    return refusal("starknet/wrong-reader");
  }
  let receipt: StarknetReceipt | null;
  try {
    receipt = await reader.receipt(ref.transaction);
  } catch {
    return refusal("starknet/unreadable");
  }
  if (receipt === null) return refusal("starknet/not-found");
  if (!isReceipt(receipt) || receipt.events.length > STARKNET_MAX_EVENTS) return refusal("starknet/unreadable");
  const accepted = receipt.finality !== "PRE_CONFIRMED" && receipt.blockNumber !== null;
  if (receipt.execution === "REVERTED") return accepted ? refusal("starknet/reverted") : refusal("starknet/not-final");
  const found = await matches(ref, reader);
  if (found === "transport" || found === "unparseable" || found === "history-gap") return refusal("starknet/unreadable");
  if (found === "beyond-bounds" || found.length === 0) {
    return accepted ? refusal("starknet/no-transfer") : refusal("starknet/not-final");
  }
  const nonces = new Set(found.map((n) => feltOf(n)));
  if (nonces.size > 1) return accepted ? refusal("starknet/ambiguous") : refusal("starknet/not-final");
  return [...nonces][0]!;
}

/**
 * The landed nonces of the `transfer` calls on `asset` nested at any depth below an `execute_from_outside_v2`
 * invocation in the trace: for each such call, each distinct nonce of an enclosing invocation for which the call's
 * identity digest, with that invocation's contract as the sender, is the reference's. A call below such a `transfer` is
 * the token's own execution of it and is not read as another transfer. A reverted invocation's whole subtree is
 * skipped. A failed trace read is "transport", no trace "history-gap", and an invocation that is not well formed, or a
 * malformed asset, "unparseable"; a trace nested deeper than `STARKNET_MAX_TRACE_DEPTH` levels or holding more than
 * `STARKNET_MAX_TRACE_INVOCATIONS` invocations is "beyond-bounds", read no further.
 */
async function matches(
  ref: { transaction: Felt; asset: Felt; idDigest: Hex },
  reader: StarknetReader,
): Promise<bigint[] | "transport" | "unparseable" | "history-gap" | "beyond-bounds"> {
  let root: StarknetInvocation | null;
  try {
    root = await reader.trace(ref.transaction);
  } catch {
    return "transport";
  }
  if (root === null) return "history-gap";
  const asset = feltValue(ref.asset);
  if (asset === undefined) return "unparseable";
  const found: bigint[] = [];
  type Execute = { contract: Felt; landed: bigint };
  const stack: { inv: StarknetInvocation; depth: number; above: readonly Execute[] }[] = [{ inv: root, depth: 1, above: [] }];
  let visited = 0;
  while (stack.length > 0) {
    const { inv, depth, above } = stack.pop()!;
    if (depth > MAX_DEPTH || ++visited > MAX_INVOCATIONS) return "beyond-bounds";
    if (!isInvocation(inv)) return "unparseable";
    if (inv.reverted) continue;
    const selector = feltValue(inv.selector);
    if (above.length > 0 && selector === TRANSFER && feltValue(inv.contract) === asset) {
      const [to, low, high] = inv.calldata.map(feltValue);
      if (to !== undefined && low !== undefined && high !== undefined && low < U128 && high < U128) {
        const nonces = new Set<bigint>();
        for (const e of above) {
          const digest = await starknetIdDigest(e.contract, feltOf(to), low + high * U128);
          if (!isRefusal(digest) && hashEquals(digest, ref.idDigest)) nonces.add(e.landed);
        }
        found.push(...nonces);
      }
    }
    let below = above;
    if (selector === TRANSFER && feltValue(inv.contract) === asset) below = [];
    else if (selector === EXECUTE) {
      const landed = feltValue(inv.calldata[1]);
      if (landed !== undefined) below = [...above, { contract: inv.contract, landed }];
    }
    for (const c of inv.calls) stack.push({ inv: c, depth: depth + 1, above: below });
  }
  return found;
}

function isReceipt(r: unknown): r is StarknetReceipt {
  if (!isObject(r)) return false;
  const { finality, execution, blockNumber, events } = r;
  return (
    (finality === "PRE_CONFIRMED" || finality === "ACCEPTED_ON_L2" || finality === "ACCEPTED_ON_L1") &&
    (execution === "SUCCEEDED" || execution === "REVERTED") &&
    (blockNumber === null || typeof blockNumber === "bigint") &&
    Array.isArray(events) &&
    events.every(isEvent)
  );
}

function isEvent(e: unknown): e is StarknetEvent {
  if (!isObject(e)) return false;
  const { fromAddress, keys, data } = e;
  return (
    typeof fromAddress === "string" &&
    Array.isArray(keys) &&
    keys.every((k) => typeof k === "string") &&
    Array.isArray(data) &&
    data.every((d) => typeof d === "string")
  );
}

function isEmitted(e: unknown): e is StarknetEmittedEvent {
  return isEvent(e) && feltValue((e as unknown as Record<string, unknown>)["transaction"]) !== undefined;
}

function isPage(p: unknown): p is StarknetEventPage {
  if (!isObject(p) || !Array.isArray(p["events"])) return false;
  const c = p["continuation"];
  return c === null || (typeof c === "string" && c.length > 0 && c.length <= STARKNET_MAX_CONTINUATION);
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
  if (!isAmount(o.amount) || decimalBelow(o.amount, U256_LIMIT) === undefined) return refusal("starknet/option-malformed");
  if (!isTimeoutSeconds(o.maxTimeoutSeconds)) return refusal("starknet/option-malformed");
  return true;
};

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

/**
 * x402's typed data for the chosen option, with `Nonce` the hash's low 250 bits, or for the act `agreement` the low 250
 * bits of the agreement's value (profile rule 4). H is checked first, then the act, then the form of the choice's
 * `from` and `now`, then its document and option, then `from` against the option's fee payer.
 */
async function build(
  c: { required: PaymentRequired; accepted: PaymentRequirements; from: Felt; now: number },
  h: AtrHash,
  act?: Act,
): Promise<StarknetUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (act !== undefined && act !== "payment" && act !== "agreement") return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("starknet/option-malformed");
  const { required, accepted, from, now } = c;
  const account = feltValue(from);
  if (account === undefined) return refusal("starknet/felt-malformed");
  if (!Number.isSafeInteger(now) || now < 0) return refusal("starknet/option-malformed");
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  const feePayer = accepted.extra!["feePayer"] as Felt;
  if (account === feltValue(feePayer)) return refusal("starknet/caller-forbidden");
  const nonce = snNonce(act === "agreement" ? await agreementValue(nh) : nh);
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
      if (!Array.isArray(signature) || signature.length < 1 || signature.length > STARKNET_MAX_SIGNATURE_FELTS) {
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

type Signed = {
  accepted: PaymentRequirements;
  from: Felt;
  nonce: bigint;
  caller: bigint;
  calls: readonly Record<string, unknown>[];
  message: Record<string, unknown>;
  h: AtrHash;
};

/**
 * The signed typed data's checks, H, and who may execute it: the domain, the chain id and the `Nonce`; then H, given
 * with the act, where the `Nonce` is the low 250 bits of the value that act carries, or else from the echoed legal
 * context, where they are its low 250 bits; then the `Caller`, which is the option's `extra.feePayer`; then the calls,
 * each a `transfer`.
 */
async function signed(presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }): Promise<Signed | Refusal> {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const from = p.payload["from"];
  if (feltValue(from) === undefined) return refusal("starknet/felt-malformed");
  const oe = p.payload["outsideExecution"];
  const td = isObject(oe) ? oe["typedData"] : undefined;
  if (!isObject(td) || (jsonBytes(td) ?? Number.POSITIVE_INFINITY) > STARKNET_MAX_TYPED_DATA_BYTES) {
    return refusal("starknet/typed-data-malformed");
  }
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
  const caller = feltValue(message["Caller"]);
  const calls = message["Calls"];
  if (nonce === undefined || caller === undefined || !Array.isArray(calls) || calls.length === 0 || !calls.every(isObject)) {
    return refusal("starknet/typed-data-malformed");
  }
  let h: AtrHash;
  if (given !== undefined) {
    const gh = isObject(given) ? normalHash(given.h) : null;
    if (gh === null || (given.act !== "payment" && given.act !== "agreement")) return refusal("x402/payload-malformed");
    const carried = BigInt(given.act === "agreement" ? await agreementValue(gh) : gh) & MASK_250;
    if (carried !== nonce) return refusal("starknet/nonce-not-bound");
    h = gh;
  } else {
    const ext = p.extensions;
    const lc = isObject(ext) ? ext[LEGAL_CONTEXT] : undefined;
    const decoded = fromLegalContext({ legalContext: isObject(lc) ? lc["info"] : undefined });
    if (decoded === null) return refusal("starknet/no-legal-context");
    if ((BigInt(decoded.h) & MASK_250) !== nonce) return refusal("starknet/nonce-not-bound");
    h = decoded.h;
  }
  if (caller !== feltValue(p.accepted.extra!["feePayer"])) return refusal("starknet/caller-not-fee-payer");
  for (const call of calls as Record<string, unknown>[]) {
    const selector = feltValue(call["Selector"]);
    if (selector === undefined) return refusal("starknet/typed-data-malformed");
    if (selector !== TRANSFER) return refusal("starknet/selector-not-transfer");
  }
  return { accepted: p.accepted, from: from as Felt, nonce, caller, calls: calls as Record<string, unknown>[], message, h };
}

/**
 * H as the payment carries it in the low 250 bits of the signed `Nonce`: from the echoed legal context, or, given the
 * act and H, H where the `Nonce` is the low 250 bits of the value that act carries (profile rules 3 to 5). It refuses a
 * `Caller` that is not the option's `extra.feePayer` and a call that is not a `transfer`. The signature is not verified
 * here; the payer's account contract verifies it at execution.
 */
async function bound(presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }): Promise<AtrHash | Refusal> {
  const s = await signed(presented, given);
  return isRefusal(s) ? s : s.h;
}

/**
 * The read keys (profile rule 11): the payer's account, the token, the signed nonce (given the act and H, checked as
 * `bound` checks it), `settleBy`, which is `Execute Before`, the payee, the `payTo` of the option the payment answers,
 * and the outside execution as presented, each member a felt in its shortest spelling. A presented `accepted` that is
 * not that option is `x402/accepted-not-option`. `Execute After` and `Execute Before` are decimals or felts below
 * 2^64, `Execute Before` also a safe integer; each call's `To` and `Calldata` are felts.
 */
async function reference(
  presented: unknown,
  option: PaymentRequirements,
  given?: { readonly act: Act; readonly h: AtrHash },
): Promise<StarknetRef | Refusal> {
  const s = await signed(presented, given);
  if (isRefusal(s)) return s;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameJson(s.accepted, option)) return refusal("x402/accepted-not-option");
  const after = u64Value(s.message["Execute After"]);
  const before = u64Value(s.message["Execute Before"]);
  if (after === undefined || before === undefined || before > BigInt(Number.MAX_SAFE_INTEGER)) {
    return refusal("starknet/typed-data-malformed");
  }
  const calls: StarknetCall[] = [];
  for (const call of s.calls) {
    const to = feltValue(call["To"]);
    const data = call["Calldata"];
    const calldata = Array.isArray(data) ? (data as Json[]).map(feltValue) : [undefined];
    if (to === undefined || calldata.some((d) => d === undefined)) return refusal("starknet/typed-data-malformed");
    calls.push({ to: feltOf(to), selector: feltOf(TRANSFER), calldata: (calldata as bigint[]).map(feltOf) });
  }
  return {
    network: s.accepted.network as StarknetNetwork,
    from: feltOf(feltValue(s.from)!),
    asset: feltOf(feltValue(s.accepted.asset)!),
    nonce: feltOf(s.nonce),
    payee,
    settleBy: Number(before),
    presented: { caller: feltOf(s.caller), nonce: feltOf(s.nonce), executeAfter: feltOf(after), executeBefore: feltOf(before), calls },
  };
}

/**
 * The option unchanged: on this pairing the hash rides in the signed nonce, not in the option. An option that carries a
 * `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/** The binding record: it names no binding pattern. */
const pattern: LcpPattern = deepFreeze({
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: false,
  forwardIndexable: false,
});

/**
 * `x402/exact/starknet`. The payee broadcasts (`broadcaster` answers `"payee"`): the settler executes the outside
 * execution the payer signed as its named `Caller`; `status` reads the nonce on the payer's account and finds the
 * transaction that consumed it; `recover` reads the nonce back from a transaction.
 */
export const exactStarknet = Object.freeze({
  id: ID,
  data: STARKNET[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee"),
  reference,
  status: starknetStatus,
  recover: starknetRecover,
}) satisfies Entry<
  typeof ID,
  StarknetPayment,
  StarknetRef,
  StarknetReader,
  X402Forms & {
    choice: Parameters<typeof build>[0];
    unsigned: StarknetUnsigned;
    landed: { h: AtrHash; transaction?: Felt };
    network: StarknetNetwork;
    query: StatusQuery<StarknetRefRead, bigint, StarknetMark, StarknetCursor>;
    answer: StarknetStatus;
  }
>;
