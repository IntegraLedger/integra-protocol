import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * UCP (Universal Commerce Protocol) reference placement, cut against the live spec (2026-04-08, ucp.dev —
 * overview §capabilities, §namespace-governance, §intersection-algorithm, and the checkout capability's
 * response schema), gate discharged 2026-07-29 against LCP v1.37 §C.3, and re-cut against the live UCP schemas and v1.38 §C.3
 * on 2026-08-08 when the canonical carrier moved.
 *
 * **THE CANONICAL CARRIER IS A `policies[]` ENTRY, AND UCP HAS NO `extensions` MAP TO WRITE INTO.** A
 * vendor capability under an authority-bound reverse-domain namespace is a real UCP surface — it is what
 * `/.well-known/ucp` advertisement uses — but a checkout RESPONSE carries no map to read one back out of.
 * Verified at
 * `universal-commerce-protocol/ucp` HEAD 2026-08-08, `source/schemas/shopping/checkout.json` has eighteen
 * properties — actions, attribution, buyer, context, continue_url, currency, expires_at, id, line_items,
 * links, messages, order, payment, policies, signals, status, totals, ucp — and `extensions` is not among
 * them. Its own description reads "Base checkout schema. Extensions compose onto this using allOf": UCP
 * extensions surface as top-level fields via schema composition, not as entries in a map.
 *
 * **The failure mode was SILENCE, which is worse than rejection.** `checkout.json` is
 * `additionalProperties: true`, so the write landed on every document and was read by nothing. A refused
 * write is a bug report; an accepted write nobody reads is a placement that reports success forever while
 * carrying no legal context at all.
 *
 * **`policies[]` is in the base schema and needs nothing negotiated.** Verified at HEAD
 * (`source/schemas/shopping/types/policy.json`): `required: ["type", "description"]`,
 * `additionalProperties: true`, and `type` is an open reverse-DNS vocabulary — "Businesses MAY define
 * custom types in their own domain (e.g., `com.example.policy.price_match`). Platforms MUST tolerate
 * unknown values." It is also per-transaction by the schema's own words: "A durable business rule about
 * the items in a response … at the time of purchase." So the reference travels with the checkout it
 * governs, with no negotiated intersection, no hosted schema at the namespace authority, and no
 * capability the counterparty can silently prune.
 *
 * **`description` is REQUIRED, and it is an OBJECT.** An entry carrying only `type` and our reference
 * fails UCP's own schema, so the container declares `constants` and the writer emits them — otherwise
 * this placement would put an invalid document on the wire, which is the shape-assertion this seam
 * refuses. `description` is a Description (`{plain|html|markdown}`, `minProperties: 1`), NOT a bare
 * string. The constants are written only when the entry is CREATED: a counterparty that already declared
 * this policy type wrote its own prose, and overwriting it to place our reference would be an edit to
 * their document nobody asked for.
 *
 * **The reference field is reverse-DNS namespaced**, `com.integraledger.legal_context`, because
 * `additionalProperties: true` tolerates an added key but UCP's own convention namespaces
 * extension-contributed keys — `reverse_domain_name.json` names exactly that use. A bare `value` would be
 * an unnamespaced claim on a shared object.
 *
 * **pattern is `http-advisory`, NOT `protocol-extension`, on the same reasoning applied to ACP.** UCP
 * does nothing atrHash-aware with the entry — §8.3.6 means the HOST protocol's own verification and
 * settlement procedure understands the hash, which no UCP implementation does. §8.3.6 is also Tier B by
 * definition, which would misdescribe a carrier that works today against stock UCP. The schema rejects
 * the protocol-extension/Tier-A pairing outright.
 *
 * **The vendor capability is not gone, it is just not the carrier.** `/.well-known/ucp` advertisement
 * remains a real UCP surface and `discovery` implements it — that is where the authority-bound namespace
 * reasoning belongs, and it is correct there. What was wrong was believing a checkout RESPONSE carries an
 * `extensions` map to read it back out of.
 *
 * **The links entry is the declared DISCOVERY alias, and it has no `write` flag — deliberately.** §C.3's
 * limitation is real: a vendor capability the counterparty did not declare is SILENTLY pruned from the
 * negotiated intersection, so the deployment SHOULD publish terms at the `links` level too, where discovery
 * does not depend on negotiation. But the links entry carries the terms URL — a DIFFERENT datum than the
 * atrHash — and `place(ref, doc)` holds one reference, not two data: writing `ref.value` into `links[].url`
 * would put a bare hash where every UCP client expects a URL. Publishing the links entry is the
 * DEPLOYMENT's act (UCP already makes `links[]` REQUIRED on checkout responses with `terms_of_service` a
 * recommended type — a conformant merchant publishes it as part of being a UCP merchant at all), and this
 * placement READS it: extract falls to the alias when the capability was pruned, the `url` carrier type
 * itself signalling discovery-not-integrity. The gate also found the "closed enum" claim false —
 * `links[].type` is an OPEN set ("Businesses MAY define custom types"); the well-known `terms_of_service`
 * tag is used because it is the spelling counterparties already read, not because it is the only one legal.
 *
 * **`termsUrlFields` is deliberately OMITTED.** The terms URL rides `links[type=terms_of_service].url` — a
 * tagged-array locator that a dotted-path parser cannot resolve. Declaring it as a `termsUrlFields` slot would
 * repeat the defect the `field` rule exists to prevent: a declared property that is not the declared thing.
 * The discovery
 * alias states the same fact WITH its machine-readable container, and the `PlacementManifest` contract says
 * an absent `termsUrlFields` means a parser must not demand one — and the kit refuses an advertisement that supplies a URL this manifest has nowhere to put.
 *
 * **`carrierTypes` permits `sha256` and `url`, and `url` is load-bearing.** extract checks every decoded
 * reference against this list, so the discovery alias's url-typed hits would refuse
 * `carrier-type-not-permitted` without it. The capability's own schema (ours, published at the namespace
 * authority when advertised) pins `sha256`; a url-typed reference in the capability is legal but adds
 * nothing over the links entry. `ipfs`/`ar` are excluded: §C.3's example carries a sha256 and our schema
 * should not advertise carrier forms no UCP counterparty has ever seen.
 *
 * UCP settles through whatever payment method the checkout selects, and that settlement is NOT this
 * package's business — the same division ACP draws: a bound rail welds the record; otherwise this
 * placement is the record's whole protocol reach and reads with an honest `not-attempted` at
 * settlement-enumeration.
 */
