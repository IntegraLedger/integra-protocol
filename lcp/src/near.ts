/**
 * NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose
 * `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it.
 *
 * The read finds the payer's act by the payer's access key, through a bounded reader, and searches every access key of
 * the payer's account for H.
 *
 * @module
 */
import type * as Borsh from "borsh";
import { fromLcpString, hash, hashEquals, parseJson, toLcpString, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash, sameJson } from "./fields.js";
import { jsonObjectKeys } from "./internal/core.js";
import type { NearPayment } from "./internal/near.js";
import {
  decodeDelegateAction,
  decodeSignedDelegate,
  delegateMessage,
  encodeDelegateAction,
  encodeSignedDelegate,
  isNearAccountId,
  isNearEd25519Signature,
  nearKeyOf,
  nearKeyText,
  type DelegateRefused,
  type FunctionCallDelegate,
} from "./internal/near-delegate.js";
import {
  advertiseFor,
  chosen,
  isAmount,
  isTimeoutSeconds,
  paymentWith,
  presentedWith,
  readFor,
  type OptionFilter,
  x402Broadcaster,
  type X402Read,
  type X402Forms,
} from "./internal/x402.js";
import { bytesOfHexDigits, decimalBelow, fromBase64, toBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
} from "./x402.js";
import { NEAR } from "./internal/data/near.js";
import type { Entry } from "./internal/registry.js";
import { x402Payee } from "./internal/payee.js";
import {
  decide,
  type Facts,
  type Moved,
  type OtherAct,
  type RecoverInput,
  type Seen,
  type StatusAnswer,
  type StatusQuery,
  type Undecoded,
  type UnreadableReason,
} from "./internal/read.js";
import { bigintOrder, isQuery, ledgerOf } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

/** The optional peer, loaded once; undefined when it is not installed, and every function needing it refuses. */
const borsh: typeof Borsh | undefined = await import("borsh").catch(() => undefined);

export { NEP461_DELEGATE } from "./internal/near.js";
export type { NearPayment } from "./internal/near.js";
export type { X402Payment, X402Read } from "./internal/x402.js";

/** x402's NEAR network identifiers. */
export type NearNetwork = "near:mainnet" | "near:testnet";
export const FT_TRANSFER_GAS = 30_000_000_000_000n;

/** A function call of a delegate action: its method, its base64 arguments, its gas, and its deposit in yoctoNEAR. */
export interface NearFunctionCall {
  methodName: string;
  argsBase64: string;
  gas: bigint;
  deposit: bigint;
}

/**
 * A transaction as nearcore's `EXPERIMENTAL_tx_status` answers it (NEAR RPC, `RpcTransactionResponse`,
 * https://docs.near.org/api-reference/post-experimental_tx_status, read 2026-11-16).
 */
export interface NearOutcome {
  /** `final_execution_status`: `FINAL` once the transaction and all its receipts are in final blocks. */
  status: "FINAL" | "EXECUTED" | string;
  /**
   * The delegate action the transaction carries, as the RPC writes a `Delegate` action's `delegate_action` (NEP-366):
   * its `sender_id`, `public_key`, `nonce`, `max_block_height` and `receiver_id`, and its actions in order, each a
   * `FunctionCall` or null for an action of any other kind. The sender and the receiver are NEAR account ids, and the
   * key is written as the RPC writes one. Null: the transaction carries no delegate action.
   */
  delegate: null | {
    senderId: string;
    publicKey: string;
    nonce: bigint;
    maxBlockHeight: bigint;
    receiverId: string;
    actions: readonly (NearFunctionCall | null)[];
  };
  /**
   * Each receipt of `receipts_outcome`: its `id`, its `executor_id`, a NEAR account id, its outcome (`SuccessValue` or
   * `SuccessReceiptId` as `success`, `Failure` as `failure`, `Unknown` as `pending`), and the height of the block it
   * executed in, which the reader reads from the outcome's `block_hash`, absent while it has not executed.
   */
  receipts: readonly { id: string; executor: string; outcome: "success" | "failure" | "pending"; height?: bigint }[];
}

/**
 * One change of an access key, as the RPC's `changes` answers it for `single_access_key_changes` and
 * `all_access_key_changes` (https://docs.near.org/api-reference/post-changes, read 2026-11-16): the height of the
 * block it is in; the key, written as the RPC writes one; the key's nonce after it, or null where it deleted the key
 * (`access_key_deletion`); and, where the reader can name them, the transaction that carried it and that
 * transaction's signer. The change's `cause` names a transaction (`transaction_processing`) or a receipt
 * (`receipt_processing`), which for a delegate action is the receipt the relayer's transaction made; the reader names
 * the transaction from it where it can, as a run on `near:testnet` showed (the profile `x402-exact-near-memo`, rule 9).
 */
export interface NearKeyChange {
  readonly height: bigint;
  readonly publicKey: string;
  readonly nonce: bigint | null;
  readonly transaction?: { readonly hash: string; readonly signer: string };
}

/**
 * A range read of access-key changes: every change in the blocks from `from` to `through`, the last height the reader
 * read, at most the range's end, a height with no block holding none; or `history: "missing"` where the node holds no
 * block at the range's start (the RPC's `GARBAGE_COLLECTED_BLOCK` or `UNKNOWN_BLOCK` for a height it should hold).
 */
export type NearKeyChanges =
  | { readonly changes: readonly NearKeyChange[]; readonly through: bigint }
  | { readonly history: "missing" };

/**
 * Bounded, read-only calls against one network's RPC (https://docs.near.org/api/rpc/introduction, read 2026-11-16).
 * Every failure rejects, for example with `ReaderError` from `@integraledger/lcp/evm`: a `ReaderError` reads by its
 * kind (`too-large` as `too-large`, `malformed` as `unparseable`), any other rejection as `transport`.
 */
export interface NearReader {
  readonly network: NearNetwork;
  /**
   * `EXPERIMENTAL_tx_status` with `wait_until` "NONE", for the transaction's hash and its signer's account where the
   * read knows it (the RPC's `sender_account_id`); null: unknown. The RPC refuses a hash named without its signer,
   * so a reader resolves the signer itself, as a seller's reader can from the accounts that relayed its payments (the
   * profile `x402-exact-near-memo`, rule 9).
   */
  txStatus(txHash: string, sender?: string): Promise<NearOutcome | null>;
  /** `block` at finality "final": its header's height. */
  finalHeight(): Promise<bigint>;
  /**
   * `query` `view_access_key` at the finality asked, "final" or "optimistic" (the latest head), for the account and the
   * key, written as the RPC writes one: the key's nonce, or null where the account holds no such key, and the
   * `block_height` of the block whose state the answer reads, which the RPC gives in both answers.
   */
  accessKeyNonce(account: string, publicKey: string, finality: NearMark): Promise<{ nonce: bigint | null; blockHeight: bigint }>;
  /** `changes` `single_access_key_changes` for the account's one key, block by block from `from` to `to`. */
  accessKeyChanges(account: string, publicKey: string, from: bigint, to: bigint): Promise<NearKeyChanges>;
  /** `changes` `all_access_key_changes` for every key of the account, block by block from `from` to `to`. */
  accountKeyChanges(account: string, from: bigint, to: bigint): Promise<NearKeyChanges>;
}

