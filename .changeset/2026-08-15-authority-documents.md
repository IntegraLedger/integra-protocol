---
"@integraledger/lcp-discovery": minor
---

Publish the authority documents behind the capability's advertised URLs, and ship the index that says which
documents exist.

Four URLs are advertised under `integraledger.com/lcp/`: the UCP capability specification and its
configuration schema, the A2A extension specification, and the x402 carrier schema. Two of the four had a
document; the specification and the extension URLs had none, and every one of the four resolved to the
marketing site's SPA index — HTTP 200, `text/html`, identical bytes, including for paths that do not exist.
A counterparty that followed one got success and a document that was not the one advertised, which no
absence check detects. The capability name is constant across deployments, so every seller advertising it
advertised the same four URLs.

The two prose specifications are now authored, at paths equal to the URLs that serve them. `authority/` ships
with the package, so the worker that serves these URLs and the package that advertises them read one source.

`AUTHORITY_DOCUMENTS` is the new export: one entry per advertised URL, naming the file that answers it and
the media type it is served as. Schemas are `application/schema+json`, which is what `json-schema.org` serves
its own meta-schemas as and what RFC 6839's `+json` suffix makes parseable as JSON; prose is
`text/markdown; charset=utf-8`. Neither UCP nor A2A names a media type for these fetches.
