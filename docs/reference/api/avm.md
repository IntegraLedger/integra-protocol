---
title: "@integraledger/lcp/avm"
description: "The exports of @integraledger/lcp/avm."
---

# @integraledger/lcp/avm

## Interfaces

### AvmParams

The buyer's read of algod `GET /v2/transactions/params`. `genesisHash` is its base64.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-feeperbyte"></a> `feePerByte` | `bigint` |
| <a id="property-firstvalid"></a> `firstValid` | `bigint` |
| <a id="property-genesishash"></a> `genesisHash` | `string` |
| <a id="property-genesisid"></a> `genesisId` | `string` |
| <a id="property-minfee"></a> `minFee` | `bigint` |

***

### AvmPresented

The x402 payload on Algorand.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-paymentgroup"></a> `paymentGroup` | readonly `string`[] |
| <a id="property-paymentindex"></a> `paymentIndex` | `number` |

***

### AvmReader

Bounded, read-only calls against one network's Indexer. Every failure rejects.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `algorand:${string}` `` |

#### Methods

##### search()

> **search**(`txid`): `Promise`\<\{ `currentRound`: `bigint`; `found`: \{ `confirmedRound`: `bigint`; `note`: `Uint8Array`; \} \| `null`; \}\>

`GET /v2/transactions?txid=…`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txid` | `string` |

###### Returns

`Promise`\<\{ `currentRound`: `bigint`; `found`: \{ `confirmedRound`: `bigint`; `note`: `Uint8Array`; \} \| `null`; \}\>

***

### AvmRef

The read keys recorded at claim, computed from the signed bytes. `lastValid` is a decimal string, so the issuer stores the
reference as JSON.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-lastvalid"></a> `lastValid` | `string` |
| <a id="property-network-1"></a> `network` | `` `algorand:${string}` `` |
| <a id="property-txid"></a> `txid` | `string` |

***

### AvmUnsigned

The bytes the payer signs, and how the signature completes the payment.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | "TX" ‖ msgpack(txn) |
| `request.bytes` | `Uint8Array` | - |
| `request.kind` | `"algorand-txn"` | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`AvmPaymentPayload`](#avmpaymentpayload)

A 64-byte Ed25519 signature.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| [`AvmPaymentPayload`](#avmpaymentpayload)

## Type Aliases

### AlgorandNetwork

> **AlgorandNetwork** = `` `algorand:${string}` ``

CAIP-2: the first 32 characters of the URL-safe base64 genesis hash.

***

### AvmPaymentPayload

> **AvmPaymentPayload** = [`X402Payment`](x402.md#x402payment)\<[`AvmPresented`](#avmpresented)\>

***

### AvmStatus

> **AvmStatus** = \{ `finality`: `"final"`; `round`: `bigint`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"expired"`; \}

## Variables

### exactAvm

> `const` **exactAvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AvmUnsigned`](#avmunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/algorand"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AvmRef`](#avmref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`AvmStatus`](#avmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### MSGPACK\_MAX\_DEPTH

> `const` **MSGPACK\_MAX\_DEPTH**: `32` = `32`

The deepest nesting of msgpack arrays and maps in a signed transaction, the outermost container being level 1. An
Algorand signed transaction nests three (the signed transaction, its transaction, and a map or array inside that).

## Functions

### avmCarrier()

> **avmCarrier**(`p`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `lastValid`: `bigint`; `txid`: `string`; \}

The payment transaction of an x402 Algorand payload: `paymentGroup[paymentIndex]`, decoded as a signed asset
transfer whose note is an LCP string. Gives the hash, the transaction id and the last valid round.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `p` | [`AvmPresented`](#avmpresented) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `lastValid`: `bigint`; `txid`: `string`; \}

***

### avmPairingOf()

> **avmPairingOf**(`o`): `"x402/exact/algorand"` \| `undefined`

The pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/algorand"` \| `undefined`

***

### avmRecover()

> **avmRecover**(`ref`, `reader`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

The hash from the landed payment's note, for anyone holding the transaction id. One call.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: `` `algorand:${string}` ``; `txid`: `string`; \} |
| `ref.network` | `` `algorand:${string}` `` |
| `ref.txid` | `string` |
| `reader` | [`AvmReader`](#avmreader) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### avmStatus()

> **avmStatus**(`ref`, `reader`): `Promise`\<[`AvmStatus`](#avmstatus)\>

Reads the payment by its id. Found is settled and final; absent after the last valid round is expired; otherwise
pending. A failed read, or a reader for another network, is pending.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`AvmRef`](#avmref) |
| `reader` | [`AvmReader`](#avmreader) |

#### Returns

`Promise`\<[`AvmStatus`](#avmstatus)\>

***

### msgpackWithinCaps()

> **msgpackWithinCaps**(`b`): `boolean`

True when `b` is exactly one msgpack value (the msgpack specification's formats) whose arrays and maps nest at most
`MSGPACK_MAX_DEPTH` deep, and whose every declared length (a string's, binary's or extension's bytes, an array's
elements, a map's keys and values) is no more than the bytes that remain, so no count is trusted past the input.
The value is scanned, never built.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `b` | `Uint8Array` |

#### Returns

`boolean`
