---
"@integraledger/lcp-binding-core": minor
"@integraledger/lcp-placement-x402": minor
"@integraledger/lcp-placement-mpp": minor
"@integraledger/lcp-placement-acp": minor
"@integraledger/lcp-placement-a2a": minor
"@integraledger/lcp-placement-ack": minor
"@integraledger/lcp-placement-ap2": minor
"@integraledger/lcp-placement-ucp": minor
"@integraledger/lcp-placement-visa-tap": minor
"@integraledger/lcp-placement-mastercard-vi": minor
"@integraledger/lcp-placements": minor
"@integraledger/lcp-conformance": minor
"@integraledger/lcp-verify": minor
"@integraledger/lcp-discovery": minor
---

Give the terms URL the write path the published set never had, and certify the composition that broke
without it (integra-protocol#8).

A third party assembling a seller from published parts emitted a 402 the published buyer refuses: every
published reader demanded `legalContextUrl` and no published writer placed it, and the schema
`placement-x402` inlined onto the wire (`required: ["type","value"]`, closed) contradicted the authority
document integraledger.com serves (`required: ["type","value","legalContextUrl"]`, closed) — two
definitions of one `info`, no document valid against both, each package self-consistent. Three structural
gaps let it ship: the manifest's `termsUrlField` was singular and read-only (declared, hygiene-checked,
never written — and x402's wire carries the URL in two slots, so one path could not even name the shape),
nothing compared the inlined schema to the authority document, and the corpus certified `place` and
`extract` separately but never fed one to the other.

`binding-core` — the placement seam now moves an ADVERTISEMENT, not a bare reference. `place` takes
`{ ref, termsUrl? }` and writes the URL at every slot the manifest's new `termsUrlFields` (plural,
replacing `termsUrlField`) declares; it REFUSES an integrity-bearing advertisement with no URL where slots
are declared (a hash no counterparty can resolve is unverifiable by construction), a URL where no slot
exists (silent dropping is fail-open), and a non-https URL on either side of the seam. `extract` returns
`{ ref, termsUrl }` with absence as a typed value — `no-field-declared` is a fact about the protocol,
`declared-fields-empty` a fact about the document, and the gate decides what an absence means — while two
slots that disagree, or a malformed value in either, refuse. The object-path writer learned to descend
into an EXISTING array element (never minting one, never extending a list, refusing an index segment it
would have to create), which is what lets x402's `accepts[0].extra` mirrors land.

`placement-x402` — the inlined wire schema now IS the authority document minus `$id` and `$defs`
(Bazaar forbids both on the wire), drift-gated in `lcp-conformance` where the two packages meet.
`termsUrlFields` declares both slots the wire carries; the bare-hash alias is written (`extra` stopped
being wholly scheme-private when x402 §6.1 reserved names inside it, and LCP v1.38 §C.4's own Tier A
illustration carries the pair there); the `url` carrier admission is withdrawn (`carrierTypes` is
`sha256` alone — the schema on the wire is `const: "sha256"`, and no shipped reader ever accepted a url
in this slot). The `place` override shrinks to composition: the kit performs the whole placement and the
override adds only the `{info, schema}` wrapper.

`placement-mpp` / `placement-acp` — the singular member becomes the one-entry `termsUrlFields`; the kit
now writes the slot their buyer parsers always demanded and refuses first at the seller.

`lcp-conformance` — the corpus grows 812 → 844: a `roundtrip` op (place then extract in one case, the
composition certification whose absence let two separately-conformant halves ship jointly broken),
advertisement-rule refusals for every manifest, and the authority↔wire drift gate. Extract expectations
across every placement area become the extracted advertisement.

`lcp-verify` — `referencePlacementStep` reads the advertisement (`extracted.ref.value`) and deliberately
ignores `termsUrl`: where the terms live is the gate's fetch concern, not a fact the record can
contradict.

`lcp-discovery` — the x402 authority document restates the atrHash pattern inline in both definitions
(no `$defs` indirection the wire copy would have to rewrite) and moves the two-definitions rationale into
`$defs.receipt`, so the challenge-time root is byte-derivable for the wire.
