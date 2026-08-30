#!/usr/bin/env node
/**
 * Write one documentation page per published package, from that package's own README.
 *
 * ⛔ THE README IS THE DOCUMENTATION. This script does not author, summarize or restate it —
 * it renders it. `pnpm check:docs` compiles the 54 TypeScript fences in those READMEs against
 * the built workspace on every verify, and a hand-written second copy on this site would be the
 * one copy no gate compiles, so it would be the copy that goes stale. The output of this script
 * is gitignored for the same reason: exactly one tracked copy of each README exists, in the
 * package that ships it.
 *
 * Runs from npm's `prebuild` / `predev`, so a build always renders the tree as it is now.
 *
 * The files are written as `.md`, not `.mdx`, deliberately: fumadocs-mdx compiles `.md` in
 * CommonMark mode, where `<` and `{` are ordinary characters. A README is written for npm and
 * GitHub and has never had to be valid JSX.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { GROUPS, publicPackages, repoRoot } from "./public-packages.mjs";

const OUT = join(process.cwd(), "content", "docs", "packages");

/** YAML-safe scalar. JSON is a subset of YAML, so a JSON string is always a valid one. */
const yaml = (value) => JSON.stringify(value);

/**
 * Rewrite a README's sibling links into this site's URL space.
 *
 * The READMEs link to each other as `](../binding-core#readme)`, which is what resolves on npm
 * and on GitHub. Left alone, all 53 of them 404 here. The target is the same package either
 * way, so this is an address change and not a content change.
 *
 * A relative link to something this site does not publish is a hard error: silently emitting a
 * dead link is how a reader learns the site is unreliable, and there is no correct fallback —
 * the page genuinely does not exist.
 */
function rewriteSiblingLinks(body, slugs, readmePath) {
  return body.replace(
    /\]\(\.\.\/([A-Za-z0-9._-]+)(#[A-Za-z0-9-]*)?\)/g,
    (match, dir) => {
      if (!slugs.has(dir)) {
        throw new Error(
          `${readmePath} links to ${match} — packages/${dir} is not a documented package, so ` +
            `that link has no page on this site. Point it at a URL, or document the package.`,
        );
      }
      return `](/packages/${dir})`;
    },
  );
}

/**
 * Drop the README's own H1.
 *
 * Every page renders its title through the docs shell already, so keeping the H1 would print
 * the package name twice and put a duplicate entry at the top of every table of contents. Only
 * a leading H1 is touched; everything below the first blank line is the README verbatim.
 */
function stripLeadingH1(body) {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    lines.splice(0, i + 1);
    while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  }
  return lines.join("\n");
}

const packages = publicPackages();
const slugs = new Set(packages.map((p) => p.dir));

// Rewritten from scratch every run: a package that stopped being published must not leave its
// page behind, and a stale page in a gitignored directory is invisible to every other check.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const pkg of packages) {
  const readme = readFileSync(join(repoRoot, pkg.readmePath), "utf8");
  const body = rewriteSiblingLinks(
    stripLeadingH1(readme),
    slugs,
    pkg.readmePath,
  );

  const frontmatter = [
    "---",
    `title: ${yaml(pkg.name)}`,
    `description: ${yaml(pkg.description)}`,
    "---",
    "",
  ].join("\n");

  writeFileSync(join(OUT, `${pkg.dir}.md`), `${frontmatter}${body.trim()}\n`);
}

// The sidebar for the section, in the order public-packages.mjs establishes, with each group's
// heading as a separator. Generated with the pages so the two can never disagree.
const pages = [];
let group;
for (const pkg of packages) {
  if (pkg.group !== group) {
    group = pkg.group;
    const title = GROUPS.find((g) => g.id === group)?.title;
    if (title === undefined)
      throw new Error(`package group ${group} has no entry in GROUPS`);
    pages.push(`---${title}---`);
  }
  pages.push(pkg.dir);
}

writeFileSync(
  join(OUT, "meta.json"),
  `${JSON.stringify({ title: "Packages", pages }, null, 2)}\n`,
);

if (!existsSync(join(OUT, "meta.json")))
  throw new Error("generate-package-pages wrote no meta.json");

console.log(
  `generate-package-pages — ${packages.length} page(s) from packages/*/README.md ` +
    `(${GROUPS.map((g) => `${g.title.toLowerCase()} ${packages.filter((p) => p.group === g.id).length}`).join(", ")})`,
);
