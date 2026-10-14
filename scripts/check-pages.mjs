#!/usr/bin/env node
// Checks the site's export:
// - every link has a name, which a screen reader reads out and which Lighthouse's `link-name` check requires. A link's
//   name is its text, a non-empty `aria-label`, `aria-labelledby` or `title`, or the `alt` of an image inside it;
// - every link to a fragment of a page on the site, `#x` or `/path#x`, finds an element with that id on that page.
//
// Usage, from the repository root, after `pnpm build` in website/:
//   node scripts/check-pages.mjs --out website/out
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
const HREF = /\bhref\s*=\s*"([^"]*)"/;
const ID = /\bid\s*=\s*"([^"]+)"/g;
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

/** The file in the export that serves a site path: `/a/b` is `a/b.html` or `a/b/index.html`. */
function pageOf(path) {
  const p = path.replace(/^\/+|\/+$/g, "");
  const candidates = p === "" ? ["index.html"] : [`${p}.html`, join(p, "index.html"), p];
  return candidates.map((c) => join(outDir, c)).find((c) => c.endsWith(".html") && existsSync(c));
}

const files = pages(outDir);
if (files.length === 0) {
  console.error(`${outDir} holds no .html page: run pnpm build in website/ first`);
  process.exit(1);
}
const html = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const ids = new Map([...html].map(([f, text]) => [f, new Set([...text.matchAll(ID)].map((m) => m[1]))]));
let links = 0;
let fragments = 0;
const failures = [];
for (const [file, text] of html) {
  for (const m of text.matchAll(LINK)) {
    links++;
    const where = () => `${relative(outDir, file)}:${text.slice(0, m.index).split("\n").length}`;
    if (!named(m[1], m[2])) failures.push(`${where()}: no name: ${m[0].slice(0, 160)}`);
    const href = HREF.exec(m[1])?.[1];
    if (href === undefined || !href.includes("#") || !(href.startsWith("#") || /^\/(?!\/)/.test(href))) continue;
    const [path, fragment] = [href.slice(0, href.indexOf("#")), href.slice(href.indexOf("#") + 1)];
    if (fragment === "") continue;
    fragments++;
    const target = path === "" ? file : pageOf(path);
    let id;
    try {
      id = decodeURIComponent(fragment);
    } catch {
      id = fragment;
    }
    if (target === undefined) failures.push(`${where()}: no page serves ${href}`);
    else if (!ids.get(target)?.has(id)) failures.push(`${where()}: no element with id "${id}" on ${relative(outDir, target)}: ${href}`);
  }
}
if (failures.length > 0) {
  console.error(`${failures.length} failures among ${links} links on ${files.length} pages:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`each of the ${links} links on ${files.length} pages has a name, and each of its ${fragments} fragment links finds its target`);
