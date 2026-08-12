---
"@integraledger/lcp-binding-hedera": minor
"@integraledger/lcp-binding-solana": minor
"@integraledger/lcp-binding-stellar": minor
"@integraledger/lcp-binding-sui": minor
---

**Breaking:** `USDC_DECIMALS` is renamed to `HEDERA_USDC_DECIMALS`, `SOLANA_USDC_DECIMALS`,
`STELLAR_USDC_DECIMALS` and `SUI_USDC_DECIMALS`.

All four packages exported the same name and they did not all mean the same number — Stellar assets carry
seven decimals where the other three carry six. Each value was correct for its own chain, so no package had
a defect and every package's own test passed; the hazard lived only in importing one rail's constant and
applying it on another, which is a ten-fold error in an amount and surfaces at settlement rather than at
compile time. The rail prefix makes that import impossible to make by accident.

`minor` rather than `major` because every package here is pre-1.0, where a minor is the breaking increment
under semver. Migration is a rename at the import site; the values are unchanged.
