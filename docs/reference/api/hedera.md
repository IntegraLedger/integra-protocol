---
title: "@integraledger/lcp/hedera"
description: "The exports of @integraledger/lcp/hedera."
---

# @integraledger/lcp/hedera

## Interfaces

### ExecutorRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asset"></a> `asset` | `string` | - |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` | - |
| <a id="property-network"></a> `network` | [`HederaNetwork`](#hederanetwork) | - |
| <a id="property-settleby"></a> `settleBy` | `number` | Unix seconds: claim time plus `maxTimeoutSeconds`. |
| <a id="property-transaction"></a> `transaction?` | `string` | The facilitator's `SettlementResponse.transaction`, mirror form. |

***

### HederaBody

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bodybytes"></a> `bodyBytes` | `Uint8Array` | - |
| <a id="property-id"></a> `id` | [`HederaTxId`](#hederatxid) | - |
| <a id="property-memo"></a> `memo` | `string` | - |
| <a id="property-validduration"></a> `validDuration` | `number` | `transactionValidDuration`, in seconds. |

***

### HederaChannelConfig

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-authorizedsigner"></a> `authorizedSigner` | `` `0x${string}` `` |
| <a id="property-chainid"></a> `chainId` | `295` \| `296` |
| <a id="property-escrow"></a> `escrow` | `` `0x${string}` `` |
| <a id="property-payee"></a> `payee` | `` `0x${string}` `` |
| <a id="property-payer"></a> `payer` | `` `0x${string}` `` |
| <a id="property-salt"></a> `salt` | `` `0x${string}` `` |
| <a id="property-token"></a> `token` | `` `0x${string}` `` |

***

### HederaReader

Bounded, read-only calls against one network's Mirror Node. Every failure rejects.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network-1"></a> `network` | `readonly` | [`HederaNetwork`](#hederanetwork) |

#### Methods

##### transactions()

> **transactions**(`mirrorId`): `Promise`\<readonly [`MirrorEntry`](#mirrorentry)[] \| `null`\>

`GET /api/v1/transactions/{id}`; null on 404.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `mirrorId` | `string` |

###### Returns

`Promise`\<readonly [`MirrorEntry`](#mirrorentry)[] \| `null`\>

***

### HederaRef

The read keys recorded at claim, taken from the signed body.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-expectmemo"></a> `expectMemo` | `string` | - |
| <a id="property-network-2"></a> `network` | [`HederaNetwork`](#hederanetwork) | - |
| <a id="property-transactionid"></a> `transactionId` | `string` | Mirror form. |
| <a id="property-validuntil"></a> `validUntil` | `number` | Unix seconds: valid start plus the valid duration. |

***

### HederaTxId

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account"></a> `account` | `string` | "shard.realm.num" |
| <a id="property-nanos"></a> `nanos` | `number` | - |
| <a id="property-seconds"></a> `seconds` | `bigint` | - |

***

### HederaUnsigned

The body the payer signs, and how its signature completes the wire transaction.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | `broadcast: true` when the payer's signer signs and broadcasts the body itself (a push). |
| `request.bodyBytes` | `Uint8Array` | - |
| `request.broadcast?` | `true` | - |
| `request.kind` | `"hedera-body"` | - |

#### Methods

##### complete()

> **complete**(`s`): `string` \| [`Refusal`](index.md#refusal)

The signed `Transaction`, base64.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | \{ `publicKey`: `Uint8Array`; `signature`: `Uint8Array`; `type`: `"ed25519"` \| `"ecdsa-secp256k1"`; \} |
| `s.publicKey` | `Uint8Array` |
| `s.signature` | `Uint8Array` |
| `s.type` | `"ed25519"` \| `"ecdsa-secp256k1"` |

###### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### HederaVoucherTypedData

The EIP-712 voucher a Hedera session's payer signs: `Voucher(bytes32 channelId,uint128 cumulativeAmount)`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-domain"></a> `domain` | `object` |
| `domain.chainId` | `295` \| `296` |
| `domain.name` | `"Hedera Stream Channel"` |
| `domain.verifyingContract` | `` `0x${string}` `` |
| `domain.version` | `"1"` |
| <a id="property-message"></a> `message` | `object` |
| `message.channelId` | `` `0x${string}` `` |
| `message.cumulativeAmount` | `bigint` |
| <a id="property-primarytype"></a> `primaryType` | `"Voucher"` |
| <a id="property-types"></a> `types` | `object` |
| `types.Voucher` | \[\{ `name`: `"channelId"`; `type`: `"bytes32"`; \}, \{ `name`: `"cumulativeAmount"`; `type`: `"uint128"`; \}\] |

***

### MirrorEntry

The Mirror Node's `Transaction` entry: the fields read here.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-consensus_timestamp"></a> `consensus_timestamp` | `string` | - |
| <a id="property-memo_base64"></a> `memo_base64` | `string` \| `null` | - |
| <a id="property-nonce"></a> `nonce` | `number` | - |
| <a id="property-result"></a> `result` | `string` | - |
| <a id="property-scheduled"></a> `scheduled` | `boolean` | - |
| <a id="property-staking_reward_transfers"></a> `staking_reward_transfers?` | readonly `object`[] | HIP-406 staking rewards paid by this transaction, in tinybars. `transfers` already holds each account's total change, so a reward is in the rewarded account's credit there, and the staking reward account `0.0.800` pays it. |
| <a id="property-token_transfers"></a> `token_transfers?` | readonly `object`[] | - |
| <a id="property-transfers"></a> `transfers?` | readonly `object`[] | - |

## Type Aliases

### ExecutorPayload

> **ExecutorPayload** = `object`

The x402 `transferExecutor` payload.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-authorization"></a> `authorization` | [`Hex`](evm.md#hex) |
| <a id="property-executor"></a> `executor` | `string` |
| <a id="property-payer-1"></a> `payer` | `string` |

***

### ExecutorPaymentPayload

> **ExecutorPaymentPayload** = [`X402Payment`](x402.md#x402payment)\<[`ExecutorPayload`](#executorpayload)\>

***

### HederaCloseRef

> **HederaCloseRef** = `object`

A close: the transaction whose `ChannelClosed` log from the escrow names the channel, and `search`, the log filter
that finds that transaction when no one reports it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel"></a> `channel` | [`Hex`](evm.md#hex) |
| <a id="property-escrow-1"></a> `escrow` | [`Hex`](evm.md#hex) |
| <a id="property-network-3"></a> `network` | `HederaNetwork` |
| <a id="property-phase"></a> `phase` | `"close"` |
| <a id="property-search"></a> `search` | `object` |
| `search.address` | [`Hex`](evm.md#hex) |
| `search.topics` | readonly ([`Hex`](evm.md#hex) \| `null`)[] |
| <a id="property-transaction-1"></a> `transaction` | [`Hex`](evm.md#hex) |

***

### HederaEvmReader

> **HederaEvmReader** = `Omit`\<[`EvmReader`](evm.md#evmreader), `"network"`\> & `object`

A reader of a Hedera network's JSON-RPC relay: an `EvmReader` on a `hedera:` network.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `network` | `HederaNetwork` |

***

### HederaLandedCharge

> **HederaLandedCharge** = [`MppCredential`](mpp.md#mppcredential) & `object`

A Hedera charge credential with what `fetchPresented` read: the network, and for a push the landed memo.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `landed` | `object` |
| `landed.memo?` | `string` |
| `landed.network` | [`HederaNetwork`](#hederanetwork) |

***

### HederaNetwork

> **HederaNetwork** = `"hedera:mainnet"` \| `"hedera:testnet"` \| `"hedera:previewnet"` \| `"hedera:devnet"`

***

### HederaPayload

> **HederaPayload** = `object`

The x402 `exact` payload on Hedera: the partially signed transaction, base64.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-transaction-2"></a> `transaction` | `string` |

***

### HederaPaymentPayload

> **HederaPaymentPayload** = [`X402Payment`](x402.md#x402payment)\<[`HederaPayload`](#hederapayload)\>

***

### HederaSessionRef

> **HederaSessionRef** = `Omit`\<[`EvmRef`](evm.md#evmref), `"network"`\> & `object`

The opening's read keys: the reported open transaction and its `ChannelOpened` log from the escrow.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `network` | `HederaNetwork` |
| `transaction` | [`Hex`](evm.md#hex) |

***

### HederaStatus

> **HederaStatus** = \{ `consensus`: `string`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"not-this-instrument"` \| `` `result:${string}` ``; \}

***

### MppHederaRequest

> **MppHederaRequest** = `object`

An MPP Hedera charge request as decoded from the challenge's `request`.

#### Index Signature

\[`k`: `string`\]: [`Json`](index.md#json)

## Variables

### APPROVE\_SELECTOR

> `const` **APPROVE\_SELECTOR**: `"0x095ea7b3"` = `"0x095ea7b3"`

***

### CHANNEL\_CLOSED\_TOPIC

> `const` **CHANNEL\_CLOSED\_TOPIC**: `"0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51"` = `"0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51"`

***

### CHANNEL\_OPENED\_TOPIC

> `const` **CHANNEL\_OPENED\_TOPIC**: `"0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94"` = `"0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94"`

`ChannelOpened(bytes32,address,address,address,address,bytes32,uint256)`: channel, payer, payee indexed.

***

### chargeHedera

> `const` **chargeHedera**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`credentialChallenge`, `request`, `c`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaUnsigned`](#hederaunsigned)\>; `carrier`: `"challenge"`; `claims`: `boolean`; `fetchPresented`: (`input`, `reader`, `defaultNetwork?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaLandedCharge`](#hederalandedcharge)\>; `id`: `"mpp/charge/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `network`: (`request`, `defaultNetwork?`) => [`Refusal`](index.md#refusal) \| [`HederaNetwork`](#hederanetwork); `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaRef`](#hederaref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`MppChallenge`](mpp.md#mppchallenge); \}\>

***

### ESCROW\_OPEN\_SELECTOR

> `const` **ESCROW\_OPEN\_SELECTOR**: `"0xc79ea485"` = `"0xc79ea485"`

`open(address,address,uint128,bytes32,address)`.

***

### exactHedera

> `const` **exactHedera**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaUnsigned`](#hederaunsigned)\>; `carrier`: `"TransactionBody.memo"`; `claims`: `boolean`; `id`: `"x402/exact/hedera"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaRef`](#hederaref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### exactHederaExecutor

> `const` **exactHederaExecutor**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `amount`: `string`; `asset`: `string`; `executors`: readonly `string`[]; `kind`: `"hedera-executor"`; `network`: [`HederaNetwork`](#hederanetwork); `payTo`: `string`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| [`ExecutorPaymentPayload`](#executorpaymentpayload); \}\>; `claims`: `boolean`; `id`: `"x402/exact/hedera/transfer-executor"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`ExecutorRef`](#executorref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### HEDERA\_CHAIN\_IDS

> `const` **HEDERA\_CHAIN\_IDS**: `Readonly`\<`Record`\<`number`, [`HederaNetwork`](#hederanetwork)\>\>

MPP's EIP-155 chain ids for Hedera, mapped to their CAIP-2 networks.

***

### HEDERA\_NETWORKS

> `const` **HEDERA\_NETWORKS**: readonly [`HederaNetwork`](#hederanetwork)[]

## Functions

### approveCalldata()

> **approveCalldata**(`spender`, `amount`): `` `0x${string}` ``

`approve(spender, amount)` calldata.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `spender` | `` `0x${string}` `` |
| `amount` | `bigint` |

#### Returns

`` `0x${string}` ``

***

### decodeHederaTx()

> **decodeHederaTx**(`wire`): [`Refusal`](index.md#refusal) \| \{ `bodies`: readonly [`HederaBody`](#hederabody)[]; \}

Reads a wire `Transaction`, or the SDK's `TransactionList` of them (a top-level field 1): each body's transaction
id, valid duration, memo and exact bytes. Every body of a list must share id and memo.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `bodies`: readonly [`HederaBody`](#hederabody)[]; \}

***

### executorStatus()

> **executorStatus**(`ref`, `reader`): `Promise`\<[`HederaStatus`](#hederastatus)\>

Reads the merged consensus record of the named transaction: the user entry must be SUCCESS; each account's net
change in the asset is summed over the user entry and its children, with HIP-406 staking rewards taken back out of
HBAR transfers and the fee payer left out; exactly one other account must be debited, and a credit of the same
magnitude must give the recorded digest. A transfer list that is not an array is pending `unreadable`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`ExecutorRef`](#executorref) & `object` |
| `reader` | [`HederaReader`](#hederareader) |

#### Returns

`Promise`\<[`HederaStatus`](#hederastatus)\>

***

### hederaChannelId()

> **hederaChannelId**(`c`): `` `0x${string}` ``

keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)), lowercase.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`HederaChannelConfig`](#hederachannelconfig) |

#### Returns

`` `0x${string}` ``

***

### hederaChargeRequest()

> **hederaChargeRequest**(`c`): `true` \| [`Refusal`](index.md#refusal)

The Hedera request checks a charge challenge must pass before it is placed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`MppChallenge`](mpp.md#mppchallenge) |

#### Returns

`true` \| [`Refusal`](index.md#refusal)

***

### hederaIdDigest()

> **hederaIdDigest**(`payer`, `payTo`, `amount`): `Promise`\<`` `0x${string}` ``\>

the core's hash over the ASCII of `payer,payTo,amount`: the identity of one transfer, never shown in the clear.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payer` | `string` |
| `payTo` | `string` |
| `amount` | `string` |

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### hederaNetworkOfChainId()

> **hederaNetworkOfChainId**(`chainId`): [`Refusal`](index.md#refusal) \| [`HederaNetwork`](#hederanetwork)

The CAIP-2 network of an MPP `methodDetails.chainId`: 295 and 296 only.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `chainId` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| [`HederaNetwork`](#hederanetwork)

***

### hederaPairingOf()

> **hederaPairingOf**(`o`): [`Refusal`](index.md#refusal) \| `"x402/exact/hedera"` \| `"x402/exact/hedera/transfer-executor"` \| `undefined`

The Hedera pairing an option names: `x402/exact/hedera` for `cryptoTransfer` (or no method), the transfer-executor
pairing for `transferExecutor`; a Hedera option either cannot serve is `hedera/option-malformed`. Undefined for an
option on another rail.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

[`Refusal`](index.md#refusal) \| `"x402/exact/hedera"` \| `"x402/exact/hedera/transfer-executor"` \| `undefined`

***

### hederaStatus()

> **hederaStatus**(`ref`, `reader`): `Promise`\<[`HederaStatus`](#hederastatus)\>

Reads every Mirror Node entry for the transaction id. Duplicates, node due-diligence failures, child and scheduled
records are skipped; the user transaction with SUCCESS and the recorded memo is settled, with another memo it is
not this instrument, and any other result is failed with that result. A failed read, or a reader for another
network, is pending.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`HederaRef`](#hederaref) |
| `reader` | [`HederaReader`](#hederareader) |

#### Returns

`Promise`\<[`HederaStatus`](#hederastatus)\>

***

### hederaVoucher()

> **hederaVoucher**(`c`, `cumulative`): [`HederaVoucherTypedData`](#hederavouchertypeddata)

The voucher for `cumulative` on a channel, under the escrow's domain.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | \{ `chainId`: `295` \| `296`; `channelId`: `` `0x${string}` ``; `escrow`: `` `0x${string}` ``; \} |
| `c.chainId` | `295` \| `296` |
| `c.channelId` | `` `0x${string}` `` |
| `c.escrow` | `` `0x${string}` `` |
| `cumulative` | `bigint` |

#### Returns

[`HederaVoucherTypedData`](#hederavouchertypeddata)

***

### openCalldata()

> **openCalldata**(`payee`, `token`, `deposit`, `salt`, `authorizedSigner`): `` `0x${string}` ``

The escrow's `open(payee, token, deposit, salt, authorizedSigner)` calldata.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payee` | `` `0x${string}` `` |
| `token` | `` `0x${string}` `` |
| `deposit` | `bigint` |
| `salt` | `` `0x${string}` `` |
| `authorizedSigner` | `` `0x${string}` `` |

#### Returns

`` `0x${string}` ``

***

### txIdMirror()

> **txIdMirror**(`id`): `string`

"0.0.1235-1700000000-000000000", the Mirror Node's form.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | [`HederaTxId`](#hederatxid) |

#### Returns

`string`

***

### txIdText()

> **txIdText**(`id`): `string`

"0.0.1235@1700000000.000000000"

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | [`HederaTxId`](#hederatxid) |

#### Returns

`string`
