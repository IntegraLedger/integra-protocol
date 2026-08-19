import type { PlacementManifest } from "@integraledger/lcp-binding-core";

/**
 * The carrier's JSON Schema, INLINED rather than referenced — and equal, member for member, to the
 * AUTHORITY document at `https://integraledger.com/lcp/x402/legal-context/v1.schema.json` minus its `$id`
 * and `$defs`. That equality is load-bearing and drift-gated (the conformance suite compares this literal
 * to `@integraledger/lcp-discovery`'s shipped copy of the authority file), because its absence was a
 * published defect: from 0.10.1's release until this version, this schema said `required: ["type",
 * "value"]` while the authority document said `required: ["type", "value", "legalContextUrl"]` — two
 * definitions of the same `info` in the published ecosystem, self-consistent halves, no document valid
 * against both (integra-protocol#8). Both being conformant to the schema each carried is exactly why no
 * package's own tests could catch it; only comparing the two could, and now something does.
 *
 * WHY INLINE AT ALL: x402 makes `schema` a REQUIRED member of an extension entry — "JSON Schema defining
 * the expected structure of info" — so whatever goes here is on the wire of every challenge. **All nine
 * extensions published in the x402 repository inline a complete JSON Schema** rather than referencing an
 * external document (`x402-foundation/x402` HEAD, read 2026-08-11), and one of the nine makes it a rule:
 * the Bazaar extension requires a `schema`'s `$ref`/`$id` values to be "same-document JSON Pointer
 * fragments (starting with `#`); external references … are not allowed", and says a facilitator "must not
 * resolve external `$ref`/`$id` values … when validating an untrusted `schema`". So an external `$ref`
 * here would not merely be unresolvable to a counterparty that declines to fetch — wherever Bazaar
 * governs, it is rejected outright. LCP v1.38 §C.4 draws the same conclusion ("publish a resolvable
 * schema or inline it — and inlining is the safer of the two"). Dropping `$id` and `$defs` from the
 * inlined form is that rule applied: the authority document's `$id` is an absolute URL, and its `$defs`
 * carries the RECEIPT-time definition, which is not this challenge-time `info` and would bloat every 402.
 *
 * The shape is the §8.1 reference object PLUS the locator the reference is verified through:
 * `legalContextUrl` is REQUIRED here because `value` is a digest — a buyer verifies the terms by fetching
 * the document and hashing it, so a challenge advertising the hash without the locator advertises
 * something no counterparty who lacks the document can check. Every shipped buyer parser already refuses
 * such a challenge; the schema now says on the wire what the readers always demanded. It describes the
 * carrier, not the terms behind it, and asserts nothing about any agreement's lawfulness — the
 * description says so in as many words because the schema travels alone.
 *
 * Changing this is a WIRE change — it appears in every challenge — so it is a frozen literal rather than a
 * value assembled at call time, and the drift gate is what keeps the frozen copy honest.
 */
