**LCP profile `mpp/session/hedera-solana-xrpl`: the ATR hash at a session's opening.** Clauses 1–3 and 5 of `mpp/charge` apply to the opening challenge. One ATR covers the whole channel.

1. `hedera`: the escrow `open`'s `salt` is H's 32 bytes; `authorizedSigner` may be zero.
2. `solana`: the `open` instruction's `salt` is H's first 8 bytes read as a little-endian u64, so its encoded bytes are H's first 8 bytes. In operator mode, `authentication.sessionChallengeId` is the opening challenge's `id`.
3. `xrpl`: the `PaymentChannelCreate`, which the payer signs with a single key (a blob that carries `Signers` is refused `xrpl/multisigned`), carries exactly one memo whose `MemoData` is the UTF-8 of `lcp:sha256:` followed by H.
4. The server refuses an opening that lacks its carrier, before it broadcasts where the method lets it.
