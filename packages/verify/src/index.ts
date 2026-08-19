/**
 * `verify` — the walk at the caller-specified `depth` (default `"structural"`). Pure over
 * its supplied inputs (the fetched ATR bytes, the enumerated settlements, the ATA chain, the acceptance)
 * — the imperative shell that fetches them via live ports is the buyer gate's. The report is honest about
 * coverage: a step whose inputs are absent is `not-attempted(<why>)`.
 *
 * At STRUCTURAL depth `verified` is always `false` (a presence/absence readout → class, not a verdict).
 * At MECHANICAL depth `verified` is an honest function of the walk via `computeVerified` — raised `true`
 * iff every step required by the CLAIMED class is `proved` and no step `failed`.
 *
 * The report separates what was asked from what was found. `claimedClass` is the caller's input, echoed
 * verbatim. `supportedClass` is the walk's own finding via `computeSupportedClass` — the highest class
 * whose every required step is `proved`, `TC-0` on any failure. The claim neither caps nor lifts it, so a
 * record that proves nothing reads `TC-0` however high the caller aimed, and one whose rungs reach past the
 * claim reads what it reached. Step outcomes are depth-agnostic (see `steps.ts`), so this holds at both
 * depths: `depth` governs `verified`, never the class.
 */
import type {
  Bounds,
  ChainWalkResult,
  SignatureVerifier,
  SignedAcceptance,
} from "@integraledger/lcp-authority";
import {
  type CompositionInput,
  discoveryIntegrityStep,
  frcNonGatingStep,
  offerBoundStep,
  operationsStep,
  proportionalityStep,
} from "./composition.js";
import type {
  StepOutcome,
  VerificationReport,
  VerificationStep,
  VerifyDepth,
} from "./report.js";
import {
  computeSupportedClass,
  computeVerified,
  type StepName,
  type TransactionClass,
} from "./required.js";
import {
  type AuthorityLink,
  acceptanceStep,
  authorityStep,
  authorityStepFromWalk,
  commitmentStep,
  fingerprintStep,
  type PlacementInput,
  type RecordIdentity,
  recourseStep,
  referencePlacementStep,
  resolvePartyStep,
  settlementStep,
} from "./steps.js";

export {
  type CompositionInput,
  type CompositionReadout,
  discoveryIntegrityStep,
  frcNonGatingStep,
  offerBoundStep,
  operationsStep,
  proportionalityStep,
  readCompositionSlots,
} from "./composition.js";
export {
  jcsCanonicalize,
  type StepOutcome,
  serializeReport,
  type VerificationReport,
  type VerificationStep,
  type VerifyDepth,
} from "./report.js";
export {
  computeVerified,
  REQUIRED_STEPS,
  type StepName,
  type TransactionClass,
} from "./required.js";
export {
  type AuthorityLink,
  acceptanceStep,
  authorityStep,
  authorityStepFromWalk,
  commitmentStep,
  fingerprintStep,
  type PlacementInput,
  RCS4_REQUIRED_ROLES,
  type RecordIdentity,
  recourseStep,
  referencePlacementStep,
  resolvePartyStep,
  settlementStep,
} from "./steps.js";

/**
 * Everything a verification walk is given. **The caller gathers the inputs; `verify()` opens no network
 * connection of its own** — it takes `atrBytes`, not a reference to fetch, and takes `settlements` rather
 * than enumerating them. That is what makes the walk pure and reproducible.
 *
 * Nearly every field is optional, and this is the type's central property: an absent input yields an
 * `indeterminate` or `not-attempted` step, never a pass. `coverage` is how the report stays honest about
 * that — it states which ports and bindings were actually supplied, so a thin walk cannot read as a
 * thorough one.
 */
