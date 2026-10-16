#!/usr/bin/env node
// Checks the script policy of the exported site (scripts/script-policy.mjs and public/_headers), reading out/ alone:
// - every page holds one `<meta http-equiv="Content-Security-Policy">`, the second element of its head, right after
//   its `<meta charSet>`, the first, which ends within the page's first 1,024 bytes, and so before every script, link
//   and style of the page; its policy is
//   `script-src 'self'` and the SHA-256 of each inline script the page holds: every one hashed, no other hash, and no
//   'unsafe-inline';
// - the policies out/_headers gives each page allow the site's script files, so the page's own policy decides which
//   inline scripts run, and hold frame-ancestors 'none', which a <meta> policy cannot carry;
// - every other file of out/ is given, among its policies, one with default-src 'none' and script-src 'none', so
//   no such file opened as a document runs a script;
// - out/_headers holds at most 100 rules and no line over 2,000 characters, Cloudflare's limits
//   (https://developers.cloudflare.com/workers/static-assets/headers/);
// - planted pages are reported: a page given one more inline script than its policy hashes, so the check sees a script
//   that the browser would refuse, and a page whose policy is moved before its charset; and scripts/script-policy.mjs
//   stops at a page holding a style inside SVG whose text holds "<", where a comment the browser reads can hide a
//   script.
// Each failure names the page or file. This reads the files as text, with its own reading of a script; the pinned
// browser loads every page under both policies in scripts/check-headers.mjs.
//
// Usage, from website/, after `pnpm build` there:
//   node scripts/check-script-policy.mjs
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { headersFor, parseHeaders } from "../headers.mjs";
import { withPolicy } from "./script-policy.mjs";
import { pagesOf } from "./serve-export.mjs";

const OUT = "out";
/** Cloudflare's limits on a `_headers` file. */
const MAX_RULES = 100;
const MAX_LINE = 2000;
/** The page's charset element, as Next.js writes it, and the start of a page up to its head's first element. */
const CHARSET = '<meta charSet="utf-8"/>';
const HEAD = /^<!DOCTYPE html><html\b[^>]*><head>/;

/** The directives of a policy, by name. */
function directives(policy) {
  return new Map(
    policy
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name.toLowerCase(), sources]),
  );
}

/** The policies of a Content-Security-Policy value: a comma separates two policies, each of which the browser enforces. */
function policiesOf(value) {
  return value
    .split(",")
    .map((p) => directives(p))
    .filter((p) => p.size > 0);
}

/** The sources a policy allows scripts from, or undefined when it does not rule scripts. */
function scriptSources(policy) {
  return policy.get("script-src") ?? policy.get("default-src");
}

/** The failures of one page's HTML. */
function failuresOf(address, html) {
  const failures = [];
  const head = html.slice(0, html.indexOf("</head>"));
  const metas = [...html.matchAll(/<meta\b[^>]*\bhttp-equiv="Content-Security-Policy"[^>]*>/gi)];
  if (metas.length !== 1) return [`${address}: ${metas.length} script policies, not 1`];
  const meta = metas[0];
  const charset = html.indexOf(CHARSET);
  const start = HEAD.exec(html);
  if (charset === -1) failures.push(`${address}: no ${CHARSET}`);
  else {
    const end = Buffer.byteLength(html.slice(0, charset + CHARSET.length));
    if (end > 1024) failures.push(`${address}: the charset ends at byte ${end}, past the first 1,024`);
  }
  if (!start) failures.push(`${address}: does not begin <!DOCTYPE html><html …><head>`);
  else {
    if (charset !== start[0].length) failures.push(`${address}: the head's first element is not ${CHARSET}`);
    if (meta.index !== start[0].length + CHARSET.length) {
      failures.push(`${address}: the script policy is not the head's second element, right after the charset`);
    }
  }
  const firstLoad = html.search(/<(script|link|style)\b/i);
  if (meta.index >= head.length) failures.push(`${address}: the script policy is not in <head>`);
  if (firstLoad !== -1 && firstLoad < meta.index) failures.push(`${address}: a script, link or style comes before the script policy`);
  const policy = directives(/\bcontent="([^"]*)"/.exec(meta[0])?.[1] ?? "");
  const sources = policy.get("script-src") ?? [];
  if (policy.size !== 1 || sources[0] !== "'self'") failures.push(`${address}: the policy is not script-src 'self' and hashes`);
  if (sources.some((s) => !/^'(self|sha256-[A-Za-z0-9+/]{43}=)'$/.test(s))) {
    failures.push(`${address}: the script policy allows more than 'self' and hashes: ${sources.join(" ")}`);
  }
  const hashed = new Set(sources.slice(1));
  const wanted = new Set();
  for (const [, attributes, text] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\ssrc=/.test(` ${attributes}`)) continue;
    const type = /\stype="([^"]*)"/.exec(` ${attributes}`)?.[1] ?? "";
    if (type === "application/ld+json" || type === "application/json") continue;
    if (type !== "") failures.push(`${address}: an inline script of type ${type}, which this check does not read`);
    // The browser reads each CR LF and lone CR as LF before it parses the page.
    const hash = `'sha256-${createHash("sha256").update(text.replace(/\r\n?/g, "\n"), "utf8").digest("base64")}'`;
    wanted.add(hash);
    if (!hashed.has(hash)) failures.push(`${address}: an inline script its policy does not hash, ${hash}: ${text.slice(0, 60)}`);
  }
  for (const hash of hashed) if (!wanted.has(hash)) failures.push(`${address}: its policy hashes ${hash}, no script of the page`);
  return failures;
}