/**
 * The read keys `reference` returns, JSON-serialisable: the option's payee (`payTo`), the key of the read's two party
 * tests; the network; and the delegate action the payer signed, whole, its signature apart: its sender (`payer`), its
 * receiver (`asset`), its key, `nonce` and `maxBlockHeight` as decimal strings, and its one function call, an
 * `ft_transfer` whose arguments are held by their SHA-256 (`argsDigest`, `0x` and lowercase hex) with its `gas` and
 * `deposit` as decimal strings; and `h`, the hash its memo carries. `transaction` is a hint where a settler names one: it
 * shortens the search and proves nothing.
 */
export interface NearRef {
  network: NearNetwork;
  payee: string;
  asset: string;
  payer: string;
  publicKey: string;
  nonce: string;
  maxBlockHeight: string;
  argsDigest: `0x${string}`;
  gas: string;
  deposit: string;
  h: AtrHash;
  transaction?: string;
}

/** The marks of a NEAR read, lowest first: optimistic (the latest head) and `FINAL`, the final mark. */
export type NearMark = "optimistic" | "final";
const MARKS: readonly NearMark[] = ["optimistic", "final"];

/**
 * What `status` takes beside the reference and the reader, as the profile `read-status` states it: positions and the
 * search position are block heights.
 */
export type NearQuery = StatusQuery<NearRef, bigint, NearMark, bigint>;

export type Answer = StatusAnswer<bigint, NearMark, bigint>;

/**
 * The answer of `status`, as the profile `read-status` gives it, positions being block heights. A `settled` answer
 * states `presented`: `yes` where the delegate action it settled on is, member by member, the one the reference was
 * built from, `no` where a member differs, `unshown` where the read could not read the delegate. Each transfer it names
 * in `moved` is named by the transaction and, as `place`, the id of the receipt the token contract executed for it.
 */
export type NearStatus = Answer;

export interface NearChoice {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  /** The payer's account: a NEAR account id, as nearcore reads a delegate action's sender, or `x402/option-malformed`. */
  payer: string;
  /**
   * The access key, read as nearcore's `PublicKey::from_str` reads it: the key type before the first `:`, `ed25519` or
   * `secp256k1` in ASCII letters of either case, or no key type, which is Ed25519; then the base58 of exactly that
   * type's key size, 32 bytes or 64. Any other text is `x402/option-malformed`.
   */
  publicKey: string;
  /** `view_access_key`'s nonce for the key. */
  accessKeyNonce: bigint;
  /** `block` at finality "final": its height. */
  finalHeight: bigint;
}

export interface NearUnsigned {
  /**
   * What the key signs. `delegateAction` is the borsh of the NEP-366 `DelegateAction`; `hash` is the SHA-256 of the
   * NEP-461 prefix, `NEP461_DELEGATE` as a little-endian u32, followed by those bytes. `nearRequest` reads them.
   */
  request: { kind: "near-delegate"; hash: Uint8Array<ArrayBuffer>; delegateAction: Uint8Array<ArrayBuffer> };
  /**
   * Takes the key type (0 Ed25519, 1 secp256k1) and its 64- or 65-byte signature. An Ed25519 signature whose last byte
   * is 0x20 or more is `x402/signature-malformed`: nearcore reads none, and a valid signature never has one.
   */
  complete(signature: { keyType: 0 | 1; bytes: Uint8Array }): NearPayment | Refusal;
}

const ID = "x402/exact/near" as const;

/**
 * The longest `signedDelegateAction` lcp decodes, in base64 characters: lcp's own resource bound. x402's NEAR scheme
 * sets no size for it; it bounds the text `bound`, `reference` and `nearCarrier` decode before anything is read, and
 * holds a delegate whose one `ft_transfer` carries arguments of `MAX_FT_TRANSFER_ARGS_BYTES`.
 */
export const MAX_SIGNED_DELEGATE_BASE64 = 8192;
/**
 * The longest `ft_transfer` arguments lcp reads, in bytes: lcp's own resource bound. NEP-141 sets no size for a memo;
 * the bound holds the arguments lcp's client writes, a NEAR account id, a 128-bit amount and an LCP string, many times
 * over, and bounds the JSON every read of the arguments parses.
 */
export const MAX_FT_TRANSFER_ARGS_BYTES = 4096;
const U128_LIMIT = 1n << 128n;
const U64_LIMIT = 1n << 64n;

const utf8 = new TextEncoder();
/** The arguments' text: strict UTF-8, a leading byte-order mark kept, so arguments that begin with one are not JSON. */
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * `ft_transfer`'s arguments: `receiver_id`, `amount` and `memo`, in that order, as `JSON.stringify` writes them. A
 * `payTo` that is not a NEAR account id, or an `amount` that is not the canonical decimal string of a positive integer
 * below 2^128, is `near/option-malformed`, as the option filter answers an option carrying it, since the token contract
 * reads `receiver_id` as an `AccountId` and `amount` as a `U128` and refuses anything else; then a value that is not a
 * 32-byte hash is `x402/payload-malformed`.
 */
export function ftTransferArgs(payTo: string, amount: string, h: AtrHash): Uint8Array<ArrayBuffer> | Refusal {
  if (!isNearAccountId(payTo)) return refusal("near/option-malformed");
  if (!isAmount(amount) || decimalBelow(amount, U128_LIMIT) === undefined) return refusal("near/option-malformed");
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  return utf8.encode(JSON.stringify({ receiver_id: payTo, amount, memo: toLcpString(nh) }));
}

