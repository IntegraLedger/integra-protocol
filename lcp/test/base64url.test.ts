// The base64url codec. Expected values: RFC 4648 §10's test vectors (written without padding, as RFC 7515 §2 does), RFC
// 7515 Appendix C's example, Node's Buffer "base64url" encoder, and ECMA-262's Uint8Array.fromBase64 with alphabet
// "base64url" and lastChunkHandling "strict" (Node 26.10.0), which reads only the canonical form of padded text.
import { describe, expect, it } from "vitest";
import { b64uDecode, b64uEncode, isB64u } from "../src/internal/base64url.js";

const ascii = (s: string) => new TextEncoder().encode(s);
const fromBase64 = (Uint8Array as unknown as {
  fromBase64(s: string, o: { alphabet: string; lastChunkHandling: string }): Uint8Array;
}).fromBase64.bind(Uint8Array);

/**
 * The platform's strict reading of unpadded text, padded with "=". Text holding "=" or whitespace is not unpadded
 * base64url (RFC 7515 §2: "with all trailing '=' characters omitted ... and without the inclusion of any line breaks,
 * whitespace, or other additional characters"); fromBase64 would skip the whitespace.
 */
function platform(s: string): Uint8Array | undefined {
  if (/[=\s]/.test(s)) return undefined;
  try {
    return fromBase64(s + "=".repeat((4 - (s.length % 4)) % 4), { alphabet: "base64url", lastChunkHandling: "strict" });
  } catch {
    return undefined;
  }
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
      expect(b64uEncode(ascii(text))).toBe(encoded);
      expect(b64uDecode(encoded)).toEqual(ascii(text));
    }
  });

  it("RFC 7515 Appendix C's example: [3, 236, 255, 224, 193] is A-z_4ME", () => {
    const bytes = Uint8Array.of(3, 236, 255, 224, 193);
    expect(b64uEncode(bytes)).toBe("A-z_4ME");
    expect(b64uDecode("A-z_4ME")).toEqual(bytes);
  });

  it("round trip over every byte value, as Node's Buffer writes it", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let n = 0; n <= all.length; n += 1) {
      const encoded = b64uEncode(all.subarray(0, n));
      expect(encoded).toBe(Buffer.from(all.subarray(0, n)).toString("base64url"));
      expect(b64uDecode(encoded)).toEqual(all.subarray(0, n));
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
    const same = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
      a === undefined || b === undefined ? a === b : Buffer.from(a).equals(Buffer.from(b));
    let read = 0;
    const differ: string[] = [];
    for (const s of texts) {
      const want = platform(s);
      if (!same(b64uDecode(s), want) || isB64u(s) !== (want !== undefined)) differ.push(s);
      if (want !== undefined) read++;
    }
    expect(differ).toEqual([]);
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(texts.length);
  });

  it("refuses the same bytes spelled with bits past the last byte, with padding, or with the standard alphabet", () => {
    // "QQ" is one byte, 0x41; its last character carries four bits past that byte, so "QR" to "QZ" spell it too.
    expect(b64uDecode("QQ")).toEqual(Uint8Array.of(0x41));
    for (const s of ["QR", "QZ", "QQ==", "QQ=", "Zm9", "Zm8=", "+w", "/w", "A", "Zm9vY"]) expect(b64uDecode(s), s).toBeUndefined();
    expect(b64uDecode("-w")).toEqual(Uint8Array.of(0xfb));
    expect(b64uDecode("_w")).toEqual(Uint8Array.of(0xff));
  });

  it("bounds the decoded length by the text's length before it decodes", () => {
    const h = new Uint8Array(32).fill(0xab);
    expect(b64uDecode(b64uEncode(h), 32)).toEqual(h);
    expect(b64uDecode(b64uEncode(new Uint8Array(33)), 32)).toBeUndefined();
    expect(b64uDecode(7)).toBeUndefined();
    expect(isB64u(7)).toBe(false);
  });
});
