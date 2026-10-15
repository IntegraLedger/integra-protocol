---
title: "@integraledger/lcp/svm"
description: "The exports of @integraledger/lcp/svm."
---

# @integraledger/lcp/svm

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

***

### ChannelIx

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel"></a> `channel` | `string` |
| <a id="property-data"></a> `data` | `Uint8Array` |
| <a id="property-kind"></a> `kind` | `"open"` \| `"top_up"` \| `"request_close"` |

***

### SvmBuildInput

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-amount"></a> `amount` | `bigint` |
| <a id="property-computeunitlimit-1"></a> `computeUnitLimit` | `number` |
| <a id="property-computeunitprice-1"></a> `computeUnitPrice` | `bigint` |
| <a id="property-decimals"></a> `decimals` | `number` |
| <a id="property-feepayer-1"></a> `feePayer` | `string` |
| <a id="property-memo-1"></a> `memo` | `string` |
| <a id="property-mint-1"></a> `mint` | `string` |
| <a id="property-payer-1"></a> `payer` | `string` |
| <a id="property-payto"></a> `payTo` | `string` |
| <a id="property-recentblockhash-1"></a> `recentBlockhash` | `string` |
| <a id="property-tokenprogram-1"></a> `tokenProgram` | `string` |

***

### SvmLanded

A landed transaction as `getTransaction` returns it with encoding `base64` and `maxSupportedTransactionVersion` 0.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-err"></a> `err` | `unknown` | - |
| <a id="property-inner"></a> `inner` | readonly `object`[] | `meta.innerInstructions`, flattened; `program` indexes the static keys, then `loaded.writable`, then `loaded.readonly`. |
| <a id="property-loaded"></a> `loaded` | `object` | - |
| `loaded.readonly` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] | - |
| `loaded.writable` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] | - |
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
`@integraledger/lcp/evm`; a rejected `transaction` reads as unreadable, and a rejected `account`,
`firstAvailableBlock` or `signatures` call counts as finding nothing. `transaction` answers `notFound` when the node
holds no such transaction at that commitment, with `slot`: the node's slot at that commitment (`getSlot`), read from
that same node before the lookup, so the lookup is at or past it, or null when the reader cannot read it from that
node. A lookup naming no slot never reads failed.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `solana:${string}` `` |

#### Methods

##### account()

> **account**(`address`): `Promise`\<\{ `slot`: `bigint`; `value`: \{ `data`: `Uint8Array`; `owner`: `string`; \} \| `null`; \}\>

`getAccountInfo` at commitment `finalized` with encoding `base64`: the response's context slot, and the account's
owner and data, or null when no account exists at that address.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |

###### Returns

`Promise`\<\{ `slot`: `bigint`; `value`: \{ `data`: `Uint8Array`; `owner`: `string`; \} \| `null`; \}\>

##### blockhashValid()

> **blockhashValid**(`blockhash`): `Promise`\<\{ `slot`: `bigint`; `valid`: `boolean`; \}\>

