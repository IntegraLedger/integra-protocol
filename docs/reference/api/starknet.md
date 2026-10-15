---
title: "@integraledger/lcp/starknet"
description: "The exports of @integraledger/lcp/starknet."
---

# @integraledger/lcp/starknet

## Interfaces

### Field

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-name"></a> `name` | `string` |
| <a id="property-type"></a> `type` | `string` |

***

### OutsideExecutionTypedData

SNIP-12 revision 1, SNIP-9 v2, as x402's Starknet scheme prints it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-domain"></a> `domain` | `object` |
| `domain.chainId` | `` `0x${string}` `` |
| `domain.name` | `"Account.execute_from_outside"` |
| `domain.revision` | `1` |
| `domain.version` | `2` |
| <a id="property-message"></a> `message` | `object` |
| `message.Caller` | `` `0x${string}` `` |
| `message.Calls` | \[\{ `Calldata`: \[`` `0x${string}` ``, `` `0x${string}` ``, `` `0x${string}` ``\]; `Selector`: `"0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e"`; `To`: `` `0x${string}` ``; \}\] |
| `message.Execute After` | `"1"` |
| `message.Execute Before` | `string` |
| `message.Nonce` | `` `0x${string}` `` |
| <a id="property-primarytype"></a> `primaryType` | `"OutsideExecution"` |
| <a id="property-types"></a> `types` | `object` |
| `types.Call` | [`Field`](#field)[] |
| `types.OutsideExecution` | [`Field`](#field)[] |
| `types.StarknetDomain` | [`Field`](#field)[] |

***

### StarknetEvent

One event of a receipt: the emitting contract, its keys and its data.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-data"></a> `data` | readonly `` `0x${string}` ``[] |
| <a id="property-fromaddress"></a> `fromAddress` | `` `0x${string}` `` |
| <a id="property-keys"></a> `keys` | readonly `` `0x${string}` ``[] |

***

### StarknetInvocation

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-calldata"></a> `calldata` | readonly `` `0x${string}` ``[] |
| <a id="property-calls"></a> `calls` | readonly [`StarknetInvocation`](#starknetinvocation)[] |
| <a id="property-contract"></a> `contract` | `` `0x${string}` `` |
| <a id="property-reverted"></a> `reverted` | `boolean` |
| <a id="property-selector"></a> `selector` | `` `0x${string}` `` |

***

### StarknetReader

Bounded, read-only calls against one network's JSON-RPC node. Every failure rejects, for example with `ReaderError`
from `@integraledger/lcp/evm`; any rejection reads as unreadable.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`StarknetNetwork`](#starknetnetwork) |

#### Methods

##### receipt()

> **receipt**(`tx`): `Promise`\<[`StarknetReceipt`](#starknetreceipt) \| `null`\>

`starknet_getTransactionReceipt`, with its events; null: unknown hash.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`StarknetReceipt`](#starknetreceipt) \| `null`\>

##### trace()

> **trace**(`tx`): `Promise`\<[`StarknetInvocation`](#starknetinvocation) \| `null`\>

`starknet_traceTransaction`'s `execute_invocation`; null: none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | `` `0x${string}` `` |

###### Returns

`Promise`\<[`StarknetInvocation`](#starknetinvocation) \| `null`\>

***

### StarknetReceipt

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blocknumber"></a> `blockNumber` | `bigint` \| `null` | - |
| <a id="property-events"></a> `events` | readonly [`StarknetEvent`](#starknetevent)[] | The receipt's `events`. A call that failed, and every call under it, leaves none here. |
| <a id="property-execution"></a> `execution` | `"SUCCEEDED"` \| `"REVERTED"` | - |
| <a id="property-finality"></a> `finality` | `"PRE_CONFIRMED"` \| `"ACCEPTED_ON_L2"` \| `"ACCEPTED_ON_L1"` | - |

***

### StarknetRef

The read keys `reference` returns; `transaction` is added when the facilitator names it.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-asset"></a> `asset` | `` `0x${string}` `` | - |
| <a id="property-from"></a> `from` | `` `0x${string}` `` | The payer's account: the contract whose outside-execution nonce is `nonce`. |
| <a id="property-iddigest"></a> `idDigest` | `` `0x${string}` `` | - |
| <a id="property-network-1"></a> `network` | [`StarknetNetwork`](#starknetnetwork) | - |
| <a id="property-nonce"></a> `nonce` | `` `0x${string}` `` | - |
| <a id="property-settleby"></a> `settleBy` | `number` | - |
| <a id="property-transaction"></a> `transaction?` | `` `0x${string}` `` | - |

***

### StarknetUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | The typed data the account's key signs; SNIP-12 hashes the account in. |
| `request.account` | `` `0x${string}` `` | - |
| `request.kind` | `"starknet-snip12"` | - |
| `request.typedData` | [`OutsideExecutionTypedData`](#outsideexecutiontypeddata) | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| `StarknetPayment`

Takes the signature as 1 to 32 felts.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | readonly `` `0x${string}` ``[] |

###### Returns

[`Refusal`](index.md#refusal) \| `StarknetPayment`

## Type Aliases

### Felt

> **Felt** = `` `0x${string}` ``

Lowercase `0x` hex with no leading zero digit, below FELT_P.

***

### StarknetNetwork

> **StarknetNetwork** = `"starknet:SN_MAIN"` \| `"starknet:SN_SEPOLIA"`

***

### StarknetStatus

> **StarknetStatus** = \{ `blockNumber`: `bigint`; `finality`: `"ACCEPTED_ON_L2"` \| `"ACCEPTED_ON_L1"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"pre-confirmed"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"reverted"` \| `"not-this-instrument"`; \}

## Variables

### ANY\_CALLER

> `const` **ANY\_CALLER**: `"0x414e595f43414c4c4552"` = `"0x414e595f43414c4c4552"`

The SNIP-9 any-caller sentinel, the short string `ANY_CALLER`.

***

### EVENT\_TRANSFER

> `const` **EVENT\_TRANSFER**: `"0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9"` = `"0x99cd8bde557814842a3121e8ddfd433a539b8c9f14bf31ebf108d12e6196e9"`

sn_keccak("Transfer"): the first key of a SNIP-2 token's `Transfer` event.

***

### exactStarknet

> `const` **exactStarknet**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StarknetUnsigned`](#starknetunsigned)\>; `claims`: `boolean`; `id`: `"x402/exact/starknet"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StarknetRef`](#starknetref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StarknetStatus`](#starknetstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/starknet`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator executes the
outside execution the payer signed and names its transaction; `status` reads the executed call's trace.

***

### FELT\_P

> `const` **FELT\_P**: `bigint`

***

### MASK\_250

> `const` **MASK\_250**: `bigint`

***

### SELECTOR\_EXECUTE\_FROM\_OUTSIDE\_V2

> `const` **SELECTOR\_EXECUTE\_FROM\_OUTSIDE\_V2**: `"0x34cc13b274446654ca3233ed2c1620d4c5d1d32fd20b47146a3371064bdc57d"` = `"0x34cc13b274446654ca3233ed2c1620d4c5d1d32fd20b47146a3371064bdc57d"`

sn_keccak("execute_from_outside_v2")

***

### SELECTOR\_TRANSFER

> `const` **SELECTOR\_TRANSFER**: `"0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e"` = `"0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e"`

sn_keccak("transfer")

## Functions

### chainIdFelt()

> **chainIdFelt**(`n`): `` `0x${string}` ``

The network's reference as a short-string felt. Throws TypeError on a network that is not a `StarknetNetwork`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `n` | [`StarknetNetwork`](#starknetnetwork) |

#### Returns

`` `0x${string}` ``

***

### outsideExecution()

> **outsideExecution**(`a`): [`Refusal`](index.md#refusal) \| [`OutsideExecutionTypedData`](#outsideexecutiontypeddata)

x402's `OutsideExecution` for one `transfer(payTo, amount)` on `asset`, with the fee payer as `Caller`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | \{ `amount`: `bigint`; `asset`: `` `0x${string}` ``; `executeBefore`: `number`; `feePayer`: `` `0x${string}` ``; `network`: [`StarknetNetwork`](#starknetnetwork); `nonce`: `` `0x${string}` ``; `payTo`: `` `0x${string}` ``; \} |
| `a.amount` | `bigint` |
| `a.asset` | `` `0x${string}` `` |
| `a.executeBefore` | `number` |
| `a.feePayer` | `` `0x${string}` `` |
| `a.network` | [`StarknetNetwork`](#starknetnetwork) |
| `a.nonce` | `` `0x${string}` `` |
| `a.payTo` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| [`OutsideExecutionTypedData`](#outsideexecutiontypeddata)

***

### snNonce()

> **snNonce**(`h`): [`Refusal`](index.md#refusal) \| `` `0x${string}` ``

The hash's low 250 bits as a felt: the way Starknet fits a 256-bit hash into a felt. A value that is not a 32-byte
hash is `x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

[`Refusal`](index.md#refusal) \| `` `0x${string}` ``

***

### starknetIdDigest()

> **starknetIdDigest**(`from`, `to`, `amount`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

the core's `hash` over `from`, `to` and `amount` as three 32-byte big-endian words: the identity of one transfer.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `from` | `` `0x${string}` `` |
| `to` | `` `0x${string}` `` |
| `amount` | `bigint` |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### starknetLandedNonce()

> **starknetLandedNonce**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The nonce that landed in the named transaction for this transfer, for a party holding the ATR to compare with the
hash's low 250 bits: the nonce of the `execute_from_outside_v2` below which, at any depth, a `transfer` call on
`ref.asset` has this payment's identity. It is found by that identity, not by the recorded nonce. A ref or reader
that is not an object, a reader for another network, or a ref whose `transaction` or `asset` is not a felt or whose
`idDigest` is not a 32-byte hash, is `starknet/wrong-reader`, with nothing read. A failed read, a receipt that is not
well formed, or a trace that is missing or holds an invocation that is not well formed, is `starknet/unreadable`, and
no receipt `starknet/not-found`. A receipt at `ACCEPTED_ON_L2` or `ACCEPTED_ON_L1` gives the verdict: a reverted
transaction is `starknet/reverted`; a trace that holds no such transfer, or that is nested deeper than 16 levels or
holds more than 512 invocations, which it reads no further, is `starknet/no-transfer`; and transfers under more than
one nonce are `starknet/ambiguous`. A `PRE_CONFIRMED` receipt, or one with no block number, gives each of these as
`starknet/not-final`, since a pre-confirmed block can change. Two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StarknetRef`](#starknetref) & `object` |
| `reader` | [`StarknetReader`](#starknetreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### starknetStatus()

> **starknetStatus**(`ref`, `reader`): `Promise`\<[`StarknetStatus`](#starknetstatus)\>

Reads the named transaction's receipt. A receipt that is `PRE_CONFIRMED`, or names no block, is pending
`pre-confirmed`: a pre-confirmed block can change. From a receipt accepted on L2 or L1, a `REVERTED` one is failed
`reverted`, and a `SUCCEEDED` one must emit exactly one `Transfer` event from `ref.asset` whose sender is `ref.from`,
and that transfer must have this payment's identity, else failed `not-this-instrument`. An asset `Transfer` event of
neither standard layout, or with an amount limb of 2^128 or more, is the token's own event as the chain holds it,
which a re-read gives again, and is failed `not-this-instrument` too. Then its trace must hold exactly one `transfer`
call on `ref.asset` with this identity nested, at any depth, below an `execute_from_outside_v2` whose calldata
carries this nonce, no invocation on the path to either having reverted. A trace that holds none, or more than one,
or that is nested deeper than 16 levels or holds more than 512 invocations, which the walk reads no further, is
failed `not-this-instrument`: an accepted transaction's trace does not change, and `starknetLandedNonce` gives
`starknet/no-transfer` for none and for a trace beyond those bounds. A call below such a `transfer` is the token's
own execution of it (a library call repeats the frame) and is not read as another transfer. A failed read, a
malformed answer (an asset `Transfer` event with a key or data member that is not `0x` and 1 to 64 hex digits below
`FELT_P`, whatever the other events hold, among them), or a reader for another network is pending. A ref whose
`from`, `asset` or `nonce` is not `0x` and 1 to 64 hex digits below `FELT_P`, or whose `idDigest` is not `0x` and 64
hex digits, is pending `unreadable`, with nothing read; felts compare as numbers and the digest as a hash, in either
case. Two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StarknetRef`](#starknetref) & `object` |
| `reader` | [`StarknetReader`](#starknetreader) |

#### Returns

`Promise`\<[`StarknetStatus`](#starknetstatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
