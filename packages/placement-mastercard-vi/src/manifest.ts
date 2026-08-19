import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/** The local-name suffix of the LCP terms-hash constraint. The full type is `<reverse-domain>.<suffix>`. */
export const LCP_TERMS_HASH_SUFFIX = "lcp_terms_hash";

/**
 * The namespace reserved for a TSC-ratified capability, and therefore the one namespace this factory
 * refuses. Reserved is not available: putting it on a consumer's signed credential before the
 * LCP TSC has ratified anything would spend the standard's name on our own deployment.
 */
const RESERVED_NAMESPACE = "org.legalcontextprotocol";

/**
 * Two or more lowercase dot-separated labels.
 *
 * It holds exactly the two properties this placement depends on and is NOT a DNS validator: the type must be
 * COLLISION-RESISTANT (the host requires URN or reverse-DNS naming, and a single bare label is neither), and
 * it must have exactly ONE spelling. The second is the sharper of the two — DNS labels compare
 * case-insensitively while a constraint `type` is a string the host never folds, so accepting `com.Example`
 * beside `com.example` would let two spellings of one namespace claim the same carrier, and a reader folding
 * case to reconcile them would then read a foreign deployment's constraint as its own.
 */
const REVERSE_DNS = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * Build the Mastercard Verifiable Intent placement manifest for a deployment's own reverse-domain namespace.
 *
 * Cut against the LIVE Verifiable Intent specification (`verifiableintent.dev/spec/` §9.1 Constraint Type
 * Registry and `verifiableintent.dev/spec/constraints/`) — gate discharged 2026-07-30 and reconciled against
 * LCP v1.37 §C.7, which it CORRECTED on three counts — and v1.38 §C.7 has since adopted the conclusion,
 * stating "Tier B — there is no Tier A carrier" and withdrawing the write outright. See the README for the full gate record.
 *
 * **The mechanism is the host's own extension point.** Layer 2 registers eight constraint types verifiers
 * MUST support and admits custom types with no registration and no coordination: §9.1 permits URI-namespaced
 * types, and the constraints document requires "collision-resistant naming (URN or reverse-DNS)". An LCP
 * constraint sits in the `constraints` array beside the registered ones, inside the consumer's Layer 2
 * mandate, whose claims are signed with the key bound in Layer 1's `cnf.jwk` — so it inherits Layer 2's
 * signature and is carried through the mandate chain. Nothing upstream has to change for the SHAPE to be
 * legal — the host's extension point, used as the host specifies.
 *
 * **`tier: "B"`, corrected from an earlier Tier A reading.**
 * The live specification puts the `constraints` array in Autonomous-mode Layer 2 OPEN mandates only —
 * "Constraints do NOT appear in Immediate mode credentials (`vct: \"mandate.checkout.1\"` and
 * `vct: \"mandate.payment.1\"`)" — and in the open ones, "Regardless of strictness mode, verifiers MUST reject
 * open mandates containing unknown constraint types". §9.1's skip-in-permissive rule therefore never reaches
 * this carrier: the only credentials that could skip an unrecognized type are the only ones that must reject
 * it. A stock verifier does not ignore our constraint — it rejects the whole mandate, which is worse than the
 * carrier not working. Tier A means "works today against stock implementations", so the honest answer is B,
 * and the coordinated change that lifts it is registering an LCP-aware Layer-2 constraint type (§C.7's own
 * Tier B forward work: registration converts legal context from optionally-skipped to mandatory-to-evaluate
 * and makes it safe in open mandates). Declared and inert until then — never presented as available.
 *
 * **`pattern: "opaque-challenge"` (§8.3.4), and the two axes are independent.** The value is committed to a
 * signed structure covered by the consumer's authorization signature and is never transmitted on-chain; that
 * is §8.3.4's definition exactly, and §8.3.4's "Tier A where the host protocol defines an opaque parameter"
 * is a trade-off clause whose condition fails here — VI's constraint slot is EVALUATED, not opaque, which is
 * precisely why an unrecognized type is rejected. It is NOT `sidecar-attestation`: §8.3.3 is a separate
 * on-chain transaction anchored to a settlement, and a mandate settles nothing on-chain. It is NOT
 * `protocol-extension` either, even at Tier B: §8.3.6 means the host's verification procedure is
 * `atrHash`-aware, which no VI verifier is.
 *
 * **NAMING IS NOT THE OBSTACLE, and an earlier docblock said it was.** It claimed the registered type "has
 * a name only the FIDO Alliance Payments TWG can assign". That is false. LCP v1.38 §C.7, in the paragraph
 * opening "Custom naming is available and is not the obstacle": the
 * `mandate.checkout.*` and `mandate.payment.*` namespaces are "open for extension by implementers", with
 * registration a SHOULD for interoperability, and collision-resistant URI naming (a URN such as
 * `urn:example:loyalty-points`) is available for types outside them. What blocks the carrier is RECOGNITION,
 * not spelling: the rejection rule "turns on whether the verifier *recognizes* the type, not on how it is
 * spelled". The `x-` private prefix exists but MUST NOT appear in production credentials crossing
 * organizational boundaries, so it is unavailable to LCP.
 *
 * **THERE IS NO `writeCondition`, BECAUSE THERE IS NO WRITE.** A condition gating a write that never
 * happens is inert and tells a reader the opposite of the truth. `place` refuses
 * `mastercard-vi/tier-b-not-writable` on every document, including the two open mandates that are the only
 * ones a constraint could sit in at all.
 *
 * `extract` is untouched, and it is what the package is for: a counterparty writing this constraint — a
 * deployment controlling both ends, where the mandate never meets a stock verifier — holds a real
 * reference.
 *
 * **Recovery, stated honestly.** Not on-chain, not zero-party recoverable: an auditor needs the credential.
 * Appropriate where the elected forum can compel it. `verify` reads this as a placement and it never raises
 * the class ladder, so a signed constraint can never be mistaken for a settlement weld.
 *
 * **`encoding: "bare-value"` with exactly one carrier type.** The constraint value is a bare `0x` hash, as
 * §C.7 illustrates and as every non-ACP carrier in the set holds. The type name says `lcp_terms_hash` —
 * underscored to match Verifiable Intent's own registered types, all eight of which are underscored
 * (`mandate.checkout.allowed_merchants`, `mandate.payment.amount_range`, …); it was `lcp-terms-hash` — and
 * its schema is ours to write because a custom type's schema belongs to whoever defines it — so a URL would
 * be a DIFFERENT constraint type, not a different value in this one. `bare-value` also forces the list to
 * exactly one: a bare value carries no type tag, so a second permitted type would leave a reader unable to
 * tell a hash from anything else.
 *
 * **A FUNCTION, not a constant: the namespace has no default.** LCP §8 canonizes no per-protocol profile,
 * and silently defaulting to an Integra-owned namespace would put our domain inside a consumer's signed
 * credential in every deployment that forgot to pass one. `org.legalcontextprotocol.*` is reserved for a
 * TSC-ratified capability and is refused here in code.
 */
