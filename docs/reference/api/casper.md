---
title: "@integraledger/lcp/casper"
description: "The exports of @integraledger/lcp/casper."
---

# @integraledger/lcp/casper

## Interfaces

### CasperBlockCall

A call among a block's transactions, with the hash of the transaction that made it, 64 hex digits.

#### Extends

- [`CasperCall`](#caspercall)

#### Properties

| Property | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ |
| <a id="property-args"></a> `args` | `object` | The call's arguments as the token takes them: `from` is the authorization's `from`, or on `cancel_authorization` the authorizer whose nonce it cancels; `validAfter` and `validBefore` where the reader shows them. | [`CasperCall`](#caspercall).[`args`](#property-args-1) |
| `args.from?` | `string` | - | - |
| `args.nonce?` | `Uint8Array`\<`ArrayBufferLike`\> | - | - |
| `args.to?` | `string` | - | - |
| `args.validAfter?` | `bigint` | - | - |
| `args.validBefore?` | `bigint` | - | - |
| `args.value?` | `bigint` | - | - |
| <a id="property-blockheight"></a> `blockHeight` | `bigint` \| `null` | - | [`CasperCall`](#caspercall).[`blockHeight`](#property-blockheight-1) |
| <a id="property-entrypoint"></a> `entryPoint` | `string` \| `null` | - | [`CasperCall`](#caspercall).[`entryPoint`](#property-entrypoint-1) |
| <a id="property-error"></a> `error` | `string` \| `null` | - | [`CasperCall`](#caspercall).[`error`](#property-error-1) |
| <a id="property-executed"></a> `executed` | `boolean` | - | [`CasperCall`](#caspercall).[`executed`](#property-executed-1) |
| <a id="property-packagehash"></a> `packageHash` | `string` \| `null` | - | [`CasperCall`](#caspercall).[`packageHash`](#property-packagehash-1) |
| <a id="property-transaction"></a> `transaction` | `string` | - | - |

***

### CasperBlockPage

One page of a block's executed transactions, in the block's order: `next` starts the next page, null at its end.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-calls"></a> `calls` | readonly [`CasperBlockCall`](#casperblockcall)[] |
| <a id="property-next"></a> `next` | `number` \| `null` |

***

### CasperCall

One executed contract call, as the reader reports it.

#### Extended by

- [`CasperBlockCall`](#casperblockcall)

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-args-1"></a> `args` | `object` | The call's arguments as the token takes them: `from` is the authorization's `from`, or on `cancel_authorization` the authorizer whose nonce it cancels; `validAfter` and `validBefore` where the reader shows them. |
| `args.from?` | `string` | - |
| `args.nonce?` | `Uint8Array`\<`ArrayBufferLike`\> | - |
| `args.to?` | `string` | - |
| `args.validAfter?` | `bigint` | - |
| `args.validBefore?` | `bigint` | - |
| `args.value?` | `bigint` | - |
| <a id="property-blockheight-1"></a> `blockHeight` | `bigint` \| `null` | - |
| <a id="property-entrypoint-1"></a> `entryPoint` | `string` \| `null` | - |
| <a id="property-error-1"></a> `error` | `string` \| `null` | - |
| <a id="property-executed-1"></a> `executed` | `boolean` | - |
| <a id="property-packagehash-1"></a> `packageHash` | `string` \| `null` | - |

***

### CasperCursor

The search's position: a height at which the item was read unset, above which the block that set it lies; or that
block, the start of the next page of its transactions to read, and the transaction that set the item where an
earlier page held it.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-block"></a> `block?` | `readonly` | `bigint` |
| <a id="property-found"></a> `found?` | `readonly` | `string` |
| <a id="property-next-1"></a> `next?` | `readonly` | `number` |
| <a id="property-unset"></a> `unset?` | `readonly` | `bigint` |

***

### CasperHead

The newest block a node has executed, every block being final: its height and its own timestamp in Unix milliseconds.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-height"></a> `height` | `bigint` |
| <a id="property-timestamp"></a> `timestamp` | `bigint` |

***

### CasperReader

Bounded, read-only calls against one network's node or its sidecar. Every failure rejects, for example with
`ReaderError` from `@integraledger/lcp/evm`; any rejection reads as unreadable.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `casper:${string}` `` |

#### Methods

##### blockCalls()

> **blockCalls**(`height`, `start`): `Promise`\<[`CasperBlockPage`](#casperblockpage) \| `null`\>

The page of the executed transactions of the block at `height` that starts at `start`; null where the node does not serve the block.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `height` | `bigint` |
| `start` | `number` |

###### Returns

`Promise`\<[`CasperBlockPage`](#casperblockpage) \| `null`\>

##### head()

> **head**(): `Promise`\<[`CasperHead`](#casperhead)\>

The newest block the node has executed.

###### Returns

`Promise`\<[`CasperHead`](#casperhead)\>

##### lowest()

> **lowest**(): `Promise`\<`bigint`\>

The lowest block height whose state the node serves, its `available_block_range.low`.

###### Returns

`Promise`\<`bigint`\>

##### nonceUsed()

> **nonceUsed**(`asset`, `from`, `nonce`, `height`): `Promise`\<`boolean` \| `null`\>

The item of `(from, nonce)` in `asset`'s `used_nonces` dictionary, read with `state_get_dictionary_item` at the
state root of the block at `height`: true where it is set, false where the node answers in the form it documents
for a missing item, and null where the node does not serve that block's state.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `asset` | `string` |
| `from` | `string` |
| `nonce` | `Uint8Array` |
| `height` | `bigint` |

###### Returns

`Promise`\<`boolean` \| `null`\>

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

The read keys `reference` returns: the network, the token package, the authorization's `from`, the signed nonce (H on
a payment, the agreement's value on an agreement), `settleBy`, which is `validBefore` up to
`Number.MAX_SAFE_INTEGER`, the payee, the `payTo` of the option the payment answers, and the authorization as
presented, for `presented`. Addresses and hashes are lowercase.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset"></a> `asset` | `string` |
| <a id="property-from"></a> `from` | `string` |
| <a id="property-network-1"></a> `network` | `` `casper:${string}` `` |
| <a id="property-nonce"></a> `nonce` | `` `0x${string}` `` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-presented"></a> `presented` | [`CasperAuthorization`](#casperauthorization) |
| <a id="property-settleby"></a> `settleBy` | `number` |

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

### CasperAuthorization

> **CasperAuthorization** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-from-1"></a> `from` | `string` |
| <a id="property-nonce-1"></a> `nonce` | `string` |
| <a id="property-to"></a> `to` | `string` |
| <a id="property-validafter"></a> `validAfter` | `string` |
| <a id="property-validbefore"></a> `validBefore` | `string` |
| <a id="property-value"></a> `value` | `string` |

***

### CasperNetwork

> **CasperNetwork** = `` `casper:${string}` ``

CAIP-2: `casper:` and the chainspec name.

***

### CasperStatus

> **CasperStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, `"finalized"`, [`CasperCursor`](#caspercursor)\>

The answer of `casperStatus`: positions are block heights, and the one mark is `finalized`, since the node serves
only executed transactions of final blocks; the search's position is a `CasperCursor`; `presented` on `settled`
compares the executed call with the authorization as presented.

***

### PackageHash

> **PackageHash** = `string`

64 hex digits, no prefix.

## Variables

### CASPER\_DOMAIN\_TYPEHASH

> `const` **CASPER\_DOMAIN\_TYPEHASH**: `"0xe20dd13933eeb9d6099b53d5ffd59cfd50fe774983038681a378371664fad4fb"`

keccak256("EIP712Domain(string name,string version,string chain_name,bytes32 contract_package_hash)")

***

### CASPER\_MAX\_NAME\_LENGTH

> `const` **CASPER\_MAX\_NAME\_LENGTH**: `64` = `64`

The longest token `name` or `version` lcp reads from a Casper option, in characters. CEP-3009 fixes no length; lcp
bounds what it hashes into the domain.

***

### CASPER\_MAX\_PAGE\_CALLS

> `const` **CASPER\_MAX\_PAGE\_CALLS**: `1024` = `1024`

The most calls lcp reads on one page of a block's transactions, the reader's page being its own choice. A page that
gives more is beyond the read's bound, `unreadable`, `too-large`.

***

### CASPER\_MAX\_PAGES

> `const` **CASPER\_MAX\_PAGES**: `8` = `8`

The most pages of a block's transactions one `status` call reads. A block's size is the chain's; a search cut short
returns its position, from which the next call resumes.

***

### CASPER\_MAX\_PROBES

> `const` **CASPER\_MAX\_PROBES**: `64` = `64`

The most reads of the nonce's item one `status` call makes to find the block that set it: a bisection of 64-bit
block heights ends within 64. A search cut short returns its position, from which the next call resumes.

***

### CASPER\_MAX\_PUBLIC\_KEY\_HEX

> `const` **CASPER\_MAX\_PUBLIC\_KEY\_HEX**: `68` = `68`

The longest tagged public key lcp reads, in hex digits: a one-byte tag and a 33-byte secp256k1 key.

***

### CASPER\_MAX\_SIGNATURE\_HEX

> `const` **CASPER\_MAX\_SIGNATURE\_HEX**: `132` = `132`

The longest tagged signature lcp reads, in hex digits: a one-byte tag and a 65-byte signature.

***

### exactCasper

> `const` **exactCasper**: `Readonly`\<\{ `advertise`: `X402Advertise`; `bound`: (`presented`, `given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`, `act?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CasperUnsigned`](#casperunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/casper"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`, `given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`CasperRef`](#casperref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`CasperStatus`](#casperstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/casper`. The payee broadcasts (`broadcaster` answers `"payee"`): the settler submits the call that
executes the payer's signed authorization; `status` reads the nonce's item, the block that set it and its
transactions.

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

The value a settlement transaction carries in H's place, from the transaction alone (profile rule 23): the `nonce`
argument of the executed authorization call on the token package the option names, `option.asset`, which is H on a
payment and the agreement's value on an agreement, which a holder of the ATR compares with `agreementValue` of its
own H. An input whose `tx` is not 64 hex digits, or whose option names no package hash of 64 hex digits as its
`asset`, is `casper/wrong-reader`, with nothing read.

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

The read of the act the query asks about, as the profile `read-status` answers it through the profile
`x402/exact/casper`'s rules 12 to 22: the nonce's item, the block that set it and its transactions. A query, a
reference or a search position that is not one, a reference without the authorization as presented among them, is
`unreadable`, `unparseable`, with nothing read, and a reader for another network `chain-mismatch`; a read the node
does not serve is `history-gap`. On `settled` the answer states `presented`, the executed call compared with the
authorization as presented.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | `CasperRefRead` |
| `reader` | [`CasperReader`](#casperreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<`CasperRefRead`, `bigint`, `"finalized"`, [`CasperCursor`](#caspercursor)\> |

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