/**
 * Reads a base64 `SignedDelegateAction` whose one action is a `FunctionCall` of `ft_transfer` with a JSON object of
 * arguments whose `receiver_id` is a NEAR account id and whose `memo` is an LCP string. The bytes are read in the order
 * nearcore reads them: the sender and the receiver, where one that is not UTF-8, or not a NEAR account id, is
 * `near/sda-malformed`, then the count of actions, where a count other than one is `near/actions`, then the action's
 * variant index, where any index other than `FunctionCall`'s is `near/not-ft-transfer`, the bytes after it unread.
 * Otherwise the bytes must be exactly the borsh encoding of what is read, every string in it UTF-8, the key and the
 * signature each Ed25519 or secp256k1, and an Ed25519 signature's last byte below 0x20, as nearcore reads one, or they
 * are `near/sda-malformed`. The arguments are strict UTF-8 JSON text whose leading byte-order mark is kept as a
 * character, so arguments that begin with one are `near/args-malformed`. So are arguments the token contract refuses:
 * it reads them as near-sdk does, with serde's derived reader over `receiver_id: AccountId`, `amount: U128` and
 * `memo: Option<String>`. Those are arguments whose object names `receiver_id`, `amount` or `memo` more than once, each
 * key read with its escapes decoded, or has a key that decodes to a lone surrogate, or whose `receiver_id` is not a NEAR
 * account id, or whose `amount` is not a string of an optional `+` and one or more ASCII digits below 2^128, leading
 * zeros allowed (Rust's `u128::from_str`). Any other key is ignored, however often it repeats. Then a `memo` that is not
 * a string is `near/memo-missing`, and one that is not an LCP string `near/memo-not-lcp`. The amount is not compared
 * with the option's. A NEAR account id is 2 to 64 characters, each a lowercase ASCII letter, a digit, `-`, `_` or `.`,
 * where a separator (`-`, `_` or `.`) is never first, never last, and never follows another (near-account-id's
 * `AccountId`). borsh reads the bytes from the sender on, the action count and variant included. Without it, a value
 * that is not a string, is too long or is not base64 gets the code it gets with borsh, as those checks need no peer,
 * and any other value is `near/peer-missing`.
 */
export function nearCarrier(signedDelegateAction: string): {
  h: AtrHash;
  payer: string;
  publicKey: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  asset: string;
} | Refusal {
  const c = carrierOf(signedDelegateAction);
  if (isRefusal(c)) return c;
  const { args: _args, gas: _gas, deposit: _deposit, payTo: _payTo, amount: _amount, ...carried } = c;
  return carried;
}

/** `nearCarrier`'s reading, with the signed `ft_transfer` arguments' bytes. */
function carrierOf(signedDelegateAction: string): Carried | Refusal {
  if (typeof signedDelegateAction !== "string") return refusal("near/sda-malformed");
  if (signedDelegateAction.length > MAX_SIGNED_DELEGATE_BASE64) return refusal("near/sda-too-large");
  const bytes = signedDelegateAction === "" ? null : fromBase64(signedDelegateAction);
  if (bytes === null) return refusal("near/sda-malformed");
  if (borsh === undefined) return refusal("near/peer-missing");
  const d = decodeSignedDelegate(borsh, bytes);
  return typeof d === "string" ? delegateRefused(d) : carriedIn(d.delegateAction);
}

/** What a delegate action carries, as `nearCarrier` reads it, with what its `ft_transfer` arguments name. */
interface Carried {
  h: AtrHash;
  payer: string;
  publicKey: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  asset: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
  /** The arguments' `receiver_id`. */
  payTo: string;
  /** The arguments' `amount`, as the canonical decimal of the value the token contract reads. */
  amount: string;
}

function delegateRefused(d: DelegateRefused): Refusal {
  if (d === "action-count") return refusal("near/actions");
  if (d === "not-function-call") return refusal("near/not-ft-transfer");
  return refusal("near/sda-malformed");
}

/** The delegate action's one function call read as `ft_transfer` and its arguments as `nearCarrier` states. */
function carriedIn(da: FunctionCallDelegate): Carried | Refusal {
  if (da.functionCall.methodName !== "ft_transfer") return refusal("near/not-ft-transfer");
  const args = da.functionCall.args;
  const parsed = argsObject(args);
  if (isRefusal(parsed)) return parsed;
  const memo = memoIn(parsed);
  if (isRefusal(memo)) return memo;
  const amount = parsed["amount"] as string;
  return {
    h: memo,
    payer: da.senderId,
    publicKey: nearKeyText(da.publicKey),
    nonce: da.nonce,
    maxBlockHeight: da.maxBlockHeight,
    asset: da.receiverId,
    args,
    gas: da.functionCall.gas,
    deposit: da.functionCall.deposit,
    payTo: parsed["receiver_id"] as string,
    amount: BigInt(amount.startsWith("+") ? amount.slice(1) : amount).toString(),
  };
}

/**
 * Reads the delegate action a `near-delegate` request carries, its borsh bytes, as `nearCarrier` reads the delegate
 * action of a signed one, with its codes, and gives `hash`, the SHA-256 of the NEP-461 prefix followed by those bytes,
 * which is the request's `hash` when the bytes are its `delegateAction`. It gives every member the bytes hold: the
 * sender (`payer`) and its access key, the token contract (`asset`, the receiver), the one function call's gas and
 * attached deposit in yoctoNEAR, the nonce, `maxBlockHeight`, the last block height at which the action can run, and
 * the `ft_transfer` arguments' `receiver_id` (`payTo`), `amount` and the hash in `memo`. A delegate action holds one
 * action, an `ft_transfer`, or it is refused, so nothing else runs under the signature. A value that is not a
 * `Uint8Array` is `near/sda-malformed`, and bytes longer than those of the longest signed delegate action lcp decodes
 * are `near/sda-too-large`; without borsh, bytes within the bound are `near/peer-missing`.
 */
export async function nearRequest(delegateAction: Uint8Array): Promise<{
  hash: Uint8Array<ArrayBuffer>;
  payer: string;
  publicKey: string;
  asset: string;
  payTo: string;
  amount: string;
  h: AtrHash;
  nonce: bigint;
  maxBlockHeight: bigint;
  gas: bigint;
  deposit: bigint;
} | Refusal> {
  if (!(delegateAction instanceof Uint8Array)) return refusal("near/sda-malformed");
  if (delegateAction.length > (MAX_SIGNED_DELEGATE_BASE64 / 4) * 3) return refusal("near/sda-too-large");
  if (borsh === undefined) return refusal("near/peer-missing");
  const d = decodeDelegateAction(borsh, delegateAction);
  if (typeof d === "string") return delegateRefused(d);
  const c = carriedIn(d);
  if (isRefusal(c)) return c;
  const digest = await hash(delegateMessage(borsh, d));
  const { args: _args, ...read } = c;
  return { hash: bytesOfHexDigits(digest.slice(2))!, ...read };
}

/**
 * `ft_transfer`'s arguments as a JSON object, read only as the token contract reads them: strict UTF-8 JSON text of at
 * most 4096 bytes whose value is an object that `tokenReads` takes. Anything else is `near/args-malformed`. Every read
 * of the arguments' content goes through here: `nearCarrier`, and so `bound` and `reference`, and `recover`.
 */
function argsObject(args: Uint8Array): Record<string, unknown> | Refusal {
  if (args.length > MAX_FT_TRANSFER_ARGS_BYTES) return refusal("near/args-malformed");
  let text: string;
  try {
    text = strictUtf8.decode(args);
  } catch {
    return refusal("near/args-malformed");
  }
  const parsed = parseJson(text);
  return isObject(parsed) && tokenReads(text, parsed) ? parsed : refusal("near/args-malformed");
}

