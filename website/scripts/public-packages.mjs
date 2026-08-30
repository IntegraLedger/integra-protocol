import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The set of packages this site documents, derived from the workspace.
 *
 * ONE derivation, imported by both readers: `scripts/generate-package-pages.mjs`, which writes
 * a page per package, and `src/lib/packages.ts`, which renders the index and each page's
 * metadata. `scripts/check-export.mjs` deliberately does NOT import it — an export check that
 * shares the generator's idea of the package set can only ever agree with it, and would pass
 * over a set this file had silently shrunk.
 *
 * THE SET IS THE MANIFESTS' `private` FIELD AND NOTHING ELSE. Not a name pattern, and not a
 * list kept here: `@integraledger/lcp-rail-invariants` is `private: true` and test-only, it
 * matches every name pattern the published packages match, and AGENTS.md records that a
 * name-pattern filter has broken twice in this repository already.
 *
 * Both callers run with the working directory set to `website/` — npm sets it for a lifecycle
 * script, and `next build` runs there — so the workspace is one level up. That is asserted
 * rather than assumed, because a wrong root would produce an empty set, and an empty set is a
 * generator that writes no pages and a site that documents nothing, both without an error.
 */

/** Repository root, from the website's working directory. */
export const repoRoot = join(process.cwd(), "..");

const packagesDir = join(repoRoot, "packages");
if (!existsSync(packagesDir)) {
  throw new Error(
    `No packages/ at ${packagesDir}. This module resolves the workspace from process.cwd() ` +
      `(${process.cwd()}), which must be the website/ directory.`,
  );
}

/**
 * Sidebar groups, in the order the site presents them. The membership TEST is a predicate over
 * the directory name, never a list of packages — a new binding or placement joins its group by
 * being named like one.
 *
 * `core` is the exception and is ordered explicitly, because its seven members have a reading
 * order that alphabetical destroys: the kernel everything agrees on, the walk over it, then the
 * pieces the walk consumes. A package matching no group is a hard error rather than a silent
 * append; see `groupOf`.
 */
const CORE_ORDER = [
  "kernel",
  "verify",
  "authority",
  "discovery",
  "evidence",
  "conformance",
  "placements",
];

/** @type {Array<{ id: string, title: string, description: string }>} */
export const GROUPS = [
  {
    id: "core",
    title: "Core",
    description:
      "The record format, the verification walk, and the pieces the walk consumes.",
  },
  {
    id: "placements",
    title: "Placements",
    description:
      "Where an LCP reference rides inside each agentic commerce protocol, and how to read it back.",
  },
  {
    id: "bindings",
    title: "Bindings",
    description:
      "How an ATR hash is welded into a settlement on each rail — plus the two seams the rails share.",
  },
];

/**
 * The group a package directory belongs to.
 * @param {string} dir
 * @returns {string}
 */
function groupOf(dir) {
  if (dir.startsWith("placement-")) return "placements";
  if (dir.startsWith("binding-")) return "bindings";
  if (CORE_ORDER.includes(dir)) return "core";
  throw new Error(
    `packages/${dir} is published but belongs to no sidebar group. Add it to CORE_ORDER in ` +
      `website/scripts/public-packages.mjs, or name it binding-* / placement-*. This refuses ` +
      `rather than appending, so a new package cannot land on the site in an arbitrary place.`,
  );
}

/**
 * @typedef {object} PublicPackage
 * @property {string} dir        directory under packages/, and the page slug
 * @property {string} name       the published package name
 * @property {string} description
 * @property {string} version
 * @property {string} group      one of GROUPS[].id
 * @property {string} readmePath repository-relative path of the README this page renders
 * @property {string} directory  repository-relative path of the package
 */

/**
 * Every published package, in sidebar order.
 * @returns {PublicPackage[]}
 */
export function publicPackages() {
  /** @type {PublicPackage[]} */
  const out = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.private === true) continue;

    const readmePath = `packages/${entry.name}/README.md`;
    if (!existsSync(join(repoRoot, readmePath))) {
      throw new Error(
        `${manifest.name} is published and has no ${readmePath}. Its page renders that file; ` +
          `there is nothing to render and no second copy to fall back to.`,
      );
    }
    for (const field of ["name", "description", "version"]) {
      if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
        throw new Error(
          `packages/${entry.name}/package.json carries no \`${field}\`. The page states it.`,
        );
      }
    }

    out.push({
      dir: entry.name,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      group: groupOf(entry.name),
      readmePath,
      directory: `packages/${entry.name}`,
    });
  }

  if (out.length === 0) {
    throw new Error(
      `No published packages under ${packagesDir}. A site that documents nothing must not build.`,
    );
  }

  const groupRank = new Map(GROUPS.map((g, i) => [g.id, i]));
  return out.sort((a, b) => {
    const byGroup =
      (groupRank.get(a.group) ?? 0) - (groupRank.get(b.group) ?? 0);
    if (byGroup !== 0) return byGroup;
    if (a.group === "core")
      return CORE_ORDER.indexOf(a.dir) - CORE_ORDER.indexOf(b.dir);
    return a.dir.localeCompare(b.dir);
  });
}

/**
 * The one version these packages carry.
 *
 * Every package is in one `fixed` changesets group (`@integraledger/lcp-*` in
 * `.changeset/config.json`), so they move together and one number describes all of them. The
 * agreement is ASSERTED rather than assumed: reading a single manifest would state a version
 * for thirty other packages on the strength of a config file this site never reads, and would
 * go on stating it after the group was split.
 * @param {PublicPackage[]} packages
 * @returns {string}
 */
export function lockstepVersion(packages) {
  const versions = [...new Set(packages.map((p) => p.version))].sort();
  if (versions.length !== 1) {
    const detail = packages.map((p) => `  ${p.name} ${p.version}`).join("\n");
    throw new Error(
      `The published packages are not at one version, so no single number describes them:\n${detail}\n\n` +
        `They are a fixed changesets group and are expected to move together. If that changed, ` +
        `this site has to state a version per package rather than one in the footer.`,
    );
  }
  return versions[0];
}
