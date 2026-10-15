/**
 * Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
 * digest of the message the payer signed, and settlement read through a bounded reader. The public names are
 * re-exported by `../svm.ts`; the rest serve the Solana pairings and the root's `Presented`.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { fromLcpString, hash, toLcpString, type AtrHash } from "../core.js";
import type { Hex } from "../evm.js";
import { isObject, notFoundPoint } from "../fields.js";
import { fromBase64 } from "../rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { UptoSvmPayload } from "../x402-upto-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

/** CAIP-2: `solana:` and 32 base58 characters. */
export type SolanaNetwork = `solana:${string}`;

/**
 * A payment on `x402/exact/solana`: the base64 partially signed versioned transaction. `../x402-exact-solana.ts`
 * returns it from `complete`, and the root names it among the payments `Presented` covers; no entry point exports it.
 */
export interface SvmPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { transaction: string };
  extensions?: PaymentRequired["extensions"];
}

/**
 * A payment on `x402/upto/solana`: the opening's signed fields and its base64 partially signed transaction.
 * `../x402-upto-solana.ts` returns it from `complete`, and the root names it among the payments `Presented` covers; no
 * entry point exports it.
 */
export interface UptoSvmPaymentPayload {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: UptoSvmPayload;
  extensions?: PaymentRequired["extensions"];
}

/** An SPL Memo program id: a top-level instruction to it is a Memo instruction. */
export const MEMO_V3 = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** An SPL Memo program id: a top-level instruction to it is a Memo instruction. */
export const MEMO_V4 = "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH";
/** The SPL Token program id. */
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/** The SPL Token-2022 program id. */
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** The System program id. */
export const SYSTEM = "11111111111111111111111111111111";
/** The `RecentBlockhashes` sysvar, which a durable message's `AdvanceNonceAccount` names after its nonce account. */
const RECENT_BLOCKHASHES = "SysvarRecentB1ockHashes11111111111111111111";
/** The Compute Budget program id. */
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/** The Associated Token Account program id. */
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export const MAX_WIRE = 1232;
const NETWORK = /^solana:[1-9A-HJ-NP-Za-km-z]{32}$/;
const MAX_LOCATE_PAGES = 10;
const LOCATE_PAGE = 1000;
const MAX_CANDIDATES = 50;
const SLOT = /^(0|[1-9][0-9]{0,19})$/;
/** Slots between the claim and a nonce account read that can show the recorded nonce has moved on. */
const NONCE_SETTLED_SLOTS = 150n;
/** The System program's nonce account: version u32, state u32, authority, durable nonce, lamports per signature. */
const NONCE_ACCOUNT_BYTES = 80;

/** One compiled instruction of an `SvmTx`; `B` is what its data is backed by, as for `SvmTx`. */
export interface SvmInstruction<B extends ArrayBufferLike = ArrayBufferLike> {
  program: number;
  accounts: readonly number[];
  data: Uint8Array<B>;
}

/**
 * A decoded wire transaction. `B` is what its bytes are backed by: `decodeSvmTx` gives `SvmTx<ArrayBuffer>`, each byte
 * field in its own fresh `ArrayBuffer`, and a function that reads one takes any backing.
 */
export interface SvmTx<B extends ArrayBufferLike = ArrayBufferLike> {
  signatures: readonly Uint8Array<B>[];
  /** Exactly the bytes every signer signed. */
  message: Uint8Array<B>;
  /** The static account keys, in order. */
  keys: readonly Uint8Array<B>[];
  instructions: readonly SvmInstruction<B>[];
  blockhash: Uint8Array<B>;
}

/** A landed transaction as `getTransaction` returns it with encoding `base64` and `maxSupportedTransactionVersion` 0. */
export interface SvmLanded {
  wire: Uint8Array;
  err: unknown | null;
  loaded: { writable: readonly Uint8Array[]; readonly: readonly Uint8Array[] };
  /** `meta.innerInstructions`, flattened; `program` indexes the static keys, then `loaded.writable`, then `loaded.readonly`. */
  inner: readonly { program: number; data: Uint8Array }[];
}

/**
 * Bounded, read-only calls against one network's endpoint. Every failure rejects, for example with `ReaderError` from
 * `@integraledger/lcp/evm`, and no function in this package reads a rejection as finding nothing. A rejected
 * `transaction` or `account` call, and a rejected `firstAvailableBlock` call in a status read, is unreadable:
 * `svm/unreadable`, a read to repeat, or a status read's pending `unreadable`. In `svmLocate`, a rejected
 * `firstAvailableBlock` or `signatures` call leaves the search `complete` false. `transaction` answers `notFound` when
 * the node holds no such transaction at that commitment, with `slot`: the node's slot at that commitment (`getSlot`),
 * read from that same node before the lookup, so the lookup is at or past it, or null when the reader cannot read it
 * from that node. A lookup naming no slot never reads failed.
 */
export interface SvmReader {
  readonly network: SolanaNetwork;
  /** `getTransaction` at that commitment, or `notFound` with the node's slot there. */
  transaction(
    signature: string,
    commitment: "confirmed" | "finalized",
  ): Promise<SvmLanded | { notFound: true; slot: bigint | null }>;
  /**
   * `getSignaturesForAddress`, newest first. `memo` is the RPC's rendering of the transaction's memos (`[len] text`,
   * joined by `; `), or null when it has none. When the page names `minContextSlot`, the reader passes it to the RPC as
   * `minContextSlot`, "the minimum slot that the request can be evaluated at", so a node that has not reached that slot
   * fails the call, and the reader rejects with `ReaderError`.
   */
  signatures(
    address: string,
    page: { before?: string; limit: 1000; minContextSlot?: bigint },
  ): Promise<readonly { signature: string; slot: bigint; memo: string | null }[]>;
  /**
   * `isBlockhashValid` at commitment `confirmed`: `valid` is the response's `value` ("Whether the blockhash is still
   * valid at the evaluated slot"), and `slot` its context slot, the slot the node evaluated it at. No function in this
   * package calls it; it serves the caller's own verdict that a message with a blockhash reference never landed. A node
   * also answers false for a blockhash whose block it has not reached, so a false answer at a slot below `fromSlot` +
   * 150, the bound `svmNonceMoved` sets for its read, shows nothing; the bound holds for a blockhash from a slot at or
   * before `fromSlot` + 150. From a false answer at or past that bound, the caller passes `slot` to `svmLocate` as
   * `minContextSlot`, so a node behind this read fails the search's call and the search is `complete` false; a search
   * given that slot and `complete` with nothing found shows the message never landed.
   */
  blockhashValid(blockhash: string): Promise<{ valid: boolean; slot: bigint }>;
  /** `getFirstAvailableBlock`: the lowest slot whose block the node still holds. */
  firstAvailableBlock(): Promise<bigint>;
  /**
   * `getAccountInfo` at commitment `finalized` with encoding `base64`: the response's context slot, and the account's
   * owner and data, or null when no account exists at that address.
   */
  account(address: string): Promise<{ slot: bigint; value: { owner: string; data: Uint8Array } | null }>;
}

/**
 * The durable nonce a message uses: the nonce account its `AdvanceNonceAccount` instruction names, and the nonce value
 * the message carries in its blockhash field.
 */
export interface SvmNonce {
  account: string;
  value: string;
}

/**
 * The read keys a seller keeps to read the settlement later: what `reference` returns, and `fromSlot`, which the seller
 * adds.
 */
export interface SvmRef {
  network: SolanaNetwork;
  transaction?: string;
  digest: Hex;
  feePayer: string;
  /**
   * The recent blockhash whose expiry bounds the message's life; empty for a durable-nonce message, whose life is
   * bounded by `nonce` instead.
   */
  blockhash: string;
  /** Present exactly when the message uses a durable nonce. */
  nonce?: SvmNonce;
  /** The slot the seller read when it kept the reference, as a decimal string. */
  fromSlot: string;
  /**
   * The channel account the transaction creates, for an opening that carries no memo: the search pages this address's
   * signatures instead of the fee payer's, and reads each one as a candidate.
   */
  channel?: string;
}

/**
 * A Solana settlement read. Pending `not-final` is a failure that rests on how the transaction executed (its `err`, or
 * the inner instructions a check reads), seen only at `confirmed`: a block that is not finalized can be replaced, and
 * the transaction can land in another block and execute otherwise, so only the read at `finalized` gives that failure.
 */
export type SvmStatus =
  | { state: "settled"; commitment: "confirmed" | "finalized" }
  | { state: "pending"; why: "not-found" | "unreadable" | "not-final" }
  | { state: "failed"; why: "err" | "not-this-instrument" | "no-transfer" | "nonce-moved" };

export interface SvmBuildInput {
  feePayer: string;
  payer: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  payTo: string;
  amount: bigint;
  recentBlockhash: string;
  memo: string;
  computeUnitLimit: number;
  computeUnitPrice: bigint;
}

