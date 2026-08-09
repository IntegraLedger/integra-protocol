/**
 * IDN-2 resolution chain. An identity that terminates in nothing but a key is not conformant *for
 * consequential transactions*: a bare key attributes a signature but resolves to no accountable party.
 * A resolution chain walks from the signing key through attestations/grants/domain control to a named
 * accountable party; `terminatesInAccountableParty` is the IDN-2 floor a consequential transaction needs.
 * The chain is substrate-open (CMP-5) — a step names HOW it resolves, not a specific attestation format.
 */

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
