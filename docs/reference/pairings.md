---
title: Pairings
description: Every pairing @integraledger/lcp implements, generated from its registry.
---

# Pairings

This page is generated from the package by `node scripts/docs-reference.mjs`, and CI checks that it matches.

`BINDINGS` holds 67 pairings on 7 surfaces (`ack`, `acp`, `ap2`, `card`, `mpp`, `ucp`, `x402`). Each row gives the pairing's id, the export that implements it, and its `pattern` record: the binding pattern, whether the buyer's signature covers the ATR hash, whether the hash itself is on chain, whether the settlement is a public proof, whether the hash can be recovered from the chain alone, and the LCP profile that defines the binding, where one does. [Binding](../concepts/binding.md) explains each field.

## `ack`

| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `ack/payment-request` | `paymentRequest` from `@integraledger/lcp/ack` | `native-field` | no | no | no | no |  |

## `acp`

| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `acp/checkout/delegated` | `delegated` from `@integraledger/lcp/acp` | `native-field` | no | no | no | no | [`acp/checkout/session-id`](../../lcp/profiles/acp-checkout-session-id.md) |
| `acp/checkout/undelegated` | `undelegated` from `@integraledger/lcp/acp` | `http-advisory` | no | no | no | no | [`acp/checkout/session-id`](../../lcp/profiles/acp-checkout-session-id.md) |

## `ap2`

| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `ap2/checkout-mandate` | `checkoutMandate` from `@integraledger/lcp/ap2` | `opaque-challenge` | yes | no | no | no | [`ap2/checkout-mandate`](../../lcp/profiles/ap2-checkout-mandate.md) |

## `card`

| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `card/mastercard-vi/autonomous` | `viAutonomous` from `@integraledger/lcp/card` | `id-reuse` | yes | no | no | no | [`card/mastercard-vi`](../../lcp/profiles/card-mastercard-vi.md) |
| `card/mastercard-vi/immediate` | `viImmediate` from `@integraledger/lcp/card` | `id-reuse` | yes | no | no | no | [`card/mastercard-vi`](../../lcp/profiles/card-mastercard-vi.md) |
| `card/seller-reference` | `sellerReference` from `@integraledger/lcp/card` | `http-advisory` | no | no | no | no |  |
| `card/visa-tap` | `visaTap` from `@integraledger/lcp/card` | `protocol-extension` | yes | no | no | no | [`card/visa-tap`](../../lcp/profiles/card-visa-tap.md) |

## `mpp`

| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `mpp/charge/card` | `chargeCard` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | no | no |  |
| `mpp/charge/evm/authorization` | `evmAuthorization` from `@integraledger/lcp/mpp` | `id-reuse` | yes | yes | yes | no |  |
| `mpp/charge/evm/hash` | `evmHash` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | no | no |  |
| `mpp/charge/evm/permit2` | `evmPermit2` from `@integraledger/lcp/mpp` | `id-reuse` | yes | yes | yes | no |  |
| `mpp/charge/evm/transaction` | `evmTransaction` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | no | no |  |
| `mpp/charge/hedera` | `chargeHedera` from `@integraledger/lcp/hedera`<br>`chargeHedera` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | yes | no |  |
| `mpp/charge/lightning` | `chargeLightning` from `@integraledger/lcp/lightning` | `native-field` | no | no | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| `mpp/charge/nearintents` | `chargeNearIntents` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | no | no |  |
| `mpp/charge/solana` | `chargeSolana` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | yes | [`mpp/charge/solana`](../../lcp/profiles/mpp-charge-solana.md) |
| `mpp/charge/stellar` | `chargeStellar` from `@integraledger/lcp/mpp` | `truncated-field` | no | yes | yes | no |  |
| `mpp/charge/stripe` | `chargeStripe` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | no | no |  |
| `mpp/charge/tempo/memo` | `tempoMemo` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | yes | no |  |
| `mpp/charge/tempo/push` | `tempoPush` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | yes | no |  |
| `mpp/charge/usdc/evm` | `chargeUsdcEvm` from `@integraledger/lcp/mpp` | `id-reuse` | yes | yes | yes | no |  |
| `mpp/charge/usdc/gateway` | `chargeUsdcGateway` from `@integraledger/lcp/mpp` | `id-reuse` | yes | no | yes | no |  |
| `mpp/charge/usdc/solana` | `chargeUsdcSolana` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | yes | [`mpp/charge/solana`](../../lcp/profiles/mpp-charge-solana.md) |
| `mpp/charge/usdc/stacks` | `chargeUsdcStacks` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | yes | [`mpp/charge/usdc/stacks`](../../lcp/profiles/mpp-charge-usdc-stacks.md) |
| `mpp/charge/xrpl` | `chargeXrpl` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | yes |  |
| `mpp/session/evm` | `sessionEvm` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | no | [`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) |
| `mpp/session/hedera` | `sessionHedera` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | yes | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| `mpp/session/lightning` | `sessionLightning` from `@integraledger/lcp/lightning` | `native-field` | no | no | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| `mpp/session/solana` | `sessionSolana` from `@integraledger/lcp/mpp` | `truncated-field` | no | yes | yes | no | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| `mpp/session/tempo` | `sessionTempo` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | no | [`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) |
| `mpp/session/xrpl` | `sessionXrpl` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | yes | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| `mpp/subscription/stripe` | `subscriptionStripe` from `@integraledger/lcp/mpp` | `opaque-challenge` | no | no | no | no |  |
| `mpp/subscription/tempo` | `subscriptionTempo` from `@integraledger/lcp/mpp` | `native-field` | yes | yes | yes | yes |  |

