/**
 * base64url without padding (RFC 4648 §5), the base64url of RFC 7515 §2. It is written with zero bits past the last
 * byte, and read only in its canonical form (RFC 4648 §3.5): the URL-safe alphabet alone, no `=` padding, a length that
 * is not 1 mod 4, and zero bits past the last whole byte in the last character.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE: { [c: number]: number } = Object.fromEntries([...ALPHABET].map((c, i) => [c.charCodeAt(0), i]));
/** The bits of the last character past the last whole byte, by the text's length mod 4. */
const SPARE = [0, 0, 0x0f, 0x03] as const;

/** base64url without padding of `b`, with zero bits past its last byte. */
export function b64uEncode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    const chars = i + 1 >= b.length ? 2 : i + 2 >= b.length ? 3 : 4;
    for (let k = 0; k < chars; k++) s += ALPHABET[(n >> (18 - 6 * k)) & 63];
  }
  return s;
}

/** True when `s` is base64url without padding in its canonical form. */
export function isB64u(s: unknown): s is string {
  if (typeof s !== "string" || s.length % 4 === 1) return false;
  for (let i = 0; i < s.length; i++) if (VALUE[s.charCodeAt(i)] === undefined) return false;
  return s.length === 0 || (VALUE[s.charCodeAt(s.length - 1)]! & SPARE[s.length % 4]!) === 0;
}

/**
 * The bytes of `s`, base64url without padding in its canonical form, when they number at most `maxBytes`: the length
 * is checked before anything is decoded. Anything else is undefined.
 */
export function b64uDecode(s: unknown, maxBytes: number = Number.POSITIVE_INFINITY): Uint8Array | undefined {
  if (typeof s !== "string" || s.length > Math.ceil((maxBytes * 4) / 3) || !isB64u(s)) return undefined;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    acc = ((acc << 6) | VALUE[s.charCodeAt(i)]!) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
