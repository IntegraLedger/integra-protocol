# @integraledger/lcp-binding-evm-common

## 0.15.1

### Patch Changes

- 1da6c07: `verifyEip3009Signature` threw on an attacker-chosen signature instead of answering `false`. Its docblock
  promises the opposite — it "Answers `false` rather than throwing for the two UNTRUSTED inputs" — and a
  seller pre-flighting an inbound x402 `PaymentPayload` was crashed by a hand-built 65-byte string that costs
  no key, no chain and no funds to produce.
  
  `isCanonicalSignature` checked shape, low-s and `v ∈ {27, 28}`, and not that `r` and `s` are in range.
  Measured: `r=0x11…, s=0` threw, `r=0, s=0x11…` threw, and `r` at or above `n` threw. `"not-a-signature"`
  was the only malformed shape the suite drove, and the regex already refused that — so every gate past the
  regex was untested against a hostile value.
  
  The range rules are the token's, on the same footing low-s is: `ecrecover` answers the ZERO ADDRESS rather
  than reverting for `r = 0`, `s = 0` or a component at or above `n`, and OpenZeppelin's `ECRecover.recover`
  — which `FiatTokenV2` routes through — reverts on the zero signer. `1 <= r < n` and `s !== 0` are now part
  of the predicate. Low-s already caps `s` below `n/2`, so on the `s` side the only value the rule adds is
  zero.
  
  The gates went into the predicate rather than a `try` in the caller deliberately: a `try` would also swallow
  an unencodable `typedData`, which is this deployment's own domain being wrong, and would tell an operator
  with a mis-copied `tokenName` that every honest payer is a forger. That case still throws, as the head note
  reserves.
- Updated dependencies [83ae16e]
- Updated dependencies [431b8ec]
- Updated dependencies [9c42f73]
  - @integraledger/lcp-kernel@0.15.1
  - @integraledger/lcp-binding-core@0.15.1
  - @integraledger/lcp-authority@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [42fb196]
  - @integraledger/lcp-kernel@0.15.0
  - @integraledger/lcp-authority@0.15.0
  - @integraledger/lcp-binding-core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [aca5978]
  - @integraledger/lcp-kernel@0.14.0
  - @integraledger/lcp-authority@0.14.0
  - @integraledger/lcp-binding-core@0.14.0

## 0.13.0

### Patch Changes

- @integraledger/lcp-authority@0.13.0
- @integraledger/lcp-binding-core@0.13.0
- @integraledger/lcp-kernel@0.13.0

## 0.12.3

### Patch Changes

- 82444ad: `verifyEip3009Signature` does the token's whole acceptance test, and says what it does not do.

  ⛔⛔ **IT ANSWERED `true` FOR SIGNATURES `FiatTokenV2` REVERTS ON.** For any `(r, s, v)` the pair
  `(r, n − s, v ^ 1)` recovers the same address, so `recoverTypedDataAddress` alone accepts both encodings —
  **measured: the malleated form of an honest payer's own signature verified.** Circle's token routes EOA
  signatures through `ECRecover.sol`, which reverts before recovery on a high-s value and on any `v` outside
  `{27, 28}`. A payer could present the malleated form, be served the resource, and the transfer would revert
  — free goods, which is the exact failure the function exists to prevent. `isCanonicalSignature` is those two
  gates, exported so its boundary is reachable: `s === n/2` is ACCEPTED, because the token's guard is
  `s > n/2`, and no signing run will ever produce that value.

  ⛔ **The components are read out of the regex MATCH, not sliced at fixed offsets.** With `.slice(66, 130)`,
  dropping the leading anchor shifted every offset and the malformed input failed the `v` gate by accident —
  so the anchor's own mutant survived. The shape check and the component read are now one statement. (Fourth
  instance of an anchor mutant surviving in one day; the other three were killed by adding a `junk0x…` case.)

  ⛔⛔ **AND THE ERC-1271 CLAIM WAS FALSE.** The first version of this docblock said a contract wallet _"cannot
  sign an EIP-3009 authorization at all — the token has no `isValidSignature` call in that path"_. That is
  wrong for **`FiatTokenV2_2`**, the 2023 implementation deployed as USDC on Base, Arbitrum and Polygon among
  others, which routes `transferWithAuthorization` through `SignatureChecker.isValidSignatureNow` and
  therefore **does** dispatch to ERC-1271 for a contract account. Deciding that needs a chain read and this
  function takes no ports, so its contract is stated narrowly instead: **a `false` means "not signed by that
  EOA", never "the chain will reject it".** A caller that must accept smart-account payers has to make the
  ERC-1271 call itself; one that refuses on this answer alone is choosing to accept EOA payers only, and
  should say so at the call site.

  ⚠️ **The `try` came off.** It caught every failure and answered `false`, including a `typedData` this
  deployment could not encode — so an operator with a mis-copied `tokenName` would have been told that every
  honest payer is a forger, which is the live mistake the docblock itself names. The two untrusted inputs
  still answer `false`; a wiring error throws.

  Mutation: `binding-evm-common` 98.56, floor 98. The two remaining `eip3009.ts` survivors are pre-existing,
  in `eip155ChainId`.

