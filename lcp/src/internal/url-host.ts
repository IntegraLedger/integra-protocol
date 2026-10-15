/**
 * The WHATWG URL Standard's host parser (§3.5), its domain parser (§3.3, UTS #46 ToASCII with the flags the Standard
 * sets, over the Unicode 17.0.0 data in idna-data.ts), and the part of its basic URL parser (§4.4) that reads an
 * absolute URL's scheme and authority. Each reads a string as the Standard reads a scalar value string: a lone
 * surrogate is U+FFFD, as Web IDL's USVString conversion gives it.
 *
 * Unicode normalization form C is UAX #15 over the tables, Punycode is RFC 3492 with its integers bounded at 2^31 − 1,
 * ContextJ is RFC 5892 appendix A.1 and A.2, and the bidi rule is RFC 5893 §2. No answer depends on the runtime's own
 * URL parser, normalization or Unicode version.
 */
import * as D from "./idna-data.js";

const SPECIAL = new Set(["ftp", "file", "http", "https", "ws", "wss"]);
/** The forbidden host code points (§3.5). */
const FORBIDDEN_HOST = /[\u0000\t\n\r #/:<>?@[\\\]^|]/;
/** The forbidden domain code points: the forbidden host code points, the C0 controls, `%` and U+007F. */
const FORBIDDEN_DOMAIN = /[\u0000-\u0020#%/:<>?@[\\\]^|\u007f]/;
const ASCII = /^[\u0000-\u007f]*$/;

/** The value of the range holding `cp`, in a table of sorted range starts. */
function rangeOf(starts: readonly number[], cp: number): number {
  let lo = 0;
  let hi = starts.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid]! <= cp) lo = mid;
    else hi = mid;
  }
  return lo;
}

const codePoints = (s: string): number[] => Array.from(s, (c) => c.codePointAt(0)!);
const fromCodePoints = (cps: readonly number[]): string => cps.map((c) => String.fromCodePoint(c)).join("");
const ccc = (cp: number): number => D.CCC[rangeOf(D.CCC_STARTS, cp)]!;
const mappingOf = (cp: number): number | string | null => D.MAPPING[rangeOf(D.MAPPING_STARTS, cp)]!;
const bidiOf = (cp: number): string => D.BIDI[rangeOf(D.BIDI_STARTS, cp)]!;
const joiningOf = (cp: number): string => D.JOINING[rangeOf(D.JOINING_STARTS, cp)]!;
/** General_Category Mark: the runs of MARK_STARTS alternate, starting with a run of non-marks at U+0000. */
const isMark = (cp: number): boolean => rangeOf(D.MARK_STARTS, cp) % 2 === 1;

// Unicode normalization form C (UAX #15).
const S_BASE = 0xac00;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;

/** Each code point's full canonical decomposition, and each primary composite by its pair, built at first use. */
let normalization: { decomposed: Map<number, number[]>; composed: Map<number, number> } | undefined;
function tablesForNfc(): { decomposed: Map<number, number[]>; composed: Map<number, number> } {
  if (normalization !== undefined) return normalization;
  const one = new Map(D.DECOMPOSITIONS.map(([cp, d]) => [cp, codePoints(d)]));
  const full = (cp: number): number[] => {
    const d = one.get(cp);
    return d === undefined ? [cp] : d.flatMap(full);
  };
  const excluded = new Set(D.COMPOSITION_EXCLUSIONS);
  const decomposed = new Map<number, number[]>();
  const composed = new Map<number, number>();
  for (const [cp, d] of one) {
    decomposed.set(cp, full(cp));
    if (d.length === 2 && !excluded.has(cp)) composed.set(d[0]! * 0x110000 + d[1]!, cp);
  }
  normalization = { decomposed, composed };
  return normalization;
}

function composite(a: number, b: number, composed: Map<number, number>): number | undefined {
  if (a >= L_BASE && a < L_BASE + L_COUNT && b >= V_BASE && b < V_BASE + V_COUNT) {
    return S_BASE + ((a - L_BASE) * V_COUNT + b - V_BASE) * T_COUNT;
  }
  const s = a - S_BASE;
  if (s >= 0 && s < S_COUNT && s % T_COUNT === 0 && b > T_BASE && b < T_BASE + T_COUNT) return a + b - T_BASE;
  return composed.get(a * 0x110000 + b);
}

