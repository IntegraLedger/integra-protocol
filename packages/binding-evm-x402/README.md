# @integraledger/lcp-binding-evm-x402

Welds an ATR hash into an [x402](https://x402.org) instant settlement on any EVM chain.

```bash
npm install @integraledger/lcp-binding-evm-x402
```

| | |
|---|---|
| **Chain** | EVM |
| **Pattern** | `native-field` |
| **Carrier** | the EIP-3009 `nonce` |
| **Surface** | `createX402Adapter` returning [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter` over a `ChainReader` |

Built on [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter` and
[`@integraledger/lcp-binding-evm-common`](../binding-evm-common#readme)'s typed-data and event machinery.
Installing this package installs **viem**.

```ts
import { createX402Adapter, getX402Deployment } from "@integraledger/lcp-binding-evm-x402";
import type { VerifierPorts } from "@integraledger/lcp-binding-core";

declare const atrHash: `0x${string}`;
declare const from: string;
declare const payTo: string;
declare const ports: VerifierPorts; // your viem-backed ChainReader + ArtifactResolver
declare const txHash: `0x${string}`;

const d = getX402Deployment("base-sepolia"); // one of: base, base-sepolia, avalanche, monad
const adapter = createX402Adapter({
  chainId: d.chainId,
  asset: d.asset,
  tokenName: d.tokenName,
  tokenVersion: d.tokenVersion,
});

// PAYER — the EIP-3009 authorization plus the EIP-712 payload to sign. `nonce` IS the atrHash.
const proposed = await adapter.propose(atrHash, {
  from,
  payTo,
  amount: "1000000",
  validAfter: "0",
  validBefore: "99999999999",
});

// VERIFIER — the atrHash back out of the settlement's `AuthorizationUsed` log.
const recovered = await adapter.recover({ chainId: d.chainId, txHash }, ports);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

## The carrier

The ATR hash rides the EIP-3009 `nonce` — a field that already exists in the authorization the payer
signs. There is no derivation and no overlay contract: the payer's signature covers the nonce, so it
covers the ATR hash, and the binding inherits the settlement's own authenticity.

```ts
import { verifyInboundNonce } from "@integraledger/lcp-binding-evm-x402";

declare const presentedNonce: string;
declare const advertisedAtrHash: string;

const checked = verifyInboundNonce(presentedNonce, advertisedAtrHash);
if ("refused" in checked) console.log(checked.code); // "x402/nonce-mismatch" -> re-challenge
```

Recovery is a scan of `AuthorizationUsed` events on the nonce topic, so a settlement is
forward-indexable: given the ATR hash, the settlement that carried it can be found without knowing the
transaction in advance.

## What it refuses rather than guesses

Two settlements this binding will not answer for, because the honest answer is a refusal and the
convenient one is wrong:

| Refusal | When |
|---|---|
| `x402/not-eip3009-settlement` | The token moved and no `AuthorizationUsed` accompanied it. The payment settled — through `permit2` or `erc7710`, the other two asset-transfer methods x402's exact-EVM scheme defines, or another path that carries no payer-controlled nonce — so there is no weld to report. An empty transition list would say the opposite: that nothing settled. |
| `x402/ambiguous-settlement` | One transaction carries several `AuthorizationUsed` events with *different* nonces and the `SettlementRef` pins no `logIndex`. Answering either one would be a coin flip presented as a recovery. Pin one with `ref.logIndex`. Repeats of the *same* nonce are one weld seen twice, and resolve normally. |

`x402/asset-transfer-method-unsupported` is the propose-side counterpart: an offer requesting a non-EIP-3009 transfer
method is refused before it is signed, rather than settled unwelded.

## The inbound re-challenge

`verifyInboundNonce` is what makes the weld non-optional in practice. A client that settles with a nonce
that is not the advertised ATR hash is re-challenged rather than silently served — so an unwelded payment
does not quietly become a served request.

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
