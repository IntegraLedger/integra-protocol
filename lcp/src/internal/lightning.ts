/**
 * BOLT11 decoding, and the checks of `x402/exact/lnbtc/payment-hash`: the invoice's signature, the option's and the
 * invoice's checks, x402's request binding for the scheme, and the scheme's validation. `decode` is the one BOLT11
 * decoder: `../lightning.ts` decodes with it (its `decodeBolt11` returns the result) and reads an invoice's `h` or `m`
 * field with `fieldHash` (its `invoiceH`); `../mpp-challenge.ts` decodes with `decode` and reads `FIELD`.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJson, fromRawBytes, type AtrHash, type Json } from "../core.js";
import { isObject } from "../fields.js";
import type { Bolt11, LnNetwork } from "../lightning.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { PaymentRequirements } from "../x402.js";
import { MAX_REQUEST_BYTES } from "./bounds.js";
import { isAmount, isTimeoutSeconds, sameJson } from "./x402.js";

const MAX_INVOICE = 8192;
const MAX_FIELDS = 64;
const SIGNATURE_WORDS = 104;
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;
const CURRENCIES = ["bcrt", "tbs", "tb", "bc"] as const;
const AMOUNT = /^([0-9]+)([munp]?)$/;
/** Tagged field types, as the Bech32 value of their letter. */
export const FIELD = { p: 1, s: 16, h: 23, m: 27, x: 6, d: 13 } as const;
export const NETWORKS: { readonly [n in LnNetwork]: Bolt11["currency"] } = {
  "lnbtc:000000000019d6689c085ae165831e93": "bc",
  "lnbtc:000000000933ea01ad0ee984209779ba": "tb",
};
/** The `n` field's type, as the Bech32 value of its letter, and its length in words: a 33-byte public key. */
const FIELD_N = 19;
const N_WORDS = 53;
/** The `d` field's text: strict UTF-8 with a leading byte-order mark kept as a character. */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ascii = new TextEncoder();

/**
 * A BOLT11 invoice of up to 8,192 characters decoded strictly (BOLT 11 at 19146282): Bech32 past its 90-character
 * limit, which BOLT 11 lets an invoice exceed, exactly one `p` field, `p`, `h` and `s` fields of 52 words, exactly one
 * `s` field, at most one `n` field of 53 words, and a signature that verifies over the human-readable part and the data
 * part without the signature, padded with zero bits to a byte, hashed by SHA-256: by the `n` key where the invoice has
 * one, a low `s` required, and otherwise by public-key recovery, either `s` accepted. Any failure is
 * `ln/invoice-malformed`; an invoice of more characters, or of more than 64 tagged fields, is `ln/invoice-too-large`.
 */
export function decode(invoice: unknown): Bolt11<ArrayBuffer> | Refusal {
  if (typeof invoice !== "string") return refusal("ln/invoice-malformed");
  const parts = decodeParts(invoice);
  if (isRefusal(parts)) return parts;
  const { b, hrp, data } = parts;
  if (b.tags.filter((t) => t === FIELD.s).length !== 1) return refusal("ln/invoice-malformed");
  const body = data.slice(0, data.length - SIGNATURE_WORDS);
  const n = fieldsOf(body, FIELD_N);
  if (n.length > 1 || n.some((w) => w.length !== N_WORDS)) return refusal("ln/invoice-malformed");
  const digest = sha256(concat(ascii.encode(hrp), padded(body)));
  const sig = toBytes(data.slice(data.length - SIGNATURE_WORDS));
  const compact = sig.subarray(0, 64);
  const recovery = sig[64]!;
  try {
    if (n.length === 1) {
      const key = toBytes(n[0]!);
      if (!secp256k1.verify(compact, digest, key, { prehash: false, lowS: true })) return refusal("ln/invoice-malformed");
      return { ...b, signer: hexOf(key) };
    }
    if (recovery > 3) return refusal("ln/invoice-malformed");
    const key = secp256k1.Signature.fromBytes(compact, "compact").addRecoveryBit(recovery).recoverPublicKey(digest);
    return { ...b, signer: hexOf(key.toBytes(true)) };
  } catch {
    return refusal("ln/invoice-malformed");
  }
}

/**
 * An invoice's fields before its signature is read, its human-readable part, and its data words, the signature's 104
 * included.
 */
interface Parts {
  b: Omit<Bolt11<ArrayBuffer>, "signer">;
  hrp: string;
  data: readonly number[];
}

