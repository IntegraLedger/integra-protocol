/**
 * The return after an agreement (legal-context-return.md): the `Legal-Context` header, by which a buyer's agent that has
 * made the agreement repeats its request with the sale's H and, where the sale has one, its return value; and the
 * member by which an agreement option names the sale's charge options it serves.
 */
import { fromLcpString, toLcpString, type AtrHash } from "./core.js";
import { isObject, normalHash } from "./fields.js";
import { opaqueMembers } from "./mpp-challenge.js";
import { fromBase64, toBase64 } from "./rail-bytes.js";
import { refusal, type Refusal } from "./refusal.js";

/** The header's name. */
export const LEGAL_CONTEXT_HEADER = "Legal-Context";

/** The member by which an agreement option names the charge options it serves: in an x402 option's `extra`, in an MPP challenge's `opaque`. */
export const LEGAL_CONTEXT_SERVES = "legalContextServes";

/** The length of a sale's return value, in bytes. */
export const RETURN_VALUE_BYTES = 32;

/** What a `Legal-Context` header carries: H, and the sale's return value where it has one, as 32 bytes. */
export interface LegalContextReturn {
  h: AtrHash;
  returnValue?: Uint8Array;
}

const LCP_TOKEN = /^lcp:sha256:0x[0-9a-f]{64}$/;
const SERVED = /^(?:x402|mpp)\/(?:[0-9]|[12][0-9]|3[01])$/;
const MAX_SERVED = 32;

/**
 * The header's value, an RFC 9651 Item: H's LCP string as a token, and, where `returnValue` is given, the parameter
 * `rv`, its 32 bytes as a byte sequence. An H that is not a 32-byte hash, or a return value that is not 32 bytes, is
 * `return/header-malformed`.
 */
export function toLegalContextHeader(h: AtrHash, returnValue?: Uint8Array): string | Refusal {
  const hash = normalHash(h);
  if (hash === null) return refusal("return/header-malformed");
  if (returnValue === undefined) return toLcpString(hash);
  if (!(returnValue instanceof Uint8Array) || returnValue.length !== RETURN_VALUE_BYTES) {
    return refusal("return/header-malformed");
  }
  return `${toLcpString(hash)};rv=:${toBase64(returnValue)}:`;
}

/**
 * H, and the return value where the header carries `rv`, from a `Legal-Context` header's value, parsed as an RFC 9651
 * Item (section 4.2): spaces before and after the item and after each `;`; a bare item that is a token, H's LCP string
 * in lowercase hex; and parameters whose keys are `rv` alone, a repeated key overwriting the value before it
 * (section 4.2.3.2). `rv` is a byte sequence of 32 bytes in the standard base64 alphabet, read with its `=` padding
 * absent and with bits set past its last byte, which section 4.2.7 says a parser should not refuse. Any other value is
 * `return/header-malformed`.
 */
export function fromLegalContextHeader(value: unknown): LegalContextReturn | Refusal {
  if (typeof value !== "string") return refusal("return/header-malformed");
  let i = skipSpaces(value, 0);
  const tokenEnd = tokenAt(value, i);
  if (tokenEnd === -1) return refusal("return/header-malformed");
  const token = value.slice(i, tokenEnd);
  if (!LCP_TOKEN.test(token)) return refusal("return/header-malformed");
  const h = fromLcpString(token);
  if (h === null) return refusal("return/header-malformed");
  i = tokenEnd;
  let rv: BareItem | undefined;
  while (value[i] === ";") {
    i = skipSpaces(value, i + 1);
    const keyEnd = keyAt(value, i);
    if (keyEnd === -1) return refusal("return/header-malformed");
    const key = value.slice(i, keyEnd);
    i = keyEnd;
    let item: BareItem = { kind: "boolean" };
    if (value[i] === "=") {
      const parsed = bareItemAt(value, i + 1);
      if (parsed === null) return refusal("return/header-malformed");
      item = parsed.item;
      i = parsed.end;
    }
    if (key !== "rv") return refusal("return/header-malformed");
    rv = item;
  }
  if (skipSpaces(value, i) !== value.length) return refusal("return/header-malformed");
  if (rv === undefined) return { h };
  if (rv.kind !== "bytes" || rv.bytes.length !== RETURN_VALUE_BYTES) return refusal("return/header-malformed");
  return { h, returnValue: rv.bytes };
}