/** What the payer signs, and how the signature becomes the wire transaction. */
export interface SvmSigning {
  request: { kind: "solana-message"; message: Uint8Array<ArrayBuffer> };
  /** The partially signed wire: the payer's 64-byte Ed25519 signature in its slot, zeros in every other. */
  wire(signature: Uint8Array): Uint8Array | Refusal;
}

// ── keys and networks ────────────────────────────────────────────────────────────────────────────────────────────

/** The 32 bytes of a base58 public key, or null. */
export function keyBytes(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return null;
  try {
    const b = base58.decode(s);
    return b.length === 32 ? b : null;
  } catch {
    return null;
  }
}

/**
 * True when `s` is a Solana public key: a base58 string of 32 to 44 characters that decodes to exactly 32 bytes. An
 * account address, a program id and a recent blockhash all take this form.
 */
export function isKey(s: unknown): s is string {
  return keyBytes(s) !== null;
}

/** True when `s` is a transaction signature: base58 of 64 bytes. */
export function isSignature(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 64 || s.length > 88) return false;
  try {
    return base58.decode(s).length === 64;
  } catch {
    return false;
  }
}

export function keyString(b: Uint8Array): string {
  return base58.encode(b);
}

export function isSolanaNetwork(s: unknown): s is SolanaNetwork {
  return typeof s === "string" && NETWORK.test(s);
}

const MEMO_V3_BYTES = base58.decode(MEMO_V3);
const MEMO_V4_BYTES = base58.decode(MEMO_V4);
const TOKEN_BYTES = base58.decode(TOKEN);
const TOKEN_2022_BYTES = base58.decode(TOKEN_2022);
const SYSTEM_BYTES = base58.decode(SYSTEM);
const RECENT_BLOCKHASHES_BYTES = base58.decode(RECENT_BLOCKHASHES);

