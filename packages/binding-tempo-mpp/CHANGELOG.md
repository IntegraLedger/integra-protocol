# @integraledger/lcp-binding-tempo-mpp

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

## 0.9.0

First public release.

`0.9.0` is deliberate: this is a release candidate for 1.0, not a preview. The implementation is complete
against LCP v1.38 and certified by the conformance corpus, and the remaining distance to 1.0 is the
specification's own — the standard is still moving through its steering committee, and this package will not
claim a stability its protocol has not yet promised.

Development before this release happened in a private repository and is not reproduced here; no earlier
version was ever available to install.
