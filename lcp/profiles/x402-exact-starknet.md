**LCP profile `x402/exact/starknet`: the ATR hash as the SNIP-9 nonce.**

1. The `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`, H the SHA-256 of the ATR's exact bytes as `0x` lowercase hex and L an `https` URL serving them.
2. The client fetches L, hashes the bytes received, and compares with H as 32 bytes. On a mismatch it does not sign.
3. On a match it signs the x402 `OutsideExecution` with `Nonce` = H AND (2^250 − 1), the low 250 bits of H, as a felt, and echoes `extensions` unchanged.
4. The server refuses a payment whose nonce is not that value for an H it issued for this request and has not seen claimed.
5. The nonce is in the calldata of the `execute_from_outside_v2` call; a holder of the ATR confirms H from it. SNIP-9 asks only that the nonce be unique, and H is unique per ATR.
