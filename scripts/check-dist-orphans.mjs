#!/usr/bin/env node
/**
 * No `dist/` file may outlive the `src/` file it was built from.
 *
 * `tsc` never removes output for a source that has been deleted or renamed, and `dist/` is gitignored, so
 * an orphan is invisible to every review and survives every incremental build. It is not invisible to a
 * CONSUMER: `files` ships `dist` and `src` together, so an orphan travels in the tarball with a source map
 * whose `sources` entry points at a path that is not there.
 *
 * Measured on 2026-08-09, in a rehearsal install of all 31 packed tarballs on Node 24 and 26: 330 source
 * maps, **4 of them dangling** — `binding-canton/dist/memo.*` (its `src/memo.ts` left with the x402 rail
 * split) and `binding-evm-x402/dist/permit2-filter.*` (renamed to `asset-transfer-method-filter.ts`).
 * Neither orphan is reachable from `dist/index.js`, so nothing failed and nothing would have.
 *
 * This is the surviving half of the 2026-08-07 audit's S-1. The other half — maps resolving at all — closed
 * when `files` gained `src`. Packing `src` is what turned a stale build artifact into a shipped one.
 *
 * `--clean` deletes every `dist/`, which is the fix; with no flag this reports and exits non-zero, which is
 * the gate. It runs AFTER build in `pnpm verify`, because before the build there is nothing to check.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const PACKAGES = join(root, "packages");

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir, prefix = "", acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) filesUnder(p, `${prefix}${entry}/`, acc);
    else acc.push(`${prefix}${entry}`);
  }
  return acc;
}

const clean = process.argv.includes("--clean");
const orphans = [];
let checked = 0;
let packages = 0;

for (const pkg of readdirSync(PACKAGES).sort()) {
  const dist = join(PACKAGES, pkg, "dist");
  const src = join(PACKAGES, pkg, "src");
  if (!existsSync(dist)) continue;
  if (clean) {
    rmSync(dist, { recursive: true, force: true });
    packages++;
    continue;
  }
  if (!existsSync(src)) continue;
  packages++;
  const sources = new Set(filesUnder(src));
  for (const out of filesUnder(dist)) {
    // `dist/x.js`, `dist/x.d.ts`, `dist/x.js.map`, `dist/x.d.ts.map` all trace to `src/x.ts`.
    const stem = out.replace(/\.(js|d\.ts)(\.map)?$/, "");
    if (stem === out) continue; // not a tsc output — `conformance`'s packed vectors, say
    checked++;
    if (!sources.has(`${stem}.ts`)) orphans.push(`packages/${pkg}/dist/${out}`);
  }
}

if (clean) {
  console.log(
    `cleaned dist/ in ${packages} package(s) — run \`pnpm -r build\` to rebuild.`,
  );
  process.exit(0);
}

if (orphans.length > 0) {
  console.error(
    `\nRefusing to verify: ${orphans.length} build output(s) whose source no longer exists.\n\n` +
      `${orphans.map((o) => `  - ${relative(root, join(root, o))}`).join("\n")}\n\n` +
      `\`tsc\` does not remove output for a deleted or renamed source, and \`dist/\` is gitignored, so this\n` +
      `is invisible until it ships: \`files\` packs dist AND src, so an orphan travels with a source map\n` +
      `pointing at a path the tarball does not contain.\n\n` +
      `Fix: \`pnpm clean && pnpm -r build\`.\n`,
  );
  process.exit(1);
}

console.log(
  `check:dist — ${checked} build outputs across ${packages} packages, every one tracing to a live src/ file.`,
);
