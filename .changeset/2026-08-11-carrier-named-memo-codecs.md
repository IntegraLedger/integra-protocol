---
"@integraledger/lcp-binding-solana": minor
"@integraledger/lcp-binding-tempo-mpp": minor
---

**Breaking:** the memo codecs are named for the carrier they encode.

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
