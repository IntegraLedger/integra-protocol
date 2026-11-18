---
title: "@integraledger/lcp/x402-exact-solana"
description: "The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement."
---

# @integraledger/lcp/x402-exact-solana

The `x402/exact/solana` pairing: the ATR hash placed as the option's `extra.memo` in LCP string form, written by the
payer as the transaction's one Memo instruction, read back from the signed message, and read from the settlement.

## Interfaces

### SvmChoice

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-computeunitlimit"></a> `computeUnitLimit?` | `number` |
| <a id="property-computeunitprice"></a> `computeUnitPrice?` | `bigint` |
| <a id="property-decimals"></a> `decimals` | `number` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-recentblockhash"></a> `recentBlockhash` | `string` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-tokenprogram"></a> `tokenProgram` | `string` |

***

### SvmUnsigned

What the payer signs, and how its signature completes the payment.

#### Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `P` | [`SvmPaymentPayload`](index.md#svmpaymentpayload) |

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-request"></a> `request` | `object` |
| `request.kind` | `"solana-message"` |
| `request.message` | `Uint8Array`\<`ArrayBuffer`\> |

#### Methods

##### complete()

> **complete**(`signature`): [`Refusal`](index.md#refusal) \| `P`

A 64-byte Ed25519 signature by the payer.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `signature` | `Uint8Array` |

###### Returns

[`Refusal`](index.md#refusal) \| `P`

## Variables

### exactSvm

> `const` **exactSvm**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmUnsigned`](#svmunsigned)\<[`SvmPaymentPayload`](index.md#svmpaymentpayload)\>\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/solana"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](aptos.md#x402read); `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`SvmRef`](svm.md#svmref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`SvmStatus`](svm.md#svmstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/solana`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator, the option's
`feePayer`, co-signs and sends the transaction the payer signed; `status` reads it.

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### SvmPaymentPayload

Re-exports [SvmPaymentPayload](index.md#svmpaymentpayload)

***

### X402Read

Re-exports [X402Read](aptos.md#x402read)
