**LCP profile `x402/batch-settlement/eip155`: the ATR hash as the channel configuration's salt.**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client opens a new channel whose `ChannelConfig.salt` = H, deposits into it, and echoes `extensions` unchanged.
4. The server refuses an opening whose salt is not an H it issued for that request and has not seen claimed, or whose `channelConfig` does not hash to `voucher.channelId`.
5. H is on chain as the salt in `ChannelCreated(channelId, config)` from `x402BatchSettlement`; the deposit authorization and every voucher sign `channelId`, which commits to H.
6. x402 says the salt *"Differentiates channels with identical parameters"*; H is unique per ATR, so it keeps that role. One ATR covers the whole channel; a new agreement opens a new channel. A client that draws its own salt is refused by rule 4.
