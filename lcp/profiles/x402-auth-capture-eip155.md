**LCP profile `x402/auth-capture/eip155`: the ATR hash as the escrow payment's salt.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client uses H as its random 32 bytes: `salt` = H when `receiverAuthorizer` and `policy` are both zero; otherwise `saltNonce` = H and `salt` is the scheme's commitment over it.
4. The server refuses a payment whose salt or saltNonce is not an H it issued for that request, or whose signed nonce does not commit to it.
5. The salt is in the escrow's `PaymentAuthorized` or `PaymentCharged` data, and a holder of the ATR confirms H from it.
