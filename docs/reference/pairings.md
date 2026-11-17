---
title: Pairing registry
description: Every pairing @integraledger/lcp implements, generated from its registry.
---

# Pairing registry

This page is generated from the package by `node scripts/docs-reference.mjs`, and CI checks that it matches.

`BINDINGS` holds 63 pairings on 7 surfaces (`ack`, `acp`, `ap2`, `card`, `mpp`, `ucp`, `x402`). Each row gives the pairing's id, the export that implements it, its data's `coverage` (`full` where the payer's own signed act on a public ledger binds H, `none` where no public payer-signed act carries it) and `confirmed`, and these members of its `pattern` record: the binding pattern, where it names one, whether the binding is visible on a public ledger, whether the hash can be recovered from the chain alone, and the LCP profile that defines the binding, where one does. [Binding](../concepts/binding.md) explains each member, `forwardIndexable` included.

## `ack`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `ack/payment-request` | `paymentRequest` from `@integraledger/lcp/ack` | `none` | no | `native-field` | no | no | [`ack/payment-request`](../../lcp/profiles/ack-payment-request.md) |

## `acp`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `acp/checkout/delegated` | `delegated` from `@integraledger/lcp/acp` | `none` | no | `native-field` | no | no | [`acp/checkout/session-id`](../../lcp/profiles/acp-checkout-session-id.md) |
| `acp/checkout/undelegated` | `undelegated` from `@integraledger/lcp/acp` | `none` | no | `http-advisory` | no | no | [`acp/checkout/session-id`](../../lcp/profiles/acp-checkout-session-id.md) |

## `ap2`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `ap2/checkout-mandate` | `checkoutMandate` from `@integraledger/lcp/ap2` | `none` | no | `opaque-challenge` | no | no | [`ap2/checkout-mandate`](../../lcp/profiles/ap2-checkout-mandate.md) |
| `ap2/checkout-mandate/x402` | `checkoutMandateX402` from `@integraledger/lcp/ap2` | `none` | no | `opaque-challenge` | no | no | [`ap2/checkout-mandate/x402`](../../lcp/profiles/ap2-checkout-mandate-x402.md) |

## `card`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `card/mastercard-agent-pay` | `agentPay` from `@integraledger/lcp/card` | `none` | no | `protocol-extension` | no | no | [`card/mastercard-agent-pay`](../../lcp/profiles/card-mastercard-agent-pay.md) |
| `card/mastercard-vi/autonomous` | `viAutonomous` from `@integraledger/lcp/card` | `none` | no | `id-reuse` | no | no | [`card/mastercard-vi`](../../lcp/profiles/card-mastercard-vi.md) |
| `card/mastercard-vi/immediate` | `viImmediate` from `@integraledger/lcp/card` | `none` | no | `id-reuse` | no | no | [`card/mastercard-vi`](../../lcp/profiles/card-mastercard-vi.md) |
| `card/seller-reference` | `sellerReference` from `@integraledger/lcp/card` | `none` | no | `http-advisory` | no | no | [`card/seller-reference`](../../lcp/profiles/card-seller-reference.md) |
| `card/visa-tap` | `visaTap` from `@integraledger/lcp/card` | `none` | no | `protocol-extension` | no | no | [`card/visa-tap`](../../lcp/profiles/card-visa-tap.md) |
| `card/visa-vic` | `visaVic` from `@integraledger/lcp/card` | `none` | no | `protocol-extension` | no | no | [`card/visa-vic`](../../lcp/profiles/card-visa-vic.md) |

## `mpp`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `mpp/charge/card` | `chargeCard` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no |  |
| `mpp/charge/evm/authorization` | `evmAuthorization` from `@integraledger/lcp/mpp` | `full` | no | `id-reuse` | yes | no |  |
| `mpp/charge/evm/hash` | `evmHash` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no |  |
| `mpp/charge/evm/permit2` | `evmPermit2` from `@integraledger/lcp/mpp` | `full` | no | `id-reuse` | yes | no |  |
| `mpp/charge/evm/transaction` | `evmTransaction` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no |  |
| `mpp/charge/lightning` | `chargeLightning` from `@integraledger/lcp/lightning` | `none` | no | `native-field` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| `mpp/charge/nearintents` | `chargeNearIntents` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/charge/nearintents`](../../lcp/profiles/mpp-charge-nearintents.md) |
| `mpp/charge/solana` | `chargeSolana` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/charge/solana`](../../lcp/profiles/mpp-charge-solana.md) |
| `mpp/charge/stripe` | `chargeStripe` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no |  |
| `mpp/charge/usdc/evm` | `chargeUsdcEvm` from `@integraledger/lcp/mpp` | `full` | no | `id-reuse` | yes | no |  |
| `mpp/charge/usdc/gateway` | `chargeUsdcGateway` from `@integraledger/lcp/mpp` | `none` | no | `id-reuse` | yes | no |  |
| `mpp/charge/usdc/solana` | `chargeUsdcSolana` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/charge/solana`](../../lcp/profiles/mpp-charge-solana.md) |
| `mpp/charge/usdc/stacks` | `chargeUsdcStacks` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/charge/usdc/stacks`](../../lcp/profiles/mpp-charge-usdc-stacks.md) |
| `mpp/charge/xrpl` | `chargeXrpl` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes |  |
| `mpp/session/evm` | `sessionEvm` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) |
| `mpp/session/lightning` | `sessionLightning` from `@integraledger/lcp/lightning` | `none` | no | `native-field` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| `mpp/session/tempo` | `sessionTempo` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) |
| `mpp/session/xrpl` | `sessionXrpl` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| `mpp/subscription/stripe` | `subscriptionStripe` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/subscription/stripe`](../../lcp/profiles/mpp-subscription-stripe.md) |
| `mpp/subscription/tempo` | `subscriptionTempo` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes |  |

## `ucp`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `ucp/booking/ap2-mandate` | `bookingAp2Mandate` from `@integraledger/lcp/ucp` | `none` | no | `opaque-challenge` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| `ucp/booking/unsigned` | `bookingUnsigned` from `@integraledger/lcp/ucp` | `none` | no | `http-advisory` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| `ucp/checkout/agent-signed` | `agentSigned` from `@integraledger/lcp/ucp` | `none` | no | `protocol-extension` | no | no | [`ucp/checkout/agent-signed`](../../lcp/profiles/ucp-checkout-agent-signed.md) |
| `ucp/checkout/ap2-mandate` | `ap2Mandate` from `@integraledger/lcp/ucp` | `none` | no | `opaque-challenge` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| `ucp/checkout/unsigned` | `unsigned` from `@integraledger/lcp/ucp` | `none` | no | `http-advisory` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |

## `x402`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| `x402/auth-capture/eip155/eip3009` | `authCaptureEip3009` from `@integraledger/lcp/x402` | `full` | no | `id-reuse` | yes | no | [`x402/auth-capture/eip155`](../../lcp/profiles/x402-auth-capture-eip155.md) |
| `x402/auth-capture/eip155/permit2` | `authCapturePermit2` from `@integraledger/lcp/x402` | `full` | no | `id-reuse` | yes | no | [`x402/auth-capture/eip155`](../../lcp/profiles/x402-auth-capture-eip155.md) |
| `x402/batch-settlement/cloudflare` | `batchCloudflare` from `@integraledger/lcp/x402-batch-settlement` | `none` | no | `protocol-extension` | no | no |  |
| `x402/batch-settlement/eip155` | `batchEvm` from `@integraledger/lcp/x402-batch-settlement` | `full` | no | `native-field` | yes | yes | [`x402/batch-settlement/eip155`](../../lcp/profiles/x402-batch-settlement-eip155.md) |
| `x402/batch-settlement/solana` | `batchSvm` from `@integraledger/lcp/x402-batch-settlement` | `full` | no | `native-field` | yes | yes |  |
| `x402/exact/algorand` | `exactAvm` from `@integraledger/lcp/avm` | `full` | no | `native-field` | yes | yes | [`x402/exact/algorand/note`](../../lcp/profiles/x402-exact-algorand-note.md) |
| `x402/exact/aptos` | `exactAptos` from `@integraledger/lcp/aptos` | `none` | no | `http-advisory` | no | no |  |
| `x402/exact/cardano` | `exactCardano` from `@integraledger/lcp/cardano` | `full` | no | `native-field` | yes | yes | [`x402/exact/cardano`](../../lcp/profiles/x402-exact-cardano.md) |
| `x402/exact/cardano/lock` | `exactCardanoLock` from `@integraledger/lcp/cardano` | `full` | no | `native-field` | yes | yes | [`x402/exact/cardano`](../../lcp/profiles/x402-exact-cardano.md) |
| `x402/exact/casper` | `exactCasper` from `@integraledger/lcp/casper` | `full` | yes | `native-field` | yes | yes | [`x402/exact/casper`](../../lcp/profiles/x402-exact-casper.md) |
| `x402/exact/ccd` | `exactCcd` from `@integraledger/lcp/ccd` | `full` | no | `native-field` | yes | yes | [`x402/exact/ccd`](../../lcp/profiles/x402-exact-ccd.md) |
| `x402/exact/eip155/eip3009` | `exactEip3009` from `@integraledger/lcp/x402` | `full` | no | `native-field` | yes | yes | [`x402/exact/eip155/eip3009`](../../lcp/profiles/x402-exact-eip155-eip3009.md) |
| `x402/exact/eip155/erc7710` | `exactErc7710` from `@integraledger/lcp/x402` | `none` | no | `http-advisory` | no | no |  |
| `x402/exact/eip155/erc7710-salt` | `exactErc7710Salt` from `@integraledger/lcp/x402` | `full` | no | `native-field` | yes | yes | [`x402/exact/eip155/erc7710-salt`](../../lcp/profiles/x402-exact-eip155-erc7710-salt.md) |
| `x402/exact/eip155/permit2` | `exactPermit2` from `@integraledger/lcp/x402` | `full` | no | `native-field` | yes | yes | [`x402/exact/eip155/permit2`](../../lcp/profiles/x402-exact-eip155-permit2.md) |
| `x402/exact/hedera` | `exactHedera` from `@integraledger/lcp/hedera` | `full` | no | `native-field` | yes | yes | [`x402/exact/hedera`](../../lcp/profiles/x402-exact-hedera.md) |
| `x402/exact/hedera/transfer-executor` | `exactHederaExecutor` from `@integraledger/lcp/hedera` | `none` | no | `http-advisory` | no | no |  |
| `x402/exact/near` | `exactNear` from `@integraledger/lcp/near` | `full` | no | `native-field` | yes | yes | [`x402/exact/near/memo`](../../lcp/profiles/x402-exact-near-memo.md) |
| `x402/exact/polkadot/lcp-assets-remark` | `exactPolkadotRemark` from `@integraledger/lcp/polkadot` | `full` | no | `native-field` | yes | yes | [`x402/exact/polkadot/lcp-assets-remark`](../../lcp/profiles/x402-exact-polkadot-lcp-assets-remark.md) |
| `x402/exact/solana` | `exactSvm` from `@integraledger/lcp/x402-exact-solana` | `full` | no | `native-field` | yes | yes |  |
| `x402/exact/starknet` | `exactStarknet` from `@integraledger/lcp/starknet` | `full` | yes |  | yes | no | [`x402/exact/starknet`](../../lcp/profiles/x402-exact-starknet.md) |
| `x402/exact/sui` | `exactSui` from `@integraledger/lcp/sui` | `full` | no | `native-field` | yes | yes | [`x402/exact/sui`](../../lcp/profiles/x402-exact-sui.md) |
| `x402/exact/tron/lcp-trc20-memo` | `exactTronMemo` from `@integraledger/lcp/tron` | `full` | no | `native-field` | yes | yes | [`x402/exact/tron/lcp-trc20-memo`](../../lcp/profiles/x402-exact-tron-lcp-trc20-memo.md) |
| `x402/exact/tvm` | `exactTvm` from `@integraledger/lcp/tvm` | `full` | no | `native-field` | yes | yes |  |
| `x402/exact/xrpl` | `exactXrpl` from `@integraledger/lcp/x402-exact-xrpl` | `full` | no | `id-reuse` | yes | no |  |
| `x402/upto/eip155/permit2` | `uptoPermit2` from `@integraledger/lcp/x402` | `full` | no | `native-field` | yes | yes | [`x402/upto/eip155/permit2`](../../lcp/profiles/x402-upto-eip155-permit2.md) |
| `x402/upto/solana` | `uptoSvm` from `@integraledger/lcp/x402-upto-solana` | `full` | no | `native-field` | yes | yes |  |

## What each binding proves

Each pairing's `data.proves` states what a payment through it shows, and what it does not. The text is the package's own, quoted as it is. Where it names `<network>` and `<transaction>`, the record fills them in.

### `ack/payment-request`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. This ATR's hash is the id of the seller's ACK Payment Request token, with the link beside it; a receipt for that request embeds the token. The token's signature is not verified here. ACK defines no payer signature, so nothing the payer signed carries the hash, and the payment, which the payer's side sends before it presents the receipt, is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `acp/checkout/delegated`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's link in metadata. The payment handler required delegate_payment, so ACP has the agent obtain a vault token whose allowance names this session as checkout_session_id, in a request the agent signs (a MUST in one section of ACP and RECOMMENDED in another) and the PSP SHOULD verify. No signature was verified here, nothing compares the agent's signer with the account that signed the agreement, and ACP does not require the PSP to hold the token to that session. The payment is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `acp/checkout/undelegated`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's link in metadata. The payment handler did not require delegate_payment, so nothing the payer signed for the payment names the hash. The payment is known from the seller's report alone, which names it by the seller's own reference for the charge.

### `ap2/checkout-mandate`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The closed AP2 Checkout Mandate presented carries checkout_hash, the SHA-256 of the checkout JWT presented beside it, and that JWT's payload carries this ATR's hash as its legalContext member. AP2 has the mandate signed by the user's trusted surface, or by the agent under the user's open mandate presented before it in a chain. That signature, the open mandate's signature, its delegation to the agent's key (cnf) and the chain's link were not verified here, and nothing compares the mandate's signer with the account that signed the agreement: AP2 has the Credential Provider verify the Payment Mandate, whose transaction_id is the same hash, before a payment credential issues. The payment, whether the merchant initiated it or the payer's side sent it, is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `ap2/checkout-mandate/x402`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken. This does not show that the account is this payment's payer. The payment paid <amount> of the token <asset> to <recipient> in <payment transaction> on <payment network>: an EIP-3009 transfer authorization whose nonce is keccak-256 of the payment mandate chain it was presented with, as AP2's payment processor requires, and whose chain's closed Payment Mandate names, as its transaction_id, the checkout_hash of the closed AP2 Checkout Mandate presented. That checkout_hash is the SHA-256 of the checkout JWT presented beside it, and that JWT's payload carries this ATR's hash as its legalContext member; the payment itself carries no hash of this ATR. No mandate signature was verified here: AP2 has the Credential Provider verify the mandates. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-agent-pay`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. Every Mastercard Agent Pay message signature in the agent's checkout request, tagged Agent-pay-auth or agent-pay-auth, covers this ATR's hash: its nonce, whose first 32 bytes are the hash, or the request's path, whose last segment is the hash. The seller checked where the hash rides and did not verify a signature here, and nothing compares the agent's key with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-vi/autonomous`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. An agent signed a Verifiable Intent L3b checkout mandate whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, with the key the presented L2 mandate delegates to it. The seller verified both ES256 signatures and the sd_hash links, but not the L1 issuer's signature, and nothing compares the L2 or L3b signer with the account that signed the agreement. The L2 signature does not cover the hash, and the seller did not see the L3a payment mandate the network received, whose transaction_id Verifiable Intent requires to equal this checkout_hash. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-vi/immediate`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The Verifiable Intent L2 mandate presented lists a checkout mandate whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, and the payment mandate's transaction_id, where disclosed, equals it. The seller checked those values and did not verify the L2 mandate's signature, which Verifiable Intent has the payment network validate before authorization, and nothing compares the L2 mandate's signer with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `card/seller-reference`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. This ATR's hash and link are for the seller to show the buyer before payment and to put in its processor's metadata under legal_context, beside the seller's own reference for the charge. Nothing the payer signed for this payment carries the hash, and the payment is known from the seller's report alone, which names it by that reference. This does not show that the payer's approval carried the hash.

