---
title: "@integraledger/lcp/x402-exact-xrpl"
description: "The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the payer signs as the Payment's `InvoiceID`."
---

# @integraledger/lcp/x402-exact-xrpl

The `x402/exact/xrpl` pairing: the ATR hash's LCP string placed as the option's `extra.invoiceId`, whose SHA-256 the
payer signs as the Payment's `InvoiceID`.

The hash is read back from the signed blob, single-signed or multisigned, and settlement is read by the payer's
instrument, its `Account` with the signed `Sequence` or ticket.

## Interfaces

### XrplChoice

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-account"></a> `account` | `string` |
| <a id="property-fee"></a> `fee` | `string` |
| <a id="property-lastledgersequence"></a> `lastLedgerSequence` | `number` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-sequence"></a> `sequence` | `number` |
| <a id="property-ticketsequence"></a> `ticketSequence?` | `number` |

## Variables

### exactXrpl

> `const` **exactXrpl**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`XrplUnsigned`](xrpl.md#xrplunsigned)\<[`XrplPaymentPayload`](index.md#xrplpaymentpayload)\>\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/xrpl"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| [`X402Read`](aptos.md#x402read); `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`, `_given?`) => `Promise`\<[`Refusal`](index.md#refusal) \| `Omit`\<[`XrplRef`](xrpl.md#xrplref), `"fromLedger"`\>\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`XrplStatus`](xrpl.md#xrplstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/xrpl`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's facilitator submits the
signed `Payment` blob; `status` reads it by the payer's instrument (`xrplStatus`). `recover` returns the value the
landed `Payment` carries in H's place, its `InvoiceID`, the SHA-256 of H's LCP string, as `0x` and 64 lowercase hex
digits (`xrplInvoiceOf`): a digest is not read back to H, so a holder of the ATR computes the SHA-256 of its own
H's LCP string and compares the two.

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)

***

### X402Read

Re-exports [X402Read](aptos.md#x402read)

***

### XrplPaymentPayload

Re-exports [XrplPaymentPayload](index.md#xrplpaymentpayload)

***

### XrplQuery

Re-exports [XrplQuery](mpp.md#xrplquery)
