import type { VerifyDepth } from "./report.js";

export type { VerifyDepth };
/** The transaction-class ladder. Higher classes require strictly more steps, so a record supporting TC-3
 *  supports every class below it. A class is a CLAIM about what a record can support — it is never a
 *  quality score, and nothing in this package tries to reach a higher one. */
export type TransactionClass = "TC-0" | "TC-1" | "TC-2" | "TC-3" | "TC-4";
/** Every step the walk can append, in one closed union. Closed because `REQUIRED_STEPS` is keyed by these
 *  names and a typo would silently make a required step unfindable — which `computeVerified` would read as
 *  "not proved", failing safe but for the wrong reason. */
export type StepName =
  | "atr-fingerprint"
  | "settlement-enumeration"
  | "buyer-acceptance"
  | "authority-attenuation"
  | "commitment-vs-leaf"
  | "recourse-elections"
  | "resolve-party"
  // The TC-4 composition steps:
  | "offer-bound"
  | "operations-bound"
  | "discovery-integrity"
  | "proportionality-declared"
  | "frc-non-gating"
  // The reference-placement step is REPORTED, NEVER REQUIRED. Deliberately absent from every entry in REQUIRED_STEPS below,
  // for the same reason frc-non-gating is: it impeaches when it FAILS (the reference found in the
  // protocol's native field contradicts the record) but its ABSENCE never blocks. A protocol that never
  // settles has nothing to enumerate, and letting a placement stand in for a settlement rung would let a
  // record that moved no money read as classed — the exact inflation the center lock forbids.
  | "reference-placement";

/** PAY + IDN — the attribution rungs every class from TC-1 up carries. */
const TC1: readonly StepName[] = ["settlement-enumeration", "resolve-party"];
/** + TRM/WLD: the fingerprint step IS the weld check (recomputed hash vs the hash the settlement committed). */
const TC2: readonly StepName[] = [...TC1, "atr-fingerprint"];
/** + TRM-6 + ATA + RCS-1/2/4 — the definition of the class, verbatim. */
const TC3: readonly StepName[] = [
  ...TC2,
  "buyer-acceptance",
  "authority-attenuation",
  "commitment-vs-leaf",
  "recourse-elections",
];

/**
 * What each class MECHANICALLY requires to be `proved` before `verified` can hold, derived row-for-row from
 * The class requirements (see `vectors/verify/mechanical.json`, the authored-from-spec truth table):
 *
 *   PAY (value settles) ................. `settlement-enumeration`      TC-1 +
 *   IDN (identity, stated assurance) .... `resolve-party`               TC-1 +
 *   TRM/WLD (fingerprint + weld) ........ `atr-fingerprint`             TC-2 +
 *   TRM-6 (signed acceptance) ........... `buyer-acceptance`            TC-3 +
 *   ATA (authority + delegation chain) .. `authority-attenuation`, `commitment-vs-leaf`   TC-3 +
 *   RCS-1/2/4 (forum, law, package) ..... `recourse-elections`          TC-3 +
 *   OFR/OPS/DSC (commerce plane) ........ the four composition steps    TC-4
 *
 * The ladder is CUMULATIVE: a class requires every rung below it, which is why TC-4 cannot hold without the
 * TC-3 acceptance. It is also EXACT: a class never requires a step it does not depend on — TRM is not a TC-1
 * rung, so a TC-1 record with an unattempted fingerprint still verifies.
 *
 * DECLARED GAP — ASP (spend authority, verifiable bounds) is marked from TC-1 and has NO step here: the bounds
 * live inside the rail's own settlement authorization (an EIP-3009 `value`, an escrow `PaymentInfo` cap) and
 * `verify` is pure over supplied inputs with no rail decoder. RCS-4 reaches it indirectly — `recourse-elections`
 * requires the `spend artifact` role in the retained package, so the artifact is kept and referenced even though
 * its bounds are not re-derived here. Closing it properly is a rail-decoder work item, named rather than omitted.
 *
 * `frc-non-gating` is DELIBERATELY absent from TC-4: it impeaches when it FAILS (a signal that gated settlement)
 * but its ABSENCE never blocks (FRC is a downstream consequence, not a v1 requirement).
 */
export const REQUIRED_STEPS: Record<TransactionClass, readonly StepName[]> = {
  "TC-0": [],
  "TC-1": TC1,
  "TC-2": TC2,
  "TC-3": TC3,
  "TC-4": [
    ...TC3,
    "offer-bound",
    "operations-bound",
    "discovery-integrity",
    "proportionality-declared",
  ],
};

/** Whether a walk affirms the claimed class. Three rules, in order: **structural depth is always `false`**
 *  (a presence/absence readout never affirms liveness), any `failed` step impeaches the whole walk, and
 *  otherwise every step required by the claimed class must be `proved`. A step that is absent, or
 *  `indeterminate`, is not `proved` — absent inputs never prove. */
export function computeVerified(
  steps: readonly { name: StepName; outcome: { status: string } }[],
  claimedClass: TransactionClass,
  depth: VerifyDepth,
): boolean {
  if (depth === "structural") return false; // structural = presence/absence readout, never affirms liveness
  if (steps.some((s) => s.outcome.status === "failed")) return false; // any failure impeaches
  const required = REQUIRED_STEPS[claimedClass];
  return required.every(
    (name) => steps.find((s) => s.name === name)?.outcome.status === "proved",
  );
}
