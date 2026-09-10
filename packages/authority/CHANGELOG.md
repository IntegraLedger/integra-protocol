# @integraledger/lcp-authority

## 0.17.0

### Patch Changes

- @integraledger/lcp-binding-core@0.17.0
  - @integraledger/lcp-kernel@0.17.0

## 0.16.1

### Patch Changes

- @integraledger/lcp-binding-core@0.16.1
  - @integraledger/lcp-kernel@0.16.1

## 0.16.0

### Patch Changes

- bb48020: An RPC outage is no longer reported as a forged signature.
  
  `verifyAcceptanceSignature` wrapped the bound verification call in `try { … } catch { return false }`. For
  `eip191` and `eip712` that closure is pure offline recovery, so a throw genuinely is the signature. For
  `evm:erc1271` and `evm:erc6492` it is an on-chain call, and viem has already drawn the line inside it: a
  signature the validator rejects makes the deployless call revert, viem catches its own `VerificationError`
  and returns `false`, and it rethrows only for an HTTP 429, a timeout, or a node that answered garbage.
  Swallowing that rethrow turned every rate-limited RPC into `acceptance/bad-signature` — "signature did not
  verify" — publishing a valid buyer acceptance as a forgery, a verdict the next run reverses. The package's
  own README argued the opposite doctrine three paragraphs above the code: "'not verified' and 'verified as
  forged' are different facts."
  
  The guard is now scheme-shaped: it wraps the offline recovery only, and an on-chain call's throw
  propagates. **This changes published behaviour** — a caller of `verifyAcceptanceSignature` or of the
  `SignatureVerifier` returned by `makeEvmAcceptanceVerifier`, on a smart-account scheme, must now handle a
  rejection where it previously received `false`. That is the point of the change: the two facts were
  indistinguishable and one of them was wrong. The `false` verdict for a signature the chain actually
  rejected is unchanged.
  
  `authority` gains no behaviour change, only the contract in writing: `SignatureVerifier.verify` returning
  `false` means CHECKED AND INVALID, and `verifyAcceptance` deliberately does not catch a rejection from the
  port, because `acceptance/bad-signature` is a claim about the record and an unreachable node has made none.
  
  The replaced test asserted the defect outright — "an on-chain call that throws is reported as false, not
  propagated (a verifier must not crash)".
- @integraledger/lcp-binding-core@0.16.0
  - @integraledger/lcp-kernel@0.16.0

## 0.15.1

### Patch Changes

- Updated dependencies [83ae16e]
- Updated dependencies [431b8ec]
- Updated dependencies [9c42f73]
  - @integraledger/lcp-kernel@0.15.1
  - @integraledger/lcp-binding-core@0.15.1

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
against the published LCP specification and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
