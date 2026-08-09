#!/usr/bin/env node
// check:docs — extract ```ts fences from the DOCUMENTATION A READER ACTUALLY GETS and typecheck them
// against the built workspace. Three sources: docs/developer/**, the root README, and every package
// README.
//
// The package READMEs were outside this gate until 2026-08-08, and that was the wrong boundary: they are
// the code on the npmjs page and the only documentation inside a tarball, so they are the fences most
// likely to be copied and the ones nobody could check. Three of them did not compile — a destructure of
// `.value` off an un-narrowed `Outcome`, a `ChainReader` passed where a `TempoReader` was required, and a
// root-README fence referencing identifiers declared in a different fence. A fence opened ```ts (or ```typescript) is checked; ```ts no-check is exempt.
// Snippets materialize under reports/doc-snippets/ (gitignored) as <doc-path>__L<line>.ts so a
// tsc error names its source doc and fence line. Requires a prior `pnpm -r build`: workspace
// types come from each package's emitted dist.
// Fences MUST open at column 0 — the extractor sees nothing else. An indented ts fence is a hard
// error rather than a silent skip, so a snippet can never look checked while never being checked.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs");
const PACKAGES = join(ROOT, "packages");
const OUT = join(ROOT, "reports", "doc-snippets");
// A ts fence the extractor's column-0 regex would never see. Only tested outside an open fence.
const INDENTED_TS_FENCE = /^\s+`{3,}\s*(?:ts|typescript)(?:\s+no-check)?\s*$/;

const mdFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".md")) mdFiles.push(p);
  }
};
// `docs/` ENTIRE, not `docs/developer/` — widened 2026-08-08. AGENTS.md claimed the wider scope while the
// walker took the narrower one, so a fence added anywhere else under docs/ was reported clean by a gate
// that had never opened the file. The developer tree is optional (the curated public export can be built
// without it) but the READMEs never are, so an empty file list is a defect rather than a no-op.
if (existsSync(DOCS)) walk(DOCS);
const rootReadme = join(ROOT, "README.md");
if (existsSync(rootReadme)) mdFiles.push(rootReadme);
for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const readme = join(PACKAGES, entry.name, "README.md");
  if (existsSync(readme)) mdFiles.push(readme);
}
if (mdFiles.length === 0)
  throw new Error(
    "check:docs found no markdown at all. The package READMEs are not optional; a silent zero here " +
      "would report every fence as checked while checking none.",
  );
mdFiles.sort();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let snippets = 0;
for (const md of mdFiles) {
  const lines = readFileSync(md, "utf8").split("\n");
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(`{3,})\s*(.*)$/);
    if (!m) {
      if (fence) {
        fence.buf.push(line);
      } else if (INDENTED_TS_FENCE.test(line)) {
        console.error(
          `check:docs — indented ts fence in ${relative(ROOT, md)} at line ${i + 1}.\n` +
            "Checked fences must start at column 0 (the extractor only sees column-0 fences).\n" +
            "Unindent it, or mark it ```ts no-check if it is a deliberate fragment.",
        );
        process.exit(1);
      }
      continue;
    }
    if (!fence) {
      fence = { ticks: m[1].length, info: m[2].trim(), start: i + 1, buf: [] };
      continue;
    }
    if (m[1].length >= fence.ticks && m[2].trim() === "") {
      const { info, start, buf } = fence;
      fence = null;
      if (info !== "ts" && info !== "typescript") continue; // includes `ts no-check`
      snippets++;
      // Relative to ROOT, never to DOCS. A README lives outside the developer tree, so a DOCS-relative
      // path begins `../../` and the slug begins with a DOT — a hidden file, which TypeScript excludes
      // from a directory `include` without a word. The fences were extracted, counted and reported as
      // "typechecked clean" while tsc never opened one of them.
      const slug = relative(ROOT, md).replaceAll("/", "__").replace(/\.md$/, "");
      writeFileSync(join(OUT, `${slug}__L${start}.ts`), `${buf.join("\n")}\n`);
    } else {
      fence.buf.push(line);
    }
  }
  if (fence) {
    console.error(`check:docs — unclosed \`\`\` fence in ${relative(ROOT, md)} at line ${fence.start}`);
    process.exit(1);
  }
}

