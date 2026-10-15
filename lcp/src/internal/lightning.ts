/**
 * BOLT11 decoding and the x402 Lightning option filters. `../lightning.ts` decodes with `decode` (its `decodeBolt11`
 * returns the result) and filters its options with these; the root's `pairingOf` names an x402 Lightning option's
 * pairing through `lnbtcPairingOf`. No entry point exports these names.
 */
import type { Json } from "../core.js";
import { isObject } from "../fields.js";
import type { Bolt11, LnNetwork } from "../lightning.js";
import { isRefusal, refusal, type Refusal } from "../refusal.js";
import type { PaymentRequirements } from "../x402.js";
import type { OptionFilter } from "./x402.js";

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
/** The `d` field's text: strict UTF-8 with a leading byte-order mark kept as a character. */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** A BOLT11 invoice decoded, up to 8 KiB. The signature is not verified. */
export function decode(invoice: string): Bolt11 | Refusal {
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

/** An `exact` option on a Lightning network with an invoice string: the part of the filter both pairings share. */
export function isLnOption(o: unknown): o is PaymentRequirements & { extra: { invoice: string } } {
  if (!isObject(o) || o["scheme"] !== "exact") return false;
  const n = o["network"];
  if (typeof n !== "string" || !Object.hasOwn(NETWORKS, n)) return false;
  const extra = o["extra"];
  return isObject(extra) && typeof extra["invoice"] === "string";
}

/**
 * The option filter of the x402 Lightning pairing whose invoice has an `m` field (`want` true) or none: an `exact`
 * option on a Lightning network whose invoice decodes, with an `m` field or without one. An invoice that does not
 * decode gives the decoder's refusal; one without an `m` field is `ln/no-metadata` where the pairing needs one, and one
 * with an `m` field is `ln/not-this-pairing` where the pairing has none. The pairing's `read` offers the options it
 * serves, and its `bound` holds a presented payment's option to it.
 */
function withMetadata(want: boolean): OptionFilter {
  return (o) => {
    if (!isLnOption(o)) return undefined;
    const b = decode(o.extra.invoice);
    if (isRefusal(b)) return b;
    if (b.tags.includes(FIELD.m) === want) return true;
    return want ? refusal("ln/no-metadata") : refusal("ln/not-this-pairing");
  };
}

/** An `exact` option on a Lightning network whose `extra` is an object, with or without an invoice. */
export function isLnOffer(o: unknown): o is PaymentRequirements & { extra: { [k: string]: Json } } {
  if (!isObject(o) || o["scheme"] !== "exact") return false;
  const n = o["network"];
  return typeof n === "string" && Object.hasOwn(NETWORKS, n) && isObject(o["extra"]);
}

/** `x402/exact/lnbtc`'s option filter: its invoice has an `m` field (`ln/no-metadata` otherwise). */
export const lnbtcFilter = withMetadata(true);
/** `x402/exact/lnbtc/invoice-named`'s option filter: its invoice has no `m` field (`ln/not-this-pairing` otherwise). */
export const namedFilter = withMetadata(false);

/**
 * Which of the two x402 Lightning pairings an option belongs to: by whether its invoice has an `m` field. An option
 * whose `extra` has no `invoice` is the offer the seller sends before its node writes the invoice, so it is
 * `x402/exact/lnbtc`; an `invoice-named` option carries its invoice at issue.
 */
export function lnbtcPairingOf(option: unknown): "x402/exact/lnbtc" | "x402/exact/lnbtc/invoice-named" | undefined {
  if (isLnOffer(option) && !Object.hasOwn(option.extra, "invoice")) return "x402/exact/lnbtc";
  if (lnbtcFilter(option as PaymentRequirements) === true) return "x402/exact/lnbtc";
  if (namedFilter(option as PaymentRequirements) === true) return "x402/exact/lnbtc/invoice-named";
  return undefined;
}