`isBlockhashValid` at commitment `confirmed`: `valid` is the response's `value` ("Whether the blockhash is still
valid at the evaluated slot"), and `slot` its context slot, the slot the node evaluated it at. No function in this
package calls it; it serves the caller's own verdict that a message with a blockhash reference never landed. A node
also answers false for a blockhash whose block it has not reached, so a false answer at a slot below `fromSlot` +
150, the bound `svmNonceMoved` sets for its read, shows nothing; the bound holds for a blockhash from a slot at or
before `fromSlot` + 150. From a false answer at or past that bound, the caller passes `slot` to `svmLocate` as
`minContextSlot`, so a node behind this read fails the search's call and the search is `complete` false; a search
given that slot and `complete` with nothing found shows the message never landed.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockhash` | `string` |

###### Returns

`Promise`\<\{ `slot`: `bigint`; `valid`: `boolean`; \}\>

##### firstAvailableBlock()

> **firstAvailableBlock**(): `Promise`\<`bigint`\>

`getFirstAvailableBlock`: the lowest slot whose block the node still holds.

###### Returns

`Promise`\<`bigint`\>

##### signatures()

> **signatures**(`address`, `page`): `Promise`\<readonly `object`[]\>

`getSignaturesForAddress`, newest first. `memo` is the RPC's rendering of the transaction's memos (`[len] text`,
joined by `; `), or null when it has none. When the page names `minContextSlot`, the reader passes it to the RPC as
`minContextSlot`, "the minimum slot that the request can be evaluated at", so a node that has not reached that slot
fails the call, and the reader rejects with `ReaderError`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |
| `page` | \{ `before?`: `string`; `limit`: `1000`; `minContextSlot?`: `bigint`; \} |
| `page.before?` | `string` |
| `page.limit` | `1000` |
| `page.minContextSlot?` | `bigint` |

###### Returns

`Promise`\<readonly `object`[]\>

##### transaction()

> **transaction**(`signature`, `commitment`): `Promise`\<[`SvmLanded`](#svmlanded) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

`getTransaction` at that commitment, or `notFound` with the node's slot there.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `string` |
| `commitment` | `"finalized"` \| `"confirmed"` |

###### Returns

`Promise`\<[`SvmLanded`](#svmlanded) \| \{ `notFound`: `true`; `slot`: `bigint` \| `null`; \}\>

***

### SvmRef

The read keys a seller keeps to read the settlement later: what `reference` returns, and `fromSlot`, which the seller
adds.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockhash"></a> `blockhash` | `string` | The recent blockhash whose expiry bounds the message's life; empty for a durable-nonce message, whose life is bounded by `nonce` instead. |
| <a id="property-channel-1"></a> `channel?` | `string` | The channel account the transaction creates, for an opening that carries no memo: the search pages this address's signatures instead of the fee payer's, and reads each one as a candidate. |
| <a id="property-digest"></a> `digest` | `` `0x${string}` `` | - |
| <a id="property-feepayer-2"></a> `feePayer` | `string` | - |
| <a id="property-fromslot"></a> `fromSlot` | `string` | The slot the seller read when it kept the reference, as a decimal string. |
| <a id="property-network-1"></a> `network` | `` `solana:${string}` `` | - |
| <a id="property-nonce"></a> `nonce?` | [`SvmNonce`](#svmnonce) | Present exactly when the message uses a durable nonce. |
| <a id="property-transaction"></a> `transaction?` | `string` | - |

***

### SvmTx

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockhash-1"></a> `blockhash` | `Uint8Array` | - |
| <a id="property-instructions"></a> `instructions` | readonly `SvmInstruction`[] | - |
| <a id="property-keys"></a> `keys` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] | The static account keys, in order. |
| <a id="property-message"></a> `message` | `Uint8Array` | Exactly the bytes every signer signed. |
| <a id="property-signatures"></a> `signatures` | readonly `Uint8Array`\<`ArrayBufferLike`\>[] | - |

## Type Aliases

### ChannelStatus

> **ChannelStatus** = [`SvmStatus`](#svmstatus) \| \{ `state`: `"failed"`; `why`: `"no-channel-instruction"`; \}

***

### SolanaNetwork

> **SolanaNetwork** = `` `solana:${string}` ``

CAIP-2: `solana:` and 32 base58 characters.

***

### SvmCloseRef

> **SvmCloseRef** = `object`

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channel-2"></a> `channel` | `string` |
| <a id="property-network-2"></a> `network` | [`SolanaNetwork`](#solananetwork) |
| <a id="property-phase"></a> `phase` | `"close"` |
| <a id="property-program"></a> `program` | `string` |
| <a id="property-transaction-1"></a> `transaction` | `string` |

***

### SvmCloseStatus

> **SvmCloseStatus** = \{ `commitment`: `"confirmed"` \| `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"` \| `"not-final"`; \} \| \{ `state`: `"failed"`; `why`: `"err"` \| `"not-a-close"`; \}

A reported close's read. Pending `not-final` is an error seen only at `confirmed`, as `SvmStatus` reads one, or a
close whose channel account, named through an address lookup table, is not the channel, seen only at `confirmed`.

***

### SvmStatus

> **SvmStatus** = \{ `commitment`: `"confirmed"` \| `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"` \| `"not-final"`; \} \| \{ `state`: `"failed"`; `why`: `"err"` \| `"not-this-instrument"` \| `"no-transfer"` \| `"nonce-moved"`; \}

A Solana settlement read. Pending `not-final` is a failure that rests on how the transaction executed (its `err`, or
the inner instructions a check reads), seen only at `confirmed`: a block that is not finalized can be replaced, and
the transaction can land in another block and execute otherwise, so only the read at `finalized` gives that failure.

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

