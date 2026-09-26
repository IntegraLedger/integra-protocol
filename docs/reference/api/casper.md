---
title: "@integraledger/lcp/casper"
description: "The exports of @integraledger/lcp/casper."
---

# @integraledger/lcp/casper

## Interfaces

### CasperCall

One executed contract call, as the reader reports it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-args"></a> `args` | `object` |
| `args.from?` | `string` |
| `args.nonce?` | `Uint8Array`\<`ArrayBufferLike`\> |
| `args.to?` | `string` |
| `args.value?` | `bigint` |
| <a id="property-blockheight"></a> `blockHeight` | `bigint` \| `null` |
| <a id="property-entrypoint"></a> `entryPoint` | `string` \| `null` |
| <a id="property-error"></a> `error` | `string` \| `null` |
| <a id="property-executed"></a> `executed` | `boolean` |
| <a id="property-packagehash"></a> `packageHash` | `string` \| `null` |

***

### CasperChoice

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-from"></a> `from` | `string` |
| <a id="property-now"></a> `now` | `number` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |

***

### CasperReader

Bounded, read-only calls against one network's node. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `casper:${string}` `` |

#### Methods

##### transaction()

> **transaction**(`hash`): `Promise`\<[`CasperCall`](#caspercall) \| `null`\>

`info_get_transaction`, as a `Version1` transaction and then as a `Deploy`; null when the node knows neither.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `hash` | `string` |

###### Returns

`Promise`\<[`CasperCall`](#caspercall) \| `null`\>

***

### CasperRef

The read keys recorded at claim.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset"></a> `asset` | `string` |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` |
| <a id="property-network-1"></a> `network` | `` `casper:${string}` `` |
| <a id="property-settleby"></a> `settleBy` | `number` |
| <a id="property-transaction"></a> `transaction?` | `string` |

***

### CasperUnsigned

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.kind` | `"casper-eip712"` |
| `request.typedData` | [`Cep3009TypedData`](#cep3009typeddata) |

#### Methods

##### complete()

> **complete**(`publicKey`, `signature`): [`Refusal`](index.md#refusal) \| [`CasperPaymentPayload`](#casperpaymentpayload)

Both arguments are hex with a one-byte algorithm tag: `01` ed25519, `02` secp256k1.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `publicKey` | `string` |
| `signature` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| [`CasperPaymentPayload`](#casperpaymentpayload)

***

### Cep3009TypedData

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-domain"></a> `domain` | `object` | - |
| `domain.chain_name` | `` `casper:${string}` `` | - |
| `domain.contract_package_hash` | `string` | - |
| `domain.name` | `string` | - |
| `domain.version` | `string` | - |
| <a id="property-message"></a> `message` | `object` | - |
| `message.from` | `string` | - |
| `message.nonce` | `string` | 64 hex digits, no prefix. |
| `message.to` | `string` | - |
| `message.validAfter` | `bigint` | - |
| `message.validBefore` | `bigint` | - |
| `message.value` | `bigint` | - |
| <a id="property-primarytype"></a> `primaryType` | `"TransferWithAuthorization"` | - |
| <a id="property-types"></a> `types` | `object` | - |
| `types.EIP712Domain` | [`Field`](evm.md#field)[] | - |
| `types.TransferWithAuthorization` | [`Field`](evm.md#field)[] | - |

## Type Aliases

### CasperAddress

> **CasperAddress** = `string`

66 hex digits, no prefix: tag `00` (account hash) or `01` (package hash), then 32 bytes.

***

### CasperAuthorization

> **CasperAuthorization** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-from-1"></a> `from` | `string` |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-to"></a> `to` | `string` |
| <a id="property-validafter"></a> `validAfter` | `string` |
| <a id="property-validbefore"></a> `validBefore` | `string` |
| <a id="property-value"></a> `value` | `string` |

***

### CasperNetwork

> **CasperNetwork** = `` `casper:${string}` ``

CAIP-2: `casper:` and the chainspec name.

***

### CasperPaymentPayload

> **CasperPaymentPayload** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted-1"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"extensions"`\] |
| <a id="property-payload"></a> `payload` | `object` |
| `payload.authorization` | [`CasperAuthorization`](#casperauthorization) |
| `payload.publicKey` | `string` |
| `payload.signature` | `string` |
| <a id="property-resource"></a> `resource?` | [`PaymentRequired`](x402.md#paymentrequired)\[`"resource"`\] |
| <a id="property-x402version"></a> `x402Version` | `2` |

***

### CasperStatus

> **CasperStatus** = \{ `blockHeight`: `bigint`; `finality`: `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"not-executed"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"reverted"` \| `"not-this-instrument"`; \}

***

### PackageHash

> **PackageHash** = `string`

64 hex digits, no prefix.

## Variables

### CASPER\_DOMAIN\_TYPEHASH

> `const` **CASPER\_DOMAIN\_TYPEHASH**: `"0xe20dd13933eeb9d6099b53d5ffd59cfd50fe774983038681a378371664fad4fb"`

keccak256("EIP712Domain(string name,string version,string chain_name,bytes32 contract_package_hash)")

***

### exactCasper

> `const` **exactCasper**: `Readonly`\<\{ `advertise`: [`X402Advertise`](x402.md#x402advertise); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CasperUnsigned`](#casperunsigned)\>; `claims`: `boolean`; `id`: `"x402/exact/casper"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CasperRef`](#casperref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`CasperStatus`](#casperstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

## Functions

### casperIdDigest()

> **casperIdDigest**(`from`, `to`, `value`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

SHA-256 over the 33 + 33 bytes of the two addresses and the value as a 32-byte big-endian integer.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `from` | `string` |
| `to` | `string` |
| `value` | `bigint` |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### casperOption()

> **casperOption**(`o`): `o is PaymentRequirements`

The pairing's filter: an `exact` option on a `casper:` network that `build` can turn into typed data.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `o` | `unknown` |

#### Returns

`o is PaymentRequirements`

***

### casperRecover()

> **casperRecover**(`ref`, `reader`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

The hash from a settlement transaction alone: the `nonce` argument of the executed authorization call on `asset`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `asset`: `string`; `network`: `` `casper:${string}` ``; `transaction`: `string`; \} |
| `ref.asset` | `string` |
| `ref.network` | `` `casper:${string}` `` |
| `ref.transaction` | `string` |
| `reader` | [`CasperReader`](#casperreader) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### casperStatus()

> **casperStatus**(`ref`, `reader`): `Promise`\<[`CasperStatus`](#casperstatus)\>

Reads the named transaction. Settled, at the height of its block, when it executed without error as a call to
`ref.asset`'s `transfer_with_authorization` or `receive_with_authorization` whose `nonce` argument is `h` and whose
`from`, `to` and `value` hash to `ref.idDigest`. A failed read, or a reader for another network, is pending.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`CasperRef`](#casperref) & `object` |
| `reader` | [`CasperReader`](#casperreader) |

#### Returns

`Promise`\<[`CasperStatus`](#casperstatus)\>

***

### cep3009TypedData()

> **cep3009TypedData**(`a`): [`Refusal`](index.md#refusal) \| [`Cep3009TypedData`](#cep3009typeddata)

The CEP-3009 typed data for `TransferWithAuthorization`, with `validAfter` 0 and the hash as the nonce.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | \{ `asset`: `string`; `from`: `string`; `name`: `string`; `network`: `` `casper:${string}` ``; `nonce`: `` `0x${string}` ``; `to`: `string`; `validBefore`: `bigint`; `value`: `string`; `version`: `string`; \} |
| `a.asset` | `string` |
| `a.from` | `string` |
| `a.name` | `string` |
| `a.network` | `` `casper:${string}` `` |
| `a.nonce` | `` `0x${string}` `` |
| `a.to` | `string` |
| `a.validBefore` | `bigint` |
| `a.value` | `string` |
| `a.version` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| [`Cep3009TypedData`](#cep3009typeddata)
