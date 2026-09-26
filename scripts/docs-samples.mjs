#!/usr/bin/env node
// Compiles and runs every TypeScript sample in the READMEs and docs/ against the built lcp package.
//
// A sample is a fence whose info string starts with `ts` or `typescript` and does not contain `no-check`. Each one is
// a complete ESM program. It is written to lcp/.samples/, so `@integraledger/lcp` resolves to the package itself,
// type-checked with lcp/tsconfig.docs.json, then run with node. When the next fence after a sample, with only blank
// lines between them, is a `text` fence, the program's standard output must equal that fence's content.
//
// Usage: node scripts/docs-samples.mjs [file.md ...]   (from the repository root, after lcp is built; with no file,
// every README and page under docs/)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = join(import.meta.dirname, "..");
const lcp = join(root, "lcp");
const out = join(lcp, ".samples");
const TIMEOUT_MS = 60_000;

if (!existsSync(join(lcp, "dist", "index.js"))) {
  console.error("lcp/dist is missing: build the package first");
  process.exit(1);
}

/** The Markdown files whose samples run: the READMEs and every page under docs/ except the generated API pages. */
function sources() {
  const files = [join(root, "README.md"), join(lcp, "README.md")].filter(existsSync);
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

/** The fences of one Markdown file, in order: info string, body and the line the fence opens on. */
function fences(text) {
  const lines = text.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})(.*)$/.exec(lines[i]);
    if (open === null) continue;
    const marker = open[1];
    const body = [];
    let j = i + 1;
    while (j < lines.length && !(lines[j].startsWith(marker) && lines[j].slice(marker.length).trim() === "")) {
      body.push(lines[j]);
      j++;
    }
    found.push({ info: open[2].trim(), body: body.join("\n"), line: i + 1, end: j });
    i = j;
  }
  return found.map((f, k) => {
    const next = found[k + 1];
    const between = next === undefined ? [] : lines.slice(f.end + 1, next.line - 1);
    const adjacent = next !== undefined && between.every((l) => l.trim() === "");
    return { ...f, output: adjacent && next.info.split(/\s+/)[0] === "text" ? next.body : undefined };
  });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);

const samples = [];
const named = process.argv.slice(2).map((f) => resolve(f));
for (const file of named.length > 0 ? named : sources()) {
  const where = relative(root, file);
  for (const f of fences(readFileSync(file, "utf8"))) {
    const lang = f.info.split(/\s+/)[0];
    if (lang !== "ts" && lang !== "typescript") continue;
    if (/\bno-check\b/.test(f.info)) continue;
    const name = `${where.replace(/[^A-Za-z0-9]+/g, "-")}-${f.line}.ts`;
    writeFileSync(join(out, name), `${f.body}\n`);
    samples.push({ where: `${where}:${f.line}`, name, output: f.output });
  }
}

let failed = 0;
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
process.exit(failed === 0 ? 0 : 1);
