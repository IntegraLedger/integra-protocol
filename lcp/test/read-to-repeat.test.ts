// readToRepeat against every code the package returns: true for refusal-classes.ts's reads to repeat, each decided from
// the code's meaning in docs/reference/refusals.md and from the code that returns it, and false for every other code.
import { describe, expect, it } from "vitest";
import { readToRepeat as rootReadToRepeat } from "../src/index.js";
import { REFUSAL_CODES } from "../src/internal/codes.js";
import { readToRepeat } from "../src/refusal.js";
import { READS_TO_REPEAT } from "./refusal-classes.js";
import { rowsOf } from "./rows.js";

const others = [...REFUSAL_CODES].filter((c) => !READS_TO_REPEAT.includes(c));

describe("readToRepeat", () => {
  it("classes as reads to repeat only codes the package returns, each once", () => {
    expect(READS_TO_REPEAT.filter((c) => !REFUSAL_CODES.has(c)), "classed strings the package does not return").toEqual([]);
    expect(READS_TO_REPEAT.filter((c, i) => READS_TO_REPEAT.indexOf(c) !== i), "codes classed twice").toEqual([]);
  });

  it("answers true for each read to repeat", () => {
    for (const code of rowsOf(READS_TO_REPEAT, "refusal-classes.ts READS_TO_REPEAT")) {
      expect([code, readToRepeat(code)]).toEqual([code, true]);
    }
  });

  it("answers false for every other code the package returns, each wrong-reader and read-first code among them", () => {
    const rows = rowsOf(others, "the codes the package returns that are not reads to repeat");
    for (const code of rows) expect([code, readToRepeat(code)]).toEqual([code, false]);
    const calls = rowsOf(rows, "the codes the package returns that are not reads to repeat", {
      keep: ["wrong-reader and read-first codes", (c) => /\/(wrong-reader|read-first)$/.test(c)],
      leave: ["every other code", (c) => !/\/(wrong-reader|read-first)$/.test(c)],
    });
    for (const code of calls) expect([code, readToRepeat(code)]).toEqual([code, false]);
  });

  it("answers false for a string the package does not return, a read-to-repeat reason in another namespace included", () => {
    const foreign = [
      "",
      "unreadable",
      "not-found",
      "server/read-unavailable",
      "server/unreadable",
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
    for (const code of rowsOf(foreign, "strings the package does not return")) {
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
