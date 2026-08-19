import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * ACK (Agent Commerce Kit) reference placement — the payment receipt credential's metadata.
 *
 * Cut against the LIVE reference implementation, not a version string: ACK publishes no specification
 * release train, no working group and no extension registry, so "what ACK does" IS
 * `agentcommercekit/ack@main` and the docs beside it. Read 2026-07-30 at `main` (pushed 2026-07-29):
 * `packages/ack-pay/src/create-payment-receipt.ts`, `packages/ack-pay/src/schemas/valibot.ts`,
 * `packages/vc/src/create-credential.ts`, `packages/vc/src/signing/sign-credential.ts`,
 * `packages/vc/src/verification/{parse-jwt-credential.ts,verify-proof.ts}`,
 * `packages/did/src/did-resolvers/get-did-resolver.ts` and `docs/ack-pay/receipt-verification.mdx`. The
 * dated record of that reading is in this package's README, under Specification provenance.
 *
 * **Tier A.** `createPaymentReceipt` builds `const attestation: Record<string, unknown> = {
 * paymentRequestToken, paymentOptionId }` and then `if (metadata) { attestation.metadata = metadata }`, and
 * `createCredential` spreads the result — verbatim `credentialSubject: { id: subject, ...attestation },` — so
 * the socket is at `credentialSubject.metadata`, and its schema is
 * `metadata: v.optional(v.record(v.string(), v.unknown()))`: OPTIONAL and wholly UNCONSTRAINED. ACK's own
 * docs say so in as many words — "`credentialSubject.metadata` is optional and should be treated as an
 * extension point for verifier-specific payment evidence", and "Metadata fields are non-normative".
 *
 * **And ACK asks for this by name**, which makes it the strongest host-governed posture in the ten-protocol set — not
 * merely permitted, invited. Verbatim from the same section: "put **references or hashes to external policy,
 * mandate, execution, and settlement records** in metadata when a deployment needs a richer audit trail." An
 * `atrHash` is a hash to an external record; the docs' own example map already carries `policyRef`,
 * `policySnapshotHash`, `mandateRef`, `executionRef`, `executionReceiptHash`, `settlementNetwork` and
 * `settlementReference`. No coordination, no schema change, nothing asked of Catena.
 *
 * **This is a RECEIPT-time placement**, not a proposal-time one: the reference lands in the artifact that
 * attests the payment happened. That makes it the natural companion to the x402 receipt binding, and it
 * means an ACK record's terms reference is recoverable from the receipt alone.
 *
 * **`pattern` is `http-advisory` (§8.3.7) — and `sidecar-attestation` was the live alternative, not
 * `protocol-extension`.** LCP v1.38 §C.10 correctly observes that this carrier is unusual: because it sits
 * inside a Verifiable Credential it is covered by the issuer's proof, bound to the issuer's assertion rather
 * than merely transported alongside it — a claim that holds of the payload the issuer signs and of nothing
 * else, which is why `place` REFUSES a document that already carries a `proof`. §C.10 states the coverage and
 * is silent on the ordering; the enforcement and the host citations are in `placement.ts` with the wrap.
 * §8.3.3 is therefore worth asking about, and the answer is no: it
 * prices "one extra transaction per payment (gas cost varies by rail)" and locates recovery in an attestation
 * indexer keyed by the settlement transaction hash, whereas an ACK receipt is an off-chain credential that
 * costs no transaction and is indexed on no ledger. §8.3's six patterns grade one thing — how the reference
 * binds to the SETTLEMENT — and proof coverage of the carrier is a different axis with no §8.3 token. So the
 * proof makes this an unusually strong advisory carrier and leaves the pattern where §8.3.7 puts it. Not
 * `protocol-extension` either: that is Tier B by definition (§8.3.6), meaning the host's own verification and
 * settlement procedure is atrHash-aware, which no ACK implementation is — and claiming it would misdescribe a
 * placement that works today as one that fragments adoption. The same determination is made for ACP and UCP.
 *
 * §8.3.7 is honest about the cost and so is this package: not on-chain, not zero-party recoverable, not
 * forward-indexable on any public ledger. A deployment needing stronger evidence pairs this with one of the
 * six settlement binding patterns — which is what happens when the receipt's `settlementNetwork` names a rail
 * we bind; otherwise this placement is the record's whole protocol reach and the record reads with an
 * honest `not-attempted` at settlement-enumeration.
 *
 * **ACK-ID is a separate seam and is NOT this package.** `getDidResolver` registers `did:key`, `did:web`,
 * `did:jwks` and `did:pkh`, and `ControllerCredential` binds owner DID to agent DID (`credentialSubject.id` =
 * agent, `credentialSubject.controller` = owner, issuer defaulting to the owner). Those feed `resolve-party`
 * as an identity input and `authority-attenuation` as a delegation input; both are settled, and both
 * must reuse the existing identity path rather than minting a second one.
 *
 * **Tier B.** There is no upstream body to register with — ACK ships patterns and a reference implementation,
 * not a conformance surface. Standardization would be the ACK maintainers documenting a conventional
 * `legalContext` key, which is a documentation act rather than a specification change. Declared in the
 * README; no code ships for it, and no second manifest is declared, because a manifest for a key whose
 * meaning nobody has published would assert a shape its owner has not defined.
 *
 * **`termsUrlFields` is OMITTED.** ACK's receipt models no terms-URL field at all. Declaring a locator the
 * host has no room for would repeat the defect the `field` rule exists to prevent: a declared property that
 * is not the declared thing. A parser reads the manifest, and a
 * parser that DEMANDED a URL here could never round-trip. `carrierTypes` permits `sha256` and `url` and
 * excludes `ipfs`/`ar`: the map is unconstrained so the restriction is not a type-system one, it is that
 * these are the two forms the LCP ecosystem's readers already handle in a `reference-object` slot. Widening
 * is a vector amendment, never a code-side default.
 */
export const ACK_PLACEMENT: PlacementManifest = {
  protocol: "ack",
  pattern: "http-advisory",
  tier: "A",
  encoding: "reference-object",
  // ACK's slot is addressable directly, so the locator IS a resolvable dotted path — no `segments`, because
  // no ACK key contains a literal dot, and no search rule, because nothing here is an array.
  container: { kind: "object-path" },
  field: "credentialSubject.metadata.legalContext",
  // ACK's own keys are camelCase throughout (`paymentRequestToken`, `policyRef`, `settlementReference`), so
  // `legalContext` is the host protocol's house style, matches v1.38 §C.10's canonical example byte for byte,
  // and is what `place` writes. The snake_case spelling is DECLARED — not sniffed — because an implementer
  // arriving from ACP, whose schema is snake_case throughout, holds a real reference in it. A declared alias
  // is auditable where a "try snake_case too" heuristic is not.
  //
  // The alias inherits the manifest's `reference-object` encoding: it is the same §8.1 object under a
  // different key, unlike ACP's aliases which differ in shape as well as spelling. It is `integrity` (the
  // default) and carries no `write` flag: a spelling difference is never a guarantee difference, and `place`
  // writes ONE declared field, ours. There is no `discovery` carrier to declare — ACK's receipt has no terms
  // URL anywhere, so there is nothing here that could locate-without-attesting.
  readAlso: [{ path: "credentialSubject.metadata.legal_context" }],
  carrierTypes: ["sha256", "url"],
  specRef:
    "ACK-Pay PaymentReceiptCredential — credentialSubject.metadata, an optional unconstrained record (agentcommercekit/ack packages/ack-pay/src/{create-payment-receipt.ts,schemas/valibot.ts}; gate discharged 2026-07-30: see README)",
};
