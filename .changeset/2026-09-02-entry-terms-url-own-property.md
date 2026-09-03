---
"@integraledger/lcp-binding-core": patch
---

`readTermsUrls` read the tagged-array entry's terms-URL field with a bare index, so a document could
advertise a locator through its PROTOTYPE. Every other read on this seam is own-property guarded —
`readAtPath` on every segment, and `readFromContainer` on both the entry's tag and the reference beside
it — and `taggedEntry`'s own docblock claimed this one was too.

Measured against the shipped UCP placement, whose `termsUrlField: "url"` sits on a `policies[type=…]`
entry: an entry owning `type`, `description` and the reference and inheriting `url` extracted as
`{"termsUrl":{"kind":"read","url":"<attacker's>"}}`, while the same entry with no `url` anywhere correctly
answered `declared-fields-empty`. An attacker-chosen locator was presented as the counterparty's own
advertisement, and the inherited value could also reach the reconciliation arm and manufacture a
`mismatch` against a document whose one real advertisement was coherent.

A field the entry did not claim now reads as absent, which is the answer `declared-fields-empty` exists to
give. Owned values are unchanged.
