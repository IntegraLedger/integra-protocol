# Run the conformance suite

## What you will have at the end

A green conformance run over the shipped corpus, and a second run that drives **your own implementation** —
in whatever language you wrote it — against the same vectors. About twenty minutes for the first, longer for
the second because the second is real work.

Read [concepts/conformance.md](../concepts/conformance.md) first if you have not: it explains why the corpus
is the definition of agreement rather than a test suite that happens to exist. This page is the procedure.

You need Node 24 or newer. Everything in this repository is ESM-only.

## Step 1 — Install the package

Packages publish to **npmjs.com** under the `@integraledger` scope at `access: public`. Nothing needs
configuring — no `.npmrc`, no registry line, no token:

```bash
npm install @integraledger/lcp-conformance
```

The corpus arrives with the package. Nothing further is fetched or cloned:

```bash
ls node_modules/@integraledger/lcp-conformance/vectors
```

Every run prints the identity of the corpus it certified against, so you never have to establish it
separately:

```text
corpus: 44/44 areas, 847/847 cases, root ec4ad1b02a81538b… (authentic)
```

**Record that root digest beside any conformance claim you make** — it is what makes "we conform" a
statement someone else can check. `authentic` means the corpus matches the digest compiled into the package
you installed, so the run certified against the whole thing rather than against whatever happened to be on
disk. A run that cannot say that refuses rather than reporting a green.

## Step 2 — Run it

The package installs one executable, `lcp-conformance`. Invoke it by its **scoped package name**:

```bash
npx @integraledger/lcp-conformance
```

Naming the scope is deliberate, not verbosity. `npx` resolves a **package** before it falls back to a
locally installed binary, so a bare `npx lcp-conformance` asks the registry for an *unscoped* package of that
name. That name is not ours — it is unclaimed, and anyone may take it. Once installed locally the bare form
resolves from `node_modules/.bin` and is safe, but the scoped form is safe on any machine, in any order, and
is what the rest of this guide uses. Once it is on `PATH` after a global install, `lcp-conformance` on its
own is fine.

```text
conformance: 847 passed, 0 failed, 0 skipped (none)
```

That is one line, and every part of it is load-bearing.

- **`847 passed`** — the size of the corpus that actually ran. Quote this number, not the exit code. A green
  run over a shrunken corpus is a regression wearing a disguise, and `0 failed` cannot tell the two apart.
- **`0 failed`** — no case disagreed. The process exits `0`; a single failure exits `1`, so this is usable
  as a CI gate directly.
- **`0 skipped (none)`** — no area was excluded. Any other value here means the run was narrowed and is
  certifying less than it looks like.

What this particular run certifies is worth being exact about: it drove the `@integraledger/*` packages you
just installed, in-process, against the corpus that shipped beside them. It is an excellent installation
check and a genuine regression gate for a project that depends on these packages. It says nothing yet about
any implementation of your own — that is Step 4.

## Step 3 — Narrow it only when you mean to

`--phase` sets a cumulative **floor**, not a rung. `--phase P4` runs P1 + P3 + P4 and reports everything
above as skipped:

```bash
npx @integraledger/lcp-conformance --phase P4
```

```text
conformance: 458 passed, 0 failed, 14 skipped (vocabulary.protocolId, placement.manifestSchema, placement.acp, placement.ap2, placement.ucp, placement.a2a, placement.x402, placement.ack, placement.mpp, placement.visa-tap, placement.mastercard-vi, placement.dispatch, verify.referencePlacement, discovery.capability)
```

Green, and certifying roughly half of what the bare run certifies. The skipped areas are named individually
so this can never pass for a full run in a log. **Do not narrow the phase to produce a green.** With no flag
the runner uses the wired floor, which today is the whole corpus.

## Step 4 — Drive your own implementation

This is the part the corpus exists for, and it is *not* something the CLI can do: `lcp-conformance` always
drives the in-process JavaScript adapter, and no flag redirects it. Driving a foreign implementation is the
library API — `runCorpus` with a `CliSubject`.

