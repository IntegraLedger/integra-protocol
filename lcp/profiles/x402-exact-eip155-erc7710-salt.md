**LCP profile `x402/exact/eip155/erc7710-salt`: the ATR hash as the leaf delegation's salt.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client's delegation tooling creates the delegation it gives the facilitator for this payment, the leaf of `permissionContext`, with `salt` = H as a uint256, and echoes `extensions` unchanged.
4. The server refuses a payment whose leaf salt is not an H it issued for that request and has not seen claimed. A payment through any other delegation manager is served at the unsigned level, and its record says so.
5. H is on chain as data word 5 of the leaf's `RedeemedDelegation` event from the manager in the settlement transaction.
6. ERC-7710 defines no salt; the salt is the reference implementation's signed field, and H, unique per ATR, keeps each per-payment delegation's hash unique.
