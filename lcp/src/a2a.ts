/**
 * The LCP extension for A2A: the ATR hash and the link to the seller's copy delivered in a Task's `metadata`, keyed by
 * the extension's URI. A2A signs nothing per transaction, so this is a carrier and exports no pairing. Pure; no I/O.
 */
import {
  canonicalJson,
  fromLegalContext,
  isHashWithNonHttpsLink,
  isHttpsLink,
  isOtherSchemeLink,
  toLegalContext,
  type AtrHash,
  type Json,
} from "./core.js";
import { isObject, jsonBytes, normalHash, sameJson } from "./fields.js";
import { refusal, type Refusal } from "./refusal.js";

/** The extension's URIs, in order of preference. The first is the one written when the client activated none. */
export const A2A_EXTENSION_URIS: readonly string[] = Object.freeze([
  "https://integraledger.com/lcp/a2a/legal-context/v1",
]);

/** A2A binds nothing: the refusal given wherever an A2A pairing is asked for. */
export const binding: Refusal = Object.freeze(refusal("a2a/no-signed-place"));

/** What the carrier proves. */
export const delivery: { proves: string } = Object.freeze({
  proves:
    "Delivered in A2A task metadata under the LCP extension's URI, protected only by the transport and the " +
    "request's authentication. A2A signs nothing per transaction, so this proves nothing about the payment; the " +
    "payment's own pairing states what its record proves.",
});

export interface A2aTask {
  metadata?: { [k: string]: Json };
  [k: string]: Json | undefined;
}

export interface A2aAgentExtension {
  uri: string;
  description: string;
  required: boolean;
}

const DESCRIPTION =
  "Delivers the ATR hash and the link to the seller's copy in task metadata, keyed by this URI. Delivery only: A2A " +
  "signs nothing per transaction.";
const MAX_HEADER = 8192;
const MAX_ELEMENTS = 64;
const MAX_VALUE_BYTES = 4096;
const MAX_LINK = 2048;

/** One Agent Card `capabilities.extensions[]` entry per listed URI. `required` defaults to false. */
export function agentExtension(o?: { required?: boolean }): A2aAgentExtension[] {
  const required = o?.required === true;
  return A2A_EXTENSION_URIS.map((uri) => ({ uri, description: DESCRIPTION, required }));
}

/**
 * True when the request's `A2A-Extensions` value names a listed URI exactly: the value split on commas, each element
 * trimmed of SP and HTAB, compared case-sensitively.
 */
export function requested(a2aExtensions: string | undefined): boolean {
  return activated(a2aExtensions) !== undefined;
}

/**
 * A copy of the task whose `metadata` carries `{type, value, legalContextUrl}` under the listed URI the request's
 * `A2A-Extensions` value activated, or the first listed URI. Other metadata is kept.
 */
export function place(task: A2aTask, h: AtrHash, link: string, a2aExtensions?: string): A2aTask | Refusal {
  if (!isObject(task)) return refusal("a2a/legal-context-malformed");
  const metadata: unknown = task["metadata"];
  if (metadata !== undefined && !isObject(metadata)) return refusal("a2a/legal-context-malformed");
  const nh = normalHash(h);
  if (nh === null) return refusal("a2a/legal-context-malformed");
  if (!isHttpsLink(link)) return refusal(isOtherSchemeLink(link) ? "a2a/link-not-https" : "a2a/legal-context-malformed");
  if (link.length > MAX_LINK) return refusal("a2a/legal-context-malformed");
  const value = toLegalContext(nh, link).legalContext as Json;
  if ((jsonBytes(value) ?? Number.POSITIVE_INFINITY) > MAX_VALUE_BYTES) return refusal("a2a/too-large");
  for (const uri of A2A_EXTENSION_URIS) {
    const present = metadata?.[uri];
    if (present !== undefined && !sameJson(present, value)) return refusal("a2a/legal-context-conflict");
  }
  const key = activated(a2aExtensions) ?? A2A_EXTENSION_URIS[0]!;
  return { ...task, metadata: { ...(metadata as { [k: string]: Json } | undefined), [key]: value } };
}

/**
 * The hash and the link from the task's `metadata`, under a listed URI. No other key is read. Values under two listed
 * URIs must agree.
 */
export function read(task: A2aTask): { h: AtrHash; link: string } | Refusal {
  const metadata: unknown = isObject(task) ? task["metadata"] : undefined;
  let found: { h: AtrHash; url: string } | undefined;
  for (const uri of A2A_EXTENSION_URIS) {
    const value = isObject(metadata) ? metadata[uri] : undefined;
    if (value === undefined) continue;
    if ((jsonBytes(value) ?? Number.POSITIVE_INFINITY) > MAX_VALUE_BYTES) return refusal("a2a/too-large");
    const decoded = fromLegalContext({ legalContext: value });
    if (decoded === null) {
      return isHashWithNonHttpsLink(value) ? refusal("a2a/link-not-https") : refusal("a2a/legal-context-malformed");
    }
    if (decoded.url.length > MAX_LINK) return refusal("a2a/legal-context-malformed");
    if (found !== undefined && (found.h !== decoded.h || found.url !== decoded.url)) {
      return refusal("a2a/legal-context-conflict");
    }
    found = decoded;
  }
  if (found === undefined) return refusal("a2a/no-legal-context");
  return { h: found.h, link: found.url };
}

/** The first listed URI that the `A2A-Extensions` value names, or undefined. */
function activated(a2aExtensions: string | undefined): string | undefined {
  if (typeof a2aExtensions !== "string" || a2aExtensions.length > MAX_HEADER) return undefined;
  const elements = a2aExtensions.split(",");
  if (elements.length > MAX_ELEMENTS) return undefined;
  const named = new Set(elements.map(trimSpHtab));
  return A2A_EXTENSION_URIS.find((uri) => named.has(uri));
}

function trimSpHtab(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === " " || s[a] === "\t")) a++;
  while (b > a && (s[b - 1] === " " || s[b - 1] === "\t")) b--;
  return s.slice(a, b);
}

