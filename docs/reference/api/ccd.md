---
title: "@integraledger/lcp/ccd"
description: "The exports of @integraledger/lcp/ccd."
---

# @integraledger/lcp/ccd

## Interfaces

### CcdChoice

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-now"></a> `now` | `number` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |

***

### CcdReader

Bounded, read-only calls against one network's node. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `ccd:${string}` `` |

#### Methods

##### item()

> **item**(`hash`): `Promise`\<[`CcdItem`](#ccditem) \| `null`\>

gRPC v2 `GetBlockItemStatus`; null when the node does not know the item.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |

###### Returns

`Promise`\<[`CcdItem`](#ccditem) \| `null`\>

***

### CcdRef

The read keys recorded at claim.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset"></a> `asset` | `string` |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` |
| <a id="property-network-1"></a> `network` | `` `ccd:${string}` `` |
| <a id="property-settleby"></a> `settleBy` | `number` |
| <a id="property-transaction"></a> `transaction?` | `string` |

***

### CcdTransfer

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` |
| <a id="property-kind"></a> `kind` | `"ccd"` \| `"plt"` |
| <a id="property-memo"></a> `memo` | `Uint8Array`\<`ArrayBufferLike`\> \| `null` |
| <a id="property-receiver"></a> `receiver` | `Uint8Array` |
| <a id="property-tokenid"></a> `tokenId?` | `string` |

***

### CcdUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.amount` | `string` |
| `request.asset` | `string` |
| `request.expiresBy` | `number` |
| `request.kind` | `"ccd-transfer"` |
| `request.memo` | `Uint8Array` |
| `request.network` | `` `ccd:${string}` `` |
| `request.sponsor` | `string` |
| `request.toAddress` | `string` |

#### Methods

##### complete()

> **complete**(`signedTransaction`): [`Refusal`](index.md#refusal) \| [`CcdPaymentPayload`](#ccdpaymentpayload)

Takes the sender-signed V1 sponsored transaction in x402's wire form: with `@concordium/web-sdk`,
`JSON.parse(Transaction.toJSONString(tx))`. A value that is not a JSON object is `ccd/transaction-malformed`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedTransaction` | [`Json`](index.md#json) |

###### Returns

[`Refusal`](index.md#refusal) \| [`CcdPaymentPayload`](#ccdpaymentpayload)

## Type Aliases

### CcdItem

> **CcdItem** = \{ `state`: `"received"`; \} \| \{ `state`: `"committed"`; \} \| \{ `sender`: `Uint8Array` \| `null`; `state`: `"finalized"`; `success`: `boolean`; `transfers`: readonly [`CcdTransfer`](#ccdtransfer)[]; \}

***

### CcdNetwork

> **CcdNetwork** = `` `ccd:${string}` ``

CAIP-2: `ccd:` and the first 32 lowercase hex digits of the genesis block hash.

***

### CcdPaymentPayload

> **CcdPaymentPayload** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"extensions"`\] |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.signedTransaction` | `object` |
| <a id="property-resource"></a> `resource?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"resource"`\] |
| <a id="property-x402version"></a> `x402Version` | `2` |

***

### CcdStatus

> **CcdStatus** = \{ `finality`: `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"received"` \| `"committed"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"rejected"` \| `"not-this-instrument"`; \}

## Variables

### exactCcd

> `const` **exactCcd**: `Readonly`\<\{ `advertise`: [`X402Advertise`](x402.md#x402advertise); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CcdUnsigned`](#ccdunsigned)\>; `claims`: `boolean`; `id`: `"x402/exact/ccd"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CcdRef`](#ccdref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`CcdStatus`](#ccdstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### accountBytes()

> **accountBytes**(`address`): `Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

The 32 bytes of a base58check account address whose version byte is 1: its last four bytes are the first four of
the double SHA-256 of the 33 before them.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

#### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

***

### ccdIdDigest()

> **ccdIdDigest**(`sender`, `receiver`, `amount`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

SHA-256 over the 32 + 32 bytes of the two accounts and the amount as a 32-byte big-endian integer.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sender` | `Uint8Array` |
| `receiver` | `Uint8Array` |
| `amount` | `bigint` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### ccdMemo()

> **ccdMemo**(`h`): `Uint8Array`

The CBOR text string of `toLcpString(h)`: `78 4d` and the 77 ASCII bytes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`

***

### ccdOption()

> **ccdOption**(`o`): `o is PaymentRequirements`

The pairing's filter: an `exact` option on a `ccd:` network, for CCD or a token symbol, whose `payTo` and
`extra.feePayer` are base58check account addresses.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | `unknown` |

#### Returns

`o is PaymentRequirements`

***

### ccdRecover()

> **ccdRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The hash from a settlement block item alone: its one memo-carrying transfer's memo, through `memoCarrier`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: `` `ccd:${string}` ``; `transaction`: `string`; \} |
| `ref.network` | `` `ccd:${string}` `` |
| `ref.transaction` | `string` |
| `reader` | [`CcdReader`](#ccdreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### ccdStatus()

> **ccdStatus**(`ref`, `reader`): `Promise`\<[`CcdStatus`](#ccdstatus)\>

Reads the named block item. Settled when it is finalized and successful, with exactly one transfer whose memo
`memoCarrier` reads as `ref.h` (a PLT memo with tag 24 unwrapped) and whose sender, receiver and amount hash to
`ref.idDigest`. Not final, unknown or unreadable is pending; a reader for another network is pending.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`CcdRef`](#ccdref) & `object` |
| `reader` | [`CcdReader`](#ccdreader) |

#### Returns

`Promise`\<[`CcdStatus`](#ccdstatus)\>

***

### memoCarrier()

> **memoCarrier**(`memo`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The hash a memo carries: exactly one CBOR text string, nothing after it, whose bytes are `ccdMemo` of the hash it
names (LCP's string form with lowercase hex, under the preferred two-byte head). `bound`, `status` and `recover` all
read a memo through this one function.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `memo` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### pltMemo()

> **pltMemo**(`h`): `Uint8Array`

CBOR tag 24 around a byte string holding `ccdMemo(h)`: `d8 18 58 4f` and the 79 bytes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`
