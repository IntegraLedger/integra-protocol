# @integraledger/lcp-binding-core

The carrier codec, and the `WeldAdapter` port the EVM rail bindings implement.

Two things live here, and nothing chain-specific does. The **carrier codec** encodes and decodes an LCP
reference across the three shapes the specification defines. The **`WeldAdapter` port** is the interface
the three EVM rail bindings satisfy, so a caller can weld a record to an EVM settlement without knowing
which of them it is on.

```bash
npm install @integraledger/lcp-binding-core
```

Depends only on [`@integraledger/lcp-kernel`](../kernel#readme) — no chain SDK, and `depcruise` holds it that way.

## The three carrier shapes

```ts
import {
  encodeLegalContextString, decodeLegalContextString,
  encodeLegalContextJson, encodeLegalContextBytes,
  type LegalContextRef,
} from "@integraledger/lcp-binding-core";

// Annotated, not inferred: a bare literal widens `type` to `string`, which is not a `CarrierType`.
const ref: LegalContextRef = { type: "sha256", value: "0x7f7f…" };

encodeLegalContextString(ref);  // "lcp:sha256:0x7f7f…"   — a string field
encodeLegalContextJson(ref);    // { legalContext: { type, value } } — a JSON field
encodeLegalContextBytes(ref);   // Uint8Array(32)        — a raw-bytes field

decodeLegalContextString("lcp:sha256:0x7f7f…"); // → { type, value }
```

Only `sha256` has a fixed-width byte form; asking for the byte carrier with any other type is a typed
refusal (`carrier/no-byte-form`) rather than a truncation.

## Unknown types are ignored; corrupt ones are not

```ts
import { decodeLegalContextString } from "@integraledger/lcp-binding-core";

decodeLegalContextString("lcp:unknown-type:whatever"); // undefined — ignored
decodeLegalContextString("lcp:sha256:");               // throws carrier/malformed
```

The `type` registry is **open**: an unrecognized type decodes to `undefined` and is skipped, so a rail
carrying a carrier type this version has never heard of does not break a verifier built against this
version. That is forward-compatibility, and it is deliberate.

A *recognized* type with a malformed or empty value is the opposite case — that is a corrupt carrier, and
it fails loudly. The distinction matters: silently ignoring a corrupt `sha256` carrier would report "no
legal context here" about a record that plainly has one.

Structure parsing and registry narrowing are separate functions, because they answer different questions.
`parseLcpString` splits the shape without consulting the registry; `decodeLegalContextString` then narrows
to known types.

## The `WeldAdapter` port

The three EVM rail bindings implement this interface — bind an ATR hash into a pre-settlement artifact,
recover it from a settled one, observe lifecycle transitions. Consumers depend on the port, not on any
chain SDK.

**It is not a universal port, and the nine non-EVM rails deliberately do not implement it.** Its shape is
EVM's: `SettlementRef.txHash` is a `0x`-hex value and `ChainReader` speaks `eth_getLogs`. A Sui
transaction digest, a Daml `contractId` or an XRPL memo cannot pass through that without lying about the
rail, so each of those bindings exposes a rail-native surface and says so in its first docblock. Unifying
the port across EVM and non-EVM is future work; pretending it is already unified would cost a consumer
more than it saves.

The dependency rule is enforced structurally rather than by convention: `dependency-cruiser` fails the
build if a chain SDK reaches outside its own binding package, so viem cannot leak into a Solana caller's
graph, and nothing in this package imports a chain library at all.

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
