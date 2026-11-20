---
title: "@integraledger/lcp/starknet"
description: "Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing one token `transfer`; its `Nonce` is the ATR hash's low 250 bits, or on an agreement the agreement value's."
---

# @integraledger/lcp/starknet

Starknet: the pairing `x402/exact/starknet`. The payer signs a SNIP-12 `OutsideExecution` (SNIP-9 v2) authorizing one
token `transfer`; its `Nonce` is the ATR hash's low 250 bits, or on an agreement the agreement value's.

The read is of that nonce on the payer's account, as state, and of the asset's `Transfer` events, receipts and
traces, through a bounded reader. The chain holds 250 of the hash's bits, so a holder of the ATR confirms the hash
from it but nothing recovers the hash.

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

### StarknetCall

One call of an outside execution: the contract, the selector and the calldata, each a felt.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-calldata"></a> `calldata` | readonly `` `0x${string}` ``[] |
| <a id="property-selector"></a> `selector` | `` `0x${string}` `` |
| <a id="property-to"></a> `to` | `` `0x${string}` `` |

***

### StarknetCursor

The search's position: the blocks it reads (`from` to `to`, both included; `to` absent where the nonce has not been
read consumed), the continuation of the page to read, and the events of that page already read.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-continuation"></a> `continuation?` | `readonly` | `string` |
| <a id="property-from"></a> `from` | `readonly` | `bigint` |
| <a id="property-skip"></a> `skip?` | `readonly` | `number` |
| <a id="property-to-1"></a> `to?` | `readonly` | `bigint` |

***

### StarknetEmittedEvent

One event of `starknet_getEvents`: the event, the transaction that emitted it and that transaction's block.

#### Extends

