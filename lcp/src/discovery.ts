/**
 * The discovery document of LCP §2, served at `/.well-known/legal-context.json`. `parse` reads one; `emit` writes one,
 * members in the order of LCP §2.4–§2.5's tables, absent members omitted, no whitespace, UTF-8. Both check only what
 * LCP §2 states. Neither throws or does I/O.
 */
import { fromRawBytes, isHttpsLink, parseJson, toRawBytes, type AtrHash } from "./core.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";

export const WELL_KNOWN_PATH = "/.well-known/legal-context.json";
export const MAX_DOCUMENT_BYTES = 65_536;

/** LCP §2.4–§2.5; members in the order of their tables. */
export interface LegalContextDocument {
  /** Absolute https URL of the terms document. */
  terms: string;
  termsFormat?: string;
  /** The digest of the document at `terms` (LCP §2.5). */
  atrHash?: AtrHash;
  acceptanceRequired?: boolean;
  disputeResolution?: {
    method?: string;
    jurisdiction?: string;
    contact?: string;
    clauseId?: string;
    source?: string;
    catalog?: string;
  };
  returns?: string;
  contact?: { legal?: string; technical?: string };
  api?: string;
}

type Kind = "terms" | "string" | "hash" | "boolean" | "clause" | Members;
type Members = readonly (readonly [string, Kind])[];

const DISPUTE: Members = [
  ["method", "string"],
  ["jurisdiction", "string"],
  ["contact", "string"],
  ["clauseId", "clause"],
  ["source", "string"],
  ["catalog", "string"],
];
const CONTACT: Members = [
  ["legal", "string"],
  ["technical", "string"],
];
const DOCUMENT: Members = [
  ["terms", "terms"],
  ["termsFormat", "string"],
  ["atrHash", "hash"],
  ["acceptanceRequired", "boolean"],
  ["disputeResolution", DISPUTE],
  ["returns", "string"],
  ["contact", CONTACT],
  ["api", "string"],
];

const HASH = /^0x[0-9a-fA-F]{64}$/;
const CLAUSE_ID = /^sha256:0x[0-9a-fA-F]{64}$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The checked members of `o` in table order, with `atrHash` in lowercase, or the first refusal. Members the table does
 * not name are left out.
 */
function check(o: Record<string, unknown>, members: Members, path: string): Record<string, unknown> | Refusal {
  const out: Record<string, unknown> = {};
  for (const [name, kind] of members) {
    const at = path === "" ? name : `${path}.${name}`;
    if (!Object.hasOwn(o, name) || o[name] === undefined) {
      if (kind === "terms") return refusal("discovery/terms-missing");
      continue;
    }
    const v = o[name];
    if (kind === "terms") {
      if (typeof v !== "string") return refusal(`discovery/member-malformed/${at}`);
      if (!isHttpsLink(v)) return refusal("discovery/terms-not-https");
      out[name] = v;
    } else if (kind === "hash") {
      if (typeof v !== "string" || !HASH.test(v)) return refusal("discovery/atr-hash-malformed");
      out[name] = fromRawBytes(toRawBytes(v as AtrHash));
    } else if (kind === "clause") {
      if (typeof v !== "string" || !CLAUSE_ID.test(v)) return refusal("discovery/clause-id-malformed");
      out[name] = v;
    } else if (kind === "boolean") {
      if (typeof v !== "boolean") return refusal(`discovery/member-malformed/${at}`);
      out[name] = v;
    } else if (kind === "string") {
      if (typeof v !== "string" || v.length === 0) return refusal(`discovery/member-malformed/${at}`);
      out[name] = v;
    } else {
      if (!isObject(v)) return refusal(`discovery/member-malformed/${at}`);
      const inner = check(v, kind, at);
      if (isRefusal(inner)) return inner;
      out[name] = inner;
    }
  }
  return out;
}

/** Dotted paths of the members of `o` the table does not name, in the order they appear. */
function unknown(o: Record<string, unknown>, members: Members, path: string, into: string[]): void {
  for (const name of Object.keys(o)) {
    const at = path === "" ? name : `${path}.${name}`;
    const known = members.find(([n]) => n === name);
    if (known === undefined) into.push(at);
    else if (typeof known[1] === "object" && isObject(o[name])) unknown(o[name], known[1], at, into);
  }
}

/** The checked members written in table order: JSON with no whitespace, strings escaped as `JSON.stringify` does. */
function write(o: Record<string, unknown>, members: Members): string {
  const parts: string[] = [];
  for (const [name, kind] of members) {
    if (!Object.hasOwn(o, name)) continue;
    const v = o[name];
    const value = typeof kind === "object" ? write(v as Record<string, unknown>, kind) : JSON.stringify(v);
    parts.push(`${JSON.stringify(name)}:${value}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * One UTF-8 JSON object of at most `MAX_DOCUMENT_BYTES`, checked as LCP §2 states. Unknown members, at the top level or
 * inside `disputeResolution` and `contact`, are left out of `document` and named in `ignored` by dotted path.
 */
export function parse(bytes: Uint8Array): { document: LegalContextDocument; ignored: string[] } | Refusal {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_DOCUMENT_BYTES) return refusal("discovery/too-large");
  let v: unknown;
  try {
    v = parseJson(decoder.decode(bytes));
  } catch {
    return refusal("discovery/not-json-object");
  }
  if (!isObject(v)) return refusal("discovery/not-json-object");
  const document = check(v, DOCUMENT, "");
  if (isRefusal(document)) return document;
  const ignored: string[] = [];
  unknown(v, DOCUMENT, "", ignored);
  return { document: document as unknown as LegalContextDocument, ignored };
}

/** The document's bytes: its checked members in table order, `atrHash` in lowercase, and no other member. */
export function emit(document: LegalContextDocument): Uint8Array | Refusal {
  if (!isObject(document)) return refusal("discovery/not-json-object");
  const checked = check(document, DOCUMENT, "");
  if (isRefusal(checked)) return checked;
  const bytes = encoder.encode(write(checked, DOCUMENT));
  if (bytes.length > MAX_DOCUMENT_BYTES) return refusal("discovery/too-large");
  return bytes;
}
