**LCP profile `ucp/checkout/legal-context`: the ATR hash as a UCP link.**

1. The checkout response carries one `links[]` entry `{"type":"legal_context","url":L,"title":"lcp:sha256:"+H}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The entry is written before `ap2.merchant_authorization` is computed, so the business's signature covers it.
3. The platform fetches L, hashes the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not present the checkout for approval.
4. Under the AP2 Mandates extension the checkout mandate commits to the checkout, and so to H. Without it, the buyer's approval is not signed, and a record of the payment says so.
5. The checkout `id` is the business's own and is never H. Each checkout state that changes the terms carries the entry of its own ATR, whose `ucp` slot names the checkout `id`.
