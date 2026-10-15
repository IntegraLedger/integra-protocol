---
title: "@integraledger/lcp/ccd"
description: "The exports of @integraledger/lcp/ccd."
---

# @integraledger/lcp/ccd

## Interfaces

### CcdReader

Bounded, read-only calls against one network's node. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable.

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

The read keys `reference` returns.

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
| `request.memo` | `Uint8Array`\<`ArrayBuffer`\> |
| `request.network` | `` `ccd:${string}` `` |
| `request.sponsor` | `string` |
| `request.toAddress` | `string` |

#### Methods

##### complete()

> **complete**(`signedTransaction`): [`Refusal`](index.md#refusal) \| `CcdPaymentPayload`

Takes the sender-signed V1 sponsored transaction in x402's wire form: with `@concordium/web-sdk`,
`JSON.parse(Transaction.toJSONString(tx))`. A value that is not a JSON object is `ccd/transaction-malformed`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedTransaction` | `unknown` |

###### Returns

[`Refusal`](index.md#refusal) \| `CcdPaymentPayload`

## Type Aliases

### CcdItem

> **CcdItem** = \{ `state`: `"received"`; \} \| \{ `state`: `"committed"`; \} \| \{ `sender`: `Uint8Array` \| `null`; `state`: `"finalized"`; `success`: `boolean`; `transfers`: readonly [`CcdTransfer`](#ccdtransfer)[]; \}

***

### CcdNetwork

> **CcdNetwork** = `` `ccd:${string}` ``

CAIP-2: `ccd:` and the first 32 lowercase hex digits of the genesis block hash.

***

### CcdStatus

> **CcdStatus** = \{ `finality`: `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"received"` \| `"committed"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"rejected"` \| `"not-this-instrument"`; \}

## Variables

### exactCcd

> `const` **exactCcd**: `Readonly`\<\{ `advertise`: `X402Advertise`; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CcdUnsigned`](#ccdunsigned)\>; `claims`: `boolean`; `id`: `"x402/exact/ccd"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`ref`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CcdRef`](#ccdref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`CcdStatus`](#ccdstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/ccd`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the sponsor,
signs and submits the sponsored transaction the payer signed; `status` reads the finalized transfer.

## Functions

### accountBytes()

> **accountBytes**(`address`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

The 32 bytes of a base58check account address whose version byte is 1: its last four bytes are the first four of
the double SHA-256 of the 33 before them.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

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

> **ccdMemo**(`h`): `Uint8Array`\<`ArrayBuffer`\>

The CBOR text string of `toLcpString(h)`: `78 4d` and the 77 ASCII bytes. Throws TypeError when `h` is not a 32-byte
hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

***

### ccdRecover()

> **ccdRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The hash from a settlement block item alone, when it is finalized and successful: the memo of its one transfer whose
memo `memoCarrier` reads (a PLT memo with tag 24 unwrapped), as `status` counts the transfers whose memo carries
`ref.h`. A transfer without a memo, or whose memo `memoCarrier` refuses, is passed over; no such transfer, or more
than one, is `ccd/no-carrier`. A ref whose `transaction` is not 64 hex digits is `ccd/wrong-reader`, with nothing
read.

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
`ref.idDigest`. Not final, unknown or unreadable is pending; a reader for another network is pending. A ref whose `h`
or `idDigest` is not `0x` and 64 hex digits is pending `unreadable`, with nothing read; hashes compare in either case.
`ref.asset` is not read, and the transfer's kind (which decides only whether a PLT memo's tag 24 is unwrapped) and
token id are compared with nothing: a transfer of another token, or of CCD, with the same sender, receiver, amount
and memo reads as settled.

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

> **pltMemo**(`h`): `Uint8Array`\<`ArrayBuffer`\>

CBOR tag 24 around a byte string holding `ccdMemo(h)`: `d8 18 58 4f` and the 79 bytes. Throws as `ccdMemo` does.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
