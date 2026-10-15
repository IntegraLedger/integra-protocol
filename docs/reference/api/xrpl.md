---
title: "@integraledger/lcp/xrpl"
description: "The exports of @integraledger/lcp/xrpl."
---

# @integraledger/lcp/xrpl

## Interfaces

### XrplLanded

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-deletedchannels"></a> `deletedChannels?` | readonly `string`[] | The `PayChannel` `DeletedNode`s of the transaction's `meta`. |
| <a id="property-invoiceid"></a> `invoiceId?` | `string` | - |
| <a id="property-ledgerindex"></a> `ledgerIndex?` | `number` | - |
| <a id="property-result"></a> `result` | `string` | `meta.TransactionResult`. |
| <a id="property-transactiontype"></a> `transactionType` | `string` | - |
| <a id="property-validated"></a> `validated` | `boolean` | - |

***

### XrplReader

Bounded, read-only calls against one network's endpoint. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `xrpl:${number}` `` |

#### Methods

##### tx()

> **tx**(`hash`, `range`): `Promise`\<[`XrplLanded`](#xrpllanded) \| \{ `notFound`: `true`; `searchedAll`: `boolean`; \}\>

`tx` by hash, with `min_ledger` and `max_ledger` when a range is given.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |
| `range` | \{ `max`: `number`; `min`: `number`; \} \| `null` |

###### Returns

`Promise`\<[`XrplLanded`](#xrpllanded) \| \{ `notFound`: `true`; `searchedAll`: `boolean`; \}\>

##### txBlob()

> **txBlob**(`hash`): `Promise`\<`string` \| `null`\>

`tx` with `binary: true`: the signed blob, for credentials that name only a hash.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |

###### Returns

`Promise`\<`string` \| `null`\>

##### validatedLedger()

> **validatedLedger**(): `Promise`\<`number`\>

`ledger` `validated` → `ledger_index`.

###### Returns

`Promise`\<`number`\>

***

### XrplRef

The read keys `reference` returns, with `fromLedger`, the ledger index the transaction search starts from.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-expect"></a> `expect` | `string` |
| <a id="property-fromledger"></a> `fromLedger` | `number` |
| <a id="property-lastledgersequence"></a> `lastLedgerSequence` | `number` \| `null` |
| <a id="property-network-1"></a> `network` | `` `xrpl:${number}` `` |
| <a id="property-transaction"></a> `transaction` | `string` |

***

### XrplTxJson

#### Indexable

> \[`field`: `string`\]: `unknown`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-account"></a> `Account` | `string` |
| <a id="property-invoiceid-1"></a> `InvoiceID?` | `string` |
| <a id="property-lastledgersequence-1"></a> `LastLedgerSequence?` | `number` |
| <a id="property-memos"></a> `Memos?` | `unknown` |
| <a id="property-transactiontype-1"></a> `TransactionType` | `string` |

***

### XrplUnsigned

What the wallet signs, and how its signed blob completes the payment.

#### Type Parameters

| Type Parameter |
| ------ |
| `P` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.kind` | `"xrpl-tx"` |
| `request.txJson` | [`XrplTxJson`](#xrpltxjson) |

#### Methods

##### complete()

> **complete**(`signedBlob`): [`Refusal`](index.md#refusal) \| `P`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedBlob` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| `P`

## Type Aliases

### XrplCloseRef

> **XrplCloseRef** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel"></a> `channel` | `string` |
| <a id="property-network-2"></a> `network` | [`XrplNetwork`](#xrplnetwork) |
| <a id="property-phase"></a> `phase` | `"close"` |
| <a id="property-transaction-1"></a> `transaction` | `string` |

***

### XrplCloseStatus

> **XrplCloseStatus** = \{ `ledgerIndex`: `number`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"not-validated"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"not-a-close"`; \}

***

### XrplNetwork

> **XrplNetwork** = `` `xrpl:${number}` ``

CAIP-2: `xrpl:` and the chain's NetworkID, 0 to 4294967295.

***

### XrplStatus

> **XrplStatus** = \{ `ledgerIndex`: `number`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"not-validated"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"expired"` \| `"claimed-fee"` \| `"not-this-instrument"`; \}

## Variables

### XRPL\_MAX\_DEPTH

> `const` **XRPL\_MAX\_DEPTH**: `10` = `10`

The deepest level a field of a transaction sits at, rippled's limit: its deserializer refuses a field whose depth is
above 10 (rippled 3.4.1, `src/libxrpl/protocol/STVar.cpp`, the `STVar` constructor that reads a `SerialIter`). A
top-level field is at level 1, each field inside an STObject or STArray field one level below that field, and an
array's member object one level below the array. An end marker sits at no level, so an object or array at this
level holds no field.

## Functions

### decodeBlob()

> **decodeBlob**(`hex`): `Promise`\<[`Refusal`](index.md#refusal) \| \{ `hash`: `string`; `tx`: [`XrplTxJson`](#xrpltxjson); \}\>

Decodes a signed blob of at most 4096 hex characters (2048 bytes), and computes its transaction hash as the ledger
does: SHA-512Half over `54584E00` and the blob, in upper case. Before the codec decodes it, a single pass over its
fields refuses a blob with a field deeper than `XRPL_MAX_DEPTH`, as rippled refuses it. The blob must be the
canonical serialization of what it decodes to: the codec's encoding of the decoded fields gives back the same bytes,
so nothing follows a top-level end marker and every array member is an object.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `hex` | `string` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| \{ `hash`: `string`; `tx`: [`XrplTxJson`](#xrpltxjson); \}\>

***

### mppInvoiceId()

> **mppInvoiceId**(`h`): `string`

The hash's 64 hex digits in upper case, without `0x`: MPP's `methodDetails.invoiceId`. Throws TypeError when `h` is
not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`string`

***

### x402InvoiceId()

> **x402InvoiceId**(`h`): `Promise`\<`string`\>

Uppercase hex of SHA-256 over the UTF-8 bytes of the hash's LCP string: x402's `InvoiceID` for `extra.invoiceId`.
Rejects with a TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`Promise`\<`string`\>

***

### xrplChannelId()

> **xrplChannelId**(`account`, `destination`, `sequence`): `string` \| [`Refusal`](index.md#refusal)

The PayChannel id: SHA-512Half of `0x0078` ‖ the source's AccountID ‖ the destination's AccountID ‖ the creating
transaction's sequence (or ticket sequence), big-endian; upper-case hex. An address that is not a classic address,
or a sequence that is not a UInt32, is `mpp/input-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `destination` | `string` |
| `sequence` | `number` |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### xrplClaim()

> **xrplClaim**(`channelId`, `drops`): `Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

The bytes a channel claim signs: `CLM\0` ‖ channel id (32 bytes) ‖ drops as u64 big-endian. A channel id that is not
64 hex digits, or drops that are not a `bigint` UInt64, is `mpp/input-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channelId` | `string` |
| `drops` | `bigint` |

#### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

***

### xrplOpenStatus()

> **xrplOpenStatus**(`ref`, `reader`): `Promise`\<[`XrplStatus`](#xrplstatus)\>

Reads an opening by the hash computed from its signed blob: settled only when a validated ledger holds it with
`tesSUCCESS` as a `PaymentChannelCreate`; `tec` codes are final failures that claimed the fee; past
`LastLedgerSequence` with the whole range searched it expired. A failed read is pending. A ref whose `transaction` is
not 64 hex digits is pending `unreadable`, with nothing read; the transaction is looked up in upper case. At most two
calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | `Omit`\<[`XrplRef`](#xrplref), `"expect"`\> |
| `reader` | [`XrplReader`](#xrplreader) |

#### Returns

`Promise`\<[`XrplStatus`](#xrplstatus)\>

***

### xrplStatus()

> **xrplStatus**(`ref`, `reader`): `Promise`\<[`XrplStatus`](#xrplstatus)\>

Reads a transaction by the hash computed from its signed blob. Settled only when a validated ledger holds it with
`tesSUCCESS` as a Payment whose `InvoiceID` is the one expected; `tec` codes are final failures that claimed the fee;
past `LastLedgerSequence` with the whole range searched it expired. A failed read is pending. A ref whose
`transaction` or `expect` is not 64 hex digits is pending `unreadable`, with nothing read; the transaction is looked
up in upper case, and invoice ids compare in either case. At most two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`XrplRef`](#xrplref) |
| `reader` | [`XrplReader`](#xrplreader) |

#### Returns

`Promise`\<[`XrplStatus`](#xrplstatus)\>
