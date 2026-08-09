/**
 * Four surfaces that nothing else in the suite holds:
 *
 * - `anyStepFailed` is EXPORTED and had no test whatsoever. It is the impeachment signal a consumer reads
 *   instead of re-deriving the walk, so an inverted or emptied one reports a contradicted record as clean.
 * - `computeVerified` looks each required step up BY NAME and optional-chains the result. No test had ever
 *   asked for a class whose required step is simply absent from the report — the case the `?.` exists for.
 * - `parseEnvelope`'s `parsed === null` guard: `typeof null === "object"` and `Array.isArray(null)` is
 *   false, so without that first disjunct a record whose bytes are literally `null` dereferences null.
 * - `jcsCanonicalize` throws on a value JSON cannot represent; nothing exercised it.
 */
import { describe, expect, it } from "vitest";
import {
  anyStepFailed,
  type VerificationReport,
  verify,
} from "../src/index.js";
import { jcsCanonicalize } from "../src/report.js";
import { computeVerified } from "../src/required.js";

/** No ports and no bindings — the honest coverage of a walk driven entirely from supplied values. */
const COVERAGE = { ports: [], bindings: [] };

function reportWith(statuses: string[]): VerificationReport {
  return {
    steps: statuses.map((status, i) => ({
      name: `step-${i}`,
      outcome: { status },
    })),
  } as unknown as VerificationReport;
}

describe("anyStepFailed", () => {
  it("is true when ANY step failed, however many did not", () => {
    expect(
      anyStepFailed(reportWith(["proved", "not-attempted", "failed"])),
    ).toBe(true);
  });

  it("is false when no step failed — indeterminate and not-attempted are gaps, not contradictions", () => {
    expect(
      anyStepFailed(reportWith(["proved", "not-attempted", "indeterminate"])),
    ).toBe(false);
  });

  it("is false for a report with no steps at all", () => {
    expect(anyStepFailed(reportWith([]))).toBe(false);
  });

  it("agrees with the supportedClass impeachment the walk itself produced", async () => {
    const impeached = await verify({
      atrBytes: new TextEncoder().encode('{"lcp":"0.3","id":"x"}'),
      settledAtrHash: `0x${"11".repeat(32)}`,
      asOf: "2026-07-25T00:00:00Z",
      coverage: COVERAGE,
    });
    expect(anyStepFailed(impeached)).toBe(true);
    expect(impeached.supportedClass).toBe("TC-0");
  });
});

describe("computeVerified when a required step is missing from the report entirely", () => {
  it("does not throw, and does not affirm", () => {
    // The `?.` is the whole guard: a report that simply never ran the required step must read as
    // unverified, not crash the caller mid-walk.
    expect(computeVerified([], "TC-2", "mechanical")).toBe(false);
    expect(
      computeVerified(
        [{ name: "atr-fingerprint", outcome: { status: "proved" } }],
        "TC-2",
        "mechanical",
      ),
    ).toBe(false);
  });

  it("still refuses to affirm at structural depth even with everything proved", () => {
    expect(
      computeVerified(
        [{ name: "atr-fingerprint", outcome: { status: "proved" } }],
        "TC-0",
        "structural",
      ),
    ).toBe(false);
  });
});