## `ucp`

| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `ucp/booking/ap2-mandate` | `bookingAp2Mandate` from `@integraledger/lcp/ucp` | `opaque-challenge` | yes | no | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| `ucp/booking/unsigned` | `bookingUnsigned` from `@integraledger/lcp/ucp` | `http-advisory` | no | no | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| `ucp/checkout/ap2-mandate` | `ap2Mandate` from `@integraledger/lcp/ucp` | `opaque-challenge` | yes | no | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| `ucp/checkout/unsigned` | `unsigned` from `@integraledger/lcp/ucp` | `http-advisory` | no | no | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |

## `x402`

| Pairing | Export | Pattern | Buyer signs H | H on chain | Public proof | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `x402/auth-capture/eip155/eip3009` | `authCaptureEip3009` from `@integraledger/lcp/x402` | `id-reuse` | yes | yes | yes | no | [`x402/auth-capture/eip155`](../../lcp/profiles/x402-auth-capture-eip155.md) |
| `x402/auth-capture/eip155/permit2` | `authCapturePermit2` from `@integraledger/lcp/x402` | `id-reuse` | yes | yes | yes | no | [`x402/auth-capture/eip155`](../../lcp/profiles/x402-auth-capture-eip155.md) |
| `x402/batch-settlement/cloudflare` | `batchCloudflare` from `@integraledger/lcp/x402-batch-settlement` | `protocol-extension` | yes | no | no | no |  |
| `x402/batch-settlement/eip155` | `batchEvm` from `@integraledger/lcp/x402-batch-settlement` | `native-field` | yes | yes | yes | yes | [`x402/batch-settlement/eip155`](../../lcp/profiles/x402-batch-settlement-eip155.md) |
| `x402/batch-settlement/solana` | `batchSvm` from `@integraledger/lcp/x402-batch-settlement` | `native-field` | yes | yes | yes | yes |  |
| `x402/exact/algorand` | `exactAvm` from `@integraledger/lcp/avm` | `native-field` | yes | yes | yes | yes | [`x402/exact/algorand/note`](../../lcp/profiles/x402-exact-algorand-note.md) |
| `x402/exact/aptos` | `exactAptos` from `@integraledger/lcp/aptos` | `http-advisory` | no | no | no | no |  |
| `x402/exact/cardano` | `exactCardano` from `@integraledger/lcp/cardano` | `native-field` | yes | yes | yes | yes | [`x402/exact/cardano`](../../lcp/profiles/x402-exact-cardano.md) |
| `x402/exact/casper` | `exactCasper` from `@integraledger/lcp/casper` | `native-field` | yes | yes | yes | yes | [`x402/exact/casper`](../../lcp/profiles/x402-exact-casper.md) |
| `x402/exact/ccd` | `exactCcd` from `@integraledger/lcp/ccd` | `native-field` | yes | yes | yes | yes | [`x402/exact/ccd`](../../lcp/profiles/x402-exact-ccd.md) |
| `x402/exact/eip155/eip3009` | `exactEip3009` from `@integraledger/lcp/x402` | `native-field` | yes | yes | yes | yes | [`x402/exact/eip155/eip3009`](../../lcp/profiles/x402-exact-eip155-eip3009.md) |
| `x402/exact/eip155/erc7710` | `exactErc7710` from `@integraledger/lcp/x402` | `http-advisory` | no | no | no | no |  |
| `x402/exact/eip155/erc7710-salt` | `exactErc7710Salt` from `@integraledger/lcp/x402` | `native-field` | yes | yes | yes | yes | [`x402/exact/eip155/erc7710-salt`](../../lcp/profiles/x402-exact-eip155-erc7710-salt.md) |
| `x402/exact/eip155/permit2` | `exactPermit2` from `@integraledger/lcp/x402` | `native-field` | yes | yes | yes | no | [`x402/exact/eip155/permit2`](../../lcp/profiles/x402-exact-eip155-permit2.md) |
| `x402/exact/hedera` | `exactHedera` from `@integraledger/lcp/hedera` | `native-field` | yes | yes | yes | yes | [`x402/exact/hedera`](../../lcp/profiles/x402-exact-hedera.md) |
| `x402/exact/hedera/transfer-executor` | `exactHederaExecutor` from `@integraledger/lcp/hedera` | `http-advisory` | no | no | no | no |  |
| `x402/exact/lnbtc` | `exactLnbtc` from `@integraledger/lcp/lightning` | `native-field` | no | no | no | no | [`x402/exact/lnbtc`](../../lcp/profiles/x402-exact-lnbtc.md) |
| `x402/exact/lnbtc/invoice-named` | `exactLnbtcNamed` from `@integraledger/lcp/lightning` | `http-advisory` | no | no | no | no |  |
| `x402/exact/near` | `exactNear` from `@integraledger/lcp/near` | `native-field` | yes | yes | yes | yes | [`x402/exact/near/memo`](../../lcp/profiles/x402-exact-near-memo.md) |
| `x402/exact/polkadot/lcp-assets-remark` | `exactPolkadotRemark` from `@integraledger/lcp/polkadot` | `native-field` | yes | yes | yes | yes | [`x402/exact/polkadot/lcp-assets-remark`](../../lcp/profiles/x402-exact-polkadot-lcp-assets-remark.md) |
| `x402/exact/solana` | `exactSvm` from `@integraledger/lcp/x402-exact-solana` | `native-field` | yes | yes | yes | yes |  |
| `x402/exact/starknet` | `exactStarknet` from `@integraledger/lcp/starknet` | `truncated-field` | yes | yes | yes | no | [`x402/exact/starknet`](../../lcp/profiles/x402-exact-starknet.md) |
| `x402/exact/stellar` | `exactStellar` from `@integraledger/lcp/x402-exact-stellar` | `truncated-field` | no | yes | yes | no |  |
| `x402/exact/sui` | `exactSui` from `@integraledger/lcp/sui` | `native-field` | yes | yes | yes | yes | [`x402/exact/sui`](../../lcp/profiles/x402-exact-sui.md) |
| `x402/exact/tron/lcp-trc20-memo` | `exactTronMemo` from `@integraledger/lcp/tron` | `native-field` | yes | yes | yes | yes | [`x402/exact/tron/lcp-trc20-memo`](../../lcp/profiles/x402-exact-tron-lcp-trc20-memo.md) |
| `x402/exact/tvm` | `exactTvm` from `@integraledger/lcp/tvm` | `native-field` | yes | yes | yes | yes |  |
| `x402/exact/xrpl` | `exactXrpl` from `@integraledger/lcp/x402-exact-xrpl` | `id-reuse` | yes | yes | yes | no |  |
| `x402/upto/eip155/permit2` | `uptoPermit2` from `@integraledger/lcp/x402` | `native-field` | yes | yes | yes | no | [`x402/upto/eip155/permit2`](../../lcp/profiles/x402-upto-eip155-permit2.md) |
| `x402/upto/solana` | `uptoSvm` from `@integraledger/lcp/x402-upto-solana` | `native-field` | yes | yes | yes | yes |  |

