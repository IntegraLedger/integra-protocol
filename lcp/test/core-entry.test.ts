// The `./core` entry point holds the core functions the package root exports, and nothing else: the ATR's assembly and
// its hash, hash comparison, the hash's string, structured and raw forms, the https-link rule, the URL Standard's host
// and domain parsers and its reading of a URL's scheme and authority, the RFC 8785 form of a JSON value and its digest,
// JSON reading capped at 64 levels, the base64 and base64url readers and writers, `isRefusal` and `readToRepeat`. Each
// is the root's own function object, one function reached by two paths, so a refusal made through one path is a refusal
// to the other path's `isRefusal`, and both paths' `readToRepeat` answer alike. The codes are the ones
// docs/reference/refusals.md lists, and its marks say which is a read to repeat. The base64 texts are RFC 4648 §10's,
// the canonical form's (§3.5), and the URL-safe alphabet's (§5), and the base64url texts RFC 4648 §10's without
// padding, as RFC 7515 §2 writes them.
import { describe, expect, expectTypeOf, it } from "vitest";
import * as core from "../src/core.js";
import * as root from "../src/index.js";
import { rowsOf } from "./rows.js";

/** The core functions the package root exports. */
const CORE = rowsOf(
  [
    "assemble",
    "base64Bytes",
    "base64UrlBytes",
    "canonicalJson",
    "digestJson",
    "domainToAscii",
    "fromBase64",
    "fromBase64Url",
    "fromLcpString",
    "fromLegalContext",
    "fromRawBytes",
    "hash",
    "hashEquals",
    "isHttpsLink",
    "isOtherSchemeLink",
    "isRefusal",
    "newAtrId",
    "parseHost",
    "parseJson",
    "readToRepeat",
    "readUrl",
    "toBase64",
    "toBase64Url",
    "toLcpString",
    "toLegalContext",
    "toRawBytes",
  ] as const,
  "the core functions the package root exports",
  { exact: 26 },
);

const ID = "6f1c2b0e-8d4a-4c3b-9e2f-1a7d5c9b3e40";
const utf8 = new TextEncoder();

