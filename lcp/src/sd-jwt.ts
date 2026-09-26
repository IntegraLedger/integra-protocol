/**
 * The SD-JWT reader: RFC 9901 §7.1 steps 1 and 3–5, without step 2's signature check. It splits a presentation into
 * the issuer-signed JWT, its disclosures and an optional Key Binding JWT, and resolves the disclosures into the issuer
 * payload by digest. Every disclosure must be referenced, and no digest may be referenced twice. One allowance: a
 * digest in an object's `_sd` that does not name a three-element disclosure is ignored there, whether it names a
 * two-element disclosure or none. Refusal codes are the caller's.
 */
import { MAX_JSON_DEPTH, type Json } from "./core.js";
import { refusal, type Refusal } from "./refusal.js";

type JsonObject = { [k: string]: Json };

/** The refusal each failure class returns, as the calling entry point names it. */
export interface SdJwtCodes {
  malformed: string;
  sdAlgUnsupported: string;
  unreferenced: string;
  tooLarge: string;
}

export interface SdJwtBounds {
  maxBytes: number;
  maxDisclosures: number;
}

export interface SdJwt {
  /** The issuer-signed JWT, as received. */
  jwt: string;
  header: JsonObject;
  /** The issuer-signed payload, as decoded. */
  payload: JsonObject;
  /** The payload with every referenced disclosure resolved, `_sd` removed, and the top-level `_sd_alg` removed. */
  resolved: JsonObject;
  /** The disclosures, as received, in order. */
  disclosures: readonly string[];
  /** The Key Binding JWT, as received and never read, or null. */
  keyBinding: string | null;
}

const MIB = 1_048_576;
export const RESOLUTION_DEPTH = 16;
const DEFAULT_BOUNDS: SdJwtBounds = { maxBytes: MIB, maxDisclosures: 128 };
const PRESENTATION = /^[A-Za-z0-9_.~-]*$/;
const SEGMENT = /^[A-Za-z0-9_-]*$/;

const ascii = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** base64url without padding (RFC 4648 §5) of `bytes`. */
export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The bytes of unpadded base64url text, or null when it is not that. */
export function b64urlDecode(s: string): Uint8Array | null {
  if (typeof s !== "string" || !SEGMENT.test(s) || s.length % 4 === 1) return null;
  let bin: string;
  try {
    bin = atob(s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4));
  } catch {
    return null;
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64url, unpadded, of SHA-256 over the US-ASCII characters of `s` (RFC 9901 §4.2.3). */
export async function disclosureDigest(s: string): Promise<string> {
  return b64urlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", ascii.encode(s))));
}

/** The JSON value that unpadded base64url text decodes to as fatal UTF-8, or null. */
export function decodeJsonSegment(s: string): Json | null {
  const bytes = b64urlDecode(s);
  if (bytes === null) return null;
  try {
    return JSON.parse(utf8.decode(bytes)) as Json;
  } catch {
    return null;
  }
}

/** The three segments of a compact JWS, each unpadded base64url, or null. */
export function jwsSegments(s: string): [header: string, payload: string, signature: string] | null {
  if (typeof s !== "string") return null;
  const parts = s.split(".");
  if (parts.length !== 3) return null;
  for (const p of parts) if (!SEGMENT.test(p) || p.length % 4 === 1) return null;
  return parts as [string, string, string];
}

/** True when `v` nests no deeper than `max` levels of arrays and objects. */
export function withinDepth(v: Json, max: number = MAX_JSON_DEPTH): boolean {
  const walk = (x: Json, depth: number): boolean => {
    if (x === null || typeof x !== "object") return true;
    if (depth >= max) return false;
    const children = Array.isArray(x) ? (x as readonly Json[]) : Object.values(x as JsonObject);
    for (const c of children) if (!walk(c, depth + 1)) return false;
    return true;
  };
  return walk(v, 0);
}

export function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Adds `k` as an own data member, so that a name such as `__proto__` is a member like any other. */
function setOwn(o: JsonObject, k: string, v: Json): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
}

interface Disclosure {
  name: string | undefined;
  value: Json;
  used: boolean;
}

