/**
 * IDN-2 resolution chain. An identity that terminates in nothing but a key is not conformant *for
 * consequential transactions*: a bare key attributes a signature but resolves to no accountable party.
 * A resolution chain walks from the signing key through attestations/grants/domain control to a named
 * accountable party; `terminatesInAccountableParty` is the IDN-2 floor a consequential transaction needs.
 * The chain is substrate-open (CMP-5) — a step names HOW it resolves, not a specific attestation format.
 *
 * ⭐ **SUBSTRATE-OPEN IS NOT THE SAME AS SUBSTRATE-SILENT, AND A STEP USED TO BE BOTH.** A hop reading
 * `{via: "attestation", ref: "lcp:sha256:…"}` states that an attestation carried this hop and states
 * nothing a reader can act on: not the profile, not the substrate, not the assurance the attestation
 * claims to confer. `terminatesInAccountableParty` then counts that hop as reaching an accountable party
 * on the strength of the word `attestation` alone. The artifact is an opaque blob at exactly the point
 * where a reader needs to inspect it. {@link ResolutionStep.attestation} carries the envelope, and
 * {@link recordResolutionAttestations} reads out what every attestation hop stated — including the hops
 * that state nothing, which is the deficiency made visible rather than repaired.
 *
 * ⛔ **THE PREDICATES BELOW STAY SUBSTRATE-BLIND.** Neither consults a profile or a substrate, and neither
 * may be made to: a resolution that fails because its attestation lives somewhere this build does not
 * recognise is this implementation deciding which roots of trust count. The package tests pin an
 * accountable terminus on a substrate no implementation has ever heard of.
 */
import {
  type ProfiledAttestation,
  type RecordedAttestation,
  recordAttestation,
} from "./attestation-profile.js";

/** How one resolution step links to the next accountable layer. */
export type ResolutionVia =
  | "key" // the bare signing key (a terminal `key` alone fails IDN-2 for consequential transactions)
  | "domain-control" // the /.well-known origin the discovery document lives under
  | "attestation" // a profiled attestation (attestation-profile.ts)
  | "grant" // an ATA grant naming the party
  | "legal-party"; // a named legal entity — an accountable terminus

/** A stated assurance level (IDN-3: never a bare boolean — the level is always stated, honestly). */
export type Assurance =
  | "wallet-signature-only"
  | "domain-controlled"
  | "attested"
  | "legal-party";

/** One hop from a signing key toward an accountable party. `ref` is optional because not every hop has a
 *  backing artifact — and where it is absent the hop is an assertion, not evidence. */
export interface ResolutionStep {
  via: ResolutionVia;
  /** An `lcp:sha256:` reference or identifier for the artifact backing this step, where one exists. */
  ref?: string;
  /**
   * The profiled attestation this hop resolves BY, where `via` is `"attestation"` — the profile and the
   * substrate it lives on, so a reader can reach the artifact and check what this package did not.
   *
   * ⛔ OPTIONAL BECAUSE THE TREE MEASURED THAT WAY, not as a compatibility shim — this repository does not
   * keep those, so the question was put to the three repositories rather than assumed. `via: "attestation"`
   * hops that carry no artifact: **16, all in ONE consuming repository** — 4 in production `src/` across
   * three modules, 11 in tests, 1 in a gate fixture — against **0 anywhere that supply one**. Those
   * modules import `ResolutionStep` from this package by name, so requiring the field is a compile break
   * at every one of them, and the two repositories with no such hop cannot carry the decision for the one
   * that has them all. ⇒ It stays optional, and a hop that omits it reads out as the stated gap
   * `attestation-hop-carries-no-profile` — the deficiency made visible rather than papered over.
   *
   * ⚠️ Re-measure before changing this. The number is a fact about another repository on a given day; the
   * query is `git grep -n 'via: "attestation"'` over every package's source and test trees and the gate
   * scripts, and it is the count of hops WITHOUT an `attestation` beside them that decides. (Spelling the
   * pathspec here is not possible: a glob for every package's source directory closes this comment.)
   */
  attestation?: ProfiledAttestation;
}

/** Who a settlement's signing key resolves to, and how far that resolution actually got. `assurance` is
 *  always STATED, never a bare boolean (IDN-3): `wallet-signature-only` is a legitimate answer meaning the
 *  chain stops at a key. The IDN-2 floor asks whether `chain` terminates in more than a key; a resolution
 *  that does not is honest, not broken. */
export interface IdentityResolution {
  /** The signing key/address the settlement attributes. */
  subject: string;
  /** The stated assurance for this identity (IDN-3). */
  assurance: Assurance;
  /** The ordered resolution steps from the key toward an accountable party. */
  chain: ResolutionStep[];
}

/** IDN-2 floor: does the chain terminate in more than a key (an accountable party)? */
export function terminatesInAccountableParty(
  resolution: IdentityResolution,
): boolean {
  const last = resolution.chain[resolution.chain.length - 1];
  if (last === undefined) return false;
  return (
    last.via === "legal-party" ||
    last.via === "grant" ||
    last.via === "attestation"
  );
}

/** Is this identity conformant for a CONSEQUENTIAL transaction (IDN-2)? Bare wallet-signature is not. */
export function isConsequentialConformant(
  resolution: IdentityResolution,
): boolean {
  return (
    resolution.assurance !== "wallet-signature-only" &&
    terminatesInAccountableParty(resolution)
  );
}

/**
 * Read out every attestation hop of a resolution chain, in chain order — one
 * {@link RecordedAttestation} per `via: "attestation"` step, and none for any other via.
 *
 * TOTAL OVER ANY INPUT OF THE DECLARED SHAPE — not over untrusted input, and the distinction is the one
 * the comment in the body draws. It never throws and never refuses for any `IdentityResolution`-shaped
 * value, including one whose `chain` is absent, is not an array, or holds elements that are not objects;
 * it does NOT survive a `resolution` that is not an object at all, exactly as the two predicates above it
 * do not. An unreadable envelope, an unknown profile and a substrate no implementation has heard of all
 * read back, the first two as a stated gap and the third as an ordinary envelope. A hop that carries no
 * attestation at all reads back as the gap
 * `attestation-hop-carries-no-profile` — which is not a defect this function repairs but the one it makes
 * visible, because `terminatesInAccountableParty` counts such a hop as accountable and a reader looking at
 * the resolution alone cannot see that it rests on nothing they can fetch.
 *
 * ⛔ It states no verdict, and there is no arm of {@link RecordedAttestation} in which it could.
 */
export function recordResolutionAttestations(
  resolution: IdentityResolution,
): RecordedAttestation[] {
  // NOT `resolution?.chain`. The optional chain there guarded a caller the declared parameter cannot
  // produce, and no test reached it; `terminatesInAccountableParty` and `isConsequentialConformant` in
  // this same file dereference `resolution` unguarded, so a null-guard here alone would be a totality this
  // file does not otherwise offer. The SHAPE guard below stays — `chain` absent or non-array is ordinary
  // wire data, and two tests reach it.
  const chain: unknown = (resolution as { chain?: unknown }).chain;
  if (!Array.isArray(chain)) return [];
  const out: RecordedAttestation[] = [];
  for (const step of chain) {
    const via: unknown = (step as { via?: unknown } | undefined)?.via;
    if (via !== "attestation") continue;
    const attestation: unknown = (step as { attestation?: unknown })
      .attestation;
    out.push(
      attestation === undefined
        ? {
            status: "not-attempted",
            depth: "attestation-hop-carries-no-profile",
          }
        : recordAttestation(attestation),
    );
  }
  return out;
}
