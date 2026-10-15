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

- `docs-samples.mjs` reads every `README.md` in the tree and every page in `docs/` as CommonMark reads them, with
  `mdast-util-from-markdown`. It compiles each TypeScript sample, a code block fenced `ts` with backticks or tildes and
  not marked `no-check`, wherever it stands, in a list item or a block quote too, against the package you just built,
  runs it, and checks its output against the fenced `text` block that follows it in the same container. A block fenced
  in another TypeScript or JavaScript language (`tsx`, `js`, `mjs`, …) fails unless it is marked `no-check`. A change
  that alters what a sample prints updates the sample.
- `docs-reference.mjs --check` checks the generated reference pages and the README's pairing list against the
  package, `lcp/src/internal/codes.ts` against the codes `docs/reference/refusals.md` lists, that page's stated total
  and namespace table against its rows, that it lists no code twice, and the page against the source both ways: the page
  lists each code the source passes to `refusal("…")` as a string literal, and each code the page lists is passed that
  way. Any other use of `refusal`, such as a call with another argument or through an alias, fails the check. It reads
  each file under `lcp/src` as the syntax tree TypeScript's parser gives, so a use is the identifier `refusal`: a
  comment is not a use, nor is a word in the text of a string, template or regular expression literal. It also checks
  that the page marks as a read to repeat exactly the codes `readToRepeat` answers true for. After a change to the
  registry, the exports, the vectors or the refusal codes, run `node scripts/docs-reference.mjs` and commit what it
  writes.
- The site in `website/` builds with `pnpm install --frozen-lockfile && pnpm run browser && pnpm build` inside that
  folder, on Linux x64. `pnpm run browser` fetches, retrying a failed download five times, the browser build the
  Mermaid diagrams are drawn in, Chrome Headless Shell, which `website/scripts/browser.mjs` pins by version and by the
  SHA-256 of its archive, and the build refuses any other. The build is pinned for Linux x64 alone, since a browser
  build for another platform measures text through that platform's own font engine, so the site is built in CI or on a
  maintainer's Linux x64 machine. After a change to a doc comment or an export in `lcp/src`, run `pnpm run api` there
  and commit the API pages it writes under `docs/reference/api/`; CI checks that they match the source.
- `node scripts/check-lcp-documents.mjs --out website/out`, after the site's build, checks that the LCP documents the
  site publishes equal `lcp/profiles/` byte for byte, each with its type and caching. With no `--out`, it checks the
  live site the same way, after a deploy.
- `node scripts/check-pages.mjs --out website/out`, after the site's build, checks that every link on the site has a
  name: its text, a non-empty `aria-label`, `aria-labelledby` or `title`, or the `alt` of an image inside it. It also
  checks that every link to a fragment of a page on the site, `#x` or `/path#x`, finds an element with that id there.
- `node scripts/check-highlighting.mjs`, in `website/` after the site's build, highlights a TypeScript sample and a
  JavaScript sample with the options `source.config.ts` gives the code highlighter: once with the clock as it is, and
  once with a clock that moves 600 ms at every read while a sample is tokenized and its Twoslash popups are
  highlighted. It checks that both give the same HTML, and that `const` and `myObject` take github-light-default's
  colours. Each line is tokenized to its end however long that takes (`tokenizeTimeLimit: 0`), so a busy machine
  colours the code as an idle one does. It also checks that no other source under `website/` imports a module that
  highlights code.
- `node scripts/check-diagrams.mjs`, in `website/` after the site's build, draws every Mermaid diagram in the pages
  twice, the second time under a font configuration that changes every font's rendering, and checks that both give the
  same SVGs. It checks that a diagram with a character Inter does not draw is refused, and that the site serves the
  Inter files the diagrams are drawn in.
- Two builds of one commit are byte-equal. The build ID, which every page carries and which names the folder of the
  build's manifests under `/_next/static/`, is the commit's sha (`website/next.config.ts`); with uncommitted changes
  it is the sha and a digest of those changes. The Mermaid diagrams are drawn in the browser build and the font the
  repository pins, with no font of the machine's. CI's site job checks it with the step "Two builds of one commit are
  byte-equal", which fetches the browser again, builds again and compares the two `website/out` trees with `diff -r`.
  To check it, in `website/`:

  ```sh
  first=$(mktemp -d) && pnpm build && mv out "$first/out" && rm -rf .next && pnpm build && diff -r --brief "$first/out" out
  ```