## What each binding proves

Each pairing's `pattern.proves` states what a payment through it shows, and what it does not. The text is the package's own, quoted as it is. Where it names `<network>` and `<transaction>`, the record fills them in.

### `ack/payment-request`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. This ATR's hash was issued to the seller as the id of its signed ACK Payment Request, with the link to deliver beside it before payment; a receipt for that request, issued after settlement, embeds the signed request. Neither the request nor the receipt was seen in making this record. ACK defines no payer signature, so nothing the buyer signed carries the hash. The seller checked nothing the buyer signed, and settlement is the seller's report. This does not show that the buyer's approval carried the hash.

### `acp/checkout/delegated`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's link in metadata. The payment handler required delegate_payment, so ACP has the buyer's agent obtain a vault token whose allowance names this session as checkout_session_id, in a request the agent signs (a MUST in one section of ACP and RECOMMENDED in another) and the PSP SHOULD verify. The seller neither saw nor verified that allowance or its signature, and ACP does not require the PSP to hold the token to that session. The seller tied the payment to the hash in its report. This does not show that amount, payee or timing match the ATR's content.

### `acp/checkout/undelegated`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's link in metadata. The payment handler did not require delegate_payment, so nothing the buyer signed for the payment names the hash. The seller tied the payment to the hash in its report.

