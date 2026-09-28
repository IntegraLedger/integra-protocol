/**
 * BOLT11 invoices and the Lightning pairings on x402 and MPP. On `x402/exact/lnbtc` the seller's node writes the ATR hash as the
 * invoice's `m` field and signs it; on `x402/exact/lnbtc/invoice-named` the invoice carries no hash and the ATR's
 * `x402` slot names the invoice instead. On MPP the seller's node writes the ATR hash as the invoice's description hash `h`. The
 * payer signs nothing; it pays the invoice.
 */
import { canonicalJson, fromLegalContext, fromRawBytes, parseJson, type AtrHash, type Json } from "./core.js";
import { deepFreeze, isObject, normalHash } from "./fields.js";
import {
  b64uEncode,
  challengeBound,
  credentialOf,
  checkChallenge,
  decodeObject,
  place,
  read as mppRead,
  tie as mppTie,
  type MppChallenge,
  type MppCredential,
} from "./mpp-challenge.js";
import { isRefusal, refusal, type Refusal } from "./refusal.js";
import {
  advertiseFor,
  chosen,
  filterOf,
  paymentWith,
  readFor,
  tie,
  type LcpPattern,
  type PaymentRequired,
  type PaymentRequirements,
  type X402Read,
} from "./x402.js";

/** CAIP-2 for Lightning: `lnbtc:` and the first 32 hex digits of the Bitcoin network's genesis block hash. */
export type LnNetwork = "lnbtc:000000000019d6689c085ae165831e93" | "lnbtc:000000000933ea01ad0ee984209779ba";

export interface Bolt11 {
  currency: "bc" | "tb" | "tbs" | "bcrt";
  amountMsat: bigint | null;
  timestamp: number;
  expiry: number;
  paymentHash: Uint8Array;
  descriptionHash: Uint8Array | null;
  description: string | null;
  metadata: Uint8Array | null;
  /** Every tagged field's type, in invoice order. */
  tags: readonly number[];
}

/** The read keys recorded at claim: the invoice's payment hash as lowercase hex, and when the payment can land. */
export interface LnRef {
  network: string;
  paymentHash: string;
  settleBy: number;
}

export interface LnUnsigned {
  /** The payer's node pays exactly this invoice. */
  request: { kind: "bolt11-pay"; invoice: string };
  complete(preimage: string): LnPaymentPayload | Refusal;
}

export type LnPaymentPayload = {
  x402Version: 2;
  resource?: PaymentRequired["resource"];
  accepted: PaymentRequirements;
  payload: { preimage: string };
  extensions?: PaymentRequired["extensions"];
};

const MAX_INVOICE = 8192;
const MAX_FIELDS = 64;
const MAX_ACCEPTS_READ = 32;
const MAX_ATR = 1_048_576;
const SKEW_SECONDS = 60;
const SIGNATURE_WORDS = 104;
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;
const CURRENCIES = ["bcrt", "tbs", "tb", "bc"] as const;
const AMOUNT = /^([0-9]+)([munp]?)$/;
/** Tagged field types, as the Bech32 value of their letter. */
const FIELD = { p: 1, s: 16, h: 23, m: 27, x: 6, d: 13 } as const;
const NETWORKS: { readonly [n in LnNetwork]: Bolt11["currency"] } = {
  "lnbtc:000000000019d6689c085ae165831e93": "bc",
  "lnbtc:000000000933ea01ad0ee984209779ba": "tb",
};
const PAY_TO = /^[0-9a-f]{66}$/;
const REQUEST_HASH = /^[0-9a-f]{64}$/;
const PREIMAGE = /^[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]{0,77}$/;
const utf8 = new TextDecoder("utf-8", { fatal: true });
/** The ATR's text: strict UTF-8 with a byte-order mark kept, so an ATR that begins with one is not one JSON object. */
const atrText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Decodes a BOLT11 invoice without its length limit, up to 8 KiB. The signature is not verified. */
export async function decodeBolt11(invoice: string): Promise<Bolt11 | Refusal> {
  return decode(invoice);
}

