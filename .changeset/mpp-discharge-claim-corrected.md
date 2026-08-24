---
"@integraledger/lcp-binding-evm-mpp": patch
"@integraledger/lcp-conformance": patch
---

MPP-EVM: the §8.3.5 discharge is not checked in this package, and the profile said it was

`MPP_EVM_MANIFEST`'s finality note read *"The tree checks it as OFR — `offerBoundStep`, required at TC-4"*
about the §8.3.5 discharge, which per LCP §C.1 rests on the ATR **stating the transaction parameters**.
`offerBoundStep` is, in full, `c?.offerBound ? proved : not-attempted("no-offer")` — one boolean off the
composition slot. It never sees an ATR and cannot establish anything about what the hashed document states.

That claim is published: it ships in `vectors/binding/mpp-evm-profile.json` and the `binding.profiles`
corpus case, where a stranger's auditor reads it as a check this software performs.

The note now says what is true — that nothing in this package establishes the discharge and no verifier
reading the wire alone can, because whether the ATR states the parameters is a property of the bytes the
seller hashed, checkable only against the ATR itself. It names `offerBoundStep` explicitly as the thing
sometimes mistaken for it, and says what that step actually reports.

`offerBoundStep`'s contract is now pinned beside the step in `verify`'s own suite: it proves on the flag
alone with every field of the charge absent, and an unbound offer is incompleteness rather than a failure.
A future change that made it a real parameter check fails that test and forces the profiles describing it to
be revisited.

⚠️ No behaviour changes. The corpus root moves because the profile document is part of the sealed corpus.
