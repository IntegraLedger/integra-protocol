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

/**
 * How a BOOLEAN composition slot reads — and it is read by TYPE, never for truthiness.
 *
 * `offerBound: "false"` — the word that DENIES the binding — is a truthy string, and so are `"no"`, `"0"`,
 * `[]` and `{}`: every one of them PROVED its rung on a value nobody stated. That is verbatim the
 * `parentDelegable` defect `steps.ts` states in capitals and fixed on the authority link; it was never
 * carried across to these slots, which are the only rungs by which a walk reaches TC-4 at all.
 *
 * Three-way, because `steps.ts`'s discipline needs all three: `true` proves, `false`/absent is the record's
 * own incompleteness (a gap), and a NON-boolean is the CALLER's shape error and reads out under its own
 * name — the same split `fingerprintStep` draws between `no-settled-hash` and `malformed-settled-hash`.
 */
type BoolSlot = "stated-true" | "unstated" | "malformed";
function boolSlot(value: unknown): BoolSlot {
  if (value === undefined) return "unstated";
  if (typeof value !== "boolean") return "malformed";
  return value ? "stated-true" : "unstated";
}

/** The DSC reading, or `"malformed"` for a value outside the closed set. The taxonomy is closed and the
 *  gap must not be read as a mismatch: `discoveryIntegrity: null` used to reach the `mismatch` arm and
 *  answer `failed(verification-failure)`, driving `supportedClass` to TC-0 over a slot the caller mistyped.
 *  Only the word `mismatch` is a DSC-2 violation; everything else this cannot read is a gap. */
function discoveryReading(
  value: unknown,
): "ok" | "mismatch" | "not-checked" | "malformed" {
  return value === "ok" || value === "mismatch" || value === "not-checked"
    ? value
    : value === undefined
      ? "not-checked"
      : "malformed";
}

/** CMP-6's closed tier set. `proportionalityTier: "seven"` is not a declared tier, and reading mere
 *  presence proved the rung for it. */
function isTier(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

/** The FRC signals as an ARRAY OF SIGNALS, or `"malformed"`. `c.frcSignals ?? []` then `.some(…)` was
 *  total over nothing: an object map (`{psp: {role, gated}}`) and a bare string both threw
 *  `TypeError: sigs.some is not a function` OUT of `verify()`, and `[null]` threw on the property read. A
 *  verification surface refuses; it does not throw, because a walk that crashes cannot report the
 *  malformation it was handed — this module's totality rule, which these steps never held. */
function frcReading(
  value: unknown,
): readonly { readonly role: string; readonly gated: boolean }[] | "malformed" {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return "malformed";
  return value.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as { role?: unknown }).role === "string" &&
      typeof (s as { gated?: unknown }).gated === "boolean",
  )
    ? (value as readonly { readonly role: string; readonly gated: boolean }[])
    : "malformed";
}

/** OFR — proved iff the offer slot is bound; an unbound offer is incompleteness (not-attempted), never a failure. */
export function offerBoundStep(c: CompositionInput | undefined): StepOutcome {
  const slot = boolSlot(c?.offerBound);
  if (slot === "malformed") return na("malformed-offer-bound");
  return slot === "stated-true" ? { status: "proved" } : na("no-offer");
}
/** OPS core — the always-applicable OPS bindings (OPS-2 order/fulfillment ref AND OPS-5 reconciliation). */
export function operationsStep(c: CompositionInput | undefined): StepOutcome {
  const order = boolSlot(c?.operations?.orderStateRef);
  const reconciliation = boolSlot(c?.operations?.reconciliationIds);
  if (order === "malformed" || reconciliation === "malformed")
    return na("malformed-operations");
  return order === "stated-true" && reconciliation === "stated-true"
    ? { status: "proved" }
    : na("ops-incomplete");
}
/** DSC-1/2 — "ok" proves; "mismatch" is a hard DSC-2 violation (verification-failure); else not-attempted. */
export function discoveryIntegrityStep(
  c: CompositionInput | undefined,
): StepOutcome {
  const reading = discoveryReading(c?.discoveryIntegrity);
  if (reading === "malformed") return na("malformed-discovery-check");
  if (reading === "not-checked") return na("no-discovery-check");
  return reading === "ok"
    ? { status: "proved" }
    : { status: "failed", haltClass: "verification-failure" };
}
/** CMP-6 — proved iff the proportionality tier is declared, as one of the four tiers the taxonomy holds. */
export function proportionalityStep(
  c: CompositionInput | undefined,
): StepOutcome {
  const tier = c?.proportionalityTier;
  if (tier === undefined) return na("no-tier");
  return isTier(tier)
    ? { status: "proved" }
    : na("malformed-proportionality-tier");
}
/** FRC-1 — impeachment-only: any signal that GATED is a `failed(risk-block)`; signals present but non-gating
 *  prove the stack recorded-not-gated; no signals is not-attempted (FRC is not a v1 requirement). */
export function frcNonGatingStep(c: CompositionInput | undefined): StepOutcome {
  const sigs = frcReading(c?.frcSignals);
  if (sigs === "malformed") return na("malformed-frc-signals");
  if (sigs.length === 0) return na("no-frc-signals");
  return sigs.some((s) => s.gated)
    ? { status: "failed", haltClass: "risk-block" }
    : { status: "proved" };
}

/** Flatten a {@link CompositionInput} into a {@link CompositionReadout}. Pure and total — an `undefined`
 *  input is legitimate and reads as "nothing stated" rather than throwing. `operationsBound` requires BOTH
 *  operations fields; either alone is a partially-composed record and reads `false`.
 *
 *  It reads every slot through the SAME readers the steps use, which is what stops the flattened readout
 *  and the report from disagreeing about the same input. A malformed slot reads here exactly as an
 *  unstated one does — this type has no third value to carry a gap in, and inventing one would be a
 *  second taxonomy. The distinction lives in the STEP, where a `depth` token can name it. */
export function readCompositionSlots(
  input: CompositionInput | undefined,
): CompositionReadout {
  const read = frcReading(input?.frcSignals);
  const sigs = read === "malformed" ? [] : read;
  const discovery = discoveryReading(input?.discoveryIntegrity);
  return {
    offerBound: boolSlot(input?.offerBound) === "stated-true",
    operationsBound:
      boolSlot(input?.operations?.orderStateRef) === "stated-true" &&
      boolSlot(input?.operations?.reconciliationIds) === "stated-true",
    discoveryIntegrity: discovery === "malformed" ? "not-checked" : discovery,
    proportionalityTier: isTier(input?.proportionalityTier)
      ? input.proportionalityTier
      : undefined,
    frcSignalCount: sigs.length,
    frcGated: sigs.some((s) => s.gated),
  };
}