/** The one 32-byte `h` or `m` field of an invoice, as the hash it carries. */
export function invoiceH(b: Bolt11, field: "h" | "m"): AtrHash | Refusal {
  const type = FIELD[field];
  const count = b.tags.filter((t) => t === type).length;
  if (count === 0) return refusal(field === "h" ? "ln/no-description-hash" : "ln/no-metadata");
  if (count > 1) return refusal("ln/field-repeated");
  const bytes = field === "h" ? b.descriptionHash : b.metadata;
  const h = bytes === null ? null : fromRawBytes(bytes);
  return h ?? refusal("ln/field-length");
}

/**
 * True when the ATR's bytes are one JSON object in the core's layout whose `x402` slot's `accepts` holds an option
 * whose `extra.invoice` is exactly `invoice`. The object's first members are `atrVersion`, `id` and `x402`, in that
 * order, and no member name appears twice, so every JSON reader finds the same `x402` slot. Only that slot is read.
 */
export function atrNamesInvoice(atr: Uint8Array, invoice: string): boolean {
  if (!(atr instanceof Uint8Array) || atr.length > MAX_ATR || typeof invoice !== "string") return false;
  let text: string;
  try {
    text = atrText.decode(atr);
  } catch {
    return false;
  }
  const parsed = parseJson(text);
  if (!isObject(parsed)) return false;
  const names = memberNames(text);
  if (names[0] !== "atrVersion" || names[1] !== "id" || names[2] !== "x402") return false;
  if (new Set(names).size !== names.length) return false;
  const slot = parsed["x402"];
  const accepts = isObject(slot) ? slot["accepts"] : undefined;
  if (!Array.isArray(accepts)) return false;
  return accepts.slice(0, MAX_ACCEPTS_READ).some((o: unknown) => {
    const extra = isObject(o) ? o["extra"] : undefined;
    return isObject(extra) && extra["invoice"] === invoice;
  });
}

/**
 * The member names of the JSON object `text` holds, decoded, in the order written. `text` is one JSON object that
 * `JSON.parse` has read, so the scan only walks it; each step moves forward, so the scan ends within its length.
 */
function memberNames(text: string): string[] {
  let i = 0;
  const space = (): void => {
    while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };
  const skipString = (): void => {
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i++;
  };
  const skipValue = (): void => {
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        skipString();
        if (depth === 0) return;
        continue;
      }
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") {
        if (depth === 0) return;
        depth--;
        i++;
        if (depth === 0) return;
        continue;
      } else if (c === "," && depth === 0) return;
      i++;
    }
  };
  const names: string[] = [];
  space();
  i++;
  space();
  while (i < text.length && text[i] === '"') {
    const start = i;
    skipString();
    names.push(JSON.parse(text.slice(start, i)) as string);
    space();
    i++;
    space();
    skipValue();
    space();
    if (text[i] !== ",") break;
    i++;
    space();
  }
  return names;
}

