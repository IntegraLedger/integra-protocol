---
title: Entry points
description: Every entry point of @integraledger/lcp and what it exports.
---

# Entry points

This page is generated from the package by `node scripts/docs-reference.mjs`, and CI checks that it matches.

Import each entry point by its subpath. Every entry point is ESM with its own type declarations. The [API reference](./api/index.md) gives each export's signature, and its doc comment where it has one.

| Entry point | What it holds |
|---|---|
| [`@integraledger/lcp`](#integraledgerlcp) | The core: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's string and structured forms, the https-link rule, and the registry of every pairing (`BINDINGS`, `pairingOf`). |
| [`@integraledger/lcp/a2a`](#integraledgerlcpa2a) | The LCP extension for A2A: the ATR hash and the link to the seller's copy delivered in a Task's `metadata`, keyed by the extension's URI. A2A signs nothing per transaction, so this is a carrier and exports no pairing. Pure; no I/O. |
| [`@integraledger/lcp/ack`](#integraledgerlcpack) | ACK Payment Requests and receipts, and the pairing `ack/payment-request`: the ATR hash as the `id` of the seller-signed Payment Request, in LCP's string form, with the link beside the request in the 402 body. ACK defines no payer signature, so `build` and `bound` always refuse. Pure; no I/O. No token or receipt signature is verified here. |
| [`@integraledger/lcp/acp`](#integraledgerlcpacp) | ACP checkout sessions and delegate-payment allowances, and the pairings `acp/checkout/delegated` and `acp/checkout/undelegated`: the ATR hash as the checkout session's `id`, with the link beside it in the session's `metadata.legal_context`, and, where the handler requires `delegate_payment`, as the allowance's `checkout_session_id`. Pure; no I/O. Nothing here signs or verifies a signature. |
| [`@integraledger/lcp/ap2`](#integraledgerlcpap2) | AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the `legalContext` member of the merchant-signed `checkout_jwt` payload, committed to by the buyer's closed Checkout Mandate through `checkout_hash`, and read back from the checkout JWT presented beside the mandate. The mandate is presented alone, or last in AP2's chain after the open mandate. Nothing here verifies a signature, a `cnf` delegation or a link between hops. |
| [`@integraledger/lcp/aptos`](#integraledgerlcpaptos) | Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer carries the ATR hash, so the hash is advertised in the challenge, read back from the echoed extension, and tied to the payment by the seller's claim. The settlement is found by the payer's sender and sequence number, and identified by a digest of the transfer the payer signed and by the expiry it signed. |
| [`@integraledger/lcp/avm`](#integraledgerlcpavm) | Algorand: the pairing `x402/exact/algorand`, in which the payer signs an asset transfer whose note is the ATR hash's LCP string, and the settlement read from an Indexer by the transaction id computed from the signed bytes. `algosdk` is an optional peer: this module loads it when present. Without it the pairing serves no option, and `avmCarrier` and `build` refuse `avm/peer-missing`. |
| [`@integraledger/lcp/card`](#integraledgerlcpcard) | The `card` entry point: the ATR hash on a card checkout, on three paths: Visa TAP, Mastercard Verifiable Intent (Immediate and Autonomous) and the plain card checkout. |
| [`@integraledger/lcp/cardano`](#integraledgerlcpcardano) | Cardano, and the `x402/exact/cardano` pairing: the ATR hash as a CIP-20 message (metadata label 674) that the payer's signed body commits to through `auxiliary_data_hash`. The transaction id is the Blake2b-256 of the body as received, so settlement is read by an id fixed before any money moves. |
| [`@integraledger/lcp/casper`](#integraledgerlcpcasper) | CEP-3009 on Casper and the `x402/exact/casper` pairing: the ATR hash as the authorization's 32-byte `nonce`, written by the buyer's signer, read back from what the payer signed, and read from the executed call's arguments. |
| [`@integraledger/lcp/ccd`](#integraledgerlcpccd) | Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer event. |
| [`@integraledger/lcp/core`](#integraledgerlcpcore) | The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's string and structured forms, the https-link rule, the RFC 8785 form of a JSON value and its digest, JSON reading capped at 64 levels, and `isRefusal`. It imports no pairing, no rail and no optional peer, so a bundle of it holds these functions and nothing else. The package root exports the same functions: each is one function, reached by either path. |
| [`@integraledger/lcp/discovery`](#integraledgerlcpdiscovery) | The discovery document of LCP §2, served at `/.well-known/legal-context.json`. `parse` reads one; `emit` writes one, members in the order of LCP §2.4–§2.5's tables, absent members omitted, no whitespace, UTF-8. Both check the members LCP §2.4–§2.5 define, with these bounds: each string member non-empty, `terms` an https URL, at most 65,536 bytes, and JSON nested at most 64 levels. Neither throws or does I/O. |
| [`@integraledger/lcp/evm`](#integraledgerlcpevm) | eip155 rail pieces: EIP-3009 and Permit2 typed data, the identity digest of a transfer, the settlement read from the token's `AuthorizationUsed` event and the transfer it produced, and the read of a signed pull authorization's use before any transaction is named; the ERC-7710 permission-context decoder and MetaMask's DelegationManager address; the commerce-payments escrow's payment hash and the salt commitment to a receiver authorizer and policy; and x402's Permit2 proxy addresses. |
| [`@integraledger/lcp/hedera`](#integraledgerlcphedera) | Hedera: the transaction wire form read and written by hand (protobuf, five messages), the Mirror Node settlement read, and the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only); and MPP's `mpp/charge/hedera`, whose signed memo is MPP's attribution memo, its nonce keccak256 of the challenge id that carries the hash. |
| [`@integraledger/lcp/lightning`](#integraledgerlcplightning) | BOLT11 invoices and the Lightning pairings on x402 and MPP. On `x402/exact/lnbtc` the seller's node writes the ATR hash as the invoice's `m` field and signs it; on `x402/exact/lnbtc/invoice-named` the invoice carries no hash and the ATR's `x402` slot names the invoice instead. On MPP the seller's node writes the ATR hash as the invoice's description hash `h`. The payer signs nothing; it pays the invoice. |
| [`@integraledger/lcp/mpp`](#integraledgerlcpmpp) | The `mpp` entry point: MPP's challenge pieces and its pairings. The charge pairings here are EVM `authorization` (the signed nonce is keccak256(id ‖ realm)), EVM `permit2` (the signed witness carries that value), EVM `transaction` and `hash` (nothing signed carries H), and Tempo pull and push (the signed `transferWithMemo` carries the attribution memo MPP's SDKs write, whose nonce is keccak256 of the id). The card, Stripe, Solana, Stellar, XRP Ledger, Hedera, NEAR Intents and `usdc` charges, and the session and subscription pairings other than Lightning's, are re-exported from their modules. |
| [`@integraledger/lcp/near`](#integraledgerlcpnear) | NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it. Settlement is read from the relayed transaction's receipts through a bounded reader. |
| [`@integraledger/lcp/polkadot`](#integraledgerlcppolkadot) | Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one extrinsic whose call is `utility.batch_all([assets.transfer_keep_alive, system.remark_with_event])` with the ATR hash's LCP string as the remark; the settlement is read by block and index through Sidecar. SCALE is encoded and decoded here for these shapes only. |
| [`@integraledger/lcp/stacks`](#integraledgerlcpstacks) | Stacks rail pieces: the transaction id, the reader a settlement read goes through, the reading of a SIP-010 `transfer` whose memo argument is the ATR hash's 32 bytes, and the zero-party recovery of that hash from a mined transaction. |
| [`@integraledger/lcp/starknet`](#integraledgerlcpstarknet) | Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing one token `transfer`; its `Nonce` is the ATR hash's low 250 bits. Settlement is read from the executed call's trace through a bounded reader. The chain holds 250 of the hash's bits, so a holder of the ATR confirms the hash from it but nothing recovers the hash. |
| [`@integraledger/lcp/stellar`](#integraledgerlcpstellar) | Stellar rail pieces: the payer-signed Soroban `transfer`, its muxed `to` whose 8-byte id is the ATR hash's first 8 bytes, the digest of the signed authorization entry, and settlement read through a bounded reader. |
| [`@integraledger/lcp/sui`](#integraledgerlcpsui) | Sui, and the `x402/exact/sui` pairing: the ATR hash as the one `Pure` input of the payer's programmable transaction that no command uses. The payer's signature covers it, the rail executes the transaction unchanged, and the hash stays on chain in the transaction's input list. Settlement is read by the transaction digest, which the signed bytes fix before any money moves. BCS decoding and base58 use @mysten/sui, loaded once when this module is; without it every function that needs it refuses `sui/peer-missing`, and `status` reads as pending `unreadable`. |
| [`@integraledger/lcp/svm`](#integraledgerlcpsvm) | Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the digest of the message the payer signed, settlement read through a bounded reader, and the payment-channels program's pieces: its instructions and PDAs, the voucher, the session salt and proof, and the channel's status read. |
| [`@integraledger/lcp/tempo`](#integraledgerlcptempo) | Tempo rail pieces: the `0x76` transaction's calls, the TIP-20 `transferWithMemo` calldata, the TIP-20 channel reserve's descriptor and ids, and the account keychain's key authorizations. Tempo serves eip155 JSON-RPC, so the reader is `EvmReader`. Nothing here throws on a caller's value; refusals are values. |
| [`@integraledger/lcp/tron`](#integraledgerlcptron) | Tron: the transaction pieces (protobuf for the fields the profile uses, base58check addresses, the transaction id) and the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its memo, `raw_data.data`, in LCP string form. Settlement is read by transaction id through a bounded reader. |
| [`@integraledger/lcp/tvm`](#integraledgerlcptvm) | TON: the pairing `x402/exact/tvm`. The ATR hash rides in the scheme's `extra.forwardPayload` as a TEP-74 text comment holding its LCP string. The payer's W5 wallet signs a request whose one Jetton transfer carries that payload; settlement is read from the W5 wallet's transaction with that request and the Jetton wallets' transactions it led to, through a bounded reader. |
| [`@integraledger/lcp/ucp`](#integraledgerlcpucp) | UCP checkouts and bookings, and four pairings: the ATR hash and link as one `links[]` entry of type `legal_context` in the checkout response. The `ap2-mandate` pairings read the hash from the checkout JWT presented beside the buyer's checkout mandate, after AP2's `checkout_hash` check, the mandate presented alone or last in AP2's chain after the open mandate; the `unsigned` pairings have nothing signed to read. Nothing here takes a key, signs, or verifies a signature, a `cnf` delegation or a link between chained mandates. |
| [`@integraledger/lcp/x402`](#integraledgerlcpx402) | x402 v2 documents, the request commitment, and the x402 pairings on eip155 chains: `exact` over EIP-3009, Permit2 and ERC-7710 (with its salt level), `upto` over Permit2, and `auth-capture` over EIP-3009 and Permit2. The ATR hash is advertised in the challenge's `extensions.legalContext`; each pairing's `pattern` record states how the pairing binds it. |
| [`@integraledger/lcp/x402-batch-settlement`](#integraledgerlcpx402-batch-settlement) | x402 `batch-settlement`: one ATR per channel. On EVM the ATR hash is the channel configuration's `salt`, which the channel id commits to and every signature signs; on Solana it is the opening transaction's seller Memo instruction (`extra.memo`), beside x402's receiver-authorizer binding memo; on Cloudflare it rides the echoed `extensions.legalContext` of each request, with no channel. |
| [`@integraledger/lcp/x402-exact-solana`](#integraledgerlcpx402-exact-solana) | The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement. |
| [`@integraledger/lcp/x402-exact-stellar`](#integraledgerlcpx402-exact-stellar) | The `x402/exact/stellar` pairing: the ATR hash advertised in the challenge's `extensions.legalContext`, and its first 8 bytes carried as the muxed id of the option's `payTo`, which the payer signs as the Soroban `transfer`'s `to`. |
| [`@integraledger/lcp/x402-exact-xrpl`](#integraledgerlcpx402-exact-xrpl) | The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the payer signs with a single key as the Payment's `InvoiceID`, read back from the signed blob, and settlement read by the blob's hash. |
| [`@integraledger/lcp/x402-upto-solana`](#integraledgerlcpx402-upto-solana) | The `x402/upto/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the one Memo instruction of the transaction that opens a one-request payment channel escrowing the signed maximum; read back from that transaction, and settlement read from the opening. |
| [`@integraledger/lcp/xrpl`](#integraledgerlcpxrpl) | XRP Ledger rail pieces: the signed Payment blob, its `InvoiceID` carrying the ATR hash in each scheme's form, the transaction hash computed from the blob, settlement read by that hash through a bounded reader, and the payment channel's id, claim and opening read. |

## `@integraledger/lcp`

The core: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's string and structured forms, the https-link rule, and the registry of every pairing (`BINDINGS`, `pairingOf`).

```ts no-check
import { assemble, BINDINGS, canonicalJson, … } from "@integraledger/lcp";
```

**Values (19):** `assemble`, `BINDINGS`, `canonicalJson`, `digestJson`, `fromLcpString`, `fromLegalContext`, `fromRawBytes`, `hash`, `hashEquals`, `isHttpsLink`, `isOtherSchemeLink`, `isRefusal`, `newAtrId`, `pairingOf`, `parseJson`, `readToRepeat`, `toLcpString`, `toLegalContext`, `toRawBytes`.

**Types (12):** `AtrHash`, `Authorizer`, `Binding`, `CarrierAfterH`, `CoreRefusal`, `Json`, `LcpPattern`, `MppBinding`, `PairingId`, `Presented`, `Refusal`, `X402Binding`.

## `@integraledger/lcp/a2a`

The LCP extension for A2A: the ATR hash and the link to the seller's copy delivered in a Task's `metadata`, keyed by the extension's URI. A2A signs nothing per transaction, so this is a carrier and exports no pairing. Pure; no I/O.

```ts no-check
import { A2A_EXTENSION_URIS, agentExtension, binding, … } from "@integraledger/lcp/a2a";
```

**Values (7):** `A2A_EXTENSION_URIS`, `agentExtension`, `binding`, `delivery`, `place`, `read`, `requested`.

**Types (2):** `A2aAgentExtension`, `A2aTask`.

## `@integraledger/lcp/ack`

ACK Payment Requests and receipts, and the pairing `ack/payment-request`: the ATR hash as the `id` of the seller-signed Payment Request, in LCP's string form, with the link beside the request in the 402 body. ACK defines no payer signature, so `build` and `bound` always refuse. Pure; no I/O. No token or receipt signature is verified here.

```ts no-check
import { fromReceipt, paymentRequest, tie } from "@integraledger/lcp/ack";
```

**Pairings:** `ack/payment-request`.

**Values (3):** `fromReceipt`, `paymentRequest`, `tie`.

**Types (3):** `AckBody`, `AckPaymentOption`, `AckValues`.

## `@integraledger/lcp/acp`

ACP checkout sessions and delegate-payment allowances, and the pairings `acp/checkout/delegated` and `acp/checkout/undelegated`: the ATR hash as the checkout session's `id`, with the link beside it in the session's `metadata.legal_context`, and, where the handler requires `delegate_payment`, as the allowance's `checkout_session_id`. Pure; no I/O. Nothing here signs or verifies a signature.

```ts no-check
import { delegated, issuedDigest, METADATA_KEY, … } from "@integraledger/lcp/acp";
```

**Pairings:** `acp/checkout/delegated`, `acp/checkout/undelegated`.

**Values (5):** `delegated`, `issuedDigest`, `METADATA_KEY`, `tie`, `undelegated`.

**Types (7):** `AcpBinding`, `AcpChoice`, `Allowance`, `HandlerOption`, `Presented`, `Session`, `Unsigned`.

## `@integraledger/lcp/ap2`

AP2 v0.2 checkouts and closed Checkout Mandates, and the `ap2/checkout-mandate` pairing: the ATR hash as the `legalContext` member of the merchant-signed `checkout_jwt` payload, committed to by the buyer's closed Checkout Mandate through `checkout_hash`, and read back from the checkout JWT presented beside the mandate. The mandate is presented alone, or last in AP2's chain after the open mandate. Nothing here verifies a signature, a `cnf` delegation or a link between hops.

```ts no-check
import { CHECKOUT_VCT, checkoutBinding, checkoutJwtOf, … } from "@integraledger/lcp/ap2";
```

**Pairings:** `ap2/checkout-mandate`.

**Values (8):** `CHECKOUT_VCT`, `checkoutBinding`, `checkoutJwtOf`, `checkoutMandate`, `issuedDigest`, `jwsPayload`, `readMandate`, `tie`.

**Types (7):** `Ap2Offer`, `CheckoutOption`, `Jws`, `MandateContent`, `Payload`, `Presented`, `Unsigned`.

## `@integraledger/lcp/aptos`

Aptos, and the `x402/exact/aptos` pairing, served at the seller-tied level: no field of a standard Aptos transfer carries the ATR hash, so the hash is advertised in the challenge, read back from the echoed extension, and tied to the payment by the seller's claim. The settlement is found by the payer's sender and sequence number, and identified by a digest of the transfer the payer signed and by the expiry it signed.

```ts no-check
import { aptosIdDigest, aptosStatus, committedInstrument, … } from "@integraledger/lcp/aptos";
```

**Pairings:** `x402/exact/aptos`.

**Values (5):** `aptosIdDigest`, `aptosStatus`, `committedInstrument`, `decodeAptosTx`, `exactAptos`.

**Types (7):** `AptosCommitted`, `AptosInstrument`, `AptosNetwork`, `AptosReader`, `AptosRef`, `AptosStatus`, `AptosUnsigned`.

## `@integraledger/lcp/avm`

Algorand: the pairing `x402/exact/algorand`, in which the payer signs an asset transfer whose note is the ATR hash's LCP string, and the settlement read from an Indexer by the transaction id computed from the signed bytes. `algosdk` is an optional peer: this module loads it when present. Without it the pairing serves no option, and `avmCarrier` and `build` refuse `avm/peer-missing`.

```ts no-check
import { avmCarrier, avmRecover, avmStatus, … } from "@integraledger/lcp/avm";
```

**Pairings:** `x402/exact/algorand`.

**Values (5):** `avmCarrier`, `avmRecover`, `avmStatus`, `exactAvm`, `MSGPACK_MAX_DEPTH`.

**Types (7):** `AlgorandNetwork`, `AvmParams`, `AvmPresented`, `AvmReader`, `AvmRef`, `AvmStatus`, `AvmUnsigned`.

## `@integraledger/lcp/card`

The `card` entry point: the ATR hash on a card checkout, on three paths: Visa TAP, Mastercard Verifiable Intent (Immediate and Autonomous) and the plain card checkout.

```ts no-check
import { disclosureDigest, sellerReference, TAP_FIELD, … } from "@integraledger/lcp/card";
```

**Pairings:** `card/mastercard-vi/autonomous`, `card/mastercard-vi/immediate`, `card/seller-reference`, `card/visa-tap`.

**Values (7):** `disclosureDigest`, `sellerReference`, `TAP_FIELD`, `tie`, `viAutonomous`, `viImmediate`, `visaTap`.

**Types (10):** `CardOption`, `CardPairing`, `CardPairingId`, `CardScheme`, `CardValues`, `TapPresented`, `TapUnsigned`, `ViAutonomous`, `ViImmediate`, `ViUnsigned`.

## `@integraledger/lcp/cardano`

Cardano, and the `x402/exact/cardano` pairing: the ATR hash as a CIP-20 message (metadata label 674) that the payer's signed body commits to through `auxiliary_data_hash`. The transaction id is the Blake2b-256 of the body as received, so settlement is read by an id fixed before any money moves.

```ts no-check
import { auxiliaryData, cardanoRecover, cardanoStatus, … } from "@integraledger/lcp/cardano";
```

**Pairings:** `x402/exact/cardano`.

**Values (6):** `auxiliaryData`, `cardanoRecover`, `cardanoStatus`, `decodeCardanoTx`, `exactCardano`, `LCP_MARKER`.

**Types (8):** `CardanoNetwork`, `CardanoOnChain`, `CardanoPayload`, `CardanoReader`, `CardanoRef`, `CardanoStatus`, `CardanoTx`, `CardanoUnsigned`.

## `@integraledger/lcp/casper`

CEP-3009 on Casper and the `x402/exact/casper` pairing: the ATR hash as the authorization's 32-byte `nonce`, written by the buyer's signer, read back from what the payer signed, and read from the executed call's arguments.

```ts no-check
import { CASPER_DOMAIN_TYPEHASH, casperIdDigest, casperRecover, … } from "@integraledger/lcp/casper";
```

**Pairings:** `x402/exact/casper`.

**Values (6):** `CASPER_DOMAIN_TYPEHASH`, `casperIdDigest`, `casperRecover`, `casperStatus`, `cep3009TypedData`, `exactCasper`.

**Types (9):** `CasperAddress`, `CasperCall`, `CasperNetwork`, `CasperReader`, `CasperRef`, `CasperStatus`, `CasperUnsigned`, `Cep3009TypedData`, `PackageHash`.

## `@integraledger/lcp/ccd`

Concordium and the `x402/exact/ccd` pairing: the ATR hash in LCP's string form, as a CBOR text string, in the memo of the one transfer the sender signs; read back from the signed transaction, and read from the finalized transfer event.

```ts no-check
import { accountBytes, ccdIdDigest, ccdMemo, … } from "@integraledger/lcp/ccd";
```

**Pairings:** `x402/exact/ccd`.

**Values (8):** `accountBytes`, `ccdIdDigest`, `ccdMemo`, `ccdRecover`, `ccdStatus`, `exactCcd`, `memoCarrier`, `pltMemo`.

**Types (7):** `CcdItem`, `CcdNetwork`, `CcdReader`, `CcdRef`, `CcdStatus`, `CcdTransfer`, `CcdUnsigned`.

## `@integraledger/lcp/core`

The core alone: assembling an ATR and hashing its exact bytes, comparing hashes, the hash's string and structured forms, the https-link rule, the RFC 8785 form of a JSON value and its digest, JSON reading capped at 64 levels, and `isRefusal`. It imports no pairing, no rail and no optional peer, so a bundle of it holds these functions and nothing else. The package root exports the same functions: each is one function, reached by either path.

```ts no-check
import { assemble, canonicalJson, digestJson, … } from "@integraledger/lcp/core";
```

**Values (16):** `assemble`, `canonicalJson`, `digestJson`, `fromLcpString`, `fromLegalContext`, `fromRawBytes`, `hash`, `hashEquals`, `isHttpsLink`, `isOtherSchemeLink`, `isRefusal`, `newAtrId`, `parseJson`, `toLcpString`, `toLegalContext`, `toRawBytes`.

**Types (4):** `AtrHash`, `CoreRefusal`, `Json`, `Refusal`.

## `@integraledger/lcp/discovery`

The discovery document of LCP §2, served at `/.well-known/legal-context.json`. `parse` reads one; `emit` writes one, members in the order of LCP §2.4–§2.5's tables, absent members omitted, no whitespace, UTF-8. Both check the members LCP §2.4–§2.5 define, with these bounds: each string member non-empty, `terms` an https URL, at most 65,536 bytes, and JSON nested at most 64 levels. Neither throws or does I/O.

```ts no-check
import { emit, MAX_DOCUMENT_BYTES, parse, … } from "@integraledger/lcp/discovery";
```

**Values (4):** `emit`, `MAX_DOCUMENT_BYTES`, `parse`, `WELL_KNOWN_PATH`.

**Types (1):** `LegalContextDocument`.

## `@integraledger/lcp/evm`

eip155 rail pieces: EIP-3009 and Permit2 typed data, the identity digest of a transfer, the settlement read from the token's `AuthorizationUsed` event and the transfer it produced, and the read of a signed pull authorization's use before any transaction is named; the ERC-7710 permission-context decoder and MetaMask's DelegationManager address; the commerce-payments escrow's payment hash and the salt commitment to a receiver authorizer and policy; and x402's Permit2 proxy addresses.

```ts no-check
import { AUTHORIZATION_STATE_SELECTOR, AUTHORIZATION_USED_TOPIC, authorizationIdDigest, … } from "@integraledger/lcp/evm";
```

**Values (27):** `AUTHORIZATION_STATE_SELECTOR`, `AUTHORIZATION_USED_TOPIC`, `authorizationIdDigest`, `authorizationUsed`, `bindSalt`, `decodePermissionContext`, `DELEGATION_MANAGER`, `DELEGATION_MANAGER_CHAINS`, `eip3009Recover`, `eip3009Status`, `eip3009TypedData`, `ESCROW`, `evmStatus`, `EXACT_PERMIT2_PROXY`, `NONCE_BITMAP_SELECTOR`, `PAYMENT_AUTHORIZED_TOPIC`, `PAYMENT_INFO_TYPEHASH`, `paymentHash`, `PERMIT2`, `permit2TypedData`, `ReaderError`, `REDEEMED_DELEGATION_TOPIC`, `SALT_BINDING_TYPEHASH`, `TRANSFER_TOPIC`, `TRANSFER_WITH_AUTHORIZATION_TYPEHASH`, `transferDigest`, `UPTO_PERMIT2_PROXY`.

**Types (19):** `Delegation`, `Eip155`, `Eip3009Ref`, `Eip3009TypedData`, `EvmBreadthStatus`, `EvmLog`, `EvmReader`, `EvmReceipt`, `EvmRef`, `EvmStatus`, `EvmTransaction`, `EvmTxRef`, `Field`, `Hex`, `PaymentInfo`, `Permit2TypedData`, `PullAuthorization`, `TransferIdentity`, `TransferLog`.

## `@integraledger/lcp/hedera`

Hedera: the transaction wire form read and written by hand (protobuf, five messages), the Mirror Node settlement read, and the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only); and MPP's `mpp/charge/hedera`, whose signed memo is MPP's attribution memo, its nonce keccak256 of the challenge id that carries the hash.

```ts no-check
import { CHANNEL_CLOSED_TOPIC, CHANNEL_OPENED_TOPIC, chargeHedera, … } from "@integraledger/lcp/hedera";
```

**Pairings:** `mpp/charge/hedera`, `x402/exact/hedera`, `x402/exact/hedera/transfer-executor`.

**Values (14):** `CHANNEL_CLOSED_TOPIC`, `CHANNEL_OPENED_TOPIC`, `chargeHedera`, `decodeHederaTx`, `ESCROW_OPEN_SELECTOR`, `exactHedera`, `exactHederaExecutor`, `executorStatus`, `hederaChannelId`, `hederaIdDigest`, `hederaStatus`, `hederaVoucher`, `txIdMirror`, `txIdText`.

**Types (13):** `ExecutorRef`, `HederaBody`, `HederaChannelConfig`, `HederaCloseRef`, `HederaEvmReader`, `HederaNetwork`, `HederaReader`, `HederaRef`, `HederaSessionRef`, `HederaStatus`, `HederaTxId`, `HederaUnsigned`, `MirrorEntry`.

## `@integraledger/lcp/lightning`

BOLT11 invoices and the Lightning pairings on x402 and MPP. On `x402/exact/lnbtc` the seller's node writes the ATR hash as the invoice's `m` field and signs it; on `x402/exact/lnbtc/invoice-named` the invoice carries no hash and the ATR's `x402` slot names the invoice instead. On MPP the seller's node writes the ATR hash as the invoice's description hash `h`. The payer signs nothing; it pays the invoice.

```ts no-check
import { atrNamesInvoice, chargeLightning, decodeBolt11, … } from "@integraledger/lcp/lightning";
```

**Pairings:** `mpp/charge/lightning`, `mpp/session/lightning`, `x402/exact/lnbtc`, `x402/exact/lnbtc/invoice-named`.

**Values (7):** `atrNamesInvoice`, `chargeLightning`, `decodeBolt11`, `exactLnbtc`, `exactLnbtcNamed`, `invoiceH`, `sessionLightning`.

**Types (7):** `Bolt11`, `LnMppChoice`, `LnMppUnsigned`, `LnNetwork`, `LnPaymentPayload`, `LnRef`, `LnUnsigned`.

## `@integraledger/lcp/mpp`

The `mpp` entry point: MPP's challenge pieces and its pairings. The charge pairings here are EVM `authorization` (the signed nonce is keccak256(id ‖ realm)), EVM `permit2` (the signed witness carries that value), EVM `transaction` and `hash` (nothing signed carries H), and Tempo pull and push (the signed `transferWithMemo` carries the attribution memo MPP's SDKs write, whose nonce is keccak256 of the id). The card, Stripe, Solana, Stellar, XRP Ledger, Hedera, NEAR Intents and `usdc` charges, and the session and subscription pairings other than Lightning's, are re-exported from their modules.

```ts no-check
import { attributionMemo, CARRIER, challengeBound, … } from "@integraledger/lcp/mpp";
```

**Pairings:** `mpp/charge/card`, `mpp/charge/evm/authorization`, `mpp/charge/evm/hash`, `mpp/charge/evm/permit2`, `mpp/charge/evm/transaction`, `mpp/charge/hedera`, `mpp/charge/nearintents`, `mpp/charge/solana`, `mpp/charge/stellar`, `mpp/charge/stripe`, `mpp/charge/tempo/memo`, `mpp/charge/tempo/push`, `mpp/charge/usdc/evm`, `mpp/charge/usdc/gateway`, `mpp/charge/usdc/solana`, `mpp/charge/usdc/stacks`, `mpp/charge/xrpl`, `mpp/session/evm`, `mpp/session/hedera`, `mpp/session/solana`, `mpp/session/tempo`, `mpp/session/xrpl`, `mpp/subscription/stripe`, `mpp/subscription/tempo`.

**Values (50):** `attributionMemo`, `CARRIER`, `challengeBound`, `challengeH`, `challengeHash`, `challengeId`, `chargeCard`, `chargeHedera`, `chargeNearIntents`, `chargeSolana`, `chargeStellar`, `chargeStripe`, `chargeUsdcEvm`, `chargeUsdcGateway`, `chargeUsdcSolana`, `chargeUsdcStacks`, `chargeXrpl`, `checkAttribution`, `evmAuthorization`, `evmChannelId`, `evmHash`, `evmPermit2`, `evmTransaction`, `issuedDigest`, `keySearch`, `LEGAL_CONTEXT_METADATA_KEY`, `MPP_BINDINGS`, `network`, `pairingsOf`, `pairingsOfPlaced`, `parseChallenges`, `place`, `problem`, `read`, `sessionEvm`, `sessionHedera`, `sessionResume`, `sessionSolana`, `sessionStatus`, `sessionTempo`, `sessionXrpl`, `subscriptionStripe`, `subscriptionTempo`, `tempoMemo`, `tempoPush`, `tie`, `transferPresent`, `usdcGatewaySalt`, `usdcNonce`, `usdcRequestHash`.

**Types (20):** `GatewayPreimage`, `GatewaySaltInput`, `LandedCredential`, `MppChallenge`, `MppChoice`, `MppCredential`, `MppMethod`, `MppPairingId`, `MppUnsigned`, `RailSessionUnsigned`, `ReceiveTypedData`, `SessionChoice`, `SessionRef`, `SessionStatus`, `SessionUnsigned`, `SessionWithin`, `StripeSubscriptionReceipt`, `UsdcUnsigned`, `VoucherTypedData`, `WithinSigningRequest`.

## `@integraledger/lcp/near`

NEAR: the pairing `x402/exact/near`. The payer signs a NEP-366 delegate action for one NEP-141 `ft_transfer` whose `memo` argument is the ATR hash's LCP string; a facilitator's relayer submits it. Settlement is read from the relayed transaction's receipts through a bounded reader.

```ts no-check
import { exactNear, FT_TRANSFER_GAS, ftTransferArgs, … } from "@integraledger/lcp/near";
```

**Pairings:** `x402/exact/near`.

**Values (8):** `exactNear`, `FT_TRANSFER_GAS`, `ftTransferArgs`, `nearCarrier`, `nearLapsed`, `nearRecover`, `nearStatus`, `NEP461_DELEGATE`.

**Types (6):** `NearNetwork`, `NearOutcome`, `NearReader`, `NearRef`, `NearStatus`, `NearUnsigned`.

## `@integraledger/lcp/polkadot`

Polkadot Asset Hub: the profile pairing `x402/exact/polkadot/lcp-assets-remark`, in which the payer signs one extrinsic whose call is `utility.batch_all([assets.transfer_keep_alive, system.remark_with_event])` with the ATR hash's LCP string as the remark; the settlement is read by block and index through Sidecar. SCALE is encoded and decoded here for these shapes only.

```ts no-check
import { CALL, decodeProfileCall, encodeProfileCall, … } from "@integraledger/lcp/polkadot";
```

**Pairings:** `x402/exact/polkadot/lcp-assets-remark`.

**Values (11):** `CALL`, `decodeProfileCall`, `encodeProfileCall`, `exactPolkadotRemark`, `extrinsicHash`, `LCP_ASSETS_REMARK`, `polkadotLocate`, `polkadotRecover`, `polkadotStatus`, `splitSigned`, `ss58Decode`.

**Types (7):** `PolkadotExtrinsic`, `PolkadotNetwork`, `PolkadotReader`, `PolkadotRef`, `PolkadotStatus`, `PolkadotUnsigned`, `ProfileCall`.

## `@integraledger/lcp/stacks`

Stacks rail pieces: the transaction id, the reader a settlement read goes through, the reading of a SIP-010 `transfer` whose memo argument is the ATR hash's 32 bytes, and the zero-party recovery of that hash from a mined transaction.

```ts no-check
import { stacksRecover, stacksStatus, stacksTxid } from "@integraledger/lcp/stacks";
```

**Values (3):** `stacksRecover`, `stacksStatus`, `stacksTxid`.

**Types (6):** `StacksLanded`, `StacksMempool`, `StacksNetwork`, `StacksReader`, `StacksRef`, `StacksStatus`.

## `@integraledger/lcp/starknet`

Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing one token `transfer`; its `Nonce` is the ATR hash's low 250 bits. Settlement is read from the executed call's trace through a bounded reader. The chain holds 250 of the hash's bits, so a holder of the ATR confirms the hash from it but nothing recovers the hash.

```ts no-check
import { ANY_CALLER, chainIdFelt, EVENT_TRANSFER, … } from "@integraledger/lcp/starknet";
```

**Pairings:** `x402/exact/starknet`.

**Values (13):** `ANY_CALLER`, `chainIdFelt`, `EVENT_TRANSFER`, `exactStarknet`, `FELT_P`, `MASK_250`, `outsideExecution`, `SELECTOR_EXECUTE_FROM_OUTSIDE_V2`, `SELECTOR_TRANSFER`, `snNonce`, `starknetIdDigest`, `starknetLandedNonce`, `starknetStatus`.

**Types (11):** `Felt`, `Field`, `OutsideExecutionTypedData`, `StarknetEvent`, `StarknetInvocation`, `StarknetNetwork`, `StarknetReader`, `StarknetReceipt`, `StarknetRef`, `StarknetStatus`, `StarknetUnsigned`.

## `@integraledger/lcp/stellar`

Stellar rail pieces: the payer-signed Soroban `transfer`, its muxed `to` whose 8-byte id is the ATR hash's first 8 bytes, the digest of the signed authorization entry, and settlement read through a bounded reader.

```ts no-check
import { decodeStellarTx, muxedFor, muxedId, … } from "@integraledger/lcp/stellar";
```

**Values (9):** `decodeStellarTx`, `muxedFor`, `muxedId`, `PASSPHRASE`, `SCVAL_MAX_DEPTH`, `stellarLocate`, `stellarStatus`, `transferEventOf`, `transferEventTopics`.

**Types (6):** `StellarNetwork`, `StellarPayment`, `StellarReader`, `StellarRef`, `StellarStatus`, `StellarUnsigned`.

## `@integraledger/lcp/sui`

Sui, and the `x402/exact/sui` pairing: the ATR hash as the one `Pure` input of the payer's programmable transaction that no command uses. The payer's signature covers it, the rail executes the transaction unchanged, and the hash stays on chain in the transaction's input list. Settlement is read by the transaction digest, which the signed bytes fix before any money moves. BCS decoding and base58 use @mysten/sui, loaded once when this module is; without it every function that needs it refuses `sui/peer-missing`, and `status` reads as pending `unreadable`.

```ts no-check
import { decodeSuiTx, exactSui, suiCarrier, … } from "@integraledger/lcp/sui";
```

**Pairings:** `x402/exact/sui`.

**Values (5):** `decodeSuiTx`, `exactSui`, `suiCarrier`, `suiRecover`, `suiStatus`.

**Types (8):** `SuiExecuted`, `SuiNetwork`, `SuiPayload`, `SuiReader`, `SuiRef`, `SuiStatus`, `SuiTx`, `SuiUnsigned`.

## `@integraledger/lcp/svm`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the digest of the message the payer signed, settlement read through a bounded reader, and the payment-channels program's pieces: its instructions and PDAs, the voucher, the session salt and proof, and the channel's status read.

```ts no-check
import { ATA_PROGRAM, buildChannelMessage, buildSvmMessage, … } from "@integraledger/lcp/svm";
```

**Values (32):** `ATA_PROGRAM`, `buildChannelMessage`, `buildSvmMessage`, `channelInstruction`, `channelPda`, `channelVoucherMessage`, `COMPUTE_BUDGET`, `decodeSvmTx`, `findPda`, `isKey`, `MEMO_V3`, `MEMO_V4`, `OPEN_DISCRIMINATOR`, `openInstructionData`, `openOf`, `PAYMENT_CHANNELS`, `RENT_SYSVAR`, `SEAL_DISCRIMINATOR`, `sessionProof`, `sessionSalt`, `SETTLE_AND_SEAL_DISCRIMINATOR`, `solanaVoucher`, `svmCarrier`, `svmChannelStatus`, `svmDigest`, `svmLocate`, `svmNonceMoved`, `svmRecover`, `svmStatus`, `SYSTEM`, `TOKEN`, `TOKEN_2022`.

**Types (13):** `ChannelBuildInput`, `ChannelIx`, `ChannelStatus`, `SolanaNetwork`, `SvmBuildInput`, `SvmCloseRef`, `SvmCloseStatus`, `SvmLanded`, `SvmNonce`, `SvmReader`, `SvmRef`, `SvmStatus`, `SvmTx`.

## `@integraledger/lcp/tempo`

Tempo rail pieces: the `0x76` transaction's calls, the TIP-20 `transferWithMemo` calldata, the TIP-20 channel reserve's descriptor and ids, and the account keychain's key authorizations. Tempo serves eip155 JSON-RPC, so the reader is `EvmReader`. Nothing here throws on a caller's value; refusals are values.

```ts no-check
import { ACCESS_KEY_SPEND_TOPIC, ACCOUNT_KEYCHAIN, CHANNEL_CLOSED_V1_TOPIC, … } from "@integraledger/lcp/tempo";
```

**Values (21):** `ACCESS_KEY_SPEND_TOPIC`, `ACCOUNT_KEYCHAIN`, `CHANNEL_CLOSED_V1_TOPIC`, `CHANNEL_CLOSED_V2_TOPIC`, `CHANNEL_OPENED_V1_TOPIC`, `CHANNEL_OPENED_V2_TOPIC`, `decodeKeyAuthorization`, `decodeTempoTx`, `encodeKeyAuthorization`, `expiringNonceHash`, `KEY_AUTHORIZATION_WITNESS_TOPIC`, `KEY_REVOKED_TOPIC`, `memoCalldata`, `OPEN_V1_SELECTOR`, `OPEN_V2_SELECTOR`, `RECEIVE_POLICY_GUARD`, `tempoChannelId`, `TIP20_CHANNEL_RESERVE`, `TRANSFER_WITH_MEMO_SELECTOR`, `TRANSFER_WITH_MEMO_TOPIC`, `witnessRecover`.

**Types (4):** `KeyAuthorizationUnsigned`, `TempoCall`, `TempoDescriptor`, `TempoKeyAuthorization`.

## `@integraledger/lcp/tron`

Tron: the transaction pieces (protobuf for the fields the profile uses, base58check addresses, the transaction id) and the pairing `x402/exact/tron/lcp-trc20-memo`, whose payer-signed TRC-20 transfer carries the ATR hash as its memo, `raw_data.data`, in LCP string form. Settlement is read by transaction id through a bounded reader.

```ts no-check
import { decodeTronTx, encodeTronRaw, exactTronMemo, … } from "@integraledger/lcp/tron";
```

**Pairings:** `x402/exact/tron/lcp-trc20-memo`.

**Values (12):** `decodeTronTx`, `encodeTronRaw`, `exactTronMemo`, `LCP_TRC20_MEMO`, `TRANSFER_SELECTOR`, `TRANSFER_TOPIC`, `TRIGGER_SMART_CONTRACT`, `TRIGGER_URL`, `tronAddress`, `tronCarrier`, `tronRecover`, `tronStatus`.

**Types (7):** `TronInfo`, `TronNetwork`, `TronRaw`, `TronReader`, `TronRef`, `TronStatus`, `TronUnsigned`.

## `@integraledger/lcp/tvm`

TON: the pairing `x402/exact/tvm`. The ATR hash rides in the scheme's `extra.forwardPayload` as a TEP-74 text comment holding its LCP string. The payer's W5 wallet signs a request whose one Jetton transfer carries that payload; settlement is read from the W5 wallet's transaction with that request and the Jetton wallets' transactions it led to, through a bounded reader.

```ts no-check
import { exactTvm, lcpComment, OP, … } from "@integraledger/lcp/tvm";
```

**Pairings:** `x402/exact/tvm`.

**Values (6):** `exactTvm`, `lcpComment`, `OP`, `tvmCarrier`, `tvmRecover`, `tvmStatus`.

**Types (7):** `TonCell`, `TonTx`, `TvmNetwork`, `TvmReader`, `TvmRef`, `TvmStatus`, `TvmUnsigned`.

## `@integraledger/lcp/ucp`

UCP checkouts and bookings, and four pairings: the ATR hash and link as one `links[]` entry of type `legal_context` in the checkout response. The `ap2-mandate` pairings read the hash from the checkout JWT presented beside the buyer's checkout mandate, after AP2's `checkout_hash` check, the mandate presented alone or last in AP2's chain after the open mandate; the `unsigned` pairings have nothing signed to read. Nothing here takes a key, signs, or verifies a signature, a `cnf` delegation or a link between chained mandates.

```ts no-check
import { ap2Mandate, bookingAp2Mandate, bookingUnsigned, … } from "@integraledger/lcp/ucp";
```

**Pairings:** `ucp/booking/ap2-mandate`, `ucp/booking/unsigned`, `ucp/checkout/ap2-mandate`, `ucp/checkout/unsigned`.

**Values (8):** `ap2Mandate`, `bookingAp2Mandate`, `bookingUnsigned`, `issuedDigest`, `legalContextLink`, `LINK_TYPE`, `tie`, `unsigned`.

**Types (7):** `BookingOption`, `Checkout`, `CheckoutOption`, `Link`, `UcpBinding`, `UcpOffer`, `Unsigned`.

## `@integraledger/lcp/x402`

x402 v2 documents, the request commitment, and the x402 pairings on eip155 chains: `exact` over EIP-3009, Permit2 and ERC-7710 (with its salt level), `upto` over Permit2, and `auth-capture` over EIP-3009 and Permit2. The ATR hash is advertised in the challenge's `extensions.legalContext`; each pairing's `pattern` record states how the pairing binds it.

```ts no-check
import { authCaptureEip3009, authCapturePermit2, exactEip3009, … } from "@integraledger/lcp/x402";
```

**Pairings:** `x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2`, `x402/exact/eip155/eip3009`, `x402/exact/eip155/erc7710`, `x402/exact/eip155/erc7710-salt`, `x402/exact/eip155/permit2`, `x402/upto/eip155/permit2`.

**Values (13):** `authCaptureEip3009`, `authCapturePermit2`, `exactEip3009`, `exactErc7710`, `exactErc7710Salt`, `exactPermit2`, `issuedDigest`, `LEGAL_CONTEXT`, `LEGAL_CONTEXT_SCHEMA`, `pairingOfPayment`, `requestCommitment`, `tie`, `uptoPermit2`.

**Types (12):** `Eip3009Payment`, `Eip3009TypedData`, `HttpRequest`, `LcpPattern`, `PaymentPayload`, `PaymentRequired`, `PaymentRequirements`, `RequestCommitment`, `Unsigned`, `X402Choice`, `X402Offer`, `X402Unsigned`.

## `@integraledger/lcp/x402-batch-settlement`

x402 `batch-settlement`: one ATR per channel. On EVM the ATR hash is the channel configuration's `salt`, which the channel id commits to and every signature signs; on Solana it is the opening transaction's seller Memo instruction (`extra.memo`), beside x402's receiver-authorizer binding memo; on Cloudflare it rides the echoed `extensions.legalContext` of each request, with no channel.

```ts no-check
import { BATCH_SETTLEMENT, batchChannelCreated, batchChannelId, … } from "@integraledger/lcp/x402-batch-settlement";
```

**Pairings:** `x402/batch-settlement/cloudflare`, `x402/batch-settlement/eip155`, `x402/batch-settlement/solana`.

**Values (13):** `BATCH_SETTLEMENT`, `batchChannelCreated`, `batchChannelId`, `batchCloudflare`, `batchEvm`, `batchSvm`, `CHANNEL_CONFIG_TYPEHASH`, `CHANNEL_CREATED_TOPIC`, `DEPOSITED_TOPIC`, `ERC3009_DEPOSIT_COLLECTOR`, `erc3009DepositNonce`, `PERMIT2_DEPOSIT_COLLECTOR`, `VOUCHER_TYPEHASH`.

**Types (8):** `BatchEvmOpen`, `BatchSvmOpen`, `BatchUnsigned`, `BatchWithin`, `ChannelConfig`, `ChannelMembers`, `Eip712Request`, `SigningRequest`.

## `@integraledger/lcp/x402-exact-solana`

The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement.

```ts no-check
import { exactSvm } from "@integraledger/lcp/x402-exact-solana";
```

**Pairings:** `x402/exact/solana`.

**Values (1):** `exactSvm`.

**Types (1):** `SvmUnsigned`.

## `@integraledger/lcp/x402-exact-stellar`

The `x402/exact/stellar` pairing: the ATR hash advertised in the challenge's `extensions.legalContext`, and its first 8 bytes carried as the muxed id of the option's `payTo`, which the payer signs as the Soroban `transfer`'s `to`.

```ts no-check
import { exactStellar } from "@integraledger/lcp/x402-exact-stellar";
```

**Pairings:** `x402/exact/stellar`.

**Values (1):** `exactStellar`.

## `@integraledger/lcp/x402-exact-xrpl`

The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the payer signs with a single key as the Payment's `InvoiceID`, read back from the signed blob, and settlement read by the blob's hash.

```ts no-check
import { exactXrpl } from "@integraledger/lcp/x402-exact-xrpl";
```

**Pairings:** `x402/exact/xrpl`.

**Values (1):** `exactXrpl`.

## `@integraledger/lcp/x402-upto-solana`

The `x402/upto/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the one Memo instruction of the transaction that opens a one-request payment channel escrowing the signed maximum; read back from that transaction, and settlement read from the opening.

```ts no-check
import { uptoSvm } from "@integraledger/lcp/x402-upto-solana";
```

**Pairings:** `x402/upto/solana`.

**Values (1):** `uptoSvm`.

**Types (2):** `UptoSvmChoice`, `UptoSvmPayload`.

## `@integraledger/lcp/xrpl`

XRP Ledger rail pieces: the signed Payment blob, its `InvoiceID` carrying the ATR hash in each scheme's form, the transaction hash computed from the blob, settlement read by that hash through a bounded reader, and the payment channel's id, claim and opening read.

```ts no-check
import { decodeBlob, mppInvoiceId, x402InvoiceId, … } from "@integraledger/lcp/xrpl";
```

**Values (8):** `decodeBlob`, `mppInvoiceId`, `x402InvoiceId`, `XRPL_MAX_DEPTH`, `xrplChannelId`, `xrplClaim`, `xrplOpenStatus`, `xrplStatus`.

**Types (9):** `XrplCloseRef`, `XrplCloseStatus`, `XrplLanded`, `XrplNetwork`, `XrplReader`, `XrplRef`, `XrplStatus`, `XrplTxJson`, `XrplUnsigned`.

