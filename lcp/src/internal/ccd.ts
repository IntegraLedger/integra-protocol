/**
 * Concordium's memo and account primitives, which `../ccd.ts` exports and both its codec and its read use; and the x402
 * payment a Concordium payer presents, which `../ccd.ts` returns from `complete` and the root names among the payments
 * `Presented` covers (no entry point exports that name).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { fromLcpString, hash, hashEquals, toLcpString, type AtrHash, type Json } from "../core.js";
import { decodeCbor, isMap, isTag, mapGet, type Cbor } from "../cbor.js";
import type { Hex } from "../evm.js";
import { isRefusal } from "../refusal.js";
import { refusal, type Refusal } from "../refusal.js";
import type { PaymentRequired, PaymentRequirements } from "../x402.js";

const utf8 = new TextEncoder();

export type CcdPaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { signedTransaction: { [k: string]: Json } };
  extensions?: PaymentRequired["extensions"];
};

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** lcp's own resource bound on an account address's text, in characters: a base58check account address is 50. */
export const CCD_MAX_ADDRESS = 64;
/** The longest memo the chain takes, in bytes: Concordium's `Memo` holds at most 256. */
export const CCD_MAX_MEMO = 256;

const TEXT_PREFIX = new Uint8Array([0x78, 0x4d]);
const TAG24_PREFIX = new Uint8Array([0xd8, 0x18, 0x58, 0x4f]);

/**
 * The CBOR text string of `toLcpString(h)`: `78 4d` and the 77 ASCII bytes. Throws TypeError when `h` is not a 32-byte
 * hash.
 */
export function ccdMemo(h: AtrHash): Uint8Array<ArrayBuffer> {
  return concat(TEXT_PREFIX, utf8.encode(toLcpString(h)));
}

/** CBOR tag 24 around a byte string holding `ccdMemo(h)`: `d8 18 58 4f` and the 79 bytes. Throws as `ccdMemo` does. */
export function pltMemo(h: AtrHash): Uint8Array<ArrayBuffer> {
  return concat(TAG24_PREFIX, ccdMemo(h));
}

/**
 * The hash a memo carries: exactly one CBOR text string, nothing after it, whose bytes are `ccdMemo` of the hash it
 * names (LCP's string form with lowercase hex, under the preferred two-byte head). `bound`, `status` and `recover` all
 * read a memo through this one function.
 */
export function memoCarrier(memo: Uint8Array): AtrHash | Refusal {
  const v = memo instanceof Uint8Array && memo.length <= CCD_MAX_MEMO ? decodeCbor(memo) : null;
  if (typeof v !== "string") return refusal("ccd/memo-not-cbor-text");
  const h = fromLcpString(v);
  return h !== null && equalBytes(memo, ccdMemo(h)) ? h : refusal("ccd/memo-not-lcp");
}

/**
 * The 32 bytes of a base58check account address whose version byte is 1: its last four bytes are the first four of
 * the double SHA-256 of the 33 before them.
 */
export function accountBytes(address: string): Uint8Array<ArrayBuffer> | Refusal {
  const raw = accountShape(address);
  if (raw === null) return refusal("ccd/address-malformed");
  const twice = sha256(sha256(raw.subarray(0, 33)));
  for (let i = 0; i < 4; i++) if (twice[i] !== raw[33 + i]) return refusal("ccd/address-malformed");
  return raw.slice(1, 33);
}

/** The 37 bytes a base58 account address decodes to, when their version byte is 1; the checksum is not checked. */
function accountShape(s: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof s !== "string" || s.length === 0 || s.length > CCD_MAX_ADDRESS) return null;
  let n = 0n;
  for (const c of s) {
    const d = BASE58.indexOf(c);
    if (d < 0) return null;
    n = n * 58n + BigInt(d);
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const body: number[] = [];
  while (n > 0n) {
    body.push(Number(n & 0xffn));
    n >>= 8n;
  }
  const out = new Uint8Array(zeros + body.length);
  for (let i = 0; i < body.length; i++) out[out.length - 1 - i] = body[i]!;
  return out.length === 37 && out[0] === 0x01 ? out : null;
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The base58check text of a 32-byte account address under version byte 1: the inverse of `accountBytes`. */
export function accountText(account: Uint8Array): string {
  const raw = new Uint8Array(37);
  raw[0] = 0x01;
  raw.set(account.subarray(0, 32), 1);
  raw.set(sha256(sha256(raw.subarray(0, 33))).subarray(0, 4), 33);
  let n = 0n;
  for (const b of raw) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)]! + out;
    n /= 58n;
  }
  for (let i = 0; i < raw.length && raw[i] === 0; i++) out = "1" + out;
  return out;
}

