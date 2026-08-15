git add -A && git commit -q -F - <<'MSG' && git push origin main 2>&1 | tail -1
A1/A2 — author the authority documents and guard them against drift

THE DEFECT, MEASURED TODAY: all three advertised URLs — and /lcp/does-not-exist — return HTTP 200 with the
site's SPA index, text/html, 2241 bytes. The nonsense path returning the same bytes proves a blanket
catch-all rather than a missing file. Worse than a 404: a counterparty that fetches the schema gets success
and an HTML page, and no absence check detects it. It ships into EVERY customer's discovery surface, because
emitUcpCapability takes no namespace.

Two schemas, authored from shipped code rather than fresh design. The UCP config schema is exactly what
normalizeCapabilityDeclaration enforces — minimumLevel required and one of the four LCP §3 levels, the two
accepted-lists optional but non-empty when present with non-blank entries, additionalProperties false
because an unknown key here is a requirement placed on the reader.

THE x402 CARRIER SCHEMA IS FOLDED IN AND MOVED ORIGIN. It pointed at legalcontextprotocol.org, which split
one capability across two custodians. com.integraledger.* is documented at integraledger.com, UCP
authority-binds its sibling schema to that origin for exactly that reason, and LCP §8 declines to canonize
any per-protocol integration profile — so hosting Integra's profile on the protocol's own domain would imply
an endorsement the standard withholds and a single steward the protocol does not have.

A2 IS THE CENTRE OF GRAVITY and asserts BOTH directions: every declaration the normalizer accepts the schema
validates, and every one it rejects the schema rejects. The second is the direction that rots quietly,
because a permissive schema still resolves. It also pins every advertised URL to the namespace authority's
origin, to https, and under /lcp/, and refuses to pass over an empty case set. Canaried three ways.

pnpm verify exits 0; discovery 192 passed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ha5DozgHitpQYZTi4JXkib
MSG