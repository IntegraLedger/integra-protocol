**LCP profile `x402/exact/lnbtc`: the ATR hash as BOLT11 payment metadata.**

1. The `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`.
2. The option's invoice carries x402's request hash in `h` and exactly one `m` field whose 32 bytes are H, signed by the node whose key is `payTo`.
3. The client fetches L, compares SHA-256 of the bytes with H and with the invoice's `m`, and pays only on a match.
4. The server refuses a paid invoice whose `m` is not an H it issued for this request and has not seen claimed.
5. The invoice and preimage prove payment of an invoice carrying H; no public ledger records it.
6. **Without `m`:** when the invoice has no `m`, the ATR's `x402` slot holds the option with its invoice; the client pays only an invoice that slot names, and echoes `extensions` so the server can find the ATR.
7. Before either, the client pays the agreement transaction the server's agreement URL offers, and starts the Lightning payment only once it is recorded.
