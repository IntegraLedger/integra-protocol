import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * ACP (Agentic Commerce Protocol) reference placement, cut against the live spec (stable 2026-04-17,
 * `spec/2026-04-17/json-schema/schema.agentic_checkout.json` and `schema.extension.json`), re-read 2026-07-28,
 * reconciled against LCP v1.37 §C.2 the same day, re-read 2026-07-30 for the write half, and re-cut against
 * v1.38 §C.2 on 2026-08-08 when that section withdrew the write.
 *
 * **The session object is TOP-LEVEL.** `CheckoutSessionBase` carries `id`, `protocol`, `capabilities`,
 * `buyer`, `status`, `currency`, `totals`, `metadata`, … directly — there is no `checkout` wrapper on the
 * wire, so the declared field is `metadata.legal_context`. `CheckoutSessionBase` is also
 * `additionalProperties: false`, which means the metadata map is not a preference over a native top-level
 * field: no AD-HOC top-level field is available on any session, and this is the only home that asks nothing of
 * the counterparty. A top-level field IS reachable — the one an extension declares — but only in a session
 * RESPONSE that declares the extension, which is why that carrier is written conditionally and this one is not.
 *
 * **pattern is `http-advisory`, tier A.** ACP's `metadata` is
 * documented "Arbitrary metadata for merchant use" with `additionalProperties: true`. Riding it is LCP
 * §8.3.7 exactly — "a request or response field … or equivalent protocol-specific carrier" that does not
 * commit the value to the settlement transaction.
 *
 * It is deliberately NOT §8.3.6 Protocol Extension. That pattern means a registered extension is defined
 * **in the host protocol** with `atrHash`-aware semantics **built into its verification and settlement
 * procedure**. ACP has defined no such thing, and we have not asked it to. ACP does offer a formal
 * `Capabilities.extensions` mechanism (`name` / `extends` JSONPath / `schema` / `spec`), and this package does
 * not ADVERTISE an entry there — advertising is a deployment act, and it is not what authorizes the write; see
 * the `readAlso` note below for what does.
 *
 * **ACP PRESENTS ONE CONFORMANT CARRIER, AND THIS PACKAGE WRITES IT.** No top-level `legal_context` is
 * written, and no extension declaration can authorise one: `CheckoutSessionBase` is
 * `additionalProperties: false` and `CheckoutSession` is `allOf: [CheckoutSessionBase]` with no properties
 * of its own, so a session carrying an undeclared top-level key fails validation against the released
 * schema. LCP v1.38 §C.2 says the same. ACP's own core `discount` extension works only because `discounts`
 * is ALREADY a declared property of `CheckoutSessionBase` — its `extends` array documents where the field
 * is rather than creating one.
 *
 * Measured with ajv 8.20 against `spec/2026-04-17`, so nobody has to re-derive it: declaration-only is
 * VALID, the `metadata` carrier is VALID, and a declared-and-gated top-level `legal_context` is INVALID on
 * `additionalProperties`.
 *
 * **The top-level path is still READ.** A counterparty who emits one holds a real reference, and refusing to
 * read it would discard evidence over a disagreement about whose schema is right — the same reasoning that
 * keeps `metadata.legalContext` in `readAlso`. Writing it is what would put a document on the wire that a
 * stock ACP validator rejects in whole, which is the hazard the gate was built to avoid and, in the end, the
 * hazard the gate was.
 *
 * **Declaring the extension remains worthwhile** even though the carrier is `metadata`: the seller advertises
 * it, the agent sends the identifiers it understands, and the response returns the declarations active in the
 * session. Discovery and negotiation are what the declaration is for. Authorisation is not.
 *
 * LCP v1.38 §C.2 also records what riding `metadata` costs: it is "undeclared, unnegotiated, absent from
 * discovery, and carrying no published schema — the appropriate fallback for a counterparty that has not
 * adopted the extensions framework". What it buys is reach. It asks nothing of the counterparty, and it is
 * the only placement here that works against a stock ACP implementation today.
 *
 * The token is not merely a matter of standing. §8.3.6 is **Tier B by definition**: it "fragments adoption
 * until upstream registration lands — stock implementations of the base protocol reject the extended
 * variant". That is false of this placement, which works today precisely because it rides an
 * arbitrary-metadata map rather than an extension anyone must adopt first. So `protocol-extension` did not
 * just overstate our standing in ACP's registry, it misdescribed the placement as undeployable when it is
 * the opposite. `http-advisory` reads weaker and is the true statement.
 *
 * **Only CORE registration is Tier B.** Publishing a third-party extension needs no SEP: ACP's framework
 * admits them under reverse-domain identifiers with no upstream coordination. What needs one is registration
 * as a **core** extension — a bare identifier alongside `discount` in ACP's core set, giving parsers
 * standardized handling without bilateral negotiation. That SEP must find a founding-maintainer sponsor to
 * proceed and may be closed as dormant if it does not. Neither path ships code here.
 *
 * §8.3.7 is honest about the cost, and so is this package: the reference here is not on-chain, not
 * zero-party recoverable, and not forward-indexable. A deployment needing stronger evidence pairs this with
 * one of the six settlement binding patterns — which is exactly what happens when ACP's selected payment
 * method is a bound rail (see the settlement note below).
 *
 * **Only CORE registration is Tier B, and the two paths are easy to conflate.** Publishing a third-party
 * extension needs no SEP at all (above); it is admitted under a reverse-domain identifier with no upstream
 * coordination. What needs one is registration as a **core** extension — a bare identifier alongside `discount` in ACP's core set, giving
 * parsers standardized handling without bilateral negotiation. That SEP must find a founding-maintainer
 * sponsor to proceed and may be closed as dormant if it does not. Neither path ships code here.
 *
 * **`termsUrlField` is not ACP's `links[type=terms_of_use]`, and must not be read from it.** ACP carries a
 * required `links[]` whose item `type` is a closed enum including `terms_of_use`. That link is the merchant's
 * **standing policy page**; `termsUrlField` names the **ATR terms document for this transaction**. They are
 * different objects, and `Link` is `additionalProperties: false` with a closed eight-value enum, so a
 * per-transaction reference could not ride there even if the two were conflated. Falling back to `links`
 * when `metadata.legal_context_url` is absent would silently substitute a policy page for a terms record —
 * a fallback path. The reason is the carrier's own: those links "carry no hash-verified integrity
 * guarantee" (LCP v1.38 §C.2), so falling to one would answer a question about integrity with evidence that
 * carries none. §C.2 adds that "A terms-of-use policy page is not a per-transaction terms record and is not
 * a substitute for one" — descriptive in v1.38, where v1.37 wrote "MUST NOT be substituted for one". This
 * The conclusion does not rest on which way the appendix words it.
 *
 * **Write direction, and it is NOT the same for both carriers.** `metadata` appears on `CheckoutSessionBase`
 * and on `CheckoutSessionCreateRequest`, and is **absent** from `CheckoutSessionUpdateRequest`
 * (`additionalProperties: false`). The canonical reference is therefore written at session create, or by the
 * merchant in a session response — never through a session update.
 *
 * The GATED carrier's write direction is narrower: **session response only.** An extension declaration
 * authorizes a field on the one schema its `extends` target names, and ACP's own core `discount` extension
 * proves the granularity by enumerating `$.CheckoutSessionCreateRequest.discounts`,
 * `$.CheckoutSessionUpdateRequest.discounts` and `$.CheckoutSession.discounts` as three separate targets. Ours
 * names `$.CheckoutSession.legal_context`, which is the response and nothing else — and it could not honestly
 * name the create request, because at create time the agent has sent the identifiers it understands and the
 * seller has declared nothing, so no create request can carry a negotiated authorization. That the request is
 * out of reach does NOT follow from the shapes: `Capabilities` is one definition shared by request and
 * response and its `extensions` `oneOf` is undiscriminated, so a schema-valid `CheckoutSessionCreateRequest`
 * may carry declaration OBJECTS. Measured against the live schema, an identifier-only gate turns a valid
 * create request into an invalid one — `legal_context` against `additionalProperties: false` with nothing
 * naming it. The gate therefore carries a second term; see `readAlso` below.
 *
 * ACP settles through whatever payment method the checkout selects, and that settlement is NOT this
 * package's business: if the selected method is a bound rail, the rail binding welds the record and the
 * class ladder reads it; if not, this placement is the whole of the record's protocol reach and the record
 * reads with an honest `not-attempted` at `settlement-enumeration`.
 *
 * `carrierTypes` permits `sha256` and `url` and excludes `ipfs`/`ar`. The map is `additionalProperties: true`
 * — NOT a string-to-string dictionary — so the restriction rests on length, not
 * on the value type: these are the two forms short enough to ride a metadata value no implementation is
 * obliged to preserve at length. Widening is a vector amendment (charter §4), never a code-side default.
 */
