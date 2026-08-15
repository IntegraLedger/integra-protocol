// The authority documents — what is served at each advertised URL, and as what.
//
// `capability-identity.ts` holds the identifiers that go on the wire. This file holds the documents behind
// them: one entry per advertised URL, naming the file that answers it and the media type it is served as.
// The worker that serves `integraledger.com/lcp/*` reads this list rather than keeping its own, so the
// deployment and the package cannot disagree about which documents exist.
//
// **The repo path IS the URL path.** Every entry's `path` is its URL's `/lcp/`-relative pathname, so the
// mapping is derivable rather than remembered, and a document cannot be filed somewhere its URL does not
// describe. `authority-drift.test.ts` derives the true set three ways — from this list, from the files on
// disk, and from the advertised URL constants — and refuses any disagreement in any direction. That is the
// standing rule about derived subject sets applied to this list itself: a list someone edits in one place
// is exactly the gate that silently empties.

import {
  A2A_LCP_EXTENSION_URI,
  LCP_CAPABILITY_SCHEMA_URL,
  LCP_CAPABILITY_SPEC_URL,
} from "./capability-identity.js";

/** The path prefix the authority worker's zone route owns. Every advertised document lives under it. */
export const AUTHORITY_PATH_PREFIX = "/lcp/";

/**
 * The media type a JSON Schema document is served as.
 *
 * `application/schema+json` is what `json-schema.org` serves its own meta-schemas as, and RFC 6839's
 * `+json` structured suffix means a conformant client parses it as JSON. Neither UCP nor A2A names a media
 * type for these fetches, so the host is silent and the registered-for-the-purpose type is the honest one.
 */
export const SCHEMA_MEDIA_TYPE = "application/schema+json";

/**
 * The media type a prose specification is served as.
 *
 * UCP calls its `spec` URL a "URL to human-readable specification document" and constrains nothing further;
 * A2A says only that a specification "should be hosted at the extension's URI". Markdown is the form the
 * document is authored in, and serving it as anything else would mean serving bytes that are not the canon.
 */
export const PROSE_MEDIA_TYPE = "text/markdown; charset=utf-8";

/** One document served under {@link AUTHORITY_PATH_PREFIX}. */
export interface AuthorityDocument {
  /** The absolute URL this document is advertised at, exactly as it appears on the wire. */
  readonly url: string;
  /** The document's path relative to the package's `authority/` directory, equal to the URL's path with
   *  {@link AUTHORITY_PATH_PREFIX} removed. */
  readonly path: string;
  /** The `Content-Type` this document is served with. */
  readonly contentType: string;
}

/**
 * Every document served under `integraledger.com/lcp/`. Four, because the x402 carrier schema moved to this
 * origin: `com.integraledger.*` is documented at `integraledger.com`, and hosting one profile of the
 * capability elsewhere would split it across two custodians.
 *
 * **Two of the four are obligations and two are ours by choice, and the difference matters when one
 * fails.** UCP authority-binds the `schema` URL and requires a platform to validate that binding before
 * fetching, so `legal-context.schema.json` is a conformance obligation. The `spec` URL's origin is
 * explicitly not bound ("MUST be `https` but MAY be served from any host"), and A2A's rule for extension
 * URIs is that they are identifiers whose HTTP access "is not expected". All four are served regardless:
 * the defect this list exists to close is not absence, it is answering 200 with a document that is not the
 * one advertised, which no counterparty's absence check detects.
 */
export const AUTHORITY_DOCUMENTS: readonly AuthorityDocument[] = [
  {
    url: LCP_CAPABILITY_SPEC_URL,
    path: "ucp/2026-07-30/legal-context",
    contentType: PROSE_MEDIA_TYPE,
  },
  {
    url: LCP_CAPABILITY_SCHEMA_URL,
    path: "ucp/2026-07-30/legal-context.schema.json",
    contentType: SCHEMA_MEDIA_TYPE,
  },
  {
    url: A2A_LCP_EXTENSION_URI,
    path: "a2a/legal-context/v1",
    contentType: PROSE_MEDIA_TYPE,
  },
  {
    url: "https://integraledger.com/lcp/x402/legal-context/v1.schema.json",
    path: "x402/legal-context/v1.schema.json",
    contentType: SCHEMA_MEDIA_TYPE,
  },
];
