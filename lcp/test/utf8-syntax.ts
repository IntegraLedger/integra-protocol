// RFC 3629 §4's syntax of UTF-8, written out as its ABNF gives it, for the tests to judge byte strings by.
//   UTF8-1    = %x00-7F
//   UTF8-2    = %xC2-DF UTF8-tail
//   UTF8-3    = %xE0 %xA0-BF UTF8-tail / %xE1-EC 2( UTF8-tail ) / %xED %x80-9F UTF8-tail / %xEE-EF 2( UTF8-tail )
//   UTF8-4    = %xF0 %x90-BF 2( UTF8-tail ) / %xF1-F3 3( UTF8-tail ) / %xF4 %x80-8F 2( UTF8-tail )
//   UTF8-tail = %x80-BF
const TAIL = "[\\x80-\\xBF]";
const CHAR = [
  "[\\x00-\\x7F]",
  `[\\xC2-\\xDF]${TAIL}`,
  `\\xE0[\\xA0-\\xBF]${TAIL}`,
  `[\\xE1-\\xEC]${TAIL}{2}`,
  `\\xED[\\x80-\\x9F]${TAIL}`,
  `[\\xEE-\\xEF]${TAIL}{2}`,
  `\\xF0[\\x90-\\xBF]${TAIL}{2}`,
  `[\\xF1-\\xF3]${TAIL}{3}`,
  `\\xF4[\\x80-\\x8F]${TAIL}{2}`,
].join("|");
const OCTETS = new RegExp(`^(?:${CHAR})*$`);

/** True when `bytes` match RFC 3629 §4's `UTF8-octets`: each byte is read as the code unit of its own value. */
export function wellFormedUtf8(bytes: Uint8Array): boolean {
  return OCTETS.test(String.fromCharCode(...bytes));
}