### `ap2/checkout-mandate`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The buyer's closed AP2 Checkout Mandate carries checkout_hash, the SHA-256 of the checkout JWT the seller last sent, and that JWT's payload carries this ATR's hash as its legalContext member. The seller read both from inside the mandate. The mandate's signer is the user's trusted surface, or the agent under the user's open mandate. The seller did not verify that signature: AP2 has the Credential Provider verify the Payment Mandate, whose transaction_id is the same hash, before a payment credential issues. The seller reported the payment. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-vi/autonomous`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The buyer's agent signed a Verifiable Intent L3b checkout mandate whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, with the key the user's L2 mandate delegates to it. The seller verified both ES256 signatures and the sd_hash links, but not the L1 issuer's signature. The user's own signature does not cover the hash, and the seller did not see the L3a payment mandate the network received, whose transaction_id Verifiable Intent requires to equal this checkout_hash. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-vi/immediate`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The user's Verifiable Intent L2 mandate lists a checkout mandate whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, and the payment mandate's transaction_id, where disclosed, equals it. The seller checked those values and did not verify the user's signature, which Verifiable Intent has the payment network validate before authorization. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `card/seller-reference`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR was in the seller's storage before payment, and its hash and link were given to the seller to show the buyer and to place in its processor reference. Nothing the buyer signed carries the hash. The seller checked nothing the buyer signed, and settlement is the seller's report. This record does not show that the buyer's approval carried the hash.

### `card/visa-tap`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The buyer's agent sent this ATR's hash in the lcp-hash field and listed that field among the covered components of its TAP agent-payer-auth message signature. The seller checked that listing and did not verify the signature here, which belongs to its TAP recognition step. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `mpp/charge/card`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR was in the seller's storage before payment. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the buyer's credential echoed that challenge. The seller also placed the hash in the method's reference field (externalId for card; the PaymentIntent's metadata for Stripe). Nothing the buyer or its card or Stripe token signed carries the hash, and the seller checked nothing the buyer signed. Settlement is the seller's report. This record does not show that the buyer's approval carried the hash.

### `mpp/charge/evm/authorization`

The payer signed an EIP-3009 transfer authorization whose nonce is keccak256 of this challenge's id and realm, and the id is this ATR's hash in base64url with the challenge's position. The token contract verified the signature when it executed the transfer, and the nonce is on chain as the nonce topic of its AuthorizationUsed event. A holder of the ATR and the realm can confirm the hash from that nonce; the chain alone does not reveal it. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/evm/hash`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The payment is an ERC-20 transfer the buyer signed as a whole transaction (`transaction`), or broadcast itself and named by its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the seller's server bound the challenge, and the settlement transaction it reported succeeded and moved the token. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/evm/permit2`

The payer signed a Permit2 transfer, single or batch, whose witness carries keccak256 of this challenge's id and realm, and the id is this ATR's hash in base64url with the challenge's position. Permit2 verified the signature when it executed the transfer; a batch's transfers all executed in that one call. The witness is in the settlement transaction's calldata only as a hash, and no event carries it. This does not show that amount, payee, asset, splits or timing match the ATR's content.

### `mpp/charge/evm/transaction`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The payment is an ERC-20 transfer the buyer signed as a whole transaction (`transaction`), or broadcast itself and named by its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the seller's server bound the challenge, and the settlement transaction it reported succeeded and moved the token. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/hedera`

The ATR was assembled, written to the seller's storage and linked in the challenge before approval, and its hash is in the MPP challenge this payment answered, protected by the server's binding of the challenge, not by the payer's signature. The payer signed a memo whose 7-byte nonce is keccak256 of that challenge's id. It ties the payment to the challenge instance, and binds this ATR's hash only through those 7 bytes: whoever assembles the ATR can construct a second ATR whose challenge id gives the same 7 bytes. This does not show that amount, recipient, token or timing match the ATR's content.

### `mpp/charge/lightning`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The seller's node signed a BOLT11 invoice whose description hash is this ATR's hash, and whose payment hash the ATR commits. The payer paid that invoice, and its node checked the node signature before paying. The payer signed nothing that carries the hash, and the seller did not verify the invoice signature. The invoice and its preimage, which the parties hold, are the proof of the payment. No public ledger shows it. This does not show that amount, payee or timing match the ATR's content.

### `mpp/charge/nearintents`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The seller's MPP challenge carried this ATR's hash in its externalId, bound by the seller's own key to a deposit address issued for that challenge only, and the seller reported delivery. The buyer's deposit does not carry the hash, and the buyer did not sign it. The NEAR Intents backend, not a contract the buyer signed, links the deposit to the seller.

### `mpp/charge/solana`

The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.

### `mpp/charge/stellar`

The ATR was assembled, written to the seller's storage and linked in the challenge before approval, and its hash is in the payment challenge, which the payer did not sign. The payer signed a transfer to the seller's muxed address whose 8-byte id is the first 8 bytes of this ATR's hash, and the transaction succeeded. The id binds this hash only through its first 8 bytes: whoever assembles the ATR can construct a second ATR whose hash begins with the same 8 bytes. This does not show that amount, asset or timing match the ATR's content.

