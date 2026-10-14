# Contributing to integra-protocol

Thank you for helping. This repository holds `@integraledger/lcp`, the reference implementation of the Legal Context
Protocol, its documentation and its shared test vectors. Bug reports, fixes, new rails and clearer documentation are
all welcome.

## Before you start

- **A bug:** open an issue with the smallest input that shows it, what you expected, and what the package returned.
- **A vulnerability:** do not open an issue. Report it privately; see [SECURITY.md](./SECURITY.md).
- **A new pairing or rail, or a change to a rule:** open an issue first. Every rule has one owner in this package and
  is fixed by the shared vectors, so a change to one is a change for every implementation that passes them.

## Setting up

You need Node.js `26.11.1` (see `.node-version`) and pnpm `12.11.2`. CI and the publish workflow take Node.js as
`node-v26.11.1-linux-x64.tar.xz` from `nodejs.org/dist`, checked against the SHA-256 the workflow holds, and pnpm as
two tarballs checked against their SHA-512.

```sh
git clone https://github.com/IntegraLedger/integra-protocol.git
cd integra-protocol
pnpm install --frozen-lockfile
pnpm -r --if-present run build
```

The workspace installs with `minimumReleaseAge: 1440` (no package version younger than a day), `trustPolicy:
no-downgrade` and `strictDepBuilds: true`. Every dependency and devDependency is pinned to an exact version. The
optional peer dependencies of `@integraledger/lcp`, the rails' own libraries, are ranges, each a caret or a tilde. Each
of them is also a devDependency, so the tests and vectors run on the version it pins.

## Checking your change

Run these before you open a pull request:

```sh
pnpm -r --if-present run build
pnpm -r --if-present run typecheck
pnpm -r --if-present run test
pnpm --filter @integraledger/lcp exec vitest run test/vectors.test.ts test/core.test.ts
node scripts/docs-samples.mjs
node scripts/docs-reference.mjs --check
```

- `docs-samples.mjs` compiles each TypeScript sample in the READMEs and `docs/` not marked `no-check` against the
  package you just built, runs it, and checks its output against the `text` block that follows it. A change that alters
  what a sample prints updates the sample.
- `docs-reference.mjs --check` checks the generated reference pages and the README's pairing list against the
  package, `lcp/src/internal/codes.ts` against the codes `docs/reference/refusals.md` lists, that page's stated total
  and namespace table against its rows, that it lists no code twice, and the page against the source both ways: the page
  lists each code the source passes to `refusal("…")` as a string literal, and each code the page lists is passed that
  way. Any other use of `refusal`, such as a call with another argument or through an alias, fails the check; a comment
  is not a use. After a change to the registry, the exports, the vectors or the refusal codes, run
  `node scripts/docs-reference.mjs` and commit what it writes.
- The site in `website/` builds with `pnpm install --frozen-lockfile && pnpm build` inside that folder. After a change
  to a doc comment or an export in `lcp/src`, run `pnpm run api` there and commit the API pages it writes under
  `docs/reference/api/`; CI checks that they match the source.
- `node scripts/check-lcp-documents.mjs --out website/out`, after the site's build, checks that the LCP documents the
  site publishes equal `lcp/profiles/` byte for byte, each with its type and caching. With no `--out`, it checks the
  live site the same way, after a deploy.
- `node scripts/check-pages.mjs --out website/out`, after the site's build, checks that every link on the site has a
  name: its text, a non-empty `aria-label`, `aria-labelledby` or `title`, or the `alt` of an image inside it.

CI runs the commands in the block above and the rest of `.github/workflows/ci.yml` on every push to `main` and when
dispatched by hand. No workflow runs on `pull_request`, and no check is required before a merge, so CI reads a change
once it is on `main`.

## The rules the code follows

- **One owner per rule.** Assembly, hashing and hash comparison live in the core (`lcp/src/core.ts`). Each pairing's
  binding lives in that pairing's module. Reuse them; never write a second version.
- **Hash the bytes delivered.** Never parse, re-serialise or canonicalise an ATR before hashing it.
- **Failures are values.** Return a refusal rather than throwing on a caller's input, with its `<namespace>/<reason>`
  code written out as a string literal in `refusal("…")`. Keep
  [`docs/reference/refusals.md`](./docs/reference/refusals.md) listing every code the package returns, and run
  `node scripts/docs-reference.mjs` and commit what it writes: `lcp/src/internal/codes.ts`, the set of those codes
  that MPP's `problem` reads.
- **Bounded.** Every reader call, decoded value and loop has a limit.
- **No business or legal logic.** The package checks the binding; it never judges amount, payee, asset, timing or
  payer against the ATR's content.
- **State what a binding proves, and no more.** A pairing's `pattern.proves` says what its payment shows and what it
  does not.
- **Expected values come from outside the code.** A test or vector takes its expected value from a specification's
  example, a standard test value, a live network read or an independent tool, and names the source. It never
  snapshots the package's own output.
- **Comments say what the code does.**

## Commits and the Developer Certificate of Origin

Every commit is signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org). The
sign-off certifies that you wrote the change, or otherwise have the right to submit it under this project's license.
Add it with `git commit -s`, which appends:

```text
Signed-off-by: Your Name <you@example.com>
```

using the name and email of your git configuration. On every push to `main`, CI reads every commit in `main`'s history
except one merge commit, exempt by its sha, and fails if a commit has no `Signed-off-by:` trailer or its message matches
the agent pattern in `.github/workflows/ci.yml` (`Co-authored-by`, `generated with` and the names it lists, in upper or
lower case). It runs after the push and cannot hold a commit back, so sign off every commit before you open a pull
request. To sign off commits you already made, run `git rebase --signoff origin/main` and force-push your branch.

## Pull requests

- Keep a pull request to one change, with a title that says what it does.
- Describe what changed and how you checked it: the commands and what they printed.
- Update the documentation and the vectors in the same pull request as the code they describe.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
