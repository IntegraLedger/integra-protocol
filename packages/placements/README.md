# @integraledger/lcp-placements

**The one place a protocol is registered.** Nine placement packages describe where an LCP reference rides in
nine protocol documents; this package is the map from a protocol id to the adapter that does it. A caller that
imports this stops hand-picking protocol packages, and adding a tenth protocol becomes a data edit here rather
than a change at every call site.

```bash
npm install @integraledger/lcp-placements
```

| | |
|---|---|
| **Registered** | `x402`, `mpp`, `ap2`, `ack`, `acp`, `ucp`, `visa-tap`, `mastercard-vi`, `a2a` |
| **Not registered** | `mcp` — a known protocol id that is **not a field placement at all** (see below) |
| **Tier A** | eight of the nine |
| **Tier B** | `mastercard-vi` — declared and inert (LCP §8.3, and see that package's README) |
| **Chain** | none, by rule — `depcruise` holds this package to the same chain-free invariant as the placements it aggregates |
| **Depends on** | [`@integraledger/lcp-binding-core`](../binding-core#readme) for `ReferencePlacementAdapter`, plus the nine `placement-*` packages |

## The four exports

```ts
import { placementFor, placementsByTier, PLACEMENTS, supportedProtocols } from "@integraledger/lcp-placements";

const acp = placementFor("acp"); //  ReferencePlacementAdapter | undefined
placementFor("mcp"); //             undefined — a fact, not a hole to fill with a throwing stub

const vi = placementFor("mastercard-vi", { reverseDomain: "com.example" });
placementFor("mastercard-vi"); //   THROWS — see below

const { adapters, unconfigured } = placementsByTier("A", { reverseDomain: "com.example" });
```

`placementFor` is total over the closed `ProtocolId` set and returns `undefined` only where this build
genuinely has no placement. It consults **own properties only**: `PLACEMENTS` is an object, so a bare index
would read `PLACEMENTS["toString"]` off `Object.prototype` — a value that is neither `undefined` nor a
singleton, and so reaches the namespaced arm and asserts a namespace requirement about a protocol that does
not exist. `ProtocolId` is a compile-time set and this is the dispatch point a counterparty's wire token and
an MCP tool argument arrive at, so the guard is a runtime one. `supportedProtocols()` enumerates in
`KNOWN_PROTOCOL_IDS` order — the schema enum's own order, so the list is stable rather than an accident of
which unit landed first.

## `mcp` is absent because MCP has no field carrier

Not a pending `placement-mcp`. LCP v1.37 §C.9 and §10 describe an LCP-aware MCP **server** — tools,
resources and prompts, plus a `capabilities.extensions` negotiation map keyed by a reverse domain — and no
document field for a reference to ride in. MCP is a delivery surface, not a placement, so `mcp`'s absence
from this registry is the correct terminal state. The corpus pins it: `placement.dispatch` asserts that a
known protocol id with no placement answers the same `unknown-placement-protocol:<id>` port error as a token
that is not a protocol id at all, and never a throw.

## Two registration shapes, because there are two

Eight placements are singletons: the host protocol fixes the carrier completely, so the package exports one
adapter and the registry holds it. Mastercard VI's carrier is a custom Layer-2 constraint type named under the
**deployment's own reverse-DNS namespace**, which has no default — so it ships as a factory, and the registry
holds the factory rather than a pre-built adapter.

```ts
import type { ReferencePlacementAdapter } from "@integraledger/lcp-binding-core";

export type PlacementRegistration =
  | { kind: "singleton"; adapter: ReferencePlacementAdapter }
  | { kind: "namespaced"; build: (reverseDomain: string) => ReferencePlacementAdapter };
```

Three consequences, each deliberate:

1. **The registry never defaults a namespace.** LCP §8 canonizes no per-protocol integration profile, and a
   default would write *our* reverse domain into a counterparty's signed mandate in every deployment that
   forgot to pass one. `placementFor("mastercard-vi")` with no deployment **throws**, naming what the caller
   owes. It does not answer `undefined`, because `undefined` means "this protocol has no placement" and would
   turn a caller's omission into a fact about the protocol.

2. **The factory's own guards are not bypassed.** The namespace is passed through unexamined: the empty,
   non-reverse-DNS and reserved-`org.legalcontextprotocol` cases are refused by the factory that owns them, and
   a second copy of those rules here could disagree with the first.

3. **One keyed union, not a singleton map beside a factory map.** Two maps admit the same protocol id in both,
   where two callers reach two different adapters for one protocol and neither is wrong. A single key cannot —
   *in the source*. `PLACEMENTS` is also `Readonly` and `Object.freeze`d, because the keyed union says nothing
   about a consumer adding, replacing or deleting a registration after import and changing what `placementFor`
   and `supportedProtocols` answer for everyone else in the process. The type stops that in TypeScript
   (TS2540 on assignment, TS2704 on `delete`); the freeze stops it in plain JavaScript, which is what a
   published package is consumed as. What the freeze guarantees is that the write does not **land** —
   whether it *throws* is the caller's strict-mode setting (an ESM importer gets a `TypeError`, a
   sloppy-mode CommonJS caller gets a silent no-op), and either way the next lookup reads the same registry.

## `placementsByTier` reports what it could not classify

A tier is a property of a *built* manifest, so a namespaced registration cannot be classified until its
namespace arrives. Dropping it would answer "no Tier B placements exist" while one sits registered a namespace
away — a hole read as a fact. So the selector returns both halves:

```ts
import { placementsByTier } from "@integraledger/lcp-placements";

placementsByTier("B");                                  // { adapters: [], unconfigured: ["mastercard-vi"] }
placementsByTier("B", { reverseDomain: "com.example" }); // { adapters: [viAdapter], unconfigured: [] }
```

Reporting rather than throwing is the point: a caller with no namespace still gets the eight Tier A adapters,
and is never pushed into inventing a namespace to satisfy a signature.

## The tier selector is what makes "the host governs" operational

The host protocol's live rules bind, and LCP's Appendix C is an illustration. A deployment that will only
ship what works against stock, unmodified implementations asks for `"A"` and gets exactly that — rather than
reading tiers out of documentation and hoping. Tier B adapters stay constructible; they are simply never
returned to a Tier-A caller.

## Where the registry sits in the dependency graph

Up-tier from every placement package and down-tier from every consumer. `depcruise` enforces both directions,
and both rules had to be widened to see this package at all — `placement-` does not match `placements/` on the
hyphen, so the registry escaped the tier discipline and the chain-free invariant until the protocol-surface
work named it. Both
widened rules were canary-proven to exit non-zero: a planted `@integraledger/lcp-conformance` import fired
`domain-tier-no-upward` (exit 1) and a planted `viem` import fired `placement-packages-are-chain-free`
(exit 2 — `depcruise` exits with the error count).

**Re-running those canaries requires a RESOLVABLE import**, and this is the whole recipe. Both rules match on
`to.path`, which only exists once enhanced-resolve has resolved the specifier; an undeclared bare import is
reported `couldNotResolve: true, valid: true` and the run exits **0**, and there is no `not-to-unresolvable`
rule to catch it. Measured both ways: the bare plant exits 0, and the same plant with
`packages/placements/node_modules/@integraledger/lcp-conformance` symlinked in exits 1 naming the rule. An
undeclared import is not a hole in the gate — it fails `pnpm -r typecheck` with TS2307 instead — but a canary
planted without the symlink proves nothing.

The conformance harness consumes this package rather than keeping its own map: `InProcessSubject` resolves the
`placement` class through `placementFor`, so a placement that is registered here is reachable on all three
conformance doors by construction, and one that is not is unreachable everywhere. The harness supplies
`com.integraledger` as its own deployment namespace — the value the `mastercard-vi` vectors are written in.

## What this package is not

It is not a second place a protocol id is spelled: the keys are `ProtocolId` tokens, hyphens included. It is
not a settlement registry — a protocol can be registered here *and* carry a settlement binding elsewhere
(x402 does both), and the two answer different questions. And it holds no protocol logic of its own: every
rule about a carrier lives in the placement package that owns it, or in `binding-core`'s placement kit.

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
