---
title: "@integraledger/lcp/x402-exact-stellar"
description: "The exports of @integraledger/lcp/x402-exact-stellar."
---

# @integraledger/lcp/x402-exact-stellar

## Interfaces

### StellarPreconditionChoice

The buyer's inputs to `build`: the chosen option, the buyer's simulated transaction, the current ledger, and the
buyer's account (`G…`), which must be the simulated transfer's `from`.

#### Properties

| Property | Type |
| ------ | ------ |
| <a id="property-accepted"></a> `accepted` | [`PaymentRequirements`](x402.md#paymentrequirements) |
| <a id="property-currentledger"></a> `currentLedger` | `number` |
| <a id="property-payer"></a> `payer` | `string` |
| <a id="property-required"></a> `required` | [`PaymentRequired`](x402.md#paymentrequired) |
| <a id="property-simulatedxdr"></a> `simulatedXdr` | `string` |

## Variables

### exactStellarPrecondition

> `const` **exactStellarPrecondition**: `Readonly`\<\{ `advertise`: (`doc`, `h`, `link`, `offer`, `agreementUrl?`) => [`Refusal`](index.md#refusal) \| [`PaymentRequired`](x402.md#paymentrequired); `bound`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `broadcaster`: (`presented`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`Broadcaster`](index.md#broadcaster)\>; `build`: (`c`, `h`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarUnsigned`](stellar.md#stellarunsigned)\>; `claims`: `boolean`; `data`: [`PairingData`](index.md#pairingdata); `id`: `"x402/exact/stellar/precondition"`; `pattern`: [`LcpPattern`](x402.md#lcppattern); `read`: (`doc`) => [`Refusal`](index.md#refusal) \| `X402Read`; `recover`: (`input`, `reader`) => `Promise`\<[`Refusal`](index.md#refusal) \| `` `0x${string}` ``\>; `reference`: (`presented`, `option`) => `Promise`\<[`Refusal`](index.md#refusal) \| [`StellarRef`](stellar.md#stellarref)\>; `status`: (`ref`, `reader`, `query`) => `Promise`\<[`StellarStatus`](stellar.md#stellarstatus)\>; `tie`: (`accepts`, `request`) => \[`"x402"`, \{ `accepts`: readonly [`PaymentRequirements`](x402.md#paymentrequirements)[]; `request`: [`RequestCommitment`](x402.md#requestcommitment) \| [`ToolCallCommitment`](x402.md#toolcallcommitment); \}\]; `unplaced`: (`option`) => [`Refusal`](index.md#refusal) \| [`PaymentRequirements`](x402.md#paymentrequirements); \}\>

`x402/exact/stellar/precondition`. The payee broadcasts (`broadcaster` answers `"payee"`): the seller's settler
submits the transaction as its source; `status` finds it by the buyer's events and holds it to the five checks.

## References

### Broadcaster

Re-exports [Broadcaster](index.md#broadcaster)