// THE BLIND-GATE CANARY, and the reason it exists: this walker has silently narrowed once already. A gate
// that stops finding files reports "clean" forever, which is indistinguishable from passing.
//
// It used to be a CONSTANT floor (55 docs / 50 snippets), and that was wrong in a way only the D7 export
// revealed: the curated public tree drops 28 internal records from `docs/`, so a correct export walked 48
// docs and FAILED a floor written for the private tree. The old comment even predicted it — "lower the
// floor deliberately when that happens" — but a gate you have to hand-adjust per tree is a gate that gets
// adjusted downward under deadline.
//
// So the expectation is DERIVED instead, by a different traversal than the walker's: enumerate what should
// be walked (the root README, every package README, every `.md` under `docs/`) and require the walker to
// have found exactly that. Equality, not a floor — it catches a walker that narrows AND one that widens
// unexpectedly, it needs no maintenance, and it holds in the private tree and the export alike.
const expectedDocs = (() => {
  let n = existsSync(rootReadme) ? 1 : 0;
  for (const entry of readdirSync(PACKAGES, { withFileTypes: true }))
    if (entry.isDirectory() && existsSync(join(PACKAGES, entry.name, "README.md"))) n++;
  const countMd = (dir) => {
    if (!existsSync(dir)) return 0;
    let c = 0;
    for (const e of readdirSync(dir, { withFileTypes: true }))
      c += e.isDirectory() ? countMd(join(dir, e.name)) : e.name.endsWith(".md") ? 1 : 0;
    return c;
  };
  return n + countMd(DOCS);
})();

if (mdFiles.length !== expectedDocs) {
  console.error(
    `check:docs — BLIND GATE: walked ${mdFiles.length} doc(s), an independent enumeration expects ` +
      `${expectedDocs} (root README + every package README + every .md under docs/). ` +
      `The two must agree; "clean" from a walker that disagrees would mean nothing.`,
  );
  process.exit(1);
}

if (snippets === 0) {
  console.error(
    `check:docs — BLIND GATE: ${mdFiles.length} doc(s) walked and NOT ONE checkable ts fence found. ` +
      `Every fence being no-check is a defect, not a pass.`,
  );
  process.exit(1);
}

// Same trick for the fences: count column-0 ```ts openers with a plain scan and require the extractor to
// have produced one snippet each. A constant floor here would rot for the same reason the doc floor did.
const expectedSnippets = mdFiles.reduce((acc, md) => {
  let fenced = false;
  let n = 0;
  for (const line of readFileSync(md, "utf8").split("\n")) {
    const m = line.match(/^(`{3,})\s*(.*)$/);
    if (!m) continue;
    if (!fenced) {
      fenced = true;
      if (m[2].trim() === "ts" || m[2].trim() === "typescript") n++;
      continue;
    }
    if (m[2].trim() === "") fenced = false;
  }
  return acc + n;
}, 0);

if (snippets !== expectedSnippets) {
  console.error(
    `check:docs — BLIND GATE: extracted ${snippets} snippet(s), an independent scan counts ` +
      `${expectedSnippets} checkable ts fence(s). Fences are being missed or silently skipped.`,
  );
  process.exit(1);
}

try {
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.docs.json"], { stdio: "inherit" });
} catch {
  console.error(
    `check:docs — FAILED. Each reports/doc-snippets/<doc>__L<line>.ts above maps to that doc's fence at that line.`,
  );
  process.exit(1);
}
console.log(`check:docs — ${snippets}/${expectedSnippets} snippet(s) across ${mdFiles.length}/${expectedDocs} doc(s) typechecked clean`);