/** True for the shape `decodeSvmTx` gives: arrays of keys and instructions, each instruction with data and accounts. */
function isTx(tx: unknown): tx is SvmTx {
  if (!isObject(tx) || !Array.isArray(tx["keys"]) || !Array.isArray(tx["instructions"])) return false;
  const isIx = (ix: unknown) => isObject(ix) && ix["data"] instanceof Uint8Array && Array.isArray(ix["accounts"]);
  return tx["instructions"].every(isIx);
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (a === undefined || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Decoded extends SvmTx {
  requiredSignatures: number;
  /** How many addresses the message's lookups load: the writable indexes, then the read-only ones. */
  loads: { writable: number; readonly: number };
  /** The message's address table lookups, in order; none for a legacy message. */
  lookups: SvmLookup[];
}

/** One address table lookup of a v0 message: the table's address, and the indexes it loads, writable and read-only. */
export interface SvmLookup {
  table: string;
  writable: readonly number[];
  readonly: readonly number[];
}

/**
 * The addresses one address table lookup loads: the table's address, and the table's entries at the lookup's writable
 * and read-only indexes, in order, each a base58 key.
 */
export interface SvmTableLoad {
  address: string;
  writable: readonly string[];
  readonly: readonly string[];
}

class Cursor {
  at = 0;
  constructor(readonly b: Uint8Array) {}
  byte(): number {
    const v = this.b[this.at];
    if (v === undefined) throw RangeError();
    this.at++;
    return v;
  }
  bytes(n: number): Uint8Array {
    if (this.at + n > this.b.length) throw RangeError();
    const out = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  /** Solana's compact-u16, in its shortest form only. */
  compact(): number {
    let v = 0;
    for (let i = 0; i < 3; i++) {
      const c = this.byte();
      v |= (c & 0x7f) << (7 * i);
      if ((c & 0x80) === 0) {
        if (i > 0 && c === 0) throw RangeError();
        if (v > 0xffff) throw RangeError();
        return v;
      }
    }
    throw RangeError();
  }
}

/**
 * Decodes a legacy or v0 wire transaction of at most 1,232 bytes; a longer one is `svm/tx-too-large`. Bytes that are not
 * one well-formed transaction are `svm/tx-malformed`, as is a v0 message with an address table lookup that names no
 * index, which the runtime refuses ("each lookup table must be used to load at least one account"). Each byte field is
 * a copy, so none shares memory with `wire`.
 */
export function decodeSvmTx(wire: Uint8Array): SvmTx<ArrayBuffer> | Refusal {
  const d = decode(wire);
  if (isRefusal(d)) return d;
  return {
    signatures: d.signatures.map(copyOf),
    message: copyOf(d.message),
    keys: d.keys.map(copyOf),
    instructions: d.instructions.map((ix) => ({ program: ix.program, accounts: ix.accounts, data: copyOf(ix.data) })),
    blockhash: copyOf(d.blockhash),
  };
}

/** The bytes in a fresh `ArrayBuffer` of their own, copied by index (not by `b`'s iterator), whatever backs `b`. */
function copyOf(b: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(b);
}

/** `decodeSvmTx`, with the message's address table lookups in order (none for a legacy message). */
export function decodeWithLookups(wire: Uint8Array): { tx: SvmTx; lookups: readonly SvmLookup[] } | Refusal {
  const d = decode(wire);
  if (isRefusal(d)) return d;
  const { requiredSignatures: _, loads: __, lookups, ...tx } = d;
  return { tx, lookups };
}

function decode(wire: Uint8Array): Decoded | Refusal {
  if (!(wire instanceof Uint8Array) || wire.length === 0) return refusal("svm/tx-malformed");
  if (wire.length > MAX_WIRE) return refusal("svm/tx-too-large");
  try {
    const c = new Cursor(wire);
    const count = c.compact();
    const signatures: Uint8Array[] = [];
    for (let i = 0; i < count; i++) signatures.push(c.bytes(64));
    const start = c.at;
    const first = c.byte();
    let requiredSignatures: number;
    let versioned = false;
    if ((first & 0x80) !== 0) {
      if ((first & 0x7f) !== 0) return refusal("svm/tx-malformed");
      versioned = true;
      requiredSignatures = c.byte();
    } else {
      requiredSignatures = first;
    }
    const readonlySigned = c.byte();
    const readonlyUnsigned = c.byte();
    const nKeys = c.compact();
    const keys: Uint8Array[] = [];
    for (let i = 0; i < nKeys; i++) keys.push(c.bytes(32));
    if (requiredSignatures === 0 || requiredSignatures > nKeys || count !== requiredSignatures) {
      return refusal("svm/tx-malformed");
    }
    if (readonlySigned >= requiredSignatures || readonlyUnsigned > nKeys - requiredSignatures) {
      return refusal("svm/tx-malformed");
    }
    const blockhash = c.bytes(32);
    const nIx = c.compact();
    const instructions: SvmInstruction[] = [];
    for (let i = 0; i < nIx; i++) {
      const program = c.byte();
      const nAcc = c.compact();
      const indices = c.bytes(nAcc);
      const accounts = Array.from({ length: indices.length }, (_, j) => indices[j]!);
      const data = c.bytes(c.compact());
      instructions.push({ program, accounts, data });
    }
    const loads = { writable: 0, readonly: 0 };
    const lookups: SvmLookup[] = [];
    if (versioned) {
      const nLookups = c.compact();
      for (let i = 0; i < nLookups; i++) {
        const table = keyString(c.bytes(32));
        const w = c.bytes(c.compact());
        const writable = Array.from({ length: w.length }, (_, j) => w[j]!);
        const r = c.bytes(c.compact());
        const readonly = Array.from({ length: r.length }, (_, j) => r[j]!);
        // A v0 message's sanitize refuses a lookup that loads no account, "each lookup table must be used to load at
        // least one account" (anza-xyz/solana-sdk 648387ee, tag message@v3.0.0, `message/src/versions/v0/mod.rs:118-129`).
        if (writable.length + readonly.length === 0) return refusal("svm/tx-malformed");
        loads.writable += writable.length;
        loads.readonly += readonly.length;
        lookups.push({ table, writable, readonly });
      }
    }
    if (c.at !== wire.length) return refusal("svm/tx-malformed");
    return { signatures, message: wire.subarray(start), keys, instructions, blockhash, requiredSignatures, loads, lookups };
  } catch {
    return refusal("svm/tx-malformed");
  }
}

/**
 * The one top-level Memo instruction (v3 or v4) and the ATR hash its UTF-8 data carries in LCP string form. None, or
 * more than one, is `svm/memo-count`. The memo must be `toLcpString(h)` exactly, in lowercase hex; the same hash in
 * any other spelling is `svm/carrier-not-canonical`. A `tx` that is not a decoded transaction is `svm/tx-malformed`.
 */
export function svmCarrier(tx: SvmTx): { h: AtrHash; memo: string } | Refusal {
  if (!isTx(tx)) return refusal("svm/tx-malformed");
  const memos = memoData(tx);
  if (memos.length !== 1) return refusal("svm/memo-count");
  return memoCarrier(memos[0]!);
}

/** The data of each top-level Memo instruction (v3 or v4), in order. */
export function memoData(tx: SvmTx): Uint8Array[] {
  return tx.instructions
    .filter((ix) => {
      const program = tx.keys[ix.program];
      return sameBytes(program, MEMO_V3_BYTES) || sameBytes(program, MEMO_V4_BYTES);
    })
    .map((ix) => ix.data);
}

/** The ATR hash one Memo instruction's UTF-8 data carries in LCP string form, exactly `toLcpString(h)`. */
export function memoCarrier(data: Uint8Array): { h: AtrHash; memo: string } | Refusal {
  let memo: string;
  try {
    memo = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    return refusal("svm/memo-not-utf8");
  }
  const h = fromLcpString(memo);
  if (h === null) return refusal("svm/memo-not-lcp");
  return canonicalCarrier(h, memo);
}

/** The carrier when `memo` is `toLcpString(h)` exactly, else `svm/carrier-not-canonical`. */
export function canonicalCarrier(h: AtrHash, memo: string): { h: AtrHash; memo: string } | Refusal {
  return memo === toLcpString(h) ? { h, memo } : refusal("svm/carrier-not-canonical");
}

/**
 * SHA-256 over the message bytes every signer signed. Rejects with a TypeError when `tx` is not an object whose
 * `message` is a `Uint8Array`.
 */
export async function svmDigest(tx: SvmTx): Promise<Hex> {
  return hash(tx.message);
}

/** The base64 wire in a payment, decoded, or the refusal naming what is wrong with it. */
export function wireOf(b64: unknown): Uint8Array | Refusal {
  if (typeof b64 !== "string" || b64.length === 0) return refusal("svm/tx-malformed");
  if (b64.length > Math.ceil(MAX_WIRE / 3) * 4 + 4) return refusal("svm/tx-too-large");
  const bytes = fromBase64(b64);
  if (bytes === null) return refusal("svm/tx-malformed");
  if (bytes.length > MAX_WIRE) return refusal("svm/tx-too-large");
  return bytes;
}

/**
 * The read keys of a signed transaction: its message digest, the fee payer (static key 0), the fee payer's signature
 * as the transaction id when that slot is signed, and what bounds the message's life: the recent blockhash, or, for a
 * durable-nonce message, an empty `blockhash` and the `nonce` it uses. A message `staticNonce` refuses has no
 * reference.
 */
export async function svmReference(
  network: SolanaNetwork,
  tx: SvmTx,
): Promise<Omit<SvmRef, "fromSlot"> | Refusal> {
  const fromTable = staticNonce(tx);
  if (fromTable !== null) return fromTable;
  const digest = await svmDigest(tx);
  const feePayer = keyString(tx.keys[0]!);
  const nonce = durableNonce(tx);
  const signed = tx.signatures[0]!.some((x) => x !== 0);
  return {
    network,
    ...(signed ? { transaction: keyString(tx.signatures[0]!) } : {}),
    digest,
    feePayer,
    blockhash: nonce === null ? keyString(tx.blockhash) : "",
    ...(nonce === null ? {} : { nonce }),
  };
}

/** True when static key `i` is writable under the message header's signer and read-only counts. */
function isWritable(tx: SvmTx, i: number): boolean {
  const at = (tx.message[0]! & 0x80) !== 0 ? 1 : 0;
  const required = tx.message[at]!;
  const readonlySigned = tx.message[at + 1]!;
  const readonlyUnsigned = tx.message[at + 2]!;
  if (i >= tx.keys.length) return false;
  return i < required ? i < required - readonlySigned : i < tx.keys.length - readonlyUnsigned;
}

/**
 * The durable nonce a message uses, or null. A message uses one when its first instruction is the System program's
 * `AdvanceNonceAccount` (data `04000000`) naming the nonce accounts that instruction requires: the nonce account as a
 * writable static key, then the `RecentBlockhashes` sysvar, and the nonce authority as a signer of the message. A
 * sysvar named by a static key must be `RecentBlockhashes`; a sysvar named through an address lookup table, past the
 * static keys, is resolved by the runtime, which checks it when `AdvanceNonceAccount` runs. The nonce value is the
 * message's blockhash field.
 */
function durableNonce(tx: SvmTx): SvmNonce | null {
  const first = advanceNonce(tx);
  if (first === null) return null;
  const [account, sysvar] = first.accounts;
  if (account === undefined || sysvar === undefined || !isWritable(tx, account)) return null;
  if (sysvar < tx.keys.length && !sameBytes(tx.keys[sysvar], RECENT_BLOCKHASHES_BYTES)) return null;
  const required = tx.message[(tx.message[0]! & 0x80) !== 0 ? 1 : 0]!;
  if (!first.accounts.some((i) => i < required)) return null;
  return { account: keyString(tx.keys[account]!), value: keyString(tx.blockhash) };
}

/** The first instruction when it is the System program's `AdvanceNonceAccount` (data `04000000`), else null. */
function advanceNonce(tx: SvmTx): SvmInstruction | null {
  const first = tx.instructions[0];
  if (first === undefined || !sameBytes(tx.keys[first.program], SYSTEM_BYTES)) return null;
  const d = first.data;
  return d.length >= 4 && d[0] === 4 && d[1] === 0 && d[2] === 0 && d[3] === 0 ? first : null;
}

/**
 * `svm/nonce-account-not-static` when the message's first instruction is `AdvanceNonceAccount` and its nonce account
 * is an address lookup table entry, past the static keys: a durable message names its nonce account as a static key
 * (SIMD-0242), so the cluster does not take that message as durable, and the message alone cannot show the nonce
 * account a reference records. Else null.
 */
export function staticNonce(tx: SvmTx): Refusal | null {
  const first = advanceNonce(tx);
  if (first === null) return null;
  const account = first.accounts[0];
  return account !== undefined && account >= tx.keys.length ? refusal("svm/nonce-account-not-static") : null;
}

/**
 * The wire for a message and one signer's signature: the compact-u16 signature count, one 64-byte slot per required
 * signer in key order with `signature` in the signer's slot and zeros in every other, then the message. A message under
 * 2 bytes, too short to hold a v0 prefix and its signature count, is `svm/tx-malformed`.
 */
export function signedWire(message: Uint8Array, signer: string, signature: Uint8Array): Uint8Array | Refusal {
  if (!(signature instanceof Uint8Array) || signature.length !== 64) return refusal("svm/input-malformed");
  const signerKey = keyBytes(signer);
  if (signerKey === null) return refusal("svm/input-malformed");
  if (message.length < 2) return refusal("svm/tx-malformed");
  const required = (message[0]! & 0x80) !== 0 ? message[1]! : message[0]!;
  const withSlots = new Uint8Array(compactLength(required) + 64 * required + message.length);
  let at = writeCompact(withSlots, 0, required);
  const slotsAt = at;
  at += 64 * required;
  withSlots.set(message, at);
  const d = decode(withSlots);
  if (isRefusal(d)) return d;
  const slot = d.keys.slice(0, d.requiredSignatures).findIndex((k) => sameBytes(k, signerKey));
  if (slot === -1) return refusal("svm/input-malformed");
  withSlots.set(signature, slotsAt + 64 * slot);
  return withSlots;
}

function compactLength(v: number): number {
  return v < 0x80 ? 1 : v < 0x4000 ? 2 : 3;
}

function writeCompact(out: Uint8Array, at: number, v: number): number {
  let x = v;
  for (;;) {
    const c = x & 0x7f;
    x >>= 7;
    if (x === 0) {
      out[at++] = c;
      return at;
    }
    out[at++] = c | 0x80;
  }
}

// ── building ─────────────────────────────────────────────────────────────────────────────────────────────────────

const U64_LIMIT = 1n << 64n;

function u32le(v: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

function u64le(v: bigint): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** True when every field of a build input has its rail form. */
function isBuildInput(i: SvmBuildInput): boolean {
  return (
    typeof i === "object" &&
    i !== null &&
    isKey(i.feePayer) &&
    isKey(i.payer) &&
    isKey(i.mint) &&
    (i.tokenProgram === TOKEN || i.tokenProgram === TOKEN_2022) &&
    Number.isInteger(i.decimals) &&
    i.decimals >= 0 &&
    i.decimals <= 255 &&
    isKey(i.payTo) &&
    typeof i.amount === "bigint" &&
    i.amount >= 0n &&
    i.amount < U64_LIMIT &&
    isKey(i.recentBlockhash) &&
    typeof i.memo === "string" &&
    i.memo.isWellFormed() &&
    Number.isInteger(i.computeUnitLimit) &&
    i.computeUnitLimit >= 0 &&
    i.computeUnitLimit <= 0xffffffff &&
    typeof i.computeUnitPrice === "bigint" &&
    i.computeUnitPrice >= 0n &&
    i.computeUnitPrice < U64_LIMIT
  );
}

/**
 * The versioned (v0) message bytes for a token payment: `SetComputeUnitLimit`, `SetComputeUnitPrice`,
 * `TransferChecked` from the payer's associated token account to the payee's, then one v3 Memo instruction whose data
 * is the memo's UTF-8 bytes. No lookup tables. A memo that is not a well-formed string (one holding a lone surrogate
 * has no UTF-8 form) is `svm/input-malformed`, with nothing built.
 */
export async function buildSvmMessage(i: SvmBuildInput): Promise<Uint8Array<ArrayBuffer> | Refusal> {
  if (!isBuildInput(i)) return refusal("svm/input-malformed");
  const memo = new TextEncoder().encode(i.memo);
  let kit: Kit;
  try {
    kit = await import("@solana/kit");
  } catch {
    return refusal("svm/peer-missing");
  }
  const { AccountRole, address } = kit;
  const [source] = await kit.getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [base58.decode(i.payer), base58.decode(i.tokenProgram), base58.decode(i.mint)],
  });
  const [destination] = await kit.getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [base58.decode(i.payTo), base58.decode(i.tokenProgram), base58.decode(i.mint)],
  });
  const instructions = [
    { programAddress: address(COMPUTE_BUDGET), data: concat(Uint8Array.of(2), u32le(i.computeUnitLimit)) },
    { programAddress: address(COMPUTE_BUDGET), data: concat(Uint8Array.of(3), u64le(i.computeUnitPrice)) },
    {
      programAddress: address(i.tokenProgram),
      accounts: [
        { address: source, role: AccountRole.WRITABLE },
        { address: address(i.mint), role: AccountRole.READONLY },
        { address: destination, role: AccountRole.WRITABLE },
        { address: address(i.payer), role: AccountRole.READONLY_SIGNER },
      ],
      data: concat(Uint8Array.of(0x0c), u64le(i.amount), Uint8Array.of(i.decimals)),
    },
    { programAddress: address(MEMO_V3), data: memo },
  ];
  return compileV0(i.feePayer, i.recentBlockhash, instructions);
}

