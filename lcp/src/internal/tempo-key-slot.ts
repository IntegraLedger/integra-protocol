/**
 * The read of a key slot in Tempo's account keychain: the entry `keys[account][keyId]` the keychain writes when it
 * authorizes a key. The keychain registers a key id for an account once: it refuses a key id it holds
 * (`KeyAlreadyExists`) or has revoked (`KeyAlreadyRevoked`), and an authorization whose `expiry` is not after the
 * block's timestamp (`ExpiryInPast`) (tempoxyz/tempo@c8b89f9b `crates/precompiles/src/account_keychain/mod.rs:316-334`);
 * a revoked key keeps `is_revoked` (`:484-490`). A transaction whose inline key authorization the keychain refuses is
 * invalid and is not included (`crates/evm/src/handler.rs:925-933`), and one it accepts registers the key before the
 * transaction's calls run, outside their checkpoint, so that a reverted transaction keeps it (`:831-834`, `:1270-1272`).
 * `getKey(account, keyId)` answers the key id where the key is held, and a blank entry with `isRevoked` where it was
 * revoked (`mod.rs:552-575`; `crates/contracts/src/precompiles/account_keychain.rs:76-82`, `:180`).
 */
import { addressWord, bytesOf, concat, hexOf, keccakHex, sameBytes, uintOf, type Hex } from "../evm-abi.js";
import { isRefusal } from "../refusal.js";
import { ACCOUNT_KEYCHAIN, decodeTempoTx } from "../tempo.js";
import { ReaderError, type EvmReader } from "./evm.js";
import { readKeyAuthorization } from "./key-authorization.js";
import { carriedKeyAuthorization, tempoSender } from "./tempo-envelope.js";
import { protocolNonceOf, type TempoSearchReader } from "./tempo-nonce.js";

/** `getKey(address,address)`. */
export const GET_KEY_SELECTOR = "0xbc298553" as const;

/**
 * The keychain calls that authorize a key, each taking the key id as its first argument: `authorizeKey` in its three
 * forms and `authorizeAdminKey` (`crates/contracts/src/precompiles/account_keychain.rs:109-143`).
 */
export const AUTHORIZE_SELECTORS: readonly Hex[] = [
  "0x54063a55", // authorizeKey(address,uint8,uint64,bool,(address,uint256)[])
  "0x980a6025", // authorizeKey(address,uint8,(uint64,bool,(address,uint256,uint64)[],bool,(address,(bytes4,address[])[])[]))
  "0xe3c154d2", // authorizeKey(address,uint8,(uint64,bool,(address,uint256,uint64)[],bool,(address,(bytes4,address[])[])[]),bytes32)
  "0x9a424307", // authorizeAdminKey(address,uint8,bytes32)
];

/** A key slot: the account, the key id, and the `expiry` the key authorization signs, null where it signs none. */
export interface KeySlot {
  readonly account: Hex;
  readonly keyId: Hex;
  readonly expiry: bigint | null;
}

/**
 * Whether the slot is consumed in the state after `block`: `getKey` names the key, or reads it revoked. An answer that
 * is not the five words of `KeyInfo`, or that names another key, rejects `malformed`.
 */
export async function slotConsumedAt(slot: KeySlot, reader: Pick<EvmReader, "call">, block: bigint): Promise<boolean> {
  const data = hexOf(concat([bytesOf(GET_KEY_SELECTOR)!, addressWord(slot.account), addressWord(slot.keyId)]));
  const answer = bytesOf(await reader.call(ACCOUNT_KEYCHAIN, data, block));
  if (answer === undefined || answer.length !== 160) throw new ReaderError("malformed", "ill-formed getKey answer");
  const key = answer.subarray(32, 64);
  const revoked = uintOf(answer.subarray(128, 160));
  if (key.subarray(0, 12).some((x) => x !== 0) || revoked > 1n) throw new ReaderError("malformed", "ill-formed getKey answer");
  const id = uintOf(key);
  if (id !== 0n && !sameBytes(hexOf(key.subarray(12)), slot.keyId)) throw new ReaderError("malformed", "getKey named another key");
  return id !== 0n || revoked === 1n;
}

/** A head as the read reads it: its number and its timestamp. */
export interface SlotHead {
  readonly number: bigint;
  readonly timestamp: bigint;
}

/** The slot as read at the final mark and at the latest head (`Facts.value`), and the block it was first read consumed at. */
export interface SlotRead {
  readonly value: {
    readonly consumed: boolean;
    readonly lapsed: boolean;
    readonly mark: "finalized" | "latest";
    readonly head: { readonly consumed: boolean };
  };
  readonly consumedAt?: bigint;
}

/**
 * The slot read at `final` and at `latest`. Its validity has passed where the final head's timestamp is at or past the
 * signed `expiry` (read at `finalized`), or the latest head's only (read at `latest`); a slot whose key authorization
 * signs no expiry never lapses. The keychain never clears a slot and registers none whose `expiry` is not after the
 * block's timestamp, so a slot read unconsumed at a head past `expiry` is never consumed.
 */