export const LEGAL_CONTEXT_SCHEMA: Readonly<Record<string, unknown>> =
  Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "legalContext — x402 extension info",
    description:
      "The `info` payload of the `legalContext` x402 extension at challenge time: a Legal Context Protocol reference to the terms governing this transaction, plus the URL the terms document can be fetched from. The reference identifies the exact terms document; it is not the terms. This describes a technology harness and asserts nothing about whether any agreement is lawful, sound or enforceable.",
    type: "object",
    additionalProperties: false,
    required: ["type", "value", "legalContextUrl"],
    properties: {
      type: {
        description:
          "The digest algorithm over the terms document. `sha256` is the only value this version defines.",
        type: "string",
        const: "sha256",
      },
      value: {
        description:
          "The atrHash — SHA-256 of the terms document, lowercase hex with an 0x prefix.",
        type: "string",
        pattern: "^0x[0-9a-f]{64}$",
      },
      legalContextUrl: {
        description:
          "Where the terms document this hash covers can be fetched. A reader verifies the document against `value`; the URL is a locator and never the authority.",
        type: "string",
        format: "uri",
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
 * **The alias IS WRITTEN, and this reverses a recorded stance — deliberately, on three grounds.** The
 * predecessor declared no `write` on the reasoning that `extra` is "Scheme-specific additional information"
 * and writing into another party's namespace is not our act. That reasoning has been overtaken. First, the
 * host itself no longer treats `extra` as wholly scheme-private: §6.1 reserves `assetTransferMethod` and
 * `paymentFlow` inside it as protocol-governed names, so `extra` is a host-managed extension surface with
 * scheme-specific residue, not a foreign namespace. Second, LCP v1.38 §C.4's own Tier A illustration puts
 * `atrHash` AND `legalContextUrl` in `accepts[].extra` — a third-party reader built from the spec's example
 * reads `extra` first, and a challenge that leaves it empty is invisible to that reader. Third, the shipped
 * buyer parser reads BOTH carriers and reconciles, refusing disagreement — so the mirror cannot drift
 * silently: two slots either agree or the document refuses at the counterparty. The write lands only in
 * `accepts[0]`, the requirement buyer parsers read (see the index-0 rule below), and never touches the
 * reserved names.
 *
 * **The alias is index 0 only.** A locator names one path. `accepts[0]` is what buyer parsers read, and the
 * reason is substantive: the reference must bind to the requirement actually being paid, and searching every
 * requirement would let a seller park a second set of terms on an alternative it never expects to be chosen.
 *
 * **`termsUrlFields` declares BOTH slots the wire carries, and both are written.** The predecessor member
 * (`termsUrlField`, singular) named only the `extensions` slot, and it was read-only in every published
 * package — the write path did not exist anywhere, so a seller assembling from published parts emitted a
 * challenge advertising a hash with no locator, which the published buyer refuses
 * (integra-protocol#8). Declaring both slots makes the manifest state what actually lands on the wire:
 * `place` writes the URL beside the reference in `info` (where the authority schema requires it) and
 * mirrors it at `accepts[0].extra.legalContextUrl` (where §C.4's illustration carries it), and `extract`
 * reconciles the two, refusing disagreement. The kit REQUIRES the URL of any integrity-bearing
 * advertisement on this manifest — a hash no counterparty can resolve is unverifiable by construction,
 * which is the defect the readers always guarded against and the emitters never did.
 *
 * **`carrierTypes` is `sha256` alone, and the `url` admission is WITHDRAWN — a defect resolved, not a
 * preference.** The predecessor admitted `url` as the §8.1 discovery form and recorded, in the same
 * docblock, that the permission was "WIDER than any shipped x402 reader": a buyer parser that requires an
 * integrity carrier refuses `info.type !== "sha256"` outright, so a `url` placed in this slot was
 * well-formed against the manifest and rejected at read time — a permission no reader accepts, which is a
 * claim about the ecosystem rather than a description of it. The withdrawal ground is now structural: the
 * `schema` member this package puts on the wire is the AUTHORITY document's shape, whose `type` is
 * `const: "sha256"`, so a `url` reference would emit a challenge that violates its own adjacent schema.
 * The predecessor declined to narrow because "narrowing the reference field to one type is a change to
 * what the SLOT may hold across the set" — that set-wide decision has since been made, by the authority
 * document. `ipfs`/`ar` remain excluded on the original ground: alternative integrity carriers add no
 * capability `sha256` does not already discharge while advertising a content-addressed transport no x402
 * counterparty resolves.
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
      write: true,
    },
  ],
  termsUrlFields: [
    "extensions.legalContext.info.legalContextUrl",
    "accepts.0.extra.legalContextUrl",
  ],
  carrierTypes: ["sha256"],
  specRef:
    "x402 v2 (x402-foundation/x402@1fec3aa04e41 specs/x402-specification-v2.md, read 2026-07-30) — top-level extensions map carried on PaymentRequired/PaymentPayload/SettlementResponse, each entry {info, schema}; accepts[].extra carries the §C.4 mirror (reserved names per §6.1 untouched; gate discharged: see README)",
};