type Kit = typeof import("@solana/kit");

/** One instruction to compile: its program, its accounts with their `AccountRole` numbers, and its data. */
export interface KitInstruction {
  readonly programAddress: string;
  readonly accounts?: readonly { readonly address: string; readonly role: number }[];
  readonly data?: Uint8Array;
}

/** Compiles instructions into v0 message bytes with the given fee payer and blockhash. */
export async function compileV0(
  feePayer: string,
  recentBlockhash: string,
  instructions: readonly KitInstruction[],
): Promise<Uint8Array<ArrayBuffer> | Refusal> {
  let kit: Kit;
  try {
    kit = await import("@solana/kit");
  } catch {
    return refusal("svm/peer-missing");
  }
  const compiled = instructions as unknown as readonly Parameters<Kit["appendTransactionMessageInstructions"]>[0][number][];
  try {
    const message = kit.pipe(
      kit.createTransactionMessage({ version: 0 }),
      (m) => kit.setTransactionMessageFeePayer(kit.address(feePayer), m),
      (m) =>
        kit.setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: kit.blockhash(recentBlockhash), lastValidBlockHeight: 0n },
          m,
        ),
      (m) => kit.appendTransactionMessageInstructions(compiled, m),
    );
    const bytes = kit.getCompiledTransactionMessageEncoder().encode(kit.compileTransactionMessage(message));
    return new Uint8Array(bytes);
  } catch {
    return refusal("svm/input-malformed");
  }
}

/** A signing request for message bytes, whose signature by `signer` makes the wire. */
export function svmSigning(message: Uint8Array<ArrayBuffer>, signer: string): SvmSigning {
  return {
    request: { kind: "solana-message", message },
    wire: (signature) => signedWire(message, signer, signature),
  };
}

// ── address lookup tables ────────────────────────────────────────────────────────────────────────────────────────

/** The address lookup table program id, which owns every address lookup table account. */
const ADDRESS_LOOKUP_TABLE = "AddressLookupTab1e1111111111111111111111111";
/** The table account's header: `ProgramState::LookupTable` and its metadata, as bincode writes them, in 56 bytes. */
const TABLE_META = 56;
/** The deactivation slot of a table that has not been deactivated: `Slot::MAX`. */
const NOT_DEACTIVATED = 0xffff_ffff_ffff_ffffn;

/**
 * An account read's answer in its documented shape (`SvmReader.account`): a bigint context slot, and no account, or an
 * owner string and data bytes. Any other answer is `svm/unreadable`, a read to repeat.
 */
function accountRead(read: unknown): { slot: bigint; value: { owner: string; data: Uint8Array } | null } | Refusal {
  if (!isObject(read) || typeof read["slot"] !== "bigint" || !("value" in read)) return refusal("svm/unreadable");
  const value = read["value"];
  if (value === null) return { slot: read["slot"], value: null };
  if (!isObject(value) || typeof value["owner"] !== "string" || !(value["data"] instanceof Uint8Array)) {
    return refusal("svm/unreadable");
  }
  return { slot: read["slot"], value: { owner: value["owner"], data: value["data"] } };
}

/**
 * An address lookup table account, read as the runtime reads one when it loads a version-0 message's addresses
 * (anza-xyz/agave f516a892, tag v3.0.14, `accounts-db/src/accounts.rs:105-162`, with `AddressLookupTable` from
 * solana-address-lookup-table-interface 3.0.0, anza-xyz/solana-sdk 3d8dc1f3,
 * `address-lookup-table-interface/src/state.rs`): an owner other than the program is `InvalidAccountOwner`
 * (`accounts.rs:118`, `:159-160`), and data that does not deserialize as an initialized table is `InvalidAccountData`
 * (`accounts.rs:120-121`; `state.rs:225-252`): a u32 `ProgramState` of 1 (0 is an uninitialized account,
 * `state.rs:121-131`), then a u64 deactivation slot, a u64 last-extended slot, a u8 start index, an `Option` of the
 * 32-byte authority (tag 0 or 1) and u16 padding (`state.rs:42-63`), the header taking 56 bytes (`state.rs:31-32`), and
 * then the entries, 32 bytes each. Each of those is `svm/table-unusable`, but for an account the System program owns
 * with no data: the program creates a table at an address the System program holds lamports for, topping up its rent
 * and then allocating and assigning it (solana-program/address-lookup-table ac994f09, tag program@v3.0.0,
 * `program/src/processor.rs:185-211`), so that account is no table yet, `svm/not-found`, as is an answer naming no
 * account. A table whose deactivation slot is set is `svm/table-unusable` too, because the opening may land after the
 * table stops resolving: the runtime loads from it only until that slot leaves the `SlotHashes` sysvar, which holds
 * the slots of the last 512 blocks (`LookupTableAccountNotFound` after that, `state.rs:15-26`, `:85-118` and
 * `:157-180`), no instruction makes it active again (`instruction.rs:12-67`), and a durable nonce keeps an opening
 * valid with no expiry. An answer of neither documented shape is `svm/unreadable`.
 */
function tableOf(read: unknown): { entries: Uint8Array[]; frozen: boolean } | Refusal {
  const account = accountRead(read);
  if (isRefusal(account)) return account;
  const { value } = account;
  if (value === null || (value.owner === SYSTEM && value.data.length === 0)) return refusal("svm/not-found");
  if (value.owner !== ADDRESS_LOOKUP_TABLE) return refusal("svm/table-unusable");
  const data = value.data;
  if (data.length < TABLE_META || (data.length - TABLE_META) % 32 !== 0) return refusal("svm/table-unusable");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const authority = data[21];
  if (view.getUint32(0, true) !== 1 || (authority !== 0 && authority !== 1)) return refusal("svm/table-unusable");
  if (view.getBigUint64(4, true) !== NOT_DEACTIVATED) return refusal("svm/table-unusable");
  const entries: Uint8Array[] = [];
  for (let at = TABLE_META; at < data.length; at += 32) entries.push(data.subarray(at, at + 32));
  return { entries, frozen: authority === 0 };
}

