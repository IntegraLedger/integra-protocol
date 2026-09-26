/**
 * Byte helpers for the EVM entry points: strict hex, 32-byte ABI words, and keccak-256. Nothing here allocates more
 * than its input's size and nothing throws on a caller's value: malformed input gives `undefined`.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";

export type Hex = `0x${string}`;

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const DIGITS = "0123456789abcdef";
const utf8 = new TextEncoder();

/** The bytes of `0x` and an even number of hex digits, or undefined. */
export function bytesOf(h: unknown, maxBytes = Number.MAX_SAFE_INTEGER): Uint8Array | undefined {
  if (typeof h !== "string" || h.length > 2 + 2 * maxBytes || !HEX.test(h)) return undefined;
  const out = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

/** `0x` and the bytes as lowercase hex. */
export function hexOf(b: Uint8Array): Hex {
  let s = "0x";
  for (const x of b) s += DIGITS[x >> 4]! + DIGITS[x & 15]!;
  return s as Hex;
}

/** keccak-256 of bytes or of a string's UTF-8. */
export function keccak(input: Uint8Array | string): Uint8Array {
  return keccak_256(typeof input === "string" ? utf8.encode(input) : input);
}

export function keccakHex(input: Uint8Array | string): Hex {
  return hexOf(keccak(input));
}

/** A uint256 as one 32-byte big-endian word. */
export function uintWord(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** An address (0x + 40 hex) as one word, left-padded with zeros. */
export function addressWord(a: Hex): Uint8Array {
  const out = new Uint8Array(32);
  out.set(bytesOf(a)!, 12);
  return out;
}

/** A 32-byte value (0x + 64 hex) as one word. */
export function bytes32Word(h: Hex): Uint8Array {
  return bytesOf(h)!;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The unsigned integer in a big-endian byte string. */
export function uintOf(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

/** Word `i` (32 bytes) of `data`, or undefined when it lies outside. */
export function wordAt(data: Uint8Array, i: number): Uint8Array | undefined {
  if (!Number.isSafeInteger(i) || i < 0 || 32 * (i + 1) > data.length) return undefined;
  return data.subarray(32 * i, 32 * (i + 1));
}

/** The address in a word whose first 12 bytes are zero, lowercase, or undefined. */
export function addressOfWord(w: Uint8Array): Hex | undefined {
  if (w.length !== 32) return undefined;
  for (let i = 0; i < 12; i++) if (w[i] !== 0) return undefined;
  return hexOf(w.subarray(12));
}

/** True when two hex strings encode the same bytes. */
export function sameBytes(a: unknown, b: unknown): boolean {
  const x = bytesOf(a);
  const y = bytesOf(b);
  if (x === undefined || y === undefined || x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
