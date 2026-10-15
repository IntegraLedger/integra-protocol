#!/usr/bin/env node
// Writes each exported page's script policy, the last step of `pnpm build`: a
// `<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'sha256-…' …">`, placed right after the page's
// `<meta charSet>`, which so stays within the page's first 1,024 bytes, and before every script, link and style,
// naming the SHA-256 of each inline script the page holds.
//
// The browser enforces that policy beside the one public/_headers gives every response, so a script runs only when it
// is one of the site's own files or one of the page's inline scripts, byte for byte. The hashes go in the page because
// a static export carries no nonce, and one page's hashes are longer than a line of _headers may be (Cloudflare takes
// 2,000 characters). The header policy allows the site's scripts and inline scripts, which this policy narrows to the
// hashed ones, and keeps frame-ancestors, which a <meta> policy cannot carry.
//
// A page is an .html file under out/ that begins `<!DOCTYPE html>`; the LCP documents written as .html are Markdown and
// are left alone. Writing a page that holds a policy replaces it, so the step gives the same pages however often it runs.
//
// Usage, from website/, after `next build` and scripts/lcp-documents.mjs:
//   node scripts/script-policy.mjs
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = "out";
/** A script element, its attributes and its text; a script's text runs to the first `</script`. */
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
/** The script types a browser runs (HTML's JavaScript MIME type essences, and module); any other type is data. */
const RUN = /^(|module|(text|application)\/(x-)?(javascript|ecmascript)|text\/(jscript|livescript|javascript1\.[0-5]))$/i;
/** The page's policy element, as this step writes it. */
const POLICY = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/;
/** The start of a page as Next.js writes it, up to the end of its `<meta charSet>`. */
const START = /^<!DOCTYPE html><html\b[^>]*><head><meta charSet="utf-8"\/>/;

/** The text of each inline script of a page that a browser runs, in order. */
function inlineScripts(html) {
  return [...html.matchAll(SCRIPT)]
    .filter(([, attributes]) => !/\ssrc\s*=/i.test(` ${attributes}`))
    .filter(([, attributes]) => RUN.test((/\stype\s*=\s*"([^"]*)"/i.exec(` ${attributes}`)?.[1] ?? "").trim()))
    .map(([, , text]) => text);
}

/** A script's hash as a policy source: `'sha256-<base64 of the SHA-256 of its UTF-8 text>'`. */
function hashOf(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** Every .html file under a folder. */
function htmlFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

let pages = 0;
let scripts = 0;
for (const file of htmlFiles(OUT)) {
  const read = readFileSync(file, "utf8");
  if (!read.startsWith("<!DOCTYPE html>")) continue;
  const html = read.replace(POLICY, "");
  const start = START.exec(html);
  const first = html.search(/<script\b/i);
  if (!start || (first !== -1 && first < start[0].length)) {
    throw new Error(`${file} does not begin <!DOCTYPE html><html …><head><meta charSet="utf-8"/> before its first script`);
  }
  const inline = inlineScripts(html);
  const hashes = [...new Set(inline.map(hashOf))];
  const meta = `<meta http-equiv="Content-Security-Policy" content="${["script-src 'self'", ...hashes].join(" ")}"/>`;
  writeFileSync(file, html.slice(0, start[0].length) + meta + html.slice(start[0].length));
  pages++;
  scripts += inline.length;
}
if (pages === 0) throw new Error(`${OUT} holds no page: run next build first`);
console.log(`wrote the script policy of ${pages} pages in ${OUT}, hashing their ${scripts} inline scripts`);
