#!/usr/bin/env node
/**
 * Refuse a publishable package sitting at `0.0.0`. Runs FIRST in `pnpm verify`, before the build, because
 * it costs milliseconds and the thing it prevents is not recoverable.
 *
 * THIS IS NOT HYGIENE. The release path publishes whatever version each `package.json` carries, for every
 * package absent from the registry at that version — `release.yml` stages the packed set on every push to
 * main. A package scaffolded at the changesets "never released" sentinel therefore goes out as `0.0.0`,
 * a REAL version, before `changeset version` has ever run and without anyone deciding to release it.
 * Staging now interposes a human approval, which makes it recoverable — but only if someone NOTICES a
 * `0.0.0` in the approval list, and a guard that relies on being noticed is not a guard.
 *
 * It happened twelve times. Every package in one batch of first-time publishes carried a stray `0.0.0`
 * beside its real `0.1.0`, because scaffolding had published before versioning ever ran; the count
 * equalled the number of first-time packages, not the two that happened to get noticed. `placement-acp`
 * is the control that proves the cause: it never had a stray, and not because its earlier publish was
 * deliberate — it too went out on a plain push with `changeset version` unrun — but because it was
 * scaffolded at `"version": "0.1.0"` while the twelve were scaffolded at `"0.0.0"`.
 *
 * Cleaning up afterwards is worse than it sounds: deleting a package's SOLE registry version deletes the
 * package and BURNS THE NAME, so a stray cannot be removed until a real version sits beside it, and the git
 * tag it created has to be swept separately because deleting a registry version does not touch its tag.
 *
 * The rule this enforces used to live only in prose, which is exactly how it failed to prevent eleven
 * recurrences after the first.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const SENTINEL = "0.0.0";

const offenders = [];
const provenanceGaps = [];
for (const dir of readdirSync(`${root}/packages`)) {
  const manifest = `${root}/packages/${dir}/package.json`;
  // A stray file in packages/ must not crash the gate that every verify now depends on.
  if (!statSync(`${root}/packages/${dir}`).isDirectory()) continue;
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  // Private packages never reach a registry, so the sentinel is harmless there and stays allowed.
  if (pkg.private === true) continue;
  if (typeof pkg.version !== "string" || pkg.version.length === 0)
    offenders.push([dir, "declares no version at all"]);
  else if (pkg.version === SENTINEL)
    offenders.push([dir, `is publishable and sits at ${SENTINEL}`]);
  // The provenance triple. `repository` alone is not enough: npm renders `bugs` and `homepage` on every
  // package page, and a published package without them gives a reader no route from the artifact back to
  // where it is developed or where to report a problem. All three are derivable from each other, which is
  // exactly why one can go missing on a new package without anyone noticing — so the gate names them.
  for (const field of ["repository", "bugs", "homepage"])
    if (pkg[field] === undefined) provenanceGaps.push([dir, field]);
}

if (offenders.length > 0) {
  const lines = offenders.map(([dir, why]) => `  - packages/${dir} ${why}`);
  console.error(
    `\nRefusing to verify: ${offenders.length} publishable package(s) would publish a version nobody chose.\n\n${lines.join("\n")}\n\n` +
      `The release path stages every packed version absent from the registry, on every push to main — so\n` +
      `${SENTINEL} would reach the approval queue as a real, installable version before \`changeset version\`\n` +
      `has ever run. Scaffold a new package at 0.1.0 and let changesets take it from there.\n\n` +
      `This is not reversible in place: deleting a package's only registry version burns the name.\n`,
  );
  process.exit(1);
}

if (provenanceGaps.length > 0) {
  const lines = provenanceGaps.map(([dir, f]) => `  - packages/${dir} has no \`${f}\``);
  console.error(
    `\nRefusing to verify: ${provenanceGaps.length} missing provenance field(s) on publishable packages.\n\n${lines.join("\n")}\n\n` +
      `npm renders \`bugs\` and \`homepage\` on the package page, so a consumer who finds the tarball and\n` +
      `nothing else has no route back to the source or to a way to report a problem. Derive them from\n` +
      `\`repository\`: bugs -> <repo>/issues, homepage -> <repo>/tree/main/<directory>#readme.\n`,
  );
  process.exit(1);
}

console.log(
  `check:versions — no publishable package is at the changesets sentinel; all carry repository, bugs and homepage.`,
);
