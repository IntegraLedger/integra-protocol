---
title: "@integraledger/lcp/near"
description: "The exports of @integraledger/lcp/near."
---

# @integraledger/lcp/near

## Interfaces

### NearChoice

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) | - |
| <a id="property-accesskeynonce"></a> `accessKeyNonce` | `bigint` | `view_access_key`'s nonce for the key. |
| <a id="property-finalheight"></a> `finalHeight` | `bigint` | `block` at finality "final": its height. |
| <a id="property-payer"></a> `payer` | `string` | - |
| <a id="property-publickey"></a> `publicKey` | `string` | `ed25519:…` or `secp256k1:…`. |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) | - |

***

### NearOutcome

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-delegate"></a> `delegate` | \{ `argsBase64`: `string`; `nonce`: `bigint`; `publicKey`: `string`; `senderId`: `string`; \} \| `null` | - |
| <a id="property-receipts"></a> `receipts` | readonly `object`[] | - |
| <a id="property-status"></a> `status` | `string` | `final_execution_status`. |

***

### NearReader

Bounded, read-only calls against one network's RPC. Every failure rejects with `ReaderError`.

#### Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-network"></a> `network` | `readonly` | [`NearNetwork`](#nearnetwork) | - |
| <a id="property-relayers"></a> `relayers` | `readonly` | readonly `string`[] | The facilitator's `/supported` `signers["near:*"]`. |

#### Methods

##### accessKeyNonce()

> **accessKeyNonce**(`account`, `publicKey`): `Promise`\<`bigint` \| `null`\>

`view_access_key` at "final": the key's nonce; null: no such key.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `account` | `string` |
| `publicKey` | `string` |

###### Returns

`Promise`\<`bigint` \| `null`\>

##### finalHeight()

> **finalHeight**(): `Promise`\<`bigint`\>

`block` at finality "final": its header's height.

###### Returns

`Promise`\<`bigint`\>

##### txStatus()

