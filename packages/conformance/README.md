# @integraledger/lcp-conformance

The conformance corpus, its runner, and the adapters that drive an implementation under test.

This is how you find out whether an independent implementation of the Legal Context Protocol agrees with
this one — not by reading the specification and hoping, but by running the same vectors and comparing.

```bash
npm install @integraledger/lcp-conformance
```

The in-process subject reaches [`@integraledger/lcp-kernel`](../kernel#readme),
[`@integraledger/lcp-binding-core`](../binding-core#readme),
[`@integraledger/lcp-authority`](../authority#readme), [`@integraledger/lcp-verify`](../verify#readme),
[`@integraledger/lcp-evidence`](../evidence#readme), [`@integraledger/lcp-discovery`](../discovery#readme) and
[`@integraledger/lcp-placements`](../placements#readme) — this package is the only one that depends on nearly
all of them, because certifying the corpus means driving every surface it covers.

## Run it

The corpus ships inside the package, so nothing needs to be fetched or cloned:

```bash
npx @integraledger/lcp-conformance
```

```
conformance: 848 passed, 0 failed, 0 skipped (none)
corpus: 44/44 areas, 848/848 cases, root 2d129ec92d91fae3… (authentic)
```

Those are the real figures for this release, not placeholders — and they cannot go stale unnoticed:
`pnpm corpus:seal --check` reads this line and refuses the build if it disagrees with the sealed corpus.
A README carrying a stale digest asserts a corpus that no longer exists, which is worse than carrying none;
gating it is what makes stating it safe.

The second line is the corpus's own identity, and it is the half worth recording: a pass count says how
many cases agreed, and only the root digest says which corpus produced them. `authentic` means the tree
matches the digest compiled into this package — the run saw the whole corpus, not a subset. If it cannot
say that, the run refuses instead of reporting a green.

Point it at a different corpus with `--vectors <dir>`. That is supported and reports honestly: a tree with
no seal of its own prints its actual counts and claims no completeness, rather than refusing.

`--phase <name>` lowers the floor, it does not select a rung: the runner executes every area at or below
the phase given, so `--phase P4` runs P1 + P3 + P4 and reports the rest as `skipped`. With no flag the
whole corpus runs, which is what the sample output above shows — a run reporting skips has been narrowed
by a flag, and is certifying less than it looks like.

## Verify the corpus yourself

The whole claim of this package is that you can check our work without asking us, and that applies to the
corpus as much as to the implementation. The seal is public API:

```ts
import { CORPUS_ROOT, verifyCorpusSeal } from "@integraledger/lcp-conformance";
import { readFileSync } from "node:fs";

const vectors = new URL("./node_modules/@integraledger/lcp-conformance/vectors/", import.meta.url);
const read = {
  bytes: (rel: string) => readFileSync(new URL(rel, vectors)),
  text: (rel: string) => readFileSync(new URL(rel, vectors), "utf8"),
};
const manifest = JSON.parse(read.text("conformance/corpus-manifest.json")) as {
  areas: { id: string; file: string }[];
};

const provenance = verifyCorpusSeal(read, manifest.areas);
provenance.sealed && provenance.root === CORPUS_ROOT; // the tree is the one this build shipped
```

`verifyCorpusSeal` throws if the corpus is damaged — a file whose bytes do not match its sealed digest, an
area whose case count is short, a manifest and seal that disagree on the area set — and names what is
wrong. It returns `authentic: false`, rather than throwing, for a corpus that is intact but is not the one
compiled into this build. Every run of the CLI reports the same verdict.

## Vectors are data

A vector is declarative JSON: an operation name, an input, and either the expected output or the expected
typed error **code**. Nothing about a vector is JavaScript, which is what lets the same corpus judge an
implementation in another language.

Assertions are on error *codes*, never on message text. The code is the contract — callers route on it —
while the message is a diagnostic for humans. Pinning prose would buy a stricter-looking suite and a
brittler one.

## Subjects

A `Subject` is the thing under test. Two adapters ship:

- **`InProcessSubject`** — drives a JavaScript implementation directly, in-process. Fast, and what this
  repository's own suite uses.
- **`CliSubject`** — drives any executable that speaks the subject protocol over stdio. This is the
  interesting one: an implementation in Rust, Go or Python conforms by satisfying a stdio contract, with
  no binding to this package.

```ts
import { runCorpus, CliSubject } from "@integraledger/lcp-conformance";

// `runCorpus(subject, opts)` — two positional arguments. `vectors` is a URL, not a path string:
// the tree that certifies is stated explicitly, never guessed.
const report = await runCorpus(new CliSubject("./my-lcp-implementation"), {
  vectors: new URL("./vectors/", import.meta.url),
});
```

## Every vector is load-bearing

A vector is not a test someone happened to write; it is a pinned decision about what the protocol means.
Changing one changes what conformance *is*.

So a change that alters a pinned vector must land the re-derived vector first, with the derivation shown —
and a green run against a shrunken corpus is a regression wearing a disguise. Report the counts, not just
the exit code.

## Requirement ids

This package's source and its messages cite short ids — `ATA-3`, `RCS-5`, `CMP-6` and their kin.
**They are not LCP clause numbers.** LCP is cited by section (`§8.3.1`, `§C.2`); anything shaped `XXX-n`
comes from Integra's functional specification of what a complete agent transaction requires, the fourteen
families below. Nothing in this package's behaviour depends on them, and where an id and an LCP section
disagree the section governs.

| | | | |
|---|---|---|---|
| `IDN` identity | `ASP` authority to spend | `ATA` authority to accept terms | `TRM` the terms record |
| `RCS` recourse | `PAY` payment and settlement | `WLD` the transactional weld | `OFR` offer integrity |
| `FRC` fraud, risk, and compliance | `OPS` commercial operations | `DSC` discovery and reputation | `ORC` orchestration |
| `CMP` composition | `PRS` persistence and verification infrastructure | | |

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
