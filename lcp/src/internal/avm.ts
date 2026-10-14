/**
 * The x402 payment an Algorand payer presents, and the msgpack scan run on a payment entry before it is decoded.
 * `../avm.ts` returns the payment from `complete` and runs the scan in `avmCarrier`, with `MSGPACK_MAX_DEPTH` as the
 * depth; the root names the payment among the payments `Presented` covers. No entry point exports either name.
 */
import type { AvmPresented } from "../avm.js";
import type { X402Payment } from "./x402.js";

export type AvmPaymentPayload = X402Payment<AvmPresented>;

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The longest string, in bytes, that algosdk 3.8.0's msgpack decoder, algorand-msgpack 1.1.0, reads with its own UTF-8
 * reader, which keeps a leading byte-order mark. A longer string, a map key or a value, it reads with a TextDecoder that
 * is not fatal and drops a leading mark (algorand-msgpack 1.1.0, `src/utils/utf8.ts:160-177`, called from
 * `src/Decoder.ts:762-766`).
 */
const MSGPACK_TEXT_DECODER_THRESHOLD = 200;

/**
 * True when `b` is exactly one msgpack value (the msgpack specification's formats) whose arrays and maps nest at most
 * `maxDepth` deep, whose every declared length (a string's, binary's or extension's bytes, an array's elements, a
 * map's keys and values) is no more than the bytes that remain, so no count is trusted past the input, and whose every
 * string (fixstr, str 8, str 16 or str 32; a map key or a value, at any depth) is well-formed UTF-8 (RFC 3629) and is
 * read by algosdk's decoder as the text its bytes spell: no string longer than `MSGPACK_TEXT_DECODER_THRESHOLD` bytes
 * begins with the byte-order mark EF BB BF, which that decoder drops from such a string. The value is scanned, never
 * built.
 */
export function msgpackWithinCaps(b: Uint8Array, maxDepth: number): boolean {
  const n = b.length;
  let i = 0;
  /** For each open array or map, the values still to come in it. */
  const pending: number[] = [];
  let opened = false;
  const uint = (width: number): number | undefined => {
    if (i + width > n) return undefined;
    let v = 0;
    for (let k = 0; k < width; k++) v = v * 256 + b[i + k]!;
    i += width;
    return v;
  };
  const skip = (length: number | undefined): boolean => {
    if (length === undefined || length > n - i) return false;
    i += length;
    return true;
  };
  const text = (length: number | undefined): boolean => {
    const start = i;
    if (!skip(length)) return false;
    const s = b.subarray(start, i);
    if (s.length > MSGPACK_TEXT_DECODER_THRESHOLD && s[0] === 0xef && s[1] === 0xbb && s[2] === 0xbf) return false;
    try {
      UTF8.decode(s);
      return true;
    } catch {
      return false;
    }
  };
  const open = (values: number | undefined): boolean => {
    if (values === undefined || values > n - i || pending.length + 1 > maxDepth) return false;
    if (values > 0) {
      pending.push(values);
      opened = true;
    }
    return true;
  };
  const withType = (length: number | undefined): number | undefined => (length === undefined ? undefined : length + 1);
  do {
    if (i >= n) return false;
    const t = b[i++]!;
    opened = false;
    let ok: boolean;
    if (t <= 0x7f || t >= 0xe0 || t === 0xc0 || t === 0xc2 || t === 0xc3) ok = true;
    else if (t <= 0x8f) ok = open(2 * (t & 0x0f));
    else if (t <= 0x9f) ok = open(t & 0x0f);
    else if (t <= 0xbf) ok = text(t & 0x1f);
    else if (t === 0xc4) ok = skip(uint(1));
    else if (t === 0xc5) ok = skip(uint(2));
    else if (t === 0xc6) ok = skip(uint(4));
    else if (t === 0xd9) ok = text(uint(1));
    else if (t === 0xda) ok = text(uint(2));
    else if (t === 0xdb) ok = text(uint(4));
    else if (t === 0xc7) ok = skip(withType(uint(1)));
    else if (t === 0xc8) ok = skip(withType(uint(2)));
    else if (t === 0xc9) ok = skip(withType(uint(4)));
    else if (t === 0xca) ok = skip(4);
    else if (t === 0xcb) ok = skip(8);
    else if (t >= 0xcc && t <= 0xcf) ok = skip(1 << (t - 0xcc));
    else if (t >= 0xd0 && t <= 0xd3) ok = skip(1 << (t - 0xd0));
    else if (t >= 0xd4 && t <= 0xd8) ok = skip((1 << (t - 0xd4)) + 1);
    else if (t === 0xdc) ok = open(uint(2));
    else if (t === 0xdd) ok = open(uint(4));
    else if (t === 0xde) ok = open(2 * (uint(2) ?? n));
    else if (t === 0xdf) ok = open(2 * (uint(4) ?? n));
    else ok = false;
    if (!ok) return false;
    if (opened) continue;
    while (pending.length > 0) {
      const top = pending.length - 1;
      pending[top] = pending[top]! - 1;
      if (pending[top]! > 0) break;
      pending.pop();
    }
  } while (pending.length > 0);
  return i === n;
}
