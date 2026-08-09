import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CompositionInput,
  discoveryIntegrityStep,
  frcNonGatingStep,
  offerBoundStep,
  operationsStep,
  proportionalityStep,
  readCompositionSlots,
} from "../src/composition.js";

const vectors = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../vectors/verify/composition-steps.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
) as {
  cases: {
    name: string;
    composition: CompositionInput;
    expect: Record<
      | "offerBound"
      | "operations"
      | "discoveryIntegrity"
      | "proportionality"
      | "frcNonGating",
      string
    >;
  }[];
};

describe("verify composition steps (TC-4 readout)", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      expect(offerBoundStep(c.composition).status).toBe(c.expect.offerBound);
      expect(operationsStep(c.composition).status).toBe(c.expect.operations);
      expect(discoveryIntegrityStep(c.composition).status).toBe(
        c.expect.discoveryIntegrity,
      );
      expect(proportionalityStep(c.composition).status).toBe(
        c.expect.proportionality,
      );
      expect(frcNonGatingStep(c.composition).status).toBe(
        c.expect.frcNonGating,
      );
    });
  }
  it("readCompositionSlots surfaces frcGated + operationsBound", () => {
    const r = readCompositionSlots({
      operations: { orderStateRef: true, reconciliationIds: true },
      frcSignals: [{ role: "a", gated: true }],
    });
    expect(r.operationsBound).toBe(true);
    expect(r.frcGated).toBe(true);
    expect(r.frcSignalCount).toBe(1);
  });
});

/**
 * The composition slots at their EDGES —
 * the weakest in the verification core — with 24 survivors clustered in two places: every step's
 * absent-input path (`c?.`), and `readCompositionSlots`, whose output nothing asserted at all.
 *
 * The most consequential survivor was `sigs.some((s) => s.gated)` mutating to `.every(...)` and living.
 * All-gated and all-clear signal sets cannot tell those apart; only a MIX can. Under `.every`, a stack that
 * gated one signal out of several would read `proved` — FRC-1 inverted, silently, in the one step whose
 * entire job is to catch a gating stack.
 */
describe("composition slots — absent inputs and the FRC-1 gating edge", () => {
  it("every step reads out not-attempted on an ABSENT composition slot, never proved", () => {
    // TC-0..TC-3 records carry no composition at all; these steps must be honest about that rather than
    // crediting an absent slot.
    expect(offerBoundStep(undefined)).toEqual({
      status: "not-attempted",
      depth: "no-offer",
    });
    expect(operationsStep(undefined)).toEqual({
      status: "not-attempted",
      depth: "ops-incomplete",
    });
    expect(discoveryIntegrityStep(undefined)).toEqual({
      status: "not-attempted",
      depth: "no-discovery-check",
    });
    expect(proportionalityStep(undefined)).toEqual({
      status: "not-attempted",
      depth: "no-tier",
    });
    expect(frcNonGatingStep(undefined)).toEqual({
      status: "not-attempted",
      depth: "no-frc-signals",
    });
  });

  it("FRC-1 fails on a MIX — one gated signal among clear ones still blocks", () => {
    const mixed: CompositionInput = {
      frcSignals: [
        { role: "sanctions", gated: false },
        { role: "fraud", gated: true },
        { role: "aml", gated: false },
      ],
    };
    expect(frcNonGatingStep(mixed)).toEqual({
      status: "failed",
      haltClass: "risk-block",
    });
    expect(readCompositionSlots(mixed).frcGated).toBe(true);
  });

  it("FRC-1 proves when signals are present and NONE gated — recorded, not gating", () => {
    const clear: CompositionInput = {
      frcSignals: [
        { role: "sanctions", gated: false },
        { role: "fraud", gated: false },
      ],
    };
    expect(frcNonGatingStep(clear)).toEqual({ status: "proved" });
    expect(readCompositionSlots(clear).frcGated).toBe(false);
  });

  it("OPS needs BOTH bindings — either alone is incomplete", () => {
    const onlyOrder: CompositionInput = { operations: { orderStateRef: true } };
    const onlyRecon: CompositionInput = {
      operations: { reconciliationIds: true },
    };
    expect(operationsStep(onlyOrder).status).toBe("not-attempted");
    expect(operationsStep(onlyRecon).status).toBe("not-attempted");
    expect(readCompositionSlots(onlyOrder).operationsBound).toBe(false);
    expect(readCompositionSlots(onlyRecon).operationsBound).toBe(false);
  });

  it("DSC-2: an explicit 'mismatch' is a verification-failure, distinct from 'not-checked'", () => {
    // The two halves of `d === undefined || d === "not-checked"` need pinning apart: an unchecked listing
    // is a gap, a MISMATCHED one is the record contradicting its own discovery document.
    expect(discoveryIntegrityStep({ discoveryIntegrity: "mismatch" })).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
    expect(
      discoveryIntegrityStep({ discoveryIntegrity: "not-checked" }),
    ).toEqual({ status: "not-attempted", depth: "no-discovery-check" });
    expect(discoveryIntegrityStep({ discoveryIntegrity: "ok" })).toEqual({
      status: "proved",
    });
  });

  it("readCompositionSlots defaults every slot honestly for an absent input", () => {
    expect(readCompositionSlots(undefined)).toEqual({
      offerBound: false,
      operationsBound: false,
      discoveryIntegrity: "not-checked",
      proportionalityTier: undefined,
      frcSignalCount: 0,
      frcGated: false,
    });
  });

  it("readCompositionSlots reports a fully-populated composition verbatim", () => {
    const full: CompositionInput = {
      offerBound: true,
      operations: { orderStateRef: true, reconciliationIds: true },
      discoveryIntegrity: "ok",
      proportionalityTier: 2,
      frcSignals: [{ role: "sanctions", gated: false }],
    };
    expect(readCompositionSlots(full)).toEqual({
      offerBound: true,
      operationsBound: true,
      discoveryIntegrity: "ok",
      proportionalityTier: 2,
      frcSignalCount: 1,
      frcGated: false,
    });
  });
});
