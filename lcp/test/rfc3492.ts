// RFC 3492's Punycode decoder and encoder as section 6.2 and section 6.3 write them, with the overflow checks of section
// 6.4 for integers bounded at 2^31 − 1, and a decoded code point past U+10FFFF a failure, since Unicode has none. The
// decoder inserts each code point into its output as it reads it, and the encoder scans the whole input once for each
// distinct code point it encodes. The tests compare the package's encoder and decoder with these two.
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 0x80;
const MAXINT = 2 ** 31 - 1;

/** Section 6.1, bias adaptation. */
function adapt(delta: number, numpoints: number, firsttime: boolean): number {
  let d = firsttime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numpoints);
  let k = 0;
  while (d > Math.floor(((BASE - TMIN) * TMAX) / 2)) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

const threshold = (k: number, bias: number): number => (k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias);

/** Section 5: a to z and A to Z are 0 to 25, 0 to 9 are 26 to 35; any other code point has no digit value. */
function digitValue(c: number): number | undefined {
  if (c >= 0x61 && c <= 0x7a) return c - 0x61;
  if (c >= 0x41 && c <= 0x5a) return c - 0x41;
  if (c >= 0x30 && c <= 0x39) return c - 0x30 + 26;
  return undefined;
}

const digitChar = (d: number): string => String.fromCharCode(d < 26 ? 0x61 + d : 0x30 + d - 26);

/** Section 6.2: the code points the ASCII string `input` encodes, or null where the procedure fails. */
export function rfc3492Decode(input: string): number[] | null {
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  const delimiter = input.lastIndexOf("-");
  const output: number[] = [];
  let pos = 0;
  if (delimiter > 0) {
    for (; pos < delimiter; pos++) {
      const c = input.charCodeAt(pos);
      if (c >= 0x80) return null;
      output.push(c);
    }
    pos++;
  }
  while (pos < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const digit = digitValue(input.charCodeAt(pos++));
      if (digit === undefined) return null;
      if (digit > Math.floor((MAXINT - i) / w)) return null;
      i += digit * w;
      const t = threshold(k, bias);
      if (digit < t) break;
      if (w > Math.floor(MAXINT / (BASE - t))) return null;
      w *= BASE - t;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    if (Math.floor(i / (output.length + 1)) > MAXINT - n) return null;
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i++;
  }
  return output;
}

/** Section 6.3: the ASCII string that encodes the code points `input`, or null where the procedure fails. */
export function rfc3492Encode(input: readonly number[]): string | null {
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  let output = "";
  for (const c of input) if (c < 0x80) output += String.fromCharCode(c);
  const b = output.length;
  let h = b;
  if (b > 0) output += "-";
  while (h < input.length) {
    let m = Infinity;
    for (const c of input) if (c >= n && c < m) m = c;
    if (m - n > Math.floor((MAXINT - delta) / (h + 1))) return null;
    delta += (m - n) * (h + 1);
    n = m;
    for (const c of input) {
      if (c < n) {
        if (delta === MAXINT) return null;
        delta++;
      }
      if (c === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = threshold(k, bias);
          if (q < t) break;
          output += digitChar(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digitChar(q);
        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return output;
}
