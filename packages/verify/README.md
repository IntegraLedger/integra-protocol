# @integraledger/lcp-verify

The verification walk, and the canonical report it emits.

`verify` takes the pieces of a record and reports, step by step, what it was able to establish. It is
**pure over its supplied inputs** — it opens no sockets and fetches nothing. The imperative shell that
gathers those inputs over live ports belongs to the caller, which is what makes this function
deterministic and testable against fixed vectors.

```bash
npm install @integraledger/lcp-verify
```

Built on [`@integraledger/lcp-kernel`](../kernel#readme),
[`@integraledger/lcp-binding-core`](../binding-core#readme) and
[`@integraledger/lcp-authority`](../authority#readme). No chain SDK: the ports are yours to supply, and
[`@integraledger/lcp-binding-evm-common`](../binding-evm-common#readme) is the EVM implementation of the
signature-verifier one.

## Use

```ts
import { verify, serializeReport } from "@integraledger/lcp-verify";

declare const atrBytes: Uint8Array;      // the exact ATR bytes the record was hashed over
declare const settledAtrHash: string;    // the atrHash recovered from the settlement

const report = await verify({
  asOf: "2026-07-27T00:00:00Z",
  coverage: { ports: [], bindings: ["evm-x402"] },
  atrBytes,
  settledAtrHash,
  settlements: [{ txHash: "0x1111…" }],
});
```

```
verified: false | claimedClass: TC-2 | supportedClass: TC-0
   atr-fingerprint          proved
   settlement-enumeration   proved
   buyer-acceptance         not-attempted   no-acceptance
   authority-attenuation    not-attempted   no-authority-chain
   commitment-vs-leaf       not-attempted   no-commitment
   recourse-elections       not-attempted   no-elections-recorded
   resolve-party            not-attempted   no-identity
```

## The four statuses, and why there are four

Most verifiers have two: pass and fail. That collapses two very different situations — *this is wrong*
and *I was not equipped to check this* — into one word, and a caller cannot tell them apart.

| Status | Meaning |
|---|---|
| `proved` | The step ran and held |
| `failed` | The step ran and did not hold — carries a halt class |
| `indeterminate` | The input exists but could not be retrieved |
| `not-attempted` | The input was never supplied — carries the reason |

**An absent input never becomes a pass.** An empty authority chain is `not-attempted`, never `proved`:
a record carrying no delegated authority at all must not clear the authority rung by supplying nothing.
A malformed chain is `not-attempted` too, with a different reason — unwalkable is a gap, not a
contradiction.

An acceptance presented without a signature verifier is `not-attempted("no-signature-verifier")`, because
a signature nobody checked is not evidence of a signature.

## `verified` is a verdict about a claim; `supportedClass` is a finding

At the default `depth: "structural"`, `verified` is **always** `false`. A structural walk is a
presence-and-absence readout; it cannot raise a verdict. Passing `depth: "mechanical"` — where the caller
has supplied live ports — lets `verified` become an honest function of the walk: true only when every
class-required step is `proved` and none `failed`.

`supportedClass` is different in kind: it is a FINDING, computed from the steps alone as the highest class
every one of whose required rungs is `proved`, and `TC-0` the moment any step fails. The claim neither caps
it nor lifts it — a record proving nothing reads `TC-0` however high the caller aimed, and one whose rungs
reach past the claim reads what they reach. `claimedClass` is echoed beside it so `verified`, which answers
"did the record reach the class it claimed?", can be read at all.

Step outcomes are depth-agnostic, so `depth` governs `verified` and never the class. A rung that is
`not-attempted` says something about this walk's inputs, not about the record — which is why the reason
rides each step and why `steps` is the thing to read before either summary.

A forged input cannot produce a `proved`. Signature verification that throws deep in curve math over
corrupted bytes is reported as a failure, not propagated as a crash — a verifier that dies on a forgery
cannot report the forgery, which is the one case it exists for.

## Byte-identical reports

```ts
import { serializeReport, type VerificationReport } from "@integraledger/lcp-verify";

declare const report: VerificationReport;

serializeReport(report); // RFC 8785 (JCS) canonical JSON
```

The protocol's promise is that independent verifiers holding the same inputs emit the same bytes. That
requires a canonical form, and RFC 8785 is precisely the multi-producer convergence case — including the
rule that integer-like keys sort by UTF-16 code unit rather than numerically.

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