- 48d1346: `verifyEip3009Signature` — the check the token makes, available before the money moves.

  `buildEip3009TypedData` has been here since the canonical EVM binding shipped, and nothing beside it could
  answer whether a given authorization was actually signed by the account it names. So a seller surface
  holding a payer's credential had three bad options: take the signature on trust until settlement, grow a
  viem dependency of its own, or reimplement recovery. `seller-mpp` needs exactly this for the 2026-08-24
  audit's C-28, and `seller-x402` already reaches here for `makeEvmAcceptanceVerifier` — the commons owns EVM
  crypto, and this is the piece that was missing.

  ⭐ **`ecrecover`, because that is what the TOKEN does.** `FiatTokenV2.transferWithAuthorization` recovers the
  signer from the EIP-712 digest and compares it to `from`; this recovers and compares the same way.

  ⛔ **It deliberately does NOT fall back to ERC-1271.** A contract wallet cannot sign an EIP-3009
  authorization at all — the token has no `isValidSignature` call on that path — so accepting one here would
  accept a payment the chain rejects, which is the failure this check exists to prevent rather than to cause.

  ⛔ **Answers `false` rather than throwing,** for the reason `atrHashEquals` states about itself: a predicate
  that throws is a worse contract than one that answers. A malformed signature, a signature of the wrong
  length and an `expectedSigner` that is not an address are all _"no, this is not signed by them"_ — and the
  caller is holding an untrusted credential and needs a value it can put on the wire. Addresses compare as
  decoded 20-byte values, so a payer's own lowercase spelling is the same payer.

  ⚠️ The domain stays the caller's to get right, and it is where this goes wrong in practice: `tokenName` and
  `tokenVersion` are the token's own EIP-712 domain and differ between USDC deployments, so a signature
  verified against a domain copied from another chain fails here exactly as it would on-chain.

  Mutation: `binding-evm-common` 98.40, floor 98 holds. ⛔ Both regex anchors needed their own case —
  `junk0x…` and `0x…ff` — because every other malformed input was refused by both mutants and the anchors
  could otherwise be deleted with the suite green.

  - @integraledger/lcp-authority@0.12.3
  - @integraledger/lcp-binding-core@0.12.3
  - @integraledger/lcp-kernel@0.12.3

## 0.12.2

### Patch Changes

- @integraledger/lcp-authority@0.12.2
- @integraledger/lcp-binding-core@0.12.2
- @integraledger/lcp-kernel@0.12.2

## 0.12.1

### Patch Changes

- @integraledger/lcp-authority@0.12.1
- @integraledger/lcp-binding-core@0.12.1
- @integraledger/lcp-kernel@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - @integraledger/lcp-kernel@0.12.0
  - @integraledger/lcp-authority@0.12.0
  - @integraledger/lcp-binding-core@0.12.0

## 0.10.2

### Patch Changes

- Updated dependencies [b2ffecc]
- Updated dependencies [822190a]
  - @integraledger/lcp-binding-core@0.11.0
  - @integraledger/lcp-authority@0.10.2
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
