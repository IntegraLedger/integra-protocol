---
"@integraledger/lcp-verify": patch
---

`verify` no longer throws on a `settledAtrHash` that is not a string.

`fingerprintStep` screened `atrBytes` and only checked `settledAtrHash` for PRESENCE — and `present()`
rejects null and undefined and nothing else. So a non-string reached `atrHashEquals`, which compares
decoded bytes but reaches them through a `RegExp.test`, and `test` coerces its argument: an object whose
`toString` is not callable makes that coercion throw `Cannot convert object to primitive value`. The
package's own contract is that a malformed record is REPORTED, never thrown on.

Found by this package's fast-check property on seed 385868373, and reproduced on `main` before this branch.
`acceptanceStep` carried the same hole on both of its atrHash-shaped slots — `SignedAcceptance.atrHash` is
typed, and a record off a wire is not bound by a type.

Both now read out `not-attempted` with depth `malformed-settled-hash`, under their own name rather than
`no-settled-hash`, which means ABSENT where something was supplied.
