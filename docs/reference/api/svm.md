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
| <a id="property-memo"></a> `memo?` | `string` | The one Memo v3 instruction's text; absent, the message carries no memo. |
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

### SvmReader

Bounded, read-only calls against one network's endpoint. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | `` `solana:${string}` `` |

#### Methods

##### blockhashValid()

> **blockhashValid**(`blockhash`): `Promise`\<`boolean`\>

`isBlockhashValid` at commitment `confirmed`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `blockhash` | `string` |

###### Returns

`Promise`\<`boolean`\>

##### firstAvailableBlock()

> **firstAvailableBlock**(): `Promise`\<`bigint`\>

`getFirstAvailableBlock`: the lowest slot whose block the node still holds.

###### Returns

`Promise`\<`bigint`\>

##### signatures()

> **signatures**(`address`, `page`): `Promise`\<readonly `object`[]\>

`getSignaturesForAddress`, newest first. `memo` is the RPC's rendering of the transaction's memos (`[len] text`,
joined by `; `), or null when it has none.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `address` | `string` |
| `page` | \{ `before?`: `string`; `limit`: `1000`; \} |
| `page.before?` | `string` |
| `page.limit` | `1000` |

###### Returns

`Promise`\<readonly `object`[]\>

##### transaction()

> **transaction**(`signature`, `commitment`): `Promise`\<[`SvmLanded`](#svmlanded) \| `null`\>

`getTransaction`; null when none is found at that commitment.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `string` |
| `commitment` | `"finalized"` \| `"confirmed"` |

###### Returns

`Promise`\<[`SvmLanded`](#svmlanded) \| `null`\>

***

### SvmRef

The read keys recorded at claim. `blockhash` is empty for a durable-nonce transaction, which never expires.

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-blockhash"></a> `blockhash` | `string` | - |
| <a id="property-channel-1"></a> `channel?` | `string` | The channel account the transaction creates, for an opening that carries no memo: the search pages this address's signatures instead of the fee payer's, and reads each one as a candidate. |
| <a id="property-digest"></a> `digest` | `` `0x${string}` `` | - |
| <a id="property-feepayer-2"></a> `feePayer` | `string` | - |
| <a id="property-fromslot"></a> `fromSlot` | `string` | The slot read at claim, as a decimal string. |
| <a id="property-network-1"></a> `network` | `` `solana:${string}` `` | - |
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

> **SvmCloseStatus** = \{ `commitment`: `"confirmed"` \| `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"err"` \| `"not-a-close"`; \}

***

### SvmStatus

> **SvmStatus** = \{ `commitment`: `"confirmed"` \| `"finalized"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"err"` \| `"not-this-instrument"` \| `"no-transfer"`; \}

## Variables

### ATA\_PROGRAM

> `const` **ATA\_PROGRAM**: `"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"` = `"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### COMPUTE\_BUDGET

> `const` **COMPUTE\_BUDGET**: `"ComputeBudget111111111111111111111111111111"` = `"ComputeBudget111111111111111111111111111111"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### MEMO\_V3

> `const` **MEMO\_V3**: `"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"` = `"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### MEMO\_V4

> `const` **MEMO\_V4**: `"Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH"` = `"Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### OPEN\_DISCRIMINATOR

> `const` **OPEN\_DISCRIMINATOR**: `1` = `1`

***

### PAYMENT\_CHANNELS

> `const` **PAYMENT\_CHANNELS**: `"CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX"` = `"CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### RENT\_SYSVAR

> `const` **RENT\_SYSVAR**: `"SysvarRent111111111111111111111111111111111"` = `"SysvarRent111111111111111111111111111111111"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### SEAL\_DISCRIMINATOR

> `const` **SEAL\_DISCRIMINATOR**: `6` = `6`

***

### SETTLE\_AND\_SEAL\_DISCRIMINATOR

> `const` **SETTLE\_AND\_SEAL\_DISCRIMINATOR**: `4` = `4`

***

### SYSTEM

> `const` **SYSTEM**: `"11111111111111111111111111111111"` = `"11111111111111111111111111111111"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### TOKEN

> `const` **TOKEN**: `"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"` = `"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

***

### TOKEN\_2022

> `const` **TOKEN\_2022**: `"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"` = `"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"`

Solana rail pieces: the wire transaction, its one Memo instruction carrying the ATR hash in LCP string form, the
digest of the message the payer signed, and settlement read through a bounded reader.

## Functions

### buildChannelMessage()

> **buildChannelMessage**(`i`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

The v0 message for a channel instruction: `SetComputeUnitLimit`, `SetComputeUnitPrice`, the payment-channels
instruction with its accounts in the program's order, then one v3 Memo instruction when `memo` is given. The fee
payer is also the `open`'s rent payer and payee.

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
is the memo's UTF-8 bytes. No lookup tables.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `i` | [`SvmBuildInput`](#svmbuildinput) |

#### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)\>

***

### channelInstruction()

> **channelInstruction**(`tx`): [`Refusal`](index.md#refusal) \| [`ChannelIx`](#channelix)

The transaction's one top-level payment-channels instruction, by its discriminator.

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
data and 6 accounts: its salt (data bytes 1–8, little-endian) and its channel (account 5). Else `svm/open-not-found`.

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

H's first 8 bytes read as a little-endian u64, so the salt's encoded bytes are exactly those 8 bytes.

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
more than one, is `svm/memo-count`.

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
discriminator is `open` (1) or `top_up` (3). At most two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) & `object` |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<[`ChannelStatus`](#channelstatus)\>

***

### svmCloseStatus()

> **svmCloseStatus**(`ref`, `reader`): `Promise`\<[`SvmCloseStatus`](#svmclosestatus)\>

Reads a reported close at `finalized`, then `confirmed`: a top-level instruction of `program` whose data byte 0 is
`settleAndSeal` (channel at account 1) or `seal` (channel at account 0) naming the channel is settled; any other
landed transaction is failed `not-a-close`. At most two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmCloseRef`](#svmcloseref) |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<[`SvmCloseStatus`](#svmclosestatus)\>

***

### svmDigest()

> **svmDigest**(`tx`): `Promise`\<`` `0x${string}` ``\>

SHA-256 over the message bytes every signer signed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `tx` | [`SvmTx`](#svmtx) |

#### Returns

`Promise`\<`` `0x${string}` ``\>

***

### svmLocate()

> **svmLocate**(`ref`, `reader`, `h`, `status?`): `Promise`\<\{ `complete`: `boolean`; `found?`: `string`; \}\>

Finds the instrument when no transaction was named: pages the fee payer's signatures, newest first, down to
`fromSlot`, at most 10 pages of 1,000. A signature is a candidate only when its memo carries `h` in LCP string form.
With `channel` in the reference, it pages that account's signatures instead, and every signature is a candidate.
Each candidate is read through `status`, the pairing's own (`svmStatus` when none is given), at most 50 per pass.
`complete` is true only when the node's first available block is at or before `fromSlot`, the pages reached
`fromSlot` within those bounds, and every candidate was read: a listed candidate whose transaction reads pending
leaves the search incomplete.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `ref` | [`SvmRef`](#svmref) | `undefined` |
| `reader` | [`SvmReader`](#svmreader) | `undefined` |
| `h` | `` `0x${string}` `` | `undefined` |
| `status` | (`ref`, `reader`) => `Promise`\<\{ `state`: `string`; `why?`: `string`; \}\> | `svmStatus` |

#### Returns

`Promise`\<\{ `complete`: `boolean`; `found?`: `string`; \}\>

***

### svmRecover()

> **svmRecover**(`ref`, `reader`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

Zero-party recovery: the ATR hash in the landed transaction's one memo. One or two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: `` `solana:${string}` ``; `transaction`: `string`; \} |
| `ref.network` | `` `solana:${string}` `` |
| `ref.transaction` | `string` |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### svmStatus()

> **svmStatus**(`ref`, `reader`): `Promise`\<[`SvmStatus`](#svmstatus)\>

Reads a named transaction's settlement. It must be the message the payer signed (by digest), must have executed
without error, and must carry a token or SOL transfer. A failed read, or a reader for another network, is pending.
At most two calls.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`SvmRef`](#svmref) & `object` |
| `reader` | [`SvmReader`](#svmreader) |

#### Returns

`Promise`\<[`SvmStatus`](#svmstatus)\>
