# @integraledger/lcp-rail-invariants

Test-only, never published. Holds the cross-rail invariants **no single binding package can assert about
itself**, because asserting them requires importing every rail at once.

It lives in its own package rather than in `conformance` for one concrete reason: it imports the EVM
bindings, whose `ox`/viem types need `lib: DOM`, and `conformance` is deliberately DOM-free so it can run
unmodified in Node, a browser, Deno, Bun and a CF Worker (see `tsconfig.dom.json`, which names conformance
as one of the packages that must keep that guarantee). Extending `tsconfig.dom.json` here is that trade,
made once, in a package that only ever runs in CI.

Current invariant: **the success gate.** A weld that is present and well-formed, on a transaction that did
not succeed, must never be recoverable — see `test/success-gate-invariant.test.ts`.
