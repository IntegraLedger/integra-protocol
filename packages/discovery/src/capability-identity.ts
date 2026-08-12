// The identity of the LCP capability we advertise — the names and URIs that go on the wire, in one file
// because they are the part a reader must be able to check at a glance.
//
// **`org.legalcontextprotocol.*` is RESERVED for a capability the LCP TSC has ratified, and is never emitted
// today.** A deployment advertises under its own reverse-domain namespace instead. Reserved is not
// available. Publishing the standard's own namespace before the standard's governing body has ratified
// anything would spend the standard's name on one vendor's deployment — the same reason
// `placement-mastercard-vi` refuses that namespace in code. Nothing in this package can be configured to
// emit it, and the repository's capability tests holds that shut — every constant below is checked, so a future edit
// cannot slip the reserved namespace in through one of them while the others still read correctly.

/**
 * The UCP vendor capability name — the profile-level advertisement, not a carrier. `placement-ucp` writes
 * the reference into a `policies[]` entry, keyed `com.integraledger.legal_context` inside a policy tagged
 * `com.integraledger.policy.legal_context`; UCP has no `extensions` map for a checkout response to carry
 * one in. The three are distinct surfaces and are deliberately spelled with ONE vocabulary, so a
 * counterparty reading a profile and a counterparty reading a checkout are demonstrably looking at the same
 * deployment's claim.
 *
 * **UNDERSCORE, MATCHING THE HOST.** This was `com.integraledger.legal-context`. UCP spells its own
 * vocabulary with underscores throughout and uses no hyphens — `dev.ucp.shopping.checkout`,
 * `com.example.loyalty_gold`, `com.example.policy.price_match` — and our own policy carrier already
 * followed that while this name did not. No host forces either spelling (ACP's identifier pattern admits
 * both, and it is the only host that constrains the shape at all), which is exactly why the house had to
 * rule it rather than inherit it. The rule is: follow the vocabulary you are writing into. That is also why
 * `LEGAL_CONTEXT_WELL_KNOWN_PATH` keeps its hyphen — RFC 8615 well-known names are hyphenated.
 *
 * The retired spelling survives on purpose in `binding-core`'s kit fixtures, where it is sample input to
 * container-validation cases cut against v1.37 §C.3's `extensions` shape. Those are historical by
 * construction and assert nothing about this deployment's identity.
 *
 * UCP's convention is `[reverse-domain].{service}.{capability}`. Three components rather than four is the
 * host's own vendor pattern (`com.example.*`, `org.acme.*`), and the registered names run to five
 * (`dev.ucp.shopping.catalog.search`), so the template describes the naming rather than fixing a segment
 * count. The authority is the leading reverse domain, which is what {@link LCP_CAPABILITY_AUTHORITY_ORIGIN}
 * has to match.
 */
export const LCP_CAPABILITY_NAME = "com.integraledger.legal_context";

/**
 * The origin the `schema` URL under {@link LCP_CAPABILITY_NAME} must have — the `spec` URL is NOT bound to
 * it. UCP, verbatim at HEAD 2026-08-08: "a declared `schema` URL's origin MUST match the namespace
 * authority in its name", and "The authority is derived from the `schema` URL host."
 *
 * An earlier docblock quoted the host as saying platforms "SHOULD reject capabilities where the spec origin
 * does not match". **That sentence is not in the live text** — a search at HEAD for both "SHOULD reject"
 * and "spec origin" returns zero — and the paragraph it purported to summarise says the opposite: the spec
 * URL's "origin is NOT authority-bound: it MUST be `https` but MAY be served from any host".
 *
 * The binding on `schema` is the useful property a vendor capability inherits — the party asserting legal
 * context is provably the party that controls the domain the capability is named for — and it is why the
 * reader enforces it rather than trusting the name. UCP is explicit that this is provenance, not trust:
 * "a valid binding proves only that the reverse-domain name is controlled by the party that owns the
 * corresponding domain."
 */
export const LCP_CAPABILITY_AUTHORITY_ORIGIN = "https://integraledger.com";

/** The capability's own entity version. UCP requires `YYYY-MM-DD` ("Entity version in YYYY-MM-DD format");
 *  this is the date the capability was defined, not the date of the UCP spec it is declared alongside. */
export const LCP_CAPABILITY_VERSION = "2026-07-30";

/** The `spec` URL this deployment emits. UCP makes `spec` a MAY and does NOT authority-bind it (https,
 *  any host); we serve it from our own origin by choice. **Serving a
 *  document here is outstanding**, and the real failure mode is worse than a 404: measured 2026-08-08, this
 *  URL answers **HTTP 200 with the site's SPA index** (`text/html`, ~2.2 kB), as does the schema URL below.
 *  A UCP counterparty validating the binding checks the origin and is unaffected; one that also FETCHES
 *  gets a success and a document that is not the one advertised, which no absence check detects. §C.3
 *  records that platforms "MUST validate that binding" — and the binding is on the SCHEMA url, so a
 *  `spec` that 200s with the wrong document is not a conformance failure, it is a deployment lying to a
 *  reader who followed it. Publish the documents; do not rely on a 404 reading as "not yet". */
export const LCP_CAPABILITY_SPEC_URL =
  "https://integraledger.com/lcp/ucp/2026-07-30/legal-context";

/** UCP's REQUIRED `schema` URL, authority-bound the same way and outstanding the same way — and
 *  answering 200-with-HTML the same way. */
export const LCP_CAPABILITY_SCHEMA_URL =
  "https://integraledger.com/lcp/ucp/2026-07-30/legal-context.schema.json";

/**
 * The A2A Agent Card extension URI.
 *
 * **Versioned in the path because the host requires it:** "A new URI MUST be used when introducing a
 * breaking change to an extension's logic, data structures, or required parameters", and an agent asked for
 * a version it does not support "MUST NOT fall back to a different version". `/v1` is the host's own example
 * form (`https://example.com/ext/konami-code/v1`).
 *
 * **The SHOULD we satisfy and the one we decline.** A2A's Implementation Considerations say the
 * specification document "should be hosted at the extension's URI" — we intend to, and it is outstanding
 * alongside the two UCP documents. Authors are also "encouraged to use a permanent identifier service, such
 * as `w3id.org`"; we decline that one with a reason: UCP already requires this capability's documents to be
 * served from the namespace authority, and routing the A2A identifier through a third-party redirector would
 * give one capability two custodians. Neither is an obligation — A2A's own governing rule for the official
 * namespace is that "These URIs are identifiers, HTTP access is not expected" — so no counterparty's read of
 * a declaration depends on either.
 */
export const A2A_LCP_EXTENSION_URI =
  "https://integraledger.com/lcp/a2a/legal-context/v1";

/**
 * The request header a client uses to ACTIVATE an A2A extension, which is a separate act from declaring it:
 * "Extensions default to being inactive."
 *
 * **The name changed at v1.0 and only the new spelling is emitted.** It was `X-A2A-Extensions` through
 * v0.3.0 (`docs/topics/extensions.md` line 110 at the `v0.3.0` tag) and is `A2A-Extensions` in the released
 * v1.0 (same file, lines 172-189 at `0ef1b02`). LCP v1.38 §C.8 shows the v1.0 spelling and records the
 * rename itself. No shim
 * accepts the old one: an agent speaking A2A v0.3.0 is speaking a superseded protocol version, and quietly
 * honouring both would hide that from a deployment that needs to know.
 */
export const A2A_EXTENSION_ACTIVATION_HEADER = "A2A-Extensions";
