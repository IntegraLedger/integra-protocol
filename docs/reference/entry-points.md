---
title: Entry points
description: Every entry point of @integraledger/lcp and what it exports.
---

# Entry points

This page is generated from the package by `node scripts/docs-reference.mjs`, and CI checks that it matches.

Import each entry point by its subpath. Every entry point is ESM with its own type declarations. The [API reference](./api/index.md) gives each export's signature, and its doc comment where it has one.

| Entry point | What it holds |
|---|---|
| [`@integraledger/lcp`](#integraledgerlcp) | The package root of `@integraledger/lcp`: the core functions of `@integraledger/lcp/core`, the registry of every pairing (`BINDINGS`, `pairingOf`) and its types, and the return after an agreement. |
| [`@integraledger/lcp/a2a`](#integraledgerlcpa2a) | The LCP extension for A2A: the ATR hash and the link to the seller's copy delivered in a Task's `metadata`, keyed by the extension's URI. A2A signs nothing per transaction, so this is a carrier and exports no pairing. Pure; no I/O. |
| [`@integraledger/lcp/ack`](#integraledgerlcpack) | ACK Payment Requests and receipts, and the pairing `ack/payment-request`: the ATR hash as the `id` of the seller-signed Payment Request, in LCP's string form, with the link beside the request in the 402 body. |
| [`@integraledger/lcp/acp`](#integraledgerlcpacp) | ACP checkout sessions and delegate-payment allowances, and the pairings `acp/checkout/delegated` and `acp/checkout/undelegated`: the ATR hash as the checkout session's `id`. |
| [`@integraledger/lcp/ap2`](#integraledgerlcpap2) | AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the `legalContext` member of the merchant-signed `checkout_jwt` payload, which the buyer's closed Checkout Mandate commits to through `checkout_hash`. |
| [`@integraledger/lcp/aptos`](#integraledgerlcpaptos) | Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer carries the ATR hash, so the hash is advertised in the challenge and tied to the payment by the seller's claim. |
| [`@integraledger/lcp/avm`](#integraledgerlcpavm) | Algorand: the pairing `x402/exact/algorand`, in which the payer signs an asset transfer whose note is the ATR hash's LCP string, and the settlement read from an Indexer by the transaction id computed from the signed bytes. |
| [`@integraledger/lcp/card`](#integraledgerlcpcard) | The `card` entry point: the ATR hash on a card checkout, on five paths: Visa TAP, Mastercard Agent Pay, Visa Intelligent Commerce, Mastercard Verifiable Intent (Immediate and Autonomous) and the plain card checkout. |
| [`@integraledger/lcp/cardano`](#integraledgerlcpcardano) | Cardano, and its two pairings: `x402/exact/cardano`, x402's address-to-address method, and `x402/exact/cardano/lock`, its two lock methods (`masumi` and `script`). Each carries the ATR hash as a CIP-20 message that the payer's signed body commits to. |
| [`@integraledger/lcp/casper`](#integraledgerlcpcasper) | CEP-3009 on Casper and the `x402/exact/casper` pairing: the ATR hash as the authorization's 32-byte `nonce`, written by the buyer's signer, read back from what the payer signed, and read from the executed call's arguments. |
| [`@integraledger/lcp/ccd`](#integraledgerlcpccd) | Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer event. |
| [`@integraledger/lcp/core`](#integraledgerlcpcore) | The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's forms, the https-link rule, the JSON and base64 forms they read and write, `isRefusal` and `readToRepeat`, with no pairing, rail or optional peer. |
| [`@integraledger/lcp/discovery`](#integraledgerlcpdiscovery) | The discovery document of LCP §2, served at `/.well-known/legal-context.json`: `parse` reads one, and `emit` writes one. |
| [`@integraledger/lcp/evm`](#integraledgerlcpevm) | eip155 rail pieces: EIP-3009 and Permit2 typed data, the settlement read from a token's events, the read of a signed pull authorization's use, ERC-7710 permission contexts, the commerce-payments escrow's pieces, and x402's Permit2 proxy addresses. |
| [`@integraledger/lcp/hedera`](#integraledgerlcphedera) | Hedera: the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only), with the transaction wire form and the Mirror Node settlement read. |
| [`@integraledger/lcp/lightning`](#integraledgerlcplightning) | BOLT11 invoices and the Lightning pairings: on x402 (`x402/exact/lnbtc/payment-hash`) the ATR commits the option's `extra.paymentHash`, and on MPP the seller's node writes the ATR hash as the invoice's description hash `h`. |
| [`@integraledger/lcp/mpp`](#integraledgerlcpmpp) | The `mpp` entry point: MPP's challenge pieces, its three fields (`encodeChallenge` writes a `WWW-Authenticate` value, `encodeCredential` and `decodeCredential` write and read an `Authorization` value, `encodeReceipt` and `decodeReceipt` write and read a `Payment-Receipt` value) and its pairings: the EVM charges, defined here, and every other MPP charge, session and subscription pairing but Lightning's, re-exported from its module. |
| [`@integraledger/lcp/near`](#integraledgerlcpnear) | NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it. |
| [`@integraledger/lcp/polkadot`](#integraledgerlcppolkadot) | Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one extrinsic that transfers an asset and remarks the ATR hash's LCP string. |
| [`@integraledger/lcp/spend-permissions`](#integraledgerlcpspend-permissions) | The Spend Permission exchange and the pairing `spend-permissions/eip155`: an account's approval, on the SpendPermissionManager, of a Spend Permission whose `salt` is the ATR hash, as the sale's agreement. |
| [`@integraledger/lcp/stacks`](#integraledgerlcpstacks) | Stacks rail pieces: the transaction id, the reader a read goes through, the read of a payment by its origin and the nonce the origin signed, and the zero-party recovery of the ATR hash from a mined transaction. |
| [`@integraledger/lcp/starknet`](#integraledgerlcpstarknet) | Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing one token `transfer`; its `Nonce` is the ATR hash's low 250 bits, or on an agreement the agreement value's. |
| [`@integraledger/lcp/stellar`](#integraledgerlcpstellar) | Stellar rail pieces: the payer-signed Soroban `transfer` and the digest of its authorization entry, the signed-payload precondition over H, the search for a buyer's acts, and the read of the agreement `x402/exact/stellar/precondition`. |
| [`@integraledger/lcp/sui`](#integraledgerlcpsui) | Sui, and the `x402/exact/sui` pairing: the ATR hash as the one `Pure` input of the payer's programmable transaction that no command uses. |
| [`@integraledger/lcp/svm`](#integraledgerlcpsvm) | Solana rail pieces: the wire transaction and its one Memo instruction carrying the ATR hash in LCP string form, the settlement read, and the payment-channels program's pieces. |
| [`@integraledger/lcp/tempo`](#integraledgerlcptempo) | Tempo rail pieces: the `0x76` transaction's calls, the TIP-20 `transferWithMemo` calldata, the TIP-20 channel reserve's descriptor and ids, and the account keychain's key authorizations. |
| [`@integraledger/lcp/tron`](#integraledgerlcptron) | Tron: the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its memo, `raw_data.data`, in LCP string form, and the transaction pieces it uses. |
| [`@integraledger/lcp/tvm`](#integraledgerlcptvm) | TON: the pairing `x402/exact/tvm`. The ATR hash rides in the scheme's `extra.forwardPayload` as a TEP-74 text comment holding its LCP string. |
| [`@integraledger/lcp/ucp`](#integraledgerlcpucp) | UCP checkouts and bookings, and five pairings, each of which carries the ATR hash and link as one `links[]` entry of type `legal_context` in the checkout response. |
| [`@integraledger/lcp/x402`](#integraledgerlcpx402) | x402 v2 documents, the request commitment, and the x402 pairings on eip155 chains: `exact` over EIP-3009, Permit2 and ERC-7710 (with its salt level), `upto` over Permit2, `auth-capture` over EIP-3009 and Permit2, and `exact` in Circle Gateway's batched domain. |
| [`@integraledger/lcp/x402-batch-settlement`](#integraledgerlcpx402-batch-settlement) | x402 `batch-settlement`: one ATR per channel, its hash the EVM channel configuration's `salt`, the Solana opening transaction's seller Memo instruction, or, on Cloudflare, the echoed `extensions.legalContext` of each request. |
| [`@integraledger/lcp/x402-exact-solana`](#integraledgerlcpx402-exact-solana) | The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement. |
| [`@integraledger/lcp/x402-exact-stellar`](#integraledgerlcpx402-exact-stellar) | Stellar on x402: the pairing `x402/exact/stellar/precondition` (`exactStellarPrecondition`), an agreement in which the buyer signs a Soroban authorization of `transfer(buyer, payTo, amount)` and a 40-byte payload of H and that authorization's nonce. |
| [`@integraledger/lcp/x402-exact-xrpl`](#integraledgerlcpx402-exact-xrpl) | The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the payer signs as the Payment's `InvoiceID`. |
| [`@integraledger/lcp/x402-upto-solana`](#integraledgerlcpx402-upto-solana) | The `x402/upto/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the one Memo instruction of the transaction that opens a one-request payment channel. |
| [`@integraledger/lcp/x402-upto-xrpl`](#integraledgerlcpx402-upto-xrpl) | The `x402/upto/xrpl` pairing: x402's `upto` scheme on the XRP Ledger, at coverage `none`, its payment following an agreement on the same network. |
| [`@integraledger/lcp/xrpl`](#integraledgerlcpxrpl) | XRP Ledger rail pieces: the signed blob, its `InvoiceID` or memo carrying the ATR hash in each scheme's form, the transaction hash computed from the blob, the reads of a payment, an opening, a channel and a close through a bounded reader, and the payment channel's id and claim. |

## `@integraledger/lcp`

The package root of `@integraledger/lcp`: the core functions of `@integraledger/lcp/core`, the registry of every pairing (`BINDINGS`, `pairingOf`) and its types, and the return after an agreement.

```ts no-check
import { agreementValue, assemble, base64Bytes, … } from "@integraledger/lcp";
```

**Values (52):** `agreementValue`, `assemble`, `base64Bytes`, `base64UrlBytes`, `BINDINGS`, `canonicalJson`, `challengeH`, `challengeHash`, `challengeId`, `checkLegalContextReturn`, `digestJson`, `domainToAscii`, `FETCHED`, `fromBase64`, `fromBase64Url`, `fromLcpString`, `fromLegalContext`, `fromLegalContextHeader`, `fromRawBytes`, `hash`, `hashEquals`, `isHttpsLink`, `isOtherSchemeLink`, `isRefusal`, `LEGAL_CONTEXT_HEADER`, `LEGAL_CONTEXT_META`, `LEGAL_CONTEXT_SERVES`, `MAX_ATR_BYTES`, `MAX_CHALLENGE_DEPTH`, `MAX_CHALLENGES`, `MAX_CREDENTIAL_BYTES`, `MAX_HEADER_BYTES`, `MAX_JSON_DEPTH`, `MAX_LINK_LENGTH`, `MAX_OPTIONS`, `MAX_REQUEST_BYTES`, `MAX_SIGNATURE_BYTES`, `MAX_SLOT_NAME_LENGTH`, `newAtrId`, `pairingOf`, `parseHost`, `parseJson`, `readToRepeat`, `readUrl`, `RETURN_VALUE_BYTES`, `servesOf`, `toBase64`, `toBase64Url`, `toLcpString`, `toLegalContext`, `toLegalContextHeader`, `toRawBytes`.

**Types (73):** `Act`, `AgreementData`, `AptosPaymentPayload`, `AtrHash`, `Authorizer`, `AvmPaymentPayload`, `BatchPaymentPayload`, `Binding`, `Broadcaster`, `CardanoPaymentPayload`, `Carrier`, `CarrierAfterH`, `CasperPaymentPayload`, `CcdPaymentPayload`, `ChannelKind`, `CloudflarePaymentPayload`, `Codec`, `CoreRefusal`, `Coverage`, `DataMembers`, `EndpointKind`, `Entry`, `ExecutorPayload`, `ExecutorPaymentPayload`, `FailedReason`, `Family`, `FeeParty`, `FeePayer`, `ForeignItem`, `ForeignReason`, `HederaPayload`, `HederaPaymentPayload`, `IsNever`, `Json`, `LcpPattern`, `LegalContextRecord`, `LegalContextReturn`, `Life`, `Moved`, `MppBinding`, `Named`, `NearPayment`, `NoneWhereNever`, `NonZeroDigit`, `OtherAct`, `PairingData`, `PairingId`, `PairingOn`, `PendingReason`, `PolkadotPayload`, `PolkadotPaymentPayload`, `Presented`, `PresentedOn`, `PushMode`, `ReadData`, `RecoverInput`, `Refusal`, `StarknetPayment`, `StatusAnswer`, `StatusQuery`, `StellarPaymentPayload`, `SuiPaymentPayload`, `Surface`, `SurfaceOf`, `SvmPaymentPayload`, `TronPayment`, `TvmPayment`, `UnreadableReason`, `UptoSvmPaymentPayload`, `UrlAuthority`, `X402Binding`, `X402Payment`, `XrplPaymentPayload`.

## `@integraledger/lcp/a2a`

The LCP extension for A2A: the ATR hash and the link to the seller's copy delivered in a Task's `metadata`, keyed by the extension's URI. A2A signs nothing per transaction, so this is a carrier and exports no pairing. Pure; no I/O.

```ts no-check
import { A2A_EXTENSION_URIS, agentExtension, binding, … } from "@integraledger/lcp/a2a";
```

**Values (7):** `A2A_EXTENSION_URIS`, `agentExtension`, `binding`, `delivery`, `place`, `read`, `requested`.

**Types (2):** `A2aAgentExtension`, `A2aTask`.

## `@integraledger/lcp/ack`

ACK Payment Requests and receipts, and the pairing `ack/payment-request`: the ATR hash as the `id` of the seller-signed Payment Request, in LCP's string form, with the link beside the request in the 402 body.

```ts no-check
import { fromReceipt, issuedDigest, paymentRequest, … } from "@integraledger/lcp/ack";
```

**Pairings:** `ack/payment-request`.

**Values (4):** `fromReceipt`, `issuedDigest`, `paymentRequest`, `tie`.

**Types (4):** `AckBody`, `AckPaymentOption`, `AckValues`, `Broadcaster`.

## `@integraledger/lcp/acp`

ACP checkout sessions and delegate-payment allowances, and the pairings `acp/checkout/delegated` and `acp/checkout/undelegated`: the ATR hash as the checkout session's `id`.

```ts no-check
import { delegated, issuedDigest, METADATA_KEY, … } from "@integraledger/lcp/acp";
```

**Pairings:** `acp/checkout/delegated`, `acp/checkout/undelegated`.

**Values (5):** `delegated`, `issuedDigest`, `METADATA_KEY`, `tie`, `undelegated`.

**Types (10):** `AcpBinding`, `AcpChoice`, `Allowance`, `Broadcaster`, `ChargePresented`, `ChargeRef`, `HandlerOption`, `Presented`, `Session`, `Unsigned`.

## `@integraledger/lcp/ap2`

AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the `legalContext` member of the merchant-signed `checkout_jwt` payload, which the buyer's closed Checkout Mandate commits to through `checkout_hash`.

```ts no-check
import { CHECKOUT_VCT, checkoutBinding, checkoutJwtOf, … } from "@integraledger/lcp/ap2";
```

**Pairings:** `ap2/checkout-mandate`, `ap2/checkout-mandate/x402`.

**Values (9):** `CHECKOUT_VCT`, `checkoutBinding`, `checkoutJwtOf`, `checkoutMandate`, `checkoutMandateX402`, `issuedDigest`, `jwsPayload`, `readMandate`, `tie`.

**Types (15):** `Ap2Offer`, `Broadcaster`, `CheckoutOption`, `EvmMark`, `EvmQuery`, `Jws`, `MandateContent`, `Payload`, `Presented`, `Unsigned`, `X402Authorization`, `X402Bundle`, `X402Method`, `X402Presented`, `X402Ref`.

## `@integraledger/lcp/aptos`

Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer carries the ATR hash, so the hash is advertised in the challenge and tied to the payment by the seller's claim.

```ts no-check
import { aptosIdDigest, aptosStatus, committedInstrument, … } from "@integraledger/lcp/aptos";
```

**Pairings:** `x402/exact/aptos`.

**Values (7):** `aptosIdDigest`, `aptosStatus`, `committedInstrument`, `decodeAptosTx`, `exactAptos`, `MAX_APTOS_READ_ITEMS`, `MAX_APTOS_TX_BYTES`.

**Types (11):** `AptosAccount`, `AptosCommitted`, `AptosInstrument`, `AptosNetwork`, `AptosPaymentPayload`, `AptosReader`, `AptosRef`, `AptosStatus`, `AptosUnsigned`, `Broadcaster`, `X402Read`.

## `@integraledger/lcp/avm`

Algorand: the pairing `x402/exact/algorand`, in which the payer signs an asset transfer whose note is the ATR hash's LCP string, and the settlement read from an Indexer by the transaction id computed from the signed bytes.

```ts no-check
import { AVM_MAX_ENTRY, AVM_MAX_GROUP, AVM_MAX_LIFE, … } from "@integraledger/lcp/avm";
```

**Pairings:** `x402/exact/algorand`.

**Values (10):** `AVM_MAX_ENTRY`, `AVM_MAX_GROUP`, `AVM_MAX_LIFE`, `AVM_MAX_NOTE`, `AVM_SEARCH_PAGES`, `avmCarrier`, `avmRecover`, `avmStatus`, `exactAvm`, `MSGPACK_MAX_DEPTH`.

**Types (15):** `AlgorandNetwork`, `AvmAssetTransfer`, `AvmIndexed`, `AvmPage`, `AvmParams`, `AvmPaymentPayload`, `AvmPresented`, `AvmReader`, `AvmRef`, `AvmSearch`, `AvmStatus`, `AvmUnsigned`, `Broadcaster`, `X402Payment`, `X402Read`.

## `@integraledger/lcp/card`

The `card` entry point: the ATR hash on a card checkout, on five paths: Visa TAP, Mastercard Agent Pay, Visa Intelligent Commerce, Mastercard Verifiable Intent (Immediate and Autonomous) and the plain card checkout.

```ts no-check
import { agentPay, disclosureDigest, issuedDigest, … } from "@integraledger/lcp/card";
```

**Pairings:** `card/mastercard-agent-pay`, `card/mastercard-vi/autonomous`, `card/mastercard-vi/immediate`, `card/seller-reference`, `card/visa-tap`, `card/visa-vic`.

**Values (18):** `agentPay`, `disclosureDigest`, `issuedDigest`, `MAX_CHARGE_REFERENCE`, `MAX_CHECKOUT_ID`, `MAX_CHECKOUT_JWT`, `MAX_TAP_COMPONENTS`, `MAX_TAP_FIELD`, `MAX_TAP_MEMBERS`, `MAX_TAP_PATH`, `MAX_VI_DISCLOSURES`, `MAX_VI_LAYER`, `sellerReference`, `tie`, `viAutonomous`, `viImmediate`, `visaTap`, `visaVic`.

**Types (17):** `Broadcaster`, `CardOption`, `CardPairing`, `CardPairingId`, `CardScheme`, `CardValues`, `ChargePresented`, `ChargeRef`, `TapPresented`, `TapUnsigned`, `ViAutonomous`, `ViCheckoutChoice`, `ViCheckoutUnsigned`, `VicPresented`, `VicUnsigned`, `ViImmediate`, `ViUnsigned`.

## `@integraledger/lcp/cardano`

Cardano, and its two pairings: `x402/exact/cardano`, x402's address-to-address method, and `x402/exact/cardano/lock`, its two lock methods (`masumi` and `script`). Each carries the ATR hash as a CIP-20 message that the payer's signed body commits to.

```ts no-check
import { auxiliaryData, CARDANO_MAX_TX_BYTES, CARDANO_SEARCH_BOUND, … } from "@integraledger/lcp/cardano";
```

**Pairings:** `x402/exact/cardano`, `x402/exact/cardano/lock`.

**Values (11):** `auxiliaryData`, `CARDANO_MAX_TX_BYTES`, `CARDANO_SEARCH_BOUND`, `cardanoFloor`, `cardanoInputs`, `cardanoRecover`, `cardanoStatus`, `decodeCardanoTx`, `exactCardano`, `exactCardanoLock`, `LCP_MARKER`.

**Types (15):** `Broadcaster`, `CardanoMethod`, `CardanoNetwork`, `CardanoOnChain`, `CardanoOutput`, `CardanoPage`, `CardanoPayload`, `CardanoPaymentPayload`, `CardanoQuery`, `CardanoReader`, `CardanoRef`, `CardanoStatus`, `CardanoTx`, `CardanoUnsigned`, `X402Read`.

## `@integraledger/lcp/casper`

CEP-3009 on Casper and the `x402/exact/casper` pairing: the ATR hash as the authorization's 32-byte `nonce`, written by the buyer's signer, read back from what the payer signed, and read from the executed call's arguments.

```ts no-check
import { CASPER_DOMAIN_TYPEHASH, CASPER_MAX_NAME_LENGTH, CASPER_MAX_PAGE_CALLS, … } from "@integraledger/lcp/casper";
```

**Pairings:** `x402/exact/casper`.

**Values (12):** `CASPER_DOMAIN_TYPEHASH`, `CASPER_MAX_NAME_LENGTH`, `CASPER_MAX_PAGE_CALLS`, `CASPER_MAX_PAGES`, `CASPER_MAX_PROBES`, `CASPER_MAX_PUBLIC_KEY_HEX`, `CASPER_MAX_SIGNATURE_HEX`, `casperIdDigest`, `casperRecover`, `casperStatus`, `cep3009TypedData`, `exactCasper`.

**Types (20):** `Broadcaster`, `CasperAddress`, `CasperAuthorization`, `CasperBlockCall`, `CasperBlockPage`, `CasperCall`, `CasperChoice`, `CasperCursor`, `CasperHead`, `CasperNetwork`, `CasperPaymentPayload`, `CasperReader`, `CasperRef`, `CasperRefRead`, `CasperStatus`, `CasperUnsigned`, `Cep3009TypedData`, `PackageHash`, `X402Advertise`, `X402Read`.

## `@integraledger/lcp/ccd`

Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer event.

```ts no-check
import { accountBytes, CCD_EXPIRY_MARGIN, CCD_MAX_ADDRESS, … } from "@integraledger/lcp/ccd";
```

**Pairings:** `x402/exact/ccd`.

**Values (13):** `accountBytes`, `CCD_EXPIRY_MARGIN`, `CCD_MAX_ADDRESS`, `CCD_MAX_MEMO`, `CCD_MAX_OPERATIONS`, `CCD_MAX_TRANSACTION`, `CCD_SEARCH_NUMBERS`, `ccdMemo`, `ccdRecover`, `ccdStatus`, `exactCcd`, `memoCarrier`, `pltMemo`.

**Types (15):** `Broadcaster`, `CcdBlockItem`, `CcdChoice`, `CcdItem`, `CcdMark`, `CcdNetwork`, `CcdPaymentPayload`, `CcdReader`, `CcdRef`, `CcdSearch`, `CcdStatus`, `CcdTransfer`, `CcdUnsigned`, `X402Advertise`, `X402Read`.

## `@integraledger/lcp/core`

The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's forms, the https-link rule, the JSON and base64 forms they read and write, `isRefusal` and `readToRepeat`, with no pairing, rail or optional peer.

```ts no-check
import { agreementValue, assemble, base64Bytes, … } from "@integraledger/lcp/core";
```

**Values (27):** `agreementValue`, `assemble`, `base64Bytes`, `base64UrlBytes`, `canonicalJson`, `digestJson`, `domainToAscii`, `fromBase64`, `fromBase64Url`, `fromLcpString`, `fromLegalContext`, `fromRawBytes`, `hash`, `hashEquals`, `isHttpsLink`, `isOtherSchemeLink`, `isRefusal`, `newAtrId`, `parseHost`, `parseJson`, `readToRepeat`, `readUrl`, `toBase64`, `toBase64Url`, `toLcpString`, `toLegalContext`, `toRawBytes`.

**Types (5):** `AtrHash`, `CoreRefusal`, `Json`, `Refusal`, `UrlAuthority`.

## `@integraledger/lcp/discovery`

The discovery document of LCP §2, served at `/.well-known/legal-context.json`: `parse` reads one, and `emit` writes one.

```ts no-check
import { emit, MAX_DOCUMENT_BYTES, parse, … } from "@integraledger/lcp/discovery";
```

**Values (4):** `emit`, `MAX_DOCUMENT_BYTES`, `parse`, `WELL_KNOWN_PATH`.

**Types (1):** `LegalContextDocument`.

## `@integraledger/lcp/evm`

eip155 rail pieces: EIP-3009 and Permit2 typed data, the settlement read from a token's events, the read of a signed pull authorization's use, ERC-7710 permission contexts, the commerce-payments escrow's pieces, and x402's Permit2 proxy addresses.

```ts no-check
import { AUTHORIZATION_CANCELED_TOPIC, AUTHORIZATION_STATE_SELECTOR, AUTHORIZATION_USED_TOPIC, … } from "@integraledger/lcp/evm";
```

**Values (31):** `AUTHORIZATION_CANCELED_TOPIC`, `AUTHORIZATION_STATE_SELECTOR`, `AUTHORIZATION_USED_TOPIC`, `authorizationIdDigest`, `authorizationUsed`, `bindSalt`, `decodePermissionContext`, `DELEGATION_MANAGER`, `DELEGATION_MANAGER_CHAINS`, `eip3009Recover`, `eip3009Status`, `eip3009TypedData`, `ESCROW`, `evmStatus`, `EXACT_PERMIT2_PROXY`, `MAX_SEARCH_PAGES`, `NONCE_BITMAP_SELECTOR`, `PAYMENT_AUTHORIZED_TOPIC`, `PAYMENT_INFO_TYPEHASH`, `paymentHash`, `PERMIT2`, `permit2TypedData`, `ReaderError`, `REDEEMED_DELEGATION_TOPIC`, `SALT_BINDING_TYPEHASH`, `SEARCH_PAGE_BLOCKS`, `TRANSFER_TOPIC`, `TRANSFER_WITH_AUTHORIZATION_TYPEHASH`, `transferDigest`, `UNORDERED_NONCE_INVALIDATION_TOPIC`, `UPTO_PERMIT2_PROXY`.

**Types (30):** `AuthCaptureRef`, `BatchEvmRef`, `Delegation`, `Eip155`, `Eip3009Ref`, `Eip3009TypedData`, `Erc7710Ref`, `EvmBreadthStatus`, `EvmLog`, `EvmLogEntry`, `EvmMark`, `EvmQuery`, `EvmReader`, `EvmReadRefBase`, `EvmReceipt`, `EvmRef`, `EvmStatus`, `EvmTransaction`, `EvmTxRef`, `Field`, `HederaNetwork`, `Hex`, `PaymentInfo`, `Permit2Ref`, `Permit2TypedData`, `PullAuthorization`, `Signed`, `TransferIdentity`, `TransferLog`, `X402EvmRefBase`.

## `@integraledger/lcp/hedera`

Hedera: the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only), with the transaction wire form and the Mirror Node settlement read.

```ts no-check
import { CHANNEL_CLOSED_TOPIC, CHANNEL_OPENED_TOPIC, decodeHederaTx, … } from "@integraledger/lcp/hedera";
```

**Pairings:** `x402/exact/hedera`, `x402/exact/hedera/transfer-executor`.

**Values (13):** `CHANNEL_CLOSED_TOPIC`, `CHANNEL_OPENED_TOPIC`, `decodeHederaTx`, `exactHedera`, `exactHederaExecutor`, `executorStatus`, `FETCHED`, `hederaChannelId`, `hederaIdDigest`, `hederaStatus`, `hederaVoucher`, `txIdMirror`, `txIdText`.

**Types (23):** `Broadcaster`, `ExecutorPayload`, `ExecutorPaymentPayload`, `ExecutorRef`, `HederaBody`, `HederaChannelConfig`, `HederaCloseRef`, `HederaNetwork`, `HederaPresented`, `HederaQuery`, `HederaReader`, `HederaRef`, `HederaRow`, `HederaStatus`, `HederaTransfer`, `HederaTxId`, `HederaUnsigned`, `HederaVoucherTypedData`, `MirrorEntry`, `MirrorPage`, `MirrorRow`, `X402Payment`, `X402Read`.

## `@integraledger/lcp/lightning`

BOLT11 invoices and the Lightning pairings: on x402 (`x402/exact/lnbtc/payment-hash`) the ATR commits the option's `extra.paymentHash`, and on MPP the seller's node writes the ATR hash as the invoice's description hash `h`.

```ts no-check
import { chargeLightning, checkPreimage, decodeBolt11, … } from "@integraledger/lcp/lightning";
```

**Pairings:** `mpp/charge/lightning`, `mpp/session/lightning`, `x402/exact/lnbtc/payment-hash`.

**Values (7):** `chargeLightning`, `checkPreimage`, `decodeBolt11`, `exactLnbtcPaymentHash`, `invoiceH`, `sessionLightning`, `validateExactLnbtc`.

**Types (15):** `Bolt11`, `Broadcaster`, `ExactLnbtcReason`, `ExactLnbtcValidation`, `LnbtcRequest`, `LnChoice`, `LnHeaderFields`, `LnMppChoice`, `LnMppUnsigned`, `LnNetwork`, `LnPaymentPayload`, `LnRef`, `LnUnsigned`, `X402Advertise`, `X402Read`.

## `@integraledger/lcp/mpp`

The `mpp` entry point: MPP's challenge pieces, its three fields (`encodeChallenge` writes a `WWW-Authenticate` value, `encodeCredential` and `decodeCredential` write and read an `Authorization` value, `encodeReceipt` and `decodeReceipt` write and read a `Payment-Receipt` value) and its pairings: the EVM charges, defined here, and every other MPP charge, session and subscription pairing but Lightning's, re-exported from its module.

```ts no-check
import { attributionMemo, CARRIER, challengeBound, … } from "@integraledger/lcp/mpp";
```

**Pairings:** `mpp/charge/card`, `mpp/charge/evm/authorization`, `mpp/charge/evm/hash`, `mpp/charge/evm/permit2`, `mpp/charge/evm/transaction`, `mpp/charge/lcp/hedera`, `mpp/charge/nearintents`, `mpp/charge/solana`, `mpp/charge/solana/unsponsored`, `mpp/charge/stripe`, `mpp/charge/tempo/split-memo`, `mpp/charge/tempo/split-memo/push`, `mpp/charge/usdc/evm`, `mpp/charge/usdc/gateway`, `mpp/charge/usdc/solana`, `mpp/charge/usdc/stacks`, `mpp/charge/xrpl`, `mpp/session/evm`, `mpp/session/hedera/stock`, `mpp/session/solana/memo`, `mpp/session/solana/stock`, `mpp/session/tempo`, `mpp/session/xrpl`, `mpp/session/xrpl/stock`, `mpp/subscription/solana`, `mpp/subscription/stripe`, `mpp/subscription/tempo`.

**Values (62):** `attributionMemo`, `CARRIER`, `challengeBound`, `challengeH`, `challengeHash`, `challengeId`, `chargeCard`, `chargeLcpHedera`, `chargeNearIntents`, `chargeSolana`, `chargeSolanaUnsponsored`, `chargeStripe`, `chargeUsdcEvm`, `chargeUsdcGateway`, `chargeUsdcSolana`, `chargeUsdcStacks`, `chargeXrpl`, `checkAttribution`, `decodeCredential`, `decodeReceipt`, `encodeChallenge`, `encodeCredential`, `encodeReceipt`, `evmAuthorization`, `evmChannelId`, `evmHash`, `evmPermit2`, `evmSessionAuthorizationNonce`, `evmTransaction`, `FETCHED`, `hederaStockStatus`, `issuedDigest`, `keySearch`, `LEGAL_CONTEXT_METADATA_KEY`, `MPP_BINDINGS`, `network`, `pairingsOf`, `pairingsOfPlaced`, `parseChallenges`, `place`, `problem`, `read`, `sessionEvm`, `sessionHederaStock`, `sessionResume`, `sessionSolanaMemo`, `sessionSolanaStock`, `sessionStatus`, `sessionTempo`, `sessionXrpl`, `sessionXrplStock`, `subscriptionSolana`, `subscriptionStripe`, `subscriptionTempo`, `tempoSplitMemo`, `tempoSplitMemoPush`, `tie`, `toX402`, `transferPresent`, `usdcGatewaySalt`, `usdcNonce`, `usdcRequestHash`.

**Types (74):** `Broadcaster`, `ChannelKind`, `ChargeRefBase`, `EvmLogEntry`, `EvmMark`, `EvmMoved`, `EvmQuery`, `EvmSearchReader`, `GatewayChargeChoice`, `GatewayPreimage`, `GatewaySaltInput`, `HederaNetwork`, `HederaQuery`, `HederaSessionUnsigned`, `HederaStockReader`, `HederaStockRef`, `HederaStockStatus`, `HederaVoucherTypedData`, `LandedCredential`, `LcpHederaChoice`, `LcpHederaLanded`, `LcpHederaRef`, `LcpHederaUnsigned`, `LcpRail`, `LcpValidation`, `MppChallenge`, `MppChoice`, `MppCredential`, `MppEip3009Ref`, `MppEvmReader`, `MppEvmStatus`, `MppIntent`, `MppMethod`, `MppNamedRef`, `MppPairingId`, `MppPermit2Ref`, `MppReceipt`, `MppSessionOpeningRef`, `MppUnsigned`, `NearIntentsRef`, `Presentation`, `RailSessionChoice`, `RailSessionUnsigned`, `ReceiveTypedData`, `Seen`, `SessionChoice`, `SessionRef`, `SessionStatus`, `SessionUnsigned`, `SessionWithin`, `SessionWithinUnsigned`, `Signed`, `SolanaChargeChoice`, `SolanaChargeUnsigned`, `SolanaSessionChoice`, `SolanaSessionUnsigned`, `SolanaTablesCredential`, `StacksChargeChoice`, `StockQuery`, `StripeSubscriptionReceipt`, `TempoLandedCredential`, `TempoSplitLanded`, `TempoSplitQuery`, `TempoSplitRef`, `TempoSplitStatus`, `TokenDomain`, `UsdcUnsigned`, `VoucherTypedData`, `WithinSigningRequest`, `X402Mapped`, `XrplChargeChoice`, `XrplChargeUnsigned`, `XrplQuery`, `XrplSessionUnsigned`.

## `@integraledger/lcp/near`

NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it.

```ts no-check
import { exactNear, FT_TRANSFER_GAS, ftTransferArgs, … } from "@integraledger/lcp/near";
```

**Pairings:** `x402/exact/near`.

**Values (10):** `exactNear`, `FT_TRANSFER_GAS`, `ftTransferArgs`, `MAX_FT_TRANSFER_ARGS_BYTES`, `MAX_SIGNED_DELEGATE_BASE64`, `nearCarrier`, `nearRecover`, `nearRequest`, `nearStatus`, `NEP461_DELEGATE`.

**Types (17):** `Answer`, `Broadcaster`, `NearChoice`, `NearFunctionCall`, `NearKeyChange`, `NearKeyChanges`, `NearMark`, `NearNetwork`, `NearOutcome`, `NearPayment`, `NearQuery`, `NearReader`, `NearRef`, `NearStatus`, `NearUnsigned`, `X402Payment`, `X402Read`.

## `@integraledger/lcp/polkadot`

Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one extrinsic that transfers an asset and remarks the ATR hash's LCP string.

```ts no-check
import { CALL, decodeProfileCall, encodeProfileCall, … } from "@integraledger/lcp/polkadot";
```

**Pairings:** `x402/exact/polkadot/lcp-assets-remark`.

**Values (11):** `CALL`, `decodeProfileCall`, `encodeProfileCall`, `exactPolkadotRemark`, `extrinsicHash`, `LCP_ASSETS_REMARK`, `POLKADOT_BOUNDS`, `polkadotRecover`, `polkadotStatus`, `splitSigned`, `ss58Decode`.

**Types (17):** `Broadcaster`, `PolkadotCursor`, `PolkadotEra`, `PolkadotExtrinsic`, `PolkadotLanded`, `PolkadotMark`, `PolkadotNetwork`, `PolkadotPayload`, `PolkadotPaymentPayload`, `PolkadotQuery`, `PolkadotReader`, `PolkadotRef`, `PolkadotStatus`, `PolkadotUnsigned`, `ProfileCall`, `X402Payment`, `X402Read`.

## `@integraledger/lcp/spend-permissions`

The Spend Permission exchange and the pairing `spend-permissions/eip155`: an account's approval, on the SpendPermissionManager, of a Spend Permission whose `salt` is the ATR hash, as the sale's agreement.

```ts no-check
import { APPROVE_SELECTOR, APPROVE_WITH_SIGNATURE_SELECTOR, approvedIn, … } from "@integraledger/lcp/spend-permissions";
```

**Pairings:** `spend-permissions/eip155`.

**Values (17):** `APPROVE_SELECTOR`, `APPROVE_WITH_SIGNATURE_SELECTOR`, `approvedIn`, `checkReturn`, `decodeSpendPermissionHeader`, `encodeSpendPermissionHeader`, `IS_APPROVED_SELECTOR`, `IS_REVOKED_SELECTOR`, `issuedDigest`, `permissionHash`, `SPEND_PERMISSION_APPROVED_TOPIC`, `SPEND_PERMISSION_DOMAIN`, `SPEND_PERMISSION_HEADER`, `SPEND_PERMISSION_REVOKED_TOPIC`, `SPEND_PERMISSION_TYPEHASH`, `spendPermissionsEip155`, `tie`.

**Types (16):** `Broadcaster`, `EvmMark`, `EvmQuery`, `EvmReadRefBase`, `OfferedPermission`, `SpendPermission`, `SpendPermissionBody`, `SpendPermissionChoice`, `SpendPermissionError`, `SpendPermissionOffer`, `SpendPermissionOfferInput`, `SpendPermissionRef`, `SpendPermissionReturn`, `SpendPermissionRoute`, `SpendPermissionTypedData`, `SpendPermissionUnsigned`.

## `@integraledger/lcp/stacks`

Stacks rail pieces: the transaction id, the reader a read goes through, the read of a payment by its origin and the nonce the origin signed, and the zero-party recovery of the ATR hash from a mined transaction.

```ts no-check
import { MAX_SEARCH_NONCES, MAX_STACKS_TX_BYTES, stacksRecover, … } from "@integraledger/lcp/stacks";
```

**Values (5):** `MAX_SEARCH_NONCES`, `MAX_STACKS_TX_BYTES`, `stacksRecover`, `stacksStatus`, `stacksTxid`.

**Types (11):** `StacksAssetEvent`, `StacksLanded`, `StacksListed`, `StacksMark`, `StacksMempool`, `StacksNetwork`, `StacksPage`, `StacksQuery`, `StacksReader`, `StacksRef`, `StacksStatus`.

## `@integraledger/lcp/starknet`

Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing one token `transfer`; its `Nonce` is the ATR hash's low 250 bits, or on an agreement the agreement value's.

```ts no-check
import { ANY_CALLER, chainIdFelt, EVENT_TRANSFER, … } from "@integraledger/lcp/starknet";
```

**Pairings:** `x402/exact/starknet`.

**Values (23):** `ANY_CALLER`, `chainIdFelt`, `EVENT_TRANSFER`, `exactStarknet`, `FELT_P`, `MASK_250`, `outsideExecution`, `SELECTOR_EXECUTE_FROM_OUTSIDE_V2`, `SELECTOR_TRANSFER`, `snNonce`, `STARKNET_MAX_CANDIDATES`, `STARKNET_MAX_CONTINUATION`, `STARKNET_MAX_EVENT_PAGES`, `STARKNET_MAX_EVENTS`, `STARKNET_MAX_SIGNATURE_FELTS`, `STARKNET_MAX_TRACE_DEPTH`, `STARKNET_MAX_TRACE_INVOCATIONS`, `STARKNET_MAX_TYPED_DATA_BYTES`, `starknetFloor`, `starknetIdDigest`, `starknetLandedNonce`, `starknetRecover`, `starknetStatus`.

**Types (24):** `Broadcaster`, `Felt`, `Field`, `OutsideExecutionTypedData`, `StarknetCall`, `StarknetCursor`, `StarknetEmittedEvent`, `StarknetEvent`, `StarknetEventPage`, `StarknetEventQuery`, `StarknetHead`, `StarknetInvocation`, `StarknetMark`, `StarknetNetwork`, `StarknetOutsideExecution`, `StarknetPayment`, `StarknetReader`, `StarknetReceipt`, `StarknetRef`, `StarknetRefRead`, `StarknetStatus`, `StarknetUnsigned`, `X402Payment`, `X402Read`.

## `@integraledger/lcp/stellar`

Stellar rail pieces: the payer-signed Soroban `transfer` and the digest of its authorization entry, the signed-payload precondition over H, the search for a buyer's acts, and the read of the agreement `x402/exact/stellar/precondition`.

```ts no-check
import { decodeStellarTx, MAX_CANDIDATES, MAX_ORDER, … } from "@integraledger/lcp/stellar";
```

**Values (17):** `decodeStellarTx`, `MAX_CANDIDATES`, `MAX_ORDER`, `MAX_PAGES`, `muxedFor`, `parseStellarPosition`, `PASSPHRASE`, `PAYLOAD_BYTES`, `readSignedPayload`, `SCVAL_MAX_DEPTH`, `signedPayload`, `stellarLocate`, `stellarPosition`, `stellarRecover`, `stellarStatus`, `transferEventOf`, `transferEventTopics`.

**Types (15):** `PayloadSigner`, `StellarCandidate`, `StellarEvent`, `StellarEventRow`, `StellarLanded`, `StellarMark`, `StellarNetwork`, `StellarPayment`, `StellarPaymentPayload`, `StellarQuery`, `StellarReader`, `StellarRef`, `StellarSearch`, `StellarStatus`, `StellarUnsigned`.

## `@integraledger/lcp/sui`

Sui, and the `x402/exact/sui` pairing: the ATR hash as the one `Pure` input of the payer's programmable transaction that no command uses.

```ts no-check
import { decodeSuiTx, exactSui, MAX_SUI_BALANCE_CHANGES, … } from "@integraledger/lcp/sui";
```

**Pairings:** `x402/exact/sui`.

**Values (9):** `decodeSuiTx`, `exactSui`, `MAX_SUI_BALANCE_CHANGES`, `MAX_SUI_COIN_TYPE_LENGTH`, `MAX_SUI_SEARCH_PAGES`, `suiCarrier`, `suiFloor`, `suiRecover`, `suiStatus`.

**Types (17):** `Broadcaster`, `SuiBalanceChange`, `SuiExecuted`, `SuiFound`, `SuiMark`, `SuiNetwork`, `SuiPage`, `SuiPayload`, `SuiPaymentPayload`, `SuiReader`, `SuiRef`, `SuiSearchRange`, `SuiStatus`, `SuiTransfer`, `SuiTx`, `SuiUnsigned`, `X402Read`.

## `@integraledger/lcp/svm`

Solana rail pieces: the wire transaction and its one Memo instruction carrying the ATR hash in LCP string form, the settlement read, and the payment-channels program's pieces.

```ts no-check
import { ATA_PROGRAM, buildChannelMessage, buildSvmMessage, … } from "@integraledger/lcp/svm";
```

**Values (32):** `ATA_PROGRAM`, `buildChannelMessage`, `buildSvmMessage`, `channelInstruction`, `channelPda`, `channelVoucherMessage`, `COMPUTE_BUDGET`, `decodeSvmTx`, `findPda`, `isKey`, `MEMO_V3`, `MEMO_V4`, `OPEN_DISCRIMINATOR`, `openInstructionData`, `openOf`, `PAYMENT_CHANNELS`, `RENT_SYSVAR`, `SEAL_DISCRIMINATOR`, `sessionProof`, `SETTLE_AND_SEAL_DISCRIMINATOR`, `solanaVoucher`, `SVM_MAX_CANDIDATES`, `SVM_SEARCH_SHOWN`, `svmCarrier`, `svmChannelStatus`, `svmDigest`, `svmOpeningStatus`, `svmRecover`, `svmStatus`, `SYSTEM`, `TOKEN`, `TOKEN_2022`.

**Types (22):** `ChannelBuildInput`, `ChannelIx`, `ChannelStatus`, `SolanaNetwork`, `SvmBuildInput`, `SvmCloseRef`, `SvmCloseStatus`, `SvmCommitment`, `SvmCursor`, `SvmInner`, `SvmInstruction`, `SvmLanded`, `SvmMark`, `SvmNonce`, `SvmQuery`, `SvmReader`, `SvmRef`, `SvmSignature`, `SvmStatus`, `SvmTokenBalance`, `SvmTx`, `SvmV1Header`.

## `@integraledger/lcp/tempo`

Tempo rail pieces: the `0x76` transaction's calls, the TIP-20 `transferWithMemo` calldata, the TIP-20 channel reserve's descriptor and ids, and the account keychain's key authorizations.

```ts no-check
import { ACCESS_KEY_SPEND_TOPIC, ACCOUNT_KEYCHAIN, CHANNEL_CLOSED_V1_TOPIC, … } from "@integraledger/lcp/tempo";
```

**Values (22):** `ACCESS_KEY_SPEND_TOPIC`, `ACCOUNT_KEYCHAIN`, `CHANNEL_CLOSED_V1_TOPIC`, `CHANNEL_CLOSED_V2_TOPIC`, `CHANNEL_OPENED_V1_TOPIC`, `CHANNEL_OPENED_V2_TOPIC`, `decodeKeyAuthorization`, `decodeTempoTx`, `encodeKeyAuthorization`, `expiringNonceHash`, `KEY_AUTHORIZATION_WITNESS_TOPIC`, `KEY_REVOKED_TOPIC`, `keyAuthorizationDigest`, `memoCalldata`, `OPEN_V1_SELECTOR`, `OPEN_V2_SELECTOR`, `RECEIVE_POLICY_GUARD`, `tempoChannelId`, `TIP20_CHANNEL_RESERVE`, `TRANSFER_WITH_MEMO_SELECTOR`, `TRANSFER_WITH_MEMO_TOPIC`, `witnessRecover`.

**Types (5):** `KeyAuthorizationUnsigned`, `TempoCall`, `TempoDescriptor`, `TempoKeyAuthorization`, `TempoSearchReader`.

## `@integraledger/lcp/tron`

Tron: the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its memo, `raw_data.data`, in LCP string form, and the transaction pieces it uses.

```ts no-check
import { decodeTronTx, encodeTronRaw, exactTronMemo, … } from "@integraledger/lcp/tron";
```

**Pairings:** `x402/exact/tron/lcp-trc20-memo`.

**Values (14):** `decodeTronTx`, `encodeTronRaw`, `exactTronMemo`, `LCP_TRC20_MEMO`, `TRANSFER_SELECTOR`, `TRANSFER_TOPIC`, `TRIGGER_SMART_CONTRACT`, `TRIGGER_URL`, `TRON_BOUNDS`, `tronAddress`, `tronCarrier`, `tronRecover`, `tronRequest`, `tronStatus`.

**Types (18):** `Broadcaster`, `TronBlock`, `TronChoice`, `TronCursor`, `TronInfo`, `TronLevel`, `TronMark`, `TronNetwork`, `TronNow`, `TronPayment`, `TronQuery`, `TronRaw`, `TronReader`, `TronRef`, `TronStatus`, `TronUnsigned`, `X402Payment`, `X402Read`.

## `@integraledger/lcp/tvm`

TON: the pairing `x402/exact/tvm`. The ATR hash rides in the scheme's `extra.forwardPayload` as a TEP-74 text comment holding its LCP string.

```ts no-check
import { exactTvm, lcpComment, MAX_TVM_ATTACHED_ABOVE_FORWARD, … } from "@integraledger/lcp/tvm";
```

**Pairings:** `x402/exact/tvm`.

**Values (14):** `exactTvm`, `lcpComment`, `MAX_TVM_ATTACHED_ABOVE_FORWARD`, `MAX_TVM_BOC_BYTES`, `MAX_TVM_CELLS`, `MAX_TVM_DEPTH`, `MAX_TVM_LISTED`, `OP`, `TVM_EXPIRY_MARGIN`, `tvmCarrier`, `tvmRecover`, `tvmRequest`, `tvmStatus`, `W5R1_CODE_HASH`.

**Types (20):** `Broadcaster`, `TonAccountState`, `TonAccountStatus`, `TonCell`, `TonIndexed`, `TonLink`, `TonOutMsg`, `TonTx`, `TonWalletState`, `TvmChoice`, `TvmMark`, `TvmNetwork`, `TvmPayment`, `TvmReader`, `TvmRef`, `TvmSearch`, `TvmStatus`, `TvmUnsigned`, `X402Payment`, `X402Read`.

## `@integraledger/lcp/ucp`

UCP checkouts and bookings, and five pairings, each of which carries the ATR hash and link as one `links[]` entry of type `legal_context` in the checkout response.

```ts no-check
import { agentSigned, ap2Mandate, bookingAp2Mandate, … } from "@integraledger/lcp/ucp";
```

**Pairings:** `ucp/booking/ap2-mandate`, `ucp/booking/unsigned`, `ucp/checkout/agent-signed`, `ucp/checkout/ap2-mandate`, `ucp/checkout/unsigned`.

**Values (10):** `agentSigned`, `ap2Mandate`, `bookingAp2Mandate`, `bookingUnsigned`, `checkoutJwt`, `issuedDigest`, `legalContextLink`, `LINK_TYPE`, `tie`, `unsigned`.

**Types (13):** `AgentSignedPresented`, `AgentSignedUnsigned`, `BookingOption`, `Broadcaster`, `ChargePresented`, `ChargeRef`, `Checkout`, `CheckoutOption`, `Link`, `Option`, `UcpBinding`, `UcpOffer`, `Unsigned`.

## `@integraledger/lcp/x402`

x402 v2 documents, the request commitment, and the x402 pairings on eip155 chains: `exact` over EIP-3009, Permit2 and ERC-7710 (with its salt level), `upto` over Permit2, `auth-capture` over EIP-3009 and Permit2, and `exact` in Circle Gateway's batched domain.

```ts no-check
import { authCaptureEip3009, authCapturePermit2, decodePaymentRequired, … } from "@integraledger/lcp/x402";
```

**Pairings:** `x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2`, `x402/exact/eip155/eip3009`, `x402/exact/eip155/erc7710`, `x402/exact/eip155/erc7710-salt`, `x402/exact/eip155/gateway-batched`, `x402/exact/eip155/permit2`, `x402/upto/eip155/permit2`.

**Values (22):** `authCaptureEip3009`, `authCapturePermit2`, `decodePaymentRequired`, `decodePaymentResponse`, `decodePaymentSignature`, `encodeHeader`, `exactEip3009`, `exactErc7710`, `exactErc7710Salt`, `exactGatewayBatched`, `exactPermit2`, `issuedDigest`, `LEGAL_CONTEXT`, `LEGAL_CONTEXT_SCHEMA`, `pairingOfPayment`, `PAYMENT_REQUIRED`, `PAYMENT_RESPONSE`, `PAYMENT_SIGNATURE`, `requestCommitment`, `tie`, `toolCallCommitment`, `uptoPermit2`.

**Types (34):** `BatchedAuthorization`, `BreadthBase`, `BreadthId`, `Broadcaster`, `Eip3009Authorization`, `Eip3009Payment`, `Eip3009TypedData`, `EvmMark`, `EvmQuery`, `GatewayBatchedChoice`, `GatewayBatchedPayment`, `GatewayBatchedTypedData`, `GatewayBatchedUnsigned`, `HeaderDigest`, `HeaderFields`, `HttpRequest`, `LcpPattern`, `Pairings`, `PaymentPayload`, `PaymentRequired`, `PaymentRequirements`, `Permit2Authorization`, `RequestCommitment`, `SettlementResponse`, `ToolCall`, `ToolCallCommitment`, `Unsigned`, `X402Advertise`, `X402Choice`, `X402Offer`, `X402PairingId`, `X402Read`, `X402SchemePayload`, `X402Unsigned`.

## `@integraledger/lcp/x402-batch-settlement`

x402 `batch-settlement`: one ATR per channel, its hash the EVM channel configuration's `salt`, the Solana opening transaction's seller Memo instruction, or, on Cloudflare, the echoed `extensions.legalContext` of each request.

```ts no-check
import { BATCH_SETTLEMENT, batchChannelCreated, batchChannelId, … } from "@integraledger/lcp/x402-batch-settlement";
```

**Pairings:** `x402/batch-settlement/cloudflare`, `x402/batch-settlement/eip155`, `x402/batch-settlement/solana`.

**Values (13):** `BATCH_SETTLEMENT`, `batchChannelCreated`, `batchChannelId`, `batchCloudflare`, `batchEvm`, `batchSvm`, `CHANNEL_CONFIG_TYPEHASH`, `CHANNEL_CREATED_TOPIC`, `DEPOSITED_TOPIC`, `ERC3009_DEPOSIT_COLLECTOR`, `erc3009DepositNonce`, `PERMIT2_DEPOSIT_COLLECTOR`, `VOUCHER_TYPEHASH`.

**Types (15):** `BatchEvmOpen`, `BatchPaymentPayload`, `BatchSvmOpen`, `BatchUnsigned`, `BatchWithin`, `Broadcaster`, `ChannelConfig`, `ChannelMembers`, `CloudflarePaymentPayload`, `Eip712Request`, `EvmMark`, `EvmQuery`, `SigningRequest`, `X402Advertise`, `X402Read`.

## `@integraledger/lcp/x402-exact-solana`

The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement.

```ts no-check
import { exactSvm } from "@integraledger/lcp/x402-exact-solana";
```

**Pairings:** `x402/exact/solana`.

**Values (1):** `exactSvm`.

**Types (5):** `Broadcaster`, `SvmChoice`, `SvmPaymentPayload`, `SvmUnsigned`, `X402Read`.

## `@integraledger/lcp/x402-exact-stellar`

Stellar on x402: the pairing `x402/exact/stellar/precondition` (`exactStellarPrecondition`), an agreement in which the buyer signs a Soroban authorization of `transfer(buyer, payTo, amount)` and a 40-byte payload of H and that authorization's nonce.

```ts no-check
import { exactStellarPrecondition } from "@integraledger/lcp/x402-exact-stellar";
```

**Pairings:** `x402/exact/stellar/precondition`.

**Values (1):** `exactStellarPrecondition`.

**Types (3):** `Broadcaster`, `StellarPreconditionChoice`, `X402Read`.

## `@integraledger/lcp/x402-exact-xrpl`

The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the payer signs as the Payment's `InvoiceID`.

```ts no-check
import { exactXrpl } from "@integraledger/lcp/x402-exact-xrpl";
```

**Pairings:** `x402/exact/xrpl`.

**Values (1):** `exactXrpl`.

**Types (5):** `Broadcaster`, `X402Read`, `XrplChoice`, `XrplPaymentPayload`, `XrplQuery`.

## `@integraledger/lcp/x402-upto-solana`

The `x402/upto/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the one Memo instruction of the transaction that opens a one-request payment channel.

```ts no-check
import { uptoSvm } from "@integraledger/lcp/x402-upto-solana";
```

**Pairings:** `x402/upto/solana`.

**Values (1):** `uptoSvm`.

**Types (5):** `Broadcaster`, `UptoSvmChoice`, `UptoSvmPayload`, `UptoSvmPaymentPayload`, `X402Read`.

## `@integraledger/lcp/x402-upto-xrpl`

The `x402/upto/xrpl` pairing: x402's `upto` scheme on the XRP Ledger, at coverage `none`, its payment following an agreement on the same network.

```ts no-check
import { uptoXrpl } from "@integraledger/lcp/x402-upto-xrpl";
```

**Pairings:** `x402/upto/xrpl`.

**Values (1):** `uptoXrpl`.

**Types (4):** `Broadcaster`, `UptoXrplPayload`, `UptoXrplPaymentPayload`, `X402Read`.

## `@integraledger/lcp/xrpl`

XRP Ledger rail pieces: the signed blob, its `InvoiceID` or memo carrying the ATR hash in each scheme's form, the transaction hash computed from the blob, the reads of a payment, an opening, a channel and a close through a bounded reader, and the payment channel's id and claim.

```ts no-check
import { decodeBlob, mppInvoiceId, x402InvoiceId, … } from "@integraledger/lcp/xrpl";
```

**Values (12):** `decodeBlob`, `mppInvoiceId`, `x402InvoiceId`, `XRPL_MAX_BLOB_BYTES`, `XRPL_MAX_DEPTH`, `XRPL_MAX_PAGES`, `xrplChannelId`, `xrplChannelStatus`, `xrplChargeStatus`, `xrplClaim`, `xrplOpenStatus`, `xrplStatus`.

**Types (19):** `XrplAmount`, `XrplChannelEntry`, `XrplChannelRef`, `XrplCloseRef`, `XrplCloseStatus`, `XrplLanded`, `XrplLedgerName`, `XrplMark`, `XrplNetwork`, `XrplPage`, `XrplQuery`, `XrplReached`, `XrplReader`, `XrplRef`, `XrplServer`, `XrplSigned`, `XrplStatus`, `XrplTxJson`, `XrplUnsigned`.