/** Normalization form C of code points: canonical decomposition, the canonical ordering, then canonical composition. */
export function nfc(cps: readonly number[]): number[] {
  if (cps.every((c) => c < 0x80)) return [...cps];
  const { decomposed, composed } = tablesForNfc();
  const flat: number[] = [];
  for (const cp of cps) {
    const s = cp - S_BASE;
    if (s >= 0 && s < S_COUNT) {
      flat.push(L_BASE + Math.floor(s / N_COUNT), V_BASE + Math.floor((s % N_COUNT) / T_COUNT));
      if (s % T_COUNT !== 0) flat.push(T_BASE + (s % T_COUNT));
    } else flat.push(...(decomposed.get(cp) ?? [cp]));
  }
  const ordered: number[] = [];
  let marks: number[] = [];
  const byClass = (a: number, b: number) => ccc(a) - ccc(b);
  for (const cp of flat) {
    if (ccc(cp) === 0) {
      ordered.push(...marks.sort(byClass), cp);
      marks = [];
    } else marks.push(cp);
  }
  ordered.push(...marks.sort(byClass));
  const out: number[] = [];
  let starter = -1;
  for (const cp of ordered) {
    const c = ccc(cp);
    // After the canonical ordering, the last code point kept since the starter has the highest class among those
    // between.
    const blocked = out.length - 1 > starter && (ccc(out.at(-1)!) === 0 || ccc(out.at(-1)!) >= c);
    if (starter >= 0 && !blocked) {
      const p = composite(out[starter]!, cp, composed);
      if (p !== undefined) {
        out[starter] = p;
        continue;
      }
    }
    if (c === 0) starter = out.length;
    out.push(cp);
  }
  return out;
}

// Punycode (RFC 3492), its integers bounded at 2^31 − 1.
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const MAXINT = 0x7fffffff;
const DIGITS = "abcdefghijklmnopqrstuvwxyz0123456789";

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

const threshold = (k: number, bias: number): number => (k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias);

/** An ASCII character's value as a Punycode digit, or undefined. */
function digitOf(c: number | undefined): number | undefined {
  if (c === undefined) return undefined;
  if (c >= 0x61 && c <= 0x7a) return c - 0x61;
  if (c >= 0x41 && c <= 0x5a) return c - 0x41;
  if (c >= 0x30 && c <= 0x39) return c - 0x30 + 26;
  return undefined;
}

/** The code points an ASCII Punycode string encodes, or null where RFC 3492's decoder fails. */
function punycodeDecode(text: string): number[] | null {
  const delimiter = text.lastIndexOf("-");
  const out = delimiter > 0 ? codePoints(text.slice(0, delimiter)) : [];
  let pos = delimiter > 0 ? delimiter + 1 : 0;
  let n = 0x80;
  let i = 0;
  let bias = 72;
  while (pos < text.length) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      const digit = digitOf(pos < text.length ? text.charCodeAt(pos) : undefined);
      pos++;
      if (digit === undefined || digit > Math.floor((MAXINT - i) / w)) return null;
      i += digit * w;
      const t = threshold(k, bias);
      if (digit < t) break;
      if (w > Math.floor(MAXINT / (BASE - t))) return null;
      w *= BASE - t;
    }
    bias = adapt(i - oldI, out.length + 1, oldI === 0);
    if (Math.floor(i / (out.length + 1)) > MAXINT - n) return null;
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10ffff) return null;
    out.splice(i, 0, n);
    i++;
  }
  return out;
}

