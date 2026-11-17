/**
 * CEP-3009 on Casper and the `x402/exact/casper` pairing: the ATR hash as the authorization's 32-byte `nonce`,
 * written by the buyer's signer, read back from what the payer signed, and read from the executed call's arguments.
 */
import { fromRawBytes, hash, type AtrHash } from "./core.js";
import type { Field, Hex } from "./evm.js";
import { deepFreeze, isObject, normalHash, UINT256_LIMIT, uint256Of } from "./fields.js";
import type { CasperAuthorization, CasperPaymentPayload } from "./internal/casper.js";
export type { CasperAuthorization } from "./internal/casper.js";
import { acceptedBy, advertiseFor, chosen, filterOf, isAmount, isTimeoutSeconds, legalContextOf, paymentWith, readFor, sameJson, x402Broadcaster, type X402Read, type X402Forms } from "./internal/x402.js";
import { decimalBelow, U64_LIMIT } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { CASPER } from "./internal/data/casper.js";
import { x402Payee } from "./internal/payee.js";
import { agreementValue } from "./internal/core.js";
import {
  decide,
  type Act,
  type Facts,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type Undecoded,
  type UnreadableReason,
} from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf } from "./internal/read-ledger.js";
import type { Entry } from "./internal/registry.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

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
  /**
   * The call's arguments as the token takes them: `from` is the authorization's `from`, or on `cancel_authorization`
   * the authorizer whose nonce it cancels; `validAfter` and `validBefore` where the reader shows them.
   */
  args: {
    from?: CasperAddress;
    to?: CasperAddress;
    value?: bigint;
    validAfter?: bigint;
    validBefore?: bigint;
    nonce?: Uint8Array;
  };
}

/** A call among a block's transactions, with the hash of the transaction that made it, 64 hex digits. */
export interface CasperBlockCall extends CasperCall {
  transaction: string;
}

/** One page of a block's executed transactions, in the block's order: `next` starts the next page, null at its end. */
export interface CasperBlockPage {
  calls: readonly CasperBlockCall[];
  next: number | null;
}

/** The newest block a node has executed, every block being final: its height and its own timestamp in Unix milliseconds. */
export interface CasperHead {
  height: bigint;
  timestamp: bigint;
}

/**
 * Bounded, read-only calls against one network's node or its sidecar. Every failure rejects, for example with
 * `ReaderError` from `@integraledger/lcp/evm`; any rejection reads as unreadable.
 */
export interface CasperReader {
  readonly network: CasperNetwork;
  /** `info_get_transaction`, as a `Version1` transaction and then as a `Deploy`; null when the node knows neither. */
  transaction(hash: string): Promise<CasperCall | null>;
  /** The newest block the node has executed. */
  head(): Promise<CasperHead>;
  /** The lowest block height whose state the node serves, its `available_block_range.low`. */
  lowest(): Promise<bigint>;
  /**
   * The item of `(from, nonce)` in `asset`'s `used_nonces` dictionary, read with `state_get_dictionary_item` at the
   * state root of the block at `height`: true where it is set, false where the node answers in the form it documents
   * for a missing item, and null where the node does not serve that block's state.
   */
  nonceUsed(asset: PackageHash, from: CasperAddress, nonce: Uint8Array, height: bigint): Promise<boolean | null>;
  /** The page of the executed transactions of the block at `height` that starts at `start`; null where the node does not serve the block. */
  blockCalls(height: bigint, start: number): Promise<CasperBlockPage | null>;
}

/**
 * The read keys `reference` returns: the network, the token package, the authorization's `from`, the signed nonce (H on
 * a payment, the agreement's value on an agreement), `settleBy`, which is `validBefore` up to
 * `Number.MAX_SAFE_INTEGER`, the payee, the `payTo` of the option the payment answers, and the authorization as
 * presented, for `presented`. Addresses and hashes are lowercase.
 */
export interface CasperRef {
  network: CasperNetwork;
  asset: PackageHash;
  from: CasperAddress;
  nonce: AtrHash;
  settleBy: number;
  payee: string;
  presented: CasperAuthorization;
}

/**
 * The search's position: a height at which the item was read unset, above which the block that set it lies; or that
 * block, the start of the next page of its transactions to read, and the transaction that set the item where an
 * earlier page held it.
 */
export interface CasperCursor {
  readonly unset?: bigint;
  readonly block?: bigint;
  readonly next?: number;
  readonly found?: string;
}

