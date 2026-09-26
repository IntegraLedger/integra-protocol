**LCP profile `x402/upto/eip155/permit2`: the ATR hash as the Permit2 nonce.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client signs the scheme's `PermitWitnessTransferFrom` with `nonce` = H as a uint256 and echoes `extensions` unchanged.
4. The server refuses a payment whose nonce is not an H it issued for that request and has not seen claimed.
5. H is in the settlement transaction's calldata; Permit2 records its use as one bit of `nonceBitmap(owner, H >> 8)`, and no event carries it.
6. x402 states no Permit2 nonce derivation. H is unpredictable before issue and unique per ATR, so Permit2's single use of (owner, nonce) holds. A client that draws a random nonce is refused by rule 4.