function decodeParts(invoice: string): Parts | Refusal {
  if (typeof invoice !== "string") return refusal("ln/invoice-malformed");
  if (invoice.length > MAX_INVOICE) return refusal("ln/invoice-too-large");
  const lower = invoice.toLowerCase();
  if (lower !== invoice && invoice.toUpperCase() !== invoice) return refusal("ln/invoice-malformed");
  const sep = lower.lastIndexOf("1");
  if (sep < 3) return refusal("ln/invoice-malformed");
  const hrp = lower.slice(0, sep);
  const words: number[] = [];
  for (const c of lower.slice(sep + 1)) {
    const w = CHARSET.indexOf(c);
    if (w < 0) return refusal("ln/invoice-malformed");
    words.push(w);
  }
  if (words.length < 6 || polymod([...hrpExpand(hrp), ...words]) !== 1) return refusal("ln/invoice-malformed");
  const data = words.slice(0, -6);
  if (data.length < 7 + SIGNATURE_WORDS) return refusal("ln/invoice-malformed");

  const prefix = currencyAndAmount(hrp);
  if (prefix === null) return refusal("ln/invoice-malformed");

  const body = data.slice(0, data.length - SIGNATURE_WORDS);
  const timestamp = uint(body.slice(0, 7));
  const tags: number[] = [];
  const first = new Map<number, number[]>();
  let i = 7;
  while (i < body.length) {
    if (i + 3 > body.length) return refusal("ln/invoice-malformed");
    const type = body[i]!;
    const length = body[i + 1]! * 32 + body[i + 2]!;
    if (i + 3 + length > body.length) return refusal("ln/invoice-malformed");
    if (tags.length === MAX_FIELDS) return refusal("ln/invoice-too-large");
    tags.push(type);
    if (!first.has(type)) first.set(type, body.slice(i + 3, i + 3 + length));
    i += 3 + length;
  }

  if (fixedLengthWrong(body)) return refusal("ln/invoice-malformed");
  const p = first.get(FIELD.p);
  if (p === undefined || tags.filter((t) => t === FIELD.p).length !== 1) return refusal("ln/invoice-malformed");
  const h = first.get(FIELD.h);
  const m = first.get(FIELD.m);
  const x = first.get(FIELD.x);
  const d = first.get(FIELD.d);
  if (x !== undefined && x.length > 10) return refusal("ln/invoice-malformed");
  let description: string | null = null;
  if (d !== undefined) {
    try {
      description = utf8.decode(toBytes(d));
    } catch {
      return refusal("ln/invoice-malformed");
    }
  }
  const b = {
    currency: prefix.currency,
    amountMsat: prefix.amountMsat,
    timestamp,
    expiry: x === undefined ? 3600 : uint(x),
    paymentHash: toBytes(p),
    descriptionHash: h === undefined ? null : toBytes(h),
    description,
    metadata: m === undefined ? null : toBytes(m),
    tags,
  };
  return { b, hrp, data };
}

/** True when any `p`, `h` or `s` field is not 52 words long. */
function fixedLengthWrong(body: readonly number[]): boolean {
  for (let i = 7; i + 3 <= body.length; ) {
    const type = body[i]!;
    const length = body[i + 1]! * 32 + body[i + 2]!;
    if ((type === FIELD.p || type === FIELD.h || type === FIELD.s) && length !== 52) return true;
    i += 3 + length;
  }
  return false;
}

/** The currency and the amount in millisatoshi from the human-readable part, `ln` + currency + [amount]. */
function currencyAndAmount(hrp: string): { currency: Bolt11["currency"]; amountMsat: bigint | null } | null {
  if (!hrp.startsWith("ln")) return null;
  const rest = hrp.slice(2);
  for (const currency of CURRENCIES) {
    if (!rest.startsWith(currency)) continue;
    const amount = rest.slice(currency.length);
    if (amount === "") return { currency, amountMsat: null };
    const a = AMOUNT.exec(amount);
    if (a === null) continue;
    const n = BigInt(a[1]!);
    switch (a[2]) {
      case "":
        return { currency, amountMsat: n * 100_000_000_000n };
      case "m":
        return { currency, amountMsat: n * 100_000_000n };
      case "u":
        return { currency, amountMsat: n * 100_000n };
      case "n":
        return { currency, amountMsat: n * 100n };
      default:
        return n % 10n === 0n ? { currency, amountMsat: n / 10n } : null;
    }
  }
  return null;
}

