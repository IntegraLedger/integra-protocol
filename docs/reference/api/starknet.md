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

Bounded, read-only calls against one network's JSON-RPC node. Every failure rejects with `ReaderError`.

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

The read keys recorded at claim; `transaction` is added when the facilitator names it.

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

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`StarknetPayment`](#starknetpayment)

Takes the signature as 1 to 32 felts.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | readonly `` `0x${string}` ``[] |

###### Returns

[`Refusal`](index.md#refusal) \| [`StarknetPayment`](#starknetpayment)

## Type Aliases

### Felt

> **Felt** = `` `0x${string}` ``

Lowercase `0x` hex with no leading zero digit, below FELT_P.

***

### StarknetNetwork

> **StarknetNetwork** = `"starknet:SN_MAIN"` \| `"starknet:SN_SEPOLIA"`

***

### StarknetPayment

> **StarknetPayment** = [`X402Payment`](x402.md#x402payment)\<\{ `from`: [`Felt`](#felt); `outsideExecution`: \{ `signature`: readonly [`Felt`](#felt)[]; `typedData`: [`OutsideExecutionTypedData`](#outsideexecutiontypeddata); \}; \}\>

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

> `const` **exactStarknet**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StarknetUnsigned`](#starknetunsigned)\>; `claims`: `boolean`; `id`: `"x402/exact/starknet"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StarknetRef`](#starknetref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`StarknetStatus`](#starknetstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

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

The network's reference as a short-string felt.

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

### pairingOf()

> **pairingOf**(`option`): `"x402/exact/starknet"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/starknet"` \| `undefined`

***

### snNonce()

> **snNonce**(`h`): `` `0x${string}` `` \| [`Refusal`](index.md#refusal)

The hash's low 250 bits as a felt: the way Starknet fits a 256-bit hash into a felt. A value that is not a 32-byte
hash is `x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`` `0x${string}` `` \| [`Refusal`](index.md#refusal)

***

### starknetIdDigest()

> **starknetIdDigest**(`from`, `to`, `amount`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

the core's `hash` over `from`, `to` and `amount` as three 32-byte big-endian words: the identity of one transfer.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `from` | `` `0x${string}` `` |
| `to` | `` `0x${string}` `` |
| `amount` | `bigint` |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### starknetLandedNonce()

> **starknetLandedNonce**(`ref`, `reader`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

The nonce that landed in the named transaction for this transfer, for a party holding the ATR to compare with the
hash's low 250 bits. It is found by the transfer's identity on `ref.asset`, not by the recorded nonce.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StarknetRef`](#starknetref) & `object` |
| `reader` | [`StarknetReader`](#starknetreader) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### starknetStatus()

> **starknetStatus**(`ref`, `reader`): `Promise`\<[`StarknetStatus`](#starknetstatus)\>

Reads the named transaction's receipt. A `SUCCEEDED` receipt must emit exactly one `Transfer` event from
`ref.asset` whose sender is `ref.from`, and that transfer must have this payment's identity, else failed
`not-this-instrument`. Then its trace must hold exactly one `execute_from_outside_v2` whose calldata carries this
nonce and whose direct call is `transfer` on `ref.asset` with this identity, no invocation on the path to either
having reverted. A failed read, a malformed answer, an asset `Transfer` event of neither standard layout, or a
reader for another network is pending. Two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StarknetRef`](#starknetref) & `object` |
| `reader` | [`StarknetReader`](#starknetreader) |

#### Returns

`Promise`\<[`StarknetStatus`](#starknetstatus)\>
