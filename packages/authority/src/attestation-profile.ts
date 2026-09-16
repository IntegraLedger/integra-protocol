/**
 * Profiled attestations interpreted GENERICALLY — the CMP-5 "stranger" reads an attestation by its
 * declared profile without the verifier hardcoding a substrate (EAS, a VC, a notarization). The profile
 * names the substrate + the claim shape; the walk stays substrate-open. This package does not verify any
 * one substrate's cryptography, and NO PORT HERE DOES EITHER — checking an attestation is the reader's
 * act, and this repository offers no seam through which it could be delegated back to the appliance. What
 * this package does is interpret the envelope, so an unknown-but-profiled attestation is a first-class,
 * inspectable input rather than an opaque blob, and carry the reference the reader needs to do the rest.
 *
 * ⚠️ The two sentences above used to promise a substrate-adapter port, "pure over a port", as though the
 * verification were merely elsewhere. It is not elsewhere: no such port exists in any package's `src/`,
 * and one is not coming, because a verifier this package owned would be the thing whose word makes a
 * record meaningful. The promise read as a forward reference and was a description of something nobody
 * was going to build.
 *
 * ⛔ **NOTHING HERE MAY CONSULT THE VALUE OF `substrate`.** A verifier that keeps a set of substrates it
 * accepts has converted an open vocabulary into a roster, and a roster makes this implementation the judge
 * of which roots of trust count — which is being a root of trust one level up. The recorder below therefore
 * reads `substrate` as an opaque non-empty string and compares it with nothing. That is a structural
 * property of this file, not a style preference, and the package tests pin it with a substrate no
 * implementation has ever heard of.
 *
 * ⭐ **WHAT A RECORDED ATTESTATION SAYS ABOUT ITSELF.** A reader of a record needs to know what was checked
 * and what was not, and a sentence in a comment cannot travel with the value. {@link RecordedAttestation}
 * carries the answer in its own type: the envelope the presenter stated, beside an
 * {@link AttestationSubstrateCheck} whose only inhabitant is `not-attempted`. There is no arm in which this
 * package claims to have checked a substrate, so no consumer can read one out and none can be added without
 * changing this type in front of a reviewer. The parties verify; the record carries the artifact so they can.
 */

/** A named attestation profile — the substrate + the claim it makes, by reference. */
export interface AttestationProfile {
  /** The profile identifier (e.g. "eas:v1", "vc:proof-of-identity") — how to interpret `claim`. */
  profile: string;
  /** The substrate the attestation lives on (e.g. "eas", "vc-2.0", "x509"). */
  substrate: string;
}

/** A profiled attestation: its profile + the subject it attests + the raw claim, by content reference. */
export interface ProfiledAttestation {
  profile: AttestationProfile;
  /** The subject this attestation is about (the party/key it vouches for). */
  subject: string;
  /** The stated assurance this attestation confers, if any. */
  assurance?: string;
  /** An `lcp:sha256:` reference to the attestation artifact — the handle a READER fetches it by, so they
   *  can check what nothing in this package checked. Not verified here and not verified anywhere in this
   *  repository. */
  ref: string;
}

/** Interpret the envelope of a profiled attestation without touching its substrate cryptography. */
export function readAttestationProfile(a: ProfiledAttestation): {
  substrate: string;
  subject: string;
  assurance: string | undefined;
} {
  return {
    substrate: a.profile.substrate,
    subject: a.subject,
    assurance: a.assurance,
  };
}

/**
 * The one thing this package can honestly say about an attestation's substrate: it did not look.
 *
 * It is a STATED gap rather than an absence, for the reason `WalkedLink.revoked` is absent rather than
 * `false`, read from the other end: "no substrate check was performed" and "the substrate checked out" must
 * never be the same value, and here there is no slot to be absent from, so the gap is written down.
 */
export const ATTESTATION_SUBSTRATE_NOT_CHECKED = "substrate-not-checked-here";