function polymod(values: readonly number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk = (chk ^ GENERATOR[i]!) >>> 0;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** 5-bit words as a big-endian integer. */
function uint(words: readonly number[]): number {
  let v = 0;
  for (const w of words) v = v * 32 + w;
  return v;
}

/** 5-bit words as bytes; trailing bits short of a byte are dropped. */
function toBytes(words: readonly number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(Math.floor((words.length * 5) / 8));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const w of words) {
    acc = ((acc << 5) | w) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      if (at < out.length) out[at++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** The one 32-byte `h` or `m` field of an invoice, as the hash it carries. */
export function fieldHash(b: Bolt11, field: "h" | "m"): AtrHash | Refusal {
  if (!isObject(b) || !Array.isArray(b.tags)) return refusal("ln/invoice-malformed");
  const type = FIELD[field];
  const count = b.tags.filter((t) => t === type).length;
  if (count === 0) return field === "h" ? refusal("ln/no-description-hash") : refusal("ln/no-metadata");
  if (count > 1) return refusal("ln/field-repeated");
  const bytes = field === "h" ? b.descriptionHash : b.metadata;
  const h = bytes === null ? null : fromRawBytes(bytes);
  return h ?? refusal("ln/field-length");
}


// ── x402/exact/lnbtc/payment-hash ──

const PAY_TO = /^[0-9a-f]{66}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const LOWER_HEX = /^[0-9a-f]*$/;
const POSITIVE = /^[1-9][0-9]{0,77}$/;
/** RFC 9110 §5.1's token, its letters lower-case: a bound header's name as the scheme's `http:1` writes it. */
const LOWER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;
/** RFC 9110 §9.1: a method is a token. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** The most names lcp reads in one `requestBindingParams` list. The scheme sets no count. */
const MAX_BOUND_NAMES = 64;
/** The longest URL or URI lcp reads in a request binding, in characters. The scheme sets no length. */
const MAX_URI = 8192;
/** The scheme's default clock-skew allowance, in seconds. */
export const SKEW_SECONDS = 60;

/** The x402 option of this pairing as the checks read it: `exact` on a Lightning network, with an `extra` object. */
export type LnOption = PaymentRequirements & { extra: { [k: string]: Json } };


/** The data of every tagged field of `type`, in invoice order. */
function fieldsOf(body: readonly number[], type: number): number[][] {
  const out: number[][] = [];
  for (let i = 7; i + 3 <= body.length; ) {
    const length = body[i + 1]! * 32 + body[i + 2]!;
    if (body[i] === type) out.push(body.slice(i + 3, i + 3 + length));
    i += 3 + length;
  }
  return out;
}

/** 5-bit words as bytes, with zero bits appended to a byte boundary. */
function padded(words: readonly number[]): Uint8Array {
  const out = new Uint8Array(Math.ceil((words.length * 5) / 8));
  let bit = 0;
  for (const w of words) {
    for (let k = 4; k >= 0; k--, bit++) if ((w >> k) & 1) out[bit >> 3]! |= 0x80 >> (bit & 7);
  }
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Lowercase hex digits, an even count of them, as bytes. */
function bytesOfHex(v: string): Uint8Array {
  const out = new Uint8Array(v.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(v.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function hexOf(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** True when `v` is 66 lowercase hex digits encoding a valid compressed secp256k1 public key. */
function isPayTo(v: unknown): v is string {
  if (typeof v !== "string" || !PAY_TO.test(v)) return false;
  try {
    return secp256k1.utils.isValidPublicKey(bytesOfHex(v), true);
  } catch {
    return false;
  }
}

/** True when `o` is an `exact` option on one of x402's two `lnbtc` networks. */
export function isLnbtc(o: unknown): o is PaymentRequirements {
  if (!isObject(o) || o["scheme"] !== "exact") return false;
  const n = o["network"];
  return typeof n === "string" && Object.hasOwn(NETWORKS, n);
}

/**
 * The checks of the option's own members (the profile's rule 6, a to c): `asset` `BTC`, `amount` a positive integer of
 * at most 78 digits, `maxTimeoutSeconds` a positive safe integer, `payTo` a valid compressed secp256k1 key as 66
 * lowercase hex digits, `extra` an object with `paymentFlow` `upfront` and `assetTransferMethod` absent or `bolt11`
 * (`x402/option-malformed`); `extra.paymentHash` 64 lowercase hex digits (`ln/payment-hash-required`);
 * `extra.requestHash` 64 lowercase hex digits (`ln/request-hash-mismatch`); and the request binding's profile and
 * parameters in the scheme's form (`ln/request-binding-malformed`).
 */
function optionMembers(o: PaymentRequirements): Refusal | null {
  const extra = o.extra;
  if (
    !isObject(extra) ||
    extra["paymentFlow"] !== "upfront" ||
    (Object.hasOwn(extra, "assetTransferMethod") && extra["assetTransferMethod"] !== "bolt11") ||
    o.asset !== "BTC" ||
    !isAmount(o.amount) ||
    !POSITIVE.test(o.amount) ||
    !isTimeoutSeconds(o.maxTimeoutSeconds) ||
    !isPayTo(o.payTo)
  ) {
    return refusal("x402/option-malformed");
  }
  if (typeof extra["paymentHash"] !== "string" || !HEX64.test(extra["paymentHash"])) return refusal("ln/payment-hash-required");
  if (typeof extra["requestHash"] !== "string" || !HEX64.test(extra["requestHash"])) return refusal("ln/request-hash-mismatch");
  if (!bindingParams(extra["requestBindingProfile"], extra["requestBindingParams"])) return refusal("ln/request-binding-malformed");
  return null;
}

/**
 * The offer before its invoice: one that carries `extra.invoice` is `ln/invoice-in-offer`; then the option's own
 * members (`optionMembers`).
 */
export function offerChecks(o: PaymentRequirements): Refusal | null {
  if (isObject(o.extra) && Object.hasOwn(o.extra, "invoice")) return refusal("ln/invoice-in-offer");
  return optionMembers(o);
}

/** The terms an invoice is held to: from the option, or in the scheme's validation from the requirements. */
interface Terms {
  network: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  requestHash: string;
}

/**
 * The invoice's checks against `t` (the profile's rule 6, e to j), in this order: exactly one `h` and no `d`
 * (`ln/no-description-hash`, `ln/field-repeated`, `ln/description-inline`); the `h` field the request hash
 * (`ln/request-hash-mismatch`); the signing key `payTo` (`ln/signer-not-payee`); the currency the network's
 * (`ln/currency-network`); the amount `amount` (`ln/amount-mismatch`); the expiry `maxTimeoutSeconds`
 * (`ln/expiry-mismatch`).
 */
function invoiceTerms(s: Bolt11, t: Terms): Refusal | null {
  const d = fieldHash(s, "h");
  if (isRefusal(d)) return d;
  if (s.tags.includes(FIELD.d)) return refusal("ln/description-inline");
  if (d !== `0x${t.requestHash}`) return refusal("ln/request-hash-mismatch");
  if (s.signer !== t.payTo) return refusal("ln/signer-not-payee");
  if (NETWORKS[t.network as LnNetwork] !== s.currency) return refusal("ln/currency-network");
  if (s.amountMsat === null || s.amountMsat.toString() !== t.amount) return refusal("ln/amount-mismatch");
  if (s.expiry !== t.maxTimeoutSeconds) return refusal("ln/expiry-mismatch");
  return null;
}

/**
 * The checks of an option with its invoice (the profile's rule 6, a to k): `optionMembers`; the invoice decoded
 * strictly (`decode`); `invoiceTerms` against the option; and the invoice's `p` equal to `extra.paymentHash`
 * (`ln/payment-hash-mismatch`). No clock and no request is read.
 */
export function optionChecks(o: PaymentRequirements): Bolt11<ArrayBuffer> | Refusal {
  const members = optionMembers(o);
  if (members !== null) return members;
  const extra = o.extra as { [k: string]: Json };
  const s = decode(extra["invoice"]);
  if (isRefusal(s)) return s;
  const terms = invoiceTerms(s, {
    network: o.network,
    amount: o.amount,
    payTo: o.payTo,
    maxTimeoutSeconds: o.maxTimeoutSeconds,
    requestHash: extra["requestHash"] as string,
  });
  if (terms !== null) return terms;
  return hexOf(s.paymentHash) === extra["paymentHash"] ? s : refusal("ln/payment-hash-mismatch");
}

/** True when SHA-256 of the bytes `preimage` spells in lowercase hex is `paymentHash`, 64 lowercase hex digits. */
export function preimageHashes(preimage: string, paymentHash: string): boolean {
  return hexOf(sha256(bytesOfHex(preimage))) === paymentHash;
}

/**
 * The preimage check: `true` where `preimage` is 64 lowercase hex digits whose SHA-256 is `paymentHash`, itself 64
 * lowercase hex digits; else `ln/preimage-malformed`, `ln/payment-hash-required` or `ln/preimage-mismatch`, in that
 * order.
 */
export function preimageCheck(preimage: unknown, paymentHash: unknown): true | Refusal {
  if (typeof preimage !== "string" || !HEX64.test(preimage)) return refusal("ln/preimage-malformed");
  if (typeof paymentHash !== "string" || !HEX64.test(paymentHash)) return refusal("ln/payment-hash-required");
  return preimageHashes(preimage, paymentHash) ? true : refusal("ln/preimage-mismatch");
}

// ── the scheme's request binding ──

/**
 * True when `v` is an absolute URI in ASCII syntax of at most 8,192 characters with no fragment and no user
 * information; with `http`, one whose scheme is `http` or `https` and whose authority is not empty.
 */
function absoluteUri(v: unknown, http: boolean): v is string {
  if (typeof v !== "string" || v.length > MAX_URI || !/^[\x21-\x7e]+$/.test(v) || v.includes("#")) return false;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(v);
  if (m === null) return false;
  const rest = m[2]!;
  const authority = rest.startsWith("//") ? /^\/\/([^/?]*)/.exec(rest)![1]! : null;
  if (authority !== null && authority.includes("@")) return false;
  if (!http) return true;
  return /^https?$/i.test(m[1]!) && authority !== null && authority.length > 0;
}

/** True when `names` holds at most 64 distinct strings, each `ok`, in ascending order of UTF-16 code units. */
function sortedNames(names: unknown, ok: (n: string) => boolean): names is string[] {
  if (!Array.isArray(names) || names.length > MAX_BOUND_NAMES) return false;
  for (let i = 0; i < names.length; i++) {
    const n: unknown = names[i];
    if (typeof n !== "string" || !ok(n)) return false;
    if (i > 0 && !((names[i - 1] as string) < n)) return false;
  }
  return true;
}

/**
 * True when `profile` is `http:1` or `mcp:1` and `params` holds exactly that profile's parameters in the scheme's form:
 * on `http:1`, `headers`, lower-case field names in ascending ASCII order, no duplicates, `payment-signature` not
 * among them; on `mcp:1`, `server`, an absolute URI with no user information or fragment, and `metadata`, non-empty
 * names in RFC 8785's member order, no duplicates, neither `x402/payment` nor `progressToken` among them.
 */
export function bindingParams(profile: unknown, params: unknown): boolean {
  if (!isObject(params)) return false;
  const keys = Object.keys(params).sort();
  if (profile === "http:1") {
    return keys.length === 1 && keys[0] === "headers" && sortedNames(params["headers"], (n) => LOWER_TOKEN.test(n) && n !== "payment-signature");
  }
  if (profile === "mcp:1") {
    return (
      keys.length === 2 &&
      keys[0] === "metadata" &&
      keys[1] === "server" &&
      absoluteUri(params["server"], false) &&
      sortedNames(params["metadata"], (n) => n.length > 0 && n !== "x402/payment" && n !== "progressToken")
    );
  }
  return false;
}

/** A request's header fields as received: each field's name, in any case, with its lines in order, or its one line. */
export type LnHeaderFields = Readonly<Record<string, string | readonly string[]>>;

/** The buyer's intended request, which the scheme's request binding commits to. */
export type LnbtcRequest =
  | {
      /** An HTTP request (the scheme's `http:1`). */
      profile: "http:1";
      /** The method, case kept. */
      method: string;
      /** The absolute URL the request is made to, its query included. */
      url: string;
      /** The content bytes after transfer decoding; empty where the request has no body. */
      body: Uint8Array;
      headers?: LnHeaderFields;
    }
  | {
      /** An MCP `tools/call` (the scheme's `mcp:1`). */
      profile: "mcp:1";
      /** The MCP server the buyer means to call, as its own configuration spells it. */
      server: string;
      name: string;
      /** `params.arguments`; absent is `{}`. */
      arguments?: Json;
      /** `params._meta`; absent is `{}`. */
      meta?: Json;
    };

const hex256 = (bytes: Uint8Array): string => hexOf(sha256(bytes));

/** SHA-256 of `0x01` and `bytes`, or of the single byte `0x00` where the value is absent, as 64 lowercase hex digits. */
function valueHash(bytes: Uint8Array | null): string {
  return bytes === null ? hex256(Uint8Array.of(0)) : hex256(concat(Uint8Array.of(1), bytes));
}

/**
 * The field's value by RFC 9421 §2.1's default rules: each line without its leading and trailing spaces and tabs, the
 * lines joined by a comma and a space; null where the field is absent. Undefined where two keys name the field, a
 * value is not a string, it holds a character outside visible ASCII, the space and the tab, or the joined value is
 * over 1 MiB.
 */
function fieldValue(record: LnHeaderFields, name: string): string | null | undefined {
  const keys = Object.keys(record).filter((k) => k.toLowerCase() === name);
  if (keys.length > 1) return undefined;
  if (keys.length === 0) return null;
  const v: unknown = record[keys[0]!];
  const lines = typeof v === "string" ? [v] : Array.isArray(v) ? (v as unknown[]) : undefined;
  if (lines === undefined || !lines.every((l): l is string => typeof l === "string")) return undefined;
  if (lines.length === 0) return null;
  if (!lines.every((l) => /^[\t\x20-\x7e]*$/.test(l))) return undefined;
  const joined = lines.map((l) => l.replace(/^[ \t]+|[ \t]+$/g, "")).join(", ");
  return joined.length > MAX_REQUEST_BYTES ? undefined : joined;
}

/**
 * The scheme's request hash of `request` under `profile` and `params`, as 64 lowercase hex digits: SHA-256 of the UTF-8
 * of RFC 8785's form of the profile's binding object. `ln/request-hash-mismatch` where the request is not of `profile`,
 * where on `http:1` `resourceUrl` is not the request's URL, or on `mcp:1` the option's `server` is not the request's;
 * `ln/request-binding-malformed` where `params` are not the profile's or the request cannot be bound: a method that is
 * not a token, a URL that is not an absolute `http` or `https` URL in ASCII without user information or fragment, a
 * body that is not bytes or is over 1 MiB, a header record that is not a record of strings or lists of strings or a
 * bound field's value outside the scheme's form, a tool name that is empty, arguments or `_meta` that are not a JSON
 * object, or a value RFC 8785 cannot write.
 *
 * A seller's server computes it from the request that will execute, with the option's `extra.requestBindingProfile`
 * and `extra.requestBindingParams` and the document's `resource.url`, and writes it as the option's `extra.requestHash`,
 * the invoice's `h` and the requirements it validates a payment against (profile `x402/exact/lnbtc/payment-hash`, rules
 * 2, 5 and 10); the buyer's `build` computes it from the buyer's intended request and holds it to `extra.requestHash`.
 */
export function requestHash(profile: unknown, params: unknown, request: unknown, resourceUrl: unknown): string | Refusal {
  if (!bindingParams(profile, params)) return refusal("ln/request-binding-malformed");
  if (!isObject(request) || request["profile"] !== profile) return refusal("ln/request-hash-mismatch");
  const p = params as { [k: string]: Json };
  let binding: Json;
  if (profile === "http:1") {
    const { method, url, body, headers } = request as { [k: string]: unknown };
    if (typeof method !== "string" || !TOKEN.test(method) || !absoluteUri(url, true)) return refusal("ln/request-binding-malformed");
    if (!(body instanceof Uint8Array) || body.length > MAX_REQUEST_BYTES) return refusal("ln/request-binding-malformed");
    if (headers !== undefined && !isObject(headers)) return refusal("ln/request-binding-malformed");
    if (resourceUrl !== url) return refusal("ln/request-hash-mismatch");
    const bound: Json[] = [];
    for (const name of p["headers"] as string[]) {
      const value = fieldValue((headers ?? {}) as LnHeaderFields, name);
      if (value === undefined) return refusal("ln/request-binding-malformed");
      bound.push({ name, valueHash: valueHash(value === null ? null : ascii.encode(value)) });
    }
    binding = { bodyHash: hex256(body), domain: "x402:exact:lnbtc:bolt11:http:1", headers: bound, method, url };
  } else {
    const { server, name, arguments: args, meta } = request as { [k: string]: unknown };
    if (server !== p["server"]) return refusal("ln/request-hash-mismatch");
    if (typeof name !== "string" || name.length === 0) return refusal("ln/request-binding-malformed");
    if ((args !== undefined && !isObject(args)) || (meta !== undefined && !isObject(meta))) return refusal("ln/request-binding-malformed");
    const metaOf = (meta ?? {}) as { [k: string]: Json };
    const bound: Json[] = [];
    for (const n of p["metadata"] as string[]) {
      if (!Object.hasOwn(metaOf, n)) {
        bound.push({ name: n, valueHash: valueHash(null) });
        continue;
      }
      const c = canonicalJson(metaOf[n]);
      if (isRefusal(c)) return refusal("ln/request-binding-malformed");
      bound.push({ name: n, valueHash: valueHash(ascii.encode(c)) });
    }
    binding = {
      arguments: (args ?? {}) as Json,
      domain: "x402:exact:lnbtc:bolt11:mcp:1",
      metadata: bound,
      method: "tools/call",
      name,
      server: p["server"]!,
    };
  }
  const text = canonicalJson(binding);
  if (isRefusal(text) || text.length > MAX_REQUEST_BYTES) return refusal("ln/request-binding-malformed");
  return hex256(ascii.encode(text));
}

// ── the scheme's validation ──

/** The scheme's `errorReason` strings its validation gives, and this form's one more. */
export type ExactLnbtcReason =
  | "unsupported_scheme"
  | "network_mismatch"
  | "unsupported_network"
  | "invalid_exact_lnbtc_asset"
  | "invalid_exact_lnbtc_amount"
  | "invalid_exact_lnbtc_amount_mismatch"
  | "invalid_exact_lnbtc_pay_to_mismatch"
  | "invalid_exact_lnbtc_pay_to_malformed"
  | "invalid_exact_lnbtc_max_timeout_mismatch"
  | "invalid_exact_lnbtc_extra_mismatch"
  | "invalid_exact_lnbtc_request_binding"
  | "invalid_exact_lnbtc_request_mismatch"
  | "invalid_exact_lnbtc_asset_transfer_method"
  | "invalid_exact_lnbtc_payment_flow"
  | "invalid_exact_lnbtc_invoice_missing"
  | "invalid_exact_lnbtc_invoice_decode_failed"
  | "invalid_exact_lnbtc_invoice_description"
  | "invalid_exact_lnbtc_invoice_request_mismatch"
  | "invalid_exact_lnbtc_invoice_payee_mismatch"
  | "invalid_exact_lnbtc_invoice_currency_mismatch"
  | "invalid_exact_lnbtc_invoice_amount_mismatch"
  | "invalid_exact_lnbtc_max_timeout"
  | "invalid_exact_lnbtc_invoice_expiry_mismatch"
  | "invalid_exact_lnbtc_invoice_created_in_future"
  | "invalid_exact_lnbtc_invoice_payment_hash_mismatch"
  | "invalid_exact_lnbtc_preimage_missing"
  | "invalid_exact_lnbtc_preimage_malformed"
  | "invalid_exact_lnbtc_preimage_length"
  | "invalid_exact_lnbtc_preimage_hash_mismatch"
  | "invalid_exact_lnbtc_invoice_expired";

/** The validation's answer: the network and payment hash of the scheme's consumption key, or the scheme's reason. */
export type ExactLnbtcValidation =
  | { valid: true; network: LnNetwork; paymentHash: string }
  | { valid: false; reason: ExactLnbtcReason };

/** The scheme's reason for each refusal of `invoiceTerms`. */
const TERMS_REASON: Readonly<Record<string, ExactLnbtcReason>> = {
  "ln/no-description-hash": "invalid_exact_lnbtc_invoice_description",
  "ln/field-repeated": "invalid_exact_lnbtc_invoice_description",
  "ln/field-length": "invalid_exact_lnbtc_invoice_decode_failed",
  "ln/description-inline": "invalid_exact_lnbtc_invoice_description",
  "ln/request-hash-mismatch": "invalid_exact_lnbtc_invoice_request_mismatch",
  "ln/signer-not-payee": "invalid_exact_lnbtc_invoice_payee_mismatch",
  "ln/currency-network": "invalid_exact_lnbtc_invoice_currency_mismatch",
  "ln/amount-mismatch": "invalid_exact_lnbtc_invoice_amount_mismatch",
  "ln/expiry-mismatch": "invalid_exact_lnbtc_invoice_expiry_mismatch",
};

const no = (reason: ExactLnbtcReason): ExactLnbtcValidation => ({ valid: false, reason });

/**
 * The scheme's Facilitator Validation, checks 1 to 7 with its Paid-but-expired Policy, in its order, over the payment
 * presented and the requirements the resource server built from its own record, at validation time `now` with
 * clock-skew allowance `skew`, both seconds. The check this form adds ends check 5: the accepted invoice's `p` is
 * `requirements.extra.paymentHash`. Moves nothing and reads nothing.
 */
export function validate(payload: unknown, requirements: unknown, now: number, skew: number): ExactLnbtcValidation {
  const a: Record<string, unknown> = isObject(payload) && isObject(payload["accepted"]) ? payload["accepted"] : {};
  const r: Record<string, unknown> = isObject(requirements) ? requirements : {};
  // 1
  if (a["scheme"] !== r["scheme"]) return no("unsupported_scheme");
  if (a["network"] !== r["network"]) return no("network_mismatch");
  if (a["amount"] !== r["amount"]) return no("invalid_exact_lnbtc_amount_mismatch");
  if (a["asset"] !== r["asset"]) return no("invalid_exact_lnbtc_asset");
  if (a["payTo"] !== r["payTo"]) return no("invalid_exact_lnbtc_pay_to_mismatch");
  if (a["maxTimeoutSeconds"] !== r["maxTimeoutSeconds"]) return no("invalid_exact_lnbtc_max_timeout_mismatch");
  // 2
  if (r["scheme"] !== "exact") return no("unsupported_scheme");
  const network = r["network"];
  if (typeof network !== "string" || !Object.hasOwn(NETWORKS, network)) return no("unsupported_network");
  if (r["asset"] !== "BTC") return no("invalid_exact_lnbtc_asset");
  if (!isAmount(r["amount"]) || !POSITIVE.test(r["amount"])) return no("invalid_exact_lnbtc_amount");
  if (!isTimeoutSeconds(r["maxTimeoutSeconds"])) return no("invalid_exact_lnbtc_max_timeout");
  if (!isPayTo(r["payTo"])) return no("invalid_exact_lnbtc_pay_to_malformed");
  // 3
  const ae: Record<string, unknown> = isObject(a["extra"]) ? a["extra"] : {};
  const re: Record<string, unknown> = isObject(r["extra"]) ? r["extra"] : {};
  const method = (e: Record<string, unknown>) => (Object.hasOwn(e, "assetTransferMethod") ? e["assetTransferMethod"] : "bolt11");
  if (method(ae) !== "bolt11" || method(re) !== "bolt11") return no("invalid_exact_lnbtc_asset_transfer_method");
  if (ae["paymentFlow"] !== "upfront" || re["paymentFlow"] !== "upfront") return no("invalid_exact_lnbtc_payment_flow");
  for (const e of [ae, re]) {
    if (typeof e["requestHash"] !== "string" || !HEX64.test(e["requestHash"])) return no("invalid_exact_lnbtc_request_binding");
    if (!bindingParams(e["requestBindingProfile"], e["requestBindingParams"])) return no("invalid_exact_lnbtc_request_binding");
  }
  if (
    ae["requestHash"] !== re["requestHash"] ||
    ae["requestBindingProfile"] !== re["requestBindingProfile"] ||
    !sameJson(ae["requestBindingParams"], re["requestBindingParams"])
  ) {
    return no("invalid_exact_lnbtc_request_mismatch");
  }
  const bindingMembers = ["invoice", "requestHash", "requestBindingProfile", "requestBindingParams"];
  for (const k of Object.keys(re)) {
    if (bindingMembers.includes(k)) continue;
    if (!Object.hasOwn(ae, k) || !sameJson(ae[k], re[k])) return no("invalid_exact_lnbtc_extra_mismatch");
  }
  // 4
  const nonEmpty = (v: unknown) => typeof v === "string" && v.length > 0;
  if (!nonEmpty(re["invoice"]) || !nonEmpty(ae["invoice"])) return no("invalid_exact_lnbtc_invoice_missing");
  // 5
  const s = decode(ae["invoice"]);
  if (isRefusal(s)) return no("invalid_exact_lnbtc_invoice_decode_failed");
  const terms = invoiceTerms(s, {
    network,
    amount: r["amount"] as string,
    payTo: r["payTo"] as string,
    maxTimeoutSeconds: r["maxTimeoutSeconds"] as number,
    requestHash: re["requestHash"] as string,
  });
  if (terms !== null) return no(TERMS_REASON[terms.code]!);
  if (s.timestamp > now + skew) return no("invalid_exact_lnbtc_invoice_created_in_future");
  const paymentHash = hexOf(s.paymentHash);
  if (paymentHash !== re["paymentHash"]) return no("invalid_exact_lnbtc_invoice_payment_hash_mismatch");
  // 6
  const body = isObject(payload) && isObject(payload["payload"]) ? payload["payload"] : {};
  if (!Object.hasOwn(body, "preimage") || body["preimage"] === undefined) return no("invalid_exact_lnbtc_preimage_missing");
  const preimage = body["preimage"];
  if (typeof preimage !== "string" || !LOWER_HEX.test(preimage)) return no("invalid_exact_lnbtc_preimage_malformed");
  if (preimage.length !== 64) return no("invalid_exact_lnbtc_preimage_length");
  if (!preimageHashes(preimage, paymentHash)) return no("invalid_exact_lnbtc_preimage_hash_mismatch");
  // 7
  if (now > s.timestamp + s.expiry + skew) return no("invalid_exact_lnbtc_invoice_expired");
  return { valid: true, network: network as LnNetwork, paymentHash };
}
