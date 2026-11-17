/**
 * x402's three HTTP headers: `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE` and `PAYMENT-RESPONSE`, each the padded standard
 * base64 of a JSON object's UTF-8, as the x402 specification's HTTP transport and its stock clients write them
 * (`@x402/core` 2.30.0, `src/http/index.ts`: `safeBase64Encode(JSON.stringify(value))`). A value is written, save what
 * that encoder leaves out (`encodeHeader`), and read whole: its members, the extensions among them, keep their order
 * and their content, so an extension lcp does not declare is carried verbatim, and `legalContext`, the one it declares,
 * is composed by the pairings' `advertise`.
 */
import { canonicalJson, parseJson, type Json } from "./core.js";
import { isObject } from "./fields.js";
import { MAX_HEADER_BYTES, MAX_JSON_DEPTH } from "./internal/bounds.js";
import { base64Bytes, toBase64 } from "./rail-bytes.js";
import { carriesRefused, isRefusal, refusal, type Refusal } from "./refusal.js";
import type { PaymentPayload, PaymentRequired } from "./x402.js";

/** The response header that carries `PaymentRequired`. */
export const PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
/** The request header that carries `PaymentPayload`. */
export const PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
/** The response header that carries the settlement response. */
export const PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

/** x402's settlement response, as `PAYMENT-RESPONSE` carries it; any other member is kept as it is. */
export type SettlementResponse = {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network: string;
  payer?: string;
  [k: string]: Json | undefined;
};

/**
 * A header's value as `@x402/core` 2.30.0 writes it (`src/http/index.ts:17-18`, `:50-51`, `:76-80`): `JSON.stringify`
 * of `value`, in its own member order, as UTF-8, in padded standard base64 (RFC 4648 §4). A member whose value is
 * `undefined`, at any depth, is left out, as `JSON.stringify` leaves it out, and a top-level `extensionResponses` is
 * left out, as `encodePaymentResponseHeader` deletes it; no x402 `PaymentRequired` or `PaymentPayload` has that member.
 * Nothing else that `JSON.stringify` would leave out or rewrite is taken (an `undefined` array item, a function, a
 * `bigint`): a value that is not then a JSON object, or whose UTF-8 is over `MAX_HEADER_BYTES`, is
 * `x402/header-malformed`.
 */
export function encodeHeader(value: PaymentRequired | PaymentPayload | SettlementResponse): string | Refusal {
  const written = isObject(value) ? withoutUndefined(value, 0) : undefined;
  if (!isObject(written) || written === value) return refusal("x402/header-malformed");
  delete written["extensionResponses"];
  if (typeof canonicalJson(written) !== "string") return refusal("x402/header-malformed");
  const bytes = new TextEncoder().encode(JSON.stringify(written));
  return bytes.length > MAX_HEADER_BYTES ? refusal("x402/header-malformed") : toBase64(bytes);
}

/**
 * A copy of `v` without the object members whose value is `undefined`, at every depth. An array is copied item by
 * item, an `undefined` item and a hole kept; a value that is not a plain object or an array, an object with an
 * enumerable symbol-keyed member, and anything deeper than `MAX_JSON_DEPTH`, are given as they are, for
 * `canonicalJson` to refuse. A member named `__proto__` is copied as a member.
 */
function withoutUndefined(v: unknown, depth: number): unknown {
  if (typeof v !== "object" || v === null || depth >= MAX_JSON_DEPTH) return v;
  if (Array.isArray(v)) return v.map((item: unknown) => withoutUndefined(item, depth + 1));
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  if (Object.getOwnPropertySymbols(v).some((s) => Object.prototype.propertyIsEnumerable.call(v, s))) return v;
  const out: Record<string, unknown> = proto === null ? Object.create(null) : {};
  for (const k of Object.keys(v)) {
    const member = (v as Record<string, unknown>)[k];
    if (member === undefined) continue;
    const copy = withoutUndefined(member, depth + 1);
    Object.defineProperty(out, k, { value: copy, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** `PAYMENT-REQUIRED`'s value: an x402 v2 `PaymentRequired`, else as `decodeHeader` refuses it. */
export function decodePaymentRequired(header: unknown): PaymentRequired | Refusal {
  return decodeHeader(header, true) as PaymentRequired | Refusal;
}

/** `PAYMENT-SIGNATURE`'s value: an x402 v2 `PaymentPayload`, else as `decodeHeader` refuses it. */
export function decodePaymentSignature(header: unknown): PaymentPayload | Refusal {
  return decodeHeader(header, true) as PaymentPayload | Refusal;
}

/** `PAYMENT-RESPONSE`'s value: a settlement response, whose `success` is a boolean, else as `decodeHeader` refuses it. */
export function decodePaymentResponse(header: unknown): SettlementResponse | Refusal {
  const v = decodeHeader(header, false);
  if (isRefusal(v)) return v;
  return typeof v["success"] === "boolean" ? (v as SettlementResponse) : refusal("x402/header-malformed");
}

/**
 * The JSON object a header's value carries: padded standard base64 in its canonical form, of at most
 * `MAX_HEADER_BYTES` bytes, that are well-formed UTF-8 of a JSON object, at most `MAX_JSON_DEPTH` deep, that carries no
 * `refused` member, which would read as a refusal; else `x402/header-malformed`. With `versioned`, the object's `x402Version` must be 2, else `x402/not-v2`. Nothing else is
 * read: what the object holds is the reader's of it, such as a pairing's `read` or `bound`.
 */
function decodeHeader(header: unknown, versioned: boolean): { [k: string]: Json } | Refusal {
  const bytes = base64Bytes(header, MAX_HEADER_BYTES);
  if (typeof bytes === "string") return refusal("x402/header-malformed");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return refusal("x402/header-malformed");
  }
  const v = parseJson(text);
  if (!isObject(v) || carriesRefused(v)) return refusal("x402/header-malformed");
  if (versioned && v["x402Version"] !== 2) return refusal("x402/not-v2");
  return v as { [k: string]: Json };
}
