#!/usr/bin/env node
/**
 * Every top-level export a consumer can import must carry a docblock.
 *
 * The hole this closes is not "coverage is low" — it was 79%, which sounds fine. It is that the
 * distribution was INVERTED against importance: members were documented and containers were not, so
 * hovering `WeldAdapter`, `createSolanaAdapter`, `EvidenceBundle` or `VerificationReport` in an IDE showed
 * nothing while the fields inside them were fully annotated. The symbols a stranger meets first were the
 * ones with no text. A percentage floor would not have caught that, because 79% was already the number.
 *
 * So the floor is 100% and the unit is the ENTRY POINT: every name reachable from a package's
 * `src/index.ts`. Anything not re-exported there is internal and out of scope, and a name re-exported from
 * ANOTHER package is documented at its source, not here.
 *
 * **Adjacency is strict — no blank line between the docblock and the declaration.** That rule is
 * load-bearing rather than stylistic: two declarations passed a lenient check purely because the FILE's
 * module docblock sat above them across a blank line, so the gate would have certified a symbol whose
 * hover text belongs to something else.
 *
 * This parses source text rather than the TypeScript AST. TypeScript 7's compiler API is available only
 * under `typescript/unstable/*`, and pinning the gate every `pnpm verify` depends on to an explicitly
 * unstable surface trades a durable check for a more precise one. The parse is bounded instead: a name it
 * cannot resolve is REPORTED, never skipped, and `EXPORT_FLOOR` below refuses a run that suddenly sees far
 * fewer exports than the tree holds — the failure mode of a text parser is to stop matching, and a gate
 * that silently matches nothing passes everything.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

// Far below the real count (590 on 2026-08-08) and far above zero — the same blind-gate discipline
// `depcruise-gate.mjs` uses. Raise it when the surface grows substantially; never lower it to pass.
const EXPORT_FLOOR = 450;

const DECL =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|type|interface|class|enum)\s+([A-Za-z_$][\w$]*)/;
const FROM_BLOCK = /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
const STAR = /export\s+\*\s+from\s+["']([^"']+)["']/g;

/** Does the block comment ENDING at `endIdx` open with `/**`? */
function isJsdoc(lines, endIdx) {
  for (let k = endIdx; k >= 0; k--) {
    const t = lines[k].trim();
    if (t.startsWith("/**")) return true;
    if (t.startsWith("/*")) return false;
    if (k < endIdx && t.endsWith("*/")) return false;
  }
  return false;
}

/** Every name a file declares and exports, with whether the declaration is documented. */
function declaredExports(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = DECL.exec(lines[i]);
    if (!m) continue;
    const prev = i > 0 ? lines[i - 1].trim() : "";
    out.set(m[1], {
      documented: prev.endsWith("*/") && isJsdoc(lines, i - 1),
      line: i + 1,
    });
  }
  return out;
}

/** `{ exportedName -> { mod, local } }` for every `export { … } from "…"`, plus `*` for star re-exports. */
function reexports(file) {
  const text = readFileSync(file, "utf8");
  const names = new Map();
  for (const m of text.matchAll(FROM_BLOCK))
    for (const raw of m[1].split(",")) {
      const spec = raw.trim().replace(/^type\s+/, "");
      if (spec === "") continue;
      const aliased = /^(\S+)\s+as\s+(\S+)$/.exec(spec);
      names.set(aliased ? aliased[2] : spec, {
        mod: m[2],
        local: aliased ? aliased[1] : spec,
      });
    }
  for (const m of text.matchAll(STAR)) names.set("*", { mod: m[1], local: "*" });
  return names;
}

/** `"./carrier.js"` -> `"carrier.ts"` — a report has to name the file an author can open, and ESM
 *  specifiers point at the emitted `.js`. */
