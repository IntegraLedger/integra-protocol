// readToRepeat against every code the package returns. The expected classes are refusal-classes.ts's, each decided from
// the code's meaning in docs/reference/refusals.md and from the code that returns it.
import { describe, expect, it } from "vitest";
import { readToRepeat as rootReadToRepeat } from "../src/index.js";
import { REFUSAL_CODES } from "../src/internal/codes.js";
import { readToRepeat } from "../src/refusal.js";
import { NOT_READS_TO_REPEAT, READS_TO_REPEAT } from "./refusal-classes.js";
import { rowsOf } from "./rows.js";

const others = Object.entries(NOT_READS_TO_REPEAT).flatMap(([ns, reasons]) => reasons.map((r) => `${ns}/${r}`));

describe("readToRepeat", () => {
  it("has a class for every code the package returns, and for no other string", () => {
    // A code added to docs/reference/refusals.md, and so to REFUSAL_CODES, fails here until refusal-classes.ts classes it.
    const classed = [...READS_TO_REPEAT, ...others];
    expect([...REFUSAL_CODES].filter((c) => !classed.includes(c)), "codes with no class").toEqual([]);
    expect(classed.filter((c) => !REFUSAL_CODES.has(c)), "classed strings the package does not return").toEqual([]);
    expect(classed.filter((c, i) => classed.indexOf(c) !== i), "codes classed twice").toEqual([]);
    expect(classed.length).toBe(REFUSAL_CODES.size);
  });

  it("answers true for each read to repeat", () => {
    for (const code of rowsOf(READS_TO_REPEAT, "refusal-classes.ts READS_TO_REPEAT", { exact: 44 })) {
      expect([code, readToRepeat(code)]).toEqual([code, true]);
    }
  });

  it("answers false for every other code the package returns, each wrong-reader and read-first code among them", () => {
    const rows = rowsOf(others, "refusal-classes.ts NOT_READS_TO_REPEAT", { exact: 452 });
    for (const code of rows) expect([code, readToRepeat(code)]).toEqual([code, false]);
    const calls = rowsOf(rows, "refusal-classes.ts NOT_READS_TO_REPEAT", {
      keep: ["wrong-reader and read-first codes", (c) => /\/(wrong-reader|read-first)$/.test(c)],
      leave: ["every other code", (c) => !/\/(wrong-reader|read-first)$/.test(c)],
      exact: 22,
    });
    for (const code of calls) expect([code, readToRepeat(code)]).toEqual([code, false]);
  });

  it("answers false for a string the package does not return, a read-to-repeat reason in another namespace included", () => {
    const foreign = [
      "",
      "unreadable",
      "not-found",
      "claim/read-unavailable",
      "door/unreadable",
      "mpp/not-found",
      "x402/unreadable",
      "solana/not-found",
      "EVM/NOT-FOUND",
      "evm/not-found ",
      " evm/not-found",
      "evm/not-found/",
      "evm/Unreadable",
      "tempo/not-final\n",
    ];
    for (const code of rowsOf(foreign, "strings the package does not return", { exact: 14 })) {
      expect(REFUSAL_CODES.has(code), code).toBe(false);
      expect([code, readToRepeat(code)]).toEqual([code, false]);
    }
    for (const v of [undefined, null, 0, {}, ["evm/not-found"]]) expect(readToRepeat(v as never)).toBe(false);
  });

  it("is the package root's export", () => {
    expect(typeof rootReadToRepeat).toBe("function");
    expect(rootReadToRepeat).toBe(readToRepeat);
  });
});