### `mpp/charge/stripe`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR was in the seller's storage before payment. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the buyer's credential echoed that challenge. The seller also placed the hash in the method's reference field (externalId for card; the PaymentIntent's metadata for Stripe). Nothing the buyer or its card or Stripe token signed carries the hash, and the seller checked nothing the buyer signed. Settlement is the seller's report. This record does not show that the buyer's approval carried the hash.

### `mpp/charge/tempo/memo`

The ATR's hash is in the MPP challenge this payment answered: its id is the hash in base64url with the challenge's position, protected by the server's binding of the challenge. The payer signed a Tempo transaction whose transferWithMemo call carries MPP's attribution memo, whose 7-byte nonce is keccak256 of that id. The chain verified the signature when it executed the call, and the memo is on chain as the memo topic of the token's TransferWithMemo event. It ties the payment to the challenge instance, and binds this ATR's hash only through those 7 bytes: whoever assembles the ATR can construct a second ATR whose challenge id gives the same 7 bytes. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/tempo/push`

The ATR's hash is in the MPP challenge this payment answered: its id is the hash in base64url with the challenge's position, protected by the server's binding of the challenge. The payer signed and broadcast a Tempo transaction whose transferWithMemo call carries MPP's attribution memo, whose 7-byte nonce is keccak256 of that id. The chain verified the signature when it executed the call, and the memo is on chain as the memo topic of the token's TransferWithMemo event, read after the money had moved. It ties the payment to the challenge instance, and binds this ATR's hash only through those 7 bytes: whoever assembles the ATR can construct a second ATR whose challenge id gives the same 7 bytes. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/evm`

The payer signed an EIP-3009 authorization whose nonce is keccak256 of the JCS of this challenge's id, realm and request hash, and the id is this ATR's hash in base64url with the challenge's position. The token contract verified the signature when it executed the transfer, and the nonce is on chain in its AuthorizationUsed event. A holder of the ATR, the realm and the request can confirm the hash; the chain alone does not reveal it. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/gateway`

The payer signed a Circle Gateway burn intent whose TransferSpec salt is keccak256 of the JCS of this challenge's id and parameters, and the id is this ATR's hash in base64url with the challenge's position. Circle Gateway validated the signature. The salt travels inside the TransferSpec that the destination mint carries, and the Gateway Minter emits that TransferSpec's keccak256 hash; this record reads no chain, and settlement is the seller's report. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/solana`

The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.

### `mpp/charge/usdc/stacks`

The payer signed a Stacks transaction whose SIP-010 transfer carries this ATR's hash as its memo argument. The chain verified the signature, the transaction executed with status success, and the memo is in the mined transaction on chain. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/xrpl`

The payer signed, with a single key, an XRPL Payment whose InvoiceID is this ATR's hash, and the Payment is in a validated ledger with tesSUCCESS. This does not show that amount, destination, asset or timing match the ATR's content.

### `mpp/session/evm`

The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with the challenge's position. The payer opened a payment channel whose salt is this ATR's hash, so the channel id, keccak256 over the payer, payee, token, salt, authorized signer, escrow and chain, commits to it. The payer signed that opening as an open call carrying the salt, an EIP-3009 authorization whose nonce is MPP's hash over the channel parameters and the salt, or a Permit2 transfer whose witness carries the salt, and the escrow and the token verified it on chain. The seller read that the opening transaction succeeded and moved the payer's deposit to the escrow. Where the payer sent the open call, the seller read that call: it is to the escrow, its salt is this ATR's hash, and its sender, payee, token and authorized signer give this channel id, so the payer is the account that signed it. Where the opening is an EIP-3009 authorization or a Permit2 transfer, the seller's server verified that the transaction created this channel. This does not show that amount, payee, asset or timing match the ATR's content. Later requests in this channel were paid under this ATR by vouchers the seller did not meter; each voucher signs a commitment to this ATR's hash.

### `mpp/session/hedera`

The payer signed a Hedera EVM transaction that opened an MPP session channel on the escrow contract named in the challenge, with this ATR's hash as the channel's salt, and it reached consensus. The escrow's ChannelOpened event carries the salt, and the channel id is keccak256 over an encoding that includes it. The hash is also in the MPP challenge the opening answered. Later requests in this channel were paid under this ATR by vouchers the seller did not meter. Each voucher signs that channel id, which commits to this ATR's hash. This does not show that amount, deposit, recipient, token or timing match the ATR's content.

