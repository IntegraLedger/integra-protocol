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
pnpm run browser # fetch the browser that draws the Mermaid diagrams into .browser/, checked by its SHA-256
pnpm run api     # regenerate the API pages (reference/api/ in the documentation folder) from ../lcp/src
pnpm build       # write the static site to out/
pnpm dev         # serve it locally with live reload
```

The diagrams are drawn in one browser build: Chrome Headless Shell 156.0.8078.4 for Linux x64, the build the locked
`playwright-core` names, from Chrome for Testing's
[download bucket](https://googlechromelabs.github.io/chrome-for-testing/). `scripts/browser.mjs` holds its version, its
address and the SHA-256 of its archive; `pnpm run browser` fetches the archive, retrying five times after a
network error or an answer other than 2xx, checks it and unpacks it. The build uses no other browser: on a
machine without it, it stops and names that command.

The site is built on Linux x64, in CI or on a maintainer's Linux x64 machine. The browser build is pinned for that one
platform because a build for another platform measures text through that platform's own font engine, so its diagrams
could differ; on another platform the build stops and names the platform it is pinned for.

## What the build does

- Renders every page under the documentation folder, in the order its `meta.json` files give.
  The home page is `index.md`.
- Drops each page's leading `# Title` (the page layout shows the frontmatter title).
- Turns relative links to `.md` pages into site links, and relative links to any other file in the
  repository into links to that file on GitHub. A link to a page that does not exist fails the build.
- Type-checks every ```` ```ts ```` block with Twoslash, against `../lcp/dist` and `viem`; a type
  error fails the build. A block whose meta carries `no-check` is highlighted only. Blocks in the
  generated API pages are not checked. Twoslash runs on the TypeScript 7 that `fumadocs-twoslash`
  depends on; the TypeScript 6.0.3 in `devDependencies` is for TypeDoc (`pnpm run api`), whose
  supported TypeScript range ends at 6.0. Hovering, focusing or clicking an identifier in a checked
  block shows its type and documentation: the build writes each page's distinct popups to
  `/twoslash/<path>.json`, which the page fetches when a reader first opens one.
- Renders each ```` ```mermaid ```` block to SVG with the `mermaid` package, in the pinned Chrome Headless
  Shell, once in a light and once in a dark theme. Every text is measured and drawn in Inter, from the
  `@fontsource-variable/inter` package, and in no font of the machine's: the browser has a font
  configuration of its own with no font in it. A diagram with a character Inter does not draw fails the
  build. Both SVGs are in the page's HTML, and the page shows the one for the reader's theme; the site serves
  the same Inter files, and no diagram code runs in the browser.
- Draws the social card at `/opengraph-image` with `next/og`, in Geist Regular, the one font `next/og` bundles, read
  from the installed `next` package. A character of the card's text that Geist does not draw fails the build, named,
  since `next/og` would fetch a font or an emoji for it.
- Asks the network nothing: `next.config.ts` turns off the upgrade check `next build` makes under a coding agent
  (`experimental.agentUpgrade: false`), and the build script empties `__NEXT_AGENT_UPGRADE`, the environment variable
  that turns the check on whatever the configuration says, and sets `NEXT_TELEMETRY_DISABLED=1`.
- Writes `/llms.txt`, `/llms-full.txt`, each page as Markdown at `/md/<path>.md`, the search index,
  `sitemap.xml`, `robots.txt` and `/.well-known/security.txt`.
- Then `scripts/lcp-documents.mjs` writes each LCP document, byte for byte from `../lcp/profiles/`, at its
  address (`/ucp/x402/2026-10-02`, its `schema.json`, and the rest it lists), and gives each address its type and
  `Cache-Control: public, max-age=86400` in `out/_headers`. A profile whose address is also its schema's folder is
  written as `<address>.html`, which the static assets serve at the address itself.

## How it is served

`wrangler.toml` serves `out/` as a Worker's static assets, with `worker.js` in front of the page addresses and
their `.md` addresses only:

- `/<path>.md`, and `/index.md` for the home page, answer with the page's Markdown copy (the address
  [llmstxt.org](https://llmstxt.org) proposes). `/llms.txt` links each page there.
- A request for a page whose `Accept` header ranks `text/markdown` (or `text/x-markdown`) at least as high as
  `text/html` gets the same Markdown at the page's own address; `text/plain` is not a Markdown type and gets HTML.
  A page address that ends in a slash redirects to the address without it, for Markdown as for HTML. Every
  response for a page address carries `Vary: Accept`, and a conditional request for a Markdown copy can be
  answered 304.
- Every other file is served directly, without the Worker: the LCP documents, the Markdown copies, the scripts, and
  every `.txt` file, the RSC payload each page fetches among them. Every response the Worker returns is a static
  assets response, so the rules in `public/_headers` and `out/_headers` apply to all of them.

Each page names `/llms.txt` with `<link rel="describedby">` and its Markdown with `<link rel="alternate"
type="text/markdown">`. `pnpm dev` does not run `worker.js`.

No workflow deploys the site. A maintainer deploys it after a build on Linux x64 (see "Run it"), at the repository
root:

```sh
npx wrangler deploy -c website/wrangler.toml
```
