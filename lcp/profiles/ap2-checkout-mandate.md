**LCP profile `ap2/checkout-mandate`: the ATR hash in the merchant's `checkout_jwt`.** This profile targets AP2 v0.2 (Checkout Mandates, `mandate.checkout.1`).

1. The payload of the merchant-signed `checkout_jwt` carries `"legalContext":{"type":"sha256","value":H,"legalContextUrl":L}` and a string `id` naming the checkout. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The shopping agent fetches L, hashes the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not present the checkout for approval.
3. The closed Checkout Mandate commits to that `checkout_jwt` through `checkout_hash`, as AP2 defines. Nothing is added to the mandate.
4. The merchant refuses a mandate whose `checkout_hash` is not the hash of the `checkout_jwt` it last sent for that checkout, taken from its own records and not from the presentation, or whose `checkout_jwt` carries an H it did not issue for that checkout, or has seen claimed. Compared with the `checkout_jwt` presented beside it, the mandate shows only that the two agree.
5. The ATR's `ap2` slot names the checkout's `id`, and never contains the `checkout_jwt`.
