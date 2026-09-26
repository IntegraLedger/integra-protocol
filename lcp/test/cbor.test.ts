// The bounded CBOR reader against RFC 8949's data model. Each expected value is the RFC's text:
// - §3.3: major type 7 carries simple values, distinct from the integers of major type 0, so simple(3) (`e3`) is not
//   the integer 3 (`03`), and simple(32) (`f8 20`) is not 32;
// - §3.1, major type 3: a text string is Unicode characters in UTF-8, so U+FEFF (`ef bb bf`) is one of its characters;
// - §5.6: a protocol may treat a map with identical keys as malformed; the PLT operations this reader serves are
//   refused on chain for a repeated key, so the reader refuses one (cborg 6.1.2's rejectDuplicateMapKeys agrees);
// - an array or a byte string is never read as a map.
import { describe, expect, it } from "vitest";
import * as cborg from "cborg";
import { decodeCbor, isMap } from "../src/cbor.js";

const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

describe("the CBOR reader", () => {
  it("a simple value is not an integer (RFC 8949 §3.3)", () => {
    expect(decodeCbor(bytes("03"))).toBe(3n);
    expect(decodeCbor(bytes("e3"))).not.toEqual(decodeCbor(bytes("03")));
    expect(decodeCbor(bytes("f820"))).not.toEqual(decodeCbor(bytes("1820")));
    expect(decodeCbor(bytes("f4"))).toBe(false);
    expect(decodeCbor(bytes("f5"))).toBe(true);
    expect(decodeCbor(bytes("f6"))).toBe(null);
  });

  it("simple(0..31) in the one-byte form is not well-formed (RFC 8949 §3.3)", () => {
    expect(decodeCbor(bytes("f81f"))).toBe(null);
  });

  it("a text string keeps a leading U+FEFF (RFC 8949 §3.1)", () => {
    expect(decodeCbor(bytes("63efbbbf"))).toBe("﻿");
    expect(decodeCbor(bytes("64efbbbf61"))).toBe("﻿a");
  });

  it("a map with a repeated key is malformed (RFC 8949 §5.6)", () => {
    const repeated = bytes("a2616101616102");
    expect(() => cborg.decode(repeated, { rejectDuplicateMapKeys: true, useMaps: true })).toThrow();
    expect(decodeCbor(repeated)).toBe(null);
    expect(decodeCbor(bytes("a2010203f5"))).toEqual({ map: [[1n, 2n], [3n, true]] });
    expect(decodeCbor(bytes("a2e301e302"))).toBe(null);
    expect(decodeCbor(bytes("a2034101034102"))).toBe(null);
  });

  it("the integer 3 and simple(3) are two keys of one map", () => {
    const v = decodeCbor(bytes("a20301e302"));
    expect(v !== null && isMap(v) ? v.map.length : -1).toBe(2);
  });

  it("an array and a byte string are not maps", () => {
    expect(isMap(decodeCbor(bytes("8100"))!)).toBe(false);
    expect(isMap(decodeCbor(bytes("4100"))!)).toBe(false);
    expect(isMap(decodeCbor(bytes("a0"))!)).toBe(true);
  });
});