/** The keys the token contract's `ft_transfer` reads. */
const TRANSFER_KEYS: ReadonlySet<string> = new Set(["receiver_id", "amount", "memo"]);
/** A surrogate code unit that is not half of a pair. */
const LONE_SURROGATE = /\p{Cs}/u;
/** `u128::from_str`'s text: an optional `+`, then one or more ASCII digits. */
const U128_TEXT = /^\+?[0-9]+$/;

/**
 * True for `ft_transfer` arguments the token contract reads. near-sdk reads a JSON method's arguments with
 * `serde_json::from_slice` into a struct serde derives from the method's parameters, here `receiver_id: AccountId`,
 * `amount: U128` and `memo: Option<String>`, and it refuses unknown keys only for a method marked
 * `deny_unknown_arguments`. serde_json reads each key of the object as a string, refusing an escape that decodes to a
 * lone surrogate. The derived reader refuses a key it names that appears twice, and skips any other key each time it
 * appears. `AccountId` is a NEAR account id; `U128` is a string that Rust's `u128::from_str` reads: an optional `+`,
 * then one or more ASCII digits, leading zeros allowed, at most 2^128 - 1. The memo is read after, by `memoIn`.
 */
function tokenReads(text: string, parsed: Record<string, unknown>): boolean {
  const keys = jsonObjectKeys(text);
  if (keys === undefined) return false;
  const named = new Set<string>();
  for (const key of keys) {
    if (LONE_SURROGATE.test(key)) return false;
    if (!TRANSFER_KEYS.has(key)) continue;
    if (named.has(key)) return false;
    named.add(key);
  }
  if (!isNearAccountId(parsed["receiver_id"])) return false;
  const amount = parsed["amount"];
  if (typeof amount !== "string" || !U128_TEXT.test(amount)) return false;
  return BigInt(amount.startsWith("+") ? amount.slice(1) : amount) < U128_LIMIT;
}

/** The hash in the `memo` of a JSON object of `ft_transfer` arguments. */
function memoIn(parsed: Record<string, unknown>): AtrHash | Refusal {
  const memo = parsed["memo"];
  if (typeof memo !== "string") return refusal("near/memo-missing");
  return fromLcpString(memo) ?? refusal("near/memo-not-lcp");
}

// ── Settlement.

/**
 * Answers `status` as the profile `read-status` gives it, from what the read observed. The read holds the single-use
 * value, the payer's access key's nonce, read at `final` and at the latest head; and, from the block after the
 * position the caller gives (the first block where it gives none):
 * - the access-key search: where the nonce is read at or past the signed one, the changes of that key up to the block it
 *   was read so at, for the change that carried the nonce to or past the signed one, and the transaction that carried it;
 * - the search for H: the changes of every access key of the payer's account up to the latest head the reader serves,
 *   each read through the transaction that carried it, from the search position an earlier answer returned where the
 *   caller gives one;
 * - the transaction the reference names as a hint, which proves nothing and stops no search.
 * A transaction read is a delegate of the payer's that carries H where one of its function calls is an `ft_transfer`
 * or `ft_transfer_call` whose memo is H's LCP string, read as the token contract reads the arguments; it is this
 * pairing's kind where it holds exactly one action, an `ft_transfer`. Its signer is the delegate's sender, compared with
 * the reference's payer and the option's payee; the account it names is its `receiver_id`, compared with the payee; it
 * consumed the single-use value where it carried the key's nonce to or past the signed one; it succeeded where the
 * payer's account ran the delegate and the token contract's receipt for it succeeded, and failed where either failed;
 * and one whose token receipt has not run is kept below the final mark. Its mark is `final` where the RPC's
 * `final_execution_status` is `FINAL` and its change is at or below the final height, `optimistic` otherwise. What it
 * moved is the transfer the token contract ran: the token, the amount the arguments name and the `receiver_id`, named
 * by the transaction and, as `place`, the id of the token contract's receipt. A transaction it is given as another act
 * under the same H is matched by its hash, or, given by its reference, by the delegate's sender, key and nonce. A
 * change whose transaction the reader cannot name stops the search at the block before it; a transaction it cannot
 * read is named as one the search could not decode, held at the block before it, and the search reads on (one the
 * caller gave is named `given`). The value is read at the final mark and at the latest head: consumed where the nonce
 * is at or past the signed one; lapsed where it is below the signed one at a block past `max_block_height`; a key that
 * is absent at either read leaves the value unread, and holds the search short of whole whatever it reads, since the
 * value may have been taken before the key went: such a read answers `pending`, `search-incomplete`, never `not-found`.
 * No run has yet shown the search across the account's keys whole, so the search is never read whole, and every
 * `failed` but `before-position` answers `pending`, `search-incomplete`.
 * A `settled` answer states `presented`: `yes` where the delegate is, member by member, the one the reference holds,
 * `no` otherwise. A read
 * that rejects is unreadable by its reason; an answer outside the reader's documented form, a change outside the range
 * asked among them, `unparseable`; a range the node holds no history for, `history-gap`; a reader for another network
 * than the reference's, `chain-mismatch`; a reference, reader or query that is not one, `unparseable`, with nothing read.
 */
export async function nearStatus(ref: NearRef, reader: NearReader, query: NearQuery): Promise<NearStatus> {
  if (!isQuery(query, MARKS, isHeight) || (query.search !== undefined && !isHeight(query.search))) return NOT_READ;
  const r = refOf(ref);
  if (r === null || !isObject(reader) || typeof reader.network !== "string") return NOT_READ;
  if (reader.network !== r.network) return { state: "unreadable", reason: "chain-mismatch", foreign: [] };
  let read: Awaited<ReturnType<typeof readNear>>;
  try {
    read = await readNear(r, reader, query);
  } catch (e) {
    return { state: "unreadable", reason: rejected(e), foreign: [] };
  }
  return decide(read.facts, query, LEDGER);
}

const LEDGER = ledgerOf<bigint, NearMark>(NEAR[ID].coverage, MARKS, bigintOrder);
const NOT_READ: NearStatus = Object.freeze({ state: "unreadable", reason: "unparseable", foreign: [] });

/** A reference read: its members in the forms the read compares. */
interface Read {
  network: NearNetwork;
  payee: string;
  payer: string;
  asset: string;
  key: string;
  signed: bigint;
  maxBlockHeight: bigint;
  h: AtrHash;
  argsDigest: string;
  gas: bigint;
  deposit: bigint;
  hint?: string;
}