/**
 * Whether two account addresses name one account: their first 29 bytes are equal, the last three naming an alias of
 * the same account (`concordium-base`, `Concordium/Types.hs`, `AccountAddressEq`, `accountAddressPrefixSize`).
 */
export function sameAccount(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null || a.length !== 32 || b.length !== 32) return false;
  for (let i = 0; i < 29; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The payload type tags the chain writes (`putPayload` in `concordium-base` `Concordium/Types/Execution.hs` at
 * `3e76777e`). A payload whose first byte is another is one the read cannot decode.
 */
const PAYLOAD_TAGS: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);

/** A signed payload as the read decodes it from the protocol's binary form. */
export type CcdPayload =
  /** `transferWithMemo` (22): one CCD transfer. */
  | { readonly kind: "ccd"; readonly receiver: Uint8Array; readonly memo: Uint8Array; readonly amount: bigint }
  /** `tokenUpdate` (27): its token id and each `transfer` operation's recipient and memo, and whether it holds others. */
  | {
      readonly kind: "plt";
      readonly tokenId: string;
      readonly transfers: readonly { readonly receiver: Uint8Array | null; readonly memo: Uint8Array | null }[];
      readonly others: boolean;
    }
  /** An encrypted (23) or scheduled (24) transfer with a memo: another kind of act, its receiver and memo read. */
  | { readonly kind: "memo"; readonly receiver: Uint8Array; readonly memo: Uint8Array }
  /** Any other payload type the chain writes, which carries no memo. */
  | { readonly kind: "other" };

/**
 * Decodes a signed payload in the protocol's binary form: the type's byte, then for `transferWithMemo` the receiver's
 * 32 bytes, the memo (a 2-byte big-endian length, at most 256 bytes) and the amount (8 bytes big-endian), and for
 * `tokenUpdate` the token id (a 1-byte length) and the operations (a 4-byte big-endian length, then CBOR)
 * (`concordium-base` `Execution.hs:776-780`, `:829-832`; `Memo.hs:56-59`; `Tokens.hs:53-56`; `Types.hs:1185-1191`).
 * Null where the type is not one the chain writes, or the bytes are not that type's form.
 */
export function decodePayload(p: Uint8Array): CcdPayload | null {
  if (!(p instanceof Uint8Array) || p.length === 0) return null;
  const tag = p[0]!;
  if (!PAYLOAD_TAGS.has(tag)) return null;
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  if (tag === 22 || tag === 23 || tag === 24) {
    if (p.length < 35) return null;
    const n = view.getUint16(33);
    if (n > CCD_MAX_MEMO || p.length < 35 + n) return null;
    const receiver = p.slice(1, 33);
    const memo = p.slice(35, 35 + n);
    if (tag !== 22) return { kind: "memo", receiver, memo };
    if (p.length !== 35 + n + 8) return null;
    return { kind: "ccd", receiver, memo, amount: view.getBigUint64(35 + n) };
  }
  if (tag === 27) {
    if (p.length < 2) return null;
    const idLength = p[1]!;
    if (p.length < 2 + idLength + 4) return null;
    const tokenId = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let id: string;
    try {
      id = tokenId.decode(p.subarray(2, 2 + idLength));
    } catch {
      return null;
    }
    const opsLength = view.getUint32(2 + idLength);
    if (p.length !== 2 + idLength + 4 + opsLength) return null;
    const ops = decodeCbor(p.subarray(2 + idLength + 4));
    if (ops === null || !Array.isArray(ops)) return null;
    const transfers: { receiver: Uint8Array | null; memo: Uint8Array | null }[] = [];
    let others = false;
    for (const op of ops as readonly Cbor[]) {
      if (!isMap(op) || op.map.length !== 1 || op.map[0]![0] !== "transfer" || !isMap(op.map[0]![1])) {
        others = true;
        continue;
      }
      transfers.push(tokenTransferOf(op.map[0]![1]));
    }
    return { kind: "plt", tokenId: id, transfers, others };
  }
  return { kind: "other" };
}

