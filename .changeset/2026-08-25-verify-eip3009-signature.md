---
"@integraledger/lcp-binding-evm-common": patch
---

`verifyEip3009Signature` — the check the token makes, available before the money moves.

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
length and an `expectedSigner` that is not an address are all *"no, this is not signed by them"* — and the
caller is holding an untrusted credential and needs a value it can put on the wire. Addresses compare as
decoded 20-byte values, so a payer's own lowercase spelling is the same payer.

⚠️ The domain stays the caller's to get right, and it is where this goes wrong in practice: `tokenName` and
`tokenVersion` are the token's own EIP-712 domain and differ between USDC deployments, so a signature
verified against a domain copied from another chain fails here exactly as it would on-chain.

Mutation: `binding-evm-common` 98.40, floor 98 holds. ⛔ Both regex anchors needed their own case —
`junk0x…` and `0x…ff` — because every other malformed input was refused by both mutants and the anchors
could otherwise be deleted with the suite green.