/**
 * The answer of `casperStatus`: positions are block heights, and the one mark is `finalized`, since the node serves
 * only executed transactions of final blocks; the search's position is a `CasperCursor`; `presented` on `settled`
 * compares the executed call with the authorization as presented.
 */
export type CasperStatus = StatusAnswer<bigint, "finalized", CasperCursor>;

interface CasperChoice {
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
/**
 * The longest token `name` or `version` lcp reads from a Casper option, in characters. CEP-3009 fixes no length; lcp
 * bounds what it hashes into the domain.
 */
export const CASPER_MAX_NAME_LENGTH = 64;
/** The longest tagged public key lcp reads, in hex digits: a one-byte tag and a 33-byte secp256k1 key. */
export const CASPER_MAX_PUBLIC_KEY_HEX = 68;
/** The longest tagged signature lcp reads, in hex digits: a one-byte tag and a 65-byte signature. */
export const CASPER_MAX_SIGNATURE_HEX = 132;
/**
 * The most reads of the nonce's item one `status` call makes to find the block that set it: a bisection of 64-bit
 * block heights ends within 64. A search cut short returns its position, from which the next call resumes.
 */
export const CASPER_MAX_PROBES = 64;
/**
 * The most pages of a block's transactions one `status` call reads. A block's size is the chain's; a search cut short
 * returns its position, from which the next call resumes.
 */
export const CASPER_MAX_PAGES = 8;
/**
 * The most calls lcp reads on one page of a block's transactions, the reader's page being its own choice. A page that
 * gives more is beyond the read's bound, `unreadable`, `too-large`.
 */
export const CASPER_MAX_PAGE_CALLS = 1024;
const MAX_NAME = CASPER_MAX_NAME_LENGTH;
const MAX_PUBLIC_KEY_HEX = CASPER_MAX_PUBLIC_KEY_HEX;
const MAX_SIGNATURE_HEX = CASPER_MAX_SIGNATURE_HEX;
const CALLS = new Set(["transfer_with_authorization", "receive_with_authorization"]);
const CANCEL = "cancel_authorization";
const FINAL = "finalized" as const;
const MARKS = [FINAL] as const;

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
  if (!isObject(a) || typeof a.network !== "string" || !NETWORK.test(a.network)) {
    return refusal("casper/network-malformed");
  }
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
 * The reference `status` reads with: the read keys, and H, which the caller adds, from which the other act's value comes;
 * the authorization as presented where the caller has it, without which the read compares nothing with it.
 */
type CasperRefRead = Omit<CasperRef, "presented"> & { presented?: CasperAuthorization; h: AtrHash };

/** A reference as the read takes it, its addresses and hashes lowercase, and the two values under H. */
interface Keys {
  readonly network: CasperNetwork;
  readonly asset: PackageHash;
  readonly from: CasperAddress;
  readonly payee: string;
  readonly nonce: AtrHash;
  /** H's other value: the agreement's value where the act's nonce is H, and H where it is the agreement's value. */
  readonly other: AtrHash;
  readonly validBefore: bigint;
  readonly presented?: CasperAuthorization;
}

/** The ledger: one mark, and block heights in their order. */
const LEDGER = ledgerOf<bigint, typeof FINAL>(CASPER[ID].coverage, MARKS, bigintOrder);

/**
 * The read keys of a reference for the act asked about, or undefined where one is malformed: the network, the asset
 * package, `from` and the payee, the signed nonce and H, the nonce being the value that act carries (H on a payment, the
 * agreement's value on an agreement), and the lapse: the `validBefore` of the authorization as presented, or
 * `settleBy`, a safe integer, where the reference holds none.
 */
async function keysOf(ref: unknown, act: Act): Promise<Keys | undefined> {
  if (!isObject(ref)) return undefined;
  const { network, asset, from, payee, presented, settleBy } = ref;
  if (typeof network !== "string" || !NETWORK.test(network)) return undefined;
  if (typeof asset !== "string" || !PACKAGE.test(asset) || !isAddress(from)) return undefined;
  if (typeof payee !== "string" || payee.length === 0) return undefined;
  const nonce = normalHash(ref["nonce"]);
  const h = normalHash(ref["h"]);
  if (nonce === null || h === null) return undefined;
  const agreement = await agreementValue(h);
  if (nonce !== (act === "agreement" ? agreement : h)) return undefined;
  let validBefore: bigint | undefined;
  if (presented === undefined) {
    if (!Number.isSafeInteger(settleBy) || (settleBy as number) < 0) return undefined;
    validBefore = BigInt(settleBy as number);
  } else {
    if (!isObject(presented) || !isAddress(presented["from"]) || !isAddress(presented["to"])) return undefined;
    if (uint256Of(presented["value"]) === undefined || decimalBelow(presented["validAfter"], U64_LIMIT) === undefined) return undefined;
    const n = presented["nonce"];
    if (typeof n !== "string" || normalHash(n.startsWith("0x") ? n : `0x${n}`) === null) return undefined;
    validBefore = decimalBelow(presented["validBefore"], U64_LIMIT);
  }
  if (validBefore === undefined) return undefined;
  return {
    network: network as CasperNetwork,
    asset: asset.toLowerCase(),
    from: from.toLowerCase(),
    payee: payee.toLowerCase(),
    nonce,
    other: nonce === h ? agreement : h,
    validBefore,
    ...(presented === undefined ? {} : { presented: presented as unknown as CasperAuthorization }),
  };
}

function isCursor(c: unknown): c is CasperCursor {
  if (!isObject(c)) return false;
  const { unset, block, next, found } = c;
  if (unset !== undefined && (typeof unset !== "bigint" || unset < 0n)) return false;
  if (block === undefined) return next === undefined && found === undefined && unset !== undefined;
  if (typeof block !== "bigint" || block < 0n) return false;
  if (!Number.isSafeInteger(next) || (next as number) < 0) return false;
  return found === undefined || (typeof found === "string" && PACKAGE.test(found));
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

/**
 * The read of the nonce (profile rules 13 to 18): the item at the newest executed block; unset, the facts of a value
 * unconsumed, lapsed where that block's own timestamp is at or past `validBefore`, with the height read as the search's
 * position where it lapsed or the caller gave a position; set, the block that set it, found by bisecting heights above the position given (below it
 * where the item is already set there, from the lowest height the node serves), and its transactions read in order, a
 * page at a time, a call there that carries either of H's values and that the read cannot decode holding the search at
 * its page. The newest executed block is final, so the value's read there is both the final mark's and the latest
 * head's. The read of the item is no search for H, each token package keeping its own nonces, so the search is never
 * whole and no `failed` but `before-position` follows from it.
 */
async function readCasper(
  k: Keys,
  reader: CasperReader,
  query: StatusQuery<CasperRefRead, bigint, typeof FINAL, CasperCursor>,
): Promise<Facts<bigint, typeof FINAL, CasperCursor>> {
  const nonce = hexBytes(k.nonce.slice(2));
  const usedAt = async (height: bigint): Promise<boolean> => {
    const u = await reader.nonceUsed(k.asset, k.from, nonce, height);
    if (u === null) throw new Stop("history-gap");
    if (typeof u !== "boolean") throw new Stop("unparseable");
    return u;
  };
  const head = await reader.head();
  if (!isObject(head) || typeof head.height !== "bigint" || typeof head.timestamp !== "bigint") throw new Stop("unparseable");
  const lapsed = head.timestamp >= k.validBefore * 1000n;
  if (!(await usedAt(head.height))) {
    const value = { consumed: false, lapsed, mark: FINAL, head: { consumed: false } } as const;
    const held = lapsed || query.search !== undefined;
    return { seen: [], value, search: { whole: false, ...(held ? { at: { unset: head.height } } : {}) }, history: true };
  }
  const value = { consumed: true, lapsed, mark: FINAL, head: { consumed: true } } as const;
  const cursor = query.search;
  let block: bigint;
  let start = 0;
  let found: string | undefined;
  if (cursor?.block !== undefined) {
    block = cursor.block;
    start = cursor.next ?? 0;
    found = cursor.found;
  } else {
    let lo: bigint | undefined = cursor?.unset;
    let hi = head.height;
    if (query.after !== undefined) {
      if (await usedAt(query.after)) {
        hi = query.after;
        lo = undefined;
      } else if (lo === undefined || lo < query.after) lo = query.after;
    }
    if (lo === undefined) {
      const lowest = await reader.lowest();
      if (typeof lowest !== "bigint") throw new Stop("unparseable");
      if (await usedAt(lowest)) throw new Stop("history-gap");
      lo = lowest;
    }
    let low: bigint = lo;
    for (let probes = 0; hi - low > 1n; probes++) {
      if (probes === CASPER_MAX_PROBES) {
        return { seen: [], value, search: { whole: false, at: { unset: low } }, history: true };
      }
      const mid: bigint = low + (hi - low) / 2n;
      if (await usedAt(mid)) hi = mid;
      else low = mid;
    }
    block = hi;
  }
  const seen: Seen<bigint, typeof FINAL>[] = [];
  const undecoded: Undecoded<CasperCursor>[] = [];
  const position = (next: number): CasperCursor => ({ unset: block - 1n, block, next, ...(found === undefined ? {} : { found }) });
  const take = (tx: string, c: unknown, next: number): void => {
    const s = isCall(c) ? seenOf(k, query, tx, c, block) : "undecoded";
    if (s === undefined) return;
    if (s === "undecoded") {
      undecoded.push({ transaction: tx.toLowerCase(), at: position(next) });
      return;
    }
    seen.push(s);
    if (s.consumed) found = s.transaction;
  };
  if (found !== undefined) {
    const c = await reader.transaction(found);
    // The position names a transaction the node read before and no longer knows: it does not hold that history.
    if (c === null) throw new Stop("history-gap");
    take(found, c, start);
  }
  let at = start;
  for (let pages = 0; ; pages++) {
    if (pages === CASPER_MAX_PAGES) {
      return { seen, value, search: { whole: false, at: position(at) }, undecoded, history: true };
    }
    const page = await reader.blockCalls(block, at);
    if (page === null) throw new Stop("history-gap");
    if (!isObject(page) || !Array.isArray(page.calls) || !(page.next === null || Number.isSafeInteger(page.next))) {
      throw new Stop("unparseable");
    }
    if (page.calls.length > CASPER_MAX_PAGE_CALLS) throw new Stop("too-large");
    for (const c of page.calls as readonly unknown[]) {
      const tx = isObject(c) ? c["transaction"] : undefined;
      if (typeof tx !== "string" || !PACKAGE.test(tx)) throw new Stop("unparseable");
      if (tx.toLowerCase() === found) continue;
      take(tx, c, at);
    }
    if (page.next === null) break;
    if (page.next <= at) throw new Stop("unparseable");
    at = page.next;
  }
  return { seen, value, search: { whole: false }, undecoded, history: true };
}

/**
 * A CEP-3009 call of the located block as the read's facts name it, on whatever package it calls, or undefined where it
 * carries neither of H's values: its signer, `from`, against the reference's `from` and the payee; `same` where it is a
 * transfer on the asset package under the act's own nonce, which alone can set the item the read reads, and `other`
 * where it is a cancellation, carries H's other value or calls another package, whose package is recorded as observed
 * and never a reason to pass it over; the account its `to` names on a transfer, named by its transaction and the
 * transaction's own call, its entry point, with `presented` against the authorization as presented; and consumed only
 * where it executed with no error under `(from, nonce)` of the reference on the asset package, the item the read reads.
 * A CEP-3009 call whose package or 32-byte nonce the reader does not show, or one carrying either value whose `from`,
 * or a transfer's `to` or `value`, it does not show, is an item the search could not decode, which holds it there.
 */
function seenOf(
  k: Keys,
  query: StatusQuery<CasperRefRead, bigint, typeof FINAL, CasperCursor>,
  tx: string,
  c: CasperCall,
  block: bigint,
): Seen<bigint, typeof FINAL> | "undecoded" | undefined {
  if (!c.executed) return undefined;
  const cancel = c.entryPoint === CANCEL;
  if (!cancel && (c.entryPoint === null || !CALLS.has(c.entryPoint))) return undefined;
  const n = c.args.nonce instanceof Uint8Array && c.args.nonce.length === 32 ? fromRawBytes(c.args.nonce) : undefined;
  if (n === undefined || c.packageHash === null) return "undecoded";
  if (n !== k.nonce && n !== k.other) return undefined;
  const pkg = c.packageHash.toLowerCase();
  const onAsset = pkg === k.asset;
  const from = c.args.from?.toLowerCase();
  const { to, value } = c.args;
  if (from === undefined || (!cancel && (to === undefined || value === undefined))) return "undecoded";
  const transaction = tx.toLowerCase();
  const succeeded = c.error === null;
  const given = (query.others ?? []).some((o) =>
    "ref" in o
      ? isObject(o.ref) && o.ref.from?.toLowerCase() === from && normalHash(o.ref.nonce) === n
      : typeof o.transaction === "string" && o.transaction.toLowerCase() === transaction,
  );
  return {
    transaction,
    position: block,
    mark: FINAL,
    result: succeeded ? "succeeded" : "failed",
    consumed: succeeded && onAsset && n === k.nonce && from === k.from,
    carries: true,
    party: from === k.payee ? "payee" : from === k.from ? "payer" : "other",
    kind: !cancel && onAsset && n === k.nonce ? "same" : "other",
    account: cancel ? "none" : to!.toLowerCase() === k.payee ? "payee" : "other",
    ...(given ? { given: true } : {}),
    ...(cancel
      ? {}
      : {
          // A failed result moved nothing; the account it names is the `to` the payer signed.
          moved: succeeded ? [{ asset: pkg, amount: value!.toString(), to: to!.toLowerCase(), transaction, place: c.entryPoint! }] : [],
          ...(k.presented === undefined ? {} : { presented: presentedOf(c, k.presented) }),
        }),
    signer: from,
  };
}

/**
 * Whether the act is the payment presented: the executed call's package, `from`, `to`, `value`, `validAfter`,
 * `validBefore` and nonce against the authorization as presented, `unshown` where the reader shows one of them not; a
 * `receive_with_authorization` is another signed message than the `TransferWithAuthorization` lcp builds, so `no`.
 */
function presentedOf(c: CasperCall, p: CasperAuthorization): "yes" | "no" | "unshown" {
  const { from, to, value, validAfter, validBefore, nonce } = c.args;
  if (from === undefined || to === undefined || value === undefined || validAfter === undefined || validBefore === undefined) {
    return "unshown";
  }
  const same =
    c.entryPoint === "transfer_with_authorization" &&
    from.toLowerCase() === p.from.toLowerCase() &&
    to.toLowerCase() === p.to.toLowerCase() &&
    value === BigInt(p.value) &&
    validAfter === BigInt(p.validAfter) &&
    validBefore === BigInt(p.validBefore) &&
    nonce instanceof Uint8Array &&
    fromRawBytes(nonce) === normalHash(p.nonce.startsWith("0x") ? p.nonce : `0x${p.nonce}`);
  return same ? "yes" : "no";
}

/**
 * The read of the act the query asks about, as the profile `read-status` answers it through the profile
 * `x402/exact/casper`'s rules 12 to 22: the nonce's item, the block that set it and its transactions. A query, a
 * reference or a search position that is not one is `unreadable`, `unparseable`, with nothing read, and a reader for
 * another network `chain-mismatch`; a read the node does not serve is `history-gap`. On `settled` the answer states
 * `presented` where the reference holds the authorization as presented, and none where it does not.
 */
export async function casperStatus(
  ref: CasperRefRead,
  reader: CasperReader,
  query: StatusQuery<CasperRefRead, bigint, typeof FINAL, CasperCursor>,
): Promise<CasperStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint") || (query.search !== undefined && !isCursor(query.search))) {
    return { state: "unreadable", reason: "unparseable", foreign: [] };
  }
  const k = await keysOf(ref, query.act);
  if (k === undefined) return { state: "unreadable", reason: "unparseable", foreign: [] };
  if (!isObject(reader) || reader.network !== k.network) return { state: "unreadable", reason: "chain-mismatch", foreign: [] };
  // A transaction is compared in its lowercase spelling, as the read names it.
  const others = query.others?.map((o) => ("transaction" in o && typeof o.transaction === "string" ? { transaction: o.transaction.toLowerCase() } : o));
  const q = { ...query, ...(others === undefined ? {} : { others }) };
  let read: Facts<bigint, typeof FINAL, CasperCursor>;
  try {
    read = await readCasper(k, reader, q);
  } catch (e) {
    return { state: "unreadable", reason: rejected(e), foreign: [] };
  }
  return decide(read, q, LEDGER);
}

