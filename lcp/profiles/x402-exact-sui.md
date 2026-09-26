**LCP profile `x402/exact/sui`: the ATR hash as the one unused Pure input.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`, as in the profile `x402/exact/eip155/eip3009`.
2. The client fetches L, computes SHA-256 over the bytes received, and compares it with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client builds the `exact` payment, adds H's 32 bytes as one `Pure` input that no command uses, bounds the expiration by epoch, signs, and echoes `extensions` unchanged.
4. The server refuses a payment whose transaction does not carry exactly one unused `Pure` input equal to an H it issued for that request and has not seen claimed.
5. H is on chain in the executed transaction's input list; whoever holds the digest can read it back while a node retains the transaction.
6. A client that does not implement this profile adds no unused input, and rule 4 refuses its payment before it is verified or settled.
