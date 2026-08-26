# @integraledger/lcp-binding-evm-escrow

Welds an ATR hash into an authorize-and-capture escrow settlement on EVM chains.

```bash
npm install @integraledger/lcp-binding-evm-escrow
```

| | |
|---|---|
| **Chain** | EVM |
| **Pattern** | `native-field` |
| **Carrier** | `PaymentInfo.salt` |
| **Surface** | `createEscrowAdapter` returning [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter` over a `ChainReader` |

Built on [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter` and
[`@integraledger/lcp-binding-evm-common`](../binding-evm-common#readme). Installing this package installs
**viem**.

```ts
import { atrHashFromSalt, createEscrowAdapter } from "@integraledger/lcp-binding-evm-escrow";
import type { VerifierPorts } from "@integraledger/lcp-binding-core";

declare const atrHash: `0x${string}`;
declare const ctx: Omit<
  import("@integraledger/lcp-binding-evm-escrow").PaymentInfo,
  "salt"
>;
declare const ports: VerifierPorts; // your viem-backed ChainReader + ArtifactResolver
declare const txHash: `0x${string}`;

const adapter = createEscrowAdapter({ chainId: 84532 });

// SERVICE OPERATOR — the PaymentInfo to submit, with `salt` filled from the atrHash.
const proposed = await adapter.propose(atrHash, ctx);

// VERIFIER — the atrHash back out of the settlement's PaymentAuthorized/PaymentCharged event.
const recovered = await adapter.recover({ chainId: 84532, txHash }, ports);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.

atrHashFromSalt(0n); // the inverse, for a salt you already hold
```

## The carrier

The ATR hash rides `PaymentInfo.salt` — an existing field the service already controls. No derivation,
no overlay contract.

**The ATR hash must be per-transaction.** `salt` is the struct's entropy source — *"a source of entropy to
ensure unique hashes across different payments"* — and an ATR hash carries none: it is deterministic and
identical for every payment made under one terms document. The escrow keys its state on the hash of the
whole `PaymentInfo` and refuses one it has already collected, so a repeat purchase under the same ATR with
the same payer, caps and expiries reverts on chain with `PaymentAlreadyCollected`. Nothing in this package
can detect that — the collision is between two transactions it never sees together. Mint a fresh ATR per
transaction, which LCP §6.1 wants anyway.

```ts
import { EVENT_TO_STATE } from "@integraledger/lcp-binding-evm-escrow";

EVENT_TO_STATE.PaymentCharged; // "charged"
```

## What it refuses rather than guesses

One escrow transaction can authorize or charge several independent payments, each with its own
`PaymentInfo` and therefore its own ATR hash. `recover` will not choose between them:

| Refusal | When |
|---|---|
| `escrow/ambiguous-settlement` | The transaction carries salt-bearing events with *different* salts and the `SettlementRef` pins no `logIndex`. Pin one. The same payment seen through both `PaymentAuthorized` and `PaymentCharged` carries one salt and resolves normally. |
| `escrow/log-index-not-found` | A pinned `logIndex` matches no salt-bearing event — a failure, never a fall-through to the first one. |
| `escrow/no-recoverable-event` | No `PaymentAuthorized`/`PaymentCharged` with a cleartext `PaymentInfo` in the settlement. |

Recovery is an **event-data scan**, not a topic filter: `paymentInfoHash` is the only indexed key and it
is not derivable from an ATR hash alone, so `enumerate` fetches the salt-bearing events over a range and
filters client-side. The manifest declares `forwardIndexable: false` for exactly that reason.

## Escrow is a mechanism, not our product

This package encodes calls to Coinbase's MIT-licensed `AuthCaptureEscrow` and collects its events. It
does not supply, operate, or price an escrow. What it contributes is the **record weld across authorize
and capture** — so that a payment authorized under one set of terms and captured later can still be shown
to correspond to those terms.

Lifecycle states are a discriminated union rather than a string enum, so an illegal state is not
constructible instead of being rejected at runtime.

## The drift guard

The constants this package ships — `PAYMENT_INFO_TYPEHASH`, and the `getHashOffchain` / `saltFromAtrHash`
derivations — are re-derived **weekly against the deployed `AuthCaptureEscrow`** on live Base mainnet and
Sepolia, in a lane held outside the default test run (per-mutant RPC storms are the reason). So a green
unit-test run says nothing about contract drift, and the weekly lane is what does.

That matters to you as a consumer because these are values you cannot check by reading: a typehash that
drifted from the deployed contract produces a well-formed hash that matches nothing on chain. The guard is
in the source repository rather than in this tarball, which is why the property is stated here rather than
the file path — you receive the constants and the fact that they are checked, not the checker.

## Requirement ids

This package's source and its messages cite short ids — `ATA-3`, `RCS-5`, `CMP-6` and their kin.
**They are not LCP clause numbers.** LCP is cited by section (`§8.3.1`, `§C.2`); anything shaped `XXX-n`
comes from Integra's functional specification of what a complete agent transaction requires, the fourteen
families below. Nothing in this package's behaviour depends on them, and where an id and an LCP section
disagree the section governs.

| | | | |
|---|---|---|---|
| `IDN` identity | `ASP` authority to spend | `ATA` authority to accept terms | `TRM` the terms record |
| `RCS` recourse | `PAY` payment and settlement | `WLD` the transactional weld | `OFR` offer integrity |
| `FRC` fraud, risk, and compliance | `OPS` commercial operations | `DSC` discovery and reputation | `ORC` orchestration |
| `CMP` composition | `PRS` persistence and verification infrastructure | | |

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
