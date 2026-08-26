# @integraledger/lcp-binding-evm-mpp

## 0.13.0

### Patch Changes

- @integraledger/lcp-binding-core@0.13.0
- @integraledger/lcp-binding-evm-common@0.13.0
- @integraledger/lcp-kernel@0.13.0

## 0.12.3

### Patch Changes

- Updated dependencies [82444ad]
- Updated dependencies [48d1346]
  - @integraledger/lcp-binding-evm-common@0.12.3
  - @integraledger/lcp-binding-core@0.12.3
  - @integraledger/lcp-kernel@0.12.3

## 0.12.2

### Patch Changes

- @integraledger/lcp-binding-core@0.12.2
- @integraledger/lcp-binding-evm-common@0.12.2
- @integraledger/lcp-kernel@0.12.2

## 0.12.1

### Patch Changes

- 353352f: MPP-EVM: the §8.3.5 discharge is not checked in this package, and the profile said it was

  `MPP_EVM_MANIFEST`'s finality note read _"The tree checks it as OFR — `offerBoundStep`, required at TC-4"_
  about the §8.3.5 discharge, which per LCP §C.1 rests on the ATR **stating the transaction parameters**.
  `offerBoundStep` is, in full, `c?.offerBound ? proved : not-attempted("no-offer")` — one boolean off the
  composition slot. It never sees an ATR and cannot establish anything about what the hashed document states.

  That claim is published: it ships in `vectors/binding/mpp-evm-profile.json` and the `binding.profiles`
  corpus case, where a stranger's auditor reads it as a check this software performs.

  The note now says what is true — that nothing in this package establishes the discharge and no verifier
  reading the wire alone can, because whether the ATR states the parameters is a property of the bytes the
  seller hashed, checkable only against the ATR itself. It names `offerBoundStep` explicitly as the thing
  sometimes mistaken for it, and says what that step actually reports.

  `offerBoundStep`'s contract is now pinned beside the step in `verify`'s own suite: it proves on the flag
  alone with every field of the charge absent, and an unbound offer is incompleteness rather than a failure.
  A future change that made it a real parameter check fails that test and forces the profiles describing it to
  be revisited.

  ⚠️ No behaviour changes. The corpus root moves because the profile document is part of the sealed corpus.

  - @integraledger/lcp-binding-core@0.12.1
  - @integraledger/lcp-binding-evm-common@0.12.1
  - @integraledger/lcp-kernel@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - @integraledger/lcp-kernel@0.12.0
  - @integraledger/lcp-binding-core@0.12.0
  - @integraledger/lcp-binding-evm-common@0.12.0

## 0.10.2

### Patch Changes

- b2ffecc: Report the class a record actually supports, place a terms URL on UCP, and stop refusing a conformant UCP
  profile — the remediation of the 2026-08-19 conformance re-audit.

  **`verify` now computes `supportedClass` instead of echoing the claim.** It was `anyFailed ? "TC-0" :
claimedClass`, so a record proving nothing — no settlement, no acceptance, no authority chain — reported
  whatever class the caller named, while the field's own published docblock promised "what the record
  honestly supports, not what the caller asked for". It is now the highest class every one of whose required
  steps is `proved`, `TC-0` on any failure, computed from the steps alone: neither capped by the claim (rungs
  that reach TC-3 read TC-3 where the caller claimed TC-2) nor lifted by it. White paper #4 §5 defines the
  class of a transaction as "the highest class whose criteria it fully meets", and this is that.

  The claim is not discarded — the report gains **`claimedClass`**, a required member, because `verified`
  answers "did the record reach the class it claimed?" and cannot be read without it. The two fields are the
  report's two halves: an input echoed, and a finding computed. Where they differ, the record did not reach
  its own shape. An out-of-taxonomy claim now lands only in the echo and can no longer masquerade as a
  finding.

  **UCP can advertise a terms URL.** Its policy object declares `url` — "Optional link to the full policy
  document", `format: uri` — on the very entry this placement writes, and §C.3's illustration carries `url`
  and `atrHash` side by side there. The manifest previously said the protocol had no slot, citing `links[]`,
  which §C.3 separates as "a standing page, not a per-transaction record". The obstacle was mechanical:
  `termsUrlFields` addresses document paths, and a tagged-array entry's index is chosen at write time. The
  `tagged-array` container therefore gains `termsUrlField`, written onto the same entry in the same write, and
  read back through the same first-match rule. UCP was the last shipped protocol that refused an
  advertisement carrying its own locator (integra-protocol#8).

  **`readUcpProfile` no longer refuses a conformant business profile.** `requireHttps` mapped an ABSENT `spec`
  to the same branch as a malformed one, and the live host requires `spec` only of a platform declaration —
  as this repository's own README already said. It is now `requireHttpsIfDeclared`: absence is absence, and a
  declared value is still held to the host's https MUST.

  Also: `requireWritten` replaces an unchecked cast in the x402 override, so a broken postcondition throws
  instead of returning a success carrying no document; six x402 citations move to the revision that actually
  touches the file they name, and a new gate refuses any `owner/repo@sha` in source that `spec-pins.json` does
  not record; four spec citations move from line anchors to section anchors; the escrow binding states why it
  declares no §8.3.1 off-canonical variant, and asserts it; and §C.3's `policies[]` illustration is recorded as
  invalid against the live UCP schema, which shows `description` as a bare string where the host requires an
  object — owed upstream, not a defect here.

  Corpus 844 → 847, root `ec4ad1b02a81538b…`.

- Updated dependencies [b2ffecc]
- Updated dependencies [822190a]
  - @integraledger/lcp-binding-core@0.11.0
  - @integraledger/lcp-binding-evm-common@0.10.2
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