function decode(invoice: string): Bolt11 | Refusal {
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
  return {
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
function toBytes(words: readonly number[]): Uint8Array {
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

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** An `exact` option on a Lightning network with an invoice string: the part of the filter both pairings share. */
function isLnOption(o: unknown): o is PaymentRequirements & { extra: { invoice: string } } {
  if (!isObject(o) || o["scheme"] !== "exact") return false;
  const n = o["network"];
  if (typeof n !== "string" || !Object.hasOwn(NETWORKS, n)) return false;
  const extra = o["extra"];
  return isObject(extra) && typeof extra["invoice"] === "string";
}

/** An option whose invoice decodes with an `m` field, or without one. */
function withMetadata(want: boolean): (o: unknown) => boolean {
  return (o) => {
    if (!isLnOption(o)) return false;
    const b = decode(o.extra.invoice);
    return !isRefusal(b) && b.tags.includes(FIELD.m) === want;
  };
}

/**
 * The x402 option checks both Lightning pairings make on the invoice and the option. `h` is the ATR hash the
 * invoice's `m` must carry, or null where `m` must be absent.
 */
function checkOption(o: PaymentRequirements & { extra: { invoice: string } }, h: AtrHash | null): Bolt11 | Refusal {
  const b = decode(o.extra.invoice);
  if (isRefusal(b)) return b;
  if (h !== null) {
    const m = invoiceH(b, "m");
    if (isRefusal(m)) return m;
    if (m !== normalHash(h)) return refusal("ln/no-metadata");
  } else if (b.tags.includes(FIELD.m)) {
    return refusal("ln/not-this-pairing");
  }
  const d = invoiceH(b, "h");
  if (isRefusal(d)) return d;
  const requestHash = o.extra["requestHash"];
  if (typeof requestHash !== "string" || !REQUEST_HASH.test(requestHash) || d !== `0x${requestHash}`) {
    return refusal("ln/request-hash-mismatch");
  }
  if (NETWORKS[o.network as LnNetwork] !== b.currency) return refusal("ln/currency-network");
  const malformed = optionFields(o);
  return malformed ?? b;
}

/** x402's client checks on the option's own fields: `paymentFlow`, `asset`, `payTo`, `amount`, `maxTimeoutSeconds`. */
function optionFields(o: PaymentRequirements): Refusal | null {
  if (
    !isObject(o.extra) ||
    o.extra["paymentFlow"] !== "upfront" ||
    o.asset !== "BTC" ||
    typeof o.payTo !== "string" ||
    !PAY_TO.test(o.payTo) ||
    typeof o.amount !== "string" ||
    !POSITIVE.test(o.amount) ||
    !Number.isSafeInteger(o.maxTimeoutSeconds) ||
    o.maxTimeoutSeconds <= 0
  ) {
    return refusal("x402/option-malformed");
  }
  return null;
}

/** The option without `extra.invoice`, the dynamic field that carries the hash on `x402/exact/lnbtc`. */
function withoutInvoice(option: PaymentRequirements): PaymentRequirements {
  if (!isObject(option.extra) || !Object.hasOwn(option.extra, "invoice")) return option;
  const { invoice: _, ...extra } = option.extra;
  return { ...option, extra };
}

function completeFor(required: PaymentRequired, accepted: PaymentRequirements): (preimage: string) => LnPaymentPayload | Refusal {
  return (preimage) => {
    if (typeof preimage !== "string" || !PREIMAGE.test(preimage)) return refusal("ln/preimage-malformed");
    return paymentWith(required, accepted, { preimage });
  };
}

/** The read keys: the network, the invoice's payment hash, and its timestamp plus expiry plus x402's 60 s skew. */
async function x402Reference(presented: unknown, want: boolean): Promise<LnRef | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isLnOption(accepted)) return refusal("x402/option-not-this-pairing");
  const b = decode(accepted.extra.invoice);
  if (isRefusal(b)) return b;
  if (b.tags.includes(FIELD.m) !== want) return refusal(want ? "ln/no-metadata" : "ln/not-this-pairing");
  return { network: accepted.network, paymentHash: hex(b.paymentHash), settleBy: b.timestamp + b.expiry + SKEW_SECONDS };
}

const X1_OPENING =
  "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, " +
  "recorded in <transaction>. ";
const PAID =
  "The payer paid that invoice, and its node checked the node signature before paying. The payer signed nothing " +
  "that carries the hash, and the seller did not verify the invoice signature. The invoice and its preimage, " +
  "which the parties hold, are the proof of the payment. No public ledger shows it. This does not show that " +
  "amount, payee or timing match the ATR's content.";

// ── x402/exact/lnbtc ──

const LNBTC = "x402/exact/lnbtc" as const;
const lnbtcPairs = withMetadata(true);
const lnbtcShared = advertiseFor(filterOf(isLnOption));

/**
 * The x402 entry point's legal-context placement, then the invoice's checks: its `m` is `h`, its `h` is the request
 * hash.
 */
function lnbtcAdvertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = lnbtcShared(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const b = checkOption(offer as PaymentRequirements & { extra: { invoice: string } }, h);
  return isRefusal(b) ? b : placed;
}

/** An `exact` option on a Lightning network whose `extra` is an object, with or without an invoice. */
function isLnOffer(o: unknown): o is PaymentRequirements & { extra: { [k: string]: Json } } {
  if (!isObject(o) || o["scheme"] !== "exact") return false;
  const n = o["network"];
  return typeof n === "string" && Object.hasOwn(NETWORKS, n) && isObject(o["extra"]);
}

const lnbtcBeforeShared = advertiseFor(filterOf(isLnOffer));

/**
 * `advertise` for the offer the seller sends before its node writes the invoice: the legal-context placement and the
 * option's own checks (a 64-hex-digit `requestHash`, x402's client checks). The invoice, its `m` and its `h` are not
 * read.
 */
function lnbtcAdvertiseBeforeCarrier(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  const placed = lnbtcBeforeShared(doc, h, link, offer, agreementUrl);
  if (isRefusal(placed)) return placed;
  const requestHash = (offer.extra as { [k: string]: Json })["requestHash"];
  if (typeof requestHash !== "string" || !REQUEST_HASH.test(requestHash)) return refusal("ln/request-hash-mismatch");
  return optionFields(offer) ?? placed;
}

async function lnbtcBuild(c: { required: PaymentRequired; accepted: PaymentRequirements }, h: AtrHash): Promise<LnUnsigned | Refusal> {
  const wrong = chosen(c.required, c.accepted, filterOf(isLnOption));
  if (wrong !== true) return wrong;
  const accepted = c.accepted as PaymentRequirements & { extra: { invoice: string } };
  const b = checkOption(accepted, h);
  if (isRefusal(b)) return b;
  return { request: { kind: "bolt11-pay", invoice: accepted.extra.invoice }, complete: completeFor(c.required, c.accepted) };
}

/** The hash in the invoice the payer paid: its `m` field. No signature is verified here. */
async function lnbtcBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isLnOption(accepted)) return refusal("x402/option-not-this-pairing");
  const b = decode(accepted.extra.invoice);
  if (isRefusal(b)) return b;
  return invoiceH(b, "m");
}