/** RFC 3492's encoding of a label, or null where the encoder fails. */
function punycodeEncode(cps: readonly number[]): string | null {
  let out = fromCodePoints(cps.filter((c) => c < 0x80));
  const b = out.length;
  let h = b;
  if (b > 0) out += "-";
  let n = 0x80;
  let delta = 0;
  let bias = 72;
  while (h < cps.length) {
    let m = Infinity;
    for (const c of cps) if (c >= n && c < m) m = c;
    if (m - n > Math.floor((MAXINT - delta) / (h + 1))) return null;
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of cps) {
      if (c < n) {
        delta++;
        if (delta > MAXINT) return null;
      } else if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = threshold(k, bias);
          if (q < t) break;
          out += DIGITS[t + ((q - t) % (BASE - t))];
          q = Math.floor((q - t) / (BASE - t));
        }
        out += DIGITS[q];
        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

// UTS #46 processing and ToASCII.
const FULL_STOP = 0x2e;
const HYPHEN = 0x2d;
const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const VIRAMA = 9;

/** CheckHyphens, UseSTD3ASCIIRules and VerifyDnsLength: UTS #46's flags that the URL Standard's two calls set apart. */
type Strictness = { strict: boolean };

/** The Map step: a disallowed code point is kept, and the validity criteria refuse it. */
function mapped(cps: readonly number[]): number[] {
  const out: number[] = [];
  for (const cp of cps) {
    const m = mappingOf(cp);
    if (m === null) out.push(cp);
    else if (typeof m === "number") out.push(cp + m);
    else out.push(...codePoints(m));
  }
  return out;
}

/**
 * RFC 5892 appendix A.1 and A.2: a joiner after a virama, or a ZWNJ between a left- or dual-joining letter and a right-
 * or dual-joining one, with only transparent letters between.
 */
function joinerAllowed(label: readonly number[], i: number): boolean {
  if (i > 0 && ccc(label[i - 1]!) === VIRAMA) return true;
  if (label[i] === ZWJ) return false;
  let before = i - 1;
  while (before >= 0 && joiningOf(label[before]!) === "T") before--;
  let after = i + 1;
  while (after < label.length && joiningOf(label[after]!) === "T") after++;
  if (before < 0 || after >= label.length) return false;
  return "LD".includes(joiningOf(label[before]!)) && "RD".includes(joiningOf(label[after]!));
}

/** RFC 5893 §2's six conditions, for a label of a domain name that holds an R, AL or AN code point. */
function meetsBidiRule(label: readonly number[]): boolean {
  const classes = label.map(bidiOf);
  let last = classes.length - 1;
  while (last >= 0 && classes[last] === "M") last--;
  const end = classes[last] ?? "";
  if (classes[0] === "R" || classes[0] === "A") {
    const numbers = classes.includes("E") && classes.includes("N");
    return classes.every((x) => "RANESCTOBM".includes(x)) && end !== "" && "RAEN".includes(end) && !numbers;
  }
  return classes[0] === "L" && classes.every((x) => "LESCTOBM".includes(x)) && end !== "" && "LE".includes(end);
}

/**
 * UTS #46 §4.1 for a non-empty label, under nontransitional processing with CheckJoiners, and CheckHyphens and
 * UseSTD3ASCIIRules as `flags` sets them. A label from Punycode must also be in NFC and hold no full stop; every other
 * label is in NFC by the Normalize step, and holds no full stop since the domain is split at each one.
 */
function meetsValidityCriteria(label: readonly number[], fromPunycode: boolean, { strict }: Strictness): boolean {
  if (fromPunycode) {
    const normal = nfc(label);
    if (normal.length !== label.length || normal.some((c, i) => c !== label[i])) return false;
    if (label.includes(FULL_STOP)) return false;
  }
  if (strict) {
    if (label[2] === HYPHEN && label[3] === HYPHEN) return false;
    if (label[0] === HYPHEN || label.at(-1) === HYPHEN) return false;
  } else if (fromCodePoints(label.slice(0, 4)) === "xn--") return false;
  if (isMark(label[0]!)) return false;
  for (const cp of label) {
    if (mappingOf(cp) !== 0) return false;
    if (strict && cp < 0x80 && !/^[a-z0-9-]$/.test(String.fromCharCode(cp))) return false;
  }
  return label.every((cp, i) => (cp !== ZWNJ && cp !== ZWJ) || joinerAllowed(label, i));
}

/**
 * UTS #46 ToASCII with nontransitional processing, CheckBidi, CheckJoiners and IgnoreInvalidPunycode false, and with
 * CheckHyphens, UseSTD3ASCIIRules and VerifyDnsLength each `flags.strict`: the URL Standard's domain parser ToASCII.
 * Null where it records an error.
 */
function toAscii(domain: string, flags: Strictness): string | null {
  const labels: number[][] = [];
  const split: number[][] = [[]];
  for (const cp of nfc(mapped(codePoints(domain)))) {
    if (cp === FULL_STOP) split.push([]);
    else split.at(-1)!.push(cp);
  }
  for (const raw of split) {
    let label = raw;
    if (fromCodePoints(label.slice(0, 4)) === "xn--") {
      const decoded = label.every((c) => c < 0x80) ? punycodeDecode(fromCodePoints(label.slice(4))) : null;
      if (decoded === null || decoded.every((c) => c < 0x80)) return null;
      if (!meetsValidityCriteria(decoded, true, flags)) return null;
      label = decoded;
    } else if (label.length > 0 && !meetsValidityCriteria(label, false, flags)) return null;
    labels.push(label);
  }
  const rtl = labels.some((label) => label.some((cp) => "RAN".includes(bidiOf(cp))));
  if (rtl && !labels.every((label) => label.length === 0 || meetsBidiRule(label))) return null;
  const out: string[] = [];
  for (const label of labels) {
    if (label.every((c) => c < 0x80)) {
      out.push(fromCodePoints(label));
      continue;
    }
    const encoded = punycodeEncode(label);
    if (encoded === null) return null;
    out.push(`xn--${encoded}`);
  }
  if (flags.strict) {
    const total = out.reduce((n, l) => n + l.length, out.length - 1);
    if (total < 1 || total > 253 || out.some((l) => l.length < 1 || l.length > 63)) return null;
  }
  return out.join(".");
}

/**
 * The URL Standard's domain parser (§3.3, "IDNA"): the ASCII form of a domain, or null for failure.
 *
 * With `beStrict` false, the URL parser's call: an ASCII domain is lowercased, and any other is read by UTS #46 ToASCII
 * (Unicode 17.0.0) with CheckBidi and CheckJoiners, nontransitional processing, and CheckHyphens, UseSTD3ASCIIRules and
 * VerifyDnsLength false; the result fails when it is empty or holds a forbidden domain code point. With `beStrict`
 * true, every domain is read by ToASCII with CheckHyphens, UseSTD3ASCIIRules and VerifyDnsLength true as well, and its
 * result is the answer. A lone surrogate is read as U+FFFD, which every domain parse refuses.
 */
export function domainToAscii(domain: string, beStrict = false): string | null {
  if (typeof domain !== "string") return null;
  const d = domain.toWellFormed();
  if (beStrict) return toAscii(d, { strict: true });
  const result = ASCII.test(d) ? d.toLowerCase() : toAscii(d, { strict: false });
  if (result === null || result === "" || FORBIDDEN_DOMAIN.test(result)) return null;
  return result;
}

/** The URL Standard's IPv4 number parser: the number a part writes, in decimal, `0x` hex or `0`-led octal, or null. */
function ipv4Number(part: string): number | null {
  if (part === "") return null;
  let digits = part;
  let radix = 10;
  if (/^0[xX]/.test(part)) {
    digits = part.slice(2);
    radix = 16;
  } else if (part.length > 1 && part[0] === "0") {
    digits = part.slice(1);
    radix = 8;
  }
  if (digits === "") return 0;
  const valid = radix === 16 ? /^[0-9A-Fa-f]+$/ : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
  if (!valid.test(digits)) return null;
  // A value past 2^53 loses precision, and stays past every bound the IPv4 parser compares it with.
  return Number.parseInt(digits, radix);
}

/** The parts of a dotted host, without one empty last part. */
function dottedParts(host: string): string[] {
  const parts = host.split(".");
  if (parts.at(-1) === "" && parts.length > 1) parts.pop();
  return parts;
}

/** The URL Standard's ends-in-a-number checker. */
function endsInANumber(host: string): boolean {
  const last = dottedParts(host).at(-1)!;
  return last !== "" && (/^[0-9]+$/.test(last) || ipv4Number(last) !== null);
}

/** The URL Standard's IPv4 parser, serialized: four decimal numbers joined by dots, or null for failure. */
function ipv4(host: string): string | null {
  const parts = dottedParts(host);
  if (parts.length > 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    const n = ipv4Number(part);
    if (n === null) return null;
    numbers.push(n);
  }
  if (numbers.slice(0, -1).some((n) => n > 255)) return null;
  const last = numbers.at(-1)!;
  if (last >= 256 ** (5 - numbers.length)) return null;
  let address = last;
  numbers.slice(0, -1).forEach((n, i) => {
    address += n * 256 ** (3 - i);
  });
  return [24, 16, 8, 0].map((s) => Math.floor(address / 2 ** s) % 256).join(".");
}

const isHex = (c: string | undefined): boolean => c !== undefined && /^[0-9A-Fa-f]$/.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

/** The URL Standard's IPv6 parser: the eight pieces, or null for failure. */
function ipv6(input: string): number[] | null {
  const address = [0, 0, 0, 0, 0, 0, 0, 0];
  const s = Array.from(input);
  let pieceIndex = 0;
  let compress: number | null = null;
  let p = 0;
  if (s[p] === ":") {
    if (s[p + 1] !== ":") return null;
    p += 2;
    pieceIndex++;
    compress = pieceIndex;
  }
  while (p < s.length) {
    if (pieceIndex === 8) return null;
    if (s[p] === ":") {
      if (compress !== null) return null;
      p++;
      pieceIndex++;
      compress = pieceIndex;
      continue;
    }
    let value = 0;
    let length = 0;
    while (length < 4 && isHex(s[p])) {
      value = value * 0x10 + Number.parseInt(s[p]!, 16);
      p++;
      length++;
    }
    if (s[p] === ".") {
      if (length === 0) return null;
      p -= length;
      if (pieceIndex > 6) return null;
      let numbersSeen = 0;
      while (p < s.length) {
        let piece: number | null = null;
        if (numbersSeen > 0) {
          if (s[p] === "." && numbersSeen < 4) p++;
          else return null;
        }
        if (!isDigit(s[p])) return null;
        while (isDigit(s[p])) {
          const number = Number(s[p]);
          if (piece === null) piece = number;
          else if (piece === 0) return null;
          else piece = piece * 10 + number;
          if (piece > 255) return null;
          p++;
        }
        address[pieceIndex] = address[pieceIndex]! * 0x100 + piece!;
        numbersSeen++;
        if (numbersSeen === 2 || numbersSeen === 4) pieceIndex++;
      }
      if (numbersSeen !== 4) return null;
      break;
    } else if (s[p] === ":") {
      p++;
      if (p >= s.length) return null;
    } else if (p < s.length) return null;
    address[pieceIndex] = value;
    pieceIndex++;
  }
  if (compress !== null) {
    let swaps = pieceIndex - compress;
    pieceIndex = 7;
    while (pieceIndex !== 0 && swaps > 0) {
      const other = compress + swaps - 1;
      [address[pieceIndex], address[other]] = [address[other]!, address[pieceIndex]!];
      pieceIndex--;
      swaps--;
    }
  } else if (pieceIndex !== 8) return null;
  return address;
}

/** The URL Standard's IPv6 serializer: lowercase hex pieces, the first longest run of two or more zeros as `::`. */
function serializeIpv6(address: readonly number[]): string {
  let best = -1;
  let bestLength = 1;
  for (let i = 0; i < 8; ) {
    let j = i;
    while (j < 8 && address[j] === 0) j++;
    if (j - i > bestLength) {
      best = i;
      bestLength = j - i;
    }
    i = j === i ? i + 1 : j;
  }
  let out = "";
  let ignore0 = false;
  for (let i = 0; i < 8; i++) {
    if (ignore0 && address[i] === 0) continue;
    ignore0 = false;
    if (i === best) {
      out += i === 0 ? "::" : ":";
      ignore0 = true;
      continue;
    }
    out += address[i]!.toString(16);
    if (i !== 7) out += ":";
  }
  return out;
}

const utf8 = new TextEncoder();

/** UTF-8 percent-encoding with the C0 control percent-encode set: each C0 control and each code point past U+007E. */
function percentEncodeC0(s: string): string {
  let out = "";
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (cp > 0x1f && cp < 0x7f) out += c;
    else for (const b of utf8.encode(c)) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * UTF-8 decode without BOM of the percent-decoding of a string, or null where the bytes are not UTF-8. For those bytes
 * the Standard's decode gives U+FFFD, which the IDNA Mapping Table disallows, so the domain parser fails on its result:
 * null is the host parser's answer for every such input.
 */
function percentDecode(s: string): string | null {
  if (!s.includes("%")) return s;
  const bytes = utf8.encode(s);
  const out: number[] = [];
  const hex = (b: number | undefined) => b !== undefined && /^[0-9A-Fa-f]$/.test(String.fromCharCode(b));
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x25 && hex(bytes[i + 1]) && hex(bytes[i + 2])) {
      out.push(Number.parseInt(String.fromCharCode(bytes[i + 1]!, bytes[i + 2]!), 16));
      i += 2;
    } else out.push(bytes[i]!);
  }
  try {
    return strictUtf8.decode(new Uint8Array(out));
  } catch {
    return null;
  }
}