/**
 * The addresses each of a message's address table lookups loads, in the message's order: each table account read
 * once through `reader.account` (`getAccountInfo` at `finalized`), one call per distinct table, and read as `tableOf`
 * reads it. An index past the table's entries is `InvalidLookupIndex` to the runtime (`state.rs:196-212`;
 * `accounts.rs:145-156`): it is `svm/table-unusable` when the table has no authority, since a table without one is
 * frozen and takes no new entry (`instruction.rs:33-50`; the authority signs each change, `state.rs:57`), and
 * `svm/not-found`, a read to repeat, when its authority can still extend it in a block that is not finalized. A
 * loaded address that repeats one of `staticKeys` or another loaded address is `svm/table-unusable`, as `loadedKeys`
 * reads it. A rejected read is `svm/unreadable`. Every table is read before the answer: a `svm/table-unusable` in any
 * lookup, which no later read changes, comes before a read to repeat in another, and otherwise the first read to
 * repeat, in the lookups' order, is the answer.
 *
 * A read at `finalized` fixes what each index names. The program only appends entries (`ExtendLookupTable`,
 * `instruction.rs:40-50`; no instruction rewrites one, `instruction.rs:12-67`); a table is closed only once deactivated
 * (`state.rs:47-49`); and a closed table's address, derived from its authority and a recent slot, can never hold a
 * table again (`instruction.rs:21-26`, `state.rs:108-111`). So an entry that a block at `finalized` holds is the entry
 * the runtime loads at that index in every later block for as long as the table is active, while an entry written in a
 * block that is not finalized can differ on another fork.
 */
export async function readLookupTables(
  reader: SvmReader,
  staticKeys: readonly Uint8Array[],
  lookups: readonly SvmLookup[],
): Promise<SvmTableLoad[] | Refusal> {
  const tables = new Map<string, { entries: Uint8Array[]; frozen: boolean } | Refusal>();
  for (const { table } of lookups) {
    if (tables.has(table)) continue;
    let read: unknown;
    try {
      read = await reader.account(table);
    } catch {
      tables.set(table, refusal("svm/unreadable"));
      continue;
    }
    tables.set(table, tableOf(read));
  }
  const answers = lookups.map(({ table, writable, readonly }): SvmTableLoad | Refusal => {
    const t = tables.get(table)!;
    if (isRefusal(t)) return t;
    if ([...writable, ...readonly].some((i) => i >= t.entries.length)) {
      return t.frozen ? refusal("svm/table-unusable") : refusal("svm/not-found");
    }
    const at = (i: number) => keyString(t.entries[i]!);
    return { address: table, writable: writable.map(at), readonly: readonly.map(at) };
  });
  const loads = answers.filter((a): a is SvmTableLoad => !isRefusal(a));
  const seen = new Set(staticKeys.map(keyString));
  let repeated = false;
  for (const key of [...loads.flatMap((l) => l.writable), ...loads.flatMap((l) => l.readonly)]) {
    if (seen.has(key)) repeated = true;
    seen.add(key);
  }
  const refused = answers.filter((a): a is Refusal => isRefusal(a));
  if (repeated || refused.some((r) => r.code === "svm/table-unusable")) return refusal("svm/table-unusable");
  return refused[0] ?? loads;
}

/**
 * Every key a message's instructions may index once its address table lookups are resolved, in the runtime's order:
 * the static keys, then each lookup's writable entries, then each lookup's read-only entries, as `decodeLanded` reads a
 * landed transaction's (`runtime/src/bank/address_lookup_table.rs:41-68` appends lookup by lookup, writable to writable
 * and read-only to read-only, `accounts.rs:145-156`). `loads` must hold, for each lookup in order, its table's address
 * and as many base58 keys as the lookup names writable and read-only indexes, as `readLookupTables` writes them; any
 * other value is `svm/read-first`. A loaded key that repeats a static key or another loaded key is
 * `svm/table-unusable`: the runtime refuses a transaction that loads one account twice (`AccountLoadedTwice`, from
 * `validate_account_locks` over the static keys and the resolved addresses; `accounts-db/src/account_locks.rs:160-170`,
 * `accounts-db/src/accounts.rs:510`, `transaction-view/src/resolved_transaction_view.rs:194-198`).
 */
export function loadedKeys(tx: SvmTx, lookups: readonly SvmLookup[], loads: unknown): Uint8Array[] | Refusal {
  if (!Array.isArray(loads) || loads.length !== lookups.length) return refusal("svm/read-first");
  const writable: Uint8Array[] = [];
  const readonly: Uint8Array[] = [];
  for (const [i, lookup] of lookups.entries()) {
    const load: unknown = loads[i];
    if (!isObject(load) || load["address"] !== lookup.table) return refusal("svm/read-first");
    const w = keyList(load["writable"], lookup.writable.length);
    const r = keyList(load["readonly"], lookup.readonly.length);
    if (w === null || r === null) return refusal("svm/read-first");
    writable.push(...w);
    readonly.push(...r);
  }
  const seen = new Set(tx.keys.map(keyString));
  for (const key of [...writable, ...readonly]) {
    const k = keyString(key);
    if (seen.has(k)) return refusal("svm/table-unusable");
    seen.add(k);
  }
  return [...tx.keys, ...writable, ...readonly];
}

/** The 32-byte keys of an array of exactly `n` base58 keys, else null. */
function keyList(v: unknown, n: number): Uint8Array[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const keys = v.map(keyBytes);
  return keys.every((k) => k !== null) ? (keys as Uint8Array[]) : null;
}

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A named transaction's lookup: landed at a commitment, or not found, with the slot the last lookup names. */
type Lookup = { landed: SvmLanded; commitment: "confirmed" | "finalized" } | { notFound: true; slot: bigint | null };

/**
 * Reads a named transaction at `finalized`, then `confirmed`: the first landed answer, or, when every lookup finds
 * nothing, `notFound` with the slot the last lookup names. Undefined when a read failed or gave an answer of neither
 * documented shape.
 */
export async function landedAt(
  reader: SvmReader,
  transaction: string,
  commitments: readonly ("finalized" | "confirmed")[] = ["finalized", "confirmed"],
): Promise<Lookup | undefined> {
  let slot: bigint | null = null;
  try {
    for (const commitment of commitments) {
      const answer: unknown = await reader.transaction(transaction, commitment);
      const readTo = notFoundPoint(answer, "slot");
      if (readTo !== undefined) {
        slot = readTo;
        continue;
      }
      if (!isLanded(answer)) return undefined;
      return { landed: answer, commitment };
    }
    return { notFound: true, slot };
  } catch {
    return undefined;
  }
}

function isLanded(v: unknown): v is SvmLanded {
  if (typeof v !== "object" || v === null) return false;
  const l = v as SvmLanded;
  return (
    l.wire instanceof Uint8Array &&
    "err" in l &&
    typeof l.loaded === "object" &&
    l.loaded !== null &&
    Array.isArray(l.loaded.writable) &&
    Array.isArray(l.loaded.readonly) &&
    Array.isArray(l.inner) &&
    l.inner.every((x) => Number.isInteger(x?.program) && x.data instanceof Uint8Array)
  );
}

/**
 * A landed transaction's wire, decoded, with every key its instructions may index, in the runtime's order: the static
 * keys, then the addresses its address lookup tables loaded, writable, then read-only, as `loaded` lists them
 * (`getTransaction`'s `meta.loadedAddresses`). A table can supply any account but a signer or a top-level instruction's
 * program, so this is how a read finds such an account without reading the table. Null when the wire does not decode,
 * when `loaded` does not hold 32-byte keys in exactly the numbers the message's lookups name, or when a loaded key
 * repeats a static key or another loaded key: the runtime refuses a transaction that loads one account twice
 * (`AccountLoadedTwice`, from `validate_account_locks` over the static keys and the resolved addresses; anza-xyz/agave
 * f516a892, tag v3.0.14, `accounts-db/src/account_locks.rs:160-170`, `accounts-db/src/accounts.rs:510` and
 * `transaction-view/src/resolved_transaction_view.rs:194-198`), so that answer is out of its documented form.
 */
export function decodeLanded(landed: SvmLanded): { tx: SvmTx; keys: readonly Uint8Array[] } | null {
  const d = decode(landed.wire);
  if (isRefusal(d)) return null;
  const { writable, readonly } = landed.loaded;
  const isKeyList = (list: readonly unknown[], n: number) =>
    list.length === n && list.every((k) => k instanceof Uint8Array && k.length === 32);
  if (!isKeyList(writable, d.loads.writable) || !isKeyList(readonly, d.loads.readonly)) return null;
  const { requiredSignatures: _, loads: __, lookups: ___, ...tx } = d;
  const seen = new Set(tx.keys.map(keyString));
  for (const key of [...writable, ...readonly]) {
    const k = keyString(key);
    if (seen.has(k)) return null;
    seen.add(k);
  }
  return { tx, keys: [...tx.keys, ...writable, ...readonly] };
}

/** True when a top-level or inner instruction is a token `TransferChecked` or a System `transfer`. */
function movesValue(tx: SvmTx, landed: SvmLanded, keys: readonly Uint8Array[]): boolean {
  const all = [...tx.instructions, ...landed.inner];
  return all.some(({ program, data }) => {
    const key = keys[program];
    if ((sameBytes(key, TOKEN_BYTES) || sameBytes(key, TOKEN_2022_BYTES)) && data[0] === 0x0c) return true;
    return sameBytes(key, SYSTEM_BYTES) && data.length >= 4 && data[0] === 2 && data[1] === 0 && data[2] === 0 && data[3] === 0;
  });
}