/**
 * The value a settlement transaction carries in H's place, from the transaction alone (profile rule 23): the `nonce`
 * argument of the executed authorization call on the token package the option names, `option.asset`, which is H on a
 * payment and the agreement's value on an agreement, which a holder of the ATR compares with `agreementValue` of its
 * own H. An input whose `tx` is not 64 hex digits, or whose option names no package hash of 64 hex digits as its
 * `asset`, is `casper/wrong-reader`, with nothing read.
 */
export async function casperRecover(
  input: RecoverInput<CasperNetwork, PaymentRequirements | MppChallenge>,
  reader: CasperReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("casper/wrong-reader");
  if (typeof input.tx !== "string" || !PACKAGE.test(input.tx)) return refusal("casper/wrong-reader");
  const asset: unknown = isObject(input.option) ? input.option["asset"] : undefined;
  if (typeof asset !== "string" || !PACKAGE.test(asset)) return refusal("casper/wrong-reader");
  let call: CasperCall | null;
  try {
    call = await reader.transaction(input.tx);
  } catch {
    return refusal("casper/unreadable");
  }
  if (call === null) return refusal("casper/not-found");
  if (!isCall(call)) return refusal("casper/unreadable");
  if (!call.executed) return refusal("casper/not-executed");
  if (call.error !== null) return refusal("casper/reverted");
  const nonce = authorizationNonce(call, asset);
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

/**
 * The pairing's filter: an `exact` option on a `casper:` network that `build` can turn into typed data, its amount a
 * canonical decimal uint256, `"0"` among them, the agreement's floor being zero by the token.
 */
function casperOption(o: unknown): o is PaymentRequirements {
  if (!isObject(o)) return false;
  const extra = o["extra"];
  return (
    o["scheme"] === "exact" &&
    typeof o["network"] === "string" &&
    NETWORK.test(o["network"]) &&
    typeof o["asset"] === "string" &&
    PACKAGE.test(o["asset"]) &&
    isAddress(o["payTo"]) &&
    (isAmount(o["amount"]) || o["amount"] === "0") &&
    uint256Of(o["amount"]) !== undefined &&
    isObject(extra) &&
    isName(extra["name"]) &&
    isName(extra["version"]) &&
    isTimeoutSeconds(o["maxTimeoutSeconds"])
  );
}

/** The pairing's option filter, which `advertise`, `read`, `build` and `bound` apply. */
const filter = filterOf(casperOption);
const advertise = advertiseFor(filter);
const read: (doc: PaymentRequired) => X402Read | Refusal = readFor(filter);

/**
 * The CEP-3009 authorization the payer signs for the chosen option, with H as its nonce, or for the act `agreement` the
 * agreement's value (profile rule 4). H is checked first, then the act, then the form of the choice's `from` and `now`,
 * then its document and option.
 */
async function build(c: CasperChoice, h: AtrHash, act?: Act): Promise<CasperUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("casper/payload-malformed");
  if (act !== undefined && act !== "payment" && act !== "agreement") return refusal("casper/payload-malformed");
  if (!isObject(c)) return refusal("x402/not-v2");
  const { required, accepted, from, now } = c;
  if (!isAddress(from)) return refusal("casper/address-malformed");
  if (!Number.isSafeInteger(now) || now < 0) return refusal("casper/option-malformed");
  const wrong = chosen(required, accepted, filter);
  if (wrong !== true) return wrong;
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
    nonce: act === "agreement" ? await agreementValue(nh) : nh,
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
 * The nonce the payer signed, lowercase: with nothing given, H as a payment carries it. Given the act and H, the value
 * that act carries in H's place (H, or the agreement's value for the act `agreement`), and H where the nonce is it;
 * otherwise `casper/nonce-not-bound`. A given H that is not a 32-byte hash, or an act that is not one, is
 * `casper/payload-malformed`.
 */
