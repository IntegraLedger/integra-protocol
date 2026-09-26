/**
 * The ATR's bytes and their hash.
 *
 * `assemble` writes one UTF-8 JSON object in a fixed order: `atrVersion`, `id`, the binding's slot, then each party
 * slot as the exact bytes received. The hash is SHA-256 over the bytes returned. Party content is checked for JSON
 * form only and is never parsed into values, re-serialised or canonicalised.
 */

/** `0x` followed by 64 hex digits. Every hash this module emits is lowercase. */
export type AtrHash = `0x${string}`;

/** A JSON value. Numbers in a binding value must be safe integers. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json };

export type CoreRefusal = {
  refused: true;
  code:
    | "core/slot-name"
    | "core/slot-reserved"
    | "core/slot-duplicate"
    | "core/content-not-json"
    | "core/binding-not-json"
    | "core/too-large";
};

const MIB = 1_048_576;
/** The deepest nesting of arrays and objects in any JSON this package writes or reads. */
export const MAX_JSON_DEPTH = 64;
const MAX_PARTY_SLOTS = 64;
const SLOT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_DIGITS = "0123456789abcdef";

const utf8 = new TextEncoder();

function refuse(code: CoreRefusal["code"]): CoreRefusal {
  return { refused: true, code };
}

/** A random RFC 9562 version 4 UUID, lowercase. */
export function newAtrId(): string {
  return crypto.randomUUID();
}

/**
 * Writes the ATR's bytes and hashes them. The same inputs always give the same bytes. Every problem with the inputs
 * is returned as a refusal.
 */
export async function assemble(
  id: string,
  binding: readonly [slot: string, value: Json],
  content: readonly (readonly [slot: string, bytes: Uint8Array])[],
  limits?: { maxBytes?: number },
): Promise<{ bytes: Uint8Array; atrHash: AtrHash } | CoreRefusal> {
  const maxBytes = limits?.maxBytes ?? MIB;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) return refuse("core/too-large");
  const limit = Math.min(maxBytes, MIB);

  const [bindingSlot, bindingValue] = binding;
  if (typeof bindingSlot !== "string" || !SLOT_NAME.test(bindingSlot)) return refuse("core/slot-name");
  if (bindingSlot === "atrVersion" || bindingSlot === "id") return refuse("core/slot-reserved");
  if (content.length > MAX_PARTY_SLOTS) return refuse("core/too-large");

  const seen = new Set<string>();
  for (const [slot, bytes] of content) {
    if (typeof slot !== "string" || !SLOT_NAME.test(slot)) return refuse("core/slot-name");
    if (slot === "atrVersion" || slot === "id" || slot === bindingSlot) return refuse("core/slot-reserved");
    if (seen.has(slot)) return refuse("core/slot-duplicate");
    seen.add(slot);
    if (!(bytes instanceof Uint8Array)) return refuse("core/content-not-json");
  }

  if (!isSerialisable(bindingValue, 0, true)) return refuse("core/binding-not-json");
  const head = utf8.encode(
    `{"atrVersion":"1","id":${JSON.stringify(String(id))},${JSON.stringify(bindingSlot)}:${JSON.stringify(bindingValue)}`,
  );

  const names = content.map(([slot]) => utf8.encode(`,${JSON.stringify(slot)}:`));
  let total = head.length + 1;
  for (let i = 0; i < content.length; i++) total += names[i]!.length + content[i]![1].length;
  if (total > limit) return refuse("core/too-large");

  for (const [, bytes] of content) {
    if (!isOneJsonValue(bytes)) return refuse("core/content-not-json");
  }

  const out = new Uint8Array(total);
  out.set(head, 0);
  let at = head.length;
  for (let i = 0; i < content.length; i++) {
    out.set(names[i]!, at);
    at += names[i]!.length;
    out.set(content[i]![1], at);
    at += content[i]![1].length;
  }
  out[at] = 0x7d;
  return { bytes: out, atrHash: await hash(out) };
}

/** SHA-256 over the bytes as given, as `0x` and lowercase hex. */
export async function hash(bytes: Uint8Array): Promise<AtrHash> {
  const view = bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return toHex(new Uint8Array(digest));
}

/**
 * SHA-256 over the RFC 8785 form of `v`. Refuses a value deeper than 64 levels, a non-finite number, a string with
 * an unpaired surrogate, or anything that is not a JSON value.
 */
export async function digestJson(v: Json): Promise<`0x${string}` | CoreRefusal> {
  const text = canonicalJson(v);
  if (typeof text !== "string") return text;
  return hash(utf8.encode(text));
}

/**
 * The RFC 8785 form of `v`: object members sorted by the UTF-16 code units of their names, recursively, and every
 * primitive written as `JSON.stringify` writes it. Refuses what `digestJson` refuses.
 */
