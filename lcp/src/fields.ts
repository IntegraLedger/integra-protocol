/** Shape checks for JSON objects, EVM and hash values, shared by the entry points. */
import { canonicalJson, fromRawBytes, MAX_JSON_DEPTH, toRawBytes, type AtrHash, type Json } from "./internal/core.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const NETWORK = /^eip155:([1-9][0-9]{0,15})$/;
const DECIMAL = /^[0-9]{1,78}$/;
export const UINT256_LIMIT = 1n << 256n;

/** The decimal chain id of an `eip155:<decimal>` network, or undefined. */
export function chainIdOf(network: unknown): number | undefined {
  const m = typeof network === "string" ? NETWORK.exec(network) : null;
  if (m === null) return undefined;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** A string of decimal digits below 2^256 as a bigint, or undefined. */
export function uint256Of(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !DECIMAL.test(value)) return undefined;
  const v = BigInt(value);
  return v < UINT256_LIMIT ? v : undefined;
}

export function isUint256(v: unknown): v is bigint {
  return typeof v === "bigint" && v >= 0n && v < UINT256_LIMIT;
}

export function isAddress(s: unknown): s is `0x${string}` {
  return typeof s === "string" && ADDRESS.test(s);
}

/** The lowercase form of a 32-byte hash written as `0x` and 64 hex digits in either case, or null. */
export function normalHash(h: unknown): AtrHash | null {
  if (typeof h !== "string" || !HASH.test(h)) return null;
  return fromRawBytes(toRawBytes(h as AtrHash));
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reads a reader's not-found answer, `{ notFound: true, [key]: point }`, where the point is how far the answering
 * source had read: undefined when `v` is not a not-found answer, else its point, or null when it names none.
 */
export function notFoundPoint(v: unknown, key: string): bigint | null | undefined {
  if (!isObject(v) || v["notFound"] !== true) return undefined;
  const point = v[key];
  return typeof point === "bigint" ? point : null;
}

/** Freezes `v` and everything reachable from it. */
export function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** True when `a` and `b` are both JSON values with the same RFC 8785 form. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false;
  const x = canonicalJson(a as Json);
  const y = canonicalJson(b as Json);
  return typeof x === "string" && x === y;
}

const utf8 = new TextEncoder();

/**
 * The UTF-8 length of `v` written by `JSON.stringify`, or undefined when `v` cannot be written. A value in which
 * objects and arrays nest more than 64 levels measures `Infinity`, over every size limit: the walk stops at the 65th
 * level, so the answer is the same on every host, whatever its stack.
 */
export function jsonBytes(v: unknown): number | undefined {
  const levels = new WeakMap<object, number>();
  let deep = false;
  try {
    const s = JSON.stringify(v, function (this: object, _key: string, value: unknown): unknown {
      if (typeof value !== "object" || value === null) return value;
      const level = (levels.get(this) ?? 0) + 1;
      if (level > MAX_JSON_DEPTH) {
        deep = true;
        throw new RangeError("nested too deep");
      }
      levels.set(value, level);
      return value;
    });
    return typeof s === "string" ? utf8.encode(s).length : undefined;
  } catch {
    return deep ? Number.POSITIVE_INFINITY : undefined;
  }
}
