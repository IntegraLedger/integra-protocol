/**
 * ⛔⛔ **EVERY RUNTIME IMPORT A PUBLISHED PACKAGE MAKES IS DECLARED IN ITS OWN `dependencies`.**
 *
 * `binding-evm-escrow` shipped `0.15.1` importing `canonicalAtrHash` from `@integraledger/lcp-kernel`
 * while its manifest carried the kernel in `devDependencies`. It resolved for everyone who tried it,
 * because a hoisted install happens to put the kernel where Node looks — so nothing failed, in this
 * repository or in a consumer's, until an install that did not hoist. The package was correct by luck.
 *
 * ⛔ **A `type` import is exempt and that is not a loophole.** Types are erased at build, so a
 * type-only import genuinely does not need a runtime dependency; `import type` is the declaration that
 * says so. What this gate refuses is a VALUE import — the kind whose specifier survives into `dist/`.
 *
 * ⚠️ **`peerDependencies` count as declared.** A package that asks its consumer to supply a chain SDK
 * has declared the edge; it has just declared it as the consumer's to install.
 *
 * ⛔ **THE SUBJECT SET IS THE PUBLISHED PACKAGES, DERIVED FROM `private`** — the same property
 * `release.yml` selects on — and it refuses an empty one. A gate that measured no packages would be
 * this repository's oldest failure, and it is the one this file exists to avoid rather than commit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PACKAGES = "packages";

/** Every `.ts` under a directory, recursively. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

/** The package a bare specifier belongs to: `@scope/name/deep` → `@scope/name`, `name/deep` → `name`. */
function packageOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

const problems = [];
let checked = 0;

for (const dir of readdirSync(PACKAGES)) {
  const manifestPath = join(PACKAGES, dir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    continue;
  }
  // ⛔ Enumerated by PROPERTY, exactly as release.yml selects what it publishes.
  if (manifest.private === true) continue;
  checked += 1;

  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);

  const srcDir = join(PACKAGES, dir, "src");
  let files;
  try {
    files = sources(srcDir);
  } catch {
    continue;
  }

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Value imports only: `import type ...` and `import { type X }`-only forms are erased.
    const pattern =
      /^\s*import\s+(?!type\s)([\s\S]*?)\s*from\s*["']([^"']+)["']/gm;
    for (const match of text.matchAll(pattern)) {
      const clause = match[1] ?? "";
      const specifier = match[2] ?? "";
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      // A brace clause whose every member is `type X` is erased too.
      const braces = clause.match(/\{([\s\S]*)\}/);
      if (braces !== null) {
        const members = (braces[1] ?? "")
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m !== "");
        if (members.length > 0 && members.every((m) => m.startsWith("type ")))
          continue;
      }
      const name = packageOf(specifier);
      if (!declared.has(name))
        problems.push(
          `${manifest.name}: ${file} imports \`${name}\` as a VALUE, and the manifest declares it in neither \`dependencies\` nor \`peerDependencies\`.`,
        );
    }
  }
}

if (checked === 0) {
  console.error(
    "\nRefusing to verify: check:declared-imports measured NO published packages. The subject set is\nderived from `private !== true` over packages/*/package.json; an empty one means the derivation broke,\nnot that the tree is clean.\n",
  );
  process.exit(1);
}

const unique = [...new Set(problems)];
if (unique.length > 0) {
  console.error(
    `\nRefusing to verify: check:declared-imports — ${String(unique.length)} undeclared runtime import(s).\n`,
  );
  for (const problem of unique) console.error(`  ⛔ ${problem}`);
  console.error(
    "\nMove the package into `dependencies` (or `peerDependencies` if the consumer supplies it). A runtime\nimport that resolves only because an install hoisted it is a package that works by luck.\n",
  );
  process.exit(1);
}

console.log(
  `check:declared-imports — ${String(checked)} published package(s); every value import declared.`,
);
