**LCP profile `x402/exact/casper`: the ATR hash as the CEP-3009 nonce.**

1. The `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`, H the SHA-256 of the ATR's exact bytes as `0x` lowercase hex and L an `https` URL serving them.
2. The client fetches L, hashes the bytes received, and compares with H as 32 bytes. On a mismatch it does not sign.
3. On a match it signs CEP-3009 `TransferWithAuthorization` with `nonce` = H (64 hex digits), `chain_name` = the option's `network`, and echoes `extensions` unchanged.
4. The server refuses a payment whose nonce is not an H it issued for this request and has not seen claimed.
5. H is the `nonce` argument of the settlement's `transfer_with_authorization` call on the option's `asset`. CEP-3009 recommends a random nonce; H is unique per ATR and unpredictable before issue.