### `card/visa-tap`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. Every TAP agent-payer-auth message signature in the agent's checkout request covers this ATR's hash: its nonce, whose first 32 bytes are the hash, or the request's path, whose last segment is the hash. The seller checked where the hash rides and did not verify a signature here, which belongs to its TAP recognition step, and nothing compares the agent's key with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `card/visa-vic`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The agent's Visa Intelligent Commerce credential request carried this ATR's hash as its transactionReferenceId, which the seller read from the credential payload Visa signs for the sale. Verifying that payload is the seller's and was not done here, and nothing compares the agent or the cardholder with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `mpp/charge/card`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the credential presented echoed that challenge. The seller also placed the hash in the request's externalId. Nothing the payer or its card signed carries the hash, and the payment is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `mpp/charge/evm/authorization`

The payer signed an EIP-3009 transfer authorization whose nonce is keccak256 of this challenge's id and realm, and the id is this ATR's hash in base64url with the challenge's position. The token contract verified the signature when it executed the transfer, and the nonce is on chain as the nonce topic of its AuthorizationUsed event. A holder of the ATR and the realm can confirm the hash from that nonce; the chain alone does not reveal it. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/evm/hash`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The payment is an ERC-20 transfer the buyer signed as a whole transaction (`transaction`), or broadcast itself and named by its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the seller's server bound the challenge, and the settlement transaction it reported succeeded and moved the token. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/evm/permit2`

The payer signed a Permit2 transfer, single or batch, whose witness carries keccak256 of this challenge's id and realm, and the id is this ATR's hash in base64url with the challenge's position. Permit2 verified the signature when it executed the transfer; a batch's transfers all executed in that one call. The witness is in the settlement transaction's calldata only as a hash, and no event carries it. This does not show that amount, payee, asset, splits or timing match the ATR's content.

### `mpp/charge/evm/transaction`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The payment is an ERC-20 transfer the buyer signed as a whole transaction (`transaction`), or broadcast itself and named by its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the seller's server bound the challenge, and the settlement transaction it reported succeeded and moved the token. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/lightning`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The seller's node's BOLT11 invoice's description hash is this ATR's hash, and the ATR commits its payment hash. Its signature is not verified here, and the payer signed nothing that carries the hash. Settlement is the seller's report; the invoice and its preimage, which the parties hold, show that the invoice was paid; they do not show who paid it, and no public ledger shows the payment. This does not show that amount, payee or timing match the ATR's content.

