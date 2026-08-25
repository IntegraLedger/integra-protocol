---
"@integraledger/lcp-binding-evm-common": patch
---

`verifyEip3009Signature` does the token's whole acceptance test, and says what it does not do.

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

⛔⛔ **AND THE ERC-1271 CLAIM WAS FALSE.** The first version of this docblock said a contract wallet *"cannot
sign an EIP-3009 authorization at all — the token has no `isValidSignature` call in that path"*. That is
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
