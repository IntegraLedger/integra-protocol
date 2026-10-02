# Documentation site

The app that renders the repository's documentation as the site at <https://lcp.integraledger.com>: Fumadocs on Next.js,
exported as static files and served by Cloudflare as a Worker's static assets. The content lives in the Markdown files
under `../docs/`; this folder holds only the app. The documentation folder is named once, in
[`src/lib/docs-dir.ts`](src/lib/docs-dir.ts).

This folder has its own lockfile and is not part of the repository's pnpm workspace.

## Run it

The TypeScript samples in the pages are type-checked against the package's built declarations, so
build the package first, at the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @integraledger/lcp run build
```

Then, in this folder:

```sh
pnpm install --frozen-lockfile
pnpm run api     # regenerate the API pages (reference/api/ in the documentation folder) from ../lcp/src
pnpm build       # write the static site to out/
pnpm dev         # serve it locally with live reload
```

## What the build does

- Renders every page under the documentation folder, in the order its `meta.json` files give.
  The home page is `index.md`.
- Drops each page's leading `# Title` (the page layout shows the frontmatter title).
- Turns relative links to `.md` pages into site links, and relative links to any other file in the
  repository into links to that file on GitHub. A link to a page that does not exist fails the build.
- Type-checks every ```` ```ts ```` block with Twoslash, against `../lcp/dist` and `viem`; a type
  error fails the build. A block whose meta carries `no-check` is highlighted only. Blocks in the
  generated API pages are not checked.
- Renders ```` ```mermaid ```` blocks as diagrams.
- Writes `/llms.txt`, `/llms-full.txt`, each page as Markdown at `/md/<path>.md`, the search index,
  `sitemap.xml`, `robots.txt` and `/.well-known/security.txt`.
- Then `scripts/lcp-documents.mjs` writes each LCP document, byte for byte from `../lcp/profiles/`, at its
  address (`/ucp/x402/2026-10-02`, its `schema.json`, and the rest it lists), and gives each address its type and
  `Cache-Control: public, max-age=86400` in `out/_headers`. A profile whose address is also its schema's folder is
  written as `<address>.html`, which the static assets serve at the address itself.