### `mpp/charge/nearintents`

Before this payment was reported, an agreement transaction carrying this ATR's hash was signed on <network>, recorded in <transaction>; this shows neither that its signer is the payer nor when the deposit was made. The seller's MPP challenge carried the hash in its externalId. The deposit carries no hash, and its payer signed nothing that does. The seller reported it paid.

### `mpp/charge/solana`

The payer signed a Solana transaction whose one LCP-form Memo instruction carries this ATR's hash in LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.

### `mpp/charge/stripe`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the credential presented echoed that challenge. The seller also placed the hash in the PaymentIntent's metadata under legal_context. Nothing the payer or its Stripe token signed carries the hash, and the payment is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `mpp/charge/usdc/evm`

The payer signed an EIP-3009 authorization whose nonce is keccak256 of the JCS of this challenge's id, realm and request hash, and the id is this ATR's hash in base64url with the challenge's position. The token contract verified the signature when it executed the transfer, and the nonce is on chain in its AuthorizationUsed event. A holder of the ATR, the realm and the request can confirm the hash; the chain alone does not reveal it. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/gateway`

The payer signed a Circle Gateway burn intent whose TransferSpec salt is keccak256 of the JCS of this challenge's id and parameters, and the id is this ATR's hash in base64url with the challenge's position. The signature is not verified here. The salt travels inside the TransferSpec that the destination mint carries, and the Gateway Minter emits that TransferSpec's keccak256 hash; this record reads no chain, and settlement is the seller's report. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/solana`

