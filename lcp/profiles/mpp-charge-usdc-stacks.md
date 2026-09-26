**LCP profile `mpp/charge/usdc/stacks`: the ATR hash as the SIP-010 `transfer` memo of MPP's `usdc` Stacks charge.** Clauses 1–3 and 5 of `mpp/charge` apply to the challenge.

1. SIP-010's `transfer` takes `(memo (optional (buff 34)))`, and the `usdc` Stacks profile requires exactly the Clarity arguments `(uint amount, principal sender, principal recipient, (optional (buff 34)) memo)`. The memo is H's 32 raw bytes: the `lcp:` string is 77 bytes and does not fit.
2. The usdc specification does not fix the memo's value; this profile makes it `some` of H's 32 bytes, serialized `0x0a0200000020` ‖ H.
3. The transaction is a contract call to the profile's token contract named `transfer`, with post-condition mode Deny and anchor mode OnChainOnly, signed by the payer's Stacks wallet.
4. What a record of this pairing proves: the payer signed a Stacks transaction whose SIP-010 transfer carries this ATR's hash as its memo argument. The chain verified the signature, the transaction executed with status success, and the memo is in the mined transaction on chain. This does not show that amount, payee, asset or timing match the ATR's content.
