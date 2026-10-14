// Every table and loop that the tests build from a list takes the list through rowsOf first. A list that is missing,
// empty, or not the count its source states throws an error that names the source and the filter. Without the check,
// an empty table or loop runs no case, and the test passes.

/** What a selection holds, and, where a filter leaves rows out on purpose, which rows it keeps and which it leaves. */
export type Selection<T> = {
  /** The count the source states: a count written in the test, or the length of the list before a filter that every row passes. */
  exact?: number;
  /** The fewest rows the selection holds, when the source states no count; 1 when not given. */
  min?: number;
  /** The rows a filter keeps: what they are, and the test that picks them. */
  keep?: readonly [string, (row: T, index: number) => boolean];
  /**
   * The rows the filter leaves out: what they are and why, and the test that picks them. Every row is kept or left
   * out, never both, so the two parts together are the whole list, and at least one row is left out.
   */
  leave?: readonly [string, (row: T, index: number) => boolean];
};

const named = (row: unknown): string => {
  if (typeof row !== "object" || row === null) return "";
  const r = row as { case?: unknown; name?: unknown };
  const n = typeof r.case === "string" ? r.case : typeof r.name === "string" ? r.name : undefined;
  return n === undefined ? "" : ` (${n})`;
};

/**
 * The rows of `list` that the selection keeps, once it holds what its source states: exactly `exact` rows, or at
 * least `min` (1 when neither is given). `source` names the list: a vector file and the path inside it, or the module
 * or table the list comes from. Throws an Error naming `source` and the filter when the list is not an array, when a
 * row is neither kept nor left out (or is both), when the filter leaves no row out, or when the count is wrong.
 */
export function rowsOf<T = any>(list: readonly T[] | null | undefined, source: string, selection: Selection<T> = {}): T[] {
  if (!Array.isArray(list)) throw new Error(`${source}: not a list (${list === null ? "null" : typeof list})`);
  const { exact, min = 1, keep, leave } = selection;
  if ((keep === undefined) !== (leave === undefined)) {
    throw new Error(`${source}: a filter names both the rows it keeps and the rows it leaves out`);
  }
  if (exact !== undefined && !(Number.isSafeInteger(exact) && exact >= 1)) {
    throw new Error(`${source}: the stated count ${exact} is not a positive integer`);
  }
  if (!(Number.isSafeInteger(min) && min >= 1)) throw new Error(`${source}: the least count ${min} is not a positive integer`);
  let rows: T[] = list as T[];
  let what = source;
  if (keep !== undefined && leave !== undefined) {
    what = `${source}, ${keep[0]}`;
    rows = [];
    let left = 0;
    list.forEach((row, i) => {
      const k = keep[1](row, i);
      const l = leave[1](row, i);
      if (k && l) throw new Error(`${source}: row ${i}${named(row)} is both ${keep[0]} and ${leave[0]}`);
      if (!k && !l) throw new Error(`${source}: row ${i}${named(row)} is neither ${keep[0]} nor ${leave[0]}`);
      if (k) rows.push(row);
      else left++;
    });
    if (left === 0) throw new Error(`${source}: no row is ${leave[0]}, so the filter keeps every row`);
  }
  if (exact !== undefined && rows.length !== exact) {
    throw new Error(`${what}: ${rows.length} rows selected where the source states ${exact}`);
  }
  if (rows.length < min) throw new Error(`${what}: ${rows.length} rows selected where at least ${min} are expected`);
  return rows;
}
