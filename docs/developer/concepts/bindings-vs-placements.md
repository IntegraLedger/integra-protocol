# Bindings and placements

A **binding** welds an ATR hash into a settlement that moves value. A **placement** puts an LCP reference
into a protocol document that never settles.

Both carry the same reference, produced by the same codec. What separates them is what the artifact
underneath is: one is a payment, the other is a message about a payment. Everything else — which package
you install, what a verifier may conclude, which rung of the class ladder is in reach — follows from that
one difference.

## The test

Ask one question of the artifact the reference is going into: **does this thing, by itself, move value?**

- **Yes** — an EVM transfer, a Solana SPL settlement, a Cardano transaction. That is a *settlement*, and
  a reference welded into a field it commits to is a **binding**. See [welds.md](welds.md).
- **No** — an x402 challenge, an A2A task, an ACP checkout session, an AP2 mandate envelope. That is a
  *protocol document*, and a reference written into one of its fields is a **placement**.

The question is about the artifact, not about the protocol. x402 is the clearest case: its HTTP challenge
is a document and its EVM settlement is a settlement, so x402 has both a binding
([`binding-evm-x402`](../../../packages/binding-evm-x402/README.md)) and a placement
([`placement-x402`](../../../packages/placement-x402/README.md)). They answer different questions about the
same transaction and neither substitutes for the other.

## Two ports, and what the second one deliberately lacks

Both ports live in [`binding-core`](../../../packages/binding-core/README.md), so the asymmetry is visible
in one file:

| | `WeldAdapter` | `ReferencePlacementAdapter` |
|---|---|---|
| Write | `propose(atrHash, ctx)` | `place(ref, doc)` |
| Read | `recover(ref, ports)` | `extract(doc)` |
| Lifecycle | `observe(ref, ports)` | — |
| Forward index | `enumerate(atrHash, ports)`, where declared | — |
| Ports | needs a chain reader | none — pure over a document |

A placement has no `observe` because there is no lifecycle without a settlement, no `recover(ref, ports)`
because no `SettlementRef` exists, and no `enumerate` because there is nothing to forward-index. Those
members are absent rather than present-and-throwing: a throwing body would be an implementation in name
only.

The manifests diverge for the same reason. A `BindingManifest` declares `recovery`, `indexing`, `finality`,
`weldGrades` and `lifecycleStates` — every one of them a statement *about a settlement*. A
`PlacementManifest` declares none of them, because a manifest carrying those fields with hollow values
would advertise properties nobody can check. What it declares instead is where the reference sits and what
a stock counterparty will do with it: `field`, `container`, `encoding`, `tier`, `carrierTypes`.

## Rails are scheme ids; protocols are a closed set

Two fields, two jobs, and conflating them is the specific bug the second field exists to prevent.

**`BindingManifest.rail`** is a **scheme id** — the string naming the rail a binding settles on. The
thirteen shipped rails, verbatim:

```text
evm:x402   evm:mpp   evm:escrow   tempo:mpp   canton:x402
solana     cardano   stellar      xrpl        hedera      sui   aptos   canton
```

The id is namespaced `family:shape` where one chain family carries more than one distinct settlement shape,
and bare where it carries one. EVM carries three — an x402 instant settlement, an MPP settlement, and an
authorize-and-capture escrow — so all three are namespaced, and `binding-evm-common` is shared machinery
that binds no chain and therefore has no scheme id at all. Everything else on the list settles one way, and
says so with a bare chain name.

**`BindingManifest.protocol`** is optional and draws from `ProtocolId`, a **closed** set of ten:

```text
x402   mpp   ap2   ack   acp   ucp   visa-tap   mastercard-vi   a2a   mcp
```

Optional because it is absent exactly when a binding is protocol-neutral. `evm:escrow` is a *mechanism* —
several protocols can settle through it — so it names no protocol, and the bare-rail bindings name none
either. Without a separate field, the only way to answer "which commerce protocol is this?" would be to
string-parse a scheme id, and for `evm:escrow` there would be no answer at all.

On a `PlacementManifest`, `protocol` is **required** and there is no `rail`. A document that never settles
rides no rail.

## Nine placements, one registry, and one deliberate absence

Import [`placements`](../../../packages/placements/README.md) rather than a `placement-*` package directly.
It is the one place a protocol id maps to its adapter, which makes adding a protocol a data edit in one
package instead of a change at every call site.

`placementFor` is total over the closed `ProtocolId` set, and "total" is doing precise work: every id gets
an answer, but the answers come in three shapes. **Eight ids return an adapter directly.**
**`mastercard-vi` returns one only when given a deployment** — its carrier sits under the deployment's own
reverse-domain namespace, which has no default, so `placementFor("mastercard-vi")` with no
`{ reverseDomain }` **throws** rather than silently answering `undefined`; an absence would be
indistinguishable from `mcp`'s, which means something else entirely. **`mcp` answers `undefined`**, and that
is a fact rather than a hole waiting for a `placement-mcp`. The specification puts
MCP's surface in the delivery layer — tools, resources, prompts and a capability negotiation map — and
names no document field for a reference to ride in. A delivery surface is not a placement, so `mcp`'s
absence from the registry is its correct terminal state.

