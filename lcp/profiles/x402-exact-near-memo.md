**LCP profile `x402/exact/near/memo`: the ATR hash as the NEP-141 transfer memo.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client signs the delegate action x402's NEAR scheme defines, with `ft_transfer` args `{"receiver_id":…,"amount":…,"memo":"lcp:sha256:"+H}` (LCP §8.1), and echoes `extensions` unchanged.
4. The server refuses a payment whose `memo` does not decode to an H that it issued for that request and has not seen claimed.
5. H is on chain in the delegated `ft_transfer` arguments, and in the token's `ft_transfer` event where the token follows NEP-141's events. It is read by transaction, together with the relayer that the facilitator publishes under `signers["near:*"]`.
6. x402's NEAR scheme leaves `memo` to the client. A client that does not implement this profile writes none, and rule 4 refuses its payment.
