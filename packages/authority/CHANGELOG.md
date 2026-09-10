# @integraledger/lcp-authority

## 0.18.1

### Patch Changes

- @integraledger/lcp-binding-core@0.18.1
  - @integraledger/lcp-kernel@0.18.1

## 0.18.0

### Minor Changes

- The walk that checked no proof and the walk that checked every proof were the same value.
  
  ⛔ **BREAKING, and it is the reason this is a minor.** `walkChainStructure` and `walkChain` both returned
  `ChainWalkResult`, whose success case is `{status:"walked", links}` — there was nowhere in the type to
  record that a proof had been checked, and `walkChain` returned the structural object verbatim. Measured: the
  same chain, with `proofValue: "zTOTALLYFORGED"`, reads **`proved`** through the structural walk and
  **`failed`** through the verifying one, and `verify` documents the structural walk as its *preferred* input.
  
  `walkChain` now returns `VerifiedChainWalkResult`, succeeding as `{status:"verified", links}`, and
  `verify`'s `authorityWalk` accepts only that type — a structural result is a **compile error** there, not a
  runtime screen. A shared private helper yields bare `WalkedLink[]` so only the two entry points can name a
  status: `walkChain` cannot return the structural object even by accident.
  
  ⚠️ **A cross-implementation semantics change rides with it.** An absent `credentialStatus` used to stamp
  `revoked: false` — the proving value. `revoked` is now stated only where a status entry was consulted, so
  `authority-attenuation` is unprovable for a chain whose grants carry no status list, and such a chain cannot
  reach TC-3. ATA-3 requires revocability, `authority-producer-ref` emits a status entry from issuance, and
  `no-revocation-stated` is already the token for this condition. **The conformance corpus moves with it:
  861 → 866 cases, root `4c9d2d02…` → `63df22e2…`.**
  
  Also in this release, across the line:
  
  - **`authority`** — the structural walk ran to completion before any proof was checked, with no length
    bound: 5000 links inflated **5.2 GB** and blocked **3.9 s** with **0 proofs checked**, the first of them
    forged. Verification now sits inside the walk, per link, and `AUTHORITY_CHAIN_MAX_LINKS = 64` refuses
    longer chains as a gap rather than a contradiction.
  - **`verify`** — a conformant UCP merchant carrying only the REQUIRED `terms_of_service` link was driven to
    **TC-0**; so was every `ipfs:`/`ar:` reference, through the carrier types meant to be the strongest.
    `discoveryIntegrity: null` read as a DSC-2 violation. Four composition slots read for truthiness, so the
    string `"false"` proved the rung it denies. `frcSignals` threw `TypeError` out of `verify()`.
    `settlements: "none"` reported `multiplySettled: true`. The report gains a required `depth`, because a
    structural and a mechanical report over the same inputs serialized to identical bytes.
  - **`conformance`** — `runCorpus` defaulted to phase P1: **102 of 866 cases certified under a seal line
    reading `866/866`**. The default is now derived from the phase ladder.
  - **`evidence`** — one byte of a CAR length prefix suppressed two artifacts and `verifyBundle` still
    answered `ok: true`; an empty bundle the builder refuses to construct verified clean; a 50 ms timeout
    returned after 1512 ms because the DNS lookup sat outside it. A bundle verdict now carries `fault`, so a
    refusal without a reason is unrepresentable.
  - **`binding-sui`** — the read that recovers a weld looked at the first twenty events of a transaction the
    **buyer** composes, and Sui permits 1024: a weld buried past position 20 read as never anchored. Both
    connections are now walked to exhaustion. Which fields are bytes is read from the endpoint's own
    `contents.type.layout` rather than guessed from a field name.
  - **the rails** — `binding-solana` and `binding-hedera` decoded counterparty-authored payloads before
    filtering to what they trust, so one bad memo killed a scan; `binding-core` accepted
    `lcp:url:javascript:…` as a legal-context reference; `binding-xrpl`'s InvoiceID collision guard was
    optional and therefore off by default; `binding-tempo-mpp` read a decimal quantity as hex, so `"16"`
    pinned log 22; `binding-cardano` compared a metadata label against a string, so db-sync and Koios
    settlements read as unwelded; `binding-evm-escrow` defaulted its escrow address, and that address is
    hashed into `paymentInfoHash`. Eleven rails declared a weld-grade token and withheld it from their barrel.
  - **all nine placements** crashed building the refusal message for a document they had correctly refused.

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
