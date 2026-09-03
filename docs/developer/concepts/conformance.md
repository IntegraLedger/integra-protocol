# Conformance

Two implementations of the Legal Context Protocol agree when they compute the same answers from the same
inputs. Reading the [specification](https://legalcontextprotocol.org/standard) carefully is how you try to
get there. It is not how you find out whether you did.

The **conformance corpus** is how you find out. It is a set of declarative vectors — an operation, an input,
and the answer the protocol requires — that any implementation in any language can be driven against. An
independent implementation agrees with this one exactly when the corpus says so, and the corpus is the only
artifact in this repository that makes that claim.

[`@integraledger/lcp-conformance`](../../../packages/conformance/README.md) ships the corpus, the runner that
executes it, and the adapters that drive an implementation under test.

## The corpus is data, and it ships

Two properties do most of the work here, and both are deliberate.

**A vector is JSON, not JavaScript.** A case names an operation, supplies an input, and states either the
expected output or the expected typed error **code**:

```json
{
  "name": "sha256-simple",
  "input": {
    "op": "parseString",
    "arg": "lcp:sha256:0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
  },
  "expected": { "type": "sha256", "value": "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069" }
}
```

```json
{ "name": "prefix-only", "input": { "op": "parseString", "arg": "lcp:" }, "error": "carrier/malformed" }
```

Nothing in either case is executable, which is what lets the same corpus judge an implementation written in
Rust, Go or Python. Of the 861 registered cases, 131 assert a refusal this way — a conformant implementation
has to refuse the right inputs, not merely accept the right ones.

Note what the second case pins: the **code**, never the message text. The code is the contract, because
callers route on it; the message is a diagnostic for a human. Pinning prose would buy a stricter-looking
suite and a more brittle one, and would make one implementation's phrasing part of the standard.

**The corpus ships inside the package**, in its `vectors/` directory, alongside `dist/`. There is nothing to
clone and nothing to fetch. The packaged tree is byte-identical to this repository's `vectors/` tree.

**And it is sealed**, so a run can say what it certified against rather than assuming. `vectors/conformance/
corpus-seal.json` carries a SHA-256 for every corpus file and a case count for every area; the root digest
over those entries is compiled into the package itself. The split matters: a seal that travels with the
corpus can be re-sealed by whatever altered it, so the anchor lives where a corpus edit cannot reach. A
damaged corpus fails and names the file; a corpus that is whole but not the one this build shipped reads as
`authentic: false`; and a run against the packaged corpus that cannot be recognised refuses rather than
reporting a green. Pointing `--vectors` at your own tree is supported and reports honestly — it simply
cannot claim completeness it has no seal to establish.

## The manifest is the corpus

`vectors/conformance/corpus-manifest.json` — currently version `5` — is what defines the corpus. The
directory is not: vector files live in the tree that no area registers, and those are individual packages'
own fixtures rather than cross-implementation obligations.

Each registered **area** names three things, and a fourth where it applies:

```text
id       a stable name, e.g. "authority.chainWalk"
file     the vector file, relative to the tree root
class    which operation a subject must perform for every case in the file
schema   for schema-validation areas, the canonical JSON Schema, passed to the subject INLINE
```

An area's `class` is the operation name — `hashAtr`, `carrier`, `placement`, `chainWalk` and sixteen others.
It has nothing to do with a transaction class or a halt class; it is the dispatch key a subject switches on.
Passing the schema inline rather than by path is what keeps a subject **tree-independent**: a foreign
implementation never has to know where the corpus lives on disk, or that it lives on disk at all.

## The count ratchets, and a green run is not the whole answer

**Today the corpus is 861 cases across 44 areas.** That number is not a fact about this page; it is a fact
about the tree, and it is quoted here from a run rather than from memory. Reproduce it:

```bash
npx @integraledger/lcp-conformance
```

```text
conformance: 861 passed, 0 failed, 0 skipped (none)
```

The rule that number exists to serve: **a green suite over a shrunken corpus is a regression wearing a
disguise.** Deleting a vector removes an obligation, and the exit code cannot tell you that happened —
`0 failed` reads identically whether 861 cases ran or six did. So the counts are what gets reported, not the
exit status, and `packages/conformance/test/runner.test.ts` pins the expected size so a case that silently
stops being registered fails the build.

The same hazard has a second door. Every area carries a **phase**, and `--phase` sets a cumulative *floor*
rather than selecting a rung: `--phase P4` runs P1 + P3 + P4 and reports everything above it as `skipped`.

```bash
npx @integraledger/lcp-conformance --phase P4
```

```text
conformance: 471 passed, 0 failed, 14 skipped (vocabulary.protocolId, placement.manifestSchema, placement.acp, placement.ap2, placement.ucp, placement.a2a, placement.x402, placement.ack, placement.mpp, placement.visa-tap, placement.mastercard-vi, placement.dispatch, verify.referencePlacement, discovery.capability)
```

That run is green and certifies roughly half of what the bare run certifies. The skips are printed by name
for exactly that reason — **a run reporting skips has been narrowed, and is certifying less than it looks
like.** With no flag the runner uses the wired floor, which today is the whole corpus.

## Two doors into an implementation

A `Subject` is the thing under test, and two adapters ship.

| | `InProcessSubject` | `CliSubject` |
|---|---|---|
| Drives | a JavaScript implementation, in-process | any executable, over stdio |
| Speed | fast | one process per case |
| Coupling to this package | direct imports | none — a JSON-on-stdin/stdout contract |
| Used by | this repository's own suite, and the `lcp-conformance` CLI | an implementation in another language |

The distinction matters when reading a green run. **The `lcp-conformance` CLI only ever drives
`InProcessSubject`** — there is no flag that points it at a third-party implementation. A bare run tells you
that the installed `@integraledger/*` packages agree with the corpus shipped beside them; it says nothing
about anyone else's code. Driving a foreign implementation is the library API, `runCorpus` with a
`CliSubject`, and [guides/run-conformance.md](../guides/run-conformance.md) walks through it end to end.

## What the corpus does not certify

Stating the edges is part of the artifact being trustworthy.

- **Cryptographic gates are out, by design.** The acceptance-signature check and the chain-walk proof gate
  are port-injected and not portable, so the corpus certifies the *structural* walk around them. See
  [authority.md](authority.md).
- **Refusal prose is unpinned.** A refusal is compared on `refused`, `haltClass` and `code`; its `detail`
  string is dropped before comparison.
- **One obligation no vector can state.** A subject that parses a request from text must apply JavaScript
  object semantics — a repeated key collapses to a single property keeping the first occurrence's position
  and the last occurrence's value, and array-index keys enumerate ahead of string keys at every depth. The
  runner reads vectors with a JSON parser and `CliSubject` re-serializes, so a duplicate key is collapsed
  before any subject sees it. A subject that keeps both entries re-emits a duplicate key into the hashed
  bytes and reads back the wrong one — an ATR hash divergence the corpus will report as green. Key
  *ordering* is certified; this one case is not, and is written down here instead.

## Two tiers, and how the corpus tells you which one you are in

[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) is the authority on this; the summary below is a pointer to
it, not a replacement for it.

The Legal Context Protocol is co-stewarded by **Integra Ledger** and **AAA-ICDR**, and the specification is
published at [legalcontextprotocol.org/standard](https://legalcontextprotocol.org/standard) rather than
edited in this repository. That single fact splits every change into one of two tiers.

**Tier one — implementation improvements.** Performance, clarity, portability, better tests, a sharper error
message, a missing edge case in an existing rule: anything that leaves observable protocol behaviour
unchanged. These are ordinary engineering and are reviewed as such, and they are welcome.

**Tier two — protocol semantics, wire formats, or the conformance corpus.** Held to a different bar: nothing
enters the standard until it is battle-tested in production use, and standard-affecting changes require
steering-committee sign-off. That is a policy rather than a backlog, so a well-argued change is held by the
same rule as a poorly-argued one. A change landing here cannot ratify a spec change — this repository is
where a decision gets *implemented*, never where it gets *made* — and the useful contribution in that case
is the evidence: a production deployment that exercised the behaviour, and the record of what it did.

"Observable protocol behaviour" is wider than it first looks. It covers every hash a counterparty could
recompute, every field name on the wire, every verdict the verification walk emits, and the class ladder
that decides those verdicts. Refactoring the code that produces them is tier one. Changing what they produce
is tier two.

**The corpus is what answers the question.** If `lcp-conformance` would have to change for your change to
pass, you are in tier two. That test is mechanical on purpose: it does not depend on how large the diff
looks or how the author describes it.

Three rules follow for anyone touching `vectors/`, and CONTRIBUTING states them as non-negotiable:

1. **Land the failing vector first** — add it, confirm it fails, and confirm it fails *for the reason you
   expect*, then implement. A vector written after the code merely records that the code agrees with itself.
2. **Re-derive pinned oracle values independently** — compute a changed hash, digest or encoded byte string
   from the input bytes with something that is *not* this implementation, and show the derivation. Copying
   what the implementation now emits proves nothing.
3. **Record the superseded pin** — a changed vector should say what it used to be and why it moved, so the
   change is auditable years later by someone who was not in the room.

## Where next

- [guides/run-conformance.md](../guides/run-conformance.md) — install the package, run the CLI, read the
  report, and drive your own implementation over stdio.
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — the two tiers in full, the vector rules, and the gates.
- [verification-walk.md](verification-walk.md) — the walk whose class ladder and step outcomes several
  corpus areas certify.
- [conformance README](../../../packages/conformance/README.md) — the runner API, the subject adapters, and
  the two CLI flags.
