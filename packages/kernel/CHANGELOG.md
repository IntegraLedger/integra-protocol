# @integraledger/lcp-kernel

## 0.12.2

## 0.12.1

## 0.12.0

### Minor Changes

- Release the protocol as ONE line: every publishable package now versions in lockstep.

  `fixed` covered `kernel`, `binding-core` and `verify` and left the other twenty-eight to bump per
  changeset. The first release under that arrangement cut two lines at once — `0.11.0` for the packages a
  changeset touched, `0.10.2` for the rest — and the two are not independently meaningful. These packages ship
  from one commit, are certified as a set by one conformance corpus, and are only ever installed together; a
  consumer cannot pair `verify@0.11.0` with `binding-xrpl@0.10.1`, because that combination was never built or
  tested. Per-package numbers therefore conveyed no independence a consumer could use, and did convey a
  choice they should never make.

  They also broke the downstream check that exists to stop exactly this class of defect. The product repo
  refuses a tree declaring more than one protocol line — a gate written after both halves of the product
  shipped green and did not interoperate — and a mixed release makes that gate unsatisfiable by any correct
  pin set.

  So the group is now every `@integraledger/lcp-*` package, and one version identifies the line. The private
  `lcp-rail-invariants` is unaffected: changesets does not version private packages.

## 0.11.0

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
