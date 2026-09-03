---
"@integraledger/lcp-binding-evm-escrow": patch
---

`saltFromAtrHash` welded whatever `BigInt` would parse. It was a bare `BigInt(atrHash)`, and the call site
said a malformed value would be "surfaced by BigInt() (fail-fast)" — but `BigInt` accepts any parseable
numeral, so it surfaced almost nothing. Counted across the EVM rails, this was the only one with no
atrHash validation anywhere in it: `binding-evm-x402` 2 call sites, `binding-evm-mpp` 6,
`binding-tempo-mpp` 3, escrow 0.

The harm is a silent round trip rather than a crash. Measured: `0x` + `ab`×31 welded as a salt and came
back out of `atrHashFromSalt` as `0x00abab…` — a DIFFERENT hash, so a verifier reports a mismatch against
a settlement that welded exactly what it was handed. `"12345"` welded as `0x…3039`. A 33-byte value came
back as 68 characters, which is not a bytes32 at all. `"0b1010"`, `"0o777"`, `""` and a whitespace-padded
hash all welded too.

`saltFromAtrHash` now goes through `canonicalAtrHash`, which throws — its stated contract for an emit
path, and what the original comment intended. Uppercase hex DIGITS are still accepted and lowercased: the
ATR canon is case-insensitive on the digits, and a counterparty spelling its own hash that way is
conformant. `atrHashFromSalt` asserts the salt fits a uint256 for the mirror reason — `padStart` pads and
never truncates, so an out-of-range salt returned a string longer than a bytes32 that then compared
unequal to every real atrHash instead of being refused.