> **buildChannelMessage**(`i`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

The v0 message for a channel instruction: `SetComputeUnitLimit`, `SetComputeUnitPrice`, the payment-channels
instruction with its accounts in the program's order, then one v3 Memo instruction when `memo` is given. The fee
payer is also the `open`'s rent payer and payee. A memo that is not a well-formed string (one holding a lone
surrogate has no UTF-8 form) is `svm/input-malformed`, with nothing built.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`ChannelBuildInput`](#channelbuildinput) |

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

***

### buildSvmMessage()

> **buildSvmMessage**(`i`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

The versioned (v0) message bytes for a token payment: `SetComputeUnitLimit`, `SetComputeUnitPrice`,
`TransferChecked` from the payer's associated token account to the payee's, then one v3 Memo instruction whose data
is the memo's UTF-8 bytes. No lookup tables. A memo that is not a well-formed string (one holding a lone surrogate
has no UTF-8 form) is `svm/input-malformed`, with nothing built.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`SvmBuildInput`](#svmbuildinput) |

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

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

> **channelVoucherMessage**(`channelId`, `cumulative`, `expiresAt`): `Uint8Array`

The 50 bytes a channel voucher signs: `56 01` ‖ channelId ‖ cumulative u64 LE ‖ expiresAt i64 LE. Throws TypeError
when the channel id is not a base58 key or a number is out of range.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channelId` | `string` |
| `cumulative` | `bigint` |
| `expiresAt` | `bigint` |

#### Returns

`Uint8Array`

***

### decodeSvmTx()

> **decodeSvmTx**(`wire`): [`Refusal`](index.md#refusal) \| [`SvmTx`](#svmtx)

Decodes a legacy or v0 wire transaction of at most 1,232 bytes.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `wire` | `Uint8Array` |

#### Returns

[`Refusal`](index.md#refusal) \| [`SvmTx`](#svmtx)

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

> **openInstructionData**(`a`): `Uint8Array`

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

`Uint8Array`

***

### openOf()

> **openOf**(`tx`, `program`): [`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `salt`: `bigint`; \}

The one top-level instruction of `program` whose data starts with `OPEN_DISCRIMINATOR`, with at least 33 bytes of
data and 6 accounts: its salt (data bytes 1–8, little-endian) and its channel (account 5). Else `svm/open-not-found`,
as is a channel named through an address lookup table: the message holds the table's address and an index, not the
account, and this function reads no table. `mpp/session/solana`'s `fetchPresented` reads an opening's tables.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SvmTx`](#svmtx) |
| `program` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `channel`: `string`; `salt`: `bigint`; \}

***

### sessionProof()

> **sessionProof**(`p`): `Uint8Array`

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

`Uint8Array`

***

### sessionSalt()

> **sessionSalt**(`h`): `bigint`

H's first 8 bytes read as a little-endian u64, so the salt's encoded bytes are exactly those 8 bytes. Throws
TypeError when `h` is not a 32-byte hash.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `h` | `` `0x${string}` `` |

#### Returns

`bigint`

***

### solanaVoucher()

> **solanaVoucher**(`channelId`, `cumulative`, `expiresAt?`): `Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

