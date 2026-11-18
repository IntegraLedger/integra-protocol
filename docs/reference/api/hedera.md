---
title: "@integraledger/lcp/hedera"
description: "Hedera: the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and `x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only), with the transaction wire form and the Mirror Node settlement read."
---

# @integraledger/lcp/hedera

Hedera: the x402 pairings `x402/exact/hedera` (the ATR hash as the signed body memo) and
`x402/exact/hedera/transfer-executor` (the hash advertised in the challenge only), with the transaction wire form and
the Mirror Node settlement read.

The wire form is read and written by hand (protobuf, five messages). The entry point also holds the escrow channel
pieces `hederaChannelId` and `hederaVoucher`, and `FETCHED`, the key under which a pairing's `fetchPresented` writes
the seller's read onto a credential.

## Interfaces

### ExecutorRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asset"></a> `asset` | `string` | - |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` | `hederaIdDigest` of the payer. |
| <a id="property-network"></a> `network` | [`HederaNetwork`](#hederanetwork) | - |
| <a id="property-payee"></a> `payee` | `string` | The option's `payTo`. |
| <a id="property-settleby"></a> `settleBy` | `number` | Unix seconds: the time `reference` ran plus `maxTimeoutSeconds`. |
| <a id="property-transaction"></a> `transaction?` | `string` | The facilitator's `SettlementResponse.transaction`, mirror form. |

***

### HederaBody

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bodybytes"></a> `bodyBytes` | `Uint8Array`\<`ArrayBuffer`\> | - |
| <a id="property-id"></a> `id` | [`HederaTxId`](#hederatxid) | - |
| <a id="property-maxfee"></a> `maxFee` | `string` | `transactionFee`: the most the fee payer pays, in tinybars, a decimal integer. |
| <a id="property-memo"></a> `memo` | `string` | - |
| <a id="property-node"></a> `node` | `string` | `nodeAccountID`: the node the body is for. |
| <a id="property-transfer"></a> `transfer?` | [`HederaTransfer`](#hederatransfer) | The body's `cryptoTransfer`; absent where the body is another transaction. |
| <a id="property-validduration"></a> `validDuration` | `number` | `transactionValidDuration`, in seconds. |

***

### HederaChannelConfig

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-authorizedsigner"></a> `authorizedSigner` | `` `0x${string}` `` |
| <a id="property-chainid"></a> `chainId` | `295` \| `296` |
| <a id="property-escrow"></a> `escrow` | `` `0x${string}` `` |
| <a id="property-payee-1"></a> `payee` | `` `0x${string}` `` |
| <a id="property-payer"></a> `payer` | `` `0x${string}` `` |
| <a id="property-salt"></a> `salt` | `` `0x${string}` `` |
| <a id="property-token"></a> `token` | `` `0x${string}` `` |

***

### HederaPresented

The members of the body the payer signed that the read compares with the landed entry, as presented.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-maxfee-1"></a> `maxFee` | `string` | - |
| <a id="property-nodes"></a> `nodes` | readonly `string`[] | The node of each body the presented list holds; one for a single `Transaction`. |
| <a id="property-transfer-1"></a> `transfer` | [`HederaTransfer`](#hederatransfer) | - |

***

### HederaReader

Bounded, read-only calls against one network's Mirror Node. Every failure rejects.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network-1"></a> `network` | `readonly` | [`HederaNetwork`](#hederanetwork) |

#### Methods

##### accountTransactions()

> **accountTransactions**(`q`): `Promise`\<[`MirrorPage`](#mirrorpage)\>

One page of an account's transactions, oldest first: `GET /api/v1/transactions` with `account.id` the account,
`timestamp` `gt:` `after` and `lte:` `until`, `order` `asc` and `limit` 100.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `q` | \{ `account`: `string`; `after`: `string`; `until`: `string`; \} |
| `q.account` | `string` |
| `q.after` | `string` |
| `q.until` | `string` |

###### Returns

`Promise`\<[`MirrorPage`](#mirrorpage)\>

##### latest()

> **latest**(): `Promise`\<`string`\>

The mirror's latest consensus timestamp: the end of its newest block, `timestamp.to` of
`GET /api/v1/blocks?order=desc&limit=1`.

###### Returns

`Promise`\<`string`\>

##### oldest()

> **oldest**(): `Promise`\<`string`\>

How far back the mirror holds records: the start of its oldest block, `timestamp.from` of
`GET /api/v1/blocks?order=asc&limit=1`, or `archival` where the endpoint is declared archival.

###### Returns

`Promise`\<`string`\>

##### transactions()

> **transactions**(`mirrorId`): `Promise`\<readonly [`MirrorEntry`](#mirrorentry)[] \| `null`\>

`GET /api/v1/transactions/{id}`: the answer's `transactions`; null on the mirror's 404 for the id.

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
| <a id="property-expectmemo"></a> `expectMemo` | `string` | The body's memo: H's LCP string. |
| <a id="property-network-2"></a> `network` | [`HederaNetwork`](#hederanetwork) | - |
| <a id="property-payee-2"></a> `payee` | `string` | The option's `payTo`. |
| <a id="property-payer-1"></a> `payer` | `string` | The one account the signed body debits: the payer, the signer the read names, and the search's key. |
| <a id="property-presented"></a> `presented` | [`HederaPresented`](#hederapresented) | The rest of the members of the payment presented. |
| <a id="property-transactionid"></a> `transactionId` | `string` | The transaction id, the single-use value, in the Mirror Node's form. |
| <a id="property-validduration-1"></a> `validDuration` | `number` | `transactionValidDuration`, in seconds. |
| <a id="property-validstart"></a> `validStart` | `string` | The valid start the id names, as a consensus timestamp `seconds.nanos`, nanoseconds in nine digits. |

***

### HederaRow

One row of a transfer list, as the signed body or the mirror holds it: the account and its signed change.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account"></a> `account` | `string` | - |
| <a id="property-amount"></a> `amount` | `string` | The change in the asset's smallest unit, a decimal integer, negative for a debit. |
| <a id="property-isapproval"></a> `isApproval` | `boolean` | `is_approval`: true where the row spends an allowance the account granted, so the account did not sign it. |

***

### HederaTransfer

A crypto transfer as the signed body holds it: its HBAR rows, and its rows per token.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-hbar"></a> `hbar` | readonly [`HederaRow`](#hederarow)[] |
| <a id="property-tokens"></a> `tokens` | readonly `object`[] |

***

### HederaTxId

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account-1"></a> `account` | `string` | "shard.realm.num" |
| <a id="property-nanos"></a> `nanos` | `number` | An integer from 0 to 999,999,999. |
| <a id="property-seconds"></a> `seconds` | `bigint` | A non-negative bigint. |

***

### HederaUnsigned

The body the payer signs, and how its signature completes the wire transaction.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.bodyBytes` | `Uint8Array`\<`ArrayBuffer`\> |
| `request.kind` | `"hedera-body"` |

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
| <a id="property-assessed_custom_fees"></a> `assessed_custom_fees?` | readonly `unknown`[] | The custom fees a token transfer assessed (the detail of `GET /api/v1/transactions/{id}`); they change its rows. |
| <a id="property-charged_tx_fee"></a> `charged_tx_fee?` | `number` | The fee charged to the transaction's fee payer, in tinybars; its `transfers` row includes it. |
| <a id="property-consensus_timestamp"></a> `consensus_timestamp` | `string` | - |
| <a id="property-max_fee"></a> `max_fee?` | `string` | - |
| <a id="property-memo_base64"></a> `memo_base64` | `string` \| `null` | - |
| <a id="property-name"></a> `name?` | `string` | The transaction's type: `CRYPTOTRANSFER` for a transfer. |
| <a id="property-node-1"></a> `node?` | `string` \| `null` | The node the transaction was submitted through. |
| <a id="property-nonce"></a> `nonce` | `number` | - |
| <a id="property-result"></a> `result` | `string` | - |
| <a id="property-scheduled"></a> `scheduled` | `boolean` | - |
| <a id="property-staking_reward_transfers"></a> `staking_reward_transfers?` | readonly [`MirrorRow`](#mirrorrow)[] | HIP-406 staking rewards paid by this transaction, in tinybars. `transfers` already holds each account's total change, so a reward is in the rewarded account's credit there, and the staking reward account `0.0.800` pays it. |
| <a id="property-token_transfers"></a> `token_transfers?` | readonly [`MirrorRow`](#mirrorrow)[] | - |
| <a id="property-transaction_id"></a> `transaction_id?` | `string` | The transaction id, `shard.realm.num-seconds-nanos`. |
| <a id="property-transfers"></a> `transfers?` | readonly [`MirrorRow`](#mirrorrow)[] | - |
| <a id="property-valid_duration_seconds"></a> `valid_duration_seconds?` | `string` | - |
| <a id="property-valid_start_timestamp"></a> `valid_start_timestamp?` | `string` | - |

***

### MirrorPage

One page of the account's transactions: the answer's `transactions` and its `links.next`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-next"></a> `next` | `string` \| `null` |
| <a id="property-transactions"></a> `transactions` | readonly [`MirrorEntry`](#mirrorentry)[] |

***

### MirrorRow

A transfer row of a Mirror Node entry: `transfers`, `token_transfers` (with `token_id`) or `staking_reward_transfers`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-account-2"></a> `account` | `string` |
| <a id="property-amount-1"></a> `amount` | `number` |
| <a id="property-is_approval"></a> `is_approval?` | `boolean` |
| <a id="property-token_id"></a> `token_id?` | `string` |

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

### HederaNetwork

> **HederaNetwork** = `"hedera:mainnet"` \| `"hedera:testnet"` \| `"hedera:previewnet"` \| `"hedera:devnet"`

***

### HederaStatus

> **HederaStatus** = [`StatusAnswer`](index.md#statusanswer)\<`string`, `"consensus"`, `string`\>

The answer of `hederaStatus` and `executorStatus`: positions are the Mirror Node's `consensus_timestamp`
(`seconds.nanos`), and the one mark is `consensus`, the record the Mirror Node serves, which is final. A `settled`
answer of `hederaStatus` states `presented` (the profile `x402/exact/hedera`, rule 12).

## Variables

### CHANNEL\_CLOSED\_TOPIC

> `const` **CHANNEL\_CLOSED\_TOPIC**: `"0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51"` = `"0x92ed5fe0fe56b3f4185e688efb342e92a4492b9df29ad5de596c44e64d097b51"`

`ChannelClosed(bytes32,address,address,uint256,uint256)`.

***

### CHANNEL\_OPENED\_TOPIC

> `const` **CHANNEL\_OPENED\_TOPIC**: `"0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94"` = `"0xcd6e60364f8ee4c2b0d62afc07a1fb04fd267ce94693f93f8f85daaa099b5c94"`

`ChannelOpened(bytes32,address,address,address,address,bytes32,uint256)`: channel, payer, payee indexed.

***

### exactHedera

> `const` **exactHedera**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaUnsigned`](#hederaunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/hedera"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`HederaRef`](#hederaref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/hedera`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the
transaction's fee payer, adds its signature to the transaction the payer signed and submits it; `status` reads it by
its transaction id.

***

### exactHederaExecutor

> `const` **exactHederaExecutor**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `request`: \{ `amount`: `string`; `asset`: `string`; `executors`: readonly `string`[]; `kind`: `"hedera-executor"`; `network`: [`HederaNetwork`](#hederanetwork); `payTo`: `string`; `validBefore`: `number`; \}; `complete`: [`Refusal`](index.md#refusal) \| `ExecutorPaymentPayload`; \}\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/hedera/transfer-executor"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`ExecutorRef`](#executorref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`HederaStatus`](#hederastatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/hedera/transfer-executor`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's
facilitator submits the executor's transfer under the authorization the payer signed, and names its transaction;
`status` reads it.

## Functions

### decodeHederaTx()

> **decodeHederaTx**(`wire`): [`Refusal`](index.md#refusal) \| \{ `bodies`: readonly [`HederaBody`](#hederabody)[]; \}

Reads a wire `Transaction`, or the SDK's `TransactionList` of them (a top-level field 1): each body's transaction
id, node, maximum fee, valid duration, memo, crypto transfer and exact bytes, the bytes a copy of `wire`'s. Every
body of a list must equal the first in all but its node, else `hedera/list-inconsistent`; a valid duration above
the chain's 180 seconds is `hedera/valid-duration`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `bodies`: readonly [`HederaBody`](#hederabody)[]; \}

***

### executorStatus()

> **executorStatus**(`ref`, `reader`, `query`): `Promise`\<[`HederaStatus`](#hederastatus)\>

The read of the executor's transfer by the transaction the facilitator named, as the profile `read-status` answers
it at coverage `none` (the profile `x402/exact/hedera`, rule 15): the named transaction is the act, read in its
merged consensus record, the user entry and its child entries, each account's net change in every asset taken with
HIP-406 staking rewards taken back out and the user entry's `charged_tx_fee` added back to the fee payer. Its signer
is the one account the record debits, which is the payer where its digest is the one `reference` recorded and the
option's payee where it is that account; it pays where it credits the payee. The named transaction id is single-use:
an entry under it that decides consumed it, and with none it lapses once its valid start plus the chain's longest
valid duration, 180 seconds, is strictly before the mirror's latest consensus timestamp, read first, the mirror
holding records back to that valid start; no search is made, the act being the transaction named. A ref whose
`transaction` is not a Mirror Node transaction id, whose `asset` is not `shard.realm.num` (it is read for nothing
else), or whose `idDigest` is not `0x` and 64 hex digits, is
`unparseable`, with nothing read; a record whose rows are not well formed is `unparseable`, and more than 64 entries
`too-large`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`ExecutorRef`](#executorref) & `object` |
| `reader` | [`HederaReader`](#hederareader) |
| `query` | `HederaQuery`\<[`ExecutorRef`](#executorref) & `object`\> |

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

> **hederaStatus**(`ref`, `reader`, `query`): `Promise`\<[`HederaStatus`](#hederastatus)\>

The read of the act the query asks about (the profiles `read-status` and `x402/exact/hedera`). The mirror's latest
consensus timestamp is read first, then the entries under the presented transaction id, its single-use value. An
entry under the id that decides consumed the id: it is the act where it succeeded, its memo is H's string, it is the
payer's own transfer and, for the act `payment`, it credits the option's payee; a failed result under the id is the
act's own failed result. With no such entry the id is unconsumed, live while the mirror holds records back to the
valid start (else `history-gap`), and lapsed once the valid start plus the valid duration is strictly before the
timestamp read first. Before a
`failed`, the search for H over the payer's transactions, from the position the caller gives, or the search position
an earlier answer returned, to that timestamp; an act it finds is the act, and with none found the answer is
`pending`, `search-incomplete`, at the search's position, the search proving no absence until a run shows its three
facts. A `settled` answer states `presented`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`HederaRef`](#hederaref) |
| `reader` | [`HederaReader`](#hederareader) |
| `query` | `HederaQuery`\<[`HederaRef`](#hederaref)\> |

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