### `mpp/session/lightning`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The seller's node signed a BOLT11 invoice whose description hash is this ATR's hash, and whose payment hash the ATR commits. The payer paid that invoice, and its node checked the node signature before paying. The payer signed nothing that carries the hash, and the seller did not verify the invoice signature. The invoice and its preimage, which the parties hold, are the proof of the payment. No public ledger shows it. This does not show that amount, payee or timing match the ATR's content. Later requests in this session were paid under this ATR from its deposit, by bearer proofs the seller did not meter. The close is the seller's report.

### `mpp/session/solana`

The ATR was assembled, written to the seller's storage and linked in the challenge before approval, and its hash is in the MPP challenge the opening answered, protected by the server's binding of the challenge. The payer signed a Solana transaction that opened a session channel on the channel program named in the challenge, with the first 8 bytes of this ATR's hash as the channel's salt, and it executed without error. The salt binds only this hash's first 8 bytes: whoever assembles the ATR can construct a second ATR whose hash shares them. Later requests in this channel were paid under this ATR by vouchers the seller did not meter. Where the operator signs the vouchers, each request also carried the payer's session proof, which signs the opening challenge's id and so this ATR's hash. This does not show that amount, deposit, recipient, mint or timing match the ATR's content.

### `mpp/session/tempo`

The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with the challenge's position. The payer signed a Tempo transaction whose one call to the channel escrow opens a channel with this ATR's hash as its salt, and the chain verified that signature when it executed the call. The escrow's ChannelOpened event names the channel, whose id commits to the salt; on the TIP-1034 escrow the event also carries the salt itself. This does not show that amount, payee, asset or timing match the ATR's content. Later requests in this channel were paid under this ATR by vouchers the seller did not meter; each voucher signs a commitment to this ATR's hash.

### `mpp/session/xrpl`

The payer signed, with a single key, an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's hash, and it is in a validated ledger with tesSUCCESS. The memo is in the public transaction. Later requests in this channel were paid under this ATR by vouchers the seller did not meter; each signs the channel id and an amount, not the hash. This does not show that amount, deposit, destination, settle delay or timing match the ATR's content.

### `mpp/subscription/stripe`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR was in the seller's storage before payment. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the buyer's credential echoed that challenge. The seller also placed the hash in the method's reference field (externalId for card; the PaymentIntent's metadata for Stripe). Nothing the buyer or its card or Stripe token signed carries the hash, and the seller checked nothing the buyer signed. Settlement is the seller's report. This record does not show that the buyer's approval carried the hash. Later billing periods were paid under this ATR by renewal invoices the seller did not read. The close is the seller's report.

### `mpp/subscription/tempo`

The ATR's hash is the MPP subscription challenge's id, in base64url. The payer's root key signed a Tempo key authorization whose witness is this ATR's hash, granting the seller's access key a per-period limit. The chain verified that signature when the activation transaction registered the key, and the account keychain's KeyAuthorizationWitness event carries the payer's account and this hash as topics. The same transaction transferred the first period's payment to the recipient. This does not show that amount, period, payee, asset or timing match the ATR's content. Later billing periods were paid under this ATR by renewal transfers the seller did not read.

### `ucp/booking/ap2-mandate`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The booking response carried this ATR's hash and link as its legal_context link before the business signed it (ap2.merchant_authorization, the seller's signature). The buyer's checkout mandate, issued by the platform or the user's credential under UCP's AP2 Mandates extension, carries checkout_hash, the SHA-256 of that signed booking, and the seller read the hash from the booking inside it. The seller did not verify the mandate's signature; the PSP verifies the payment mandate over the same booking hash. The seller reported the payment. This does not show that amount, payee or timing match the ATR's content.

### `ucp/booking/unsigned`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The booking response the platform received carried this ATR's hash and link as its legal_context link before the buyer completed the booking, and the ATR was in the seller's storage before that. UCP without the AP2 Mandates extension defines no buyer signature, so the buyer's approval, given in the platform's interface, did not sign the hash. The seller tied the payment to the hash in its report.

### `ucp/checkout/ap2-mandate`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The checkout response carried this ATR's hash and link as its legal_context link before the business signed it (ap2.merchant_authorization, the seller's signature). The buyer's checkout mandate, issued by the platform or the user's credential under UCP's AP2 Mandates extension, carries checkout_hash, the SHA-256 of that signed checkout, and the seller read the hash from the checkout inside it. The seller did not verify the mandate's signature; the PSP verifies the payment mandate over the same checkout hash. The seller reported the payment. This does not show that amount, payee or timing match the ATR's content.

### `ucp/checkout/unsigned`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The checkout response the platform received carried this ATR's hash and link as its legal_context link before the buyer completed the checkout, and the ATR was in the seller's storage before that. UCP without the AP2 Mandates extension defines no buyer signature, so the buyer's approval, given in the platform's interface, did not sign the hash. The seller tied the payment to the hash in its report.

### `x402/auth-capture/eip155/eip3009`

