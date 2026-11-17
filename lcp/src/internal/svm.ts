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
import { isObject } from "../fields.js";
import { fromBase64 } from "../rail-bytes.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { UptoSvmPayload } from "../x402-upto-solana.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";
import type { OptionFilter } from "./x402.js";

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

/** The serialized size bound of a legacy or v0 transaction. */
export const MAX_WIRE = 1232;
/** The serialized size bound of a v1 transaction (SIMD-0385, *Transaction Constraints*). */
export const MAX_WIRE_V1 = 4096;
/** The first byte of a v1 wire transaction, its message's version byte (SIMD-0385, *VersionByte*). */
const V1_VERSION_BYTE = 0x81;
/** SIMD-0385's bounds on a v1 message: signatures, account addresses and instructions. */
const V1_MAX_SIGNATURES = 12;
const V1_MAX_ADDRESSES = 64;
const V1_MAX_INSTRUCTIONS = 64;
/**
 * The `TransactionConfigMask` bits SIMD-0385 assigns: 0 and 1 the priority fee (a u64, both bits set together), 2 the
 * compute unit limit, 3 the loaded accounts data size limit, 4 the requested heap size (each a u32).
 */
const V1_CONFIG_BITS = 0b11111;
const V1_PRIORITY_FEE_BITS = 0b11;
const V1_HEAP_SIZE_BIT = 0b10000;
const NETWORK = /^solana:[1-9A-HJ-NP-Za-km-z]{32}$/;
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

/**
 * The durable nonce a message uses: the nonce account its `AdvanceNonceAccount` instruction names, and the nonce value
 * the message carries in its blockhash field.
 */
export interface SvmNonce {
  account: string;
  value: string;
}

export type { SvmLanded, SvmMark, SvmQuery, SvmReader, SvmRef, SvmStatus } from "./svm-read.js";

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
  /** Present, a version-1 message (SIMD-0385) whose header carries the compute budget in this form; absent, v0. */
  v1?: SvmV1Header;
}

/**
 * The form of a version-1 message's header, which carries the compute budget in place of Compute Budget
 * instructions: the compute unit limit, the priority fee in lamports for the limit at the budget's price per unit,
 * rounded up, and the loaded-account-data limit.
 */
export interface SvmV1Header {
  /** The loaded-account-data limit the header carries, in bytes. */
  loadedAccountsDataSizeLimit: number;
  /** Whether the header carries a priority fee of 0 lamports; otherwise a fee of 0 is left out. */
  zeroPriorityFee: boolean;
}

/**
 * The header @x402/svm 2.31.0's clients write (`applyTransactionV1Config`, `dist/esm/chunk-RZ6M7L3U.mjs:40-53`): a
 * priority fee only where it is above 0, and `DEFAULT_LOADED_ACCOUNTS_DATA_SIZE_LIMIT`, 4 MiB.
 */
export const X402_V1: SvmV1Header = Object.freeze({ loadedAccountsDataSizeLimit: 4_194_304, zeroPriorityFee: false });

/**
 * The header solana-foundation/pay-kit 86400da's MPP charge client writes (`typescript/packages/mpp/src/client/
 * Charge.ts:451-464`): the priority fee always, and the runtime maximum of 64 MiB, the one value its server's
 * `checkV1BudgetCaps` admits (`src/utils/transaction-versions.ts`).
 */
export const MPP_V1: SvmV1Header = Object.freeze({ loadedAccountsDataSizeLimit: 67_108_864, zeroPriorityFee: true });

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

