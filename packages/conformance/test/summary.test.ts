/**
 * The exit code and the corpus line. These decide whether a conformance claim is green, and until the seal
 * work they lived in `cli.ts` — a top-level-await shell no test can import, so all thirty of its mutants
 * were NoCoverage. Extracting them was the fix; these are the tests that made it worth doing.
 */
import { describe, expect, it } from "vitest";
import type { Report } from "../src/runner.js";
import { formatCorpus, summarize } from "../src/summary.js";

const sealed = (
  over: Partial<Extract<Report["corpus"], { sealed: true }>> = {},
) =>
  ({
    sealed: true,
    root: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    authentic: true,
    areas: { expected: 44, actual: 44 },
    cases: { expected: 832, actual: 832 },
    ...over,
  }) as Report["corpus"];

const report = (over: Partial<Report> = {}): Report => ({
  passed: 832,
  skipped: [],
  failed: [],
  corpus: sealed(),
  ...over,
});

const FAIL = {
  area: "verify.authorityWalk",
  case: "a case",
  expected: 1,
  got: 2,
};

describe("formatCorpus", () => {
  it("states counts, a truncated root, and the verdict", () => {
    expect(formatCorpus(sealed())).toBe(
      "corpus: 44/44 areas, 832/832 cases, root abcdef0123456789… (authentic)",
    );
  });

  it("says NOT the packaged corpus when the root does not match the build", () => {
    expect(formatCorpus(sealed({ authentic: false }))).toContain(
      "NOT the packaged corpus",
    );
  });

  it("shows actual against expected, so a shortfall is visible in the line itself", () => {
    // The whole reason the line carries both numbers rather than one.
    expect(
      formatCorpus(sealed({ cases: { expected: 832, actual: 800 } })),
    ).toContain("800/832 cases");
  });

  it("an unsealed tree claims no completeness — no expected counts, no root", () => {
    const line = formatCorpus({
      sealed: false,
      authentic: false,
      areas: { actual: 44 },
      cases: { actual: 832 },
    });
    expect(line).toContain("UNSEALED");
    // No `actual/expected` pair — there is no expectation to compare against, and printing `44/44` for a
    // tree that never stated what 44 should be is the false reassurance this whole union exists to avoid.
    expect(line).not.toMatch(/\d+\/\d+/);
    // And no digest. The prose says "states no root", which is the point, so the assertion is on the
    // absence of a VALUE rather than of the word.
    expect(line).not.toMatch(/root [0-9a-f]{8}/);
  });
});

describe("summarize — the exit code", () => {
  it("exits 0 on a clean run against the packaged corpus", () => {
    expect(summarize(report(), false).exitCode).toBe(0);
  });

  it("exits 1 on any failed case", () => {
    expect(summarize(report({ failed: [FAIL] }), false).exitCode).toBe(1);
  });

  it("exits 1 when the PACKAGED corpus is unrecognised, even with every case passing", () => {
    // The silent certification the seal exists to end: 832 passed, against the wrong corpus.
    const r = report({ corpus: sealed({ authentic: false }) });
    const s = summarize(r, false);
    expect(s.exitCode).toBe(1);
    expect(s.err.join("\n")).toContain("REFUSING to certify");
  });

  it("exits 0 for the SAME corpus when --vectors named it — a report, not a refusal", () => {
    // `vectorsExplicit` is the entire difference. An implementer running their own tree is the tool
    // working; only an unrecognised corpus that arrived WITH the package is a refusal.
    const r = report({ corpus: sealed({ authentic: false }) });
    const s = summarize(r, true);
    expect(s.exitCode).toBe(0);
    expect(s.err.join("\n")).not.toContain("REFUSING");
  });

  it("exits 0 on an unsealed tree the caller named", () => {
    const r = report({
      corpus: {
        sealed: false,
        authentic: false,
        areas: { actual: 2 },
        cases: { actual: 3 },
      },
    });
    expect(summarize(r, true).exitCode).toBe(0);
    expect(summarize(r, false).exitCode).toBe(1);
  });
});

describe("summarize — nothing is suppressed", () => {
  it("reports per-case failures AND the refusal when both are wrong", () => {
    // An earlier draft exited on the authenticity verdict before printing failures, so a user with a
    // damaged install and a failing implementation saw only half the problem.
    const r = report({ failed: [FAIL], corpus: sealed({ authentic: false }) });
    const err = summarize(r, false).err.join("\n");
    expect(err).toContain("FAIL verify.authorityWalk / a case");
    expect(err).toContain("REFUSING to certify");
  });

  it("puts the failing cases BEFORE the refusal — detail first, verdict last", () => {
    const r = report({ failed: [FAIL], corpus: sealed({ authentic: false }) });
    const err = summarize(r, false).err;
    expect(err[0]).toContain("FAIL");
    expect(err[err.length - 1]).toContain("REFUSING");
  });

  it("always prints the corpus line, on a passing run and a failing one alike", () => {
    expect(summarize(report(), false).out[1]).toContain("corpus:");
    expect(summarize(report({ failed: [FAIL] }), false).out[1]).toContain(
      "corpus:",
    );
  });

  it("names the skipped areas, and says `none` rather than an empty parenthesis", () => {
    expect(summarize(report(), false).out[0]).toContain("skipped (none)");
    expect(
      summarize(report({ skipped: ["a.b", "c.d"] }), false).out[0],
    ).toContain("2 skipped (a.b, c.d)");
  });
});
