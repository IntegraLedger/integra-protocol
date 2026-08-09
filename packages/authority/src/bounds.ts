/**
 * ATA-2 bounds attenuation as a meet-semilattice. `isWithin(child, parent)` is true iff the child's
 * bounds are no wider than the parent's, **dimension by dimension, with a stated rule for every dimension
 * {@link Bounds} defines** — a dimension the predicate has no semantics for is one it cannot check, so
 * unknown bound keys **fail closed**. This is the predicate whose absence lets a compromised officer
 * holding a $10k grant mint itself a $50M link (entirely within its authority to *delegate*) while every
 * signature and revocation check still passes — the verifier would then affirmatively assert the forged
 * chain valid.
 *
 * **`Bounds` is four dimensions, and that is NARROWER than ATA-2 asks for.** ATA-2 states commitment caps
 * as "monetary value, duration, recurring obligation"; only the monetary one has a home here. Time-based
 * and recurrence caps are therefore not merely unimplemented — `hasOnlyKnownKeys` fails closed, so a
 * deployment cannot add one without changing this package. That is deliberate on both halves: fail-closed
 * is correct, because a dimension nobody wrote a rule for is one nobody can check; and a containment rule
 * over time has several defensible readings, so choosing one here would make the reference implementation
 * define a protocol semantic rather than implement one. Read the claim above as scoped to this type.
 *
 * The rules (the load-bearing one is the inverted fourth):
 * - `jurisdictions`   — child ⊆ parent (set subset)
 * - `caps`            — child ≤ parent, per currency, decimal-integer base units
 * - `disputeMethods`  — child ⊆ parent (an acceptable-methods set attenuates by narrowing)
 * - `forbiddenClauseCategories` — child ⊇ parent (**INVERTED**: a restriction set attenuates by
 *   forbidding *more*; a child that DROPS a parent's forbidden category has WIDENED — the case an
 *   implementer pattern-matching subset from `jurisdictions` writes as a silent forged-widening hole).
 *
 * The same predicate serves ATA-4's commitment-vs-leaf containment: `isWithin(commitment, leaf.bounds)`.
 */

/** The ATA-2 bound dimensions. A parent dimension left `undefined` is unbounded (child always within it). */
export interface Bounds {
  jurisdictions?: string[];
  /** Per-currency spend caps, decimal-integer base-unit strings. */
  caps?: Record<string, string>;
  disputeMethods?: string[];
  forbiddenClauseCategories?: string[];
}

const KNOWN_KEYS = new Set([
  "jurisdictions",
  "caps",
  "disputeMethods",
  "forbiddenClauseCategories",
]);

/** Every key present on either side must be a known ATA-2 dimension (else no rule exists → fail closed). */
function hasOnlyKnownKeys(b: Bounds): boolean {
  for (const k of Object.keys(b)) if (!KNOWN_KEYS.has(k)) return false;
  return true;
}

/** child ⊆ parent (every child element is in parent). */
function subset(child: string[], parent: string[]): boolean {
  const p = new Set(parent);
  return child.every((c) => p.has(c));
}

/** child ⊇ parent (every parent element is in child) — the inverted direction for restriction sets. */
function superset(child: string[], parent: string[]): boolean {
  const c = new Set(child);
  return parent.every((p) => c.has(p));
}

const INT_RE = /^\d+$/;

/** Every child cap currency must be authorized by the parent and be ≤ the parent's cap (big-integer safe). */
function capsWithin(
  child: Record<string, string>,
  parent: Record<string, string>,
): boolean {
  for (const [cur, childVal] of Object.entries(child)) {
    const parentVal = parent[cur];
    if (parentVal === undefined) return false; // currency the parent never authorized — widened
    if (!INT_RE.test(childVal) || !INT_RE.test(parentVal)) return false; // non-integer → cannot compare, fail closed
    if (BigInt(childVal) > BigInt(parentVal)) return false;
  }
  return true;
}

/**
 * Is the child's authority contained within the parent's? All four ATA-2 dimensions; unknown keys fail
 * closed. **Every gate is on the PARENT's side:** wherever the parent restricts a dimension, the child
 * MUST restrict it no wider — an ABSENT child dimension is UNBOUNDED (the widest possible), so it does
 * NOT escape a restricting parent (the forged-empty-link `{}` is rejected, not affirmed). A parent that
 * leaves a dimension undefined is unbounded there and the child may hold anything on it.
 */
export function isWithin(child: Bounds, parent: Bounds): boolean {
  if (!hasOnlyKnownKeys(child) || !hasOnlyKnownKeys(parent)) return false;

  if (parent.jurisdictions !== undefined) {
    // Absent child.jurisdictions = unbounded jurisdiction = wider than any restricting parent → reject.
    if (
      child.jurisdictions === undefined ||
      !subset(child.jurisdictions, parent.jurisdictions)
    )
      return false;
  }
  if (parent.caps !== undefined) {
    // Absent child.caps = unbounded spend = wider than a capped parent → reject. (An explicit empty
    // `caps: {}` is MORE restrictive — no currency authorized — and passes capsWithin trivially.)
    if (child.caps === undefined || !capsWithin(child.caps, parent.caps))
      return false;
  }
  if (parent.disputeMethods !== undefined) {
    if (
      child.disputeMethods === undefined ||
      !subset(child.disputeMethods, parent.disputeMethods)
    )
      return false;
  }
  // Inverted: the child must forbid AT LEAST everything the parent forbids (child ⊇ parent). Absent
  // child.forbiddenClauseCategories = forbids nothing = wider than a parent that forbids something → reject.
  if (parent.forbiddenClauseCategories !== undefined) {
    if (
      !superset(
        child.forbiddenClauseCategories ?? [],
        parent.forbiddenClauseCategories,
      )
    )
      return false;
  }
  return true;
}
