# @integraledger/lcp-binding-evm-x402

## 0.18.0

### Patch Changes

- @integraledger/lcp-binding-evm-common@0.18.0
  - @integraledger/lcp-binding-core@0.18.0
  - @integraledger/lcp-kernel@0.18.0

## 0.17.0

### Patch Changes

- @integraledger/lcp-binding-core@0.17.0
  - @integraledger/lcp-binding-evm-common@0.17.0
  - @integraledger/lcp-kernel@0.17.0

## 0.16.1

### Patch Changes

- @integraledger/lcp-binding-core@0.16.1
  - @integraledger/lcp-binding-evm-common@0.16.1
  - @integraledger/lcp-kernel@0.16.1

## 0.16.0

### Minor Changes

- 62e2b3e: `weldGrades` is keyed by x402's own asset-transfer-method token, not by the escrow sibling's collector name.
  
  The manifest declared `weldGrades: { ERC3009: "signature" }`. Every other rail keys this map in its host's
  vocabulary — `spl-memo`, `invoice-id`, `cap67-mux`, `tx-metadata`, `settle-payment` — and this rail's
  vocabulary is x402's `assetTransferMethod`, which this package exports as
  `EIP3009_TRANSFER_METHOD = "eip3009"` and which x402's exact-EVM scheme spells the same way. `ERC3009` is
  the Commerce Payments Protocol COLLECTOR name that `binding-evm-escrow` declares, where it is correct.
  
  Here it named nothing, so a consumer doing `manifest.weldGrades[assetTransferMethod]` got `undefined` —
  the grade absent rather than wrong, which reads as a rail that declares no weld grade at all. The key is
  now the constant itself, so the manifest and the filter cannot spell it differently.
  
  **This changes published behaviour**: the manifest key, and the published `integra-x402-nonce-v1` profile
  in the corpus, move from `ERC3009` to `eip3009`. Escrow's collector names are untouched. The corpus root
  moves to `c2875add14f5f2bf…`.

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
- Updated dependencies [2fd5eb2]
- Updated dependencies [bb48020]
  - @integraledger/lcp-binding-evm-common@0.16.0
  - @integraledger/lcp-binding-core@0.16.0
  - @integraledger/lcp-kernel@0.16.0

## 0.15.1

### Patch Changes

- Updated dependencies [83ae16e]
- Updated dependencies [1da6c07]
- Updated dependencies [431b8ec]
- Updated dependencies [9c42f73]
  - @integraledger/lcp-kernel@0.15.1
  - @integraledger/lcp-binding-evm-common@0.15.1
  - @integraledger/lcp-binding-core@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [42fb196]
  - @integraledger/lcp-kernel@0.15.0
  - @integraledger/lcp-binding-core@0.15.0
  - @integraledger/lcp-binding-evm-common@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [aca5978]
  - @integraledger/lcp-kernel@0.14.0
  - @integraledger/lcp-binding-core@0.14.0
  - @integraledger/lcp-binding-evm-common@0.14.0

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
against the published LCP specification and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
