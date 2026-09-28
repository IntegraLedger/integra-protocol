/**
 * Stacks rail pieces: the transaction id, the reader a settlement read goes through, the reading of a SIP-010 `transfer`
 * whose memo argument is the ATR hash's 32 bytes, and the zero-party recovery of that hash from a mined transaction.
 */
import { sha512_256 } from "@noble/hashes/sha2.js";
import { fromRawBytes, type AtrHash } from "./core.js";
import { bytesOf, hexOf, type Hex } from "./evm-abi.js";
import { isObject, normalHash } from "./fields.js";
import { refusal, type Refusal } from "./refusal.js";

/** CAIP-2: `stacks:1` (mainnet), `stacks:2147483648` (testnet). */
export type StacksNetwork = `stacks:${string}`;

/** The Clarity serialization of `(some <32-byte buffer>)` before its bytes: `0x0a`, `0x02`, then the length 32. */
export const MEMO_PREFIX = "0x0a0200000020";

/** SHA-512/256 of a transaction's whole consensus serialization, as `0x` and lowercase hex. */
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

/** An unmined transaction: `pending`, or one of the `dropped_…` states. */
export interface StacksMempool {
  mined: false;
  status: string;
}

/** Bounded reads of one network's Stacks Blockchain API. Any failure rejects with ReaderError. */
export interface StacksReader {
  readonly network: StacksNetwork;
  /** The transaction by its `0x`-prefixed id, with its function arguments; null when the API does not know it. */
  transaction(txid: Hex): Promise<StacksLanded | StacksMempool | null>;
  /** The tenure height of the block at `height`. */
  blockTenure(height: bigint): Promise<bigint>;
  /** The tip's tenure height. */
  tipTenure(): Promise<bigint>;
  /** The principal's last confirmed nonce, or null when it has none. */
  confirmedNonce(principal: string): Promise<bigint | null>;
}

/**
 * The read keys of a Stacks payment: its network, the token contract, the origin and its nonce as a decimal string,
 * and the transaction id (absent for a sponsored transaction, whose id is fixed only by the sponsor's signature).
 */
export interface StacksRef {
  network: StacksNetwork;
  contract: string;
  origin: string;
  nonce: string;
  transaction?: Hex;
}

export type StacksStatus =
  | { state: "settled"; finality: "block" | "bitcoin"; blockHeight: bigint }
  | { state: "pending"; why: "not-found" | "mempool" | "dropped" | "unreadable" }
  | {
      state: "failed";
      why: "abort-by-response" | "abort-by-post-condition" | "skipped" | "not-this-instrument";
      finality: "block" | "bitcoin";
      blockHeight: bigint;
    }
  | { state: "failed"; why: "nonce-used"; finality: "block" };

const FAILED: { readonly [status: string]: "abort-by-response" | "abort-by-post-condition" | "skipped" } = Object.freeze({
  abort_by_response: "abort-by-response",
  abort_by_post_condition: "abort-by-post-condition",
  problematic_skipped: "skipped",
});
const NONCE = /^(?:0|[1-9][0-9]{0,19})$/;

/** The memo argument's serialization for `h`: `(some h)` as a 32-byte buffer, lowercase. */
export function memoArgument(h: AtrHash): Hex | undefined {
  const n = normalHash(h);
  return n === null ? undefined : (`${MEMO_PREFIX}${n.slice(2)}` as Hex);
}

/** H from a memo argument that is `(some <32-byte buffer>)`, or null. */
export function memoHash(arg: unknown): AtrHash | null {
  if (typeof arg !== "string" || arg.length !== MEMO_PREFIX.length + 64) return null;
  if (arg.slice(0, MEMO_PREFIX.length).toLowerCase() !== MEMO_PREFIX) return null;
  const raw = bytesOf(`0x${arg.slice(MEMO_PREFIX.length)}`);
  return raw === undefined ? null : fromRawBytes(raw);
}

/**
 * The payment's settlement, in at most four reader calls. The origin's confirmed nonce is read first, then the
 * transaction. A wrong reader, a failed transaction read, or an answer of neither documented shape is pending
 * `unreadable`. A mined transaction must be the origin's at its nonce, calling the contract's `transfer` with `(some H)`
 * as its fourth argument, else failed `not-this-instrument`; then the API's `status` decides. A mined transaction's
 * answer, settled or failed, carries its finality: `bitcoin` once the tip's tenure height is at least the block's plus
 * two, else `block`, and a failed or malformed tenure read counts as `block`. Unmined and dropped, or unknown, it is
 * failed `nonce-used` only when the nonce read before the lookup was already at or above the transaction's: that nonce
 * was read at the API's tip, so `block`. A failed or malformed nonce read then is pending `unreadable`.
 */
