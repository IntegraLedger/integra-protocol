/**
 * The verification walk as an ordered table of typed steps. At STRUCTURAL depth each step is
 * presence/absence → outcome plus the pure checks it can do over supplied inputs (no live ports):
 * `proved | failed(haltClass) | indeterminate | not-attempted(depth)`. A step whose inputs are absent is
 * `not-attempted(<why>)` — coverage is honest depth, never a silent pass. These outcomes are depth-agnostic;
 * `verified` is computed FROM them by `computeVerified` (index.ts); the live-port gathering that raises
 * coverage to mechanical depth is the buyer gate's.
 *
 * Three rules hold across every step, and all three exist so the walk can never flatter a record:
 *   - ABSENT INPUTS NEVER PROVE. An empty authority chain, an acceptance with no verifier to check its
 *     signature, an identity with no resolution chain — each is `not-attempted`, never `proved`.
 *   - CONTRADICTIONS FAIL, GAPS DO NOT. `failed` is reserved for a record that contradicts itself (a
 *     fingerprint that does not match, a link that widens its parent, a signature that does not verify);
 *     it impeaches `supportedClass` to TC-0. Missing evidence is a gap: `not-attempted`, which leaves
 *     `verified` false without impeaching a record that simply did not carry that rung.
 *   - EVERY STEP IS TOTAL. Steps read their slots through `present` and shape-check before dereferencing,
 *     because the callers they exist for are untyped — a foreign conformance subject, an unvalidated
 *     intake. A malformed slot reads out as a gap, never as a `failed`: the caller's shape error says
 *     nothing about whether the record is self-consistent, and a walk that throws cannot report the
 *     malformation it was handed.
 *
 * The authority step is the load-bearing one. Every link must have been PERMITTED by its parent (ATA-3 —
 * the parent was delegable, it had depth left, and the link stated a depth that fits beneath what the
 * parent held; an unstated depth is unbounded and therefore an escalation like any other), must ATTENUATE
 * (`authority.isWithin`), and must be UNREVOKED and UNEXPIRED as-of settlement. Each failure is
 * `failed(verification-failure)`, never `proved`, so the walk can never affirm a forged chain — whether the
 * forgery widened the bounds or the authority to delegate them. These are the same four gates
 * `authority.linkAttenuates` enforces at issuance; producer and verifier must not diverge, and
 * `vectors/{authority/link-attenuates,verify/authority-walk}.json` pin both halves against each other.
 *
 * `authorityStep` reads a FLATTENED chain, every field of which is a derived fact it must take on trust.
 * `authorityStepFromWalk` is the path that removes that trust — it consumes `authority.walkChain`'s
 * readout directly, so the caller never flattens anything. Both are exported: the flattened door stays
 * open because a foreign conformance subject may legitimately derive its links some other way, and this
 * module's totality rule means such a caller gets an honest readout rather than a compile wall.
 */
import {
  type Bounds,
  type ChainWalkResult,
  commitmentWithinLeaf,
  type IdentityResolution,
  isWithin,
  type SignatureVerifier,
  type SignedAcceptance,
  verifyAcceptance,
} from "@integraledger/lcp-authority";
import { atrHashEquals, hashAtr } from "@integraledger/lcp-kernel";
import type { StepOutcome } from "./report.js";

/**
 * One link in the ATA chain, pre-resolved to what the structural walk checks — the verification-time
 * mirror of `authority.linkAttenuates`, whose four issuance gates it must all carry: the parent permitted
 * delegation, the parent had depth left, this link's depth fits beneath it, and the bounds are contained.
 *
 * `parentDelegable` is REQUIRED, not optional, and that is the point: `GrantSubject.delegable` is
 * non-delegable by default, so "the caller did not thread the flag" and "the parent refused delegation"
 * would be the same absent value — the exact ambiguity that turns an unverified rung into a proved one.
 * Requiring it makes the unstated case a compile error at the callsite instead of a silent pass.
 */