/** A parsed RFC 9651 bare item: a byte sequence with its bytes, or another kind, whose value is not read. */
type BareItem = { kind: "bytes"; bytes: Uint8Array } | { kind: "boolean" | "number" | "string" | "token" | "date" | "display" };

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = /[0-9]/;
const ALPHA = /[A-Za-z]/;
const TOKEN_CHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z:/]/;
const KEY_FIRST = /[a-z*]/;
const KEY_CHAR = /[a-z0-9_\-.*]/;
const LOWER_HEX = /[0-9a-f]/;

function skipSpaces(s: string, i: number): number {
  while (s[i] === " ") i++;
  return i;
}

/** The end of the token at `i` (RFC 9651 section 4.2.6), or -1 where none starts there. */
function tokenAt(s: string, i: number): number {
  const c = s[i];
  if (c === undefined || !(ALPHA.test(c) || c === "*")) return -1;
  let j = i + 1;
  while (s[j] !== undefined && TOKEN_CHAR.test(s[j]!)) j++;
  return j;
}

/** The end of the key at `i` (RFC 9651 section 4.2.3.3), or -1 where none starts there. */
function keyAt(s: string, i: number): number {
  const c = s[i];
  if (c === undefined || !KEY_FIRST.test(c)) return -1;
  let j = i + 1;
  while (s[j] !== undefined && KEY_CHAR.test(s[j]!)) j++;
  return j;
}

/** The bare item at `i` and where it ends (RFC 9651 section 4.2.3.1), or null where it does not parse. */
function bareItemAt(s: string, i: number): { item: BareItem; end: number } | null {
  const c = s[i];
  if (c === undefined) return null;
  if (c === "-" || DIGIT.test(c)) {
    const end = numberAt(s, i, true);
    return end === -1 ? null : { item: { kind: "number" }, end };
  }
  if (c === '"') {
    for (let j = i + 1; j < s.length; j++) {
      const d = s.charCodeAt(j);
      if (d === 0x5c) {
        if (s[j + 1] !== '"' && s[j + 1] !== "\\") return null;
        j++;
      } else if (d === 0x22) return { item: { kind: "string" }, end: j + 1 };
      else if (d < 0x20 || d > 0x7e) return null;
    }
    return null;
  }
  if (c === ":") {
    const close = s.indexOf(":", i + 1);
    if (close === -1) return null;
    const bytes = byteSequence(s.slice(i + 1, close));
    return bytes === null ? null : { item: { kind: "bytes", bytes }, end: close + 1 };
  }
  if (c === "?") {
    return s[i + 1] === "0" || s[i + 1] === "1" ? { item: { kind: "boolean" }, end: i + 2 } : null;
  }
  if (c === "@") {
    const end = numberAt(s, i + 1, false);
    return end === -1 ? null : { item: { kind: "date" }, end };
  }
  if (c === "%") return displayStringAt(s, i);
  const end = tokenAt(s, i);
  return end === -1 ? null : { item: { kind: "token" }, end };
}

/**
 * The end of the integer, or where `decimal` admits it the decimal, at `i` (RFC 9651 section 4.2.4): an optional `-`,
 * then at most 15 digits, or at most 12 digits, a `.` and 1 to 3 digits; or -1.
 */
