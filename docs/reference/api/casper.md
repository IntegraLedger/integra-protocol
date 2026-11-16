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

### CasperReader

Bounded, read-only calls against one network's node. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`; any rejection reads as unreadable.

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

The read keys `reference` returns.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asset"></a> `asset` | `string` | - |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` | - |
| <a id="property-network-1"></a> `network` | `` `casper:${string}` `` | - |
| <a id="property-payee"></a> `payee` | `string` | The option's `payTo`. |
| <a id="property-settleby"></a> `settleBy` | `number` | - |
| <a id="property-transaction"></a> `transaction?` | `string` | - |

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

> **complete**(`publicKey`, `signature`): [`Refusal`](index.md#refusal) \| `CasperPaymentPayload`

Both arguments are hex with a one-byte algorithm tag: `01` ed25519, `02` secp256k1.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `publicKey` | `string` |
| `signature` | `string` |

###### Returns

[`Refusal`](index.md#refusal) \| `CasperPaymentPayload`

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

### CasperNetwork

> **CasperNetwork** = `` `casper:${string}` ``

CAIP-2: `casper:` and the chainspec name.

***

### CasperStatus

> **CasperStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `"finalized"`, `bigint`\>

The answer of `casperStatus`: positions are block heights, and the one mark is `finalized`, since the node serves
only executed transactions of final blocks.

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

> `const` **exactCasper**: `Readonly`\<\{ `advertise`: `X402Advertise`; `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CasperUnsigned`](#casperunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/casper"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CasperRef`](#casperref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`CasperStatus`](#casperstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/casper`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
call that executes the payer's signed authorization; `status` reads the executed call.

## Functions

### casperIdDigest()

> **casperIdDigest**(`from`, `to`, `value`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

SHA-256 over the 33 + 33 bytes of the two addresses and the value as a 32-byte big-endian integer.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `from` | `string` |
| `to` | `string` |
| `value` | `bigint` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### casperRecover()

> **casperRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The hash from a settlement transaction alone: the `nonce` argument of the executed authorization call on the token
package the option names, `option.asset`. An input whose `tx` is not 64 hex digits, or whose option names no package
hash of 64 hex digits as its `asset`, is `casper/wrong-reader`, with nothing read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`` `casper:${string}` ``, [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`CasperReader`](#casperreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### casperStatus()

> **casperStatus**(`ref`, `reader`, `query`): `Promise`\<[`CasperStatus`](#casperstatus)\>

The read of the payment by the transaction the facilitator named, as the profile `read-status` answers it: the
payer's executed authorization call settles at `finalized`; a reverted call, a call not yet executed, another call
and a transaction the node does not know answer `pending`, `search-incomplete`, since the read has no search for H.
On the act `agreement`, `ref.h` is the agreement's own value, the nonce the payer signed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | `CasperRefRead` |
| `reader` | [`CasperReader`](#casperreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<`CasperRefRead`, `bigint`, `"finalized"`, `bigint`\> |

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

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
