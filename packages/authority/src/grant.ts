/**
 * The ATA grant + delegation link as W3C Verifiable Credentials 2.0 with Data Integrity proofs (IDN-4).
 * A grant authorizes a subject to act within `bounds` (ATA-2); a delegation link re-issues a narrower
 * grant from a parent — and MUST attenuate (`isWithin(link.bounds, parent.bounds)`), or a compromised
 * holder forges a wider link than it holds. `delegable`/`maxDepth` govern whether and how deep the chain
 * may extend. These are TYPES + the pure attenuation predicate over them; VC proof verification and
 * chain custody are the walk's (walk.ts, pure over an injected `GrantProofVerifier` port), signature
 * checks are pure over an injected port (acceptance.ts).
 */
import { type Bounds, isWithin } from "./bounds.js";

/** A VC 2.0 Data Integrity proof (structure only — cryptographic verification is port-injected). */
export interface DataIntegrityProof {
  type: string;
  created?: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;
}

/** The ATA grant's credential subject — the authority the holder may exercise. */
export interface GrantSubject {
  id: string;
  bounds: Bounds;
  /** May this grant be delegated onward? (default: false — undefined is treated as non-delegable). */
  delegable?: boolean;
  /** How many further links may extend below this one (0 = leaf). */
  maxDepth?: number;
}

/** An ATA grant / delegation link as a W3C VC 2.0. `validFrom`/`validUntil` bound its lifecycle (IDN-5). */
export interface AtaGrant {
  "@context": string[];
  type: string[];
  issuer: string;
  validFrom?: string;
  validUntil?: string;
  credentialSubject: GrantSubject;
  /**
   * Bitstring Status List entry (revocation) — checked as-of settlement (status.ts).
   *
   * `statusPurpose` is REQUIRED by Bitstring Status List v1.0 and required here for the same reason
   * `SignedAcceptance.signedAt` is: it is what the set bit MEANS. A bit set under `suspension` is not a
   * revocation, so an entry that omits its purpose states a status nobody can act on. Requiring it makes
   * that entry unconstructible rather than rejected at runtime — and the walk still screens it, because
   * the walk's input is untyped wire data that never passed through this type.
   */
  credentialStatus?: {
    type: string;
    statusListCredential: string;
    statusListIndex: string;
    statusPurpose: string;
  };
  proof?: DataIntegrityProof;
}

/**
 * Is a link's OWN stated depth usable as a bound? Only if it is finite — and `undefined` is not, which
 * is the point: below a depth-bounded parent an unstated depth is unbounded onward delegation, so it is
 * refused for the same reason an overstated one is. (A non-finite value is refused because `NaN`
 * compares false on both sides of the escalation arithmetic and would disengage the gate outright.)
 */
function usableDepth(depth: number | undefined): depth is number {
  return Number.isFinite(depth);
}

/**
 * Does a delegation link attenuate its parent? The parent permitted delegation, depth remains below it,
 * the link does not mint itself more onward-delegation depth than the parent held, AND the bounds are
 * contained.
 *
 * The depth check runs in BOTH directions deliberately. `isWithin` governs `bounds` and says nothing about
 * `delegable`/`maxDepth`, which live on `GrantSubject` beside them — so without the second comparison a
 * holder of a `maxDepth: 1` grant could issue a `maxDepth: 99` link, every pairwise check would pass, and
 * the chain would extend arbitrarily deep below a parent that authorized one more hop. Attenuation is a
 * property of the authority to delegate, not only of what is delegated.
 *
 * A link descending from a depth-bounded parent must STATE its own depth. An absent `maxDepth` means
 * unbounded onward delegation, so omitting it is the same escalation as overstating it — and reading it as
 * `parentDepth - 1` instead would be a silent fallback that also leaves the next link's parent depth
 * unstated, disengaging this gate for the remainder of the chain. Under an unbounded parent, anything goes.
 */
export function linkAttenuates(link: AtaGrant, parent: AtaGrant): boolean {
  if (parent.credentialSubject.delegable !== true) return false; // parent never permitted delegation
  const parentDepth = parent.credentialSubject.maxDepth;
  if (parentDepth !== undefined) {
    // FINITE, not merely stated: `NaN` compares false on BOTH sides of the arithmetic below
    // (`NaN <= 0`, `x > NaN - 1`), so a non-finite depth on EITHER side would disengage this gate
    // entirely and let a child state any onward depth. This predicate is a boolean PERMIT and cannot
    // express "gap", so a stated-but-unusable depth fails closed — false is the only honest answer.
    // JSON cannot express NaN, so no corpus vector can pin this; the pins are in this package's tests
    // (grant-acceptance.test.ts, beside the negative-depth cases). Negative and fractional depths stay
    // deliberately un-screened: the arithmetic already fails closed on them.
    if (!Number.isFinite(parentDepth)) return false;
    if (parentDepth <= 0) return false; // no depth left below the parent
    // ONE condition for both refusals, and deliberately so: `Number.isFinite(undefined)` is already
    // false, so testing absence separately would be a branch removable without changing any result.
    if (!usableDepth(link.credentialSubject.maxDepth)) return false;
    if (link.credentialSubject.maxDepth > parentDepth - 1) return false; // depth escalation
  }
  return isWithin(
    link.credentialSubject.bounds,
    parent.credentialSubject.bounds,
  );
}
