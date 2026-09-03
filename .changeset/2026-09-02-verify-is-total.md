---
"@integraledger/lcp-verify": patch
"@integraledger/lcp-conformance": patch
---

`verify()` was not total: two slots reached a primitive that raises, so a malformed record became a
`TypeError` at the callsite instead of a report. `steps.ts` states the opposite in capitals — EVERY STEP
IS TOTAL, "because the callers they exist for are untyped", and "a walk that throws cannot report the
malformation it was handed".

- `fingerprintStep` handed `atrBytes` to `SubtleCrypto.digest`, which does its own type check and throws.
  A JSON-decoded byte array — what an HTTP intake produces for `{"atrBytes":[123,34,97,125]}`, the live
  path — an object, a number, a string and a boolean all raised. A slot that is not a `BufferSource` now
  reads `not-attempted("malformed-atr-bytes")`. Not `indeterminate`: that says the ATR could not be
  retrieved, and here something was supplied.
- `recourseStep` handed `evidenceRoles` to `new Set`, which throws on a non-iterable — and a STRING, which
  IS iterable, quietly became a package of one role per character, so `"atr"` read as `a`, `t`, `r`. A
  non-array now reads `not-attempted("no-evidence-package")`, the token an absent slot gets. A real empty
  array is untouched and still `evidence-package-incomplete`: supplied and short is not absent.

Both are reachable only past a SECOND slot — `fingerprintStep` returns `indeterminate` before hashing
unless a settled hash is also present, `recourseStep` stops at four earlier guards unless the ATR parses
and carries both elections — which is why neither had a case.

The corpus gains three `verify.recourse` cases. 856 → 859; the corpus root moved.

The property test whose title is "never throws, whatever shape the caller supplies" had **no `atrBytes`
key in its generator at all**, so every one of its 500 runs short-circuited at the first guard of both
steps. A generator that omits a slot is not a weak oracle; nothing downstream of the omission is under
test. It now generates `atrBytes` and `settledAtrHash` — real bytes, a real ATR, and the untyped shapes
including the JSON byte array — and both throws reproduce from it.
