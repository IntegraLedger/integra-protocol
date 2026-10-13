/**
 * The x402 payment an Algorand payer presents, and the msgpack scan run on a payment entry before it is decoded.
 * `../avm.ts` returns the payment from `complete` and runs the scan in `avmCarrier`, with `MSGPACK_MAX_DEPTH` as the
 * depth; the root names the payment among the payments `Presented` covers. No entry point exports either name.
 */
import type { AvmPresented } from "../avm.js";
import type { X402Payment } from "./x402.js";

export type AvmPaymentPayload = X402Payment<AvmPresented>;

/**
 * True when `b` is exactly one msgpack value (the msgpack specification's formats) whose arrays and maps nest at most
 * `maxDepth` deep, and whose every declared length (a string's, binary's or extension's bytes, an array's elements, a
 * map's keys and values) is no more than the bytes that remain, so no count is trusted past the input. The value is
 * scanned, never built.
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
    else if (t <= 0xbf) ok = skip(t & 0x1f);
    else if (t === 0xc4 || t === 0xd9) ok = skip(uint(1));
    else if (t === 0xc5 || t === 0xda) ok = skip(uint(2));
    else if (t === 0xc6 || t === 0xdb) ok = skip(uint(4));
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
