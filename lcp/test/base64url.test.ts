// base64url without padding: `fromBase64Url`, `base64UrlBytes` and `toBase64Url`. Expected values: RFC 4648 §10's test
// vectors (written without padding, as RFC 7515 §2 does), RFC 7515 Appendix C's example, Node's Buffer "base64url"
// encoder, and ECMA-262's Uint8Array.fromBase64 with alphabet "base64url" and lastChunkHandling "strict", which reads only
// the canonical form of padded text, as vectors/base64-platform.json records it (Node 24 has no such reader; on a Node
// that has it, the answers are also held to it live).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { base64UrlBytes, fromBase64Url, toBase64Url } from "../src/rail-bytes.js";

const ascii = (s: string) => new TextEncoder().encode(s);
const fromBase64 = (Uint8Array as unknown as {
  fromBase64?(s: string, o: { alphabet: string; lastChunkHandling: string }): Uint8Array;
}).fromBase64?.bind(Uint8Array);
const PLATFORM = JSON.parse(readFileSync(new URL("../vectors/base64-platform.json", import.meta.url), "utf8")) as Record<
  string,
  { texts: number; read: Record<string, string> }
>;

/**
 * The platform's strict reading of unpadded text, padded with "=". Text holding "=" or whitespace is not unpadded
 * base64url (RFC 7515 §2: "with all trailing '=' characters omitted ... and without the inclusion of any line breaks,
 * whitespace, or other additional characters"); fromBase64 would skip the whitespace.
 */
function live(s: string): Uint8Array | null {
  if (/[=\s]/.test(s)) return null;
  try {
    return fromBase64!(s + "=".repeat((4 - (s.length % 4)) % 4), { alphabet: "base64url", lastChunkHandling: "strict" });
  } catch {
    return null;
  }
}

/** The platform's strict reading as base64-platform.json records it over the set `name`, and as it answers live where it can. */
function platformOf(name: string, texts: string[]): (s: string) => Uint8Array | null {
  const set = PLATFORM[name]!;
  expect(texts.length).toBe(set.texts);
  const made = new Set(texts);
  expect(Object.keys(set.read).filter((s) => !made.has(s))).toEqual([]);
  return (s) => {
    const h = set.read[s];
    if (fromBase64 !== undefined) {
      const now = live(s);
      expect(now === null ? null : Buffer.from(now).toString("hex"), `the built-in reader on ${JSON.stringify(s)}`).toBe(h ?? null);
    }
    return h === undefined ? null : Uint8Array.from(Buffer.from(h, "hex"));
  };
}

