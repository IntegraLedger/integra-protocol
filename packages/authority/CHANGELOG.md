# @integraledger/lcp-authority

## 0.15.0

### Patch Changes

- Updated dependencies [42fb196]
  - @integraledger/lcp-kernel@0.15.0
  - @integraledger/lcp-binding-core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [aca5978]
  - @integraledger/lcp-kernel@0.14.0
  - @integraledger/lcp-binding-core@0.14.0

## 0.13.0

### Patch Changes

- @integraledger/lcp-binding-core@0.13.0
- @integraledger/lcp-kernel@0.13.0

## 0.12.3

### Patch Changes

- @integraledger/lcp-binding-core@0.12.3
- @integraledger/lcp-kernel@0.12.3

## 0.12.2

### Patch Changes

- @integraledger/lcp-binding-core@0.12.2
- @integraledger/lcp-kernel@0.12.2

## 0.12.1

### Patch Changes

- @integraledger/lcp-binding-core@0.12.1
- @integraledger/lcp-kernel@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - @integraledger/lcp-kernel@0.12.0
  - @integraledger/lcp-binding-core@0.12.0

## 0.10.2

### Patch Changes

- Updated dependencies [b2ffecc]
- Updated dependencies [822190a]
  - @integraledger/lcp-binding-core@0.11.0
  - @integraledger/lcp-kernel@0.11.0

## 0.10.1

**0.10.0 was staged and withdrawn before approval; this is that release, re-cut.** The conformance corpus
was re-sealed after 0.10.0 was staged — its root moved `32fa90a6…` → `28bbf4ef…` when the vector tree was
brought inside the prose gates — so the staged `lcp-conformance` tarball carried a seal that no longer
matched the repository. The seal is what proves corpus authenticity to an independent implementer, and a
published version cannot be replaced, so the whole set was rejected and re-cut rather than shipping one
package that disagreed with its own source. No version 0.10.0 exists on the registry.

Released as part of a flat `0.10.1` across the whole suite. One number describes the set that was built,
tested and sealed together, so a consumer never has to work out which combination of versions was verified.

This package has no source change of its own in this release. What moved across the suite: three exported
names were corrected before anyone depends on them — `USDC_DECIMALS` became rail-qualified after it was
found to mean 6 on three rails and 7 on Stellar under one name, `VISA_TAP_PLACEMENT_TIER_A` lost the tier
it had baked into an identifier, and the memo codecs were named for the carrier they encode. Two wire
identities were respelled to match the vocabulary they are written into. Five gates were added or widened,
and a large number of documentation claims were corrected against the host specifications at HEAD.

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
