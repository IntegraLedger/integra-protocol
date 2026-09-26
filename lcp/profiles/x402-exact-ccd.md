**LCP profile `x402/exact/ccd`: the ATR hash as the transfer memo.**

1. The `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`, H the SHA-256 of the ATR's exact bytes as `0x` lowercase hex and L an `https` URL serving them.
2. The client fetches L, hashes the bytes received, and compares with H as 32 bytes. On a mismatch it does not sign.
3. On a match its one transfer carries a memo: for CCD, `SimpleTransferWithMemo` whose memo is the CBOR text string `lcp:sha256:` + H; for a PLT, a `transfer` operation whose `memo` is CBOR tag 24 around those bytes.
4. The server refuses a payment whose memo does not carry an H it issued for this request and has not seen claimed.
5. The memo is in the finalized `AccountTransfer` or `TokenTransfer` event of the settlement transaction.