export async function readSlot(slot: KeySlot, reader: Pick<EvmReader, "call">, final: SlotHead, latest: SlotHead): Promise<SlotRead> {
  const consumedFinal = await slotConsumedAt(slot, reader, final.number);
  const consumedHead = latest.number === final.number ? consumedFinal : await slotConsumedAt(slot, reader, latest.number);
  const lapsedFinal = slot.expiry !== null && final.timestamp >= slot.expiry;
  const lapsedLatest = slot.expiry !== null && latest.timestamp >= slot.expiry;
  const value = {
    consumed: consumedFinal,
    lapsed: lapsedFinal || lapsedLatest,
    mark: lapsedFinal || !lapsedLatest ? ("finalized" as const) : ("latest" as const),
    head: { consumed: consumedHead },
  };
  const first = consumedFinal ? final.number : consumedHead ? latest.number : undefined;
  return first === undefined ? { value } : { value, consumedAt: first };
}

/** The transaction found to have consumed the slot, with its sender; or the block's transactions the read could not decode. */
export type SlotConsumer = { readonly transaction: Hex; readonly sender: Hex } | { readonly undecoded: readonly Hex[] };

/**
 * The transaction that consumed the slot, read consumed at `hi`: the first block in `(lo, hi]` at which the slot reads
 * consumed, found by halving the range (one read of the slot a halving), or, where it reads consumed at `lo`, the
 * position given, the first block in `[0, lo]`; then, in that block's transactions in their order, the first of the
 * account's whose key authorization names the key id, or whose own call to the keychain authorizes it, read from the
 * transaction's signed bytes. A transaction whose bytes the node does not return, or that do not decode, is named
 * `undecoded` where no transaction of the block is found. Undefined where none is found and every one decodes.
 */
export async function slotConsumer(slot: KeySlot, reader: TempoSearchReader, lo: bigint, hi: bigint): Promise<SlotConsumer | undefined> {
  let a = lo;
  let b = hi;
  // Invariant: consumed at b; at a unconsumed, or a is block 0 consumed (b = a).
  if (a === b || (await slotConsumedAt(slot, reader, a))) {
    b = a;
    a = 0n;
  }
  if (a < b && (await slotConsumedAt(slot, reader, a))) b = a;
  while (b - a > 1n) {
    const m = (a + b) / 2n;
    if (await slotConsumedAt(slot, reader, m)) b = m;
    else a = m;
  }
  const undecoded: Hex[] = [];
  for (const hash of await reader.blockTransactions(b)) {
    const found = await registers(slot, hash, reader);
    if (found === "undecodable") undecoded.push(hash.toLowerCase() as Hex);
    else if (found) return { transaction: hash.toLowerCase() as Hex, sender: slot.account.toLowerCase() as Hex };
  }
  return undecoded.length === 0 ? undefined : { undecoded };
}

/** Whether `input` is a keychain call that authorizes `keyId`. */
function authorizes(to: Hex | null, input: Uint8Array, keyId: Hex): boolean {
  if (to === null || !sameBytes(to, ACCOUNT_KEYCHAIN) || input.length < 36) return false;
  const selector = hexOf(input.subarray(0, 4));
  return AUTHORIZE_SELECTORS.some((s) => sameBytes(s, selector)) && sameBytes(hexOf(input.subarray(4, 36)), hexOf(addressWord(keyId)));
}

/**
 * Whether the transaction `hash` is the account's and registers the slot's key: a `0x76` or `0x78` transaction by its
 * sender, its key authorization (item 13) and its calls, from its signed bytes; a transaction of another type whose
 * signed bytes hash to its name by the sender, recipient and input the node reads for it. A keychain call counts only
 * where the transaction succeeded. `undecodable` where the node returns no bytes or they do not decode.
 */
async function registers(slot: KeySlot, hash: Hex, reader: TempoSearchReader): Promise<boolean | "undecodable"> {
  const raw = await reader.raw(hash);
  const wire = typeof raw === "string" ? bytesOf(raw) : undefined;
  if (wire === undefined || wire.length === 0) return "undecodable";
  if (wire[0] === 0x76 || wire[0] === 0x78) {
    const tx = decodeTempoTx(wire);
    const sender = tempoSender(wire);
    const carried = carriedKeyAuthorization(wire);
    if (isRefusal(tx) || isRefusal(sender) || isRefusal(carried)) return "undecodable";
    if (!sameBytes(sender, slot.account)) return false;
    if (carried !== undefined) {
      const k = readKeyAuthorization(carried);
      if (isRefusal(k)) return "undecodable";
      if (sameBytes(k.keyId, slot.keyId)) return true;
    }
    return tx.calls.some((c) => authorizes(c.to, c.input, slot.keyId)) && (await succeeded(hash, reader));
  }
  if (protocolNonceOf(wire) === undefined || !sameBytes(keccakHex(wire), hash)) return "undecodable";
  const t = await reader.transaction(hash);
  const input = t === null ? undefined : bytesOf(t.input);
  if (t === null || input === undefined || typeof t.from !== "string") return "undecodable";
  return sameBytes(t.from, slot.account) && authorizes(t.to, input, slot.keyId) && (await succeeded(hash, reader));
}

/** Whether the transaction's receipt shows it succeeded: a keychain call's registration is undone where the call reverts. */
async function succeeded(hash: Hex, reader: TempoSearchReader): Promise<boolean> {
  const r = await reader.receipt(hash);
  return r !== null && r.status === 1;
}
