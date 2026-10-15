#!/usr/bin/env node
// Compiles and runs every TypeScript sample in the READMEs (every README.md in the tree, outside node_modules and
// build output) and in the pages under docs/ (except the generated API pages) against the built lcp package.
//
// Each file is read as CommonMark reads it, by mdast-util-from-markdown: a fenced code block inside a block quote or a
// list item is read where it stands, and the text of an indented code block, an HTML block or a paragraph is never a
// fence. A sample is a fenced code block whose info string starts with `ts` or `typescript` and does not contain
// `no-check`. A fenced code block whose info string starts with another TypeScript or JavaScript name (`tsx`, `mts`,
// `cts`, `js`, `jsx`, `mjs`, `cjs`, `javascript`, or `ts` or `typescript` with a capital letter) fails unless it
// contains `no-check`, so no sample leaves the run by its label. Each sample is a complete ESM program. It is written
// to lcp/.samples/, so `@integraledger/lcp` resolves to the package itself, type-checked with lcp/tsconfig.docs.json,
// then run with node. When the block after a sample in the same container, with only blank lines between them, is a
// fenced `text` block, the program's standard output must equal that block's content.
//
// Usage: node scripts/docs-samples.mjs [file.md ...]   (from the repository root, after lcp is built; with no file,
// every README and page under docs/)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";

const root = join(import.meta.dirname, "..");
const lcp = join(root, "lcp");
const out = join(lcp, ".samples");
const TIMEOUT_MS = 60_000;

if (!existsSync(join(lcp, "dist", "index.js"))) {
  console.error("lcp/dist is missing: build the package first");
  process.exit(1);
}

/** The Markdown files whose samples run: every README.md and every page under docs/ except the generated API pages. */
function sources() {
  const files = [];
  const readmes = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === "out" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (p !== join(root, "docs")) readmes(p);
      } else if (e.name === "README.md") {
        files.push(p);
      }
    }
  };
  readmes(root);
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (relative(root, p) !== join("docs", "reference", "api")) walk(p);
      } else if (name.endsWith(".md")) {
        files.push(p);
      }
    }
  };
  if (existsSync(join(root, "docs"))) walk(join(root, "docs"));
  return files;
}

/**
 * The fenced code blocks of one Markdown file, in document order: language, info string, body, the line the block
 * opens on, and the body of the fenced `text` block that follows it in the same container, if one does. Only a fenced
 * code block has an info string, so a code node with no language is an indented block or a fence with none. Nodes
 * that follow each other in one container have only blank lines between them.
 */
function fences(text) {
  const found = [];
  const walk = (node) => {
    const children = node.children ?? [];
    children.forEach((child, k) => {
      if (child.type === "code" && child.lang !== null) {
        const next = children[k + 1];
        found.push({
          lang: child.lang,
          info: child.meta === null ? child.lang : `${child.lang} ${child.meta}`,
          body: child.value,
          line: child.position.start.line,
          output: next?.type === "code" && next.lang === "text" ? next.value : undefined,
        });
      }
      walk(child);
    });
  };
  walk(fromMarkdown(text));
  return found;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

const samples = [];
const refused = [];
const named = process.argv.slice(2).map((f) => resolve(f));
for (const file of named.length > 0 ? named : sources()) {
  const where = relative(root, file);
  for (const f of fences(readFileSync(file, "utf8"))) {
    const lang = f.lang;
    if (/\bno-check\b/.test(f.info)) continue;
    if (lang !== "ts" && lang !== "typescript") {
      if (/^(?:[cm]?[jt]sx?|typescript|javascript)$/i.test(lang)) refused.push(`${where}:${f.line} is fenced \`${lang}\``);
      continue;
    }
    const name = `${where.replace(/[^A-Za-z0-9]+/g, "-")}-${f.line}.ts`;
    writeFileSync(join(out, name), `${f.body}\n`);
    samples.push({ where: `${where}:${f.line}`, name, output: f.output });
  }
}

let failed = 0;
for (const r of refused) console.error(`FAIL ${r}: a sample is fenced \`ts\`, and any other TypeScript or JavaScript fence is marked no-check`);
let typeErrors = "";
try {
  if (samples.length > 0) {
    try {
      execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.docs.json"], { cwd: lcp, stdio: "pipe", encoding: "utf8" });
    } catch (e) {
      typeErrors = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
  }
  if (typeErrors === "") {
    for (const s of samples) {
      const run = spawnSync(process.execPath, [join(out, s.name)], { cwd: out, encoding: "utf8", timeout: TIMEOUT_MS });
      if (run.status !== 0) {
        failed++;
        console.error(`FAIL ${s.where}: exit ${run.status ?? run.signal}\n${run.stderr}`);
        continue;
      }
      if (s.output !== undefined && run.stdout.trimEnd() !== s.output.trimEnd()) {
        failed++;
        console.error(`FAIL ${s.where}: the output differs\n--- expected\n${s.output}\n--- printed\n${run.stdout}`);
        continue;
      }
      console.log(`ok   ${s.where}${s.output !== undefined ? " (output matches)" : ""}`);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (samples.length === 0) {
  console.error("no TypeScript sample found");
  process.exit(1);
}
if (typeErrors !== "") {
  console.error(`the samples do not type-check:\n${typeErrors}`);
  for (const s of samples) console.error(`  ${s.name} is ${s.where}`);
  process.exit(1);
}
console.log(`${samples.length - failed} of ${samples.length} samples type-check, run and print what the docs show`);
if (refused.length > 0) console.error(`${refused.length} fence(s) labelled as TypeScript or JavaScript other than ts, without no-check`);
process.exit(failed === 0 && refused.length === 0 ? 0 : 1);
