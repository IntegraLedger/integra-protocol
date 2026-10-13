---
title: Binding
description: How the ATR hash rides in a payment, the binding patterns, and what each binding proves.
---

# Binding

**Binding** is how H rides in a pairing's payment: the field its specification defines. The seller places H where
the protocol or rail provides a place, and, where the pairing's `buyerSigns` is true, the buyer approves a payment that
carries H, or carries a value from which anyone holding the ATR can confirm exactly that H. Where its `claims` is false,
nothing in the payment is bound to H, and the agreement payment is the proof.

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
| `card/visa-tap` | An `lcp-hash` field covered by every `agent-payer-auth` message signature of the agent's request. |

The [pairings reference](../reference/pairings.md) gives every pairing with the sentence its record states.

## The patterns

Every pairing declares one binding pattern in its `pattern.pattern`. The six this package's pairings use:

| Pattern | What it means in this package's pairings |
|---|---|
| `native-field` | H itself, or its LCP string, sits in a field the protocol or rail defines: a nonce, memo, note, remark, salt, session id or invoice field. |
| `id-reuse` | An identifier the payment already carries is derived from H: MPP's challenge id through the signed nonce, an escrow's salt, the XRPL `InvoiceID`, or a card checkout's hash. |
| `opaque-challenge` | H rides in the challenge or checkout the seller issues, and what the buyer presents echoes it or commits to it. |
| `truncated-field` | A signed or landed field holds part of H: its first 8 bytes, or its low 250 bits. Anyone holding the ATR confirms H from it; nothing recovers H from it. An 8-byte part binds H only through those bytes: whoever assembles the ATR can construct a second ATR that shares them. |
| `protocol-extension` | H rides in a protocol extension: a field the agent's message signature covers, or an extension echoed on each request. |
| `http-advisory` | H and its link are advertised in the exchange, and nothing the buyer signs or the rail carries holds H. |

The `LcpPattern` type also names `overlay-contract` and `sidecar-attestation`. No pairing in this package uses them.

These names are this package's. `LCP §8.3` defines six settlement binding patterns: Native Field, Overlay Contract,
Sidecar Attestation, Opaque Challenge Parameter, Id-Reuse (Hashed Binding) and Protocol Extension. `truncated-field`
is the "truncated Native Field" of `LCP §8.3.8`, and `http-advisory` is the HTTP-Layer Advisory Reference of
`LCP §8.3.7`, which "is not one of the six patterns above; it is the no-binding baseline".

## What each binding proves

Each pairing's `pattern` record states what a payment through it shows, and never claims more:

| Field | Meaning |
|---|---|
| `pattern` | The binding pattern above. |
| `buyerSigns` | The buyer's signature covers H, or a value derived from H that no second ATR can feasibly be made to match: a part of 7 or 8 bytes does not count. |
| `onChain` | The binding is visible on a public ledger after settlement (`LCP §8.3`): the settlement carries H, part of it, or a value derived from it. |
| `publicProof` | Settlement leaves a public record that commits to H. Where that record holds only 8 bytes of H, or 7 bytes derived from the challenge id that carries H, it binds H only through those bytes: whoever assembles the ATR can construct a second ATR that shares them, and the pairing's `proves` says so. |
| `zeroPartyRecoverable` | H can be read back from the settled transaction alone, without either party (the pairing's `recover`). |
| `forwardIndexable` | A search by H finds the settlement. |
| `profile` | The LCP profile that defines the binding, where one does. The profiles ship in the package's [`profiles/`](../../lcp/profiles/). |
| `canonical` | A flag the record declares. Nothing in this package reads it. |
| `proves` | One paragraph stating what the payment shows and what it does not. Where `publicProof` is false, it opens with the agreement payment the buyer gate requires before the full payment, and the record fills in that payment's `<network>` and `<transaction>`. |

Where the buyer's approval does not sign H, the record says so, and says what the payment does show. For example,
`x402/exact/eip155/erc7710`, whose `buyerSigns` is `false`, states (the record fills in `<network>` and
`<transaction>`):

> Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on <network>,
> recorded in <transaction>. The ATR was assembled and delivered before the payment, and the buyer's payment payload
> echoed this ATR's hash in the legalContext entry of x402's extensions. The buyer's delegation does not sign the hash,
> and the settlement transaction does not carry it.

This example checks that some pairings' buyer does not sign H, `mpp/charge/stripe` among them:

```ts
import { BINDINGS } from "@integraledger/lcp";

const unsigned = BINDINGS.filter((b) => !b.pattern.buyerSigns).map((b) => `${b.id} (${b.pattern.pattern})`);
console.log(unsigned.length > 0, unsigned.includes("mpp/charge/stripe (opaque-challenge)"));
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
