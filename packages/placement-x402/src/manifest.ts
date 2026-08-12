import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * The carrier's JSON Schema, INLINED rather than referenced.
 *
 * x402 makes `schema` a REQUIRED member of an extension entry — "JSON Schema defining the expected
 * structure of info" — so whatever goes here is on the wire of every challenge. A `$ref` to a URL nobody
 * serves would be a required member no counterparty can resolve, and "x402 never fetches it" is a reason
 * that does not break, not a reason to ship it. (`https://legalcontextprotocol.org/schemas/lcp-extension.json`
 * returns **404**, measured 2026-08-08 — the schema is inlined instead.)
 *
 * **All nine extensions published in the x402 repository inline a complete JSON Schema** rather than
 * referencing an external document — `bazaar`, `builder-code`, `eip2612GasSponsoring`,
 * `erc20ApprovalGasSponsoring`, `auth-hints`, `offer-receipt`, `http-message-signatures`,
 * `payment-identifier`, `sign-in-with-x`, read at `x402-foundation/x402` HEAD 2026-08-11. Note that two of
 * the nine are camelCase, so this package's `legalContext` key follows an established minority spelling
 * rather than diverging from a unanimous one. LCP v1.38 §C.4 says to do one or the other — "Because
 * `schema` is a REQUIRED member, publish a resolvable schema or inline it" — and adds that inlining is the
 * safer of the two. Inlining also removes a hosting
 * dependency the deployment does not currently meet — the same dependency the UCP capability still owes.
 *
 * **One of the nine makes it a rule, which settles the question.** The Bazaar extension requires a
 * `schema`'s `$ref`/`$id` values to be "same-document JSON Pointer fragments (starting with `#`); external
 * references (`http(s)://`, `file://`, or any other absolute/relative URI) are not allowed", and says a
 * facilitator "must not resolve external `$ref`/`$id` values … when validating an untrusted `schema`". So a
 * `$ref` here would not merely be unresolvable to a counterparty — it would be rejected outright by any
 * facilitator cataloguing this extension.
 *
 * The shape is the §8.1 reference object this placement writes into `info`, and nothing more: it describes
 * the carrier, not the terms behind it.
 *
 * Changing this is a WIRE change — it appears in every challenge — so it is a frozen literal rather than a
 * value assembled at call time.
 */
export const LEGAL_CONTEXT_SCHEMA: Readonly<Record<string, unknown>> =
  Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "LCP legal-context reference",
    description:
      "A Legal Context Protocol reference to the terms governing this transaction. The reference identifies the exact terms document; it is not the terms.",
    type: "object",
    required: ["type", "value"],
    additionalProperties: false,
    properties: {
      type: {
        type: "string",
        enum: ["sha256", "url", "ipfs", "ar"],
        description:
          "Carrier type. sha256, ipfs and ar are content-addressed and bear integrity; url only locates a document.",
      },
      value: {
        type: "string",
        minLength: 1,
        description:
          "The reference itself — for sha256, a 0x-prefixed lowercase 32-byte hex digest of the complete ATR file.",
      },
    },
  });

