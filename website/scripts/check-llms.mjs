#!/usr/bin/env node
// Checks the files the site writes for AI agents, in out/, the last step of `pnpm build`:
// - every link of the site's own in every llms.txt names a file the site serves: a page's Markdown address its copy
//   under /md/ (worker.js answers it), any other address its file (an LCP document written as <address>.html too);
// - each size an llms.txt states for a file, "<n> KB, about <n> tokens", is that file's;
// - every page's Markdown copy is listed in /llms.txt, and each copy names /llms.txt.
// Each failure names the file and the link.
//
// Usage, from website/, after `next build` and the steps after it:
//   node scripts/check-llms.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ORIGIN } from "../src/lib/lcp-documents.ts";
import { fileFor } from "./serve-export.mjs";

const OUT = join(import.meta.dirname, "..", "out");

/** Every file under a folder, as its path from out/ with forward slashes. */
const filesUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(OUT, join(e.parentPath, e.name)).split(sep).join("/"));

/** The file of out/ that answers an address of the site, or undefined. */
function served(address) {
  if (address.endsWith(".md")) {
    const copy = join(OUT, "md", address === "/index.md" ? "index.md" : address.slice(1));
    if (statSync(copy, { throwIfNoEntry: false })?.isFile()) return copy;
  }
  return fileFor(OUT, address);
}

/** The size the build states for a text: as src/lib/llms.ts's sizeOf writes it. */
function sizeOf(bytes) {
  const size = bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  const step = bytes >= 40_000 ? 1000 : 100;
  const tokens = Math.max(step, Math.round(bytes / 4 / step) * step);
  return `${size}, about ${tokens.toLocaleString("en-US")} tokens`;
}

const failures = [];
const indexes = filesUnder(OUT).filter((f) => f === "llms.txt" || f.endsWith("/llms.txt"));
let links = 0;
let sizes = 0;
const listed = new Set();
for (const index of indexes) {
  const text = readFileSync(join(OUT, index), "utf8");
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)) {
      const url = m[1];
      if (!url.startsWith(`${ORIGIN}/`)) continue;
      links++;
      const address = url.slice(ORIGIN.length).split("#")[0];
      const file = served(address);
      if (file === undefined) {
        failures.push(`${index}: ${url} names no file of out/`);
        continue;
      }
      if (index === "llms.txt" && address.endsWith(".md")) listed.add(relative(OUT, file).split(sep).join("/"));
      const size = /\): (?:[^;]*; )?(\d+(?:\.\d)? (?:KB|MB), about [\d,]+ tokens)/.exec(line.slice(m.index))?.[1];
      if (size !== undefined) {
        sizes++;
        const actual = sizeOf(statSync(file).size);
        if (size !== actual) failures.push(`${index}: ${url} is stated as ${size}; it is ${actual}`);
      }
    }
  }
  for (const m of text.matchAll(/https:\/\/\S+?\/llms-full\.txt \((\d+(?:\.\d)? (?:KB|MB), about [\d,]+ tokens)\)/g)) {
    sizes++;
    const file = served(m[0].slice(ORIGIN.length).split(" ")[0]);
    const actual = file === undefined ? "no file" : sizeOf(statSync(file).size);
    if (m[1] !== actual) failures.push(`${index}: ${m[0]}: it is ${actual}`);
  }
}
const copies = filesUnder(join(OUT, "md")).filter((f) => f.endsWith(".md"));
for (const copy of copies) {
  if (!listed.has(copy)) failures.push(`llms.txt does not list ${copy}`);
  if (!readFileSync(join(OUT, copy), "utf8").includes(`${ORIGIN}/llms.txt`)) failures.push(`${copy} does not name /llms.txt`);
}
if (indexes.length < 3 || links === 0 || sizes === 0) failures.push(`read ${indexes.length} indexes, ${links} links, ${sizes} sizes`);

if (failures.length > 0) {
  console.error(`${failures.length} failures in the files for AI agents:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `${indexes.length} llms.txt files: each of their ${links} links names a file of out/, each of ${sizes} sizes is its file's; ` +
    `/llms.txt lists all ${copies.length} Markdown copies, and each names /llms.txt`,
);
