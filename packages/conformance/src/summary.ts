/**
 * What the CLI prints and what it exits with — as a pure function, so both are testable.
 *
 * `cli.ts` is a top-level-await shell that runs a whole corpus on import, which means no test can import it
 * and every line in it is unreachable by the suite. That was tolerable while it only formatted a pass
 * count. It stopped being tolerable when the seal put a REFUSAL decision there: "does this run exit 0" is
 * the most consequential logic in the package, and it was living in the one file nothing could exercise.
 *
 * So the shell keeps only the two things a shell must do — call the runner, and hand the result to the
 * process — and everything that decides anything lives here.
 */
import type { Report } from "./runner.js";

/** Everything the shell needs, decided in one place. */
export type CliSummary = {
  /** Lines for stdout, in order. */
  out: string[];
  /** Lines for stderr, in order — per-case failures first, then any refusal. */
  err: string[];
  exitCode: 0 | 1;
};

/** The corpus identity line. Stated on every run: a pass count without it is the exact reassurance a
 *  truncated corpus used to produce. */
export function formatCorpus(corpus: Report["corpus"]): string {
  if (!corpus.sealed)
    return `corpus: ${corpus.areas.actual} areas, ${corpus.cases.actual} cases, UNSEALED — this tree states no root, so its completeness cannot be established`;
  const verdict = corpus.authentic ? "authentic" : "NOT the packaged corpus";
  return `corpus: ${corpus.areas.actual}/${corpus.areas.expected} areas, ${corpus.cases.actual}/${corpus.cases.expected} cases, root ${corpus.root.slice(0, 16)}… (${verdict})`;
}

/**
 * Decide the whole output and the exit code.
 *
 * `vectorsExplicit` is what separates a refusal from a report. An unrecognised corpus that arrived WITH the
 * package is damaged or substituted, and exiting 0 on it is the silent certification the seal exists to
 * end. An unrecognised corpus the caller NAMED is an implementer running against a tree of their own, which
 * is the tool working as intended.
 *
 * Every diagnostic is emitted before the exit code is decided — a user with a damaged install and a failing
 * implementation needs to see both, not fix one and rediscover the other.
 */
export function summarize(
  report: Report,
  vectorsExplicit: boolean,
): CliSummary {
  const skipped = report.skipped.join(", ") || "none";
  const out = [
    `conformance: ${report.passed} passed, ${report.failed.length} failed, ${report.skipped.length} skipped (${skipped})`,
    formatCorpus(report.corpus),
  ];
  const err = report.failed.map(
    (f) =>
      `FAIL ${f.area} / ${f.case}: expected ${JSON.stringify(f.expected)} got ${JSON.stringify(f.got)}`,
  );
  const unrecognised = !report.corpus.authentic && !vectorsExplicit;
  if (unrecognised)
    err.push(
      "REFUSING to certify: the packaged corpus does not match the root compiled into this build. " +
        "This package cannot vouch for a tree it does not recognise — reinstall @integraledger/lcp-conformance, " +
        "or pass --vectors explicitly if you meant to run a different corpus.",
    );
  return {
    out,
    err,
    exitCode: unrecognised || report.failed.length > 0 ? 1 : 0,
  };
}
