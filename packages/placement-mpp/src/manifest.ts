import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * MPP (Machine Payments Protocol) reference placement — inside the challenge-bound `request` body.
 *
 * Cut against the LIVE specification family at paymentauth.org, specification gate discharged **2026-07-30**, per
 * method. The README carries the per-method record; MPP is a family and a single "verified" would be
 * meaningless across it.
 *
 * **The document this placement operates on is the `request` body** — the base64url(JCS(JSON)) payload the
 * `request` auth-param of a `WWW-Authenticate: Payment` challenge carries, and slot 3 of the challenge
 * binding. `methodDetails` is an OPTIONAL member of that body (`draft-payment-intent-charge-00` §5.1.2,
 * Table 3), so `methodDetails.atrHash` is inside the bound input byte-for-byte. That is the package's
 * central claim and the gate confirmed it verbatim.
 *
 * **Tier A, and the carrier is integrity-bearing — but read the direction of the guarantee.** Binding the
 * challenge `id` to the challenge parameters is a server MUST in the `id` field description (core §5.1.1,
 * "Servers MUST bind this value to the …") — **and a SHOULD in the section devoted to it** (§5.1.2.1,
 * "Servers SHOULD bind the challenge id to the challenge parameters"). The host is internally inconsistent
 * here, verified at paymentauth.org 2026-08-08, and LCP v1.38 §C.1 names the same split rather than
 * resolving it. This package's tamper-evidence claim rests on the MUST, so the SHOULD is recorded beside
 * it: against a server that took the weaker reading, the guarantee below is weaker too. The seven-slot
 * canonicalization
 * — realm, method, intent, request, expires, digest, opaque, joined with `|`, absent optionals as empty
 * segments, HMAC-SHA256, base64url-nopad — is the **RECOMMENDED** realization of that MUST (§5.1.2.1.1), not
 * the only conformant one: §5.1.2.1 says the mechanism is implementation-defined and a stateful database
 * lookup qualifies. And the key is a server secret §11.2.2 says implementations MUST keep server-side and
 * MUST NOT disclose to clients, so **the buyer cannot verify the MAC**. What the carrier gets is
 * tamper-evidence — a client cannot alter the advertised values and still be accepted, and a seller cannot
 * honour a credential whose `request` differs from the one it bound. Stronger than a bare advisory field;
 * NOT a buyer-verifiable seller commitment, and this package will not describe it as one.
 *
 * **Still not a settlement binding.** `binding-evm-mpp` (B1) and `binding-tempo-mpp` (B2) own that, and the
 * two differ enormously in strength on the same wire format: Tempo's `methodDetails.memo` is a documented
 * `bytes32` field whose presence obliges the client to call `transferWithMemo` and obliges the server to
 * verify the emitted memo (`draft-tempo-charge-00` §4.2, §7 step 5), which is a Native Field weld; MPP-EVM
 * offers only Id-Reuse. Neither claim rides here.
 *
 * **`methodDetails` is the METHOD's namespace, and that is the honest caveat.** The charge intent §5.3:
 * "Payment methods MAY define additional fields in the methodDetails object ... MUST be documented in the
 * payment method specification." The family is **TEN** methods, re-enumerated from paymentauth.org
 * 2026-08-08 — card, evm, hedera, lightning, nearintents, solana, stellar, stripe, tempo, usdc. This
 * family grows: `draft-usdc-charge-00` and `draft-nearintents-charge-01` both landed after an earlier
 * enumeration, so any count here is a measurement with a date on it rather than a standing fact.
 *
 * **One of the ten DOES constrain `methodDetails`, and the earlier "none closes the object" was too
 * strong.** `draft-usdc-charge-00` §: "The methodDetails object MUST include exactly one profile details
 * object, and that object MUST use the same name as methodDetails.type … methodDetails.evm,
 * methodDetails.stacks, and methodDetails.gateway MUST be absent." That constrains which PROFILE objects
 * may appear; it says nothing about unknown keys, and the draft contains no unknown-key rule at all. So
 * `atrHash` — not a profile object — is still tolerated, and Tier A survives. The correction matters
 * anyway: a method CAN close part of this namespace, so "none of them ever will" is not a property to
 * lean on.
 *
 * None of the ten documents a legal-context field, so `atrHash` sits in a namespace whose authority is
 * each method specification. A deployment on a method that later constrains `methodDetails` must discharge the specification gate
 * for THAT method rather than assume this one carries over, and the right forward ask is the steward
 * invitation (standard placement per method), not a core-spec change.
 *
 * **Tier B — the outer challenge parameter.** A custom parameter on the outer `WWW-Authenticate: Payment`
 * challenge is permitted today by the extension policy (§9.3: unknown parameters MUST be ignored by
 * clients) — and note the same section requires lowercase names, so it would have to spell `legalcontext`,
 * not `legalContext`. LCP v1.38 §C.1 now writes `legalcontext` and states the MUST itself
 * ("custom parameter names MUST be lowercase"), adopting what this comment recorded as drift owed back to
 * the spec. Bringing it under the binding requires
 * extending the seven-slot canonicalization input, which is a coordinated change to the core draft. An outer
 * parameter outside the seven slots is unbound, and this package will not ship one dressed as bound. No Tier
 * B manifest is declared for it: declaring a shape the host has not defined is the assertion this seam refuses.
 *
 * `encoding` is `bare-value`: §C.1 shows `methodDetails.atrHash` holding a bare `0x…` hash, and that is the
 * shape MPP integrators recognize. Bare-value fixes the type from the field's own contract, so `carrierTypes`
 * is capped at exactly one — which is also why **no discovery alias can be declared here.** A url-typed
 * `readAlso` would need a second permitted carrier type, and the cap forbids it. That is the right answer
 * rather than a limitation: `termsUrlField` declares where the terms URL lives, labelled as the different
 * datum it is, and a located document cannot stand in for an attested one (LCP v1.38 §C.2).
 */
export const MPP_PLACEMENT: PlacementManifest = {
  protocol: "mpp",
  pattern: "http-advisory",
  tier: "A",
  encoding: "bare-value",
  container: { kind: "object-path" },
  field: "methodDetails.atrHash",
  termsUrlField: "methodDetails.legalContextUrl",
  carrierTypes: ["sha256"],
  specRef:
    "MPP core draft-httpauth-payment-00 §5.1.1/§5.1.2.1.1 — the challenge-bound `request` body; draft-payment-intent-charge-00 §5.1.2/§5.3 — methodDetails (gate discharged per method 2026-07-30: see README)",
};