Eight of the nine are **Tier A**: they work against stock, unmodified implementations of the host protocol
today. One — `mastercard-vi` — is **Tier B**, meaning it needs a coordinated change upstream before a stock
verifier would accept it, and it is **declaration-only**: the manifest records where the reference would sit
if the constraint type were registered, `extract` reads one a counterparty wrote, and `place` refuses
`mastercard-vi/tier-b-not-writable` on every document. That refusal is in the package's own code, not in the
kit — `tier` is a label the kit never reads, so a Tier-B placement that merely declared its tier would still
have shipped a writer. `placementsByTier("A")` never returns it either. Stating the tier is what keeps a
Tier-B carrier from being read as available-today; refusing the write is what stops it being one.

## Placing a reference, and reading it back

An A2A task is a protocol document: it coordinates work between agents and settles nothing. Placing a
reference into it makes the task say which record it was performed under, and changes nothing else about
the task.

```ts
import type { LegalContextRef } from "@integraledger/lcp-binding-core";
import { placementFor } from "@integraledger/lcp-placements";

const a2a = placementFor("a2a");
// `undefined` means this build genuinely has no placement for that id. For `a2a` it always has one.
if (a2a === undefined) throw new Error("a2a has no registered placement");

console.log(a2a.manifest.tier, a2a.manifest.encoding, a2a.manifest.field);

const ref: LegalContextRef = {
  type: "sha256",
  value: "0x437a46db8485b1b3552533d415ba6290a4e7d1ff4cb01e4e6eb7ef63d10748a5",
};
const task = { id: "task-1", metadata: { traceId: "abc" } };

const placed = a2a.place({ ref }, task);
if (!("ok" in placed)) throw new Error(placed.code);
console.log(JSON.stringify(placed.value));

// A verifier on the other side reads it back out of the document alone — no ports, no chain.
console.log(JSON.stringify(a2a.extract(placed.value)));

// A document carrying no reference REFUSES. It never answers with a placeholder.
console.log(JSON.stringify(a2a.extract(task)));

// `mcp` is a known protocol id with no field carrier — `undefined` is the answer, not a throw.
console.log(placementFor("mcp"));
```

```text
A reference-object metadata.legalContext
{"id":"task-1","metadata":{"traceId":"abc","legalContext":{"type":"sha256","value":"0x437a46db8485b1b3552533d415ba6290a4e7d1ff4cb01e4e6eb7ef63d10748a5"}}}
{"ok":true,"value":{"ref":{"type":"sha256","value":"0x437a46db8485b1b3552533d415ba6290a4e7d1ff4cb01e4e6eb7ef63d10748a5"},"termsUrl":{"kind":"no-field-declared"}}}
{"refused":true,"haltClass":"verification-failure","code":"a2a/reference-absent","detail":"no metadata.legalContext on this document"}
undefined
```

`place` is pure — it returns a new document and never mutates the one it was handed — and both members
return an `Outcome`, so a refusal is a value carrying a code and a halt class rather than an exception.

## What each one licenses a verifier to say

This is the part that matters downstream, and the walk draws the line itself.

A recovered weld becomes `settledAtrHash`, which is what `atr-fingerprint` compares against — the step that
carries `TC-2` and everything above it. A placement feeds the `reference-placement` step instead, which is
**reported but never required**: no class lists it, so its absence never blocks, and it impeaches only when
it *fails* — when the reference found in a protocol document names a different record than the one in hand.

The asymmetry is deliberate. A protocol that never settles has nothing to enumerate, and letting a
placement stand in for a settlement rung would let a record that moved no money read as classed. See
[verification-walk.md](verification-walk.md).

## Which package

| You have | You need | Where |
|---|---|---|
| A settlement on a chain | the rail's `binding-*` package | [reference.md § Bindings](../reference.md#bindings) |
| A host protocol's document | `placements`, then `placementFor(id)` | [reference.md § Placements](../reference.md#placements) |
| Neither yet, and you are adding a rail | `binding-core`'s `WeldAdapter` | [../guides/implement-a-binding.md](../guides/implement-a-binding.md) |
| Neither yet, and you are adding a protocol | `binding-core`'s placement kit | [../guides/add-a-placement.md](../guides/add-a-placement.md) |

The per-rail carrier fields, weld grades and recovery declarations are in [welds.md](welds.md), and each
package's README is its own detailed reference. Neither is restated here.

## What a placement is not

- **Not a weld.** It rides a document, not a movement of value. Whatever authenticated the document
  authenticated the reference; nothing authenticated a payment, because there was none.
- **Not a negotiation.** Placing a reference states which record this interaction is under. It commits
  nothing on the counterparty's behalf.
- **Not a host-protocol validator.** A placement writes and reads one declared field. Whether the rest of
  the document is conformant is the host protocol's own question.

## Where next

- [welds.md](welds.md) — the carrier field on each rail, weld grades, and what recovery can actually do.
- [verification-walk.md](verification-walk.md) — where `settledAtrHash` and `reference-placement` land in
  the report.
- [binding-core README](../../../packages/binding-core/README.md) — the carrier codec, the `WeldAdapter`
  port, and the placement kit both halves are built from.
- [placements README](../../../packages/placements/README.md) — the registry, the two registration shapes,
  and the tier selector.
