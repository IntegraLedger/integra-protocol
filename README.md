# Legal Context Protocol — open layer

Reference implementation of the open layer of the **Legal Context Protocol (LCP)**: the record format,
the verification walk, the settlement bindings for ten chains, the reference placements for nine agentic
commerce protocols, and the conformance corpus that decides whether an independent implementation agrees
with this one.

LCP is co-stewarded by **Integra Ledger** and **AAA-ICDR**. The specification is published at
[legalcontextprotocol.org/standard](https://legalcontextprotocol.org/standard); this repository is an
implementation of it, not the specification itself.

## The problem

When two parties transact, the terms they agreed to and the payment that settled it live in different
systems and are joined by nothing durable. Reconstructing "what did we actually agree, and does this
payment correspond to it?" means correlating a document store against a ledger, months later, by hand.

When one or both parties is an autonomous agent, that reconstruction stops being merely expensive. An
agent that signs terms it did not verify has committed its principal to an obligation nobody read.

LCP makes the join mechanical. The terms document is hashed to an **ATR hash**; that hash is carried in a
field the settlement itself commits to — an EIP-3009 `nonce`, a Solana memo, a Stellar muxed address, a
Cardano metadata label. Recovering the hash from a settlement and recomputing it from a terms document
are both deterministic, so the correspondence either holds or it does not, and anyone can check.

## Install

Packages publish to **npmjs.com** under the `@integraledger` scope at `access: public`. No `.npmrc`, no
registry line and no token:

```bash
npm install @integraledger/lcp-kernel
```

Every release builds a CycloneDX SBOM over the resolved dependency graph and retains it as a build
artifact for a year — long enough that a disclosure reaching back past ninety days still finds it.

### What `0.9.0` means

Every package here is at **0.9.0**, and the number is a statement rather than an accident. This is a release
candidate for 1.0: the implementation is complete against LCP v1.38 and certified by the conformance
corpus on every commit. It is not a preview, and it is not a first draft.

It is not `1.0` because **the distance left to travel is the specification's, not the implementation's.** LCP
is stewarded by a committee that has not yet frozen the standard, and a `1.0` from the reference
implementation would claim a stability the protocol has not promised. Publishing `1.0` ahead of that would
be the reference implementation quietly ratifying the spec, which is not its job.

What that means for you, concretely:

- **Within `0.9.x`**, breaking changes to the wire format, the verification verdicts or the conformance
  corpus will not ship. Patches are fixes and additions.
- **A minor bump — `0.9.0` to `0.10.0` — may break you**, and under semver's `0.x` rule your package manager
  already treats it that way: `^0.9.0` resolves inside `0.9.x` and will not cross to `0.10`. Pin with that
  in mind.
- **Every break is recorded** in the affected package's `CHANGELOG.md`, with the reason, not just the diff.
- **`1.0` arrives when the specification does.** It will not be a marketing decision.

The class of change most likely to force a minor bump is a corpus change — a new case, or a rule that
tightens what a conformant implementation must refuse. That is deliberate: the corpus is the contract, and a
contract that could tighten silently inside a patch would be worth less than one that cannot.

## Build a record, then verify it

An ATR is one canonical JSON document. `assemble` compiles it and hashes its exact bytes:

```ts
import { assemble, hashAtr } from "@integraledger/lcp-kernel";

const { atrBytes, atrHash } = await assemble([
  { slot: "terms", ref: "lcp:sha256:0xaaaa…" }, // the terms document, by content hash
  { slot: "id", value: "0x3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f" },
  { slot: "parties", value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" } },
]);

atrHash;                             // 0xdebb86b9…  the fingerprint the settlement will carry
await hashAtr(atrBytes) === atrHash;  // true — recomputable by anyone holding the bytes
```

`verify` walks a record and reports what it could establish:

```ts
import { verify } from "@integraledger/lcp-verify";

declare const atrBytes: Uint8Array;      // the assembled ATR bytes, from the fence above
declare const atrHash: `0x${string}`;   // its fingerprint

const report = await verify({
  asOf: "2026-07-27T00:00:00Z",
  coverage: { ports: [], bindings: ["evm-x402"] },
  atrBytes,
  settledAtrHash: atrHash,
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

Read that output carefully, because it is the design. **`verified` is `false`, and that is the correct
answer** — a structural walk over inputs that were never supplied has proved two things and cannot speak
to five. Each unproved step says *why* it could not be attempted rather than reporting a bare failure, and
an absent input never becomes a pass. Raising `verified` requires `depth: "mechanical"`, where the walk
has live ports and the value becomes an honest function of what they returned.

`supportedClass` is a readout of how much of the record is actually evidenced, on a ladder from `TC-0`
(nothing established) up to `TC-4`. It is computed from the steps alone: the highest class every one of
whose required rungs is `proved`, and `TC-0` the moment any step fails. Here it is `TC-0` because
`resolve-party` never proved, and identity is a `TC-1` rung — two proved rungs do not make a class if they
are not the class's own. `claimedClass` sits beside it carrying what the caller said the record was shaped
for, and the walk cannot change that; where the two differ, the record did not reach its own shape.

A report is serialized with [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical JSON, so two
independent verifiers holding the same inputs emit byte-identical bytes.

## Documentation

[**docs/developer/**](docs/developer/index.md) is the full documentation: what the model is, and how to do
things with it. This README is the overview; the package READMEs are the API reference.

| | |
|---|---|
| [Getting started](docs/developer/getting-started.md) | Install a package, assemble an ATR, hash it, verify it. |
| [Concepts](docs/developer/index.md#concepts) | The [ATR](docs/developer/concepts/atr.md) · the [verification walk](docs/developer/concepts/verification-walk.md) · [welds](docs/developer/concepts/welds.md) · [bindings vs placements](docs/developer/concepts/bindings-vs-placements.md) · [authority](docs/developer/concepts/authority.md) · [discovery](docs/developer/concepts/discovery.md) · [evidence](docs/developer/concepts/evidence.md) · [conformance](docs/developer/concepts/conformance.md) |
| [Guides](docs/developer/index.md#guides) | [Run conformance](docs/developer/guides/run-conformance.md) against your own implementation · [verify a settlement](docs/developer/guides/verify-a-settlement.md) · [implement a binding](docs/developer/guides/implement-a-binding.md) · [add a placement](docs/developer/guides/add-a-placement.md) |
| [Package reference](docs/developer/reference.md) | All 31 published packages, one line each, linked to their READMEs. |

Read the concepts in order the first time — they build on each other.

## Conformance

The corpus is the arbiter of whether another implementation agrees with this one. It ships inside the
package, so running it requires nothing else:

```bash
npx @integraledger/lcp-conformance
```

Vectors are declarative JSON: an operation, an input, and the expected output or the expected typed error
code. A subject adapter drives an implementation under test — `InProcessSubject` for a JavaScript library,
`CliSubject` for anything that speaks the CLI protocol over stdio, in any language.

## The host governs

One convention governs every binding and placement in this repository. The source states it above the
placement manifest type, where every consumer of that seam reads; it is stated here too because it explains
more of what follows than any other single rule.

**Where a host protocol's own live specification and LCP's informative Appendix C disagree, the host wins.**
Appendix C is an illustration of how a reference *can* ride on a given protocol; it is not a licence to
assert a shape that protocol has not defined. A manifest that declares a field the host does not have, or a
spelling no counterparty emits, produces something no counterparty can read — and a manifest is the thing a
stranger acts on. So a placement describes what the host actually specifies today, records any divergence
from Appendix C in prose rather than encoding it, and leaves unbuilt forward paths unbuilt.

The practical test: if honouring Appendix C would make a conformant host document invalid, or would put a
key on the wire that no implementation of that host reads, the host decides it and Appendix C yields.

## Requirement ids

The source, the vectors and some runtime strings cite short requirement ids — `IDN-3`, `RCS-5`,
`WLD-3`, `ATA-4` and their kin. **They are not LCP clause numbers**, and looking for
them in the specification will not find them — LCP is cited here by section (`§8.3.1`, `§C.2`), and anything
of the form `XXX-n` is from a different document.

They come from Integra's own functional specification of what a complete agent transaction requires — an
analysis that predates and motivates this implementation, organised into fourteen families:

| | | | |
|---|---|---|---|
| `IDN` identity | `ASP` authority to spend | `ATA` authority to accept terms | `TRM` the terms record |
| `RCS` recourse | `PAY` payment and settlement | `WLD` the transactional weld | `OFR` offer integrity |
| `FRC` fraud, risk, and compliance | `OPS` commercial operations | `DSC` discovery and reputation | `ORC` orchestration |
| `CMP` composition | `PRS` persistence and verification infrastructure | | |

They are kept because they are load-bearing in review: `WLD-3` names the recovery triple that
`BindingManifest.recovery` encodes, and `IDN-3` names the stated-assurance rule the verifier gates on, in
one token each. They are glossed here — rather than silently dropped or left unexplained — because a
citation a reader cannot resolve is worse than prose, and the family name plus this table is enough to read
any of them as what it is: a requirement Integra asserts, not a conformance obligation the standard imposes.

Nothing in this repository's behaviour depends on them. Where an id and an LCP section say different
things, the section governs, and where only an id is cited the claim is Integra's own.

## Packages

**Core** — the seven packages that make up the verification cone:

| Package | Role |
|---|---|
| [`kernel`](packages/kernel) | ATR assembly and hashing. Zero dependencies. |
| [`binding-core`](packages/binding-core) | The carrier codec and the `WeldAdapter` port the EVM rails implement |
| [`verify`](packages/verify) | The verification walk and its canonical report |
| [`authority`](packages/authority) | Delegated-authority chains, acceptance signatures, revocation |
| [`evidence`](packages/evidence) | Content-addressed evidence bundles, the hardened artifact resolver |
| [`discovery`](packages/discovery) | The `/.well-known/legal-context.json` document and its integrity check |
| [`conformance`](packages/conformance) | The corpus, the runner, and the subject adapters |

**Rail bindings** — thirteen bindings across ten chains. The three EVM rails implement `binding-core`'s
`WeldAdapter` port; the other ten expose a rail-native surface instead, because that port is EVM-shaped
(`SettlementRef.txHash` is `0x`-hex, `ChainReader` speaks `eth_getLogs`) and forcing a Sui digest or a
Daml contract id through it would misrepresent the rail. Each states which it is in its first docblock:

| Package | Chain | Carrier |
|---|---|---|
| [`binding-evm-x402`](packages/binding-evm-x402) | EVM | EIP-3009 `nonce` |
| [`binding-evm-escrow`](packages/binding-evm-escrow) | EVM | `PaymentInfo.salt` (authorize/capture) |
| [`binding-evm-mpp`](packages/binding-evm-mpp) | EVM | MPP `challenge.id`, which MPP's own required derivation carries into the EIP-3009 `nonce` |
| [`binding-tempo-mpp`](packages/binding-tempo-mpp) | Tempo | TIP-20 `transferWithMemo` `bytes32 memo` (indexed) |
| [`binding-solana`](packages/binding-solana) | Solana | SPL Memo instruction data |
| [`binding-stellar`](packages/binding-stellar) | Stellar | CAP-67 muxed-address `mux_id` |
| [`binding-sui`](packages/binding-sui) | Sui | Pay402 `payment_id` argument |
| [`binding-aptos`](packages/binding-aptos) | Aptos | Move entry-call argument (overlay) |
| [`binding-cardano`](packages/binding-cardano) | Cardano | Transaction metadata label |
| [`binding-hedera`](packages/binding-hedera) | Hedera | HTS transaction memo |
| [`binding-xrpl`](packages/binding-xrpl) | XRPL | `Payment.InvoiceID` (the `Memos[].MemoData` path is read-only legacy) |
| [`binding-canton`](packages/binding-canton) | Canton | `LcpAnchor` Daml contract (overlay) — every deployment x402's Canton scheme cannot reach |
| [`binding-canton-x402`](packages/binding-canton-x402) | Canton | x402 `extra.memo`, echoed into the transfer metadata under `x402.memo` |

[`binding-evm-common`](packages/binding-evm-common) sits alongside them: shared EIP-712 / ERC-1271 / 6492
signature and event machinery that the three EVM bindings are built from. It implements no `WeldAdapter` of
its own and binds no chain by itself.

A binding is **native-field** where the chain already has a field the payer's signature commits to, and
**overlay-contract** only where it does not. The distinction is not cosmetic: a native-field binding
inherits the settlement's own authenticity, while an overlay binds through a contract someone deployed.
`binding-evm-mpp` is the one **id-reuse** binding: MPP's EVM charge method leaves no field free, so nothing
is placed — an input is supplied and the host protocol's own derivation does the binding.

A rail binding earns publication once its live proof has run green against a public network. All thirty-one
publishable packages publish to **npmjs at `access: public`** — the config states the intent; the registry
states the fact, and only a probe against it answers what is live right now.

**Reference placements** — where an LCP reference rides in a protocol document that never settles. A
placement is not a rail binding: it has no chain (`dependency-cruiser` enforces that), and a protocol can
have both — x402 does, and the two answer different questions.

| Package | Protocol | Tier | Carrier |
|---|---|---|---|
| [`placements`](packages/placements) | — | — | **the registry**: `placementFor`, `placementsByTier`, `supportedProtocols` |
| [`placement-x402`](packages/placement-x402) | x402 | A | `extensions.legalContext.info`, reading also `accepts[0].extra.atrHash` |
| [`placement-mpp`](packages/placement-mpp) | MPP | A | `methodDetails.atrHash` |
| [`placement-ap2`](packages/placement-ap2) | AP2 | A | `metadata.legalContext` on the transport envelope |
| [`placement-ack`](packages/placement-ack) | ACK | A | `credentialSubject.metadata.legalContext` |
| [`placement-acp`](packages/placement-acp) | ACP | A | session `metadata.legal_context`; the top-level `legal_context` is READ only — v1.38 §C.2 withdrew the write |
| [`placement-ucp`](packages/placement-ucp) | UCP | A | `policies[type=com.integraledger.policy.legal_context]`, reading also the `terms_of_service` link |
| [`placement-visa-tap`](packages/placement-visa-tap) | Visa TAP | A | `headers.x-lcp-hash` — the set's only `header-map` container, outside `Signature-Input` |
| [`placement-mastercard-vi`](packages/placement-mastercard-vi) | Mastercard VI | B | a custom Layer-2 constraint under the **deployment's own** reverse-DNS namespace — declaration only; `place` refuses unconditionally, per v1.38 §C.7 |
| [`placement-a2a`](packages/placement-a2a) | A2A | A | task `metadata.legalContext` |

`mcp` is a known protocol id with **no placement**, and that is terminal rather than pending: LCP §C.9 and
§10 describe an LCP-aware MCP *server*, which is a delivery surface and not a document field.

Import [`placements`](packages/placements) rather than a `placement-*` package directly — it is the one place
a protocol is registered, and `placementsByTier("A", deployment)` is how a deployment ships only what works
against stock, unmodified implementations.

## Development

```bash
pnpm install
pnpm verify          # versions → docblocks → live-rails → harness-proof → corpus-seal → audit → build
                     #   → dist → lint → depcruise → typecheck → docs → test
pnpm mutation <pkg>  # mutation score against that package's ratchet
```

`pnpm verify` is the gate, and it builds first because workspace packages consume each other through
built `dist/`. Every package is ESM-only, TypeScript `strict`, and compiled under `erasableSyntaxOnly`.

Mutation testing is a standing gate, not an occasional exercise: each package carries a score ratchet that
CI enforces. It exists because a test suite that never fails when the code is wrong is indistinguishable
from one that works, and coverage does not tell the two apart.

Dependencies between packages are enforced structurally by `dependency-cruiser` — the kernel is zero-dep,
chain SDKs are confined to their own binding, and no lower tier may import an upper one.

## Contributing

Implementation improvements — performance, clarity, portability — are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md).

Changes to protocol semantics, wire formats, or the conformance corpus are held to a different bar:
nothing enters the standard until it is battle-tested in production use, and standard-affecting changes
require steering-committee sign-off. That is policy rather than backlog. Every conformance vector is
load-bearing, so a change that alters a pinned vector must land the re-derived vector first, with the
derivation shown.

## Licence

[Apache-2.0](LICENSE). Trademark use is not granted by the licence (see Section 6).