/** The reference as the read compares it, or null where a member is not in its form. */
function refOf(ref: unknown): Read | null {
  if (!isObject(ref)) return null;
  const nonce = u64Of(ref["nonce"]);
  const maxBlockHeight = u64Of(ref["maxBlockHeight"]);
  const gas = u64Of(ref["gas"]);
  const deposit = typeof ref["deposit"] === "string" ? decimalBelow(ref["deposit"], U128_LIMIT) : undefined;
  const h = normalHash(ref["h"] as string);
  const digest = normalHash(ref["argsDigest"] as string);
  const network = ref["network"];
  const hint = ref["transaction"];
  if (
    (network !== "near:mainnet" && network !== "near:testnet") ||
    nonce === null ||
    maxBlockHeight === null ||
    gas === null ||
    deposit === undefined ||
    h === null ||
    digest === null ||
    !isNearAccountId(ref["payee"]) ||
    !isNearAccountId(ref["asset"]) ||
    !isNearAccountId(ref["payer"]) ||
    !isPublicKey(ref["publicKey"]) ||
    (hint !== undefined && (typeof hint !== "string" || hint === ""))
  ) {
    return null;
  }
  return {
    network,
    payee: ref["payee"],
    payer: ref["payer"],
    asset: ref["asset"],
    key: ref["publicKey"] as string,
    signed: nonce,
    maxBlockHeight,
    h,
    argsDigest: digest,
    gas,
    deposit: BigInt(deposit),
    ...(hint === undefined ? {} : { hint }),
  };
}

/** An answer out of the reader's documented form. */
class Malformed extends Error {}

function malformed(): never {
  throw new Malformed();
}

/** A rejected read: an answer out of form `unparseable`, a `ReaderError` by its kind, anything else `transport`. */
function rejected(e: unknown): UnreadableReason {
  if (e instanceof Malformed) return "unparseable";
  if (e instanceof HistoryMissing) return "history-gap";
  const kind = isObject(e) && e["name"] === "ReaderError" ? e["kind"] : undefined;
  return kind === "too-large" ? "too-large" : kind === "malformed" ? "unparseable" : "transport";
}

/** A range read the node holds no history for. */
class HistoryMissing extends Error {}

/** The key's nonce and the height it was read at. */
async function keyAt(reader: NearReader, r: Read, finality: NearMark): Promise<{ nonce: bigint | null; blockHeight: bigint }> {
  const k: unknown = await reader.accessKeyNonce(r.payer, r.key, finality);
  if (!isObject(k) || !isHeight(k["blockHeight"])) malformed();
  const nonce = k["nonce"];
  if (nonce !== null && !isHeight(nonce)) malformed();
  return { nonce, blockHeight: k["blockHeight"] };
}

/** The changes a range read found, by height, and how far it read; a change outside the range is out of form. */
function changesOf(c: unknown, from: bigint, to: bigint): { changes: NearKeyChange[]; through: bigint } {
  if (isObject(c) && c["history"] === "missing") throw new HistoryMissing();
  if (!isObject(c) || !Array.isArray(c["changes"]) || !isHeight(c["through"])) malformed();
  const through = c["through"];
  if (through < from - 1n || through > to) malformed();
  const changes = (c["changes"] as unknown[]).map((x) => {
    if (!isObject(x) || !isHeight(x["height"]) || typeof x["publicKey"] !== "string") malformed();
    if (x["height"] < from || x["height"] > through) malformed();
    if (x["nonce"] !== null && !isHeight(x["nonce"])) malformed();
    const t = x["transaction"];
    if (t !== undefined && !(isObject(t) && typeof t["hash"] === "string" && t["hash"] !== "" && isNearAccountId(t["signer"]))) {
      malformed();
    }
    return x as unknown as NearKeyChange;
  });
  return { changes: changes.sort((a, b) => bigintOrder(a.height, b.height)), through };
}