export const ACP_PLACEMENT: PlacementManifest = {
  protocol: "acp",
  pattern: "http-advisory",
  tier: "A",
  encoding: "lcp-string",
  // ACP's slot is addressable directly, so the locator IS a resolvable dotted path and needs no search rule.
  // The two protocols that do need one (UCP's `links`, Mastercard VI's `constraints`) declare `tagged-array`.
  container: { kind: "object-path" },
  field: "metadata.legal_context",
  // `metadata` is `additionalProperties: true` and accepts any key, so NOTHING in ACP's grammar constrains this
  // one: `legal_context` follows the convention ACP's own schema is written in — snake_case throughout — and
  // that is house style meeting a convention, not a host requirement. The host's grammar does fix the
  // TOP-LEVEL alias below, where `extends_target`
  // (`^\$\.[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9_]*)*$`) admits `$.CheckoutSession.legal_context` and
  // REJECTS `legal-context`. Keeping the two apart matters: attributing our own choice to the host is the
  // overclaim the host-governs rule exists to prevent.
  //
  // Two other spellings exist, and both are read. THE ORDER WITHIN `readAlso` IS DECLARED, NOT INCIDENTAL —
  // the stronger of the two answers first. It is not the order of the whole read: `extract` reads `field`
  // BEFORE any alias, so on a document carrying both the canonical `metadata` string answers, which is
  // deliberate (a document carrying two spellings is answered with ours) and is pinned as its own case.
  //
  // 1. `legal_context` TOP-LEVEL is READ and never written. LCP v1.38 §C.2 withdrew the home it would be
  //    written into: `CheckoutSessionBase` is `additionalProperties: false` and `CheckoutSession` is a bare
  //    `allOf` over it with no properties of its own, so no ExtensionDeclaration can make a new top-level
  //    key valid — measured INVALID with ajv 8.20 against `spec/2026-04-17`. A counterparty that emits one
  //    anyway still holds a real reference, and reading it costs nothing; writing it would put a document on
  //    the wire that a stock ACP validator rejects in whole.
  //
  //    No gate would help, because the question a gate would answer — "is this write authorised?" — has no
  //    yes. `extends: ["$.CheckoutSession.legal_context"]` documents where a field would be; it does not
  //    create one.
  //
  // 2. `metadata.legalContext` is LCP Appendix C.2's own illustration. That appendix is informative and
  //    non-prescriptive, so it does not move our canonical field — but an implementer who followed it
  //    literally holds a real reference, and `extract` reads it. Writing a second spelling nobody asked for
  //    would be asserting a shape onto the wire.
  //
  // Each alias declares its OWN encoding: both hold a §8.1 OBJECT while our canonical field holds an `lcp:`
  // STRING. Same reference, three shapes — which is exactly why an alias is an object and not a bare path.
  // All are `integrity` (the default): these are spelling and strength differences, never a guarantee
  // difference, and nothing here may fall back to ACP's `links` — see the termsUrlField note below.
  //
  readAlso: [
    { path: "legal_context", encoding: "reference-object" },
    { path: "metadata.legalContext", encoding: "reference-object" },
  ],
  termsUrlField: "metadata.legal_context_url",
  carrierTypes: ["sha256", "url"],
  specRef:
    "ACP agentic checkout — CheckoutSessionBase.metadata (stable 2026-04-17)",
};