export function canonicalJson(v: Json): string | CoreRefusal {
  if (!isSerialisable(v, 0, false)) return refuse("core/content-not-json");
  return canonical(v);
}

function canonical(v: Json): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${(v as readonly Json[]).map(canonical).join(",")}]`;
  const o = v as { readonly [k: string]: Json };
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k]!)}`).join(",")}}`;
}

/**
 * True when `v` is a JSON value that `JSON.stringify` writes exactly, with every string free of unpaired surrogates
 * and nesting at most 64 levels. With `integersOnly`, every number must be a safe integer; otherwise it must be
 * finite.
 */
function isSerialisable(v: unknown, depth: number, integersOnly: boolean): boolean {
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "string") return v.isWellFormed();
  if (typeof v === "number") return integersOnly ? Number.isSafeInteger(v) : Number.isFinite(v);
  if (typeof v !== "object") return false;
  if (depth >= MAX_JSON_DEPTH) return false;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v) || !isSerialisable(v[i], depth + 1, integersOnly)) return false;
    }
    return true;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(v).length > 0) return false;
  for (const k of Object.keys(v)) {
    if (!k.isWellFormed()) return false;
    if (!isSerialisable((v as Record<string, unknown>)[k], depth + 1, integersOnly)) return false;
  }
  return true;
}

/**
 * True when `b` is valid UTF-8 without a leading byte-order mark and holds exactly one RFC 8259 JSON value, with
 * optional surrounding whitespace and at most 64 levels of nesting. The value is scanned, never built.
 */
function isOneJsonValue(b: Uint8Array): boolean {
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return false;
  if (!isUtf8(b)) return false;

  const n = b.length;
  const stack: number[] = [];
  let i = 0;

  const ws = (): void => {
    while (i < n) {
      const c = b[i]!;
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };
  const string = (): boolean => {
    if (b[i] !== 0x22) return false;
    i++;
    while (i < n) {
      const c = b[i]!;
      if (c === 0x22) {
        i++;
        return true;
      }
      if (c < 0x20) return false;
      if (c === 0x5c) {
        const e = b[i + 1];
        if (e === 0x75) {
          for (let k = 2; k < 6; k++) if (!isHexByte(b[i + k])) return false;
          i += 6;
        } else if (e === 0x22 || e === 0x5c || e === 0x2f || e === 0x62 || e === 0x66 || e === 0x6e || e === 0x72 || e === 0x74) {
          i += 2;
        } else {
          return false;
        }
      } else {
        i++;
      }
    }
    return false;
  };
  const digits = (): boolean => {
    const start = i;
    while (i < n && b[i]! >= 0x30 && b[i]! <= 0x39) i++;
    return i > start;
  };
  const number = (): boolean => {
    if (b[i] === 0x2d) i++;
    if (b[i] === 0x30) i++;
    else if (b[i] !== undefined && b[i]! >= 0x31 && b[i]! <= 0x39) digits();
    else return false;
    if (b[i] === 0x2e) {
      i++;
      if (!digits()) return false;
    }
    if (b[i] === 0x65 || b[i] === 0x45) {
      i++;
      if (b[i] === 0x2b || b[i] === 0x2d) i++;
      if (!digits()) return false;
    }
    return true;
  };
  const literal = (word: readonly number[]): boolean => {
    for (let k = 0; k < word.length; k++) if (b[i + k] !== word[k]) return false;
    i += word.length;
    return true;
  };
  const member = (): boolean => {
    if (!string()) return false;
    ws();
    if (b[i] !== 0x3a) return false;
    i++;
    ws();
    return true;
  };

  ws();
  for (;;) {
    // A value starts at i.
    const c = b[i];
    if (c === 0x7b || c === 0x5b) {
      if (stack.length >= MAX_JSON_DEPTH) return false;
      stack.push(c);
      i++;
      ws();
      const close = c === 0x7b ? 0x7d : 0x5d;
      if (b[i] === close) {
        i++;
        stack.pop();
      } else {
        if (c === 0x7b && !member()) return false;
        continue;
      }
    } else if (c === 0x22) {
      if (!string()) return false;
    } else if (c === 0x2d || (c !== undefined && c >= 0x30 && c <= 0x39)) {
      if (!number()) return false;
    } else if (c === 0x74) {
      if (!literal(TRUE)) return false;
    } else if (c === 0x66) {
      if (!literal(FALSE)) return false;
    } else if (c === 0x6e) {
      if (!literal(NULL)) return false;
    } else {
      return false;
    }

    // A value ended before i: close containers until another value is due.
    for (;;) {
      ws();
      const top = stack[stack.length - 1];
      if (top === undefined) return i === n;
      const d = b[i];
      if (d === 0x2c) {
        i++;
        ws();
        if (top === 0x7b && !member()) return false;
        break;
      }
      if ((top === 0x5b && d === 0x5d) || (top === 0x7b && d === 0x7d)) {
        i++;
        stack.pop();
        continue;
      }
      return false;
    }
  }
}

/**
 * True when no array or object in JSON text is nested more than `MAX_JSON_DEPTH` deep. Brackets inside strings are
 * skipped; nothing else about the text is checked.
 */
export function jsonWithinDepth(text: string): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) {
      inString = true;
    } else if (c === 0x5b || c === 0x7b) {
      if (++depth > MAX_JSON_DEPTH) return false;
    } else if (c === 0x5d || c === 0x7d) {
      depth--;
    }
  }
  return true;
}

/** The value of JSON text nested at most `MAX_JSON_DEPTH` deep; undefined for text that is deeper or is not JSON. */
export function parseJson(text: string): unknown {
  if (typeof text !== "string" || !jsonWithinDepth(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const TRUE = [0x74, 0x72, 0x75, 0x65] as const;
const FALSE = [0x66, 0x61, 0x6c, 0x73, 0x65] as const;
const NULL = [0x6e, 0x75, 0x6c, 0x6c] as const;

function isHexByte(c: number | undefined): boolean {
  return c !== undefined && ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66));
}

/** Well-formed UTF-8 as Unicode's Table 3-7 defines it: no overlong forms, no surrogates, nothing above U+10FFFF. */
function isUtf8(b: Uint8Array): boolean {
  const n = b.length;
  let i = 0;
  while (i < n) {
    const c = b[i]!;
    if (c < 0x80) {
      i++;
      continue;
    }
    const form = UTF8_LEAD[c];
    if (form === undefined) return false;
    const [need, lo, hi] = form;
    const second = b[i + 1];
    if (second === undefined || second < lo || second > hi) return false;
    for (let k = 2; k <= need; k++) {
      const t = b[i + k];
      if (t === undefined || t < 0x80 || t > 0xbf) return false;
    }
    i += need + 1;
  }
  return true;
}

/** For each lead byte: the continuation bytes it needs, and the range its second byte must fall in. */
const UTF8_LEAD: { readonly [lead: number]: readonly [need: number, lo: number, hi: number] } = (() => {
  const t: { [lead: number]: readonly [number, number, number] } = {};
  for (let c = 0xc2; c <= 0xdf; c++) t[c] = [1, 0x80, 0xbf];
  t[0xe0] = [2, 0xa0, 0xbf];
  for (let c = 0xe1; c <= 0xec; c++) t[c] = [2, 0x80, 0xbf];
  t[0xed] = [2, 0x80, 0x9f];
  t[0xee] = [2, 0x80, 0xbf];
  t[0xef] = [2, 0x80, 0xbf];
  t[0xf0] = [3, 0x90, 0xbf];
  for (let c = 0xf1; c <= 0xf3; c++) t[c] = [3, 0x80, 0xbf];
  t[0xf4] = [3, 0x80, 0x8f];
  return t;
})();

/**
 * True when `a` and `b` are each `0x` and 64 hex digits, in either case, and decode to the same 32 bytes (LCP §2.5).
 * Anything else is false.
 */
export function hashEquals(a: string, b: string): boolean {
  const x = decodeHash(a);
  const y = decodeHash(b);
  if (x === null || y === null) return false;
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

function decodeHash(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || !HASH.test(s)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(s.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}

/** The one place a hash is written: `0x` and lowercase hex of 32 bytes. */
function toHex(b: Uint8Array): AtrHash {
  let s = "0x";
  for (const x of b) s += HEX_DIGITS[x >> 4]! + HEX_DIGITS[x & 15]!;
  return s as AtrHash;
}

function mustDecode(h: AtrHash): Uint8Array {
  const b = decodeHash(h);
  if (b === null) throw new TypeError("not a 32-byte hash");
  return b;
}

/** Unicode White_Space, every Unicode Cc control character, and the backslash. */
const LINK_FORBIDDEN = /[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\\]/;
/** The scheme `https` in either case, then `//` and the authority up to the path, query or fragment. */
const HTTPS_AUTHORITY = /^https:\/\/([^/?#]*)/i;
const DNS_LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
/** An IP literal in brackets, or a DNS name of RFC 1123 labels (which includes dotted IPv4), then an optional port. */
const HOST_PORT = new RegExp(`^(?:\\[[0-9A-Fa-f:.]+\\]|${DNS_LABEL}(?:\\.${DNS_LABEL})*\\.?)(?::([0-9]{0,5}))?$`);
const MAX_DNS_NAME = 253;

/**
 * The one https-link rule. The raw string holds no whitespace, control character or backslash; it parses as an
 * absolute URL; its scheme is `https`, compared case-insensitively (RFC 3986 §3.1); its authority has a host, a DNS
 * name or an IP literal, and no userinfo.
 */
export function isHttpsLink(s: unknown): s is string {
  if (typeof s !== "string" || !s.isWellFormed() || LINK_FORBIDDEN.test(s)) return false;
  const authority = HTTPS_AUTHORITY.exec(s)?.[1];
  if (authority === undefined || authority.includes("@")) return false;
  const hp = HOST_PORT.exec(authority);
  if (hp === null) return false;
  const host = hp[1] === undefined ? authority : authority.slice(0, authority.length - hp[1].length - 1);
  if (!host.startsWith("[") && host.replace(/\.$/, "").length > MAX_DNS_NAME) return false;
  if (hp[1] !== undefined && hp[1] !== "" && Number(hp[1]) > 65_535) return false;
  if (!URL.canParse(s)) return false;
  const u = new URL(s);
  return u.protocol === "https:" && u.hostname !== "" && u.username === "" && u.password === "";
}

/** LCP §8.1 string form: `lcp:sha256:0x…`. Throws TypeError when `h` is not a 32-byte hash. */
export function toLcpString(h: AtrHash): string {
  return `lcp:sha256:${toHex(mustDecode(h))}`;
}

/** Decodes `lcp:sha256:0x…`, returning the lowercase hash, or null for anything else. */
export function fromLcpString(s: string): AtrHash | null {
  if (typeof s !== "string" || !s.startsWith("lcp:sha256:")) return null;
  const b = decodeHash(s.slice("lcp:sha256:".length));
  return b === null ? null : toHex(b);
}

/**
 * LCP §8.1 structured form, with the link beside the digest. `spelling` "snake" writes `legal_context_url`.
 * Throws TypeError when `h` is not a 32-byte hash or `url` is not an `https://` URL.
 */
export function toLegalContext(
  h: AtrHash,
  url: string,
  spelling: "camel" | "snake" = "camel",
): { legalContext: { type: "sha256"; value: AtrHash; legalContextUrl?: string; legal_context_url?: string } } {
  const value = toHex(mustDecode(h));
  if (!isHttpsLink(url)) throw new TypeError("the link is not an https URL");
  return spelling === "snake"
    ? { legalContext: { type: "sha256", value, legal_context_url: url } }
    : { legalContext: { type: "sha256", value, legalContextUrl: url } };
}

/**
 * Decodes the structured form: `type` "sha256", a 32-byte hash, and an `https://` link in either spelling. Returns
 * the lowercase hash and the link, or null for anything else, including two spellings that disagree. Other members
 * are ignored.
 */
export function fromLegalContext(o: unknown): { h: AtrHash; url: string } | null {
  if (typeof o !== "object" || o === null) return null;
  const lc = (o as { legalContext?: unknown }).legalContext;
  if (typeof lc !== "object" || lc === null || Array.isArray(lc)) return null;
  const { type, value, legalContextUrl, legal_context_url } = lc as Record<string, unknown>;
  if (type !== "sha256") return null;
  const b = decodeHash(value);
  if (b === null) return null;
  if (legalContextUrl !== undefined && legal_context_url !== undefined && legalContextUrl !== legal_context_url) {
    return null;
  }
  const url = legalContextUrl ?? legal_context_url;
  if (!isHttpsLink(url)) return null;
  return { h: toHex(b), url };
}

/** The longest link a placement carries, in characters. */
const MAX_LINK = 2048;

/**
 * True for a string of at most 2048 characters that parses as an absolute URL whose scheme is not `https`: the one
 * failing link refused as `link-not-https`. Every other failing link is `legal-context-malformed`.
 */
export function isOtherSchemeLink(s: unknown): s is string {
  return typeof s === "string" && s.length <= MAX_LINK && URL.canParse(s) && new URL(s).protocol !== "https:";
}

/**
 * True for a structured form's inner object that `fromLegalContext` would decode except that its one link, in either
 * spelling, is a link of another scheme (`isOtherSchemeLink`).
 */
export function isHashWithNonHttpsLink(info: unknown): boolean {
  if (typeof info !== "object" || info === null || Array.isArray(info)) return false;
  const { type, value, legalContextUrl: camel, legal_context_url: snake } = info as Record<string, unknown>;
  if (type !== "sha256" || decodeHash(value) === null) return false;
  if (camel !== undefined && snake !== undefined && camel !== snake) return false;
  return isOtherSchemeLink(camel ?? snake);
}

/** The raw 32 bytes of a hash. Throws TypeError when `h` is not a 32-byte hash. */
export function toRawBytes(h: AtrHash): Uint8Array {
  return mustDecode(h);
}

/** The lowercase hash of exactly 32 raw bytes, or null. */
export function fromRawBytes(b: Uint8Array): AtrHash | null {
  if (!(b instanceof Uint8Array) || b.length !== 32) return null;
  return toHex(b);
}
