# @integraledger/lcp-placements

## 0.10.0

Released as part of a flat `0.10.0` across the whole suite, so this package carries the suite version even
though its own change is dependency-level: two placements it re-exports renamed an export, and the registry
itself is unchanged.

### Patch Changes

- Updated dependencies [3f2d2e3]
  - @integraledger/lcp-placement-mastercard-vi@0.10.0
  - @integraledger/lcp-placement-visa-tap@0.10.0

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