/** What the read observed, and for each transaction read whether its delegate is the one presented. */
async function readNear(
  r: Read,
  reader: NearReader,
  query: NearQuery,
): Promise<{ facts: Facts<bigint, NearMark, bigint> }> {
  const final = await reader.finalHeight();
  if (!isHeight(final)) malformed();
  const atFinal = await keyAt(reader, r, "final");
  const atLatest = await keyAt(reader, r, "optimistic");
  const latest = [final, atFinal.blockHeight, atLatest.blockHeight].reduce((a, b) => (b > a ? b : a));
  const from = query.after === undefined ? 0n : query.after + 1n;
  const givenTx = new Set((query.others ?? []).flatMap((o) => ("transaction" in o && typeof o.transaction === "string" ? [o.transaction] : [])));
  const givenRefs = (query.others ?? []).flatMap((o: OtherAct<NearRef>) => {
    const g = "ref" in o ? refOf(o.ref) : null;
    return g === null ? [] : [g];
  });

  const seen = new Map<string, Seen<bigint, NearMark>>();
  const undecoded: Undecoded<bigint>[] = [];
  const read = new Set<string>();
  let whole = true;
  let stopped: bigint | undefined;
  const stopAt = (at: bigint): void => {
    whole = false;
    stopped = stopped === undefined || at < stopped ? at : stopped;
  };

  // The access-key search: the change that carried the nonce to or past the signed one.
  const consumedAt =
    atFinal.nonce !== null && atFinal.nonce >= r.signed
      ? atFinal.blockHeight
      : atLatest.nonce !== null && atLatest.nonce >= r.signed
        ? atLatest.blockHeight
        : undefined;
  let consuming: NearKeyChange | undefined;
  if (consumedAt !== undefined && from <= consumedAt) {
    const kc = changesOf(await reader.accessKeyChanges(r.payer, r.key, from, consumedAt), from, consumedAt);
    consuming = kc.changes.find((c) => c.publicKey === r.key && c.nonce !== null && c.nonce >= r.signed);
    if (consuming === undefined && kc.through < consumedAt) whole = false;
  }
  const consumingTx = consuming?.transaction?.hash;

  const visit = async (change: NearKeyChange, fromSearch: boolean): Promise<void> => {
    const tx = change.transaction;
    if (tx === undefined) {
      stopAt(change.height - 1n);
      return;
    }
    if (read.has(tx.hash)) return;
    read.add(tx.hash);
    const o: unknown = await reader.txStatus(tx.hash, tx.signer);
    const s = o !== null && isOutcome(o) ? await classify(o, tx.hash, change.height) : "undecodable";
    if (s === "undecodable") {
      // Named, and the search reads on: the answer holds it at the block before it (rule 19).
      undecoded.push({ transaction: tx.hash, at: change.height - 1n });
      return;
    }
    if (s === undefined) return;
    seen.set(tx.hash, s);
    // A find above the final mark that the access-key search would not find again keeps the search position below it.
    if (fromSearch && tx.hash !== consumingTx && s.mark !== "final") stopped = minHeight(stopped, change.height - 1n);
  };

  const classify = async (
    o: NearOutcome,
    tx: string,
    position: bigint | undefined,
  ): Promise<Seen<bigint, NearMark> | undefined | "undecodable"> => {
    const d = o.delegate;
    const isConsumer = tx === consumingTx;
    if (d === null) {
      if (!isConsumer) return undefined;
      return {
        transaction: tx,
        ...(position === undefined ? {} : { position }),
        mark: markOf(o.status === "FINAL", position, final),
        result: o.receipts.some((x) => x.outcome === "failure") ? "failed" : "succeeded",
        consumed: true,
        carries: false,
        party: "payer",
        kind: "other",
        account: "none",
        presented: "no",
      };
    }
    const calls: ({ call: NearFunctionCall; args: Record<string, unknown> | null; bytes: Uint8Array } | null)[] = [];
    for (const a of d.actions) {
      if (a === null) {
        calls.push(null);
        continue;
      }
      const bytes = fromBase64(a.argsBase64);
      if (bytes === null) return "undecodable";
      const args = argsObject(bytes);
      calls.push({ call: a, args: isRefusal(args) ? null : args, bytes });
    }
    let carrying: (typeof calls)[number] = null;
    for (const c of calls) {
      if (c === null || c.args === null || (c.call.methodName !== "ft_transfer" && c.call.methodName !== "ft_transfer_call")) continue;
      const m = memoIn(c.args);
      if (!isRefusal(m) && hashEquals(m, r.h)) {
        carrying = c;
        break;
      }
    }
    const ownReceipt = o.receipts.find((x) => x.executor === d.senderId);
    const ran = ownReceipt?.outcome === "success";
    const sameKey = d.senderId === r.payer && d.publicKey === r.key && d.nonce >= r.signed;
    const consumed = isConsumer || (consumingTx === undefined && ran && sameKey);
    if (carrying === null && !consumed) return undefined;
    const one = calls.length === 1 ? calls[0] : null;
    const named = carrying ?? (one !== null && one !== undefined && one.call.methodName === "ft_transfer" ? one : null);
    const receiver = named?.args?.["receiver_id"];
    const token = ran ? o.receipts.find((x) => x !== ownReceipt && x.executor === d.receiverId) : undefined;
    const notRun = !ran ? ownReceipt === undefined || ownReceipt.outcome === "pending" : token === undefined || token.outcome === "pending";
    const succeeded = ran && token?.outcome === "success";
    const kind = one !== null && one !== undefined && one.call.methodName === "ft_transfer" ? "same" : "other";
    const at = position ?? ownReceipt?.height;
    const moved: Moved[] =
      succeeded && kind === "same" && token !== undefined && typeof receiver === "string" && named !== null
        ? [{ asset: d.receiverId, amount: amountOf(named.args?.["amount"]), to: receiver, transaction: tx, place: token.id }]
        : [];
    const given = givenTx.has(tx) || givenRefs.some((g) => g.payer === d.senderId && g.key === d.publicKey && g.signed === d.nonce);
    const seen: Omit<Seen<bigint, NearMark>, "presented"> = {
      transaction: tx,
      ...(at === undefined ? {} : { position: at }),
      mark: notRun ? "optimistic" : markOf(o.status === "FINAL", at, final),
      // A delegate whose token receipt has not run is kept below the final mark: its facts would answer `failed`.
      result: succeeded ? "succeeded" : "failed",
      consumed,
      carries: carrying !== null,
      party: d.senderId === r.payee ? "payee" : d.senderId === r.payer ? "payer" : "other",
      kind,
      account: typeof receiver !== "string" ? "none" : receiver === r.payee ? "payee" : "other",
      ...(given ? { given: true } : {}),
      ...(moved.length === 0 ? {} : { moved }),
      signer: d.senderId,
      authority: d.publicKey,
    };
    const isPresented =
      one !== null &&
      one !== undefined &&
      one.call.methodName === "ft_transfer" &&
      d.senderId === r.payer &&
      d.receiverId === r.asset &&
      d.publicKey === r.key &&
      d.nonce === r.signed &&
      d.maxBlockHeight === r.maxBlockHeight &&
      one.call.gas === r.gas &&
      one.call.deposit === r.deposit &&
      hashEquals(await hash(one.bytes), r.argsDigest);
    return { ...seen, presented: isPresented ? "yes" : "no" };
  };

  if (consuming !== undefined) await visit(consuming, false);

  // The search for H: every access key of the payer's account, to the latest head.
  const resume = query.search === undefined ? from : query.search + 1n;
  const searchFrom = resume > from ? resume : from;
  if (searchFrom <= latest) {
    const ac = changesOf(await reader.accountKeyChanges(r.payer, searchFrom, latest), searchFrom, latest);
    if (ac.through < latest) stopAt(ac.through);
    for (const change of ac.changes) {
      if (change.nonce === null) continue;
      if (change.transaction !== undefined && change.transaction.hash === consumingTx) continue;
      await visit(change, true);
    }
  }

  // The hint: read where the search did not read it; it proves nothing and stops nothing.
  if (r.hint !== undefined && !read.has(r.hint)) {
    let o: unknown = null;
    try {
      o = await reader.txStatus(r.hint);
    } catch {
      o = null;
    }
    if (o !== null && isOutcome(o)) {
      const s = await classify(o, r.hint, undefined);
      if (s !== undefined && s !== "undecodable") seen.set(r.hint, s);
    }
  }

  // A key absent at either read leaves the value unread, and no read shows it untaken once the key is gone: the
  // search is not whole, whatever it read.
  if (atFinal.nonce === null || atLatest.nonce === null) whole = false;
  // The value at the final mark and at the latest head.
  let value: Facts<bigint, NearMark, bigint>["value"];
  if (atFinal.nonce !== null && atLatest.nonce !== null) {
    const head = { consumed: atLatest.nonce >= r.signed };
    if (atFinal.nonce >= r.signed) value = { consumed: true, lapsed: false, mark: "final", head };
    else if (head.consumed) value = { consumed: false, lapsed: false, mark: "final", head };
    else if (atFinal.blockHeight > r.maxBlockHeight) value = { consumed: false, lapsed: true, mark: "final", head };
    else if (atLatest.blockHeight > r.maxBlockHeight) value = { consumed: false, lapsed: true, mark: "optimistic", head };
    else value = { consumed: false, lapsed: false, mark: "final", head };
  }
  // No run has yet shown the search across the account's keys whole (the profile), so it is never read whole: every
  // `failed` but `before-position` answers `pending`, `search-incomplete`. It is held where it stopped below the latest
  // head, and gives no position where it read to it.
  const at = whole || stopped === undefined ? undefined : stopped < final ? stopped : final;
  // The items the search could not decode, the earliest first, none past the position the search is held at, so that
  // the next call reads again every block this one did not read (rule 8: a change whose transaction the reader cannot
  // name stops the search at the block before it).
  const holding = undecoded
    .map((u) => (at !== undefined && u.at !== undefined && u.at > at ? { ...u, at } : u))
    .sort((a, b) => bigintOrder(a.at ?? -1n, b.at ?? -1n));
  return {
    facts: {
      seen: [...seen.values()],
      ...(value === undefined ? {} : { value }),
      search: { whole: false, ...(at === undefined ? {} : { at }) },
      ...(holding.length === 0 ? {} : { undecoded: holding }),
      history: true,
    },
  };
}