- [`StarknetEvent`](#starknetevent)

#### Properties

| Property | Type | Inherited from |
| ------ | ------ | ------ |
| <a id="property-blocknumber"></a> `blockNumber` | `bigint` \| `null` | - |
| <a id="property-data"></a> `data` | readonly `` `0x${string}` ``[] | [`StarknetEvent`](#starknetevent).[`data`](#property-data-1) |
| <a id="property-fromaddress"></a> `fromAddress` | `` `0x${string}` `` | [`StarknetEvent`](#starknetevent).[`fromAddress`](#property-fromaddress-1) |
| <a id="property-keys"></a> `keys` | readonly `` `0x${string}` ``[] | [`StarknetEvent`](#starknetevent).[`keys`](#property-keys-1) |
| <a id="property-transaction"></a> `transaction` | `` `0x${string}` `` | - |

***

### StarknetEvent

One event of a receipt: the emitting contract, its keys and its data.

#### Extended by

- [`StarknetEmittedEvent`](#starknetemittedevent)

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-data-1"></a> `data` | readonly `` `0x${string}` ``[] |
| <a id="property-fromaddress-1"></a> `fromAddress` | `` `0x${string}` `` |
| <a id="property-keys-1"></a> `keys` | readonly `` `0x${string}` ``[] |

***

### StarknetEventPage

One page of `starknet_getEvents`: its events in the chain's order, and the token of the next page, null at the end.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-continuation-1"></a> `continuation` | `string` \| `null` |
| <a id="property-events"></a> `events` | readonly [`StarknetEmittedEvent`](#starknetemittedevent)[] |

***

### StarknetEventQuery

What one page of `starknet_getEvents` asks: the emitting contract, the keys, the blocks (both included) and the page.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-address"></a> `address` | `` `0x${string}` `` |
| <a id="property-continuation-2"></a> `continuation?` | `string` |
| <a id="property-from-1"></a> `from` | `bigint` |
| <a id="property-keys-2"></a> `keys` | readonly readonly `` `0x${string}` ``[][] |
| <a id="property-to-2"></a> `to` | `bigint` |

***

### StarknetHead

The newest block at a mark: its number, and its own timestamp in Unix seconds.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-number"></a> `number` | `bigint` |
| <a id="property-timestamp"></a> `timestamp` | `bigint` |

***

### StarknetInvocation

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-calldata-1"></a> `calldata` | readonly `` `0x${string}` ``[] |
| <a id="property-calls"></a> `calls` | readonly [`StarknetInvocation`](#starknetinvocation)[] |
| <a id="property-contract"></a> `contract` | `` `0x${string}` `` |
| <a id="property-reverted"></a> `reverted` | `boolean` |
| <a id="property-selector-1"></a> `selector` | `` `0x${string}` `` |

***

### StarknetOutsideExecution

An outside execution as the payer signed it, its signature apart, every member a felt in its shortest spelling.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-caller"></a> `caller` | `` `0x${string}` `` |
| <a id="property-calls-1"></a> `calls` | readonly [`StarknetCall`](#starknetcall)[] |
| <a id="property-executeafter"></a> `executeAfter` | `` `0x${string}` `` |
| <a id="property-executebefore"></a> `executeBefore` | `` `0x${string}` `` |
| <a id="property-nonce"></a> `nonce` | `` `0x${string}` `` |

***

### StarknetReader

Bounded, read-only calls against one network's JSON-RPC node. Every failure rejects, for example with `ReaderError`
from `@integraledger/lcp/evm`; any rejection reads as unreadable.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`StarknetNetwork`](#starknetnetwork) |

#### Methods

##### events()

> **events**(`query`): `Promise`\<[`StarknetEventPage`](#starkneteventpage) \| `null`\>

One page of `starknet_getEvents`; null where the node does not hold the range.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | [`StarknetEventQuery`](#starkneteventquery) |

###### Returns

`Promise`\<[`StarknetEventPage`](#starkneteventpage) \| `null`\>

##### head()

> **head**(`mark`): `Promise`\<[`StarknetHead`](#starknethead)\>

The newest block at `mark`: `ACCEPTED_ON_L2` the block `latest` names, `ACCEPTED_ON_L1` the newest accepted on L1.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `mark` | [`StarknetMark`](#starknetmark) |

###### Returns

`Promise`\<[`StarknetHead`](#starknethead)\>

##### nonceValid()

> **nonceValid**(`account`, `nonce`, `block`): `Promise`\<`boolean` \| `null`\>

`is_valid_outside_execution_nonce(nonce)` on `account`, by `starknet_call` at the block numbered `block`: true where
the nonce is unused there, false where it is used, null where the node does not serve that block's state. Where the
node answers the call with a JSON-RPC error, it rejects with an error whose `code` member is that error's code, as
starknet.js's `RpcError` does: `CONTRACT_NOT_FOUND` (20) and `ENTRYPOINT_NOT_FOUND` (21) read as an account that
runs no outside execution at that block, its nonce unconsumed there.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `` `0x${string}` `` |
| `nonce` | `` `0x${string}` `` |
| `block` | `bigint` |

###### Returns

`Promise`\<`boolean` \| `null`\>

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
| <a id="property-blocknumber-1"></a> `blockNumber` | `bigint` \| `null` | - |
| <a id="property-events-1"></a> `events` | readonly [`StarknetEvent`](#starknetevent)[] | The receipt's `events`. A call that failed, and every call under it, leaves none here. |
| <a id="property-execution"></a> `execution` | `"SUCCEEDED"` \| `"REVERTED"` | - |
| <a id="property-finality"></a> `finality` | `"PRE_CONFIRMED"` \| `"ACCEPTED_ON_L2"` \| `"ACCEPTED_ON_L1"` | - |

***

### StarknetRef

The read keys `reference` returns: the network, the payer's account (the contract whose outside-execution nonce is
`nonce`), the asset, which is the event search's key, the signed nonce (H's low 250 bits on a payment, the agreement
value's on an agreement), `settleBy`, which is `Execute Before`, the payee, the `payTo` of the option the payment
answers, and the outside execution as presented, for `presented`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset"></a> `asset` | `` `0x${string}` `` |
| <a id="property-from-2"></a> `from` | `` `0x${string}` `` |
| <a id="property-network-1"></a> `network` | [`StarknetNetwork`](#starknetnetwork) |
| <a id="property-nonce-1"></a> `nonce` | `` `0x${string}` `` |
| <a id="property-payee"></a> `payee` | `string` |
| <a id="property-presented"></a> `presented` | [`StarknetOutsideExecution`](#starknetoutsideexecution) |
| <a id="property-settleby"></a> `settleBy` | `number` |

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

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`StarknetPayment`](index.md#starknetpayment)

Takes the signature as 1 to 32 felts.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | readonly `` `0x${string}` ``[] |

###### Returns

[`Refusal`](index.md#refusal) \| [`StarknetPayment`](index.md#starknetpayment)

## Type Aliases

### Felt

> **Felt** = `` `0x${string}` ``

Lowercase `0x` hex with no leading zero digit, below FELT_P.

***

### StarknetMark

> **StarknetMark** = `"ACCEPTED_ON_L2"` \| `"ACCEPTED_ON_L1"`

The read's marks, lowest first: `ACCEPTED_ON_L2`, the newest block (`latest`), and `ACCEPTED_ON_L1`, the final one.

***

### StarknetNetwork

> **StarknetNetwork** = `"starknet:SN_MAIN"` \| `"starknet:SN_SEPOLIA"`

***

### StarknetRefRead

> **StarknetRefRead** = [`StarknetRef`](#starknetref) & `object`

The reference `status` reads with: the read keys, H, which the caller adds, and the transaction a settler named.

#### Type Declaration

| Name | Type |
| ------ | ------ |
| `h` | [`AtrHash`](index.md#atrhash) |
| `transaction?` | [`Felt`](#felt) |

***

### StarknetStatus

> **StarknetStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, [`StarknetMark`](#starknetmark), [`StarknetCursor`](#starknetcursor)\>

The answer of `starknetStatus`, as the profile `read-status` gives it. Its marks are `ACCEPTED_ON_L2` and
`ACCEPTED_ON_L1`, in that order, its position the block number, and its search position a `StarknetCursor`. Each
transfer it names carries its transaction and its `place`: a `Transfer` its event's index among its receipt's
`events`, a number; a transfer call of zero the indexes of the calls that lead to it from the trace's root, joined by
`.`, a string.

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

> `const` **exactStarknet**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`, `given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`, `act?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StarknetUnsigned`](#starknetunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/starknet"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](aptos.md#x402read); `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`, `given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StarknetRef`](#starknetref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StarknetStatus`](#starknetstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/starknet`. The payee broadcasts (`broadcaster` answers `"payee"`): the settler executes the outside
execution the payer signed as its named `Caller`; `status` reads the nonce on the payer's account and finds the
transaction that consumed it; `recover` reads the nonce back from a transaction.

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

***

### STARKNET\_MAX\_CANDIDATES

> `const` **STARKNET\_MAX\_CANDIDATES**: `16` = `16`

The most candidate transactions, each a receipt and a trace, one `status` call reads. A search cut short returns
its position, from which the next call resumes. It is also the most other acts a caller gives by their transaction,
each read the same way; a query that gives more is `unreadable`, `too-large`, with nothing read.

***

### STARKNET\_MAX\_CONTINUATION

> `const` **STARKNET\_MAX\_CONTINUATION**: `1024` = `1024`

The longest continuation token, in characters, lcp carries in a search position.

***

### STARKNET\_MAX\_EVENT\_PAGES

> `const` **STARKNET\_MAX\_EVENT\_PAGES**: `8` = `8`

The most pages of `starknet_getEvents` one `status` call reads. A range's size is the chain's; a search cut short
returns its position, from which the next call resumes.

***

### STARKNET\_MAX\_EVENTS

> `const` **STARKNET\_MAX\_EVENTS**: `1024` = `1024`

The most events lcp reads in one receipt, and in one page of `starknet_getEvents`. More are beyond the read's bound.

***

### STARKNET\_MAX\_SIGNATURE\_FELTS

> `const` **STARKNET\_MAX\_SIGNATURE\_FELTS**: `32` = `32`

The most felts of a signature lcp takes, x402's Starknet scheme's suggested bound: an account's signature is one
or a few felts, a multisig's one pair per signer.

***

### STARKNET\_MAX\_TRACE\_DEPTH

> `const` **STARKNET\_MAX\_TRACE\_DEPTH**: `16` = `16`

The deepest trace lcp walks, in levels, the root being 1: a forwarder, the payer's account, a proxy's library call
and the token's transfer sit well within it. A deeper trace is beyond the read's bound.

***

### STARKNET\_MAX\_TRACE\_INVOCATIONS

> `const` **STARKNET\_MAX\_TRACE\_INVOCATIONS**: `512` = `512`

The most invocations of one trace lcp walks. A larger trace is beyond the read's bound.

***

### STARKNET\_MAX\_TYPED\_DATA\_BYTES

> `const` **STARKNET\_MAX\_TYPED\_DATA\_BYTES**: `16384` = `16_384`

The largest presented typed data lcp reads, in bytes of its JSON; one call's typed data is under 2 KiB.

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

### starknetFloor()

> **starknetFloor**(`input`): `bigint` \| [`Refusal`](index.md#refusal)

The agreement's floor on the token `asset` of `network`, in its base units (the profile `x402-exact-starknet`, rule
24): 0 on a token a run has shown to emit a `Transfer` for a transfer of zero on that network (`ZERO_TRANSFER_SHOWN`),
since the search finds a payment by its `Transfer` alone, and 1 on any other, and on any token where no network is
given. An `asset` that is not a felt is `starknet/felt-malformed`; a `network` given that is not a Starknet network,
`starknet/network-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | \{ `asset`: `string`; `network?`: [`StarknetNetwork`](#starknetnetwork); \} |
| `input.asset` | `string` |
| `input.network?` | [`StarknetNetwork`](#starknetnetwork) |

#### Returns

`bigint` \| [`Refusal`](index.md#refusal)

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
`ref.asset` has this payment's identity, the digest of its sender, recipient and amount (`starknetIdDigest`). It is
found by that identity, not by a recorded nonce. A ref or reader that is not an object, a reader for another network,
or a ref whose `transaction` or `asset` is not a felt or whose `idDigest` is not a 32-byte hash, is
`starknet/wrong-reader`, with nothing read. A failed read, a receipt that is not well formed, or a trace that is
missing or holds an invocation that is not well formed, is `starknet/unreadable`, and no receipt `starknet/not-found`.
A receipt at `ACCEPTED_ON_L2` or `ACCEPTED_ON_L1` gives the verdict: a reverted transaction is `starknet/reverted`; a
trace that holds no such transfer, or that is nested deeper than 16 levels or holds more than 512 invocations, which
it reads no further, is `starknet/no-transfer`; and transfers under more than one nonce are `starknet/ambiguous`. A
`PRE_CONFIRMED` receipt, or one with no block number, gives each of these as `starknet/not-final`, since a
pre-confirmed block can change. Two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `asset`: `` `0x${string}` ``; `idDigest`: `` `0x${string}` ``; `network`: [`StarknetNetwork`](#starknetnetwork); `transaction`: `` `0x${string}` ``; \} |
| `ref.asset` | `` `0x${string}` `` |
| `ref.idDigest` | `` `0x${string}` `` |
| `ref.network` | [`StarknetNetwork`](#starknetnetwork) |
| `ref.transaction` | `` `0x${string}` `` |
| `reader` | [`StarknetReader`](#starknetreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### starknetRecover()

> **starknetRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

The value a settlement transaction carries in H's place, from the transaction alone (profile rule 23): the nonce of
its executed outside execution whose calls reach a `transfer` on the token the option names, `option.asset`, as `0x`
and 64 hex digits; H's low 250 bits on a payment, the agreement value's on an agreement, which a holder of the ATR
compares with the same bits of its own H, or of `agreementValue` of it. A reader for another network, or an input whose
`tx` or option's `asset` is not a felt, is `starknet/wrong-reader`, with nothing read. A failed read, a receipt that is
not well formed, or a trace that is missing, holds an invocation that is not well formed, or is beyond lcp's bounds,
which it reads no further, is `starknet/unreadable`, and no receipt `starknet/not-found`. A receipt at
`ACCEPTED_ON_L2` or `ACCEPTED_ON_L1` gives the verdict: a reverted transaction is `starknet/reverted`; a trace that
holds no such execution `starknet/no-transfer`; and executions under more than one nonce `starknet/ambiguous`. A
`PRE_CONFIRMED` receipt, or one with no block number, gives each of these as `starknet/not-final`. Two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<[`StarknetNetwork`](#starknetnetwork), [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`StarknetReader`](#starknetreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### starknetStatus()

> **starknetStatus**(`ref`, `reader`, `query`): `Promise`\<[`StarknetStatus`](#starknetstatus)\>

The read of the act the query asks about, as the profile `read-status` answers it through the profile
`x402/exact/starknet`'s rules 12 to 22: the named transaction, the nonce as state, and the event search. A query, a
reference or a search position that is not one is `unreadable`, `unparseable`, with nothing read, a reader for
another network `chain-mismatch`, and a query that gives more than `STARKNET_MAX_CANDIDATES` other acts by their
transaction `too-large`. Felts compare as numbers, and transactions are named in their shortest lowercase spelling.
On `settled` the answer states `presented`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`StarknetRefRead`](#starknetrefread) |
| `reader` | [`StarknetReader`](#starknetreader) |
| `query` | [`StatusQuery`](index.md#statusquery)\<[`StarknetRefRead`](#starknetrefread), `bigint`, [`StarknetMark`](#starknetmark), [`StarknetCursor`](#starknetcursor)\> |

#### Returns

`Promise`\<[`StarknetStatus`](#starknetstatus)\>

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### StarknetPayment

Re-exports [StarknetPayment](index.md#starknetpayment)

***

### X402Payment

Re-exports [X402Payment](index.md#x402payment)

***

### X402Read

Re-exports [X402Read](aptos.md#x402read)