export const exactLnbtc = Object.freeze({
  id: LNBTC,
  pattern: deepFreeze({
    pattern: "native-field",
    canonical: true,
    profile: LNBTC,
    buyerSigns: false,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves:
      X1_OPENING +
      "The seller's node signed a BOLT11 invoice whose payment metadata is this ATR's hash, and whose description " +
      "hash is x402's request hash. " +
      PAID,
  } satisfies LcpPattern) as LcpPattern,
  claims: true as boolean,
  carrier: "extra.invoice#m" as const,
  unplaced: withoutInvoice,
  tie,
  advertise: lnbtcAdvertise,
  advertiseBeforeCarrier: lnbtcAdvertiseBeforeCarrier,
  read: readFor(filterOf(lnbtcPairs)) as (doc: PaymentRequired) => X402Read | Refusal,
  build: lnbtcBuild,
  bound: lnbtcBound,
  reference: (presented: unknown) => x402Reference(presented, true),
});

// ── x402/exact/lnbtc/invoice-named ──

const NAMED = "x402/exact/lnbtc/invoice-named" as const;
const namedPairs = withMetadata(false);
const namedShared = advertiseFor(filterOf(isLnOption));

/** The invoice's checks with `m` forbidden, then the x402 entry point's legal-context placement. */
function namedAdvertise(
  doc: PaymentRequired,
  h: AtrHash,
  link: string,
  offer: PaymentRequirements,
  agreementUrl?: string,
): PaymentRequired | Refusal {
  if (isLnOption(offer)) {
    const b = checkOption(offer, null);
    if (isRefusal(b)) return b;
  }
  return namedShared(doc, h, link, offer, agreementUrl);
}