/**
 * The URL Standard's host parser (§3.5), with the host serializer (§3.6): the serialized host, or null for failure.
 *
 * `[…]` is read by the IPv6 parser and serialized in brackets, compressed. With `isOpaque` true (the host of a URL
 * whose scheme is not special) any other input is an opaque host: it fails on a forbidden host code point, and is
 * otherwise UTF-8 percent-encoded with the C0 control percent-encode set. Otherwise the input is percent-decoded,
 * decoded as UTF-8, and read by the domain parser (`domainToAscii` with `beStrict` false); a domain whose last label is
 * a number is read by the IPv4 parser, in decimal, `0x` hex or `0`-led octal parts, and serialized as four decimal
 * numbers. The empty string is an opaque host, and a failure otherwise. A lone surrogate is read as U+FFFD, and so are
 * percent-encoded bytes that are not UTF-8, which the domain parser fails on.
 */
export function parseHost(input: string, isOpaque = false): string | null {
  if (typeof input !== "string") return null;
  const s = input.toWellFormed();
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) return null;
    const address = ipv6(s.slice(1, -1));
    return address === null ? null : `[${serializeIpv6(address)}]`;
  }
  if (isOpaque) return FORBIDDEN_HOST.test(s) ? null : percentEncodeC0(s);
  const decoded = percentDecode(s);
  if (decoded === null) return null;
  const asciiDomain = domainToAscii(decoded);
  if (asciiDomain === null) return null;
  return endsInANumber(asciiDomain) ? ipv4(asciiDomain) : asciiDomain;
}