export interface AuthorityLink {
  bounds: Bounds;
  parentBounds: Bounds;
  /** ATA-3: did the PARENT grant permit delegation at all? A link below a non-delegable parent is forged. */
  parentDelegable: boolean;
  /** The parent's remaining delegation depth (0 = leaf, nothing may descend). Absent = unbounded. */
  parentMaxDepth?: number;
  /** This link's OWN remaining depth. It may not exceed `parentMaxDepth - 1` — a link cannot mint itself
   *  more latitude to delegate onward than the parent it descends from held.
   *
   *  Absent = unbounded, which is why omitting it BELOW A DEPTH-BOUNDED PARENT is itself an escalation and
   *  fails. Inferring `parentMaxDepth - 1` from the parent instead would be a silent fallback, and it would
   *  also leave the next hop's `parentMaxDepth` unstated, disengaging this gate for the rest of the chain.
   *  Under an unbounded parent the link may hold any depth, including none. */
  maxDepth?: number;
  /** Revoked as-of settlement, from the hash-pinned status-list snapshot.
   *
   *  REQUIRED, for the same reason `parentDelegable` is: "the flattener never consulted a status list"
   *  and "the walk checked the pinned snapshot and the link is unrevoked" are otherwise the same absent
   *  value, and one of them proves. `authority.WalkedLink` already states it always, never defaulted, so
   *  a walk-fed caller satisfies this for free and only a hand-flattener feels it — which is the point.
   *
   *  The compile error is not the whole gate, and must not be relied on as one — at runtime an absent value reads as
   *  unrevoked and PROVED, on the grounds that the corpus pinned that reading cross-implementation. The
   *  corpus was the thing to change, and on 2026-08-08 it was: absence now reads `not-attempted` with
   *  depth `no-revocation-stated`, and a non-boolean reads `malformed-authority-chain`. Type and runtime
   *  agree, so the untyped caller this step exists for gets the same answer a typed one is prevented from
   *  asking. */
  revoked: boolean;
  /** Temporally active as-of settlement (expiry). REQUIRED on the same grounds as `revoked` — an
   *  unstated liveness and a checked-and-live one must not be the same value. Runtime matches: absent is
   *  `not-attempted` with depth `no-liveness-stated`, its OWN token rather than revocation's, so a report
   *  never describes an expiry gap as something about revocation. */
  active: boolean;
}

/** Both parties' resolutions as the record's `identity` slot carries them (IDN-1/IDN-3). */
export interface RecordIdentity {
  seller: IdentityResolution;
  buyer: IdentityResolution;
}

/**
 * Is the ATR's `terms` slot an `lcp:sha256:` REFERENCE rather than the inlined document?
 *
 * Narrow on purpose. Only the content-addressed form means "the document lives elsewhere and must travel
 * with the package": an inlined string IS the document, and `lcp:ipfs:`/`lcp:ar:` are not what
 * `kernel.assemble` emits for the terms slot. A non-string slot is not a ref — it reads as absent here and
 * is the fingerprint step's business, not this one's.
 */
function isRefTerms(terms: unknown): boolean {
  return typeof terms === "string" && terms.startsWith("lcp:sha256:");
}

/**
 * RCS-4's required evidence roles — the specification's own enumeration of a self-contained package: the terms
 * artifact and fingerprint; the acceptance signature and its authority chain (ATA-6); the spend-authorization
 * artifact or a verifiable reference to it (ASP-5); the identity attestations relied on and their assurance
 * levels (IDN-3); the settlement reference and weld; timestamps. Its own conditional clause — fulfillment and
 * order-state, "where performance is disputed" (OPS-2) — is conditional and therefore NOT required here.
 */
export const RCS4_REQUIRED_ROLES: readonly string[] = [
  "atr",
  "signed acceptance",
  "authority chain",
  "spend artifact",
  "attestation",
  "settlement",
  "weld",
  "timestamp",
];

/**
 * Is a slot supplied at all? `=== undefined` is not enough over an untyped caller — a foreign conformance
 * subject or an unvalidated intake can hand in an explicitly `null` slot, which is *present* to that check
 * and then dereferences to a TypeError. `typeof null === "object"` slips it past shape guards too. Every
 * step reads its own slots through this, so a malformed record gets an honest `not-attempted` readout
 * rather than crashing the walk that exists to report on it. Typed callers cannot express the null case.
 */