/**
 * Whether the substrate's own cryptography was checked when the attestation was recorded. It was not, and
 * this type has exactly one inhabitant saying so — the arm that would claim otherwise does not exist.
 */
export interface AttestationSubstrateCheck {
  status: "not-attempted";
  depth: typeof ATTESTATION_SUBSTRATE_NOT_CHECKED;
}

/**
 * The envelope of a profiled attestation, AS STATED BY THE PRESENTER — every field is a reading of the
 * presented document, never a fact this package established. `substrate` in particular is echoed, not
 * recognised: an implementation that has never heard of it reads exactly the same envelope.
 */
export interface AttestationEnvelope {
  /** The profile identifier, as stated — how a reader that knows this profile interprets the artifact. */
  profile: string;
  /** The substrate, as stated. Compared with nothing; see the file header. */
  substrate: string;
  /** The subject the attestation declares it vouches for, as stated. */
  subject: string;
  /** The assurance the attestation declares it confers, where it declares one. */
  assurance?: string;
  /** The reference to the artifact itself, so a reader can fetch it and check what this package did not. */
  ref: string;
}

/**
 * One presented attestation, recorded. Two arms and neither is a refusal, which is the point: an
 * attestation can never make a walk refuse a record.
 *
 * `envelope-read` carries what the presenter stated beside the standing statement that the substrate was
 * not checked. `not-attempted` carries a `depth` naming the field that was missing or unreadable — an
 * element nobody could interpret is still recorded as having been presented, because dropping it silently
 * would make the record claim the presenter supplied less than they did.
 */
export type RecordedAttestation =
  | {
      status: "envelope-read";
      envelope: AttestationEnvelope;
      substrateCheck: AttestationSubstrateCheck;
    }
  | { status: "not-attempted"; depth: string };

/**
 * Record one presented attestation. TOTAL over untrusted wire input, and it never throws and never refuses:
 * the worst an element can do is read back as `not-attempted` with the depth naming what was missing.
 *
 * ⛔ The substrate is required to be a non-empty string and is otherwise UNEXAMINED. Adding a membership
 * test here is the roster failure, and it is the failure that looks fine — a build that refuses substrates
 * it does not know passes every test written about the substrates it does know.
 */
export function recordAttestation(presented: unknown): RecordedAttestation {
  if (
    typeof presented !== "object" ||
    presented === null ||
    Array.isArray(presented)
  )
    return notAttempted("attestation-not-an-object");
  const a = presented as Record<string, unknown>;
  const profile = a["profile"];
  if (typeof profile !== "object" || profile === null || Array.isArray(profile))
    return notAttempted("attestation-profile-not-stated");
  const p = profile as Record<string, unknown>;
  if (!stated(p["profile"]))
    return notAttempted("attestation-profile-not-stated");
  if (!stated(p["substrate"]))
    return notAttempted("attestation-substrate-not-stated");
  if (!stated(a["subject"]))
    return notAttempted("attestation-subject-not-stated");
  if (!stated(a["ref"])) return notAttempted("attestation-ref-not-stated");
  // An assurance that is present but not a string is a claim nobody can read. It is a gap rather than a
  // dropped field: omitting it here would record an attestation that stated an assurance as one that
  // stated none, which is a quieter record than the presenter gave.
  const assurance = a["assurance"];
  if (assurance !== undefined && !stated(assurance))
    return notAttempted("attestation-assurance-unreadable");
  return {
    status: "envelope-read",
    envelope: {
      profile: p["profile"],
      substrate: p["substrate"],
      subject: a["subject"],
      ...(assurance !== undefined ? { assurance } : {}),
      ref: a["ref"],
    },
    substrateCheck: {
      status: "not-attempted",
      depth: ATTESTATION_SUBSTRATE_NOT_CHECKED,
    },
  };
}

function stated(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function notAttempted(depth: string): RecordedAttestation {
  return { status: "not-attempted", depth };
}
