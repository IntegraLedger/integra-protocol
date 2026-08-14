# Contributing

The Legal Context Protocol is co-stewarded by **Integra Ledger** and **AAA-ICDR**. This repository is the
reference implementation of the standard's open layer. The specification itself is published at
[legalcontextprotocol.org/standard](https://legalcontextprotocol.org/standard) and is not edited here —
which is the first thing to know about contributing, because it decides which of two bars your change
has to clear.

Before changing anything, read [**docs/developer/**](docs/developer/index.md) — the concepts explain the
model this repository implements, and the guides are end-to-end procedures against the shipped packages.
[implement-a-binding](docs/developer/guides/implement-a-binding.md) and
[add-a-placement](docs/developer/guides/add-a-placement.md) are the two paths most contributions take, and
both end in a vectors-first definition of done that this file's gates then enforce.

## Two tiers

**Implementation improvements are welcome.** Performance, clarity, portability, better tests, a sharper
error message, a missing edge case in an existing rule — anything that leaves observable protocol
behaviour unchanged. These are ordinary engineering and are reviewed as such.

**Changes to protocol semantics, wire formats, or the conformance corpus are held to a different bar:**
nothing enters the standard until it is battle-tested in production use, and standard-affecting changes
require steering-committee sign-off. That is policy rather than backlog — a well-argued change is held
by the same rule as a poorly-argued one, and being right is not the thing that moves it.

Two consequences worth stating plainly:

- A change here cannot ratify a spec change. If a proposal alters what the wire carries or what
  conformance means, this repository is where a decision gets *implemented*, never where it gets *made*.
  The useful contribution in that case is the evidence — a production deployment that exercised the
  behaviour, and the record of what it did.
- "Observable protocol behaviour" is a wider category than it first looks. It includes every hash a
  counterparty could recompute, every field name on the wire, every verdict the verification walk emits,
  and the class ladder that decides those verdicts. Refactoring the code that produces them is tier one.
  Changing what they produce is tier two.

If you are not sure which tier a change is in, the conformance corpus answers it: if `lcp-conformance`
would have to change, it is tier two.

## Vectors are load-bearing

`vectors/` is not a fixture directory. It is the artefact that decides whether an independent
implementation agrees with this one, and it is shipped to consumers inside `@integraledger/lcp-conformance`.
Three rules follow, and they are not negotiable:

1. **Land the failing vector first.** Add the vector, confirm it fails, and confirm it fails *for the
   reason you expect* — then implement. A vector written after the code merely records that the code
   agrees with itself.
2. **Re-derive pinned oracle values independently.** When a pinned hash, digest, or encoded byte string
   has to change, compute the new value from the input bytes with something that is not this
   implementation — a throwaway `python3`/`hashlib` script, `cast keccak`, a second library. Show the
   derivation in the changeset. Copying what the implementation now emits proves nothing.
3. **Record the superseded pin.** A changed vector should say what it used to be and why it moved, so the
   change is auditable years later by someone who was not in the room.
4. **Re-seal.** `vectors/` is sealed — per-file digests and per-area case counts in
   `vectors/conformance/corpus-seal.json`, under one root digest. Run `pnpm corpus:seal` after any vector
   change and commit the result. `pnpm verify` runs `corpus-seal --check` as its third stage, so skipping
   this does not produce a subtle problem later; it produces a red build immediately, with no obvious
   connection to the vector you edited unless you know the seal exists.

Every area in the corpus manifest carries a phase, and `lcp-conformance` runs at the wired floor by
default. Do not narrow the phase to produce a green — a run that skips areas prints the skips loudly for
exactly this reason.

## The gates

```bash
pnpm verify          # check:versions → check:docblocks → check:live-rails → corpus-seal → audit → build
                     #   → check:dist → lint → depcruise → typecheck → check:docs → test
pnpm mutation <pkg>  # mutation score against that package's ratchet
pnpm conformance            # the whole corpus, no --phase
```

`pnpm verify` must exit 0. It builds first because workspace packages consume each other through built
`dist/`, and because `isolatedDeclarations` means a package's `.d.ts` is emitted rather than inferred — a
stale `dist` feeds wrong types to every downstream typecheck. `depcruise` is a real gate, not decoration:
the kernel is zero-dependency, chain SDKs are confined to their own binding, and no lower tier may import
an upper one.

**Mutation ratchets only move up.** Each package's `break` threshold in `stryker.config.mjs` sits just
under its measured score, and CI enforces it. Raise it when the score rises; never lower it to make a
build pass. If a change drops a score, the test that should have caught the mutant is missing — write it.
A suite that never fails when the code is wrong is indistinguishable from one that works, and coverage
does not tell the two apart.

Changes that affect a published package need a changeset (`pnpm changeset`). Write it as part of the
work, in prose that explains the reasoning and not just the diff.

## House rules

These are absolute in this codebase and a change that violates one will not land regardless of merit:

- **Fail fast and loud.** No mocks, no silent fallbacks, no backward-compatibility shims. A port
  implementation — a real, deterministic implementation of an interface the unit is pure over, with the
  real behaviour proven elsewhere — is allowed, and must say in a comment that that is what it is.
- **TypeScript `strict`**, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `isolatedDeclarations`. No `any` without an `// @ts-expect-error <reason>`.
- **Remove dead code and stale comments** in the same change that makes them dead. A comment that
  misdescribes a boundary the code correctly holds is a defect.

## How work reaches us

This repository is public and forking is enabled, but **CI runs `on: [push]` only** — a pull request from a
fork triggers no checks, so a PR cannot demonstrate green here. Work lands directly on `main`.

Issues are open, and a bug report, a question about a manifest, or a correction to something a package
claims about a host protocol is welcome as one. Larger proposals — a new binding, a new placement, a change
to the conformance corpus — reach the maintainers through the co-stewards, because those are decisions about
the protocol rather than about this tree. **Security reports are the one thing that must not be an issue:
follow `SECURITY.md`**, whose private channel is authoritative for vulnerabilities.

## Licence, and what you are attesting

Apache-2.0. Contributions are licensed under its Section 5, and the licence does not grant trademark use
(Section 6).

**There is no CLA. There is a DCO sign-off.** Every commit carries a `Signed-off-by:` trailer:

```bash
git commit -s -m "…"
```

That trailer is the [Developer Certificate of Origin](https://developercertificate.org) 1.1: you are
stating that you wrote the change, or have the right to submit it under Apache-2.0, and that you understand
it is public and permanent. Nothing more. You keep your copyright, you assign nothing, and there is no
document to sign or account to create.

The choice is deliberate in both directions. A **CLA** was rejected because it asks contributors to grant
this project more than the licence the project itself ships under, and for a reference implementation of an
openly stewarded standard that asymmetry is hard to justify. **Silence** was rejected because LCP is
co-stewarded and its software gate (below) exists to move battle-tested work toward the standard — and a
contribution whose provenance was never attested is exactly the one that becomes difficult to move later,
when the contributor may be unreachable. A sign-off costs one flag and produces a per-commit record that
cannot be reconstructed after the fact.

If you forget it, `git commit --amend -s` fixes the last commit and
`git rebase --signoff <base>` fixes a branch; nobody is going to make a contribution difficult over a
missing trailer.

The licence is encoded, not merely recorded: [LICENSE](LICENSE) and [NOTICE](NOTICE) sit at the root, every
`package.json` carries `"license": "Apache-2.0"`, and `scripts/sync-license.mjs` copies both files into each
tarball at `prepack` so a consumer who never sees this repository still receives them. NOTICE travels
because Apache-2.0 §4(d) requires it to — npm force-includes `LICENSE` on its own, but not that.

The vendored `lib/commerce-payments` submodule is Coinbase's, under its own MIT licence, and is not covered
by the above.
