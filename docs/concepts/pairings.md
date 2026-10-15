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
| `broadcaster(presented)` | seller | Who broadcasts what the buyer presented: `"payer"`, which sent it before presenting it, or `"payee"`, which sends or executes it after ([Who broadcasts](#who-broadcasts)). |

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
| `landedTx`, `fetchPresented` | `mpp/charge/tempo/push`, `mpp/charge/hedera`, `mpp/charge/solana`, `mpp/charge/stellar`, `mpp/charge/xrpl` and `mpp/session/hedera`; `mpp/session/evm` has `landedTx` only, for an opening the payer broadcast, and `mpp/session/solana` has `fetchPresented` only. Other pairings whose payer broadcasts have neither; see [Who broadcasts](#who-broadcasts) | The transaction a credential names, and the credential completed with that landed transaction, written under the member `FETCHED` keys, the only one `bound` and `reference` read it from; `fetchPresented` refuses a landed transaction that failed. `mpp/session/solana`'s `fetchPresented` reads the opening's address lookup tables instead, and writes them under `FETCHED`. |
| `keySearch`, `keyProves` | `mpp/subscription/tempo` | The read keys of a transfer made under the subscription's access key, from the receipt that registered the key, and what the record proves for that transfer. |
| `network` | `mpp/charge/hedera` | The CAIP-2 network of a charge request: `methodDetails.chainId` 295 or 296, or, where it names none, the default it is given. |
| `advertiseBeforeCarrier` | pairings whose carrier the seller writes after H | `advertise`'s checks and placement, without the checks on that carrier. |

## Who broadcasts

`broadcaster(presented)` answers who puts what the buyer presents on its rail, and so what the seller does next.
`"payer"`: the payer sent the payment before presenting it, and the seller reads the landed payment, through
`fetchPresented`, `status` or `recover` where the pairing has them; where no member reads it, the seller confirms it
outside the package. `"payee"`: the seller, or the facilitator or processor acting for it, sends or executes what the
payer presented, such as the signed transaction `complete` returns or an authorization, and reads its settlement after.
Each pairing's [API page](../reference/api/index.md) names the read or the execution that follows. The answer's type,
`Broadcaster`, is exported from the package root and from every entry point with pairings.

The members a pairing exports do not answer this. `mpp/session/solana` has `fetchPresented`, but it reads the
opening's address lookup tables, and the seller broadcasts the opening; on `mpp/charge/evm/hash` and
`mpp/charge/nearintents` the payer broadcasts, and neither has `landedTx` or `fetchPresented`.

`broadcaster` answers only for a payment of a type and kind the pairing takes, within the shape gate its `bound`
applies first, and gives any other payment the refusal `bound` gives that fault. Where a payment has a second fault
that `bound` finds first, in H or the challenge, the two codes differ. A session's or batch channel's `bound` reads the
opening alone, so for any other action the reader is `channel.kind`: a payment it refuses for its own content gets its
refusal (a batch channel reads the payload alone, under any `accepted` option), and one a session's `channel.kind`
refuses for what the challenge decides is answered. The shape gates are an MPP credential of `credentialOf`'s shape, at
most 64 KiB as JSON and 16 arrays and objects deep; an x402 v2 payment whose `accepted` is an object, and whose
`payload` is one too, except on `x402/exact/lnbtc`, `x402/exact/lnbtc/invoice-named` and
`x402/batch-settlement/cloudflare`, which read no payload; and an object, for the checkout and card pairings (on
`acp/checkout/delegated`, one whose `allowance` has ACP's members). Faults `bound` finds in anything else, such as H,
the challenge, an amount or a signature, do not change the answer, so `broadcaster` does not stand in for `bound`.
It is pure: it takes no reader and loads no peer. The pairings whose `bound` binds nothing and applies no gate
(`ack/payment-request`, `acp/checkout/undelegated`, `ucp/checkout/unsigned`, `ucp/booking/unsigned`,
`card/seller-reference`) answer for whatever is presented.

A pairing that reads a payload `type` or a session `action` refuses one it does not take with `bound`'s code:
`mpp/credential-type` on most MPP charges, `near/not-hash-credential` on `mpp/charge/nearintents`, and
`mpp/no-signed-place` on `mpp/charge/evm/transaction` and `mpp/charge/evm/hash`, whose `bound` binds nothing. A session
takes the actions its `channel.kind` takes, and refuses any other with the code its `bound` gives a credential that is
not an opening; an opening of a type its `bound` does not take gets `bound`'s code too. On `mpp/session/solana`, a close
that lacks the member its `voucherSigner` mode requires, or carries the one it forbids, gets `mpp/credential-malformed`,
as `channel.kind` refuses it; where `channel.kind` refuses the echoed challenge itself, the challenge decides, and
`broadcaster` answers. The EVM and Solana batch-settlement channels refuse a payload `type` their `channel.kind` does
not take with `x402/not-an-opening`, and the EVM channel refuses a refund whose `amount` is not a positive decimal below
2^128 with `x402/payload-malformed`, as `channel.kind` does. Both read the payload alone, so which option `accepted` is
does not change the answer.

Most pairings take payments of one path, and every payment they take gets one answer. These take more than one, and
answer by the payment's kind:

| Pairing | `"payer"` | `"payee"` |
|---|---|---|
| `mpp/charge/evm/transaction`, `mpp/charge/evm/hash` | `type` `hash` | `type` `transaction` |
| `mpp/charge/hedera`, `mpp/charge/xrpl` | `type` `hash` | `type` `transaction` |
| `mpp/charge/stellar` | `type` `hash`, where the request's `feePayer` is not true; under `feePayer` true MPP's Stellar charge forbids push mode, and a `hash` credential gets `mpp/credential-type` | `type` `transaction` |
| `mpp/charge/solana` | `type` `signature` | `type` `transaction` or `bundle` |
| `mpp/session/evm` | An opening or a top-up of `type` `hash`, and a voucher carrying an opening `deposit` of that `type`. No member reads the top-up, so the seller confirms it outside the package. | An opening or a top-up of `type` `authorization` or `permit2`, and a voucher carrying an opening `deposit` of either; any other voucher; the close. |
| `mpp/session/hedera` | The opening; a top-up, which no member reads, so the seller confirms it outside the package. | A voucher; the close. |
| `mpp/session/lightning` | The opening; a top-up; a bearer proof, which draws on the deposit the payer paid. | The close, whose refund the seller's node pays. |

```ts
import { isRefusal } from "@integraledger/lcp";
import { evmHash } from "@integraledger/lcp/mpp";

const challenge = { id: "x", realm: "api.seller.example", method: "evm", intent: "charge", request: "e30" };
console.log(await evmHash.broadcaster({ challenge, payload: { type: "hash", hash: `0x${"55".repeat(32)}` } }));
console.log(await evmHash.broadcaster({ challenge, payload: { type: "transaction", signature: "0x02" } }));
const refused = await evmHash.broadcaster("not a credential");
console.log(isRefusal(refused) && refused.code);
```

```text
payer
payee
mpp/credential-malformed
```

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
which it can pay no option (`x402/no-payable-option`, or the rail's `peer-missing` code when one of its own options
cannot be read without the rail's optional peer). Where a protocol gives the buyer nothing to sign, the
pairing says so instead of inventing a place: ACK's `build` and `bound` refuse `ack/no-signed-place`.

## Next

- [The buyer gate](./buyer-gate.md): what the buyer checks before `build`.
- [Seller](../guides/seller.md) and [Buyer](../guides/buyer.md): the members in order, in a working flow.
