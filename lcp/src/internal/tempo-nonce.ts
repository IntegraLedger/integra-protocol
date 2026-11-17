/**
 * The read of a Tempo transaction's single-use value, its nonce, by its nonce key (TIP-1009 at tempoxyz/tempo@c8b89f9b, `tips/tip-1009.md:33-39`, `:191-196`), and the receive-policy guard's
 * `TransferBlocked` receipt (TIP-1028, `tips/tip-1028.md:238-258`, `:394-401`). Key 2^256 - 1 is the expiring nonce,
 * whose value is the hash over the transaction's sender-signed fields and its sender (`expiringNonceHash`), marked seen in
 * the nonce precompile under its `validBefore` and cleared only after it (`crates/precompiles/src/nonce/mod.rs:21-36`,
 * `:149-164`); key 0 is the protocol nonce, read by `eth_getTransactionCount`; any other key is a 2D nonce lane, read by
 * the precompile's `getNonce(account, nonceKey)` (`crates/contracts/src/precompiles/nonce.rs:12-16`).
 */
import { addressWord, bytesOf, concat, hexOf, keccakHex, sameBytes, uintOf, uintWord, type Hex } from "../evm-abi.js";
import { isRefusal } from "../refusal.js";
import { rlpDecode, rlpUint } from "../rlp.js";
import { decodeTempoTx, expiringNonceHash } from "../tempo.js";
import type { EvmSearchReader } from "./evm-search.js";
import { decodeEnvelope, tempoSender } from "./tempo-envelope.js";

/** The nonce precompile, which keeps 2D nonce lanes and the expiring nonces seen. */
export const NONCE_PRECOMPILE = "0x4e4f4e4345000000000000000000000000000000" as const;
/** The nonce key of the expiring nonce. */
export const EXPIRING_NONCE_KEY = (1n << 256n) - 1n;
/** `getNonce(address,uint256)`. */
export const GET_NONCE_SELECTOR = "0x89535803" as const;
/** `TransferBlocked(address,address,uint64,uint256,uint8,bytes)`, which the receive-policy guard emits for a held transfer. */
export const TRANSFER_BLOCKED_TOPIC = "0x361d86e46fd139dc3eac4148f16b53597f0f8ddd9aba772aae0034bda5531b1c" as const;

/** Envelope positions of the nonce key and the nonce. */
const NONCE_KEY_ITEM = 6;
const NONCE_ITEM = 7;

/**
 * A reader of a Tempo network: an `EvmSearchReader` that also reads a storage slot, an account's protocol nonce and the
 * transactions of a block, each in the state after the block named. Every failure rejects.
 */
export interface TempoSearchReader extends EvmSearchReader {
  /** `eth_getStorageAt(address, slot, block)`: the 32-byte word. */
  storageAt(address: Hex, slot: Hex, block: bigint): Promise<Hex>;
  /** `eth_getTransactionCount(account, block)`. */
  nonceAt(account: Hex, block: bigint): Promise<bigint>;
  /** `eth_getBlockByNumber(block, false)`'s `transactions`: the hashes of the block's transactions, in its order. */
  blockTransactions(block: bigint): Promise<readonly Hex[]>;
}

/** A Tempo transaction's single-use value: its sender, nonce key and nonce, the hash over what it signed, and its window. */
export interface TempoValue {
  readonly sender: Hex;
  readonly key: bigint;
  readonly nonce: bigint;
  readonly signed: Hex;
  readonly validBefore: bigint | null;
}

/** The single-use value of a signed `0x76` or `0x78` transaction, or undefined where it does not decode. */
export function tempoValueOf(wire: Uint8Array): TempoValue | undefined {
  const items = decodeEnvelope(wire);
  const sender = tempoSender(wire);
  const tx = decodeTempoTx(wire);
  if (isRefusal(items) || isRefusal(sender) || isRefusal(tx)) return undefined;
  const signed = expiringNonceHash(wire, sender);
  const key = rlpUint(items[NONCE_KEY_ITEM]);
  const nonce = rlpUint(items[NONCE_ITEM]);
  if (isRefusal(signed) || key === undefined || nonce === undefined) return undefined;
  return { sender: sender.toLowerCase() as Hex, key, nonce, signed, validBefore: tx.validBefore };
}

/**
 * The nonce of a signed legacy, EIP-2930, EIP-1559 or EIP-7702 transaction, the envelopes Tempo takes beside its own
 * under the protocol nonce (tempoxyz/tempo@c8b89f9b `crates/primitives/src/transaction/envelope.rs:48-67`): a legacy
 * list's first item, a typed list's second. Undefined for any other bytes.
 */
