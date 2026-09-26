**LCP profile `x402/exact/cardano`: the ATR hash as a CIP-20 message.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`.
2. The client fetches L, hashes the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client builds the `exact` payment with a TTL, attaches metadata label 674 = `{"msg": ["lcp:sha256:0x", <H's 64 lowercase hex digits>]}` with its `auxiliary_data_hash`, signs, does not broadcast, and echoes `extensions` unchanged.
4. The server refuses a payment whose signed body does not commit to exactly one such message carrying an H it issued for that request and has not seen claimed.
5. H is on chain in the transaction's metadata, readable by transaction id.
6. A client that does not implement this profile writes no such message, and rule 4 refuses its payment before it is verified or settled.