function present<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

/** A bounds-shaped slot: an object `isWithin` can walk. Mirrors `authority.walkableBounds`'s own gate, which
 *  exists for the same reason — `isWithin` reads its arguments with `Object.keys`, which THROWS on `undefined`
 *  and `null`. `typeof` alone is not that check (`typeof null === "object"`), and an array is not it either:
 *  `Object.keys([])` answers indices, so an array would read as a bounds with no dimensions instead of being
 *  refused. Only the shape is screened here — UNKNOWN keys are `isWithin`'s fail-closed refusal to make, not
 *  a shape gap for this step to pre-empt. */
function boundsShaped(value: unknown): value is Bounds {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string that actually STATES something. `present` is not enough where the value IS the claim: `""` is
 *  a present string asserting nothing, and a walk that accepts it reports a fact nobody supplied. Blank
 *  runs count as empty — whitespace is not a subject and not a resolution method. */
function nonBlank(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Bytes `hashAtr` can actually digest. `SubtleCrypto.digest` does its own type check and THROWS on
 *  anything that is not a `BufferSource`, so this is the screen that keeps `fingerprintStep` total —
 *  `ArrayBuffer.isView` is exactly the set the primitive accepts as a view, and it is realm-agnostic where
 *  `instanceof Uint8Array` is not. A JSON-decoded `[123, 34, 97, 125]` is the shape this exists for: it is
 *  what an HTTP intake produces for `{"atrBytes":[…]}`, and it is neither bytes nor refused by `typeof`. */
function digestibleBytes(value: unknown): boolean {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

/** Recompute the fingerprint over the retrieved ATR bytes and compare to what the settlement committed. */
export async function fingerprintStep(
  atrBytes: Uint8Array | undefined,
  settledAtrHash: string | undefined,
): Promise<StepOutcome> {
  if (!present(atrBytes)) return { status: "indeterminate" }; // unretrievable ATR — not a failure
  // A slot that is not bytes is the caller's shape error, and it is NOT `indeterminate`: `indeterminate`
  // says the ATR could not be retrieved, and something WAS supplied here. `not-attempted` under its own
  // name, like every other malformed slot in this module.
  if (!digestibleBytes(atrBytes))
    return { status: "not-attempted", depth: "malformed-atr-bytes" };
  if (!present(settledAtrHash))
    return { status: "not-attempted", depth: "no-settled-hash" };
  const recomputed = await hashAtr(atrBytes);
  // Decoded-byte comparison per LCP §2.5. This is the rung that proves the settlement committed to THIS
  // document, so a comparison that could answer `true` for two malformed strings is the wrong primitive.
  return atrHashEquals(recomputed, settledAtrHash)
    ? { status: "proved" }
    : { status: "failed", haltClass: "verification-failure" };
}

/** Settlement enumeration across supplied forward-indexable bindings (multiply-settled flag). */
export function settlementStep(
  settlements: unknown[] | undefined,
): StepOutcome {
  // A non-array in the slot is not an enumeration — `.length` on it is `undefined` on an object, a number
  // or a boolean, and `undefined === 0` is false, so every one of them fell through to `proved` with ZERO
  // settlements enumerated. `{ length: 5 }` is the sharpest case: a duck-typed object that answers the
  // only question this step used to ask. That is this module's capitalised rule read backwards — ABSENT
  // INPUTS NEVER PROVE — on the rung that carries TC-1. Same screen, same reasoning and the same token as
  // an absent slot, exactly as `authorityStep` rules on a non-array chain: the caller supplied nothing
  // this step can enumerate, which is distinct from a real port that enumerated nothing.
  if (!present(settlements) || !Array.isArray(settlements))
    return { status: "not-attempted", depth: "no-enumeration-port" };
  if (settlements.length === 0)
    return { status: "not-attempted", depth: "no-settlement-found" };
  return { status: "proved" };
}

/**
 * TRM-6: the buyer's acceptance over the fingerprint, SIGNED and TIMESTAMPED. The signature is checked
 * through `authority.verifyAcceptance` over the injected `SignatureVerifier` port (the EVM implementation
 * — EOA EIP-191/712 and smart-account ERC-1271/6492 — is `binding-evm-common`'s).
 *
 * WITHOUT A VERIFIER THIS STEP CANNOT PROVE. A signature nobody checked is not evidence of a signature, so
 * an acceptance presented with no verifier is `not-attempted("no-signature-verifier")` — the honest readout
 * of "this record carries an acceptance whose cryptography this verifier was not equipped to check".
 * `signedAt` needs no separate gate: `SignedAcceptance` requires it, so an untimestamped acceptance is
 * unrepresentable rather than rejected at runtime — illegal states are not constructible.
 */
export async function acceptanceStep(
  acceptance: SignedAcceptance | undefined,
  settledAtrHash: string | undefined,
  verifier: SignatureVerifier | undefined,
): Promise<StepOutcome> {
  if (!present(acceptance))
    return { status: "not-attempted", depth: "no-acceptance" };
  if (!present(settledAtrHash))
    return { status: "not-attempted", depth: "no-settled-hash" };
  if (!present(verifier))
    return { status: "not-attempted", depth: "no-signature-verifier" };
  const outcome = await verifyAcceptance(acceptance, settledAtrHash, verifier);
  return "refused" in outcome
    ? { status: "failed", haltClass: outcome.haltClass }
    : { status: "proved" };
}

/** Walk the ATA chain: every link attenuates (isWithin), is unrevoked, and is unexpired as-of settlement. */
export function authorityStep(chain: AuthorityLink[] | undefined): StepOutcome {
  // A non-array in the slot is not a chain — `.length` on it is meaningless and `for…of` throws.
  if (!present(chain) || !Array.isArray(chain))
    return { status: "not-attempted", depth: "no-authority-chain" };
  // An empty chain walks nothing. Proving it would let a record with no delegated authority whatsoever
  // clear the ATA rung — the gap that let placeholder chains carry a class they never earned.
  if (chain.length === 0)
    return { status: "not-attempted", depth: "empty-authority-chain" };
  for (const link of chain) {
    // An element that is not a link makes the chain UNWALKABLE. That is a gap, not a contradiction: the
    // caller handed over something malformed, which says nothing about whether the record is self-
    // consistent. Reporting it as `failed` would impeach a record to TC-0 over the caller's shape error.
    if (!present(link) || typeof link !== "object")
      return { status: "not-attempted", depth: "malformed-authority-chain" };
    // ATA-3, gate one: the parent must have permitted delegation at all. Impeccably attenuated bounds
    // re-issued by a holder who was never authorized to re-issue them are still a forged link.
    //
    // TYPE-SCREENED FIRST, on the same rule as `revoked` and `active` below and as
    // `authority.walkableGrant` applies to `delegable` on the producing side. Read for truthiness alone
    // this gate answered `proved` for every non-boolean but `0` and `""` — the strings `"false"`, `"no"`
    // and `"0"`, an empty array, an empty object — so the word that DENIES permission read as permission
    // and the load-bearing delegation rung cleared on a value nobody stated.
    //
    // ABSENCE parts company with the two siblings here, and only here. `revoked` and `active` name their
    // own gaps because "never consulted" and "consulted and clean" are different facts; delegability has
    // no such gap, because ATA-3 fixes a restrictive DEFAULT — unstated is non-delegable, which is a
    // ruling and stays `failed`. That is why the screen sits behind `present` rather than in front of it.
    if (
      present(link.parentDelegable) &&
      typeof link.parentDelegable !== "boolean"
    )
      return { status: "not-attempted", depth: "malformed-authority-chain" };
    if (!link.parentDelegable)
      return { status: "failed", haltClass: "verification-failure" };
    // ATA-3, gate two: depth. A depth-exhausted parent admits no link below it, and a link may not mint
    // itself more onward-delegation latitude than the parent held (`isWithin` governs bounds, not depth).
    // An UNSTATED child depth means unbounded, so under a bounded parent it is an escalation like any
    // other — the same reason `parentDelegable` is required rather than defaulted.
    if (present(link.parentMaxDepth)) {
      // FINITE, not merely present. `NaN` compares false on BOTH sides of the arithmetic below
      // (`NaN <= 0`, `x > NaN - 1`), so a non-finite depth on either side disengages this gate and the
      // link reaches `proved` with its depth never actually checked. It reads out as a GAP, not a
      // failure, under this step's own discipline: a caller's type corruption is a malformed slot, and
      // says nothing about whether the RECORD contradicts itself — the same ruling the walk makes on the
      // same value (`authority.walkChainStructure`, which refuses it as `malformed-authority-chain`), so
      // walk and step stay categorically aligned. JSON cannot express NaN, so no corpus vector can pin
      // this; the pins are in this package's tests. Negative and fractional depths stay deliberately
      // un-screened: the arithmetic already fails closed on them.
      if (!Number.isFinite(link.parentMaxDepth))
        return { status: "not-attempted", depth: "malformed-authority-chain" };
      if (link.parentMaxDepth <= 0)
        return { status: "failed", haltClass: "verification-failure" };
      // Absent and non-finite part company HERE, and only here: an unstated child depth is unbounded,
      // which under a bounded parent is a real escalation the record committed (`failed`), while a
      // non-finite one is the caller's corruption (`not-attempted`).
      if (!present(link.maxDepth))
        return { status: "failed", haltClass: "verification-failure" };
      if (!Number.isFinite(link.maxDepth))
        return { status: "not-attempted", depth: "malformed-authority-chain" };
      if (link.maxDepth > link.parentMaxDepth - 1)
        return { status: "failed", haltClass: "verification-failure" };
    }
    // The bounds slots must be WALKABLE before they can be compared. `isWithin` reads both sides with
    // `Object.keys`, so an absent, null or non-object slot throws there — and this module's contract is
    // totality over its inputs, not over well-formed inputs. `not-attempted` rather than `failed`, for the
    // same reason a non-finite depth is: a caller's shape corruption says nothing about whether the RECORD
    // contradicts itself, and answering `failed` would impeach a record to TC-0 over the caller's mistake.
    // A well-formed readout always carries objects — `authority.walkChainStructure` supplies `{}` for a root
    // link's `parentBounds` — and it refuses this same value as `malformed-authority-chain`, so walk and step
    // stay categorically aligned.
    if (!boundsShaped(link.bounds) || !boundsShaped(link.parentBounds))
      return { status: "not-attempted", depth: "malformed-authority-chain" };
    if (!isWithin(link.bounds, link.parentBounds))
      return { status: "failed", haltClass: "verification-failure" }; // forged widening
    // Revocation and liveness, and the ONE place this step used to flatter a record. Both slots are
    // compile-time REQUIRED, so a typed caller cannot reach the absent arm and `authorityStepFromWalk`
    // never could — but this step's whole contract is totality over UNTYPED input, and for that caller an
    // omitted `revoked` used to read as unrevoked and PROVE. That is the permissive direction of the one
    // rule this module states in capitals: "the flattener never consulted a status list" and "the pinned
    // snapshot says unrevoked" are not the same fact, and only one of them may prove.
    //
    // Absence is therefore a gap with its own name, a contradiction still fails, and a non-boolean is the
    // caller's shape error — the same three-way split the depth gate above already makes. The order also
    // matters and is pinned: a link that BOTH widens and omits its status fails, because `isWithin` runs
    // first and a contradiction outranks a gap.
    if (!present(link.revoked))
      return { status: "not-attempted", depth: "no-revocation-stated" };
    if (typeof link.revoked !== "boolean")
      return { status: "not-attempted", depth: "malformed-authority-chain" };
    if (link.revoked)
      return { status: "failed", haltClass: "verification-failure" };
    if (!present(link.active))
      return { status: "not-attempted", depth: "no-liveness-stated" };
    if (typeof link.active !== "boolean")
      return { status: "not-attempted", depth: "malformed-authority-chain" };
    if (!link.active)
      return { status: "failed", haltClass: "verification-failure" }; // expired
  }
  return { status: "proved" };
}

/**
 * The WALK-FED authority step — `authority.walkChain`'s readout mapped onto a `StepOutcome`. Prefer it.
 *
 * `authorityStep` accepts any `AuthorityLink[]`, which makes whoever produced that array a trusted
 * oracle: every field on a link is a DERIVED fact (`parentDelegable`, `parentMaxDepth`, `parentBounds`,
 * `revoked`, `active`), and the step takes each at face value. A flattener that never verified custody —
 * never checked that link N+1 was signed by link N's subject, never dereferenced a status list — yields a
 * confident `proved`. A caller that walks first constructs no link at all and cannot make that mistake.
 *
 * The mapping needs no interpretation, because `ChainWalkResult` already draws this module's own line:
 * `refused` is a reasoned CONTRADICTION (a spliced link, an issuer discontinuity, a forged widening, a
 * revoked grant) and carries the halt class with it; `not-attempted` is the walk's honest GAP, its depth
 * passed through verbatim; `walked` hands over links whose every field the walk STATED rather than
 * defaulted. Re-proving those links through `authorityStep` is deliberate rather than redundant — it is
 * what stops the custody walk and the verification step from drifting apart, and
 * `packages/conformance/the repository's walk-readout tests` pins that the walk's output is exactly what the step
 * proves. Total over untyped input like every step here: an unrecognized readout carries no links, so it
 * falls through to `authorityStep`'s own gap rather than throwing.
 */
export function authorityStepFromWalk(
  walk: ChainWalkResult | undefined,
): StepOutcome {
  if (!present(walk) || typeof walk !== "object")
    return { status: "not-attempted", depth: "no-authority-walk" };
  if (walk.status === "refused")
    return { status: "failed", haltClass: walk.haltClass };
  if (walk.status === "not-attempted")
    return { status: "not-attempted", depth: walk.depth };
  return authorityStep(walk.links);
}

/** ATA-4: the accepted commitment must be contained by the leaf grant's bounds. */
export function commitmentStep(
  c: { commitment: Bounds; leafBounds: Bounds } | undefined,
): StepOutcome {
  // Both halves must be usable bounds objects. `isWithin` is the pure ATA-2 predicate and is deliberately
  // strict — it does `Object.keys` on what it is given — so the walk, not the predicate, owns the totality
  // at this boundary. A half-supplied commitment slot is no commitment: a gap, never a contradiction.
  //
  // The halves go through `boundsShaped`, which is the screen written for exactly this and was never
  // carried here. `typeof x !== "object"` admits an ARRAY, and `Object.keys([])` answers `[]` rather than
  // throwing — so `isWithin` read an array as a bounds with NO dimensions, i.e. unbounded, and skipped all
  // four gates. A $50M commitment therefore cleared the ATA-4 containment rung against a leaf grant that
  // was never readable, while `authorityStep` answered `malformed-authority-chain` on the same value.
  // ⚠️ `{}` PROVING is correct and is not what this closes: ATA-2 makes an absent dimension unbounded, so
  // an empty-object leaf bounds nothing. Only the array is the defect.
  if (
    !present(c) ||
    typeof c !== "object" ||
    !boundsShaped(c.commitment) ||
    !boundsShaped(c.leafBounds)
  )
    return { status: "not-attempted", depth: "no-commitment" };
  return commitmentWithinLeaf(c.commitment, c.leafBounds)
    ? { status: "proved" }
    : { status: "failed", haltClass: "verification-failure" };
}

/**
 * RCS-1/2/4: the elections the record carries and the package it produced.
 *
 * The elections are read from THE HASHED RECORD ITSELF — `atrBytes` parsed as the ATR — never from
 * a caller-supplied side channel, because RCS-1 requires the forum designation "recorded inside the terms
 * record" (TRM-9). What this step proves is therefore what was welded.
 *
 * This step NEVER returns `failed`. An unelected forum is a record that did not reach for the rung, not a
 * record that contradicts itself, and impeaching `supportedClass` to TC-0 over it would misreport a
 * perfectly coherent TC-2. Likewise a non-machine-readable ATR (a ratified prose template, a PDF) is an
 * honest coverage gap: a human forum can read a governing-law clause a verifier cannot.
 */
export function recourseStep(
  atrBytes: Uint8Array | undefined,
  evidenceRoles: readonly string[] | undefined,
): StepOutcome {
  if (!present(atrBytes))
    return { status: "not-attempted", depth: "no-atr-bytes" };
  const atr = parseAtr(atrBytes);
  if (!present(atr))
    return { status: "not-attempted", depth: "atr-not-machine-readable" };
  const recourse = atr["recourse"];
  if (!present(recourse) || typeof recourse !== "object")
    return { status: "not-attempted", depth: "no-elections-recorded" };
  const elections = recourse as Record<string, unknown>;
  if (!stated(elections["forum"]))
    return { status: "not-attempted", depth: "no-forum-elected" }; // RCS-1
  if (!stated(elections["governingLaw"]))
    return { status: "not-attempted", depth: "no-governing-law-elected" }; // RCS-2
  // RCS-4. A slot that is not an ARRAY is no package at all, and reads out under the same token an absent
  // one gets — the ruling `authorityStep` makes on a non-array chain. Two reasons, and both are live:
  // `new Set` raises on a non-iterable, so `{}`, `42` and `true` threw out of a module whose contract is
  // totality; and a STRING is iterable, so `"atr"` quietly became a three-role package of `a`, `t`, `r`,
  // which is worse than the throw because it answers. A real empty array is untouched and still reads
  // `evidence-package-incomplete`: it was supplied and is short, which is a different fact from absent.
  if (!present(evidenceRoles) || !Array.isArray(evidenceRoles))
    return { status: "not-attempted", depth: "no-evidence-package" };
  const supplied = new Set(evidenceRoles);
  if (!RCS4_REQUIRED_ROLES.every((role) => supplied.has(role)))
    return { status: "not-attempted", depth: "evidence-package-incomplete" };
  // CONDITIONAL, and this is the rung the role list alone cannot express. An ATR may carry its terms
  // INLINE — then the ATR artifact is the document, and the list above is already complete — or by
  // `lcp:sha256:` REFERENCE, in which case the package holds a fingerprint of a document it does not
  // contain. A hash without a document is a proof without evidence (LCP §5.5, TRM-7), and the forum that
  // opens the package years later receives the fingerprint of something nobody retained.
  //
  // Required IFF the terms slot is a ref, because an unconditional role would fail every honest
  // inline-terms package. `manifest.schema.json` already stated this rule; nothing enforced it.
  if (isRefTerms(atr["terms"]) && !supplied.has("referenced terms document"))
    return { status: "not-attempted", depth: "referenced-terms-not-retained" };
  return { status: "proved" };
}

/**
 * IDN-1/IDN-3: both parties resolve, each at a STATED assurance level, over a non-empty resolution chain.
 *
 * IDN-2 — does the chain terminate in an accountable party rather than a bare key? — is deliberately NOT a
 * gate here. It is the counterparty-trust question a BUYER's policy asks (`authority.isConsequentialConformant`,
 * applied by the gate), not a property of the record's class: a record that honestly states
 * `wallet-signature-only` is conformant at its level, and IDN-3's whole discipline is that the low level
 * stated honestly passes while an unstated level does not.
 */
export function resolvePartyStep(
  identity: RecordIdentity | undefined,
): StepOutcome {
  if (!present(identity))
    return { status: "not-attempted", depth: "no-identity" };
  // A party that is absent or carries no resolution chain is an UNRESOLVED party, not a crash: the step is
  // total over its input, so a foreign conformance subject feeding a half-shaped identity gets an honest
  // readout instead of a TypeError. Typed callers cannot express this — `RecordIdentity` requires both.
  for (const party of [identity.seller, identity.buyer]) {
    if (!present(party) || !present(party.chain))
      return { status: "not-attempted", depth: "no-resolution" };
    if (party.chain.length === 0)
      return { status: "not-attempted", depth: "no-resolution-chain" };
    // IDN-1 — the statement of WHO. A party resolved to nobody is unresolved.
    if (!nonBlank(party.subject))
      return { status: "not-attempted", depth: "no-subject" };
    // IDN-3 — the statement of HOW. Array LENGTH is not evidence: `[{}]` and `[{via:""}]` are non-empty
    // arrays that record nothing, and honouring them proved attribution for an identity naming no method
    // at all. Every entry must say how, or the chain is present in shape only.
    if (!party.chain.every((step) => nonBlank(step?.via)))
      return { status: "not-attempted", depth: "no-resolution-method" };
    // IDN-3 — the statement of AT WHAT LEVEL. A party whose resolution names no assurance stated nothing
    // to pass honestly at: absence is a gap, exactly as a blank `subject` or `via` is. Typed callers cannot
    // omit it (`IdentityResolution` requires `assurance`); this gate exists for the untyped ones.
    if (!nonBlank(party.assurance))
      return { status: "not-attempted", depth: "no-assurance-stated" };
  }
  return { status: "proved" };
}

/** The placement slot: what a commerce protocol's own document yielded, and nothing else. `extracted` is
 *  the `ExtractedAdvertisement` a `ReferencePlacementAdapter.extract` returned — the reference under
 *  `ref`, the terms-URL reading beside it. This step compares the REFERENCE against the record
 *  fingerprint and deliberately ignores `termsUrl`: where the terms live is the gate's fetch concern,
 *  not a fact the record can contradict. Absent ⇒ the step is a gap. */
export interface PlacementInput {
  readonly extracted?: unknown;
}

/**
 * The reference-placement step — did the reference found in the protocol's native field match this record?
 *
 * REPORTED, NEVER REQUIRED: no class lists it in `REQUIRED_STEPS`, so its absence never blocks, and it
 * impeaches only when it FAILS — the `frc-non-gating` pattern exactly. A protocol that never settles has
 * nothing to enumerate, and letting a placement stand in for a settlement rung would let a record that
 * moved no money read as classed.
 *
 * Total, like every step: the shape checks stay even though the arguments are typed, because the callers
 * this exists for are untyped — a foreign conformance subject, an unvalidated intake. A malformed
 * extraction is a GAP, never a `failed`: the caller's shape error says nothing about whether the record
 * contradicts itself.
 */
export function referencePlacementStep(
  placement: PlacementInput | undefined,
  settledAtrHash: string | undefined,
): StepOutcome {
  if (!present(placement))
    return { status: "not-attempted", depth: "no-placement-input" };
  const extracted: unknown = placement.extracted;
  if (extracted === undefined)
    return { status: "not-attempted", depth: "no-reference-extracted" };
  const ref: unknown =
    typeof extracted === "object" && extracted !== null
      ? (extracted as { ref?: unknown }).ref
      : undefined;
  if (
    typeof ref !== "object" ||
    ref === null ||
    typeof (ref as { value?: unknown }).value !== "string"
  )
    return { status: "not-attempted", depth: "malformed-extracted-reference" };
  if (typeof settledAtrHash !== "string")
    return { status: "not-attempted", depth: "no-record-fingerprint" };

  // Both sides are NORMALIZED to the canonical 0x-prefixed lower-case form, not stripped to bare digits.
  // Hex is case-insensitive, so a conformant uppercase counterparty must not be false-negatived. And a
  // missing `0x` is a CARRIER-FORM defect that `binding-core`'s decoder already refuses upstream at
  // extract time — failing here would drive `supportedClass` to TC-0 over formatting, impeaching a record
  // whose reference names it correctly. Impeachment is reserved for a reference naming a DIFFERENT record.
  const canonical = (h: string): string => {
    const lower = h.toLowerCase();
    return lower.startsWith("0x") ? lower : `0x${lower}`;
  };
  if (canonical((ref as { value: string }).value) !== canonical(settledAtrHash))
    return { status: "failed", haltClass: "verification-failure" };
  return { status: "proved" };
}

/** A non-empty, non-blank string statement — an empty election is not an election. */
function stated(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Parse the ATR bytes as a kernel-assembled ATR, or `undefined` when they are not one (prose, PDF, foreign JSON). */
function parseAtr(atrBytes: Uint8Array): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(atrBytes));
  } catch {
    return undefined; // not JSON at all — a prose or binary terms artifact
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const atr = parsed as Record<string, unknown>;
  // `atrVersion` is engine-stamped by kernel.assemble on every record — its absence means these bytes are not a
  // kernel-assembled ATR, whatever else they may be.
  return typeof atr["atrVersion"] === "string" ? atr : undefined;
}
