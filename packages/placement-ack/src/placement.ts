import {
  type LegalContextAdvertisement,
  makePlacement,
  type ReferencePlacementAdapter,
  readAtPath,
} from "@integraledger/lcp-binding-core";
import { ACK_PLACEMENT } from "./manifest.js";

const base = makePlacement(ACK_PLACEMENT);

/**
 * The ACK reference placement — the kit plus ONE ordering rule the kit cannot know.
 *
 * `makePlacement(ACK_PLACEMENT)` supplies everything structural. ACK writes at a TWO-level nested path:
 * `object-path` creates each absent level and structurally copies each one, so `credentialSubject` and its
 * `metadata` are both created when missing and every sibling at both levels survives — including ACK's own
 * `policyRef` / `mandateRef` / `executionRef` / `settlementReference` in the map, and the receipt's own
 * `paymentRequestToken` / `paymentOptionId` / payer `id` one level up.
 *
 * **Nested creation is the kit's job precisely because getting it wrong is silent.** A hand-rolled two-level
 * write that spreads the wrong level drops a whole set of sibling keys, and the only test that catches it is
 * the sibling-preservation one — every other test still passes. The guarantee is proved once in
 * `binding-core`'s `kit.test.ts`, where it lives, and again here where it is used.
 *
 * **ACK is also the first shipped placement to evidence BOTH halves of the kit's malformed-container rule.**
 * Its path has two segments above the field, so an unmergeable `metadata` is the field's DIRECT HOLDER and is
 * replaced, while an unmergeable `credentialSubject` is an INTERMEDIATE and is refused — replacing it would
 * discard the payer's identity. ACP could not evidence that distinction; its path has one segment above the
 * field, and the kit's own test had to use a synthetic `outer.inner` shape. The ACK vectors pin both arms
 * against a real protocol.
 *
 * **THE WRAP: place BEFORE issuance, and the refusal that enforces it.** ACK is the first shipped placement
 * whose host document can be signed, and §C.10's headline strength claim — the reference "is covered by the
 * issuer's proof" — is true of the payload the issuer signs and of nothing else. §C.10 states the coverage and
 * is silent on the ordering; the host is not, so the ordering is a REFUSAL here rather than a sentence in a
 * README. A document already carrying a `proof` is refused `ack/receipt-already-issued`, because writing into
 * one fails ACK both ways it secures a receipt:
 *
 * - On the embedded-proof receipt `docs/ack-pay/receipt-verification.mdx` illustrates, verification step 1 is
 *   "Verify the cryptographic signature (`proof`) on the VC … This ensures the receipt hasn't been tampered
 *   with since issuance." A field added after issuance IS tampering since issuance, so the signature stops
 *   verifying — a loud break, but one we would have caused.
 * - On the object `parseJwtCredential` returns — ACK signs to a JWT (`signCredential` returns a `JwtString`,
 *   and `verifyProof` supports `JwtProof2020` ONLY, throwing `UnsupportedProofTypeError` on anything else) —
 *   the reference sits OUTSIDE the signed payload. `parse-jwt-credential.ts` says it in as many words: "any
 *   outer object wrapping the proof can carry tampered fields that the proof does not attest to", and callers
 *   "MUST treat the returned value as the authoritative credential". So the reference is silently dropped by
 *   ACK's own verification, which is worse than the loud break.
 *
 * This asserts nothing of ACK — it declines to emit a document ACK's own procedure rejects or
 * overwrites, the same fail-fast rule as refusing a corrupt carrier value rather than writing it. And the test
 * is ACK's OWN predicate, mirrored: `isDecodedCredential` accepts a value iff `"proof" in value &&
 * value.proof != null`, so a null `proof` is not an issued credential by the host's rule and is accepted here.
 * Borrowing the host's predicate is what keeps this an ordering rule rather than a validator of our own.
 *
 * The mirror is exact for every OWN `proof` — `{}`, `false`, `0` and `[]` all refuse, `null` and an own
 * `undefined` both place — and it diverges in exactly one place, in the PERMISSIVE direction: `readAtPath` is
 * own-property where ACK uses `in`, so a PROTOTYPE-borne `proof` reads as issued to ACK and places here. That
 * is acceptable, not stricter. `JSON.parse` never sets a prototype, so no receipt off the wire can take that
 * path; and the kit's write spreads own keys only, so the document we emit does not carry the inherited
 * `proof` at all — what leaves here is a coherent UNSIGNED credential, not a tampered signed one. Own-property
 * is independently the right rule for a walker that must not read `constructor` or `__proto__` as data.
 *
 * **The guard runs BEFORE the kit, and on `place` only.** Before, because issued-ness is a precondition on the
 * operation rather than a defect in the reference — there is nothing to place into a signed receipt whatever
 * the carrier type — and because it is the one refusal here a caller cannot fix by correcting an argument.
 * `place` only, because a proof-bearing receipt is exactly what a verifier holds: the object ACK's chain
 * returns is decoded FROM the signed payload, so its reference IS the proof-covered one, and refusing to read
 * it would break the receipt-time story this placement exists for.
 *
 * **No HTTPS wrap on the URL carrier — and the honest reason is not that the seam covers it.** UCP ships one
 * (`ucp/insecure-terms-url`: an `http:` reference is rewritable in transit) and that rule rests on LCP's own
 * reasoning rather than any host grant, so the same reasoning reaches an `http:` value here. ACK declares no
 * `discovery` alias and no `termsUrlFields`, so the canonical slot is the only place a `url` can sit, and
 * `readDeclaredPaths` reports that slot `integrity` — the label is the SLOT's declared strength, which is
 * what it has always meant.
 *
 * **The consequence that used to follow no longer does.** A `{ type: "url", value: "http://…" }` here
 * extracted fine, read back `carrierClass: "integrity"` and PASSED `requireIntegrity` — the §C.2
 * substitution, arriving through the canonical field. That was left open deliberately, because guarding ACK
 * alone would have forked two placements' behaviour on one shape: `placement-acp` is published and ratified
 * riding the identical `reference-object` slot with the identical `["sha256", "url"]` carrier types. The
 * hazard the carrier-strength rulings named — "a flat tolerant-read alias list lets a URL carrier satisfy
 * a read that wanted a hash" — was closed by the ruled per-alias `carrierClass` for ALIASES, leaving the
 * canonical slot untouched.
 *
 * Closed at the seam on 2026-08-04, which is where it belonged: `requireIntegrity` now requires
 * BOTH a slot declared integrity-bearing AND a decoded value of a content-addressed type, so every placement
 * gets it at once and none forks. `readDeclaredPaths` still reports the slot's class unchanged. What remains
 * true of this manifest is only the first sentence: the axis models the slot's strength, and the value is
 * checked by the function that asks about values.
 *
 * That is the contrast with the ordering rule above, which stands on ACK's own published procedure.
 *
 * The protocol-specific reasoning — why `credentialSubject.metadata`, why `http-advisory` rather than
 * `sidecar-attestation` despite the issuer's proof, why ACK-ID is a different seam, why no `termsUrlFields` —
 * lives in `manifest.ts`, where it belongs.
 */
export const ackPlacement: ReferencePlacementAdapter = {
  ...base,
  place(ad: LegalContextAdvertisement, doc: unknown) {
    const proof = readAtPath(doc, "proof");
    if (proof !== undefined && proof !== null)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "ack/receipt-already-issued",
        detail:
          "this credential already carries a proof — place the reference before the issuer signs it, or the reference lands outside what the proof covers",
      };
    return base.place(ad, doc);
  },
};
