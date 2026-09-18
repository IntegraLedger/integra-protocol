---
"@integraledger/lcp-authority": minor
---

The authority package records a presented attestation as an inspectable envelope

`recordAttestation` reads a presented attestation into a `RecordedAttestation`, carrying the profile,
substrate, subject, assurance and artifact reference exactly as the presenter stated them, beside an
`AttestationSubstrateCheck` recording that no substrate cryptography was checked here; the substrate is
compared with nothing, so an attestation on a substrate this package has never heard of is recorded rather
than refused, and `walkChainStructure` carries the result onto the link readout.