/** Pays only an invoice that the ATR's own `x402` slot names. */
async function namedBuild(
  c: { required: PaymentRequired; accepted: PaymentRequirements; atr: Uint8Array },
  h: AtrHash,
): Promise<LnUnsigned | Refusal> {
  const wrong = chosen(c.required, c.accepted, filterOf(isLnOption));
  if (wrong !== true) return wrong;
  const accepted = c.accepted as PaymentRequirements & { extra: { invoice: string } };
  const b = checkOption(accepted, null);
  if (isRefusal(b)) return b;
  if (!atrNamesInvoice(c.atr, accepted.extra.invoice)) return refusal("ln/invoice-not-named");
  return { request: { kind: "bolt11-pay", invoice: accepted.extra.invoice }, complete: completeFor(c.required, c.accepted) };
}

/**
 * The candidate hash: the echoed legal context's value. The paid invoice carries none; the issuer's digest over the issued
 * option, invoice included, is what ties this payment to the ATR.
 */
async function namedBound(presented: unknown): Promise<AtrHash | Refusal> {
  if (!isObject(presented) || presented["x402Version"] !== 2) return refusal("x402/not-v2");
  const accepted = presented["accepted"];
  if (!isLnOption(accepted)) return refusal("x402/option-not-this-pairing");
  const b = checkOption(accepted, null);
  if (isRefusal(b)) return b;
  const extensions = presented["extensions"];
  const lc = isObject(extensions) ? extensions["legalContext"] : undefined;
  const decoded = isObject(lc) ? fromLegalContext({ legalContext: lc["info"] }) : null;
  return decoded === null ? refusal("ln/no-legal-context") : decoded.h;
}

export const exactLnbtcNamed = Object.freeze({
  id: NAMED,
  pattern: deepFreeze({
    pattern: "http-advisory",
    canonical: true,
    buyerSigns: false,
    onChain: false,
    zeroPartyRecoverable: false,
    forwardIndexable: false,
    publicProof: false,
    proves:
      X1_OPENING +
      "The ATR names this payment: its binding slot holds the payment option as issued, including the seller node's " +
      "signed BOLT11 invoice, whose payment hash the payer paid and whose description hash is x402's request hash. " +
      "The invoice does not carry this ATR's hash, and the payer signed nothing that does. The buyer's gate paid only " +
      "an invoice its ATR names, and the seller checked that the paid invoice is the one issued with this ATR. The " +
      "invoice and its preimage, which the parties hold, are the proof of the payment. No public ledger shows it. " +
      "This does not show that amount, payee or timing match the ATR's content.",
  } satisfies LcpPattern) as LcpPattern,
  claims: true as boolean,
  carrier: null,
  unplaced: (option: PaymentRequirements): PaymentRequirements => option,
  tie,
  advertise: namedAdvertise,
  read: readFor(filterOf(namedPairs)) as (doc: PaymentRequired) => X402Read | Refusal,
  build: namedBuild,
  bound: namedBound,
  reference: (presented: unknown) => x402Reference(presented, false),
});

/**
 * Which of the two x402 Lightning pairings an option belongs to: by whether its invoice has an `m` field. An option
 * whose `extra` has no `invoice` is the offer the seller sends before its node writes the invoice, so it is
 * `x402/exact/lnbtc`; an `invoice-named` option carries its invoice at issue.
 */
export function lnbtcPairingOf(option: unknown): typeof LNBTC | typeof NAMED | undefined {
  if (isLnOffer(option) && !Object.hasOwn(option.extra, "invoice")) return LNBTC;
  if (lnbtcPairs(option)) return LNBTC;
  if (namedPairs(option)) return NAMED;
  return undefined;
}


// ── mpp/charge/lightning and mpp/session/lightning ──

export type LnMppPairing = typeof LN_CHARGE | typeof LN_SESSION;
const LN_CHARGE = "mpp/charge/lightning" as const;
const LN_SESSION = "mpp/session/lightning" as const;
const MPP_NETWORKS: { readonly [n: string]: Bolt11["currency"] } = { mainnet: "bc", signet: "tbs", regtest: "bcrt" };
const CURRENCY_NETWORK: { readonly [c in Bolt11["currency"]]: string } = {
  bc: "mainnet",
  tb: "testnet",
  tbs: "signet",
  bcrt: "regtest",
};
const OPEN = "open";

