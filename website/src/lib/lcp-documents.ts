// The LCP documents this site publishes: each one's address on the site, the file in lcp/profiles/ that holds it, the
// type it is served as, and the title and description `/llms.txt` lists it under. scripts/lcp-documents.mjs writes each
// into out/ and re-exports this list for scripts/check-lcp-documents.mjs; src/lib/llms-files.ts lists them in /llms.txt.
// This module imports nothing, so that Node runs it from a script and the site's bundler from a route alike.

/** The site's origin, `siteConfig.url` in src/lib/site.ts. */
export const ORIGIN = "https://lcp.integraledger.com";

/** A profile, served in the Markdown it is written in. */
export const MARKDOWN = "text/markdown; charset=utf-8";

/** A JSON Schema, as json-schema.org serves its own meta-schemas; RFC 6839's `+json` suffix makes it JSON. */
export const SCHEMA = "application/schema+json";

/** Public, and cacheable for a day: UCP's hosting rule for a schema a profile references asks at least 60 seconds. */
export const CACHE_CONTROL = "public, max-age=86400";

export interface LcpDocument {
  /** Its address on the site. */
  path: string;
  /** The file of the repository that holds it, from the repository's root. */
  source: string;
  /** The Content-Type it is served with. */
  type: string;
  /** The name `/llms.txt` lists it under. */
  title: string;
  /** What `/llms.txt` says of it. */
  description: string;
}

export const DOCUMENTS: LcpDocument[] = [
  // UCP's x402 payment handler, com.integraledger.lcp.x402: its specification and its schema.
  {
    path: "/ucp/x402/2026-10-02",
    source: "lcp/profiles/ucp-payment-handler-x402.md",
    type: MARKDOWN,
    title: "UCP payment handler com.integraledger.lcp.x402, version 2026-10-02",
    description:
      "The x402 payment handler for UCP checkouts: its specification, in Markdown, at the address it names as its specification.",
  },
  {
    path: "/ucp/x402/2026-10-02/schema.json",
    source: "lcp/profiles/ucp-payment-handler-x402.schema.json",
    type: SCHEMA,
    title: "UCP payment handler schema",
    description: "The handler's JSON Schema, served as application/schema+json; its $id is this address.",
  },
  // LCP's A2A extension: its URI, where A2A says an extension's specification is hosted.
  {
    path: "/a2a/legal-context/v1",
    source: "lcp/profiles/a2a-legal-context-v1.md",
    type: MARKDOWN,
    title: "A2A extension legal-context v1",
    description: "The LCP extension for A2A task metadata: its specification, in Markdown, at the extension's URI.",
  },
];
