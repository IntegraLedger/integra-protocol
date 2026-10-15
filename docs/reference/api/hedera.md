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
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` | `hederaIdDigest` of the payer. |
| <a id="property-network"></a> `network` | [`HederaNetwork`](#hederanetwork) | - |
| <a id="property-settleby"></a> `settleBy` | `number` | Unix seconds: the time `reference` ran plus `maxTimeoutSeconds`. |
| <a id="property-transaction"></a> `transaction?` | `string` | The facilitator's `SettlementResponse.transaction`, mirror form. |

***

### HederaBody

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bodybytes"></a> `bodyBytes` | `Uint8Array`\<`ArrayBuffer`\> | - |
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

### HederaChargeChoice

The buyer's inputs to the Hedera charge's `build`: the chosen challenge, the payer, the node, the transaction's valid
start and maximum fee, and, optionally, the client id the attribution memo carries and the credential type.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-challenge"></a> `challenge` | [`MppChallenge`](mpp.md#mppchallenge) & `object` |
| <a id="property-clientid"></a> `clientId?` | `string` |
| <a id="property-credentialtype"></a> `credentialType?` | `"transaction"` \| `"hash"` |
| <a id="property-maxfee"></a> `maxFee` | `bigint` |
| <a id="property-node"></a> `node` | `string` |
| <a id="property-payer-1"></a> `payer` | `string` |
| <a id="property-validstart"></a> `validStart` | `object` |
| `validStart.nanos` | `number` |
| `validStart.seconds` | `bigint` |

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

The read keys `reference` returns.

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
| <a id="property-nanos"></a> `nanos` | `number` | An integer from 0 to 999,999,999. |
| <a id="property-seconds"></a> `seconds` | `bigint` | A non-negative bigint. |

***

### HederaUnsigned

The body the payer signs, and how its signature completes the wire transaction.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | `broadcast: true` when the payer's signer signs and broadcasts the body itself (a push). |
| `request.bodyBytes` | `Uint8Array`\<`ArrayBuffer`\> | - |
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

### MirrorEntry

The Mirror Node's `Transaction` entry: the fields read here.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-charged_tx_fee"></a> `charged_tx_fee?` | `number` | The fee charged to the transaction's fee payer, in tinybars; its `transfers` row includes it. |
| <a id="property-consensus_timestamp"></a> `consensus_timestamp` | `string` | - |
| <a id="property-memo_base64"></a> `memo_base64` | `string` \| `null` | - |
| <a id="property-nonce"></a> `nonce` | `number` | - |
| <a id="property-result"></a> `result` | `string` | - |
| <a id="property-scheduled"></a> `scheduled` | `boolean` | - |
| <a id="property-staking_reward_transfers"></a> `staking_reward_transfers?` | readonly `object`[] | HIP-406 staking rewards paid by this transaction, in tinybars. `transfers` already holds each account's total change, so a reward is in the rewarded account's credit there, and the staking reward account `0.0.800` pays it. |
| <a id="property-token_transfers"></a> `token_transfers?` | readonly `object`[] | - |
| <a id="property-transfers"></a> `transfers?` | readonly `object`[] | - |

## Type Aliases

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

### HederaNetwork

> **HederaNetwork** = `"hedera:mainnet"` \| `"hedera:testnet"` \| `"hedera:previewnet"` \| `"hedera:devnet"`

***

### HederaSessionRef

> **HederaSessionRef** = \{ `bindingLog`: `NonNullable`\<[`EvmRef`](evm.md#evmref)\[`"bindingLog"`\]\>; `escrow?`: `never`; `network`: `HederaNetwork`; `transaction`: [`Hex`](evm.md#hex); \} \| \{ `bindingLog?`: `never`; `escrow`: [`Hex`](evm.md#hex); `network`: `HederaNetwork`; `transaction`: [`Hex`](evm.md#hex); \}

The opening's read keys: the reported open transaction, and either its `ChannelOpened` log from the escrow naming the
channel (`bindingLog`), or, where the channel is not known, the escrow alone (`escrow`, the challenge's
`methodDetails.escrowContract`, lowercase), whose one `ChannelOpened` log in the transaction `recover` and `status`
read.

***

### HederaStatus

> **HederaStatus** = \{ `consensus`: `string`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"not-this-instrument"` \| `` `result:${string}` ``; \}

## Variables

### CHANNEL\_CLOSED\_TOPIC

> `const` **CHANNEL\_CLOSED\_TOPIC**: `"0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51"` = `"0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51"`

`ChannelClosed(bytes32,address,address,uint256,uint256)`.

***

### CHANNEL\_OPENED\_TOPIC

> `const` **CHANNEL\_OPENED\_TOPIC**: `"0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94"` = `"0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94"`

`ChannelOpened(bytes32,address,address,address,address,bytes32,uint256)`: channel, payer, payee indexed.

***

### chargeHedera

