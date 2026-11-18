---
title: "@integraledger/lcp/x402-upto-xrpl"
description: "The `x402/upto/xrpl` pairing: x402's `upto` scheme on the XRP Ledger, at coverage `none`, its payment following an agreement on the same network."
---

# @integraledger/lcp/x402-upto-xrpl

The `x402/upto/xrpl` pairing: x402's `upto` scheme on the XRP Ledger, at coverage `none`, its payment following an
agreement on the same network.

The payer opens a payment channel to the option's `payTo` itself and presents the channel and its own account, so
nothing it signs carries the ATR hash. Settlement is read from the channel's create.

## Interfaces

### UptoXrplPayload

What the payer presents: the channel's id, the maximum its claim signs, the claim's signature, the channel's
`PublicKey` and the channel's `Account` (`specs/schemes/upto/scheme_upto_xrpl.md:172-188` at x402 `88b66dd4`).

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-channelid"></a> `channelId` | `string` |
| <a id="property-maxamount"></a> `maxAmount` | `string` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-publickey"></a> `publicKey` | `string` |
| <a id="property-signature"></a> `signature` | `string` |

***

### UptoXrplPaymentPayload

A payment on `x402/upto/xrpl`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-extensions"></a> `extensions?` | `object` |
| <a id="property-payload"></a> `payload` | [`UptoXrplPayload`](#uptoxrplpayload) |
| <a id="property-resource"></a> `resource?` | `object` |
| `resource.url` | `string` |
| <a id="property-x402version"></a> `x402Version` | `2` |

## Variables

### uptoXrpl

> `const` **uptoXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/upto/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `reference`: (`presented`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplChannelRef`](xrpl.md#xrplchannelref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/upto/xrpl`. The payer broadcasts (`broadcaster` answers `"payer"`): its client submits the channel's create
before it presents the payment, and the payment names that channel. `status` reads the create
(`xrplChannelStatus`). It has no `build`, the payer's own client opening the channel, and no `recover`, nothing on
the ledger carrying H.

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