The payer signed a Solana transaction whose one LCP-form Memo instruction carries this ATR's hash in LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.

### `mpp/charge/usdc/stacks`

The payer signed a Stacks transaction whose origin is the payer and which carries this ATR's hash as the `(some H)` memo of a SIP-010 `transfer`, or as a token transfer's memo. The chain verified the origin's signature, the transaction executed with status success on the canonical chain, and the memo is in the mined transaction on chain. Where it made a transfer, one of zero included, it paid that transfer's recipient, named in the record; the origin, never a sponsor, is the signer. This does not show that the contract is a SIP-010 token, or that amount, asset or timing match the ATR's content.

### `mpp/charge/xrpl`

The payer signed, with a single key, an XRPL Payment whose InvoiceID is this ATR's hash, and the Payment is in a validated ledger with tesSUCCESS. This does not show that amount, destination, asset or timing match the ATR's content.

### `mpp/session/evm`

The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with the challenge's position. The payer opened a payment channel whose salt is this ATR's hash, so the channel id, keccak256 over the payer, payee, token, salt, authorized signer, escrow and chain, commits to it. The payer signed that opening as an open call carrying the salt, an EIP-3009 authorization whose nonce is MPP's hash over the channel parameters and the salt, or a Permit2 transfer whose witness carries the salt, and the escrow and the token verified it on chain. The seller read that the opening transaction succeeded and moved the payer's deposit to the escrow. Where the payer sent the open call, or a relayer sent the escrow's Permit2 opening, the seller read that call: it is to the escrow, its salt is this ATR's hash, and its payer, payee, token and authorized signer give this channel id, so the payer is the account that signed the call or, on Permit2, the transfer. This does not show that amount, payee, asset or timing match the ATR's content. Each voucher in this channel signs a commitment to this ATR's hash.

