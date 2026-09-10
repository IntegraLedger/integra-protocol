# @integraledger/lcp-binding-cardano

## 0.18.1

### Patch Changes

- @integraledger/lcp-binding-core@0.18.1
  - @integraledger/lcp-kernel@0.18.1

## 0.18.0

### Patch Changes

- @integraledger/lcp-binding-core@0.18.0
  - @integraledger/lcp-kernel@0.18.0

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

- f630fd2: Six gate weaknesses, and the three shipped case-folds one of them was not reaching.
  
  - `check:dist` was the only gate in `scripts/` with no non-empty floor: an unbuilt tree printed
    `0 build outputs across 0 packages` and exited 0. Driven by `pnpm clean` — it now refuses.
  - `spec-version.test.ts` claimed to catch "a future package that hardcodes the string" over a literal
    two-element array of paths, which by construction cannot contain a future package.
    `binding-cardano/src/metadata.ts` already carried the literal twice, in docblocks reading
    `e.g. "0.1.38"`. The subject set is derived from every `packages/*/src/**/*.ts`, exempting only the
    definition; the two comments now name the constant instead of a revision.
  - `atrhash-case-invariant` said "nothing in the tree case-folds an atrHash except this file" while three
    files did. Its regex admitted a bracket but not the quote inside one, and required the fold to sit
    against the name, so `doc["atrHash"].toLowerCase()`, `stripHexPrefix(atrHash).toLowerCase()` and
    `atrHashFromCid(cid).toLowerCase()` were all invisible. Widened, and the three sites now go through the
    kernel: `discovery`'s emit path and `binding-canton`'s ledger-text form call `canonicalAtrHash` (one
    validation and one fold, in the one place that owns both), and `evidence`'s fold is gone — the value it
    folded is lowercase by construction.
  - `vectors/legal-context/schema.json` is what a third party validates against, generated from the Zod
    schema, and guarded only by two `toContain` assertions. It had already drifted: its `description` was
    missing a word the generator emits. The vector is re-rendered and pinned by equality on the parsed value.
  - `release.yml`'s packing loop read `|| continue`, and a `require` that throws exits 1 exactly as a private
    package does — so a manifest with a stray comma silently left the publishable set and the run stayed
    green. The probe now exits 2 for an unreadable manifest and the release stops. `publish-integrity.mjs`
    had the same collapse in a `catch { continue }` and now distinguishes ENOENT from a parse failure.
  - `tags.yml` annotated two pinned action SHAs `v5.0.1` and `v6.0.0`; the same SHAs are annotated `v7.0.1`
    and `v7.0.0` at twenty other sites in this repository. The SHA is what pins, so nothing was exploitable —
    the comment is what a reviewer reads.
  
  Behaviour: `emit` and `atrHashToLedgerText` now throw the kernel's message rather than each package's own
  on a malformed atrHash. Both threw before.
  
  The corpus root moves to `c2875add14f5f2bf…` — the schema vector's re-render is a sealed file.
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
