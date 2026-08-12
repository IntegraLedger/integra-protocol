# @integraledger/lcp-placement-mastercard-vi

## 0.10.0

### Minor Changes

- 3f2d2e3: **Breaking, two wire identities and one exported name.**

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

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
