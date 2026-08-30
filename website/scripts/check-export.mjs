#!/usr/bin/env node
/**
 * The export carries what the site promises.
 *
 * ⛔ A GREEN `next build` PROVES THE EXPORT COMPILED, NOT THAT IT CARRIES ANYTHING. Every
 * assertion here is over the bytes in `out/`, because that is the artifact a reader gets.
 *
 * This is one node script rather than the inline shell the agentic-terms site runs, for one
 * reason: the package-page assertion has to read `packages/*&#47;package.json` and derive the
 * published set from the `private` field, which is not a thing to write in bash. Being a script
 * also means it runs locally, exactly as CI runs it — `npm run check:export`.
 *
 * ⛔ IT DOES NOT IMPORT `scripts/public-packages.mjs`. The generator derives the page set from
 * that module; a check that shared it could only ever agree with it, and would pass over a set
 * the module had silently shrunk. This reads the manifests itself, and that independence is the
 * whole value of the check.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WEBSITE = process.cwd();
const OUT = join(WEBSITE, "out");
const PACKAGES = join(WEBSITE, "..", "packages");

/** The canonical origin, spelled out. This gate exists to fail if it ever moves without
 *  the site's single source (src/lib/site.ts) moving with it. */
const ORIGIN = "https://lcp-packages.integraledger.com";

const failures = [];
const fail = (message) => failures.push(message);

const read = (relativePath) => readFileSync(join(OUT, relativePath), "utf8");

/** A file in the export that must exist and must not be empty. */
function present(relativePath) {
  const path = join(OUT, relativePath);
  if (!existsSync(path)) {
    fail(`missing out/${relativePath}`);
    return false;
  }
  if (statSync(path).size === 0) {
    fail(`empty out/${relativePath}`);
    return false;
  }
  return true;
}

if (!existsSync(OUT)) {
  console.error(`No export at ${OUT}. Run \`npm run build\` first.`);
  process.exit(1);
}

/* ---------- 1. The files the site promises ---------- */

for (const file of [
  "index.html",
  "404.html",
  "sitemap.xml",
  "robots.txt",
  "llms.txt",
  "llms-full.txt",
  "manifest.webmanifest",
  "icon.svg",
  "apple-icon",
  "opengraph-image",
  "api/search",
  "_headers",
  ".well-known/security.txt",
]) {
  present(file);
}

/* ---------- 1b. Static files that restate the host must agree with it ----------
 *
 * `src/lib/site.ts` is the single source of truth for the origin, and every generated URL derives
 * from it. `public/.well-known/security.txt` is a plain static file that cannot import it, so it
 * spells the host out a second time — the one place on this site that does. RFC 9116 says a
 * `Canonical` naming a URL the document is not served at makes the file invalid, and a reporter
 * who follows it lands nowhere. Nothing else would notice, so this does. */

const securityTxt = read(".well-known/security.txt");
const canonical = /^Canonical:\s*(\S+)\s*$/m.exec(securityTxt)?.[1];
if (canonical !== `${ORIGIN}/.well-known/security.txt`)
  fail(
    `.well-known/security.txt declares Canonical ${canonical ?? "(none)"}, but this site is served ` +
      `at ${ORIGIN}. It restates the host that src/lib/site.ts owns; move them together.`,
  );

/* ---------- 2. A page per published package, and no page for a private one ----------
 *
 * The subject set is the manifests' `private` field. NOT a name pattern:
 * `@integraledger/lcp-rail-invariants` is private and test-only, it matches every name pattern
 * the published packages match, and AGENTS.md records that a name-pattern filter has broken
 * twice in this repository. NOT a list written here either — a list goes stale the next time a
 * package lands, and it goes stale silently. */

const published = [];
const privateDirs = [];
for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = join(PACKAGES, entry.name, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  (manifest.private === true ? privateDirs : published).push({
    dir: entry.name,
    name: manifest.name,
  });
}

if (published.length === 0) {
  fail(
    "read zero published packages from packages/*/package.json — this check has no subject, " +
      "so every assertion below it would pass over nothing",
  );
}

