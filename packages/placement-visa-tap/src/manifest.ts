import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * Visa TAP (Trusted Agent Protocol) reference placement — Tier A, and UNBOUND.
 *
 * Cut against the LIVE TAP specification published at Visa Developer
 * (`developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications`), the
 * `visa/trusted-agent-protocol` reference implementation's RFC 9421 documentation, and RFC 9421 itself —
 * gate discharged 2026-07-30 against LCP v1.37 §C.6, re-checked against v1.38 §C.6 on 2026-08-08 — no
 * material drift either time.
 *
 * TAP is built on HTTP Message Signatures [RFC 9421] with a three-signature model establishing agent
 * identity (a header signature), consumer identity and payment authorization (two signed body objects). A
 * custom header carrying the reference is available today with no coordination — and it is **not covered by
 * any signature**: TAP's agent recognition signature covers exactly `@authority` and `@path`, and RFC 9421
 * §2.5 builds the signature base from only the components `Signature-Input` enumerates. Anything on the path
 * can therefore replace `x-lcp-hash` while every TAP signature still verifies. Binding it means adding the
 * header to the covered components, which is itself a coordinated change and therefore Tier B.
 *
 * This manifest declares the unbound header because it is what is honestly available. The README leads with
 * the limitation rather than burying it, and `verify` treats the result as a placement — it never raises the
 * class ladder through the reference-placement step, so an unbound header can never be mistaken for
 * evidence of a weld.
 *
 * **NOT `sidecar-attestation`.** §8.3.3 is a separate on-chain transaction anchored to a settlement. TAP
 * settles nothing on-chain; there is no settlement transaction to anchor to. An earlier plan draft assigned
 * that token and it was wrong. §8.3.7 HTTP-Layer Advisory is what an uncovered header actually is.
 *
 * **The `_TIER_A` in the name is load-bearing here**, unlike in `placement-ucp` where the re-cut collapsed
 * the two-manifest design into one: TAP genuinely has Tier B integration points (inside one of the signed
 * body objects under the spec's extensibility clause, a new sibling object carrying its own
 * `nonce`/`kid`/`alg`/`signature` quartet, or naming this header in `Signature-Input`). None is declared as
 *
 * (`kid` here is the BODY OBJECT's quartet field, not RFC 9421's `keyid` signature parameter — the two
 * spellings sit side by side in this package and are two different structures, not a contradiction to
 * reconcile. RFC 9421 §2.3 names the parameter `keyid`; the body objects follow JOSE's `kid`. Neither is
 * verifiable from the reference implementation, which mentions neither, so both are left as read.)
 * a manifest — a manifest asserting a shape whose owner has not defined it is the asserting-a-shape defect,
 * and a manifest is the thing a stranger acts on — so the forward path lives in the README's prose and this
 * name says which tier the shipped thing is.
 *
 * `encoding` is `bare-value` with `carrierTypes: ["sha256"]`: a header holds a scalar and the field's own
 * name fixes the type. That is also why the type list is exactly one — a bare value carries no type tag, so
 * a second permitted type would leave a reader unable to tell a hash from a URL. `url` is excluded for the
 * further reason that this carrier is already the weakest in the set; pairing an uncovered header with an
 * unattested target would compound two weaknesses into something a reader could easily overread.
 *
 * The container is `header-map`, the only one in the placement set: RFC 9110 field names compare
 * case-insensitively, so the kit folds case on read and reuses an existing key's casing on write. Neither is
 * a heuristic — it is what reading and writing an HTTP field map correctly means.
 */
export const VISA_TAP_PLACEMENT_TIER_A: PlacementManifest = {
  protocol: "visa-tap",
  pattern: "http-advisory",
  tier: "A",
  encoding: "bare-value",
  container: { kind: "header-map" },
  field: "headers.x-lcp-hash",
  carrierTypes: ["sha256"],
  specRef:
    "Visa TAP — custom HTTP header outside the Signature-Input covered set (@authority, @path); RFC 9421 §1.1/§2.5 (gate discharged 2026-07-30: see README)",
};
