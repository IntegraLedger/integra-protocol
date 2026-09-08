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

const LOCKFILE = "pnpm-lock.yaml";

let output;
let status = 0;
try {
  output = execFileSync(
    "osv-scanner",
    ["scan", "source", "--lockfile", LOCKFILE],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
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
  output = String(error?.stdout ?? "") + String(error?.stderr ?? "");
  status = typeof error?.status === "number" ? error.status : 1;
}

/**
 * The scanner\'s own inventory line: "Scanned <path> file and found N packages". It is the only statement
 * in the run that distinguishes "nothing is wrong" from "nothing was read".
 */
const inventory = /found (\d+) packages/.exec(output);
const scanned = inventory === null ? 0 : Number(inventory[1]);

if (scanned === 0) {
  console.error(
    "\nRefusing to verify: check:advisories -- the scan resolved NO packages from " +
      LOCKFILE +
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
      " package(s).\n\n" +
      "Fix them, or declare one in `osv-scanner.toml` with a `reason` and an `ignoreUntil`. An exemption\n" +
      "with no expiry is a suppression; the date is what forces the decision to be made again.\n",
  );
  process.exit(1);
}

console.log(
  "check:advisories -- osv-scanner over " +
    String(scanned) +
    " package(s) from " +
    LOCKFILE +
    ", no known vulnerabilities.",
);
