#!/usr/bin/env node
// Checks the site's export: every link has a name, which a screen reader reads out and which Lighthouse's `link-name`
// check requires. A link's name is its text, a non-empty `aria-label`, `aria-labelledby` or `title`, or the `alt` of an
// image inside it.
//
// Usage, from the repository root, after `pnpm build` in website/:
//   node scripts/check-pages.mjs --out website/out
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const at = process.argv.indexOf("--out");
const outDir = at === -1 ? undefined : process.argv[at + 1];
if (!outDir) {
  console.error("usage: node scripts/check-pages.mjs --out website/out");
  process.exit(2);
}

/** Every `.html` file under `dir`. */
function pages(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name));
}

const LINK = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
const NAMED_BY_ATTRIBUTE = /\b(?:aria-label|aria-labelledby|title)\s*=\s*"[^"]*\S[^"]*"/;
const IMAGE_WITH_ALT = /<img\b[^>]*\balt\s*=\s*"[^"]*\S[^"]*"/;

function named(attributes, inner) {
  if (NAMED_BY_ATTRIBUTE.test(attributes) || IMAGE_WITH_ALT.test(inner)) return true;
  const text = inner
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ");
  return text.trim() !== "";
}

const files = pages(outDir);
if (files.length === 0) {
  console.error(`${outDir} holds no .html page: run pnpm build in website/ first`);
  process.exit(1);
}
let links = 0;
const nameless = [];
for (const file of files) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(LINK)) {
    links++;
    if (!named(m[1], m[2])) {
      const line = html.slice(0, m.index).split("\n").length;
      nameless.push(`${relative(outDir, file)}:${line}: ${m[0].slice(0, 160)}`);
    }
  }
}
if (nameless.length > 0) {
  console.error(`${nameless.length} of ${links} links on ${files.length} pages have no name:`);
  for (const n of nameless) console.error(`  ${n}`);
  process.exit(1);
}
console.log(`each of the ${links} links on ${files.length} pages has a name`);