> `const` **chargeHedera**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge)[]; `bound`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaUnsigned`](#hederaunsigned)\>; `carrier`: `"challenge"`; `claims`: `boolean`; `fetchPresented`: (`input`, `reader`, `defaultNetwork?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `HederaLandedCharge`\>; `id`: `"mpp/charge/hedera"`; `landedTx`: (`presented`) => `string` \| `undefined`; `network`: (`request`, `defaultNetwork?`) => [`Refusal`](index.md#refusal) \| [`HederaNetwork`](#hederanetwork); `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| \{ `agreement?`: `string`; `h`: `` `0x${string}` ``; `link`: `string`; `offer`: \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}; \}; `reference`: (`input`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaRef`](#hederaref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`options`) => \[`"mpp"`, \{ `challenges`: [`MppChallenge`](mpp.md#mppchallenge)[]; \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`MppChallenge`](mpp.md#mppchallenge); \}\>

`mpp/charge/hedera`. `broadcaster` answers by the credential's `type`, as the charge's `build` writes the request:
`hash`, the default, whose request carries `broadcast: true`, `"payer"`: the payer's signer broadcast the body and
presents the transaction id, which `fetchPresented` reads, then `status`; `transaction`, whose request carries no
`broadcast`, `"payee"`: the seller's server broadcasts the signed transaction, and `status` reads it. A credential of
any other type gets `mpp/credential-type`, as `bound` refuses it.

***

### ESCROW\_OPEN\_SELECTOR

> `const` **ESCROW\_OPEN\_SELECTOR**: `"0xc79ea485"` = `"0xc79ea485"`

`open(address,address,uint128,bytes32,address)`.

***

### exactHedera

> `const` **exactHedera**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaUnsigned`](#hederaunsigned)\>; `carrier`: `"TransactionBody.memo"`; `claims`: `boolean`; `id`: `"x402/exact/hedera"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaRef`](#hederaref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/hedera`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the
transaction's fee payer, adds its signature to the transaction the payer signed and submits it; `status` reads it by
its transaction id.

***

### exactHederaExecutor

> `const` **exactHederaExecutor**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `amount`: `string`; `asset`: `string`; `executors`: readonly `string`[]; `kind`: `"hedera-executor"`; `network`: [`HederaNetwork`](#hederanetwork); `payTo`: `string`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| `ExecutorPaymentPayload`; \}\>; `claims`: `boolean`; `id`: `"x402/exact/hedera/transfer-executor"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`ExecutorRef`](#executorref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/hedera/transfer-executor`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
facilitator submits the executor's transfer under the authorization the payer signed, and names its transaction;
`status` reads it.

## Functions

### decodeHederaTx()

> **decodeHederaTx**(`wire`): [`Refusal`](index.md#refusal) \| \{ `bodies`: readonly [`HederaBody`](#hederabody)[]; \}

Reads a wire `Transaction`, or the SDK's `TransactionList` of them (a top-level field 1): each body's transaction
id, valid duration, memo and exact bytes, the bytes a copy of `wire`'s. Every body of a list must share id and memo.

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
HBAR transfers. The fee payer's rows are kept: fees are paid in HBAR, so token rows are whole, and on HBAR the fee the
user entry's `charged_tx_fee` names is added back to the fee payer, so a payer or payee that is also the fee payer
reads as what it paid or received. Exactly one account must be debited, by at least one unit, and its digest must be
the recorded one: the payment is the named transaction's debit of the payer. Payee and amount are not read. A transfer
list that is not an array, or an HBAR user entry without `charged_tx_fee`, is pending `unreadable`. A ref whose
`transaction` is not a Mirror Node transaction id, whose `asset` is not `shard.realm.num` or whose `idDigest` is not
`0x` and 64 hex digits is pending `unreadable`, with nothing read.

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

keccak256(abi.encode(payer, payee, token, salt, authorizedSigner, escrow, chainId)), lowercase. Throws TypeError
when an address is not `0x` and 40 hex digits, the salt is not a 32-byte hash, or the chain id is not 295 or 296.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | [`HederaChannelConfig`](#hederachannelconfig) |

#### Returns

`` `0x${string}` ``

***

### hederaIdDigest()

> **hederaIdDigest**(`payer`): `Promise`\<`` `0x${string}` ``\>

The core's hash over the ASCII of `payer`: the payer's identity, never shown in the clear.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payer` | `string` |

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### hederaStatus()

> **hederaStatus**(`ref`, `reader`): `Promise`\<[`HederaStatus`](#hederastatus)\>

Reads every Mirror Node entry for the transaction id. Duplicates, node due-diligence failures, child and scheduled
records are skipped; the user transaction with SUCCESS and the recorded memo is settled, with another memo it is
not this instrument, and any other result is failed with that result. A failed read, a reader for another network,
or a SUCCESS entry whose `memo_base64` is not base64 in its canonical form (RFC 4648 §3.5) is pending. A ref whose
`expectMemo` is not a string is pending `unreadable`, with nothing read. It never answers expired: a transaction id
that no entry uses stays pending `not-found`, and `validUntil` is not read, so the caller decides when to stop
reading.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`HederaRef`](#hederaref) |
| `reader` | [`HederaReader`](#hederareader) |

#### Returns

`Promise`\<[`HederaStatus`](#hederastatus)\>

***

### hederaVoucher()

> **hederaVoucher**(`c`, `cumulative`): `HederaVoucherTypedData`

The voucher for `cumulative` on a channel, under the escrow's domain. Throws TypeError when the channel id is not a
32-byte hash, the escrow not `0x` and 40 hex digits, the chain id not 295 or 296, or `cumulative` not a bigint that
fits a uint128.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `c` | \{ `chainId`: `295` \| `296`; `channelId`: `` `0x${string}` ``; `escrow`: `` `0x${string}` ``; \} |
| `c.chainId` | `295` \| `296` |
| `c.channelId` | `` `0x${string}` `` |
| `c.escrow` | `` `0x${string}` `` |
| `cumulative` | `bigint` |

#### Returns

`HederaVoucherTypedData`

***

### txIdMirror()

> **txIdMirror**(`id`): `string`

"0.0.1235-1700000000-000000000", the Mirror Node's form. Throws TypeError on an id that is not a `HederaTxId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | [`HederaTxId`](#hederatxid) |

#### Returns

`string`

***

### txIdText()

> **txIdText**(`id`): `string`

"0.0.1235@1700000000.000000000". Throws TypeError on an id that is not a `HederaTxId`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | [`HederaTxId`](#hederatxid) |

#### Returns

`string`

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### FETCHED

Re-exports [FETCHED](index.md#fetched)
