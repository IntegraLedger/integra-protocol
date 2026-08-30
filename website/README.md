# Integra LCP Packages — documentation site

The public documentation for the packages this repository publishes. Every package page is that
package's own `README.md`, rendered.

Next.js 16 (static export) · Fumadocs 16 (MDX) · Tailwind 4 · Cloudflare Pages. The same stack as the
`integra-agentic-terms` site, so a change made in one is legible in the other.

```bash
npm install          # this app has its own lockfile; it is NOT a pnpm workspace member
npm run dev          # http://localhost:3000
npm run build        # static export to out/
npm run typecheck    # the app, then the Pages Function under functions/
npm run check:export # assert the export carries what the site promises
```

From the repository root: `pnpm docs:dev` and `pnpm docs:build`. CI builds the site on every push (the
`docs` job in `.github/workflows/ci.yml`), so a page that fails to compile fails the push. It does not
deploy.

## ⛔ The READMEs are the documentation. This site renders them.

`pnpm check:docs` extracts every column-0 ` ```ts ` fence from `docs/`, the root README and every package
README and compiles it against the built workspace. A page here that restated a README would be the one
copy nothing compiles, so it would be the copy that goes stale.

So: **`scripts/generate-package-pages.mjs` writes one page per published package from that package's
`README.md` and its `package.json`, before every build.** The output lands in `content/docs/packages/` and
is **gitignored** — exactly one tracked copy of each README exists, in the package that ships it.

Three consequences worth knowing before editing anything here:

- **To change what a package page says, edit that package's `README.md`.** Editing the generated file
  changes nothing; the next build overwrites it. "Edit this page" on a package page points at the README
  for that reason.
- **The pages are `.md`, not `.mdx`**, so fumadocs compiles them as CommonMark. A README is written for
  npm and for GitHub and has never had to be valid JSX.
- **Sibling links are rewritten, not rewritten by hand.** The READMEs link to each other as
  `](../binding-core#readme)`, which is what resolves on npm; the generator maps those to
  `/packages/binding-core`. A relative link to something this site does not publish is a hard error.

`docs/developer/**` is **not** published by this site today. Those files stay where they are, still gated
by their fences. Adding them later is a `meta.json` entry and a second collection root — no rework of what
is here.

## ⛔ TypeScript written on this site is not compiled by anything

`check:docs` walks `docs/` and the package READMEs. It does **not** walk `website/content/`. A ` ```ts `
fence in an authored page here would be the only snippet on the site nothing typechecks, which is the
exact failure that gate exists to prevent — so `npm run check:export` refuses one. Put the snippet where
the gate can see it, or widen `scripts/check-doc-snippets.mjs` to reach here.

The generated package pages are exempt: their fences are the READMEs' fences, already checked at source.

## Layout

| Path | What it is |
|---|---|
| `content/docs/index.mdx` | the overview — the one authored page on this site |
| `content/docs/packages/` | **generated, gitignored** — one page per published package |
| `content/docs/meta.json` | sidebar order |
| `scripts/public-packages.mjs` | **the one derivation** of which packages this site documents |
| `scripts/generate-package-pages.mjs` | writes the package pages; runs from npm's `prebuild` |
| `scripts/check-export.mjs` | asserts on the bytes in `out/`; re-reads the manifests independently |
| `src/lib/site.ts` | **single source of truth** for the canonical origin, titles, and JSON-LD |
| `src/lib/packages.ts` | the package set and its version, read from the workspace at build |
| `src/components/DocView.tsx` | one renderer for the overview and for all package pages |
| `src/app/(docs)/` | the Fumadocs shell, the site root, and the catch-all docs route |
| `src/app/llms.txt/`, `src/app/llms-full.txt/`, `src/app/md/` | the AI-crawler index, the full-text export, and each page as `/md/<page>.md` |
| `src/app/{icon.svg,apple-icon.tsx,manifest.ts,opengraph-image.tsx}` | favicon, touch icon, web manifest, social card — Next file conventions, no hand-kept `<link>` tags |
| `public/_headers` | security headers (HSTS, a `'self'` CSP, …) and caching Cloudflare Pages applies to every response |
| `public/.well-known/security.txt` | RFC 9116 pointer at the GitHub Security Advisories intake |
| `functions/_middleware.ts` | folds the `.pages.dev` alias into the canonical host with a 301 |

Never hardcode the domain outside `src/lib/site.ts` — every absolute URL, canonical tag, sitemap entry,
robots directive and JSON-LD `@id` derives from `siteConfig.url`.

## What is derived, and from where

- **Which packages get a page** — the `private` field in each `packages/*/package.json`. Not a name
  pattern: `@integraledger/lcp-rail-invariants` is private and test-only and matches every name pattern
  the published packages match. `check:export` reads those manifests again, independently of the
  generator, and refuses an export whose page set disagrees with them.
- **The version** — the manifests, at build time. All of them are one `fixed` changesets group, and that
  they agree is asserted rather than assumed. It is the version at **HEAD**, which between a merge and a
  release is not the version on the registry; the site documents the code it was built from.
- **Last-modified dates** — the sitemap's `<lastmod>` and each page's "last updated" line come from git.
  A package page is dated by the **README it renders**, not by its own generated file, which has no
  history at all. Build from a full clone; `check:export` refuses a sitemap with a missing date.
- **"Edit on GitHub"** — the README for a package page, the `.mdx` for the overview.
- **Fonts** — Inter and JetBrains Mono are self-hosted by `next/font` and ship with the export. A page
  view makes no request to any third party, and `check:export` fails the build if a Google Fonts URL
  appears anywhere in `out/`.
- **"Copy Markdown" / "Open in …"** on every page point at that page's `/md/<page>.md`, rendered by the
  same function as `/llms-full.txt`, so what an agent is handed is what the page says.
- **Colour tokens** in `src/app/global.css` carry their measured WCAG contrast ratios in the comment
  beside them; change a colour, re-measure, restate the number.

## Adding a page

A **package** page needs nothing: publish the package with a `README.md` and it appears. A package that
belongs to no sidebar group is a hard error rather than a silent append — name it `binding-*` or
`placement-*`, or add it to `CORE_ORDER` in `scripts/public-packages.mjs`.

An **authored** page: write `content/docs/<name>.mdx` with `title` and `description` frontmatter, and add
`<name>` to `content/docs/meta.json`. A page missing from it still builds, but is unreachable from the
sidebar.

## Deploying

Static export in `out/`, served by Cloudflare Pages (`wrangler.toml` sets `pages_build_output_dir`).
Deploys are manual, as every Cloudflare surface in this organization is:

```bash
npm run build && wrangler pages deploy --remote
```

**The canonical host is `lcp-packages.integraledger.com`**, ruled 2026-08-30, written in `src/lib/site.ts`,
attached to the Pages project and live. It deliberately does not sit under `integraledger.com/lcp/*`, which
is held at the zone by another service — a distinct subdomain does not collide with a path route.

`functions/_middleware.ts` 301s the `integra-protocol.pages.dev` alias to whatever `siteConfig.url` names,
so the site is not two independently indexable copies of itself. It has to be a Pages Function, because
that alias lives on Cloudflare's zone and no redirect rule on `integraledger.com` can reach it. It fires
only while `CANONICAL_HOST_ATTACHED = "true"` in `wrangler.toml`.

⚠️ **That flag ships armed now, and the order it enforces is the point.** It was `"false"` until the
canonical host was attached and measured answering 200 — and the host did return 522 for the first minutes
after the domain was added, while the certificate provisioned. Arming the fold in that window would have
301'd the only host that served to one that did not answer. **If the canonical host is ever moved or
detached, set this back to `"false"` before the change, not after.**
