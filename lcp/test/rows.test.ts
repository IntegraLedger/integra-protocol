// rowsOf, the check every table and loop built from a list runs first: each way a selection can come out wrong throws
// an error that names the source and the filter.
import { describe, expect, it } from "vitest";
import { rowsOf } from "./rows.js";

const ROWS = [
  { case: "a", input: 1 },
  { case: "b", input: 2 },
  { case: "c" },
];
const withInput = ["the rows that carry an input", (r: { input?: number }) => r.input !== undefined] as const;
const without = ["the rows without one, which state a code only", (r: { input?: number }) => r.input === undefined] as const;

describe("rowsOf", () => {
  it("gives the list back when it holds at least one row, or the stated count", () => {
    expect(rowsOf(ROWS, "rows")).toBe(ROWS);
    expect(rowsOf(ROWS, "rows", { exact: 3 })).toBe(ROWS);
    expect(rowsOf(ROWS, "rows", { min: 3 })).toBe(ROWS);
  });

  it("refuses a list that is missing or not an array", () => {
    expect(() => rowsOf(undefined, "file.json moved")).toThrow("file.json moved: not a list (undefined)");
    expect(() => rowsOf(null, "file.json moved")).toThrow("file.json moved: not a list (null)");
    expect(() => rowsOf({ length: 1 } as never, "file.json moved")).toThrow("file.json moved: not a list (object)");
  });

  it("refuses an empty list, and a count other than the stated one", () => {
    expect(() => rowsOf([], "file.json rows")).toThrow("file.json rows: 0 rows selected where at least 1 are expected");
    expect(() => rowsOf(ROWS, "file.json rows", { exact: 4 })).toThrow("file.json rows: 3 rows selected where the source states 4");
    expect(() => rowsOf(ROWS, "file.json rows", { min: 4 })).toThrow("file.json rows: 3 rows selected where at least 4 are expected");
  });

  it("refuses a stated count that selects nothing", () => {
    expect(() => rowsOf([], "file.json rows", { exact: 0 })).toThrow("file.json rows: the stated count 0 is not a positive integer");
    expect(() => rowsOf(ROWS, "file.json rows", { min: 0 })).toThrow("file.json rows: the least count 0 is not a positive integer");
  });

  it("keeps the rows a filter selects once every row is kept or left out, and some row is left out", () => {
    expect(rowsOf(ROWS, "file.json rows", { keep: withInput, leave: without, exact: 2 })).toEqual(ROWS.slice(0, 2));
  });

  it("refuses a filter that names one side only", () => {
    expect(() => rowsOf(ROWS, "file.json rows", { keep: withInput })).toThrow(
      "file.json rows: a filter names both the rows it keeps and the rows it leaves out",
    );
  });

  it("refuses a row that is neither kept nor left out, or both", () => {
    const named = ["the rows named a", (r: { case: string }) => r.case === "a"] as const;
    const notC = ["the rows not named c", (r: { case: string }) => r.case !== "c"] as const;
    expect(() => rowsOf(ROWS, "file.json rows", { keep: named, leave: without })).toThrow(
      "file.json rows: row 1 (b) is neither the rows named a nor the rows without one, which state a code only",
    );
    expect(() => rowsOf(ROWS, "file.json rows", { keep: withInput, leave: notC })).toThrow(
      "file.json rows: row 0 (a) is both the rows that carry an input and the rows not named c",
    );
  });

  it("refuses a filter that leaves no row out, or keeps none", () => {
    const all = ["every row", () => true] as const;
    const none = ["no row", () => false] as const;
    expect(() => rowsOf(ROWS, "file.json rows", { keep: all, leave: none })).toThrow(
      "file.json rows: no row is no row, so the filter keeps every row",
    );
    expect(() => rowsOf(ROWS, "file.json rows", { keep: none, leave: all })).toThrow(
      "file.json rows, no row: 0 rows selected where at least 1 are expected",
    );
  });
});