describe("verify over ATR bytes that are not an LCP envelope", () => {
  const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
  const base = { asOf: "2026-07-25T00:00:00Z", coverage: COVERAGE } as const;

  /** The recourse step is the one that parses the bytes as an envelope, so it carries the readout. */
  const recourseOf = async (raw: string): Promise<unknown> =>
    (await verify({ ...base, atrBytes: bytes(raw) })).steps.find(
      (s) => s.name === "recourse-elections",
    )?.outcome;

  it("reads out `atr-not-machine-readable` for bytes that are the JSON literal `null`", async () => {
    // `typeof null === "object"` and `Array.isArray(null)` is false, so the null check is the only thing
    // between this input and a dereference of null. The readout must be the honest coverage gap — not a
    // throw, and not a `failed` that would impeach a record over the caller's shape error.
    expect(await recourseOf("null")).toEqual({
      status: "not-attempted",
      depth: "atr-not-machine-readable",
    });
  });

  it("reads out the same gap for an array, a bare number, a string, and non-JSON", async () => {
    for (const raw of ["[1,2,3]", "42", '"a string"', "not json {{{"])
      expect(await recourseOf(raw)).toEqual({
        status: "not-attempted",
        depth: "atr-not-machine-readable",
      });
  });

  it("reads out the same gap for valid JSON carrying no engine-stamped `lcp` member", async () => {
    expect(await recourseOf('{"id":"x"}')).toEqual({
      status: "not-attempted",
      depth: "atr-not-machine-readable",
    });
  });

  it("gets PAST that gap once the bytes really are an envelope", async () => {
    // The counterpart that keeps the four cases above from passing for the wrong reason: a real envelope
    // must reach the elections check, not stop at "not machine readable".
    expect(await recourseOf('{"lcp":"0.3","id":"x"}')).toEqual({
      status: "not-attempted",
      depth: "no-elections-recorded",
    });
  });
});

describe("verify with no settlements supplied", () => {
  it("reports an empty enumeration rather than carrying undefined through", async () => {
    const report = await verify({
      asOf: "2026-07-25T00:00:00Z",
      coverage: COVERAGE,
      atrBytes: new TextEncoder().encode('{"lcp":"0.3","id":"x"}'),
    });
    expect(report.settlements).toEqual({ found: [], multiplySettled: false });
  });

  it("flags multiplySettled only above one", async () => {
    const one = await verify({
      asOf: "2026-07-25T00:00:00Z",
      coverage: COVERAGE,
      settlements: [{ txHash: "0xa" }],
    });
    expect(one.settlements.multiplySettled).toBe(false);

    const two = await verify({
      asOf: "2026-07-25T00:00:00Z",
      coverage: COVERAGE,
      settlements: [{ txHash: "0xa" }, { txHash: "0xb" }],
    });
    expect(two.settlements.multiplySettled).toBe(true);
  });
});

describe("the report's step names are the public readout", () => {
  it("appends all five TC-4 composition steps under their contract names", async () => {
    // The composition steps are only ever exercised by calling their functions directly, so the NAMES
    // index.ts files them under were unconstrained — and `computeVerified` looks required steps up by
    // exactly these strings.
    const report = await verify({
      asOf: "2026-07-25T00:00:00Z",
      coverage: COVERAGE,
      composition: { offerBound: true, proportionalityTier: 2 },
    });
    expect(report.steps.map((s) => s.name)).toEqual([
      "atr-fingerprint",
      "settlement-enumeration",
      "buyer-acceptance",
      "authority-attenuation",
      "commitment-vs-leaf",
      "recourse-elections",
      "resolve-party",
      "offer-bound",
      "operations-bound",
      "discovery-integrity",
      "proportionality-declared",
      "frc-non-gating",
    ]);
  });

  it("omits the composition steps entirely when no composition slot is supplied", async () => {
    const report = await verify({
      asOf: "2026-07-25T00:00:00Z",
      coverage: COVERAGE,
    });
    expect(report.steps).toHaveLength(7);
  });
});

describe("jcsCanonicalize rejects what JSON cannot represent", () => {
  it("throws rather than emitting `undefined` into a canonical string", () => {
    expect(() => jcsCanonicalize(undefined)).toThrow(/JSON/);
    expect(() => jcsCanonicalize(() => 1)).toThrow(/JSON/);
    expect(() => jcsCanonicalize(Symbol("s"))).toThrow(/JSON/);
  });

  it("fails with its OWN diagnosis, not a parser error from further downstream", () => {
    // Without the guard, `JSON.parse(undefined)` throws a SyntaxError about a stray `u` — an error that
    // names the symptom rather than the cause. Fail-loud means the throw explains what the caller did.
    let caught: unknown;
    try {
      jcsCanonicalize(undefined);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(SyntaxError);
  });

  it("still canonicalizes ordinary JSON values", () => {
    expect(jcsCanonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(jcsCanonicalize(null)).toBe("null");
  });
});
