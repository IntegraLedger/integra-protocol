---
title: Refusal codes
description: Every refusal code @integraledger/lcp returns, with its meaning.
---

# Refusal codes

Every failure in this package is a value, `{ refused: true, code }`, and every code is `<namespace>/<reason>`
([Refusals](../concepts/refusals.md)). This page lists all 480 codes the package can return, by namespace.
CI checks that every code the source names in `refusal(…)` or `refuse(…)` is listed here.

| Namespace | Codes | Returned by |
|---|---|---|
| [`core`](#core) | 6 | The core: `assemble` and the JSON checks under it. |
| [`discovery`](#discovery) | 20 | The discovery document (`@integraledger/lcp/discovery`). |
| [`x402`](#x402) | 31 | x402 documents, the request commitment, and the checks every x402 pairing shares (`@integraledger/lcp/x402` and the x402 pairings on each rail). |
| [`mpp`](#mpp) | 51 | MPP challenges and credentials, and the checks every MPP pairing shares (`@integraledger/lcp/mpp`). |
| [`ack`](#ack) | 10 | ACK Payment Requests and receipts (`@integraledger/lcp/ack`). |
| [`acp`](#acp) | 15 | ACP checkout sessions and delegated payments (`@integraledger/lcp/acp`). |
| [`ap2`](#ap2) | 17 | AP2 checkouts, Checkout Mandates and the SD-JWT reader under them (`@integraledger/lcp/ap2`). |
| [`ucp`](#ucp) | 13 | UCP checkouts and bookings (`@integraledger/lcp/ucp`). |
| [`card`](#card) | 25 | Visa TAP, Mastercard Verifiable Intent and the plain card checkout (`@integraledger/lcp/card`). |
| [`a2a`](#a2a) | 6 | The A2A extension (`@integraledger/lcp/a2a`). |
| [`evm`](#evm) | 12 | EVM chains: typed data, logs and the settlement read (`@integraledger/lcp/evm`). |
| [`tempo`](#tempo) | 16 | Tempo: transactions, memos, channels and key authorizations (`@integraledger/lcp/tempo`). |
| [`svm`](#svm) | 27 | Solana (`@integraledger/lcp/svm` and the Solana pairings). |
| [`stellar`](#stellar) | 16 | Stellar (`@integraledger/lcp/stellar` and the Stellar pairings). |
| [`xrpl`](#xrpl) | 22 | The XRP Ledger (`@integraledger/lcp/xrpl` and the XRPL pairings). |
| [`hedera`](#hedera) | 19 | Hedera (`@integraledger/lcp/hedera`). |
| [`avm`](#avm) | 12 | Algorand (`@integraledger/lcp/avm`). |
| [`aptos`](#aptos) | 6 | Aptos (`@integraledger/lcp/aptos`). |
| [`cardano`](#cardano) | 12 | Cardano (`@integraledger/lcp/cardano`). |
| [`casper`](#casper) | 13 | Casper (`@integraledger/lcp/casper`). |
| [`ccd`](#ccd) | 17 | Concordium (`@integraledger/lcp/ccd`). |
| [`near`](#near) | 16 | NEAR (`@integraledger/lcp/near`). |
| [`polkadot`](#polkadot) | 18 | Polkadot Asset Hub (`@integraledger/lcp/polkadot`). |
| [`starknet`](#starknet) | 13 | Starknet (`@integraledger/lcp/starknet`). |
| [`sui`](#sui) | 12 | Sui (`@integraledger/lcp/sui`). |
| [`tron`](#tron) | 15 | Tron (`@integraledger/lcp/tron`). |
| [`tvm`](#tvm) | 15 | TON (`@integraledger/lcp/tvm`). |
| [`ln`](#ln) | 19 | Lightning: BOLT11 invoices and the Lightning pairings (`@integraledger/lcp/lightning`). |
| [`stacks`](#stacks) | 6 | Stacks (`@integraledger/lcp/stacks`). |

## core

The core: `assemble` and the JSON checks under it.

| Code | Meaning |
|---|---|
| `core/binding-not-json` | `assemble` refuses a binding value that is not serialisable JSON with safe-integer numbers and at most 64 levels of nesting. |
| `core/content-not-json` | `assemble` refuses party content that is not a `Uint8Array` holding exactly one JSON value, and `canonicalJson` and `digestJson` refuse a value that is not JSON (deeper than 64 levels, a non-finite number, a string with an unpaired surrogate, or a non-JSON type). |
| `core/slot-duplicate` | `assemble` refuses two party slots with the same name. |
| `core/slot-name` | `assemble` refuses a binding slot or party slot name that is not a string of 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `.`, `_` and `-` starting with a letter or digit. |
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
| `discovery/not-json-object` | `parse` refuses bytes that are not UTF-8 JSON or whose value is not an object, and `emit` refuses a document that is not an object. |
| `discovery/terms-missing` | The discovery document has no `terms` member. |
| `discovery/terms-not-https` | The discovery document's `terms` is a string that is not an absolute `https` URL. |
| `discovery/too-large` | `parse` refuses input that is not a `Uint8Array` or exceeds 65536 bytes, and `emit` refuses a document whose written bytes exceed 65536. |

## x402

x402 documents, the request commitment, and the checks every x402 pairing shares (`@integraledger/lcp/x402` and the x402 pairings on each rail).

| Code | Meaning |
|---|---|
| `x402/channel-id-mismatch` | The EVM batch pairing finds that the voucher's `channelId` is not the id computed from the payment's channel config, or `buildWithin` is given a channel config whose `salt` is not H. |
| `x402/channel-kind-unknown` | The batch pairing's `channel.kind` cannot classify the payment as an opening, a payment within the channel, or a close (an unknown payload `type`, or an SVM deposit whose channel instruction is neither `open` nor `top_up`). |
| `x402/delegation-empty` | At the ERC-7710 salt level, the payment's permission context decodes to no delegations. |
| `x402/deposit-authorization` | The EVM batch opening's `deposit.authorization` is not an object carrying exactly one of `erc3009Authorization` and `permit2Authorization`. |
| `x402/escrow-not-canonical` | An `auth-capture` option's `extra.authCaptureEscrow` names neither the v1.1 nor the v1.0 canonical escrow deployment. |
| `x402/facilitator-missing` | An `upto` option on an EVM network has no valid `extra.facilitatorAddress`. |
| `x402/flow-missing` | The Solana `upto` pairing's `advertise` refuses an option whose `extra.paymentFlow` is not `escrow`. |
| `x402/flow-not-carried` | An `auth-capture` option's `extra.paymentFlow` is neither `escrow` nor `authorization`, or its `extra.autoCapture` is `true`. |
| `x402/legal-context-conflict` | `advertise` finds an `extensions.legalContext` already in the document with other values, or the Cloudflare batch pairing's `build` finds that the document's legal context carries a hash other than H. |
| `x402/legal-context-malformed` | The link or agreement URL given to `advertise` is not a usable `https` URL of at most 2048 characters, H is invalid, or the document's `extensions` is not an object; or `extensions.legalContext.info` does not decode as a legal context, has a link over 2048 characters, or carries an agreement URL that is malformed or given in both spellings with different values. |
| `x402/link-not-https` | The link or agreement URL given to `advertise`, or found in the document's `extensions.legalContext.info` by `read`, is an absolute URL of at most 2048 characters whose scheme is not `https`. |
| `x402/manager-not-reference` | At the ERC-7710 salt level, the payment's `delegationManager` is not the reference DelegationManager on a chain where it is deployed. |
| `x402/no-legal-context` | The document or presented payment has no `extensions.legalContext`, or (for the unsigned ERC-7710 level and Aptos `bound`) the echoed `extensions.legalContext.info` does not decode. |
| `x402/no-payable-option` | `read` finds no option in the document's `accepts` that this pairing serves. |
| `x402/nonce-malformed` | A presented Permit2 payment's `nonce` is not a decimal below 2^256 or `0x` followed by 64 hex digits. |
| `x402/nonce-not-payment` | A presented `auth-capture` payment's signed nonce does not decode, or is not the escrow payment hash recomputed from the option's terms, the salt and the expiry. |
| `x402/not-an-opening` | `bound` or `reference` refuses a presented payment that is not a channel opening: its payload `type` is not `deposit`, or its channel instruction is not `open`. |
| `x402/not-bound-within` | The SVM batch pairing's `channel.boundWithin` always refuses, because a voucher within the channel carries no hash. |
| `x402/not-v2` | The payment document given to `advertise`, `read` or `build`, or the payment presented to `bound` or `reference`, is not an object whose `x402Version` is 2. |
| `x402/option-malformed` | The document's `accepts` is not an array of at most 32 options, an option this pairing names lacks what the pairing needs to pay it (a valid amount, asset, `payTo`, positive `maxTimeoutSeconds`, token name and version, or its scheme's required `extra` members), or the buyer's choice given to `build` carries an invalid payer address, `now`, key, nonce, sequence, deposit or amount. |
| `x402/option-not-in-document` | The option given to `advertise` or chosen in `build` is not one of the document's `accepts`, compared by identity or RFC 8785 form. |
| `x402/option-not-this-pairing` | The option offered, chosen or presented (as the payment's `accepted`) is not one this pairing serves: its scheme, network, asset transfer method, payment flow or fields belong to another pairing or to none. |
| `x402/payload-malformed` | The presented EIP-3009 payment carries a `refused` member, the presented payment's `accepted` or `payload` is not an object or lacks a member the pairing reads (authorization, Permit2 authorization, delegation fields, transaction, channel config, voucher or deposit), a member does not decode to a valid address, amount, deadline or digest, or H given to `build` is not a valid ATR hash. |
| `x402/permission-context-malformed` | The ERC-7710 `permissionContext` given to `complete` is not hex of at most 32 KiB, or at the salt level it does not decode as a list of delegations. |
| `x402/request-target-invalid` | `requestCommitment` refuses a request whose method or target is not a string, whose body is not a `Uint8Array`, or whose target does not start with `/` or contains a character outside visible ASCII. |
| `x402/request-too-large` | `requestCommitment` refuses a request target longer than 8192 characters or a body larger than 1 MiB. |
| `x402/salt-malformed` | A presented `auth-capture` payment's `salt`, or its `saltNonce` when the option binds a receiver authorizer or policy, is not `0x` followed by 64 hex digits. |
| `x402/salt-not-bound` | A presented `auth-capture` payment's `salt` is not the commitment of its `saltNonce` to the option's receiver authorizer and policy. |
| `x402/signature-malformed` | A signature given to `complete` or carried in the presented payload is missing, not hex (or bytes) of the length the pairing requires, or not the number of signatures the request asked for. |
| `x402/signed-not-bound` | `complete` refuses a signed transaction from which the pairing cannot read H back (or its read keys), or which carries a hash other than H. |
| `x402/spender-not-proxy` | A presented Permit2 payment's `spender` is not the x402 Permit2 proxy for its scheme (`exact` or `upto`). |

## mpp

MPP challenges and credentials, and the checks every MPP pairing shares (`@integraledger/lcp/mpp`).

| Code | Meaning |
|---|---|
| `mpp/access-key-malformed` | A Tempo subscription challenge's `methodDetails.accessKey` is not an object with an address `accessKeyAddress` and a `keyType` of `p256`, `secp256k1` or `webAuthn`. |
| `mpp/attribution-malformed` | `checkAttribution` is given a memo that is not 32 bytes of hex, or a Hedera charge's memo is not UTF-8 or not an attribution memo. |
| `mpp/attribution-mismatch` | An attribution memo's tag, version, server id for the realm, or nonce for the challenge id is not the expected value. |
| `mpp/carrier-not-challenge` | The hash the payment carries (the Lightning invoice's description hash, the Solana memo, the XRPL `InvoiceID` or memo, the session opening's salt, or the NEAR Intents `externalId`) is not the hash the echoed challenge's id derives from. |
| `mpp/carrier-occupied` | `advertise` for a card, Stripe or `usdc` Solana charge finds the carrier member already holding a value other than H's LCP string. |
| `mpp/carrier-taken` | A challenge as issued already carries an LCP member (`legalContext`, `legalContextUrl` or `legalContextAgreementUrl`) in its `opaque`, or a Tempo charge challenge already has a `methodDetails.memo`. |
| `mpp/chain-id-required` | An EVM session or Tempo subscription challenge has no positive integer `chainId`, a Tempo session challenge's `chainId` is present but not a positive integer, or a Tempo session using `sessionProtocol` `v2` lacks `chainId` or `escrowContract`. |
| `mpp/challenge-malformed` | A challenge is not challenge-shaped: `parseChallenges` finds a repeated parameter or a missing or empty required one, `place`, `read` or `issuedDigest` is given more than 32 challenges or one without the required members, `challengeId` is given an invalid H or a position outside 0 to 31, a Hedera charge `build` is given a challenge without a string `id` and `realm`, or H or a value to hash cannot be written in its canonical form. |
| `mpp/channel-named` | A session challenge as issued already names a channel (`channelId`, or an EVM or Tempo `sessionSnapshot`), so it is not a challenge to open one. |
| `mpp/channel-not-bound` | An EVM session opening's `channelId` is not the channel id computed from the payer, payee, token, H as salt, signer, escrow and chain. |
| `mpp/credential-malformed` | A credential is not an object with an echoed challenge carrying an `id`, an optional string `source` and a `payload` object, carries a `refused` member, exceeds the credential size bound, or lacks a payload member the pairing reads (signature, nonce, hash, transaction, salt, channel id, authorization fields or landed logs) in the required form; or a signature or hash given to `complete` is not the required hex, or the Lightning `build` choice has no challenge with a string `id`. |
| `mpp/credential-type` | The credential's payload `type` is not one the pairing accepts (such as `transaction`, `hash`, `authorization`, `permit2`, `transfer` or `keyAuthorization`). |
| `mpp/credential-types` | The challenge's `credentialTypes` is not a non-empty array of types the method defines, or leaves no pairing (EVM `splits` allow only Permit2), or the credential type the buyer asks a session `build` for is not one the challenge lists. |
| `mpp/escrow-malformed` | An EVM or Tempo session challenge's `methodDetails.escrowContract` is not an address. |
| `mpp/expires-required` | The challenge has no `expires`, or its `expires` is not a valid RFC 3339 date-time. |
| `mpp/gateway-unread` | The `usdc` Gateway credential's `authorization` is not a single `circle-gateway-v1` signed burn intent whose spec carries a bytes32 `salt`, decimal value and fee, and readable signer and recipient accounts. |
| `mpp/header-malformed` | `parseChallenges` refuses field values that are not an array of strings of at most 8 KiB each, that do not parse by RFC 9110's challenge grammar, or that carry more than 32 `Payment` challenges. |
| `mpp/id-not-ours` | A challenge id is not the base64url of an ATR hash in the form this package writes it (with a position 0 to 31, or bare for a Tempo subscription), or the id does not derive from H given to `build`, or a held session opening is bound to a hash other than H. |
| `mpp/input-malformed` | The buyer's input to `build`, `buildWithin` or `complete` is not what the pairing needs: no chosen challenge object, or an invalid payer address, token domain, spender, client id, deposit, signer, cumulative amount, fee, key or other value the pairing reads. |
| `mpp/legal-context-conflict` | `place` finds LCP members already in the challenge's `opaque` with other values, or `read` finds challenges that carry different hashes, links or agreement URLs. |
| `mpp/legal-context-malformed` | The link or agreement URL given to `place` is not a usable `https` URL of at most 2048 characters, or `read` finds a challenge whose `legalContextUrl` or `legalContextAgreementUrl` is not one (and, for the link, no challenge reads). |
| `mpp/link-not-https` | The link or agreement URL given to `place`, or found in a challenge's `opaque` by `read` when no challenge reads, is an absolute URL of at most 2048 characters whose scheme is not `https`. |
| `mpp/metadata-malformed` | A Stripe challenge's `methodDetails.metadata` is not an object within Stripe's bounds (key count including the one `advertise` adds, key length and characters, string values of bounded length). |
| `mpp/modes-pull-only` | A Tempo charge challenge leaves no mode to pay in: its `supportedModes` omits `pull`, and either omits `push` or the challenge sets `feePayer` to `true`. |
| `mpp/network-unnamed` | `network` refuses a challenge whose method names no network, such as a `usdc` Gateway challenge. |
| `mpp/no-legal-context` | `read` finds no challenge whose `opaque` carries an LCP hash and a link and whose id derives from that hash. |
| `mpp/no-signed-place` | `bound` of the EVM `transaction` and `hash` charge pairings, and `build` and `bound` of the card and Stripe pairings, always refuse, because nothing the buyer signs carries H. |
| `mpp/nonce-not-challenge-hash` | The EVM `authorization` credential's `nonce` is not keccak256 of the challenge's id and realm. |
| `mpp/nonce-not-channel` | An EVM session opening of type `authorization` carries a `nonce` other than the one derived from the payer, recipient, currency, H and signer. |
| `mpp/nonce-not-usdc-derivation` | The `usdc` EVM credential's `nonce` is not the `usdcNonce` derived from the challenge's id, realm and request hash. |
| `mpp/not-an-opening` | The session credential presented as the opening is not one: its action is not `open` (EVM, Tempo) or its payload `type` is not the opening's (`transaction` on Tempo, `keyAuthorization` on a Tempo subscription). |
| `mpp/not-bound-within` | `channel.boundWithin` refuses a payment within the channel that carries no hash: an EVM session, a Tempo session under `sessionProtocol` `v1`, a Tempo subscription, a Hedera or XRPL session, a Solana payment other than `use`, a Lightning bearer or top-up, or a Stripe renewal. |
| `mpp/not-this-pairing` | The challenge's intent and method name no pairing this package defines, the challenge (offered, chosen, echoed or held) does not offer the pairing whose function was called, or `place` finds no challenge in the document whose bound members equal the option. |
| `mpp/opaque-malformed` | The challenge's `opaque` does not decode as a base64url JSON object of strings, or the `opaque` that `place` would write is larger than 8 KiB. |
| `mpp/opaque-not-this-hash` | The echoed challenge has no `opaque`, or its `opaque` does not carry a `legalContext` equal to the hash its id derives from. |
| `mpp/receipt-malformed` | The Stripe subscription's activation receipt is not a successful `stripe` receipt with a Stripe subscription ID of 1 to 255 visible ASCII characters. |
| `mpp/receipt-missing` | The Stripe subscription's `channel.ref` is given no activation receipt. |
| `mpp/request-malformed` | A challenge's `request` does not decode as a base64url JSON object of at most 8 KiB, its `methodDetails` is not an object, a member its intent and method require (amount, currency, recipient, addresses, networks, period, channel id or profile fields) is missing or malformed, or the request re-encoded with the carrier placed would exceed 8 KiB. |
| `mpp/request-not-jcs` | `usdcRequestHash` finds that the challenge's decoded `request` bytes are not the RFC 8785 form of their own parse. |
| `mpp/salt-not-this-hash` | An EVM session opening's `salt`, or its Permit2 witness `salt`, is not the hash the echoed challenge's id derives from. |
| `mpp/salt-not-usdc-derivation` | The `usdc` Gateway credential's TransferSpec `salt` is not the `usdcGatewaySalt` derived from the challenge and the credential's own values. |
| `mpp/session-action` | A session credential's or `buildWithin` input's `action` is not one the pairing defines (such as `open`, `voucher`, `topUp`, `use`, `bearer` or `close`), or a credential presented as an opening does not have `action` `open`. |
| `mpp/session-protocol` | A Tempo session challenge's `sessionProtocol` is neither `v1` nor `v2`. |
| `mpp/source-required` | The credential's `source` is not a `did:pkh:eip155` DID naming the payer, which the EVM Permit2 `reference` and a `hash`-type EVM session opening need. |
| `mpp/splits-malformed` | An EVM charge challenge's `methodDetails.splits` is not an array of 1 to 10 entries, each with an address `recipient` and a non-zero decimal `amount`. |
| `mpp/stacks-memo-not-h` | The `usdc` Stacks transaction is not a contract call to `transfer` whose fourth argument is `(some H)`. |
| `mpp/stacks-tx-malformed` | The `usdc` Stacks credential's `transactionFormat` is not the one read, or its `transaction` is not base64 of a non-empty Stacks transaction within the size bound that decodes and re-serialises to the same bytes. |
| `mpp/usdc-profile` | A `usdc` charge challenge's `methodDetails.type` does not name one of `evm`, `solana`, `stacks` or `gateway`, the named profile's details are not an object, or `methodDetails` also holds another profile's details. |
| `mpp/within-action-not-built` | `buildWithin` is asked for an action it does not build (`topUp`, `use` or `bearer`), or for a voucher on a Solana channel whose vouchers the operator signs. |
| `mpp/witness-not-challenge-hash` | The EVM `permit2` credential's `witness.challengeHash` is not keccak256 of the challenge's id and realm. |
| `mpp/witness-taken` | `place` refuses a Tempo subscription challenge in a document that holds another Tempo subscription challenge, because both would take the same id derived from H. |

## ack

ACK Payment Requests and receipts (`@integraledger/lcp/ack`).

| Code | Meaning |
|---|---|
| `ack/id-not-lcp` | `read` finds that the signed token's `id` is not an ATR hash in LCP's string form (`lcp:sha256:H`). |
| `ack/legal-context-conflict` | `read` finds that the hash in the body's `legalContext` differs from the hash in the signed token's `id`. |
| `ack/legal-context-malformed` | `advertise` refuses an invalid ATR hash, a link that is not a usable `https` URL of at most 2048 characters, or an agreement URL that is not a valid `https` link; `read` refuses a body `legalContext` that does not decode, whose link exceeds 2048 characters, or whose agreement URL is malformed or given twice with different values. |
| `ack/link-not-https` | The link or agreement URL given to `advertise`, or found in the body's `legalContext` by `read`, is an absolute URL whose scheme is not `https`. |
| `ack/no-legal-context` | `read` finds no `legalContext` in the 402 body. |
| `ack/no-signed-place` | ACK defines no payer signature, so `build` and `bound` of `ack/payment-request` always return this refusal. |
| `ack/option-malformed` | `advertise` refuses a payment option that is not an object with a non-empty string `id`. |
| `ack/receipt-malformed` | `fromReceipt` refuses a `credentialSubject` that is not a serialisable JSON object or whose embedded `paymentRequestToken` does not carry an `id` in LCP's string form. |
| `ack/token-malformed` | `read` refuses a 402 body that is not a serialisable JSON object, a `paymentRequestToken` that is not a compact JWS with a JSON object payload, or a token payload whose `paymentOptions` is not an array. |
| `ack/too-large` | `read` refuses a 402 body over 64 KiB, a token over 16384 characters or more than 16 payment options, and `fromReceipt` refuses a `credentialSubject` over 64 KiB. |

## acp

ACP checkout sessions and delegated payments (`@integraledger/lcp/acp`).

| Code | Meaning |
|---|---|
| `acp/allowance-changed` | The `complete` function returned by `build` refuses a `delegate_payment` request that is not an object or whose `allowance` differs from the one built. |
| `acp/allowance-malformed` | `bound` refuses a presented request that is not an object or whose `allowance` is not exactly ACP's six members with `reason` `one_time`. |
| `acp/choice-malformed` | `build` refuses a choice that is not an object, or whose `max_amount`, `currency`, `merchant_id` or `expires_at` is not a non-negative safe integer, a three-letter lowercase code, a non-empty string and an RFC 3339 date-time respectively. |
| `acp/hash-not-session` | `build` refuses when H is not a valid ATR hash or the chosen session's `id` is not H. |
| `acp/id-conflict` | `advertise` finds that the session already has an `id` other than H. |
| `acp/id-not-hash` | `read` finds that the session's `id` is not an ATR hash, or `bound` finds that the allowance's `checkout_session_id` is not one. |
| `acp/legal-context-conflict` | `advertise` finds a different `metadata.legal_context` already in the session, or `read` finds that the hash in `metadata.legal_context` differs from the session's `id`. |
| `acp/legal-context-malformed` | `advertise` refuses an invalid ATR hash, a link that is not a usable `https` URL of at most 2048 characters, or a malformed agreement URL; `read` refuses a `metadata.legal_context` that does not decode, whose link exceeds 2048 characters, or whose agreement URL is malformed or given in both spellings with different values. |
| `acp/link-not-https` | The link or agreement URL given to `advertise`, or found in `metadata.legal_context` by `read`, is an absolute URL whose scheme is not `https`. |
| `acp/no-legal-context` | `read` finds no `metadata.legal_context` in the session. |
| `acp/not-buyer-signed` | `bound` of `acp/checkout/undelegated` always refuses, because nothing the buyer signs names the hash. |
| `acp/nothing-to-sign` | `build` of `acp/checkout/undelegated` always refuses, because a handler that does not require `delegate_payment` gives the buyer nothing to sign. |
| `acp/option-malformed` | `advertise` refuses a handler option that is not an object with a boolean `requires_delegate_payment`. |
| `acp/session-malformed` | `advertise` or `read` refuses a checkout session that is not a serialisable JSON object, or (in `advertise`) whose `metadata` is present but not an object. |
| `acp/too-large` | The checkout session exceeds 1 MiB or (in `read`) its `id` is longer than a hash, or the buyer's choice given to `build` has a `merchant_id` over 256 characters or an `expires_at` over 64 characters. |

## ap2

AP2 checkouts, Checkout Mandates and the SD-JWT reader under them (`@integraledger/lcp/ap2`).

| Code | Meaning |
|---|---|
| `ap2/checkout-hash-mismatch` | `bound` finds that the mandate discloses a `checkout_jwt` different from the presented one. |
| `ap2/checkout-id-missing` | The checkout payload has no `id`, or its `id` is not a non-empty string. |
| `ap2/checkout-not-latest` | `bound` finds that the mandate's `checkout_hash` is not the SHA-256 of the presented `checkout_jwt`. |
| `ap2/disclosure-unreferenced` | The Checkout Mandate carries a disclosure that no digest in its payload references. |
| `ap2/hash-not-in-checkout` | `build` finds that the hash in the offer's checkout JWT is not H. |
| `ap2/jws-malformed` | A checkout JWT (given to `jwsPayload`, `read`, `build` or `bound`, or as a payload to `advertise`) is not a compact JWS whose payload is one JSON object, or `advertise` is given a payload that is not a serialisable JSON object. |
| `ap2/legal-context-conflict` | `advertise` finds a different `legalContext` already in the checkout payload. |
| `ap2/legal-context-malformed` | The link or agreement URL given to `advertise` is not a usable `https` URL of at most 2048 characters or H is invalid, or the checkout payload's `legalContext` does not decode, has a link over 2048 characters, or has an agreement URL that is malformed or given in both spellings with different values. |
| `ap2/link-not-https` | The link or agreement URL given to `advertise`, or the link or agreement URL found in the checkout payload's `legalContext` by `read`, `build` or `bound`, is an absolute URL whose scheme is not `https`. |
| `ap2/mandate-ambiguous` | The resolved SD-JWT contains more than one object whose `vct` is `mandate.checkout.1`. |
| `ap2/mandate-malformed` | The Checkout Mandate is not a well-formed SD-JWT presentation (bad segments, disclosures, or a digest referenced twice), its `checkout_hash` is not 43 base64url characters, its `checkout_jwt` is present but not a string, the presentation given to `bound` is not an object, or `checkoutJwtOf` finds no disclosed `checkout_jwt`. |
| `ap2/no-checkout-mandate` | The resolved SD-JWT contains no object whose `vct` is `mandate.checkout.1`. |
| `ap2/no-legal-context` | The checkout payload read by `read`, `build` or `bound` has no `legalContext` member. |
| `ap2/option-malformed` | `advertise` refuses an option that is not an object with exactly one member, `checkout`, a string of 1 to 256 characters. |
| `ap2/option-not-this-checkout` | `advertise` finds that the option's `checkout` is not the payload's `id`. |
| `ap2/sd-alg-unsupported` | The Checkout Mandate's `_sd_alg` names a digest algorithm other than `sha-256`. |
| `ap2/too-large` | A checkout JWT, Checkout Mandate or checkout payload exceeds 1 MiB or nests deeper than 64 levels, a mandate carries too many disclosures or nests them too deeply, or a checkout `id` is longer than 256 characters. |

## ucp

UCP checkouts and bookings (`@integraledger/lcp/ucp`).

| Code | Meaning |
|---|---|
| `ucp/already-signed` | `advertise` refuses a checkout that already carries `ap2.merchant_authorization`, because the link must be placed before the business signs. |
| `ucp/ap2-not-active` | An AP2 Mandate pairing's `read` or `build` finds no `ap2.merchant_authorization` in the checkout in detached JWS form. |
| `ucp/checkout-malformed` | The checkout (or booking) is not a serialisable JSON object with a non-empty string `id`, its `links` is present but not an array, or the offer given to `build` is not an object. |
| `ucp/hash-not-in-checkout` | The AP2 Mandate pairing's `build` finds that the checkout's `legal_context` link carries a hash other than H. |
| `ucp/legal-context-conflict` | The checkout has more than one `legal_context` link or more than one `legal_context_agreement` link, or `advertise` finds an existing `legal_context` or `legal_context_agreement` link whose values differ from the ones it would write (including an existing `legal_context` link with no agreement link when an agreement URL is given). |
| `ucp/legal-context-malformed` | The `legal_context` link's `title` is not an ATR hash in LCP's string form, its `url` or a `legal_context_agreement` link's `url` is not a usable `https` URL of at most 2048 characters, or the link, agreement URL or H given to `advertise` is invalid. |
| `ucp/link-not-https` | The link or agreement URL given to `advertise`, or the `url` of the checkout's `legal_context` or `legal_context_agreement` link, is an absolute URL whose scheme is not `https`. |
| `ucp/no-legal-context` | The checkout has no `links` or no link whose `type` is `legal_context`. |
| `ucp/not-buyer-signed` | `bound` of the unsigned checkout and booking pairings always refuses, because nothing the buyer signs carries the hash. |
| `ucp/nothing-to-sign` | `build` of the unsigned checkout and booking pairings always refuses, because the buyer signs nothing. |
| `ucp/option-malformed` | `advertise` refuses an option that is not an object with exactly one member, `checkout` or `booking` as the pairing requires, a string of 1 to 256 characters. |
| `ucp/option-not-this-checkout` | `advertise` finds that the option names a checkout or booking other than the document's `id`. |
| `ucp/too-large` | The checkout exceeds 1 MiB as JSON, its `id` exceeds 256 characters, or its `links` holds, or after `advertise` would hold, more than 64 entries. |

## card

Visa TAP, Mastercard Verifiable Intent and the plain card checkout (`@integraledger/lcp/card`).

| Code | Meaning |
|---|---|
| `card/legal-context-malformed` | The link or agreement URL given to `advertise` is not a usable `https` URL of at most 2048 characters, or H given to `advertise` or to the Visa TAP `build` is invalid, or a `legalContext` read from the shown JSON or a `checkout_jwt` does not decode, has a link over 2048 characters, or has an agreement URL that is malformed or given in both spellings with different values. |
| `card/link-not-https` | The link or agreement URL given to `advertise`, or the link or agreement URL found in a `legalContext` by `read`, is an absolute URL whose scheme is not `https`. |
| `card/no-legal-context` | The JSON the seller showed (for `card/visa-tap` and `card/seller-reference`) or the payload of a `checkout_jwt` (for Verifiable Intent) has no `legalContext` member. |
| `card/no-signed-place` | `build` and `bound` of `card/seller-reference` always refuse, because nothing the buyer signs carries the hash. |
| `card/option-malformed` | `advertise` refuses a card option that is not an object with a known `scheme` and a `checkout` of 1 to 128 visible ASCII characters. |
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
| `card/vi-key-malformed` | In autonomous mode, L2 does not delegate exactly one open checkout mandate whose `cnf.jwk` is an EC P-256 key with a string `kid`, L1's `cnf.jwk` is not an EC P-256 key, or a key cannot be imported for verification. |
| `card/vi-kid-mismatch` | In autonomous mode, the `kid` in L3b's header is not the `kid` of the agent key that L2 delegates. |
| `card/vi-legal-context-conflict` | The Verifiable Intent `build` finds that the hash in the `checkout_jwt` is not H. |
| `card/vi-malformed` | A Verifiable Intent input is not what it must be: the presentation is not an object, a layer or `checkout_jwt` is not a string, not a well-formed compact JWS or SD-JWT with a JSON object payload, has no disclosures or trailing `~`, has an `_sd_alg` other than `sha-256`, or lacks a `delegate_payload` array of `{"...": digest}` entries. |
| `card/vi-no-checkout-mandate` | A Verifiable Intent layer's `delegate_payload` does not reference exactly one `mandate.checkout.1` mandate. |
| `card/vi-sd-hash-mismatch` | In autonomous mode, L3b's `sd_hash` is not the digest of L2, or L2's `sd_hash` is not the digest of L1. |
| `card/vi-signature-invalid` | In autonomous mode, the ES256 signature on L3b or L2 is not 64 bytes or does not verify under the delegated key. |
| `card/vi-transaction-id-mismatch` | A `mandate.payment.1` mandate in the same layer has a `transaction_id` other than the digest of the checkout mandate's `checkout_jwt`. |
| `card/vi-typ` | A Verifiable Intent layer's header does not have `alg` `ES256` and the expected `typ`, or (in autonomous mode) L3b's header has no string `kid`. |

## a2a

The A2A extension (`@integraledger/lcp/a2a`).

| Code | Meaning |
|---|---|
| `a2a/legal-context-conflict` | `place` finds a different legal context already under an extension URI in the task's `metadata`, or `read` finds values under two extension URIs that disagree. |
| `a2a/legal-context-malformed` | `place` refuses a task or `metadata` that is not an object, an invalid ATR hash, or a link that is not a usable `https` URL of at most 2048 characters; `read` refuses a value under the extension URI that does not decode as a legal context or whose link exceeds 2048 characters. |
| `a2a/link-not-https` | The link to the seller's copy, given to `place` or found by `read`, is an absolute URL whose scheme is not `https`. |
| `a2a/no-legal-context` | `read` finds no legal context under any extension URI in the task's `metadata`. |
| `a2a/no-signed-place` | The exported `binding` value: A2A signs nothing per transaction, so every request for an A2A pairing gets this refusal. |
| `a2a/too-large` | The legal context value written by `place` or found by `read` under the extension URI is larger than 4096 bytes of JSON. |

## evm

EVM chains: typed data, logs and the settlement read (`@integraledger/lcp/evm`).

| Code | Meaning |
|---|---|
| `evm/ambiguous` | An EVM `recover` finds more than one candidate hash in the transaction: several distinct `AuthorizationUsed` nonces, several distinct leaf salts, or several `ChannelCreated` logs. |
| `evm/amount-malformed` | An amount given to an EVM typed-data, digest or payment-hash helper is not an unsigned integer within its type's width (uint256, or uint120 for an escrow `maxAmount`). |
| `evm/channel-id-mismatch` | `batchChannelCreated` finds that the channel id computed from a `ChannelCreated` log's data is not the id in its topic. |
| `evm/field-malformed` | A value given to an EVM helper is not what the ABI or EIP-712 type requires: an address, uint256, bytes32, time bound or fee outside its width, an empty or oversized Permit2 batch, an invalid witness type, a permission context or `ChannelCreated` log that does not decode strictly, or a malformed channel config. |
| `evm/network-malformed` | A network is not an `eip155:<chain id>` CAIP-2 name, or a chain id given to `eip3009TypedData`, `permit2TypedData` or `batchChannelId` is not a positive safe integer. |
| `evm/no-authorization-use` | `eip3009Recover` finds no `AuthorizationUsed` log from the asset in the transaction. |
| `evm/no-channel-created` | The EVM batch pairing's `recover` finds no `ChannelCreated` log from the batch-settlement contract in the transaction. |
| `evm/no-leaf` | `redeemedLeafRecover` finds no `RedeemedDelegation` log from the DelegationManager whose delegate is the redeemer or the wildcard. |
| `evm/not-found` | The reader found no receipt for the transaction the reference names. |
| `evm/reverted` | The transaction the reference names reverted. |
| `evm/unreadable` | The reader threw, or returned a receipt or log that is not well formed, when an EVM `recover` read the transaction. |
| `evm/wrong-reader` | The reader passed to an EVM `recover` or `status` answers for a different network than the reference names. |

## tempo

Tempo: transactions, memos, channels and key authorizations (`@integraledger/lcp/tempo`).

| Code | Meaning |
|---|---|
| `tempo/ambiguous` | More than one candidate carries the binding: several `transferWithMemo` calls or logs with the challenge's attribution memo, several `KeyAuthorizationWitness` logs, or several accounts whose key authorization carried H. |
| `tempo/descriptor-mismatch` | A Tempo v2 session descriptor is missing or malformed (a non-address party, an invalid salt, nonce hash or chain), its channel id is not the payload's `channelId`, or its `salt` is not H. |
| `tempo/key-authorization-malformed` | A Tempo key authorization does not encode or decode as the bounded RLP structure (items, limits, scopes, witness and signature), or the subscription credential's `signature` is not a string. |
| `tempo/key-not-authorized` | `keyAccount` finds that the receipt has no `KeyAuthorized` log registering the key for the account whose key authorization carried H. |
| `tempo/memo-not-bound` | The signed or landed Tempo transfer carries no `transferWithMemo` to the challenge's currency whose memo is the challenge's attribution memo. |
| `tempo/no-access-key` | `keySearch` is given a reference with no well-formed access key (key id, token and recipient digest). |
| `tempo/no-witness` | The Tempo subscription's key authorization carries no witness, or a receipt holds no `KeyAuthorizationWitness` log (for `witnessRecover`, or naming H for `keyAccount`). |
| `tempo/not-found` | The reader found no receipt for the transaction, or the transaction hash is not a 32-byte hash. |
| `tempo/open-ambiguous` | The signed Tempo session opening has more than one `open` call to the challenge's escrow contract. |
| `tempo/open-not-found` | The signed Tempo session opening has no `open` call to the challenge's escrow contract. |
| `tempo/reverted` | The Tempo transaction reverted. |
| `tempo/salt-not-bound` | The salt word of the Tempo session opening's `open` call is not H. |
| `tempo/tx-malformed` | A Tempo transaction does not decode as a type-`0x76` RLP envelope with the expected fields and at most the allowed calls, `memoCalldata` is given an invalid recipient, amount or memo, `expiringNonceHash` is given a sender that is not an address, or a Tempo session opening's `open` call input has the wrong length. |
| `tempo/tx-too-large` | A Tempo transaction's wire bytes exceed the size bound. |
| `tempo/unreadable` | The Tempo reader is missing, answers for another network or threw, the receipt or its logs are not well formed, or `keyAccount` is given an invalid H, key id or receipt, or finds a keychain log whose account topic is not a padded address. |
| `tempo/witness-not-bound` | The Tempo subscription's key authorization witness is not the hash the echoed challenge's id derives from. |

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
| `svm/err` | The landed Solana transaction failed with an error: the one a recovery reads, or the one an MPP Solana `signature` credential names. |
| `svm/input-malformed` | The buyer's input to a Solana `build`, `complete` or message helper is not valid: a payer, key or blockhash that is not a base58 key, a token program other than the option's, an out-of-range amount, slot or compute budget, a signature that is not 64 bytes or not for a required signer, a session challenge with malformed Solana details, or MPP `splits` or `confidential` transfers, which are not built. |
| `svm/memo-count` | The Solana transaction has no top-level Memo instruction or more than one (x402), or more than one Memo instruction carrying an LCP string (MPP). |
| `svm/memo-not-lcp` | The Solana transaction's one Memo instruction does not carry an ATR hash in LCP string form. |
| `svm/memo-not-utf8` | The Solana transaction's one Memo instruction's data is not UTF-8. |
| `svm/network-malformed` | A Solana network is not `mainnet`, `devnet` or `localnet` in an MPP challenge, or not a Solana CAIP-2 name in an x402 option. |
| `svm/network-undeclared` | The MPP Solana challenge names `localnet`, which has no CAIP-2 network to read on. |
| `svm/no-carrier` | The Solana transaction presented for an MPP charge has no Memo instruction carrying an ATR hash in LCP string form. |
| `svm/no-channel-instruction` | The Solana transaction has no top-level payment-channels instruction. |
| `svm/nonce-account-not-static` | The Solana message's first instruction is `AdvanceNonceAccount` and names its nonce account or the `RecentBlockhashes` sysvar through an address lookup table, so the message alone cannot show the durable nonce a reference records. |
| `svm/not-found` | The Solana reader found no landed transaction for the signature. |
| `svm/open-not-found` | The MPP Solana session transaction has no single `open` instruction of the challenge's channel program with the required data and accounts, or the program key is invalid. |
| `svm/pda-not-found` | `findPda` is given an invalid program key or too many or too long seeds, or no bump yields an off-curve address. |
| `svm/peer-missing` | The optional peer dependency `@solana/kit` cannot be loaded to build a Solana message. |
| `svm/proof-not-challenge` | The MPP Solana session credential's `authentication.challengeId` is not the echoed challenge's id, or a `use` credential carries no such proof. |
| `svm/read-first` | An MPP Solana `signature` credential carries no transaction yet; the seller reads it with `fetchPresented` before `bound`. |
| `svm/tx-malformed` | A Solana transaction is not non-empty base64 of a well-formed unversioned or v0 wire transaction (signature count, header, keys, instructions and lookup tables consistent and fully consumed), or an MPP `bundle` credential's `transactions` is not an array within the bound. |
| `svm/tx-too-large` | A Solana transaction, or its base64 text, exceeds the wire size bound. |
| `svm/unreadable` | The Solana reader threw or returned a landed transaction that is not well formed. |
| `svm/wrong-reader` | The Solana reader answers for a different network than the reference or challenge names. |

## stellar

Stellar (`@integraledger/lcp/stellar` and the Stellar pairings).

| Code | Meaning |
|---|---|
| `stellar/carrier-mismatch` | The option's `payTo` or the challenge's `recipient` does not carry the muxed id derived from H, or the signed transfer's recipient or muxed id is not the one the option or challenge names. |
| `stellar/carrier-occupied` | `advertise` finds the x402 option's `payTo` not a plain account, or the MPP challenge's `recipient` already muxed. |
| `stellar/event-malformed` | `transferEventOf` is given topics or data that do not decode as a SEP-41 `transfer` event with an address recipient within the value caps. |
| `stellar/network-malformed` | A Stellar network is not `stellar:pubnet` or `stellar:testnet`. |
| `stellar/no-address-auth` | The Stellar operation does not carry exactly one address-credential authorization entry for the transfer's `from`, or the payer is not an Ed25519 account. |
| `stellar/no-carrier` | The signed Stellar transfer's recipient is not a muxed address, so it carries no muxed id. |
| `stellar/not-found` | The Stellar reader found no transaction envelope for the hash. |
| `stellar/not-one-transfer` | The Stellar envelope does not hold exactly one `invokeHostFunction` operation calling a SEP-41 `transfer(from, to, amount)`, the payer's signed root invocation is not one such transfer with no sub-invocations, or the operation does not invoke exactly what the payer signed. |
| `stellar/option-malformed` | An MPP Stellar challenge's `network`, `amount`, `currency`, `recipient` or `feePayer` is not of the required form, a recipient cannot take a muxed id, or `transferEventTopics` is given an address that is neither an account nor a contract. |
| `stellar/peer-missing` | The optional peer dependency `@stellar/stellar-sdk` cannot be loaded. |
| `stellar/read-first` | An MPP Stellar `hash` credential carries no transaction yet; the seller reads it with `fetchPresented` before `bound`. |
| `stellar/tx-malformed` | A Stellar transaction envelope is not strict base64 of a v1 envelope XDR within the value caps, the signing inputs (current ledger, time, expiration, signature, envelope type) are invalid, or a credential or buyer choice carries no transaction where one is required. |
| `stellar/tx-failed` | The transaction an MPP Stellar `hash` credential names is recorded `FAILED` on the ledger, so it moved nothing. |
| `stellar/tx-too-large` | A Stellar transaction envelope's base64 text exceeds the size bound. |
| `stellar/unreadable` | The Stellar reader threw, returned a response that is not an object, or reported a status other than `SUCCESS`, `FAILED` or `NOT_FOUND`. |
| `stellar/wrong-reader` | The Stellar reader answers for a different network than the challenge names. |

## xrpl

The XRP Ledger (`@integraledger/lcp/xrpl` and the XRPL pairings).

| Code | Meaning |
|---|---|
| `xrpl/blob-malformed` | An XRPL signed blob is not a string of hex, nests fields deeper or holds more fields than the caps allow (checked before it is decoded), does not decode, is not the canonical serialization of what it decodes to, lacks `TransactionType` or `Account`, or a credential or `complete` call carries no string blob. |
| `xrpl/blob-too-large` | An XRPL signed blob exceeds 4 KiB. |
| `xrpl/carrier-mismatch` | The option's `extra.invoiceId` or the challenge's `invoiceId` is not the one derived from H when `build` is called, or the signed `Payment`'s `InvoiceID` is not the one the option or challenge names. |
| `xrpl/carrier-not-lcp` | The x402 XRPL option's `extra.invoiceId` is not an ATR hash in LCP string form. |
| `xrpl/carrier-occupied` | `advertise` finds the option's `extra.invoiceId`, or the MPP challenge's `invoiceId`, already holding a value other than the one derived from H. |
| `xrpl/currency-not-xrp` | An MPP XRPL session challenge names a `currency` other than `XRP`. |
| `xrpl/memo-count` | The XRPL session opening carries more than 8 memos, or more than one memo carrying an LCP string. |
| `xrpl/memos-not-carried` | The MPP XRPL charge `build` refuses a challenge whose `methodDetails` carries `memos`. |
| `xrpl/multisigned` | The signed blob presented to `x402/exact/xrpl`, `mpp/charge/xrpl` or the `mpp/session/xrpl` opening carries `Signers`: the XRPL pairings take a transaction the payer signed with a single key, whose transaction hash is the one that can land. |
| `xrpl/network-malformed` | The MPP XRPL challenge's `methodDetails.network` is not one of the XRPL network names this package maps. |
| `xrpl/network-missing` | The MPP XRPL challenge's `methodDetails` names no `network`, which has no default. |
| `xrpl/no-invoice-id` | The XRPL `Payment` carries no `InvoiceID`, or the validated transaction a recovery reads has no 256-bit `InvoiceID`. |
| `xrpl/no-memo` | The XRPL session opening carries no memo whose `MemoData` is an ATR hash in LCP string form. |
| `xrpl/not-channel-create` | The XRPL session opening or the transaction a recovery reads is not a `PaymentChannelCreate`, or `xrplChannelId` or `xrplClaim` is given a malformed address, sequence, channel id or amount. |
| `xrpl/not-found` | The XRPL reader found no transaction for the reference. |
| `xrpl/not-payment` | The XRPL signed blob presented for a charge is not a `Payment`. |
| `xrpl/not-success` | The validated XRPL transaction a recovery reads is not a `Payment` with result `tesSUCCESS`, or the one an MPP XRPL `hash` credential names has a result other than `tesSUCCESS`. |
| `xrpl/not-validated` | The XRPL transaction the reference, or an MPP XRPL `hash` credential, names is not yet in a validated ledger. |
| `xrpl/peer-missing` | The optional peer dependency `ripple-binary-codec` cannot be loaded to decode a blob. |
| `xrpl/read-first` | An MPP XRPL `hash` credential carries no blob yet; the seller reads it by hash before `bound`. |
| `xrpl/unreadable` | The XRPL reader threw or returned a response that is not well formed. |
| `xrpl/wrong-reader` | The XRPL reader answers for a different network than the reference or challenge names. |

## hedera

Hedera (`@integraledger/lcp/hedera`).

| Code | Meaning |
|---|---|
| `hedera/chain-id-unnamed` | An MPP Hedera `chainId` is not 295 or 296, or a charge request names no `chainId` and no default network is given. |
| `hedera/channel-id-mismatch` | The channel id recomputed from the Hedera `ChannelOpened` log is not the `channelId` the credential names. |
| `hedera/channel-log-not-found` | The Hedera session opening's landed logs hold no single `ChannelOpened` log from the escrow naming the channel with readable parties, or the reference names no binding log. |
| `hedera/deprecated-fields` | A Hedera `Transaction` uses the deprecated fields 1 to 4 instead of `signedTransactionBytes`. |
| `hedera/executor-malformed` | The transfer-executor payload given to `complete` or presented is not an object with entity `payer` and `executor` and a hex `authorization` within the bound. |
| `hedera/executor-not-offered` | The transfer-executor payload names an `executor` the option does not list. |
| `hedera/list-inconsistent` | The bodies of a Hedera `TransactionList` do not all share one transaction id and memo. |
| `hedera/memo-not-lcp` | The Hedera memo is not UTF-8 carrying an ATR hash in LCP string form. |
| `hedera/network-malformed` | The network written by `fetchPresented` for an MPP Hedera charge is not a Hedera network. |
| `hedera/no-legal-context` | The transfer-executor pairing's `bound` finds no decodable `extensions.legalContext.info` echoed in the payment. |
| `hedera/no-memo` | The signed Hedera body, or the landed transaction a recovery reads, has an empty memo. |
| `hedera/not-found` | The Hedera reader found no transaction, or no successful entry for it, or no receipt for the session transaction. |
| `hedera/option-malformed` | A Hedera option names an unknown transfer method or lacks what its pairing needs (a servable amount, asset and `payTo`, a `feePayer`, or 1 to the allowed number of `executors`), the buyer's choice carries an invalid payer, node, valid start, fee or decimals, or an MPP Hedera charge request has an invalid amount, currency, recipient or splits (too many, not less than the amount, or repeating an account). |
| `hedera/read-first` | An MPP Hedera `hash` charge credential or session opening carries no landed data yet; the seller reads it with `fetchPresented` before `bound`. |
| `hedera/reverted` | The Hedera session opening transaction reverted. |
| `hedera/tx-malformed` | A Hedera transaction is not base64 of a wire `Transaction` or `TransactionList` whose signed body decodes within the depth bound, a signature pair given to `complete` has the wrong key or signature length, or a push credential's `transactionId` is not `shard.realm.num@seconds.nanos`. |
| `hedera/tx-too-large` | A Hedera transaction's wire bytes exceed the size bound. |
| `hedera/unreadable` | The Hedera reader failed or returned a response that is not well formed, or (for a session) answers for a different network. |
| `hedera/wrong-reader` | The Hedera reader is missing or answers for a different network than the reference or request names. |

## avm

Algorand (`@integraledger/lcp/avm`).

| Code | Meaning |
|---|---|
| `avm/group-too-large` | The Algorand payment group is empty or larger than the group bound. |
| `avm/index-out-of-range` | The Algorand `paymentIndex` does not name a transaction in the payment group. |
| `avm/network-malformed` | An Algorand option's network starts with `algorand:` but does not name a genesis hash in CAIP-2 form. |
| `avm/network-mismatch` | The suggested parameters' genesis hash given to `build` is not 32 bytes or is not the network the option names. |
| `avm/not-axfer` | The Algorand payment transaction is not an asset transfer. |
| `avm/not-found` | The Algorand reader found no transaction for the id. |
| `avm/note-not-lcp` | The Algorand transaction's note is not UTF-8 carrying an ATR hash in LCP string form. |
| `avm/option-malformed` | An Algorand option's `extra` is not an object or names a transfer method or flow this pairing does not pay, its asset, `payTo`, fee payer, amount or timeout is invalid, or the buyer's payer or suggested parameters given to `build` are invalid (or `algosdk` is not loaded). |
| `avm/signature-malformed` | The signature given to the Algorand `complete` is not 64 bytes. |
| `avm/txn-malformed` | The Algorand payload has no `paymentGroup` array, the payment entry is not base64 msgpack within the caps that decodes as a signed transaction, its note exceeds the bound, or `algosdk` is not loaded. |
| `avm/unreadable` | The Algorand reader threw or returned an answer that is not well formed. |
| `avm/wrong-reader` | The Algorand reader is missing or answers for a different network than the reference names. |

## aptos

Aptos (`@integraledger/lcp/aptos`).

| Code | Meaning |
|---|---|
| `aptos/chain-mismatch` | The presented Aptos transaction's chain id is not the chain of the option's network. |
| `aptos/network-malformed` | An Aptos option's network starts with `aptos:` but names no known chain. |
| `aptos/not-an-x402-transfer` | The Aptos transaction, or the committed transaction a reader returns, is not a call to the framework `primary_fungible_store::transfer` or `fungible_asset::transfer` with one struct type argument and three arguments (two addresses and a u64 amount). |
| `aptos/not-entry-function` | The Aptos transaction's payload is not an entry function call. |
| `aptos/tx-malformed` | `decodeAptosTx` is given text that is not base64 of an Aptos `RawTransaction` prefix (in BCS or x402's reference JSON form) that reads to the end of its fields. |
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
| `cardano/not-found` | The Cardano reader found no transaction for the id. |
| `cardano/not-valid` | The Cardano transaction the reference names is on chain as invalid (its collateral was taken). |
| `cardano/ttl-missing` | The Cardano transaction sets no TTL, so `reference` has no slot by which it settles. |
| `cardano/tx-malformed` | A Cardano transaction is not base64 of one CBOR array `[body, witness set, validity, auxiliary data]` with a map body of unique unsigned keys, a valid TTL and a 32-byte auxiliary data hash. |
| `cardano/tx-too-large` | `decodeCardanoTx` is given a transaction larger than the size bound. |
| `cardano/unreadable` | The Cardano reader threw or returned a transaction that is not well formed, too large, or not the one the reference names. |
| `cardano/wrong-reader` | The Cardano reader answers for a different network than the reference names. |

## casper

Casper (`@integraledger/lcp/casper`).

| Code | Meaning |
|---|---|
| `casper/address-malformed` | A Casper `from` or `to` address, or the payer given to `build`, is not a valid Casper account or package address. |
| `casper/amount-malformed` | A Casper amount is not a uint256. |
| `casper/key-tag-mismatch` | The public key and signature given to the Casper `complete` carry different algorithm tags. |
| `casper/network-malformed` | A Casper network given to `cep3009TypedData` is not a Casper CAIP-2 name. |
| `casper/no-authorization-call` | The executed Casper transaction holds no authorization call on the asset carrying a nonce. |
| `casper/not-executed` | The Casper transaction the reference names has not executed. |
| `casper/not-found` | The Casper reader found no transaction for the reference. |
| `casper/option-malformed` | A Casper asset is not a contract package hash, the token name or version is not a valid name, `validBefore` is out of range, or the `now` given to `build` is not a non-negative safe integer. |
| `casper/payload-malformed` | The presented Casper payment carries a `refused` member, is not x402 version 2 for a Casper option with a string CEP-3009 authorization (hex nonce), a tagged public key and signature, or its value or `validBefore` cannot be read, or H given to `cep3009TypedData` is not a valid ATR hash. |
| `casper/reverted` | The Casper transaction executed with an error. |
| `casper/signature-malformed` | The public key or signature given to the Casper `complete` is not tagged hex of the allowed length. |
| `casper/unreadable` | The Casper reader threw or returned a call that is not well formed. |
| `casper/wrong-reader` | The Casper reader answers for a different network than the reference names. |

## ccd

Concordium (`@integraledger/lcp/ccd`).

| Code | Meaning |
|---|---|
| `ccd/address-malformed` | A Concordium account address is missing, is not base58check of the account form, or its bytes are not 32 long. |
| `ccd/memo-not-cbor-text` | The Concordium memo is not exactly one CBOR text string within the memo bound. |
| `ccd/memo-not-lcp` | The Concordium memo's text is not an ATR hash in LCP string form under the preferred encoding, or H given to `build` is not a valid ATR hash. |
| `ccd/no-carrier` | The finalized Concordium block item does not hold exactly one transfer with a memo, or that memo carries no ATR hash. |
| `ccd/no-memo` | The Concordium transaction is a plain `transfer` with no memo, or its PLT transfer operation has no memo. |
| `ccd/not-finalized` | The Concordium block item is not finalized. |
| `ccd/not-found` | The Concordium reader found no block item for the reference. |
| `ccd/not-v1` | The Concordium signed transaction's `version` is not 1. |
| `ccd/operation-count` | The Concordium PLT operations are not exactly one `transfer` operation. |
| `ccd/operations-malformed` | The Concordium PLT operations are not a CBOR list whose transfer carries a byte-string memo, a tagged 32-byte recipient account and a decimal-fraction amount. |
| `ccd/option-malformed` | The `now` given to the Concordium `build` is not a non-negative safe integer. |
| `ccd/payload-kind` | The Concordium transaction's payload is neither `transferWithMemo` nor a PLT `tokenUpdate`. |
| `ccd/rejected` | The Concordium block item was rejected. |
| `ccd/too-large` | The Concordium signed transaction, its memo or its token operations exceed the size bound. |
| `ccd/transaction-malformed` | The presented Concordium signed transaction is not a JSON value (x402's wire form, `JSON.parse(Transaction.toJSONString(tx))`), or not an object with a header and payload, a valid expiry, a decimal amount below 2^64 and hex memo or operations of the stated length, or an amount given to `ccdIdDigest` is out of range, or the value given to `complete` is not an object. |
| `ccd/unreadable` | The Concordium reader threw or returned a block item that is not well formed. |
| `ccd/wrong-reader` | The Concordium reader answers for a different network than the reference names. |

## near

NEAR (`@integraledger/lcp/near`).

| Code | Meaning |
|---|---|
| `near/actions` | The NEAR delegate action does not hold exactly one action. |
| `near/args-malformed` | The `ft_transfer` arguments are over the size bound, not UTF-8 JSON, or not an object, or the arguments a recovery reads are not base64. |
| `near/carrier-occupied` | `advertise` for the NEAR Intents charge finds the challenge's `externalId` already holding a value other than H's LCP string. |
| `near/memo-missing` | The `ft_transfer` arguments carry no string `memo`. |
| `near/memo-not-lcp` | The `ft_transfer` `memo`, or the NEAR Intents challenge's `externalId`, is not an ATR hash in LCP string form. |
| `near/network-malformed` | A NEAR option's network starts with `near:` but is not `near:mainnet` or `near:testnet`. |
| `near/no-relayer` | The NEAR reader lists no relayer to ask for the transaction status. |
| `near/not-found` | No relayer the NEAR reader lists knows the transaction, or its outcome carries no delegate action. |
| `near/not-ft-transfer` | The NEAR delegate action's one action is not a function call to `ft_transfer`. |
| `near/not-hash-credential` | The NEAR Intents charge credential's payload `type` is not `hash`. |
| `near/option-malformed` | A NEAR option's `extra` is not an object, or its `asset`, `payTo`, `amount` or `maxTimeoutSeconds` is not a valid account, u128 amount or positive timeout. |
| `near/peer-missing` | The optional peer dependencies `@near-js/crypto`, `@near-js/transactions` and `borsh` cannot be loaded. |
| `near/sda-malformed` | The NEAR signed delegate action is not non-empty base64 of a canonical Borsh `SignedDelegate`, or its public key cannot be read. |
| `near/sda-too-large` | The NEAR signed delegate action's base64 text exceeds the size bound. |
| `near/unreadable` | The NEAR reader threw or returned an outcome that is not well formed. |
| `near/wrong-reader` | The NEAR reader answers for a different network than the reference names. |

## polkadot

Polkadot Asset Hub (`@integraledger/lcp/polkadot`).

| Code | Meaning |
|---|---|
| `polkadot/address-malformed` | A Polkadot address is not an SS58 string of at most 64 characters that decodes to 35 bytes with a simple prefix and a valid checksum. |
| `polkadot/address-not-id` | The Polkadot extrinsic's signer is not a `MultiAddress::Id` of 32 bytes. |
| `polkadot/call-not-profile` | The Polkadot call is not exactly the profile's `batchAll` of `transferKeepAlive` then `remarkWithEvent` with a remark of the fixed length, or the presented `call` is not lowercase hex, or the recovered extrinsic does not end with that remark. |
| `polkadot/call-not-suffix` | The signed Polkadot extrinsic does not end with the profile call, after its signature. |
| `polkadot/extrinsic-malformed` | A Polkadot extrinsic is not lowercase hex within the bound whose compact length prefix matches its length, or the raw extrinsic a recovery reads is not hex within the bound. |
| `polkadot/extrinsic-too-large` | A Polkadot extrinsic exceeds the size bound. |
| `polkadot/hash-mismatch` | The chain's record of the Polkadot extrinsic has a hash other than that of the raw bytes read. |
| `polkadot/network-unsupported` | A Polkadot option's network starts with `polkadot:` but is not one this package supports. |
| `polkadot/no-remark` | The Polkadot extrinsic did not dispatch successfully with a `Remarked` event for its remark. |
| `polkadot/not-found` | The Polkadot reader found no block, no extrinsic at the index, or no record of the extrinsic. |
| `polkadot/not-signed-v4` | The Polkadot extrinsic is not a signed version 4 extrinsic. |
| `polkadot/option-malformed` | A Polkadot option does not name the `lcp-assets-remark` transfer method, names another flow, or has an invalid asset id, amount or timeout (1 to 3600 seconds), or the choice given to `build` is not an object. |
| `polkadot/range` | `polkadotLocate` is given a block range that is not non-negative bigints in order spanning at most 256 blocks. |
| `polkadot/remark-not-lcp` | The Polkadot remark is not exactly an ATR hash's LCP string form with lowercase hex, byte for byte. |
| `polkadot/signature-malformed` | The Polkadot extrinsic's `MultiSignature` has an unknown variant or runs past the end. |
| `polkadot/transaction-malformed` | `polkadotRecover` is given a transaction reference that is not a `<block hash>-<index>` timepoint. |
| `polkadot/unreadable` | The Polkadot reader threw or returned block extrinsics that are not an array. |
| `polkadot/wrong-reader` | The Polkadot reader is missing or answers for a different network than the reference names. |

## starknet

Starknet (`@integraledger/lcp/starknet`).

| Code | Meaning |
|---|---|
| `starknet/ambiguous` | The Starknet transaction holds matching transfers with more than one nonce. |
| `starknet/caller-forbidden` | The Starknet option's fee payer is zero or the any-caller value, or the paying account is the fee payer itself. |
| `starknet/felt-malformed` | A Starknet fee payer, asset, `payTo`, nonce, payer account or `from` is not a valid felt. |
| `starknet/network-malformed` | A Starknet network is not one of the Starknet networks this package supports. |
| `starknet/no-legal-context` | The Starknet payment echoes no decodable `extensions.legalContext.info`. |
| `starknet/nonce-not-bound` | The Starknet signed `Nonce` is not the low 250 bits of the echoed hash. |
| `starknet/not-found` | The Starknet reader found no receipt, or no transfer matching the reference in it. |
| `starknet/option-malformed` | A Starknet option has no `extra` object, or its amount is not a u256 or its timeout is not positive, or the buyer's choice given to `build` is not an object or has an invalid `now`, or an amount or deadline given to a typed-data helper is out of range. |
| `starknet/reverted` | The Starknet transaction the reference names reverted. |
| `starknet/signature-malformed` | The signature given to the Starknet `complete` is not 1 to the allowed number of valid felts. |
| `starknet/typed-data-malformed` | The presented Starknet `outsideExecution.typedData` is not an `OutsideExecution` under domain `Account.execute_from_outside` version 2 revision 1 on the option's chain with a felt `Nonce`, exceeds the bound, or lacks one transfer call's calldata and a decimal `Execute Before`. |
| `starknet/unreadable` | The Starknet reader threw or returned a receipt or events that are not well formed. |
| `starknet/wrong-reader` | The Starknet reader answers for a different network than the reference names. |

## sui

Sui (`@integraledger/lcp/sui`).

| Code | Meaning |
|---|---|
| `sui/aborted` | The Sui transaction the reference names executed with status `FAILURE`. |
| `sui/ambiguous` | The Sui transaction has more than one unused `Pure` input. |
| `sui/expiration-unbounded` | The Sui transaction sets no maximum epoch, so `reference` has no time by which it settles. |
| `sui/hash-not-carried` | The Sui transaction has no unused `Pure` input, or its one unused `Pure` input is not 32 bytes. |
| `sui/network-malformed` | A Sui option's network starts with `sui:` but is not `sui:mainnet`, `sui:testnet` or `sui:devnet`. |
| `sui/not-found` | The Sui reader found no transaction for the digest. |
| `sui/not-programmable` | The Sui transaction is not `TransactionData` V1 with a programmable transaction kind. |
| `sui/peer-missing` | The optional peer dependency `@mysten/sui` cannot be loaded. |
| `sui/tx-malformed` | `decodeSuiTx` is given text that is not base64 of a canonical BCS `TransactionData`, or a `Pure` input that is not valid base64 within the bound. |
| `sui/tx-too-large` | `decodeSuiTx` is given a transaction larger than the size bound. |
| `sui/unreadable` | The Sui reader failed, or returned a transaction whose digest is not the reference's or that does not decode. |
| `sui/wrong-reader` | The Sui reader answers for a different network than the reference names. |

## tron

Tron (`@integraledger/lcp/tron`).

| Code | Meaning |
|---|---|
| `tron/address-malformed` | A TRON address is not a base58check address of 34 characters starting with byte `0x41`. |
| `tron/contracts` | The TRON raw data does not hold exactly one contract. |
| `tron/fee-limit` | The fee limit given to the TRON `build` is not a bigint from 1 to the maximum. |
| `tron/memo-not-lcp` | The TRON transaction's memo is not an ATR hash in LCP string form. |
| `tron/network-malformed` | A TRON option's network is not `tron:` followed by a chain number. |
| `tron/not-found` | The TRON reader found no transaction for the id. |
| `tron/not-transfer` | The TRON contract's call data is not a TRC-20 `transfer`. |
| `tron/not-trigger` | The TRON contract is not a `TriggerSmartContract`. |
| `tron/option-malformed` | A TRON option's amount is not a uint256 or its `maxTimeoutSeconds` is outside 1 to the allowed maximum. |
| `tron/raw-not-canonical` | The TRON raw data does not re-encode to the bytes received. |
| `tron/signature-malformed` | A TRON transaction carries no signature, too many, or one that is not 65 bytes, or the signature given to `complete` is not 65 bytes with a recovery byte of 0, 1, 27 or 28. |
| `tron/tx-malformed` | A TRON transaction is not lowercase hex of a protobuf `Transaction` whose raw data decodes with in-range fields, the raw bytes a recovery reads do not hash to the transaction id, or the reference block or time given to `build` is invalid. |
| `tron/tx-too-large` | A TRON transaction's hex exceeds the size bound. |
| `tron/unreadable` | The TRON reader threw or returned a transaction whose raw data is not hex within the bound. |
| `tron/wrong-reader` | The TRON reader answers for a different network than the reference names. |

## tvm

TON (`@integraledger/lcp/tvm`).

| Code | Meaning |
|---|---|
| `tvm/actions` | The W5 request's action list is not exactly one `send_msg` action with no extended actions. |
| `tvm/boc-malformed` | A TON bag of cells is not non-empty base64 that parses to exactly one root with no exotic cells, or the settlement message is not an internal message or its action list is exotic. |
| `tvm/boc-too-large` | A TON bag of cells exceeds the byte, depth or cell-count bound. |
| `tvm/carrier-mismatch` | The option's `extra.forwardPayload` is not H's comment when `build` is called, or the presented Jetton transfer's forward payload is not the option's. |
| `tvm/carrier-occupied` | `advertise` finds the option's `extra.forwardPayload` already holding a payload other than H's comment. |
| `tvm/network-malformed` | A TON option's network is not `tvm:` followed by a workchain number. |
| `tvm/not-found` | The TON reader found no transaction for the reference. |
| `tvm/not-jetton-transfer` | The W5 request's outgoing message is not an internal message whose body is a Jetton `transfer`. |
| `tvm/not-w5-signed` | The TON settlement message body is not a W5 `internal_signed` request with a trailing signature and no further references. |
| `tvm/option-malformed` | A TON option's `extra` is not an object, or its asset, `payTo`, response destination, forward TON amount, amount or timeout is invalid, or it does not set `areFeesSponsored` to `true`. |
| `tvm/payload-not-lcp` | The Jetton transfer carries no forward payload, or its forward payload is not a comment carrying an ATR hash in LCP string form. |
| `tvm/peer-missing` | The optional peer dependency `@ton/core` cannot be loaded. |
| `tvm/unreadable` | The TON reader threw or returned a transaction that is not well formed or has no inbound body. |
| `tvm/value-too-low` | The TON attached to the Jetton transfer is not more than the option's forward TON amount. |
| `tvm/wrong-reader` | The TON reader answers for a different network than the reference names. |

## ln

Lightning: BOLT11 invoices and the Lightning pairings (`@integraledger/lcp/lightning`).

| Code | Meaning |
|---|---|
| `ln/currency-network` | The invoice's currency is not the one the option's or challenge's network names, or the MPP challenge names a network MPP Lightning does not define. |
| `ln/description-inline` | The MPP challenge's invoice carries an inline `d` description. |
| `ln/description-present` | The MPP Lightning challenge's request carries a `description`. |
| `ln/expires-after-invoice` | The MPP challenge's `expires` is later than the invoice's own expiry. |
| `ln/field-length` | The invoice's `h` or `m` field is not 32 bytes. |
| `ln/field-repeated` | The invoice carries more than one `h` field or more than one `m` field. |
| `ln/invoice-malformed` | A BOLT11 invoice is missing or not a string, mixes case, or does not decode (bech32 checksum, prefix, field lengths, exactly one payment hash, expiry width). |
| `ln/invoice-not-named` | The invoice-named pairing's `build` finds that the ATR's `x402` slot does not name the option's invoice, or that the ATR is not one JSON object whose first members are `atrVersion`, `id` and `x402` with no member name repeated. |
| `ln/invoice-too-large` | A BOLT11 invoice exceeds 8 KiB or carries more tagged fields than the bound. |
| `ln/no-description-hash` | The invoice has no `h` (description hash) field. |
| `ln/no-legal-context` | The invoice-named pairing's `bound` finds no decodable `extensions.legalContext.info` echoed in the payment. |
| `ln/no-metadata` | The invoice for `x402/exact/lnbtc` has no `m` (metadata) field, or its `m` is not H. |
| `ln/no-payment-in-action` | The MPP Lightning session credential whose payment is being bound is not the `open` action, the only one that pays the invoice. |
| `ln/not-this-pairing` | An invoice for the invoice-named pairing carries an `m` field, which belongs to `x402/exact/lnbtc`. |
| `ln/payment-hash-mismatch` | The invoice's payment hash is not the challenge's `paymentHash`. |
| `ln/payment-hash-required` | An MPP Lightning challenge carries no payment hash of 64 lowercase hex digits (in `methodDetails.paymentHash` for charge, `paymentHash` for session). |
| `ln/preimage-malformed` | The preimage given to `complete` is not 64 lowercase hex digits. |
| `ln/request-hash-mismatch` | The option's `extra.requestHash` is not 64 hex digits, or the invoice's description hash is not that request hash. |
| `ln/return-invoice-malformed` | The MPP Lightning session `build` is given a return invoice that is not an amountless BOLT11 invoice. |

## stacks

Stacks (`@integraledger/lcp/stacks`).

| Code | Meaning |
|---|---|
| `stacks/no-memo` | The Stacks transaction is not a call to the reference's contract `transfer`, or its fourth argument is not `(some <32 bytes>)`. |
| `stacks/not-found` | The reference's transaction id is not a 32-byte hash, or the Stacks reader found no mined transaction for it. |
| `stacks/not-success` | The mined Stacks transaction's status is not `success`. |
| `stacks/peer-missing` | The optional peer dependency `@stacks/transactions` cannot be loaded. |
| `stacks/unreadable` | The reference or reader is not an object, or the Stacks reader threw or answered a transaction that is neither a mined nor an unmined transaction of the reader's documented shape. |
| `stacks/wrong-reader` | The Stacks reader answers for a different network than the reference names. |