### `mpp/session/lightning`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The seller's node's BOLT11 invoice's description hash is this ATR's hash, and the ATR commits its payment hash. Its signature is not verified here, and the payer signed nothing that carries the hash. Settlement is the seller's report; the invoice and its preimage, which the parties hold, show that the invoice was paid; they do not show who paid it, and no public ledger shows the payment. This does not show that amount, payee or timing match the ATR's content. The close is the seller's report.

### `mpp/session/tempo`

The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with the challenge's position. The payer signed a Tempo transaction whose one call to the channel escrow opens a channel with this ATR's hash as its salt, and the chain verified that signature when it executed the call. The escrow's ChannelOpened event names the channel, whose id commits to the salt; on the TIP-1034 escrow the event also carries the salt itself. This does not show that amount, payee, asset or timing match the ATR's content. Each voucher in this channel signs a commitment to this ATR's hash.

### `mpp/session/xrpl`

The payer signed, with a single key, an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's hash, and it is in a validated ledger with tesSUCCESS. The memo is in the public transaction. Vouchers in this channel sign the channel id and an amount, not the hash. This does not show that amount, deposit, destination, settle delay or timing match the ATR's content.

### `mpp/subscription/stripe`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the credential presented echoed that challenge. The seller also placed the hash in the metadata under legal_context of the payment that activates the subscription. Nothing the payer or its Stripe token signed carries the hash, and the activation is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `mpp/subscription/tempo`

