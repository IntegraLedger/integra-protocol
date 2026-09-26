**LCP profile `x402/exact/algorand/note`: the ATR hash as the Algorand payment's note.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client builds the `exact` payment as x402's Algorand scheme defines it. It sets the `note` of `paymentGroup[paymentIndex]` to exactly the 77 ASCII bytes `lcp:sha256:` followed by H (LCP §8.1), and echoes `extensions` unchanged.
4. The server refuses a payment whose payment-transaction note does not decode to an H that it issued for that request and has not seen claimed.
5. H is on chain in the confirmed transaction's note. An Indexer search with `note-prefix` equal to the base64 of that string returns it, and also returns any other transaction that wrote the same note.
6. x402's Algorand scheme leaves the note to the client, and the steward's client writes its own (`x402-payment-v2-<milliseconds>`). A client that does not implement this profile is refused by rule 4.
