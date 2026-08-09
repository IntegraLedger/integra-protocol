/**
 * The TC-4 **composition readout** — the pure step evaluators the walk appends when a
 * `composition` slot is supplied. Each evaluator mirrors `fingerprintStep`: presence/absence over the
 * supplied `CompositionInput` → a `StepOutcome`, no I/O, no fetch, no viem. TC-4 is a READOUT of a record
 * complete enough to prove it was complete — these steps never gate; they only confirm or impeach.
 *
 * FRC is DELIBERATELY non-gating (FRC-1): `frcNonGatingStep` is impeachment-only — a signal that GATED is a
 * `failed(risk-block)`, its ABSENCE never blocks TC-4 (it is not in `REQUIRED_STEPS["TC-4"]`).
 */
import type { StepOutcome } from "./report.js";

/** What the caller can state about a record's composition. **Every field is optional, and absence is
 *  meaningful**: an omitted field is a gap the readout reports as unproved, never an assumed `false`.
 *  The values are the CALLER's assertions — this module performs no I/O and cannot check any of them. */
export interface CompositionInput {
  readonly offerBound?: boolean;
  readonly operations?: {
    readonly orderStateRef?: boolean;
    readonly reconciliationIds?: boolean;
  };
  readonly discoveryIntegrity?: "ok" | "mismatch" | "not-checked";
  readonly proportionalityTier?: 1 | 2 | 3 | 4;
  readonly frcSignals?: readonly {
    readonly role: string;
    readonly gated: boolean;
  }[];
}
/** The flattened TC-4 readout. It is a READOUT, not a verdict: nothing here gates, and `frcGated: true`
 *  is an impeachment signal rather than a refusal. `proportionalityTier` stays `undefined` when the caller
 *  stated none, because an unstated tier is not tier 1. */
export interface CompositionReadout {
  readonly offerBound: boolean;
  readonly operationsBound: boolean;
  readonly discoveryIntegrity: "ok" | "mismatch" | "not-checked";
  readonly proportionalityTier: 1 | 2 | 3 | 4 | undefined;
  readonly frcSignalCount: number;
  readonly frcGated: boolean;
}

const na = (why: string): StepOutcome => ({
  status: "not-attempted",
  depth: why,
});

/** OFR — proved iff the offer slot is bound; an unbound offer is incompleteness (not-attempted), never a failure. */
export function offerBoundStep(c: CompositionInput | undefined): StepOutcome {
  return c?.offerBound ? { status: "proved" } : na("no-offer");
}
/** OPS core — the always-applicable OPS bindings (OPS-2 order/fulfillment ref AND OPS-5 reconciliation). */
export function operationsStep(c: CompositionInput | undefined): StepOutcome {
  return c?.operations?.orderStateRef && c.operations.reconciliationIds
    ? { status: "proved" }
    : na("ops-incomplete");
}
/** DSC-1/2 — "ok" proves; "mismatch" is a hard DSC-2 violation (verification-failure); else not-attempted. */
export function discoveryIntegrityStep(
  c: CompositionInput | undefined,
): StepOutcome {
  const d = c?.discoveryIntegrity;
  if (d === undefined || d === "not-checked") return na("no-discovery-check");
  return d === "ok"
    ? { status: "proved" }
    : { status: "failed", haltClass: "verification-failure" };
}
/** CMP-6 — proved iff the proportionality tier is declared. */
export function proportionalityStep(
  c: CompositionInput | undefined,
): StepOutcome {
  return c?.proportionalityTier !== undefined
    ? { status: "proved" }
    : na("no-tier");
}
/** FRC-1 — impeachment-only: any signal that GATED is a `failed(risk-block)`; signals present but non-gating
 *  prove the stack recorded-not-gated; no signals is not-attempted (FRC is not a v1 requirement). */
export function frcNonGatingStep(c: CompositionInput | undefined): StepOutcome {
  const sigs = c?.frcSignals ?? [];
  if (sigs.length === 0) return na("no-frc-signals");
  return sigs.some((s) => s.gated)
    ? { status: "failed", haltClass: "risk-block" }
    : { status: "proved" };
}

/** Flatten a {@link CompositionInput} into a {@link CompositionReadout}. Pure and total — an `undefined`
 *  input is legitimate and reads as "nothing stated" rather than throwing. `operationsBound` requires BOTH
 *  operations fields; either alone is a partially-composed record and reads `false`. */
export function readCompositionSlots(
  input: CompositionInput | undefined,
): CompositionReadout {
  const sigs = input?.frcSignals ?? [];
  return {
    offerBound: !!input?.offerBound,
    operationsBound: !!(
      input?.operations?.orderStateRef && input.operations.reconciliationIds
    ),
    discoveryIntegrity: input?.discoveryIntegrity ?? "not-checked",
    proportionalityTier: input?.proportionalityTier,
    frcSignalCount: sigs.length,
    frcGated: sigs.some((s) => s.gated),
  };
}