/** The mark of a transaction: `final` where its status is `FINAL` and it is placed at or below the final height. */
function markOf(isFinal: boolean, position: bigint | undefined, final: bigint): NearMark {
  return isFinal && (position === undefined || position <= final) ? "final" : "optimistic";
}

/** The lower of two heights, either absent. */
function minHeight(a: bigint | undefined, b: bigint): bigint {
  return a === undefined || b < a ? b : a;
}

/** The amount the arguments name, as the token reads it: its decimal, an optional `+` and leading zeros dropped. */
function amountOf(amount: unknown): string {
  return typeof amount === "string" && U128_TEXT.test(amount) ? BigInt(amount.startsWith("+") ? amount.slice(1) : amount).toString() : "";
}

/** A block height, nonce or gas: a non-negative bigint below 2^64. */
function isHeight(v: unknown): v is bigint {
  return typeof v === "bigint" && v >= 0n && v < U64_LIMIT;
}

/**
 * Recovers the hash from a transaction: the `memo` in its delegate action's one `ft_transfer`. The input is
 * `{network, tx, option}`: the network, the transaction's hash, and the option the payment answers, an object, of which
 * the read needs no member; the transaction is read by its hash alone, its signer unknown. A transaction that carries no
 * delegate action, or whose delegate's one action is not a function call of `ft_transfer`, is `near/not-ft-transfer`,
 * and one with more than one action `near/actions`; one the reader does not know is `near/not-found`. A failed read, an
 * outcome that is not well formed, or a delegate whose arguments are not base64 in its canonical form (RFC 4648 §3.5) is
 * `near/unreadable`. An input that is not one, a reader for another network, a `tx` that is not a non-empty string, or
 * an option that is not an object, is `near/wrong-reader`, with nothing read. The arguments are read as `nearCarrier`
 * reads them, as the token contract reads them: arguments over the size bound, not UTF-8 JSON, not an object, or that
 * the contract refuses are `near/args-malformed`; then a `memo` that is not a string is `near/memo-missing`, and one
 * that is not an LCP string `near/memo-not-lcp`. The hash is recovered whatever the transfer's outcome.
 */
export async function nearRecover(
  input: RecoverInput<NearNetwork, PaymentRequirements | MppChallenge>,
  reader: NearReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("near/wrong-reader");
  if (typeof input.tx !== "string" || input.tx === "" || !isObject(input.option)) return refusal("near/wrong-reader");
  let o: unknown;
  try {
    o = await reader.txStatus(input.tx);
  } catch {
    return refusal("near/unreadable");
  }
  if (o === null) return refusal("near/not-found");
  if (!isOutcome(o)) return refusal("near/unreadable");
  const d = o.delegate;
  if (d === null) return refusal("near/not-ft-transfer");
  if (d.actions.length !== 1) return refusal("near/actions");
  const call = d.actions[0];
  if (call === null || call === undefined || call.methodName !== "ft_transfer") return refusal("near/not-ft-transfer");
  const args = fromBase64(call.argsBase64);
  if (args === null) return refusal("near/unreadable");
  const parsed = argsObject(args);
  return isRefusal(parsed) ? parsed : memoIn(parsed);
}

const RECEIPT_OUTCOMES: ReadonlySet<unknown> = new Set(["success", "failure", "pending"]);

/** True for an outcome in the reader's documented form. */
function isOutcome(o: unknown): o is NearOutcome {
  if (!isObject(o) || typeof o["status"] !== "string" || !Array.isArray(o["receipts"])) return false;
  const d = o["delegate"];
  if (d !== null) {
    if (!isObject(d) || !isNearAccountId(d["senderId"]) || !isNearAccountId(d["receiverId"])) return false;
    if (typeof d["publicKey"] !== "string" || !isHeight(d["nonce"]) || !isHeight(d["maxBlockHeight"])) return false;
    if (!Array.isArray(d["actions"])) return false;
    const callsOk = (d["actions"] as unknown[]).every(
      (a) =>
        a === null ||
        (isObject(a) &&
          typeof a["methodName"] === "string" &&
          typeof a["argsBase64"] === "string" &&
          isHeight(a["gas"]) &&
          typeof a["deposit"] === "bigint" &&
          a["deposit"] >= 0n &&
          a["deposit"] < U128_LIMIT),
    );
    if (!callsOk) return false;
  }
  return o["receipts"].every(
    (x) =>
      isObject(x) &&
      typeof x["id"] === "string" &&
      isNearAccountId(x["executor"]) &&
      RECEIPT_OUTCOMES.has(x["outcome"]) &&
      (x["height"] === undefined || isHeight(x["height"])),
  );
}

// ── The pairing.

