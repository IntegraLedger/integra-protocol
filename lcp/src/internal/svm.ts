/**
 * Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
 * digest of the message the payer signed, and settlement read through a bounded reader. The public names are
 * re-exported by `../svm.ts`; the rest serve the Solana pairings.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { fromLcpString, hash, toLcpString, type AtrHash } from "../core.js";
import type { Hex } from "../evm.js";
import { refusal, type Refusal } from "../refusal.js";

/** CAIP-2: `solana:` and 32 base58 characters. */
export type SolanaNetwork = `solana:${string}`;

export const MEMO_V3 = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const MEMO_V4 = "Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH";
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SYSTEM = "11111111111111111111111111111111";
export const RECENT_BLOCKHASHES = "SysvarRecentB1ockHashes11111111111111111111";
export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
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

export interface SvmInstruction {
  program: number;
  accounts: readonly number[];
  data: Uint8Array;
}

export interface SvmTx {
  signatures: readonly Uint8Array[];
  /** Exactly the bytes every signer signed. */
  message: Uint8Array;
  /** The static account keys, in order. */
  keys: readonly Uint8Array[];
  instructions: readonly SvmInstruction[];
  blockhash: Uint8Array;
}

/** A landed transaction as `getTransaction` returns it with encoding `base64` and `maxSupportedTransactionVersion` 0. */
export interface SvmLanded {
  wire: Uint8Array;
  err: unknown | null;
  loaded: { writable: readonly Uint8Array[]; readonly: readonly Uint8Array[] };
  /** `meta.innerInstructions`, flattened; `program` indexes the static keys, then `loaded.writable`, then `loaded.readonly`. */
  inner: readonly { program: number; data: Uint8Array }[];
}

/** Bounded, read-only calls against one network's endpoint. Every failure rejects with `ReaderError`. */
export interface SvmReader {
  readonly network: SolanaNetwork;
  /** `getTransaction`; null when none is found at that commitment. */
  transaction(signature: string, commitment: "confirmed" | "finalized"): Promise<SvmLanded | null>;
  /**
   * `getSignaturesForAddress`, newest first. `memo` is the RPC's rendering of the transaction's memos (`[len] text`,
   * joined by `; `), or null when it has none.
   */
  signatures(
    address: string,
    page: { before?: string; limit: 1000 },
  ): Promise<readonly { signature: string; slot: bigint; memo: string | null }[]>;
  /** `isBlockhashValid` at commitment `confirmed`. */
  blockhashValid(blockhash: string): Promise<boolean>;
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

/** The read keys recorded at claim. */
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
  /** The slot read at claim, as a decimal string. */
  fromSlot: string;
  /**
   * The channel account the transaction creates, for an opening that carries no memo: the search pages this address's
   * signatures instead of the fee payer's, and reads each one as a candidate.
   */
  channel?: string;
}

export type SvmStatus =
  | { state: "settled"; commitment: "confirmed" | "finalized" }
  | { state: "pending"; why: "not-found" | "unreadable" }
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
  request: { kind: "solana-message"; message: Uint8Array };
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

export function isKey(s: unknown): s is string {
  return keyBytes(s) !== null;
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

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (a === undefined || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

// ── the wire ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Decoded extends SvmTx {
  requiredSignatures: number;
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

/** Decodes a legacy or v0 wire transaction of at most 1,232 bytes. */
export function decodeSvmTx(wire: Uint8Array): SvmTx | Refusal {
  const d = decode(wire);
  if ("refused" in d) return d;
  const { requiredSignatures: _, ...tx } = d;
  return tx;
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
      const accounts = Array.from(c.bytes(nAcc));
      const data = c.bytes(c.compact());
      instructions.push({ program, accounts, data });
    }
    if (versioned) {
      const nLookups = c.compact();
      for (let i = 0; i < nLookups; i++) {
        c.bytes(32);
        c.bytes(c.compact());
        c.bytes(c.compact());
      }
    }
    if (c.at !== wire.length) return refusal("svm/tx-malformed");
    return { signatures, message: wire.subarray(start), keys, instructions, blockhash, requiredSignatures };
  } catch {
    return refusal("svm/tx-malformed");
  }
}