/** Reads an SD-JWT presentation and resolves its disclosures. No signature is verified. */
export async function readSdJwt(
  token: unknown,
  codes: SdJwtCodes,
  bounds: SdJwtBounds = DEFAULT_BOUNDS,
): Promise<SdJwt | Refusal> {
  const malformed = refusal(codes.malformed);
  if (typeof token !== "string") return malformed;
  if (token.length > bounds.maxBytes) return refusal(codes.tooLarge);
  if (!PRESENTATION.test(token)) return malformed;

  const parts = token.split("~");
  if (parts.length < 2) return malformed;
  const jwt = parts[0]!;
  const last = parts[parts.length - 1]!;
  const keyBinding = last === "" ? null : last.includes(".") ? last : undefined;
  if (keyBinding === undefined) return malformed;
  const disclosures = parts.slice(1, -1);
  if (disclosures.length > bounds.maxDisclosures) return refusal(codes.tooLarge);

  const segments = jwsSegments(jwt);
  if (segments === null) return malformed;
  const header = decodeJsonSegment(segments[0]);
  const payload = decodeJsonSegment(segments[1]);
  if (!isJsonObject(header) || !isJsonObject(payload)) return malformed;
  if (!withinDepth(header) || !withinDepth(payload)) return refusal(codes.tooLarge);

  const alg = payload["_sd_alg"];
  if (alg !== undefined && alg !== "sha-256") return refusal(codes.sdAlgUnsupported);

  const byDigest = new Map<string, Disclosure>();
  for (const d of disclosures) {
    if (d === "") return malformed;
    const decoded = decodeJsonSegment(d);
    if (!Array.isArray(decoded)) return malformed;
    const arr = decoded as readonly Json[];
    if (!withinDepth(decoded)) return refusal(codes.tooLarge);
    let disclosure: Disclosure;
    if (arr.length === 3 && typeof arr[0] === "string" && typeof arr[1] === "string") {
      disclosure = { name: arr[1], value: arr[2]!, used: false };
    } else if (arr.length === 2 && typeof arr[0] === "string") {
      disclosure = { name: undefined, value: arr[1]!, used: false };
    } else {
      return malformed;
    }
    const digest = await disclosureDigest(d);
    if (byDigest.has(digest)) return malformed;
    byDigest.set(digest, disclosure);
  }

  const referenced = new Set<string>();
  type Outcome = { ok: true; value: Json } | { ok: false; code: string };
  const fail = (code: string): Outcome => ({ ok: false, code });

  const resolve = (v: Json, level: number): Outcome => {
    if (v === null || typeof v !== "object") return { ok: true, value: v };
    if (Array.isArray(v)) {
      const out: Json[] = [];
      for (const el of v as readonly Json[]) {
        if (isJsonObject(el) && Object.keys(el).length === 1 && "..." in el) {
          const digest = el["..."];
          if (typeof digest !== "string") return fail(codes.malformed);
          if (referenced.has(digest)) return fail(codes.malformed);
          referenced.add(digest);
          const d = byDigest.get(digest);
          if (d === undefined) continue;
          if (d.name !== undefined) return fail(codes.malformed);
          d.used = true;
          if (level + 1 > RESOLUTION_DEPTH) return fail(codes.tooLarge);
          const r = resolve(d.value, level + 1);
          if (!r.ok) return r;
          out.push(r.value);
        } else {
          const r = resolve(el, level);
          if (!r.ok) return r;
          out.push(r.value);
        }
      }
      return { ok: true, value: out };
    }

    const o = v as JsonObject;
    const out: JsonObject = {};
    for (const [k, x] of Object.entries(o)) {
      if (k === "_sd") continue;
      const r = resolve(x, level);
      if (!r.ok) return r;
      setOwn(out, k, r.value);
    }
    const sd = o["_sd"];
    if (sd === undefined) return { ok: true, value: out };
    if (!Array.isArray(sd)) return fail(codes.malformed);
    for (const digest of sd as readonly Json[]) {
      if (typeof digest !== "string") return fail(codes.malformed);
      const d = byDigest.get(digest);
      if (d === undefined || d.name === undefined) continue;
      if (referenced.has(digest)) return fail(codes.malformed);
      referenced.add(digest);
      const name = d.name;
      if (name === "_sd" || name === "..." || Object.hasOwn(out, name)) return fail(codes.malformed);
      d.used = true;
      if (level + 1 > RESOLUTION_DEPTH) return fail(codes.tooLarge);
      const r = resolve(d.value, level + 1);
      if (!r.ok) return r;
      setOwn(out, name, r.value);
    }
    return { ok: true, value: out };
  };

  const r = resolve(payload, 0);
  if (!r.ok) return refusal(r.code);
  for (const d of byDigest.values()) if (!d.used) return refusal(codes.unreferenced);
  const resolved = r.value as JsonObject;
  delete resolved["_sd_alg"];
  return { jwt, header, payload, resolved, disclosures, keyBinding };
}
