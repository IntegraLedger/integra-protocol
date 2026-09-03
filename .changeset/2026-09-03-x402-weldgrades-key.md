---
"@integraledger/lcp-binding-evm-x402": minor
---

`weldGrades` is keyed by x402's own asset-transfer-method token, not by the escrow sibling's collector name.

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
