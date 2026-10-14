// The `./core` entry point holds the core functions the package root exports, and nothing else: the ATR's assembly and
// its hash, hash comparison, the hash's string, structured and raw forms, the https-link rule, the RFC 8785 form of a
// JSON value and its digest, JSON reading capped at 64 levels, `isRefusal` and `readToRepeat`. Each is the root's own
// function object, one function reached by two paths, so a refusal made through one path is a refusal to the other
// path's `isRefusal`, and both paths' `readToRepeat` answer alike. The codes are the ones docs/reference/refusals.md
// lists, and its marks say which is a read to repeat.
import { describe, expect, expectTypeOf, it } from "vitest";
import * as core from "../src/core.js";
import * as root from "../src/index.js";
import { rowsOf } from "./rows.js";

/** The core functions the package root exports. */
const CORE = rowsOf(
  [
    "assemble",
    "canonicalJson",
    "digestJson",
    "fromLcpString",
    "fromLegalContext",
    "fromRawBytes",
    "hash",
    "hashEquals",
    "isHttpsLink",
    "isOtherSchemeLink",
    "isRefusal",
    "newAtrId",
    "parseJson",
    "readToRepeat",
    "toLcpString",
    "toLegalContext",
    "toRawBytes",
  ] as const,
  "the core functions the package root exports",
  { exact: 17 },
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
});
