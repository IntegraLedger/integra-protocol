// The package's Punycode encoder and decoder (internal/url-host.ts), which take O(n log n) time, against RFC 3492's own
// procedures (rfc3492.ts), which scan or insert once per code point: the same answer, a string or null, for each label
// below. The labels are drawn by a seeded generator, so every run compares the same ones. IdnaTestV2.txt's labels are
// compared in url-host-conformance.test.ts.
import { describe, expect, it } from "vitest";
import { punycodeDecode, punycodeEncode } from "../src/internal/url-host.js";
import { rfc3492Decode, rfc3492Encode } from "./rfc3492.js";
import { rowsOf } from "./rows.js";

/** mulberry32: a seeded generator of numbers in [0, 1). */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = generator(20261015);
const below = (n: number): number => Math.floor(random() * n);
const between = (lo: number, hi: number): number => lo + below(hi - lo + 1);

/** A code point of one kind: 0 basic (below U+0080), 1 past U+007F in the BMP, 2 astral. Never a surrogate. */
function codePoint(kind: number): number {
  if (kind === 0) return below(0x80);
  if (kind === 2) return between(0x10000, 0x10ffff);
  const c = between(0x80, 0xffff - 0x800);
  return c < 0xd800 ? c : c + 0x800;
}

/**
 * A label of `size` code points drawn from a pool of distinct ones: one, a few, many, or as many as the label is long,
 * so some code points repeat and some do not. Each label draws its own proportions of the three kinds.
 */
function label(size: number): number[] {
  const poolSize = [1, between(2, 8), between(9, 300), Math.max(1, size)][below(4)]!;
  const weights = [random(), random(), random()];
  const total = weights[0]! + weights[1]! + weights[2]!;
  const kind = (): number => {
    const x = random() * total;
    return x < weights[0]! ? 0 : x < weights[0]! + weights[1]! ? 1 : 2;
  };
  const pool = Array.from({ length: poolSize }, () => codePoint(kind()));
  return Array.from({ length: size }, () => pool[below(poolSize)]!);
}

const SIZES: readonly (readonly [number, number, number])[] = [
  // [labels, least size, greatest size]
  [400, 0, 16],
  [250, 17, 300],
  [80, 301, 4000],
];

/**
 * A label of 1,900 to 2,500 basic code points with one or two code points from U+C0000 to U+10FFFF among them, so the
 * encoder's first step past the basic code points, (m − 0x80) × (h + 1), falls on either side of 2^31 − 1.
 */
function nearTheBound(): number[] {
  const cps = Array.from({ length: between(1900, 2500) }, () => below(0x80));
  for (let k = between(1, 2); k > 0; k--) cps.splice(below(cps.length + 1), 0, between(0xc0000, 0x10ffff));
  return cps;
}
const labels = rowsOf(
  [
    ...SIZES.flatMap(([count, lo, hi]) => Array.from({ length: count }, () => label(between(lo, hi)))),
    ...Array.from({ length: 60 }, nearTheBound),
  ],
  "the seeded labels",
  { exact: 790 },
);
const rfcEncoded = labels.map(rfc3492Encode);

/** A string of `size` characters from `alphabet`. */
const text = (alphabet: string, size: number): string =>
  Array.from({ length: size }, () => alphabet[below(alphabet.length)]!).join("");
const ALPHABETS = [
  "a",
  "ab",
  "abc-",
  "aAbB9-",
  "abcdefghijklmnopqrstuvwxyz0123456789",
  "abcdefghijklmnopqrstuvwxyz-0123ABCXYZ",
];
const strings = rowsOf(
  Array.from({ length: 600 }, (_, i) => text(ALPHABETS[i % ALPHABETS.length]!, between(0, i % 10 === 0 ? 3000 : 40))),
  "the seeded ASCII strings",
  { exact: 600 },
);

