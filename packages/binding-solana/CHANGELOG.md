# @integraledger/lcp-binding-solana

## 0.10.1

**0.10.0 was staged and withdrawn before approval; this is that release, re-cut.** The conformance corpus
was re-sealed after 0.10.0 was staged — its root moved `32fa90a6…` → `28bbf4ef…` when the vector tree was
brought inside the prose gates — so the staged `lcp-conformance` tarball carried a seal that no longer
matched the repository. The seal is what proves corpus authenticity to an independent implementer, and a
published version cannot be replaced, so the whole set was rejected and re-cut rather than shipping one
package that disagreed with its own source. No version 0.10.0 exists on the registry.

### Minor Changes

- e837c02: **Breaking:** the memo codecs are named for the carrier they encode.

  `binding-solana` — `encodeAtrMemo` → `encodeSplMemo`, `decodeAtrMemo` → `decodeSplMemo`, `verifyAtrMemo` →
  `verifySplMemo`.

  `binding-tempo-mpp` — `encodeAtrMemo` → `encodeTip20Memo`, `decodeAtrMemo` → `decodeTip20Memo`,
  `verifyAtrMemo` → `verifyTip20Memo`.

  Both packages exported all three names, and they are not the same function: one encodes an SPL Memo
  instruction's data (UTF-8 or raw bytes, returning `Uint8Array`), the other a TIP-20 `bytes32` memo
  (returning `0x`-hex). `encodeAtrMemo(atrHash)` typechecked against both, so importing the wrong package
  returned the wrong shape from a call that read correctly. Naming them for the carrier follows what these
  packages already do elsewhere — `MEMO_PROGRAM_ID`, `TIP20_ADDRESS_PREFIX`, `PAY402_MODULE` — and makes the
  import self-describing.

  Found by the new published-surface invariant rather than by hand, which is the point of adding it.

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
