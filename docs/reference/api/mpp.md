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
| <a id="property-request"></a> `request` | `string` |

***

### MppChoice

The buyer's inputs to `build`. `build` checks their form and that the chosen challenge's id carries H; it compares no
deal value.

#### Extended by

- [`SessionChoice`](#sessionchoice)

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-challenge-1"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - |
| <a id="property-clientid"></a> `clientId?` | `string` | tempo only: the payer's label in the attribution memo, a well-formed string. |
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

### SessionChoice

The buyer's inputs to `build`. `build` checks their form and that the chosen challenge's id carries H; it compares no
deal value.

#### Extends

- [`MppChoice`](#mppchoice)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-authorizedsigner"></a> `authorizedSigner?` | `` `0x${string}` `` | sessions: default the zero address, which means the payer. | - |
| <a id="property-challenge-3"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` | - | [`MppChoice`](#mppchoice).[`challenge`](#property-challenge-1) |
| <a id="property-clientid-1"></a> `clientId?` | `string` | tempo only: the payer's label in the attribution memo, a well-formed string. | [`MppChoice`](#mppchoice).[`clientId`](#property-clientid) |
| <a id="property-credentialtype"></a> `credentialType?` | `"permit2"` \| `"authorization"` \| `"hash"` | EVM: default the first listed type. | - |
| <a id="property-deposit"></a> `deposit?` | `bigint` | sessions: the buyer's deposit; `suggestedDeposit` is advice. | - |
| <a id="property-from-1"></a> `from` | `` `0x${string}` `` | - | [`MppChoice`](#mppchoice).[`from`](#property-from) |
| <a id="property-now-1"></a> `now` | `number` | - | [`MppChoice`](#mppchoice).[`now`](#property-now) |
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
| <a id="property-authorization"></a> `authorization?` | [`PullAuthorization`](evm.md#pullauthorization) | The signed pull authorization and where the chain records its use, where the pairing's reference records one. | [`EvmRef`](evm.md#evmref).[`authorization`](evm.md#property-authorization) |
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
| <a id="property-opens"></a> `opens?` | `object` | The opening of an EVM session of type `hash` or `permit2`: the escrow's open call whose salt is `h`, and whose payer, payee, token and authorized signer, with `h`, the escrow and `chainId`, give `channel`. | - |
| `opens.chainId` | `number` | - | - |
| `opens.channel` | `` `0x${string}` `` | - | - |
| `opens.escrow` | `` `0x${string}` `` | - | - |
| `opens.h` | `` `0x${string}` `` | - | - |
| <a id="property-revokes"></a> `revokes?` | `object` | The close of a subscription: the account keychain's `KeyRevoked` whose topic 1 is `account` and topic 2 `keyId`. | - |
| `revokes.account` | `` `0x${string}` `` | - | - |
| `revokes.keyId` | `` `0x${string}` `` | - | - |
| <a id="property-search"></a> `search?` | `object` | The log filter that finds the transaction when none is named; absent, only a named transaction is read. | [`EvmRef`](evm.md#evmref).[`search`](evm.md#property-search) |
| `search.address` | `` `0x${string}` `` | - | - |
| `search.topics` | readonly (`` `0x${string}` `` \| `null`)[] | - | - |
| <a id="property-settleby"></a> `settleBy?` | `string` | Decimal Unix seconds after which the payment can no longer execute. | [`EvmRef`](evm.md#evmref).[`settleBy`](evm.md#property-settleby) |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` | The transaction the credential presents, where the payer broadcast the opening before the claim. | - |
| <a id="property-transferlog"></a> `transferLog?` | [`TransferLog`](evm.md#transferlog) | The token transfer this payment made, identified by the digest of the named fields. | [`EvmRef`](evm.md#evmref).[`transferLog`](evm.md#property-transferlog) |

***

### SessionWithin

The buyer's inputs to an in-channel payment: the within 402's challenge, echoed as given; the held opening, exactly
as signed; the cumulative amount to sign; and the action.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-action"></a> `action` | `"close"` \| `"voucher"` |
| <a id="property-challenge-4"></a> `challenge` | [`MppChallenge`](#mppchallenge) & `object` |
| <a id="property-cumulativeamount"></a> `cumulativeAmount` | `bigint` |
| <a id="property-opening"></a> `opening` | [`MppCredential`](#mppcredential) |

***

### StripeSubscriptionReceipt

The Stripe subscription's activation receipt: the `Payment-Receipt` payload the seller's server answered the opening
with, decoded from its base64url JSON (or the MCP transport's receipt object as given). `channel.ref` takes it with
the opening.

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

## Type Aliases

### GatewayPreimage

> **GatewayPreimage** = `Pick`\<[`GatewaySaltInput`](#gatewaysaltinput), `"id"` \| `"realm"` \| `"requestHash"` \| `"recipient"`\>

The salt's inputs a Gateway signing request carries from the chosen challenge.

***

### MppMethod

> **MppMethod** = `"evm"` \| `"tempo"` \| `"solana"` \| `"lightning"` \| `"card"` \| `"stripe"` \| `"usdc"` \| `"nearintents"` \| `"stellar"` \| `"xrpl"` \| `"hedera"`

***

### MppPairingId

> **MppPairingId** = `"mpp/charge/evm/permit2"` \| `"mpp/charge/evm/authorization"` \| `"mpp/charge/evm/transaction"` \| `"mpp/charge/evm/hash"` \| `"mpp/charge/tempo/memo"` \| `"mpp/charge/tempo/push"` \| `"mpp/session/evm"` \| `"mpp/session/tempo"` \| `"mpp/subscription/tempo"` \| `"mpp/charge/lightning"` \| `"mpp/session/lightning"` \| `"mpp/charge/hedera"` \| `"mpp/charge/solana"` \| `"mpp/charge/stellar"` \| `"mpp/charge/xrpl"` \| `"mpp/charge/nearintents"` \| `"mpp/session/hedera"` \| `"mpp/session/solana"` \| `"mpp/session/xrpl"` \| `"mpp/charge/card"` \| `"mpp/charge/stripe"` \| `"mpp/subscription/stripe"` \| `"mpp/charge/usdc/evm"` \| `"mpp/charge/usdc/solana"` \| `"mpp/charge/usdc/stacks"` \| `"mpp/charge/usdc/gateway"`

The id of each MPP pairing `pairingsOf` can name.

***

### MppUnsigned

> **MppUnsigned** = \{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"tempo-call"`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `broadcast`: `boolean`; `calls`: readonly `object`[]; `chainId`: `number`; `kind`: `"tempo-calls"`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \} \| \{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"evm-call"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

#### Union Members

##### Type Literal

\{ `request`: \{ `kind`: `"eip712"`; `typedData`: [`Eip3009TypedData`](evm.md#eip3009typeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

***

##### Type Literal

\{ `request`: \{ `broadcast`: `boolean`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"tempo-call"`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `request` | `object` | push: the buyer's signer broadcasts, and `complete` takes the transaction hash. memo: `complete` takes the signed transaction, and refuses one that does not decode, an empty one among them, or that is signed for a chain other than `chainId` with `tempo/tx-malformed`, as `bound` refuses it. |
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

\{ `request`: \{ `broadcast`: `boolean`; `calls`: readonly `object`[]; `chainId`: `number`; `kind`: `"tempo-calls"`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `request` | `object` | A Tempo charge with `splits`: the calls, in order, of one Tempo transaction, the primary transfer first, then one per split. push: the buyer's signer broadcasts, and `complete` takes the transaction hash. memo: `complete` takes the signed transaction, and refuses one that does not decode, an empty one among them, or that is signed for a chain other than `chainId` with `tempo/tx-malformed`, as `bound` refuses it. |
| `request.broadcast` | `boolean` | - |
| `request.calls` | readonly `object`[] | - |
| `request.chainId` | `number` | - |
| `request.kind` | `"tempo-calls"` | - |
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

> **RailSessionUnsigned** = `HederaSessionUnsigned` \| `SolanaSessionUnsigned` \| `XrplSessionUnsigned`

***

### ReceiveTypedData

> **ReceiveTypedData** = `Omit`\<[`Eip3009TypedData`](evm.md#eip3009typeddata), `"primaryType"` \| `"types"`\> & `object`

EIP-3009's `ReceiveWithAuthorization`: the same fields as `TransferWithAuthorization`, for a payee contract.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `primaryType` | `"ReceiveWithAuthorization"` |
| `types` | `object` |
| `types.EIP712Domain` | [`Field`](evm.md#field)[] |
| `types.ReceiveWithAuthorization` | [`Field`](evm.md#field)[] |

***

### SessionStatus

> **SessionStatus** = [`EvmBreadthStatus`](evm.md#evmbreadthstatus) \| \{ `state`: `"pending"`; `why`: `"not-a-close"` \| `"open-call-not-found"`; \} \| \{ `state`: `"failed"`; `why`: `"open-call-not-found"`; \}

***

### SessionUnsigned

> **SessionUnsigned** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-funding"></a> `funding` | \{ `kind`: `"eip712"`; `typedData`: [`ReceiveTypedData`](#receivetypeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \} \| \{ `broadcast`: `true`; `calls`: `object`[]; `chainId`: `number`; `kind`: `"evm-calls"`; \} \| \{ `broadcast`: `false`; `call`: \{ `data`: [`Hex`](evm.md#hex); `to`: [`Hex`](evm.md#hex); \}; `chainId`: `number`; `kind`: `"tempo-call"`; `validBefore`: `number`; \} |

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

`funded`: the funding signature, transaction hash or signed `0x76` transaction. A `tempo-call` funding's signed
transaction that does not decode, an empty one among them, or that is signed for a chain other than
`funding.chainId` is refused `tempo/tx-malformed` here and by `complete`, as `bound` refuses it.

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

> **WithinSigningRequest** = \{ `kind`: `"eip712"`; `typedData`: [`VoucherTypedData`](#vouchertypeddata) \| `HederaVoucherTypedData`; \} \| \{ `kind`: `"ed25519-raw"`; `message`: `Uint8Array`; `signer`: `string`; \} \| \{ `bytes`: `Uint8Array`; `channelId`: `string`; `drops`: `bigint`; `kind`: `"xrpl-claim"`; \}

A request to the buyer's signer for an in-channel payment.

## Variables

### CARRIER

> `const` **CARRIER**: \{ readonly \[i in MppIntent\]: \{ readonly \[m in MppMethod\]?: readonly string\[\] \| null \} \}

The request member a pairing writes H into, by intent and method; null where no request member carries it. `usdc`
carries H in a request member only on its Solana profile. A Stellar charge's `recipient` carries H's first 8 bytes as
its muxed id only: its base account stays a member of what was issued.

***

### chargeCard

> `const` **chargeCard**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/card"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeNearIntents

> `const` **chargeNearIntents**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`credential`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/nearintents"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeSolana

> `const` **chargeSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/solana"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeStellar

> `const` **chargeStellar**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `StellarChargeUnsigned`\>; `carrier`: `"request.recipient"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/stellar"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarRef`](stellar.md#stellarref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StellarStatus`](stellar.md#stellarstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeStripe

> `const` **chargeStripe**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcEvm

> `const` **chargeUsdcEvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`UsdcUnsigned`](#usdcunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcGateway

> `const` **chargeUsdcGateway**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/gateway"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcSolana

> `const` **chargeUsdcSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeUsdcStacks

> `const` **chargeUsdcStacks**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: `` `0x${string}` ``; `recipient`: `string`; `sender`: `string`; \}; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/stacks"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StacksRef`](stacks.md#stacksref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StacksStatus`](stacks.md#stacksstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### chargeXrpl

> `const` **chargeXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `XrplChargeUnsigned`\>; `carrier`: `"request.methodDetails.invoiceId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/xrpl"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### evmAuthorization

> `const` **evmAuthorization**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/authorization"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### evmHash

> `const` **evmHash**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/hash"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### evmPermit2

> `const` **evmPermit2**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/permit2"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### evmTransaction

> `const` **evmTransaction**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/transaction"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### LEGAL\_CONTEXT\_METADATA\_KEY

> `const` **LEGAL\_CONTEXT\_METADATA\_KEY**: `"legal_context"` = `"legal_context"`

The Stripe metadata key the seller places H under: at most 40 characters, no square brackets.

***

### MPP\_BINDINGS

> `const` **MPP\_BINDINGS**: readonly \[`Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/authorization"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/permit2"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/transaction"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/evm/hash"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref) & `object`\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/tempo/memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/charge/tempo/push"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/evm"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/tempo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`KeyAuthorizationUnsigned`](tempo.md#keyauthorizationunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `_channel`, `account?`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/subscription/tempo"`; `keyProves`: `string`; `keySearch`: (`ref`, `receipt`, `h`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `pattern`: \{ `buyerSigns`: `true`; `canonical`: `true`; `forwardIndexable`: `true`; `onChain`: `true`; `pattern`: `"native-field"`; `proves`: `string`; `publicProof`: `true`; `zeroPartyRecoverable`: `true`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](lightning.md#lnmppunsigned)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](lightning.md#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `advertiseBeforeCarrier`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnMppUnsigned`](lightning.md#lnmppunsigned)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/session/lightning"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LnRef`](lightning.md#lnref)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`c`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`credentialChallenge`, `request`, `c`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaUnsigned`](hedera.md#hederaunsigned)\>; `carrier`: `"challenge"`; `claims`: `boolean`; `fetchPresented`: (`input`, `reader`, `defaultNetwork?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `HederaLandedCharge`\>; `id`: `"mpp/charge/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `network`: (`request`, `defaultNetwork?`) => [`Refusal`](index.md#refusal) \| [`HederaNetwork`](hedera.md#hederanetwork); `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaRef`](hedera.md#hederaref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](hedera.md#hederastatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/solana"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `StellarChargeUnsigned`\>; `carrier`: `"request.recipient"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/stellar"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarRef`](stellar.md#stellarref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StellarStatus`](stellar.md#stellarstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `XrplChargeUnsigned`\>; `carrier`: `"request.methodDetails.invoiceId"`; `claims`: `boolean`; `fetchPresented`: (`credential`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential)\>; `id`: `"mpp/charge/xrpl"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`credential`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/nearintents"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `HederaSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`HederaCloseRef`](hedera.md#hederacloseref), `"transaction"`\>; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/session/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaSessionRef`](hedera.md#hederasessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`SvmCloseRef`](svm.md#svmcloseref), `"transaction"`\>; `id`: `"mpp/session/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus) \| [`SvmCloseStatus`](svm.md#svmclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `XrplSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`XrplCloseRef`](xrpl.md#xrplcloseref), `"transaction"`\>; `id`: `"mpp/session/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"expect"` \| `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus) \| [`XrplCloseStatus`](xrpl.md#xrplclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/card"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `claims`: `boolean`; `id`: `"mpp/charge/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`_presented`) => `"open"`; `ref`: (`_presented`, `receipt?`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/subscription/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `authorizer`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`UsdcUnsigned`](#usdcunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/evm"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaChargeUnsigned`\>; `carrier`: `"request.externalId"`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `anchorMode`: `"onChainOnly"`; `args`: \{ `amount`: `string`; `memo`: `` `0x${string}` ``; `recipient`: `string`; `sender`: `string`; \}; `contract`: `string`; `functionName`: `"transfer"`; `kind`: `"stacks-contract-call"`; `postCondition`: `"SentEq"`; `postConditionMode`: `"deny"`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/stacks"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StacksRef`](stacks.md#stacksref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StacksStatus`](stacks.md#stacksstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>, `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `kind`: `"gateway-burn-intent"`; `preimage`: [`GatewayPreimage`](#gatewaypreimage); \}; `complete`: [`Refusal`](index.md#refusal) \| [`MppCredential`](#mppcredential); \}\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"mpp/charge/usdc/gateway"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>\]

Every MPP pairing this entry point implements.

***

### sessionEvm

> `const` **sessionEvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/evm"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### sessionHedera

> `const` **sessionHedera**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `HederaSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`HederaCloseRef`](hedera.md#hederacloseref), `"transaction"`\>; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/session/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaSessionRef`](hedera.md#hederasessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### sessionSolana

> `const` **sessionSolana**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SolanaSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`SvmCloseRef`](svm.md#svmcloseref), `"transaction"`\>; `id`: `"mpp/session/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus) \| [`SvmCloseStatus`](svm.md#svmclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### sessionTempo

> `const` **sessionTempo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionUnsigned`](#sessionunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/session/tempo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### sessionXrpl

> `const` **sessionXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `XrplSessionUnsigned`\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `SessionWithinUnsigned`\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => [`Refusal`](index.md#refusal) \| `Kind`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `channel`) => [`Refusal`](index.md#refusal) \| `Omit`\<[`XrplCloseRef`](xrpl.md#xrplcloseref), `"transaction"`\>; `id`: `"mpp/session/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"expect"` \| `"fromLedger"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus) \| [`XrplCloseStatus`](xrpl.md#xrplclosestatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### subscriptionStripe

> `const` **subscriptionStripe**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`_choice`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal)\>; `carrier`: `string`; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`_presented`) => `"open"`; `ref`: (`_presented`, `receipt?`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_presented`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"mpp/subscription/stripe"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge); \}\>

***

### subscriptionTempo

> `const` **subscriptionTempo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`KeyAuthorizationUnsigned`](tempo.md#keyauthorizationunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`_presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`presented`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`presented`) => `number` \| `undefined`; \}\>; `claims`: `true`; `closeRef`: (`chosen`, `_channel`, `account?`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `id`: `"mpp/subscription/tempo"`; `keyProves`: `string`; `keySearch`: (`ref`, `receipt`, `h`) => [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref); `pattern`: \{ `buyerSigns`: `true`; `canonical`: `true`; `forwardIndexable`: `true`; `onChain`: `true`; `pattern`: `"native-field"`; `proves`: `string`; `publicProof`: `true`; `zeroPartyRecoverable`: `true`; \}; `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SessionStatus`](#sessionstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### tempoMemo

> `const` **tempoMemo**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `id`: `"mpp/charge/tempo/memo"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

***

### tempoPush

> `const` **tempoPush**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`MppUnsigned`](#mppunsigned)\>; `claims`: `boolean`; `fetchPresented`: (`presented`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`LandedCredential`](#landedcredential)\>; `id`: `"mpp/charge/tempo/push"`; `landedTx`: (`presented`) => `string` \| `undefined`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`Json`](index.md#json); \}\>

## Functions

### attributionMemo()

> **attributionMemo**(`realm`, `challengeId`, `clientId?`): `` `0x${string}` ``

MPP's 32-byte attribution memo: keccak256("mpp")[0..3], `0x01`, keccak256(realm)[0..9], keccak256(clientId)[0..9]
or ten zero bytes, then keccak256(challengeId)[0..6], each over the string's UTF-8. A string that is not well-formed
is written as `TextEncoder` writes it, with U+FFFD for each lone surrogate; the pairings refuse such a realm,
challenge id or client id before they call it.

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

> **challengeH**(`id`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

H from an id `challengeId` wrote, or from the bare base64url of H; anything else is `mpp/id-not-ours`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### challengeHash()

> **challengeHash**(`id`, `realm`): `` `0x${string}` ``

keccak256(UTF-8(id) ‖ UTF-8(realm)), lowercase: Solidity's `abi.encodePacked(string, string)`. A string that is not
well-formed is written as `TextEncoder` writes it, with U+FFFD for each lone surrogate; the pairings refuse such an id
or realm before they call it.

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

Checks a memo's tag, version, server id for `realm` and nonce for `challengeId`. The client id is not read. A `realm`
or `challengeId` that is not well-formed is hashed as `attributionMemo` hashes it, with U+FFFD for each lone
surrogate; the pairings refuse such a challenge before they call it.

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

> **evmChannelId**(`c`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

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

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### issuedDigest()

> **issuedDigest**(`c`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

the core's `digestJson` over the bound members, with `request` decoded and its carrier removed (`asIssued`), and
`opaque` decoded without the LCP members (omitted when that leaves it empty). A value that does not decode is its
string.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### keySearch()

> **keySearch**(`ref`, `receipt`, `h`): [`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)

The read keys of a transfer made under the subscription's access key, from a receipt of the key's registration: the
account whose key authorization carried `h` and registered the key, then `accessKey` with that account, the token's
`Transfer` to the recipient's digest, and the keychain's `AccessKeySpend` filter for the account, the key and the
token. Refused when `ref` carries no access key (`tempo/no-access-key`), when `h` is not a 32-byte hash
(`mpp/input-malformed`), or when the receipt did not register the key under `h`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SessionRef`](#sessionref) |
| `receipt` | [`EvmReceipt`](evm.md#evmreceipt) |
| `h` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SessionRef`](#sessionref)

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

> **pairingsOf**(`c`): [`Refusal`](index.md#refusal) \| readonly [`MppPairingId`](#mpppairingid)[]

Checks a challenge as issued (no LCP member in `opaque`) and names its pairings, in the order they are offered. A
Tempo charge whose `amount` is 0 names none: MPP pays it with a `proof` credential, which moves no money. An
`expires` that is present must be an RFC 3339 date-time, else `mpp/expires-required`. Without `expires`, the pairings
whose `build` writes it into what the payer signs, and the NEAR Intents and XRP Ledger charges, whose drafts require
it, are left out, and a challenge left with no pairing is `mpp/expires-required`. These checks are each pairing's one
filter: they include every check its `build`, `bound` and `reference` make on the challenge alone, and those take
only a challenge `pairingsOfPlaced` names for the pairing, refusing any other with the code these checks give it
(`mpp/not-this-pairing` where they name only other pairings).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

[`Refusal`](index.md#refusal) \| readonly [`MppPairingId`](#mpppairingid)[]

***

### pairingsOfPlaced()

> **pairingsOfPlaced**(`c`): readonly [`MppPairingId`](#mpppairingid)[]

The pairings a placed challenge offers: `pairingsOf`'s checks over the challenge with the LCP members `place` writes
allowed in its `opaque`, which must decode as a map of strings, so they are not read as an occupied carrier, and
with the carrier the seller writes after `place` required where `pairingsOf` takes a challenge without it (the
Lightning invoice). These are the pairings whose `build` takes the challenge and whose `bound` and `reference` take it
echoed. None when the challenge does not read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](#mppchallenge) |

#### Returns

readonly [`MppPairingId`](#mpppairingid)[]

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
A Tempo subscription challenge's id is the bare base64url of H. A `doc` holding a challenge that carries a `refused`
member is `mpp/challenge-malformed`, as one holding a challenge without the required members is.

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

The Payment scheme's problem type and HTTP status for a refusal code this package returns, from the scheme's Status
Codes and Error Codes tables, under `https://paymentauth.org/problems/`:
- 402 `malformed-credential`: `mpp/credential-malformed`, `mpp/request-malformed` and `mpp/opaque-malformed`;
- 402 `invalid-challenge`: `mpp/id-not-ours`;
- 500 `internal-payment-error`: a read to repeat, a code `readToRepeat` answers true for, so the seller asks again
  later: a reader that failed or answered out of its form (`<rail>/unreadable`), no landed transaction yet
  (`<rail>/not-found`), or a transaction not final yet, such as a revert above the reader's `finalized` mark
  (`tempo/not-final`, `hedera/not-final`) or one not in a validated ledger (`xrpl/not-validated`);
- 500 `internal-payment-error`: a call that cannot read the payment, which gives the same code until the seller
  changes the call: a reader that is not for the network the challenge or reference names, or a ref `recover`
  cannot read (`tempo/wrong-reader`, `svm/wrong-reader`, `stellar/wrong-reader`, `xrpl/wrong-reader` and
  `hedera/wrong-reader`), and `bound` or `reference` on a push credential before `fetchPresented` has read it
  (`tempo/read-first`, `svm/read-first`, `stellar/read-first`, `xrpl/read-first` and `hedera/read-first`);
- 402 `verification-failed`: every other code this package returns;
- 500 `internal-payment-error`: a code this package does not return. The caller answers its own codes itself.

The seller answers a 402 with a fresh challenge and a 500 with no challenge: a challenge goes out only with a 402.
Neither carries `Payment-Receipt`.

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
salt `h` is the channel. Where `ref.opens` is present, the succeeded transaction, read by `eth_getTransactionByHash`,
must be sent to the escrow and hold its open call for the channel: `open` from the payer, or `openWithPermit2` with
the payer as its `from`. An open call sent to the escrow that opens another channel is failed `open-call-not-found`
where `ref.settleBy` is absent and the receipt's block is at or below the `finalized` mark, and pending otherwise;
any other transaction, one sent through an ERC-4337 EntryPoint included, is pending `open-call-not-found`. Where
`ref.closes` is present, the
succeeded transaction must be a call to that escrow whose calldata starts with one of `EVM_CLOSE_SELECTORS` and
whose first argument is that channel, else pending `not-a-close`. Where `ref.accessKey.account` is present, the
succeeded receipt must also hold the account keychain's `AccessKeySpend` log naming that account, key and token, else
failed `binding-log-not-found`. Where `ref.revokes` is present, the succeeded receipt must hold the account keychain's
`KeyRevoked` log naming that account and key, else failed `binding-log-not-found`. Each failed answer, `evmStatus`'s
and these, is given only where the receipt's block is at or below the reader's `finalized` mark; above it, or where
that mark cannot be read, the same reason is pending. An `opens` that is not an object
whose `escrow` is an address, `channel` and `h` 32-byte hashes and `chainId` a positive integer, an `opened` that is
not one whose `address` is an address, `version` `v1` or `v2`, `channel` and `h` 32-byte hashes and `chainId` a
positive integer, a `closes` that is not an object whose `escrow` is an address and `channel` a 32-byte hash, an
`accessKey` that is not an object whose `keyId` and `token` are addresses, `to` a 32-byte hash and `account`, when
present, an address, or a `revokes` that is not an object whose `account` and `keyId` are addresses, is pending
`unreadable`, with no call made; so is a ref that names none of the keys the three pairings' `reference`, `closeRef`
and `keySearch` write for the opening or the close (`opens`, `opened`, `closes`, `revokes`, an `accessKey` with
`account`, or a binding log under `AuthorizationUsed`, `ChannelClosed` or `KeyAuthorizationWitness`), and what
`evmStatus` reads as `unreadable`. At most four calls.

This function accepts a key of any of the three pairings. Each pairing's own `status` reads a ref only when it names
one of the keys that pairing writes and none of the other two pairings' keys: on `mpp/session/evm` `opens`, `closes`
or a binding log under `AuthorizationUsed`; on `mpp/session/tempo` `opened` or a binding log under `ChannelClosed`;
on `mpp/subscription/tempo` `revokes`, an `accessKey` with `account` or a binding log under
`KeyAuthorizationWitness`. Any other ref is pending `unreadable` there, with no call made.

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
topics and `topics[0]` = `Transfer` whose sender `ref.transferLog` identifies and whose recipient is not
`RECEIVE_POLICY_GUARD`. `ref.asset` and `ref.transferLog.address` must be addresses naming the same token, and
`ref.transferLog` must identify a `Transfer` from it by its sender alone (identity `from`), as the pairing's
`reference` records it; any other ref is pending `unreadable`, with nothing read. Without such a log, a `Transfer`
from that sender to the guard is failed `receive-policy-blocked`, and anything else failed `transfer-not-found`:
another account's `Transfer` in the same transaction is not this payment. Each failed answer, `evmStatus`'s and
these, is given only where the receipt's block is at or below the reader's `finalized` mark; above it, or where that
mark cannot be read, the same reason is pending. At most three calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`EvmRef`](evm.md#evmref) & `object` |
| `reader` | [`EvmReader`](evm.md#evmreader) |

#### Returns

`Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>

***

### usdcGatewaySalt()

> **usdcGatewaySalt**(`i`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

`usdc`'s Gateway salt: keccak256 of the JCS of the inputs with `method` "usdc", `intent` "charge", `type` "gateway".

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`GatewaySaltInput`](#gatewaysaltinput) |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### usdcNonce()

> **usdcNonce**(`id`, `realm`, `requestHash`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

`usdc`'s EIP-3009 nonce: keccak256 of the JCS of `{id, method: "usdc", realm, intent: "charge", requestHash}`, with
`requestHash` written as `0x` and 64 lowercase hex.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |
| `realm` | `string` |
| `requestHash` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### usdcRequestHash()

> **usdcRequestHash**(`requestParam`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

keccak256 of the challenge's `request` parameter's decoded bytes, as `0x` and lowercase hex. The bytes must be the
RFC 8785 form of their own parse, else `mpp/request-not-jcs`; they are hashed as received.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `requestParam` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

## References

### chargeHedera

Re-exports [chargeHedera](hedera.md#chargehedera)
