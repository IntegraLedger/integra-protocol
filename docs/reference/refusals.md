---
title: Refusal codes
description: Every refusal code @integraledger/lcp returns, with its meaning.
---

# Refusal codes

Every function in this package whose type carries a refusal answers a failure with a value, `{ refused: true, code }`,
and every code is `<namespace>/<reason>` ([Refusals](../concepts/refusals.md)). A `recover` given a ref or reader that
is not an object, or a ref whose transaction id is not in its rail's form, refuses with nothing read, with the code it
gives a reader for another network.
The writers whose type carries no refusal, such as `toLcpString`, throw a
`TypeError` on an argument outside their type instead ([What throws](../concepts/refusals.md#what-throws)).
This page lists all 497 codes the package can return, by namespace. CI checks that every `refusal(…)` call in the
source passes its code as a string literal, that this page lists exactly those codes, each once, and that this total
and the namespace counts below match its rows.

A meaning that begins **Read to repeat.** is that of a code `readToRepeat` answers true for: the answer rests on a read
of the rail that may answer differently later, with nothing the caller must change, so the caller asks again later
([Reads to repeat](../concepts/refusals.md#reads-to-repeat)). No other code is a read to repeat: `wrong-reader` and
`read-first` codes are calls the caller changes. `node scripts/docs-reference.mjs` writes the marks from the set
`readToRepeat` answers from, and CI checks that they match it.

| Namespace | Codes | Returned by |
|---|---|---|
| [`core`](#core) | 6 | The core: `assemble` and the JSON checks under it. |
| [`discovery`](#discovery) | 20 | The discovery document (`@integraledger/lcp/discovery`). |
| [`x402`](#x402) | 31 | x402 documents, the request commitment, and the checks every x402 pairing shares (`@integraledger/lcp/x402` and the x402 pairings on each rail). |
| [`mpp`](#mpp) | 51 | MPP challenges and credentials, and the checks every MPP pairing shares (`@integraledger/lcp/mpp`). |
| [`ack`](#ack) | 10 | ACK Payment Requests and receipts (`@integraledger/lcp/ack`). |
| [`acp`](#acp) | 15 | ACP checkout sessions and delegated payments (`@integraledger/lcp/acp`). |
| [`ap2`](#ap2) | 17 | AP2 checkouts, Checkout Mandates and the SD-JWT reader under them (`@integraledger/lcp/ap2`, and the AP2 Mandate pairings of `@integraledger/lcp/ucp`). |
| [`ucp`](#ucp) | 13 | UCP checkouts and bookings (`@integraledger/lcp/ucp`). |
| [`card`](#card) | 25 | Visa TAP, Mastercard Verifiable Intent and the plain card checkout (`@integraledger/lcp/card`). |
| [`a2a`](#a2a) | 6 | The A2A extension (`@integraledger/lcp/a2a`). |
| [`evm`](#evm) | 16 | EVM chains: typed data, logs and the settlement read (`@integraledger/lcp/evm`, and the EVM pairings of `@integraledger/lcp/x402`, `@integraledger/lcp/x402-batch-settlement` and `@integraledger/lcp/mpp`). |
| [`tempo`](#tempo) | 19 | Tempo: transactions, memos, channels and key authorizations (`@integraledger/lcp/tempo`, and the MPP Tempo pairings and `keySearch` in `@integraledger/lcp/mpp`). |
| [`svm`](#svm) | 29 | Solana (`@integraledger/lcp/svm` and the Solana pairings). |
| [`stellar`](#stellar) | 19 | Stellar (`@integraledger/lcp/stellar` and the Stellar pairings). |
| [`xrpl`](#xrpl) | 22 | The XRP Ledger (`@integraledger/lcp/xrpl` and the XRPL pairings). |
| [`hedera`](#hedera) | 21 | Hedera (`@integraledger/lcp/hedera`, and the MPP Hedera pairings and challenges in `@integraledger/lcp/mpp`). |
| [`avm`](#avm) | 13 | Algorand (`@integraledger/lcp/avm`). |
| [`aptos`](#aptos) | 6 | Aptos (`@integraledger/lcp/aptos`). |
| [`cardano`](#cardano) | 12 | Cardano (`@integraledger/lcp/cardano`). |
| [`casper`](#casper) | 13 | Casper (`@integraledger/lcp/casper`). |
| [`ccd`](#ccd) | 17 | Concordium (`@integraledger/lcp/ccd`). |
| [`near`](#near) | 16 | NEAR (`@integraledger/lcp/near`, and `chargeNearIntents` in `@integraledger/lcp/mpp`). |
| [`polkadot`](#polkadot) | 19 | Polkadot Asset Hub (`@integraledger/lcp/polkadot`). |
| [`starknet`](#starknet) | 15 | Starknet (`@integraledger/lcp/starknet`). |
| [`sui`](#sui) | 11 | Sui (`@integraledger/lcp/sui`). |
| [`tron`](#tron) | 15 | Tron (`@integraledger/lcp/tron`). |
| [`tvm`](#tvm) | 15 | TON (`@integraledger/lcp/tvm`). |
| [`ln`](#ln) | 19 | Lightning: BOLT11 invoices and the Lightning pairings (`@integraledger/lcp/lightning`). |
| [`stacks`](#stacks) | 6 | Stacks (`@integraledger/lcp/stacks`, and `chargeUsdcStacks` in `@integraledger/lcp/mpp`). |

## core

The core: `assemble` and the JSON checks under it.

| Code | Meaning |
|---|---|
| `core/binding-not-json` | `assemble` refuses an `id` that is not a string, or a binding value that is not serialisable JSON with safe-integer numbers and at most 64 levels of nesting. |
| `core/content-not-json` | `assemble` refuses a `content` that is not an array, or party content that is not a `Uint8Array` holding exactly one JSON value, and `canonicalJson` and `digestJson` refuse a value that is not JSON (deeper than 64 levels, a non-finite number, a string with an unpaired surrogate, or a non-JSON type). |
| `core/slot-duplicate` | `assemble` refuses two party slots with the same name. |
| `core/slot-name` | `assemble` refuses a binding or a party slot that is not an array of two, or a binding slot or party slot name that is not a string of 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-` starting with a letter or digit. |
| `core/slot-reserved` | `assemble` refuses a slot named `atrVersion` or `id`, or a party slot that reuses the binding slot's name. |
| `core/too-large` | `assemble` refuses a `maxBytes` limit that is not a non-negative safe integer, more than 64 party slots, or an ATR whose bytes would exceed the limit (at most 1 MiB). |

## discovery

The discovery document (`@integraledger/lcp/discovery`).

| Code | Meaning |
|---|---|
| `discovery/atr-hash-malformed` | The discovery document's `atrHash` is not `0x` followed by 64 hex digits. |
| `discovery/clause-id-malformed` | The discovery document's `disputeResolution.clauseId` is not `sha256:0x` followed by 64 hex digits. |
| `discovery/member-malformed/acceptanceRequired` | `parse` or `emit` finds the discovery document's `acceptanceRequired` present but not a boolean. |
| `discovery/member-malformed/api` | `parse` or `emit` finds the discovery document's `api` present but not a non-empty string. |
| `discovery/member-malformed/contact` | `parse` or `emit` finds the discovery document's `contact` present but not an object. |
| `discovery/member-malformed/contact.legal` | `parse` or `emit` finds the discovery document's `contact.legal` present but not a non-empty string. |
| `discovery/member-malformed/contact.technical` | `parse` or `emit` finds the discovery document's `contact.technical` present but not a non-empty string. |
| `discovery/member-malformed/disputeResolution` | `parse` or `emit` finds the discovery document's `disputeResolution` present but not an object. |
| `discovery/member-malformed/disputeResolution.catalog` | `parse` or `emit` finds the discovery document's `disputeResolution.catalog` present but not a non-empty string. |
| `discovery/member-malformed/disputeResolution.contact` | `parse` or `emit` finds the discovery document's `disputeResolution.contact` present but not a non-empty string. |
| `discovery/member-malformed/disputeResolution.jurisdiction` | `parse` or `emit` finds the discovery document's `disputeResolution.jurisdiction` present but not a non-empty string. |
| `discovery/member-malformed/disputeResolution.method` | `parse` or `emit` finds the discovery document's `disputeResolution.method` present but not a non-empty string. |
| `discovery/member-malformed/disputeResolution.source` | `parse` or `emit` finds the discovery document's `disputeResolution.source` present but not a non-empty string. |
| `discovery/member-malformed/returns` | `parse` or `emit` finds the discovery document's `returns` present but not a non-empty string. |
| `discovery/member-malformed/terms` | `parse` or `emit` finds the discovery document's `terms` present but not a string. |
| `discovery/member-malformed/termsFormat` | `parse` or `emit` finds the discovery document's `termsFormat` present but not a non-empty string. |
| `discovery/not-json-object` | `parse` refuses an input that is not a `Uint8Array`, or bytes that are not UTF-8 JSON or whose value is not an object, and `emit` refuses a document that is not an object. |
| `discovery/terms-missing` | The discovery document has no `terms` member. |
| `discovery/terms-not-https` | The discovery document's `terms` is a string that the package's https-link rule (`isHttpsLink`) refuses: not an absolute URL of scheme `https` with a host and no userinfo, or holding whitespace, a control character or a backslash, a host name over 253 characters or a port above 65535, or not well-formed UTF-16. |
| `discovery/too-large` | `parse` refuses bytes that exceed 65536, and `emit` refuses a document whose written bytes exceed 65536. |

## x402

x402 documents, the request commitment, and the checks every x402 pairing shares (`@integraledger/lcp/x402` and the x402 pairings on each rail).

| Code | Meaning |
|---|---|
| `x402/channel-id-mismatch` | The EVM batch pairing finds that the voucher's `channelId` is not the id computed from the payment's channel config, or `buildWithin` is given a channel config whose `salt` is not H. |
| `x402/channel-kind-unknown` | The batch pairing's `channel.kind` cannot classify the payment as an opening, a payment within the channel, or a close (an unknown payload `type`, or an SVM deposit whose channel instruction is neither `open` nor `top_up`). |
| `x402/delegation-empty` | At the ERC-7710 salt level, the payment's permission context decodes to no delegations. |
| `x402/deposit-authorization` | The EVM batch opening's `deposit.authorization` is not an object carrying exactly one of `erc3009Authorization` and `permit2Authorization`. |
| `x402/escrow-not-canonical` | An `auth-capture` option's `extra.authCaptureEscrow` is present but is not the address of the commerce-payments escrow's v1.1 or v1.0 deployment; an absent `authCaptureEscrow` means v1.1. |
| `x402/facilitator-missing` | An `upto` option on an EVM network has no valid `extra.facilitatorAddress`. |
| `x402/flow-missing` | The Solana `upto` pairing's `advertise` refuses an option with no `extra.paymentFlow`; an option whose `extra.paymentFlow` is present and not `escrow` is refused `x402/option-not-this-pairing`. |
| `x402/flow-not-carried` | An `auth-capture` option's `extra.paymentFlow` is neither `escrow` nor `authorization`, or its `extra.autoCapture` is `true`. |
| `x402/legal-context-conflict` | `advertise` finds an `extensions.legalContext` already in the document with other values, or the Cloudflare batch pairing's `build` finds that the document's legal context carries a hash other than H. |
| `x402/legal-context-malformed` | The link or agreement URL given to `advertise` is an `https` link over 2048 characters, H is invalid, or the document's `extensions` is not an object; or `extensions.legalContext.info` does not decode as a legal context, has a link over 2048 characters, or carries an agreement URL that is malformed or given in both spellings with different values. |
| `x402/link-not-https` | The link or agreement URL given to `advertise` is not an `https` link, or the link or agreement URL in the document's `extensions.legalContext.info` read by `read`, or the legal context's link read by the Cloudflare batch pairing's `build` and `bound` or by the Stellar pairing's `bound` and `reference`, is an absolute URL of at most 2048 characters whose scheme is not `https`. |
| `x402/manager-not-reference` | At the ERC-7710 salt level, the payment's `delegationManager` is not the reference DelegationManager on a chain where it is deployed. |
| `x402/no-legal-context` | The document or presented payment has no `extensions.legalContext`, or (for the unsigned ERC-7710 level and Aptos `bound`) the echoed `extensions.legalContext.info` does not decode. |
| `x402/no-payable-option` | `read` finds no option in the document's `accepts` that this pairing serves. |
| `x402/nonce-malformed` | A presented `exact` or `upto` Permit2 payment's `nonce` is not a decimal below 2^256 or `0x` followed by 64 hex digits (on `auth-capture`, a nonce that does not decode is `x402/nonce-not-payment`). |
| `x402/nonce-not-payment` | A presented `auth-capture` payment's signed nonce does not decode, or is not the escrow payment hash recomputed from the option's terms, the salt and the expiry. |
| `x402/not-an-opening` | `bound` or `reference` refuses a presented payment that is not a channel opening: its payload `type` is not `deposit`, or its channel instruction is not `open`. |
| `x402/not-bound-within` | The SVM batch pairing's `channel.boundWithin` always refuses, because a voucher within the channel carries no hash. |
| `x402/not-v2` | The payment document given to `advertise`, `read`, `build` or `buildWithin`, or the payment presented to `bound`, `reference`, `authorizer` or a batch pairing's `channel.kind` or `channel.ref` (and the EVM batch pairing's `channel.boundWithin`), is not an object whose `x402Version` is 2, or the choice given to `build` or `buildWithin` is not an object. |
| `x402/option-malformed` | The document's `accepts` is not an array of at most 32 options, an option this pairing names lacks what the pairing needs to pay it (a valid amount, asset, `payTo`, a `maxTimeoutSeconds` that is a positive safe integer, token name and version, or its scheme's required `extra` members; on `auth-capture`, an amount below 2^120, `captureDeadline`, `refundDeadline` and `maxTimeoutSeconds` below 2^48, fees of at most 65,535 basis points, and a non-zero `receiverAuthorizer` where `paymentFlow` is `authorization`; each pairing's `read` offers no such option, and its `bound` and `reference` refuse a payment presented under one), the buyer's choice given to `build` carries an invalid payer address, `now`, key, nonce, sequence, deposit, amount or TON state init (a TON state init that holds libraries, whose fixed prefix is longer than 8 bits, or whose hash, the bits of its fixed prefix aside, is not the wallet's address, is invalid, since TON deploys no wallet from one; on the EVM batch pairing, also an invalid payer authorizer, authorization salt or H, or a payer that is the zero address, which the channel contract's `deposit` refuses in a channel configuration, as it refuses an option whose `payTo` or asset is), `unplaced` is given an option that carries a `refused` member, or `advertise` or `advertiseBeforeCarrier` is given a document, or an option in its `accepts`, that carries one. |
| `x402/option-not-in-document` | The option given to `advertise` or chosen in `build` or `buildWithin` is not one of the document's `accepts`, compared by identity or RFC 8785 form. |
| `x402/option-not-this-pairing` | The option offered, chosen or presented (as the payment's `accepted`) is not one this pairing serves: its scheme, network, asset transfer method, payment flow or fields belong to another pairing or to none. On Aptos, Cardano, Casper, Concordium and Sui this is also the code for an `exact` option on the pairing's network whose other members the pairing cannot pay, a `maxTimeoutSeconds` that is not a positive safe integer included. Every x402 pairing's `bound` holds the presented `accepted` to the option filter its `read` applies: an option the filter does not name is this code, and one it refuses is refused with the filter's code, the one `advertise` gives that option. |
| `x402/payload-malformed` | The presented EIP-3009 payment carries a `refused` member, the presented payment's `accepted` or `payload` is not an object or lacks a member the pairing reads (authorization, Permit2 authorization, delegation fields, transaction, channel config, voucher or deposit), a member does not decode to a valid address, amount, deadline or digest, the EVM batch opening's deposit amount is not a positive decimal below 2^128 (the `uint128` the channel contract's `deposit` takes, which refuses 0), its ERC-3009 `validBefore` or Permit2 `deadline` is not a decimal below 2^256 (the `uint256` the deposit collectors decode), an EVM batch payment's channel configuration, or the one given to its `buildWithin`, is one that `deposit` refuses (a payer, receiver, receiver authorizer or token that is the zero address, or a withdrawal delay outside 900 to 2,592,000 seconds), an EVM batch refund's `amount` is present and is not a positive decimal below 2^128 (the `uint128` the channel contract's `refund` takes, which refuses 0), a Solana batch payment's channel configuration, or the one given to its `buildWithin`, has a `withdrawDelay` that is not a positive integer below 2^32 (the payment-channels program's `grace_period`, a `u32` its `open` refuses as 0) or a `payerAuthorizer` that is not a point on the Ed25519 curve (`open` refuses such an authorized signer), the delegation given to the ERC-7710 `complete` is not an object whose `delegationManager` and `delegator` are addresses, or H given to `build` is not a valid ATR hash. The EVM batch pairing's `build` refuses such an H as `x402/option-malformed`, the Cloudflare batch pairing's as `x402/legal-context-conflict`, and the Concordium, Casper and `x402/exact/lnbtc` pairings' as `ccd/memo-not-lcp`, `casper/payload-malformed` and `ln/no-metadata`; the `x402/exact/lnbtc/invoice-named` pairing's `build` does not read H. |
| `x402/permission-context-malformed` | The ERC-7710 `permissionContext` given to `complete` is not hex of at most 32 KiB, or at the salt level it does not decode as a list of delegations. |
| `x402/request-target-invalid` | `requestCommitment` refuses a request that is not an object, or whose method or target is not a string, whose body is not a `Uint8Array`, or whose target does not start with `/` or contains a character outside visible ASCII. |
| `x402/request-too-large` | `requestCommitment` refuses a request target longer than 8192 characters or a body larger than 1 MiB. |
| `x402/salt-malformed` | A presented `auth-capture` payment's `salt`, or its `saltNonce` when the option binds a receiver authorizer or policy, is not `0x` followed by 64 hex digits. |
| `x402/salt-not-bound` | A presented `auth-capture` payment's `salt` is not the commitment of its `saltNonce` to the option's receiver authorizer and policy, or the payment carries a `saltNonce` under an option that binds neither, whose payload carries none and whose salt is H. |
| `x402/signature-malformed` | A signature given to `complete` or carried in the presented payload is missing, not hex (or bytes) of the length the pairing requires (on Sui, the presented signature is checked only as a non-empty string), or not the number of signatures the request asked for. A Solana pairing's `complete` answers these as `svm/input-malformed`. |
| `x402/signed-not-bound` | `complete` refuses a signed transaction from which the pairing cannot read H back (or its read keys), or which carries a hash other than H. |
| `x402/spender-not-proxy` | A presented Permit2 payment's `spender` is not the x402 Permit2 proxy for its scheme (`exact` or `upto`). |

## mpp

MPP challenges and credentials, and the checks every MPP pairing shares (`@integraledger/lcp/mpp`).

| Code | Meaning |
|---|---|
| `mpp/access-key-malformed` | A Tempo subscription challenge's `methodDetails.accessKey` is not an object with an address `accessKeyAddress` and a `keyType` of `p256`, `secp256k1` or `webAuthn`. |
| `mpp/attribution-malformed` | `checkAttribution` is given a memo that is not 32 bytes of hex, or a Hedera charge's memo is not UTF-8 or not `0x` followed by 64 hex digits. |
| `mpp/attribution-mismatch` | An attribution memo's tag, version, server id for the realm, or nonce for the challenge id is not the expected value. |
| `mpp/carrier-not-challenge` | The hash a carrier holds (the Lightning invoice's description hash, the Solana memo, the XRPL `InvoiceID` or memo, a Hedera or Solana session opening's salt, which on Solana is H's first 8 bytes, or the NEAR Intents challenge's `externalId`) is not the hash the echoed challenge's id derives from; or the MPP Lightning `advertise` or `build` finds that the invoice's description hash is not the H it is given. On the MPP Lightning pairings an invoice whose `h` field is absent or repeated is refused this way, by `pairingsOf` too. |
| `mpp/carrier-occupied` | `advertise` for a card or Stripe charge, the Stripe subscription or a `usdc` Solana charge finds the carrier member already holding a value other than H's LCP string. |
| `mpp/carrier-taken` | A challenge as issued already carries an LCP member (`legalContext`, `legalContextUrl` or `legalContextAgreementUrl`) in its `opaque`, or a Tempo charge challenge whose `amount` is not 0 already has a `methodDetails.memo`. |
| `mpp/chain-id-required` | An EVM session or Tempo subscription challenge has no positive integer `chainId`, a Tempo session challenge's `chainId` is present but not a positive integer, or a Tempo session using `sessionProtocol` `v2` lacks `chainId` or `escrowContract`. |
| `mpp/challenge-malformed` | A challenge is not challenge-shaped: `parseChallenges` finds one of the parameters MPP defines repeated, or a required one (`id`, `realm`, `method`, `intent`, `request`) missing or empty; `place` or `read` is given a document that is not an array or holds more than 32 challenges, or `place` one holding a challenge without string `realm`, `method`, `intent` and `request`; `issuedDigest`, `pairingsOf` or `network` is given a challenge without those members; `challengeId` is given an invalid H or a position outside 0 to 31; a Hedera charge `build` is given a challenge without a string `id` and `realm`; a challenge's `realm` (or, given to a Hedera charge `build`, its `id`) is not a well-formed string (one holding a lone surrogate has no UTF-8 form to hash); H or a value to hash cannot be written in its canonical form; `unplaced` is given a challenge that carries a `refused` member; or `place`, and so each pairing's `advertise` and `advertiseBeforeCarrier`, is given a list holding a challenge that carries one. `read` skips an entry that is not challenge-shaped, and `parseChallenges` drops a parameter MPP does not define, with its repeats. |
| `mpp/channel-named` | A session challenge as issued already names a channel (`channelId`, or an EVM or Tempo `sessionSnapshot`), so it is not a challenge to open one. |
| `mpp/channel-not-bound` | An EVM session opening's `channelId` is not the channel id computed from the payer, payee, token, H as salt, signer, escrow and chain, or a Tempo v1 session opening's `channelId` is not the channel id its open transaction opens, computed the same way from the transaction's sender and the payee, token and signer of its `open` call; that transaction is checked before the `channelId`, so a fault in the transaction gives that fault's code. |
| `mpp/credential-malformed` | A credential is not an object with an echoed challenge carrying an `id`, an optional string `source` and a `payload` object, carries a `refused` member, exceeds the credential size bound, nests more than 16 arrays and objects (the outermost counting 1, whatever the innermost holds), or lacks a payload member the pairing reads (signature, nonce, hash, transaction, salt, channel id or authorization fields) in the required form; or an MPP Solana session opening lacks `authentication` where its challenge's `voucherSigner` is `operator`, or carries one where it is `client` or absent; or an MPP Solana session `close`, given to `channel.kind`, `channel.ref` or `channel.boundWithin`, lacks `voucher` or carries `authentication` where its echoed challenge's `voucherSigner` is `client` or absent, or carries `voucher` or lacks `authentication` where it is `operator`; or a signature or hash given to `complete` is not the required hex, the EVM or Tempo session `buildWithin`'s `complete` is given other than one signature, the `usdc` Stacks `complete` is given bytes that are not a non-empty `Uint8Array` within the size bound, or the `usdc` Gateway `complete` is given a burn intent that is not an object or an empty `source`, network or `maxFee`; or the EVM session `build`'s `voucher` is given a value that is not hex bytes; or the channel given to a session pairing's `closeRef` is not a channel id in its rail's form; or the Lightning `build` choice has no challenge with a string `id`. |
| `mpp/credential-type` | The credential's payload `type` is not one the pairing accepts (such as `transaction`, `hash`, `authorization`, `permit2`, `transfer`, `bundle` or `signature`), or is `hash` on an MPP Stellar charge whose request sets `feePayer` to `true`, where the Stellar charge forbids push mode. |
| `mpp/credential-types` | The challenge's `credentialTypes` is not a non-empty array of types the method defines, or leaves no pairing (EVM `splits` allow only Permit2), or the credential type the buyer asks a session `build` for is not one the challenge lists. |
| `mpp/escrow-malformed` | An EVM or Tempo session challenge's `methodDetails.escrowContract` is not an address. |
| `mpp/expires-required` | The challenge's `expires` is not a valid RFC 3339 date-time where the function reads it, or the challenge has no `expires` where it is needed: in the challenge's checks, when every pairing the challenge offers needs it (each one whose `build` writes it into what the payer signs, and the NEAR Intents and XRP Ledger charges, whose drafts require it). `bound`, `reference`, `fetchPresented` and a session's `channel.ref` given an opening hold the echoed challenge to those checks, and a session's `closeRef` the issued one. |
| `mpp/gateway-unread` | The `usdc` Gateway credential's `authorization` is not a single `circle-gateway-v1` signed burn intent whose spec carries a bytes32 `salt`, a decimal value and readable signer and recipient accounts, and whose burn intent carries a decimal `maxFee`. |
| `mpp/header-malformed` | `parseChallenges` refuses field values that are not an array of strings of at most 8192 characters each, that do not parse by RFC 9110's challenge grammar, or that carry more than 32 `Payment` challenges. |
| `mpp/id-not-ours` | A challenge id is not the base64url of an ATR hash in the form this package writes it (with a position 0 to 31, or bare for a Tempo subscription), or the id does not derive from H given to `build`, or a held session opening is bound to a hash other than H. |
| `mpp/input-malformed` | The buyer's input to `build` or `buildWithin` is not what the pairing needs: no chosen challenge object, or an invalid payer address, token domain, spender, client id (a Tempo client id that is not a well-formed string included), deposit, signer, cumulative amount, fee, key or other value the pairing reads; or an EVM charge challenge's `amount` less its `splits` is not above zero, which `permit2` cannot pay, where `permit2` is the only pairing it offers (`pairingsOf` leaves `permit2` out where another stays offered), or a Tempo charge challenge's is not, which leaves its primary transfer nothing (`pairingsOf` included); or the account given to `mpp/subscription/tempo`'s `closeRef` is not an address; or `evmChannelId` is given a payer, payee, token, signer or escrow that is not an address, a salt that is not a 32-byte hash or a chain id that is not a positive safe integer, or `usdcGatewaySalt` an input that is not an object whose salt inputs are strings; or `xrplChannelId` or `xrplClaim` is given a malformed address, sequence, channel id or amount, as the XRPL session's `build` gives them the payer; or the H given to `mpp/subscription/tempo`'s `keySearch` is not a 32-byte hash. |
| `mpp/legal-context-conflict` | `place` finds LCP members already in the challenge's `opaque` with other values, or `read` finds challenges that carry different hashes, links or agreement URLs. |
| `mpp/legal-context-malformed` | The link or agreement URL given to `place` is an `https` link over 2048 characters, or `read` finds a challenge whose `legalContextUrl` or `legalContextAgreementUrl` is not a usable `https` URL of at most 2048 characters (and, for the link, no challenge reads). |
| `mpp/link-not-https` | The link or agreement URL given to `place` is not an `https` link, or the `legalContextAgreementUrl` that `read` finds beside a link that reads, or a `legalContextUrl` that `read` finds when no challenge reads, is an absolute URL of at most 2048 characters whose scheme is not `https`. |
| `mpp/metadata-malformed` | A Stripe challenge's `methodDetails.metadata` is not an object within Stripe's bounds (key count including the one `advertise` adds, key length and characters, string values of bounded length). |
| `mpp/modes-pull-only` | A Tempo charge challenge whose `amount` is not 0 leaves no mode to pay in: its `supportedModes` omits `pull`, and either omits `push` or the challenge sets `feePayer` to `true`. |
| `mpp/network-unnamed` | `network` gives no CAIP-2 network for a Lightning, card or Stripe challenge (a Lightning charge whose `methodDetails.network` names one included), or for a `usdc` Gateway challenge. |
| `mpp/no-legal-context` | `read` finds no challenge whose `opaque` carries an LCP hash and a link and whose id derives from that hash. |
| `mpp/no-signed-place` | `bound` of the EVM `transaction` and `hash` charge pairings, and `build` and `bound` of the card and Stripe pairings, refuse every payment, because nothing the buyer signs carries H; `bound` first holds the echoed challenge to the pairing's filter, whose refusal it gives. |
| `mpp/nonce-not-challenge-hash` | The EVM `authorization` credential's `nonce` is not keccak256 of the challenge's id and realm. |
| `mpp/nonce-not-channel` | An EVM session opening of type `authorization` carries a `nonce` other than the one derived from the payer, recipient, currency, H and signer. |
| `mpp/nonce-not-usdc-derivation` | The `usdc` EVM credential's `nonce` is not the `usdcNonce` derived from the challenge's id, realm and request hash. |
| `mpp/not-an-opening` | The session credential presented as the opening is not one: its action is not `open` (EVM, where a `voucher` carrying a `deposit` whose action is `open` also counts, and Tempo), or its payload `type` is not the opening's (`transaction` on Tempo, `keyAuthorization` on a Tempo subscription). |
| `mpp/not-bound-within` | `channel.boundWithin` refuses a payment within the channel that carries no hash: an EVM session, a Tempo session under `sessionProtocol` `v1`, a Tempo subscription, a Hedera or XRPL session, a Solana payment other than `use`, a Lightning bearer or top-up, or a Stripe renewal. |
| `mpp/not-this-pairing` | The challenge's intent and method name no pairing this package defines, the challenge (offered, chosen, held or echoed in a credential) does not offer the pairing whose function was called, an echoed challenge's intent and method (on `usdc`, the profile `methodDetails.type` names) are not the pairing's, or `place` finds no challenge in the document whose bound members equal the option. |
| `mpp/opaque-malformed` | The challenge's `opaque` does not decode as a base64url JSON object of strings, or the `opaque` that `place` would write is larger than 8 KiB. |
| `mpp/opaque-not-this-hash` | The echoed challenge has no `opaque`, or its `opaque` does not carry a `legalContext` equal to the hash its id derives from. |
| `mpp/receipt-malformed` | The Stripe subscription's activation receipt is not a successful `stripe` receipt with a Stripe subscription ID of 1 to 255 visible ASCII characters. |
| `mpp/receipt-missing` | The Stripe subscription's `channel.ref` is given no activation receipt. |
| `mpp/request-malformed` | A challenge's `request` does not decode as a base64url JSON object of at most 8 KiB, the base64url without padding in its canonical form (RFC 4648 §3.5), its `methodDetails` is not an object, a member its intent and method require (amount, currency, recipient, addresses, the NEAR Intents origin network, period, channel id or profile fields; on the card charge only `externalId`, and on the Stripe charge none) is missing or malformed, or the request re-encoded with the carrier placed would exceed 8 KiB; an XRPL session's `recipient` is not a classic address whose checksum holds, or a Tempo subscription's period is 2^64 seconds or more or its `subscriptionExpires` is before 1970. `bound`, `reference` and `fetchPresented` hold the echoed challenge to these checks, the pairing's filter, except a `fetchPresented` given a signed transaction, which returns it as given. |
| `mpp/request-not-jcs` | A `usdc` EVM or Gateway challenge's decoded `request` bytes are not the RFC 8785 form of their own parse, which its derivations hash, wherever the challenge is checked (`pairingsOf` included), or `usdcRequestHash` is given such bytes. |
| `mpp/salt-not-this-hash` | An EVM session opening's `salt`, or its Permit2 witness `salt`, is not the hash the echoed challenge's id derives from. |
| `mpp/salt-not-usdc-derivation` | The `usdc` Gateway credential's TransferSpec `salt` is not the `usdcGatewaySalt` derived from the challenge and the credential's own values. |
| `mpp/session-action` | A session credential's or `buildWithin` input's `action` is not one the pairing's draft defines: `open`, `topUp`, `voucher` and `close` on the EVM, Tempo and Hedera sessions, those and `use` on the Solana session, `open`, `voucher` and `close` on the XRPL session, and `open`, `bearer`, `topUp` and `close` on the Lightning session; or `buildWithin` is given `open`; a Hedera, Solana or XRPL credential presented as an opening, or the opening given to the Solana session `build`'s `complete`, does not have `action` `open`; or an MPP Solana session `voucher` whose echoed challenge's `voucherSigner` is `operator`, or `use` whose echoed challenge's `voucherSigner` is `client` or absent, is given to `channel.kind`, `channel.ref` or `channel.boundWithin`; or the Tempo subscription's `channel.kind` is given a payload whose `type` is not `keyAuthorization`. |
| `mpp/session-protocol` | A Tempo session challenge's `sessionProtocol` is neither `v1` nor `v2`. |
| `mpp/source-required` | The credential's `source` is not a `did:pkh:eip155` DID, whose address the EVM Permit2 `reference` and `authorizer`, the EVM `transaction` and `hash` `reference`, and a `hash`-type EVM session opening take as the payer. |
| `mpp/splits-malformed` | An EVM charge challenge's `methodDetails.splits` is not an array of 1 to 10 entries, each with an address `recipient` and a decimal `amount`; or a Tempo charge challenge's is not an array of 1 to 10 entries, each with an address `recipient`, a decimal `amount` above zero and, when present, a 32-byte hex `memo`, wherever the challenge is checked (`pairingsOf` included). |
| `mpp/stacks-memo-not-h` | The `usdc` Stacks transaction is not a contract call to `transfer` whose fourth argument is `(some H)`. |
| `mpp/stacks-tx-malformed` | The `usdc` Stacks credential's `transactionFormat` is not the one read, or its `transaction` is not base64 of a non-empty Stacks transaction within the size bound that a Stacks node decodes and serializes back to the same bytes, as stacks-core 4.0.5's `StacksTransaction::consensus_deserialize` reads it: each field of a form that deserializer reads, such as a principal as a token transfer's or coinbase's recipient (a Nakamoto coinbase's none or `(some <principal>)`), contract and Clarity names, a multisig authorization's signatures exactly as many as it requires (an order-independent one's at least as many), a VRF proof that parses, and Clarity values nested at most 16 levels, the outermost counting 1, whose type is at most 1,048,576 bytes, with no empty tuple, a tuple's members in name order as bytes and a list's items of a common type. |
| `mpp/usdc-profile` | A `usdc` charge challenge's `methodDetails.type` does not name one of `evm`, `solana`, `stacks` or `gateway`, the named profile's details are not an object, or `methodDetails` also holds another profile's details. |
| `mpp/within-action-not-built` | `buildWithin` is asked for an action the pairing's draft defines within a channel and it does not build (`topUp` on the EVM, Tempo, Hedera and Solana sessions, and `use` on the Solana session), or for a voucher or a close on a Solana channel whose vouchers the operator signs. |
| `mpp/witness-not-challenge-hash` | The EVM `permit2` credential's `witness.challengeHash` is not keccak256 of the challenge's id and realm. |
| `mpp/witness-taken` | `place` refuses a Tempo subscription challenge in a document that holds another Tempo subscription challenge, because both would take the same id derived from H. |

## ack

ACK Payment Requests and receipts (`@integraledger/lcp/ack`).

| Code | Meaning |
|---|---|
| `ack/id-not-lcp` | `read` finds that the Payment Request token's `id` is not an ATR hash in LCP's string form (`lcp:sha256:H`). |
| `ack/legal-context-conflict` | `read` finds that the hash in the body's `legalContext` differs from the hash in the Payment Request token's `id`. |
| `ack/legal-context-malformed` | `advertise` refuses an invalid ATR hash, or a link or agreement URL that is an `https` link over 2048 characters; `read` refuses a body `legalContext` that does not decode (a link that is not `https` included), whose link exceeds 2048 characters, or whose agreement URL is not an `https` link of at most 2048 characters or is given twice with different values. |
| `ack/link-not-https` | The link or agreement URL given to `advertise` is not an `https` link. |
| `ack/no-legal-context` | `read` finds no `legalContext` in the 402 body. |
| `ack/no-signed-place` | ACK defines no payer signature, so `build` and `bound` of `ack/payment-request` always return this refusal. |
| `ack/option-malformed` | `advertise` refuses a payment option that is not an object with a non-empty string `id`, and `unplaced` refuses an option that carries a `refused` member. |
| `ack/receipt-malformed` | `fromReceipt` refuses a `credentialSubject` that is not a serialisable JSON object or whose embedded `paymentRequestToken` is not a token `read` takes or does not carry an `id` in LCP's string form. |
| `ack/token-malformed` | `read` refuses a 402 body that is not a serialisable JSON object, a `paymentRequestToken` that is not a compact JWS, each segment base64url without padding in its canonical form (RFC 4648 §3.5), with a JSON object payload, or a token payload whose `paymentOptions` is not an array. |
| `ack/too-large` | `read` refuses a 402 body over 64 KiB, a token over 16384 characters or more than 16 payment options, and `fromReceipt` refuses a `credentialSubject` over 64 KiB; a body or `credentialSubject` nested more than 64 levels deep is refused the same way. |

## acp

ACP checkout sessions and delegated payments (`@integraledger/lcp/acp`).

| Code | Meaning |
|---|---|
| `acp/allowance-changed` | The `complete` function returned by `build` refuses a `delegate_payment` request that is not an object or whose `allowance` differs from the one built. |
| `acp/allowance-malformed` | `bound` refuses a presented request that is not an object or whose `allowance` is not exactly ACP's six members with `reason` `one_time`. |
| `acp/choice-malformed` | `build` refuses a choice that is not an object, or whose `max_amount`, `currency`, `merchant_id` or `expires_at` is not a non-negative safe integer, a three-letter lowercase code, a non-empty string and an RFC 3339 date-time respectively, or whose allowance has no RFC 8785 form (a `merchant_id` holding an unpaired surrogate). |
| `acp/hash-not-session` | `build` refuses when H is not a valid ATR hash or the chosen session's `id` is not H. |
| `acp/id-conflict` | `advertise` finds that the session already has an `id` other than H. |
| `acp/id-not-hash` | `read` finds that the session's `id` is not an ATR hash, or `bound` finds that the allowance's `checkout_session_id` is not one. |
| `acp/legal-context-conflict` | `advertise` finds a different `metadata.legal_context` already in the session, or `read` finds that the hash in `metadata.legal_context` differs from the session's `id`. |
| `acp/legal-context-malformed` | `advertise` refuses an invalid ATR hash, or an agreement URL that is an `https` link over 2048 characters; `read` refuses a `metadata.legal_context` that does not decode, or whose agreement URL is malformed or given in both spellings with different values. |
| `acp/link-not-https` | The link or agreement URL given to `advertise` is not an `https` link, or one found in `metadata.legal_context` by `read` is an absolute URL whose scheme is not `https`. |
| `acp/no-legal-context` | `read` finds no `metadata.legal_context` in the session. |
| `acp/not-buyer-signed` | `bound` of `acp/checkout/undelegated` always refuses, because nothing the buyer signs names the hash. |
| `acp/nothing-to-sign` | `build` of `acp/checkout/undelegated` always refuses, because a handler that does not require `delegate_payment` gives the buyer nothing to sign. |
| `acp/option-malformed` | `advertise` refuses a handler option that is not an object with a boolean `requires_delegate_payment`, and `unplaced` refuses an option that carries a `refused` member. |
| `acp/session-malformed` | `advertise` or `read` refuses a checkout session that is not a serialisable JSON object, or (in `advertise`) one that carries a `refused` member or whose `metadata` is present but not an object. |
| `acp/too-large` | The checkout session, or the session `advertise` would return, exceeds 1 MiB or is nested more than 64 levels deep, an `https` link given to `advertise` or read from `metadata.legal_context` exceeds 2048 characters, or (in `read`) its `id` is longer than a hash, or the buyer's choice given to `build` has a `merchant_id` over 256 characters or an `expires_at` over 64 characters. |

## ap2

AP2 checkouts, Checkout Mandates and the SD-JWT reader under them (`@integraledger/lcp/ap2`, and the AP2 Mandate
pairings of `@integraledger/lcp/ucp`).

| Code | Meaning |
|---|---|
| `ap2/checkout-hash-mismatch` | `bound` finds that the mandate discloses a `checkout_jwt` different from the presented one. |
| `ap2/checkout-id-missing` | `advertise`, `read` or `build` finds that the checkout payload has no `id`, or that its `id` is not a non-empty string; `bound` does not read the `id`. |
| `ap2/checkout-not-latest` | `bound` finds that the mandate's `checkout_hash` is not the SHA-256 of the presented `checkout_jwt`. |
| `ap2/disclosure-unreferenced` | An SD-JWT of the Checkout Mandate presentation (either hop of a chain) carries a disclosure that no digest in its payload references. |
| `ap2/hash-not-in-checkout` | `build` finds that the hash in the offer's checkout JWT is not H. |
| `ap2/jws-malformed` | A checkout JWT (given to `jwsPayload`, `read`, `build` or `bound`, or as a payload to `advertise`) is not a compact JWS, each segment base64url without padding in its canonical form (RFC 4648 §3.5), whose payload is one JSON object, `advertise` is given a payload that is not a serialisable JSON object or that carries a `refused` member, or `build` is given an offer that is not an object. |
| `ap2/legal-context-conflict` | `advertise` finds a different `legalContext` already in the checkout payload. |
| `ap2/legal-context-malformed` | The agreement URL given to `advertise` is an `https` link over 2048 characters, or H is invalid, or the checkout payload's `legalContext`, as `read`, `build` or `bound` finds it, does not decode (a link that is not `https` included), or, as `read` finds it, has an agreement URL that is not an `https` link of at most 2048 characters or is given in both spellings with different values. |
| `ap2/link-not-https` | The link or agreement URL given to `advertise` is not an `https` link. |
| `ap2/mandate-ambiguous` | The resolved SD-JWT (the last hop of a chain) contains more than one object whose `vct` is `mandate.checkout.1`. |
| `ap2/mandate-malformed` | The Checkout Mandate is not a well-formed SD-JWT presentation (bad segments or disclosures, base64url not in its canonical form (RFC 4648 §3.5) included, a digest referenced twice, or a digest that names no three-element disclosure listed twice in `_sd`), or is a chain joined by `~~` with more than two hops or a hop that is not one, its `checkout_hash` is not 43 base64url characters, its `checkout_jwt` is present but not a string, the presentation given to `bound` is not an object, or `checkoutJwtOf` finds no disclosed `checkout_jwt`. |
| `ap2/no-checkout-mandate` | The resolved SD-JWT (the last hop of a chain) contains no object whose `vct` is `mandate.checkout.1`. |
| `ap2/no-legal-context` | The checkout payload read by `read`, `build` or `bound` has no `legalContext` member. |
| `ap2/option-malformed` | `advertise` refuses an option that is not an object with exactly one member, `checkout`, a string of 1 to 256 characters, and `unplaced` refuses an option that carries a `refused` member. |
| `ap2/option-not-this-checkout` | `advertise` finds that the option's `checkout` is not the payload's `id`. |
| `ap2/sd-alg-unsupported` | The `_sd_alg` of an SD-JWT of the Checkout Mandate presentation names a digest algorithm other than `sha-256`. |
| `ap2/too-large` | A checkout JWT, Checkout Mandate or checkout payload exceeds 1 MiB or nests deeper than 64 levels, an SD-JWT of a mandate carries too many disclosures or nests them too deeply, a checkout `id` is longer than 256 characters, or an `https` link given to `advertise` or read from the checkout payload's `legalContext` is longer than 2048 characters. |

## ucp

UCP checkouts and bookings (`@integraledger/lcp/ucp`).

| Code | Meaning |
|---|---|
| `ucp/already-signed` | `advertise` refuses a checkout that already carries `ap2.merchant_authorization`, because the link must be placed before the business signs. |
| `ucp/ap2-not-active` | An AP2 Mandate pairing's `read` or `build` finds no `ap2.merchant_authorization` in the checkout in detached JWS form. |
| `ucp/checkout-malformed` | The checkout (or booking) is not a serialisable JSON object with a non-empty string `id`, its `links` is present but not an array, the checkout given to `advertise` carries a `refused` member, or the offer given to `build` is not an object. |
| `ucp/hash-not-in-checkout` | The AP2 Mandate pairing's `build` finds that the checkout's `legal_context` link carries a hash other than H. |
| `ucp/legal-context-conflict` | The checkout has more than one `legal_context` link, `read` finds more than one `legal_context_agreement` link, or `advertise` finds an existing `legal_context` link whose values differ from the ones it would write, or, given an agreement URL, finds more than one `legal_context_agreement` link, one whose `url` differs from it, or an existing `legal_context` link with no agreement link. |
| `ucp/legal-context-malformed` | The `legal_context` link's `title` is not an ATR hash in LCP's string form or its `url` is not a usable `https` URL, `read` finds a `legal_context_agreement` link whose `url` is not a usable `https` URL of at most 2048 characters, or the agreement URL given to `advertise` is an `https` link over 2048 characters or the H given to it is invalid. |
| `ucp/link-not-https` | The link or agreement URL given to `advertise` is not an `https` link, or the `url` of the checkout's `legal_context` link, or the `url` of its `legal_context_agreement` link read by `read`, is an absolute URL whose scheme is not `https`. |
| `ucp/no-legal-context` | The checkout has no `links` or no link whose `type` is `legal_context`. |
| `ucp/not-buyer-signed` | `bound` of the unsigned checkout and booking pairings always refuses, because nothing the buyer signs carries the hash. |
| `ucp/nothing-to-sign` | `build` of the unsigned checkout and booking pairings always refuses, because the buyer signs nothing. |
| `ucp/option-malformed` | `advertise` refuses an option that is not an object with exactly one member, `checkout` or `booking` as the pairing requires, a string of 1 to 256 characters, and `unplaced` refuses an option that carries a `refused` member. |
| `ucp/option-not-this-checkout` | `advertise` finds that the option names a checkout or booking other than the document's `id`. |
| `ucp/too-large` | The checkout exceeds 1 MiB as JSON or is nested more than 64 levels deep, its `id` exceeds 256 characters, its `links` holds, or after `advertise` would hold, more than 64 entries, or the `legal_context` link's `url`, or the link given to `advertise`, is an `https` URL over 2048 characters. |

## card

Visa TAP, Mastercard Verifiable Intent and the plain card checkout (`@integraledger/lcp/card`).

| Code | Meaning |
|---|---|
| `card/legal-context-malformed` | The link or agreement URL given to `advertise` is an `https` link over 2048 characters, or H given to `advertise` or to the Visa TAP `build` is invalid, or a `legalContext` read from the shown JSON or a `checkout_jwt` does not decode (a link that is not `https` included), has a link over 2048 characters, or has an agreement URL that is not an `https` link of at most 2048 characters or is given in both spellings with different values. |
| `card/link-not-https` | The link or agreement URL given to `advertise` is not an `https` link. |
| `card/no-legal-context` | The JSON the seller showed (for `card/visa-tap` and `card/seller-reference`) or the payload of a `checkout_jwt` (for Verifiable Intent) has no `legalContext` member. |
| `card/no-signed-place` | `build` and `bound` of `card/seller-reference` always refuse, because nothing the buyer signs carries the hash. |
| `card/option-malformed` | `advertise` refuses a card option that is not an object with a known `scheme` and a `checkout` of 1 to 128 visible ASCII characters, and `unplaced` refuses an option that carries a `refused` member. |
| `card/tap-field-malformed` | The TAP request's `lcpHash` is not an array of strings, or its one line is not an ATR hash. |
| `card/tap-field-missing` | The TAP request carries no `lcp-hash` field line. |
| `card/tap-field-repeated` | The TAP request carries more than one `lcp-hash` field line. |
| `card/tap-hash-not-covered` | An `agent-payer-auth` signature input in the TAP request does not list the `lcp-hash` component without parameters. |
| `card/tap-no-payer-signature` | No signature input in the TAP request has the `agent-payer-auth` tag. |
| `card/tap-signature-input-malformed` | The Visa TAP `bound` refuses a presentation that is not an object, or a `signatureInput` that is not a string parsing as an RFC 9651 dictionary of signature inputs. |
| `card/tap-signature-malformed` | The Visa TAP `bound` refuses a `signature` that is not a string parsing as an RFC 9651 dictionary of byte-sequence signatures. |
| `card/tap-signature-missing` | No `agent-payer-auth` signature input has a matching member in the `Signature` field. |
| `card/too-large` | A `checkout_jwt` exceeds 16384 characters, a Verifiable Intent layer exceeds 65536 characters or 32 disclosures, a decoded payload nests too deeply, a TAP `Signature-Input` or `Signature` field exceeds 8192 characters, 16 members or 32 components, or an `lcp-hash` line exceeds 256 characters. |
| `card/vi-checkout-hash-mismatch` | The checkout mandate's `checkout_hash` is not the digest of its `checkout_jwt`. |
| `card/vi-disclosure-unreferenced` | A Verifiable Intent layer carries a disclosure that no digest in its payload references. |
| `card/vi-key-malformed` | In autonomous mode, L2 does not delegate exactly one open checkout mandate whose `cnf.jwk` is an EC P-256 key with a string `kid`, L1's `cnf.jwk` is not an EC P-256 key, a key's `x` or `y` is not base64url without padding of 32 bytes in its canonical form (RFC 4648 §3.5), or a key cannot be imported for verification. |
| `card/vi-kid-mismatch` | In autonomous mode, the `kid` in L3b's header is not the `kid` of the agent key that L2 delegates. |
| `card/vi-legal-context-conflict` | The Verifiable Intent `build` finds that the hash in the `checkout_jwt` is not H. |
| `card/vi-malformed` | A Verifiable Intent input is not what it must be: the presentation is not an object, a layer or `checkout_jwt` is not a string, not a well-formed compact JWS or SD-JWT, each segment and disclosure base64url without padding in its canonical form (RFC 4648 §3.5), with a JSON object payload, has no disclosures or trailing `~`, has an `_sd_alg` other than `sha-256`, or lacks a `delegate_payload` array of `{"...": digest}` entries. |
| `card/vi-no-checkout-mandate` | A Verifiable Intent layer's `delegate_payload` does not reference exactly one `mandate.checkout.1` mandate. |
| `card/vi-sd-hash-mismatch` | In autonomous mode, L3b's `sd_hash` is not the digest of L2, or L2's `sd_hash` is not the digest of L1. |
| `card/vi-signature-invalid` | In autonomous mode, L3b's ES256 signature does not verify under the key L2 delegates, or L2's under L1's `cnf.jwk`, or a signature is not 64 bytes of base64url. |
| `card/vi-transaction-id-mismatch` | A `mandate.payment.1` mandate in the same layer has no `transaction_id`, or one other than the digest of the checkout mandate's `checkout_jwt`. |
| `card/vi-typ` | A Verifiable Intent layer's header does not have `alg` `ES256` and the expected `typ`, or (in autonomous mode) L3b's header has no string `kid`. |

## a2a

The A2A extension (`@integraledger/lcp/a2a`).

| Code | Meaning |
|---|---|
| `a2a/legal-context-conflict` | `place` finds a different legal context already under the extension URI in the task's `metadata`. |
| `a2a/legal-context-malformed` | `place` refuses a task or `metadata` that is not an object, a task that carries a `refused` member, an invalid ATR hash, or an `https` link over 2048 characters; `read` refuses a value under the extension URI that does not decode as a legal context or whose link exceeds 2048 characters. |
| `a2a/link-not-https` | The link to the seller's copy given to `place` is not an `https` link, or the one found by `read` is an absolute URL whose scheme is not `https`. |
| `a2a/no-legal-context` | `read` finds no legal context under any extension URI in the task's `metadata`. |
| `a2a/no-signed-place` | The exported `binding` value: A2A signs nothing per transaction, so it has no pairing; a caller asked for one can answer with this refusal. |
| `a2a/too-large` | The legal context value written by `place` or found by `read` under the extension URI is larger than 4096 bytes of JSON, or is nested more than 64 levels deep. |

## evm

EVM chains: typed data, logs and the settlement read (`@integraledger/lcp/evm`, and the EVM pairings of
`@integraledger/lcp/x402`, `@integraledger/lcp/x402-batch-settlement` and `@integraledger/lcp/mpp`).

| Code | Meaning |
|---|---|
| `evm/ambiguous` | An EVM `recover` finds more than one candidate hash in a transaction whose block is at or below the reader's `finalized` mark: several distinct `AuthorizationUsed` nonces, several distinct leaf salts, several `ChannelCreated` logs, or, on the Permit2 pairings, several calls of the scheme's x402 proxy, each with its token's `Transfer` from its owner in the receipt, that differ in nonce or owner. |
| `evm/amount-malformed` | An amount given to an EVM typed-data, digest or payment-hash helper is not an unsigned integer within its type's width (uint256, or uint120 for an escrow `maxAmount`). |
| `evm/channel-id-mismatch` | `batchChannelCreated` finds that the channel id computed from a `ChannelCreated` log's data is not the id in its topic. The `x402/batch-settlement/eip155` `recover` answers such a log, read from the chain, `evm/unreadable`. |
| `evm/field-malformed` | A value given to an EVM helper is not what the ABI or EIP-712 type requires: an address, uint256, bytes32, time bound or fee outside its width, a chain id given to `paymentHash` that is not a positive safe integer, an empty or oversized Permit2 batch, a Permit2 batch with no witness, a Permit2 witness that is not an object or whose `type` is not a valid type name, whose `fields` is not an array of objects with a string `name` and `type`, or whose `value` is not an object, a permission context or `ChannelCreated` log that does not decode strictly, a malformed channel config, or an argument to `transferDigest` or `paymentHash` that is not an object; or `authorizationUsed` is given a ref that is not an object or has no well-formed `authorization`, an authorizer that is not an address, or a block that is not a non-negative bigint. |
| `evm/network-malformed` | A network is not an `eip155:<chain id>` CAIP-2 name, or a chain id given to `permit2TypedData` or `batchChannelId` is not a positive safe integer, or the argument to `eip3009TypedData` or `permit2TypedData` is not an object. |
| `evm/no-authorization-use` | `eip3009Recover` finds no `AuthorizationUsed` log from the asset in a transaction whose block is at or below the reader's `finalized` mark. |
| `evm/no-channel-created` | The EVM batch pairing's `recover` finds no `ChannelCreated` log from the batch-settlement contract in a transaction whose block is at or below the reader's `finalized` mark. |
| `evm/no-leaf` | `x402/exact/eip155/erc7710-salt`'s `recover` finds no `RedeemedDelegation` log from the DelegationManager whose delegate is the redeemer or the wildcard, in a transaction whose block is at or below the reader's `finalized` mark. |
| `evm/no-open-call` | The `mpp/session/evm` `recover` finds that the transaction's own call is not an escrow open call (`open`, `openWithAuthorization` or `openWithPermit2`, with a recipient and the leading argument words), or that the receipt, in a block at or below the reader's `finalized` mark, holds no `Transfer` of the call's token from its payer into the called contract. An opening sent through an ERC-4337 EntryPoint, or whose calldata is longer than 131,072 bytes (go-ethereum's transaction pool maximum, the most the read decodes), is refused so: the calldata is the transaction's own, so every read gives the same. |
| `evm/no-permit2-settle` | The Permit2 pairings' `recover`, reading a transaction whose block is at or below the reader's `finalized` mark, finds no call of the scheme's x402 proxy (`settle` or `settleWithPermit`, with an address in the permit's token word and in the owner word) at any offset of the transaction's input with a `Transfer` in the receipt that the call's token emits from the call's owner. A transaction whose input carries the call but whose receipt holds no such `Transfer` is refused so, whether the owner's nonce was spent elsewhere in the block or cancelled by the owner. |
| `evm/nonce-not-used` | The Permit2 pairings' `recover` finds that Permit2 did not mark the proxy call's nonce used for its owner in the receipt's block, at or below the reader's `finalized` mark: the bit is unset at that block, or already set at the block before. |
| `evm/not-final` | **Read to repeat.** A transaction an EVM `recover` reads reverted, or its receipt, its calldata's settle call or Permit2's nonce bitmap does not show the one use the recovery reads, in a block above the reader's `finalized` mark or with a reader that cannot give that mark: a read to repeat, since that block can be replaced. |
| `evm/not-found` | **Read to repeat.** The reader found no receipt for the transaction the reference names, or, where an EVM `recover` reads the transaction itself, no transaction. |
| `evm/reverted` | The transaction an EVM `recover` reads reverted, in a block at or below the reader's `finalized` mark. |
| `evm/unreadable` | **Read to repeat.** The reader threw, or returned a receipt, log, transaction or `eth_call` answer that is not well formed, when an EVM `recover` read the transaction or when `authorizationUsed` made its `eth_call` (an answer that is not one 32-byte word, or for `eip3009` a word other than 0 or 1). For the `x402/batch-settlement/eip155` `recover`, a `ChannelCreated` log from the batch-settlement contract that `batchChannelCreated` refuses is such a log. |
| `evm/wrong-reader` | The reader passed to an EVM `recover` or to `authorizationUsed` is missing or declares a different network than the reference names, or the ref given to an EVM `recover` is not an object or names a `transaction` that is not a 32-byte hash. An EVM `status` gives such a reader pending `unreadable` instead, with nothing read. |

## tempo

Tempo: transactions, memos, channels and key authorizations (`@integraledger/lcp/tempo`, and the MPP Tempo pairings and
`keySearch` in `@integraledger/lcp/mpp`).

| Code | Meaning |
|---|---|
| `tempo/ambiguous` | More than one candidate carries the binding: several `transferWithMemo` calls or logs with the challenge's attribution memo, several `KeyAuthorizationWitness` logs, several accounts whose key authorization carried H, or `ChannelOpened` logs of the TIP-20 channel reserve giving more than one salt. A Tempo `recover` gives it only for a receipt in a block at or below the reader's `finalized` mark, and `fetchPresented` lands such logs only from one. |
| `tempo/descriptor-mismatch` | A Tempo v2 session descriptor is missing or malformed (a non-address party, an invalid salt, nonce hash or chain), its channel id is not the payload's `channelId`, its `operator` is not the echoed challenge's `methodDetails.operator` (the zero address where the challenge names none), or its `salt` is not H, or, on an opening, its `payee`, `operator`, `token` or `authorizedSigner` is not that argument of the `open` call in the opening's transaction, its `payer` is not the address that signed the opening's transaction or its `expiringNonceHash` is not the expiring nonce hash of that transaction under that address. The opening's transaction is checked before its `channelId` and its descriptor, so a fault in the transaction gives that fault's code. |
| `tempo/key-authorization-malformed` | A Tempo key authorization does not encode or decode as the bounded RLP structure (items, limits, scopes, witness and signature), or the subscription credential's `signature` is not a string, or, for the `mpp/subscription/tempo` `reference`, the authorization does not name exactly one token, as its limit and its allowed-call target, and exactly one recipient. |
| `tempo/key-not-authorized` | The Tempo subscription's key authorization authorizes a key other than the echoed challenge's `methodDetails.accessKey`, by its key id or its key type, or names a chain id other than the challenge's `methodDetails.chainId` (`bound`, `reference` and `channel.ref`), or `keySearch` finds that the receipt has no `KeyAuthorized` log registering the reference's access key for the account whose key authorization carried H. |
| `tempo/memo-not-bound` | The signed or landed Tempo transfer carries no `transferWithMemo` to the challenge's currency whose memo is the challenge's attribution memo; `fetchPresented` lands a receipt without exactly one such log only from a block at or below the reader's `finalized` mark. |
| `tempo/no-access-key` | `keySearch` is given a reference with no well-formed access key (key id, token and recipient digest). |
| `tempo/no-witness` | The Tempo subscription's key authorization carries no witness, or a receipt holds no `KeyAuthorizationWitness` log (for `witnessRecover`, in a block at or below the reader's `finalized` mark, or naming H for `keySearch`). |
| `tempo/not-final` | **Read to repeat.** The transaction an MPP Tempo push `hash` credential names, or that a Tempo `recover` reads, reverted, or its receipt holds no single log the read takes H from (for the credential, a `TransferWithMemo` with the challenge's attribution memo; for a `recover`, a `ChannelOpened` salt or a `KeyAuthorizationWitness` log), in a block above the reader's `finalized` mark or with a reader that cannot give that mark: a read to repeat, since that block can be replaced. |
| `tempo/not-found` | **Read to repeat.** The reader found no receipt for the transaction. |
| `tempo/open-ambiguous` | The signed Tempo session opening has more than one `open` call to the challenge's escrow contract. |
| `tempo/open-not-found` | The signed Tempo session opening has no `open` call to the challenge's escrow contract, or the receipt the `mpp/session/tempo` `recover` reads, in a block at or below the reader's `finalized` mark, holds no `ChannelOpened` of the TIP-20 channel reserve, whose data carries the salt (a v1 escrow's `ChannelOpened` carries none). |
| `tempo/read-first` | An MPP Tempo push `hash` credential carries no landed logs yet; the seller reads it with `fetchPresented` before `bound` or `reference`. |
| `tempo/reverted` | The transaction an MPP Tempo push `hash` credential names, or that a Tempo `recover` reads, reverted, in a block at or below the reader's `finalized` mark. |
| `tempo/salt-not-bound` | The salt word of the Tempo session opening's `open` call is not H. |
| `tempo/tx-malformed` | A Tempo transaction does not decode as a type-`0x76` RLP envelope with the expected fields and at most the allowed calls, the signed transaction of an `mpp/charge/tempo/memo` credential or an `mpp/session/tempo` opening is for a chain other than the echoed challenge's `methodDetails.chainId` (where the challenge names none, 42431 on the charge and 4217 on a v1 session), or the signed transaction given to the `mpp/session/tempo` `build`'s `voucher` or `complete`, or to the `mpp/charge/tempo/memo` `build`'s `complete`, does not decode (an empty one among them) or is for a chain other than the chosen challenge's, `memoCalldata` is given an invalid recipient, amount or memo, `expiringNonceHash` is given a sender that is not an address, or a Tempo session opening's `open` call input has the wrong length or a payee, operator, token or signer word that is not an address, or its transaction's signature gives no sender (a keychain signature of type `0x03`, which Tempo's transaction specification rejects from T1C onward ("Keychain"; "Transaction Validation", step 1) and Tempo's node refuses once T1C is active, as it is on chains 4217 and 42431 (tempoxyz/tempo `7d4fd03`, `crates/revm/src/handler.rs` `validate_version` and `crates/hardfork/src/constants.rs`), a form other than the secp256k1, P256, WebAuthn and keychain signatures that specification lists, such as a `0x05` type byte, or a secp256k1 signature that does not recover with its s in the lower half of the order). |
| `tempo/tx-too-large` | A Tempo transaction's wire bytes exceed the size bound. |
| `tempo/unreadable` | **Read to repeat.** The Tempo reader threw, the receipt or its logs are not well formed (on `mpp/charge/tempo/push`, a `TransferWithMemo` log from the currency without a 32-byte sender and recipient topic and an amount word, as `fetchPresented` reads it or as `reference` reads the landed log it matched), or `keySearch` is given an invalid receipt, or finds a `KeyAuthorizationWitness` log naming H whose account topic is not a padded address. |
| `tempo/witness-not-bound` | The Tempo subscription's key authorization witness is not the hash the echoed challenge's id derives from. |
| `tempo/wrong-reader` | The Tempo reader is missing or answers for a different network than the challenge or reference names, or the ref given to a Tempo `recover` is not an object or names a `transaction` that is not a 32-byte hash. |

## svm

Solana (`@integraledger/lcp/svm` and the Solana pairings).

| Code | Meaning |
|---|---|
| `svm/bundle-empty` | An MPP Solana `bundle` credential's `transactions` is empty. |
| `svm/carrier-mismatch` | The option's `extra.memo` or the challenge's `externalId` is not H's LCP string when `build` is called, or the memo in the presented Solana transaction is not the option's `extra.memo` or the challenge's `externalId`. |
| `svm/carrier-not-canonical` | The Solana memo carrying the ATR hash is an LCP string in a spelling other than `toLcpString(h)`, `lcp:sha256:0x` and 64 lowercase hex digits. |
| `svm/carrier-occupied` | `advertise` finds the option's `extra.memo`, or the MPP Solana challenge's `externalId`, already holding a value other than H's LCP string. |
| `svm/channel-id-mismatch` | In the SVM batch pairing, the voucher's `channelId` or the channel instruction's channel account is not the channel PDA derived from the payment's config. |
| `svm/channel-instruction` | The Solana transaction has more than one payment-channels instruction, or its one instruction has an unknown discriminator or the wrong accounts. |
| `svm/channel-mismatch` | The MPP Solana session opening's `channelId` is not the channel account its `open` instruction opens. |
| `svm/err` | The landed Solana transaction failed with an error, read at `finalized`: the one a recovery reads, or the one an MPP Solana `signature` credential names. |
| `svm/input-malformed` | The buyer's input to a Solana `build`, `complete` or message helper is not valid: a payer, key or blockhash that is not a base58 key (on the x402 `batch-settlement` pairing, also a payer authorizer that is not a point on the Ed25519 curve), a token program that is not Token or Token-2022 (on the x402 `upto` and `batch-settlement` pairings, not the option's own), an out-of-range amount, slot or compute budget, a memo to write that is not a well-formed string, a signature that is not 64 bytes or not for a required signer, or a number of signatures other than the request asked for; or an MPP Solana charge challenge (on `usdc`, its Solana profile), wherever it is checked (`pairingsOf` included), carries `splits` or a `confidential` transfer, which are not built, a `recentBlockhash` string that is not a key, or, for a mint, a `decimals` number that is not an integer from 0 to 255 or a `tokenProgram` string that is not Token or Token-2022; or an MPP Solana session challenge, wherever it is checked (`place` and `pairingsOf` included), has a malformed channel program, currency, recipient, recent blockhash or slot, or voucher signer. |
| `svm/memo-count` | The Solana transaction has no top-level Memo instruction or more than one (x402 `exact` and `upto`), or more than one Memo instruction carrying an LCP string (MPP). An x402 `batch-settlement` opening has other than exactly one binding memo and exactly one other Memo instruction; a binding memo is a Memo instruction whose data starts with x402's receiver-authorizer prefix `x402:batch-settlement:svm:rcvauth:v1:`. |
| `svm/memo-not-lcp` | The Solana transaction's one Memo instruction, or an x402 `batch-settlement` opening's Memo instruction beside its binding memo, does not carry an ATR hash in LCP string form. |
| `svm/memo-not-utf8` | The data of the Solana transaction's one Memo instruction, or of an x402 `batch-settlement` opening's Memo instruction beside its binding memo, is not UTF-8. |
| `svm/network-malformed` | A Solana network is not `mainnet`, `devnet` or `localnet` in an MPP challenge, or not a Solana CAIP-2 name in an x402 option. |
| `svm/network-undeclared` | The MPP Solana challenge names `localnet`, which has no CAIP-2 network to read on. |
| `svm/no-carrier` | The Solana transaction presented for an MPP charge has no Memo instruction carrying an ATR hash in LCP string form. |
| `svm/no-channel-instruction` | The Solana transaction has no top-level payment-channels instruction. |
| `svm/nonce-account-not-static` | The Solana message's first instruction is `AdvanceNonceAccount` and names its nonce account through an address lookup table: a durable message names its nonce account as a static key (SIMD-0242), and the message alone cannot show the nonce account a reference records. |
| `svm/not-final` | **Read to repeat.** The Solana transaction landed with an error at `confirmed` and is not found at `finalized`: a read to repeat, since a block that is not finalized can be replaced. |
| `svm/not-found` | **Read to repeat.** The Solana reader answers that the node holds no transaction for the signature (its not-found answer). |
| `svm/open-not-found` | The MPP Solana session transaction has no single `open` instruction of the challenge's channel program with the required data and accounts, or the program key is invalid, or the `open` names its channel (account 5) through an address lookup table; `buildWithin` also refuses a client channel whose `open` names its `authorizedSigner` (account 4) through a table. These functions take no reader and read no table. |
| `svm/pda-not-found` | `findPda` is given an invalid program key or too many or too long seeds, or no bump yields an off-curve address. |
| `svm/peer-missing` | The optional peer dependency `@solana/kit` cannot be loaded to build a Solana message. |
| `svm/proof-not-challenge` | The MPP Solana session credential's `authentication.challengeId` is not the echoed challenge's id, or a `use` credential carries no such proof. |
| `svm/read-first` | An MPP Solana `signature` credential carries no transaction yet; the seller reads it with `fetchPresented` before `bound`. |
| `svm/signer-not-operator` | The MPP Solana session opening's `open` instruction names an `authorizedSigner` (account 4) other than the echoed challenge's `operator`, or names it through an address lookup table, which these functions do not read, when the challenge's `voucherSigner` is `operator` (`bound`, `reference`, `build`'s `complete` and `buildWithin`). |
| `svm/tx-malformed` | A Solana transaction is not non-empty base64 of a well-formed unversioned or v0 wire transaction (signature count, header, keys, instructions and lookup tables consistent and fully consumed), or an MPP `bundle` credential's `transactions` is not an array within the bound, or `svmCarrier` or `channelInstruction` is given a transaction that is not a decoded one. |
| `svm/tx-too-large` | A Solana transaction, or its base64 text, exceeds the wire size bound. |
| `svm/unreadable` | **Read to repeat.** The Solana reader threw, gave an answer of neither documented shape (a landed transaction, or a not-found answer), or returned a landed transaction that is not well formed. |
| `svm/wrong-reader` | The Solana reader answers for a different network than the reference or challenge names, or the reference given to a Solana `recover` names a `transaction` that is not a signature, base58 of 64 bytes. |

## stellar

Stellar (`@integraledger/lcp/stellar` and the Stellar pairings).

| Code | Meaning |
|---|---|
| `stellar/amount-mismatch` | A Stellar `build` finds that the simulated transfer's amount is not the option's `amount` (x402) or the request's `amount` (MPP) exactly. Nothing reaches the signer. |
| `stellar/asset-mismatch` | A Stellar `build` finds that the simulated transfer calls a token contract other than the option's `asset` (x402) or the request's `currency` (MPP). Nothing reaches the signer. |
| `stellar/carrier-mismatch` | The option's `payTo` or the challenge's `recipient` does not carry the muxed id derived from H, or the signed transfer's recipient or muxed id is not the one the option or challenge names. |
| `stellar/carrier-occupied` | `advertise` finds the x402 option's `payTo` not a plain account, or the MPP challenge's `recipient` already muxed. |
| `stellar/event-malformed` | `transferEventOf` is given topics or data that are not padded standard base64 in its canonical form (RFC 4648 §3.5), that do not decode as a SEP-41 `transfer` event with an address recipient, or that nest vectors and maps deeper than `SCVAL_MAX_DEPTH`. |
| `stellar/network-malformed` | A Stellar network is not `stellar:pubnet` or `stellar:testnet`. |
| `stellar/no-address-auth` | The payer's authorization entry cannot be identified. Before a transaction lands (`decodeStellarTx`, `build`, x402 `bound` and `reference`, MPP `bound` and `reference` of a `transaction` credential): the operation does not carry exactly one address-credential authorization entry for the transfer's `from`. On a landed transaction (MPP `bound` and `reference` of a `hash` credential), which is read by `from`'s first address-credential entry whose `rootInvocation` is the operation's `transfer`: `from` has no such entry and not exactly one address-credential entry. An entry with source-account credentials is not an address entry: only an MPP `hash` credential under a request whose `feePayer` is false or absent reads a payer with no address entry, when the payer is the source account of the transaction and of its operation and a source-account entry is the operation's `transfer`. Or the payer is not an Ed25519 account. |
| `stellar/no-carrier` | The signed Stellar transfer's recipient is not a muxed address, so it carries no muxed id. |
| `stellar/not-found` | **Read to repeat.** The Stellar reader found no transaction envelope for the hash. |
| `stellar/not-one-transfer` | The Stellar envelope does not hold exactly one `invokeHostFunction` operation calling a SEP-41 `transfer(from, to, amount)`, the payer's signed root invocation is not one such transfer with no sub-invocations, or the operation does not invoke exactly what the payer signed. |
| `stellar/option-malformed` | An MPP Stellar challenge's `network`, `amount` (a decimal below 2^127, the `i128` of a SEP-41 `transfer`), `currency`, `recipient` or `feePayer` is not of the required form, a recipient cannot take a muxed id, or `transferEventTopics` is given an address that is neither an account nor a contract. |
| `stellar/payer-mismatch` | A Stellar `build` finds that the simulated transfer's `from` is not the choice's `payer`. Nothing reaches the signer. |
| `stellar/peer-missing` | The optional peer dependency `@stellar/stellar-sdk` cannot be loaded. |
| `stellar/read-first` | An MPP Stellar `hash` credential carries no transaction yet; the seller reads it with `fetchPresented` before `bound`. |
| `stellar/tx-malformed` | A Stellar transaction envelope is not strict base64 of a v1 envelope XDR, its operation or the payer's authorization entry nests ScVals or invocations deeper than `SCVAL_MAX_DEPTH`, the signing inputs (current ledger, time, expiration, signature, envelope type) are invalid, or a credential or buyer choice carries no transaction where one is required. |
| `stellar/tx-failed` | The transaction an MPP Stellar `hash` credential names is recorded `FAILED` on the ledger, so it moved nothing. |
| `stellar/tx-too-large` | A Stellar transaction envelope's base64 text exceeds the size bound. |
| `stellar/unreadable` | **Read to repeat.** The Stellar reader threw, returned a response that is not an object, or returned an envelope under a status other than `SUCCESS`, `FAILED` or `NOT_FOUND`; such a status with no envelope is `stellar/not-found`. |
| `stellar/wrong-reader` | The Stellar reader answers for a different network than the challenge names. |

## xrpl

The XRP Ledger (`@integraledger/lcp/xrpl` and the XRPL pairings).

| Code | Meaning |
|---|---|
| `xrpl/blob-malformed` | An XRPL signed blob is not a string of hex, holds a field deeper than `XRPL_MAX_DEPTH` (10 levels, as rippled 3.4.1's `STVar.cpp` L104-108 counts them; checked before it is decoded) or an end marker in an object or array it does not close (as rippled 3.4.1's `STObject.cpp` L240-244 and `STArray.cpp` L54-58 refuse it), does not decode, is not the canonical serialization of what it decodes to, lacks `TransactionType` or `Account`, or a credential or `complete` call carries no string blob. |
| `xrpl/blob-too-large` | An XRPL signed blob exceeds 4096 hex characters (2048 bytes). |
| `xrpl/carrier-mismatch` | The option's `extra.invoiceId` or the challenge's `invoiceId` is not the one derived from H when `build` is called, or the signed `Payment`'s `InvoiceID` is not the one the option or challenge names. |
| `xrpl/carrier-not-lcp` | The x402 XRPL option's `extra.invoiceId` is not an ATR hash in LCP string form. |
| `xrpl/carrier-occupied` | `advertise` finds the option's `extra.invoiceId`, or the MPP challenge's `invoiceId`, already holding a value other than the one derived from H. |
| `xrpl/currency-not-xrp` | An MPP XRPL session challenge names a `currency` other than `XRP`. |
| `xrpl/memo-count` | The XRPL session opening carries more than 8 memos, or more than one memo carrying an LCP string. |
| `xrpl/memos-not-carried` | An MPP XRPL charge challenge's `methodDetails` carries `memos`, which `build` does not write: `pairingsOf` refuses it, and so does each function that holds the challenge to the pairing's filter. |
| `xrpl/multisigned` | The signed blob presented to `x402/exact/xrpl`, `mpp/charge/xrpl` or the `mpp/session/xrpl` opening carries `Signers`: the XRPL pairings take a transaction the payer signed with a single key, whose transaction hash is the one that can land. |
| `xrpl/network-malformed` | The MPP XRPL challenge's `methodDetails.network` is not one of the XRPL network names this package maps. |
| `xrpl/network-missing` | The MPP XRPL challenge's `methodDetails` names no `network`, which has no default. |
| `xrpl/no-invoice-id` | The XRPL `Payment` carries no `InvoiceID`, or the validated transaction a recovery reads has no 256-bit `InvoiceID`. |
| `xrpl/no-memo` | The XRPL session opening carries no memo whose `MemoData` is an ATR hash in LCP string form. |
| `xrpl/not-channel-create` | The XRPL session opening or the transaction a recovery reads is not a `PaymentChannelCreate`, or the opening `channel.ref` or `buildWithin` reads lacks the source, destination or sequence its channel id is derived from. |
| `xrpl/not-found` | **Read to repeat.** The XRPL reader found no transaction for the reference. |
| `xrpl/not-payment` | The XRPL signed blob presented for a charge is not a `Payment`. |
| `xrpl/not-success` | The validated XRPL transaction a recovery reads has a result other than `tesSUCCESS`, or is not the `Payment` a charge's recovery reads; or the one an MPP XRPL `hash` credential names has a result other than `tesSUCCESS`. |
| `xrpl/not-validated` | **Read to repeat.** The XRPL transaction the reference, or an MPP XRPL `hash` credential, names is not yet in a validated ledger. |
| `xrpl/peer-missing` | The optional peer dependency `ripple-binary-codec` cannot be loaded to decode a blob. |
| `xrpl/read-first` | An MPP XRPL `hash` credential carries no blob yet; the seller reads it by hash before `bound`. |
| `xrpl/unreadable` | **Read to repeat.** The XRPL reader threw or returned a response that is not well formed, or, to the MPP XRPL session's `recover`, returned a signed blob that is not the validated transaction's: one that does not decode, whose hash is not the transaction's, or whose `TransactionType` is not the one the validated answer gives. |
| `xrpl/wrong-reader` | The XRPL reader answers for a different network than the reference or challenge names, or the reference given to `recover` names a `transaction` that is not 64 hex digits. |

## hedera

Hedera (`@integraledger/lcp/hedera`, and the MPP Hedera pairings and challenges in `@integraledger/lcp/mpp`).

| Code | Meaning |
|---|---|
| `hedera/chain-id-unnamed` | An MPP Hedera `chainId` is not 295 or 296, or a charge request names no `chainId` and no default network is given. |
| `hedera/channel-id-mismatch` | The channel id recomputed from the Hedera `ChannelOpened` log is not the `channelId` the credential names. |
| `hedera/channel-log-not-found` | The Hedera session opening's landed logs hold no single `ChannelOpened` log from the escrow naming the channel with readable parties (`fetchPresented` lands logs without exactly one only from a block at or below the reader's `finalized` mark), or the receipt the `mpp/session/hedera` `recover` reads, in a block at or below the reader's `finalized` mark, holds no single `ChannelOpened` log with four topics and four data words from the binding log's address naming its channel, or, for a reference that names the escrow alone, from the escrow naming any channel. |
| `hedera/deprecated-fields` | A Hedera `Transaction` uses the deprecated fields 2 to 4, or a `Transaction` inside a `TransactionList` the deprecated fields 1 to 4, instead of `signedTransactionBytes` (a top-level field 1 is read as a `TransactionList`). |
| `hedera/executor-malformed` | The transfer-executor payload given to `complete` or presented is not an object with entity `payer` and `executor` and a hex `authorization` within the bound. |
| `hedera/executor-not-offered` | The transfer-executor payload given to `complete` names an `executor` the option does not list; `bound` and `reference` do not check it. |
| `hedera/list-inconsistent` | The bodies of a Hedera `TransactionList` do not all share one transaction id and memo. |
| `hedera/memo-not-lcp` | The Hedera memo does not carry an ATR hash in LCP string form, or the memo of the landed transaction a recovery reads is not UTF-8 (a signed body whose memo is not UTF-8 is `hedera/tx-malformed`). |
| `hedera/network-malformed` | The network written by `fetchPresented` for an MPP Hedera charge is not a Hedera network. |
| `hedera/no-legal-context` | The transfer-executor pairing's `bound` finds no decodable `extensions.legalContext.info` echoed in the payment. |
| `hedera/no-memo` | The signed Hedera body, or the landed transaction a recovery reads, has an empty memo. |
| `hedera/not-final` | **Read to repeat.** The Hedera session opening transaction reverted, or its receipt holds no `ChannelOpened` log naming the channel (for `fetchPresented`, not exactly one from the escrow naming the credential's `channelId`), in a block above the reader's `finalized` mark or with a reader that cannot give that mark: a read to repeat, since that block can be replaced. |
| `hedera/not-found` | **Read to repeat.** The Hedera reader found no transaction, or the transaction an x402 Hedera recovery or an MPP Hedera `hash` charge credential names has no counted user entry yet, or the reader found no receipt for the session transaction. |
| `hedera/not-success` | The transaction an x402 Hedera recovery reads, or an MPP Hedera `hash` charge credential names, reached consensus with no `SUCCESS` among its counted user entries, so its transfers were not made. |
| `hedera/option-malformed` | A Hedera option names an unknown transfer method or lacks what its pairing needs (an asset and `payTo`, a `feePayer`, 1 to the allowed number of `executors`, or a decimal amount below 2^63 and a timeout that is a positive safe integer), the buyer's choice carries an invalid payer, node, valid start, fee or decimals, or a client id that is not a well-formed string, or a transfer-executor `now` that is not a non-negative safe integer or whose sum with `maxTimeoutSeconds` is not one, or a `maxTimeoutSeconds` whose sum with the time the transfer-executor `reference` runs is not a safe integer, or an MPP Hedera charge request has an invalid amount, currency, recipient or splits (too many, not less than the amount, or repeating an account). |
| `hedera/read-first` | An MPP Hedera `hash` charge credential or session opening carries no landed data yet; the seller reads it with `fetchPresented` before `bound`. |
| `hedera/reverted` | The Hedera session opening transaction reverted, in a block at or below the reader's `finalized` mark, as `fetchPresented` and `recover` read it. |
| `hedera/tx-malformed` | A Hedera transaction is not base64 of a wire `Transaction` or `TransactionList` whose signed body decodes within the depth bound, a signature pair given to `complete` has the wrong key or signature length, or a push credential's `transactionId` is not `shard.realm.num@seconds.nanos`. |
| `hedera/tx-too-large` | A Hedera transaction's wire bytes exceed the size bound. |
| `hedera/unreadable` | **Read to repeat.** The Hedera reader failed or returned a response that is not well formed. |
| `hedera/wrong-reader` | The Hedera reader is missing or answers for a different network than the reference or request names, or the reference given to the `x402/exact/hedera` `recover` names a `transactionId` that is not a Mirror Node transaction id (`shard.realm.num-seconds-nanos`), or the reference given to the `mpp/session/hedera` `recover` names a `transaction` that is not a 32-byte hash, a `bindingLog` that is not an object with an address `address` and a 32-byte `value`, or an `escrow` that is not an address, or names neither a `bindingLog` nor an `escrow`, or both. |

## avm

Algorand (`@integraledger/lcp/avm`).

| Code | Meaning |
|---|---|
| `avm/group-too-large` | The Algorand payment group is empty or larger than the group bound. |
| `avm/index-out-of-range` | The Algorand `paymentIndex` does not name a transaction in the payment group. |
| `avm/network-malformed` | An Algorand option's network starts with `algorand:` but does not name a genesis hash in CAIP-2 form. |
| `avm/network-mismatch` | The suggested parameters' genesis hash given to `build` is not base64 of 32 bytes or is not the network the option names. |
| `avm/not-axfer` | The Algorand payment transaction is not an asset transfer. |
| `avm/not-found` | **Read to repeat.** The Algorand reader found no transaction for the id. |
| `avm/note-not-lcp` | The Algorand transaction's note is not UTF-8 carrying an ATR hash in LCP string form. |
| `avm/option-malformed` | An Algorand option's `extra` is not an object or names a transfer method or flow this pairing does not pay, its asset, `payTo` or fee payer is invalid, or its amount or timeout is invalid, or the buyer's payer or suggested parameters given to `build` are invalid, or the payment entry `build` would write from them is one the carrier refuses, its base64 longer than 8,192 characters included. |
| `avm/peer-missing` | The optional peer dependency `algosdk`, with which the Algorand pairing checks an option's addresses and builds the transaction, cannot be loaded: `avmCarrier` and `build` refuse without it. |
| `avm/signature-malformed` | The signature given to the Algorand `complete` is not 64 bytes. |
| `avm/txn-malformed` | The Algorand payload has no `paymentGroup` array, the payment entry is not base64 of one msgpack value within the caps, algod's decoder or the x402 facilitator's refuses it, algod reads a transaction type it does not know or a member of another type set, the two read different signed transactions, the facilitator can compute no transaction id for it, or its note exceeds the bound. |
| `avm/unreadable` | **Read to repeat.** The Algorand reader threw or returned an answer that is not well formed. |
| `avm/wrong-reader` | The Algorand reader is missing or answers for a different network than the reference names, or the reference given to `recover` names a `txid` that is not the 52 base32 characters of a 32-byte hash. |

## aptos

Aptos (`@integraledger/lcp/aptos`).

| Code | Meaning |
|---|---|
| `aptos/chain-mismatch` | The presented Aptos transaction's chain id is not the chain of the option's network. |
| `aptos/network-malformed` | An Aptos option's network starts with `aptos:` but is not followed by a decimal chain id from 1 to 255 with no leading zero. |
| `aptos/not-an-x402-transfer` | The transaction given to `decodeAptosTx` is not a call to the framework `primary_fungible_store::transfer` or `fungible_asset::transfer` with one struct type argument and three arguments (two addresses and a u64 amount), or the committed transaction a reader returns is not a user transaction with an entry function payload whose sender, sequence number, expiry, function name, one type argument and three arguments (two addresses and a decimal u64 amount) can be read; `committedInstrument` does not check which function is called. |
| `aptos/not-entry-function` | The Aptos transaction's payload is not an entry function call. |
| `aptos/tx-malformed` | `decodeAptosTx` is given text that is not base64 of an Aptos `RawTransaction` prefix (in BCS or x402's reference JSON form) that reads to the end of its fields, or a prefix with a module, function or struct name that is not an ASCII letter or underscore followed by up to 254 ASCII letters, digits and underscores (a leading U+FEFF included), or `aptosIdDigest` is given an instrument that is not an object whose sequence number is a bigint and whose type arguments and arguments are arrays. |
| `aptos/tx-too-large` | `decodeAptosTx` is given a transaction larger than the size bound. |

## cardano

Cardano (`@integraledger/lcp/cardano`).

| Code | Meaning |
|---|---|
| `cardano/ambiguous` | The Cardano metadata holds label 674 more than once, label 674's map repeats a key, or its `msg` lines hold more than one line that reads as the LCP marker when case and a leading byte-order mark are ignored. |
| `cardano/aux-hash-mismatch` | The Blake2b-256 of the Cardano transaction's auxiliary data is not the hash in its body. |
| `cardano/aux-missing` | The Cardano transaction's body has no auxiliary data hash (key 7), or it carries no auxiliary data. |
| `cardano/hash-not-carried` | The Cardano auxiliary data's label 674 `msg` lines carry no line that is exactly the lowercase LCP marker followed by a line of 64 lowercase hex digits. |
| `cardano/network-malformed` | A Cardano option's network starts with `cardano:` or `cip34:` but is not one this package maps. |
| `cardano/not-found` | **Read to repeat.** The Cardano reader answers that the indexer does not hold the transaction (its not-found answer). |
| `cardano/not-valid` | The Cardano transaction the reference names is on chain as invalid (its collateral was taken). |
| `cardano/ttl-missing` | The Cardano transaction sets no TTL, so `reference` has no slot by which it settles. |
| `cardano/tx-malformed` | A Cardano transaction, as base64 text or as the CBOR bytes a reader returns to `cardanoRecover` whose body has the id the reference names, is not one CBOR array `[body, witness set, validity, auxiliary data]` with a map body of unique unsigned keys, a valid TTL and a 32-byte auxiliary data hash. |
| `cardano/tx-too-large` | `decodeCardanoTx` is given a transaction larger than the size bound. |
| `cardano/unreadable` | **Read to repeat.** The Cardano reader threw, gave an answer of neither documented shape (a transaction, or a not-found answer), or returned a transaction with no CBOR bytes, more bytes than the size bound, or bytes that are not one CBOR array whose first item, the body, has the reference's id as its Blake2b-256, before any decoding refusal. |
| `cardano/wrong-reader` | The Cardano reader answers for a different network than the reference names, or the reference given to `recover` names a `txId` that is not a 32-byte hash. |

## casper

Casper (`@integraledger/lcp/casper`).

| Code | Meaning |
|---|---|
| `casper/address-malformed` | A `from` or `to` address given to `cep3009TypedData` or `casperIdDigest`, or the payer given to `build`, is not a valid Casper account or package address. |
| `casper/amount-malformed` | A Casper amount is not a uint256. |
| `casper/key-tag-mismatch` | The public key and signature given to the Casper `complete` carry different algorithm tags. |
| `casper/network-malformed` | A Casper network given to `cep3009TypedData` is not a Casper CAIP-2 name, or its argument is not an object. |
| `casper/no-authorization-call` | The executed Casper transaction holds no authorization call on the asset carrying a nonce. |
| `casper/not-executed` | **Read to repeat.** The Casper transaction the reference names has not executed. |
| `casper/not-found` | **Read to repeat.** The Casper reader found no transaction for the reference. |
| `casper/option-malformed` | A Casper asset is not a contract package hash, the token name or version is not a valid name, `validBefore` is out of range, or the `now` given to `build` is not a non-negative safe integer. |
| `casper/payload-malformed` | The presented Casper payment carries a `refused` member, or is not x402 version 2, or its payload is not a string CEP-3009 authorization (hex nonce), a tagged public key and signature; or, for `reference`, its value is not a decimal uint256, its `validBefore` not a decimal below 2^64, or its `from` or `to` not a Casper address; or H given to `cep3009TypedData` or `build` is not a valid ATR hash. |
| `casper/reverted` | The Casper transaction executed with an error. |
| `casper/signature-malformed` | The public key or signature given to the Casper `complete` is not tagged hex of the allowed length. |
| `casper/unreadable` | **Read to repeat.** The Casper reader threw or returned a call that is not well formed. |
| `casper/wrong-reader` | The Casper reader answers for a different network than the reference names, or the reference given to `recover` names a `transaction` that is not 64 hex digits or an `asset` that is not a package hash of 64 hex digits. |

## ccd

Concordium (`@integraledger/lcp/ccd`).

| Code | Meaning |
|---|---|
| `ccd/address-malformed` | A Concordium account address is missing, is not base58check of the account form, or its bytes are not 32 long. |
| `ccd/memo-not-cbor-text` | The Concordium memo is not exactly one CBOR text string within the memo bound. |
| `ccd/memo-not-lcp` | The Concordium memo's text is not an ATR hash in LCP string form with lowercase hex under the preferred encoding, or H given to `build` is not a valid ATR hash. |
| `ccd/no-carrier` | The finalized Concordium block item does not hold exactly one transfer whose memo carries an ATR hash as `memoCarrier` reads it. |
| `ccd/no-memo` | The Concordium transaction is a plain `transfer` with no memo, or its PLT transfer operation has no memo. |
| `ccd/not-finalized` | **Read to repeat.** The Concordium block item is not finalized. |
| `ccd/not-found` | **Read to repeat.** The Concordium reader found no block item for the reference. |
| `ccd/not-v1` | The Concordium signed transaction's `version` is not 1. |
| `ccd/operation-count` | The Concordium PLT operations are not exactly one `transfer` operation. |
| `ccd/operations-malformed` | The Concordium PLT operations are not a CBOR list whose transfer carries a byte-string memo, a tagged 32-byte recipient account and a decimal-fraction amount. |
| `ccd/option-malformed` | The `now` given to the Concordium `build` is not a non-negative safe integer. |
| `ccd/payload-kind` | The Concordium transaction's payload is neither `transferWithMemo` nor a PLT `tokenUpdate`. |
| `ccd/rejected` | The Concordium block item was rejected. |
| `ccd/too-large` | The Concordium signed transaction, its memo or its token operations exceed the size bound. |
| `ccd/transaction-malformed` | The presented Concordium signed transaction is not a JSON value (x402's wire form, `JSON.parse(Transaction.toJSONString(tx))`), or not an object with a header and payload, a valid expiry, a decimal amount below 2^64 and hex memo or operations of the stated length, or an amount given to `ccdIdDigest` is out of range, or the value given to `complete` is not an object that serialises as JSON (the SDK's unserialized transaction, whose header holds bigints, is refused). |
| `ccd/unreadable` | **Read to repeat.** The Concordium reader threw or returned a block item that is not well formed. |
| `ccd/wrong-reader` | The Concordium reader answers for a different network than the reference names, or the reference given to `recover` names a `transaction` that is not 64 hex digits. |

## near

NEAR (`@integraledger/lcp/near`, and `chargeNearIntents` in `@integraledger/lcp/mpp`).

| Code | Meaning |
|---|---|
| `near/actions` | The NEAR delegate action does not hold exactly one action. |
| `near/args-malformed` | The `ft_transfer` arguments are over the size bound, not UTF-8 JSON, or not an object. |
| `near/carrier-occupied` | `advertise` for the NEAR Intents charge finds the challenge's `externalId` already holding a value other than H's LCP string. |
| `near/memo-missing` | The `ft_transfer` arguments carry no string `memo`. |
| `near/memo-not-lcp` | The `ft_transfer` `memo` is not an ATR hash in LCP string form, or the NEAR Intents challenge's `externalId` is absent or a string that is not one. |
| `near/network-malformed` | A NEAR option's network starts with `near:` but is not `near:mainnet` or `near:testnet`. |
| `near/no-relayer` | The NEAR reader lists no relayer to ask for the transaction status. |
| `near/not-found` | **Read to repeat.** None of the first four relayers the NEAR reader lists knows the transaction. |
| `near/not-ft-transfer` | The NEAR delegate action's one action is not a function call to `ft_transfer`, or the transaction a recovery reads carries no delegate action or its delegate calls another method. |
| `near/not-hash-credential` | The NEAR Intents charge credential's payload `type` is not `hash`. |
| `near/option-malformed` | A NEAR option's `extra` is not an object, or its `asset`, `payTo`, `amount` or `maxTimeoutSeconds` is not a valid account, u128 amount or positive safe integer timeout. |
| `near/peer-missing` | The optional peer dependencies `near-api-js` and `borsh` cannot be loaded. |
| `near/sda-malformed` | The NEAR signed delegate action is not non-empty base64 of a canonical Borsh `SignedDelegate`, a string in it is not UTF-8, its signature or a key in it is neither Ed25519 nor secp256k1, or its public key cannot be read. |
| `near/sda-too-large` | The NEAR signed delegate action's base64 text exceeds the size bound. |
| `near/unreadable` | **Read to repeat.** The NEAR reader threw or returned an outcome that is not well formed, or one whose delegate's arguments are not base64 in its canonical form. |
| `near/wrong-reader` | The NEAR reader answers for a different network than the reference names, or the reference given to `recover` names no `transaction` string. |

## polkadot

Polkadot Asset Hub (`@integraledger/lcp/polkadot`).

| Code | Meaning |
|---|---|
| `polkadot/address-malformed` | A Polkadot address is not an SS58 string of at most 64 characters that decodes to 35 bytes with a simple prefix and a valid checksum. |
| `polkadot/address-not-id` | The Polkadot extrinsic's signer is not a `MultiAddress::Id` of 32 bytes. |
| `polkadot/call-not-profile` | The Polkadot call is not exactly the profile's `batchAll` of `transferKeepAlive` then `remarkWithEvent` with a remark of the fixed length, or the presented `call` is not lowercase hex, or the recovered extrinsic does not end with that call after its signature. |
| `polkadot/call-not-suffix` | The signed Polkadot extrinsic does not end, after its signature, with the call it is checked against: the presented `call` for `bound` and `reference`, or the profile call `build` made for `complete`. |
| `polkadot/extrinsic-malformed` | A Polkadot extrinsic is not lowercase hex whose compact length prefix matches its length. |
| `polkadot/extrinsic-too-large` | A Polkadot extrinsic, or the raw extrinsic a recovery reads, is longer than 4,096 bytes. |
| `polkadot/network-unsupported` | A Polkadot option's network starts with `polkadot:` but is not one this package supports. |
| `polkadot/no-remark` | The Polkadot extrinsic `polkadotRecover` reads, in a block the finalized chain holds, did not dispatch successfully with a `Remarked` event for its remark. |
| `polkadot/no-transfer` | The recovered Polkadot extrinsic's record, in a block the finalized chain holds, carries no `Transferred` event of the asset its profile call names. |
| `polkadot/not-final` | **Read to repeat.** The extrinsic `polkadotRecover` reads did not dispatch with its remark or the asset transfer, in a block above the finalized height: a read to repeat, since that block can be replaced. |
| `polkadot/not-found` | **Read to repeat.** The Polkadot reader holds no block for the timepoint given to `polkadotRecover`, or no record of the extrinsic at its index. |
| `polkadot/not-located` | The timepoint given to `polkadotRecover` names no extrinsic: its block holds none at that index, or the finalized chain holds another block at that height without the same extrinsic at that index. `polkadotLocate` finds the extrinsic by its hash. |
| `polkadot/not-signed-v4` | The Polkadot extrinsic is not a signed version 4 extrinsic. |
| `polkadot/option-malformed` | A Polkadot option does not name the `lcp-assets-remark` transfer method, names another flow, or has an invalid asset id, amount or timeout (a positive safe integer of at most 3600 seconds), or the choice given to `build` is not an object. |
| `polkadot/range` | `polkadotLocate` is given a block range that is not non-negative bigints in order spanning at most 256 blocks. |
| `polkadot/remark-not-lcp` | The Polkadot remark is not exactly an ATR hash's LCP string form with lowercase hex, byte for byte. |
| `polkadot/signature-malformed` | The Polkadot extrinsic's `MultiSignature` has an unknown variant or runs past the end. |
| `polkadot/unreadable` | **Read to repeat.** The Polkadot reader threw, or answered out of its documented form: to `polkadotRecover`, block extrinsics that are not an array, an entry there that is not a hex string, a record that is not an extrinsic's, raw bytes whose BLAKE2b-256 is not the hash of the chain's record of them, or a finalized height that is not a bigint; to `polkadotLocate`, block extrinsics that are not an array. |
| `polkadot/wrong-reader` | The Polkadot reader is missing or answers for a different network than the reference names, or the reference given to `polkadotLocate` has an `extrinsicHash` that is not `0x` and 64 hex digits, or the reference given to `polkadotRecover` names a `transaction` that is not a `<block hash>-<index>` timepoint. |

## starknet

Starknet (`@integraledger/lcp/starknet`).

| Code | Meaning |
|---|---|
| `starknet/ambiguous` | The Starknet transaction `starknetLandedNonce` reads, accepted on L2 or L1, holds matching transfers with more than one nonce. |
| `starknet/caller-forbidden` | The Starknet option's fee payer is zero or the any-caller value, or the paying account is the fee payer itself. |
| `starknet/felt-malformed` | A Starknet fee payer, asset, `payTo`, nonce, payer account or `from` is not a valid felt. |
| `starknet/network-malformed` | A Starknet network is not one of the Starknet networks this package supports, or the argument to `outsideExecution` is not an object. |
| `starknet/no-legal-context` | The Starknet payment echoes no decodable `extensions.legalContext.info`. |
| `starknet/no-transfer` | The Starknet transaction `starknetLandedNonce` reads, accepted on L2 or L1, holds no `transfer` call on the asset with this payment's identity below an `execute_from_outside_v2`, within 16 levels and 512 invocations. |
| `starknet/nonce-not-bound` | The Starknet signed `Nonce` is not the low 250 bits of the echoed hash. |
| `starknet/not-final` | **Read to repeat.** The Starknet transaction `starknetLandedNonce` reads is `PRE_CONFIRMED` and reverted or holds no single matching transfer: a read to repeat, since a pre-confirmed block can change. |
| `starknet/not-found` | **Read to repeat.** The Starknet reader found no receipt for the transaction the reference names. |
| `starknet/option-malformed` | A Starknet option has no `extra` object, or its amount is not a u256 or its timeout is not a positive safe integer, or the buyer's choice given to `build` is not an object or has an invalid `now`, or an amount or deadline given to a typed-data helper is out of range. |
| `starknet/reverted` | The Starknet transaction `starknetLandedNonce` reads, accepted on L2 or L1, reverted. |
| `starknet/signature-malformed` | The signature given to the Starknet `complete` is not 1 to the allowed number of valid felts. |
| `starknet/typed-data-malformed` | The presented Starknet `outsideExecution.typedData` is not an `OutsideExecution` under domain `Account.execute_from_outside` version 2 revision 1 on the option's chain with a felt `Nonce`, or exceeds 16 KiB as JSON or nests more than 64 levels; or, for `reference`, its `Calls` is not exactly one call whose `Calldata` is three felts (recipient, amount low and amount high, each half below 2^128), or its `Execute Before` is not a decimal. `reference` does not read the call's `Selector` or `To`. |
| `starknet/unreadable` | **Read to repeat.** The Starknet reader threw, or returned a receipt or events that are not well formed, or a trace that is missing or holds an invocation that is not well formed. |
| `starknet/wrong-reader` | The Starknet reader answers for a different network than the reference names, or the reference given to `starknetLandedNonce` has a `transaction` or `asset` that is not a felt or an `idDigest` that is not a 32-byte hash. |

## sui

Sui (`@integraledger/lcp/sui`).

| Code | Meaning |
|---|---|
| `sui/aborted` | The Sui transaction the reference names executed with status `FAILURE`. |
| `sui/ambiguous` | The Sui transaction has more than one unused `Pure` input. |
| `sui/hash-not-carried` | The Sui transaction has no unused `Pure` input, or its one unused `Pure` input is not 32 bytes. |
| `sui/network-malformed` | A Sui option's network starts with `sui:` but is not `sui:mainnet`, `sui:testnet` or `sui:devnet`. |
| `sui/not-found` | **Read to repeat.** The Sui reader found no transaction for the digest. |
| `sui/not-programmable` | The Sui `TransactionData` V1 given to `decodeSuiTx`, or read by `suiRecover` under the reference's digest, has a kind that is not `ProgrammableTransaction`; a `TransactionData` of another version does not decode, and is `sui/tx-malformed`. |
| `sui/peer-missing` | The optional peer dependency `@mysten/sui` cannot be loaded. |
| `sui/tx-malformed` | `decodeSuiTx` is given text that is not base64 of a canonical BCS `TransactionData`, or `suiRecover` reads, under the reference's digest, bytes that are not one; or either holds a programmable transaction with a type (a call's type argument, a vector's element type, a funds withdrawal's type) nested 16 levels deep, Sui's type depth limit, or a `Pure` input that is not valid base64 within the bound; or `suiCarrier` is given a transaction that is not a decoded one. |
| `sui/tx-too-large` | `decodeSuiTx` is given a transaction larger than the size bound. |
| `sui/unreadable` | **Read to repeat.** The Sui reader failed, or returned a transaction whose digest is not the reference's. |
| `sui/wrong-reader` | The Sui reader answers for a different network than the reference names, or the reference given to `recover` names a `digest` that is not base58 of 32 bytes. |

## tron

Tron (`@integraledger/lcp/tron`).

| Code | Meaning |
|---|---|
| `tron/address-malformed` | A TRON address is not a base58check address: 34 base58 characters decoding to 25 bytes that begin with `0x41` and end with the first four bytes of SHA-256 twice over the other 21. |
| `tron/contracts` | The TRON raw data does not hold exactly one contract. |
| `tron/fee-limit` | The fee limit given to the TRON `build` is not a bigint from 1 to the maximum. |
| `tron/memo-not-lcp` | The TRON transaction's memo is not an ATR hash in LCP string form. |
| `tron/network-malformed` | A TRON option's network is not `tron:` followed by a chain number. |
| `tron/not-found` | **Read to repeat.** The TRON reader found no transaction for the id. |
| `tron/not-transfer` | The TRON contract's call data is not a TRC-20 `transfer`. |
| `tron/not-trigger` | The TRON contract is not a `TriggerSmartContract`. |
| `tron/option-malformed` | A TRON option's amount is not a uint256 or its `maxTimeoutSeconds` is not a positive safe integer of at most the allowed maximum. |
| `tron/raw-not-canonical` | The TRON raw data does not re-encode to the bytes received. |
| `tron/signature-malformed` | A TRON transaction carries no signature, too many, or one that is not 65 bytes, or the signature given to `complete` is not 65 bytes with a recovery byte of 0, 1, 27 or 28. |
| `tron/tx-malformed` | A TRON transaction is not lowercase hex of a protobuf `Transaction` whose raw data decodes with in-range fields, or the reference block or time given to `build` is invalid, or `tronCarrier` is given a transaction that is not `decodeTronTx`'s `{ raw, rawBytes }`. |
| `tron/tx-too-large` | A TRON transaction's hex, or the raw data a recovery reads, exceeds the size bound. |
| `tron/unreadable` | **Read to repeat.** The TRON reader threw or returned a transaction whose raw data is not hex, or whose raw bytes do not hash to the transaction id. |
| `tron/wrong-reader` | The TRON reader answers for a different network than the reference names, or the reference given to `recover` names a `txid` that is not a 32-byte hash. |

## tvm

TON (`@integraledger/lcp/tvm`).

| Code | Meaning |
|---|---|
| `tvm/actions` | The W5 request's action list is not exactly one `send_msg` action with no extended actions. |
| `tvm/boc-malformed` | A TON bag of cells is not non-empty base64 of bytes TON deserializes to exactly one root of level 0 (its header, CRC32C and cell layout, and each cell's references, bits, level mask, stored hashes and depth as TON creates the cell), or the settlement message is not an internal message TON's action phase sends at the configuration lcp holds for the option's network, or for the network `tvmCarrier` is given, which for `tvm:-239` and `tvm:-3` alike is mainnet's (its source `addr_none` or an `addr_std` with no anycast, and its destination an `addr_std`, or an `addr_var` of 256 bits, with no anycast, each on workchain -1 or 0; its value's Grams and its `extra_flags` each a `VarUInteger 16` in its shortest form, whose length's first byte is not zero; no extra currency; `extra_flags` of at most 3; a state init that is one `StateInitWithLibs` within 1,024 cell reads, each dictionary label at most as long as its key; a referenced body that is an ordinary cell with nothing after it; at most two Merkle proofs or updates nested under its init and body), or its action list is exotic. |
| `tvm/boc-too-large` | A TON bag of cells exceeds the byte, depth or cell-count bound. |
| `tvm/carrier-mismatch` | The option's `extra.forwardPayload` is not H's comment when `build` is called, or the presented Jetton transfer's forward payload is not the option's. |
| `tvm/carrier-occupied` | `advertise` finds the option's `extra.forwardPayload` already holding a payload other than H's comment. |
| `tvm/network-malformed` | A TON option's network is `tvm:` and not one of the two networks the pairing serves, `tvm:-239` (mainnet) and `tvm:-3` (testnet), or the network `tvmCarrier` is given is not one of them. |
| `tvm/not-found` | **Read to repeat.** The TON reader found no transaction for the reference. |
| `tvm/not-jetton-transfer` | The W5 request's outgoing message is not an internal message TON's action phase sends, as `tvm/boc-malformed` reads the settlement message, with its source `addr_none` or the W5 wallet's own address, or the W5 action's send mode is one TON's action phase refuses or skips (a bit other than +1, +2, +16, +32, +64 and +128, or +64 with +128), or its body is not a Jetton `transfer`, or the inbound body of the transaction `tvmRecover` reads is not a Jetton `transfer`. |
| `tvm/not-w5-signed` | The TON settlement message body is not one W5 runs as an `internal_signed` request: it is under 640 bits, or begins with another op, or its signed part, the body less its last 512 bits (the signature) with all its references, ends before the wallet id, `valid_until`, seqno, the action list's `Maybe ^Cell` and `has_other_actions`. Nothing after `has_other_actions` 0 is read, as W5 reads nothing there. |
| `tvm/option-malformed` | A TON option's `extra` is not an object, or its asset, `payTo`, response destination or forward TON amount is invalid, or it does not set `areFeesSponsored` to `true`, or its amount or timeout is invalid. |
| `tvm/payload-not-lcp` | The Jetton transfer carries no forward payload, or its forward payload is not a comment carrying an ATR hash in LCP string form. |
| `tvm/peer-missing` | The optional peer dependency `@ton/core` cannot be loaded. |
| `tvm/unreadable` | **Read to repeat.** The TON reader threw or returned a transaction that is not well formed, or whose inbound message body is not a bag of cells TON deserializes to one root, as `tvm/boc-malformed` reads one. |
| `tvm/value-too-low` | The TON attached to the Jetton transfer is not more than the option's forward TON amount. |
| `tvm/wrong-reader` | The TON reader answers for a different network than the reference names, or the reference given to `recover` names no `transaction` string. |

## ln

Lightning: BOLT11 invoices and the Lightning pairings (`@integraledger/lcp/lightning`).

| Code | Meaning |
|---|---|
| `ln/currency-network` | The invoice's currency is not the one the option's or challenge's network names, or the MPP challenge names a network MPP Lightning does not define (`pairingsOf` included); every Lightning pairing's `bound` and `reference` check the echoed option or challenge the same way, and an x402 Lightning pairing's `read` does not offer such an option. |
| `ln/description-inline` | The MPP challenge's invoice carries an inline `d` description. |
| `ln/description-present` | The MPP Lightning challenge's request carries a `description`. |
| `ln/expires-after-invoice` | The MPP challenge's `expires` is later than the invoice's own expiry. |
| `ln/field-length` | `invoiceH` finds that the invoice lists an `h` or `m` field whose bytes are absent or not 32 bytes: a decoded invoice's `m` of another length, or a hand-built `Bolt11`. A BOLT11 invoice whose `h` field is not 52 words (32 bytes) does not decode, and is `ln/invoice-malformed`. |
| `ln/field-repeated` | The invoice carries more than one `h` field or more than one `m` field. |
| `ln/invoice-malformed` | A BOLT11 invoice is missing or not a string, mixes case, or does not decode (bech32 checksum, prefix, field lengths, exactly one payment hash, expiry width), or `invoiceH` is given a decoded invoice that is not an object with a `tags` array. |
| `ln/invoice-not-named` | The invoice-named pairing's `build` finds that the ATR's `x402` slot does not name the option's invoice, or that the ATR is not one JSON object whose first members are `atrVersion`, `id` and `x402` with no member name repeated. |
| `ln/invoice-too-large` | A BOLT11 invoice exceeds 8 KiB or carries more tagged fields than the bound. |
| `ln/no-description-hash` | The invoice of an x402 Lightning option, or a decoded invoice given to `invoiceH` for its `h`, has no `h` (description hash) field; on the MPP Lightning pairings such an invoice is `mpp/carrier-not-challenge`. |
| `ln/no-legal-context` | The invoice-named pairing's `bound` finds no decodable `extensions.legalContext.info` echoed in the payment. |
| `ln/no-metadata` | The invoice for `x402/exact/lnbtc` has no `m` (metadata) field, or its `m` is not H. |
| `ln/no-payment-in-action` | The MPP Lightning session credential whose payment is being bound is not the `open` action, the only one that pays the invoice. |
| `ln/not-this-pairing` | An invoice for the invoice-named pairing carries an `m` field, which belongs to `x402/exact/lnbtc`. |
| `ln/payment-hash-mismatch` | The invoice's payment hash is not the challenge's `paymentHash`. |
| `ln/payment-hash-required` | An MPP Lightning challenge carries no payment hash of 64 lowercase hex digits (in `methodDetails.paymentHash` for charge, `paymentHash` for session). |
| `ln/preimage-malformed` | The preimage given to `complete` is not 64 lowercase hex digits. |
| `ln/request-hash-mismatch` | The option's `extra.requestHash` is not 64 lowercase hex digits, or the invoice's description hash is not that request hash. |
| `ln/return-invoice-malformed` | The MPP Lightning session `build` is given a return invoice that is not an amountless BOLT11 invoice. |

## stacks

Stacks (`@integraledger/lcp/stacks`, and `chargeUsdcStacks` in `@integraledger/lcp/mpp`).

| Code | Meaning |
|---|---|
| `stacks/no-memo` | The Stacks transaction is not a call to the reference's contract `transfer`, or its fourth argument is not `(some <32 bytes>)`. |
| `stacks/not-final` | **Read to repeat.** The mined Stacks transaction a recovery reads failed in a block whose tenure is fewer than two below the tip's, or whose tenure cannot be read: a read to repeat, since that block can be replaced. |
| `stacks/not-found` | **Read to repeat.** The Stacks reader answers that the API does not know the transaction (its not-found answer) or that the transaction is unmined. |
| `stacks/not-success` | The mined Stacks transaction a recovery reads failed (`abort_by_response`, `abort_by_post_condition` or `problematic_skipped`) in a block whose tenure is at least two below the tip's. |
| `stacks/unreadable` | **Read to repeat.** The Stacks reader threw or gave an answer of none of its documented shapes (a mined or unmined transaction, or a not-found answer), or a mined transaction whose status is none of `success`, `abort_by_response`, `abort_by_post_condition` and `problematic_skipped`. |
| `stacks/wrong-reader` | The Stacks reader answers for a different network than the reference names, or the reference or reader given to `recover` is not an object, or the reference names a `transaction` that is not a 32-byte hash. |

