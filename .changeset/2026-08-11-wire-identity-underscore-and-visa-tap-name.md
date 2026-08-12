---
"@integraledger/lcp-discovery": minor
"@integraledger/lcp-placement-mastercard-vi": minor
"@integraledger/lcp-placement-visa-tap": minor
"@integraledger/lcp-conformance": minor
---

**Breaking, two wire identities and one exported name.**

`LCP_CAPABILITY_NAME` is now `com.integraledger.legal_context` (was `com.integraledger.legal-context`), and
`LCP_TERMS_HASH_SUFFIX` is now `lcp_terms_hash` (was `lcp-terms-hash`). Both go on a counterparty's wire, and
both were hyphenated where the host they are written into spells its own vocabulary with underscores
throughout — UCP (`dev.ucp.shopping.checkout`, `com.example.policy.price_match`) and Verifiable Intent (all
eight registered constraint types). Our own UCP `policies[]` carrier already used underscores, so one
deployment identity was spelled two ways. No host forces either spelling, which is why the house had to rule
it: **follow the vocabulary you are writing into.** `LEGAL_CONTEXT_WELL_KNOWN_PATH` keeps its hyphen for the
same reason — RFC 8615 well-known names are hyphenated.

`VISA_TAP_PLACEMENT_TIER_A` is renamed `VISA_TAP_PLACEMENT`, matching every sibling placement. The tier is a
manifest field because it can move; an identifier carrying the answer could only be corrected by a breaking
rename, which is the hazard `placement-mastercard-vi` states as `tier: "B"` IS A LABEL, NOT A GATE.

The conformance corpus is re-sealed: root `32fa90a62eb83930…`, 812/812 across 44 areas, unchanged in size.
Twenty-two cases pinned the old spellings and were updated; the retired spelling survives deliberately in
`binding-core`'s kit fixtures, where it is sample input to container-validation cases cut against v1.37
§C.3's `extensions` shape and asserts nothing about this deployment's identity.

`minor` rather than `major` because these packages are pre-1.0, where minor is the breaking increment.