async function signedNonce(p: CasperPaymentPayload, given?: { readonly act: Act; readonly h: AtrHash }): Promise<AtrHash | Refusal> {
  const n = p.payload.authorization.nonce;
  const nonce = normalHash(n.startsWith("0x") ? n : `0x${n}`)!;
  if (given === undefined) return nonce;
  const h = isObject(given) ? normalHash(given.h) : null;
  if (h === null || (given.act !== "payment" && given.act !== "agreement")) return refusal("casper/payload-malformed");
  const carried = given.act === "agreement" ? await agreementValue(h) : h;
  return nonce === carried ? h : refusal("casper/nonce-not-bound");
}

/**
 * H as the payment carries it in the authorization's nonce, or, given the act and H, H where the nonce is the value
 * that act carries (profile rules 3 and 4). The signature is not verified here; the token contract verifies it, and that
 * the key is the payer's, when it executes the transfer.
 */
async function bound(presented: unknown, given?: { readonly act: Act; readonly h: AtrHash }): Promise<AtrHash | Refusal> {
  const p = paymentOf(presented);
  return isRefusal(p) ? p : signedNonce(p, given);
}

/**
 * The read keys for finding this payment (profile rule 11): the network, the token package, `from`, the signed nonce
 * (given the act and H, checked as `bound` checks it; with nothing given, the act `payment`, whose nonce is H, so where
 * the payment echoes a legal context that decodes, its H must be the nonce, else `casper/nonce-not-bound`), `settleBy`,
 * which is `validBefore` up to
 * `Number.MAX_SAFE_INTEGER` and that value for a later one, the payee, the `payTo` of the option the payment answers,
 * and the authorization as presented. A presented `accepted` that is not that option is `x402/accepted-not-option`.
 * `validAfter` and `validBefore` are decimals below 2^64, CEP-3009's `valid_before` being a u64 whose largest value
 * never expires; `value` is a decimal uint256.
 */
