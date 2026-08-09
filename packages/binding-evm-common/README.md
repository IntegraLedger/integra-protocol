# @integraledger/lcp-binding-evm-common

Shared EVM machinery for the rail bindings: typed-data construction, signature verification, and
event decoding. This is not itself a rail binding — it is what [`@integraledger/lcp-binding-evm-x402`](../binding-evm-x402#readme),
[`@integraledger/lcp-binding-evm-escrow`](../binding-evm-escrow#readme) and [`@integraledger/lcp-binding-evm-mpp`](../binding-evm-mpp#readme) are built from.

```bash
npm install @integraledger/lcp-binding-evm-common
```

## Acceptance signatures

Implements the `SignatureVerifier` port that [`@integraledger/lcp-authority`](../authority#readme) declares, across four schemes:

| Scheme | How it verifies |
|---|---|
| `eip191` | Recovered offline — no chain access |
| `eip712` | Recovered offline — no chain access |
| `erc1271` | On-chain, through an injected viem client |
| `erc6492` | On-chain — counterfactual accounts not yet deployed |

The EOA schemes need no network, which is what lets the deterministic conformance vectors cover them.

```ts
import {
  type AcceptanceSignatureInput,
  type AcceptanceVerifyOpts,
  verifyAcceptanceSignature,
} from "@integraledger/lcp-binding-evm-common";

declare const acceptance: AcceptanceSignatureInput; // scheme: "eip191" | "eip712" | …
declare const smartAccountOpts: AcceptanceVerifyOpts; // { chainId, client } — a viem PublicClient

// EOA schemes need no network at all — no client, no chain id.
const ok = await verifyAcceptanceSignature(acceptance);

// The smart-account schemes do, and an absent client THROWS rather than answering `false`:
// "not verified" and "verified as forged" are different facts.
const onChain = await verifyAcceptanceSignature(acceptance, smartAccountOpts);
```

## Three outcomes, kept distinct

A malformed **configuration** throws — an absent chain id or a missing client is an integration error the
caller must fix. A malformed **record** throws — an unparseable timestamp is a different fact from a
forged signature, and letting it hide behind a bad-signature verdict would lose that. A malformed
**signature** returns `false` — recovery over forged bytes fails deep in curve math, and a verifier that
crashes on a forgery cannot report the forgery.

Collapsing any two of those into one another is how a verifier ends up reporting the wrong thing about
the one case it exists for.

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