CI runs the commands in the block above and the rest of `.github/workflows/ci.yml` on every push to `main`, when
dispatched by hand, and from the publish workflow before it packs. Its other steps check:

- **Node.js:** every job that runs a step fetches the Node.js `.node-version` names, checked against one SHA-256, in one
  step, byte for byte the same in every job, before its first other step that runs. Every download in a workflow is
  `curl -fsSL --retry 5 --retry-all-errors -o "$RUNNER_TEMP/<file>" https://<address>`, which retries a failed transfer
  five times whatever the error, and writes one file. No workflow uses `setup-node`, `continue-on-error`, `if:`,
  `container:`, `shell:` or a `PATH:` key, or writes `$GITHUB_ENV`, and only the Node.js and pnpm fetches write
  `$GITHUB_PATH`. Every workflow is written in YAML's plain block style: outside a block scalar (`run: |`), each line is
  one plain key and its value, with no flow mapping, anchor, alias, tag or quoted value that does not close on its own
  line, and a block scalar's header holds only its indicators and a comment. The step reads the jobs' steps only outside
  a block scalar, so the text a block scalar holds is never read as a step.
- **The install policy:** both `pnpm-workspace.yaml` files set `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade`
  and `strictDepBuilds: true`, and no other setting but `packages` (`"*"` and `"!website"`, so `pnpm -r` reaches every
  package), `permissions` (each package's `build` and `skills` decisions, every one `false`), `minimumReleaseAgeExclude`
  (`@integraledger/*` only) and `overrides` (registry versions only). `allowBuilds` and `allowSkills` are refused, so
  every package decision is in one place. Every package in both lockfiles comes from the registry by its integrity, and
  no dependency is a file, directory, link, git or tarball source. No workflow sets pnpm's settings by a `pnpm_config_`
  environment variable, a `--config.` flag or the `pnpm config` command, its alias or its shorthands. The step reads the
  committed files and the workflows' lines. A workflow step that rewrites a checked file before the install, such as a
  `sed -i` on `pnpm-workspace.yaml`, or that builds a setting's name at run time, is code, like a step that deletes this
  check, and this check does not read it.
- **One-way imports:** no package here, nor the root `package.json`, depends on or names another `@integraledger`
  package, however the name is loaded or resolved; the site names only `@integraledger/lcp`. Each workspace package
  has a `build`, `typecheck` and `test` script that is not empty, since `pnpm -r` skips a package without one.

No workflow runs on `pull_request`, and no check is required before a merge, so CI reads a change once it is on
`main`.

## The rules the code follows

- **One owner per rule.** Assembly, hashing and hash comparison live in the core (`lcp/src/internal/core.ts`), which the
  package root and `@integraledger/lcp/core` export. Each pairing's binding lives in that pairing's module. Reuse them;
  never write a second version.
- **Hash the bytes delivered.** Never parse, re-serialise or canonicalise an ATR before hashing it.
- **Failures are values.** Return a refusal rather than throwing on a caller's input, with its `<namespace>/<reason>`
  code written out as a string literal in `refusal("…")`. Keep
  [`docs/reference/refusals.md`](./docs/reference/refusals.md) listing every code the package returns, and run
  `node scripts/docs-reference.mjs` and commit what it writes: `lcp/src/internal/codes.ts`, the set of those codes
  that MPP's `problem` reads. Class each new code: a read to repeat, whose answer rests on a read that may answer
  differently later with nothing the caller must change, goes in `lcp/src/internal/reads-to-repeat.ts`, and
  `lcp/test/refusal-classes.ts` gives every code its class.
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

## Releases

Each release of `@integraledger/lcp` is the annotated tag `v<version>` on the commit on `main` that sets that version,
made in this order:

1. A pull request sets the version in `lcp/package.json`.
2. It is merged to `main`.
3. A maintainer tags that commit `v<version>` with an annotated tag (`git tag -a v<version> -m v<version> <commit>`)
   and pushes the tag.
4. A maintainer dispatches the publish workflow from the tag. Its first job fails unless the run's ref is the
   annotated tag `v<version>` of the version `lcp/package.json` names and the tag's commit is on `main`. CI then runs every check on
   that commit, and only then does the `pack` job pack the package and the `stage` job stage it on npm, where a
   maintainer approves it.

To link the documentation of a release, link the tag's copy:
`https://github.com/IntegraLedger/integra-protocol/tree/v<version>/docs`.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
