#!/usr/bin/env node
// Checks scripts/public-units.json, the table of every public unit of @integraledger/lcp and of the settler,
// @integraledger/profile-facilitator, against the built packages. A package's exports are every entry point its
// `package.json` lists under `exports`, and for each, the names its built module exports at run time and the type names
// its declaration file exports, read as scripts/docs-reference.mjs reads them.
//
// Each unit in the file names its exports, a map from each entry point (`.` for the package root) to the names it
// exports into the unit; `package`, the package's name, where the unit is not lcp's; its use for anyone using the
// protocol; and, in `fixedBy`, the published specification or profile that fixes its behaviour. The file's `pending`
// list names, with a reason, exports a unit may name before the package exports them; it is lcp's.
//
// It fails when an export belongs to no unit or to more than one; when a unit names an entry point the package does
// not have, or an export the package does not export and `pending` does not list; when `pending` lists an export the
// package now exports, or one no unit names; when a unit's name, use or `fixedBy` is empty or not a string; and when
// scripts/check-public-package.mjs finds a held item in the file. That scan takes the key check-public-package.mjs
// takes, from PUBLIC_CHECK_KEY or --key-file.
//
// Usage, from the repository root after lcp is built:
//   node scripts/check-public-units.mjs
//   node scripts/check-public-units.mjs --table <path>      check another file of the same form in its place
//   node scripts/check-public-units.mjs --root <dir>        read the packages from <dir>/lcp and <dir>/settler, each a
//                                                           built package's folder or one installed from its tarball,
//                                                           in place of this repository's
//   node scripts/check-public-units.mjs --key-file <path>   read the scan's key, in hex, from this file
// It exits 0 when the file holds every export in one unit and the scan finds no held item, 1 naming each problem
// otherwise, and 2 when it finds no other problem but the scan did not run: no key, or a key that is refused.
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { keyOf, scanner } from "./check-public-package.mjs";

const root = join(import.meta.dirname, "..");
const rootAt = process.argv.indexOf("--root");
const packagesRoot = rootAt === -1 ? root : resolve(process.argv[rootAt + 1] ?? "");
const LCP = "@integraledger/lcp";
/** Each package the table covers: its name and its folder. */
const PACKAGES = [
  [LCP, join(packagesRoot, "lcp")],
  ["@integraledger/profile-facilitator", join(packagesRoot, "settler")],
];
const at = process.argv.indexOf("--table");
const TABLE = at === -1 ? join(root, "scripts", "public-units.json") : resolve(process.argv[at + 1] ?? "");
const keyAt = process.argv.indexOf("--key-file");
const KEY_FILE = keyAt === -1 ? undefined : resolve(process.argv[keyAt + 1] ?? "");
const FILE = TABLE.startsWith(`${root}/`) ? relative(root, TABLE) : TABLE;

/** An entry point as a finding names it: lcp's as `.` or `./x`, another package's as its import specifier. */
const label = (pkg, e) => (pkg === LCP ? e : `${pkg}${e.slice(1)}`);

/** The type names a declaration file exports, following `export type { … } from` and `export { type … }`. */
function typeExports(dir, name) {
  const text = readFileSync(join(dir, "dist", `${name}.d.ts`), "utf8");
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

/** Every export of every entry point of every package: a map from the entry point's label to its names. */
async function packageExports() {
  const out = new Map();
  for (const [name, dir] of PACKAGES) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (pkg.name !== name) throw new Error(`${dir}/package.json names ${pkg.name}, not ${name}`);
    for (const key of Object.keys(pkg.exports)) {
      const file = key === "." ? "index" : key.slice(2);
      if (!existsSync(join(dir, "dist", `${file}.js`))) {
        throw new Error(`${dir}/dist/${file}.js is missing: build the packages first (pnpm -r --if-present run build)`);
      }
      const mod = await import(pathToFileURL(join(dir, "dist", `${file}.js`)).href);
      out.set(label(name, key), new Set([...Object.keys(mod), ...typeExports(dir, file)]));
    }
  }
  return out;
}

/**
 * The `[entry point, name]` pairs an `exports` map of package `pkg` names, each entry point by its label, or a string
 * saying why it cannot be read.
 */
function exportsOf(map, pkg = LCP) {
  if (map === null || typeof map !== "object" || Array.isArray(map)) return "its exports are not a map";
  const out = [];
  for (const [e, names] of Object.entries(map)) {
    if (!Array.isArray(names) || names.length === 0) return `its exports under ${e} are not a list of names`;
    for (const n of names) {
      if (typeof n !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) return `${JSON.stringify(n)} is not a name`;
      out.push([label(pkg, e), n]);
    }
  }
  return out;
}

const text = (v) => (typeof v === "string" ? v.trim() : "");
const problems = [];
const source = readFileSync(TABLE, "utf8");
const table = JSON.parse(source);
const exported = await packageExports();

let notRun;
try {
  const { key, reason } = keyOf(KEY_FILE, process.env);
  if (key === undefined) throw new Error(reason);
  const scan = scanner(key);
  for (const { line, item } of scan(source)) problems.push(`${FILE}:${line}: check-public-package finds item ${item}`);
} catch (e) {
  notRun = e.message;
}

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
  const pkg = u.package ?? LCP;
  if (!PACKAGES.some(([name]) => name === pkg)) {
    problems.push(`${where}: ${JSON.stringify(pkg)} is not a package the table covers`);
    return;
  }
  const names = exportsOf(u.exports, pkg);
  if (typeof names === "string") {
    problems.push(`${where}: ${names}`);
    return;
  }
  for (const [e, n] of names) {
    const key = `${e} ${n}`;
    unitsOf.set(key, [...(unitsOf.get(key) ?? []), i + 1]);
    if (!exported.has(e)) problems.push(`${where}: ${pkg} has no entry point ${e}`);
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

if (notRun !== undefined) console.error(`check-public-units: the scan for held items did not run: ${notRun}`);
if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`check-public-units: ${problems.length} problems`);
  process.exit(1);
}
if (notRun !== undefined) process.exit(2);
console.log(
  `check-public-units: ${exported.size} entry points, ${count} exports, ${units.length} units` +
    (pending.size > 0 ? ` (${pending.size} exports pending)` : "") +
    `; every export is in one unit of ${FILE}`,
);
