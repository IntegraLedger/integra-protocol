/**
 * Stacks rail pieces: the transaction id, the reader a settlement read goes through, the reading of a SIP-010 `transfer`
 * whose memo argument is the ATR hash's 32 bytes, and the zero-party recovery of that hash from a mined transaction.
 */
import { sha512_256 } from "@noble/hashes/sha2.js";
import { fromRawBytes, type AtrHash } from "./core.js";
import { bytesOf, hexOf, type Hex } from "./evm-abi.js";
import { isObject, normalHash, notFoundPoint } from "./fields.js";
import { MEMO_PREFIX, memoArgument } from "./internal/stacks.js";
import { decide, type Facts, type RecoverInput, type StatusAnswer, type StatusQuery, type UnreadableReason } from "./internal/read.js";
import { actSeen, bigintOrder, isQuery, ledgerOf, UNPARSEABLE } from "./internal/read-ledger.js";
import { STACKS } from "./internal/data/stacks.js";
import { decodeObject, isChallengeShape, type MppChallenge } from "./mpp-challenge.js";
import { refusal, type Refusal } from "./refusal.js";
import type { PaymentRequirements } from "./x402.js";

/** CAIP-2: `stacks:1` (mainnet), `stacks:2147483648` (testnet). */
export type StacksNetwork = `stacks:${string}`;

/**
 * SHA-512/256 of a transaction's whole consensus serialization, as `0x` and lowercase hex. Throws TypeError when `wire`
 * is not a `Uint8Array`.
 */
export function stacksTxid(wire: Uint8Array): Hex {
  return hexOf(sha512_256(wire));
}

/** A mined transaction as the Stacks Blockchain API reports it from the canonical chain. `result` is never read. */
export interface StacksLanded {
  mined: true;
  status: "success" | "abort_by_response" | "abort_by_post_condition" | "problematic_skipped";
  sender: { address: string; nonce: bigint };
  blockHeight: bigint;
  /** The contract call, with each argument's consensus serialization as `0x` hex; null for any other payload. */
  call: { contractId: string; functionName: string; args: readonly Hex[] } | null;
}

/**
 * An unmined transaction: `pending`, or one of the `dropped_…` states, with the `height` its API had reached when it
 * answered (see `StacksReader`).
 */
export interface StacksMempool {
  mined: false;
  status: string;
  height: bigint | null;
}

/**
 * Bounded reads of one network's Stacks Blockchain API. Any failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`; a rejected tenure read counts as `block`, and any other rejection reads as unreadable.
 * `height` is the block height of that API's indexed chain tip (`GET /extended` → `chain_tip.block_height`), read from
 * the node that gave the answer it goes with: after the `confirmedNonce` call, so the nonce read is at or below it, and
 * before a lookup that answers `notFound` or an unmined transaction, so the lookup is at or above it. It is null when
 * the reader cannot read it from that node, and an answer naming no height never reads an unknown or dropped
 * transaction as failed.
 */
export interface StacksReader {
  readonly network: StacksNetwork;
  /** The transaction by its `0x`-prefixed id, with its function arguments; `notFound` when the API does not know it. */
  transaction(txid: Hex): Promise<StacksLanded | StacksMempool | { notFound: true; height: bigint | null }>;
  /** The tenure height of the block at `height`. */
  blockTenure(height: bigint): Promise<bigint>;
  /** The tip's tenure height. */
  tipTenure(): Promise<bigint>;
  /** The principal's last confirmed nonce, or null when it has none. */
  confirmedNonce(principal: string): Promise<{ nonce: bigint | null; height: bigint | null }>;
}

/**
 * The read keys of a Stacks payment: its network, the contract the transaction calls, the origin and its nonce as a
 * decimal string, the transaction id (absent for a sponsored transaction, whose id is fixed only by the sponsor's
 * signature), and the payee, the recipient of the challenge the payment answers.
 */
export interface StacksRef {
  network: StacksNetwork;
  payee: string;
  contract: string;
  origin: string;
  nonce: string;
  transaction?: Hex;
}

/**
 * The answer of `stacksStatus`, as the profile `read-status` gives it. Its marks are `block` and `bitcoin`, in that
 * order, and its position the block height.
 */
export type StacksStatus = StatusAnswer<bigint, StacksMark>;

type StacksMark = "block" | "bitcoin";
const MARKS: readonly StacksMark[] = ["block", "bitcoin"];

/**
 * What the read of the transaction and the origin's nonce found. `not-this-instrument`: a mined transaction of the
 * origin at the ref's nonce that is not the ref's transfer; `not-a-transfer`: a mined transaction of another origin or
 * nonce.
 */
