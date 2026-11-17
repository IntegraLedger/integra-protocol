**LCP profile `x402/upto/eip155/permit2`: the ATR hash as the Permit2 nonce.**

This pairing serves x402's `upto` scheme on an EVM chain through Permit2 and x402's `upto` Permit2 proxy, as lcp's client writes it. H is the Permit2 nonce the payer signs, written in decimal, so the pairing is at coverage `full`. The amount settled is the seller's, submitted by the facilitator the witness names, and at most the signed maximum; an `upto` payment is no agreement, since it is no fixed amount.

**The payment**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client signs the scheme's `PermitWitnessTransferFrom` with `nonce` = H as a uint256, written in decimal, `spender` x402's `upto` Permit2 proxy (`0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002`), `deadline` the signing time plus the option's `maxTimeoutSeconds`, the permitted amount the option's amount as a maximum, and the witness `{to: payTo, facilitator: extra.facilitatorAddress, validAfter: 0}`, and echoes `extensions` unchanged.
4. The server refuses a payment whose nonce is not an H it issued for that request and has not seen claimed.
5. H is in the settlement transaction's calldata; Permit2 records its use as bit `H & 0xff` of `nonceBitmap(owner, H >> 8)`, one bitmap per owner for every token, and no event carries it.
6. x402 states no Permit2 nonce derivation. H is unpredictable before issue and unique per ATR, so Permit2's single use of (owner, nonce) holds. A client that draws a random nonce is refused by rule 4.

**The reference**

7. `reference` gives the network, the asset, the payer (the permit's owner), the signed `deadline`, H, the members of the payment presented (the permit's `token`, `amount`, `nonce` and `deadline`, its `spender`, the owner, and the witness's `to`, `facilitator` and `validAfter`), the option's payee, and the transaction a settler names, a hint. It refuses a payment whose `accepted` is not the option it is given, compared by RFC 8785 form (`x402/accepted-not-option`).

**The read**

The read is `x402/exact/eip155/permit2`'s (its rules 10 to 15), through the `upto` proxy, with these differences.

8. **Found by.** A hit counts only where its transaction's input carries the nonce in a call of the `upto` proxy (`0xff11e7b4`, or `0x016c1748` with an EIP-2612 permit first), whose words name the permit, the settled amount after it, the owner, and the witness's `to`, `facilitator` and `validAfter`; the receipt's `Transfer` of the permit's token from the owner to `to` must be of the settled amount, and the owner's bit set at the receipt's block and unset at the block before. One call is taken by owner and nonce: a copy of a call in the same input is that call, and two that differ leave the transaction unread as the act, the search holding on it. A call through the exact proxy is an act of another kind.
9. **What moved** is the settled amount, by its `Transfer`, named by the transaction and its log's place; no log shows the signed maximum.
10. **The payment presented.** The proxy takes the call only from the witness's `facilitator`. Where the proxy call is the transaction's own (its `to` the proxy, the call at the input's start), its decoded arguments are compared as they stand; a call wrapped in another reads `unshown`, since no log shows the permit's maximum or the witness's `facilitator`.

**What a record proves**

11. That the payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with x402's `upto` proxy as spender and the payee in the witness; that Permit2 verified the signature when the proxy executed the transfer; and that the hash is in the settlement transaction's calldata as the Permit2 nonce, no event carrying it. The amount settled is the seller's, submitted by the facilitator the witness names, and at most the signed maximum. This does not show that the amount, payee, asset or timing match the ATR's content.

**The read kit**

12. Declared inapplicable to the read kit, with the reasons of `x402/exact/eip155/permit2`'s rule 17, the same cases: `transaction-failed` and the cases opening *a failed result that consumed the value*; `not-found`; the three cases of *an act the read cannot place against the position given* and *an item the search could not decode that gives no position*; *a read with no means to read the single-use value*, *search-incomplete is answered before not-found* and *a read that did not read the value at the latest head*; *each transfer of what moved is named by its transaction and its place*; and the ten cases that rule names because the bit is H's own carrier. An `upto` payment is no agreement, so the cases on the act `agreement` are left out by its data.