The 50 bytes a voucher signs: `56 01` ‖ channel id ‖ cumulative u64 LE ‖ expiresAt i64 LE (0 when absent). A
malformed channel id or an out-of-range number is `svm/input-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `channelId` | `string` |
| `cumulative` | `bigint` |
| `expiresAt?` | `bigint` |

#### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

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

> **svmChannelStatus**(`ref`, `reader`): `Promise`\<[`ChannelStatus`](#channelstatus)\>

`svmStatus` with the presence test replaced: exactly one top-level payment-channels instruction whose
discriminator is `open` (1) or `top_up` (3). The test reads only the signed message, so a transaction without it is
failed `no-channel-instruction` from a read at either commitment; an error is failed `err` only from the read at
`finalized`, and pending `not-final` from the read at `confirmed`. At most two calls, or five for a durable-nonce
reference: the two `transaction` reads, `account`, `firstAvailableBlock` and one more `transaction` at `finalized`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) & `object` |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<[`ChannelStatus`](#channelstatus)\>

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

### svmLocate()

> **svmLocate**(`ref`, `reader`, `h`, `status?`, `minContextSlot?`): `Promise`\<\{ `complete`: `boolean`; `found?`: `string`; \}\>

Finds the instrument when no transaction was named: pages the fee payer's signatures, newest first, down to
`fromSlot`, at most 10 pages of 1,000. A signature is a candidate only when its memo carries `h` in LCP string form,
matched without regard to case. With `channel` in the reference, it pages that account's signatures instead, and
every signature is a candidate. Each candidate is read through `status`, the pairing's own (`svmStatus` when none
is given), at most 50 per pass.
`complete` is true only when the node's first available block is at or before `fromSlot`, the pages reached
`fromSlot` within those bounds, and every candidate was read: a listed candidate whose transaction reads pending
leaves the search incomplete. A ref or reader that is not an object, or a reader for another network, is `complete`
false, with nothing read.

`minContextSlot` places the search no earlier than a read the caller made first, such as the nonce account read whose
context slot `svmNonceMoved` gives, or the `blockhashValid` read's `slot`: every page names it, so a node that has not
reached that slot fails the call and the search is `complete` false. A `minContextSlot` that is not a u64 bigint is
`complete` false, with nothing read.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `ref` | [`SvmRef`](#svmref) | `undefined` |
| `reader` | [`SvmReader`](#svmreader) | `undefined` |
| `h` | `` `0x${string}` `` | `undefined` |
| `status` | (`ref`, `reader`) => `Promise`\<\{ `state`: `string`; `why?`: `string`; \}\> | `svmStatus` |
| `minContextSlot?` | `bigint` | `undefined` |

#### Returns

`Promise`\<\{ `complete`: `boolean`; `found?`: `string`; \}\>

***

### svmNonceMoved()

> **svmNonceMoved**(`ref`, `reader`): `Promise`\<`bigint` \| `null`\>

The context slot of the nonce account read when that read shows the durable nonce `ref.nonce` records is spent or
gone, else null. The read is at `finalized`, and shows it at a context slot at least 150 slots past `fromSlot` when
it finds no account, an account the System program does not own, an account that is not an initialized nonce
account, or an initialized current-version nonce account holding another value. A legacy-version nonce account, a
read too early, a failed or malformed read, a reference without `nonce`, a ref or reader that is not an object and a
reader for another network are null. One call.

The message then can never land, and the transaction that used the nonce, when it landed, is final by that read. A
lookup shows a transaction absent only up to the slot its node had reached, so a lookup of the named transaction that
finds nothing shows the message never landed only from a node at or past that read's context slot, as `svmStatus`
reads it. With no transaction named, a `svmLocate` given this slot as `minContextSlot`, and complete with nothing
found, shows the message never landed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<`bigint` \| `null`\>

***

### svmRecover()

> **svmRecover**(`ref`, `reader`): `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

Zero-party recovery: the ATR hash in the landed transaction's one memo. A transaction that landed with an error is
`svm/err` when the read at `finalized` holds it, and `svm/not-final` when only the read at `confirmed` holds it, since
a block that is not finalized can be replaced. A landed wire that does not decode is `svm/unreadable`. A ref whose
`transaction` is not a signature, base58 of 64 bytes, is `svm/wrong-reader`, with nothing read. One or two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: `` `solana:${string}` ``; `transaction`: `string`; \} |
| `ref.network` | `` `solana:${string}` `` |
| `ref.transaction` | `string` |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>

***

### svmStatus()

> **svmStatus**(`ref`, `reader`): `Promise`\<[`SvmStatus`](#svmstatus)\>

Reads a named transaction's settlement. It must be the message the payer signed (by digest), must have executed
without error, and must carry a token or SOL transfer, a top-level or an inner instruction, whose program is read
from the static keys or from the addresses the transaction's lookup tables loaded. A message the payer did not sign
is failed `not-this-instrument` from a read at either commitment, since the signature fixes the message. An error, or
no transfer, rests on how the transaction executed, so it is failed (`err`, `no-transfer`) only from the read at
`finalized`, and pending `not-final` from the read at `confirmed`. A failed read, an answer of neither documented
shape (a landed wire that does not decode, `loaded` addresses other than 32-byte keys in the numbers the message's
lookups name, or a loaded address that repeats a static key or another loaded address, included), or a reader for
another network is pending `unreadable`. A ref whose `digest` is not a string is pending `unreadable`, with nothing
read. A durable-nonce transaction that is not found, once `svmNonceMoved` names a slot and the node's first available
block is at or before `fromSlot`, is read once more at `finalized`; when that lookup, naming a slot at or past the
context slot of the nonce account read, finds nothing, it is failed `nonce-moved`: the message can never land. A
lookup from a node behind that read, or naming no slot, is pending `not-found`. At most two calls, or five for a
durable-nonce reference.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) & `object` |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<[`SvmStatus`](#svmstatus)\>
