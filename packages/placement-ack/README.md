# @integraledger/lcp-placement-ack

Places an LCP reference into an [Agent Commerce Kit](https://www.agentcommercekit.com) (ACK) payment receipt
credential, and reads it back out.

**The socket is ACK's own open extension point.** ACK-Pay's `PaymentReceiptCredential` carries
`credentialSubject.metadata`, an optional and wholly unconstrained key-value map that ACK's documentation
calls "an extension point for verifier-specific payment evidence" and whose fields it calls "non-normative".
It already carries `policyRef`, `policySnapshotHash`, `mandateRef`, `executionRef`, `executionReceiptHash`,
`settlementNetwork` and `settlementReference`. An LCP reference riding beside those is that extension point
being used exactly as ACK intends — no coordination, no schema change, nothing asked of Catena Labs.

```bash
npm install @integraledger/lcp-placement-ack
```

| | |
|---|---|
| **Chain** | none — ACK-Pay settles through whatever payment option the receipt attests |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `credentialSubject.metadata.legalContext` |
| **Read also** | `credentialSubject.metadata.legal_context` (integrity — a spelling, not a weaker carrier) |
| **Carrier types** | `sha256`, `url` |
| **`place` precondition** | the credential must not yet carry a `proof` — enforced, `ack/receipt-already-issued` |
| **Spec** | the ACK reference implementation, read at `main` **2026-07-30** (pushed 2026-07-29) |

## Use

```ts
import { ACK_PLACEMENT, ackPlacement } from "@integraledger/lcp-placement-ack";

// ACK's own SDK surface — this package neither wraps nor re-exports it.
declare function createPaymentReceipt(input: Record<string, unknown>): unknown;
declare function parseJwtCredential(jwt: string, resolver: unknown): Promise<unknown>;
declare const paymentRequestToken: string;
declare const paymentOptionId: string;
declare const issuer: string;
declare const payerDid: string;
declare const receiptJwt: string;
declare const resolver: unknown;

// `place` takes the credential createPaymentReceipt returned, BEFORE signCredential — see
// "Before the issuer signs". Passing it an already-signed receipt is a refusal, not a silent rewrite.
const draft = createPaymentReceipt({ paymentRequestToken, paymentOptionId, issuer, payerDid });
const placed = ackPlacement.place({ ref: { type: "sha256", value: "0x…" } }, draft);

// `extract` takes the credential the verification chain returned — proof and all.
const ref = ackPlacement.extract(await parseJwtCredential(receiptJwt, resolver));
```

## Specification provenance — verified against the live host, 2026-07-30

ACK publishes **no specification release train, no working group and no extension registry** — it is a
reference toolkit under MIT, not a governed standard. So "what ACK does" is the code, and the gate was
discharged against `github.com/agentcommercekit/ack` at `main` (pushed 2026-07-29, read 2026-07-30), not
against a version string. Four things were confirmed:

1. **The socket exists and is at `credentialSubject.metadata`.**
   `packages/ack-pay/src/create-payment-receipt.ts` builds it in two statements, verbatim —
   `const attestation: Record<string, unknown> = { paymentRequestToken, paymentOptionId }` then
   `if (metadata) { attestation.metadata = metadata }` — and `packages/vc/src/create-credential.ts` spreads the
   result, also verbatim: `credentialSubject: { id: subject, ...attestation },`. The map is therefore two levels
   deep, under `credentialSubject`, and `metadata` is an optional sibling of the two required claims.
2. **It is open and non-normative.** `packages/ack-pay/src/schemas/valibot.ts` declares
   `metadata: v.optional(v.record(v.string(), v.unknown()))` — optional, and unconstrained in both key and
   value. `docs/ack-pay/receipt-verification.mdx` says it in words: "`credentialSubject.metadata` is optional
   and should be treated as an extension point for verifier-specific payment evidence", and "Metadata fields
   are non-normative."
3. **ACK asks for this by name.** The same doc section says, verbatim: "put **references or hashes to
   external policy, mandate, execution, and settlement records** in metadata when a deployment needs a richer
   audit trail." An `atrHash` is a hash to an external record, and the docs' own example map already holds
   `policyRef`, `policySnapshotHash`, `mandateRef`, `executionRef`, `executionReceiptHash`,
   `settlementNetwork` and `settlementReference`. This is the strongest available posture anywhere in the
   ten-protocol set: not merely permitted, invited.
4. **ACK-ID's DID methods.** `packages/did/src/did-resolvers/get-did-resolver.ts` registers **four**:
   `did:key`, `did:web`, `did:jwks` and `did:pkh`. The internal 2026-07-08 research extracts listed `did:jwks`
   as pending ("improving did:jwks support" in an unreleased changeset); it has since landed. Re-reading the
   live code rather than trusting those extracts is what caught it.
5. **How ACK actually secures a receipt — which decides *when* the reference may be placed.**
   `packages/vc/src/create-credential.ts`'s own docblock says it returns "a new, **unsigned** Verifiable
   Credential"; `packages/vc/src/signing/sign-credential.ts` then returns a `JwtString` via `did-jwt-vc`, so
   ACK's live proof is an **enveloping JWT proof**, and `packages/vc/src/verification/verify-proof.ts` supports
   `JwtProof2020` **only**, throwing `UnsupportedProofTypeError` on anything else. The published docs illustrate
   the other shape — an embedded `Ed25519Signature2020` `proof` — so both exist in ACK's world. See "Before the
   issuer signs" below: this is the finding that turns §C.10's proof-coverage claim into an enforced
   precondition rather than an assumed one.

**One premise corrected.** This package was designed on the understanding that ACK is the only protocol in
the set with no LCP Appendix C section. That was true of v1.36 and is **false of v1.37**, which added
**§C.10**. §C.10 agrees with the code on every point that matters here, including the camelCase
`legalContext` spelling this package makes canonical, so nothing in the build changed — but the premise did,
and the host's own code decides either way.

## `http-advisory`, and why not `sidecar-attestation`

§C.10 makes a real observation: because the reference sits inside a Verifiable Credential it is **covered by
the issuer's proof** — bound to the issuer's assertion rather than merely transported alongside it. That is
true of the payload the issuer signs and of nothing else, which is why this package **enforces** the ordering
rather than assuming it (see "Before the issuer signs"). It also makes §8.3.3 Sidecar Attestation worth asking
about, and the answer is no. §8.3.3 prices "one extra transaction per
payment (gas cost varies by rail)" and locates recovery in an attestation indexer keyed by the **settlement
transaction hash**; an ACK receipt is an off-chain credential that costs no transaction and is indexed on no
ledger. §8.3's six patterns grade one thing — how the reference binds to the **settlement** — and proof
coverage of the carrier is a different axis with no §8.3 token at all. So the issuer's proof makes this an
unusually strong *advisory* carrier and leaves the pattern where §8.3.7 puts it.

Not `protocol-extension` either: that is Tier B **by definition** (§8.3.6), meaning the host's own
verification and settlement procedure is `atrHash`-aware. No ACK implementation is, and there is no registry
to file with. The same determination is made for ACP and UCP.

§8.3.7 is honest about the cost, and so is this package: **not** on-chain, **not** zero-party recoverable,
**not** forward-indexable on any public ledger. A deployment needing stronger evidence pairs this with one of
the six settlement binding patterns — which is what happens when the receipt's `settlementNetwork` names a
rail we bind. Otherwise this placement is the record's whole protocol reach, and the record reads with
an honest `not-attempted` at settlement-enumeration.

## Receipt-time, not proposal-time

Every other placement in this set rides a **proposal** — a checkout session, a mandate, a payment-required
challenge. This one rides the **receipt**: the artifact that attests the payment happened. Two consequences.
It is the natural companion to the x402 receipt binding, and an ACK record's terms reference is recoverable
**from the receipt alone**, without replaying the request that produced it.

"Receipt-time" is about *which artifact*, not about *how late*. The reference goes into the receipt while the
receipt is still being built — `createPaymentReceipt` even takes `metadata` as an input — and the window closes
when the issuer signs.

## A placement, not a binding

Two pure functions and a manifest — no ports, no chain, no lifecycle. Both members are total: a refusal is a
returned value, never a thrown exception.

## Two levels deep, which is new

ACK is the first shipped placement whose path is `credentialSubject` → `metadata` → leaf. The kit creates each
absent level and structurally copies each one, so both levels are created when missing and **every sibling at
both levels survives** — ACK's own refs in the map, and the receipt's `paymentRequestToken` /
`paymentOptionId` / payer `id` one level up. That guarantee is proved in `binding-core`'s `kit.test.ts` where
it lives, and again here where it is used, because a two-level write that spreads the wrong level drops a
whole set of keys and nothing else notices.

Being two levels deep also makes ACK the first **real** protocol to evidence both halves of the kit's
malformed-container rule: an unmergeable `metadata` is the field's direct holder and is **replaced**, while an
unmergeable `credentialSubject` is an intermediate and is **refused** — replacing it would discard the payer's
identity. ACP could not evidence that distinction; its path has one segment above the field.

## Before the issuer signs

`place` **refuses a document that already carries a `proof`** — `ack/receipt-already-issued`. This is the
precondition §C.10's strength claim rests on, and it is the one rule this package adds to the kit. §C.10 states
the coverage and is silent on the ordering; the host is not, and writing into an issued receipt fails ACK both
ways it secures one:

- On the **embedded-proof** receipt the docs illustrate, verification step 1 is "Verify the cryptographic
  signature (`proof`) on the VC … This ensures the receipt hasn't been tampered with since issuance." A field
  added after issuance *is* tampering since issuance, so the signature stops verifying.
- On the **JWT-proof** object `parseJwtCredential` returns, the reference sits *outside* the signed payload.
  `parse-jwt-credential.ts` warns that "any outer object wrapping the proof can carry tampered fields that the
  proof does not attest to" and that callers "MUST treat the returned value as the authoritative credential" —
  so the reference is silently dropped, which is worse than the loud break.

The refusal asserts nothing of ACK: it declines to emit a document ACK's own procedure rejects or overwrites,
the same fail-fast rule as refusing a corrupt carrier value rather than writing it. The test is **ACK's own
predicate**, mirrored — `isDecodedCredential` accepts a value iff `"proof" in value && value.proof != null`, so
a null `proof` is not an issued credential by the host's rule and is accepted here.

The mirror is exact for every **own** `proof` (`{}`, `false`, `0`, `[]` refuse; `null` and own `undefined`
place) and diverges in exactly one place, in the **permissive** direction: our walker is own-property where
ACK's is `in`, so a *prototype-borne* `proof` reads as issued to ACK and places here. That is acceptable rather
than stricter — `JSON.parse` never sets a prototype, so no receipt off the wire takes that path, and the kit's
write spreads own keys only, so the emitted document does not carry the inherited `proof` at all.

**`extract` is deliberately not guarded.** A proof-bearing receipt is exactly what a verifier holds, and the
object ACK's verification chain returns is decoded *from* the signed payload — so its reference is the
proof-covered one, and refusing to read it would break the receipt-time story this placement exists for.

## No HTTPS wrap on the URL carrier — and what that leaves open

Apart from that ordering rule, `ackPlacement` is `makePlacement(ACK_PLACEMENT)`, and `makePlacement` and
`requireIntegrity` both come from [`@integraledger/lcp-binding-core`](../binding-core#readme). `placement-ucp` ships a second
wrap (`ucp/insecure-terms-url` — an `http:` reference is rewritable in transit); this package does not, and the
reason is **not** that the seam already models the difference. It does not, for this manifest:

`carrierClass` is declared **per slot**, not derived from the value. ACK declares no `discovery` alias and no
`termsUrlFields`, so the canonical slot is the only place a `url` can sit — and `readDeclaredPaths` reports that
slot `integrity`. Measured: `{ "type": "url", "value": "http://…" }` at
`credentialSubject.metadata.legalContext` extracts successfully, reads back `carrierClass: "integrity"`, and
**passes `requireIntegrity`**. A caller that needs an attested document and checks only the class does not learn
from the class that it got a rewritable locator; it has to look at the reference's own `type`.

That is left as it is deliberately, for consistency rather than comfort. `placement-acp` is published and
ratified riding the identical `reference-object` slot with the identical `["sha256", "url"]` carrier types and no
such refusal, so guarding ACK alone would fork two placements' behaviour on one shape from inside one package.
The hazard is named in the carrier-strength rulings ("a flat tolerant-read alias list lets a URL carrier satisfy
a read that wanted a hash"), and the ruled fix — a per-alias `carrierClass` — closes it for **aliases** while
leaving a canonical slot that permits both types untouched. Closing that residue means deciding whether the
class is derived from the value read, which is a seam decision across every placement rather than a placement's
call. Stated here so the gap is auditable; unchanged here so the answer stays one decision.

By contrast the ordering rule above stands on ACK's own published procedure, which is why it *is* enforced.

## What is NOT here

- **ACK-ID is a separate seam.** `did:key` / `did:web` / `did:jwks` / `did:pkh` and `ControllerCredential`
  (owner DID ← agent DID) are identity and delegation inputs. They feed `resolve-party` and
  `authority-attenuation`, they are settled in the identity workstream, and they must reuse the existing
  identity path rather than
  minting a second one.
- **`termsUrlFields`.** ACK's receipt models no terms-URL field. Declaring a locator the host has no room
  for would repeat the defect the `field` rule exists to prevent — a declared property that is not the
  declared thing — and a parser told to demand one could never round-trip. The kit holds the seller to the
  omission too: `place` REFUSES an advertisement that supplies a URL (`ack/terms-url-unplaceable`), because
  dropping it silently would advertise less than the seller stated.
- **A Tier B manifest.** There is no upstream body to register with. Standardization would be the ACK
  maintainers documenting a conventional `legalContext` key — a documentation act, not a specification
  change — and a manifest for a key whose meaning nobody has published would assert exactly the shape a
  host has not defined. Stated here in prose; no code ships for it.

## Provenance

Cut against the ACK reference implementation at `main`, read **2026-07-30** (repo pushed 2026-07-29), and
reconciled against LCP v1.37 §C.10 the same day, and re-read against **v1.38 §C.10** on 2026-08-12 — which
still spells the carrier `legalContext`, as this package does. The carrier-strength rules — per-alias `carrierClass` and
`write`, and `org.legalcontextprotocol.*` reserved for a TSC-ratified capability — neither apply to a
manifest whose only alias is an integrity spelling and which advertises no namespaced capability.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
