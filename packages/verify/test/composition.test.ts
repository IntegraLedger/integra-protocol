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
/**
 * ⛔⛔ WHAT `offerBoundStep` REPORTS, PINNED — BECAUSE A PUBLISHED PROFILE ONCE SAID IT REPORTED MORE.
 *
 * `binding-evm-mpp`'s finality note read *"The tree checks it as OFR — `offerBoundStep`"* about the §8.3.5
 * discharge, which rests on the ATR STATING the transaction parameters (LCP §C.1). This step does not
 * establish that and cannot: it never sees the ATR. It reads one boolean off the composition slot and says
 * whether an offer binding is present.
 *
 * ⇒ The step's contract is pinned HERE, beside the step, so a reader checking a claim about it finds the
 * answer in one place — and so a future change that made it a real parameter check would fail this test and
 * force the profiles that describe it to be revisited.
 */
describe("⛔ `offerBoundStep` is a PRESENCE report, not a parameter check", () => {
  it("proves on the flag alone — it is handed no ATR and no transaction parameters", () => {
    // Every field of the charge is absent, and the step still proves. That is correct for what it measures
    // and is exactly why it cannot discharge a claim about what the hashed document states.
    expect(offerBoundStep({ offerBound: true })).toEqual({ status: "proved" });
  });

  it("an unbound offer is INCOMPLETENESS, never a failure", () => {
    // `not-attempted` and not `failed`: a record that binds no offer has not been impeached, it has not
    // been examined. A profile reading this as a check that can refuse would be reading a gate into a gap.
    expect(offerBoundStep({ offerBound: false })).toEqual({
      status: "not-attempted",
      depth: "no-offer",
    });
  });
});

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

/**
 * TOTALITY OVER UNTYPED INPUT — the rule `steps.ts` states in capitals and these steps never held.
 *
 * Every case below is a value a typed caller cannot express and an untyped one reaches every day: a
 * foreign conformance subject, an HTTP intake, a hand-written JSON fixture. Two defects live here, and
 * they are opposite failures of the same rule. Read for TRUTHINESS, the word `"false"` PROVED the rung it
 * denies. Read without a shape screen, an object map threw `TypeError` out of `verify()` itself.
 */
describe("the composition steps are total over untyped slots", () => {
  const untyped = (c: unknown): CompositionInput => c as CompositionInput;

  it("a NON-BOOLEAN offer slot never proves — 'false' is a truthy string", () => {
    // The four shapes that used to clear the OFR rung on a value nobody stated.
    for (const offerBound of ["false", "no", "0", {}]) {
      expect(
        offerBoundStep(untyped({ offerBound })),
        String(offerBound),
      ).toEqual({
        status: "not-attempted",
        depth: "malformed-offer-bound",
      });
    }
    // A stated `false` is the RECORD's incompleteness, not the caller's shape error, and keeps its own
    // token — the same line `steps.ts` draws between an absent slot and a malformed one.
    expect(offerBoundStep({ offerBound: false })).toEqual({
      status: "not-attempted",
      depth: "no-offer",
    });
  });

  it("NON-BOOLEAN operations members never prove", () => {
    expect(
      operationsStep(
        untyped({
          operations: { orderStateRef: "false", reconciliationIds: "no" },
        }),
      ),
    ).toEqual({ status: "not-attempted", depth: "malformed-operations" });
    // EACH member is independently screened: one good half does not rescue the other.
    expect(
      operationsStep(
        untyped({
          operations: { orderStateRef: true, reconciliationIds: "yes" },
        }),
      ),
    ).toEqual({ status: "not-attempted", depth: "malformed-operations" });
    expect(
      operationsStep(
        untyped({
          operations: { orderStateRef: "yes", reconciliationIds: true },
        }),
      ),
    ).toEqual({ status: "not-attempted", depth: "malformed-operations" });
  });

  it("a discovery slot outside the closed set is a GAP, never a DSC-2 mismatch", () => {
    // The measured defect: `discoveryIntegrity: null` fell through to the mismatch arm, answered
    // `failed(verification-failure)`, and drove supportedClass to TC-0 over the caller's mistyped slot.
    // `steps.ts` states in capitals that a caller shape error is `not-attempted`; this file did not hold it.
    for (const discoveryIntegrity of [null, "OK", "checked", 1, {}]) {
      expect(
        discoveryIntegrityStep(untyped({ discoveryIntegrity })),
        String(discoveryIntegrity),
      ).toEqual({
        status: "not-attempted",
        depth: "malformed-discovery-check",
      });
    }
    // The one word that IS a violation still impeaches — the screen narrows nothing it should not.
    expect(discoveryIntegrityStep({ discoveryIntegrity: "mismatch" })).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("a tier outside CMP-6's four never proves — presence was not a declaration", () => {
    for (const proportionalityTier of ["seven", 0, 5, 2.5, null, true]) {
      expect(
        proportionalityStep(untyped({ proportionalityTier })),
        String(proportionalityTier),
      ).toEqual({
        status: "not-attempted",
        depth: "malformed-proportionality-tier",
      });
    }
    for (const proportionalityTier of [1, 2, 3, 4] as const)
      expect(proportionalityStep({ proportionalityTier })).toEqual({
        status: "proved",
      });
  });

  it("a malformed FRC slot REFUSES rather than throwing out of the step", () => {
    // `sigs.some is not a function` for the first two, and a null dereference for the third. A
    // verification surface that throws cannot report the malformation it was handed.
    //
    // The MIXED array is the one that says `every` rather than `some`: read with `some`, an array whose
    // first entry is a good signal would read as readable and the unreadable second one — whose `gated`
    // could be the impeachment — would be silently dropped.
    for (const frcSignals of [
      { psp: { role: "psp", gated: true } },
      "psp",
      [null],
      [undefined],
      [{ role: "psp" }],
      [{ role: 7, gated: false }],
      [{ role: "psp", gated: "yes" }],
      [
        { role: "psp", gated: false },
        { role: 7, gated: true },
      ],
    ]) {
      expect(
        frcNonGatingStep(untyped({ frcSignals })),
        JSON.stringify(frcSignals),
      ).toEqual({ status: "not-attempted", depth: "malformed-frc-signals" });
    }
  });

  it("readCompositionSlots reads the SAME screens, so the flattened readout cannot disagree", () => {
    // Every slot malformed. The readout has no gap channel, so each reads as its unstated value — and the
    // point is that none of them reads as STATED, which is what the truthiness form did for four of the six.
    expect(
      readCompositionSlots(
        untyped({
          offerBound: "false",
          operations: { orderStateRef: "false", reconciliationIds: "false" },
          discoveryIntegrity: null,
          proportionalityTier: "seven",
          frcSignals: { psp: { role: "psp", gated: true } },
        }),
      ),
    ).toEqual({
      offerBound: false,
      operationsBound: false,
      discoveryIntegrity: "not-checked",
      proportionalityTier: undefined,
      frcSignalCount: 0,
      frcGated: false,
    });
  });
});
