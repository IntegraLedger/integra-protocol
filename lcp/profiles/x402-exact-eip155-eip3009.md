**LCP profile `x402/exact/eip155/eip3009`: the ATR hash as the EIP-3009 nonce.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client signs `TransferWithAuthorization` for an `exact` option with `nonce` = H, and echoes `extensions` unchanged.
4. The server refuses a payment whose `nonce` is not an H it issued for that request and has not seen claimed.
5. H is on chain as `topics[2]` of `AuthorizationUsed(authorizer, nonce)`, emitted by the option's `asset` in the settlement transaction. A search by that topic can also return other authorizers' uses of the same value.
6. x402 calls the nonce a *"32-byte random nonce to prevent replay attacks"*. H is unpredictable before issue and unique per ATR, because each ATR carries a random UUID, so the nonce keeps its replay role. A client that does not implement this profile draws a random nonce, and rule 4 refuses its payment.
