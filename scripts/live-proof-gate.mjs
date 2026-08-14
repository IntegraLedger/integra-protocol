#!/usr/bin/env node
/**
 * Refuse to report a live-rail run as green unless it actually ran.
 *
 * **The failure this closes is not hypothetical, and it is silent.** These suites are `describe.skip` when
 * their env is absent, Vitest exits 0 on an all-skipped run, and — unlike the commerce proofs — the
 * protocol harnesses print no skip banner to grep for. Measured on 2026-08-14 against `binding-aptos` with
 * no credentials: the JSON report came back `success: true` with `numPassedTests: 0`. A workflow that
 * trusted the exit code would have certified eleven rails while executing none of them.
 *
 * So the gate reads the run's own structured output rather than its exit code or its log text:
 *
 *   • `numFailedTests === 0`  — the ordinary assertion.
 *   • `numPendingTests === 0` — nothing skipped. A skip here means the gate was FALSE: either a credential
 *     is absent, or one is present and unusable (unfunded wallet, revoked key, expired JWT). Both are
 *     "this rail is not proven", and both must be red.
 *   • `numPassedTests > 0`    — the non-empty floor. Zero passing tests is the shape every silently-empty
 *     gate takes, and it is the one this file exists for.
 *
 * **Why structured output and not a log grep.** A grep for a banner is itself a derived subject set: the
 * banner is a string someone may reword, and on the day it is reworded the guard stops guarding while
 * staying green. Counts cannot be reworded.
 *
 * Usage: node scripts/live-proof-gate.mjs <report.json> <rail-name>
 */
import { readFileSync } from "node:fs";

const [, , reportPath, rail] = process.argv;

if (!reportPath || !rail) {
  console.error(
    "live-proof-gate: usage — node scripts/live-proof-gate.mjs <report.json> <rail-name>",
  );
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (err) {
  // An unreadable report is a failed run, never a passed one: the suite may have crashed before the
  // reporter wrote anything, which is exactly when a permissive gate would wave it through.
  console.error(
    `::error::${rail} — no readable Vitest report at ${reportPath} (${err.message}). ` +
      `Treating as FAILED: a run that produced no report did not prove anything.`,
  );
  process.exit(1);
}

const passed = report.numPassedTests ?? 0;
const failed = report.numFailedTests ?? 0;
const pending = report.numPendingTests ?? 0;
const total = report.numTotalTests ?? 0;

const problems = [];
if (failed > 0) problems.push(`${failed} test(s) FAILED`);
if (pending > 0)
  problems.push(
    `${pending} test(s) SKIPPED — the suite's env gate was false, so this rail was not exercised. ` +
      `Either a required credential is missing, or one is present and unusable (unfunded wallet, ` +
      `revoked key, expired JWT)`,
  );
if (passed === 0)
  problems.push(
    "0 test(s) PASSED — an empty run. Vitest exits 0 over nothing, which is precisely the outcome " +
      "this gate exists to refuse",
  );

if (problems.length > 0) {
  console.error(
    `::error::${rail} — live proof NOT established (passed=${passed} failed=${failed} skipped=${pending} total=${total})`,
  );
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

console.log(
  `live-proof-gate — ${rail}: ${passed}/${total} passed, none skipped, none failed. Rail proven live.`,
);