describe("the ./core entry point", () => {
  it("exports exactly the core functions", () => {
    expect(Object.keys(core).sort()).toEqual([...CORE].sort());
  });

  it.each(CORE)("%s is the root's function object", (name) => {
    expect(typeof core[name]).toBe("function");
    expect(core[name]).toBe(root[name]);
  });

  it("exports the root's core types", () => {
    expectTypeOf<core.AtrHash>().toEqualTypeOf<root.AtrHash>();
    expectTypeOf<core.CoreRefusal>().toEqualTypeOf<root.CoreRefusal>();
    expectTypeOf<core.Json>().toEqualTypeOf<root.Json>();
    expectTypeOf<core.Refusal>().toEqualTypeOf<root.Refusal>();
    expectTypeOf<core.UrlAuthority>().toEqualTypeOf<root.UrlAuthority>();
  });

  it("a refusal made through either path is a refusal to both paths' isRefusal", async () => {
    const viaCore = core.canonicalJson(Number.NaN);
    const viaRoot = await root.assemble(ID, ["bind", {}], [["id", utf8.encode("{}")]]);
    expect(viaCore).toEqual({ refused: true, code: "core/content-not-json" });
    expect(viaRoot).toEqual({ refused: true, code: "core/slot-reserved" });
    for (const isRefusal of [core.isRefusal, root.isRefusal]) {
      expect(isRefusal(viaCore)).toBe(true);
      expect(isRefusal(viaRoot)).toBe(true);
      expect(isRefusal({ refused: true, code: "core/content-not-json" })).toBe(false);
    }
  });

  it("readToRepeat answers alike through either path", () => {
    // docs/reference/refusals.md marks evm/not-found and tempo/not-final **Read to repeat.**, and not core/too-large.
    for (const readToRepeat of [core.readToRepeat, root.readToRepeat]) {
      expect(readToRepeat("evm/not-found")).toBe(true);
      expect(readToRepeat("tempo/not-final")).toBe(true);
      expect(readToRepeat("core/too-large")).toBe(false);
    }
  });

  it("fromBase64 reads, through either path, the canonical form toBase64 writes and nothing else", () => {
    const foobar = utf8.encode("foobar");
    for (const { fromBase64, toBase64 } of [core, root]) {
      expect(toBase64(foobar)).toBe("Zm9vYmFy");
      expect(toBase64(foobar.subarray(0, 4))).toBe("Zm9vYg==");
      expect(toBase64(foobar.subarray(0, 5))).toBe("Zm9vYmE=");
      expect(toBase64(new Uint8Array([0xfb, 0xff]))).toBe("+/8=");
      for (const n of [0, 1, 2, 3, 4, 5, 6]) {
        expect(fromBase64(toBase64(foobar.subarray(0, n)))).toEqual(foobar.subarray(0, n));
      }
      // The same bytes in a form not canonical (a bit set past the last byte), unpadded, and in the URL-safe alphabet.
      for (const text of ["Zm9vYh==", "Zm9vYmF=", "Zm9vYg", "-_8=", "Zm9v Ymfy", 42]) {
        expect(fromBase64(text)).toBeNull();
      }
    }
  });

  it("base64Bytes reads, through either path, what fromBase64 reads, bounded by its size before decoding", () => {
    const foobar = utf8.encode("foobar");
    for (const { base64Bytes } of [core, root]) {
      expect(base64Bytes("Zm9vYmFy", 6)).toEqual(foobar);
      expect(base64Bytes("Zm9vYmE=", 5)).toEqual(foobar.subarray(0, 5));
      expect(base64Bytes("Zm9vYmFy", 5)).toBe("too-large");
      expect(base64Bytes("Zm9vYmE=", 4)).toBe("too-large");
      // Past the bound, a text is too large whatever its form; within it, a form fromBase64 does not read is malformed.
      expect(base64Bytes("Zm9vYmF=", 4)).toBe("too-large");
      for (const text of ["Zm9vYmF=", "Zm9vYg", "-_8=", 42]) expect(base64Bytes(text, 1024)).toBe("malformed");
    }
  });

  it("fromBase64Url reads, through either path, the canonical form toBase64Url writes and nothing else", () => {
    const foobar = utf8.encode("foobar");
    for (const { fromBase64Url, toBase64Url } of [core, root]) {
      expect(toBase64Url(foobar)).toBe("Zm9vYmFy");
      expect(toBase64Url(foobar.subarray(0, 4))).toBe("Zm9vYg");
      expect(toBase64Url(foobar.subarray(0, 5))).toBe("Zm9vYmE");
      expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
      for (const n of [0, 1, 2, 3, 4, 5, 6]) {
        expect(fromBase64Url(toBase64Url(foobar.subarray(0, n)))).toEqual(foobar.subarray(0, n));
      }
      // The same bytes in a form not canonical (a bit set past the last byte), padded, and in the standard alphabet.
      for (const text of ["Zm9vYh", "Zm9vYmF", "Zm9vYg==", "+/8", "Zm9v Ymfy", 42]) {
        expect(fromBase64Url(text)).toBeNull();
      }
    }
  });

  it("base64UrlBytes reads, through either path, what fromBase64Url reads, bounded by its size before decoding", () => {
    const foobar = utf8.encode("foobar");
    for (const { base64UrlBytes } of [core, root]) {
      expect(base64UrlBytes("Zm9vYmFy", 6)).toEqual(foobar);
      expect(base64UrlBytes("Zm9vYmE", 5)).toEqual(foobar.subarray(0, 5));
      expect(base64UrlBytes("Zm9vYmFy", 5)).toBe("too-large");
      expect(base64UrlBytes("Zm9vYmE", 4)).toBe("too-large");
      // Past the bound, a text is too large whatever its form; within it, a form fromBase64Url does not read is malformed.
      expect(base64UrlBytes("Zm9vYmF", 4)).toBe("too-large");
      for (const text of ["Zm9vYmF", "Zm9vYg==", "+/8", 42]) expect(base64UrlBytes(text, 1024)).toBe("malformed");
    }
  });
});