/**
 * Reads a named transaction's settlement. It must be the message the payer signed (by digest), must have executed
 * without error, and must carry a token or SOL transfer, a top-level or an inner instruction, whose program is read
 * from the static keys or from the addresses the transaction's lookup tables loaded. A message the payer did not sign
 * is failed `not-this-instrument` from a read at either commitment, since the signature fixes the message. An error, or
 * no transfer, rests on how the transaction executed, so it is failed (`err`, `no-transfer`) only from the read at
 * `finalized`, and pending `not-final` from the read at `confirmed`. A failed read, an answer of neither documented
 * shape (a landed wire that does not decode, `loaded` addresses other than 32-byte keys in the numbers the message's
 * lookups name, or a loaded address that repeats a static key or another loaded address, included), or a reader for
 * another network is pending `unreadable`. A ref whose `digest` is not a string is pending `unreadable`, with nothing
 * read. A durable-nonce transaction that is not found, once `svmNonceMoved` names a slot and the node's first available
 * block is at or before `fromSlot`, is read once more at `finalized`; when that lookup, naming a slot at or past the
 * context slot of the nonce account read, finds nothing, it is failed `nonce-moved`: the message can never land. A
 * lookup from a node behind that read, or naming no slot, is pending `not-found`. At most two calls, or five for a
 * durable-nonce reference.
 */
export async function svmStatus(ref: SvmRef & { transaction: string }, reader: SvmReader): Promise<SvmStatus> {
  return settledBy(ref, reader, { execution: (tx, landed, keys) => (movesValue(tx, landed, keys) ? null : "no-transfer") });
}

/**
 * The shared settlement read: the digest, then the pairing's check of the signed message (`message`), then `err`, then
 * its check of how the transaction executed (`execution`, given every key the instructions may index, as `decodeLanded`
 * reads them); each check names a failure or returns null. A landed answer `decodeLanded` cannot read is pending
 * `unreadable`. A failure on the signed message, the digest's `not-this-instrument` included, is final from a read at
 * either commitment: the signature fixes the message, so every landing of it carries the same instructions. A failure
 * on execution is failed only from the read at `finalized`, and pending `not-final` from the read at `confirmed`, since
 * a block that is not finalized can be replaced and the transaction can land in another block and execute otherwise. A
 * durable-nonce transaction that is not found is failed `nonce-moved` once its nonce has moved on and a last read at
 * `finalized`, naming a slot at or past the context slot of the nonce account read, still finds nothing.
 */
export async function settledBy<W extends string>(
  ref: SvmRef & { transaction: string },
  reader: SvmReader,
  check: {
    message?: (tx: SvmTx) => W | null;
    execution?: (tx: SvmTx, landed: SvmLanded, keys: readonly Uint8Array[]) => W | null;
  },
): Promise<
  | { state: "settled"; commitment: "confirmed" | "finalized" }
  | { state: "pending"; why: "not-found" | "unreadable" | "not-final" }
  | { state: "failed"; why: "err" | "not-this-instrument" | "nonce-moved" | W }
> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network || typeof ref.digest !== "string") {
    return { state: "pending", why: "unreadable" };
  }
  let read = await landedAt(reader, ref.transaction);
  if (read === undefined) return { state: "pending", why: "unreadable" };
  if ("notFound" in read && ref.nonce !== undefined) {
    const movedAt = await nonceLapsed(ref, reader);
    if (isRefusal(movedAt)) return { state: "pending", why: "unreadable" };
    if (movedAt !== null) {
      read = await landedAt(reader, ref.transaction, ["finalized"]);
      if (read === undefined) return { state: "pending", why: "unreadable" };
      const covered = "notFound" in read && read.slot !== null && read.slot >= movedAt;
      if (covered) return { state: "failed", why: "nonce-moved" };
    }
  }
  if ("notFound" in read) return { state: "pending", why: "not-found" };
  const decoded = decodeLanded(read.landed);
  if (decoded === null) return { state: "pending", why: "unreadable" };
  const { tx, keys } = decoded;
  if ((await svmDigest(tx)) !== ref.digest.toLowerCase()) return { state: "failed", why: "not-this-instrument" };
  const signed = check.message?.(tx) ?? null;
  if (signed !== null) return { state: "failed", why: signed };
  const executed =
    read.landed.err !== null && read.landed.err !== undefined ? "err" : (check.execution?.(tx, read.landed, keys) ?? null);
  if (executed === null) return { state: "settled", commitment: read.commitment };
  return read.commitment === "finalized" ? { state: "failed", why: executed } : { state: "pending", why: "not-final" };
}

/**
 * The context slot of the nonce account read when that read shows the durable nonce `ref.nonce` records is spent or
 * gone; null when it does not show that; and `svm/unreadable`, a read to repeat, when the read is rejected or answers
 * neither documented shape, as every read of `SvmReader.account` takes it. The read is at `finalized`, and shows it at
 * a context slot at least 150 slots past `fromSlot` when it finds no account, an account the System program does not
 * own, an account that is not an initialized nonce account, or an initialized current-version nonce account holding
 * another value. A legacy-version nonce account and a read too early are null. A reference without `nonce` or with a
 * `fromSlot` that is not a slot, a ref or reader that is not an object, and a reader for another network are null, with
 * nothing read. One call.
 *
 * The message then can never land, and the transaction that used the nonce, when it landed, is final by that read. A
 * lookup shows a transaction absent only up to the slot its node had reached, so a lookup of the named transaction that
 * finds nothing shows the message never landed only from a node at or past that read's context slot, as `svmStatus`
 * reads it. With no transaction named, a `svmLocate` given this slot as `minContextSlot`, and complete with nothing
 * found, shows the message never landed.
 */
export async function svmNonceMoved(ref: SvmRef, reader: SvmReader): Promise<bigint | null | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return null;
  const nonce: unknown = ref.nonce;
  if (typeof nonce !== "object" || nonce === null) return null;
  const { account, value } = nonce as SvmNonce;
  if (!isKey(account) || !isKey(value)) return null;
  if (typeof ref.fromSlot !== "string" || !SLOT.test(ref.fromSlot)) return null;
  let answer: unknown;
  try {
    answer = await reader.account(account);
  } catch {
    return refusal("svm/unreadable");
  }
  const read = accountRead(answer);
  if (isRefusal(read)) return read;
  if (read.slot < BigInt(ref.fromSlot) + NONCE_SETTLED_SLOTS) return null;
  if (read.value === null) return read.slot;
  const { owner, data } = read.value;
  if (owner !== SYSTEM || data.length !== NONCE_ACCOUNT_BYTES) return read.slot;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(0, true);
  const state = view.getUint32(4, true);
  if (state !== 1) return read.slot;
  if (version === 0) return null;
  if (version !== 1) return read.slot;
  return keyString(data.subarray(40, 72)) !== value ? read.slot : null;
}

/**
 * `svmNonceMoved`'s slot when it names one and the node holds every block from `fromSlot`, else null; `svm/unreadable`
 * when the nonce account read or the first-available-block read is rejected or answers out of its documented shape.
 */
async function nonceLapsed(ref: SvmRef, reader: SvmReader): Promise<bigint | null | Refusal> {
  const movedAt = await svmNonceMoved(ref, reader);
  if (movedAt === null || isRefusal(movedAt)) return movedAt;
  let first: unknown;
  try {
    first = await reader.firstAvailableBlock();
  } catch {
    return refusal("svm/unreadable");
  }
  if (typeof first !== "bigint") return refusal("svm/unreadable");
  return first <= BigInt(ref.fromSlot) ? movedAt : null;
}

/**
 * Finds the instrument when no transaction was named: pages the fee payer's signatures, newest first, down to
 * `fromSlot`, at most 10 pages of 1,000. A signature is a candidate only when its memo carries `h` in LCP string form,
 * matched without regard to case. With `channel` in the reference, it pages that account's signatures instead, and
 * every signature is a candidate. Each candidate is read through `status`, the pairing's own (`svmStatus` when none
 * is given), at most 50 per pass.
 * `complete` is true only when the node's first available block is at or before `fromSlot`, the pages reached
 * `fromSlot` within those bounds, and every candidate was read: a listed candidate whose transaction reads pending
 * leaves the search incomplete. A ref or reader that is not an object, or a reader for another network, is `complete`
 * false, with nothing read.
 *
 * `minContextSlot` places the search no earlier than a read the caller made first, such as the nonce account read whose
 * context slot `svmNonceMoved` gives, or the `blockhashValid` read's `slot`: every page names it, so a node that has not
 * reached that slot fails the call and the search is `complete` false. A `minContextSlot` that is not a u64 bigint is
 * `complete` false, with nothing read.
 */
