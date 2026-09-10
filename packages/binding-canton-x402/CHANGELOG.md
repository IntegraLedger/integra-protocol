# @integraledger/lcp-binding-canton-x402

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

- e4dde9b: The participant endpoint paths are configuration, not constants this package invents.
  
  `makeCantonX402Reader` POSTed to `/v1/updates/transfer` and `/v1/updates/transfers`. Neither names an
  endpoint of any published Daml JSON API version — v1 defines `/v1/create`, `/v1/exercise`, `/v1/query` and
  `/v1/fetch` and no `updates` family, and the update endpoints that do exist live under `/v2/`. Nothing here
  could have caught it: the only assertion over those paths was a stubbed `fetch` compared against the URL
  the code itself builds, so the test and the code restated one guess to each other.
  
  The fix is not a better guess. A Canton Coin `TransferFactory_Transfer` is a token-standard object, and
  how a deployment exposes one over HTTP — stock JSON Ledger API version, scan proxy, or a facilitator's own
  service in front of the participant — is a property of that deployment. `CantonX402ReaderConfig` therefore
  requires `transferPath` and `transfersPath`, refuses an empty one at construction rather than POSTing to
  the base URL, and the live harness reads them from `CANTON_X402_TRANSFER_PATH` /
  `CANTON_X402_TRANSFERS_PATH` (mapped in `live-proofs.yml`, so `check:live-rails --check-env` names them
  when a run cannot proceed).
  
  **This changes published behaviour**: `makeCantonX402Reader` now needs two more fields and throws without
  them.

### Patch Changes

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

First release. Welds an ATR hash into a Canton Coin settlement over x402's `exact` scheme for Canton:
the seller advertises `PaymentRequirements.extra.memo`, the payer echoes it into the transfer metadata
under `x402.memo`, and the facilitator rejects `invalid_exact_canton_memo_mismatch` on a mismatch
(scheme safety check 12). A §8.3.1 Native Field binding, conforms to the published LCP specification.

Split out of `@integraledger/lcp-binding-canton` rather than replacing it: x402's exact-Canton scheme
settles Canton Coin only, so the `LcpAnchor` overlay remains the carrier for every other Canton
deployment. One chain, two carriers, two rails — `canton` and `canton:x402`.
