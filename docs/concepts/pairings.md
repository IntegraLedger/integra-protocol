---
title: Pairings
description: A payment protocol, scheme and rail combination, the members every pairing has, and the registry.
---

# Pairings

A **pairing** is a payment protocol, scheme and rail combination, such as `x402/exact/eip155/eip3009`. Its id reads
from the protocol outward: the surface (`x402`), the scheme or intent (`exact`), then the rail and its method
(`eip155`, `eip3009`). Each pairing is one frozen object that carries the whole binding for that combination, on both
sides of the payment.

The package holds 67 pairings on seven surfaces: `x402`, `mpp`, `acp`, `ucp`, `ap2`, `ack` and `card`. The
[pairings reference](../reference/pairings.md) lists each one, generated from the registry.

## The members

Every pairing has these members, except that `mpp/charge/nearintents` has no `build`: the buyer's deposit carries
nothing of that pairing. The types differ per surface; the roles do not.

| Member | Side | What it does |
|---|---|---|
| `id` | both | The pairing's id. |
| `pattern` | both | The [binding record](./binding.md#what-each-binding-proves): the pattern and what a payment through this pairing proves. |
| `claims` | seller | `true` when what the buyer presents carries a value bound to H that `bound` reads; `false` when it does not, and a seller has nothing in the payment itself to match. |
| `unplaced(option)` | seller | The option as the seller issued it, before the pairing's carrier was placed in it. |
| `tie(...)` | seller | The ATR's binding slot: `[slot, value]`, the values that tie the record to this payment. |
| `advertise(doc, h, link, offer, agreementUrl?)` | seller | A copy of the challenge or checkout with H, the link and, where the pairing has one, the carrier placed. |
| `read(doc)` | buyer | H, the link, the agreement URL when one is present, and the options from an advertised document: on x402, those this pairing can pay; on MPP, every challenge, whatever its method, and `build` refuses another method's challenge. |
| `build(choice, h)` | buyer | What the buyer's signer signs, with H in its place, and a `complete` that turns the signature into the payment. |
| `bound(presented)` | seller | H as it appears in what the buyer presented. |

Pairings that settle on a rail the package can read also have:

| Member | What it does |
|---|---|
| `reference(presented)` | The read keys for finding this payment's settlement later: the network, and the log, transfer or transaction that carries H. |
| `status(ref, reader)` | The settlement's state, read through a bounded reader you supply: settled with its finality, pending, or failed with the reason. A `settled` answer at `latest` (EVM) or `head` (Polkadot, Tron) can be reorganised away; read it again until it is final: `finalized`, or `solidified` on Tron. On Sui it also takes `position`, the checkpoint from which you need the endpoint's history ([Reading settlement](../guides/rails.md#reading-settlement)). On Cardano it is `status(ref, reader, depth)`, with the depth at which you take a settlement as final ([Reading settlement](../guides/rails.md#reading-settlement)). |
| `recover(tx, reader)` | H read back from a settled transaction alone, where the rail keeps it (`pattern.zeroPartyRecoverable`). |
| `authorizer(presented)` | On an EVM pull pairing, the account whose signature authorises the pull. With the reference's `authorization`, it lets a reader ask the chain whether the authorization executed before any transaction is named. |

The Lightning pairings and `x402/exact/eip155/erc7710` have `reference` without `status`.

Some pairings carry members for their own shape of payment:

| Member | Where | What it does |
|---|---|---|
| `carrier` | some pairings | Where H is placed in the option or request, that field's path; `null` where nothing in the option carries it; on Hedera, the transaction field (x402) or `challenge` (MPP). |
| `channel` | channels, sessions and subscriptions | `kind` classifies a later payment as the opening, a payment within, or the close; `ref` names the channel; `boundWithin` reads H from a payment within, where one carries it; `until` gives the channel's end, where it has one. |
| `buildWithin` | channels and sessions | Builds a later payment within an open channel. |
| `closeRef` | the MPP sessions other than `mpp/session/lightning`, and `mpp/subscription/tempo` | The read keys of the channel's close. |
| `landedTx`, `fetchPresented` | push-mode pairings; `mpp/session/evm` has `landedTx` only, for an opening the payer broadcast, and `mpp/session/solana` has `fetchPresented` only | The transaction a credential names, and the credential completed with that landed transaction, written under the member `FETCHED` keys, the only one `bound` and `reference` read it from; `fetchPresented` refuses a landed transaction that failed. `mpp/session/solana`'s `fetchPresented` reads the opening's address lookup tables instead, and writes them under `FETCHED`. |
| `keySearch`, `keyProves` | `mpp/subscription/tempo` | The read keys of a transfer made under the subscription's access key, from the receipt that registered the key, and what the record proves for that transfer. |
| `network` | `mpp/charge/hedera` | The CAIP-2 network of a charge request: `methodDetails.chainId` 295 or 296, or, where it names none, the default it is given. |
| `advertiseBeforeCarrier` | pairings whose carrier the seller writes after H | `advertise`'s checks and placement, without the checks on that carrier. |

## The registry

`BINDINGS` holds every pairing. `pairingOf(option)` names the x402 pairing that serves an x402 option;
`pairingsOf(challenge)`, from `@integraledger/lcp/mpp`, names the MPP pairings a challenge offers.

```ts
import { BINDINGS, pairingOf } from "@integraledger/lcp";
import type { PaymentRequirements } from "@integraledger/lcp/x402";

const option: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};

console.log(pairingOf(option));
console.log(pairingOf({ ...option, extra: { ...option.extra, assetTransferMethod: "permit2" } }));
console.log([...new Set(BINDINGS.map((b) => b.id.split("/")[0]))].sort().join(" "));
```

```text
x402/exact/eip155/eip3009
x402/exact/eip155/permit2
ack acp ap2 card mpp ucp x402
```

## What no pairing serves

`pairingOf` returns `undefined` for an option no pairing serves, and each x402 pairing's `read` refuses a document in
which it can pay no option (`x402/no-payable-option`). Where a protocol gives the buyer nothing to sign, the
pairing says so instead of inventing a place: ACK's `build` and `bound` refuse `ack/no-signed-place`.

## Next

- [The buyer gate](./buyer-gate.md): what the buyer checks before `build`.
- [Seller](../guides/seller.md) and [Buyer](../guides/buyer.md): the members in order, in a working flow.
