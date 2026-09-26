**LCP profile `mpp/session/evm-tempo`: the ATR hash in an MPP session or subscription opening.**

1. The challenge carries H as `mpp/charge` rules 1, 3 and 5 say. The id is rule 2's, except that a Tempo `subscription` challenge's id is exactly the base64url (no padding) of H.
2. Session (`evm`, `tempo`): the client opens a new channel whose `salt` is H's 32 bytes. EVM `authorization`: the EIP-3009 nonce is keccak256(abi.encode(from, recipient, currency, H, authorizedSigner)), as MPP requires. EVM `permit2`: the witness `salt` is H. EVM `hash` and Tempo: the signed `open` call's salt is H, and a Tempo v2 descriptor carries it.
3. A session challenge naming `channelId` resumes a channel. The client pays it with a voucher only for a channel it opened for an ATR it compared.
4. Subscription (`tempo`): the key authorization's `witness` is the id's 32 bytes, which is H.
5. One ATR covers the whole session or subscription. Vouchers, top-ups and renewals carry no new ATR.
