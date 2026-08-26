# @integraledger/lcp-binding-hedera

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

### Minor Changes

- f1c531c: **Breaking:** `USDC_DECIMALS` is renamed to `HEDERA_USDC_DECIMALS`, `SOLANA_USDC_DECIMALS`,
  `STELLAR_USDC_DECIMALS` and `SUI_USDC_DECIMALS`.

  All four packages exported the same name and they did not all mean the same number — Stellar assets carry
  seven decimals where the other three carry six. Each value was correct for its own chain, so no package had
  a defect and every package's own test passed; the hazard lived only in importing one rail's constant and
  applying it on another, which is a ten-fold error in an amount and surfaces at settlement rather than at
  compile time. The rail prefix makes that import impossible to make by accident.

  `minor` rather than `major` because every package here is pre-1.0, where a minor is the breaking increment
  under semver. Migration is a rename at the import site; the values are unchanged.

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