function numberAt(s: string, i: number, decimal: boolean): number {
  let j = s[i] === "-" ? i + 1 : i;
  const start = j;
  while (s[j] !== undefined && DIGIT.test(s[j]!)) j++;
  const whole = j - start;
  if (whole === 0) return -1;
  if (s[j] !== ".") return whole > 15 ? -1 : j;
  if (!decimal || whole > 12) return -1;
  const point = j++;
  while (s[j] !== undefined && DIGIT.test(s[j]!)) j++;
  const fraction = j - point - 1;
  return fraction === 0 || fraction > 3 ? -1 : j;
}

/** The display string at `i` (RFC 9651 section 4.2.10): `%"`, visible ASCII with `%` and two lowercase hex digits for each byte escaped, `"`, the bytes well-formed UTF-8. */
function displayStringAt(s: string, i: number): { item: BareItem; end: number } | null {
  if (s[i + 1] !== '"') return null;
  const bytes: number[] = [];
  for (let j = i + 2; j < s.length; j++) {
    const d = s.charCodeAt(j);
    if (d < 0x20 || d > 0x7e) return null;
    if (d === 0x25) {
      const hex = s.slice(j + 1, j + 3);
      if (hex.length !== 2 || !LOWER_HEX.test(hex[0]!) || !LOWER_HEX.test(hex[1]!)) return null;
      bytes.push(Number.parseInt(hex, 16));
      j += 2;
    } else if (d === 0x22) {
      try {
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes));
      } catch {
        return null;
      }
      return { item: { kind: "display" }, end: j + 1 };
    } else bytes.push(d);
  }
  return null;
}

/**
 * The bytes of a byte sequence's content (RFC 9651 section 4.2.7): the standard base64 alphabet, its `=` padding
 * present or absent, and any bits past the last byte set or clear; or null.
 */
function byteSequence(text: string): Uint8Array | null {
  let body = text;
  if (body.length % 4 === 0) body = body.replace(/={1,2}$/, "");
  if (body.length % 4 === 1) return null;
  for (const ch of body) if (!BASE64.includes(ch)) return null;
  const spare = (body.length * 6) % 8;
  if (spare !== 0) {
    const last = BASE64.indexOf(body[body.length - 1]!) & ~((1 << spare) - 1);
    body = body.slice(0, -1) + BASE64[last];
  }
  return fromBase64(body + "=".repeat((4 - (body.length % 4)) % 4));
}

/**
 * The charge options an agreement option names as those it serves: each `x402/<i>` or `mpp/<i>`, the option at index
 * `i` of the ATR binding slot of that name (`accepts` of `x402`, `challenges` of `mpp`). On an x402 option the member is
 * `extra.legalContextServes`, an array of those strings; on an MPP challenge it is `opaque`'s `legalContextServes`, those
 * strings joined by one space. Undefined where the option carries no such member; `return/serves-malformed` where the
 * member is not 1 to 32 distinct such strings.
 */
export function servesOf(option: unknown): readonly string[] | undefined | Refusal {
  if (!isObject(option)) return refusal("return/serves-malformed");
  let listed: unknown;
  if (typeof option["scheme"] === "string") {
    const extra = option["extra"];
    if (extra === undefined) return undefined;
    if (!isObject(extra)) return refusal("return/serves-malformed");
    listed = extra[LEGAL_CONTEXT_SERVES];
  } else {
    const opaque = option["opaque"];
    if (opaque === undefined) return undefined;
    const members = typeof opaque === "string" ? opaqueMembers(opaque) : undefined;
    if (members === undefined) return refusal("return/serves-malformed");
    const joined = members[LEGAL_CONTEXT_SERVES];
    listed = typeof joined === "string" ? joined.split(" ") : joined;
  }
  if (listed === undefined) return undefined;
  if (
    !Array.isArray(listed) ||
    listed.length === 0 ||
    listed.length > MAX_SERVED ||
    !listed.every((s) => typeof s === "string" && SERVED.test(s)) ||
    new Set(listed).size !== listed.length
  ) {
    return refusal("return/serves-malformed");
  }
  return Object.freeze([...(listed as string[])]);
}