export function protocolNonceOf(wire: Uint8Array): bigint | undefined {
  if (wire.length === 0) return undefined;
  const typed = wire[0] === 0x01 || wire[0] === 0x02 || wire[0] === 0x04;
  if (!typed && wire[0]! < 0xc0) return undefined;
  const top = rlpDecode(typed ? wire.subarray(1) : wire, 8);
  if (top === undefined || top.kind !== "list") return undefined;
  return rlpUint(top.items[typed ? 1 : 0]);
}

/** Whether two signed transactions take one value: one expiring nonce hash, or one sender, key and nonce. */
export function sameValue(a: TempoValue, b: TempoValue): boolean {
  if (a.key === EXPIRING_NONCE_KEY || b.key === EXPIRING_NONCE_KEY) return a.key === b.key && sameBytes(a.signed, b.signed);
  return sameBytes(a.sender, b.sender) && a.key === b.key && a.nonce === b.nonce;
}

/**
 * Whether `v` is consumed in the state after `block`: the expiring nonce's slot `keccak256(hash ‖ uint256(1))` of the
 * nonce precompile non-zero; the protocol nonce's count, or the 2D lane's `getNonce`, above the signed nonce. An answer
 * that is not a 32-byte word rejects.
 */
export async function consumedAt(v: TempoValue, reader: TempoSearchReader, block: bigint): Promise<boolean> {
  if (v.key === EXPIRING_NONCE_KEY) {
    const slot = keccakHex(concat([bytesOf(v.signed)!, uintWord(1n)]));
    const word = bytesOf(await reader.storageAt(NONCE_PRECOMPILE, slot, block));
    if (word === undefined || word.length !== 32) throw new Error("ill-formed storage word");
    return word.some((x) => x !== 0);
  }
  if (v.key === 0n) {
    const n = await reader.nonceAt(v.sender, block);
    if (typeof n !== "bigint") throw new Error("ill-formed nonce");
    return n > v.nonce;
  }
  const data = hexOf(concat([bytesOf(GET_NONCE_SELECTOR)!, addressWord(v.sender), uintWord(v.key)]));
  const word = bytesOf(await reader.call(NONCE_PRECOMPILE, data, block));
  if (word === undefined || word.length !== 32) throw new Error("ill-formed getNonce answer");
  return uintOf(word) > v.nonce;
}

/**
 * The last block at or below `hi` whose timestamp is below `validBefore`, at or above `lo`; `lo` where none is. A read of
 * an expiring nonce at a later block shows nothing, since the chain clears the entry after `validBefore`, and none of the
 * forms includes the transaction there.
 */
export async function lastBelow(reader: TempoSearchReader, validBefore: bigint, lo: bigint, hi: bigint): Promise<bigint> {
  if ((await reader.block(hi)).timestamp < validBefore) return hi;
  let a = lo;
  let b = hi;
  if ((await reader.block(a)).timestamp >= validBefore) return lo;
  // Invariant: block a is below validBefore, block b is not.
  while (b - a > 1n) {
    const m = (a + b) / 2n;
    if ((await reader.block(m)).timestamp < validBefore) a = m;
    else b = m;
  }
  return a;
}

/** A head as the read reads it: its number and its timestamp. */
export interface Head {
  readonly number: bigint;
  readonly timestamp: bigint;
}

/** The value as read at the final mark and at the latest head (`Facts.value`), and the block it was first read consumed at. */
export interface ValueRead {
  readonly value: {
    readonly consumed: boolean;
    readonly lapsed: boolean;
    readonly mark: "finalized" | "latest";
    readonly head: { readonly consumed: boolean };
  };
  /** The block read consumed at, the final head's read first; absent where neither read shows it consumed. */
  readonly consumedAt?: bigint;
}

/**
 * The value read at `final` and at `latest`, each at the last block below the signed `validBefore` where the head's
 * timestamp is at or past it. Its validity has passed where the final head's timestamp is at or past `validBefore`
 * (read at `finalized`), or the latest head's only (read at `latest`, a state below the final mark); a value with no
 * `validBefore` never lapses. `lo` is the lowest block a search reads.
 */