async function reference(
  presented: unknown,
  option: PaymentRequirements,
  given?: { readonly act: Act; readonly h: AtrHash },
): Promise<CasperRef | Refusal> {
  const p = paymentOf(presented);
  if (isRefusal(p)) return p;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameJson(p.accepted, option)) return refusal("x402/accepted-not-option");
  const a = p.payload.authorization;
  const value = uint256Of(a.value);
  const validAfter = decimalBelow(a.validAfter, U64_LIMIT);
  const validBefore = decimalBelow(a.validBefore, U64_LIMIT);
  if (value === undefined || validAfter === undefined || validBefore === undefined || !isAddress(a.from) || !isAddress(a.to)) {
    return refusal("casper/payload-malformed");
  }
  const nonce = await signedNonce(p, given);
  if (isRefusal(nonce)) return nonce;
  const signed = normalHash(a.nonce.startsWith("0x") ? a.nonce : `0x${a.nonce}`)!;
  const echoed = given === undefined ? legalContextOf(p.extensions) : undefined;
  if (echoed !== undefined && !isRefusal(echoed) && normalHash(echoed.h) !== signed) return refusal("casper/nonce-not-bound");
  return {
    network: p.accepted.network as CasperNetwork,
    asset: p.accepted.asset.toLowerCase(),
    from: a.from.toLowerCase(),
    nonce: signed,
    settleBy: Math.min(Number(validBefore), Number.MAX_SAFE_INTEGER),
    payee,
    presented: {
      from: a.from.toLowerCase(),
      to: a.to.toLowerCase(),
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: signed,
    },
  };
}

