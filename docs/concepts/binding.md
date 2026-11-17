---
title: Binding
description: How the ATR hash rides in a payment, the binding patterns, and what each binding proves.
---

# Binding

**Binding** is how H rides in a pairing's payment: the field its specification defines. The seller places H where the
protocol or rail provides a place, and, where the pairing's `data.carrier.signed` names a field, the buyer approves a
payment that carries H, or carries a value from which anyone holding the ATR can confirm exactly that H. Where its
`data.coverage` is `none`, no public act the payer signs carries H, whatever the buyer approves, and the agreement
payment is the proof.

Binding is what this package checks about a payment, beside the form its rail or scheme requires and the bounds within
which it reads its input. It never judges amount, payee, asset, timing or payer, and never reads the parties' content
in the ATR. A discrepancy between what the parties agreed and what was paid is between them, and the record is what
they agreed to.

## Where H rides

Where H rides depends on the pairing. Some examples, all from the package's own pairings:

| Pairing | Where H rides |
|---|---|
| `x402/exact/eip155/eip3009` | The `nonce` of the EIP-3009 authorization the payer signs. |
| `x402/exact/solana` | The option's `extra.memo`, written by the payer as the transaction's one Memo instruction. |
| `x402/exact/xrpl` | The Payment's `InvoiceID`, which is SHA-256 of H's LCP string, in a Payment the payer signs with a single key. |
| `mpp/charge/evm/authorization` | The MPP challenge `id`, from which the signed nonce is derived. |
| `x402/batch-settlement/eip155` | The channel configuration's `salt`, which every signature in the channel signs. |
| `card/visa-tap` | The `nonce` of every `agent-payer-auth` message signature of the agent's request, the base64 of H and 32 random bytes, or the checkout path those signatures cover. |

The [pairings reference](../reference/pairings.md) gives every pairing with the sentence its record states.

## The patterns

Every pairing has a binding record, `pattern`, and every one but `x402/exact/starknet` names its binding pattern in
`pattern.pattern`. The five this package's pairings use:

| Pattern | What it means in this package's pairings |
|---|---|
| `native-field` | H itself, or its LCP string, sits in a field the protocol or rail defines: a nonce, memo, note, remark, salt, session id or invoice field. |
| `id-reuse` | An identifier the payment already carries is derived from H: MPP's challenge id through the signed nonce, an escrow's salt, the XRPL `InvoiceID`, or a card checkout's hash. |
| `opaque-challenge` | H rides in the challenge or checkout the seller issues, and what the buyer presents echoes it or commits to it. |
| `protocol-extension` | H rides in a protocol extension: a field the agent's message signature covers, or an extension echoed on each request. |
| `http-advisory` | H and its link are advertised in the exchange, and nothing the buyer signs or the rail carries holds H. |

The `LcpPattern` type also names `overlay-contract` and `sidecar-attestation`. No pairing in this package uses them.

These names are this package's. `LCP §8.3` defines six settlement binding patterns: Native Field, Overlay Contract,
Sidecar Attestation, Opaque Challenge Parameter, Id-Reuse (Hashed Binding) and Protocol Extension. `http-advisory` is
the HTTP-Layer Advisory Reference of `LCP §8.3.7`, which "is not one of the six patterns above; it is the no-binding
baseline".

## What each binding proves

Each pairing's `pattern` record names its binding pattern and where the binding is seen:

| Field | Meaning |
|---|---|
| `pattern` | The binding pattern above, where one of them names the binding. |
| `onChain` | The binding is visible on a public ledger after settlement (`LCP §8.3`): the settlement carries H or a value derived from it. |
| `zeroPartyRecoverable` | H can be read back from the settled transaction alone, without either party (the pairing's `recover`). |
| `forwardIndexable` | A search by H finds the settlement. |
| `profile` | The LCP profile that defines the binding, where one does. The profiles ship in the package's [`profiles/`](../../lcp/profiles/). |

Each pairing's `data` states what a payment through it shows, and never claims more. Its members are plain values,
typed `PairingData`:

| Member | Meaning |
|---|---|
| `coverage` | `full`: the payer's own signed act, on a public ledger, binds all of H, a 256-bit digest over a preimage that holds H, or on Starknet H's low 250 bits. `none`: no public payer-signed act carries H. |
| `carrier` | `signed`, the field of what the payer signs that carries H, or null; `member`, the path of the option or request member the seller writes H into, where it writes one. |
| `link` | At coverage `none`: whether the payment carries H (`h`), a pointer to its proof transaction (`pointer`), or neither (`none`), in a field that is no public proof. |
| `source` | Who writes H: lcp's client, or a stock client and release, with the member it copies H from. |
| `nonce` | Whether the identical instrument can land more than once: `single-use`, `reusable`, or `unshown` until a vector or a run shows single use. |
| `broadcasts` | The answers the pairing's `broadcaster` can give: `payee`, `payer` or `either`. |
| `read` | What a read of the pairing needs: the endpoint kind, the search key and its bound, the history, the contracts, the signed fact after which the payment can no longer land, and, where the rail bounds it, how long a signed payment stays payable. |
| `destination`, `asset`, `payer` | How each is identified in the landed transaction. |
| `agreementOn` | At coverage `none`: which agreement the charge can follow: `any`, one on the `same-network`, or one pairing's. |
| `confirmed` | Whether something outside this package has shown the form as its profile defines it. |
| `agreement` | Where the pairing's payment can itself be an agreement: the smallest amount, who pays the fee, and the fields that show it succeeded. |
| `proves` | One paragraph stating what the payment shows and what it does not. At coverage `none`, it opens with the agreement payment the buyer gate requires before the full payment, and the record fills in that payment's `<network>` and `<transaction>`. |

Where the buyer's approval does not sign H, the record says so, and says what the payment does show. For example,
`x402/exact/eip155/erc7710`, whose `data.carrier.signed` is null, states (the record fills in `<network>` and
`<transaction>`):

> Before this payment was taken, an account signed an agreement transaction carrying this ATR's hash on <network>,
> recorded in <transaction>; this shows neither that the account is the payer nor what the agreement moved. The ATR was
> assembled and delivered before the payment, and the payment payload echoed this ATR's hash in the legalContext entry
> of x402's extensions. The read found the named settlement transaction, after the agreement's position, holding a
> transfer from the payment's delegator to the payee. The delegation does not sign the hash, and the settlement
> transaction does not carry it.

This example checks that some pairings' buyer does not sign H, `mpp/charge/stripe` among them:

```ts
import { BINDINGS } from "@integraledger/lcp";

const unsigned = BINDINGS.filter((b) => b.data.carrier.signed === null).map((b) => `${b.id} (${b.data.coverage})`);
console.log(unsigned.length > 0, unsigned.includes("mpp/charge/stripe (none)"));
```

```text
true true
```

## Binding the request too

On x402, the ATR's binding slot also records the request the challenge answers: its method, path, query and a SHA-256
of its body (`requestCommitment`), beside every option the challenge offers, exactly as issued (`tie`). On MPP, the
binding slot records every challenge's bound parameters as issued, including the body's `digest` when the seller sets
one; MPP binds no HTTP method, path or query. H therefore commits to the payment options and the request, as well as to
the parties' content.

## Next

- [Pairings](./pairings.md): the members of a pairing.
- [Rails](../guides/rails.md): where H rides on each chain and on Lightning.