export interface LnMppChoice {
  challenge: MppChallenge & { id: string };
  /** session only: the payer's return invoice, a BOLT11 invoice with no amount, which the open action registers. */
  returnInvoice?: string;
}

export interface LnMppUnsigned {
  request: { kind: "bolt11-pay"; invoice: string };
  complete(preimage: string): MppCredential | Refusal;
}

/** Where a pairing's invoice and payment hash sit in the decoded request. */
function lnFields(pairing: LnMppPairing, request: { [k: string]: Json }): { invoice: unknown; paymentHash: unknown } {
  if (pairing === LN_SESSION) return { invoice: request["depositInvoice"], paymentHash: request["paymentHash"] };
  const d = request["methodDetails"];
  return isObject(d) ? { invoice: d["invoice"], paymentHash: d["paymentHash"] } : { invoice: undefined, paymentHash: undefined };
}

/**
 * The checks of what the seller's node wrote: the invoice decodes, its one `h` is `h`, it has no `d`, the request has
 * no `description`, its payment hash is the request's, its currency is the challenge's `network`, and `expires` is no
 * later than the invoice's own expiry.
 */
function lnChallengeChecks(pairing: LnMppPairing, c: MppChallenge, h: AtrHash, placed: boolean): Bolt11 | Refusal {
  const checked = checkChallenge(c, placed);
  if (isRefusal(checked)) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  const { invoice, paymentHash } = lnFields(pairing, checked.request);
  if (typeof invoice !== "string") return refusal("ln/invoice-malformed");
  const b = decode(invoice);
  if (isRefusal(b)) return b;
  const d = invoiceH(b, "h");
  if (isRefusal(d) || d !== normalHash(h)) return refusal("mpp/carrier-not-challenge");
  if (b.tags.includes(FIELD.d)) return refusal("ln/description-inline");
  if (checked.request["description"] !== undefined) return refusal("ln/description-present");
  if (paymentHash !== hex(b.paymentHash)) return refusal("ln/payment-hash-mismatch");
  const network = checked.details["network"];
  if (pairing === LN_CHARGE && network !== undefined) {
    if (typeof network !== "string" || MPP_NETWORKS[network] !== b.currency) return refusal("ln/currency-network");
  }
  if (checked.expires > b.timestamp + b.expiry) return refusal("ln/expires-after-invoice");
  return b;
}

/** The challenge without its invoice, `request` re-encoded as base64url of its JCS form. */
function lnUnplaced(pairing: LnMppPairing): (c: MppChallenge) => MppChallenge {
  return (c) => {
    const request = isObject(c) && typeof c.request === "string" ? decodeObject(c.request) : undefined;
    if (request === undefined) return c;
    let rest: { [k: string]: Json };
    if (pairing === LN_SESSION) {
      const { depositInvoice: _, ...r } = request;
      rest = r;
    } else {
      const d = request["methodDetails"];
      if (!isObject(d)) return c;
      const { invoice: _, ...details } = d as { [k: string]: Json };
      rest = { ...request, methodDetails: details };
    }
    const text = canonicalJson(rest);
    return typeof text === "string" ? { ...c, request: b64uEncode(new TextEncoder().encode(text)) } : c;
  };
}

function lnAdvertise(pairing: LnMppPairing) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const b = lnChallengeChecks(pairing, offer, h, false);
    if (isRefusal(b)) return b;
    return place(doc, h, link, offer, agreementUrl);
  };
}

/**
 * The checks `advertise` makes that do not read the invoice: the challenge is one of this pairing, carries its payment
 * hash, has no request `description`, and names, when it names one, a network MPP Lightning defines.
 */