The ATR's hash is the MPP subscription challenge's id, in base64url. The payer's root key signed a Tempo key authorization whose witness is this ATR's hash, granting the seller's access key a per-period limit. The chain verified that signature when the activation transaction registered the key, and the account keychain's KeyAuthorizationWitness event carries the payer's account and this hash as topics. The same transaction transferred the token the payer's key authorization limits to the recipient it allows. This does not show that amount, period, payee, asset or timing match the ATR's content.

### `ucp/booking/ap2-mandate`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The booking carried this ATR's hash and link as its legal_context link. The checkout mandate presented under UCP's AP2 Mandates extension carries checkout_hash, the SHA-256 of the booking JWT presented beside it, and the hash was read from that JWT's booking. The mandate's signature, and, where an open mandate precedes it in a chain, that mandate's signature, its delegation (cnf) and the chain's link, were not verified here, and nothing compares the mandate's signer with the account that signed the agreement; the PSP verifies the payment mandate over the same booking hash. The payment is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `ucp/booking/unsigned`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The booking response carried this ATR's hash and link as its legal_context link. UCP without the AP2 Mandates extension defines no buyer signature, so the payer's approval did not sign the hash. The payment is known from the seller's report alone.

### `ucp/checkout/agent-signed`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout response carried this ATR's hash and link as its legal_context link, and the platform's request that completed the checkout carried the hash in its legal_context member, with a Content-Digest that is the SHA-256 of that request's body. The platform's RFC 9421 signature over the request, which UCP has the business verify with the key in the platform's profile, was not verified here, and nothing ties that key to the account that signed the agreement. The seller reported the payment. This does not show that amount, payee or timing match the ATR's content.

### `ucp/checkout/ap2-mandate`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout carried this ATR's hash and link as its legal_context link. The checkout mandate presented under UCP's AP2 Mandates extension carries checkout_hash, the SHA-256 of the checkout JWT presented beside it, and the hash was read from that JWT's checkout. The mandate's signature, and, where an open mandate precedes it in a chain, that mandate's signature, its delegation (cnf) and the chain's link, were not verified here, and nothing compares the mandate's signer with the account that signed the agreement; the PSP verifies the payment mandate over the same checkout hash. The payment is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `ucp/checkout/unsigned`

An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout response carried this ATR's hash and link as its legal_context link. UCP without the AP2 Mandates extension defines no buyer signature, so the payer's approval did not sign the hash. The payment is known from the seller's report alone, which names it by the seller's own reference for the charge.

### `x402/auth-capture/eip155/eip3009`

The payer signed a token authorization whose nonce commits, through the escrow's PaymentInfo, to a salt that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy when bound. The token contract verified the signature when the escrow collected the payment, and the escrow's event carries the salt. When unbound, the salt is this ATR's hash, so the settled transaction itself shows it. When bound, a holder of the ATR, the receiver authorizer and the policy can confirm the hash from the salt; the chain alone does not reveal it. This record covers that first collection; capture, void, refund and reclaim are the operator's and the payer's.

### `x402/auth-capture/eip155/permit2`

The payment presented a Permit2 authorization whose nonce commits, through the escrow's PaymentInfo, to a salt that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy when bound. The escrow's event in the settlement transaction carries that PaymentInfo, salt included; it does not show which collector funded the payment. When unbound, the salt is this ATR's hash, so the settled transaction itself shows it. When bound, a holder of the ATR, the receiver authorizer and the policy can confirm the hash from the salt; the chain alone does not reveal it. This record covers that first collection; capture, void, refund and reclaim are the operator's and the payer's.

