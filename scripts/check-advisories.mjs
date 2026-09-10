/**
 * KNOWN VULNERABILITIES, SCANNED BY osv-scanner, WITH EXEMPTIONS THAT CARRY A REASON AND AN EXPIRY.
 *
 * This replaced `pnpm audit`, and the reason is not coverage alone. A scanner is only half of what a
 * repository needs; the other half is a way to say "reviewed, here is why, ask again on this date". pnpm
 * offers `--ignore <GHSA>` and `auditConfig.ignoreGhsas`, and neither carries a reason, an owner or an
 * expiry -- they SUPPRESS a finding rather than DECLARE one, and a suppression with no expiry outlives
 * everyone who understood it. `osv-scanner.toml` carries `reason` and `ignoreUntil` natively, so the
 * declaration is the tool\'s own format rather than something bespoke wrapped around it.
 *
 * It also resolves an alias problem a hand-rolled gate gets wrong. osv-scanner ignores the aliases of an
 * ignored vulnerability, so a declaration keyed on a GHSA still holds when the same advisory arrives as a
 * CVE. A gate keying on one id would let the same vulnerability back through under another name.
 *
 * WHAT THIS WRAPPER ADDS, and it is one thing. osv-scanner exits 0 when it finds nothing -- including when
 * it resolved NOTHING AT ALL. Measured while adopting it: an invocation that read no packages exited 0 and
 * printed a clean report, which is this repository\'s oldest failure wearing a new tool\'s colours. The
 * scan therefore has to say how many packages it inventoried, and a run that inventoried none is refused
 * rather than believed. Everything else -- severity, aliases, the exemption format -- is the scanner\'s.
 *
 * REFUSES RATHER THAN SKIPS when the binary is absent, for the reason every gate here does: a check that
 * quietly does not run is worse than one that fails, because only one of them is visible.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * ⛔⛔ **EVERY LOCKFILE IN THE TREE, DISCOVERED — NOT ONE NAMED HERE.** This gate read a single hardcoded
 * `pnpm-lock.yaml` for its whole life, and `website/` ships a **`package-lock.json`** of its own: 399
 * packages, the public documentation site, outside the gate entirely. They were clean the day it was
 * measured (2026-09-10), which is exactly why it went unnoticed — nothing about a hardcoded subject set
 * announces the day something arrives outside it.
 *
 * ⇒ Discovery rather than a list, and the difference is the whole point. A declared roster of lockfiles
 * would have to be updated by whoever adds the next one, which is the same person who did not think about
 * this gate. A walk covers it the day it lands, and cannot silently narrow: if the walk finds nothing, that
 * is refused below as loudly as a vulnerability, because a tree with no lockfile is a broken walk and not a
 * clean repository.
 */
const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "npm-shrinkwrap.json",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "reports",
  ".stryker-tmp",
]);

/**
 * ⛔⛔ **AND THE ROSTER OF SUBMODULES COMES FROM `.gitmodules`, NOT FROM WHAT IS ON DISK** — which is the
 * half of "discovery" that was wrong. A walk covers whatever is checked out, and what is checked out is
 * NOT the same here as in CI: `ci.yml` uses `actions/checkout` with no `submodules:` key, so a runner
 * never fetches `lib/commerce-payments` and never sees the four vendored lockfiles under it. Locally they
 * are present, and one of them — permit2's copy of openzeppelin-contracts — carries 1208 packages of
 * OpenZeppelin's own JS dev tooling, red with advisories nobody in this repository can fix.
 *
 * So the gate that says a walk "cannot silently narrow" was narrowing, in the one place it mattered: CI
 * scanned a SMALLER subject set than the tree contains, and the zero-lockfile guard below never fires
 * because two lockfiles are still found. A green run meant "green over whatever git happened to fetch".
 *
 * ⇒ Skipped BY NAME and SAID OUT LOUD. A submodule is another repository's dependency graph, pinned by
 * commit and governed by that repository's own gate; this one consumes Solidity sources from it and never
 * installs, builds or publishes its npm tree, so those advisories are unreachable from anything shipped
 * here. Declaring ~50 third-party dev-dependency exemptions in `osv-scanner.toml` would record that as
 * this repository's decision, which it is not.
 *
 * The roster is TRACKED, so the subject set is now identical in both places rather than a function of
 * fetch depth — and the skip is printed, because a subject set that shrinks in silence is the failure
 * this gate exists to prevent.
 */