for (const pkg of published) {
  const page = `packages/${pkg.dir}.html`;
  if (!present(page)) continue;
  const html = read(page);
  if (!html.includes(pkg.name))
    fail(
      `out/${page} never names ${pkg.name} — it is rendering the wrong package`,
    );
  if (!html.includes(`rel="canonical" href="${ORIGIN}/packages/${pkg.dir}"`))
    fail(`out/${page} carries no canonical at ${ORIGIN}/packages/${pkg.dir}`);
  present(`md/packages/${pkg.dir}.md`);
}

for (const pkg of privateDirs) {
  if (existsSync(join(OUT, `packages/${pkg.dir}.html`)))
    fail(
      `out/packages/${pkg.dir}.html exists, but ${pkg.name} is \`private: true\` and is not ` +
        `published — it must not be documented as though a reader could install it`,
    );
}

const pageFiles = existsSync(join(OUT, "packages"))
  ? readdirSync(join(OUT, "packages")).filter((f) => f.endsWith(".html"))
  : [];
if (pageFiles.length !== published.length)
  fail(
    `out/packages/ carries ${pageFiles.length} page(s) for ${published.length} published ` +
      `package(s): ${pageFiles
        .map((f) => f.replace(/\.html$/, ""))
        .sort()
        .join(", ")}`,
  );

/* ---------- 3. The export reaches no other origin at runtime, fonts included ---------- */

const fontHost = /https?:\/\/fonts\.(googleapis|gstatic)\.com/;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(html|css|js|txt|json|webmanifest|xml)$/.test(entry.name)) {
      if (fontHost.test(readFileSync(path, "utf8")))
        fail(`third-party font request in ${path.slice(OUT.length + 1)}`);
    }
  }
};
walk(OUT);

/* ---------- 4. Every URL is dated by a commit, not by the build clock ----------
 *
 * The dates come from git, and a package page is dated by the README it renders rather than by
 * its own generated file. When that mapping is wrong every page loses its date and the build
 * stays green: the first version of `source.config.ts` keyed the map on a relative path while
 * fumadocs hands it an absolute one, and all thirty-two `<lastmod>` elements vanished without
 * an error. A shallow clone does the same thing, which is why the CI job sets `fetch-depth: 0`. */

const sitemap = read("sitemap.xml");
const urlCount = (sitemap.match(/<url>/g) ?? []).length;
const lastmodCount = (sitemap.match(/<lastmod>/g) ?? []).length;
if (urlCount !== published.length + 1)
  fail(
    `sitemap carries ${urlCount} URL(s); expected ${published.length + 1} ` +
      `(one per published package, plus the overview)`,
  );
if (lastmodCount !== urlCount)
  fail(
    `sitemap carries ${lastmodCount} <lastmod> for ${urlCount} URL(s). Every page is dated by ` +
      `the last commit that changed its source; a missing date means that lookup silently ` +
      `matched nothing, or the clone is shallow.`,
  );
if (!sitemap.includes(`<loc>${ORIGIN}</loc>`))
  fail(`sitemap does not carry ${ORIGIN} as the overview URL`);

/* ---------- 5. Every URL a machine is handed must resolve in this export ----------
 *
 * Found the hard way. Every package page shipped a BreadcrumbList whose middle item pointed at
 * `/packages` — a URL that exists in no sitemap and no export, because the package pages are
 * reached through a `...packages` expansion rather than a folder index. Thirty-one pages, each
 * telling a crawler to follow a link to a 404, and every other gate green: the HTML was valid,
 * the JSON-LD was valid, and the URL was well-formed. Only resolving it against the export
 * catches that. This checks the URLs nothing else does — the ones a machine follows without a
 * person ever seeing them. */

/**
 * `https://origin/a/b` -> the file the export serves for it, or undefined if it serves none.
 *
 * ⛔ `isFile()`, NOT `existsSync`. `/packages` is a DIRECTORY in the export and `existsSync`
 * says yes to a directory, so the first version of this check reported "126 internal URLs all
 * resolve" while the very defect it was written to catch was reintroduced and present on all
 * thirty-one pages. A directory is not a page: Cloudflare Pages serves nothing at `/packages`
 * unless a `packages.html` or `packages/index.html` exists, and neither does.
 */