### `x402/batch-settlement/cloudflare`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The buyer's agent signed, with the HTTP message signature key it registered with Cloudflare, a request whose PAYMENT-SIGNATURE header echoes this ATR's hash in the legalContext entry of x402's extensions. Cloudflare verifies that signature and bills the agent's registered identity off chain. This does not show that amount, asset or timing match the ATR's content.

### `x402/batch-settlement/eip155`

The payer signed a token authorization for a deposit into an x402 batch-settlement channel whose identifier, the EIP-712 hash of the channel's configuration, commits to this ATR's hash as the configuration's salt. The token contract or Permit2 verified that signature when the channel contract collected the deposit, and the hash is on chain as the salt in the channel's ChannelCreated event. Each voucher in this channel signs a commitment to this ATR's hash. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/batch-settlement/solana`

The payer signed a Solana transaction whose seller Memo instruction (`extra.memo`) carries this ATR's hash in LCP string form, and which opened an x402 batch-settlement payment channel; it executed without error. The memo is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.

### `x402/exact/algorand`

The payer's account authorized an Algorand asset transfer whose note is this ATR's hash in LCP string form, with a signature, a multisignature or a logic signature. The ledger verified that authorization when it confirmed the transaction, which is final on confirmation, and the note is on chain in it. This does not show that amount, receiver, asset or timing match the ATR's content.

### `x402/exact/aptos`

Before this payment was taken, an account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>; this shows neither that the account is the payer nor what the agreement moved. The ATR was assembled before the challenge went out, and the challenge advertised its hash and link. The payer's signed Aptos transaction does not carry the hash. The resource server tied the hash to this payment when it recorded the hash for this request, and the read identified the payment as the sender's committed transaction at its signed sequence number, signed by an account other than the option's payee and depositing to a store the payee owns. What it moved is recorded as observed: this does not show that amount, asset or timing match the ATR's content.

### `x402/exact/cardano`

The payer, the payment credential that holds the input the payment names, signed a Cardano transaction whose body commits through its auxiliary_data_hash to a CIP-20 message (label 674) carrying this ATR's hash, and the ledger included it as valid at the mark read. It paid: the read names each output it created, to which payment credential and in what asset and amount, as observed, and on a payment one output reached the payee's payment credential. A transaction with fewer confirmations than the ledger's security parameter (2160 on mainnet) can be rolled back. The read compares no amount, asset or time with the ATR's terms.

### `x402/exact/cardano/lock`

The payer, the payment credential that holds the input the payment names, signed a Cardano transaction whose body commits through its auxiliary_data_hash to a CIP-20 message (label 674) carrying this ATR's hash, and the ledger included it as valid at the mark read. It deposited into a contract: the read names each output it created, as observed, and on a Masumi lock the beneficiary its escrow datum names. A deposit is a charge and never an agreement. The read compares no amount, asset or time with the ATR's terms.

### `x402/exact/casper`

The payer signed a CEP-3009 transfer authorization whose nonce is this ATR's hash. The token contract verified that signature, and that the signing key is the payer's, when it executed the transfer, and the hash is on chain as the nonce argument of that call. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/ccd`

The payer signed a Concordium transaction one of whose transfers carries this ATR's hash, in LCP string form, as its memo. The chain accepted the transaction only with the sender's valid signature, and the memo is on chain in the finalized transfer event. This does not show that amount, payee, token or timing match the ATR's content.

### `x402/exact/eip155/eip3009`

The payer signed an EIP-3009 transfer authorization whose nonce is this ATR's hash. The token contract verified that signature when it executed the transfer, and the hash is on chain as the nonce topic of its AuthorizationUsed event in the settlement transaction. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/eip155/erc7710`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The ATR was assembled and delivered before the payment, and the buyer's payment payload echoed this ATR's hash in the legalContext entry of x402's extensions. The buyer's delegation does not sign the hash, and the settlement transaction does not carry it.

### `x402/exact/eip155/erc7710-salt`

The leaf delegation of the permission context redeemed for this payment, made through MetaMask's DelegationManager, carries this ATR's hash as its signed salt. The manager verified every delegation's signature when it redeemed them, and the leaf, with its salt, is in a RedeemedDelegation event in the settlement transaction. The leaf's signer is its delegator, which may be an account the paying account authorised rather than the paying account itself. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/eip155/permit2`

The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/hedera`

