/**
 * The status of one Tron transaction by its id, read as `tronStatus` of `@integraledger/lcp` 0.5.0 reads it. Later lcp
 * releases replace that function with the pairing read, which takes the reference `reference` writes and a search
 * query; this facilitator keeps the 0.5.0 read, unchanged, until it reads the chain through that one.
 */
import { TRANSFER_TOPIC, type TronInfo, type TronNetwork } from "@integraledger/lcp/tron";

type Hex = `0x${string}`;

/**
 * Bounded, read-only calls against one network's FullNode: its `/walletsolidity` API for solidified data and its
 * `/wallet` API at the head. Any rejection reads as unreadable.
 */
export interface TronReader {
  readonly network: TronNetwork;
  /**
   * `/walletsolidity/gettransactioninfobyid` ("solid") or `/wallet/gettransactioninfobyid` ("head"). When the node does
   * not know the transaction, `notFound` with `timestamp`: the time in milliseconds of the latest block at that level
   * on the node that answered (`/walletsolidity/getnowblock` or `/wallet/getnowblock`), read from that same node before
   * the lookup, or null when the reader cannot read it from that node. A lookup naming no time never reads failed.
   */
  info(txid: Hex, level: "solid" | "head"): Promise<TronInfo | { notFound: true; timestamp: bigint | null }>;
  /** `/walletsolidity/gettransactionbyid`; null: none. */
  transaction(txid: Hex): Promise<{ rawDataHex: string } | null>;
  /** `/walletsolidity/getnowblock`: the latest solidified block's number and time in milliseconds. */
  solidHead(): Promise<{ number: bigint; timestamp: bigint }>;
}

/** The transaction to read: `asset` is the contract's 21-byte address; `expiration` is decimal milliseconds. */
export interface TronRef {
  network: TronNetwork;
  txid: Hex;
  asset: Hex;
  expiration: string;
}

export type TronStatus =
  | { state: "settled"; finality: "solidified" | "head"; blockNumber: bigint }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "contract-failed" | "no-transfer" | "expired"; result?: string };

/** Two block slots: a transaction is never included once the latest block is this far past its expiration. */
const EXPIRY_SLOTS_MS = 6000n;
const HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Reads the transaction at the Solidity level, then at the head: settled with receipt result `SUCCESS` and a `Transfer`
 * log from the asset; failed with any other result, or with no such log; failed as expired when neither lookup finds
 * it, each naming a latest block at or past the latest solidified block, and that block is two slots past the
 * expiration; pending otherwise.
 */
export async function tronStatus(ref: TronRef, reader: TronReader): Promise<TronStatus> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) {
    return { state: "pending", why: "unreadable" };
  }
  const txid = normalHash(ref.txid);
  const asset: unknown = ref.asset;
  if (txid === null || typeof asset !== "string" || !/^41[0-9a-f]{40}$/.test(bare(asset))) {
    return { state: "pending", why: "unreadable" };
  }
  const head = await solidTimestamp(reader);
  let covered = true;
  for (const level of ["solid", "head"] as const) {
    let info: unknown;
    try {
      info = await reader.info(txid, level);
    } catch {
      return { state: "pending", why: "unreadable" };
    }
    const readTo = notFoundPoint(info, "timestamp");
    if (readTo !== undefined) {
      covered &&= readTo !== null && head !== null && readTo >= head;
      continue;
    }
    if (!isInfo(info)) return { state: "pending", why: "unreadable" };
    if (info.result !== "SUCCESS") return { state: "failed", why: "contract-failed", result: info.result };
    if (!info.logs.some((log) => isAssetTransfer(log, ref.asset))) return { state: "failed", why: "no-transfer" };
    return { state: "settled", finality: level === "solid" ? "solidified" : "head", blockNumber: info.blockNumber };
  }
  const expiration = typeof ref.expiration === "string" && /^[0-9]{1,19}$/.test(ref.expiration) ? BigInt(ref.expiration) : null;
  if (head === null || expiration === null) return { state: "pending", why: "unreadable" };
  if (head >= expiration + EXPIRY_SLOTS_MS && covered) return { state: "failed", why: "expired" };
  return { state: "pending", why: "not-found" };
}

/** The latest solidified block's timestamp in milliseconds, or null when the read fails or its answer is malformed. */
async function solidTimestamp(reader: TronReader): Promise<bigint | null> {
  let head: unknown;
  try {
    head = await reader.solidHead();
  } catch {
    return null;
  }
  return isObject(head) && typeof head["timestamp"] === "bigint" ? head["timestamp"] : null;
}

function isInfo(v: unknown): v is TronInfo {
  if (!isObject(v)) return false;
  return typeof v["blockNumber"] === "bigint" && typeof v["result"] === "string" && Array.isArray(v["logs"]);
}

/** True for a log emitted by `asset` whose first topic is `Transfer`. */
function isAssetTransfer(log: unknown, asset: Hex): boolean {
  if (!isObject(log) || typeof log["address"] !== "string" || !Array.isArray(log["topics"])) return false;
  const emitter = bare(log["address"]);
  const token = bare(asset);
  if (token.length !== 42 || !token.startsWith("41")) return false;
  const address = emitter.length === 42 && emitter.startsWith("41") ? emitter.slice(2) : emitter;
  if (address !== token.slice(2)) return false;
  const first: unknown = log["topics"][0];
  return typeof first === "string" && bare(first) === TRANSFER_TOPIC;
}

/**
 * Reads a reader's not-found answer, `{ notFound: true, [key]: point }`, where the point is how far the answering
 * source had read: undefined when `v` is not a not-found answer, else its point, or null when it names none.
 */
function notFoundPoint(v: unknown, key: string): bigint | null | undefined {
  if (!isObject(v) || v["notFound"] !== true) return undefined;
  const point = v[key];
  return typeof point === "bigint" ? point : null;
}

/** The lowercase form of a 32-byte hash written as `0x` and 64 hex digits in either case, or null. */
function normalHash(h: unknown): Hex | null {
  return typeof h === "string" && HASH.test(h) ? (h.toLowerCase() as Hex) : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Lowercase hex without a `0x` prefix. */
function bare(s: string): string {
  const t = s.toLowerCase();
  return t.startsWith("0x") ? t.slice(2) : t;
}
