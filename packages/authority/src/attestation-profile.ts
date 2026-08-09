/**
 * Profiled attestations interpreted GENERICALLY — the CMP-5 "stranger" reads an attestation by its
 * declared profile without the verifier hardcoding a substrate (EAS, a VC, a notarization). The profile
 * names the substrate + the claim shape; the walk stays substrate-open. This package does not verify any
 * one substrate's cryptography (that is the substrate adapter's, pure over a port) — it interprets the
 * envelope so an unknown-but-profiled attestation is a first-class, inspectable input, not an opaque blob.
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
  /** An `lcp:sha256:` reference to the attestation artifact (verified by a substrate adapter over a port). */
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