> **txStatus**(`txHash`, `sender`): `Promise`\<[`NearOutcome`](#nearoutcome) \| `null`\>

`EXPERIMENTAL_tx_status` with `wait_until` "NONE"; null: unknown.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `txHash` | `string` |
| `sender` | `string` |

###### Returns

`Promise`\<[`NearOutcome`](#nearoutcome) \| `null`\>

***

### NearRef

The read keys recorded at claim, JSON-serialisable: `nonce` and `maxBlockHeight` are decimal strings. `transaction` is
added when the facilitator names it.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-asset"></a> `asset` | `string` |
| <a id="property-maxblockheight"></a> `maxBlockHeight` | `string` |
| <a id="property-network-1"></a> `network` | [`NearNetwork`](#nearnetwork) |
| <a id="property-nonce"></a> `nonce` | `string` |
| <a id="property-payer-1"></a> `payer` | `string` |
| <a id="property-publickey-1"></a> `publicKey` | `string` |
| <a id="property-transaction"></a> `transaction?` | `string` |

***

### NearUnsigned

#### Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-request"></a> `request` | `object` | SHA-256 of the NEP-461-prefixed delegate action: what the key signs. |
| `request.hash` | `Uint8Array` | - |
| `request.kind` | `"near-delegate"` | - |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| [`NearPayment`](#nearpayment)

Takes the key type (0 Ed25519, 1 secp256k1) and its 64- or 65-byte signature.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | \{ `bytes`: `Uint8Array`; `keyType`: `0` \| `1`; \} |
| `signature.bytes` | `Uint8Array` |
| `signature.keyType` | `0` \| `1` |

###### Returns

[`Refusal`](index.md#refusal) \| [`NearPayment`](#nearpayment)

## Type Aliases

### NearNetwork

> **NearNetwork** = `"near:mainnet"` \| `"near:testnet"`

x402's NEAR network identifiers.

***

### NearPayment

> **NearPayment** = [`X402Payment`](x402.md#x402payment)\<\{ `signedDelegateAction`: `string`; \}\>

***

### NearStatus

> **NearStatus** = \{ `finality`: `"final"` \| `"optimistic"`; `state`: `"settled"`; \} \| \{ `state`: `"pending"`; `why`: `"not-found"` \| `"in-flight"` \| `"unreadable"`; \} \| \{ `state`: `"failed"`; `why`: `"not-this-instrument"` \| `"transfer-failed"`; \}

## Variables

### exactNear

> `const` **exactNear**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`NearUnsigned`](#nearunsigned)\>; `carrier`: `null`; `claims`: `boolean`; `id`: `"x402/exact/near"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](x402.md#x402read); `recover`: (`ref`, `reader`) => `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>; `reference`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`NearRef`](#nearref)\>; `status`: (`ref`, `reader`) => `Promise`\<[`NearStatus`](#nearstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment); \}\]; `unplaced`: (`option`) => [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

***

### FT\_TRANSFER\_GAS

> `const` **FT\_TRANSFER\_GAS**: `30000000000000n` = `30_000_000_000_000n`

***

### NEP461\_DELEGATE

> `const` **NEP461\_DELEGATE**: `1073742190` = `1073742190`

The NEP-461 prefix for a delegate action: (1 << 30) + 366.

## Functions

### ftTransferArgs()

> **ftTransferArgs**(`payTo`, `amount`, `h`): `Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

`ft_transfer`'s arguments: `receiver_id`, `amount` and `memo`, in that order, as `JSON.stringify` writes them. A value
that is not a 32-byte hash is `x402/payload-malformed`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payTo` | `string` |
| `amount` | `string` |
| `h` | `` `0x${string}` `` |

#### Returns

`Uint8Array`\<`ArrayBufferLike`\> \| [`Refusal`](index.md#refusal)

***

### nearCarrier()

> **nearCarrier**(`signedDelegateAction`): [`Refusal`](index.md#refusal) \| \{ `asset`: `string`; `h`: `` `0x${string}` ``; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `payer`: `string`; `publicKey`: `string`; \}

Reads a base64 `SignedDelegateAction` whose one action is a `FunctionCall` of `ft_transfer` with a JSON object of
arguments whose `memo` is an LCP string. The bytes must be exactly the borsh encoding of what is read.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signedDelegateAction` | `string` |

#### Returns

[`Refusal`](index.md#refusal) \| \{ `asset`: `string`; `h`: `` `0x${string}` ``; `maxBlockHeight`: `bigint`; `nonce`: `bigint`; `payer`: `string`; `publicKey`: `string`; \}

***

### nearLapsed()

> **nearLapsed**(`ref`, `reader`): `Promise`\<`boolean`\>

True only when the delegate action can never execute: the final height is past `maxBlockHeight` and the key's
nonce is below the action's, or the key is gone. Two calls; a failed read is false.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`NearRef`](#nearref) |
| `reader` | [`NearReader`](#nearreader) |

#### Returns

`Promise`\<`boolean`\>

***

### nearRecover()

> **nearRecover**(`ref`, `reader`): `Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

Recovers the hash from the settlement transaction: the `memo` in its delegated `ft_transfer` arguments.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | \{ `network`: [`NearNetwork`](#nearnetwork); `transaction`: `string`; \} |
| `ref.network` | [`NearNetwork`](#nearnetwork) |
| `ref.transaction` | `string` |
| `reader` | [`NearReader`](#nearreader) |

#### Returns

`Promise`\<`` `0x${string}` `` \| [`Refusal`](index.md#refusal)\>

***

### nearStatus()

> **nearStatus**(`ref`, `reader`): `Promise`\<[`NearStatus`](#nearstatus)\>

Finds the relayed transaction under each published relayer (at most four), then requires its delegate to be this
instrument and reads the receipts the token contract executed: a failure is failed, a success is settled. A
failed read, an empty relayer list, or a reader for another network is pending.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ref` | [`NearRef`](#nearref) & `object` |
| `reader` | [`NearReader`](#nearreader) |

#### Returns

`Promise`\<[`NearStatus`](#nearstatus)\>

***

### pairingOf()

> **pairingOf**(`option`): `"x402/exact/near"` \| `undefined`

This pairing's id for an option it can pay, or undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `option` | [`PaymentRequirements`](x402.md#paymentrequirements) |

#### Returns

`"x402/exact/near"` \| `undefined`
