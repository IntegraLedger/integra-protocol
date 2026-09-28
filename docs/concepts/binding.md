---
title: Binding
description: How the ATR hash rides in a payment, the binding patterns, and what each binding proves.
---

# Binding

**Binding** is how H rides in a pairing's payment: the field its specification defines. The seller places H where
the protocol or rail provides a place, and the buyer approves a payment that carries H, or carries a value from which
anyone holding the ATR can confirm exactly that H.

Binding is the whole of what this package checks about a payment. It never compares amount, payee, asset, timing or
payer with the ATR's content. A discrepancy between the payment and the record is between the parties, and the record
is what they agreed to.

## Where H rides

Each pairing places H in one field. Some examples, all from the package's own pairings:

| Pairing | Where H rides |
|---|---|
| `x402/exact/eip155/eip3009` | The `nonce` of the EIP-3009 authorization the payer signs. |
| `x402/exact/solana` | The option's `extra.memo`, written by the payer as the transaction's one Memo instruction. |
| `x402/exact/xrpl` | The Payment's `InvoiceID`, which is SHA-256 of H's LCP string. |
| `mpp/charge/evm/authorization` | The MPP challenge `id`, from which the signed nonce is derived. |
| `x402/batch-settlement/eip155` | The channel configuration's `salt`, which every signature in the channel signs. |
| `card/visa-tap` | An `lcp-hash` field covered by the agent's `agent-payer-auth` message signature. |

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

## What each binding proves

Each pairing's `pattern` record states what a payment through it shows, and never claims more:

| Field | Meaning |
|---|---|
| `pattern` | The binding pattern above. |
| `buyerSigns` | The buyer's signature covers H, or a value derived from H. |
| `onChain` | H itself is on chain after settlement. |
| `publicProof` | Settlement leaves a public record that commits to H. |
| `zeroPartyRecoverable` | H can be read back from the settled transaction alone, without either party (the pairing's `recover`). |
| `forwardIndexable` | A search by H finds the settlement. |
| `profile` | The LCP profile that defines the binding, where one does. The profiles ship in the package's [`profiles/`](../../lcp/profiles/). |
| `instrument` | `"landed"` where the buyer presents standing authority that is redeemed once per payment, so a payment is the transfer that lands. |
| `canonical` | A flag the record declares. Nothing in this package reads it. |
| `proves` | One paragraph stating what the payment shows and what it does not. |

Where the buyer's approval does not sign H, the record says so, and says what the payment does show. For example,
`x402/exact/eip155/permit2` states:

> The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 proxy as spender
> and the payee in the witness. Permit2 verified the signature when the proxy executed the transfer, and the hash is
> in the settlement transaction's calldata as the Permit2 nonce; no event carries it. This does not show that amount,
> payee, asset or timing match the ATR's content.

This example prints the pattern record of every pairing whose buyer does not sign H:

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
binding slot records every challenge's bound parameters as issued. H therefore commits to the payment options and the
request, as well as to the parties' content.

## Next

- [Pairings](./pairings.md): the members every pairing has.
- [Rails](../guides/rails.md): where H rides on each chain and payment network.
