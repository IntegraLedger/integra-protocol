#!/usr/bin/env node
/**
 * Run Stryker over one package, or every publishable package with tests.
 *
 * The set is derived from `private` in each manifest — one rule, applied once. A private package has no
 * published surface, so a mutation score on it is a number nobody should act on.
 *
 * There used to be a `p.startsWith("spikes-")` branch above the `private` check, and the way it was
 * REDUNDANT rather than wrong is the part worth keeping: both spike packages were `private: true`, so the
 * line below already excluded them and deleting the branch changed nothing. Two rules encoding one fact is
 * how a filter drifts from what it means — and note this predicate walks DIRECTORY names, not package
 * names, so the 0.9.0 `lcp-*` rename would not have disturbed a name pattern here even though it broke the
 * package-name filters in CI. State the property you mean (`private`), not a spelling that correlates
 * with it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const all = readdirSync(`${root}/packages`).filter((p) => {
  // A stray file in packages/ (a .gitkeep, a .DS_Store) must not crash the enumerate step that CI's
  // matrix depends on — the whole fan-out is `needs:` this script's output.
  if (!statSync(`${root}/packages/${p}`).isDirectory()) return false;
  if (!existsSync(`${root}/packages/${p}/package.json`)) return false;
  const isPrivate = JSON.parse(
    readFileSync(`${root}/packages/${p}/package.json`, "utf8"),
  ).private;
  // A private package legitimately has no mutation obligation. A PUBLISHABLE one with no `test/` used to
  // drop out of the matrix silently — the set would shrink, CI would stay green, and the missing package
  // was indistinguishable from one that never existed. It is the absence that has to be loud: an
  // unmutated published package is the exact thing this fan-out exists to prevent.
  if (!existsSync(`${root}/packages/${p}/test`)) {
    if (isPrivate) return false;
    throw new Error(
      `packages/${p} is publishable but has no test/ directory, so it would silently leave the mutation ` +
        `matrix. Add tests, or mark the package private if it is genuinely not published.`,
    );
  }
  return !isPrivate;
});

const args = process.argv.slice(2);
// `--list` prints the package set as JSON so CI can fan out over it as a matrix instead of running
// every publishable package back-to-back in one job. Keeps the list in ONE place: this script, which
// derives it from `private` rather than from a name pattern or a number written here.
if (args[0] === "--list") {
  console.log(JSON.stringify(all));
  process.exit(0);
}
const targets = args.length > 0 ? args : all;
const unknown = targets.filter((t) => !all.includes(t));
if (unknown.length > 0) {
  console.error(
    `unknown package(s): ${unknown.join(", ")}\nknown: ${all.join(", ")}`,
  );
  process.exit(1);
}

const failed = [];
for (const pkg of targets) {
  console.log(`\n━━━ mutation: ${pkg} ━━━`);
  try {
    execFileSync("npx", ["stryker", "run", "stryker.config.mjs"], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, STRYKER_PKG: pkg },
    });
  } catch {
    failed.push(pkg); // below its ratchet — keep going so one run reports every regression
  }
}
if (failed.length > 0) {
  console.error(`\nBELOW RATCHET: ${failed.join(", ")}`);
  process.exit(1);
}
