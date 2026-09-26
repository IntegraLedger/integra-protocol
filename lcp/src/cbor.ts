/**
 * A bounded reader of one CBOR data item (RFC 8949): definite lengths only, at most 8 levels of nesting and 256
 * items. Integers are bigints, byte strings are bytes, text is checked UTF-8 with every character kept (a leading
 * U+FEFF included), maps keep their pairs in order and a map with two equal keys is malformed, tags are kept as
 * `{tag, value}`, and a simple value other than false, true, null and undefined is kept as `{simple}`.
 */

export type Cbor =
  | bigint
  | number
  | boolean
  | null
  | undefined
  | string
  | Uint8Array
  | readonly Cbor[]
  | CborMap
  | CborTag
  | CborSimple;
export interface CborMap {
  readonly map: readonly (readonly [Cbor, Cbor])[];
}
export interface CborTag {
  readonly tag: bigint;
  readonly value: Cbor;
}
export interface CborSimple {
  readonly simple: number;
}

const MAX_DEPTH = 8;
const MAX_ITEMS = 256;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

class Malformed extends Error {}

/** The one data item `b` holds, with nothing after it, or null when `b` is anything else. */
export function decodeCbor(b: Uint8Array): Cbor | null {
  const state = { at: 0, items: 0 };
  try {
    const v = item(b, state, 0);
    return state.at === b.length ? v : null;
  } catch (e) {
    if (e instanceof Malformed) return null;
    throw e;
  }
}

export function isTag(v: Cbor, tag: bigint): v is CborTag {
  return typeof v === "object" && v !== null && "tag" in v && v.tag === tag;
}

export function isMap(v: Cbor): v is CborMap {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array) && "map" in v;
}

/** The value under `key` in a map, or undefined when the key is absent. */
export function mapGet(m: CborMap, key: string | bigint): Cbor | undefined {
  for (const [k, v] of m.map) if (k === key) return v;
  return undefined;
}

function item(b: Uint8Array, s: { at: number; items: number }, depth: number): Cbor {
  if (depth > MAX_DEPTH) throw new Malformed();
  if (++s.items > MAX_ITEMS) throw new Malformed();
  const head = byte(b, s);
  const major = head >> 5;
  const info = head & 0x1f;

  if (major === 7) return simple(b, s, info);
  const arg = argument(b, s, info);
  switch (major) {
    case 0:
      return arg;
    case 1:
      return -1n - arg;
    case 2:
      return take(b, s, arg).slice();
    case 3:
      try {
        return utf8.decode(take(b, s, arg));
      } catch {
        throw new Malformed();
      }
    case 4: {
      const out: Cbor[] = [];
      for (let i = 0n; i < arg; i++) out.push(item(b, s, depth + 1));
      return out;
    }
    case 5: {
      const pairs: (readonly [Cbor, Cbor])[] = [];
      for (let i = 0n; i < arg; i++) {
        const key = item(b, s, depth + 1);
        if (pairs.some(([k]) => same(k, key))) throw new Malformed();
        pairs.push([key, item(b, s, depth + 1)]);
      }
      return { map: pairs };
    }
    default:
      return { tag: arg, value: item(b, s, depth + 1) };
  }
}

function argument(b: Uint8Array, s: { at: number }, info: number): bigint {
  if (info < 24) return BigInt(info);
  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
  if (width === 0) throw new Malformed();
  let v = 0n;
  for (const x of take(b, s, BigInt(width))) v = (v << 8n) | BigInt(x);
  return v;
}

function simple(b: Uint8Array, s: { at: number }, info: number): Cbor {
  if (info === 20) return false;
  if (info === 21) return true;
  if (info === 22) return null;
  if (info === 23) return undefined;
  if (info < 20) return { simple: info };
  if (info === 24) {
    const v = byte(b, s);
    if (v < 32) throw new Malformed();
    return { simple: v };
  }
  if (info === 25) return half(take(b, s, 2n));
  if (info === 26) return new DataView(take(b, s, 4n).slice().buffer).getFloat32(0);
  if (info === 27) return new DataView(take(b, s, 8n).slice().buffer).getFloat64(0);
  throw new Malformed();
}

/** Whether two decoded items are the same value in CBOR's data model. */
function same(a: Cbor, b: Cbor): boolean {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return typeof a === "number" && typeof b === "number" ? Object.is(a, b) : a === b;
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (isArray(a) || isArray(b)) {
    return isArray(a) && isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]!));
  }
  if (isMap(a) || isMap(b)) {
    if (!isMap(a) || !isMap(b) || a.map.length !== b.map.length) return false;
    const other = b.map;
    return a.map.every(([k, v]) => other.some(([k2, v2]) => same(k, k2) && same(v, v2)));
  }
  if ("tag" in a || "tag" in b) return "tag" in a && "tag" in b && a.tag === b.tag && same(a.value, b.value);
  return "simple" in a && "simple" in b && a.simple === b.simple;
}

function isArray(v: Cbor): v is readonly Cbor[] {
  return Array.isArray(v);
}

function half(x: Uint8Array): number {
  const h = (x[0]! << 8) | x[1]!;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  const v = exp === 0 ? mant * 2 ** -24 : exp !== 31 ? (mant + 1024) * 2 ** (exp - 25) : mant === 0 ? Infinity : NaN;
  return h & 0x8000 ? -v : v;
}

function byte(b: Uint8Array, s: { at: number }): number {
  if (s.at >= b.length) throw new Malformed();
  return b[s.at++]!;
}

function take(b: Uint8Array, s: { at: number }, n: bigint): Uint8Array {
  if (n > BigInt(b.length - s.at)) throw new Malformed();
  const out = b.subarray(s.at, s.at + Number(n));
  s.at += Number(n);
  return out;
}
