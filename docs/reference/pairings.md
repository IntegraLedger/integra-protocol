---
title: Pairing registry
description: Every pairing @integraledger/lcp implements, generated from its registry.
---

# Pairing registry

This page is generated from the package by `node scripts/docs-reference.mjs`, and CI checks that it matches.

`BINDINGS` holds 77 pairings on 8 surfaces (`ack`, `acp`, `ap2`, `card`, `mpp`, `spend-permissions`, `ucp`, `x402`). Each row gives the pairing's id, the export that implements it, its data's `coverage` (`full` where the payer's own signed act on a public ledger binds H, `none` where no public payer-signed act carries it) and `confirmed` (`yes` where something outside this package has shown the form as its profile defines it, `no` where nothing has yet), and these members of its `pattern` record: the binding pattern, where it names one, whether the binding is visible on a public ledger, whether the hash can be recovered from the chain alone, and the LCP profile that defines the binding, where one does. [Binding](../concepts/binding.md) explains each member, `forwardIndexable` included. Each pairing's id links to [where H rides in it and what its binding proves](#what-each-binding-proves).

## `ack`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`ack/payment-request`](#ackpayment-request) | `paymentRequest` from `@integraledger/lcp/ack` | `none` | no | `native-field` | no | no | [`ack/payment-request`](../../lcp/profiles/ack-payment-request.md) |

## `acp`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`acp/checkout/delegated`](#acpcheckoutdelegated) | `delegated` from `@integraledger/lcp/acp` | `none` | no | `native-field` | no | no | [`acp/checkout/session-id`](../../lcp/profiles/acp-checkout-session-id.md) |
| [`acp/checkout/undelegated`](#acpcheckoutundelegated) | `undelegated` from `@integraledger/lcp/acp` | `none` | no | `http-advisory` | no | no | [`acp/checkout/session-id`](../../lcp/profiles/acp-checkout-session-id.md) |

## `ap2`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`ap2/checkout-mandate`](#ap2checkout-mandate) | `checkoutMandate` from `@integraledger/lcp/ap2` | `none` | no | `opaque-challenge` | no | no | [`ap2/checkout-mandate`](../../lcp/profiles/ap2-checkout-mandate.md) |
| [`ap2/checkout-mandate/x402`](#ap2checkout-mandatex402) | `checkoutMandateX402` from `@integraledger/lcp/ap2` | `none` | no | `opaque-challenge` | no | no | [`ap2/checkout-mandate/x402`](../../lcp/profiles/ap2-checkout-mandate-x402.md) |

## `card`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`card/mastercard-agent-pay`](#cardmastercard-agent-pay) | `agentPay` from `@integraledger/lcp/card` | `none` | no | `protocol-extension` | no | no | [`card/mastercard-agent-pay`](../../lcp/profiles/card-mastercard-agent-pay.md) |
| [`card/mastercard-vi/autonomous`](#cardmastercard-viautonomous) | `viAutonomous` from `@integraledger/lcp/card` | `none` | no | `id-reuse` | no | no | [`card/mastercard-vi`](../../lcp/profiles/card-mastercard-vi.md) |
| [`card/mastercard-vi/immediate`](#cardmastercard-viimmediate) | `viImmediate` from `@integraledger/lcp/card` | `none` | no | `id-reuse` | no | no | [`card/mastercard-vi`](../../lcp/profiles/card-mastercard-vi.md) |
| [`card/seller-reference`](#cardseller-reference) | `sellerReference` from `@integraledger/lcp/card` | `none` | no | `http-advisory` | no | no | [`card/seller-reference`](../../lcp/profiles/card-seller-reference.md) |
| [`card/visa-tap`](#cardvisa-tap) | `visaTap` from `@integraledger/lcp/card` | `none` | no | `protocol-extension` | no | no | [`card/visa-tap`](../../lcp/profiles/card-visa-tap.md) |
| [`card/visa-vic`](#cardvisa-vic) | `visaVic` from `@integraledger/lcp/card` | `none` | no | `protocol-extension` | no | no | [`card/visa-vic`](../../lcp/profiles/card-visa-vic.md) |

## `mpp`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`mpp/charge/card`](#mppchargecard) | `chargeCard` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/evm/authorization`](#mppchargeevmauthorization) | `evmAuthorization` from `@integraledger/lcp/mpp` | `full` | yes | `id-reuse` | yes | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/evm/hash`](#mppchargeevmhash) | `evmHash` from `@integraledger/lcp/mpp` | `none` | yes | `opaque-challenge` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/evm/permit2`](#mppchargeevmpermit2) | `evmPermit2` from `@integraledger/lcp/mpp` | `full` | no | `id-reuse` | yes | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/evm/transaction`](#mppchargeevmtransaction) | `evmTransaction` from `@integraledger/lcp/mpp` | `none` | yes | `opaque-challenge` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/lcp/hedera`](#mppchargelcphedera) | `chargeLcpHedera` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | yes | [`mpp/method/lcp`](../../lcp/profiles/mpp-method-lcp.md) |
| [`mpp/charge/lightning`](#mppchargelightning) | `chargeLightning` from `@integraledger/lcp/lightning` | `none` | no | `native-field` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/nearintents`](#mppchargenearintents) | `chargeNearIntents` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/charge/nearintents`](../../lcp/profiles/mpp-charge-nearintents.md) |
| [`mpp/charge/solana`](#mppchargesolana) | `chargeSolana` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | yes | [`mpp/charge/solana`](../../lcp/profiles/mpp-charge-solana.md) |
| [`mpp/charge/solana/unsponsored`](#mppchargesolanaunsponsored) | `chargeSolanaUnsponsored` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | yes | [`mpp/charge/solana`](../../lcp/profiles/mpp-charge-solana.md) |
| [`mpp/charge/stripe`](#mppchargestripe) | `chargeStripe` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/tempo/split-memo`](#mppchargetemposplit-memo) | `tempoSplitMemo` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | no | [`mpp/charge/tempo/split-memo`](../../lcp/profiles/mpp-charge-tempo-split-memo.md) |
| [`mpp/charge/tempo/split-memo/push`](#mppchargetemposplit-memopush) | `tempoSplitMemoPush` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | no | [`mpp/charge/tempo/split-memo`](../../lcp/profiles/mpp-charge-tempo-split-memo.md) |
| [`mpp/charge/usdc/evm`](#mppchargeusdcevm) | `chargeUsdcEvm` from `@integraledger/lcp/mpp` | `full` | yes | `id-reuse` | yes | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/usdc/gateway`](#mppchargeusdcgateway) | `chargeUsdcGateway` from `@integraledger/lcp/mpp` | `none` | no | `id-reuse` | yes | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/charge/usdc/solana`](#mppchargeusdcsolana) | `chargeUsdcSolana` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | yes | [`mpp/charge/usdc/solana`](../../lcp/profiles/mpp-charge-usdc-solana.md) |
| [`mpp/charge/usdc/stacks`](#mppchargeusdcstacks) | `chargeUsdcStacks` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/charge/usdc/stacks`](../../lcp/profiles/mpp-charge-usdc-stacks.md) |
| [`mpp/charge/xrpl`](#mppchargexrpl) | `chargeXrpl` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | yes | [`mpp/charge/xrpl`](../../lcp/profiles/mpp-charge-xrpl.md) |
| [`mpp/session/evm`](#mppsessionevm) | `sessionEvm` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) |
| [`mpp/session/hedera/stock`](#mppsessionhederastock) | `sessionHederaStock` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| [`mpp/session/lightning`](#mppsessionlightning) | `sessionLightning` from `@integraledger/lcp/lightning` | `none` | no | `native-field` | no | no | [`mpp/charge`](../../lcp/profiles/mpp-charge.md) |
| [`mpp/session/solana/memo`](#mppsessionsolanamemo) | `sessionSolanaMemo` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| [`mpp/session/solana/stock`](#mppsessionsolanastock) | `sessionSolanaStock` from `@integraledger/lcp/mpp` | `none` | yes | `native-field` | no | no | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| [`mpp/session/tempo`](#mppsessiontempo) | `sessionTempo` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | yes | [`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) |
| [`mpp/session/xrpl`](#mppsessionxrpl) | `sessionXrpl` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| [`mpp/session/xrpl/stock`](#mppsessionxrplstock) | `sessionXrplStock` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/session/hedera-solana-xrpl`](../../lcp/profiles/mpp-session-hedera-solana-xrpl.md) |
| [`mpp/subscription/solana`](#mppsubscriptionsolana) | `subscriptionSolana` from `@integraledger/lcp/mpp` | `full` | no | `native-field` | yes | yes | [`mpp/subscription/solana`](../../lcp/profiles/mpp-subscription-solana.md) |
| [`mpp/subscription/stripe`](#mppsubscriptionstripe) | `subscriptionStripe` from `@integraledger/lcp/mpp` | `none` | no | `opaque-challenge` | no | no | [`mpp/subscription/stripe`](../../lcp/profiles/mpp-subscription-stripe.md) |
| [`mpp/subscription/tempo`](#mppsubscriptiontempo) | `subscriptionTempo` from `@integraledger/lcp/mpp` | `full` | yes | `native-field` | yes | yes | [`mpp/session/evm-tempo`](../../lcp/profiles/mpp-session-evm-tempo.md) |

## `spend-permissions`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`spend-permissions/eip155`](#spend-permissionseip155) | `spendPermissionsEip155` from `@integraledger/lcp/spend-permissions` | `full` | yes | `native-field` | yes | no | [`spend-permissions/eip155`](../../lcp/profiles/spend-permissions-eip155.md) |

## `ucp`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`ucp/booking/ap2-mandate`](#ucpbookingap2-mandate) | `bookingAp2Mandate` from `@integraledger/lcp/ucp` | `none` | no | `opaque-challenge` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| [`ucp/booking/unsigned`](#ucpbookingunsigned) | `bookingUnsigned` from `@integraledger/lcp/ucp` | `none` | no | `http-advisory` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| [`ucp/checkout/agent-signed`](#ucpcheckoutagent-signed) | `agentSigned` from `@integraledger/lcp/ucp` | `none` | no | `protocol-extension` | no | no | [`ucp/checkout/agent-signed`](../../lcp/profiles/ucp-checkout-agent-signed.md) |
| [`ucp/checkout/ap2-mandate`](#ucpcheckoutap2-mandate) | `ap2Mandate` from `@integraledger/lcp/ucp` | `none` | no | `opaque-challenge` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |
| [`ucp/checkout/unsigned`](#ucpcheckoutunsigned) | `unsigned` from `@integraledger/lcp/ucp` | `none` | no | `http-advisory` | no | no | [`ucp/checkout/legal-context`](../../lcp/profiles/ucp-checkout-legal-context.md) |

## `x402`

| Pairing | Export | Coverage | Confirmed | Pattern | Binding on chain | Recoverable from chain | Profile |
|---|---|---|---|---|---|---|---|
| [`x402/auth-capture/eip155/eip3009`](#x402auth-captureeip155eip3009) | `authCaptureEip3009` from `@integraledger/lcp/x402` | `full` | yes | `id-reuse` | yes | no | [`x402/auth-capture/eip155`](../../lcp/profiles/x402-auth-capture-eip155.md) |
| [`x402/auth-capture/eip155/permit2`](#x402auth-captureeip155permit2) | `authCapturePermit2` from `@integraledger/lcp/x402` | `full` | yes | `id-reuse` | yes | no | [`x402/auth-capture/eip155`](../../lcp/profiles/x402-auth-capture-eip155.md) |
| [`x402/batch-settlement/cloudflare`](#x402batch-settlementcloudflare) | `batchCloudflare` from `@integraledger/lcp/x402-batch-settlement` | `none` | no | `protocol-extension` | no | no | [`x402/batch-settlement/cloudflare`](../../lcp/profiles/x402-batch-settlement-cloudflare.md) |
| [`x402/batch-settlement/eip155`](#x402batch-settlementeip155) | `batchEvm` from `@integraledger/lcp/x402-batch-settlement` | `full` | yes | `native-field` | yes | yes | [`x402/batch-settlement/eip155`](../../lcp/profiles/x402-batch-settlement-eip155.md) |
| [`x402/batch-settlement/solana`](#x402batch-settlementsolana) | `batchSvm` from `@integraledger/lcp/x402-batch-settlement` | `full` | no | `native-field` | yes | yes | [`x402/batch-settlement/solana`](../../lcp/profiles/x402-batch-settlement-solana.md) |
| [`x402/exact/algorand`](#x402exactalgorand) | `exactAvm` from `@integraledger/lcp/avm` | `full` | yes | `native-field` | yes | yes | [`x402/exact/algorand/note`](../../lcp/profiles/x402-exact-algorand-note.md) |
| [`x402/exact/aptos`](#x402exactaptos) | `exactAptos` from `@integraledger/lcp/aptos` | `none` | yes | `http-advisory` | no | no | [`x402/exact/aptos`](../../lcp/profiles/x402-exact-aptos.md) |
| [`x402/exact/cardano`](#x402exactcardano) | `exactCardano` from `@integraledger/lcp/cardano` | `full` | yes | `native-field` | yes | yes | [`x402/exact/cardano`](../../lcp/profiles/x402-exact-cardano.md) |
| [`x402/exact/cardano/lock`](#x402exactcardanolock) | `exactCardanoLock` from `@integraledger/lcp/cardano` | `full` | yes | `native-field` | yes | yes | [`x402/exact/cardano`](../../lcp/profiles/x402-exact-cardano.md) |
| [`x402/exact/casper`](#x402exactcasper) | `exactCasper` from `@integraledger/lcp/casper` | `full` | no | `native-field` | yes | yes | [`x402/exact/casper`](../../lcp/profiles/x402-exact-casper.md) |
| [`x402/exact/ccd`](#x402exactccd) | `exactCcd` from `@integraledger/lcp/ccd` | `full` | no | `native-field` | yes | yes | [`x402/exact/ccd`](../../lcp/profiles/x402-exact-ccd.md) |
| [`x402/exact/eip155/eip3009`](#x402exacteip155eip3009) | `exactEip3009` from `@integraledger/lcp/x402` | `full` | yes | `native-field` | yes | yes | [`x402/exact/eip155/eip3009`](../../lcp/profiles/x402-exact-eip155-eip3009.md) |
| [`x402/exact/eip155/erc7710`](#x402exacteip155erc7710) | `exactErc7710` from `@integraledger/lcp/x402` | `none` | yes | `http-advisory` | no | no | [`x402/exact/eip155/erc7710`](../../lcp/profiles/x402-exact-eip155-erc7710.md) |
| [`x402/exact/eip155/erc7710-salt`](#x402exacteip155erc7710-salt) | `exactErc7710Salt` from `@integraledger/lcp/x402` | `full` | yes | `native-field` | yes | yes | [`x402/exact/eip155/erc7710-salt`](../../lcp/profiles/x402-exact-eip155-erc7710-salt.md) |
| [`x402/exact/eip155/gateway-batched`](#x402exacteip155gateway-batched) | `exactGatewayBatched` from `@integraledger/lcp/x402` | `none` | yes | `native-field` | no | no | [`x402/exact/eip155/gateway-batched`](../../lcp/profiles/x402-exact-eip155-gateway-batched.md) |
| [`x402/exact/eip155/permit2`](#x402exacteip155permit2) | `exactPermit2` from `@integraledger/lcp/x402` | `full` | yes | `native-field` | yes | yes | [`x402/exact/eip155/permit2`](../../lcp/profiles/x402-exact-eip155-permit2.md) |
| [`x402/exact/hedera`](#x402exacthedera) | `exactHedera` from `@integraledger/lcp/hedera` | `full` | yes | `native-field` | yes | yes | [`x402/exact/hedera`](../../lcp/profiles/x402-exact-hedera.md) |
| [`x402/exact/hedera/transfer-executor`](#x402exacthederatransfer-executor) | `exactHederaExecutor` from `@integraledger/lcp/hedera` | `none` | no | `http-advisory` | no | no | [`x402/exact/hedera`](../../lcp/profiles/x402-exact-hedera.md) |
| [`x402/exact/lnbtc/payment-hash`](#x402exactlnbtcpayment-hash) | `exactLnbtcPaymentHash` from `@integraledger/lcp/lightning` | `none` | yes | `native-field` | no | no | [`x402/exact/lnbtc/payment-hash`](../../lcp/profiles/x402-exact-lnbtc-payment-hash.md) |
| [`x402/exact/near`](#x402exactnear) | `exactNear` from `@integraledger/lcp/near` | `full` | yes | `native-field` | yes | yes | [`x402/exact/near/memo`](../../lcp/profiles/x402-exact-near-memo.md) |
| [`x402/exact/polkadot/lcp-assets-remark`](#x402exactpolkadotlcp-assets-remark) | `exactPolkadotRemark` from `@integraledger/lcp/polkadot` | `full` | yes | `native-field` | yes | yes | [`x402/exact/polkadot/lcp-assets-remark`](../../lcp/profiles/x402-exact-polkadot-lcp-assets-remark.md) |
| [`x402/exact/solana`](#x402exactsolana) | `exactSvm` from `@integraledger/lcp/x402-exact-solana` | `full` | yes | `native-field` | yes | yes | [`x402/exact/solana`](../../lcp/profiles/x402-exact-solana.md) |
| [`x402/exact/starknet`](#x402exactstarknet) | `exactStarknet` from `@integraledger/lcp/starknet` | `full` | yes |  | yes | no | [`x402/exact/starknet`](../../lcp/profiles/x402-exact-starknet.md) |
| [`x402/exact/stellar/precondition`](#x402exactstellarprecondition) | `exactStellarPrecondition` from `@integraledger/lcp/x402-exact-stellar` | `full` | yes | `native-field` | yes | yes | [`x402/exact/stellar/precondition`](../../lcp/profiles/x402-exact-stellar-precondition.md) |
| [`x402/exact/sui`](#x402exactsui) | `exactSui` from `@integraledger/lcp/sui` | `full` | yes | `native-field` | yes | yes | [`x402/exact/sui`](../../lcp/profiles/x402-exact-sui.md) |
| [`x402/exact/tron/lcp-trc20-memo`](#x402exacttronlcp-trc20-memo) | `exactTronMemo` from `@integraledger/lcp/tron` | `full` | yes | `native-field` | yes | yes | [`x402/exact/tron/lcp-trc20-memo`](../../lcp/profiles/x402-exact-tron-lcp-trc20-memo.md) |
| [`x402/exact/tvm`](#x402exacttvm) | `exactTvm` from `@integraledger/lcp/tvm` | `full` | yes | `native-field` | yes | yes | [`x402/exact/tvm`](../../lcp/profiles/x402-exact-tvm.md) |
| [`x402/exact/xrpl`](#x402exactxrpl) | `exactXrpl` from `@integraledger/lcp/x402-exact-xrpl` | `full` | yes | `id-reuse` | yes | no | [`x402/exact/xrpl`](../../lcp/profiles/x402-exact-xrpl.md) |
| [`x402/upto/eip155/permit2`](#x402uptoeip155permit2) | `uptoPermit2` from `@integraledger/lcp/x402` | `full` | yes | `native-field` | yes | yes | [`x402/upto/eip155/permit2`](../../lcp/profiles/x402-upto-eip155-permit2.md) |
| [`x402/upto/solana`](#x402uptosolana) | `uptoSvm` from `@integraledger/lcp/x402-upto-solana` | `full` | no | `native-field` | yes | yes | [`x402/upto/solana`](../../lcp/profiles/x402-upto-solana.md) |
| [`x402/upto/xrpl`](#x402uptoxrpl) | `uptoXrpl` from `@integraledger/lcp/x402-upto-xrpl` | `none` | yes | `http-advisory` | no | no | [`x402/upto/xrpl`](../../lcp/profiles/x402-upto-xrpl.md) |

## What each binding proves

For each pairing, where H rides, from its data's `carrier`: `signed`, the field of what the payer signs that carries H, and `member`, the member of the option (x402) or of the challenge's request (MPP) the seller writes H into; then its data's `proves`, what a payment through it shows and what it does not. The text is the package's own, quoted as it is. Where it names `<network>` and `<transaction>`, the record fills them in.

### `ack/payment-request`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. This ATR's hash is the id of the seller's ACK Payment Request token, with the link beside it; a receipt for that request embeds the token. The token's signature is not verified here. ACK defines no payer signature, so nothing the payer signed carries the hash, and the payment, which the payer's side sends before it presents the receipt, is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `acp/checkout/delegated`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's link in metadata. The payment handler required delegate_payment, so ACP has the agent obtain a vault token whose allowance names this session as checkout_session_id, in a request the agent signs (a MUST in one section of ACP and RECOMMENDED in another) and the PSP SHOULD verify. No signature was verified here, nothing compares the agent's signer with the account that signed the agreement, and ACP does not require the PSP to hold the token to that session. The payment is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `acp/checkout/undelegated`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout session this payment completed has this ATR's hash as its id, and its responses carried the ATR's link in metadata. The payment handler did not require delegate_payment, so nothing the payer signed for the payment names the hash. The payment is known from the seller's report alone, which names it by the seller's own reference for the charge.

### `ap2/checkout-mandate`

**Where H rides:** the mandate's `checkout_hash`, over a merchant-signed checkout carrying H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The closed AP2 Checkout Mandate presented carries checkout_hash, the SHA-256 of the checkout JWT presented beside it, and that JWT's payload carries this ATR's hash as its legalContext member. AP2 has the mandate signed by the user's trusted surface, or by the agent under the user's open mandate presented before it in a chain. That signature, the open mandate's signature, its delegation to the agent's key (cnf) and the chain's link were not verified here, and nothing compares the mandate's signer with the account that signed the agreement: AP2 has the Credential Provider verify the Payment Mandate, whose transaction_id is the same hash, before a payment credential issues. The payment, whether the merchant initiated it or the payer's side sent it, is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `ap2/checkout-mandate/x402`

**Where H rides:** the mandate's `checkout_hash`, over a merchant-signed checkout carrying H; the x402 authorization's nonce is keccak-256 of the payment mandate chain, and carries no H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken. This does not show that the account is this payment's payer. The payment paid <amount> of the token <asset> to <recipient> in <payment transaction> on <payment network>: an EIP-3009 transfer authorization whose nonce is keccak-256 of the payment mandate chain it was presented with, as AP2's payment processor requires, and whose chain's closed Payment Mandate names, as its transaction_id, the checkout_hash of the closed AP2 Checkout Mandate presented. That checkout_hash is the SHA-256 of the checkout JWT presented beside it, and that JWT's payload carries this ATR's hash as its legalContext member; the payment itself carries no hash of this ATR. No mandate signature was verified here: AP2 has the Credential Provider verify the mandates. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-agent-pay`

**Where H rides:** H followed by 32 random bytes in the nonce of an Agent Pay message signature, which the agent signs; H also in the checkout path for an agent whose nonce does not carry it.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. Every Mastercard Agent Pay message signature in the agent's checkout request, tagged Agent-pay-auth or agent-pay-auth, covers this ATR's hash: its nonce, whose first 32 bytes are the hash, or the request's path, whose last segment is the hash. The seller checked where the hash rides and did not verify a signature here, and nothing compares the agent's key with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-vi/autonomous`

**Where H rides:** `legalContext` in the merchant's `checkout_jwt`, whose hash the agent's mandate signs.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. An agent signed a Verifiable Intent L3b checkout mandate whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, with the key the presented L2 mandate delegates to it. The seller verified both ES256 signatures and the sd_hash links, but not the L1 issuer's signature, and nothing compares the L2 or L3b signer with the account that signed the agreement. The L2 signature does not cover the hash, and the seller did not see the L3a payment mandate the network received, whose transaction_id Verifiable Intent requires to equal this checkout_hash. This does not show that amount, payee or timing match the ATR's content.

### `card/mastercard-vi/immediate`

**Where H rides:** `legalContext` in the `checkout_jwt` (the merchant's, or one the agent created), whose hash the user's mandate signs.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The Verifiable Intent L2 mandate presented lists a checkout mandate whose checkout_hash is the SHA-256 of a checkout_jwt carrying this ATR's hash, and the payment mandate's transaction_id, where disclosed, equals it. The seller checked those values and did not verify the L2 mandate's signature, which Verifiable Intent has the payment network validate before authorization, and nothing compares the L2 mandate's signer with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `card/seller-reference`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. This ATR's hash and link are for the seller to show the buyer before payment and to put in its processor's metadata under legal_context, beside the seller's own reference for the charge. Nothing the payer signed for this payment carries the hash, and the payment is known from the seller's report alone, which names it by that reference. This does not show that the payer's approval carried the hash.

### `card/visa-tap`

**Where H rides:** H followed by 32 random bytes in the signature's nonce, which the agent signs; H also in the checkout path for stock agents.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. Every TAP agent-payer-auth message signature in the agent's checkout request covers this ATR's hash: its nonce, whose first 32 bytes are the hash, or the request's path, whose last segment is the hash. The seller checked where the hash rides and did not verify a signature here, which belongs to its TAP recognition step, and nothing compares the agent's key with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `card/visa-vic`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The agent's Visa Intelligent Commerce credential request carried this ATR's hash as its transactionReferenceId, which the seller read from the credential payload Visa signs for the sale. Verifying that payload is the seller's and was not done here, and nothing compares the agent or the cardholder with the account that signed the agreement. The card authorization itself does not carry the hash. This does not show that amount, payee or timing match the ATR's content.

### `mpp/charge/card`

**Where H rides:** nothing the payer signs carries H. The seller writes H into the challenge request's `externalId`.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the credential presented echoed that challenge. The seller also placed the hash in the request's externalId. Nothing the payer or its card signed carries the hash, and the payment is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `mpp/charge/evm/authorization`

**Where H rides:** the EIP-3009 `nonce`, `keccak256(JSON.stringify([id, realm]))`, a 256-bit digest over a preimage holding H.

**What it proves:** The payer signed an EIP-3009 transfer authorization whose nonce is keccak256 of this challenge's id and realm, and the id is this ATR's hash in base64url with the challenge's position. The token contract verified the signature when it executed the transfer, and the nonce is on chain as the nonce topic of its AuthorizationUsed event. A holder of the ATR and the realm can confirm the hash from that nonce; the chain alone does not reveal it. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/evm/hash`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this payment, an account signed an agreement carrying this ATR's hash on <network>, recorded in <transaction>; that shows neither that the account is the payer nor when this charge was taken. The payment is an ERC-20 transfer signed as a whole transaction (`transaction`), or broadcast by its signer and named by its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the read found that the named transaction succeeded and moved a token to the challenge's recipient. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/evm/permit2`

**Where H rides:** the Permit2 witness's `challengeHash`, a digest over the challenge holding H; the permit's `nonce` is required to be the same value, and `bound` refuses a permit under another.

**What it proves:** The payer signed a Permit2 transfer, single or batch, whose witness carries keccak256 of this challenge's id and realm, and the id is this ATR's hash in base64url with the challenge's position. Permit2 verified the signature when it executed the transfer; a batch's transfers all executed in that one call. The witness is in the settlement transaction's calldata only as a hash, and no event carries it. This does not show that amount, payee, asset, splits or timing match the ATR's content.

### `mpp/charge/evm/transaction`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this payment, an account signed an agreement carrying this ATR's hash on <network>, recorded in <transaction>; that shows neither that the account is the payer nor when this charge was taken. The payment is an ERC-20 transfer signed as a whole transaction (`transaction`), or broadcast by its signer and named by its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the read found that the named transaction succeeded and moved a token to the challenge's recipient. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/lcp/hedera`

**Where H rides:** the memo of the TransferTransaction body the buyer signs: H's LCP string (77 bytes), all of H, in lowercase hex.

**What it proves:** The payer's own signed act carries this ATR's hash: a Hedera crypto transfer whose memo is the hash's LCP string reached consensus with SUCCESS, debiting the payer, the one account its rows debit, and paid the account it credits, recorded with the asset and amount it moved. The memo is in the public transaction record, readable by transaction id. It compares no amount, asset or time with the ATR's terms.

### `mpp/charge/lightning`

**Where H rides:** nothing the payer signs carries H. The seller writes H into the challenge request's `methodDetails.invoice`.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's node's BOLT11 invoice's description hash is this ATR's hash, and the ATR commits its payment hash. The invoice is decoded strictly and its signer is recovered; no payee key is compared with that signer, and the payer signed nothing that carries the hash. The preimage, which every node on the payment's route learns, shows that the secret behind the hash left the seller's custody, never who paid, and to anyone but the seller's node not that the invoice was paid; no public ledger shows the payment. Settlement is the seller's report. This does not show that amount, payee or timing match the ATR's content.

### `mpp/charge/nearintents`

**Where H rides:** nothing the payer signs carries H. The seller writes H into the challenge request's `externalId`.

**What it proves:** Before this payment was reported, an agreement transaction carrying this ATR's hash was signed on <network>, recorded in <transaction>; this shows neither that its signer is the payer nor when the deposit was made. The seller's MPP challenge carried the hash in its externalId. The deposit carries no hash, and its payer signed nothing that does. The seller reported it paid.

### `mpp/charge/solana`

**Where H rides:** one Memo instruction, H's LCP string. The seller writes H into the challenge request's `externalId`.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose one LCP-form Memo instruction is the hash's LCP string, final at `finalized` with no error. It paid each transfer it made from the buyer's account, recorded with its mint or lamports, amount and recipient, one of zero included, the recipient being the owner the transaction's token balances name; as a payment, one of them reached an account the option's payee owns. The memo is in the transaction's instruction data on chain. It compares no amount, mint or time with the ATR's terms.

### `mpp/charge/solana/unsponsored`

**Where H rides:** one Memo instruction, H's LCP string. The seller writes H into the challenge request's `externalId`.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose one LCP-form Memo instruction is the hash's LCP string, final at `finalized` with no error. It paid each transfer it made from the buyer's account, recorded with its mint or lamports, amount and recipient, one of zero included, the recipient being the owner the transaction's token balances name; as a payment, one of them reached an account the option's payee owns. The memo is in the transaction's instruction data on chain. It compares no amount, mint or time with the ATR's terms.

### `mpp/charge/stripe`

**Where H rides:** nothing the payer signs carries H. The seller writes H into the challenge request's `methodDetails.metadata.legal_context`.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the credential presented echoed that challenge. The seller also placed the hash in the PaymentIntent's metadata under legal_context. Nothing the payer or its Stripe token signed carries the hash, and the payment is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `mpp/charge/tempo/split-memo`

**Where H rides:** the `memo` of the one `transferWithMemo` call to `currency` whose memo is H, the split `{recipient, amount: 1, memo: H}` the challenge carries, in the Tempo transaction the payer signs; all of H. The seller writes H into the challenge request's `methodDetails.splits`.

**What it proves:** The ATR's hash is in the MPP Tempo charge challenge the payer answered: its id is the hash in base64url with the challenge's position, and one of its splits carries the hash as its memo. The payer's own signed Tempo transaction carries all of the hash as the memo of a `transferWithMemo` call, and the chain verified the payer's signature when it executed the call. The record states "paid" where value moved, with the account it reached, and "signed" where nothing moved. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/tempo/split-memo/push`

**Where H rides:** the `memo` of the one `transferWithMemo` call to `currency` whose memo is H, in the Tempo transaction the payer signed and broadcast; all of H. The seller writes H into the challenge request's `methodDetails.splits`.

**What it proves:** The ATR's hash is in the MPP Tempo charge challenge the payer answered: its id is the hash in base64url with the challenge's position, and one of its splits carries the hash as its memo. The payer's own signed Tempo transaction carries all of the hash as the memo of a `transferWithMemo` call, and the chain verified the payer's signature when it executed the call. The record states "paid" where value moved, with the account it reached, and "signed" where nothing moved. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/evm`

**Where H rides:** the EIP-3009 `nonce`, keccak256 of the JCS of `{id, method, realm, intent, requestHash}`, a digest over H.

**What it proves:** The payer signed an EIP-3009 authorization whose nonce is keccak256 of the JCS of this challenge's id, realm and request hash, and the id is this ATR's hash in base64url with the challenge's position. The token contract verified the signature when it executed the transfer, and the nonce is on chain in its AuthorizationUsed event. A holder of the ATR, the realm and the request can confirm the hash; the chain alone does not reveal it. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/gateway`

**Where H rides:** the Circle Gateway burn intent's TransferSpec `salt`, a digest over the challenge `id`, which the payer signs and which is not public.

**What it proves:** The payer signed a Circle Gateway burn intent whose TransferSpec salt is keccak256 of the JCS of this challenge's id and parameters, and the id is this ATR's hash in base64url with the challenge's position. The signature is not verified here. The salt travels inside the TransferSpec that the destination mint carries, and the Gateway Minter emits that TransferSpec's keccak256 hash; this record reads no chain, and settlement is the seller's report. This does not show that amount, payee, asset or timing match the ATR's content.

### `mpp/charge/usdc/solana`

**Where H rides:** one Memo instruction, H's LCP string. The seller writes H into the challenge request's `externalId`.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose one LCP-form Memo instruction is the hash's LCP string, final at `finalized` with no error. It paid each transfer it made from the buyer's account, recorded with its mint or lamports, amount and recipient, one of zero included, the recipient being the owner the transaction's token balances name; as a payment, one of them reached an account the option's payee owns. The memo is in the transaction's instruction data on chain. It compares no amount, mint or time with the ATR's terms.

### `mpp/charge/usdc/stacks`

**Where H rides:** the SIP-010 `transfer`'s memo argument, `(some H)` with H's 32 bytes as a buffer, in the transaction the origin signs.

**What it proves:** The payer signed a Stacks transaction whose origin is the payer and which carries this ATR's hash as the `(some H)` memo of a SIP-010 `transfer`, or as a token transfer's memo. The chain verified the origin's signature, the transaction executed with status success on the canonical chain, and the memo is in the mined transaction on chain. Where it made a transfer, one of zero included, it paid that transfer's recipient, named in the record; the origin, never a sponsor, is the signer. This does not show that the contract is a SIP-010 token, or that amount, asset or timing match the ATR's content.

### `mpp/charge/xrpl`

**Where H rides:** the Payment's `InvoiceID`, H itself. The seller writes H into the challenge request's `methodDetails.invoiceId`.

**What it proves:** The payer signed an XRPL Payment whose InvoiceID is this ATR's hash, and it is in a validated ledger with tesSUCCESS: it paid the amount meta.delivered_amount states to the account its Destination names. This does not show that amount, destination, asset or timing match the ATR's content.

### `mpp/session/evm`

**Where H rides:** the channel `salt`, which is H; an `authorization` funding's EIP-3009 nonce is a digest over the channel's parameters and H, and a `permit2` funding's witness carries the salt.

**What it proves:** The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with the challenge's position. The payer opened a payment channel whose salt is this ATR's hash, so the channel id, keccak256 over the payer, payee, token, salt, authorized signer, escrow and chain, commits to it. The payer signed that opening as an open call carrying the salt, an EIP-3009 authorization whose nonce is MPP's hash over the channel parameters and the salt, or a Permit2 transfer whose witness carries the salt. The seller read that the opening transaction succeeded and moved the payer's deposit to the escrow, and that the escrow ran the open call as the transaction shows it: an `openWithAuthorization` by its token's AuthorizationUsed of the payer and the nonce the escrow recomputes over the channel parameters and the salt, or an `openWithPermit2` as the transaction's own call to the escrow. Its salt is this ATR's hash, its payee is the channel's beneficiary, and the payer is the account its authorization or permit is signed by, whose deposit moved to the escrow. This does not show that amount, payee, asset or timing match the ATR's content. Each voucher in this channel signs a commitment to this ATR's hash.

### `mpp/session/hedera/stock`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this session, an account signed an agreement transaction carrying this ATR's hash on the session's Hedera network. The opening the credential names reached consensus: the account its ChannelOpened log names as payer deposited the deposit into the escrow's channel, whose payee the log names, after the block the agreement was recorded at. The opening does not carry the hash, and this does not show that the account that signed the agreement is the one that opened the channel unless the record compares the two. Vouchers sign the channel id and an amount, not the hash. This does not show that amount, deposit, payee or timing match the ATR's content.

### `mpp/session/lightning`

**Where H rides:** nothing the payer signs carries H. The seller writes H into the challenge request's `depositInvoice`.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's node's BOLT11 invoice's description hash is this ATR's hash, and the ATR commits its payment hash. The invoice is decoded strictly and its signer is recovered; no payee key is compared with that signer, and the payer signed nothing that carries the hash. The preimage, which every node on the payment's route learns, shows that the secret behind the hash left the seller's custody, never who paid, and to anyone but the seller's node not that the invoice was paid; no public ledger shows the payment. Settlement is the seller's report. This does not show that amount, payee or timing match the ATR's content. The close is the seller's report.

### `mpp/session/solana/memo`

**Where H rides:** one Memo instruction, H's LCP string, in the open the payer signs.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose one LCP-form Memo instruction in the `open` the seller's operator co-signed and submitted is the hash's LCP string, final at `finalized` with no error, which deposited the amount its `open` names into a payment channel whose distribution pays the option's payee more than nothing, recorded with its mint and each account's share of the amount as the program pays it out. The memo is in the transaction's instruction data on chain. Vouchers and the close do not carry the hash. It compares no amount, mint or time with the ATR's terms.

### `mpp/session/solana/stock`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this opening was taken, an account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>. The opening, a stock MPP session's payment-channel open that its payer broadcast and that carries no hash, came after it and deposited the amount its `open` names into a channel whose distribution pays the option's payee more than nothing. This does not show that the account that signed the agreement is the opening's payer, nor that amount, recipient, mint or timing match the ATR's content.

### `mpp/session/tempo`

**Where H rides:** the channel `salt`, which is H, in the `open` call to the escrow the payer signs; on the newer session protocol the descriptor carries it too.

**What it proves:** The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in base64url with the challenge's position. The payer signed a Tempo transaction whose one call to the channel escrow opens a channel with this ATR's hash as its salt, and the chain verified that signature when it executed the call. The escrow's ChannelOpened event names the channel, whose id commits to the salt, and carries the salt itself, on the v1 escrow as on the TIP-1034 escrow. This does not show that amount, payee, asset or timing match the ATR's content. Each voucher in this channel signs a commitment to this ATR's hash.

### `mpp/session/xrpl`

**Where H rides:** one memo, H's LCP string, in the `PaymentChannelCreate` the buyer signs and the server submits.

**What it proves:** The payer signed an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's hash, and it is in a validated ledger with tesSUCCESS: it deposited the create's Amount into a channel whose beneficiary is the account its Destination names. The memo is in the public transaction. Vouchers in this channel sign the channel id and an amount, not the hash. This does not show that amount, deposit, destination, settle delay or timing match the ATR's content.

### `mpp/session/xrpl/stock`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this session, an account signed an agreement transaction carrying this ATR's hash on the session's XRPL network. The channel's create is in a validated ledger with tesSUCCESS: the account the voucher's source names deposited the create's Amount into the channel the voucher names, whose beneficiary is the account its Destination names, after the ledger the agreement was recorded at. The create does not carry the hash, and this does not show that the account that signed the agreement is the one that opened the channel unless the record compares the two. Vouchers sign the channel id and an amount, not the hash. This does not show that amount, deposit, destination, settle delay or timing match the ATR's content.

### `mpp/subscription/solana`

**Where H rides:** the Memo instruction of the activation, H's LCP string. The seller writes H into the challenge request's `externalId`.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, a subscription's activation, whose one LCP-form Memo instruction is the hash's LCP string, final at `finalized` with no error, which paid the first period to an account the option's payee owns, recorded with its mint and amount. The memo is in the transaction's instruction data on chain. Renewals are the seller's later pulls, which do not carry the hash. It compares no amount, mint, period or time with the ATR's terms.

### `mpp/subscription/stripe`

**Where H rides:** nothing the payer signs carries H. The seller writes H into the challenge request's `methodDetails.metadata.legal_context`.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The seller's MPP challenge carried this ATR's hash in its id and its opaque reference, bound to the challenge by the seller's own server, and the credential presented echoed that challenge. The seller also placed the hash in the metadata under legal_context of the payment that activates the subscription. Nothing the payer or its Stripe token signed carries the hash, and the activation is known from the seller's report alone. This does not show that the payer's approval carried the hash.

### `mpp/subscription/tempo`

**Where H rides:** the key authorization's witness, the challenge `id`'s 32 bytes, which are H.

**What it proves:** The ATR's hash is the MPP subscription challenge's id, in base64url. The payer's root key signed a Tempo key authorization whose witness is this ATR's hash, granting the seller's access key a per-period limit. The chain verified that signature when the activation transaction registered the key, and the account keychain's KeyAuthorizationWitness event carries the payer's account and this hash as topics. The key authorization names one recipient the key may pay; what the same transaction transferred from the payer's account, if anything, is recorded as what moved, with its recipient. This does not show that amount, period, payee, asset or timing match the ATR's content.

### `spend-permissions/eip155`

**Where H rides:** the Spend Permission's `salt`, which is H, all of H: a member of the EIP-712 hash the account signs in the SpendPermissionManager's domain, or of the permission the account's own `approve` call carries.

**What it proves:** The account named signed a Spend Permission whose salt is this ATR's hash, naming the payee as spender, and the SpendPermissionManager approved it: the hash is on chain in the permission its SpendPermissionApproved event carries in the approval's transaction. The approval moves nothing. This does not show that any amount was later spent, nor that the allowance, period, token or timing match the ATR's content.

### `ucp/booking/ap2-mandate`

**Where H rides:** the mandate's `checkout_hash`, over the booking whose `links[]` carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The booking carried this ATR's hash and link as its legal_context link. The checkout mandate presented under UCP's AP2 Mandates extension carries checkout_hash, the SHA-256 of the booking JWT presented beside it, and the hash was read from that JWT's booking. The mandate's signature, and, where an open mandate precedes it in a chain, that mandate's signature, its delegation (cnf) and the chain's link, were not verified here, and nothing compares the mandate's signer with the account that signed the agreement; the PSP verifies the payment mandate over the same booking hash. The payment is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `ucp/booking/unsigned`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The booking response carried this ATR's hash and link as its legal_context link. UCP without the AP2 Mandates extension defines no buyer signature, so the payer's approval did not sign the hash. The payment is known from the seller's report alone.

### `ucp/checkout/agent-signed`

**Where H rides:** the `legal_context` member of the platform's request that completes the checkout, which the platform's RFC 9421 signature covers through `content-digest`.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout response carried this ATR's hash and link as its legal_context link, and the platform's request that completed the checkout carried the hash in its legal_context member, with a Content-Digest that is the SHA-256 of that request's body. The platform's RFC 9421 signature over the request, which UCP has the business verify with the key in the platform's profile, was not verified here, and nothing ties that key to the account that signed the agreement. The seller reported the payment. This does not show that amount, payee or timing match the ATR's content.

### `ucp/checkout/ap2-mandate`

**Where H rides:** the mandate's `checkout_hash`, over the checkout whose `links[]` carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout carried this ATR's hash and link as its legal_context link. The checkout mandate presented under UCP's AP2 Mandates extension carries checkout_hash, the SHA-256 of the checkout JWT presented beside it, and the hash was read from that JWT's checkout. The mandate's signature, and, where an open mandate precedes it in a chain, that mandate's signature, its delegation (cnf) and the chain's link, were not verified here, and nothing compares the mandate's signer with the account that signed the agreement; the PSP verifies the payment mandate over the same checkout hash. The payment is known from the seller's report alone. This does not show that amount, payee or timing match the ATR's content.

### `ucp/checkout/unsigned`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The checkout response carried this ATR's hash and link as its legal_context link. UCP without the AP2 Mandates extension defines no buyer signature, so the payer's approval did not sign the hash. The payment is known from the seller's report alone, which names it by the seller's own reference for the charge.

### `x402/auth-capture/eip155/eip3009`

**Where H rides:** `PaymentInfo.salt`: H where `receiverAuthorizer` and `policy` are absent, else `keccak256` over a typehash, both and H; a bound salt travels with `saltNonce`, which is H.

**What it proves:** The payer signed a token authorization whose nonce commits, through the escrow's PaymentInfo, to a salt that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy when bound. The token contract verified the signature when the escrow collected the payment, and the escrow's event carries the salt. When unbound, the salt is this ATR's hash, so the settled transaction itself shows it. When bound, a holder of the ATR, the receiver authorizer and the policy can confirm the hash from the salt; the chain alone does not reveal it. This record covers that first collection; capture, void, refund and reclaim are the operator's and the payer's.

### `x402/auth-capture/eip155/permit2`

**Where H rides:** `PaymentInfo.salt`: H where `receiverAuthorizer` and `policy` are absent, else `keccak256` over a typehash, both and H; a bound salt travels with `saltNonce`, which is H.

**What it proves:** The payment presented a Permit2 authorization whose nonce commits, through the escrow's PaymentInfo, to a salt that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy when bound. The escrow's event in the settlement transaction carries that PaymentInfo, salt included, and names the deployment's Permit2 collector as the token collector that funded it. When unbound, the salt is this ATR's hash, so the settled transaction itself shows it. When bound, a holder of the ATR, the receiver authorizer and the policy can confirm the hash from the salt; the chain alone does not reveal it. This record covers that first collection; capture, void, refund and reclaim are the operator's and the payer's.

### `x402/batch-settlement/cloudflare`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** The request whose payment echoed this ATR's hash in the legalContext entry of x402's extensions was signed with an HTTP message signature key registered with Cloudflare, which Cloudflare verifies, billing that key's registered identity off chain. The echoed hash only locates the sale: the pairing follows no agreement, and no public ledger records the payment. This does not show that amount, asset or timing match the ATR's content.

### `x402/batch-settlement/eip155`

**Where H rides:** `ChannelConfig.salt`, which is H, all of H; in the scheme's refund-authorizer mode (`extra.voucherManager` `"facilitator"` with a non-zero `extra.refundAuthorizer`), whose channel salt packs entropy and the refund authorizer, the deposit authorization's salt (`erc3009Authorization.salt`) or the Permit2 deposit's nonce, which is H.

**What it proves:** The payer signed a token authorization for a deposit into an x402 batch-settlement channel whose identifier, the EIP-712 hash of the channel's configuration, commits to this ATR's hash as the configuration's salt, or, in the scheme's refund-authorizer mode, whose own salt is this ATR's hash. The token contract or Permit2 verified that signature when the channel contract collected the deposit, and the hash is on chain as the salt in the channel's ChannelCreated event, or in that mode in the deposit call. Each voucher in this channel signs a commitment to the channel, and so, outside that mode, to this ATR's hash. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/batch-settlement/solana`

**Where H rides:** the seller's Memo instruction in the channel's opening, H's LCP string, next to the scheme's own receiver-authorizer memo. The seller writes H into the option's `extra.memo`.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose seller Memo instruction (`extra.memo`), beside the scheme's receiver-authorizer memo, is the hash's LCP string, final at `finalized` with no error, which deposited the amount its `open` names into a payment channel whose distribution pays the option's payee more than nothing, recorded with its mint and each account's share of the amount as the program pays it out. The memo is in the transaction's instruction data on chain. It compares no amount, mint or time with the ATR's terms.

### `x402/exact/algorand`

**Where H rides:** the asset transfer's `note`: H's LCP string, the 77 ASCII bytes `lcp:sha256:` and H in 0x lowercase hex, all of H.

**What it proves:** The payer's account authorized an Algorand asset transfer whose note is this ATR's hash in LCP string form, with a key's signature, a multisignature or a Falcon signature, by the account's own key or the key it is rekeyed to; a logic signature, or a transfer that names an asset sender, is no such act. The ledger verified that authorization when it confirmed the transaction, which is final on confirmation, and the note is on chain in it. Where the transfer moved an amount, zero included, the payer paid it to the account the transfer names (`arcv`). As an agreement, it shows that this account signed the transfer carrying the hash. It does not show that amount, asset or timing match the ATR's content.

### `x402/exact/aptos`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this payment was taken, an account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>; this shows neither that the account is the payer nor what the agreement moved. The ATR was assembled before the challenge went out, and the challenge advertised its hash and link. The payer's signed Aptos transaction does not carry the hash. The resource server tied the hash to this payment when it recorded the hash for this request, and the read identified the payment as the sender's committed transaction at its signed sequence number, signed by an account other than the option's payee and depositing to a store the payee owns. What it moved is recorded as observed: this does not show that amount, asset or timing match the ATR's content.

### `x402/exact/cardano`

**Where H rides:** CIP-20 metadata, label 674, holding H's LCP string, to which the signed body's auxiliary-data hash (key 7) commits; all of H.

**What it proves:** The payer, the payment credential that holds the input the payment names, signed a Cardano transaction whose body commits through its auxiliary_data_hash to a CIP-20 message (label 674) carrying this ATR's hash, and the ledger included it as valid at the mark read. It paid: the read names each output it created, to which payment credential and in what asset and amount, as observed, and on a payment one output reached the payee's payment credential. A transaction with fewer confirmations than the ledger's security parameter (2160 on mainnet) can be rolled back. The read compares no amount, asset or time with the ATR's terms.

### `x402/exact/cardano/lock`

**Where H rides:** CIP-20 metadata, label 674, holding H's LCP string, to which the signed body's auxiliary-data hash (key 7) commits; all of H.

**What it proves:** The payer, the payment credential that holds the input the payment names, signed a Cardano transaction whose body commits through its auxiliary_data_hash to a CIP-20 message (label 674) carrying this ATR's hash, and the ledger included it as valid at the mark read. It deposited into a contract: the read names each output it created, as observed, and on a Masumi lock the beneficiary its escrow datum names. A deposit is a charge and never an agreement. The read compares no amount, asset or time with the ATR's terms.

### `x402/exact/casper`

**Where H rides:** the CEP-3009 authorization's 32-byte `nonce`, which is H, signed by `from`; on an agreement, the agreement's own value, SHA-256 over the ASCII bytes `lcp-agreement-v1` and H.

**What it proves:** The payer's own signed CEP-3009 authorization carries this ATR's hash as its nonce (on an agreement, the agreement's value of it), which the token contract verified with the payer's key when it executed the call. It paid the account its `to` names the amount its `value` states, zero included: on a payment, the option's `payTo`. This does not show that the amount, the asset or the timing match the ATR's content.

### `x402/exact/ccd`

**Where H rides:** the transfer's memo, H's LCP string, in the account transaction the sender signs; all of H.

**What it proves:** The payer signed a Concordium transaction one of whose transfers carries this ATR's hash, in LCP string form, as its memo. The chain accepted the transaction only with the sender's valid signature, and the memo is on chain in the finalized transfer event. Where the transfer moved an amount, zero included, the payer paid it to the account the transfer names. It does not show that amount, token or timing match the ATR's content.

### `x402/exact/eip155/eip3009`

**Where H rides:** the EIP-3009 `nonce`, which is H, all of H; for the act `agreement`, the tagged digest over the agreement tag and H.

**What it proves:** The payer signed an EIP-3009 transfer authorization whose nonce is this ATR's hash, or for an agreement the agreement's value of it. The token contract verified that signature when it executed the transfer, and the hash is on chain as the nonce topic of its AuthorizationUsed event in the settlement transaction. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/eip155/erc7710`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this payment was taken, an account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>; this shows neither that the account is the payer nor what the agreement moved. The ATR was assembled and delivered before the payment, and the payment payload echoed this ATR's hash in the legalContext entry of x402's extensions. The read found the named settlement transaction, after the agreement's position, holding a transfer from the payment's delegator to the payee. The delegation does not sign the hash, and the settlement transaction does not carry it.

### `x402/exact/eip155/erc7710-salt`

**Where H rides:** the leaf delegation's `salt`, which is H, all of H, through the reference manager on a chain of its list.

**What it proves:** The leaf delegation of the permission context redeemed for this payment, made through MetaMask's DelegationManager, carries this ATR's hash as its signed salt. The manager verified every delegation's signature when it redeemed them, and the leaf, with its salt, is in a RedeemedDelegation event in the settlement transaction. The leaf's signer is its delegator, which may be an account the paying account authorised rather than the paying account itself. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/eip155/gateway-batched`

**Where H rides:** the nonce of the `TransferWithAuthorization` signed in Circle Gateway's `GatewayWalletBatched` domain, which is H, all of H; no public ledger shows it.

**What it proves:** Before this payment was reported, an account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>; this shows neither that the account is the payer nor when the payment was taken. The payment presented was a Circle Gateway batched authorization whose nonce is this ATR's hash, signed under the Gateway Wallet's domain; no public ledger records it, since a batch carries each depositor's net change and no payment's nonce, and Circle's transfers API listing it by its nonce is Circle's statement, not a ledger's. The seller reported it paid. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/eip155/permit2`

**Where H rides:** the Permit2 `nonce`, which is H, all of H; for the act `agreement`, the tagged digest over the agreement tag and H.

**What it proves:** The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, or for an agreement the agreement's value of it, with the scheme's x402 proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show that amount, payee, asset or timing match the ATR's content.

### `x402/exact/hedera`

**Where H rides:** the memo of the transfer body the buyer signs: H's LCP string (77 bytes), all of H, in lowercase hex.

**What it proves:** The payer's own signed act carries this ATR's hash: a Hedera crypto transfer whose memo is the hash's LCP string reached consensus with SUCCESS, debiting the payer, the one account its rows debit, and paid the account it credits, recorded with the asset and amount it moved. The memo is in the public transaction record, readable by transaction id. It compares no amount, asset or time with the ATR's terms.

### `x402/exact/hedera/transfer-executor`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this payment was taken, an account signed an agreement carrying this ATR's hash on <network>, recorded in <transaction>; this does not show that the account is the payer. The payment is an x402 transferExecutor payment on Hedera: the payer's executor contract moved the funds under an authorization the seller did not read, and the facilitator submitted the transaction. The hash reached the payer only in the challenge's extension, and nothing the payer signed carries it. The read of the named transaction's merged consensus record found that its one debited account is the payer recorded when the payment was presented, and that it credited the payee. It compares no amount, asset or time with the ATR's terms.

### `x402/exact/lnbtc/payment-hash`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** An account signed an agreement transaction carrying this ATR's hash on <network>, recorded in <transaction>, before this payment was taken or reported. This shows neither that the account is this payment's payer nor when this payment was taken, which nothing here reads. The ATR commits the payment hash of the BOLT11 invoice paid, whose signer is held to the option's payTo; the payer signed nothing that carries the hash. The preimage, which every node on the payment's route learns, shows that the secret behind the hash left the seller's custody, never who paid, and to anyone but the seller's node not that the invoice was paid; no public ledger shows the payment. Settlement is the seller's report. This does not show that amount, payee or timing match the ATR's content.

### `x402/exact/near`

**Where H rides:** the `memo` argument of the one `ft_transfer`, H's LCP string, inside the NEP-366 delegate action the payer signs; all of H.

**What it proves:** Paid: the payer's account signed a NEP-366 delegate action whose one ft_transfer carries this ATR's hash in its memo, in LCP string form, so the payer's own signed act carries the hash. The runtime verified that signature and ran the delegate, and the transfer succeeded on the token contract the delegate names, reaching the account its receiver_id names, both as read. The signer is the delegate's sender, named apart from any other act's. This states nothing of the amount, nor that the token, the account reached or the time meet a term of the ATR.

### `x402/exact/polkadot/lcp-assets-remark`

**Where H rides:** `system.remark_with_event` of H's LCP string, batched with the transfer in `utility.batch_all`, inside the extrinsic the payer signs.

**What it proves:** The payer signed one Polkadot Asset Hub extrinsic whose bytes hold this ATR's hash in LCP string form as a remark, at the account nonce its reference holds, or an account acting for the payer through a `proxy.proxy` or `multisig.as_multi_threshold_1` wrapper signed one. The chain verified the signature and dispatched the extrinsic with a Remarked event for that remark, at the finality recorded. Where the record shows a transfer event from the payer, or the call is a transfer of zero that runs as the payer, it states that the extrinsic paid, with each recipient and what moved; where it shows neither, it states that the payer signed. The signer is named, with the wrapper as its authority where it acted for the payer. This does not show that amount, asset or timing match the ATR's content.

### `x402/exact/solana`

**Where H rides:** one Memo instruction, H's LCP string, in the transaction the buyer and the fee payer sign; all of H. The seller writes H into the option's `extra.memo`.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose one LCP-form Memo instruction is the hash's LCP string, final at `finalized` with no error. It paid each transfer it made from the buyer's account, recorded with its mint or lamports, amount and recipient, one of zero included, the recipient being the owner the transaction's token balances name; as a payment, one of them reached an account the option's payee owns. The memo is in the transaction's instruction data on chain. It compares no amount, mint or time with the ATR's terms.

### `x402/exact/starknet`

**Where H rides:** the SNIP-9 outside execution's `Nonce`: H's low 250 bits as a felt; on an agreement, the low 250 bits of the agreement's own value, SHA-256 over the ASCII bytes `lcp-agreement-v1` and H.

**What it proves:** The payer's own signed SNIP-9 outside execution carries the low 250 bits of this ATR's hash as its nonce (on an agreement, of the agreement's value of it), which the payer's account verified when it executed it. It paid the account each `Transfer` from the payer, or a transfer call of zero, names the amount it states, zero included: on a payment, the option's `payTo` among them; where the read observed no transfer, the payer signed it. A holder of the ATR confirms the hash's low 250 bits from the nonce; the chain holds no more of it. This does not show that the amount, the asset or the timing match the ATR's content.

### `x402/exact/stellar/precondition`

**Where H rides:** the transaction's `PRECOND_V2` extra signer `SIGNER_KEY_TYPE_ED25519_SIGNED_PAYLOAD`: the buyer's key and the 40-byte payload of H and the nonce of the buyer's Soroban authorization entry, an `int64` big-endian, on the transaction carrying that authorization of `transfer(buyer, payTo, amount)`; all of H.

**What it proves:** Signed: the buyer's account signed a Soroban authorization of a transfer and the 40-byte payload of this ATR's hash and that authorization's nonce, carried as a signed-payload precondition of the transaction that consumed it, so the buyer's own signed act carries the hash. The transaction succeeded on the asset contract its event names; where the transfer moved a nonzero amount, it paid the account the event's to names. This states nothing of the amount, nor that the asset, the account reached or the time meet a term of the ATR.

### `x402/exact/sui`

**Where H rides:** one `Pure` input, H's 32 bytes, that no command uses, inside the transaction data the sender signs.

**What it proves:** The payer, the sender, signed a Sui transaction whose one unused Pure input is this ATR's hash, and the network executed it successfully in a checkpoint after the position the read was given; the hash is on chain in its input list, readable by its digest while a node retains it. The sender is not the option's payee. Where the transaction moved value it paid each account a positive balance change names; where it moved nothing it was signed, naming the recipient its signed transfer names. What it moved is recorded as observed: this does not show that amount, coin type or timing match the ATR's content.

### `x402/exact/tron/lcp-trc20-memo`

**Where H rides:** `raw_data.data`: H's 77-byte LCP string, signed with the one `TriggerSmartContract`.

**What it proves:** The payer, the transaction's owner, signed a Tron transaction whose memo is this ATR's hash in LCP string form, and whose one contract calls transfer on the token. The network verified the signature, which covers the memo through the transaction id, and the receipt's result is SUCCESS, at the finality recorded. Where the receipt holds Transfer logs from the owner, the transaction paid, with each recipient and what moved; where it holds no Transfer log and the signed call is a transfer of zero, it paid zero to that call's recipient; where it holds neither, the payer signed, and no account is named. The owner is named as the signer, and its Permission_id as the authority. This does not show that amount, token or timing match the ATR's content.

### `x402/exact/tvm`

**Where H rides:** the forward payload's comment cell, in the Jetton transfer the payer's W5 wallet signs. The seller writes H into the option's `extra.forwardPayload`.

**What it proves:** The payer's W5 wallet signed a request whose one Jetton transfer carries this ATR's hash in its forward payload, as a TEP-74 text comment in LCP string form, and ran it: the payer's own signed act carries the hash. The W5 wallet paid, through its Jetton wallet, the amount the `internal_transfer` names, zero included, to the Jetton wallet that took it, the recipient; where the read observed no transfer, the W5 wallet signed. The signer is the W5 wallet, named apart from the recipient. This does not show that the amount, the Jetton, the payee or the time match the ATR's content.

### `x402/exact/xrpl`

**Where H rides:** the Payment's `InvoiceID`, the SHA-256 of H's LCP string. The seller writes H into the option's `extra.invoiceId`.

**What it proves:** The payer signed an XRPL Payment whose InvoiceID is the SHA-256 of this ATR's hash in LCP string form, and it is in a validated ledger with tesSUCCESS: it paid the amount meta.delivered_amount states to the account its Destination names. The hash can be confirmed from the ATR's bytes but not recovered from the ledger alone. This does not show that amount, destination, asset or timing match the ATR's content.

### `x402/upto/eip155/permit2`

**Where H rides:** the Permit2 `nonce`, which is H, written in decimal.

**What it proves:** The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show that amount, payee, asset or timing match the ATR's content. The amount settled is the seller's, submitted by the facilitator the witness names, and at most the signed maximum.

### `x402/upto/solana`

**Where H rides:** the Memo of the open that escrows the signed maximum in a one-request channel; H's LCP string, all of H. The seller writes H into the option's `extra.memo`.

**What it proves:** The payer's own signed act carries this ATR's hash: a Solana transaction the buyer's account signed, whose one Memo instruction is the hash's LCP string, final at `finalized` with no error, which deposited the amount its `open` names into a payment channel whose distribution pays the option's payee more than nothing, recorded with its mint and each account's share of the amount as the program pays it out. The memo is in the transaction's instruction data on chain. The deposit is the signed maximum a one-request channel escrows; the amount charged from it, which may be zero, is the seller's metering, settled in a later transaction that does not carry the hash, and the rest returns to the payer. It compares no amount, mint or time with the ATR's terms.

### `x402/upto/xrpl`

**Where H rides:** nothing the payer signs carries H.

**What it proves:** Before this payment, an account signed an agreement transaction carrying this ATR's hash on the payment's XRPL network. The channel's create is in a validated ledger with tesSUCCESS: the account the payment's payer names deposited the create's Amount into the channel the payment names, whose beneficiary is the account its Destination names, after the ledger the agreement was recorded at. The create does not carry the hash, and this does not show that the account that signed the agreement is the one that opened the channel unless the record compares the two. The claim that closes the channel signs the channel id and an amount, not the hash, and is not read. This does not show that amount, deposit, destination, settle delay or timing match the ATR's content.