/** The inputs where the package's answer differs from the RFC's: their index, and both answers. */
function differences<T>(inputs: readonly T[], ours: (x: T) => unknown, rfc: (x: T, i: number) => unknown): string[] {
  return inputs.flatMap((x, i) => {
    const [a, b] = [JSON.stringify(ours(x)), JSON.stringify(rfc(x, i))];
    return a === b ? [] : [`${i}: ${a.slice(0, 80)} where RFC 3492 gives ${b.slice(0, 80)}`];
  });
}

describe("the Punycode encoder gives RFC 3492's answer", () => {
  it("for each seeded label, with repeats, astral code points and labels the integer bound refuses", () => {
    expect(differences(labels, punycodeEncode, (_, i) => rfcEncoded[i])).toEqual([]);
    // The seeded set's counts: RFC 3492 refuses 12 labels, and gives 121 encodings longer than 1,000 characters.
    const refused = rfcEncoded.filter((a) => a === null).length;
    const long = rfcEncoded.filter((a) => a !== null && a.length > 1000).length;
    expect([refused, long]).toEqual([12, 121]);
  });
  it("at the integer bound before the first insertion: 1,926 basic code points and U+10FFFF, then 1,927", () => {
    // RFC 3492 section 6.4: (0x10FFFF − 0x80) × (h + 1) is 2,146,645,241 for h = 1926, and 2,147,759,224 for h = 1927,
    // past 2^31 − 1.
    const at = (h: number) => [...Array<number>(h).fill(0x61), 0x10ffff];
    expect(punycodeEncode(at(1926))).toBe(rfc3492Encode(at(1926)));
    expect(punycodeEncode(at(1926))).not.toBeNull();
    expect(rfc3492Encode(at(1927))).toBeNull();
    expect(punycodeEncode(at(1927))).toBeNull();
  });
  it("at the integer bound within the scan: U+10FF70 after 127 of 1,927 basic code points, then after 128", () => {
    // (0x10FF70 − 0x80) × 1928 is 2,147,483,520, 127 below 2^31 − 1, and the scan adds one for each basic code point
    // before U+10FF70.
    const at = (before: number) => {
      const cps = Array<number>(1928).fill(0x61);
      cps.splice(before, 1, 0x10ff70);
      return cps;
    };
    expect(punycodeEncode(at(127))).toBe(rfc3492Encode(at(127)));
    expect(punycodeEncode(at(127))).not.toBeNull();
    expect(rfc3492Encode(at(128))).toBeNull();
    expect(punycodeEncode(at(128))).toBeNull();
  });
});

describe("the Punycode decoder gives RFC 3492's answer", () => {
  it("for each seeded label's encoding, which decodes to the label", () => {
    const encoded = rowsOf(
      rfcEncoded.flatMap((e) => (e === null ? [] : [e])),
      "the seeded labels' encodings",
      { exact: 778 },
    );
    expect(differences(encoded, punycodeDecode, rfc3492Decode)).toEqual([]);
    expect(encoded.map((e) => punycodeDecode(e))).toEqual(labels.filter((_, i) => rfcEncoded[i] !== null));
  });
  it("for each seeded ASCII string, decoded or refused", () => {
    expect(differences(strings, punycodeDecode, rfc3492Decode)).toEqual([]);
    const answers = strings.map(rfc3492Decode);
    // The seeded set's counts: RFC 3492 refuses 123 strings, and decodes 37 to more than 100 code points.
    const refused = answers.filter((a) => a === null).length;
    const long = answers.filter((a) => a !== null && a.length > 100).length;
    expect([refused, long]).toEqual([123, 37]);
  });
  it("for basic code points, a delimiter and digits that insert one code point each", () => {
    for (const [b, d] of [[0, 3000], [1500, 1500], [3000, 1], [1, 3000]] as const) {
      const s = `${"a".repeat(b)}-${"a".repeat(d)}`;
      expect(punycodeDecode(s)).toEqual(rfc3492Decode(s));
    }
  });
});