const pages = pagesOf(OUT);
if (pages.length === 0) {
  console.error(`${OUT} holds no page: run pnpm build in website/ first`);
  process.exit(1);
}
const fileOf = (address) => join(OUT, address === "/" ? "index.html" : `${address.slice(1)}.html`);
const failures = [];
let scripts = 0;
for (const address of pages) {
  const html = readFileSync(fileOf(address), "utf8");
  failures.push(...failuresOf(address, html));
  scripts += [...html.matchAll(/<script\b(?![^>]*\ssrc=)(?![^>]*type="application\/(ld\+)?json")[^>]*>/gi)].length;
}

const headersText = readFileSync(join(OUT, "_headers"), "utf8");
const rules = parseHeaders(headersText);
if (rules.length > MAX_RULES) failures.push(`out/_headers holds ${rules.length} rules, past Cloudflare's ${MAX_RULES}`);
headersText.split("\n").forEach((line, i) => {
  if (line.length > MAX_LINE) failures.push(`out/_headers line ${i + 1} is ${line.length} characters, past ${MAX_LINE}`);
});
for (const address of pages) {
  const policies = policiesOf(headersFor(rules, address)["content-security-policy"] ?? "");
  if (!policies.some((p) => p.get("frame-ancestors")?.join(" ") === "'none'")) {
    failures.push(`${address}: no header policy holds frame-ancestors 'none'`);
  }
  const refusing = policies.filter((p) => scriptSources(p) !== undefined && !scriptSources(p).includes("'self'"));
  if (refusing.length > 0) failures.push(`${address}: a header policy refuses the site's script files`);
}

// Every other file the export serves, at its address: an LCP document written as <address>.html is served at <address>.
const pageSet = new Set(pages);
let files = 0;
for (const entry of readdirSync(OUT, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = relative(OUT, join(entry.parentPath, entry.name)).split(sep).join("/");
  if (path === "_headers") continue;
  const bare = path.endsWith(".html") ? `/${path.slice(0, -".html".length)}` : undefined;
  if (path === "index.html" || (bare !== undefined && pageSet.has(bare))) continue;
  const address = bare ?? `/${path}`;
  files++;
  const policies = policiesOf(headersFor(rules, address)["content-security-policy"] ?? "");
  const strict = policies.some((p) => p.get("default-src")?.join(" ") === "'none'" && scriptSources(p)?.join(" ") === "'none'");
  if (!strict) failures.push(`${address}: not a page, and no header policy gives it default-src 'none' and script-src 'none'`);
}

// The controls, on the first page when it holds its policy: one more inline script, which its policy does not hash;
// its policy moved before its charset; and, for scripts/script-policy.mjs, a style inside SVG whose text opens a comment
// that, as the browser reads it, hides the script after it.
const first = pages[0];
const page = readFileSync(fileOf(first), "utf8");
if (failuresOf(first, page).length === 0) {
  const planted = page.replace("</body>", "<script>window.planted = true;</script></body>");
  if (!failuresOf(first, planted).some((f) => f.includes("does not hash"))) {
    failures.push(`${first} with one more inline script is not reported: the check does not see an unhashed script`);
  }
  const policy = page.slice(page.indexOf(CHARSET) + CHARSET.length).match(/^<meta http-equiv="Content-Security-Policy"[^>]*>/)[0];
  const swapped = page.replace(`${CHARSET}${policy}`, `${policy}${CHARSET}`);
  if (swapped === page || !failuresOf(first, swapped).some((f) => f.includes("is not the head's second element"))) {
    failures.push(`${first} with its policy before its charset is not reported`);
  }
  const svg = page.replace("</body>", "<svg><style><!--</style><script>window.planted = true;</script>--></style></svg></body>");
  let stopped = "";
  try {
    withPolicy(svg, first);
  } catch (error) {
    stopped = error.message;
  }
  if (!stopped.includes('has a <style> inside SVG or MathML whose text holds "<"')) {
    failures.push(`scripts/script-policy.mjs does not stop at ${first} with a style inside SVG that holds "<!--"`);
  }
} else failures.push(`${first} fails the check, so the controls are not run on it`);

if (failures.length > 0) {
  console.log(`${failures.length} failure(s) of the script policy in ${OUT}:`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log(
  `${pages.length} pages: each of their ${scripts} inline scripts is hashed in its page's script policy, which follows ` +
    `the charset, the head's first element, in the first 1,024 bytes, and allows 'self' and those ` +
    `hashes alone; the header policies allow the site's script files and hold frame-ancestors 'none'; each of the ` +
    `${files} other files is given default-src 'none' and script-src 'none'; out/_headers holds ${rules.length} rules ` +
    `of at most ${MAX_LINE} characters a line; a planted script and a policy before the charset are reported, and ` +
    `the writer stops at a style inside SVG that holds "<"`,
);
