import { describe, expect, it } from "vitest";
import { decodeSplMemo, encodeSplMemo, verifySplMemo } from "../src/memo.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";

describe("encodeSplMemo / decodeSplMemo", () => {
  it("hex (canonical): memo data is the 0x-prefixed ASCII hex string", () => {
    const data = encodeSplMemo(ATR, "hex");
    expect(new TextDecoder().decode(data)).toBe(ATR);
    expect(data.length).toBe(66); // "0x" + 64 hex chars, one byte each
    expect(decodeSplMemo(data, "hex")).toBe(ATR);
  });

  it("raw: memo data is the 32 raw bytes", () => {
    const data = encodeSplMemo(ATR, "raw");
    expect(data.length).toBe(32);
    expect(decodeSplMemo(data, "raw")).toBe(ATR);
  });

  it("lowercases an uppercase atrHash (ATR canon)", () => {
    const data = encodeSplMemo(ATR.toUpperCase().replace("0X", "0x"), "hex");
    expect(decodeSplMemo(data, "hex")).toBe(ATR);
  });

  it("fails loud on a malformed atrHash", () => {
    expect(() => encodeSplMemo("0xdead", "hex")).toThrow(/32-byte/);
    expect(() => encodeSplMemo("not-hex")).toThrow();
  });

  it("returns null for a memo that is not an atrHash (a scan skips it, not errors)", () => {
    expect(
      decodeSplMemo(new TextEncoder().encode("hello world"), "hex"),
    ).toBeNull();
    expect(decodeSplMemo(new Uint8Array([1, 2, 3]), "raw")).toBeNull(); // wrong length
  });
});

describe("verifySplMemo", () => {
  it("confirms a matching memo and rejects a mismatched one", () => {
    const data = encodeSplMemo(ATR, "hex");
    expect(verifySplMemo({ memoData: data, atrHash: ATR })).toBe(true);
    expect(
      verifySplMemo({
        memoData: data,
        atrHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }),
    ).toBe(false);
  });

  it("defaults to the hex encoding, and honours an explicit one", () => {
    // The default is the canonical LCP §8.3.1 form. Reading a hex memo as raw (or the reverse) decodes to
    // null and reports a genuine weld as absent, so which encoding the absent argument means matters.
    expect(
      verifySplMemo({ memoData: encodeSplMemo(ATR, "hex"), atrHash: ATR }),
    ).toBe(true);
    expect(
      verifySplMemo({
        memoData: encodeSplMemo(ATR, "raw"),
        atrHash: ATR,
        encoding: "raw",
      }),
    ).toBe(true);
    expect(
      verifySplMemo({ memoData: encodeSplMemo(ATR, "raw"), atrHash: ATR }),
    ).toBe(false);
  });

  // Each arm of the guard rejects on its own.
  it("rejects memo data that does not decode, even against a well-formed atrHash", () => {
    expect(
      verifySplMemo({
        memoData: new TextEncoder().encode("just a note"),
        atrHash: ATR,
      }),
    ).toBe(false);
  });

  it("rejects a malformed atrHash argument, even against a well-formed memo", () => {
    const data = encodeSplMemo(ATR, "hex");
    expect(verifySplMemo({ memoData: data, atrHash: "0xdead" })).toBe(false);
    expect(verifySplMemo({ memoData: data, atrHash: "" })).toBe(false);
  });

  it("matches case-insensitively, as the ATR canon requires", () => {
    expect(
      verifySplMemo({
        memoData: encodeSplMemo(ATR, "hex"),
        atrHash: `0x${ATR.slice(2).toUpperCase()}`,
      }),
    ).toBe(true);
  });
});