describe("base64url without padding", () => {
  it("RFC 4648 §10's test vectors, without padding", () => {
    const rows: [string, string][] = [
      ["", ""],
      ["f", "Zg"],
      ["fo", "Zm8"],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg"],
      ["fooba", "Zm9vYmE"],
      ["foobar", "Zm9vYmFy"],
    ];
    for (const [text, encoded] of rows) {
      expect(toBase64Url(ascii(text))).toBe(encoded);
      expect(fromBase64Url(encoded)).toEqual(ascii(text));
    }
  });

  it("RFC 7515 Appendix C's example: [3, 236, 255, 224, 193] is A-z_4ME", () => {
    const bytes = Uint8Array.of(3, 236, 255, 224, 193);
    expect(toBase64Url(bytes)).toBe("A-z_4ME");
    expect(fromBase64Url("A-z_4ME")).toEqual(bytes);
  });

  it("round trip over every byte value, as Node's Buffer writes it", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let n = 0; n <= all.length; n += 1) {
      const encoded = toBase64Url(all.subarray(0, n));
      expect(encoded).toBe(Buffer.from(all.subarray(0, n)).toString("base64url"));
      expect(fromBase64Url(encoded)).toEqual(all.subarray(0, n));
    }
  });

  it("reads exactly what the platform's strict reader reads", () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/ .";
    const texts: string[] = [""];
    for (const a of chars) {
      texts.push(a);
      for (const b of chars) texts.push(a + b, `Zm9v${a}${b}`);
    }
    for (const a of "AQgw_Z.=") for (const b of chars) for (const c of chars) texts.push(a + b + c, `Zm9v${a}${b}${c}`);
    const same = (a: Uint8Array | null, b: Uint8Array | null) =>
      a === null || b === null ? a === b : Buffer.from(a).equals(Buffer.from(b));
    const platform = platformOf("base64urlStrict", texts);
    let read = 0;
    const differ: string[] = [];
    for (const s of texts) {
      const want = platform(s);
      const bounded = base64UrlBytes(s, 1024);
      if (!same(fromBase64Url(s), want) || !same(bounded instanceof Uint8Array ? bounded : null, want)) differ.push(s);
      if (want !== null) read++;
    }
    expect(differ).toEqual([]);
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(texts.length);
  });

  it("refuses the same bytes spelled with bits past the last byte, with padding, or with the standard alphabet", () => {
    // "QQ" is one byte, 0x41; its last character carries four bits past that byte, so "QR" to "QZ" spell it too.
    expect(fromBase64Url("QQ")).toEqual(Uint8Array.of(0x41));
    for (const s of ["QR", "QZ", "QQ==", "QQ=", "Zm9", "Zm8=", "+w", "/w", "A", "Zm9vY"]) expect(fromBase64Url(s), s).toBeNull();
    expect(fromBase64Url("-w")).toEqual(Uint8Array.of(0xfb));
    expect(fromBase64Url("_w")).toEqual(Uint8Array.of(0xff));
  });

  it("refuses a character outside ASCII, whatever its low seven bits", () => {
    // U+00C1, U+00E1, U+00B0, U+00AD, U+00DF and U+0141 have the low seven bits of "A", "a", "0", "-", "_" and "A";
    // U+D800 is a lone surrogate. None is in the URL-safe alphabet (RFC 4648 §5), and the platform's strict reader
    // refuses each.
    const chars = ["\u00c1", "\u00e1", "\u00b0", "\u00ad", "\u00df", "\u0141", "\ud800"];
    const platform = platformOf("base64urlNonAscii", chars.flatMap((c) => [`${c}Q`, `Q${c}`, `Zm9v${c}g`]));
    for (const c of chars) {
      for (const s of [`${c}Q`, `Q${c}`, `Zm9v${c}g`]) {
        expect([fromBase64Url(s), base64UrlBytes(s, 8), platform(s)], s).toEqual([null, "malformed", null]);
      }
    }
  });

  it("base64UrlBytes bounds the decoded length by the text's length before it decodes", () => {
    const h = new Uint8Array(32).fill(0xab);
    expect(base64UrlBytes(toBase64Url(h), 32)).toEqual(h);
    expect(base64UrlBytes(toBase64Url(new Uint8Array(33)), 32)).toBe("too-large");
    // Past the bound, a text is too large whatever its form; within it, a form fromBase64Url does not read is malformed.
    expect(base64UrlBytes(`${"A".repeat(43)}=`, 32)).toBe("too-large");
    for (const s of ["QR", "QQ==", "+w", "A", 7]) expect(base64UrlBytes(s, 32), String(s)).toBe("malformed");
    expect(fromBase64Url(7)).toBeNull();
  });

  it("toBase64Url writes 16 MiB as Node's Buffer writes it, and fromBase64Url and base64UrlBytes read it back", () => {
    // 16 MiB is one byte more than a multiple of three, so the text ends in two characters, the last with four zero
    // bits. The test has no time bound (0): the reader and the writer each make one pass, in constant stack, and how
    // long that takes depends only on the machine.
    const bytes = Uint8Array.from({ length: 16 * 1024 * 1024 }, (_, i) => (i * 31 + (i >>> 11)) & 0xff);
    const text = Buffer.from(bytes).toString("base64url");
    expect(text.length).toBe(22369622);
    expect(toBase64Url(bytes) === text).toBe(true);
    const read = fromBase64Url(text);
    const bounded = base64UrlBytes(text, bytes.length);
    expect(read !== null && Buffer.from(read).equals(bytes)).toBe(true);
    expect(bounded instanceof Uint8Array && Buffer.from(bounded).equals(bytes)).toBe(true);
    expect(base64UrlBytes(text, bytes.length - 1)).toBe("too-large");
    expect(fromBase64Url(`${text.slice(0, -1)}R`)).toBeNull();
  }, 0);
});
