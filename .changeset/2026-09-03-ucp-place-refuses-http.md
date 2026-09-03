---
"@integraledger/lcp-placement-ucp": minor
"@integraledger/lcp-conformance": patch
---

UCP's HTTPS rule now applies to `place`, not only to `extract`.

The placement wrapped `extract` alone, under a docblock reasoning that "`place` never writes the links
alias, so the write side has no URL to police". The write side does have one: the `policies[]` entry
`place` writes carries the reference itself, `url` is a permitted carrier type here, and `place` accepted an
`http:` url reference and emitted a document this very module's `extract` refuses. A placement that will
not read back the bytes it wrote fails a round trip on its own output.

The terms URL was never the gap — the kit already refuses a non-https `termsUrl` at
`ucp/terms-url-malformed`. The reference was, and a url-typed reference inside a policies entry is exactly
as rewritable in transit as one in `links`. The rule is now stated once and applied in both directions.

**This changes published behaviour**: `ucpPlacement.place` refuses `ucp/insecure-terms-url` where it
previously returned a written document.

The corpus gains the write half of the rule and an https control beside it. 859 → 861; the corpus root
moved to `a47801f6ecfc96b2…`.