function lnOfferChecks(pairing: LnMppPairing, c: MppChallenge): Refusal | null {
  const checked = checkChallenge(c, false);
  if (isRefusal(checked)) return checked;
  if (!checked.pairings.includes(pairing)) return refusal("mpp/not-this-pairing");
  if (checked.request["description"] !== undefined) return refusal("ln/description-present");
  const network = checked.details["network"];
  if (pairing === LN_CHARGE && network !== undefined) {
    if (typeof network !== "string" || !Object.hasOwn(MPP_NETWORKS, network)) return refusal("ln/currency-network");
  }
  return null;
}

/** `advertise` for the challenge the seller sends before its node writes the invoice; the invoice is not read. */
function lnAdvertiseBeforeCarrier(pairing: LnMppPairing) {
  return (
    doc: readonly MppChallenge[],
    h: AtrHash,
    link: string,
    offer: MppChallenge,
    agreementUrl?: string,
  ): MppChallenge[] | Refusal => {
    const refused = lnOfferChecks(pairing, offer);
    return refused ?? place(doc, h, link, offer, agreementUrl);
  };
}

function lnBuild(pairing: LnMppPairing) {
  return async (choice: LnMppChoice, h: AtrHash): Promise<LnMppUnsigned | Refusal> => {
    if (!isObject(choice) || !isObject(choice.challenge) || typeof choice.challenge.id !== "string") {
      return refusal("mpp/credential-malformed");
    }
    const b = lnChallengeChecks(pairing, choice.challenge, h, true);
    if (isRefusal(b)) return b;
    const returnInvoice = choice.returnInvoice;
    if (pairing === LN_SESSION && !amountless(returnInvoice)) return refusal("ln/return-invoice-malformed");
    const { invoice } = lnFields(pairing, decodeObject(choice.challenge.request)!);
    const challenge = choice.challenge;
    return {
      request: { kind: "bolt11-pay", invoice: invoice as string },
      complete(preimage: string): MppCredential | Refusal {
        if (typeof preimage !== "string" || !PREIMAGE.test(preimage)) return refusal("ln/preimage-malformed");
        if (pairing === LN_CHARGE) return { challenge, payload: { preimage } };
        return { challenge, payload: { action: OPEN, preimage, returnInvoice: returnInvoice as string } };
      },
    };
  };
}

/** Whether `v` is a BOLT11 invoice with no amount in its human-readable part. */
function amountless(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const b = decode(v);
  return !isRefusal(b) && b.amountMsat === null;
}

/**
 * The echoed challenge's hash, held to the invoice the payer paid. On the session, only the open action is the
 * session's payment. No signature is verified here.
 */
async function lnPaid(pairing: LnMppPairing, input: unknown): Promise<{ h: AtrHash; b: Bolt11; request: { [k: string]: Json } } | Refusal> {
  const presented = credentialOf(input);
  if (isRefusal(presented)) return presented;
  const cb = challengeBound(presented);
  if (isRefusal(cb)) return cb;
  const c = presented.challenge;
  if (c.method !== "lightning" || c.intent !== (pairing === LN_CHARGE ? "charge" : "session")) return refusal("mpp/not-this-pairing");
  const { invoice, paymentHash } = lnFields(pairing, cb.request);
  const b = typeof invoice === "string" ? decode(invoice) : refusal("ln/invoice-malformed");
  if (isRefusal(b)) return b;
  const d = invoiceH(b, "h");
  if (isRefusal(d) || d !== cb.h) return refusal("mpp/carrier-not-challenge");
  if (paymentHash !== hex(b.paymentHash)) return refusal("ln/payment-hash-mismatch");
  if (pairing === LN_SESSION && presented.payload["action"] !== OPEN) return refusal("ln/no-payment-in-action");
  return { h: cb.h, b, request: cb.request };
}

function lnBound(pairing: LnMppPairing) {
  return async (presented: unknown): Promise<AtrHash | Refusal> => {
    const p = await lnPaid(pairing, presented);
    return isRefusal(p) ? p : p.h;
  };
}

