/**
 * Recursive-length prefix (RLP) encoding, strict and bounded. The decoder accepts only the canonical form: a single
 * byte below 0x80 stands for itself, a length uses the short form whenever it fits, and a long length has no leading
 * zero. Every decoded item keeps `raw`, its exact encoded bytes, so a caller can hash what was received.
 */
import { concat } from "./evm-abi.js";

export type RlpItem =
  | { kind: "bytes"; bytes: Uint8Array; raw: Uint8Array }
  | { kind: "list"; items: RlpItem[]; raw: Uint8Array };

/**
 * Decodes one item that spans all of `input`. The outermost list is at depth 0, and a list deeper than `maxDepth` is
 * refused. Returns undefined for anything that is not canonical RLP within that depth.
 */
export function rlpDecode(input: Uint8Array, maxDepth: number): RlpItem | undefined {
  const at = { pos: 0 };
  const item = readItem(input, at, input.length, 0, maxDepth);
  return item !== undefined && at.pos === input.length ? item : undefined;
}

function readItem(b: Uint8Array, at: { pos: number }, end: number, depth: number, maxDepth: number): RlpItem | undefined {
  const start = at.pos;
  if (start >= end) return undefined;
  const p = b[start]!;
  if (p < 0x80) {
    at.pos = start + 1;
    return { kind: "bytes", bytes: b.subarray(start, start + 1), raw: b.subarray(start, start + 1) };
  }
  let len: number;
  let head: number;
  if (p <= 0xb7 || (p >= 0xc0 && p <= 0xf7)) {
    len = p <= 0xb7 ? p - 0x80 : p - 0xc0;
    head = 1;
  } else {
    const lenOfLen = p <= 0xbf ? p - 0xb7 : p - 0xf7;
    if (start + 1 + lenOfLen > end || b[start + 1] === 0) return undefined;
    len = 0;
    for (let i = 0; i < lenOfLen; i++) {
      len = len * 256 + b[start + 1 + i]!;
      if (len > end) return undefined;
    }
    if (len <= 55) return undefined;
    head = 1 + lenOfLen;
  }
  const bodyStart = start + head;
  const bodyEnd = bodyStart + len;
  if (bodyEnd > end) return undefined;
  const raw = b.subarray(start, bodyEnd);
  if (p < 0xc0) {
    if (len === 1 && b[bodyStart]! < 0x80) return undefined;
    at.pos = bodyEnd;
    return { kind: "bytes", bytes: b.subarray(bodyStart, bodyEnd), raw };
  }
  if (depth > maxDepth) return undefined;
  const items: RlpItem[] = [];
  at.pos = bodyStart;
  while (at.pos < bodyEnd) {
    const item = readItem(b, at, bodyEnd, depth + 1, maxDepth);
    if (item === undefined) return undefined;
    items.push(item);
  }
  return { kind: "list", items, raw };
}

/** The unsigned integer in a canonical RLP byte string (no leading zero; empty is zero), up to 32 bytes. */
export function rlpUint(item: RlpItem | undefined): bigint | undefined {
  if (item === undefined || item.kind !== "bytes" || item.bytes.length > 32) return undefined;
  if (item.bytes.length > 0 && item.bytes[0] === 0) return undefined;
  let v = 0n;
  for (const x of item.bytes) v = (v << 8n) | BigInt(x);
  return v;
}

/** The encoding of a byte string. */
export function rlpBytes(b: Uint8Array): Uint8Array {
  if (b.length === 1 && b[0]! < 0x80) return b.slice();
  return concat([prefix(0x80, b.length), b]);
}

/** The encoding of an unsigned integer: its big-endian bytes without leading zeros. */
export function rlpUintBytes(v: bigint): Uint8Array {
  const out: number[] = [];
  let rest = v;
  while (rest > 0n) {
    out.unshift(Number(rest & 0xffn));
    rest >>= 8n;
  }
  return rlpBytes(Uint8Array.from(out));
}

/** The encoding of a list whose items are already encoded. */
export function rlpList(encodedItems: readonly Uint8Array[]): Uint8Array {
  const body = concat(encodedItems);
  return concat([prefix(0xc0, body.length), body]);
}

function prefix(base: 0x80 | 0xc0, len: number): Uint8Array {
  if (len <= 55) return Uint8Array.of(base + len);
  const lenBytes: number[] = [];
  let rest = len;
  while (rest > 0) {
    lenBytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Uint8Array.from([base + 55 + lenBytes.length, ...lenBytes]);
}