export async function stacksStatus(
  ref: StacksRef & { transaction: Hex; h: AtrHash },
  reader: StacksReader,
): Promise<StacksStatus> {
  if (typeof ref !== "object" || ref === null || typeof reader !== "object" || reader === null) {
    return { state: "pending", why: "unreadable" };
  }
  if (reader.network !== ref.network || typeof ref.nonce !== "string" || !NONCE.test(ref.nonce)) {
    return { state: "pending", why: "unreadable" };
  }
  const memo = memoArgument(ref.h);
  const txid = normalHash(ref.transaction);
  if (memo === undefined || txid === null) return { state: "pending", why: "unreadable" };
  const nonce = BigInt(ref.nonce);
  const confirmed = await confirmedNonce(reader, ref.origin);
  let tx: unknown;
  try {
    tx = await reader.transaction(txid as Hex);
  } catch {
    return { state: "pending", why: "unreadable" };
  }
  if (isLanded(tx)) {
    const landed = tx;
    const mark = async (): Promise<"block" | "bitcoin"> => {
      try {
        const [block, tip]: unknown[] = [await reader.blockTenure(landed.blockHeight), await reader.tipTenure()];
        return typeof block === "bigint" && typeof tip === "bigint" && tip >= block + 2n ? "bitcoin" : "block";
      } catch {
        return "block";
      }
    };
    const call = tx.call;
    const ours =
      tx.sender.address === ref.origin &&
      tx.sender.nonce === nonce &&
      call !== null &&
      call.contractId === ref.contract &&
      call.functionName === "transfer" &&
      typeof call.args[3] === "string" &&
      call.args[3].toLowerCase() === memo;
    if (!ours) return { state: "failed", why: "not-this-instrument", finality: await mark(), blockHeight: tx.blockHeight };
    if (tx.status !== "success") {
      const why = Object.hasOwn(FAILED, tx.status) ? FAILED[tx.status] : undefined;
      if (why === undefined) return { state: "pending", why: "unreadable" };
      return { state: "failed", why, finality: await mark(), blockHeight: tx.blockHeight };
    }
    return { state: "settled", finality: await mark(), blockHeight: tx.blockHeight };
  }
  if (tx !== null && !isMempool(tx)) return { state: "pending", why: "unreadable" };
  if (tx !== null && tx.status === "pending") return { state: "pending", why: "mempool" };
  if (tx !== null && !tx.status.startsWith("dropped_")) return { state: "pending", why: "unreadable" };
  if (confirmed === undefined) return { state: "pending", why: "unreadable" };
  if (confirmed !== null && confirmed >= nonce) return { state: "failed", why: "nonce-used", finality: "block" };
  return { state: "pending", why: tx === null ? "not-found" : "dropped" };
}

/** The principal's last confirmed nonce; null when it has none; undefined when the read fails or is malformed. */
async function confirmedNonce(reader: StacksReader, principal: string): Promise<bigint | null | undefined> {
  let n: unknown;
  try {
    n = await reader.confirmedNonce(principal);
  } catch {
    return undefined;
  }
  return n === null || typeof n === "bigint" ? n : undefined;
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
 * Zero-party: H from the fourth argument of a mined, successful call to the contract's `transfer`, in one reader call.
 * A wrong reader is `stacks/wrong-reader`, a failed read or an answer of neither documented shape `stacks/unreadable`,
 * an unknown or unmined transaction `stacks/not-found`, any other status `stacks/not-success`, and no
 * `(some <32 bytes>)` memo of that call `stacks/no-memo`.
 */
export async function stacksRecover(
  ref: { network: StacksNetwork; contract: string; transaction: Hex },
  reader: StacksReader,
): Promise<AtrHash | Refusal> {
  if (typeof ref !== "object" || ref === null || typeof reader !== "object" || reader === null) {
    return refusal("stacks/unreadable");
  }
  if (reader.network !== ref.network) return refusal("stacks/wrong-reader");
  const txid = normalHash(ref.transaction);
  if (txid === null) return refusal("stacks/not-found");
  let tx: unknown;
  try {
    tx = await reader.transaction(txid as Hex);
  } catch {
    return refusal("stacks/unreadable");
  }
  if (tx !== null && !isLanded(tx) && !isMempool(tx)) return refusal("stacks/unreadable");
  if (!isLanded(tx)) return refusal("stacks/not-found");
  if (tx.status !== "success") return refusal("stacks/not-success");
  const call = tx.call;
  if (call === null || call.contractId !== ref.contract || call.functionName !== "transfer") return refusal("stacks/no-memo");
  const h = memoHash(call.args[3]);
  return h === null ? refusal("stacks/no-memo") : h;
}