/** A token `transfer` operation's recipient (the tag-40307 map's key 3) and memo, tag 24 around a byte string removed. */
function tokenTransferOf(body: Cbor): { receiver: Uint8Array | null; memo: Uint8Array | null } {
  if (!isMap(body)) return { receiver: null, memo: null };
  const recipient = mapGet(body, "recipient");
  const account = recipient !== undefined && isTag(recipient, 40307n) && isMap(recipient.value) ? mapGet(recipient.value, 3n) : undefined;
  const memo = mapGet(body, "memo");
  const bytes = memo !== undefined && isTag(memo, 24n) ? memo.value : memo;
  return {
    receiver: account instanceof Uint8Array && account.length === 32 ? account : null,
    memo: bytes instanceof Uint8Array ? bytes : null,
  };
}

/** Whether `memoCarrier` reads the memo as `h`. */
export function memoCarries(memo: Uint8Array | null, h: AtrHash): boolean {
  if (memo === null) return false;
  const got = memoCarrier(memo);
  return !isRefusal(got) && hashEquals(got, h);
}

/** The members of an account transaction the sender signs, as the read compares them with the payment presented. */
export interface CcdSignedMembers {
  readonly sender: Uint8Array;
  readonly nonce: bigint;
  readonly expiry: bigint;
  readonly energy: bigint;
  readonly sponsor: Uint8Array | null;
  readonly payload: Uint8Array;
}

/**
 * The energy in the header the sender signs, which no member of x402's wire form holds: the wallet computes it at
 * signing from `executionEnergyAmount`, the transaction-specific cost, as 100 for each signature, the sender's and the
 * sponsor's, plus 1 for each byte of the sponsored header (a 2-byte bitmap, the 60-byte account transaction header and
 * the sponsor's 32 bytes) and of the payload, plus that cost (`@concordium/web-sdk` 12.0.2,
 * `src/transactions/Transaction/finalized.ts:12-16`, `src/transactions/Transaction/builder.ts:620-631`,
 * `src/transactions/AccountTransactionV1.ts:220-249`, `src/energyCost.ts:16-17`). A node's block item gives that value
 * as its header's `energy_amount`.
 */
export function signedEnergy(execution: bigint, signatures: bigint, payloadSize: number): bigint {
  return 100n * signatures + BigInt(SPONSORED_HEADER + payloadSize) + execution;
}
/** A sponsored account transaction's header, in bytes: the bitmap, the account transaction header and the sponsor. */
const SPONSORED_HEADER = 2 + 60 + 32;

/**
 * The digest of what the sender signed, its signatures apart: SHA-256 over the sender's 32 bytes, the sequence number,
 * the expiry and the energy as 8-byte big-endian integers, a byte 1 and the sponsor's 32 bytes (a byte 0 where it names
 * none), and the payload in the protocol's binary form. Two transactions with one digest are one signed message.
 */
export async function signedDigest(m: CcdSignedMembers): Promise<Hex> {
  const head = new Uint8Array(32 + 24 + 1 + (m.sponsor === null ? 0 : 32));
  const view = new DataView(head.buffer);
  head.set(m.sender.subarray(0, 32), 0);
  view.setBigUint64(32, m.nonce);
  view.setBigUint64(40, m.expiry);
  view.setBigUint64(48, m.energy);
  head[56] = m.sponsor === null ? 0 : 1;
  if (m.sponsor !== null) head.set(m.sponsor.subarray(0, 32), 57);
  return (await hash(concat(head, m.payload))) as Hex;
}

/** A transfer's memo bytes as its event gives them, with a token memo's CBOR tag 24 around a byte string removed. */
export function transferMemo(t: { readonly kind: "ccd" | "plt"; readonly memo: Uint8Array | null }): Uint8Array | null {
  const m = t.memo;
  if (m === null || t.kind !== "plt") return m;
  const v = decodeCbor(m);
  return v !== null && isTag(v, 24n) && v.value instanceof Uint8Array ? v.value : m;
}
