---
"@integraledger/lcp-binding-evm-common": minor
---

`isEasValidAsOf` now bounds the validity interval from below.

The predicate answers "was this attestation valid AS OF the settlement". It gated on existence, revocation
and expiry — three facts that all bound the interval from ABOVE — and never read `att.time`, EAS's creation
timestamp, which was decoded and used by nothing. So an attestation minted the day after a settlement was
reported valid as of that settlement: backdating by omission, and the one direction an attester can exploit
after the fact.

`att.time > asOfUnixSeconds` is now a refusal. The boundary is inclusive in the same sense as the other
two: revoked or expired AT the as-of second is invalid, attested AT the as-of second is valid.

**This changes published behaviour** — a caller passing an attestation newer than its as-of instant now
gets `false` where it previously got `true`.
