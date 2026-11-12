#!/usr/bin/env node
// Checks scripts/public-units.json, the table of every public unit of @integraledger/lcp, against the built package.
// The package's exports are every entry point `lcp/package.json` lists under `exports`, and for each, the names its
// built module exports at run time and the type names its declaration file exports, read as
// scripts/docs-reference.mjs reads them.
//
// Each unit in the file names its exports, a map from each entry point (`.` for the package root) to the names it
// exports into the unit; its use for anyone using the protocol; and, in `fixedBy`, the published specification or
// profile that fixes its behaviour. The file's `pending` list names, with a reason, exports a unit may name before the
// package exports them.
//
// It fails when an export belongs to no unit or to more than one; when a unit names an entry point the package does
// not have, or an export the package does not export and `pending` does not list; when `pending` lists an export the
// package now exports, or one no unit names; when a unit's name, use or `fixedBy` is empty or not a string; and when
// scripts/check-public-package.mjs finds a held item in the file.
//
// Usage, from the repository root after lcp is built:
//   node scripts/check-public-units.mjs
//   node scripts/check-public-units.mjs --table <path>   check another file of the same form in its place
// It exits 0 when the file holds every export in one unit, and 1 naming each problem otherwise.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scan } from "./check-public-package.mjs";

const root = join(import.meta.dirname, "..");
const lcp = join(root, "lcp");
const at = process.argv.indexOf("--table");
const TABLE = at === -1 ? join(root, "scripts", "public-units.json") : resolve(process.argv[at + 1] ?? "");
const FILE = TABLE.startsWith(`${root}/`) ? relative(root, TABLE) : TABLE;

/** The type names a declaration file exports, following `export type { … } from` and `export { type … }`. */
function typeExports(name) {
  const text = readFileSync(join(lcp, "dist", `${name}.d.ts`), "utf8");
  const names = new Set();
  for (const m of text.matchAll(/^export (?:declare )?(?:type|interface) ([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export type \{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop();
      if (n) names.add(n);
    }
  }
  for (const m of text.matchAll(/^export \{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (!p.startsWith("type ")) continue;
      const n = p.slice(5).trim().split(/\s+as\s+/).pop();
      if (n) names.add(n);
    }
  }
  return names;
}

/** Every export of every entry point: a map from the entry point (`.` or `./x`) to its names. */
async function packageExports() {
  const pkg = JSON.parse(readFileSync(join(lcp, "package.json"), "utf8"));
  const out = new Map();
  for (const key of Object.keys(pkg.exports)) {
    const file = key === "." ? "index" : key.slice(2);
    if (!existsSync(join(lcp, "dist", `${file}.js`))) {
      throw new Error(`lcp/dist/${file}.js is missing: build lcp first (pnpm -r --if-present run build)`);
    }
    const mod = await import(pathToFileURL(join(lcp, "dist", `${file}.js`)).href);
    out.set(key, new Set([...Object.keys(mod), ...typeExports(file)]));
  }
  return out;
}

/** The `[entry point, name]` pairs an `exports` map names, or a string saying why it cannot be read. */
function exportsOf(map) {
  if (map === null || typeof map !== "object" || Array.isArray(map)) return "its exports are not a map";
  const out = [];
  for (const [e, names] of Object.entries(map)) {
    if (!Array.isArray(names) || names.length === 0) return `its exports under ${e} are not a list of names`;
    for (const n of names) {
      if (typeof n !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) return `${JSON.stringify(n)} is not a name`;
      out.push([e, n]);
    }
  }
  return out;
}

const text = (v) => (typeof v === "string" ? v.trim() : "");
const problems = [];
const source = readFileSync(TABLE, "utf8");
const table = JSON.parse(source);
const exported = await packageExports();

for (const { line, item } of scan(source)) problems.push(`${FILE}:${line}: check-public-package finds item ${item}`);

const pending = new Map();
(table.pending ?? []).forEach((p, i) => {
  const where = `${FILE}: pending ${i + 1}`;
  const names = exportsOf(p.exports);
  if (typeof names === "string") problems.push(`${where}: ${names}`);
  else if (text(p.reason) === "") problems.push(`${where} gives no reason`);
  else for (const [e, n] of names) pending.set(`${e} ${n}`, where);
});

const units = Array.isArray(table.units) ? table.units : [];
if (units.length === 0) problems.push(`${FILE} lists no units`);
const unitsOf = new Map();
units.forEach((u, i) => {
  const where = `${FILE}: unit ${i + 1} (${text(u.unit) || "unnamed"})`;
  if (text(u.unit) === "") problems.push(`${where} has no name`);
  if (text(u.use) === "") problems.push(`${where} states no use`);
  if (text(u.fixedBy) === "") problems.push(`${where} names no specification or profile`);
  const names = exportsOf(u.exports);
  if (typeof names === "string") {
    problems.push(`${where}: ${names}`);
    return;
  }
  for (const [e, n] of names) {
    const key = `${e} ${n}`;
    unitsOf.set(key, [...(unitsOf.get(key) ?? []), i + 1]);
    if (!exported.has(e)) problems.push(`${where}: lcp has no entry point ${e}`);
    else if (!exported.get(e).has(n) && !pending.has(key)) {
      problems.push(`${where}: ${e} does not export ${n}, and pending does not list it`);
    }
  }
});

for (const [key, where] of pending) {
  const [e, n] = key.split(" ");
  if (exported.get(e)?.has(n)) problems.push(`${where}: ${e} now exports ${n}: remove it from pending`);
  if (!unitsOf.has(key)) problems.push(`${where}: ${e} ${n} is in no unit`);
}

let count = 0;
for (const [e, names] of exported) {
  for (const n of [...names].sort()) {
    count++;
    const found = unitsOf.get(`${e} ${n}`) ?? [];
    if (found.length === 0) problems.push(`${e} ${n} is in no unit of ${FILE}`);
    if (found.length > 1) problems.push(`${e} ${n} is in more than one unit of ${FILE}: units ${found.join(", ")}`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`check-public-units: ${problems.length} problems`);
  process.exit(1);
}
console.log(
  `check-public-units: ${exported.size} entry points, ${count} exports, ${units.length} units` +
    (pending.size > 0 ? ` (${pending.size} exports pending)` : "") +
    `; every export is in one unit of ${FILE}`,
);