/**
 * The read keys: the network the challenge names, else the invoice currency's; the invoice's payment hash; and its
 * timestamp plus expiry.
 */
function lnReference(pairing: LnMppPairing) {
  return async (presented: unknown): Promise<LnRef | Refusal> => {
    const p = await lnPaid(pairing, presented);
    if (isRefusal(p)) return p;
    const d = p.request["methodDetails"];
    const named = isObject(d) && typeof d["network"] === "string" ? d["network"] : undefined;
    return { network: named ?? CURRENCY_NETWORK[p.b.currency], paymentHash: hex(p.b.paymentHash), settleBy: p.b.timestamp + p.b.expiry };
  };
}

const MPP_LN_PROVES =
  X1_OPENING +
  "The seller's node signed a BOLT11 invoice whose description hash is this ATR's hash, and whose payment hash the " +
  "ATR commits. " +
  PAID;

function lnMppBinding<P extends LnMppPairing>(id: P, carrier: string, proves: string = MPP_LN_PROVES) {
  return Object.freeze({
    id,
    pattern: deepFreeze({
      pattern: "native-field",
      canonical: true,
      profile: "mpp/charge",
      buyerSigns: false,
      onChain: false,
      zeroPartyRecoverable: false,
      forwardIndexable: false,
      publicProof: false,
      proves,
    } satisfies LcpPattern) as LcpPattern,
    claims: true as boolean,
    carrier,
    unplaced: lnUnplaced(id),
    tie: mppTie,
    read: mppRead,
    advertise: lnAdvertise(id),
    advertiseBeforeCarrier: lnAdvertiseBeforeCarrier(id),
    build: lnBuild(id),
    bound: lnBound(id),
    reference: lnReference(id),
  });
}

export const chargeLightning = lnMppBinding(LN_CHARGE, "request.methodDetails.invoice#h");
/** The one network name every Lightning session channel key carries: a bearer or close challenge names no invoice. */
const SESSION_CHANNEL_NETWORK = "lightning";
const PAYMENT_HASH = /^[0-9a-fA-F]{64}$/;

/** The session action: open opens the channel, bearer and topUp are within it, close ends it. */
function sessionKind(presented: unknown): "open" | "within" | "close" | Refusal {
  const c = credentialOf(presented);
  if (isRefusal(c)) return c;
  const a = c.payload["action"];
  if (a === OPEN) return "open";
  if (a === "bearer" || a === "topUp") return "within";
  if (a === "close") return "close";
  return refusal("mpp/session-action");
}

/** The session's id: the open's challenge `paymentHash`, else the payload's `sessionId`, as lowercase hex. */
async function sessionRef(presented: unknown): Promise<{ network: string; channel: string } | Refusal> {
  const k = sessionKind(presented);
  if (isRefusal(k)) return k;
  const c = presented as MppCredential;
  const request = typeof c.challenge.request === "string" ? decodeObject(c.challenge.request) : undefined;
  const id = k === "open" ? request?.["paymentHash"] : c.payload["sessionId"];
  if (typeof id !== "string" || !PAYMENT_HASH.test(id)) return refusal("mpp/credential-malformed");
  return { network: SESSION_CHANNEL_NETWORK, channel: id.toLowerCase() };
}

/** A bearer proof is the deposit preimage, and a topUp pays a new invoice: neither carries the hash. */
async function sessionBoundWithin(_presented: unknown): Promise<AtrHash | Refusal> {
  return refusal("mpp/not-bound-within");
}

const MPP_LN_SESSION_PROVES =
  MPP_LN_PROVES +
  " Later requests in this session were paid under this ATR from its deposit, by bearer proofs the seller did not " +
  "meter. The close is the seller's report.";

export const sessionLightning = Object.freeze({
  ...lnMppBinding(LN_SESSION, "request.depositInvoice#h", MPP_LN_SESSION_PROVES),
  channel: Object.freeze({
    kind: sessionKind,
    ref: sessionRef,
    boundWithin: sessionBoundWithin,
    until: (_presented: unknown): number | undefined => undefined,
  }),
});
