---
title: "@integraledger/lcp/mpp"
description: "The exports of @integraledger/lcp/mpp."
---

# @integraledger/lcp/mpp

## Interfaces

### GatewaySaltInput

The inputs of `usdc`'s Gateway salt, every one a string.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `string` |
| <a id="property-destinationnetwork"></a> `destinationNetwork` | `string` |
| <a id="property-destinationrecipient"></a> `destinationRecipient` | `string` |
| <a id="property-id"></a> `id` | `string` |
| <a id="property-maxfee"></a> `maxFee` | `string` |
| <a id="property-realm"></a> `realm` | `string` |
| <a id="property-recipient"></a> `recipient` | `string` |
| <a id="property-requesthash"></a> `requestHash` | `` `0x${string}` `` |
| <a id="property-sourcedepositor"></a> `sourceDepositor` | `string` |
| <a id="property-sourcenetwork"></a> `sourceNetwork` | `string` |
| <a id="property-sourcesigner"></a> `sourceSigner` | `string` |

***

### HederaSessionUnsigned

A Hedera session opening for the payer's signer: two calls broadcast in order, and the zero voucher to sign.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.calls` | `object`[] |
| `request.chainId` | `295` \| `296` |
| `request.kind` | `"hedera-session-open"` |
| `request.voucher` | [`HederaVoucherTypedData`](hedera.md#hederavouchertypeddata) |

#### Methods

##### complete()

> **complete**(`signed`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | \{ `openTx`: `` `0x${string}` ``; `signature`: `` `0x${string}` ``; \} |
| `signed.openTx` | `` `0x${string}` `` |
| `signed.signature` | `` `0x${string}` `` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

***

### LandedCredential

A push credential with the landed receipt's logs from the currency.

#### Extends

- [`MppCredential`](#mppcredential)

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-challenge"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | [`MppCredential`](#mppcredential).[`challenge`](#property-challenge-2) |
| <a id="property-landed"></a> `landed` | `object` | - |
| `landed.blockNumber` | `bigint` | - |
| `landed.logs` | readonly [`EvmLog`](evm.md#evmlog)[] | - |
| `landed.transaction` | `` `0x${string}` `` | - |
| <a id="property-payload"></a> `payload` | `object` | [`MppCredential`](#mppcredential).[`payload`](#property-payload-1) |
| <a id="property-source"></a> `source?` | `string` | [`MppCredential`](#mppcredential).[`source`](#property-source-1) |

***

### MppChallenge

A challenge's auth-params after quoted-string unescaping. `request` and `opaque` are base64url-nopad JSON.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-description"></a> `description?` | `string` |
| <a id="property-digest"></a> `digest?` | `string` |
| <a id="property-expires"></a> `expires?` | `string` |
| <a id="property-header"></a> `header?` | `string` |
| <a id="property-id-1"></a> `id?` | `string` |
| <a id="property-intent"></a> `intent` | `string` |
| <a id="property-method"></a> `method` | `string` |
| <a id="property-opaque"></a> `opaque?` | `string` |
| <a id="property-realm-1"></a> `realm` | `string` |
| <a id="property-request-1"></a> `request` | `string` |

***

### MppChoice

The buyer's inputs to `build`. No check reads them.

#### Extended by

- [`SessionChoice`](#sessionchoice)

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-challenge-1"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - |
| <a id="property-clientid"></a> `clientId?` | `string` | tempo only: the payer's label in the attribution memo. |
| <a id="property-from"></a> `from` | `` `0x${string}` `` | - |
| <a id="property-now"></a> `now` | `number` | - |
| <a id="property-spender"></a> `spender?` | `` `0x${string}` `` | permit2 only: the seller server's submitting address. |
| <a id="property-tokendomain"></a> `tokenDomain?` | `object` | authorization only: the token's EIP-712 name and version. |
| `tokenDomain.name` | `string` | - |
| `tokenDomain.version` | `string` | - |

***

### MppCredential

#### Extended by

- [`LandedCredential`](#landedcredential)

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-challenge-2"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-payload-1"></a> `payload` | `object` |
| <a id="property-source-1"></a> `source?` | `string` |

***

### RailSessionChoice

The buyer's inputs to a session opening's `build`. The deposit and the XRPL channel terms are the funder's.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-challenge-3"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-deposit"></a> `deposit` | `bigint` |
| <a id="property-from-1"></a> `from` | `string` |
| <a id="property-now-1"></a> `now` | `number` |
| <a id="property-xrpl"></a> `xrpl?` | `object` |
| `xrpl.cancelAfter?` | `number` |
| `xrpl.fee` | `string` |
| `xrpl.lastLedgerSequence` | `number` |
| `xrpl.publicKey` | `string` |
| `xrpl.sequence` | `number` |
| `xrpl.settleDelay` | `number` |

***

### SessionChoice

The buyer's inputs to `build`. No check reads them.

#### Extends

- [`MppChoice`](#mppchoice)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-authorizedsigner"></a> `authorizedSigner?` | `` `0x${string}` `` | sessions: default the zero address, which means the payer. | - |
| <a id="property-challenge-4"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - | [`MppChoice`](#mppchoice).[`challenge`](#property-challenge-1) |
| <a id="property-clientid-1"></a> `clientId?` | `string` | tempo only: the payer's label in the attribution memo. | [`MppChoice`](#mppchoice).[`clientId`](#property-clientid) |
| <a id="property-credentialtype"></a> `credentialType?` | `"authorization"` \| `"permit2"` \| `"hash"` | EVM: default the first listed type. | - |
| <a id="property-deposit-1"></a> `deposit?` | `bigint` | sessions: the buyer's deposit; `suggestedDeposit` is advice. | - |
| <a id="property-from-2"></a> `from` | `` `0x${string}` `` | - | [`MppChoice`](#mppchoice).[`from`](#property-from) |
| <a id="property-now-2"></a> `now` | `number` | - | [`MppChoice`](#mppchoice).[`now`](#property-now) |
| <a id="property-spender-1"></a> `spender?` | `` `0x${string}` `` | permit2 only: the seller server's submitting address. | [`MppChoice`](#mppchoice).[`spender`](#property-spender) |
| <a id="property-tokendomain-1"></a> `tokenDomain?` | `object` | authorization only: the token's EIP-712 name and version. | [`MppChoice`](#mppchoice).[`tokenDomain`](#property-tokendomain) |
| `tokenDomain.name` | `string` | - | - |
| `tokenDomain.version` | `string` | - | - |

***

### SessionRef

The settlement read keys of these pairings.

#### Extends

- [`EvmRef`](evm.md#evmref)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-accesskey"></a> `accessKey?` | `object` | The subscription's access key: its id, the token it spends, and `transferDigest({to: recipient})`. With `account`, the read keys of a transfer made under the key for that account. | - |
| `accessKey.account?` | `` `0x${string}` `` | - | - |
| `accessKey.keyId` | `` `0x${string}` `` | - | - |
| `accessKey.to` | `` `0x${string}` `` | - | - |
| `accessKey.token` | `` `0x${string}` `` | - | - |
| <a id="property-bindinglog"></a> `bindingLog?` | \{ address: \`0x$\{string\}\`; topic0: \`0x$\{string\}\`; value: \`0x$\{string\}\`; \} & (\{ index: 2 \| 1 \| 3; \} \| \{ dataWord: number; \}) | The log carrying H or its commitment: in topic `index`, or in 32-byte data word `dataWord`. | [`EvmRef`](evm.md#evmref).[`bindingLog`](evm.md#property-bindinglog) |
| <a id="property-closes"></a> `closes?` | `object` | The close of an EVM session: a call to `escrow` of one of `EVM_CLOSE_SELECTORS` naming `channel`. | - |
| `closes.channel` | `` `0x${string}` `` | - | - |
| `closes.escrow` | `` `0x${string}` `` | - | - |
| <a id="property-network"></a> `network` | `` `eip155:${string}` `` \| `HederaNetwork` | - | [`EvmRef`](evm.md#evmref).[`network`](evm.md#property-network-1) |
| <a id="property-opened"></a> `opened?` | `object` | - | - |
| `opened.address` | `` `0x${string}` `` | - | - |
| `opened.chainId` | `number` | - | - |
| `opened.channel` | `` `0x${string}` `` | - | - |
| `opened.h` | `` `0x${string}` `` | - | - |
| `opened.version` | `"v2"` \| `"v1"` | - | - |
| <a id="property-opens"></a> `opens?` | `object` | The opening of an EVM session that the payer broadcast as a call: a call to `escrow` of `OPEN_V1_SELECTOR` whose salt is `h`, and whose sender, payee, token and authorized signer, with `h`, the escrow and `chainId`, give `channel`. | - |
| `opens.chainId` | `number` | - | - |
| `opens.channel` | `` `0x${string}` `` | - | - |
| `opens.escrow` | `` `0x${string}` `` | - | - |
| `opens.h` | `` `0x${string}` `` | - | - |
| <a id="property-search"></a> `search?` | `object` | The log filter that finds the transaction when none is named; absent, only a named transaction is read. | [`EvmRef`](evm.md#evmref).[`search`](evm.md#property-search) |
| `search.address` | `` `0x${string}` `` | - | - |
| `search.topics` | readonly (`` `0x${string}` `` \| `null`)[] | - | - |
| <a id="property-settleby"></a> `settleBy?` | `string` | Decimal Unix seconds after which the payment can no longer execute. | [`EvmRef`](evm.md#evmref).[`settleBy`](evm.md#property-settleby) |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` | The transaction the credential presents, where the payer broadcast the opening before the claim. | - |
| <a id="property-transferlog"></a> `transferLog?` | `object` | The token transfer this payment made, identified by the digest of the named fields. | [`EvmRef`](evm.md#evmref).[`transferLog`](evm.md#property-transferlog) |
| `transferLog.address` | `` `0x${string}` `` | - | - |
| `transferLog.digest` | `` `0x${string}` `` | - | - |
| `transferLog.identity` | [`TransferIdentity`](evm.md#transferidentity) | - | - |
| `transferLog.topic0` | `` `0x${string}` `` | - | - |

***

### SessionWithin

The buyer's inputs to an in-channel payment: the within 402's challenge, echoed as given; the held opening, exactly
as signed; the cumulative amount to sign; and the action.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-action"></a> `action` | `"close"` \| `"voucher"` |
| <a id="property-challenge-5"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-cumulativeamount"></a> `cumulativeAmount` | `bigint` |
| <a id="property-opening"></a> `opening` | [`MppCredential`](#mppcredential) |

***

### SessionWithinUnsigned

One signing request; `complete` takes its one signature and returns the in-channel credential.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-requests"></a> `requests` | readonly [`WithinSigningRequest`](#withinsigningrequest)[] |

#### Methods

##### complete()

> **complete**(`signatures`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signatures` | readonly `string`[] |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

***

### SolanaChargeChoice

The buyer's inputs to `build`. The request's `decimals`, `tokenProgram` and `recentBlockhash` win when present.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-challenge-6"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-computeunitlimit"></a> `computeUnitLimit?` | `number` |
| <a id="property-computeunitprice"></a> `computeUnitPrice?` | `bigint` |
| <a id="property-decimals"></a> `decimals?` | `number` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-recentblockhash"></a> `recentBlockhash?` | `string` |
| <a id="property-tokenprogram"></a> `tokenProgram?` | `string` |

***

### SolanaChargeUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request-2"></a> `request` | `object` |
| `request.kind` | `"solana-message"` |
| `request.message` | `Uint8Array` |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

The payer's 64-byte Ed25519 signature over `message`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

***

### SolanaSessionUnsigned

The values a Solana channel client composes the `open` from; `complete` takes the composed open payload.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request-3"></a> `request` | `object` |
| `request.channelProgram` | `string` |
| `request.kind` | `"solana-session-open"` |
| `request.network` | `` `solana:${string}` `` |
| `request.recentBlockhash` | `string` |
| `request.recentSlot` | `bigint` |
| `request.salt` | `bigint` |

#### Methods

##### complete()

> **complete**(`open`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `open` | \{\[`k`: `string`\]: [`Json`](index.md#json); \} |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

***

### StacksChargeChoice

The buyer's inputs to the Stacks build: the chosen challenge and the payer's c32 standard principal.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-challenge-7"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-from-3"></a> `from` | `string` |

***

### StellarChargeChoice

The buyer's inputs to `build`: the buyer's simulated transaction and its ledger and clock readings.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-challenge-8"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-currentledger"></a> `currentLedger` | `number` |
| <a id="property-now-3"></a> `now` | `number` |
| <a id="property-simulatedxdr"></a> `simulatedXdr` | `string` |

***

### StellarChargeUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request-4"></a> `request` | `object` |
| `request.kind` | `"stellar-auth"` |
| `request.preimage` | `Uint8Array` |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

The payer's Ed25519 signature over SHA-256 of `preimage`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

***

### StripeSubscriptionReceipt

The Stripe subscription's activation receipt, the `Payment-Receipt` payload decoded from its base64url JSON (or the
MCP transport's receipt object as given). The seller passes it when it reports the opening paid.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-externalid"></a> `externalId?` | `string` | - |
| <a id="property-method-1"></a> `method` | `"stripe"` | - |
| <a id="property-reference"></a> `reference` | `string` | The Stripe invoice whose payment activated the subscription. |
| <a id="property-status"></a> `status` | `"success"` | - |
| <a id="property-stripesubscription"></a> `stripeSubscription` | `string` | The Stripe subscription ID. |
| <a id="property-subscriptionid"></a> `subscriptionId` | `string` | The seller's own identifier for the subscription. |
| <a id="property-timestamp"></a> `timestamp` | `string` | - |

***

### VoucherTypedData

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-domain"></a> `domain` | `object` |
| `domain.chainId` | `number` |
| `domain.name` | `"EVM Payment Channel"` \| `"Tempo Stream Channel"` \| `"TIP20 Channel Reserve"` |
| `domain.verifyingContract` | `` `0x${string}` `` |
| `domain.version` | `"1"` |
| <a id="property-message"></a> `message` | `object` |
| `message.channelId` | `` `0x${string}` `` |
| `message.cumulativeAmount` | `bigint` |
| <a id="property-primarytype"></a> `primaryType` | `"Voucher"` |
| <a id="property-types"></a> `types` | `object` |
| `types.Voucher` | \[\{ `name`: `"channelId"`; `type`: `"bytes32"`; \}, \{ `name`: `"cumulativeAmount"`; `type`: `"uint128"` \| `"uint96"`; \}\] |

***

### XrplChargeChoice

The buyer's inputs to `build`: the paying account and the buyer's own reads of fee, sequence and ledger.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-account"></a> `account` | `string` |
| <a id="property-challenge-9"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-fee"></a> `fee` | `string` |
| <a id="property-lastledgersequence"></a> `lastLedgerSequence` | `number` |
| <a id="property-sequence"></a> `sequence` | `number` |

***

### XrplChargeUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request-5"></a> `request` | `object` |
| `request.kind` | `"xrpl-tx"` |
| `request.txJson` | [`XrplTxJson`](xrpl.md#xrpltxjson) |

#### Methods

##### complete()

> **complete**(`signedBlob`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

The wallet's signed blob, hex.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedBlob` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

***

### XrplSessionUnsigned

An XRPL `PaymentChannelCreate` for the wallet to sign, and the first claim's bytes.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request-6"></a> `request` | `object` |
| `request.claim` | `object` |
| `request.claim.bytes` | `Uint8Array` |
| `request.claim.channelId` | `string` |
| `request.claim.drops` | `bigint` |
| `request.kind` | `"xrpl-session-open"` |
| `request.txJson` | [`XrplTxJson`](xrpl.md#xrpltxjson) |

#### Methods

##### complete()

> **complete**(`signed`): `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | \{ `claimSignature`: `string`; `signedBlob`: `string`; \} |
| `signed.claimSignature` | `string` |
| `signed.signedBlob` | `string` |

###### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>

## Type Aliases

### GatewayPreimage

> **GatewayPreimage** = `Pick`\<[`GatewaySaltInput`](#gatewaysaltinput), `"id"` \| `"realm"` \| `"requestHash"` \| `"recipient"`\>

The salt's inputs a Gateway signing request carries from the chosen challenge.

***

### HederaLandedCredential

> **HederaLandedCredential** = [`LandedCredential`](#landedcredential)

A Hedera session opening with the landed receipt's logs from the escrow.

***

### MppIntent

> **MppIntent** = `"charge"` \| `"session"` \| `"subscription"`

***

### MppMethod

> **MppMethod** = `"evm"` \| `"tempo"` \| `"solana"` \| `"lightning"` \| `"card"` \| `"stripe"` \| `"usdc"` \| `"nearintents"` \| `"stellar"` \| `"xrpl"` \| `"hedera"`

***

### MppPairing

> **MppPairing** = `"mpp/charge/evm/permit2"` \| `"mpp/charge/evm/authorization"` \| `"mpp/charge/evm/transaction"` \| `"mpp/charge/evm/hash"` \| `"mpp/charge/tempo/memo"` \| `"mpp/charge/tempo/push"` \| `"mpp/session/evm"` \| `"mpp/session/tempo"` \| `"mpp/subscription/tempo"` \| `"mpp/charge/lightning"` \| `"mpp/session/lightning"` \| `"mpp/charge/hedera"` \| `"mpp/charge/solana"` \| `"mpp/charge/stellar"` \| `"mpp/charge/xrpl"` \| `"mpp/charge/nearintents"` \| `"mpp/session/hedera"` \| `"mpp/session/solana"` \| `"mpp/session/xrpl"` \| `"mpp/charge/card"` \| `"mpp/charge/stripe"` \| `"mpp/subscription/stripe"` \| `"mpp/charge/usdc/evm"` \| `"mpp/charge/usdc/solana"` \| `"mpp/charge/usdc/stacks"` \| `"mpp/charge/usdc/gateway"`

Every MPP pairing `pairingsOf` can name.

***

### MppUnsigned

> **MppUnsigned** = \{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"tempo-call"`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"evm-call"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

#### Union Members

##### Type Literal

\{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

***

##### Type Literal

\{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"tempo-call"`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `request` | `object` | push: the buyer's signer broadcasts, and `complete` takes the transaction hash. |
| `request.broadcast` | `boolean` | - |
| `request.call` | `object` | - |
| `request.call.data` | [`Hex`](evm.md#hex) | - |
| `request.call.to` | [`Hex`](evm.md#hex) | - |
| `request.chainId` | `number` | - |
| `request.kind` | `"tempo-call"` | - |
| `request.validBefore` | `number` | - |
| `complete()` | (`signedTxOrHash`) => [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) | - |

***

##### Type Literal

\{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"evm-call"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `request` | `object` | An EIP-1559 transaction of the call, or its hash once broadcast. |
| `request.broadcast` | `boolean` | - |
| `request.call` | `object` | - |
| `request.call.data` | [`Hex`](evm.md#hex) | - |
| `request.call.to` | [`Hex`](evm.md#hex) | - |
| `request.chainId` | `number` | - |
| `request.kind` | `"evm-call"` | - |
| `complete()` | (`signedTxOrHash`) => [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential) | - |

***

### RailSessionUnsigned

> **RailSessionUnsigned** = [`HederaSessionUnsigned`](#hederasessionunsigned) \| [`SolanaSessionUnsigned`](#solanasessionunsigned) \| [`XrplSessionUnsigned`](#xrplsessionunsigned)

***

### SessionStatus

> **SessionStatus** = [`EvmBreadthStatus`](evm.md#evmbreadthstatus) \| \{ `state`: `"pending"`; `why`: `"not-a-close"`; \} \| \{ `state`: `"failed"`; `why`: `"open-call-not-found"`; \}

***

### SessionUnsigned

> **SessionUnsigned** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-funding"></a> `funding` | \{ `kind`: `"eip712"`; `typedData`: [`ReceiveTypedData`](evm.md#receivetypeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \} \| \{ `broadcast`: `true`; `calls`: `object`[]; `chainId`: `number`; `kind`: `"evm-calls"`; \} \| \{ `broadcast`: `false`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"tempo-call"`; `validBefore`: `number`; \} |

#### Methods

##### complete()

> **complete**(`funded`, `voucherSignature`): [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `funded` | `` `0x${string}` `` |
| `voucherSignature` | `` `0x${string}` `` |

###### Returns

[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)

##### voucher()

> **voucher**(`funded`): [`Refusal`](index.md#refusal) \| [`VoucherTypedData`](#vouchertypeddata)

`funded`: the funding signature, transaction hash or signed `0x76` transaction.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `funded` | `` `0x${string}` `` |

###### Returns

[`Refusal`](index.md#refusal) \| [`VoucherTypedData`](#vouchertypeddata)

***

### UsdcUnsigned

> **UsdcUnsigned** = \{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: [`AtrHash`](index.md#atrhash); `recipient`: `string`; `sender`: `string`; \}; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

What the signer is handed for each `usdc` profile, and how its answer completes the credential.

***

### WithinSigningRequest

> **WithinSigningRequest** = \{ `kind`: `"eip712"`; `typedData`: [`VoucherTypedData`](#vouchertypeddata) \| [`HederaVoucherTypedData`](hedera.md#hederavouchertypeddata); \} \| \{ `kind`: `"ed25519-raw"`; `message`: `Uint8Array`; `signer`: `string`; \} \| \{ `bytes`: `Uint8Array`; `channelId`: `string`; `drops`: `bigint`; `kind`: `"xrpl-claim"`; \}

A request to the buyer's signer for an in-channel payment.

## Variables

### CARRIER

> `const` **CARRIER**: \{ readonly \[i in MppIntent\]: \{ readonly \[m in MppMethod\]?: readonly string\[\] \| null \} \}

The request member a pairing writes H into, by intent and method; null where no request member carries it. `usdc`
carries H in a request member only on its Solana profile (`USDC_CARRIER`). A Stellar charge's `recipient` carries H's
first 8 bytes as its muxed id only: its base account stays a member of what was issued.

***

### chargeCard

> `const` **chargeCard**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/card"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`, `unmux?`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeNearIntents

> `const` **chargeNearIntents**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`credential`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/nearintents"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeSolana

> `const` **chargeSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaChargeUnsigned`](#solanachargeunsigned)\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/solana"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeStellar

> `const` **chargeStellar**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarChargeUnsigned`](#stellarchargeunsigned)\>; `carrier`: `"request.recipient"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/stellar"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarRef`](stellar.md#stellarref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StellarStatus`](stellar.md#stellarstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeStripe

> `const` **chargeStripe**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`, `unmux?`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcEvm

> `const` **chargeUsdcEvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`UsdcUnsigned`](#usdcunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcGateway

> `const` **chargeUsdcGateway**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/gateway"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcSolana

> `const` **chargeUsdcSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaChargeUnsigned`](#solanachargeunsigned)\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcStacks

> `const` **chargeUsdcStacks**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: `` `0x${string}` ``; `recipient`: `string`; `sender`: `string`; \}; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/stacks"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StacksRef`](stacks.md#stacksref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StacksStatus`](stacks.md#stacksstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### chargeXrpl

> `const` **chargeXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplChargeUnsigned`](#xrplchargeunsigned)\>; `carrier`: `"request.methodDetails.invoiceId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/xrpl"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### EVM\_CLOSE\_SELECTORS

> `const` **EVM\_CLOSE\_SELECTORS**: readonly \[`"0x0d65c51d"`, `"0x79d35ded"`, `"0x8e19899e"`\]

The EVM session escrow's functions that finalize a channel, each taking the channel id as its first argument:
`close(bytes32,uint128,bytes)`, `closeWithAuthorization(bytes32,uint128,uint256,uint256,bytes,bytes)` and
`withdraw(bytes32)`.

***

### evmAuthorization

> `const` **evmAuthorization**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/authorization"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### evmHash

> `const` **evmHash**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/hash"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### evmPermit2

> `const` **evmPermit2**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/permit2"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### evmTransaction

> `const` **evmTransaction**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/transaction"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### LEGAL\_CONTEXT\_METADATA\_KEY

> `const` **LEGAL\_CONTEXT\_METADATA\_KEY**: `"legal_context"` = `"legal_context"`

The Stripe metadata key the seller places H under: at most 40 characters, no square brackets.

***

### MPP\_BINDINGS

> `const` **MPP\_BINDINGS**: readonly \[`Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/authorization"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/permit2"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/transaction"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/hash"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/tempo/memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/charge/tempo/push"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/evm"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/tempo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`KeyAuthorizationUnsigned`](tempo.md#keyauthorizationunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `_channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/subscription/tempo"`; `keyProves`: `string`; `keySearch`: (`ref`, `receipt`, `h`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `pattern`: \{ `buyerSigns`: `true`; `canonical`: `true`; `forwardIndexable`: `true`; `onChain`: `true`; `pattern`: `"native-field"`; `proves`: `string`; `publicProof`: `true`; `zeroPartyRecoverable`: `true`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](lightning.md#lnmppunsigned)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](lightning.md#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](lightning.md#lnmppunsigned)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/session/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](lightning.md#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`credentialChallenge`, `request`, `c`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaUnsigned`](hedera.md#hederaunsigned)\>; `carrier`: `"challenge"`; `claims`: `boolean`; `fetchPresented`: (`input`, `reader`, `defaultNetwork?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaLandedCharge`](hedera.md#hederalandedcharge)\>; `id`: `"mpp/charge/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `network`: (`request`, `defaultNetwork?`) => [`Refusal`](index.md#refusal) \| [`HederaNetwork`](hedera.md#hederanetwork); `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaRef`](hedera.md#hederaref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](hedera.md#hederastatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaChargeUnsigned`](#solanachargeunsigned)\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/solana"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarChargeUnsigned`](#stellarchargeunsigned)\>; `carrier`: `"request.recipient"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/stellar"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarRef`](stellar.md#stellarref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StellarStatus`](stellar.md#stellarstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplChargeUnsigned`](#xrplchargeunsigned)\>; `carrier`: `"request.methodDetails.invoiceId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/xrpl"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`credential`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/nearintents"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaSessionUnsigned`](#hederasessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`HederaCloseRef`](hedera.md#hederacloseref), `"transaction"`\>; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/session/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaSessionRef`](hedera.md#hederasessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaSessionUnsigned`](#solanasessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`SvmCloseRef`](svm.md#svmcloseref), `"transaction"`\>; `id`: `"mpp/session/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus) \| [`SvmCloseStatus`](svm.md#svmclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplSessionUnsigned`](#xrplsessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`XrplCloseRef`](xrpl.md#xrplcloseref), `"transaction"`\>; `id`: `"mpp/session/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"expect"` \| `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus) \| [`XrplCloseStatus`](xrpl.md#xrplclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/card"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`, `unmux?`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`, `unmux?`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`_presented`) => `"open"`; `ref`: (`_presented`, `receipt?`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/subscription/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`, `unmux?`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`UsdcUnsigned`](#usdcunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaChargeUnsigned`](#solanachargeunsigned)\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: `` `0x${string}` ``; `recipient`: `string`; `sender`: `string`; \}; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/stacks"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StacksRef`](stacks.md#stacksref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StacksStatus`](stacks.md#stacksstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/gateway"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>\]

Every MPP pairing this entry point implements.

***

### sessionEvm

> `const` **sessionEvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/evm"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### sessionHedera

> `const` **sessionHedera**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaSessionUnsigned`](#hederasessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`HederaCloseRef`](hedera.md#hederacloseref), `"transaction"`\>; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/session/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaSessionRef`](hedera.md#hederasessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### sessionSolana

> `const` **sessionSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SolanaSessionUnsigned`](#solanasessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`SvmCloseRef`](svm.md#svmcloseref), `"transaction"`\>; `id`: `"mpp/session/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus) \| [`SvmCloseStatus`](svm.md#svmclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### sessionTempo

> `const` **sessionTempo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/tempo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### sessionXrpl

> `const` **sessionXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplSessionUnsigned`](#xrplsessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionWithinUnsigned`](#sessionwithinunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`XrplCloseRef`](xrpl.md#xrplcloseref), `"transaction"`\>; `id`: `"mpp/session/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"expect"` \| `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus) \| [`XrplCloseStatus`](xrpl.md#xrplclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](#mppchallenge); \}\>

***

### subscriptionStripe

> `const` **subscriptionStripe**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`_presented`) => `"open"`; `ref`: (`_presented`, `receipt?`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/subscription/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`, `unmux?`) => [`MppChallenge`](#mppchallenge); \}\>

***

### subscriptionTempo

> `const` **subscriptionTempo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`KeyAuthorizationUnsigned`](tempo.md#keyauthorizationunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `_channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/subscription/tempo"`; `keyProves`: `string`; `keySearch`: (`ref`, `receipt`, `h`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `pattern`: \{ `buyerSigns`: `true`; `canonical`: `true`; `forwardIndexable`: `true`; `onChain`: `true`; `pattern`: `"native-field"`; `proves`: `string`; `publicProof`: `true`; `zeroPartyRecoverable`: `true`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### tempoMemo

> `const` **tempoMemo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/tempo/memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### tempoPush

> `const` **tempoPush**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/charge/tempo/push"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Json`](index.md#json); \}\>

***

### USDC\_CARRIER

> `const` **USDC\_CARRIER**: `object`

The request member `usdc` writes H into, by `methodDetails.type`; null where no request member carries it.

#### Index Signature

\[`profile`: `string`\]: readonly `string`[] \| `null`

## Functions

### attributionMemo()

> **attributionMemo**(`realm`, `challengeId`, `clientId?`): `` `0x${string}` ``

MPP's 32-byte attribution memo: keccak256("mpp")[0..3], `0x01`, keccak256(realm)[0..9], keccak256(clientId)[0..9]
or ten zero bytes, then keccak256(challengeId)[0..6], each over the string's UTF-8.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `realm` | `string` |
| `challengeId` | `string` |
| `clientId?` | `string` |

#### Returns

`` `0x${string}` ``

***

### challengeBound()

> **challengeBound**(`c`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `request`: \{\[`k`: `string`\]: [`Json`](index.md#json); \}; \}

H from an echoed challenge: its id derives from H in the form its intent and method take, its `opaque` names H, and
its `request` decodes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `request`: \{\[`k`: `string`\]: [`Json`](index.md#json); \}; \}

***

### challengeH()

> **challengeH**(`id`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

H from an id `challengeId` wrote, or from the bare base64url of H; anything else is `mpp/id-not-ours`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### challengeHash()

> **challengeHash**(`id`, `realm`): `` `0x${string}` ``

keccak256(UTF-8(id) ‖ UTF-8(realm)), lowercase: Solidity's `abi.encodePacked(string, string)`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `realm` | `string` |

#### Returns

`` `0x${string}` ``

***

### challengeId()

> **challengeId**(`h`, `index`): `string` \| [`Refusal`](index.md#refusal)

base64url, without padding, of H's 32 bytes, then `.` and the challenge's position (0 to 31).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |
| `index` | `number` |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### checkAttribution()

> **checkAttribution**(`memo`, `realm`, `challengeId`): `true` \| [`Refusal`](index.md#refusal)

Checks a memo's tag, version, server id for `realm` and nonce for `challengeId`. The client id is not read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `memo` | `string` |
| `realm` | `string` |
| `challengeId` | `string` |

#### Returns

`true` \| [`Refusal`](index.md#refusal)

***

### evmChannelId()

> **evmChannelId**(`c`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)); also Tempo v1's.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | \{ `authorizedSigner`: `` `0x${string}` ``; `chainId`: `number`; `escrow`: `` `0x${string}` ``; `payee`: `` `0x${string}` ``; `payer`: `` `0x${string}` ``; `salt`: `` `0x${string}` ``; `token`: `` `0x${string}` ``; \} |
| `c.authorizedSigner` | `` `0x${string}` `` |
| `c.chainId` | `number` |
| `c.escrow` | `` `0x${string}` `` |
| `c.payee` | `` `0x${string}` `` |
| `c.payer` | `` `0x${string}` `` |
| `c.salt` | `` `0x${string}` `` |
| `c.token` | `` `0x${string}` `` |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### gatewayAccount()

> **gatewayAccount**(`network`, `word`): `string` \| `undefined`

CAIP-10 of a TransferSpec `bytes32` account on `network`: on `eip155:*` the last 20 bytes as `0x` lowercase hex, the
first 12 being zero; on `solana:*` base58 of the 32 bytes. Anything else is undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `network` | `string` |
| `word` | `unknown` |

#### Returns

`string` \| `undefined`

***

### issuedDigest()

> **issuedDigest**(`c`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

the core's `digestJson` over the bound members, with `request` decoded and its carrier removed (`asIssued`), and
`opaque` decoded without the LCP members (omitted when that leaves it empty). A value that does not decode is its
string.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### keySearch()

> **keySearch**(`ref`, `receipt`, `h`): [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)

The read keys of a transfer made under the subscription's access key, from a receipt of the key's registration: the
account whose key authorization carried `h` and registered the key (`keyAccount`), then `accessKey` with that
account, the token's `Transfer` to the recipient's digest, and the keychain's `AccessKeySpend` filter for the account,
the key and the token. Refused when `ref` carries no access key, or the receipt did not register it under `h`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SessionRef`](#sessionref) |
| `receipt` | [`EvmReceipt`](evm.md#evmreceipt) |
| `h` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)

***

### mppSvmCarrier()

> **mppSvmCarrier**(`tx`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `memo`: `string`; \}

The one top-level Memo instruction (v3 or v4) whose UTF-8 data parses as an LCP string, and its hash. Memo
instructions whose data is not an LCP string are not read. None is `svm/no-carrier`; more than one `svm/memo-count`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SvmTx`](svm.md#svmtx) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `memo`: `string`; \}

***

### network()

> **network**(`challenge`): `string` \| [`Refusal`](index.md#refusal)

The CAIP-2 network an MPP challenge pays on, read from its method, intent and `methodDetails` as each method defines
it, with that method's default where it names one. A method whose challenge names no network is refused.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `challenge` | [`MppChallenge`](#mppchallenge) |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### pairingsOf()

> **pairingsOf**(`c`): [`Refusal`](index.md#refusal) \| readonly [`MppPairing`](#mpppairing)[]

Checks a challenge as issued (no LCP member in `opaque`) and names its pairings, in the order they are offered.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

[`Refusal`](index.md#refusal) \| readonly [`MppPairing`](#mpppairing)[]

***

### parseChallenges()

> **parseChallenges**(`fieldValues`): [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

Reads `WWW-Authenticate` field values by RFC 9110's challenge grammar and keeps the `Payment` challenges, with
quoted-strings unescaped and unknown parameters dropped. At most 8 KiB per value and 32 `Payment` challenges.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fieldValues` | readonly `string`[] |

#### Returns

[`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

***

### place()

> **place**(`doc`, `h`, `link`, `option`, `agreementUrl?`): [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

A copy of `doc` in which the challenge whose bound members equal `option` carries the id derived from H and an
`opaque` holding the seller's map plus `legalContext`, `legalContextUrl` and, when given, `legalContextAgreementUrl`.
A Tempo subscription challenge's id is the bare base64url of H.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | readonly [`MppChallenge`](#mppchallenge)[] |
| `h` | `` `0x${string}` `` |
| `link` | `string` |
| `option` | [`MppChallenge`](#mppchallenge) |
| `agreementUrl?` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]

***

### problem()

> **problem**(`code`): `object`

The MPP problem type and status for a refusal code.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `code` | `string` |

#### Returns

`object`

| Name | Type |
| ------ | ------ |
| `status` | `402` \| `500` |
| `type` | `string` |

***

### read()

> **read**(`doc`): [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}

The buyer's reading: the challenges whose `opaque` carries an LCP hash and an `https` link and whose id derives from
that hash, in document order. `agreement` is their agreement URL when one is present. A link or agreement URL of at
most 2048 characters that parses as an absolute URL with a scheme other than `https` is `mpp/link-not-https`, and
any other value that is not a link is `mpp/legal-context-malformed`; with no challenge read, a link of another scheme
in any challenge gives `mpp/link-not-https`, else a malformed link gives `mpp/legal-context-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `doc` | readonly [`MppChallenge`](#mppchallenge)[] |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}

***

### sessionResume()

> **sessionResume**(`c`): [`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \} \| `null`

The network and channel a session challenge names for the client to resume, spelled as the pairing's `channel.ref`
spells it: EVM, Tempo and Hedera in `methodDetails.channelId` (a bytes32, lowercase), Solana in
`methodDetails.channelId` (a base58 address), XRPL in the request's `channelId` (64 hex characters, upper case). Null
when the challenge names no channel; refused for a challenge of no session pairing, or a channel or network that
cannot be read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \} \| `null`

***

### sessionStatus()

> **sessionStatus**(`ref`, `reader`): `Promise`\<[`SessionStatus`](#sessionstatus)\>

`evmStatus` on the named logs, then, where `ref.opened` is present, one `ChannelOpened` log from `opened.address`
naming the channel: on v2 its data word 3 (the salt) is `h`; on v1 the channel id recomputed from the event with
salt `h` is the channel. Where `ref.opens` is present, the succeeded transaction must be the open call `opens`
describes, read by `eth_getTransactionByHash`, else failed `open-call-not-found`. Where `ref.closes` is present, the
succeeded transaction must be a call to that escrow whose calldata starts with one of `EVM_CLOSE_SELECTORS` and
whose first argument is that channel, else pending `not-a-close`. Where `ref.accessKey.account` is present, the
succeeded receipt must also hold the account keychain's `AccessKeySpend` log naming that account, key and token, else
failed `binding-log-not-found`. At most four calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SessionRef`](#sessionref) & `object` |
| `reader` | [`EvmReader`](evm.md#evmreader) |

#### Returns

`Promise`\<[`SessionStatus`](#sessionstatus)\>

***

### tie()

> **tie**(`options`): \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]

The binding slot: the distinct challenges among `options`, each with exactly MPP's bound members, as issued.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | readonly [`MppChallenge`](#mppchallenge)[] |

#### Returns

\[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]

***

### transferPresent()

> **transferPresent**(`ref`, `reader`): `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>

`evmStatus` on the reported transaction with no named log; settled also requires one log from `ref.asset` with three
topics and `topics[0]` = `Transfer` whose recipient is not `RECEIVE_POLICY_GUARD`. Without one, a `Transfer` from
`ref.asset` to the guard is failed `receive-policy-blocked`, and anything else failed `transfer-not-found`. At most
three calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`EvmRef`](evm.md#evmref) & `object` |
| `reader` | [`EvmReader`](evm.md#evmreader) |

#### Returns

`Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>

***

### usdcGatewaySalt()

> **usdcGatewaySalt**(`i`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

`usdc`'s Gateway salt: keccak256 of the JCS of the inputs with `method` "usdc", `intent` "charge", `type` "gateway".

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`GatewaySaltInput`](#gatewaysaltinput) |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### usdcNonce()

> **usdcNonce**(`id`, `realm`, `requestHash`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

`usdc`'s EIP-3009 nonce: keccak256 of the JCS of `{id, method: "usdc", realm, intent: "charge", requestHash}`, with
`requestHash` written as `0x` and 64 lowercase hex.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `realm` | `string` |
| `requestHash` | `` `0x${string}` `` |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### usdcRequestHash()

> **usdcRequestHash**(`requestParam`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

keccak256 of the challenge's `request` parameter's decoded bytes, as `0x` and lowercase hex. The bytes must be the
RFC 8785 form of their own parse, else `mpp/request-not-jcs`; they are hashed as received.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `requestParam` | `string` |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

## References

### chargeHedera

Re-exports [chargeHedera](hedera.md#chargehedera)

***

### pairingsOfPlaced

Re-exports [pairingsOfPlaced](index.md#pairingsofplaced)

***

### ReceiveTypedData

Re-exports [ReceiveTypedData](evm.md#receivetypeddata)
