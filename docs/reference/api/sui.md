---
title: "@integraledger/lcp/sui"
description: "The exports of @integraledger/lcp/sui."
---

# @integraledger/lcp/sui

## Interfaces

### SuiExecuted

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-checkpoint"></a> `checkpoint` | `bigint` \| `null` |
| <a id="property-status"></a> `status` | `"SUCCESS"` \| `"FAILURE"` |
| <a id="property-transactionbcs"></a> `transactionBcs` | `Uint8Array` |

***

### SuiPayload

The payload x402's Sui scheme defines.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-signature"></a> `signature` | `string` |
| <a id="property-transaction"></a> `transaction` | `string` |

***

### SuiPaymentPayload

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | `object` |
| <a id="property-payload"></a> `payload` | [`SuiPayload`](#suipayload) |
| <a id="property-resource"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version"></a> `x402Version` | `2` |

***

### SuiReader

Bounded, read-only calls against one network's GraphQL endpoint. Every failure rejects with `ReaderError`.
`read` is one request, so one snapshot:
`query($d:String!){transaction(digest:$d){transactionBcs effects{status checkpoint{sequenceNumber}}}
checkpoint{epoch{epochId}}}`, where the last field is the latest checkpoint's epoch.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`SuiNetwork`](#suinetwork) |

#### Methods

##### read()

> **read**(`digest`): `Promise`\<\{ `epoch`: `bigint`; `tx`: [`SuiExecuted`](#suiexecuted) \| `null`; \}\>

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `digest` | `string` |

###### Returns

`Promise`\<\{ `epoch`: `bigint`; `tx`: [`SuiExecuted`](#suiexecuted) \| `null`; \}\>

***

### SuiRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-digest"></a> `digest` | `string` | - |
| <a id="property-network-1"></a> `network` | [`SuiNetwork`](#suinetwork) | - |
| <a id="property-untilepoch"></a> `untilEpoch` | `string` | The last epoch the transaction can execute in, as a decimal string. |

***

### SuiTx

A decoded `TransactionData`: the bytes as received, their digest, the unused `Pure` inputs, and the epoch bound.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bytes"></a> `bytes` | `Uint8Array` | - |
| <a id="property-digest-1"></a> `digest` | `string` | Base58 of Blake2b-256 over `"TransactionData::"` followed by the bytes. |
| <a id="property-untilepoch-1"></a> `untilEpoch` | `bigint` \| `null` | - |
| <a id="property-unusedpure"></a> `unusedPure` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] | - |

***

### SuiUnsigned

What `build` hands the payer's wallet, and how it checks what comes back.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| `request.expiration` | `"epoch-bounded"` |
| `request.kind` | `"sui-transaction"` |
| `request.pureInput` | `Uint8Array` |

#### Methods

##### complete()

> **complete**(`signed`): [`Refusal`](index.md#refusal) \| [`SuiPaymentPayload`](#suipaymentpayload)

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | [`SuiPayload`](#suipayload) |

###### Returns

[`Refusal`](index.md#refusal) \| [`SuiPaymentPayload`](#suipaymentpayload)

## Type Aliases

### SuiNetwork

> **SuiNetwork** = `"sui:mainnet"` \| `"sui:testnet"` \| `"sui:devnet"`

***

### SuiStatus

> **SuiStatus** = \{ `checkpoint`: `bigint` \| `null`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"aborted"` \| `"expired"` \| `"not-this-instrument"`; \}

## Variables

### exactSui

> `const` **exactSui**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiUnsigned`](#suiunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/sui"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SuiRef`](#suiref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`SuiStatus`](#suistatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### decodeSuiTx()

> **decodeSuiTx**(`base64`): [`Refusal`](index.md#refusal) \| [`SuiTx`](#suitx)

Decodes a base64 `TransactionData` V1 with a programmable kind.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `base64` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SuiTx`](#suitx)

***

### suiCarrier()

> **suiCarrier**(`tx`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

The hash carried by exactly one unused `Pure` input of exactly 32 bytes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SuiTx`](#suitx) |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### suiOptionCheck()

> **suiOptionCheck**(`option`): [`Refusal`](index.md#refusal) \| `undefined`

The pairing's filter: undefined for an option this pairing can pay, or the refusal naming why not.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | `unknown` |

#### Returns

[`Refusal`](index.md#refusal) \| `undefined`

***

### suiPairingOf()

> **suiPairingOf**(`option`): `"x402/exact/sui"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/sui"` \| `undefined`

***

### suiRecover()

> **suiRecover**(`ref`, `reader`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

Reads the hash back from the executed transaction alone, by its digest. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `digest`: `string`; `network`: [`SuiNetwork`](#suinetwork); \} |
| `ref.digest` | `string` |
| `ref.network` | [`SuiNetwork`](#suinetwork) |
| `reader` | [`SuiReader`](#suireader) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### suiStatus()

> **suiStatus**(`ref`, `reader`): `Promise`\<[`SuiStatus`](#suistatus)\>

Reads the recorded digest. A failed read, or a reader for another network, is pending. An absent transaction is
expired once the latest epoch is past its bound; a present one must be these bytes carrying this hash, and its
effects' status decides. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SuiRef`](#suiref) & `object` |
| `reader` | [`SuiReader`](#suireader) |

#### Returns

`Promise`\<[`SuiStatus`](#suistatus)\>
