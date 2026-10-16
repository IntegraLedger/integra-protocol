#!/usr/bin/env node
// Checks that a TypeScript user who installs @integraledger/lcp and none of its optional peers can typecheck any entry
// point, under the default `skipLibCheck: false`. From each entry point's `types` in lcp/package.json, it follows every
// relative import in the declarations tsc wrote to lcp/dist, and refuses any other import that is not one of the
// package's `dependencies` or a `node:` module. An optional peer's types belong only in a declaration no entry point
// reaches.
//
// Usage, from the repository root, after lcp is built:
//   node scripts/check-declaration-imports.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const LCP = resolve("lcp");

/** The module specifiers a declaration file names: imports, re-exports, `import("…")` types and type references. */
export function specifiersOf(text) {
  const found = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\/\/\/\s*<reference\s+types=["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) for (const m of text.matchAll(pattern)) found.push(m[1]);
  return found;
}

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The declaration file a relative specifier in `from` resolves to, as tsc writes `./x.js` for `./x.d.ts`. */
function declarationOf(from, specifier) {
  const target = resolve(dirname(from), specifier);
  for (const candidate of [target.replace(/\.js$/, ".d.ts"), `${target}.d.ts`, join(target, "index.d.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Each import an entry point's declarations reach that a user without the optional peers cannot resolve. */
export function refusedImports(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const allowed = new Set(Object.keys(manifest.dependencies ?? {}));
  const refused = [];
  const seen = new Set();
  const queue = [];
  for (const [entry, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target === "object" && target !== null && typeof target.types === "string") {
      queue.push({ file: resolve(root, target.types), via: entry });
    }
  }
  while (queue.length > 0) {
    const { file, via } = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) {
      refused.push(`${via}: ${relative(root, file)} does not exist (is lcp built?)`);
      continue;
    }
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const specifier of specifiersOf(line)) {
        if (specifier.startsWith(".")) {
          const next = declarationOf(file, specifier);
          if (next === undefined) refused.push(`${relative(root, file)}:${i + 1}: "${specifier}" resolves to no declaration`);
          else queue.push({ file: next, via });
        } else if (!specifier.startsWith("node:") && !allowed.has(packageOf(specifier))) {
          refused.push(`${relative(root, file)}:${i + 1}: "${specifier}" is not a dependency (reached from "${via}")`);
        }
      }
    });
  }
  return { refused, files: seen.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { refused, files } = refusedImports(LCP);
  if (refused.length > 0) {
    for (const r of refused) console.error(r);
    console.error(`${refused.length} import(s) in lcp's declarations need a package a user may not have installed`);
    process.exit(1);
  }
  console.log(`the ${files} declaration files lcp's entry points reach import only its dependencies and each other`);
}