export interface VerifyInput {
  /** The settlement's chain-anchored time (every validity check is evaluated against it). */
  asOf: string;
  /** Which ports/bindings were supplied — coverage is honest depth. */
  coverage: { ports: string[]; bindings: string[] };
  /** The retrieved ATR bytes (absent ⇒ the fingerprint step is indeterminate). */
  atrBytes?: Uint8Array;
  /** The atrHash the settlement committed (nonce/salt) — the fingerprint is checked against it. */
  settledAtrHash?: string;
  /** Settlements found for the fingerprint across supplied forward-indexable bindings. */
  settlements?: unknown[];
  /** The buyer's presented signed acceptance over the fingerprint (TRM-6). */
  acceptance?: SignedAcceptance;
  /** The port that checks the acceptance's signature. Absent ⇒ the acceptance step cannot prove — a
   *  signature nobody checked is not evidence of a signature. The EVM impl is `binding-evm-common`'s. */
  acceptanceVerifier?: SignatureVerifier;
  /**
   * The ATA chain to check for attenuation + as-of revocation/expiry, ALREADY FLATTENED.
   *
   * Whoever produced this array is a trusted oracle — every field on a link is a derived fact the step
   * takes at face value. Prefer `authorityWalk`, which removes that trust. This door stays open because
   * a foreign conformance subject may legitimately derive its links some other way.
   */
  authorityChain?: AuthorityLink[];
  /**
   * The custody walk's readout (`authority.walkChain`) — the PREFERRED authority input.
   *
   * `authorityChain` cannot express what the walk found: a spliced link, an issuer discontinuity, a root
   * issued by someone other than the declared principal, a leaf granted to anyone but the acceptance
   * signer. Flattening a `refused` walk throws those away and hands over links that then read as a clean
   * `not-attempted`, so the report says the record simply did not carry a chain when in fact it carried
   * a contradictory one. Supplied here, the refusal reaches the report WITH its halt class, and the
   * walk's own gap depths pass through verbatim.
   *
   * Mutually exclusive with `authorityChain` — supplying both is a contradiction, not a precedence
   * question, so it throws rather than silently picking one (the same ruling `makeProposalRecord` makes
   * on its own exactly-one-of invariant).
   */
  authorityWalk?: ChainWalkResult;
  /** The accepted commitment vs the leaf grant's bounds (ATA-4). */
  commitment?: { commitment: Bounds; leafBounds: Bounds };
  /** Both parties' resolutions, each at a stated assurance (IDN-1/IDN-3) — the record's `identity` slot. */
  identity?: RecordIdentity;
  /** The retained evidence package's manifest roles (RCS-4 completeness; `RCS4_REQUIRED_ROLES` is the floor). */
  evidenceRoles?: readonly string[];
  /** The class the record is shaped for (default TC-2). The taxonomy is closed (TC-0..TC-4); a caller
   *  at a trust boundary validates untyped input before calling (Zod there, not here). */
  claimedClass?: TransactionClass;
  /** Verification depth (default "structural"). Mechanical depth lets `verified` be raised honestly. */
  depth?: VerifyDepth;
  /** The TC-4 commerce-plane slots. Absent ⇒ the composition steps are NOT appended to the walk
   *  (TC-0..TC-3 reports are byte-identical). Present ⇒ the four required composition steps + the
   *  impeachment-only `frc-non-gating` step are appended and flow through the existing machinery. */
  composition?: CompositionInput;
  /** The reference recovered from a commerce protocol's own document. Absent ⇒ the
   *  `reference-placement` step is NOT appended and every existing report stays byte-identical. Present ⇒
   *  the step is appended and flows through the same machinery as every other: it impeaches when it FAILS
   *  and never blocks by its absence. REPORTED, never REQUIRED — no class lists it. */
  placement?: PlacementInput;
}

