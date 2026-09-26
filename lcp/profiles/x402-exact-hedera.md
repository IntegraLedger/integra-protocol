**LCP profile `x402/exact/hedera`: the ATR hash as the transaction memo.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`, H being the SHA-256 of the ATR's exact bytes as `0x` lowercase hex, and L an `https` URL serving those bytes.
2. The client fetches L, hashes the bytes received, and compares with H as 32 decoded bytes; on a mismatch it does not sign.
3. On a match, the client sets the `TransferTransaction`'s memo to `lcp:sha256:` followed by H, signs, and echoes `extensions` unchanged.
4. The server refuses a payment whose memo is not `lcp:sha256:` and an H it issued for that request and has not seen claimed.
5. H is public in the transaction record's memo, readable by transaction id from any Mirror Node.