function sourceOf(spec) {
  return spec.replace(/^\.\//, "").replace(/\.js$/, ".ts");
}

/** Every `.ts` under `dir`, one level deep, keyed by the `./x.js` specifier an index would import it as. */
function moduleFiles(dir) {
  const out = new Map();
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      for (const g of readdirSync(p))
        if (g.endsWith(".ts")) out.set(`./${f}/${g.replace(/\.ts$/, ".js")}`, join(p, g));
    } else if (f.endsWith(".ts")) {
      out.set(`./${f.replace(/\.ts$/, ".js")}`, p);
    }
  }
  return out;
}

const undocumented = [];
const unresolved = [];
let total = 0;
let packages = 0;

for (const dir of readdirSync(join(root, "packages")).sort()) {
  const src = join(root, "packages", dir, "src");
  const index = join(src, "index.ts");
  // `rail-invariants` is test-only and has no `src/`. A package with no entry point exports nothing.
  if (!existsSync(index)) continue;
  packages++;

  const decls = new Map();
  const external = new Map();
  for (const [spec, file] of moduleFiles(src)) {
    decls.set(spec, declaredExports(file));
    external.set(
      spec,
      new Set(
        [...reexports(file)]
          .filter(([name, r]) => name !== "*" && !r.mod.startsWith("."))
          .map(([name]) => name),
      ),
    );
  }

  const record = (name, info, where) => {
    total++;
    if (!info.documented) undocumented.push(`packages/${dir}/src/${where}:${info.line}  ${name}`);
  };

  for (const [exported, { mod, local }] of reexports(index)) {
    const modDecls = decls.get(mod);
    if (exported === "*") {
      if (modDecls === undefined) {
        unresolved.push(`packages/${dir}/src/index.ts  export * from "${mod}"`);
        continue;
      }
      for (const [name, info] of modDecls) record(name, info, sourceOf(mod));
      continue;
    }
    const info = modDecls?.get(local);
    if (info === undefined) {
      // A name re-exported straight through from another package is documented where it is declared.
      if (external.get(mod)?.has(local)) continue;
      unresolved.push(`packages/${dir}/src/index.ts  ${exported} (from "${mod}")`);
      continue;
    }
    record(exported, info, sourceOf(mod));
  }
  for (const [name, info] of declaredExports(index)) record(name, info, "index.ts");
}

if (unresolved.length > 0) {
  console.error(
    `\nRefusing to verify: check:docblocks could not resolve ${unresolved.length} export(s).\n\n` +
      `${unresolved.map((u) => `  - ${u}`).join("\n")}\n\n` +
      `An export this gate cannot see is an export it cannot check, which is a hole in the gate rather\n` +
      `than a passing symbol. Either the re-export form is one the parser does not handle — extend it —\n` +
      `or the module specifier is wrong.\n`,
  );
  process.exit(1);
}

if (total < EXPORT_FLOOR) {
  console.error(
    `\nRefusing to verify: check:docblocks saw only ${total} top-level exports across ${packages} packages, ` +
      `floor is ${EXPORT_FLOOR}.\n\n` +
      `A text parser fails by matching nothing, and a gate that matches nothing passes everything. Either\n` +
      `the export surface really shrank by a third — raise the floor deliberately — or the parse broke.\n`,
  );
  process.exit(1);
}

if (undocumented.length > 0) {
  console.error(
    `\nRefusing to verify: ${undocumented.length} of ${total} top-level exports carry no docblock.\n\n` +
      `${undocumented.map((u) => `  - ${u}`).join("\n")}\n\n` +
      `Every name reachable from a package's entry point is something a stranger hovers in an IDE before\n` +
      `reading anything else. One or two sentences: what it is, what it is for, and the one thing that\n` +
      `surprises a first-time caller. The docblock must sit IMMEDIATELY above the declaration — a blank\n` +
      `line between them means the comment belongs to the file, not to the symbol.\n`,
  );
  process.exit(1);
}

console.log(
  `check:docblocks — ${total}/${total} top-level exports documented across ${packages} packages (floor ${EXPORT_FLOOR}).`,
);