### The contract your program has to satisfy

`CliSubject` spawns your command **once per case**, and for each one:

1. writes a single JSON **request** object to your process's stdin, followed by a newline, then closes stdin;
2. collects your process's entire stdout until it exits;
3. parses that stdout as a single JSON **response** object.

A request carries the operation class, the case input, and — for schema-validation areas only — the canonical
JSON Schema, inline. Three real ones, as they arrive on stdin:

```text
{"class":"byteInput","input":{"encoding":"utf8","data":"abc"}}
{"class":"assemble","input":[{"slot":"terms","value":"# Terms\nService provided as-is."},{"slot":"id","value":"0x9f8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c"}]}
{"class":"schema","input":{"lcp":"0.3","terms":"# Terms","id":"0x9f8b7a6c5d4e3f2a1b0c9d8e7f6a5b4c"},"schema":{"$schema":"https://json-schema.org/draft/2020-12/schema", …}}
```

The schema travels *with* the request rather than by path, which is what lets a subject stay
tree-independent: your program never has to know where the corpus lives, or that it lives on disk at all.

A response is either a produced output or a declared error code, and nothing else:

```text
{"output":"616263"}
{"error":"carrier/malformed"}
```

Your stderr is inherited, so anything you write there goes straight to your terminal — which is where
debugging output belongs. Stdout is reserved for the one response object. If stdout is not parseable JSON
the run **throws** rather than counting a failure: an unreadable subject is a broken harness, not a
disagreement about the protocol.

### A subject, in a language that is not this one

This one implements a single operation class and refuses everything else by name. It is nowhere near a real
implementation and is not meant to be — it is the smallest thing that proves the wiring works, so that the
next failure you see is about the protocol rather than about plumbing:

```python
#!/usr/bin/env python3
"""A minimal foreign LCP subject: reads one JSON request on stdin, writes one JSON response
on stdout. Implements the byteInput class only."""
import json
import sys

req = json.loads(sys.stdin.read())


def respond(obj):
    sys.stdout.write(json.dumps(obj))
    sys.exit(0)


if req["class"] != "byteInput":
    respond({"error": "unknown-class:" + req["class"]})

inp = req["input"]
enc = inp.get("encoding")
if enc not in ("utf8", "hex"):
    respond({"error": "byteInput/unknown-encoding"})
data = inp.get("data")
if not isinstance(data, str):
    respond({"error": "byteInput/bad-data"})
if enc == "utf8":
    respond({"output": data.encode("utf-8").hex()})
if not data.startswith("0x"):
    respond({"error": "byteInput/bad-hex"})
h = data[2:]
if len(h) % 2 != 0 or any(c not in "0123456789abcdefABCDEF" for c in h):
    respond({"error": "byteInput/bad-hex"})
respond({"output": bytes.fromhex(h).hex()})
```

### Point the runner at it

```ts
import { CliSubject, runCorpus } from "@integraledger/lcp-conformance";

// A DIRECTORY URL — the trailing slash is what makes the manifest resolve INSIDE the tree rather
// than beside it. This is the corpus that shipped inside the package you installed.
const vectors = new URL(
  "file:///srv/my-lcp/node_modules/@integraledger/lcp-conformance/vectors/",
);

// State the phase. `runCorpus` defaults to "P1" — 95 of the 847 cases — where the CLI defaults to
// the wired floor. Omitting it here is the quiet way to certify an eighth of the corpus. "P8" is
// the top of the ladder today; check `report.skipped` is empty rather than trusting this string.
const report = await runCorpus(new CliSubject("python3", ["subject.py"]), {
  vectors,
  phase: "P8",
});

const areas = new Set(report.failed.map((f) => f.area));
console.log(
  `conformance: ${report.passed} passed, ${report.failed.length} failed, ${report.skipped.length} skipped`,
);
console.log(`failing areas: ${areas.size} of 44`);
console.log(report.failed[0]);
```