export async function readValue(v: TempoValue, reader: TempoSearchReader, final: Head, latest: Head, lo: bigint): Promise<ValueRead> {
  const at = async (h: Head): Promise<bigint> =>
    v.validBefore !== null && h.timestamp >= v.validBefore ? lastBelow(reader, v.validBefore, lo < h.number ? lo : h.number, h.number) : h.number;
  const finalAt = await at(final);
  const latestAt = latest.number === final.number ? finalAt : await at(latest);
  const consumedFinal = await consumedAt(v, reader, finalAt);
  const consumedHead = latestAt === finalAt ? consumedFinal : await consumedAt(v, reader, latestAt);
  const lapsedFinal = v.validBefore !== null && final.timestamp >= v.validBefore;
  const lapsedLatest = v.validBefore !== null && latest.timestamp >= v.validBefore;
  const value = {
    consumed: consumedFinal,
    lapsed: lapsedFinal || lapsedLatest,
    mark: lapsedFinal || !lapsedLatest ? ("finalized" as const) : ("latest" as const),
    head: { consumed: consumedHead },
  };
  const first = consumedFinal ? finalAt : consumedHead ? latestAt : undefined;
  return first === undefined ? { value } : { value, consumedAt: first };
}

/**
 * The transaction that consumed `v`, read consumed at `hi` (`read-status` rule 23): the first block in
 * `(lo, hi]` at which the value reads consumed, found by halving the range (one read of the value a halving), then in
 * that block's transactions the one whose signed bytes take the value (`sameValue`), or, on the protocol nonce, a
 * transaction of another type that takes it (`takesProtocolNonce`). A value already consumed at `lo`,
 * the position given, was consumed at or before it: the range halved is then `[0, lo]`, so that the answer,
 * `before-position`, names that transaction. Undefined where no transaction of the block found takes the value.
 */
export async function consumerOf(v: TempoValue, reader: TempoSearchReader, lo: bigint, hi: bigint): Promise<Hex | undefined> {
  let a = lo;
  let b = hi;
  // Invariant: consumed at b; at a unconsumed, or a is block 0 consumed (b = a). Consumed at `hi` = `lo` is consumed
  // at the position given.
  if (a === b || (await consumedAt(v, reader, a))) {
    b = a;
    a = 0n;
  }
  if (a < b && (await consumedAt(v, reader, a))) b = a;
  while (b - a > 1n) {
    const m = (a + b) / 2n;
    if (await consumedAt(v, reader, m)) b = m;
    else a = m;
  }
  for (const hash of await reader.blockTransactions(b)) {
    const raw = await reader.raw(hash);
    const wire = raw === null ? undefined : bytesOf(raw);
    const other = wire === undefined ? undefined : tempoValueOf(wire);
    if (other !== undefined && sameValue(v, other)) return hash.toLowerCase() as Hex;
    if (other === undefined && wire !== undefined && (await takesProtocolNonce(v, wire, hash, reader))) return hash.toLowerCase() as Hex;
  }
  return undefined;
}

/**
 * Whether a transaction of another type than Tempo's takes `v` on the protocol nonce: its signed bytes hash to its name
 * and carry the nonce (`protocolNonceOf`), and its sender, as the node reads it, is the value's.
 */
export async function takesProtocolNonce(v: TempoValue, wire: Uint8Array, hash: Hex, reader: Pick<EvmSearchReader, "transaction">): Promise<boolean> {
  if (v.key !== 0n || protocolNonceOf(wire) !== v.nonce || !sameBytes(keccakHex(wire), hash)) return false;
  const t = await reader.transaction(hash);
  return t !== null && typeof t.from === "string" && sameBytes(t.from, v.sender);
}

/** A transfer the receive-policy guard held, as its `TransferBlocked` receipt names it (`ClaimReceiptV1`). */
export interface HeldTransfer {
  readonly token: Hex;
  readonly originator: Hex;
  readonly recipient: Hex;
  readonly memo: Hex;
}

/**
 * The receipt a `TransferBlocked` log's data carries, `(uint256 amount, uint8 receiptVersion, bytes receipt)`, the
 * receipt being `abi.encode(ClaimReceiptV1)`: ten words, version 1. Undefined for any other form or version.
 */
export function heldTransferOf(data: Hex | string): HeldTransfer | undefined {
  const d = bytesOf(data);
  if (d === undefined || d.length < 96) return undefined;
  const word = (b: Uint8Array, i: number): Uint8Array => b.subarray(32 * i, 32 * (i + 1));
  if (uintOf(word(d, 1)) !== 1n || uintOf(word(d, 2)) !== 96n) return undefined;
  const len = uintOf(word(d, 3));
  const r = d.subarray(128);
  if (len !== 320n || r.length !== 320 || uintOf(word(r, 0)) !== 1n) return undefined;
  const address = (i: number): Hex | undefined => {
    const w = word(r, i);
    return w.subarray(0, 12).some((x) => x !== 0) ? undefined : hexOf(w.subarray(12));
  };
  const [token, , originator, recipient] = [address(1), address(2), address(3), address(4)];
  if (token === undefined || address(2) === undefined || originator === undefined || recipient === undefined) return undefined;
  return { token, originator, recipient, memo: hexOf(word(r, 9)) };
}