type StacksRead =
  | { state: "settled"; finality: StacksMark; blockHeight: bigint }
  | { state: "pending"; why: "not-found" | "mempool" | "dropped" }
  | {
      state: "failed";
      why: "abort-by-response" | "abort-by-post-condition" | "skipped" | "not-this-instrument" | "not-a-transfer";
      finality: StacksMark;
      blockHeight: bigint;
    }
  | { state: "failed"; why: "nonce-used"; finality: "block" }
  | { state: "unreadable"; reason: UnreadableReason };

const FAILED: { readonly [status: string]: "abort-by-response" | "abort-by-post-condition" | "skipped" } = Object.freeze({
  abort_by_response: "abort-by-response",
  abort_by_post_condition: "abort-by-post-condition",
  problematic_skipped: "skipped",
});
const NONCE = /^(?:0|[1-9][0-9]{0,19})$/;
/** A standard principal as c32check writes it: `S`, the version and the checked hash160, 28 to 41 characters in all. */
const PRINCIPAL = /^S[0-9A-HJKMNP-TV-Z]{27,40}$/;
/** A contract principal: a standard principal, `.` and a Clarity contract name of at most 128 characters. */
const CONTRACT = /^S[0-9A-HJKMNP-TV-Z]{27,40}\.[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

/** H from a memo argument that is `(some <32-byte buffer>)`, or null. */
function memoHash(arg: unknown): AtrHash | null {
  if (typeof arg !== "string" || arg.length !== MEMO_PREFIX.length + 64) return null;
  if (arg.slice(0, MEMO_PREFIX.length).toLowerCase() !== MEMO_PREFIX) return null;
  const raw = bytesOf(`0x${arg.slice(MEMO_PREFIX.length)}`);
  return raw === undefined ? null : fromRawBytes(raw);
}

/**
 * Answers the read of the payment as the profile `read-status` gives it, in at most four reader calls. The origin's
 * confirmed nonce is read first, then the transaction. A mined transaction that is the origin's at its nonce, calling
 * `transfer` on the ref's `contract`, the contract the presented transaction called, with `(some H)` as its fourth
 * argument, is the payer's act; the API's `status` then decides whether it succeeded. A mined act, succeeded or not,
 * is read at its mark, `bitcoin` once the tip's tenure height is at least the block's plus two, else `block`, a failed
 * or malformed tenure read counting as `block`, and at its block height. An act aborted by its response or a post
 * condition is included with a failed result that took the nonce; a skipped one took none. A mined transaction of the
 * origin at its nonce that is not that transfer means the nonce is taken by another act, and one of another origin or
 * nonce carries no act of the payer's. An unmined, dropped or unknown transaction names no included act, except where
 * the nonce read before the lookup was already at or above the transaction's and the lookup names a height at or above
 * the one the nonce read names: the nonce is then taken by another act. The read holds no search for H, so none of
 * these answers `failed`. A transaction read that rejects, or a nonce read that rejects where the answer needs it, is
 * unreadable `transport`; an answer of no documented shape, or a mined status the API does not document, is
 * `unparseable`; a reader for another network than the ref's is `chain-mismatch`. A ref, a reader or a query that is
 * not one, a reader that names no network, or a ref whose nonce is not a decimal below 2^64, whose origin is not a c32
 * address in upper case, whose contract is not such an address, `.` and a contract name, or whose transaction or `h`
 * is not a 32-byte hash, is unreadable `unparseable`, with nothing read.
 */
export async function stacksStatus(
  ref: StacksRef & { transaction: Hex; h: AtrHash },
  reader: StacksReader,
  query: StatusQuery<StacksRef & { transaction: Hex; h: AtrHash }, bigint, StacksMark>,
): Promise<StacksStatus> {
  if (!isQuery(query, MARKS, (p) => typeof p === "bigint")) return UNPARSEABLE;
  return decide(factsOf(await readStacks(ref, reader), ref), query, LEDGER);
}

const LEDGER = ledgerOf<bigint, StacksMark>(STACKS["mpp/charge/usdc/stacks"].coverage, MARKS, bigintOrder);

async function readStacks(ref: StacksRef & { transaction: Hex; h: AtrHash }, reader: StacksReader): Promise<StacksRead> {
  const unparseable = { state: "unreadable", reason: "unparseable" } as const;
  if (!isObject(ref) || !isObject(reader) || typeof reader.network !== "string") return unparseable;
  if (typeof ref.network !== "string" || typeof ref.nonce !== "string" || !NONCE.test(ref.nonce)) return unparseable;
  const { origin, contract }: { origin: unknown; contract: unknown } = ref;
  if (typeof origin !== "string" || !PRINCIPAL.test(origin) || typeof contract !== "string" || !CONTRACT.test(contract)) {
    return unparseable;
  }
  const memo = memoArgument(ref.h);
  const txid = normalHash(ref.transaction);
  if (memo === undefined || txid === null) return unparseable;
  if (reader.network !== ref.network) return { state: "unreadable", reason: "chain-mismatch" };
  const nonce = BigInt(ref.nonce);
  const confirmed = await confirmedNonce(reader, ref.origin);
  let tx: unknown;
  try {
    tx = await reader.transaction(txid as Hex);
  } catch {
    return { state: "unreadable", reason: "transport" };
  }
  if (isLanded(tx)) {
    const landed = tx;
    const mark = () => tenureMark(reader, landed.blockHeight);
    const call = tx.call;
    const own = tx.sender.address === ref.origin && tx.sender.nonce === nonce;
    const ours =
      own &&
      call !== null &&
      call.contractId === ref.contract &&
      call.functionName === "transfer" &&
      typeof call.args[3] === "string" &&
      call.args[3].toLowerCase() === memo;
    if (!ours) {
      return { state: "failed", why: own ? "not-this-instrument" : "not-a-transfer", finality: await mark(), blockHeight: tx.blockHeight };
    }
    if (tx.status !== "success") {
      const why = Object.hasOwn(FAILED, tx.status) ? FAILED[tx.status] : undefined;
      if (why === undefined) return unparseable;
      return { state: "failed", why, finality: await mark(), blockHeight: tx.blockHeight };
    }
    return { state: "settled", finality: await mark(), blockHeight: tx.blockHeight };
  }
  const notFound = notFoundPoint(tx, "height");
  let readTo: bigint | null;
  if (notFound !== undefined) {
    readTo = notFound;
  } else {
    if (!isMempool(tx)) return unparseable;
    if (tx.status === "pending") return { state: "pending", why: "mempool" };
    if (!tx.status.startsWith("dropped_")) return unparseable;
    readTo = typeof tx.height === "bigint" ? tx.height : null;
  }
  if (typeof confirmed === "string") return { state: "unreadable", reason: confirmed };
  const covered = readTo !== null && confirmed.height !== null && readTo >= confirmed.height;
  if (confirmed.nonce !== null && confirmed.nonce >= nonce && covered) {
    return { state: "failed", why: "nonce-used", finality: "block" };
  }
  return { state: "pending", why: notFound === undefined ? "dropped" : "not-found" };
}

/**
 * The read's facts: the act at its mark and block height where it succeeded, or where it was aborted, a failed result
 * that took the nonce, or for a skipped one a failed result that took none; a nonce taken by another act as the
 * single-use value consumed; and nothing else. The lookup by id is never a search read whole.
 */
function factsOf(read: StacksRead, ref: StacksRef & { transaction: Hex }): Facts<bigint, StacksMark> {
  const none = { seen: [], search: { whole: false }, history: false } as const;
  const consumed = { ...none, value: { consumed: true, lapsed: false, mark: "bitcoin" } } as const;
  switch (read.state) {
    case "unreadable":
      return { ...none, unreadable: read.reason };
    case "pending":
      return none;
    case "settled":
      return { ...none, seen: [actSeen(ref.transaction, read.finality, read.blockHeight)] };
    case "failed":
      switch (read.why) {
        case "nonce-used":
        case "not-this-instrument":
          return consumed;
        case "not-a-transfer":
          return none;
        default:
          return {
            ...none,
            seen: [actSeen(ref.transaction, read.finality, read.blockHeight, "failed", read.why !== "skipped")],
          };
      }
  }
}

/**
 * The finality of a mined transaction's block: `bitcoin` once the tip's tenure height is at least the block's plus two,
 * else `block`. A failed or malformed tenure read counts as `block`. One or two calls.
 */
async function tenureMark(reader: StacksReader, blockHeight: bigint): Promise<"block" | "bitcoin"> {
  try {
    const [block, tip]: unknown[] = [await reader.blockTenure(blockHeight), await reader.tipTenure()];
    return typeof block === "bigint" && typeof tip === "bigint" && tip >= block + 2n ? "bitcoin" : "block";
  } catch {
    return "block";
  }
}

/**
 * The principal's last confirmed nonce (null when it has none) with the tip height it names; `transport` when the read
 * rejects, and `unparseable` when its answer is malformed.
 */
async function confirmedNonce(
  reader: StacksReader,
  principal: string,
): Promise<{ nonce: bigint | null; height: bigint | null } | "transport" | "unparseable"> {
  let n: unknown;
  try {
    n = await reader.confirmedNonce(principal);
  } catch {
    return "transport";
  }
  if (!isObject(n)) return "unparseable";
  const { nonce, height } = n;
  if (nonce !== null && typeof nonce !== "bigint") return "unparseable";
  return height === null || typeof height === "bigint" ? { nonce, height } : "unparseable";
}

/** True for an answer of `StacksLanded`'s shape. */
function isLanded(v: unknown): v is StacksLanded {
  if (!isObject(v) || v["mined"] !== true || typeof v["status"] !== "string") return false;
  const sender = v["sender"];
  if (!isObject(sender) || typeof sender["address"] !== "string" || typeof sender["nonce"] !== "bigint") return false;
  if (typeof v["blockHeight"] !== "bigint") return false;
  const call = v["call"];
  if (call === null) return true;
  if (!isObject(call) || typeof call["contractId"] !== "string" || typeof call["functionName"] !== "string") return false;
  const args = call["args"];
  return Array.isArray(args) && args.every((a) => typeof a === "string");
}

/** True for an answer of `StacksMempool`'s shape. */
function isMempool(v: unknown): v is StacksMempool {
  return isObject(v) && v["mined"] === false && typeof v["status"] === "string";
}

/**
 * Zero-party: H from the fourth argument of a mined, successful call to the contract's `transfer`, in one reader call,
 * or at most three for a failed one. A ref or reader that is not an object, a reader for another network, or a ref
 * whose `transaction` is not a 32-byte hash is `stacks/wrong-reader`, with nothing read; a failed read, an answer of no
 * documented shape, or a mined transaction whose status is none of `success`, `abort_by_response`,
 * `abort_by_post_condition` and `problematic_skipped`, `stacks/unreadable`; an unknown or unmined transaction
 * `stacks/not-found`. A failed status is `stacks/not-success` once the tip's tenure height is at least the block's plus
 * two, as `stacksStatus` reads `bitcoin` finality; below that, or where a tenure read fails, it is `stacks/not-final`,
 * since that block can be replaced. No `(some <32 bytes>)` memo of a call to the contract's `transfer` is
 * `stacks/no-memo`. The input's `tx` is the transaction id, and its `option` the challenge the payment answers, whose
 * decoded request names the contract in `methodDetails.stacks`: its `contractAddress`, `.` and its `contractName`. An
 * input whose `tx` is not a 32-byte hash, or whose option is not a challenge whose request names a contract so, is
 * `stacks/wrong-reader`, with nothing read.
 */
export async function stacksRecover(
  input: RecoverInput<StacksNetwork, PaymentRequirements | MppChallenge>,
  reader: StacksReader,
): Promise<AtrHash | Refusal> {
  if (typeof input !== "object" || input === null || typeof reader !== "object" || reader === null) {
    return refusal("stacks/wrong-reader");
  }
  if (reader.network !== input.network) return refusal("stacks/wrong-reader");
  const txid = normalHash(input.tx);
  const contract = contractOf(input.option);
  if (txid === null || contract === undefined) return refusal("stacks/wrong-reader");
  let tx: unknown;
  try {
    tx = await reader.transaction(txid as Hex);
  } catch {
    return refusal("stacks/unreadable");
  }
  if (!isLanded(tx) && !isMempool(tx) && notFoundPoint(tx, "height") === undefined) return refusal("stacks/unreadable");
  if (!isLanded(tx)) return refusal("stacks/not-found");
  if (tx.status !== "success") {
    if (!Object.hasOwn(FAILED, tx.status)) return refusal("stacks/unreadable");
    return (await tenureMark(reader, tx.blockHeight)) === "bitcoin" ? refusal("stacks/not-success") : refusal("stacks/not-final");
  }
  const call = tx.call;
  if (call === null || call.contractId !== contract || call.functionName !== "transfer") return refusal("stacks/no-memo");
  const h = memoHash(call.args[3]);
  return h === null ? refusal("stacks/no-memo") : h;
}

/** The contract a Stacks challenge's decoded request names in `methodDetails.stacks`, or undefined. */
function contractOf(option: unknown): string | undefined {
  if (!isChallengeShape(option)) return undefined;
  const details = decodeObject(option.request)?.["methodDetails"];
  const stacks = isObject(details) ? details["stacks"] : undefined;
  if (!isObject(stacks)) return undefined;
  const { contractAddress, contractName } = stacks;
  if (typeof contractAddress !== "string" || typeof contractName !== "string") return undefined;
  const contract = `${contractAddress}.${contractName}`;
  return CONTRACT.test(contract) ? contract : undefined;
}