/**
 * x402 reference placement — the HTTP-layer carrier, cut against the live x402 v2 specification
 * (`x402-foundation/x402@1fec3aa04e41`, `specs/x402-specification-v2.md`; gate discharged in the README).
 *
 * **THE CANONICAL REPOSITORY IS THE FOUNDATION'S, and the citation moved on 2026-08-08.** Every
 * reference here named `coinbase/x402`, which the GitHub API reports as `"fork": true`;
 * `x402-foundation/x402` is `"fork": false` and is what LCP v1.38 §C.4's own *Checked against* line
 * reads. Citing a fork invites a reader to diff against a copy that may lag. The revision is pinned
 * rather than left as a bare repo name, because "the live spec" with no commit is not a claim anyone
 * can re-check.
 *
 * **This is NOT the x402 weld.** `@integraledger/lcp-binding-evm-x402` binds `atrHash` into the EIP-3009 nonce —
 * that is the SETTLEMENT binding and it answers "what did the money commit to?". This manifest answers a
 * different question — "where does the reference ride on the wire?" — and both are true at once. x402 is the
 * proof that one protocol can need a binding AND a placement.
 *
 * **Tier A in both slots, and the canonical one is the map the protocol PROTECTS.** x402 v2 defines a
 * per-requirement `accepts[].extra` object and a top-level `extensions` map, the latter carried on the
 * `PaymentRequired` challenge, the `PaymentPayload` AND the `SettlementResponse` — so a reference placed
 * there is on the receipt, not only the proposal. Each `extensions` entry carries `info` ("Extension-specific
 * data provided by the server") and `schema` ("JSON Schema defining the expected structure of `info`"). The
 * live spec's echo rule — "The client must include at least the info received; it may append additional info
 * but cannot delete or overwrite existing info" — is what makes that map the more durable carrier, and it is
 * why it is canonical here.
 *
 * **`pattern` is `http-advisory`, not `protocol-extension`.** §8.3.6 means the HOST protocol's own
 * verification and settlement procedure understands the hash; no x402 facilitator does. It is also Tier B by
 * definition, which would misdescribe a carrier that works today against stock x402 — extension identifiers
 * are implementation-defined strings, so no registration gates this. The same determination is made for ACP
 * and UCP. §C.4's Tier B forward paths (a reference inside the signed Offer/Receipt artifact; a registered
 * extension identifier) are declared in the README as prose and in NO manifest — asserting a shape whose
 * owner has not defined it is the asserting-a-shape defect.
 *
 * **The extension key is `legalContext`, deliberately not a reverse-domain name.** x402 imposes no namespace
 * rule, and `legalContext` is the spelling emitters put on the wire, the spelling buyer parsers read, and the
 * one LCP v1.38 §C.4's own illustration shows. The `com.integraledger.*` reverse-domain namespace applies to
 * hosts that REQUIRE one — UCP does; x402 does not — and renaming this key to suit a convention x402 does not
 * have would put a spelling on the wire that no counterparty reads.
 *
 * **The alias carries a DIFFERENT SHAPE, and x402 is the only protocol in the set where that is true.** The
 * canonical slot holds a §8.1 object; `accepts[0].extra.atrHash` holds a **bare** hash — that is the form
 * emitters write there and the form x402 integrators recognize. Writing an `lcp:` string into `extra.atrHash`
 * would emit something no x402 counterparty parses. This is the reason an alias declares its own `encoding`
 * at all.
 *
 * **The alias declares no `write`, and the live spec is the reason.** `extra` is "Scheme-specific additional
 * information" — the payment scheme's object, whose contents that scheme defines. An `atrHash` is READ there
 * because sellers put one there; writing into another party's namespace is not the same act. The
 * `extensions` map is the protocol's own declared extension point and is where `place` writes.
 *
 * **The alias is index 0 only.** A locator names one path. `accepts[0]` is what buyer parsers read, and the
 * reason is substantive: the reference must bind to the requirement actually being paid, and searching every
 * requirement would let a seller park a second set of terms on an alternative it never expects to be chosen.
 *
 * **`termsUrlField` is DECLARED — this is the protocol whose wire carries both halves.** `binding-core`'s own
 * contract cites x402 for exactly that: a buyer-side parser may demand the URL because x402 carries it, and
 * emitters put `legalContextUrl` inside `info` beside `type`/`value`. Declaring the path
 * makes that half machine-readable instead of a second private convention; `place` never writes it, because
 * `place(ref, doc)` holds one reference and the terms URL is a different datum (the same division ACP draws
 * with `metadata.legal_context_url`). The shipped carrier repeats the URL at `accepts[0].extra.legalContextUrl`
 * too, which a single `termsUrlField` cannot express — recorded in the README as a known limitation rather
 * than half-declared here.
 *
 * **`carrierTypes` permits `sha256` and `url`, and the two are admitted on DIFFERENT grounds** — one reason
 * cannot cover both. `sha256` is the integrity carrier: §C.4's illustration carries one, emitters carry one,
 * and the bare alias is fixed to it. `url` is the §8.1 discovery form, admitted because the canonical
 * slot is a general reference-object slot and the kit puts the integrity-versus-discovery decision at the
 * READER — `carrierClass` plus `requireIntegrity` — not in the permission list; ACP and UCP permit it for the
 * same reason. `ipfs`/`ar` are excluded on a ground that does NOT apply to `url`: they are ALTERNATIVE
 * integrity carriers, so admitting one adds no capability `sha256` does not already discharge while
 * advertising a content-addressed transport no x402 counterparty resolves — a claim about the ecosystem
 * rather than a description of it.
 *
 * The `url` permission is nonetheless WIDER than any shipped x402 reader: a buyer parser that requires an
 * integrity carrier refuses `info.type !== "sha256"` outright, so a `url` placed in this slot is well-formed
 * against this manifest and would still be rejected at read time. Recorded in the README as a limitation
 * rather than narrowed away here, because narrowing the reference field to one type is a change to what the
 * SLOT may hold across the set, not a fact about x402.
 */
export const X402_PLACEMENT: PlacementManifest = {
  protocol: "x402",
  pattern: "http-advisory",
  tier: "A",
  encoding: "reference-object",
  container: { kind: "object-path" },
  field: "extensions.legalContext.info",
  readAlso: [
    {
      path: "accepts.0.extra.atrHash",
      encoding: "bare-value",
      bareType: "sha256",
    },
  ],
  termsUrlField: "extensions.legalContext.info.legalContextUrl",
  carrierTypes: ["sha256", "url"],
  specRef:
    "x402 v2 (x402-foundation/x402@1fec3aa04e41 specs/x402-specification-v2.md, read 2026-07-30) — top-level extensions map carried on PaymentRequired/PaymentPayload/SettlementResponse, each entry {info, schema}; accepts[].extra is scheme-specific (gate discharged: see README)",
};
