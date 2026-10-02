// The LCP documents this site publishes: each one's address on the site, the file in lcp/profiles/ that holds it, and
// the type it is served as. Run after `next build` (`pnpm build` does), this module writes each document into out/,
// byte for byte, and gives its address its headers in out/_headers. `scripts/check-lcp-documents.mjs`, at the
// repository root, checks the export and the live site against lcp/profiles/.
//
// A profile's address can also be the folder of its schema (`/ucp/x402/2026-10-02` and
// `/ucp/x402/2026-10-02/schema.json`), and one name cannot be both a file and a folder. Such a profile is written as
// `<address>.html`: the static assets serve `/a/b.html` at `/a/b`, with no redirect, and the address's `_headers` rule
// gives it its own type.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The site's origin, `siteConfig.url` in src/lib/site.ts. */
export const ORIGIN = "https://lcp.integraledger.com";

/** A profile, served in the Markdown it is written in. */
export const MARKDOWN = "text/markdown; charset=utf-8";

/** A JSON Schema, as json-schema.org serves its own meta-schemas; RFC 6839's `+json` suffix makes it JSON. */
export const SCHEMA = "application/schema+json";

/** Public, and cacheable for a day: UCP's hosting rule for a schema a profile references asks at least 60 seconds. */
export const CACHE_CONTROL = "public, max-age=86400";

export const DOCUMENTS = [
  // UCP's x402 payment handler, com.integraledger.lcp.x402: its specification and its schema.
  { path: "/ucp/x402/2026-10-02", source: "lcp/profiles/ucp-payment-handler-x402.md", type: MARKDOWN },
  { path: "/ucp/x402/2026-10-02/schema.json", source: "lcp/profiles/ucp-payment-handler-x402.schema.json", type: SCHEMA },
  // UCP's checkout extension com.integraledger.lcp.with: its specification and its schema.
  { path: "/ucp/with/2026-10-02", source: "lcp/profiles/ucp-checkout-lcp-with.md", type: MARKDOWN },
  { path: "/ucp/with/2026-10-02/schema.json", source: "lcp/profiles/ucp-checkout-lcp-with.schema.json", type: SCHEMA },
  // LCP's A2A extension: its URI, where A2A says an extension's specification is hosted.
  { path: "/a2a/legal-context/v1", source: "lcp/profiles/a2a-legal-context-v1.md", type: MARKDOWN },
];

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The bytes of a document, as lcp/profiles/ holds them. */
export const sourceBytes = (doc) => readFileSync(join(ROOT, doc.source));

/** The file in the export that serves a document: its address, or `<address>.html` where the address is a folder. */
export function exportFile(outDir, doc) {
  const folder = DOCUMENTS.some((d) => d.path.startsWith(`${doc.path}/`));
  return join(outDir, folder ? `${doc.path}.html` : doc.path);
}

/** The heading of the documents' rules in out/_headers; everything after it is this module's. */
export const HEADERS_HEADING = "# The LCP documents, from lcp/profiles/ (scripts/lcp-documents.mjs).";

if (import.meta.main) {
  const out = fileURLToPath(new URL("../out/", import.meta.url));
  const headersFile = join(out, "_headers");
  if (!existsSync(headersFile)) throw new Error(`${headersFile} does not exist: run next build first`);
  const before = readFileSync(headersFile, "utf8");
  const at = before.indexOf(`\n${HEADERS_HEADING}\n`);
  writeFileSync(headersFile, at === -1 ? before : before.slice(0, at));
  const rules = ["", HEADERS_HEADING];
  for (const doc of DOCUMENTS) {
    const file = exportFile(out, doc);
    mkdirSync(dirname(file), { recursive: true });
    copyFileSync(join(ROOT, doc.source), file);
    rules.push(doc.path, `  Content-Type: ${doc.type}`, `  Cache-Control: ${CACHE_CONTROL}`);
    console.log(`${doc.path} <- ${doc.source} (out/${relative(out, file)}, ${doc.type})`);
  }
  appendFileSync(headersFile, `${rules.join("\n")}\n`);
  console.log(`wrote ${DOCUMENTS.length} LCP documents into out/ and their headers into out/_headers`);
}
