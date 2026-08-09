import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * AP2 (Agent Payments Protocol) reference placement — transport-layer metadata, cut against AP2 v0.2
 * (release `0.2.0`, 2026-04-28) and its reference samples, gate discharged 2026-07-30. See the README.
 *
 * **Tier A.** AP2 mandates are Verifiable Digital Credentials — SD-JWTs — carried over some transport. The
 * reference rides ALONGSIDE the mandate, in that transport's metadata map, with no coordination.
 *
 * **AP2 DEFINES NO TRANSPORT, and that is a gate finding rather than a detail.** §Specification: "AP2
 * operates as a security feature within a Commerce Protocol. The exact details of the Commerce Protocol …
 * are outside the scope of AP2." So the Tier A claim here cannot rest on AP2 — it rests on the transport
 * AP2's own v0.2 samples use, which is A2A: an A2A `Message` carries a free-form `metadata` object ("Any
 * metadata to provide along with the message"), with no reserved-key constraint, and AP2 never writes to it.
 * The mandates ride DataParts keyed `ap2.mandates.CheckoutMandateSdJwt` / `ap2.mandates.PaymentMandateSdJwt`
 * beside siblings like `risk_data`, so the metadata map is genuinely untouched and genuinely open.
 *
 * A deployment that instead carries AP2 mandates over UCP — the commerce protocol AP2 names as its explicit
 * compatibility target — wants `@integraledger/lcp-placement-ucp`, not this package. Saying which transport a
 * placement is true of is the honest form of a Tier A claim; "AP2 has a metadata field" is not.
 *
 * **Tier B — inside the mandate.** Embedding the reference in the AP2 mandate itself, so the legal context
 * travels through the mandate chain with the consumer's authorization, requires an upstream extension. v0.2
 * makes that harder than LCP v1.37 §C.5 stated — and v1.38 §C.5 now states it too, describing the closed
 * `anyOf` and the FIDO Alliance filing path, so this is no longer drift owed back to the spec. A mandate is
 * a signed SD-JWT whose `vct` "MUST match the
 * exact `vct` string, including the version suffix", so an added claim is a NEW credential type rather than a
 * tolerated extra field, and the closed mandate's key-binding signature is made at presentation over
 * `sd_hash`, so nothing can be inserted after signing. v0.2's actual forward path is its Mandate Constraints
 * extension point, which requires "a uniquely defined `type`", a schema naming its selectively-disclosable
 * fields, and an evaluation algorithm — a filing with the FIDO Payments TWG, not a field. This package does
 * not ship it, does not emit it, and deliberately does not READ it (see the vectors).
 *
 * **A LIVE PRECEDENT DOES THE TIER B THING — do not copy it.** A working AP2 integration was observed
 * placing `atrHash` inside `CartMandateSubject.paymentMethod` and `legalContextUrl` on
 * `credentialSubject`. That integration controls both ends, so it could define its own mandate
 * shape — and it is cut against AP2 v0.1, whose `CartMandate` v0.2 retired. A shipped package can do
 * neither: writing our own mandate fields requires every AP2 counterparty to accept them, which is exactly
 * an assertion the host has not authorised. The precedent is evidence the shape works, not a template.
 *
 * **`pattern` is `http-advisory`, not `protocol-extension`** — the same determination made for ACP and UCP.
 * §8.3.6 means the HOST protocol's own verification and settlement procedure understands the hash, which no
 * AP2 role does; §8.3.6 is also Tier B by definition, which would misdescribe a carrier that works today
 * against stock AP2 over stock A2A. The schema rejects the protocol-extension/Tier-A pairing outright.
 *
 * **No reverse-domain namespace, deliberately.** The reverse-domain namespace convention
 * (`org.legalcontextprotocol.*` is reserved for a TSC-ratified capability) applies to protocols whose own
 * naming governance demands it — UCP requires vendor capabilities under a reverse-domain the vendor controls. A2A
 * documents no namespacing convention for message metadata; its `a2a-` prefix rule covers transport service
 * parameters, not `Message.metadata`. Inventing a reverse-domain key here would put a spelling on the wire
 * that neither AP2 nor A2A asks for, so the plain `legalContext` key stands, and it is the same spelling
 * `placement-a2a` uses — one wire spelling on one transport, which is the point.
 *
 * **`readAlso` is the snake_case spelling, and it is `integrity`, not `discovery`.** AP2's own claim names
 * are snake_case (`checkout_hash`, `risk_data`), so a counterparty spelling the metadata key that way is
 * following the protocol's convention rather than inventing one. It is the SAME datum in the same container,
 * so it takes the default carrier class and no `write` flag: one declared field, ours.
 *
 * **Conceptual note.** AP2 mandates capture WHAT was authorized; LCP captures WHAT TERMS govern that
 * authorization. They are complementary and travel together, which is why riding alongside the mandate loses
 * nothing an integrator actually needs.
 */
export const AP2_PLACEMENT: PlacementManifest = {
  protocol: "ap2",
  pattern: "http-advisory",
  tier: "A",
  encoding: "reference-object",
  container: { kind: "object-path" },
  field: "metadata.legalContext",
  readAlso: [{ path: "metadata.legal_context" }],
  carrierTypes: ["sha256", "url"],
  specRef:
    "AP2 v0.2 (2026-04-28) §Mandates — the Commerce Protocol carrying the mandate is outside AP2's scope; in the v0.2 reference samples that transport is A2A, whose Message.metadata is a free-form key/value object AP2 never writes to (gate discharged 2026-07-30: see README)",
};