export const UCP_PLACEMENT: PlacementManifest = {
  protocol: "ucp",
  pattern: "http-advisory",
  tier: "A",
  encoding: "reference-object",
  container: {
    kind: "tagged-array",
    at: "policies",
    tagField: "type",
    tag: "com.integraledger.policy.legal_context",
    valueField: "com.integraledger.legal_context",
    // `description` is REQUIRED by UCP's policy schema alongside `type`, so an entry without one is an
    // invalid document. Verified at UCP HEAD 2026-08-08 (source/schemas/shopping/types/policy.json):
    // `required: ["type","description"]`, and `description` is a Description OBJECT — {plain|html|markdown},
    // minProperties 1 — not a bare string.
    constants: {
      description: {
        plain:
          "Terms of sale for this order, identified by a Legal Context Protocol reference. The reference identifies the exact terms document; it is not itself the terms.",
      },
    },
  },
  field: "policies[type=com.integraledger.policy.legal_context]",
  readAlso: [
    {
      path: "links[type=terms_of_service].url",
      encoding: "bare-value",
      bareType: "url",
      carrierClass: "discovery",
      container: {
        kind: "tagged-array",
        at: "links",
        tagField: "type",
        tag: "terms_of_service",
        valueField: "url",
      },
    },
  ],
  carrierTypes: ["sha256", "url"],
  specRef:
    "UCP checkout — policies[] entry under a reverse-DNS custom type (source/schemas/shopping/types/policy.json: base schema, required [type, description], additionalProperties true, type an open reverse-DNS vocabulary whose unknown values platforms MUST tolerate); checkout links[] entry typed terms_of_service (both re-verified at HEAD 2026-08-08: see README)",
};