/**
 * The option unchanged: on this pairing the hash rides in the authorization, not in the option. An option that carries
 * a `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/**
 * The payment's shape as this pairing requires it, or the refusal that names what is wrong: `acceptedBy`'s answer for
 * an `accepted` the pairing's filter does not serve, and `casper/payload-malformed` for every other fault.
 */
function paymentOf(presented: unknown): CasperPaymentPayload | Refusal {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("casper/payload-malformed");
  if (carriesRefused(presented)) return refusal("casper/payload-malformed");
  const accepted = acceptedBy(presented["accepted"], filter);
  if (isRefusal(accepted)) return accepted;
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
  profile: ID,
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/casper`. The payee broadcasts (`broadcaster` answers `"payee"`): the settler submits the call that
 * executes the payer's signed authorization; `status` reads the nonce's item, the block that set it and its
 * transactions.
 */
export const exactCasper = Object.freeze({
  id: ID,
  data: CASPER[ID],
  pattern,
  claims: true as boolean,
  unplaced,
  tie,
  advertise,
  read,
  build,
  bound,
  broadcaster: x402Broadcaster("payee", {
    envelope: () => refusal("casper/payload-malformed"),
    refused: () => refusal("casper/payload-malformed"),
    payload: () => refusal("casper/payload-malformed"),
  }),
  reference,
  status: casperStatus,
  recover: casperRecover,
}) satisfies Entry<
  typeof ID,
  CasperPaymentPayload,
  CasperRef,
  CasperReader,
  X402Forms & {
    choice: CasperChoice;
    unsigned: CasperUnsigned;
    landed: { h: AtrHash };
    network: CasperNetwork;
    query: StatusQuery<CasperRefRead, bigint, "finalized", CasperCursor>;
    answer: CasperStatus;
  }
>;