export interface Decoded extends SvmTx {
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
 * Decodes a legacy or v0 wire transaction of at most 1,232 bytes, or a v1 wire transaction (SIMD-0385) of at most 4,096
 * bytes; a longer one is `svm/tx-too-large`. Bytes that are not one well-formed transaction are `svm/tx-malformed`, as
 * is a v0 message with an address table lookup that names no index, which the runtime refuses ("each lookup table must
 * be used to load at least one account"), and a v1 message that SIMD-0385's sanitization refuses (`decodeV1`). Each
 * byte field is a copy, so none shares memory with `wire`.
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

export function decode(wire: Uint8Array): Decoded | Refusal {
  if (!(wire instanceof Uint8Array) || wire.length === 0) return refusal("svm/tx-malformed");
  if (wire[0] === V1_VERSION_BYTE) return decodeV1(wire);
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
 * A v1 wire transaction, laid out as SIMD-0385's *Transaction V1 Specification* states: the version byte 129, the
 * legacy header, the `TransactionConfigMask` (u32 little-endian), the lifetime specifier (the recent blockhash or
 * durable nonce), the instruction count and address count (one byte each), the addresses, one 4-byte config value per
 * mask bit, one 4-byte header per instruction (program index, account count, data length as a u16 little-endian),
 * each instruction's account indexes and data, then one 64-byte signature per required signer. The message every
 * signer signs is every byte before the signatures, and no byte follows them. A v1 message has no address table
 * lookups. `svm/tx-malformed` where SIMD-0385's sanitization refuses the message: no signer, or a read-only signer
 * count not below the signer count; fewer addresses than the signers and read-only unsigned accounts, or more than 64;
 * more than 12 signers or 64 instructions; an address listed twice; a program or account index not below the address
 * count; only one of the priority fee's two mask bits set; or a requested heap size that is not a multiple of 1,024
 * from 32,768 to 262,144. A set mask bit SIMD-0385 assigns no field, for which it states no rule, is `svm/tx-malformed`
 * too, since the 4 bytes it stands for have no meaning this package can read. Over 4,096 bytes is `svm/tx-too-large`.
 */
function decodeV1(wire: Uint8Array): Decoded | Refusal {
  if (wire.length > MAX_WIRE_V1) return refusal("svm/tx-too-large");
  try {
    const c = new Cursor(wire);
    c.byte();
    const requiredSignatures = c.byte();
    const readonlySigned = c.byte();
    const readonlyUnsigned = c.byte();
    const mask = new DataView(c.bytes(4).slice().buffer).getUint32(0, true);
    const blockhash = c.bytes(32);
    const nIx = c.byte();
    const nKeys = c.byte();
    if (requiredSignatures === 0 || readonlySigned >= requiredSignatures) return refusal("svm/tx-malformed");
    if (nKeys < requiredSignatures + readonlyUnsigned || nKeys > V1_MAX_ADDRESSES) return refusal("svm/tx-malformed");
    if (requiredSignatures > V1_MAX_SIGNATURES || nIx > V1_MAX_INSTRUCTIONS) return refusal("svm/tx-malformed");
    if ((mask & ~V1_CONFIG_BITS) !== 0) return refusal("svm/tx-malformed");
    const fee = mask & V1_PRIORITY_FEE_BITS;
    if (fee !== 0 && fee !== V1_PRIORITY_FEE_BITS) return refusal("svm/tx-malformed");
    const keys: Uint8Array[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < nKeys; i++) {
      const key = c.bytes(32);
      const k = keyString(key);
      if (seen.has(k)) return refusal("svm/tx-malformed");
      seen.add(k);
      keys.push(key);
    }
    const values = c.bytes(4 * popcount(mask));
    if ((mask & V1_HEAP_SIZE_BIT) !== 0) {
      const heap = new DataView(values.slice(values.length - 4).buffer).getUint32(0, true);
      if (heap % 1024 !== 0 || heap < 32 * 1024 || heap > 256 * 1024) return refusal("svm/tx-malformed");
    }
    const headers: { program: number; nAcc: number; nData: number }[] = [];
    for (let i = 0; i < nIx; i++) {
      const h = c.bytes(4);
      headers.push({ program: h[0]!, nAcc: h[1]!, nData: h[2]! | (h[3]! << 8) });
    }
    const instructions: SvmInstruction[] = [];
    for (const { program, nAcc, nData } of headers) {
      const indices = c.bytes(nAcc);
      const accounts = Array.from({ length: indices.length }, (_, j) => indices[j]!);
      if (program >= nKeys || accounts.some((a) => a >= nKeys)) return refusal("svm/tx-malformed");
      instructions.push({ program, accounts, data: c.bytes(nData) });
    }
    const messageEnd = c.at;
    const signatures: Uint8Array[] = [];
    for (let i = 0; i < requiredSignatures; i++) signatures.push(c.bytes(64));
    if (c.at !== wire.length) return refusal("svm/tx-malformed");
    return {
      signatures,
      message: wire.subarray(0, messageEnd),
      keys,
      instructions,
      blockhash,
      requiredSignatures,
      loads: { writable: 0, readonly: 0 },
      lookups: [],
    };
  } catch {
    return refusal("svm/tx-malformed");
  }
}

function popcount(v: number): number {
  let n = 0;
  for (let x = v; x !== 0; x &= x - 1) n++;
  return n;
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
  if (b64.length > Math.ceil(MAX_WIRE_V1 / 3) * 4 + 4) return refusal("svm/tx-too-large");
  const bytes = fromBase64(b64);
  if (bytes === null) return refusal("svm/tx-malformed");
  if (bytes.length > (bytes[0] === V1_VERSION_BYTE ? MAX_WIRE_V1 : MAX_WIRE)) return refusal("svm/tx-too-large");
  return bytes;
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
export function durableNonce(tx: SvmTx): SvmNonce | null {
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
 * The message version a Solana build writes under `fields`, an x402 Solana option's `extra` or an MPP Solana charge
 * challenge's Solana details: the highest version both the field and this package admit, 1 where `transactionVersions`
 * holds 1, 0 where it holds 0 alone or is absent; null where it is present and is not a non-empty array of the JSON
 * integers 0 and 1, which admits neither. The field is the set of versions the sponsor or server accepts, and absent
 * it is `[0]` (x402: scheme_exact_svm.md §1.5 at x402-foundation/x402 88b66dd4, and `resolveTransactionVersion` of
 * @x402/svm 2.31.0, which refuses an empty list, a value that is not an array and any entry other than 0 and 1; MPP: the
 * draft `methodDetails.transactionVersions` of tempoxyz/mpp-specs pull request 355, as solana-foundation/pay-kit
 * 86400da reads it in `typescript/packages/mpp/src/utils/transaction-versions.ts`, where a present, empty list accepts
 * nothing, and builds it in `src/client/Charge.ts:211-220`).
 */
export function builtVersion(fields: unknown): 0 | 1 | null {
  if (!isObject(fields) || !("transactionVersions" in fields)) return 0;
  const versions = fields["transactionVersions"];
  if (!Array.isArray(versions) || versions.length === 0 || !versions.every((v) => v === 0 || v === 1)) return null;
  return versions.includes(1) ? 1 : 0;
}

/**
 * `svm/version-not-admitted` where the signed message's version is one the `transactionVersions` of `fields` (an x402
 * Solana option's `extra`, or an MPP Solana charge challenge's Solana details) does not admit, else null: a payment the
 * option does not admit is no answer to it. The version is read as @x402/svm 2.31.0 reads it, from the message's first
 * byte, `legacy` where its high bit is clear and its low seven bits otherwise (version 1's prefix being 129, SIMD-0385);
 * the list absent is `[0]` (`resolveTransactionVersion`, `dist/esm/chunk-DAIKIZVB.mjs:289-290`), and a list that is not
 * an array admits nothing.
 * - On x402 (`on` `"x402"`) a version is admitted as the facilitator admits it, `legacy` where the list holds 0
 *   (`isAcceptedTransactionVersion`, `:269-278`); its server copies the facilitator's list into the option (`@x402/svm`
 *   at `88b66dd4`, `exact/server/scheme.ts:139-141`), so a version the option does not list is one its facilitator
 *   refuses.
 * - On MPP (`on` `"mpp"`) the server refuses a legacy message whatever the list holds, the list absent being `[0]`
 *   (solana-foundation/pay-kit 86400da, `typescript/packages/mpp/src/utils/transaction-versions.ts:15-16` and
 *   `:218-226`, applied before it co-signs at `src/server/Charge.ts:424-433` and to a pushed signature at
 *   `:1077-1081`), so `legacy` is refused on every MPP Solana charge challenge.
 */
export function versionNotAdmitted(fields: unknown, tx: SvmTx, on: "x402" | "mpp"): Refusal | null {
  const present = isObject(fields) && "transactionVersions" in fields;
  const listed = present ? fields["transactionVersions"] : [0];
  const first = tx.message[0];
  if (!Array.isArray(listed) || first === undefined) return refusal("svm/version-not-admitted");
  const version = (first & 0x80) !== 0 ? first & 0x7f : "legacy";
  if (version === "legacy" && on === "mpp") return refusal("svm/version-not-admitted");
  return listed.includes(version === "legacy" ? 0 : version) ? null : refusal("svm/version-not-admitted");
}

/**
 * The refusal an x402 Solana option filter gives an option of its pairing that no Solana build honours, else null:
 * an `extra.transactionVersions` that admits neither version (`builtVersion`), which scheme_exact_svm.md §1.5 makes
 * invalid, is `x402/option-malformed`; an `extra.splits` is `svm/input-malformed`, since no Solana build writes split
 * legs and each pays the whole amount to `payTo`.
 */
export function unbuiltOption(extra: unknown): Refusal | null {
  if (builtVersion(extra) === null) return refusal("x402/option-malformed");
  if (isObject(extra) && extra["splits"] !== undefined) return refusal("svm/input-malformed");
  return null;
}

/** An x402 Solana pairing's option filter: `filter`, then `unbuiltOption` over an option it serves. */
export function svmOptionFilter(filter: OptionFilter): OptionFilter {
  return (o) => {
    const f = filter(o);
    return f === true ? (unbuiltOption(o.extra) ?? true) : f;
  };
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
 * The wire for a message and one signer's signature, one 64-byte slot per required signer in key order with
 * `signature` in the signer's slot and zeros in every other. A legacy or v0 message takes the compact-u16 signature
 * count and the slots before it; a version-1 message (first byte 129) takes the slots after it, with no count and no
 * byte following, as SIMD-0385 lays it out and @solana/kit 8.4.0's `getTransactionEncoder` writes it. A message under
 * 2 bytes, too short to hold a v0 prefix and its signature count, is `svm/tx-malformed`.
 */
export function signedWire(message: Uint8Array, signer: string, signature: Uint8Array): Uint8Array | Refusal {
  if (!(signature instanceof Uint8Array) || signature.length !== 64) return refusal("svm/input-malformed");
  const signerKey = keyBytes(signer);
  if (signerKey === null) return refusal("svm/input-malformed");
  if (message.length < 2) return refusal("svm/tx-malformed");
  const v1 = message[0] === V1_VERSION_BYTE;
  const required = (message[0]! & 0x80) !== 0 ? message[1]! : message[0]!;
  const prefix = v1 ? 0 : compactLength(required);
  const withSlots = new Uint8Array(prefix + 64 * required + message.length);
  let slotsAt: number;
  if (v1) {
    withSlots.set(message, 0);
    slotsAt = message.length;
  } else {
    slotsAt = writeCompact(withSlots, 0, required);
    withSlots.set(message, slotsAt + 64 * required);
  }
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

/**
 * True when the members a payer passes to every x402 Solana `build` have their rail form: the payer and the recent
 * blockhash base58 public keys, the token program Token's or Token-2022's, and the compute unit limit and price, when
 * given, a u32 and a u64. Each `build` checks them before the choice's document and option, so a malformed one is
 * `svm/input-malformed`, the code the message builders give it, whatever the document holds.
 */
export function isPayerInput(c: {
  payer?: unknown;
  tokenProgram?: unknown;
  recentBlockhash?: unknown;
  computeUnitLimit?: unknown;
  computeUnitPrice?: unknown;
}): boolean {
  const limit = c.computeUnitLimit ?? 0;
  return (
    isKey(c.payer) &&
    (c.tokenProgram === TOKEN || c.tokenProgram === TOKEN_2022) &&
    isKey(c.recentBlockhash) &&
    Number.isInteger(limit) &&
    (limit as number) >= 0 &&
    (limit as number) <= 0xffffffff &&
    isU64(c.computeUnitPrice ?? 0n)
  );
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
    i.computeUnitPrice < U64_LIMIT &&
    (i.v1 === undefined || isV1Header(i.v1))
  );
}

/** True for a version-1 header form: a u32 loaded-account-data limit and a boolean. */
function isV1Header(h: unknown): h is SvmV1Header {
  if (!isObject(h)) return false;
  const limit = h["loadedAccountsDataSizeLimit"];
  return Number.isInteger(limit) && (limit as number) >= 0 && (limit as number) <= 0xffffffff && typeof h["zeroPriorityFee"] === "boolean";
}

/**
 * The versioned message bytes for a token payment: `SetComputeUnitLimit`, `SetComputeUnitPrice`, `TransferChecked`
 * from the payer's associated token account to the payee's, then one v3 Memo instruction whose data is the memo's
 * UTF-8 bytes, as a v0 message; with `v1`, the same without the two Compute Budget instructions, as a version-1
 * message whose header carries the budget (`compileV1`). No lookup tables. A memo that is not a well-formed string
 * (one holding a lone surrogate has no UTF-8 form) is `svm/input-malformed`, with nothing built.
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
  return compileBudgeted(i.feePayer, i.recentBlockhash, instructions, i, i.v1);
}

/**
 * Compiles instructions with the budget `b`: as a v0 message led by `SetComputeUnitLimit` and `SetComputeUnitPrice`
 * where `v1` is absent, else as a version-1 message whose header carries it in the form `v1` names (`compileV1`).
 */
export async function compileBudgeted(
  feePayer: string,
  recentBlockhash: string,
  instructions: readonly KitInstruction[],
  b: { computeUnitLimit: number; computeUnitPrice: bigint },
  v1: SvmV1Header | undefined,
): Promise<Uint8Array<ArrayBuffer> | Refusal> {
  if (v1 !== undefined) return compileV1(feePayer, recentBlockhash, instructions, b, v1);
  return compileV0(feePayer, recentBlockhash, [
    { programAddress: COMPUTE_BUDGET, data: concat(Uint8Array.of(2), u32le(b.computeUnitLimit)) },
    { programAddress: COMPUTE_BUDGET, data: concat(Uint8Array.of(3), u64le(b.computeUnitPrice)) },
    ...instructions,
  ]);
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

/**
 * Compiles instructions into version-1 message bytes (SIMD-0385) with the given fee payer and blockhash, the budget in
 * the header as `v1` names it: the compute unit limit, which must be above 0, as @x402/svm 2.31.0's
 * `applyTransactionV1Config` and pay-kit 86400da's charge client require; the priority fee, the limit times the price
 * per unit in micro-lamports over 10^6, rounded up, left out where it is 0 unless `v1.zeroPriorityFee`; and
 * `v1.loadedAccountsDataSizeLimit`. A limit of 0, or past the 1,400,000 units @solana/kit 8.4.0 admits, is
 * `svm/input-malformed`.
 */
export async function compileV1(
  feePayer: string,
  recentBlockhash: string,
  instructions: readonly KitInstruction[],
  b: { computeUnitLimit: number; computeUnitPrice: bigint },
  v1: SvmV1Header,
): Promise<Uint8Array<ArrayBuffer> | Refusal> {
  if (!Number.isInteger(b.computeUnitLimit) || b.computeUnitLimit <= 0) return refusal("svm/input-malformed");
  let kit: Kit;
  try {
    kit = await import("@solana/kit");
  } catch {
    return refusal("svm/peer-missing");
  }
  const fee = (BigInt(b.computeUnitLimit) * b.computeUnitPrice + 999_999n) / 1_000_000n;
  const config = {
    computeUnitLimit: b.computeUnitLimit,
    loadedAccountsDataSizeLimit: v1.loadedAccountsDataSizeLimit,
    ...(fee > 0n || v1.zeroPriorityFee ? { priorityFeeLamports: fee } : {}),
  };
  const compiled = instructions as unknown as readonly Parameters<Kit["appendTransactionMessageInstructions"]>[0][number][];
  try {
    const message = kit.pipe(
      kit.createTransactionMessage({ version: 1 }),
      (m) => kit.setTransactionMessageConfig(config, m),
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

/** A bigint from 0 to 2^64 − 1. */
export function isU64(v: unknown): v is bigint {
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
  /** Present, a version-1 message (SIMD-0385) whose header carries the compute budget in this form; absent, v0. */
  v1?: SvmV1Header;
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
 * The message for a channel instruction: `SetComputeUnitLimit`, `SetComputeUnitPrice`, the payment-channels
 * instruction with its accounts in the program's order, then one v3 Memo instruction when `memo` is given, as a v0
 * message; with `v1`, the same without the two Compute Budget instructions, as a version-1 message whose header
 * carries the budget (`compileV1`). The fee
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
    (i.v1 !== undefined && !isV1Header(i.v1)) ||
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
  return compileBudgeted(
    i.feePayer,
    i.recentBlockhash,
    [
      { programAddress: address(PAYMENT_CHANNELS), accounts, data },
      ...(memos as readonly string[]).map((m) => ({ programAddress: address(MEMO_V3), data: new TextEncoder().encode(m) })),
    ],
    i,
    i.v1,
  );
}
