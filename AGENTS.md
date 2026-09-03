# integra-protocol — contributor guide

Reference implementation of the open layer of the Legal Context Protocol: the record format, the
verification walk, thirteen settlement bindings, nine reference placements, and the conformance corpus.

pnpm workspace, Node >= 24, TypeScript with `isolatedDeclarations`. Apache-2.0.

## Gates

`pnpm verify` is the one that counts. It runs, in order:

```
check:versions → check:docblocks → check:live-rails → check:harness-proof → corpus-seal --check → audit
  → build → check:dist → lint → depcruise → typecheck → check:docs → check:doc-calls → test
```

Build comes before typecheck deliberately: workspace packages consume each other through built `dist/`, so
`kernel` must be built before `conformance` can be typechecked.

| Command | Notes |
|---|---|
| `pnpm verify` | Must exit 0 before anything is claimed done |
| `pnpm mutation <pkg>` | Per package — `STRYKER_PKG` is required and the config throws without it |
| `pnpm check:docs` | Typechecks every TS fence in `docs/`, the root README and every package README — the count is derived, never written down |
| `pnpm check:doc-calls` | RUNS the self-contained example calls in those fences — a call of a workspace export whose every argument is a literal — and refuses one that throws or returns a `Refusal`. A line annotated `// throws` / `// refuses` must fail; elided arguments and calls inside a `try` are skipped |
| `pnpm check:docblocks` | Refuses a top-level export with no docblock — 100% floor, adjacency strict |
| `pnpm check:dist` | Refuses a `dist/` output whose `src/` file was deleted or renamed |
| `pnpm check:harness-proof` | Refuses a live-rail harness that can report a PASS without doing its work — a `return` in a test body (Vitest records one as passed, never as skipped) or a body with no `expect`. Subject set is `check:live-rails`' inventory, so the two cannot disagree about what a harness is |
| `pnpm check:live-rails` | The live-rail inventory — derives which packages carry an env-gated on-chain suite, refuses a set that disagrees with its named floor, and refuses a `live-proofs.yml` that fails to map a credential a harness reads |
| `pnpm check:commit-trailers` | Commit-message policy over a range. **Not part of `verify`** — its subject is the range a push adds, which does not exist locally. `commit-policy.yml` runs it on every push |

## Commit messages

Two rules, both enforced by `commit-policy.yml` on the range a push adds, and both worth knowing before you
write a commit rather than after:

- **Every commit carries a DCO `Signed-off-by:` matching its author.** CONTRIBUTING.md has always said so;
  until 2026-08-26 nothing checked. The trailer is the only per-commit provenance record LCP has, it is what
  lets battle-tested work move toward the standard later, and CONTRIBUTING is right that it "cannot be
  reconstructed after the fact". `pnpm install` installs a `prepare-commit-msg` hook that adds it, so the
  flag is a backstop rather than a habit. **65 commits on `main` carry none** — the 64 predating the gate,
  plus the first commit of the gate's own work, which landed while the hook was still being written. They
  stand rather than being rewritten, and the number is frozen because a 66th cannot be pushed.
- **No agent-authorship trailers** — no `Co-Authored-By:` naming an assistant, no `claude.ai/code` session
  URL, no "Generated with" line. This history is world-readable and permanent. The DCO trailer already
  records who is responsible.

⛔ **The remedy for a missed sign-off on public `main` is the habit, never a rewrite.** Amending published
history breaks every clone and orphans the release tags, so the gate can only stop the next one — which is
why the hook exists. Check before you push, not after.

⚠️ **`[bot]` authors are exempt from DCO, and the run says how many it waived.** Dependabot signs off as
`dependabot[bot] <support@github.com>` — GitHub's service address, not its author address — so a strict
author match would fail every one of its pushes and leave `commit-policy` permanently red on
`dependabot/**`. That is worse than a false red: `dependabot.yml` relies on a red build to hold the 24h
quarantine, and a check that is always red there carries no information. DCO is a human attestation and a
bot cannot make one. The forbidden-marker rules still apply to bots.

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
- **The live-rail harnesses skip SILENTLY, and Vitest exits 0 over an all-skipped run.** They print no
  banner, so there is nothing to grep and a green exit code certifies nothing. `live-proofs.yml` therefore
  adjudicates on the JSON reporter's counts — passed > 0, skipped == 0 — via `scripts/live-proof-gate.mjs`,
  and never on the exit code. Anything that runs these suites owes the same check.
- **Counts close the EMPTY run and cannot close the HOLLOW one.** A test body that `return`s is recorded
  as **passed**, not pending, so it satisfies `passed > 0 && pending === 0` while touching no chain —
  `binding-xrpl` had exactly that path until 2026-09-03. Not decidable from a report, so it is decided in
  the source: `check:harness-proof` refuses a `return` in a live-rail test body and a body with no
  `expect`. In a live harness, a missing dependency or an unusable credential is a **throw**.
- **Enumerate the live harnesses by property, never by filename.** Nine are `integration.onchain.test.ts`
  and two are `integration.canton.test.ts`; a glob for the first silently omits Canton at both layers.
  `scripts/live-rails.mjs` is the inventory, and it refuses rather than returning a short set.

## Publishing

Steady state is **trusted publishing over OIDC** — `release.yml` holds no token, and `pnpm release:approve`
is the human half. Two things about that are worth knowing before you touch it.

**A brand-new package name cannot use it.** npm can neither configure trusted publishing for a package that
does not exist nor stage a name that has never been published, so the first release of any new name needs a
one-time token-gated publish. Run it **from GitHub Actions, never from a laptop**: registry auth is the
token but the attestation is the workflow's OIDC identity, and provenance is minted at publish time while an
npm version can never be reused — so a laptop publish leaves that version permanently unattested. The
workflow that bootstrapped `0.9.0` is in this repository's history and is the template; it was deleted
after use so no standing credential path remains.

**The registry lags itself.** Immediately after a publish, `npm view` and the full packument endpoint can
both still report the package as absent — cached documents, not truth. The version-specific endpoint
(`registry.npmjs.org/<pkg>/<version>`) is authoritative. A post-publish check that trusts the other two will
report a successful release as a failure, which is exactly what happened on the `0.9.0` bootstrap.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution gate and the two testing tiers, and
[SECURITY.md](SECURITY.md) for vulnerability reporting. Developer documentation lives in
[docs/developer](docs/developer/index.md).
