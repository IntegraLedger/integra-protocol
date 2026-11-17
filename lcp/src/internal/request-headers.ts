/**
 * The request header fields an x402 request commitment names (x402-request-commitment.md, rule 3): for each field the
 * resource server names, in the order named, its lower-cased name and SHA-256 of its value as received, never the value.
 */
import { hash, type AtrHash } from "./core.js";
import { MAX_REQUEST_BYTES } from "./bounds.js";

/**
 * A request's header fields as received: each field's name, in any case, with its field lines in the order received,
 * or with its one line. Each line is the field's value as HTTP parses it; its leading and trailing spaces and tabs are
 * not part of it.
 */
export type HeaderFields = Readonly<Record<string, string | readonly string[]>>;

/** One named field of a request commitment: its lower-cased name, and SHA-256 of its value, null where the request lacks it. */
export interface HeaderDigest {
  readonly name: string;
  readonly digest: AtrHash | null;
}

/** RFC 9110 §5.1: a field name is a token. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** True where every character is visible ASCII, the space or the tab. */
function fieldText(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 0x09 && (c < 0x20 || c > 0x7e)) return false;
  }
  return true;
}

/** The line without its leading and trailing spaces and tabs (RFC 9110 §5.5). */
function trimmed(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === " " || s[a] === "\t")) a++;
  while (b > a && (s[b - 1] === " " || s[b - 1] === "\t")) b--;
  return s.slice(a, b);
}

/**
 * The named fields' digests, in the order named: `invalid` where the names are not a list of distinct field names
 * (compared lower-cased), the fields are not a record of strings or lists of strings, two of its keys name one named
 * field in different case, or a named field's value holds a character outside visible ASCII, the space and the tab;
 * `too-large` where a named field's value, its lines joined, is over 1 MiB. Only the named fields are read. A field's
 * lines are joined in the order given by a comma and a space, `cookie`'s by a semicolon and a space; a field with no
 * line, or none in the record, has `digest` null.
 */
export async function headerDigests(names: unknown, fields: unknown): Promise<HeaderDigest[] | "invalid" | "too-large"> {
  if (!Array.isArray(names)) return "invalid";
  const lower: string[] = [];
  for (const n of names as unknown[]) {
    if (typeof n !== "string" || !TOKEN.test(n)) return "invalid";
    const l = asciiLower(n);
    if (lower.includes(l)) return "invalid";
    lower.push(l);
  }
  if (fields !== undefined && (typeof fields !== "object" || fields === null || Array.isArray(fields))) return "invalid";
  const record = (fields ?? {}) as Record<string, unknown>;
  const keys = Object.keys(record);
  const lines: (readonly string[] | null)[] = [];
  for (const name of lower) {
    const matching = keys.filter((k) => asciiLower(k) === name);
    if (matching.length > 1) return "invalid";
    if (matching.length === 0) {
      lines.push(null);
      continue;
    }
    const v = record[matching[0]!];
    const given = typeof v === "string" ? [v] : Array.isArray(v) ? (v as unknown[]) : undefined;
    if (given === undefined || !given.every((x): x is string => typeof x === "string")) return "invalid";
    if (given.length === 0) {
      lines.push(null);
      continue;
    }
    const length = given.reduce((sum, x) => sum + x.length, 0) + (given.length - 1) * 2;
    if (length > MAX_REQUEST_BYTES) return "too-large";
    if (!given.every(fieldText)) return "invalid";
    lines.push(given.map(trimmed));
  }
  const out: HeaderDigest[] = [];
  for (const [i, name] of lower.entries()) {
    const l = lines[i]!;
    const digest = l === null ? null : await hash(new TextEncoder().encode(l.join(name === "cookie" ? "; " : ", ")));
    out.push({ name, digest });
  }
  return out;
}
