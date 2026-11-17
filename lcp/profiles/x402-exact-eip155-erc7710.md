**LCP profile `x402/exact/eip155/erc7710`: an ERC-7710 payment that signs no H, taken after its agreement.**

This pairing serves x402's `exact` scheme with `assetTransferMethod` `erc7710` for every delegation that is not `x402/exact/eip155/erc7710-salt`: one through another delegation manager, one through the reference manager on a chain outside its deployments, and one through the reference manager whose leaf salt is not H, as a stock client draws it. Nothing the delegator signed holds H, so the pairing is at coverage `none` (`link` `none`): the payment is taken only after an agreement carrying H is recorded, by any agreement option the resource server declares (`agreementOn` `any`), and the read finds the payment only by the transaction a settler names.

**The payment**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`, as in the profile `x402/exact/eip155/eip3009`, and the `erc7710` option, the same option the salt level serves.
2. The client gives the facilitator a delegation chain whose execution moves the option's amount of the option's asset from the delegator to `payTo`, encoded as x402's ERC-7710 payload (`delegationManager`, `permissionContext`, `delegator`), and echoes `extensions` unchanged. `bound` returns the echoed H (`x402/no-legal-context` where it does not decode), which only locates the sale and is no proof. `pairingOfPayment` names this level as `x402/exact/eip155/erc7710-salt`'s rule 7 states.
3. The settler simulates the redemption and calls `redeemDelegations` on the delegation manager the payload names; x402 leaves the `permissionContext` opaque, and no published facilitator settles it.
4. The resource server takes the payment only after the agreement for this H is recorded, and an agreement whose signer is the option's payee is no agreement.

**The reference**

5. `reference` gives the network, the token, H as the echoed extension gives it, the payer (the payload's `delegator`), the leaf delegation presented, as its EIP-712 hash where the permission context decodes as the reference DelegationManager's (rule 8), the option's payee and the transaction a settler names. It refuses a payment whose `accepted` is not the option it is given, compared by RFC 8785 form (`x402/accepted-not-option`).

**The read**

`status` reads through a JSON-RPC endpoint the caller supplies: a receipt, a transaction, and blocks by mark.

6. **No search.** Nothing the delegator signed names the sale, so the read is the lookup of the transaction the reference names, read whole where one is named. The read holds no single-use value: it answers no `instrument-live`, and no `failed` but `before-position`. A read of the chain alone, with no named transaction, never settles the payment.
7. **The act.** The named transaction is the payment where it succeeded and holds a `Transfer` from the payment's `delegator` to the option's `payTo`, whatever its amount; what moved is each `Transfer` from the delegator in it, named by the transaction and its log's place among the receipt's logs. The read is given the position the agreement's settlement recorded, and a transaction at or before it is `failed`, `before-position`. A `Transfer` from the delegator whose value the read cannot decode holds the read.
8. **Answers.** A named transaction that reverted is `pending`, `search-incomplete`, the delegation left usable; one that holds no transfer to the payee's account, or that the caller gives as another act under the same H (the agreement's own transaction among them), is `pending`, `not-found`, the lookup read whole having found no act of this payment. An other act the caller gives by a reference that names its transaction is that transaction's act. On `settled`, `presented` compares the leaf delegation whole, by its EIP-712 hash as `x402/exact/eip155/erc7710-salt` computes it (that profile, rule 13), with the one leaf the reference DelegationManager redeemed in the named transaction under the payment's `delegator` as root delegator, decoded whole from its `RedeemedDelegation`: `yes` where the hashes are equal, `no` where they differ, and `unshown` where the transaction holds no such redemption (another manager's), several, or one the read cannot decode, or where the reference holds no leaf. Nothing the delegator signed carries H, so the signer the answer names is the payment's `delegator`, whose `Transfer` is the act, and the party tests read that account.
9. **Marks.** `latest`, `safe` and `finalized`; final `finalized`.

**What a record proves**

10. That an account signed an agreement transaction carrying this ATR's hash before this payment was taken, which shows neither that the account is the payer nor what the agreement moved; that the ATR was assembled and delivered before the payment, and that the payment echoed its hash in the legal-context extension; and that the named settlement transaction holds a transfer from the delegator to the payee. The delegation does not sign the hash, and the settlement transaction does not carry it.

**The read kit**

11. Declared inapplicable to the read kit, each with its reason:
    - `transaction-failed`, and the cases opening *a failed result that consumed the value*: a reverted transaction consumes nothing, and the level holds no single-use value.
    - `instrument-unused` and `instrument-consumed`: the level signs no bound and holds no single-use value.
    - *An act the read cannot place against the position given* (its three cases) and *an item the search could not decode that gives no position*: every receipt the read meets names its block.
    - Every case whose facts give a single-use value: the level holds none.