export async function svmLocate(
  ref: SvmRef,
  reader: SvmReader,
  h: AtrHash,
  status: (ref: SvmRef & { transaction: string }, reader: SvmReader) => Promise<{ state: string; why?: string }> = svmStatus,
  minContextSlot?: bigint,
): Promise<{ found?: string; complete: boolean }> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return { complete: false };
  if (typeof ref.fromSlot !== "string" || !SLOT.test(ref.fromSlot)) return { complete: false };
  if (minContextSlot !== undefined && !isU64(minContextSlot)) return { complete: false };
  if (ref.channel !== undefined && !isKey(ref.channel)) return { complete: false };
  const address = ref.channel ?? ref.feePayer;
  let carrier: string;
  try {
    carrier = toLcpString(h);
  } catch {
    return { complete: false };
  }
  const fromSlot = BigInt(ref.fromSlot);
  let first: bigint;
  try {
    first = await reader.firstAvailableBlock();
  } catch {
    return { complete: false };
  }
  if (typeof first !== "bigint" || first > fromSlot) return { complete: false };
  let before: string | undefined;
  let candidates = 0;
  for (let page = 0; page < MAX_LOCATE_PAGES; page++) {
    let list: readonly { signature: string; slot: bigint; memo: string | null }[];
    try {
      list = await reader.signatures(address, {
        ...(before === undefined ? {} : { before }),
        limit: LOCATE_PAGE,
        ...(minContextSlot === undefined ? {} : { minContextSlot }),
      });
    } catch {
      return { complete: false };
    }
    if (!Array.isArray(list) || list.length > LOCATE_PAGE) return { complete: false };
    for (const entry of list) {
      if (typeof entry?.signature !== "string" || typeof entry.slot !== "bigint") return { complete: false };
      if (entry.memo !== null && typeof entry.memo !== "string") return { complete: false };
      if (entry.slot < fromSlot) return { complete: true };
      if (ref.channel === undefined && (entry.memo === null || !entry.memo.toLowerCase().includes(carrier))) continue;
      if (++candidates > MAX_CANDIDATES) return { complete: false };
      const s = await status({ ...ref, transaction: entry.signature }, reader);
      if (s.state === "settled") return { found: entry.signature, complete: true };
      if (s.state === "pending") return { complete: false };
    }
    if (list.length < LOCATE_PAGE) return { complete: true };
    before = list[list.length - 1]!.signature;
  }
  return { complete: false };
}

/**
 * Zero-party recovery: the ATR hash in the landed transaction's one memo. A transaction that landed with an error is
 * `svm/err` when the read at `finalized` holds it, and `svm/not-final` when only the read at `confirmed` holds it, since
 * a block that is not finalized can be replaced. A landed wire that does not decode is `svm/unreadable`. A ref whose
 * `transaction` is not a signature, base58 of 64 bytes, is `svm/wrong-reader`, with nothing read. One or two calls.
 */
export async function svmRecover(
  ref: { network: SolanaNetwork; transaction: string },
  reader: SvmReader,
): Promise<AtrHash | Refusal> {
  const tx = await landedTransaction(ref, reader);
  if (isRefusal(tx)) return tx;
  const c = svmCarrier(tx);
  return isRefusal(c) ? c : c.h;
}

/**
 * The named transaction, landed without error and decoded, read at `finalized`, then `confirmed`. An error the read at
 * `finalized` holds is `svm/err`; one only the read at `confirmed` holds is `svm/not-final`. A landed wire that does not
 * decode is `svm/unreadable`: a transaction the chain executed is a well-formed one within Solana's packet size, the
 * bound the decoder holds a wire to, so such a wire is the reader's answer out of its documented form. One or two calls.
 */
export async function landedTransaction(
  ref: { network: SolanaNetwork; transaction: string },
  reader: SvmReader,
): Promise<SvmTx | Refusal> {
  if (!isObject(ref) || !isObject(reader) || reader.network !== ref.network) return refusal("svm/wrong-reader");
  if (!isSignature(ref.transaction)) return refusal("svm/wrong-reader");
  const read = await landedAt(reader, ref.transaction);
  if (read === undefined) return refusal("svm/unreadable");
  if ("notFound" in read) return refusal("svm/not-found");
  if (read.landed.err !== null && read.landed.err !== undefined) {
    return read.commitment === "finalized" ? refusal("svm/err") : refusal("svm/not-final");
  }
  const tx = decodeSvmTx(read.landed.wire);
  return isRefusal(tx) ? refusal("svm/unreadable") : tx;
}

// ── the payment-channels program ─────────────────────────────────────────────────────────────────────────────────

/** The payment-channels program id. */
export const PAYMENT_CHANNELS = "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
/** The Rent sysvar id. */
export const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111";

const PAYMENT_CHANNELS_BYTES = base58.decode(PAYMENT_CHANNELS);
const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const MAX_SEEDS = 16;
const MAX_SEED = 32;

/**
 * The program-derived address of `seeds` under `program`: for bumps 255 down to 0, the first
 * SHA-256(seeds ‖ bump ‖ program ‖ "ProgramDerivedAddress") that does not decompress to an Ed25519 point.
 */
export function findPda(seeds: readonly Uint8Array[], program: string): { address: string; bump: number } | Refusal {
  const programBytes = keyBytes(program);
  if (programBytes === null || seeds.length > MAX_SEEDS || seeds.some((s) => !(s instanceof Uint8Array) || s.length > MAX_SEED)) {
    return refusal("svm/pda-not-found");
  }
  for (let bump = 255; bump >= 0; bump--) {
    const candidate = sha256(concat(...seeds, Uint8Array.of(bump), programBytes, PDA_MARKER));
    if (!isPoint(candidate)) return { address: keyString(candidate), bump };
  }
  return refusal("svm/pda-not-found");
}

