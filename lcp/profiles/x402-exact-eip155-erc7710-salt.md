**LCP profile `x402/exact/eip155/erc7710-salt`: the ATR hash as the leaf delegation's salt.**

This pairing serves x402's `exact` scheme with `assetTransferMethod` `erc7710`, through MetaMask's reference DelegationManager (`0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`, v1.3.0) on a chain where it is deployed, with H as the signed salt of the leaf delegation, so it is at coverage `full`. Every other `erc7710` payment is `x402/exact/eip155/erc7710`, which signs no H. A redemption is reusable: it consumes no single-use value and is never an agreement.

**The payment**

1. The resource server's `PaymentRequired` carries `extensions.legalContext.info` = `{"type":"sha256","value":H,"legalContextUrl":L}`. H is the SHA-256 of the ATR's exact bytes, as `0x` lowercase hex, and L is an `https` URL that serves those bytes.
2. The client fetches L, computes SHA-256 over the bytes received, and compares the result with H as 32 decoded bytes. On a mismatch it does not sign.
3. On a match, the client's delegation tooling creates the delegation it gives the facilitator for this payment, the leaf of `permissionContext`, with `salt` = H as a uint256, and echoes `extensions` unchanged.
4. The server refuses a payment whose leaf salt is not an H it issued for that request and has not seen claimed. A payment through any other delegation manager is served at the unsigned level, and its record says so.
5. H is on chain as data word 5 of the leaf's `RedeemedDelegation` event from the manager in the settlement transaction.
6. ERC-7710 defines no salt; the salt is the reference implementation's signed field, and H, unique per ATR, keeps each per-payment delegation's hash unique.
7. **Which level a payment is.** `pairingOfPayment` names this level only where the payment's `delegationManager` is the reference manager, the option's chain is one of its deployments, and the leaf delegation of the permission context carries as its salt the H the payment's echoed `extensions.legalContext.info` names. A stock client's delegation through the reference manager, whose leaf salt is drawn at random, and one whose context or extension does not decode, is the unsigned level (`x402-exact-eip155-erc7710-salt.json`, `EV8.stockSalt`). This level's `bound` refuses a payment through another manager or on another chain (`x402/manager-not-reference`), a context that does not decode (`x402/permission-context-malformed`) and an empty one (`x402/delegation-empty`).

**The reference**

8. `reference` gives the network, the token, H, the payer (the root delegator, the last delegation's delegator, whose account the manager executes the transfer from), the leaf delegation presented, as its EIP-712 hash (rule 13), the option's payee and the transaction a settler names, a hint. It refuses a payment whose `accepted` is not the option it is given, compared by RFC 8785 form (`x402/accepted-not-option`).

**The read**

`status` reads through a JSON-RPC endpoint the caller supplies: receipts, blocks by mark, and `eth_getLogs`.

9. **No single-use value.** A delegation signs no bound and holds no single-use value, so the read answers no `instrument-live` and no `instrument-unused`, and is never `failed` for lapse: the search runs for as long as the caller asks, and is never read whole.
10. **Found by.** The manager's `RedeemedDelegation(rootDelegator, redeemer, delegation)` logs with the payer as root delegator (topic 1), from the block after the position given to the latest head, in pages as `x402/exact/eip155/eip3009` reads them. Each redemption whose delegation carries H as its salt is an act carrying H: of this kind where it is the leaf, its delegate the redeemer or the reference implementation's wildcard `0x0000000000000000000000000000000000000a11`, and of another kind where it is a delegation above the leaf. A `RedeemedDelegation` of that root delegator the read cannot decode holds the search. A reverted transaction holds no act.
11. **Who signed.** Every delegator of that root's redemptions in the transaction is tested as a signer of H: an act where the root delegator or any of them is the option's payee is the payee's, and settles nothing; one whose root delegator is not the payer is another account's.
12. **The account an act names, and what moved.** The token's `Transfer` from the root delegator to the option's payee names the payee's account; what moved is each `Transfer` from the root delegator in the transaction, named by the transaction and its log's place among the receipt's logs.
13. **The payment presented** is the leaf delegation whole, compared by its EIP-712 hash as the DelegationManager's `getDelegationHash` computes it (delegation-framework v1.3.0, `EncoderLib`; the types `Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)` and `Caveat(address enforcer,bytes terms)`, `src/utils/Constants.sol`): its delegate, delegator, authority, salt and each caveat's enforcer and terms, a caveat's `args` being the redeemer's and its signature apart. A delegation's `authority` is its parent's hash, so the leaf's hash covers the chain above it. The read decodes the delegation each leaf's `RedeemedDelegation` carries whole, its data `abi.encode(Delegation)` under the bounds a permission context is decoded under, and `presented` is `yes` where its hash is the presented leaf's, `no` where it is another (a leaf with other caveats among them), and `unshown` where the read cannot decode it whole. Every redemption of one chain of delegations is that payment.
14. **Marks.** `latest`, `safe` and `finalized`; final `finalized`. The answers follow `read-status.md`.

**What a record proves**

15. That the leaf delegation of the permission context redeemed for this payment, made through MetaMask's DelegationManager, carries this ATR's hash as its signed salt; that the manager verified every delegation's signature when it redeemed them; and that the leaf, with its salt, is in a `RedeemedDelegation` event in the settlement transaction. The leaf's signer is its delegator, which may be an account the paying account authorised rather than the paying account itself. This does not show that the amount, payee, asset or timing match the ATR's content.

**The read kit**

16. Declared inapplicable to the read kit, each with its reason:
    - `transaction-failed`, and the cases opening *a failed result that consumed the value*: a reverted transaction consumes nothing, and a redemption holds no single-use value.
    - `not-found`: the read searches for as long as the caller asks, and never reads its search whole.
    - `instrument-unused` and `instrument-consumed`: a delegation signs no bound and holds no single-use value.
    - *An act the read cannot place against the position given* (its three cases) and *an item the search could not decode that gives no position*: every log and receipt the read meets names its block.
    - Every other case whose facts give a single-use value, since the level holds none, but these ten, which the read meets all the same: *a read that did not read the value at the latest head*, *a search narrowed to one asset, payee or token*, *a value read consumed whose transaction the search has not found*, *a value unconsumed at the final mark and consumed at the latest head*, *a value whose validity passed, unconsumed at the final mark and consumed*, *an item the caller gave that the read cannot decode, beside one*, *an item the search could not decode holds a failed answer*, *at coverage full, instrument-consumed waits for the search for H*, *below-mark is answered before instrument-live* and *the validity passed with the value unconsumed and the search for H not read whole*.
