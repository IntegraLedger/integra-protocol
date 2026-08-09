# Developer documentation

This is the developer documentation for the reference implementation of the open layer of the **Legal
Context Protocol (LCP)** — the record format, the verification walk, the settlement bindings, the
reference placements, and the conformance corpus. LCP is co-stewarded by **Integra Ledger** and
**AAA-ICDR**, and its specification is published at
[legalcontextprotocol.org/standard](https://legalcontextprotocol.org/standard). This repository
implements that specification; it never defines it. Where the two disagree, the specification is
authoritative and the implementation is wrong.

## Where to start

| If you are… | Read |
|---|---|
| new here | [getting-started.md](getting-started.md) — install a package, assemble an ATR, hash it, verify it |
| trying to understand the model | [concepts/](#concepts) — what an ATR is, what the walk proves, what a weld is |
| trying to do a specific task | [guides/](#guides) — end-to-end procedures against the shipped packages |
| looking for a specific package | [reference.md](reference.md) — all 31 publishable packages, one line each, linked to their READMEs |

## Concepts

Read these in order the first time; they build on each other.

- [concepts/atr.md](concepts/atr.md) — the ATR as one canonical JSON document: its slots, its canonical
  bytes, why `atrHash` is the SHA-256 of the assembled file, and what makes it recomputable by anyone
  holding those bytes.
- [concepts/verification-walk.md](concepts/verification-walk.md) — what the walk answers and what it
  declines to answer: its inputs, the four step statuses, the class ladder, authority chain custody, and
  what a `failed` step and its halt class mean for a consumer.
- [concepts/welds.md](concepts/welds.md) — a weld is the ATR hash carried in a field the settlement itself
  commits to: the carrier field on each rail, and why recovering the hash and recomputing it is a
  deterministic correspondence rather than a judgement.
- [concepts/bindings-vs-placements.md](concepts/bindings-vs-placements.md) — a binding welds into a
  settlement that moves value; a placement places a reference into a protocol document that never settles.
  The distinction decides which package you need.
- [concepts/authority.md](concepts/authority.md) — authority artifacts, delegation and attenuation, the
  custody walk, and revocation semantics.
- [concepts/discovery.md](concepts/discovery.md) — what discovery integrity provides, and what it does not.
- [concepts/evidence.md](concepts/evidence.md) — evidence bundles, artifact roles, and content addressing.
- [concepts/conformance.md](concepts/conformance.md) — the corpus as the definition of agreement between
  independent implementations.

## Guides

- [guides/run-conformance.md](guides/run-conformance.md) — install the conformance package and run its CLI
  against your own implementation.
- [guides/verify-a-settlement.md](guides/verify-a-settlement.md) — you hold a settlement and a terms
  document: recover the carried hash, recompute it from the document, compare them, and run the walk.
- [guides/implement-a-binding.md](guides/implement-a-binding.md) — what `binding-core` requires of a new
  rail, with `binding-solana` as the exemplar and a vectors-first definition of done.
- [guides/add-a-placement.md](guides/add-a-placement.md) — what a placement package does, with
  `placement-x402` as the exemplar.

## Reference

[reference.md](reference.md) lists every shipped package with its role and a link to its README. The
package READMEs are the detailed API reference; this tree explains the model they implement and the tasks
they compose into.