/** What the basic URL parser gives for an absolute URL's scheme and authority. */
export type UrlAuthority = {
  /** The scheme, lowercased. */
  scheme: string;
  /** The serialized host, or null for a URL with no authority. */
  host: string | null;
  /** Whether the URL has a username or a password that is not empty. */
  credentials: boolean;
  /** The port, or null where the URL names none. */
  port: number | null;
};

/**
 * The scheme and authority of a string that the URL Standard's basic URL parser (§4.4) reads, with no base, as an
 * absolute URL, or null where it returns failure. Only the scheme and the authority can fail: the parser's path, query
 * and fragment states accept every input, so they are not read.
 */
export function readUrl(input: string): UrlAuthority | null {
  const s = input.toWellFormed().replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "").replace(/[\t\n\r]/g, "");
  const m = /^[A-Za-z][A-Za-z0-9+.-]*:/.exec(s);
  if (m === null) return null;
  const scheme = m[0].slice(0, -1).toLowerCase();
  const rest = s.slice(m[0].length);
  const special = SPECIAL.has(scheme);
  const none: UrlAuthority = { scheme, host: null, credentials: false, port: null };
  if (scheme === "file") {
    // The file state, then the file slash state: two slashes or backslashes start the file host state.
    if (!/^[/\\]{2}/.test(rest)) return { ...none, host: "" };
    const buffer = /^[^/\\?#]*/.exec(rest.slice(2))![0];
    if (buffer === "" || /^[A-Za-z][:|]$/.test(buffer)) return { ...none, host: "" };
    const host = parseHost(buffer);
    if (host === null) return null;
    return { ...none, host: host === "localhost" ? "" : host };
  }
  let authority: string;
  if (special) {
    // The special authority slashes and ignore slashes states skip every slash and backslash.
    authority = /^[/\\]*([^/\\?#]*)/.exec(rest)![1]!;
  } else if (rest.startsWith("//")) {
    authority = /^[^/?#]*/.exec(rest.slice(2))![0];
  } else return none;
  // The authority state: everything before the last `@` is the userinfo, split into username and password at its first
  // `:`.
  const at = authority.lastIndexOf("@");
  const userinfo = at < 0 ? "" : authority.slice(0, at);
  const hostPort = authority.slice(at + 1);
  if (at >= 0 && hostPort === "") return null;
  // The host state: a `:` outside brackets ends the host and starts the port.
  let inside = false;
  let colon = -1;
  for (let i = 0; i < hostPort.length && colon < 0; i++) {
    const c = hostPort[i];
    if (c === "[") inside = true;
    else if (c === "]") inside = false;
    else if (c === ":" && !inside) colon = i;
  }
  const hostText = colon < 0 ? hostPort : hostPort.slice(0, colon);
  if (hostText === "" && (colon >= 0 || special)) return null;
  const host = parseHost(hostText, !special);
  if (host === null) return null;
  let port: number | null = null;
  if (colon >= 0) {
    const digits = hostPort.slice(colon + 1);
    if (!/^[0-9]*$/.test(digits)) return null;
    if (digits !== "") {
      port = Number(digits);
      if (port > 65_535) return null;
    }
  }
  return { scheme, host, credentials: userinfo !== "" && userinfo !== ":", port };
}
