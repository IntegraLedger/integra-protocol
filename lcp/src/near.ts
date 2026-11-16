/**
 * NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose
 * `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it. Settlement is read from the
 * relayed transaction's receipts through a bounded reader.
 */
import type * as Borsh from "borsh";
import { fromLcpString, hash, hashEquals, parseJson, toLcpString, type AtrHash } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import { jsonObjectKeys } from "./internal/core.js";
import type { NearPayment } from "./internal/near.js";
import {
  decodeSignedDelegate,
  delegateMessage,
  encodeSignedDelegate,
  isNearAccountId,
  isNearEd25519Signature,
  nearKeyOf,
  nearKeyText,
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
import { decide, type Facts, type RecoverInput, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import { actSeen, bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import type { MppChallenge } from "./mpp-challenge.js";
export type { Broadcaster } from "./internal/broadcaster.js";

/** The optional peer, loaded once; undefined when it is not installed, and every function needing it refuses. */
const borsh: typeof Borsh | undefined = await import("borsh").catch(() => undefined);

export { NEP461_DELEGATE } from "./internal/near.js";

/** x402's NEAR network identifiers. */
export type NearNetwork = "near:mainnet" | "near:testnet";
export const FT_TRANSFER_GAS = 30_000_000_000_000n;

export interface NearOutcome {
  /** `final_execution_status`. */
  status: "FINAL" | "EXECUTED" | string;
  /**
   * The delegate action the relayed transaction carries: its `sender_id`, `public_key` and `nonce`, its `receiver_id`,
   * and the `method_name` and base64 `args` of its first action's function call. The sender and the receiver are NEAR
   * account ids, as nearcore's RPC writes them.
   */
  delegate: null | {
    senderId: string;
    publicKey: string;
    nonce: bigint;
    receiverId: string;
    methodName: string;
    argsBase64: string;
  };
  /** Each receipt's `executor_id`, a NEAR account id, and its outcome. */
  receipts: readonly { executor: string; outcome: "success" | "failure" | "pending" }[];
}

/**
 * Bounded, read-only calls against one network's RPC. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`; any rejection reads as unreadable, except in `nearLapsed`, which answers false.
 */
export interface NearReader {
  readonly network: NearNetwork;
  /**
   * The relayer accounts the transaction is looked up under, the first four, each a NEAR account id. x402's NEAR scheme
   * leaves relayer selection to the facilitator, which may list them under `/supported` `signers["near:*"]`.
   */
  readonly relayers: readonly string[];
  /** `EXPERIMENTAL_tx_status` with `wait_until` "NONE"; null: unknown. */
  txStatus(txHash: string, sender: string): Promise<NearOutcome | null>;
  /** `block` at finality "final": its header's height. */
  finalHeight(): Promise<bigint>;
  /**
   * `view_access_key` at "final" for the account and the key asked, which is written as nearcore's RPC writes a key: that
   * key's nonce and the `block_height` of the block whose state it reads; null: no such key.
   */
  accessKeyNonce(account: string, publicKey: string): Promise<{ nonce: bigint; blockHeight: bigint } | null>;
}

/**
 * The read keys `reference` returns, JSON-serialisable: `nonce` and `maxBlockHeight` are decimal strings, and `payee`
 * is the option's `payTo`. `transaction` is added when the facilitator names it.
 */
export interface NearRef {
  network: NearNetwork;
  payee: string;
  asset: string;
  payer: string;
  publicKey: string;
  nonce: string;
  maxBlockHeight: string;
  /** SHA-256 of the signed `ft_transfer` arguments' bytes, `0x` and lowercase hex. */
  argsDigest: `0x${string}`;
  transaction?: string;
}

/**
 * The answer of `nearStatus`, as the profile `read-status` gives it. Its marks are `optimistic` and `final`, in that
 * order; it reads no ledger position, so a position given as `after` places nothing.
 */
export type NearStatus = StatusAnswer<bigint, NearMark>;

type NearMark = "optimistic" | "final";
const MARKS: readonly NearMark[] = ["optimistic", "final"];

/**
 * What the read of the relayed transaction found. `not-this-instrument`: a delegate of the ref's payer on its key with
 * the ref's nonce or another, which is not the instrument the ref names; `not-a-delegate`: a transaction that carries
 * no delegate of that payer and key.
 */
type NearRead =
  | { state: "settled"; finality: NearMark }
  | { state: "pending"; why: "not-found" | "in-flight" }
  | { state: "failed"; why: "not-this-instrument" | "not-a-delegate" }
  | { state: "failed"; why: "transfer-failed"; finality: NearMark }
  | { state: "unreadable"; reason: UnreadableReason };

interface NearChoice {
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
  /** SHA-256 of the NEP-461-prefixed delegate action: what the key signs. */
  request: { kind: "near-delegate"; hash: Uint8Array<ArrayBuffer> };
  /**
   * Takes the key type (0 Ed25519, 1 secp256k1) and its 64- or 65-byte signature. An Ed25519 signature whose last byte
   * is 0x20 or more is `x402/signature-malformed`: nearcore reads none, and a valid signature never has one.
   */
  complete(signature: { keyType: 0 | 1; bytes: Uint8Array }): NearPayment | Refusal;
}

const ID = "x402/exact/near" as const;
const MAX_SDA_BASE64 = 8192;
const MAX_ARGS_BYTES = 4096;
const MAX_RELAYERS = 4;
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
  const { args: _args, ...carried } = c;
  return carried;
}

/** `nearCarrier`'s reading, with the signed `ft_transfer` arguments' bytes. */
function carrierOf(signedDelegateAction: string): {
  h: AtrHash;
  payer: string;
  publicKey: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  asset: string;
  args: Uint8Array;
} | Refusal {
  if (typeof signedDelegateAction !== "string") return refusal("near/sda-malformed");
  if (signedDelegateAction.length > MAX_SDA_BASE64) return refusal("near/sda-too-large");
  const bytes = signedDelegateAction === "" ? null : fromBase64(signedDelegateAction);
  if (bytes === null) return refusal("near/sda-malformed");
  if (borsh === undefined) return refusal("near/peer-missing");
  const d = decodeSignedDelegate(borsh, bytes);
  if (d === "malformed") return refusal("near/sda-malformed");
  if (d === "action-count") return refusal("near/actions");
  if (d === "not-function-call") return refusal("near/not-ft-transfer");
  const da = d.delegateAction;
  if (da.functionCall.methodName !== "ft_transfer") return refusal("near/not-ft-transfer");
  const args = da.functionCall.args;
  const parsed = argsObject(args);
  if (isRefusal(parsed)) return parsed;
  const memo = memoIn(parsed);
  if (isRefusal(memo)) return memo;
  return {
    h: memo,
    payer: da.senderId,
    publicKey: nearKeyText(da.publicKey),
    nonce: da.nonce,
    maxBlockHeight: da.maxBlockHeight,
    asset: da.receiverId,
    args,
  };
}

/**
 * `ft_transfer`'s arguments as a JSON object, read only as the token contract reads them: strict UTF-8 JSON text of at
 * most 4096 bytes whose value is an object that `tokenReads` takes. Anything else is `near/args-malformed`. Every read
 * of the arguments' content goes through here: `nearCarrier`, and so `bound` and `reference`, and `recover`.
 */
function argsObject(args: Uint8Array): Record<string, unknown> | Refusal {
  if (args.length > MAX_ARGS_BYTES) return refusal("near/args-malformed");
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
 * Answers the read of the relayed transaction as the profile `read-status` gives it. The read finds the transaction
 * under each relayer the reader lists (at most four), then requires its delegate to be the instrument the ref names,
 * and reads the receipts the token contract executed. The delegate is that instrument when its sender, key and nonce
 * are the ref's, it calls `ft_transfer` on `ref.asset`, and the SHA-256 of its arguments is `ref.argsDigest`; nothing
 * in the arguments is compared with the ATR's content. A succeeded token receipt is the payer's act, at `final` when
 * `final_execution_status` is `FINAL`, every receipt's block then being final, and at `optimistic` otherwise, `EXECUTED`
 * included; a failed one is the payer's act included with a failed result, which consumed the access key's nonce. A
 * delegate of the ref's payer and key, at the ref's nonce or above it, that is not that instrument, a second one the
 * payer signed on the same nonce included, means the nonce is taken by another act; a transaction with no such delegate carries no act of the
 * payer's; a transaction no relayer knows, or whose token receipt has not run, names no included act. The read holds
 * no search for H and does not read the access key's nonce, so none of these answers `failed`. A read that rejects is
 * unreadable `transport`; an outcome that is not well formed (a delegate sender or receiver, or a receipt's executor,
 * that is not a NEAR account id among them), or a delegate whose arguments are not base64 in its canonical form
 * (RFC 4648 §3.5), is `unparseable`. A ref, a reader or a query that is not one, a reader that names no network, a
 * ref whose network, nonce, asset, payer, public key or digest is malformed, or a relayer list that is empty or whose
 * first four are not each a NEAR account id, is unreadable `unparseable`, and a reader for another network than the
 * ref's `chain-mismatch`, each with nothing read: the asset and the
 * payer must be NEAR account ids, and the public key `ed25519:` and the base58 of 32 bytes or `secp256k1:` and of 64.
 * A NEAR account id is 2 to 64 characters, each a lowercase ASCII letter, a digit, `-`, `_` or `.`, where a separator
 * (`-`, `_` or `.`) is never first, never last, and never follows another (near-account-id's `AccountId`).
 */
export async function nearStatus(
  ref: NearRef & { transaction: string },
  reader: NearReader,
  query: StatusQuery<NearRef & { transaction: string }, bigint, NearMark>,
): Promise<NearStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint")) return UNPARSEABLE;
  return decide(factsOf(await readNear(ref, reader), ref), query, LEDGER);
}

const LEDGER = ledgerOf<bigint, NearMark>(NEAR[ID].coverage, MARKS, bigintOrder);

async function readNear(ref: NearRef & { transaction: string }, reader: NearReader): Promise<NearRead> {
  if (!isObject(ref) || !isObject(reader) || typeof reader.network !== "string") {
    return { state: "unreadable", reason: "unparseable" };
  }
  const nonce = u64Of(ref.nonce);
  if (
    (ref.network !== "near:mainnet" && ref.network !== "near:testnet") ||
    nonce === null ||
    typeof ref.transaction !== "string" ||
    !isNearAccountId(ref.asset) ||
    !isNearAccountId(ref.payer) ||
    !isPublicKey(ref.publicKey) ||
    normalHash(ref.argsDigest) === null
  ) {
    return { state: "unreadable", reason: "unparseable" };
  }
  if (reader.network !== ref.network) return { state: "unreadable", reason: "chain-mismatch" };
  const relayers = relayersOf(reader);
  if (relayers === null) return { state: "unreadable", reason: "unparseable" };
  const outcome = await findOutcome(ref.transaction, reader, relayers);
  if (typeof outcome === "string") return { state: "unreadable", reason: outcome };
  if (outcome === null) return { state: "pending", why: "not-found" };
  const dg = outcome.delegate;
  if (dg === null || dg.senderId !== ref.payer || dg.publicKey !== ref.publicKey || dg.nonce < nonce) {
    return { state: "failed", why: "not-a-delegate" };
  }
  if (dg.nonce !== nonce || dg.receiverId !== ref.asset || dg.methodName !== "ft_transfer") {
    return { state: "failed", why: "not-this-instrument" };
  }
  const args = fromBase64(dg.argsBase64);
  if (args === null) return { state: "unreadable", reason: "unparseable" };
  if (!hashEquals(await hash(args), ref.argsDigest)) {
    return { state: "failed", why: "not-this-instrument" };
  }
  const finality: NearMark = outcome.status === "FINAL" ? "final" : "optimistic";
  const byToken = outcome.receipts.filter((r) => r.executor === ref.asset);
  if (byToken.some((r) => r.outcome === "failure")) return { state: "failed", why: "transfer-failed", finality };
  if (!byToken.some((r) => r.outcome === "success")) return { state: "pending", why: "in-flight" };
  return { state: "settled", finality };
}

/**
 * The read's facts: the act at its mark where it succeeded or failed; a taken nonce, read through a delegate that is
 * not the instrument, as the single-use value consumed; and nothing else. The lookup is never a search read whole.
 */
function factsOf(read: NearRead, ref: NearRef & { transaction: string }): Facts<bigint, NearMark> {
  const none = { seen: [], search: { whole: false }, history: false } as const;
  switch (read.state) {
    case "unreadable":
      return { ...none, unreadable: read.reason };
    case "settled":
      return { ...none, seen: [actSeen<bigint, NearMark>(ref.transaction, read.finality)] };
    case "pending":
      return none;
    case "failed":
      if (read.why === "transfer-failed") {
        return { ...none, seen: [actSeen<bigint, NearMark>(ref.transaction, read.finality, undefined, "failed")] };
      }
      return read.why === "not-this-instrument" ? { ...none, value: { consumed: true, lapsed: false, mark: "final" } } : none;
  }
}

/**
 * True only when the delegate action can never execute: the final height, read first, is past `maxBlockHeight`, and
 * the key's nonce, read at a block height at or past that final height, is below the action's. A key read that lags
 * the final height read first is false. A key that does not exist is false, because a key deleted after the delegate
 * executed gives the same answer. Two calls; a failed or malformed read, or a ref or reader that is not an object, is
 * false. The key is read only for the delegate's own key, the ref's `publicKey` in the form nearcore's RPC writes it
 * and `reference` copies from the delegate (`ed25519:` and the base58 of 32 bytes, or `secp256k1:` and of 64), since
 * the reader's answer names no key: it is the answer for the key asked. A ref whose public key is in any other form,
 * another spelling of a key included, or names no key, is false with nothing read, as `nearStatus` reads it as
 * unreadable; so is a ref whose payer is not a NEAR account id.
 */
export async function nearLapsed(ref: NearRef, reader: NearReader): Promise<boolean> {
  if (!isObject(ref) || !isObject(reader)) return false;
  const maxBlockHeight = u64Of(ref.maxBlockHeight);
  const signed = u64Of(ref.nonce);
  if (reader.network !== ref.network || maxBlockHeight === null || signed === null) return false;
  if (!isNearAccountId(ref.payer) || !isPublicKey(ref.publicKey)) return false;
  try {
    const height = await reader.finalHeight();
    if (typeof height !== "bigint" || height <= maxBlockHeight) return false;
    const key: unknown = await reader.accessKeyNonce(ref.payer, ref.publicKey);
    if (!isObject(key) || typeof key["nonce"] !== "bigint" || typeof key["blockHeight"] !== "bigint") return false;
    return key["blockHeight"] >= height && key["nonce"] < signed;
  } catch {
    return false;
  }
}

/**
 * Recovers the hash from the settlement transaction: the `memo` in its delegated `ft_transfer` arguments. A transaction
 * that carries no delegate action, or whose delegate calls another method, is `near/not-ft-transfer`, as `nearStatus`
 * answers it failed `not-this-instrument`; one that no relayer the reader lists knows is `near/not-found`. A failed
 * read, an outcome that is not well formed (a delegate sender or receiver, or a receipt's executor, that is not a NEAR
 * account id among them), or a delegate whose arguments are not base64 in its canonical form (RFC 4648 §3.5), an answer
 * out of the reader's documented form, is `near/unreadable`, as `nearStatus` answers it pending. A ref that names no
 * `transaction` string is `near/wrong-reader`, and a relayer list that is empty or whose first four are not each a NEAR
 * account id is `near/no-relayer`, each with nothing read. The delegate's arguments are read as `nearCarrier` reads
 * them, only as the token contract reads them: arguments over the size bound, not UTF-8 JSON, not an object, or that the
 * contract refuses (a `receiver_id`, `amount` or `memo` named more than once, a key that decodes to a lone surrogate, a
 * `receiver_id` that is not a NEAR account id, or an `amount` that is not a string of an optional `+` and ASCII digits
 * below 2^128) are `near/args-malformed`, since the contract makes no transfer with them; then a `memo` that is not a
 * string is `near/memo-missing`, and one that is not an LCP string `near/memo-not-lcp`. Otherwise the hash is recovered
 * whatever the transfer's outcome, and nothing else in the arguments is compared with the ATR's content. The input's
 * `tx` is the transaction's hash, and its `option` the option the payment answers, an object, of which the read needs
 * no member; an input whose `tx` is not a non-empty string, or whose option is not an object, is `near/wrong-reader`.
 */
export async function nearRecover(
  input: RecoverInput<NearNetwork, PaymentRequirements | MppChallenge>,
  reader: NearReader,
): Promise<AtrHash | Refusal> {
  if (!isObject(input) || !isObject(reader) || reader.network !== input.network) return refusal("near/wrong-reader");
  if (typeof input.tx !== "string" || input.tx === "" || !isObject(input.option)) return refusal("near/wrong-reader");
  const relayers = relayersOf(reader);
  if (relayers === null) return refusal("near/no-relayer");
  const outcome = await findOutcome(input.tx, reader, relayers);
  if (typeof outcome === "string") return refusal("near/unreadable");
  if (outcome === null) return refusal("near/not-found");
  if (outcome.delegate === null || outcome.delegate.methodName !== "ft_transfer") return refusal("near/not-ft-transfer");
  const args = fromBase64(outcome.delegate.argsBase64);
  if (args === null) return refusal("near/unreadable");
  const parsed = argsObject(args);
  return isRefusal(parsed) ? parsed : memoIn(parsed);
}

/** The relayers the reader lists, the first four, when there is one and each is a NEAR account id; else null. */
function relayersOf(reader: NearReader): readonly string[] | null {
  if (!Array.isArray(reader.relayers) || reader.relayers.length === 0) return null;
  const relayers: readonly unknown[] = reader.relayers.slice(0, MAX_RELAYERS);
  return relayers.every(isNearAccountId) ? (relayers as readonly string[]) : null;
}

/** The outcome under the first relayer that knows it, or null; `transport` where a read rejects, `unparseable` where an answer is not an outcome. */
async function findOutcome(
  txHash: string,
  reader: NearReader,
  relayers: readonly string[],
): Promise<NearOutcome | null | "transport" | "unparseable"> {
  for (const relayer of relayers) {
    let o: NearOutcome | null;
    try {
      o = await reader.txStatus(txHash, relayer);
    } catch {
      return "transport";
    }
    if (o === null) continue;
    return isOutcome(o) ? o : "unparseable";
  }
  return null;
}

function isOutcome(o: unknown): o is NearOutcome {
  if (!isObject(o) || typeof o["status"] !== "string" || !Array.isArray(o["receipts"])) return false;
  const d = o["delegate"];
  if (d !== null) {
    if (!isObject(d)) return false;
    if (!isNearAccountId(d["senderId"]) || typeof d["publicKey"] !== "string" || typeof d["nonce"] !== "bigint") {
      return false;
    }
    if (!isNearAccountId(d["receiverId"]) || typeof d["methodName"] !== "string") return false;
    if (typeof d["argsBase64"] !== "string") return false;
  }
  return o["receipts"].every((r) => isObject(r) && isNearAccountId(r["executor"]) && typeof r["outcome"] === "string");
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
    request: { kind: "near-delegate", hash: bytesOfHexDigits(digest.slice(2))! },
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
 * The read keys, from the signed delegate action: the token, the payer, its key and the nonce, the window, and the
 * SHA-256 of the signed `ft_transfer` arguments; and the payee, the `payTo` of the option the payment answers.
 */
async function reference(presented: unknown, option: PaymentRequirements): Promise<NearRef | Refusal> {
  const r = carried(presented);
  if (isRefusal(r)) return r;
  const payee = x402Payee(option);
  if (isRefusal(payee)) return payee;
  const { asset, payer, publicKey, nonce, maxBlockHeight, args } = r.c;
  return {
    network: r.accepted.network as NearNetwork,
    payee,
    asset,
    payer,
    publicKey,
    nonce: nonce.toString(),
    maxBlockHeight: maxBlockHeight.toString(),
    argsDigest: await hash(args),
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
 * names the same key but would compare unequal, and is unreadable here. `nearLapsed` asks the reader for a key's nonce
 * only with a ref's key in this form.
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
 * submits the delegate action the payer signed; `status` reads the relayed transaction's receipts.
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
    landed: { transaction: string };
    network: NearNetwork;
    query: StatusQuery<NearRef & { transaction: string }, bigint, NearMark>;
    answer: NearStatus;
  }
>;


