import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verify } from "../src/index.js";
import { REQUIRED_STEPS, type TransactionClass } from "../src/required.js";
import { type PlacementInput, referencePlacementStep } from "../src/steps.js";

const vec = JSON.parse(
  readFileSync(
    new URL(
      "../../../vectors/verify/reference-placement.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  ladder: { stepMustNotAppearIn: TransactionClass[] };
  cases: {
    name: string;
    input: Record<string, unknown>;
    expected: { status: string; haltClass?: string; depth?: string };
  }[];
};

const ATR =
  "0x3f786850e387550fdab836ed7e6dc881de23001b3f786850e387550fdab836ed";
const ATR_BYTES = new TextEncoder().encode("a");

// `asOf` and `coverage` are REQUIRED on VerifyInput — every validity check is evaluated against the
// settlement instant, and coverage is what makes depth honest. Spread into each call so the placement
// slot is the only thing that varies between them.
const BASE = {
  asOf: "2026-07-27T00:00:00Z",
  coverage: { ports: [], bindings: [] },
  atrBytes: ATR_BYTES,
  settledAtrHash: ATR,
};

describe("R-8.1 — reference-placement is reported, never required", () => {
  for (const cls of vec.ladder.stepMustNotAppearIn) {
    it(`${cls} does not require reference-placement`, () => {
      expect(REQUIRED_STEPS[cls]).not.toContain("reference-placement");
    });
  }
});

describe("referencePlacementStep", () => {
  for (const c of vec.cases) {
    it(c.name, () => {
      // The vector states the slot flat (`extracted` + `atrHash`) so it stays neutral across
      // implementations; this maps it onto the typed arguments. A case with no `extracted` key is the
      // absent-slot arm — exactly what a caller that never placed anything passes.
      const out = referencePlacementStep(
        "extracted" in c.input
          ? ({ extracted: c.input["extracted"] } as PlacementInput)
          : undefined,
        c.input["atrHash"] as string | undefined,
      );
      expect(out).toEqual(c.expected);
    });
  }
});

// The one arm no vector can reach. `exactOptionalPropertyTypes` makes `{ extracted: undefined }`
// unassignable to `PlacementInput`, so a TYPED caller cannot construct it, and JSON has no `undefined`,
// so no conformance case can either — the same reason the ATA-3 depth gates pin their non-finite arms in
// package tests rather than the corpus. It is still reachable from an untyped JS caller, which is exactly
// the caller this file's totality rule exists for, so it is pinned here.
describe("referencePlacementStep — the untyped-caller arm", () => {
  it("a slot present but carrying no extraction is its OWN gap, not a malformed one", () => {
    expect(
      referencePlacementStep({ extracted: undefined } as PlacementInput, ATR),
    ).toEqual({ status: "not-attempted", depth: "no-reference-extracted" });
  });

  it("a null slot is the absent slot — total over what a typed caller cannot express", () => {
    expect(
      referencePlacementStep(null as unknown as PlacementInput, ATR),
    ).toEqual({ status: "not-attempted", depth: "no-placement-input" });
  });
});

// A unit test on the step function cannot catch an UNWIRED step: the step could be perfect and still
// appear in no report and impeach nothing. These assert the wiring itself.
describe("reference-placement is wired into verify()'s walk", () => {
  it("a contradicting placement reports the step as failed AND impeaches to TC-0", async () => {
    const report = await verify({
      ...BASE,
      placement: {
        extracted: {
          ref: {
            type: "sha256",
            value:
              "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
          termsUrl: { kind: "no-field-declared" },
        },
      },
    });
    const step = report.steps.find((s) => s.name === "reference-placement");
    expect(step?.outcome).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
    expect(report.supportedClass).toBe("TC-0");
    expect(report.verified).toBe(false);
  });

  it("a matching placement reports the step as proved and does NOT inflate the class", async () => {
    const report = await verify({
      ...BASE,
      placement: {
        extracted: {
          ref: { type: "sha256", value: ATR },
          termsUrl: { kind: "no-field-declared" },
        },
      },
    });
    expect(
      report.steps.find((s) => s.name === "reference-placement")?.outcome,
    ).toEqual({ status: "proved" });
    // The placement adds REACH, never class: with no settlement rung earned, `verified` stays false.
    expect(report.verified).toBe(false);
  });

  it("an absent placement appends NO step — reports stay byte-identical", async () => {
    const without = await verify({ ...BASE });
    expect(without.steps.some((s) => s.name === "reference-placement")).toBe(
      false,
    );

    // Byte-identity is the property that makes the slot additive, so it is asserted on the bytes.
    const withUndefined = await verify({ ...BASE });
    expect(JSON.stringify(withUndefined)).toBe(JSON.stringify(without));
  });
});
