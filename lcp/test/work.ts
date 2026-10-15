// A count of the work built-in methods do while a call runs, so a test can hold a function to time linear in its
// input without a clock: the same call gives the same count, and a test compares one input shape at two sizes. It
// counts each element an array, Map or Set iterator yields (spread, for...of, Array.from of an iterable, new Map of a
// Map); for array and typed-array methods, each element a copy writes (slice, concat, map, filter, flat, flatMap,
// splice, from, set), each element a search reads up to its answer (indexOf, lastIndexOf, includes) or each callback
// it calls (find, findIndex, findLast, findLastIndex, some, every), and each element a whole-array method visits
// (forEach, reduce, reduceRight, fill, join, reverse, sort).
// The methods are wrapped only while the call runs, then restored.

type Fn = (...args: unknown[]) => unknown;

let count = 0;

function lengthOf(x: unknown): number {
  return typeof x === "object" && x !== null && typeof (x as { length?: unknown }).length === "number"
    ? (x as { length: number }).length
    : 0;
}

const COPIES = ["slice", "concat", "map", "filter", "flat", "flatMap"] as const;
const SEARCHES = ["indexOf", "lastIndexOf", "includes"] as const;
const CALLBACKS = ["find", "findIndex", "findLast", "findLastIndex", "some", "every"] as const;
const VISITS = ["forEach", "reduce", "reduceRight", "fill", "join", "reverse", "sort"] as const;

function wrap(target: object, name: string, counted: (self: unknown, args: unknown[], result: unknown) => number): () => void {
  const had = Object.getOwnPropertyDescriptor(target, name);
  if (had === undefined || typeof had.value !== "function") return () => {};
  const original = had.value as Fn;
  // Decided here, since the wrapper itself calls no method it may have wrapped.
  const callsBack = (CALLBACKS as readonly string[]).includes(name);
  Object.defineProperty(target, name, {
    ...had,
    value: function (this: unknown, ...args: unknown[]) {
      if (callsBack && typeof args[0] === "function") {
        const cb = args[0] as Fn;
        args[0] = function (this: unknown, ...a: unknown[]) {
          count++;
          return cb.apply(this, a);
        };
      }
      const result = original.apply(this, args);
      count += counted(this, args, result);
      return result;
    },
  });
  return () => Object.defineProperty(target, name, had);
}

function install(): () => void {
  const undo: (() => void)[] = [];
  for (const it of [[][Symbol.iterator](), new Map()[Symbol.iterator](), new Set()[Symbol.iterator]()]) {
    undo.push(wrap(Object.getPrototypeOf(it), "next", () => 1));
  }
  const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
  for (const proto of [Array.prototype, typed]) {
    for (const name of COPIES) undo.push(wrap(proto, name, (_s, _a, r) => lengthOf(r)));
    for (const name of SEARCHES) {
      undo.push(
        wrap(proto, name, (self, _a, r) =>
          typeof r === "number" && r >= 0 ? (name === "lastIndexOf" ? lengthOf(self) - r : r + 1) : lengthOf(self),
        ),
      );
    }
    for (const name of CALLBACKS) undo.push(wrap(proto, name, () => 0));
    for (const name of VISITS) undo.push(wrap(proto, name, (self) => lengthOf(self)));
  }
  undo.push(wrap(Array.prototype, "splice", (_s, args, r) => lengthOf(r) + Math.max(0, args.length - 2)));
  undo.push(wrap(typed, "set", (_s, args) => lengthOf(args[0])));
  undo.push(wrap(Object.getPrototypeOf(Uint8Array) as object, "from", (_s, _a, r) => lengthOf(r)));
  return () => {
    for (const u of undo.reverse()) u();
  };
}

/** The work counted while `run` runs. */
export function workOf(run: () => unknown): number {
  const restore = install();
  count = 0;
  let n: number;
  try {
    run();
  } finally {
    n = count;
    restore();
  }
  return n;
}

/** The work counted while the promise `run` gives settles. */
export async function workOfAsync(run: () => Promise<unknown>): Promise<number> {
  const restore = install();
  count = 0;
  let n: number;
  try {
    await run();
  } finally {
    n = count;
    restore();
  }
  return n;
}