const check: OptionFilter = (o) => {
  if (!isObject(o) || o.scheme !== "exact") return refusal("x402/option-not-this-pairing");
  if (typeof o.network !== "string" || !o.network.startsWith("near:")) return refusal("x402/option-not-this-pairing");
  const extra: unknown = o.extra;
  if (extra !== undefined && !isObject(extra)) return refusal("near/option-malformed");
  if (extra?.["assetTransferMethod"] !== undefined) return refusal("x402/option-not-this-pairing");
  const flow = extra?.["paymentFlow"];
  if (flow !== undefined && flow !== "authorization") return refusal("x402/option-not-this-pairing");
  if (o.network !== "near:mainnet" && o.network !== "near:testnet") return refusal("near/network-malformed");
  if (!isNearAccountId(o.asset) || !isNearAccountId(o.payTo)) return refusal("near/option-malformed");
  if (!isAmount(o.amount) || decimalBelow(o.amount, U128_LIMIT) === undefined) return refusal("near/option-malformed");
  if (!isTimeoutSeconds(o.maxTimeoutSeconds)) return refusal("near/option-malformed");
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
 * The delegate action for the chosen option: one `ft_transfer` whose memo is the hash's LCP string. H is checked first,
 * then the form of the choice's payer, key, nonce and height, then its document and option, then the height with the
 * option's timeout; borsh writes the delegate action, so without it the choice is `near/peer-missing` once every check
 * that needs no peer has passed.
 */
async function build(c: NearChoice, h: AtrHash): Promise<NearUnsigned | Refusal> {
  const nh = normalHash(h);
  if (nh === null) return refusal("x402/payload-malformed");
  if (!isObject(c)) return refusal("x402/option-malformed");
  const { required, accepted, payer, publicKey, accessKeyNonce, finalHeight } = c;
  if (!isNearAccountId(payer)) return refusal("x402/option-malformed");
  const key = nearKeyOf(publicKey);
  if (key === null) return refusal("x402/option-malformed");
  if (typeof accessKeyNonce !== "bigint" || accessKeyNonce < 0n || accessKeyNonce + 1n >= U64_LIMIT) {
    return refusal("x402/option-malformed");
  }
  if (typeof finalHeight !== "bigint" || finalHeight < 0n || finalHeight >= U64_LIMIT) {
    return refusal("x402/option-malformed");
  }
  const ok = chosen(required, accepted, check);
  if (ok !== true) return ok;
  // x402's NEAR scheme opens max(1, ceil(maxTimeoutSeconds / estimatedBlockSeconds)) blocks; with one-second blocks and
  // the positive timeout the filter holds, that is maxTimeoutSeconds blocks.
  const window = BigInt(accepted.maxTimeoutSeconds);
  if (finalHeight + window >= U64_LIMIT) return refusal("x402/option-malformed");
  const args = ftTransferArgs(accepted.payTo, accepted.amount, nh);
  if (isRefusal(args)) return args;
  if (borsh === undefined) return refusal("near/peer-missing");
  const delegateAction: FunctionCallDelegate = {
    senderId: payer,
    receiverId: accepted.asset,
    functionCall: { methodName: "ft_transfer", args, gas: FT_TRANSFER_GAS, deposit: 1n },
    nonce: accessKeyNonce + 1n,
    maxBlockHeight: finalHeight + window,
    publicKey: key,
  };
  const digest = await hash(delegateMessage(borsh, delegateAction));
  return {
    request: {
      kind: "near-delegate",
      hash: bytesOfHexDigits(digest.slice(2))!,
      delegateAction: Uint8Array.from(encodeDelegateAction(borsh, delegateAction)),
    },
    complete(signature: { keyType: 0 | 1; bytes: Uint8Array }): NearPayment | Refusal {
      if (!isObject(signature) || !(signature.bytes instanceof Uint8Array)) return refusal("x402/signature-malformed");
      const { keyType, bytes } = signature;
      if (!((keyType === 0 && isNearEd25519Signature(bytes)) || (keyType === 1 && bytes.length === 65))) {
        return refusal("x402/signature-malformed");
      }
      const signedDelegateAction = toBase64(
        encodeSignedDelegate(borsh, { delegateAction, signature: { keyType, data: new Uint8Array(bytes) } }),
      );
      return paymentWith(required, accepted, { signedDelegateAction });
    },
  };
}

function carried(presented: unknown): { accepted: PaymentRequirements; c: Exclude<ReturnType<typeof carrierOf>, Refusal> } | Refusal {
  const p = presentedWith(presented, check);
  if (isRefusal(p)) return p;
  const sda = p.payload["signedDelegateAction"];
  if (typeof sda !== "string") return refusal("x402/payload-malformed");
  const c = carrierOf(sda);
  return isRefusal(c) ? c : { accepted: p.accepted, c };
}

/**
 * The hash in the memo of the `ft_transfer` the payer's delegate action signs. The signature is not verified here;
 * the facilitator verifies it, and the runtime checks it against the account's key before executing.
 */
async function bound(presented: unknown): Promise<AtrHash | Refusal> {
  const r = carried(presented);
  return isRefusal(r) ? r : r.c.h;
}

/**
 * The read keys, from the signed delegate action and the option it answers: the option's payee, its `payTo`; and the
 * delegate action whole, its signature apart: the payer (its sender), the token (its receiver), its key, nonce and
 * `max_block_height`, and its one `ft_transfer`'s arguments by their SHA-256, with its gas and deposit, and the hash the
 * memo carries. A presented `accepted` that is not the option given, compared as RFC 8785 JSON, is
 * `x402/accepted-not-option`; an option with no `payTo` string is `x402/option-malformed`.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<NearRef | Refusal> {
  const r = carried(presented);
  if (isRefusal(r)) return r;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  if (!sameJson(r.accepted, option)) return refusal("x402/accepted-not-option");
  const { asset, payer, publicKey, nonce, maxBlockHeight, args, gas, deposit, h } = r.c;
  return {
    network: r.accepted.network as NearNetwork,
    payee,
    asset,
    payer,
    publicKey,
    nonce: nonce.toString(),
    maxBlockHeight: maxBlockHeight.toString(),
    argsDigest: await hash(args),
    gas: gas.toString(),
    deposit: deposit.toString(),
    h,
  };
}

/**
 * The option unchanged: on this pairing the hash rides in the signed arguments, not in the option. An option that
 * carries a `refused` member is `x402/option-malformed`; a value that is not an object comes back as it is.
 */
function unplaced(option: PaymentRequirements): PaymentRequirements | Refusal {
  if (isObject(option) && carriesRefused(option)) return refusal("x402/option-malformed");
  return option;
}

/** A decimal string below 2^64 as a bigint, or null. */
function u64Of(s: unknown): bigint | null {
  if (typeof s !== "string" || !/^[0-9]{1,20}$/.test(s)) return null;
  const v = BigInt(s);
  return v < U64_LIMIT ? v : null;
}

/**
 * True for a public key as nearcore writes it: `ed25519:` and the base58 of 32 bytes, or `secp256k1:` and of 64.
 * `nearStatus` compares a ref's key as text with the key the reader's delegate carries, which nearcore's RPC writes in
 * this form, so a ref holds it in this form alone: another spelling `build` reads, such as `ED25519:` or no key type,
 * names the same key but would compare unequal, and is unreadable here; the read asks the reader for the key's nonce and
 * changes only with a ref's key in this form.
 */
function isPublicKey(s: unknown): boolean {
  const k = nearKeyOf(s);
  return k !== null && nearKeyText(k) === s;
}

const pattern: LcpPattern = deepFreeze({
  pattern: "native-field",
  profile: "x402/exact/near/memo",
  onChain: true,
  zeroPartyRecoverable: true,
  forwardIndexable: false,
});

/**
 * `x402/exact/near`. The payee broadcasts (`broadcaster` answers `"payee"`): a relayer of the seller's facilitator
 * submits the delegate action the payer signed; `status` finds it by the payer's access key and searches every key of
 * the payer's account for H.
 */
export const exactNear = Object.freeze({
  id: ID,
  data: NEAR[ID],
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
  status: nearStatus,
  recover: nearRecover,
}) satisfies Entry<
  typeof ID,
  NearPayment,
  NearRef,
  NearReader,
  X402Forms & {
    choice: NearChoice;
    unsigned: NearUnsigned;
    landed: unknown;
    network: NearNetwork;
    query: NearQuery;
    answer: NearStatus;
  }
>;


