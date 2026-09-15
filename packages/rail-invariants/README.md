# @integraledger/lcp-rail-invariants

Test-only, never published. Holds the cross-rail invariants **no single binding package can assert about
itself**, because asserting them requires importing every rail at once.

It lives in its own package rather than in `conformance` for one concrete reason: it imports the EVM
bindings, whose `ox`/viem types need `lib: DOM`, and `conformance` is deliberately DOM-free so it can run
unmodified in Node, a browser, Deno, Bun and a CF Worker (see `tsconfig.dom.json`, which names conformance
as one of the packages that must keep that guarantee). Extending `tsconfig.dom.json` here is that trade,
made once, in a package that only ever runs in CI.

The invariants it holds, one file each — this section said "current invariant: the success gate" while eight
others sat beside it, and `docs-match-the-tree` now requires every `test/*.test.ts` here to be named below:

| File | What it refuses |
|---|---|
| `success-gate-invariant.test.ts` | A weld that is present and well-formed, on a transaction that did not succeed, being recoverable |
| `recovery-triple-invariant.test.ts` | A `recovery` triple overstating what its rail can do (WLD-3) |
| `atrhash-case-invariant.test.ts` | An `atrHash` compared as a string, or case-folded outside the one place that may |
| `docs-match-the-tree.test.ts` | A number or table in the documentation the tree contradicts |
| `spec-citation-invariant.test.ts` | Shipped prose citing a superseded LCP revision as if it were current |
| `spec-pins-invariant.test.ts` | A `spec-pins.json` entry that is malformed or misses a host this tree makes claims about |
| `public-surface-invariant.test.ts` | One name meaning two things across the published `@integraledger/lcp-*` scope |
| `offchain-slot-invariant.test.ts` | A rail that says "fetch the rest off-chain" naming a slot nothing writes |
| `runner-patch-invariant.test.ts` | The Stryker runner and the catalog's vitest major disagreeing, which makes every filtered mutant SURVIVE in silence |
| `hermetic-tests-invariant.test.ts` | A non-live test — or a helper one imports — reaching a third party, and the live-rail-harness exclusion widening to swallow real tests |
| `no-private-referents.test.ts` | Shipped source or a shipped README naming a referent only a private tree has |
| `forbidden-literals-invariant.test.ts` | A private referent reaching any world-readable file rather than only the subset npm packs, and the repository-wide gate reporting clean over a subject set it never read |
| `published-parity-invariant.test.ts` | A published version whose bytes no longer match the source that carries its number |
| `published-dist-parity-invariant.test.ts` | A published `dist/` that is not what its own source emits — the consumed surface, which the parity gate above cannot reach because `dist/` is untracked and so has nothing in the tree to be held against |
