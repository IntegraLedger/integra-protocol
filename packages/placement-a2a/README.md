# @integraledger/lcp-placement-a2a

Places an LCP reference into an [A2A](https://a2a-protocol.org) (Agent-to-Agent Protocol) task, and reads it
back out.

**Integrity is Tier A today, with nothing negotiated.** A2A's `metadata` is a `google.protobuf.Struct` the
specification defines as free for custom keys, so the §8.1 reference object rides `metadata.legalContext`
against every conformant implementation on day one — no extension declared, no header activated, no
counterparty coordination. camelCase is canonical here and snake_case is the declared alias: the reverse of
`placement-acp`, because A2A's JSON wire is proto3 lowerCamelCase and the host protocol's conventions decide.

```bash
npm install @integraledger/lcp-placement-a2a
```

| | |
|---|---|
| **Chain** | none — A2A is a connectivity transport and settles nothing |
| **Pattern** | `http-advisory` (LCP §8.3.7, Tier A) |
| **Field** | `metadata.legalContext` — an `object-path`, keys case-sensitive |
| **Read also** | `metadata.legal_context` (integrity, same container, never written) |
| **Carrier types** | `sha256`, `url`, `ipfs`, `ar` — the whole §8.2 registry |
| **Spec** | `specification/a2a.proto` at `a2aproject/A2A@0ef1b02` — `main`, 2026-07-23; gate discharged **2026-07-30** |

## Use

```ts
import { A2A_PLACEMENT, a2aPlacement } from "@integraledger/lcp-placement-a2a";

declare const task: unknown; // an A2A Task/Message, as received

const placed = a2aPlacement.place({ ref: { type: "sha256", value: "0x…" } }, task);
const ref = a2aPlacement.extract(task);
```

Both members are total: a refusal is a returned value, never a thrown exception.

## Specification provenance — verified against the live host, 2026-07-30

Read against the host protocol's own live sources, never the appendix: `specification/a2a.proto`,
`docs/specification.md`, `docs/topics/extensions.md` and `docs/topics/extension-and-binding-governance.md` in
`a2aproject/A2A` at commit `0ef1b02`.

`0ef1b02` is `main`, dated **2026-07-23**. It is deliberately **not** the `v1.0.1` tag — that release is
2026-05-28 and points at `3303592`, two months earlier — and the two trees are not interchangeable:
`AgentInterface.url`'s comment was reworded at proto 337 to admit a gRPC `host:port` address, which shifts
every later line by one. **Every proto line number below is `0ef1b02`'s.**

1. **The field exists and is free.** `google.protobuf.Struct metadata = 6` on `Task` (proto line 183),
   commented "A key/value object to store custom metadata about a task". `docs/specification.md` §3.2.5 calls
   `metadata` "a flexible key-value map" whose values "can be any valid value that can be represented in
   JSON" (its sentence carries an upstream typo — "Metadata keys and are strings" — so it is quoted here in
   fragments rather than repaired inside quotation marks). No reserved keys, no length budget — hence the full
   carrier registry rather than ACP's two short forms.
2. **It survives the round trip.** The project's own reference implementation is generated from that proto:
   `a2a-python`'s `Task` carries `metadata: _struct_pb2.Struct` in its `__slots__`. A `Struct` is dynamic, so
   unknown keys are preserved rather than dropped the way a closed-schema object drops them.
3. **Tier A, because the protocol documents the map as free for custom use** — not because it appears to
   work. `pattern` is `http-advisory` (§8.3.7) and deliberately not `protocol-extension`: A2A does have a
   formal extensions framework, but §8.3.6 means the host's own procedure is atrHash-aware, which no A2A
   implementation is, and it is Tier B by definition — false of a carrier that works against stock A2A now.
4. **One locator covers all eight carriers.** Eight messages declare a `google.protobuf.Struct metadata`
   field, all the same free-form map: `Task` (183), `Part` (236), `Message` (272), `Artifact` (290),
   `TaskStatusUpdateEvent` (304), `TaskArtifactUpdateEvent` (321), `SendMessageRequest` (658) and
   `CancelTaskRequest` (723). `Task.id` is server-generated, so a client writes the `Message` it sends, the
   agent writes the `Task`, and the streaming path writes the two update events; every one of those ends uses
   this manifest unchanged.
5. **Forward drift checked.** The Agent Card extension shape recorded for the discovery package is `AgentExtension` =
   `uri`, `description`, `required`, `params` (proto 424–433). Extension governance defines an official tier
   — a repository under the `a2aproject` organization, a canonical `https://a2a-protocol.org/extensions/`
   URI, a TSC vote with quorum, Apache 2.0, and at least one production-quality reference implementation —
   but "Anyone is able to define, publish, and implement an extension", so official status is not a
   precondition for anything. That is the Tier B forward path, and no manifest is declared for it.

### One drift from LCP §C.8 — recorded in prose, not encoded

The appendix is informative and the host specification governs. The drift is the discovery package's input, not this package's —
it changes no line here. **Consumed 2026-07-30:** `@integraledger/lcp-discovery`'s capability declaration accepts,
emits and returns the fourth field and exports only the renamed activation header; see that package's README
for the discharge and for the SHOULD-level publication guidance below.

