/**
 * Byte helpers shared by the rail entry points: padded standard base64 read in its canonical form only, lowercase hex,
 * and fixed-width integers. The base64 reader and writer each make one pass over their input, in constant stack,
 * whatever its length.
 */

/** A base64 alphabet: each value's character code, and each character code's value or -1. */
interface Alphabet {
  readonly codes: Uint8Array;
  readonly values: Int8Array;
}

function alphabetOf(chars: string): Alphabet {
  const codes = new TextEncoder().encode(chars);
  const values = new Int8Array(128).fill(-1);
  for (let v = 0; v < codes.length; v++) values[codes[v]!] = v;
  return { codes, values };
}

/** RFC 4648 §4's alphabet. */
const STANDARD = alphabetOf("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
const PAD = 0x3d;
/** The written characters, all ASCII, read back as text. */
const ascii = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The bytes the first `n` characters of `s` spell in `alphabet`, or null when one of them is outside it, when `n` is
 * one more than a multiple of four, or when the last character has a bit set past the last whole byte (RFC 4648 §3.5).
 */
function decode(s: string, n: number, alphabet: Alphabet): Uint8Array | null {
  if (n % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((n * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? alphabet.values[c]! : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = acc >> bits;
      acc &= (1 << bits) - 1;
    }
  }
  return acc === 0 ? out : null;
}

/**
 * `b` in `alphabet`, with zero bits past its last byte, and `=` padding to a multiple of four characters when `pad`.
 */
function encode(b: Uint8Array, alphabet: Alphabet, pad: boolean): string {
  const tail = b.length % 3;
  const whole = b.length - tail;
  const out = new Uint8Array((whole / 3) * 4 + (tail === 0 ? 0 : pad ? 4 : tail + 1));
  const { codes } = alphabet;
  let o = 0;
  for (let i = 0; i < whole; i += 3) {
    const n = (b[i]! << 16) | (b[i + 1]! << 8) | b[i + 2]!;
    out[o++] = codes[n >> 18]!;
    out[o++] = codes[(n >> 12) & 63]!;
    out[o++] = codes[(n >> 6) & 63]!;
    out[o++] = codes[n & 63]!;
  }
  if (tail !== 0) {
    const n = (b[whole]! << 16) | (tail === 2 ? b[whole + 1]! << 8 : 0);
    out[o++] = codes[n >> 18]!;
    out[o++] = codes[(n >> 12) & 63]!;
    if (tail === 2) out[o++] = codes[(n >> 6) & 63]!;
    if (pad) out.fill(PAD, o);
  }
  return ascii.decode(out);
}

/**
 * The bytes of `s` when it is padded standard base64 (RFC 4648 §4) in its canonical form (RFC 4648 §3.5), or null: the
 * standard alphabet, `=` padding to a multiple of four characters, and zero bits past the last whole byte in the last
 * character before the padding. A text whose last character before the padding has a bit set past the last byte is not
 * that form. Every rail's standard base64 is read by this one function, in one pass over the text.
 */
export function fromBase64(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || s.length % 4 !== 0) return null;
  return decode(s, s.endsWith("==") ? s.length - 2 : s.endsWith("=") ? s.length - 1 : s.length, STANDARD);
}

/**
 * The bytes of `s` as `fromBase64` reads them, or "too-large" when they would be more than `maxBytes`, or "malformed".
 * The size is read from the text's length before anything is decoded, so a text past the bound is never decoded.
 */
export function base64Bytes(s: unknown, maxBytes: number): Uint8Array | "too-large" | "malformed" {
  if (typeof s !== "string") return "malformed";
  if (s.length % 4 !== 0) return "malformed";
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  if ((s.length / 4) * 3 - pad > maxBytes) return "too-large";
  return fromBase64(s) ?? "malformed";
}

/**
 * Padded standard base64 (RFC 4648 §4) of `b`, in the canonical form `fromBase64` reads, in one pass over the bytes.
 */
export function toBase64(b: Uint8Array): string {
  return encode(b, STANDARD, true);
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