export function mastercardViManifest(reverseDomain: string): PlacementManifest {
  if (reverseDomain.trim() === "")
    throw new Error(
      "mastercard-vi: a reverse-domain namespace is required and has no default",
    );
  if (!REVERSE_DNS.test(reverseDomain))
    throw new Error(
      `mastercard-vi: ${reverseDomain} is not a lowercase reverse-domain namespace — a constraint type must be collision-resistant and have exactly one spelling`,
    );
  if (
    reverseDomain === RESERVED_NAMESPACE ||
    reverseDomain.startsWith(`${RESERVED_NAMESPACE}.`)
  )
    throw new Error(
      `mastercard-vi: ${RESERVED_NAMESPACE} is reserved for a TSC-ratified capability and must not reach a consumer credential`,
    );
  const tag = `${reverseDomain}.${LCP_TERMS_HASH_SUFFIX}`;
  return {
    protocol: "mastercard-vi",
    pattern: "opaque-challenge",
    tier: "B",
    encoding: "bare-value",
    container: {
      kind: "tagged-array",
      at: "constraints",
      tagField: "type",
      tag,
      valueField: "value",
    },
    field: `constraints[type=${tag}].value`,
    carrierTypes: ["sha256"],
    specRef:
      "Mastercard Verifiable Intent — custom Layer-2 constraint type under reverse-DNS naming (§9.1); constraints appear only in Autonomous open mandates, where unknown types MUST be rejected — so this placement is DECLARATION-ONLY per LCP v1.38 §C.7 and `place` refuses (withdrawn 2026-08-08; gate originally discharged 2026-07-30: see README)",
  };
}