```text
conformance: 13 passed, 834 failed, 0 skipped
failing areas: 43 of 44
{
  area: 'atrhash.compute',
  case: 'empty-terms',
  expected: '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  got: 'unknown-class:hashAtr'
}
```

That is what day one looks like, and it is the right shape: the thirteen `byteInput` cases pass because that
one operation class is implemented, and the other forty-three areas are open. The failure list is a work queue with the areas already
grouped. The command runs from the parent process's working directory, so `["subject.py"]` resolves relative
to wherever you start the script.

Note the report is a plain value — `{ passed, skipped, failed }`, with each failure carrying `area`, `case`,
`expected` and `got`. Nothing is printed for you and nothing throws on a red run; formatting and exit codes
are yours to choose.

## Step 5 — When a case fails

A failure is a disagreement between your implementation and a pinned decision about what the protocol means.
There are exactly two things it can be, and they are answered differently.

**Almost always: your implementation is wrong.** Read `expected` and `got` for the failing case, then open
the vector file the area names and read the neighbouring cases — the ones that pass tell you the boundary
the failing one sits on. Check the operation class's conventions first, because they are the common cause:
byte inputs arrive as `{ "encoding": "utf8" | "hex", "data": … }` with hex requiring a lowercase `0x`
prefix, and error assertions compare the **code**, never message text. Fix, re-run, and watch the passed
count rise.

**Occasionally: you and the corpus disagree about what the protocol requires.** That is a tier-two matter,
and [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) is the path. The short version, and the part that decides
what to do next: the corpus is not edited to accommodate an implementation. Nothing enters the standard
until it is battle-tested in production use, and standard-affecting changes require steering-committee
sign-off. A change to this repository cannot ratify a change to the specification — the
[specification](https://legalcontextprotocol.org/standard) is published separately and the Legal Context
Protocol is co-stewarded by **Integra Ledger** and **AAA-ICDR**.

So what actually helps is evidence rather than argument: the input bytes, the answer you compute, the
derivation of that answer produced with something that is not this implementation, and — most of all — a
production deployment that exercised the behaviour and the record of what it did. CONTRIBUTING's own rules
for changing a vector are the same three you would need to satisfy: land the failing vector first, re-derive
the pinned value independently, and record what the pin used to be and why it moved.

Contributions and proposals reach the maintainers through the co-stewards; CONTRIBUTING's "How work reaches
us" section is current on that.

## Reference — the whole CLI

Two flags. There are no others, and an unrecognised argument is ignored rather than rejected.

| Flag | Effect | Default |
|---|---|---|
| `--vectors <dir>` | Certify against a different corpus tree | the tree packaged with the build |
| `--phase <name>` | Lower the floor; areas above it report as `skipped` | the wired floor — today, the whole corpus |

Both fail loudly rather than falling back. A flag present with no value is an error, because `--vectors`
with a missing path would certify the packaged tree while you believed it was certifying yours — and
`--phase` with a missing value would run a different rung of the ladder. Each throws, and the process dies
with Node's usual stack trace under this line:

```bash
npx @integraledger/lcp-conformance --vectors
```

```text
Error: --vectors requires a path
```

```bash
npx @integraledger/lcp-conformance --phase P2
```

```text
Error: unknown phase: P2
```

And a real failure, from a corpus with one expected value altered — the summary line first, then one line
per failing case naming the area, the case, and both values:

```text
conformance: 846 passed, 1 failed, 0 skipped (none)
FAIL atrhash.compute / empty-terms: expected "0x0000000000000000000000000000000000000000000000000000000000000000" got "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

## Where next

- [concepts/conformance.md](../concepts/conformance.md) — why the corpus is the definition of agreement, the
  count ratchet, and what the corpus deliberately does not certify.
- [conformance README](../../../packages/conformance/README.md) — the runner API and the subject adapters.
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — the two tiers, the vector rules, and the repository's gates.
- [../getting-started.md](../getting-started.md) — assemble an ATR, hash it, and run the verification walk,
  if you have not yet.