The payer signed a Hedera transaction body whose memo carries this ATR's hash in LCP string form. A transaction under that body's id with that memo reached consensus with SUCCESS, and the memo is in the public transaction record; the fee payer, the seller's facilitator, could land another body under the same id. This does not show that amount, recipient, token or timing match the ATR's content.

### `x402/exact/hedera/transfer-executor`

Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The payment is an x402 transferExecutor payment on Hedera: the payer's executor contract moved the funds under an authorization the seller did not read, and the facilitator submitted the transaction. The hash reached the payer only in the challenge's extension, and nothing the payer signed carries it. The seller read the merged consensus record of the named transaction, and found that its one debited account, by at least one unit, is the payer recorded when the payment was presented. This does not show that amount, recipient, token or timing match the ATR's content.

### `x402/exact/near`

Paid: the payer's account signed a NEP-366 delegate action whose one ft_transfer carries this ATR's hash in its memo, in LCP string form, so the payer's own signed act carries the hash. The runtime verified that signature and ran the delegate, and the transfer succeeded on the token contract the delegate names, reaching the account its receiver_id names, both as read. The signer is the delegate's sender, named apart from any other act's. This states nothing of the amount, nor that the token, the account reached or the time meet a term of the ATR.

### `x402/exact/polkadot/lcp-assets-remark`

The payer signed one Polkadot Asset Hub extrinsic whose bytes end with the profile call, the encoding of a batch of a transfer of the asset and a remark whose bytes are this ATR's hash in LCP string form. The chain verified the signature and dispatched the extrinsic, and its record carries a Remarked event with the BLAKE2b-256 of that remark and a Transferred event of the asset, at the finality recorded. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/solana`

The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and the transaction executed without error, carrying a token or SOL transfer. The memo is in the transaction's instruction data on chain. This does not show that amount, recipient, mint or timing match the ATR's content.

### `x402/exact/starknet`

The payer signed, as SNIP-12 typed data, a SNIP-9 outside execution whose nonce is the low 250 bits of this ATR's hash. The payer's account contract verified that signature when it executed the transfer call, and the nonce is in the settlement transaction's calldata. A holder of the ATR can confirm the hash from the nonce; the chain alone does not reveal all of it, and no event indexes it. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/sui`

The payer, the sender, signed a Sui transaction whose one unused Pure input is this ATR's hash, and the network executed it successfully in a checkpoint after the position the read was given; the hash is on chain in its input list, readable by its digest while a node retains it. The sender is not the option's payee. Where the transaction moved value it paid each account a positive balance change names; where it moved nothing it was signed, naming the recipient its signed transfer names. What it moved is recorded as observed: this does not show that amount, coin type or timing match the ATR's content.

### `x402/exact/tron/lcp-trc20-memo`

The payer signed a Tron transaction whose memo is this ATR's hash in LCP string form, and whose one contract calls transfer on the token. The network verified the signature, which covers the memo through the transaction id. The call succeeded with the token's Transfer event, at the finality recorded. The memo is on chain in the transaction. This does not show that amount, payee, token or timing match the ATR's content.

### `x402/exact/tvm`

The payer's W5 wallet signed a request whose one Jetton transfer carries this ATR's hash in its forward payload, as a TEP-74 text comment in LCP string form, and ran it: the payer's own signed act carries the hash. The W5 wallet paid, through its Jetton wallet, the amount the `internal_transfer` names, zero included, to the Jetton wallet that took it, the recipient; where the read observed no transfer, the W5 wallet signed. The signer is the W5 wallet, named apart from the recipient. This does not show that the amount, the Jetton, the payee or the time match the ATR's content.

### `x402/exact/xrpl`

The payer signed, with a single key, an XRPL Payment whose InvoiceID is the SHA-256 of this ATR's hash in LCP string form, and the Payment is in a validated ledger with tesSUCCESS. The hash can be confirmed from the ATR's bytes but not recovered from the ledger alone. This does not show that amount, destination, asset or timing match the ATR's content.

### `x402/upto/eip155/permit2`

The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show that amount, payee, asset or timing match the ATR's content. The amount settled is the seller's, submitted by the facilitator the witness names, and at most the signed maximum.

### `x402/upto/solana`

The payer signed a Solana transaction whose one Memo instruction carries this ATR's hash in LCP string form, and which opened a one-request payment channel escrowing the signed maximum; it executed without error. The memo is in the transaction's instruction data on chain. The amount charged from the escrow, which may be zero, is the seller's metering, settled by the facilitator in a later transaction that does not carry the hash, and the rest returns to the payer. This does not show that amount, recipient, mint or timing match the ATR's content.