function exportTarget(url) {
  if (!url.startsWith(ORIGIN)) return undefined; // external by design; not ours to resolve
  const path = url.slice(ORIGIN.length) || "/";
  for (const candidate of [
    path === "/" ? "index.html" : `${path.slice(1)}.html`,
    path.slice(1),
    `${path.slice(1)}/index.html`,
  ]) {
    if (!candidate) continue;
    const file = join(OUT, candidate);
    if (existsSync(file) && statSync(file).isFile()) return candidate;
  }
  return undefined;
}

const htmlPages = [];
const collectHtml = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectHtml(path);
    else if (entry.name.endsWith(".html")) htmlPages.push(path);
  }
};
collectHtml(OUT);

let internalUrls = 0;
for (const path of htmlPages) {
  const html = readFileSync(path, "utf8");
  const where = path.slice(OUT.length + 1);
  for (const block of html.matchAll(
    /<script type="application\/ld\+json">(.*?)<\/script>/gs,
  )) {
    let data;
    try {
      data = JSON.parse(block[1].replaceAll("\\u003c", "<"));
    } catch (error) {
      fail(
        `out/${where} carries JSON-LD that does not parse: ${error.message}`,
      );
      continue;
    }
    for (const item of data["@type"] === "BreadcrumbList"
      ? (data.itemListElement ?? [])
      : []) {
      if (typeof item.item !== "string") continue;
      internalUrls += 1;
      if (item.item.startsWith(ORIGIN) && !exportTarget(item.item))
        fail(
          `out/${where} has a breadcrumb pointing at ${item.item}, which this export does not serve`,
        );
    }
  }
}

for (const loc of read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)) {
  internalUrls += 1;
  if (!exportTarget(loc[1]))
    fail(`the sitemap lists ${loc[1]}, which this export does not serve`);
}

if (internalUrls === 0)
  fail(
    "found no internal URLs to resolve at all — this check had no subject, so it proved nothing",
  );

/* ---------- 6. The Markdown exports must be Markdown ---------- */

const llmsFull = read("llms-full.txt");
if (/&#x[0-9A-Fa-f]+;/.test(llmsFull))
  fail(
    "HTML entities in llms-full.txt — the stringifier's escapes reached the export",
  );
const leakedTag = /^\s*<\/?[A-Z]/m.exec(llmsFull);
if (leakedTag)
  fail(
    `component tag in llms-full.txt (${leakedTag[0].trim()}) — a reader outside this site ` +
      `cannot resolve it`,
  );
if (!read("llms.txt").includes(`${ORIGIN}/llms-full.txt`))
  fail("llms.txt does not point at llms-full.txt on the canonical origin");

/* ---------- 7. Source-side: no TypeScript this repository does not compile ----------
 *
 * `pnpm check:docs` extracts and typechecks every column-0 `ts` fence in `docs/`, the root
 * README and every package README. It does NOT walk `website/content/`, so a TypeScript fence
 * in an authored page here would be the one snippet on the site that nothing compiles — and
 * teaching an integrator to write code that does not compile is the exact failure that gate
 * exists to prevent. The generated package pages are exempt: their fences are the READMEs'
 * fences and are already checked at their source. */

const authored = join(WEBSITE, "content", "docs");
const authoredWalk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== "packages") authoredWalk(join(dir, entry.name));
      continue;
    }
    if (!/\.mdx?$/.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const fence = /^`{3,}\s*(ts|typescript)\b/m.exec(
      readFileSync(path, "utf8"),
    );
    if (fence)
      fail(
        `${path.slice(WEBSITE.length + 1)} opens a \`${fence[1]}\` fence. Nothing typechecks ` +
          `TypeScript written on this site: \`pnpm check:docs\` walks docs/ and the package ` +
          `READMEs, not website/content/. Put the snippet where the gate can see it, or widen ` +
          `scripts/check-doc-snippets.mjs to reach here.`,
      );
  }
};
if (existsSync(authored)) authoredWalk(authored);

/* ---------- verdict ---------- */

if (failures.length > 0) {
  console.error(
    `\ncheck:export — ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
  );
  process.exit(1);
}

console.log(
  `check:export — ${published.length} published package(s), one page each; ` +
    `${urlCount} sitemap URL(s) all dated; ${internalUrls} internal URL(s) all resolve; ` +
    `no third-party origin in the export.`,
);
