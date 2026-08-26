---
"@integraledger/lcp-discovery": patch
---

`LCP_MCP_EXTENSION_ID` — the fourth wire identity, spelled in MCP's vocabulary.

MCP revision 2026-07-28 advertises optional extensions in the `extensions` field of capabilities, keyed by
a `{vendor-prefix}/{extension-name}` identifier with the prefix mandatory. This package already owns every
identifier of that class — `LCP_CAPABILITY_NAME` for UCP, `A2A_LCP_EXTENSION_URI` for A2A — and
`check:wire` in the buyer-side repo derives its seal by importing this package, so an MCP identifier
declared anywhere else would be both a second home for a wire identity and invisible to the gate that
exists to catch drift.

⭐ **SLASH AND HYPHEN, BY THE HOUSE RULE RATHER THAN BY TASTE.** *Follow the vocabulary you are writing
into* is what gave `LCP_CAPABILITY_NAME` its underscore, because UCP spells its own vocabulary that way.
Applied to MCP the same rule gives the opposite answer: MCP's own extensions are
`io.modelcontextprotocol/ui`, `/tasks` and `/oauth-client-credentials` — a slash after the prefix and
hyphens in the name half. So this is `com.integraledger/legal-context`, one character from UCP's
`com.integraledger.legal_context` and deliberately not the same string. Same deployment, same claim, two
hosts, two spellings; that is the one-vocabulary property working rather than a collision.

⭐ **NO VERSION SEGMENT, AND THE CONTRAST WITH A2A IS THE REASON.** `A2A_LCP_EXTENSION_URI` carries `/v1`
because A2A requires a NEW URI on a breaking change and forbids falling back. MCP versions the same event
by requiring a new IDENTIFIER — a `-v2` suffix on the name half — and prefers capability flags or settings
fields over a rename outright. Retrofitting `-v1` would invent a spelling the host does not use and would
make every future non-breaking revision look like it owed an explanation.

⛔⛔ **THE RESERVED-NAMESPACE GUARD WAS A HAND-WRITTEN LIST, AND THIS EXPORT IS EXACTLY THE EDIT IT
POLICES.** The test that holds `org.legalcontextprotocol.*` shut iterated five named constants — a set that
stays exhaustive only until someone adds a sixth, and adding a sixth is the thing it exists to catch. It
now derives its subjects from the module's own string exports, so a new wire identity is covered on the day
it is written rather than when somebody remembers. Safe to derive here because the EXPECTATION stays a
fixed literal: the tree supplies the subjects, never the rule they are judged against. **Proven with a
planted sixth constant carrying the reserved namespace — the old list passed it, the derived guard fails
it.**

Three further canaries drive the new assertions red and the tree restores green: the UCP underscore
smuggled into the MCP id, the dot form in place of the mandatory slash, and a retrofitted `-v1`.

MCP reserves any prefix whose SECOND label is `modelcontextprotocol` or `mcp`, so `io.modelcontextprotocol/`,
`dev.mcp/` and `com.mcp.tools/` are closed while `com.example.mcp/` is not. Ours is `integraledger`: the
prefix is available on the host's own terms rather than by our forbearance.

⚠️ Nothing emits this yet. It is a constant with a specification behind it (the buyer-side repo's
`2026-08-25-lcp-mcp-extension-specification.md`) and no declaration; wiring it into a server is a separate
change against a re-pinned tree.
