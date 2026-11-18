---
title: "@integraledger/lcp/svm"
description: "Solana rail pieces: the wire transaction and its one Memo instruction carrying the ATR hash in LCP string form, the settlement read, and the payment-channels program's pieces."
---

# @integraledger/lcp/svm

Solana rail pieces: the wire transaction and its one Memo instruction carrying the ATR hash in LCP string form, the
settlement read, and the payment-channels program's pieces.

It also holds the digest of the message the payer signed. The settlement is read through a bounded reader. The
payment-channels pieces are its instructions and PDAs, the voucher, the session proof, and the channel's status read.

## Interfaces

### ChannelBuildInput

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-computeunitlimit"></a> `computeUnitLimit` | `number` | - |
| <a id="property-computeunitprice"></a> `computeUnitPrice` | `bigint` | - |
| <a id="property-feepayer"></a> `feePayer` | `string` | - |
| <a id="property-instruction"></a> `instruction` | \{ `channel`: `string`; `deposit`: `bigint`; `gracePeriod`: `number`; `kind`: `"open"`; `openSlot`: `bigint`; `recipient`: `string`; `salt`: `bigint`; `signer`: `string`; \} \| \{ `amount`: `bigint`; `channel`: `string`; `kind`: `"top_up"`; \} \| \{ `channel`: `string`; `kind`: `"request_close"`; \} | - |
| <a id="property-memo"></a> `memo?` | `string` | The one Memo v3 instruction's text, a well-formed string; absent, the message carries no memo. |
| <a id="property-mint"></a> `mint` | `string` | - |
| <a id="property-payer"></a> `payer` | `string` | - |
| <a id="property-recentblockhash"></a> `recentBlockhash` | `string` | - |
| <a id="property-tokenprogram"></a> `tokenProgram` | `string` | - |
| <a id="property-v1"></a> `v1?` | [`SvmV1Header`](#svmv1header) | Present, a version-1 message (SIMD-0385) whose header carries the compute budget in this form; absent, v0. |

***

### ChannelIx

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel"></a> `channel` | `string` | - |
| <a id="property-data"></a> `data` | `Uint8Array`\<`ArrayBuffer`\> | A copy of the instruction's data. |
| <a id="property-kind"></a> `kind` | `"open"` \| `"top_up"` \| `"request_close"` | - |

***

### SvmBuildInput

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` | - |
| <a id="property-computeunitlimit-1"></a> `computeUnitLimit` | `number` | - |
| <a id="property-computeunitprice-1"></a> `computeUnitPrice` | `bigint` | - |
| <a id="property-decimals"></a> `decimals` | `number` | - |
| <a id="property-feepayer-1"></a> `feePayer` | `string` | - |
| <a id="property-memo-1"></a> `memo` | `string` | - |
| <a id="property-mint-1"></a> `mint` | `string` | - |
| <a id="property-payer-1"></a> `payer` | `string` | - |
| <a id="property-payto"></a> `payTo` | `string` | - |
| <a id="property-recentblockhash-1"></a> `recentBlockhash` | `string` | - |
| <a id="property-tokenprogram-1"></a> `tokenProgram` | `string` | - |
| <a id="property-v1-1"></a> `v1?` | [`SvmV1Header`](#svmv1header) | Present, a version-1 message (SIMD-0385) whose header carries the compute budget in this form; absent, v0. |

***

### SvmCursor

The search's handle, which a `pending` answer returns and the next call takes: `before`, the signature below which
the buyer's account has range left to read; `head`, the newest signature an earlier pass read, so the next pass reads
the head down to it; `met`, the signatures of the transactions carrying H an earlier pass met that the answer rests
on, each a transaction that consumed the value or one the payer signed, other than those the caller gave, which the
next pass looks up by signature, since the ranges it resumes no longer list them; and `validAt`, the context slot of
the first `isBlockhashValid` answer of `true` at `confirmed`, as a decimal string, which bounds the blockhash's own
slot from above.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-before"></a> `before?` | `readonly` | `string` |
| <a id="property-head"></a> `head?` | `readonly` | `string` |
| <a id="property-met"></a> `met?` | `readonly` | readonly `string`[] |
| <a id="property-validat"></a> `validAt?` | `readonly` | `string` |

***

### SvmInner

One instruction of `meta.innerInstructions`: the top-level instruction it ran under (`index`), and its own fields.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accounts"></a> `accounts` | readonly `number`[] | - |
| <a id="property-data-1"></a> `data` | `Uint8Array` | - |
| <a id="property-index"></a> `index` | `number` | The index, among the message's top-level instructions, of the instruction it ran under. |
| <a id="property-program"></a> `program` | `number` | Indexes the static keys, then `loaded.writable`, then `loaded.readonly`, as a top-level instruction does. |

***

### SvmInstruction

One compiled instruction of an `SvmTx`; `B` is what its data is backed by, as for `SvmTx`.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `B` *extends* `ArrayBufferLike` | `ArrayBufferLike` |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accounts-1"></a> `accounts` | readonly `number`[] |
| <a id="property-data-2"></a> `data` | `Uint8Array`\<`B`\> |
| <a id="property-program-1"></a> `program` | `number` |

***

### SvmLanded

A landed transaction as `getTransaction` returns it with encoding `base64` and `maxSupportedTransactionVersion` 1,
the highest message version this package decodes.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-err"></a> `err` | `unknown` | - |
| <a id="property-inner"></a> `inner` | readonly [`SvmInner`](#svminner)[] | `meta.innerInstructions`, in the node's order, each with the top-level instruction it ran under. |
| <a id="property-loaded"></a> `loaded` | `object` | - |
| `loaded.readonly` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] | - |
| `loaded.writable` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] | - |
| <a id="property-post"></a> `post?` | readonly [`SvmTokenBalance`](#svmtokenbalance)[] | `meta.postTokenBalances`; absent read as none. |
| <a id="property-pre"></a> `pre?` | readonly [`SvmTokenBalance`](#svmtokenbalance)[] | `meta.preTokenBalances`; absent read as none. |
| <a id="property-slot"></a> `slot?` | `bigint` | The slot of the block that holds it, as `getTransaction` gives it; absent where the endpoint gives none. |
| <a id="property-wire"></a> `wire` | `Uint8Array` | - |

***

### SvmNonce

The durable nonce a message uses: the nonce account its `AdvanceNonceAccount` instruction names, and the nonce value
the message carries in its blockhash field.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-account"></a> `account` | `string` |
| <a id="property-value"></a> `value` | `string` |

***

### SvmReader

Bounded, read-only calls against one network's endpoint. Every failure rejects, for example with `ReaderError` from
`@integraledger/lcp/evm`, and no function in this package reads a rejection as finding nothing: a rejected call is
`unreadable`, `transport` (`too-large` or `unparseable` for a `ReaderError` of kind `too-large` or `malformed`).

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `solana:${string}` `` |

#### Methods

##### account()

> **account**(`address`, `commitment`): `Promise`\<\{ `slot`: `bigint`; `value`: \{ `data`: `Uint8Array`; `owner`: `string`; \} \| `null`; \}\>

`getAccountInfo` at that commitment with encoding `base64`: the response's context slot, and the account's owner and
data, or null when no account exists at that address.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |
| `commitment` | [`SvmCommitment`](#svmcommitment) |

###### Returns

`Promise`\<\{ `slot`: `bigint`; `value`: \{ `data`: `Uint8Array`; `owner`: `string`; \} \| `null`; \}\>

##### blockhashValid()

> **blockhashValid**(`blockhash`, `commitment`): `Promise`\<\{ `slot`: `bigint`; `valid`: `boolean`; \}\>

`isBlockhashValid` at that commitment: `valid` is the response's `value`, and `slot` its context slot, the slot the
node evaluated it at.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockhash` | `string` |
| `commitment` | [`SvmCommitment`](#svmcommitment) |

###### Returns

`Promise`\<\{ `slot`: `bigint`; `valid`: `boolean`; \}\>

##### firstAvailableBlock()

> **firstAvailableBlock**(): `Promise`\<`bigint`\>

`getFirstAvailableBlock`: the lowest slot whose block the node still holds.

###### Returns

`Promise`\<`bigint`\>

##### signatures()

> **signatures**(`address`, `page`): `Promise`\<readonly [`SvmSignature`](#svmsignature)[]\>

`getSignaturesForAddress` at that commitment, newest first, `before` and `until` as the RPC takes them (each
exclusive), and `minContextSlot`, "the minimum slot that the request can be evaluated at", so a node that has not
reached it fails the call.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |
| `page` | \{ `before?`: `string`; `commitment`: [`SvmCommitment`](#svmcommitment); `limit`: `1000`; `minContextSlot?`: `bigint`; `until?`: `string`; \} |
| `page.before?` | `string` |
| `page.commitment` | [`SvmCommitment`](#svmcommitment) |
| `page.limit` | `1000` |
| `page.minContextSlot?` | `bigint` |
| `page.until?` | `string` |

###### Returns

`Promise`\<readonly [`SvmSignature`](#svmsignature)[]\>

##### slot()

> **slot**(`commitment`): `Promise`\<`bigint`\>

`getSlot` at that commitment.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `commitment` | [`SvmCommitment`](#svmcommitment) |

###### Returns

`Promise`\<`bigint`\>

##### transaction()

> **transaction**(`signature`, `commitment`): `Promise`\<[`SvmLanded`](#svmlanded) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

`getTransaction` at that commitment, with encoding `base64` and `maxSupportedTransactionVersion: 1`, or `notFound`
with the node's slot there (`getSlot`, read from the same node before the lookup), or null when the reader cannot
read it. A reader must ask with 1: a node asked with 0 answers a version-1 transaction with an error (-32015).

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `string` |
| `commitment` | [`SvmCommitment`](#svmcommitment) |

###### Returns

`Promise`\<[`SvmLanded`](#svmlanded) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

***

### SvmRef

The read keys of a presented payment, which `reference` returns: the network; the transaction id once the message is
signed in its first slot; the digest of the message the payer signed, the payment presented compared whole, absent
where the payment was presented as a transaction alone; the buyer's account, which the search pages and whose
signature is the act's; H as the presented payment carries it, which the search looks for; the option's payee, the
key of the read's two party tests; the fee payer; and what bounds the message's life: its recent blockhash, or the
durable nonce it uses.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockhash"></a> `blockhash?` | `string` | The recent blockhash; absent for a durable-nonce message and for a transaction alone. |
| <a id="property-digest"></a> `digest?` | `` `0x${string}` `` | - |
| <a id="property-feepayer-2"></a> `feePayer?` | `string` | - |
| <a id="property-h"></a> `h` | `` `0x${string}` `` | - |
| <a id="property-network-1"></a> `network` | `` `solana:${string}` `` | - |
| <a id="property-nonce"></a> `nonce?` | [`SvmNonce`](#svmnonce) | Present exactly when the message uses a durable nonce. |
| <a id="property-payee"></a> `payee` | `string` | - |
| <a id="property-payer-2"></a> `payer` | `string` | - |
| <a id="property-transaction"></a> `transaction?` | `string` | - |

***

### SvmSignature

One entry of `getSignaturesForAddress`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-memo-2"></a> `memo` | `string` \| `null` | The RPC's rendering of the transaction's memos (`[len] text`, joined by `; `), or null when it has none. |
| <a id="property-signature"></a> `signature` | `string` | - |
| <a id="property-slot-1"></a> `slot` | `bigint` | - |

***

### SvmTokenBalance

One entry of `meta.preTokenBalances` or `meta.postTokenBalances`.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account-1"></a> `account` | `number` | `accountIndex`: the token account, indexing the keys as an instruction does. |
| <a id="property-mint-2"></a> `mint` | `string` | - |
| <a id="property-owner"></a> `owner?` | `string` | The token account's owner, which the read requires: a landed transaction whose balances name no owner cannot show whose account a transfer reached, so the search holds it as an item it could not decode, never another account. |

***

### SvmTx

A decoded wire transaction. `B` is what its bytes are backed by: `decodeSvmTx` gives `SvmTx<ArrayBuffer>`, each byte
field in its own fresh `ArrayBuffer`, and a function that reads one takes any backing.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `B` *extends* `ArrayBufferLike` | `ArrayBufferLike` |

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockhash-1"></a> `blockhash` | `Uint8Array`\<`B`\> | - |
| <a id="property-instructions"></a> `instructions` | readonly [`SvmInstruction`](#svminstruction)\<`B`\>[] | - |
| <a id="property-keys"></a> `keys` | readonly `Uint8Array`\<`B`\>[] | The static account keys, in order. |
| <a id="property-message"></a> `message` | `Uint8Array`\<`B`\> | Exactly the bytes every signer signed. |
| <a id="property-signatures"></a> `signatures` | readonly `Uint8Array`\<`B`\>[] | - |

***

### SvmV1Header

The form of a version-1 message's header, which carries the compute budget in place of Compute Budget
instructions: the compute unit limit, the priority fee in lamports for the limit at the budget's price per unit,
rounded up, and the loaded-account-data limit.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-loadedaccountsdatasizelimit"></a> `loadedAccountsDataSizeLimit` | `number` | The loaded-account-data limit the header carries, in bytes. |
| <a id="property-zeropriorityfee"></a> `zeroPriorityFee` | `boolean` | Whether the header carries a priority fee of 0 lamports; otherwise a fee of 0 is left out. |

## Type Aliases

### ChannelStatus

> **ChannelStatus** = [`SvmStatus`](#svmstatus)

A channel opening's read: the answer `svmStatus` gives.

***

### SolanaNetwork

> **SolanaNetwork** = `` `solana:${string}` ``

CAIP-2: `solana:` and 32 base58 characters.

***

### SvmCloseRef

> **SvmCloseRef** = `object`

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel-1"></a> `channel` | `string` | - |
| <a id="property-network-2"></a> `network` | [`SolanaNetwork`](#solananetwork) | - |
| <a id="property-payee-1"></a> `payee` | `string` | The option's payee. |
| <a id="property-phase"></a> `phase` | `"close"` | - |
| <a id="property-program-2"></a> `program` | `string` | - |
| <a id="property-transaction-1"></a> `transaction` | `string` | - |

***

### SvmCloseStatus

> **SvmCloseStatus** = [`SvmStatus`](#svmstatus)

A reported close's read, as the profile `read-status` answers it: the answer `SvmStatus` names.

***

### SvmCommitment

> **SvmCommitment** = `"confirmed"` \| `"finalized"`

A commitment an RPC call names: `finalized`, the mark, or `confirmed`, a block a supermajority of the cluster voted
on, which is the latest head the search for H and the lookups read on to before a `failed`, and no mark.

***

### SvmMark

> **SvmMark** = `"finalized"`

The one Solana mark: `finalized`, a block at maximum lockout, the default and the final mark. A seller names it
alone, and a caller asks for it alone.

***

### SvmQuery

> **SvmQuery** = [`StatusQuery`](index.md#statusquery)\<[`SvmRef`](#svmref), `bigint`, [`SvmMark`](#svmmark), [`SvmCursor`](#svmcursor)\>

What a Solana status read takes with the reference and the reader.

***

### SvmStatus

> **SvmStatus** = [`StatusAnswer`](index.md#statusanswer)\<`bigint`, [`SvmMark`](#svmmark), [`SvmCursor`](#svmcursor)\>

A Solana settlement read, as the profile `read-status` answers it, the position a slot and the one mark `finalized`.
A `settled` answer states `presented`: `yes` where the landed message is the one the reference holds, by its digest,
or, for a payment presented as a transaction alone, where the act is that transaction; `no` otherwise; never
`unshown`, since the read decodes every message it settles on. A `pending` or `failed` answer that names a
transaction met only above the final head names no finality.

## Variables

### ATA\_PROGRAM

> `const` **ATA\_PROGRAM**: `"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"` = `"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"`

The Associated Token Account program id.

***

### COMPUTE\_BUDGET

> `const` **COMPUTE\_BUDGET**: `"ComputeBudget111111111111111111111111111111"` = `"ComputeBudget111111111111111111111111111111"`

The Compute Budget program id.

***

### MEMO\_V3

> `const` **MEMO\_V3**: `"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"` = `"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"`

An SPL Memo program id: a top-level instruction to it is a Memo instruction.

***

### MEMO\_V4

> `const` **MEMO\_V4**: `"Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH"` = `"Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH"`

An SPL Memo program id: a top-level instruction to it is a Memo instruction.

***

### OPEN\_DISCRIMINATOR

> `const` **OPEN\_DISCRIMINATOR**: `1` = `1`

***

### PAYMENT\_CHANNELS

> `const` **PAYMENT\_CHANNELS**: `"CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX"` = `"CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX"`

The payment-channels program id.

***

### RENT\_SYSVAR

> `const` **RENT\_SYSVAR**: `"SysvarRent111111111111111111111111111111111"` = `"SysvarRent111111111111111111111111111111111"`

The Rent sysvar id.

***

### SEAL\_DISCRIMINATOR

> `const` **SEAL\_DISCRIMINATOR**: `6` = `6`

***

### SETTLE\_AND\_SEAL\_DISCRIMINATOR

> `const` **SETTLE\_AND\_SEAL\_DISCRIMINATOR**: `4` = `4`

***

### SVM\_MAX\_CANDIDATES

> `const` **SVM\_MAX\_CANDIDATES**: `50` = `50`

The most candidates one pass of the search reads: lcp's own bound, since each candidate costs up to two
`getTransaction` calls, so one pass makes at most 100 lookups beside its 10 pages. A pass that meets more is not read
whole, and the next call resumes it.

***

### SVM\_SEARCH\_SHOWN

> `const` **SVM\_SEARCH\_SHOWN**: `false` = `false`

Whether a run has shown the fact the search's completeness rests on: that every transaction the buyer signs is listed
under its account's signatures (`getSignaturesForAddress`), which no run has shown yet. Until a run shows it,
a search read whole proves no absence (read-status rule 25): the read answers no `failed` but `before-position`, and
where it would answer `failed` it answers `pending`, `search-incomplete`. A later release sets it from that run.

***

### SYSTEM

> `const` **SYSTEM**: `"11111111111111111111111111111111"` = `"11111111111111111111111111111111"`

The System program id.

***

### TOKEN

> `const` **TOKEN**: `"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"` = `"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"`

The SPL Token program id.

***

### TOKEN\_2022

> `const` **TOKEN\_2022**: `"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"` = `"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"`

The SPL Token-2022 program id.

## Functions

### buildChannelMessage()

> **buildChannelMessage**(`i`): `Promise`\<`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)\>

The message for a channel instruction: `SetComputeUnitLimit`, `SetComputeUnitPrice`, the payment-channels
instruction with its accounts in the program's order, then one v3 Memo instruction when `memo` is given, as a v0
message; with `v1`, the same without the two Compute Budget instructions, as a version-1 message whose header
carries the budget (`compileV1`). The fee
payer is also the `open`'s rent payer and payee. A memo that is not a well-formed string (one holding a lone
surrogate has no UTF-8 form) is `svm/input-malformed`, with nothing built.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`ChannelBuildInput`](#channelbuildinput) |

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)\>

***

### buildSvmMessage()

> **buildSvmMessage**(`i`): `Promise`\<`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)\>

The versioned message bytes for a token payment: `SetComputeUnitLimit`, `SetComputeUnitPrice`, `TransferChecked`
from the payer's associated token account to the payee's, then one v3 Memo instruction whose data is the memo's
UTF-8 bytes, as a v0 message; with `v1`, the same without the two Compute Budget instructions, as a version-1
message whose header carries the budget (`compileV1`). No lookup tables. A memo that is not a well-formed string
(one holding a lone surrogate has no UTF-8 form) is `svm/input-malformed`, with nothing built.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`SvmBuildInput`](#svmbuildinput) |

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)\>

***

### channelInstruction()

> **channelInstruction**(`tx`): [`Refusal`](index.md#refusal) \| [`ChannelIx`](#channelix)

The transaction's one top-level payment-channels instruction, by its discriminator. A `tx` that is not a decoded
transaction is `svm/tx-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SvmTx`](#svmtx) |

#### Returns

[`Refusal`](index.md#refusal) \| [`ChannelIx`](#channelix)

***

### channelPda()

> **channelPda**(`a`): `string` \| [`Refusal`](index.md#refusal)

The channel PDA: seeds "channel", payer, payee, mint, signer, u64le(salt), u64le(openSlot).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | \{ `mint`: `string`; `openSlot`: `bigint`; `payee`: `string`; `payer`: `string`; `salt`: `bigint`; `signer`: `string`; \} |
| `a.mint` | `string` |
| `a.openSlot` | `bigint` |
| `a.payee` | `string` |
| `a.payer` | `string` |
| `a.salt` | `bigint` |
| `a.signer` | `string` |

#### Returns

`string` \| [`Refusal`](index.md#refusal)

***

### channelVoucherMessage()

> **channelVoucherMessage**(`channelId`, `cumulative`, `expiresAt`): `Uint8Array`\<`ArrayBuffer`\>

The 50 bytes a channel voucher signs: `56 01` ‖ channelId ‖ cumulative u64 LE ‖ expiresAt i64 LE. Throws TypeError
when the channel id is not a base58 key or a number is out of range.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channelId` | `string` |
| `cumulative` | `bigint` |
| `expiresAt` | `bigint` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

***

### decodeSvmTx()

> **decodeSvmTx**(`wire`): [`Refusal`](index.md#refusal) \| [`SvmTx`](#svmtx)\<`ArrayBuffer`\>

Decodes a legacy or v0 wire transaction of at most 1,232 bytes, or a v1 wire transaction (SIMD-0385) of at most 4,096
bytes; a longer one is `svm/tx-too-large`. Bytes that are not one well-formed transaction are `svm/tx-malformed`, as
is a v0 message with an address table lookup that names no index, which the runtime refuses ("each lookup table must
be used to load at least one account"), and a v1 message that SIMD-0385's sanitization refuses (`decodeV1`). Each
byte field is a copy, so none shares memory with `wire`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SvmTx`](#svmtx)\<`ArrayBuffer`\>

***

### findPda()

> **findPda**(`seeds`, `program`): [`Refusal`](index.md#refusal) \| \{ `address`: `string`; `bump`: `number`; \}

The program-derived address of `seeds` under `program`: for bumps 255 down to 0, the first
SHA-256(seeds ‖ bump ‖ program ‖ "ProgramDerivedAddress") that does not decompress to an Ed25519 point.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `seeds` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] |
| `program` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `address`: `string`; `bump`: `number`; \}

***

### isKey()

> **isKey**(`s`): `s is string`

True when `s` is a Solana public key: a base58 string of 32 to 44 characters that decodes to exactly 32 bytes. An
account address, a program id and a recent blockhash all take this form.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `s` | `unknown` |

#### Returns

`s is string`

***

### openInstructionData()

> **openInstructionData**(`a`): `Uint8Array`\<`ArrayBuffer`\>

The `open` instruction's data: `01` ‖ salt u64 ‖ deposit u64 ‖ gracePeriod u32 ‖ openSlot u64 ‖ one recipient
(`01000000` ‖ recipient ‖ bps 10 000 as u16), little-endian. 67 bytes. Throws TypeError on a value out of range.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `a` | \{ `deposit`: `bigint`; `gracePeriod`: `number`; `openSlot`: `bigint`; `recipient`: `string`; `salt`: `bigint`; \} |
| `a.deposit` | `bigint` |
| `a.gracePeriod` | `number` |
| `a.openSlot` | `bigint` |
| `a.recipient` | `string` |
| `a.salt` | `bigint` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

***

### openOf()

> **openOf**(`tx`, `program`): [`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `salt`: `bigint`; \}

The one top-level instruction of `program` whose data starts with `OPEN_DISCRIMINATOR`, with at least 33 bytes of
data and 6 accounts: its salt (data bytes 1–8, little-endian) and its channel (account 5). Else `svm/open-not-found`,
as is a channel named through an address lookup table: the message holds the table's address and an index, not the
account, and this function reads no table.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SvmTx`](#svmtx) |
| `program` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `salt`: `bigint`; \}

***

### sessionProof()

> **sessionProof**(`p`): `Uint8Array`\<`ArrayBuffer`\>

The UTF-8 of the core's `canonicalJson` of `{channelId, domain: "mpp-session-auth-v1", payer, sessionChallengeId}`.
Throws TypeError when `p` is not an object, or when its `channelId`, `payer` or `challengeId` is not a well-formed
string (one holding a lone surrogate has no UTF-8 form): it never returns a message the caller did not write.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `p` | \{ `challengeId`: `string`; `channelId`: `string`; `payer`: `string`; \} |
| `p.challengeId` | `string` |
| `p.channelId` | `string` |
| `p.payer` | `string` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\>

***

### solanaVoucher()

> **solanaVoucher**(`channelId`, `cumulative`, `expiresAt?`): `Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

The 50 bytes a voucher signs: `56 01` ‖ channel id ‖ cumulative u64 LE ‖ expiresAt i64 LE (0 when absent). A
malformed channel id or an out-of-range number is `svm/input-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channelId` | `string` |
| `cumulative` | `bigint` |
| `expiresAt?` | `bigint` |

#### Returns

`Uint8Array`\<`ArrayBuffer`\> \| [`Refusal`](index.md#refusal)

***

### svmCarrier()

> **svmCarrier**(`tx`): [`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `memo`: `string`; \}

The one top-level Memo instruction (v3 or v4) and the ATR hash its UTF-8 data carries in LCP string form. None, or
more than one, is `svm/memo-count`. The memo must be `toLcpString(h)` exactly, in lowercase hex; the same hash in
any other spelling is `svm/carrier-not-canonical`. A `tx` that is not a decoded transaction is `svm/tx-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SvmTx`](#svmtx) |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `h`: `` `0x${string}` ``; `memo`: `string`; \}

***

### svmChannelStatus()

> **svmChannelStatus**(`ref`, `reader`, `query`): `Promise`\<[`SvmStatus`](#svmstatus)\>

The read of a channel opening that carries H (`x402/upto/solana`, `x402/batch-settlement/solana`, `mpp/session/solana/memo`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) |
| `reader` | [`SvmReader`](#svmreader) |
| `query` | [`SvmQuery`](#svmquery) |

#### Returns

`Promise`\<[`SvmStatus`](#svmstatus)\>

***

### svmDigest()

> **svmDigest**(`tx`): `Promise`\<`` `0x${string}` ``\>

SHA-256 over the message bytes every signer signed. Rejects with a TypeError when `tx` is not an object whose
`message` is a `Uint8Array`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SvmTx`](#svmtx) |

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### svmOpeningStatus()

> **svmOpeningStatus**(`ref`, `reader`, `query`): `Promise`\<[`SvmStatus`](#svmstatus)\>

The read of a named channel opening at coverage `none` (`mpp/session/solana/stock`): the opening the reference names
is the act, whether or not it carries H, and the read makes no search.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) |
| `reader` | [`SvmReader`](#svmreader) |
| `query` | [`SvmQuery`](#svmquery) |

#### Returns

`Promise`\<[`SvmStatus`](#svmstatus)\>

***

### svmRecover()

> **svmRecover**(`input`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Zero-party recovery: the ATR hash in the landed transaction's one memo, read by `tx`, the transaction's signature, at
`finalized`; `option`, the x402 option or MPP challenge the ATR's binding slot holds, must be an object, and no
member of it is read. A transaction that landed with an error at `finalized` is `svm/err`; one the read at
`confirmed` alone holds, with an error or none, is `svm/not-final`, a read to repeat, since a block not yet finalized
can be replaced. A landed wire that does not decode is `svm/unreadable`. An input or option that is not an object,
and a `tx` that is not a signature, are `svm/wrong-reader`, with nothing read. One or two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`RecoverInput`](index.md#recoverinput)\<`` `solana:${string}` ``, [`PaymentRequirements`](x402.md#paymentrequirements) \| [`MppChallenge`](mpp.md#mppchallenge)\> |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### svmStatus()

> **svmStatus**(`ref`, `reader`, `query`): `Promise`\<[`SvmStatus`](#svmstatus)\>

The read of a transfer pairing (`x402/exact/solana`, the three MPP charges, `mpp/subscription/solana`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) |
| `reader` | [`SvmReader`](#svmreader) |
| `query` | [`SvmQuery`](#svmquery) |

#### Returns

`Promise`\<[`SvmStatus`](#svmstatus)\>
