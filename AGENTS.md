# integra-protocol — contributor guide

Reference implementation of the open layer of the Legal Context Protocol: the record format, the
verification walk, thirteen settlement bindings, nine reference placements, and the conformance corpus.

pnpm workspace, Node >= 24, TypeScript with `isolatedDeclarations`. Apache-2.0.

## Gates

`pnpm verify` is the one that counts. It runs, in order:

```
check:versions → check:docblocks → corpus-seal --check → audit → build → check:dist → lint → depcruise
  → typecheck → check:docs → check:public-docs → test
```

Build comes before typecheck deliberately: workspace packages consume each other through built `dist/`, so
`kernel` must be built before `conformance` can be typechecked.

| Command | Notes |
|---|---|
| `pnpm verify` | Must exit 0 before anything is claimed done |
| `pnpm mutation <pkg>` | Per package — `STRYKER_PKG` is required and the config throws without it |
| `pnpm check:docs` | Typechecks every TS fence in `docs/`, the root README and all 31 package READMEs |
| `pnpm check:docblocks` | Refuses a top-level export with no docblock — 100% floor, adjacency strict |
| `pnpm check:dist` | Refuses a `dist/` output whose `src/` file was deleted or renamed |

`pnpm verify` is **not hermetic**: one stage is `pnpm audit`, so a newly published advisory turns it red
against an unchanged tree. If only that stage fails, record the advisory, run the remaining stages, and
triage it separately. Never weaken the threshold to get past it.

Mutation ratchets exist per package. **Raise them, never lower them** — a drop is a regression even when the
suite is green. Raise from a repeated low rather than one good reading; at least one package's score moves
between runs on unchanged code.

## The rule that causes the most rework

**The host governs.** Where a host protocol's live specification and LCP's informative Appendix C disagree,
the host is correct. A placement declares the carrier the host already permits, at the strength the host
actually gives it; a carrier that would make a stock implementation reject the whole document is not
declared at all. Where a host has not defined a carrier, the answer is prose, never a manifest for a shape
its owner has not agreed to.

**Check a manifest against its adapter, not against the schema.** A manifest is a machine-readable claim a
stranger relies on, and the schema cannot tell you whether a declared `indexing` strategy is one the reader
can actually perform. Successive reviews have found manifests their own adapter contradicted.

## Corpus discipline

`vectors/` is load-bearing, not fixtures.

- Land the failing vector **first** and confirm it fails for the reason you expect, then implement.
- Re-derive a pinned oracle independently rather than copying what the implementation now emits —
  otherwise the vector only proves the code agrees with itself.
- Record a superseded pin so the change is auditable.
- Regenerate the seal with `pnpm corpus:seal` after ANY corpus change; `pnpm verify` fails on drift.

The corpus ships inside `@integraledger/lcp-conformance` and every run prints the identity of the corpus it
certified against. Quote that root digest beside any conformance claim — a pass count over a shrunken corpus
is also a pass count.

## Layout

`packages/kernel` assemble + refs · `binding-core` the placement/carrier seam and the `WeldAdapter` port ·
`authority` grants, walks, attenuation · `verify` the step ladder · `evidence` CAR bundles · `discovery`
well-known documents · `conformance` the corpus runner · `binding-*` thirteen rails (plus `binding-core` and
`binding-evm-common`, which are seams, not rails) · `placement-*` nine reference placements ·
`placements` the registry.

## Traps worth knowing

- `pnpm test` is deliberately bounded to `--workspace-concurrency=3`; the unbounded default produces false
  red runs. Run `pnpm test`, not `pnpm -r test`.
- `stryker.config.mjs` throws without `STRYKER_PKG`. Use `pnpm mutation <pkg>`.
- `packages/conformance/vectors/` is a build artifact. The real corpus is the repository-root `/vectors`.
- `packages/rail-invariants` is private — the only one. Derive the publishable set from `private`, never
  from a name pattern; a name-pattern filter has broken twice.
- Refusals are returned values, not exceptions. Narrow an `Outcome` with `"refused" in result` — `Refusal`
  carries no `ok`, so the union cannot discriminate on one.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution gate and the two testing tiers, and
[SECURITY.md](SECURITY.md) for vulnerability reporting. Developer documentation lives in
[docs/developer](docs/developer/index.md).
