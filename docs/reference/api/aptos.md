---
title: "@integraledger/lcp/aptos"
description: "The exports of @integraledger/lcp/aptos."
---

# @integraledger/lcp/aptos

## Interfaces

### AptosCommitted

A committed user transaction as the REST API returns it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-expiration_timestamp_secs"></a> `expiration_timestamp_secs` | `string` |
| <a id="property-hash"></a> `hash` | `string` |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.arguments` | `unknown`[] |
| `payload.function` | `string` |
| `payload.type` | `string` |
| `payload.type_arguments` | `string`[] |
| <a id="property-sender"></a> `sender` | `string` |
| <a id="property-sequence_number"></a> `sequence_number` | `string` |
| <a id="property-success"></a> `success` | `boolean` |
| <a id="property-type"></a> `type` | `"user_transaction"` |
| <a id="property-version"></a> `version` | `string` |

***

### AptosInstrument

The transfer the payer signed, in one normal form shared by the signed bytes and the chain's REST answer.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-arguments"></a> `arguments` | readonly `string`[] |
| <a id="property-chainid"></a> `chainId` | `number` |
| <a id="property-expiresat"></a> `expiresAt` | `bigint` |
| <a id="property-function"></a> `function` | `string` |
| <a id="property-sender-1"></a> `sender` | `` `0x${string}` `` |
| <a id="property-sequencenumber"></a> `sequenceNumber` | `bigint` |
| <a id="property-typearguments"></a> `typeArguments` | readonly `string`[] |

***

### AptosReader

Bounded, read-only calls against one network's REST endpoint. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `aptos:${number}` `` |

#### Methods

##### byHash()

> **byHash**(`hash`): `Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `type`: `"pending_transaction"`; \} \| `null`\>

`GET /v1/transactions/by_hash/{hash}`; null on 404.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `type`: `"pending_transaction"`; \} \| `null`\>

##### bySequence()

> **bySequence**(`sender`, `n`): `Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `notFound`: `true`; `timestampUsecs`: `bigint`; \}\>

`GET /v1/accounts/{sender}/transactions?start=n&limit=1`, kept only when its `sequence_number` is n. When there is
none, `notFound` with `timestampUsecs`: the ledger timestamp of that answer, its `X-Aptos-Ledger-TimestampUsec`
header.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `sender` | `` `0x${string}` `` |
| `n` | `bigint` |

###### Returns

`Promise`\<[`AptosCommitted`](#aptoscommitted) \| \{ `notFound`: `true`; `timestampUsecs`: `bigint`; \}\>

##### ledger()

> **ledger**(): `Promise`\<\{ `chainId`: `number`; `timestampUsecs`: `bigint`; \}\>

`GET /v1`.

###### Returns

`Promise`\<\{ `chainId`: `number`; `timestampUsecs`: `bigint`; \}\>

***

### AptosRef

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-expiresat-1"></a> `expiresAt` | `string` | - |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` | - |
| <a id="property-network-1"></a> `network` | `` `aptos:${number}` `` | - |
| <a id="property-sender-2"></a> `sender` | `` `0x${string}` `` | - |
| <a id="property-sequencenumber-1"></a> `sequenceNumber` | `string` | Decimal strings. |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` | The facilitator's transaction hash, once named. |

***

### AptosUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| `request.kind` | `"aptos-transaction"` |

#### Methods

##### complete()

> **complete**(`signed`): [`Refusal`](index.md#refusal) \| `AptosPaymentPayload`

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signed` | \{ `transaction`: `string`; \} |
| `signed.transaction` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| `AptosPaymentPayload`

## Type Aliases

### AptosNetwork

> **AptosNetwork** = `` `aptos:${number}` ``

CAIP-2: `aptos:` and the numeric chain id.

***

### AptosStatus

> **AptosStatus** = \{ `state`: `"settled"`; `transaction`: [`Hex`](evm.md#hex); `version`: `bigint`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"in-mempool"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"aborted"` \| `"superseded"` \| `"expired"`; \}

## Variables

### exactAptos

> `const` **exactAptos**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `build`: (`choice`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AptosUnsigned`](#aptosunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/aptos"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`AptosRef`](#aptosref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`AptosStatus`](#aptosstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### aptosIdDigest()

> **aptosIdDigest**(`i`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

SHA-256 over the RFC 8785 form of `{sender, sequenceNumber, function, typeArguments, arguments}`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`AptosInstrument`](#aptosinstrument) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### aptosStatus()

> **aptosStatus**(`ref`, `reader`): `Promise`\<[`AptosStatus`](#aptosstatus)\>

Finds the payer's transaction by the facilitator's hash when named, else by sender and sequence number, and
identifies it by the transfer's digest and its expiry: a committed transaction at that sequence number with another
transfer or another expiry is failed `superseded`. Only `success` decides a committed, matching transaction. The
ledger is read first: failed `expired` only when its timestamp is past `expiresAt` and the lookup by sequence number
finds nothing at a ledger timestamp at or past that ledger's; a lookup computed at an earlier ledger, or naming none,
is pending `not-found`. A failed read, or a reader for another network, is pending. At most three calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`AptosRef`](#aptosref) |
| `reader` | [`AptosReader`](#aptosreader) |

#### Returns

`Promise`\<[`AptosStatus`](#aptosstatus)\>

***

### committedInstrument()

> **committedInstrument**(`t`, `chainId`): [`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)

The REST answer in the normal form: every address as `0x` and 64 lowercase hex, `{"inner": a}` as `a`, and the
amount as its decimal string. The REST answer carries no chain id, so the caller supplies the ledger's.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `t` | [`AptosCommitted`](#aptoscommitted) |
| `chainId` | `number` |

#### Returns

[`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)

***

### decodeAptosTx()

> **decodeAptosTx**(`transaction`): [`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)

Reads the `RawTransaction` prefix of a base64 transaction, in either wire form: the scheme's BCS bytes, or x402's
reference form, base64 of the JSON `{"transaction": [bytes], "senderAuthenticator": [bytes]}`. Only an entry
function call to a framework fungible-asset transfer is accepted. Module, function and struct names are read as
their exact bytes, a leading U+FEFF included, and each must be an ASCII letter or underscore followed by up to 254
ASCII letters, digits and underscores, else `aptos/tx-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `transaction` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`AptosInstrument`](#aptosinstrument)