const declaredSubmodules = () => {
  try {
    return [
      ...readFileSync(".gitmodules", "utf8").matchAll(
        /^\s*path\s*=\s*(\S.*?)\s*$/gm,
      ),
    ].map((m) => m[1]);
  } catch {
    return [];
  }
};
const SUBMODULES = new Set(declaredSubmodules());

const findLockfiles = (dir) => {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // `.gitmodules` writes paths with forward slashes whatever the platform separator is.
      if (SUBMODULES.has(relative(process.cwd(), path).split(sep).join("/")))
        continue;
      found.push(...findLockfiles(path));
    } else if (LOCKFILE_NAMES.has(entry.name))
      found.push(relative(process.cwd(), path));
  }
  return found;
};

const lockfiles = findLockfiles(process.cwd()).sort();

if (lockfiles.length === 0) {
  console.error(
    "\nRefusing to verify: check:advisories -- the walk found NO lockfile anywhere in this tree.\n\n" +
      "This gate takes its subject set from that walk, so an empty one is not a repository with no\n" +
      "dependencies — it is this gate running over nothing, which is the failure it exists to prevent.\n",
  );
  process.exit(1);
}

/** Scan one lockfile. Returns the scanner's raw output and its exit status. */
const scan = (lockfile) => {
  try {
    return {
      output: execFileSync(
        "osv-scanner",
        ["scan", "source", "--lockfile", lockfile],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
      status: 0,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.error(
        "\nRefusing to verify: check:advisories -- osv-scanner is not on the PATH.\n\n" +
          "It is the vulnerability gate, and a gate that is skipped because a tool is missing is a gate that\n" +
          "reports clean on the day it matters. Install it (https://google.github.io/osv-scanner/) or run\n" +
          "`pnpm verify` somewhere that has it; CI installs a pinned build by checksum.\n",
      );
      process.exit(1);
    }
    return {
      output: String(error?.stdout ?? "") + String(error?.stderr ?? ""),
      status: typeof error?.status === "number" ? error.status : 1,
    };
  }
};

const inventories = [];
for (const lockfile of lockfiles) {
  const { output, status } = scan(lockfile);

  /**
   * The scanner's own inventory line: "Scanned <path> file and found N packages". It is the only statement
   * in the run that distinguishes "nothing is wrong" from "nothing was read".
   */
  const inventory = /found (\d+) packages/.exec(output);
  const scanned = inventory === null ? 0 : Number(inventory[1]);

  // ⛔ PER LOCKFILE, not over the total. A summed count lets a lockfile the scanner silently stopped
  // parsing hide behind a sibling that still resolves — which is the same empty-subject-set failure one
  // level up, and the reason this gate refuses a zero at all.
  if (scanned === 0) {
    console.error(
      "\nRefusing to verify: check:advisories -- the scan resolved NO packages from " +
        lockfile +
        ".\n\n" +
        "osv-scanner exits 0 when it finds no vulnerabilities AND when it read nothing at all, and those are\n" +
        "different facts. A clean report over an empty subject set is the failure this repository has been\n" +
        "bitten by more than any other. Check that the lockfile exists and that the scanner still parses it.\n",
    );
    process.exit(1);
  }

  if (status !== 0) {
    process.stderr.write(output);
    console.error(
      "\nRefusing to verify: check:advisories -- osv-scanner reported vulnerabilities over " +
        String(scanned) +
        " package(s) from " +
        lockfile +
        ".\n\n" +
        "Fix them, or declare one in `osv-scanner.toml` with a `reason` and an `ignoreUntil`. An exemption\n" +
        "with no expiry is a suppression; the date is what forces the decision to be made again.\n",
    );
    process.exit(1);
  }

  inventories.push(`${String(scanned)} from ${lockfile}`);
}

console.log(
  "check:advisories -- osv-scanner over " +
    String(lockfiles.length) +
    " lockfile(s) discovered in this tree (" +
    inventories.join("; ") +
    "), no known vulnerabilities." +
    (SUBMODULES.size === 0
      ? ""
      : " " +
        String(SUBMODULES.size) +
        " declared submodule(s) NOT walked (" +
        [...SUBMODULES].sort().join(", ") +
        "): another repository's dependency graph, held by that repository's own gate. The roster is read " +
        "from `.gitmodules` rather than from disk, so this subject set is the same here as on a runner, " +
        "which fetches no submodule at all."),
);