The payer signed a token authorization whose nonce commits, through the escrow's PaymentInfo, to a salt that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy when bound. The token contract or Permit2 verified the signature when the escrow collected the payment, and the escrow's event carries the salt. A holder of the ATR can confirm the hash from the salt; the chain alone does not reveal it. This record covers that first collection; capture, void, refund and reclaim are the operator's and the payer's.

### `x402/auth-capture/eip155/permit2`

The payer signed a token authorization whose nonce commits, through the escrow's PaymentInfo, to a salt that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy when bound. The token contract or Permit2 verified the signature when the escrow collected the payment, and the escrow's event carries the salt. A holder of the ATR can confirm the hash from the salt; the chain alone does not reveal it. This record covers that first collection; capture, void, refund and reclaim are the operator's and the payer's.

### `x402/batch-settlement/cloudflare`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The buyer's agent signed, with the HTTP message signature key it registered with Cloudflare, a request whose PAYMENT-SIGNATURE header echoes this ATR's hash in the x402 legalContext extension. Cloudflare verifies that signature and bills the agent's registered identity off chain. This does not show that amount, asset or timing match the ATR's content.

### `x402/batch-settlement/eip155`

The payer signed a token authorization for a deposit into an x402 batch-settlement channel whose identifier, the EIP-712 hash of the channel's configuration, commits to this ATR's hash as the configuration's salt. The token contract or Permit2 verified that signature when the channel contract collected the deposit, and the hash is on chain as the salt in the channel's ChannelCreated event. Later requests in this channel were paid under this ATR by vouchers the seller did not meter; each voucher signs a commitment to this ATR's hash. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/batch-settlement/solana`

The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and which opened an x402 batch-settlement payment channel; it executed without error. The memo is in the transaction's instruction data on chain. Later requests in this channel were paid under this ATR by vouchers the seller did not meter. This does not show that amount, recipient, mint or timing match the ATR's content.

### `x402/exact/algorand`

The payer signed an Algorand asset transfer whose note is this ATR's hash in LCP string form. The ledger verified that signature when it confirmed the transaction, which is final on confirmation, and the note is on chain in it. This does not show that amount, receiver, asset or timing match the ATR's content.

### `x402/exact/aptos`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR was assembled and written to the seller's storage before the challenge went out, and the challenge advertised its hash and link. The payer's signed Aptos transaction does not carry the hash. The seller tied the hash to this payment when it claimed it for this request, and identified the settlement as the payer's committed transaction by sender, sequence number and a digest of its transfer. This does not show that the buyer's approval carried the hash, or that amount, payee, asset or timing match the ATR's content.

### `x402/exact/cardano`

The payer signed a Cardano transaction whose body commits, through its auxiliary_data_hash, to a CIP-20 message (label 674) carrying this ATR's hash. The ledger included the transaction as valid, at the stated depth; the rail allows a rollback of fewer than k blocks. The hash is in the transaction's metadata on chain. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/casper`

The payer signed a CEP-3009 transfer authorization whose nonce is this ATR's hash. The token contract verified that signature, and that the signing key is the payer's, when it executed the transfer, and the hash is on chain as the nonce argument of that call. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/ccd`

The payer signed a Concordium transaction whose one transfer carries this ATR's hash, in LCP string form, as its memo. The chain accepted the transaction only with the sender's valid signature, and the memo is on chain in the finalized transfer event. This does not show that amount, payee, token or timing match the ATR's content.

### `x402/exact/eip155/eip3009`

The payer signed an EIP-3009 transfer authorization whose nonce is this ATR's hash. The token contract verified that signature when it executed the transfer, and the hash is on chain as the nonce topic of its AuthorizationUsed event in the settlement transaction. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/eip155/erc7710`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR was assembled, written to the seller's storage and linked in the challenge before approval, and the buyer's payment payload echoed this ATR's hash in the x402 legalContext extension. The buyer's delegation does not sign the hash, and the settlement transaction does not carry it.

### `x402/exact/eip155/erc7710-salt`

The leaf delegation of the permission context redeemed for this payment, made through MetaMask's DelegationManager, carries this ATR's hash as its signed salt. The manager verified every delegation's signature when it redeemed them, and the leaf, with its salt, is in a RedeemedDelegation event in the settlement transaction. The leaf's signer is its delegator, which may be an account the paying account authorised rather than the paying account itself. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/eip155/permit2`

The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/hedera`

The payer signed a Hedera transaction body whose memo carries this ATR's hash in LCP string form, and the transaction reached consensus with SUCCESS. The memo is in the public transaction record. This does not show that amount, recipient, token or timing match the ATR's content. The seller read the landed entry by its transaction id and memo; the fee payer, the seller's facilitator, could land another body under the same id.

