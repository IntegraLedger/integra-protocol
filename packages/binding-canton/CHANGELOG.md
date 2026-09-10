# @integraledger/lcp-binding-canton

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

### Minor Changes

- fa1288c: `propose` sends the `createdAt` the Daml template requires, and the drift gate no longer excuses it.
  
  `daml/Main.daml` declares `createdAt : Text` as a required field of `LcpAnchor`. `buildAnchorPayload` sent
  four fields and the name appeared nowhere in `src/`, so every create command this package built was one the
  participant would reject with a Daml type error — at deployment time, on somebody else's ledger. The only
  code that ever supplied it was this package's own live harness, which spread it onto the codec's output by
  hand immediately before the create, which is why the on-chain proof passed over the defect.
  
  ⛔ The gate that exists for exactly this drift had been taught the exception: `test/daml-template.test.ts`
  asserted the template's fields equal `[...sent, "createdAt"]`. A drift gate that names its own drift
  asserts that the two sides agree except where they do not. The assertion is now a plain equality and the
  harness submits the command as built.
  
  **This changes published behaviour**: `createdAt` (ISO-8601 UTC, `Z`-terminated) is a REQUIRED input to
  both `propose` and `buildAnchorPayload`. It is not defaulted to the current time — this codec is pure, a
  builder that read the clock would emit a different payload for the same inputs, and the caller is the one
  who knows when the settlement happened. `anchorCreatedAt` is exported for callers that want to validate the
  stamp on its own; an offset or a local time is refused rather than normalized, so one instant has one
  spelling on the ledger.

### Patch Changes

- feab885: Five README examples that failed on their first line, and a gate that runs the examples.
  
  Each was the first thing a stranger runs, on the npmjs landing page:
  
  - `binding-evm-x402` opened with `getX402Deployment("base-sepolia-usdc")`; the keys are `base`,
    `base-sepolia`, `avalanche`, `monad`. It threw.
  - `discovery` told the reader to read `hashesAgree`; the field is `hashesMatch`, so the documented read is
    `undefined` — falsy — and records a MISMATCH for a hash that matched, the exact defect the two-field
    design exists to prevent.
  - `placement-ucp`'s only usage example refused `ucp/terms-url-missing`: this protocol declares a terms-URL
    slot, so an integrity-bearing reference needs one, and every sibling README passes it.
  - `placement-ack` claimed a `url` carrier in the canonical slot "passes `requireIntegrity`". It did when
    written; `requireIntegrity` now checks the value's type as well as the slot's declared class and returns
    `undefined`. The narrower point that survives is stated instead.
  - `binding-canton` documented a DAR filename, `lcp-anchor-0.9.0.dar`, that no build produces —
    `daml.yaml` carries the package version, gated by a test. Both the README and `daml.yaml`'s own comment
    now write the version as a glob, because a pinned number inside a copyable command goes stale at the
    next bump and had already done so twice.
  
  The mechanism behind all five is that `check:docs` COMPILES fences and never runs them. `check:doc-calls`
  runs the subset that can be run — a call of a workspace export whose every argument is a literal — and
  refuses a throw or a returned `Refusal`. It also reads the inversion: a line the document annotates
  `// throws` or `// refuses` must fail, so a demonstration that quietly starts succeeding is caught too.
  Elided arguments (`"0x…"`) and calls inside a `try` are skipped as structurally not assertions. It refuses
  an empty subject set, and it runs 30 calls across 74 fences today.
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