- **§C.8 lists `AgentExtension` as `uri`, `required`, `params`.** The proto declares a fourth field,
  `description` — "A human-readable description of how this agent uses the extension", field 2 of four
  (proto 424–433).

### Not a drift: the dereference sentence, and the scope that reconciles it

§C.8 says "The URI is an identifier, not a location — A2A does not expect it to be dereferenced." The host
states that position **verbatim** — "These URIs are identifiers, HTTP access is not expected"
(`extension-and-binding-governance.md` line 34, echoed at `extensions.md` line 67). §C.8 needs no amendment
here.

It is recorded anyway because two host documents *read* as though they disagree, and the discovery package
needs the scoped version rather than either half:

- that sentence governs the **official** `https://a2a-protocol.org/extensions/` namespace — governance line 21
  names the prefix and line 34 rules on it, and `extensions.md`'s note at 62–69 quotes the same rule about the
  same prefix; while
- `extensions.md` 245–250, under *Implementation Considerations → Discoverability and Publication*, is
  **SHOULD**-level guidance for an author's own URI: the specification document "**should** be hosted at the
  extension's URI", and authors are "encouraged to use a permanent identifier service, such as `w3id.org`, for
  their extension URIs to prevent broken links".

So an LCP Agent Card extension published under an Integra-controlled URI **should** serve its specification
there and is **encouraged** toward a permanent identifier — a recommendation the discovery package may satisfy or decline with a
reason, never an obligation, and never a precondition for a counterparty reading the declaration. Nothing
here makes a hosted document owed at whatever URI an extension claims.

One more spelling fact for the discovery package: activation used the header `X-A2A-Extensions` through v0.3.0
(`docs/topics/extensions.md` line 110 at the `v0.3.0` tag) and is `A2A-Extensions` in the released v1.0
(same file, lines 172–189, at `0ef1b02`).

## Declaration is not activation — and this placement needs neither

A2A extensions "default to being inactive". A client activates by naming extension URIs in the
`A2A-Extensions` request header; the agent's response SHOULD echo the set it actually activated; a requested
extension the agent does not support is ignored. So an Agent Card declaration on its own is never exercised
by any counterparty.

The task-metadata carrier in this package is live with neither step taken, and that asymmetry is the entire
argument for placing a per-transaction reference in `metadata` rather than behind an extension.

## What this package deliberately excludes

The Agent Card at `/.well-known/agent-card.json` declares, under `capabilities.extensions[]`, what an agent
**requires** of a counterparty before interacting. It is not a `readAlso` alias of this manifest at any
carrier class, for two independent reasons:

- its `params` carry **requirements** (minimum level, accepted jurisdictions, accepted dispute methods), not
  a reference to a terms document — there is nothing there for `extract` to decode; and
- it is a **different document** from the one `place`/`extract` operate on, where ACP's and UCP's second
  carriers both sit inside the same checkout session.

Two documents, two jobs. Agent Card requirements live in [`@integraledger/lcp-discovery`](../discovery#readme), and `field` stays
singular here.

## A placement, not a binding

A2A moves messages between agents; it settles nothing. This package is a `ReferencePlacementAdapter` — two
pure functions and a manifest, no ports, no chain, no lifecycle. Where an A2A exchange leads to settlement on
a bound rail, that rail binding welds the record; otherwise this placement is the record's whole protocol
reach and it reads with an honest `not-attempted` at settlement-enumeration.

## Limitations, stated plainly

- **Recognition is not guaranteed.** A custom metadata key is interoperable only as far as the receiving
  agent recognizes it, and an agent that ignores it is behaving conformantly.
- **Nothing is committed cryptographically.** A2A does not sign task metadata, so this carrier is evidence of
  what was exchanged, not proof that a counterparty accepted it. A deployment needing more pairs it with one
  of the six settlement binding patterns.
- **`a2a/carrier-type-not-permitted` behaves differently on the two members.** `carrierTypes` is the complete
  §8.2 registry because A2A imposes no constraint to mirror, and narrowing it to make a refusal arm reachable
  would invent a host constraint A2A does not have. On `extract` the arm is therefore unreachable: every registered type
  is permitted, and an unregistered one is undecodable under §8.2, so the refusal is `reference-malformed`. On
  `place` the arm is reachable for a `ref` whose type is outside the registry — TypeScript forbids that at
  every call site, but an untyped door does not, and the conformance corpus pins it there.

## Provenance

Cut against `specification/a2a.proto` at `a2aproject/A2A@0ef1b02` (`main`, 2026-07-23 — after the `v1.0.1`
release, not at it), gate discharged 2026-07-30, and reconciled against LCP v1.37 §C.8 the same day; re-read
against **v1.38 §C.8** on 2026-08-12, which now states `AgentExtension`'s four fields. The kit is `makePlacement` from
[`@integraledger/lcp-binding-core`](../binding-core#readme); this package composes nothing on top of it,
because A2A asks for no rule the kit does not already hold.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
