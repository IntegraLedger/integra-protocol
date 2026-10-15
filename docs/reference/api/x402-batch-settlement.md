---
title: "@integraledger/lcp/x402-batch-settlement"
description: "The exports of @integraledger/lcp/x402-batch-settlement."
---

# @integraledger/lcp/x402-batch-settlement

## Interfaces

### BatchEvmOpen

#### Extends

- [`X402Choice`](x402.md#x402choice)

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) | [`X402Choice`](x402.md#x402choice).[`accepted`](x402.md#property-accepted) |
| <a id="property-authsalt"></a> `authSalt` | `` `0x${string}` `` | - |
| <a id="property-deposit"></a> `deposit` | `bigint` | - |
| <a id="property-from"></a> `from` | `` `0x${string}` `` | [`X402Choice`](x402.md#x402choice).[`from`](x402.md#property-from) |
| <a id="property-now"></a> `now` | `number` | [`X402Choice`](x402.md#x402choice).[`now`](x402.md#property-now) |
| <a id="property-payerauthorizer"></a> `payerAuthorizer` | `` `0x${string}` `` | - |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) | [`X402Choice`](x402.md#x402choice).[`required`](x402.md#property-required) |

***

### BatchSvmOpen

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-computeunitlimit"></a> `computeUnitLimit?` | `number` |
| <a id="property-computeunitprice"></a> `computeUnitPrice?` | `bigint` |
| <a id="property-deposit-1"></a> `deposit` | `bigint` |
| <a id="property-openslot"></a> `openSlot` | `bigint` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-payerauthorizer-1"></a> `payerAuthorizer` | `string` |
| <a id="property-recentblockhash"></a> `recentBlockhash` | `string` |
| <a id="property-required-1"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-salt"></a> `salt` | `bigint` |
| <a id="property-tokenprogram"></a> `tokenProgram` | `string` |

***

### BatchUnsigned

Several signing requests, signed in order. `complete` takes one signature per request: `0x` hex for `eip712`,
base58 for `solana-message` and `ed25519-raw`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-requests"></a> `requests` | readonly [`SigningRequest`](#signingrequest)[] |

#### Methods

##### complete()

> **complete**(`signatures`): [`Refusal`](index.md#refusal) \| `BatchPaymentPayload`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signatures` | readonly `string`[] |

###### Returns

[`Refusal`](index.md#refusal) \| `BatchPaymentPayload`

***

### BatchWithin

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accepted-2"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) | - |
| <a id="property-channelconfig"></a> `channelConfig` | [`Json`](index.md#json) | Exactly as sent at the opening. |
| <a id="property-computeunitlimit-1"></a> `computeUnitLimit?` | `number` | SVM refund's `request_close`: the Compute Budget values, 200 000 units and 1 microlamport when absent. |
| <a id="property-computeunitprice-1"></a> `computeUnitPrice?` | `bigint` | - |
| <a id="property-maxclaimableamount"></a> `maxClaimableAmount` | `bigint` | - |
| <a id="property-recentblockhash-1"></a> `recentBlockhash?` | `string` | SVM refund: the blockhash of its `request_close`. Given, the refund carries that transaction, which x402 sends only on a retry after `invalid_batch_settlement_svm_receiver_binding_unavailable`. |
| <a id="property-refund"></a> `refund?` | `object` | A refund. EVM: its amount, absent for a full refund. SVM: `{}`, a full refund carrying the voucher for `maxClaimableAmount`, the server's accepted cumulative amount, and, with `recentBlockhash`, a payer-signed `request_close` built here. |
| `refund.amount?` | `bigint` | - |
| <a id="property-required-2"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) | - |

***

### ChannelConfig

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-payer-1"></a> `payer` | `` `0x${string}` `` | - |
| <a id="property-payerauthorizer-2"></a> `payerAuthorizer` | `` `0x${string}` `` | - |
| <a id="property-receiver"></a> `receiver` | `` `0x${string}` `` | - |
| <a id="property-receiverauthorizer"></a> `receiverAuthorizer` | `` `0x${string}` `` | - |
| <a id="property-salt-1"></a> `salt` | `` `0x${string}` `` | `0x` and 64 hex digits. |
| <a id="property-token"></a> `token` | `` `0x${string}` `` | - |
| <a id="property-withdrawdelay"></a> `withdrawDelay` | `number` | - |

***

### ChannelMembers

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel"></a> `channel` | `object` |
| `channel.boundWithin` | `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\> |
| `channel.kind` | `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"` |
| `channel.ref` | `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\> |
| `channel.until` | `number` \| `undefined` |

***

### Eip712Request

An EIP-712 request for the buyer's signer; numbers in `message` are decimal strings.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-domain"></a> `domain` | `object` |
| `domain.chainId` | `number` |
| `domain.name` | `string` |
| `domain.verifyingContract` | `` `0x${string}` `` |
| `domain.version?` | `string` |
| <a id="property-message"></a> `message` | `object` |
| <a id="property-primarytype"></a> `primaryType` | `string` |
| <a id="property-types"></a> `types` | `object` |

## Type Aliases

### SigningRequest

> **SigningRequest** = \{ `kind`: `"eip712"`; `typedData`: [`Eip712Request`](#eip712request) \| [`ReceiveTypedData`](mpp.md#receivetypeddata) \| [`Permit2TypedData`](evm.md#permit2typeddata); \} \| \{ `kind`: `"solana-message"`; `message`: `Uint8Array`\<`ArrayBuffer`\>; \} \| \{ `kind`: `"ed25519-raw"`; `message`: `Uint8Array`\<`ArrayBuffer`\>; `signer`: `string`; \}

A request to the buyer's signer.

## Variables

### BATCH\_SETTLEMENT

> `const` **BATCH\_SETTLEMENT**: `"0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003"`

***

### batchCloudflare

> `const` **batchCloudflare**: `Readonly`\<\{ `advertise`: `X402Advertise`; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| `CloudflarePaymentPayload`\>; `claims`: `boolean`; `id`: `"x402/batch-settlement/cloudflare"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/batch-settlement/cloudflare`. The payee broadcasts (`broadcaster` answers `"payee"`): Cloudflare, for the
seller, verifies the agent's signed request and bills its registered identity off chain; no `status` reads it.

***

### batchEvm

> `const` **batchEvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`BatchUnsigned`](#batchunsigned)\>; `buildWithin`: (`w`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`BatchUnsigned`](#batchunsigned)\>; `channel`: `Readonly`\<\{ `boundWithin`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`p`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"x402/batch-settlement/eip155"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`EvmRef`](evm.md#evmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`EvmBreadthStatus`](evm.md#evmbreadthstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/batch-settlement/eip155`. The payee broadcasts (`broadcaster` answers `"payee"` for each payment type
`channel.kind` takes): for every payment of the channel: the seller's facilitator executes the deposit's token
authorization, redeems vouchers when it claims, and executes a refund; `status` reads them, and `channel.kind`
classifies each payment. A payment of any other type gets `x402/not-an-opening`, as `bound` refuses it. `bound` reads
a deposit alone, so `channel.kind` reads the rest: a refund whose `amount` is not a positive decimal below 2^128 gets
`x402/payload-malformed`, as `channel.kind` refuses it.

***

### batchSvm

> `const` **batchSvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`BatchUnsigned`](#batchunsigned)\>; `buildWithin`: (`w`, `_h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`BatchUnsigned`](#batchunsigned)\>; `carrier`: `"extra.memo"`; `channel`: `Readonly`\<\{ `boundWithin`: (`_p`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `kind`: (`p`) => `"open"` \| `"close"` \| [`Refusal`](index.md#refusal) \| `"within"`; `ref`: (`p`) => `Promise`\<[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `network`: `string`; \}\>; `until`: (`_p`) => `number` \| `undefined`; \}\>; `claims`: `boolean`; `id`: `"x402/batch-settlement/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`SvmRef`](svm.md#svmref), `"fromSlot"`\>\>; `status`: (`ref`, `reader`) => `Promise`\<[`ChannelStatus`](svm.md#channelstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/batch-settlement/solana`. The payee broadcasts (`broadcaster` answers `"payee"` for each payment type
`channel.kind` takes): for every payment of the channel: the seller's facilitator, the `feePayer`, co-signs and sends
the deposit and top-up transactions the payer signed, redeems vouchers when it settles, and sends the refund;
`status` reads them, and `channel.kind` classifies each payment. A payment of any other type gets
`x402/not-an-opening`, as `bound` refuses it.

***

### CHANNEL\_CONFIG\_TYPEHASH

> `const` **CHANNEL\_CONFIG\_TYPEHASH**: `"0x1c9a06ceab9b0ebbd3301dc56c9111bb6d9af421356dc9ccb3b7084c755db308"`

***

### CHANNEL\_CREATED\_TOPIC

> `const` **CHANNEL\_CREATED\_TOPIC**: `"0x69d8248d5566bdb2ebc4d218970710d8378a2ff9b709a999e052b71970f808fa"`

***

### DEPOSITED\_TOPIC

> `const` **DEPOSITED\_TOPIC**: `"0x6c2a09353b5e75e70d0b9778b80a413809bb235d46c211811c474b3346791d89"`

***

### ERC3009\_DEPOSIT\_COLLECTOR

> `const` **ERC3009\_DEPOSIT\_COLLECTOR**: `"0x4020806089470a89826cB9fB1f4059150b550004"`

***

### PERMIT2\_DEPOSIT\_COLLECTOR

> `const` **PERMIT2\_DEPOSIT\_COLLECTOR**: `"0x4020425FAf3B746C082C2f942b4E5159887B0005"`

***

### VOUCHER\_TYPEHASH

> `const` **VOUCHER\_TYPEHASH**: `"0x1e1bd6ff84c3e0d9029a292b212e039c0ca97ec497c55191a4a5874294609a69"`

## Functions

### batchChannelCreated()

> **batchChannelCreated**(`log`, `chainId`): [`Refusal`](index.md#refusal) \| \{ `channelId`: `` `0x${string}` ``; `config`: [`ChannelConfig`](#channelconfig); \}

The config and id of a `ChannelCreated(channelId, config)` log, the id recomputed from the 7-word data.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `log` | [`EvmLog`](evm.md#evmlog) |
| `chainId` | `number` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `channelId`: `` `0x${string}` ``; `config`: [`ChannelConfig`](#channelconfig); \}

***

### batchChannelId()

> **batchChannelId**(`chainId`, `c`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The channel id: the EIP-712 digest of the configuration under the `x402 Batch Settlement` domain.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `chainId` | `number` |
| `c` | [`ChannelConfig`](#channelconfig) |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### erc3009DepositNonce()

> **erc3009DepositNonce**(`channelId`, `authSalt`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The EIP-3009 deposit's nonce: keccak256(abi.encode(bytes32 channelId, uint256 authSalt)). A `channelId` or
`authSalt` that is not a string of `0x` and 64 hex digits is `evm/field-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channelId` | `` `0x${string}` `` |
| `authSalt` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