/** Run the walk at the caller-specified `depth` (default `"structural"`) and emit the vector-anchored, JCS-serializable report. */
export async function verify(input: VerifyInput): Promise<VerificationReport> {
  if (input.authorityWalk !== undefined && input.authorityChain !== undefined)
    throw new Error(
      "verify: authorityWalk and authorityChain are mutually exclusive — a walked chain is already the readout, and flattening it alongside would ask which of two answers about the same chain to believe",
    );
  const steps: VerificationStep[] = [
    {
      name: "atr-fingerprint",
      outcome: await fingerprintStep(input.atrBytes, input.settledAtrHash),
    },
    {
      name: "settlement-enumeration",
      outcome: settlementStep(input.settlements),
    },
    {
      name: "buyer-acceptance",
      outcome: await acceptanceStep(
        input.acceptance,
        input.settledAtrHash,
        input.acceptanceVerifier,
      ),
    },
    {
      name: "authority-attenuation",
      // One step name either way: the report's shape does not change with how the caller obtained its
      // chain, only how much the walk was able to say about it.
      outcome:
        input.authorityWalk !== undefined
          ? authorityStepFromWalk(input.authorityWalk)
          : authorityStep(input.authorityChain),
    },
    { name: "commitment-vs-leaf", outcome: commitmentStep(input.commitment) },
    {
      name: "recourse-elections",
      outcome: recourseStep(input.atrBytes, input.evidenceRoles),
    },
    { name: "resolve-party", outcome: resolvePartyStep(input.identity) },
  ];

  // Append the TC-4 composition steps ONLY when a composition slot is supplied — the slot is additive:
  // a TC-0..TC-3 report that supplies none is byte-identical to one produced without the slot existing.
  // The appended steps flow through the same `computeSupportedClass`/`computeVerified` machinery as every
  // other, and are the only rungs by which a walk can reach TC-4 at all.
  if (input.composition !== undefined) {
    steps.push(
      { name: "offer-bound", outcome: offerBoundStep(input.composition) },
      { name: "operations-bound", outcome: operationsStep(input.composition) },
      {
        name: "discovery-integrity",
        outcome: discoveryIntegrityStep(input.composition),
      },
      {
        name: "proportionality-declared",
        outcome: proportionalityStep(input.composition),
      },
      {
        name: "frc-non-gating",
        outcome: frcNonGatingStep(input.composition),
      },
    );
  }

  // Append the reference-placement step ONLY when a placement slot is supplied — its own `if`, because a
  // placement is independent of a composition and a record may carry either, both, or neither. Absent ⇒
  // nothing is appended and existing reports stay byte-identical, which is what makes the slot additive.
  // Supplied ⇒ it flows through the same `computeSupportedClass`/`computeVerified` machinery as every
  // other step, so a placement that CONTRADICTS the record impeaches `supportedClass` to TC-0 — the one
  // power the step grants it, since no class requires it and it can therefore only pull the answer down.
  // Without this block the step would appear in no report and impeach nothing.
  if (input.placement !== undefined) {
    steps.push({
      name: "reference-placement",
      outcome: referencePlacementStep(input.placement, input.settledAtrHash),
    });
  }

  const found = input.settlements ?? [];
  const depth = input.depth ?? "structural";
  const claimed = input.claimedClass ?? "TC-2";
  const stepsForVerified = steps.map((s) => ({
    name: s.name as StepName,
    outcome: s.outcome,
  }));

  return {
    verified: computeVerified(stepsForVerified, claimed, depth),
    // The BUYER's stated level: the report's assurance answers "at what assurance did the party who
    // committed resolve?" — the seller's own level rides in the record's identity slot and the package.
    // `buyer` is optional-chained on purpose: `RecordIdentity` requires it, but this readout must be TOTAL
    // over the same half-shaped input `resolvePartyStep` is total over (an untyped caller, a foreign
    // conformance subject). A walk that throws on a malformed record cannot report the malformation.
    //
    // The fallback is NOT a ladder value. `wallet-signature-only` would be conservative in
    // direction, since it never inflates, but still a level the verifier elected for a record that stated
    // none, and the floor of a ladder reads as a finding rather than as silence. `no-assurance-stated` is
    // the SAME token `resolvePartyStep` emits for this condition (steps.ts), so absence has one spelling
    // across the step and the report instead of contradicting itself inside a single run.
    assurance: input.identity?.buyer?.assurance ?? "no-assurance-stated",
    claimedClass: claimed,
    supportedClass: computeSupportedClass(stepsForVerified),
    asOf: input.asOf,
    steps,
    coverage: input.coverage,
    settlements: { found, multiplySettled: found.length > 1 },
  };
}

/** Discriminant helper — did any step fail (the honest impeachment signal)? */
export function anyStepFailed(report: VerificationReport): boolean {
  return report.steps.some(
    (s: VerificationStep) => (s.outcome as StepOutcome).status === "failed",
  );
}