function isPoint(b: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(b, true);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when `s` is a base58 public key whose 32 bytes are a point on the Ed25519 curve, by the rule `findPda` applies to
 * a candidate: a key that can sign, which a program-derived address is not.
 */
export function isCurveKey(s: unknown): s is string {
  const b = keyBytes(s);
  return b !== null && isPoint(b);
}

/** The channel PDA: seeds "channel", payer, payee, mint, signer, u64le(salt), u64le(openSlot). */
export function channelPda(a: {
  payer: string;
  payee: string;
  mint: string;
  signer: string;
  salt: bigint;
  openSlot: bigint;
}): string | Refusal {
  if (!isObject(a)) return refusal("svm/input-malformed");
  const keys = [a.payer, a.payee, a.mint, a.signer].map(keyBytes);
  if (keys.some((k) => k === null) || !isU64(a.salt) || !isU64(a.openSlot)) return refusal("svm/input-malformed");
  const pda = findPda(
    [new TextEncoder().encode("channel"), ...(keys as Uint8Array[]), u64le(a.salt), u64le(a.openSlot)],
    PAYMENT_CHANNELS,
  );
  return isRefusal(pda) ? pda : pda.address;
}

function isU64(v: unknown): v is bigint {
  return typeof v === "bigint" && v >= 0n && v < U64_LIMIT;
}

/**
 * The `open` instruction's data: `01` ‖ salt u64 ‖ deposit u64 ‖ gracePeriod u32 ‖ openSlot u64 ‖ one recipient
 * (`01000000` ‖ recipient ‖ bps 10 000 as u16), little-endian. 67 bytes. Throws TypeError on a value out of range.
 */
export function openInstructionData(a: {
  salt: bigint;
  deposit: bigint;
  gracePeriod: number;
  openSlot: bigint;
  recipient: string;
}): Uint8Array<ArrayBuffer> {
  const recipient = keyBytes(a.recipient);
  if (
    recipient === null ||
    !isU64(a.salt) ||
    !isU64(a.deposit) ||
    !isU64(a.openSlot) ||
    !Number.isInteger(a.gracePeriod) ||
    a.gracePeriod < 0 ||
    a.gracePeriod > 0xffffffff
  ) {
    throw new TypeError("open instruction value out of range");
  }
  return concat(
    Uint8Array.of(1),
    u64le(a.salt),
    u64le(a.deposit),
    u32le(a.gracePeriod),
    u64le(a.openSlot),
    u32le(1),
    recipient,
    Uint8Array.of(0x10, 0x27),
  );
}

/**
 * The 50 bytes a channel voucher signs: `56 01` ‖ channelId ‖ cumulative u64 LE ‖ expiresAt i64 LE. Throws TypeError
 * when the channel id is not a base58 key or a number is out of range.
 */
export function channelVoucherMessage(
  channelId: string,
  cumulative: bigint,
  expiresAt: bigint,
): Uint8Array<ArrayBuffer> {
  const id = keyBytes(channelId);
  if (id === null || !isU64(cumulative) || typeof expiresAt !== "bigint" || BigInt.asIntN(64, expiresAt) !== expiresAt) {
    throw new TypeError("voucher value out of range");
  }
  const tail = new Uint8Array(8);
  new DataView(tail.buffer).setBigInt64(0, expiresAt, true);
  return concat(Uint8Array.of(0x56, 0x01), id, u64le(cumulative), tail);
}

export interface ChannelIx {
  kind: "open" | "top_up" | "request_close";
  channel: string;
  /** A copy of the instruction's data. */
  data: Uint8Array<ArrayBuffer>;
}

/** Each channel instruction: its discriminator, its account count, and the position of the `channel` account. */
const CHANNEL_KINDS: { readonly [d: number]: readonly [ChannelIx["kind"], number, number] } = {
  1: ["open", 14, 5],
  3: ["top_up", 6, 1],
  5: ["request_close", 2, 1],
};

/**
 * The transaction's one top-level payment-channels instruction, by its discriminator. A `tx` that is not a decoded
 * transaction is `svm/tx-malformed`.
 */
export function channelInstruction(tx: SvmTx): ChannelIx | Refusal {
  if (!isTx(tx)) return refusal("svm/tx-malformed");
  const found = tx.instructions.filter((ix) => sameBytes(tx.keys[ix.program], PAYMENT_CHANNELS_BYTES));
  if (found.length === 0) return refusal("svm/no-channel-instruction");
  if (found.length > 1) return refusal("svm/channel-instruction");
  const ix = found[0]!;
  const shape = CHANNEL_KINDS[ix.data[0] ?? -1];
  if (shape === undefined || ix.accounts.length !== shape[1]) return refusal("svm/channel-instruction");
  const channel = tx.keys[ix.accounts[shape[2]]!];
  if (channel === undefined) return refusal("svm/channel-instruction");
  return { kind: shape[0], channel: keyString(channel), data: copyOf(ix.data) };
}

export type ChannelStatus = SvmStatus | { state: "failed"; why: "no-channel-instruction" };

/**
 * `svmStatus` with the presence test replaced: exactly one top-level payment-channels instruction whose
 * discriminator is `open` (1) or `top_up` (3). The test reads only the signed message, so a transaction without it is
 * failed `no-channel-instruction` from a read at either commitment; an error is failed `err` only from the read at
 * `finalized`, and pending `not-final` from the read at `confirmed`. At most two calls, or five for a durable-nonce
 * reference: the two `transaction` reads, `account`, `firstAvailableBlock` and one more `transaction` at `finalized`.
 */
export async function svmChannelStatus(ref: SvmRef & { transaction: string }, reader: SvmReader): Promise<ChannelStatus> {
  return settledBy(ref, reader, {
    message: (tx) => {
      const found = tx.instructions.filter((ix) => sameBytes(tx.keys[ix.program], PAYMENT_CHANNELS_BYTES));
      return found.length === 1 && (found[0]!.data[0] === 1 || found[0]!.data[0] === 3) ? null : "no-channel-instruction";
    },
  });
}

export interface ChannelBuildInput {
  feePayer: string;
  payer: string;
  mint: string;
  tokenProgram: string;
  recentBlockhash: string;
  /** The one Memo v3 instruction's text, a well-formed string; absent, the message carries no memo. */
  memo?: string;
  computeUnitLimit: number;
  computeUnitPrice: bigint;
  instruction:
    | {
        kind: "open";
        channel: string;
        signer: string;
        salt: bigint;
        deposit: bigint;
        gracePeriod: number;
        openSlot: bigint;
        recipient: string;
      }
    | { kind: "top_up"; channel: string; amount: bigint }
    | { kind: "request_close"; channel: string };
}

/**
 * The v0 message for a channel instruction: `SetComputeUnitLimit`, `SetComputeUnitPrice`, the payment-channels
 * instruction with its accounts in the program's order, then one v3 Memo instruction when `memo` is given. The fee
 * payer is also the `open`'s rent payer and payee. A memo that is not a well-formed string (one holding a lone
 * surrogate has no UTF-8 form) is `svm/input-malformed`, with nothing built.
 */
export async function buildChannelMessage(i: ChannelBuildInput): Promise<Uint8Array<ArrayBuffer> | Refusal> {
  const memo = typeof i === "object" && i !== null ? i.memo : undefined;
  return channelMessage(i, memo === undefined ? [] : [memo]);
}

/** `buildChannelMessage` with one v3 Memo instruction per entry of `memos`, in order, in place of `i.memo`. */
export async function channelMessage(
  i: ChannelBuildInput,
  memos: readonly unknown[],
): Promise<Uint8Array<ArrayBuffer> | Refusal> {
  const ix = i?.instruction;
  if (
    typeof i !== "object" ||
    i === null ||
    !isKey(i.feePayer) ||
    !isKey(i.payer) ||
    !isKey(i.mint) ||
    (i.tokenProgram !== TOKEN && i.tokenProgram !== TOKEN_2022) ||
    !isKey(i.recentBlockhash) ||
    !memos.every((m) => typeof m === "string" && m.isWellFormed()) ||
    !Number.isInteger(i.computeUnitLimit) ||
    i.computeUnitLimit < 0 ||
    i.computeUnitLimit > 0xffffffff ||
    !isU64(i.computeUnitPrice) ||
    typeof ix !== "object" ||
    ix === null ||
    !isKey(ix.channel)
  ) {
    return refusal("svm/input-malformed");
  }
  if (ix.kind === "open" && !isKey(ix.signer)) return refusal("svm/input-malformed");
  if (ix.kind === "top_up" && !isU64(ix.amount)) return refusal("svm/input-malformed");
  let data: Uint8Array;
  try {
    data =
      ix.kind === "open"
        ? openInstructionData(ix)
        : ix.kind === "top_up"
          ? concat(Uint8Array.of(3), u64le(ix.amount))
          : Uint8Array.of(5);
  } catch {
    return refusal("svm/input-malformed");
  }
  let kit: Kit;
  try {
    kit = await import("@solana/kit");
  } catch {
    return refusal("svm/peer-missing");
  }
  const { AccountRole, address } = kit;
  const ata = async (owner: string) =>
    (
      await kit.getProgramDerivedAddress({
        programAddress: address(ATA_PROGRAM),
        seeds: [base58.decode(owner), base58.decode(i.tokenProgram), base58.decode(i.mint)],
      })
    )[0];
  const eventAuthority = findPda([new TextEncoder().encode("event_authority")], PAYMENT_CHANNELS);
  if (isRefusal(eventAuthority)) return eventAuthority;
  const a = (s: string, role: (typeof AccountRole)[keyof typeof AccountRole]) => ({ address: address(s), role });
  let accounts;
  if (ix.kind === "open") {
    accounts = [
      a(i.payer, AccountRole.WRITABLE_SIGNER),
      a(i.feePayer, AccountRole.WRITABLE_SIGNER),
      a(i.feePayer, AccountRole.READONLY),
      a(i.mint, AccountRole.READONLY),
      a(ix.signer, AccountRole.READONLY),
      a(ix.channel, AccountRole.WRITABLE),
      { address: await ata(i.payer), role: AccountRole.WRITABLE },
      { address: await ata(ix.channel), role: AccountRole.WRITABLE },
      a(i.tokenProgram, AccountRole.READONLY),
      a(SYSTEM, AccountRole.READONLY),
      a(RENT_SYSVAR, AccountRole.READONLY),
      a(ATA_PROGRAM, AccountRole.READONLY),
      a(eventAuthority.address, AccountRole.READONLY),
      a(PAYMENT_CHANNELS, AccountRole.READONLY),
    ];
  } else if (ix.kind === "top_up") {
    accounts = [
      a(i.payer, AccountRole.WRITABLE_SIGNER),
      a(ix.channel, AccountRole.WRITABLE),
      { address: await ata(i.payer), role: AccountRole.WRITABLE },
      { address: await ata(ix.channel), role: AccountRole.WRITABLE },
      a(i.mint, AccountRole.READONLY),
      a(i.tokenProgram, AccountRole.READONLY),
    ];
  } else {
    accounts = [a(i.payer, AccountRole.READONLY_SIGNER), a(ix.channel, AccountRole.WRITABLE)];
  }
  return compileV0(i.feePayer, i.recentBlockhash, [
    { programAddress: address(COMPUTE_BUDGET), data: concat(Uint8Array.of(2), u32le(i.computeUnitLimit)) },
    { programAddress: address(COMPUTE_BUDGET), data: concat(Uint8Array.of(3), u64le(i.computeUnitPrice)) },
    { programAddress: address(PAYMENT_CHANNELS), accounts, data },
    ...(memos as readonly string[]).map((m) => ({ programAddress: address(MEMO_V3), data: new TextEncoder().encode(m) })),
  ]);
}