/**
 * The one top-level Memo instruction (v3 or v4) and the ATR hash its UTF-8 data carries in LCP string form. None, or
 * more than one, is `svm/memo-count`. The memo must be `toLcpString(h)` exactly, in lowercase hex; the same hash in
 * any other spelling is `svm/carrier-not-canonical`.
 */
export function svmCarrier(tx: SvmTx): { h: AtrHash; memo: string } | Refusal {
  const memos = tx.instructions.filter((ix) => {
    const program = tx.keys[ix.program];
    return sameBytes(program, MEMO_V3_BYTES) || sameBytes(program, MEMO_V4_BYTES);
  });
  if (memos.length !== 1) return refusal("svm/memo-count");
  let memo: string;
  try {
    memo = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(memos[0]!.data);
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

/** SHA-256 over the message bytes every signer signed. */
export function svmDigest(tx: SvmTx): Promise<Hex> {
  return hash(tx.message);
}

/** The base64 wire in a payment, decoded, or the refusal naming what is wrong with it. */
export function wireOf(b64: unknown): Uint8Array | Refusal {
  if (typeof b64 !== "string" || b64.length === 0) return refusal("svm/tx-malformed");
  if (b64.length > Math.ceil(MAX_WIRE / 3) * 4 + 4) return refusal("svm/tx-too-large");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return refusal("svm/tx-malformed");
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  if (bytes.length > MAX_WIRE) return refusal("svm/tx-too-large");
  return bytes;
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

/**
 * The read keys of a signed transaction: its message digest, the fee payer (static key 0), the fee payer's signature
 * as the transaction id when that slot is signed, and what bounds the message's life: the recent blockhash, or, for a
 * durable-nonce message, an empty `blockhash` and the `nonce` it uses.
 */
export async function svmReference(
  network: SolanaNetwork,
  tx: SvmTx,
): Promise<Omit<SvmRef, "fromSlot">> {
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
 * writable static key, then the `RecentBlockhashes` sysvar, and the nonce authority as a signer of the message. The
 * nonce value is the message's blockhash field.
 */
function durableNonce(tx: SvmTx): SvmNonce | null {
  const first = tx.instructions[0];
  if (first === undefined || !sameBytes(tx.keys[first.program], SYSTEM_BYTES)) return null;
  const d = first.data;
  if (d.length < 4 || d[0] !== 4 || d[1] !== 0 || d[2] !== 0 || d[3] !== 0) return null;
  const [account, sysvar] = first.accounts;
  if (account === undefined || sysvar === undefined || !isWritable(tx, account)) return null;
  if (!sameBytes(tx.keys[sysvar], RECENT_BLOCKHASHES_BYTES)) return null;
  const required = tx.message[(tx.message[0]! & 0x80) !== 0 ? 1 : 0]!;
  if (!first.accounts.some((i) => i < required)) return null;
  return { account: keyString(tx.keys[account]!), value: keyString(tx.blockhash) };
}

/**
 * The wire for a message and one signer's signature: the compact-u16 signature count, one 64-byte slot per required
 * signer in key order with `signature` in the signer's slot and zeros in every other, then the message.
 */
export function signedWire(message: Uint8Array, signer: string, signature: Uint8Array): Uint8Array | Refusal {
  if (!(signature instanceof Uint8Array) || signature.length !== 64) return refusal("svm/input-malformed");
  const signerKey = keyBytes(signer);
  if (signerKey === null) return refusal("svm/input-malformed");
  const required = (message[0]! & 0x80) !== 0 ? message[1]! : message[0]!;
  const withSlots = new Uint8Array(compactLength(required) + 64 * required + message.length);
  let at = writeCompact(withSlots, 0, required);
  const slotsAt = at;
  at += 64 * required;
  withSlots.set(message, at);
  const d = decode(withSlots);
  if ("refused" in d) return d;
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

function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

function concat(...parts: Uint8Array[]): Uint8Array {
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
 * is the memo's UTF-8 bytes. No lookup tables.
 */
export async function buildSvmMessage(i: SvmBuildInput): Promise<Uint8Array | Refusal> {
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
): Promise<Uint8Array | Refusal> {
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
export function svmSigning(message: Uint8Array, signer: string): SvmSigning {
  return {
    request: { kind: "solana-message", message },
    wire: (signature) => signedWire(message, signer, signature),
  };
}

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Reads a named transaction at `finalized`, then `confirmed`. Undefined when the read failed. */
async function landedAt(
  reader: SvmReader,
  transaction: string,
  commitments: readonly ("finalized" | "confirmed")[] = ["finalized", "confirmed"],
): Promise<{ landed: SvmLanded; commitment: "confirmed" | "finalized" } | null | undefined> {
  try {
    for (const commitment of commitments) {
      const landed = await reader.transaction(transaction, commitment);
      if (landed === null) continue;
      if (!isLanded(landed)) return undefined;
      return { landed, commitment };
    }
    return null;
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

/** Every key the landed transaction's instructions may index: the static keys, then the loaded addresses. */
export function allKeys(tx: SvmTx, landed: SvmLanded): readonly Uint8Array[] {
  return [...tx.keys, ...landed.loaded.writable, ...landed.loaded.readonly];
}

/** True when a top-level or inner instruction is a token `TransferChecked` or a System `transfer`. */
function movesValue(tx: SvmTx, landed: SvmLanded): boolean {
  const keys = allKeys(tx, landed);
  const all = [...tx.instructions, ...landed.inner];
  return all.some(({ program, data }) => {
    const key = keys[program];
    if ((sameBytes(key, TOKEN_BYTES) || sameBytes(key, TOKEN_2022_BYTES)) && data[0] === 0x0c) return true;
    return sameBytes(key, SYSTEM_BYTES) && data.length >= 4 && data[0] === 2 && data[1] === 0 && data[2] === 0 && data[3] === 0;
  });
}

/**
 * Reads a named transaction's settlement. It must be the message the payer signed (by digest), must have executed
 * without error, and must carry a token or SOL transfer. A failed read, or a reader for another network, is pending.
 * A durable-nonce transaction that is not found, once `svmNonceMoved` holds and the node's first available block is
 * at or before `fromSlot`, is read once more at `finalized`; still not found, it is failed `nonce-moved`: the message
 * can never land. At most two calls, or five for a durable-nonce reference.
 */
export async function svmStatus(ref: SvmRef & { transaction: string }, reader: SvmReader): Promise<SvmStatus> {
  return settledBy(ref, reader, (tx, landed) => (movesValue(tx, landed) ? null : "no-transfer"));
}

/**
 * The shared settlement read: digest, then `err`, then the pairing's own check, which names a failure or returns null.
 * A durable-nonce transaction that is not found is failed `nonce-moved` once its nonce has moved on and a last read at
 * `finalized` still finds nothing.
 */
export async function settledBy<W extends string>(
  ref: SvmRef & { transaction: string },
  reader: SvmReader,
  check: (tx: SvmTx, landed: SvmLanded) => W | null,
): Promise<
  | { state: "settled"; commitment: "confirmed" | "finalized" }
  | { state: "pending"; why: "not-found" | "unreadable" }
  | { state: "failed"; why: "err" | "not-this-instrument" | "nonce-moved" | W }
> {
  if (reader.network !== ref.network) return { state: "pending", why: "unreadable" };
  let read = await landedAt(reader, ref.transaction);
  if (read === undefined) return { state: "pending", why: "unreadable" };
  if (read === null && ref.nonce !== undefined && (await nonceLapsed(ref, reader))) {
    read = await landedAt(reader, ref.transaction, ["finalized"]);
    if (read === undefined) return { state: "pending", why: "unreadable" };
    if (read === null) return { state: "failed", why: "nonce-moved" };
  }
  if (read === null) return { state: "pending", why: "not-found" };
  const tx = decodeSvmTx(read.landed.wire);
  if ("refused" in tx) return { state: "pending", why: "unreadable" };
  if ((await svmDigest(tx)) !== ref.digest.toLowerCase()) return { state: "failed", why: "not-this-instrument" };
  if (read.landed.err !== null && read.landed.err !== undefined) return { state: "failed", why: "err" };
  const why = check(tx, read.landed);
  if (why !== null) return { state: "failed", why };
  return { state: "settled", commitment: read.commitment };
}

/**
 * True when the durable nonce `ref.nonce` records is spent or gone: a `finalized` read of the nonce account, at a
 * context slot at least 150 slots past `fromSlot`, finds no account, an account the System program does not own, an
 * account that is not an initialized nonce account, or an initialized current-version nonce account holding another
 * value. A legacy-version nonce account, a read too early, a failed or malformed read, a reference without `nonce` and
 * a reader for another network are false. One call.
 *
 * The message then can never land, and the transaction that used the nonce, when it landed, is final by that read. So
 * a durable-nonce reference with no named transaction lapses when this reads true and a `svmLocate` that starts after
 * it is complete with nothing found.
 */
export async function svmNonceMoved(ref: SvmRef, reader: SvmReader): Promise<boolean> {
  if (reader.network !== ref.network) return false;
  const nonce: unknown = ref.nonce;
  if (typeof nonce !== "object" || nonce === null) return false;
  const { account, value } = nonce as SvmNonce;
  if (!isKey(account) || !isKey(value)) return false;
  if (typeof ref.fromSlot !== "string" || !SLOT.test(ref.fromSlot)) return false;
  let read: Awaited<ReturnType<SvmReader["account"]>>;
  try {
    read = await reader.account(account);
  } catch {
    return false;
  }
  if (typeof read !== "object" || read === null || typeof read.slot !== "bigint") return false;
  if (read.slot < BigInt(ref.fromSlot) + NONCE_SETTLED_SLOTS) return false;
  const found: unknown = read.value;
  if (found === null) return true;
  if (typeof found !== "object") return false;
  const { owner, data } = found as { owner: unknown; data: unknown };
  if (typeof owner !== "string" || !(data instanceof Uint8Array)) return false;
  if (owner !== SYSTEM || data.length !== NONCE_ACCOUNT_BYTES) return true;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(0, true);
  const state = view.getUint32(4, true);
  if (state !== 1) return true;
  if (version === 0) return false;
  if (version !== 1) return true;
  return keyString(data.subarray(40, 72)) !== value;
}

/** `svmNonceMoved`, and the node still holds every block from `fromSlot`. */
async function nonceLapsed(ref: SvmRef, reader: SvmReader): Promise<boolean> {
  if (!(await svmNonceMoved(ref, reader))) return false;
  try {
    const first = await reader.firstAvailableBlock();
    return typeof first === "bigint" && first <= BigInt(ref.fromSlot);
  } catch {
    return false;
  }
}

/**
 * Finds the instrument when no transaction was named: pages the fee payer's signatures, newest first, down to
 * `fromSlot`, at most 10 pages of 1,000. A signature is a candidate only when its memo carries `h` in LCP string form,
 * matched without regard to case. With `channel` in the reference, it pages that account's signatures instead, and
 * every signature is a candidate. Each candidate is read through `status`, the pairing's own (`svmStatus` when none
 * is given), at most 50 per pass.
 * `complete` is true only when the node's first available block is at or before `fromSlot`, the pages reached
 * `fromSlot` within those bounds, and every candidate was read: a listed candidate whose transaction reads pending
 * leaves the search incomplete.
 */
export async function svmLocate(
  ref: SvmRef,
  reader: SvmReader,
  h: AtrHash,
  status: (ref: SvmRef & { transaction: string }, reader: SvmReader) => Promise<{ state: string; why?: string }> = svmStatus,
): Promise<{ found?: string; complete: boolean }> {
  if (reader.network !== ref.network) return { complete: false };
  if (typeof ref.fromSlot !== "string" || !SLOT.test(ref.fromSlot)) return { complete: false };
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
      list = await reader.signatures(address, before === undefined ? { limit: LOCATE_PAGE } : { before, limit: LOCATE_PAGE });
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

/** Zero-party recovery: the ATR hash in the landed transaction's one memo. One or two calls. */
export async function svmRecover(
  ref: { network: SolanaNetwork; transaction: string },
  reader: SvmReader,
): Promise<AtrHash | Refusal> {
  if (reader.network !== ref.network) return refusal("svm/wrong-reader");
  const read = await landedAt(reader, ref.transaction);
  if (read === undefined) return refusal("svm/unreadable");
  if (read === null) return refusal("svm/not-found");
  if (read.landed.err !== null && read.landed.err !== undefined) return refusal("svm/err");
  const tx = decodeSvmTx(read.landed.wire);
  if ("refused" in tx) return tx;
  const c = svmCarrier(tx);
  return "refused" in c ? c : c.h;
}

// ── the payment-channels program ─────────────────────────────────────────────────────────────────────────────────

export const PAYMENT_CHANNELS = "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
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

/** The channel PDA: seeds "channel", payer, payee, mint, signer, u64le(salt), u64le(openSlot). */
export function channelPda(a: {
  payer: string;
  payee: string;
  mint: string;
  signer: string;
  salt: bigint;
  openSlot: bigint;
}): string | Refusal {
  const keys = [a.payer, a.payee, a.mint, a.signer].map(keyBytes);
  if (keys.some((k) => k === null) || !isU64(a.salt) || !isU64(a.openSlot)) return refusal("svm/input-malformed");
  const pda = findPda(
    [new TextEncoder().encode("channel"), ...(keys as Uint8Array[]), u64le(a.salt), u64le(a.openSlot)],
    PAYMENT_CHANNELS,
  );
  return "refused" in pda ? pda : pda.address;
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
}): Uint8Array {
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
export function channelVoucherMessage(channelId: string, cumulative: bigint, expiresAt: bigint): Uint8Array {
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
  data: Uint8Array;
}

/** Each channel instruction: its discriminator, its account count, and the position of the `channel` account. */
const CHANNEL_KINDS: { readonly [d: number]: readonly [ChannelIx["kind"], number, number] } = {
  1: ["open", 14, 5],
  3: ["top_up", 6, 1],
  5: ["request_close", 2, 1],
};

/** The transaction's one top-level payment-channels instruction, by its discriminator. */
export function channelInstruction(tx: SvmTx): ChannelIx | Refusal {
  const found = tx.instructions.filter((ix) => sameBytes(tx.keys[ix.program], PAYMENT_CHANNELS_BYTES));
  if (found.length === 0) return refusal("svm/no-channel-instruction");
  if (found.length > 1) return refusal("svm/channel-instruction");
  const ix = found[0]!;
  const shape = CHANNEL_KINDS[ix.data[0] ?? -1];
  if (shape === undefined || ix.accounts.length !== shape[1]) return refusal("svm/channel-instruction");
  const channel = tx.keys[ix.accounts[shape[2]]!];
  if (channel === undefined) return refusal("svm/channel-instruction");
  return { kind: shape[0], channel: keyString(channel), data: ix.data };
}

export type ChannelStatus = SvmStatus | { state: "failed"; why: "no-channel-instruction" };

/**
 * `svmStatus` with the presence test replaced: exactly one top-level payment-channels instruction whose
 * discriminator is `open` (1) or `top_up` (3). At most two calls.
 */
export async function svmChannelStatus(ref: SvmRef & { transaction: string }, reader: SvmReader): Promise<ChannelStatus> {
  return settledBy(ref, reader, (tx) => {
    const found = tx.instructions.filter((ix) => sameBytes(tx.keys[ix.program], PAYMENT_CHANNELS_BYTES));
    return found.length === 1 && (found[0]!.data[0] === 1 || found[0]!.data[0] === 3) ? null : "no-channel-instruction";
  });
}

export interface ChannelBuildInput {
  feePayer: string;
  payer: string;
  mint: string;
  tokenProgram: string;
  recentBlockhash: string;
  /** The one Memo v3 instruction's text; absent, the message carries no memo. */
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
 * payer is also the `open`'s rent payer and payee.
 */
export async function buildChannelMessage(i: ChannelBuildInput): Promise<Uint8Array | Refusal> {
  const ix = i?.instruction;
  if (
    typeof i !== "object" ||
    i === null ||
    !isKey(i.feePayer) ||
    !isKey(i.payer) ||
    !isKey(i.mint) ||
    (i.tokenProgram !== TOKEN && i.tokenProgram !== TOKEN_2022) ||
    !isKey(i.recentBlockhash) ||
    (i.memo !== undefined && typeof i.memo !== "string") ||
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
  if ("refused" in eventAuthority) return eventAuthority;
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
    ...(i.memo !== undefined ? [{ programAddress: address(MEMO_V3), data: new TextEncoder().encode(i.memo) }] : []),
  ]);
}