### `x402/exact/hedera/transfer-executor`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The payment is an x402 transferExecutor payment on Hedera: the payer's executor contract moved the funds under an authorization the seller did not read, and the facilitator submitted the transaction. The hash reached the payer only in the challenge's extension, and nothing the payer signed carries it. The seller read the merged consensus record of the named transaction, and found the transfer whose payer, payee and amount match the digest recorded at claim. This does not show that amount, recipient, token or timing match the ATR's content.

### `x402/exact/lnbtc`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The seller's node signed a BOLT11 invoice whose payment metadata is this ATR's hash, and whose description hash is x402's request hash. The payer paid that invoice, and its node checked the node signature before paying. The payer signed nothing that carries the hash, and the seller did not verify the invoice signature. The invoice and its preimage, which the parties hold, are the proof of the payment. No public ledger shows it. This does not show that amount, payee or timing match the ATR's content.

### `x402/exact/lnbtc/invoice-named`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR names this payment: its binding slot holds the payment option as issued, including the seller node's signed BOLT11 invoice, whose payment hash the payer paid and whose description hash is x402's request hash. The invoice does not carry this ATR's hash, and the payer signed nothing that does. The buyer's gate paid only an invoice its ATR names, and the seller checked that the paid invoice is the one issued with this ATR. The invoice and its preimage, which the parties hold, are the proof of the payment. No public ledger shows it. This does not show that amount, payee or timing match the ATR's content.

### `x402/exact/near`

The payer signed a NEP-366 delegate action whose one ft_transfer carries this ATR's hash in its memo, in LCP string form. The runtime verified that signature and executed the transfer on the token contract, and the memo is on chain in the delegated call's arguments. This does not show that amount, receiver, token or timing match the ATR's content.

### `x402/exact/polkadot/lcp-assets-remark`

The payer signed one Polkadot Asset Hub extrinsic whose call is an atomic batch of a transfer of the asset and an on-chain remark whose bytes are this ATR's hash in LCP string form. The chain verified the signature, which covers the call, and executed the batch, which applies both calls or neither. Its Remarked event carries the BLAKE2b-256 of the remark, and its Transferred event names the asset, at the finality recorded. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/solana`

The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.

### `x402/exact/starknet`

The payer signed a SNIP-12 outside execution whose nonce is the low 250 bits of this ATR's hash. The payer's account contract verified that signature when it executed the transfer call, and the nonce is in the settlement transaction's calldata. A holder of the ATR can confirm the hash from the nonce; the chain alone does not reveal all of it, and no event indexes it. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/stellar`

The ATR was assembled, written to the seller's storage and linked in the challenge before approval, and its hash is in the payment challenge, which the payer did not sign. The payer signed a transfer to the seller's muxed address whose 8-byte id is the first 8 bytes of this ATR's hash, and the transaction succeeded. The id binds this hash only through its first 8 bytes: whoever assembles the ATR can construct a second ATR whose hash begins with the same 8 bytes. This does not show that amount, asset or timing match the ATR's content.

### `x402/exact/sui`

The payer signed a Sui transaction whose one unused Pure input is this ATR's hash. The network executed that transaction successfully, and the hash is on chain in its input list, readable by its digest while a node retains it. This does not show that amount, payee, coin type or timing match the ATR's content.

### `x402/exact/tron/lcp-trc20-memo`

The payer signed a Tron transaction whose memo is this ATR's hash in LCP string form, and whose one contract calls transfer on the token. The network verified the signature, which covers the memo through the transaction id. The call succeeded with the token's Transfer event, at the finality recorded. The memo is on chain in the transaction. This does not show that amount, payee, token or timing match the ATR's content.

### `x402/exact/tvm`

The payer's W5 wallet signed a request whose one Jetton transfer carries this ATR's hash in its forward payload, as a TEP-74 text comment in LCP string form. The payer's Jetton wallet executed that transfer, and the payee's Jetton wallet accepted it. The comment is on chain in the transfer's message bodies. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/xrpl`

The payer signed, with a single key, an XRPL Payment whose InvoiceID is the SHA-256 of this ATR's hash in LCP string form, and the Payment is in a validated ledger with tesSUCCESS. The hash can be confirmed from the ATR's bytes but not recovered from the ledger alone. This does not show that amount, destination, asset or timing match the ATR's content.

### `x402/upto/eip155/permit2`

The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show that amount, payee, asset or timing match the ATR's content. The amount settled is the facilitator's, at most the signed maximum.

### `x402/upto/solana`

The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and which opened a one-request payment channel escrowing the signed maximum; it executed without error. The memo is in the transaction's instruction data on chain. The amount charged from the escrow, which may be zero, is the seller's metering, settled by the facilitator in a later transaction that does not carry the hash, and the rest returns to the payer. This does not show that amount, recipient, mint or timing match the ATR's content.

