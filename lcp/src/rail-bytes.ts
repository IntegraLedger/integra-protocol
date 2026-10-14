/**
 * Byte helpers shared by the rail entry points: padded standard base64 read in its canonical form only, lowercase hex,
 * and fixed-width integers.
 */

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * True when `s` is padded standard base64 (RFC 4648 §4) in its canonical form (RFC 4648 §3.5): the standard alphabet,
 * `=` padding to a multiple of four characters, and zero bits past the last whole byte in the last character before
 * the padding.
 */
function isBase64(s: unknown): s is string {
  if (typeof s !== "string" || !BASE64.test(s)) return false;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return pad === 0 || (ALPHABET.indexOf(s[s.length - pad - 1]!) & (pad === 2 ? 0x0f : 0x03)) === 0;
}

/**
 * The bytes of `s` when it is padded standard base64 (RFC 4648 §4) in its canonical form (RFC 4648 §3.5), or null: a
 * text whose last character before the padding has a bit set past the last byte is not that form. Every rail's
 * standard base64 is read here.
 */
export function fromBase64(s: unknown): Uint8Array | null {
  if (!isBase64(s)) return null;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The bytes of `s` as `fromBase64` reads them, or "too-large" when they would exceed `maxBytes`, or "malformed". The
 * length is checked before anything is decoded.
 */
export function base64Bytes(s: unknown, maxBytes: number): Uint8Array | "too-large" | "malformed" {
  if (typeof s !== "string") return "malformed";
  if (s.length % 4 !== 0) return "malformed";
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  if ((s.length / 4) * 3 - pad > maxBytes) return "too-large";
  return fromBase64(s) ?? "malformed";
}

/** Standard padded base64 of `b`. */
export function toBase64(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]!);
  return btoa(bin);
}

/** `0x` and lowercase hex. */
export function hexOf(b: Uint8Array): `0x${string}` {
  let s = "0x";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s as `0x${string}`;
}

/** Equality of two byte strings. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A decimal string below `limit`, or undefined. At most 78 digits are read. */
export function decimalBelow(v: unknown, limit: bigint): bigint | undefined {
  if (typeof v !== "string" || !/^[0-9]{1,78}$/.test(v)) return undefined;
  const n = BigInt(v);
  return n < limit ? n : undefined;
}

export const U64_LIMIT = 1n << 64n;

/** Lowercase hex of the bytes, without a prefix. */
export function hexDigits(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += (x < 16 ? "0" : "") + x.toString(16);
  return s;
}

/** The bytes of an even-length hex string in either case, without a prefix, or null. */
export function bytesOfHexDigits(s: string): Uint8Array | null {
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}
