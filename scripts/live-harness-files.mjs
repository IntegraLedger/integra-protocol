/**
 * Which test files are LIVE RAIL HARNESSES — one definition, because two would drift.
 *
 * ⛔⛔ **THIS EXACT PREDICATE HAS ALREADY BEEN WRONG ONCE, AND `live-rails.mjs` RECORDS IT:** the glob was
 * `integration.onchain.test.ts`, and `binding-canton` and `binding-canton-x402` name theirs
 * `integration.canton.test.ts`, so both were omitted and a plan was built on the short count. ⇒ The rule
 * is **`integration*.test.ts`, whatever it is called** — a prefix, never a spelling.
 *
 * ⭐ **WHY IT MOVED HERE RATHER THAN BEING RESTATED.** `check:hermetic-tests` needs the same answer for the
 * opposite reason: a live harness reaches a real network by design and must be OUTSIDE the hermeticity
 * subject set, while every other test must be inside it. Two copies of one judgement is how one of them
 * goes stale — and the cost is asymmetric and silent: if this predicate drifts wider than
 * `live-rails.mjs`'s, a real test stops being swept; if narrower, a harness reds for doing its job.
 *
 * ⚠️ **What this does NOT decide.** Whether a harness is *legitimately* live — env-gated, skipping loud
 * rather than faking — is a separate question `live-rails.mjs` answers with `describe.skip` and an env
 * read. This module answers only *"is this file a rail harness"*, from its name and its location.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Is this bare filename a live rail harness?
 *
 * @param {string} name a filename, not a path.
 * @returns {boolean}
 */
export function isLiveHarnessFile(name) {
  return name.startsWith("integration") && name.endsWith(".test.ts");
}

/**
 * Every live harness directly inside one package's `test/`.
 *
 * @param {string} packagesDir the `packages` directory.
 * @param {string} pkgDir the package directory name.
 * @returns {string[]} absolute paths.
 */
export function harnessFilesIn(packagesDir, pkgDir) {
  const testDir = join(packagesDir, pkgDir, "test");
  if (!existsSync(testDir)) return [];
  return readdirSync(testDir)
    .filter((f) => isLiveHarnessFile(f))
    .map((f) => join(testDir, f));
}
