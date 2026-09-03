#!/usr/bin/env node
/**
 * Run the publish-integrity gates (publint + attw) over exactly the packages that GET PUBLISHED.
 *
 * THE RULE IS `private`, NOT A NAME. Both gates inspect a package's published type/export surface, so a
 * private package — which has no such surface, and typically no `exports` and no `dist` at all — fails them
 * BY DESIGN. CI used to encode that as a name-pattern filter, which was correct only while one particular
 * package happened to be the only private one in the workspace. It stopped being correct the moment
 * a second private package existed. The first was a short-lived release-tooling spike, since deleted; the
 * one that remains is `rail-invariants` (test-only, holds the cross-rail invariants that need
 * every binding imported at once) turned CI red on a `💀 Resolution failed` the day it was added, and the
 * failure said nothing about the actual rule it had tripped.
 *
 * Deriving the list from `private` means the next private package is covered the day it is created, by
 * someone who never has to read this file. A name pattern cannot do that — it can only be updated after it
 * has already broken the build.
 *
 * Note this gate does NOT run inside `pnpm verify` (it needs the packed tarballs), so a green local verify
 * is not evidence it passes. That asymmetry is why the rule has to be self-maintaining rather than
 * remembered.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packagesDir = join(root, "packages");

const publishable = [];
const skipped = [];
for (const entry of readdirSync(packagesDir).sort()) {
  const manifestPath = join(packagesDir, entry, "package.json");
  if (
    !statSync(join(packagesDir, entry), {
      throwIfNoEntry: false,
    })?.isDirectory()
  )
    continue;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    // ⛔ ENOENT is "not a package directory" and is the only quiet case. A manifest that EXISTS and will
    // not parse is a package nobody can classify, and the old blanket `continue` classified it as absent —
    // so a stray comma removed a package from the publishable set and this gate reported the smaller set
    // as clean. The same collapse lived in `release.yml`'s packing loop.
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") continue;
    console.error(
      `publish-integrity: ${manifestPath} exists and cannot be parsed (${err.message}). ` +
        "Refusing: a package whose manifest is unreadable is not a package that is private.",
    );
    process.exit(1);
  }
  (manifest.private === true ? skipped : publishable).push(manifest.name);
}

if (publishable.length === 0) {
  console.error(
    "publish-integrity: no publishable packages found — refusing to pass vacuously",
  );
  process.exit(1);
}

console.log(`publish-integrity: ${publishable.length} publishable package(s)`);
if (skipped.length > 0)
  console.log(
    `  skipped (private, no published surface): ${skipped.join(", ")}`,
  );

const filters = publishable.flatMap((name) => ["--filter", name]);
for (const [label, argv] of [
  ["publint", ["exec", "publint"]],
  ["attw", ["exec", "attw", "--pack", ".", "--profile", "esm-only"]],
]) {
  console.log(`\npublish-integrity: ${label}`);
  // Fails LOUD: execFileSync throws on a non-zero exit, which propagates as this script's exit code.
  execFileSync("pnpm", [...filters, ...argv], { cwd: root, stdio: "inherit" });
}
