// Import port-free types directly from their modules, never from "./index.js" — the barrel re-exports this
// file, so a barrel import is a type-only cycle that trips the no-circular rule (swc does not tag type-only
// edges, so the exemption would not fire). Same rule adapter.ts follows.
import {
  CarrierError,
  decodeLegalContextJson,
  decodeLegalContextString,
  encodeLegalContextJson,
  encodeLegalContextString,
  type LegalContextRef,
} from "./carrier.js";
import type { ProtocolId } from "./protocol-id.js";
import type { Outcome } from "./vocabulary.js";

/** The LCP §8.3 patterns a protocol that never settles can exhibit. `native-field`, `id-reuse` and
 *  `overlay-contract` are settlement patterns and are excluded by construction — a placement has no
 *  settlement to bind into. */
export type PlacementPattern =
  | "protocol-extension"
  | "sidecar-attestation"
  | "http-advisory"
  | "opaque-challenge";

/**
 * THE HOST GOVERNS.
 *
 * A placement never asserts a shape onto a host protocol's wire that the host has not defined. Where LCP's
 * own Appendix C and a host protocol's live specification disagree, the host is correct and the appendix is
 * wrong — Appendix C says so in its own opening, and it is informative rather than normative. Concretely: a
 * manifest declares the carrier the host already permits, at the strength the host actually gives it, and a
 * carrier that would make a stock implementation reject the whole document is not declared at all.
 *
 * This is the rule behind most of the decisions recorded in this file, and it has teeth in both directions.
 * Two placements were rewritten in 2026-08 for breaking it opposite ways: `placement-acp` wrote a top-level
 * field a closed schema forbade, and `placement-ucp` wrote into an `extensions` map its host does not
 * define at all — the second landing silently, because that schema is `additionalProperties: true`. A third,
 * `placement-mastercard-vi`, became declaration-only for the same reason: an unregistered constraint gets
 * the whole mandate rejected rather than skipped.
 *
 * It also decides what NOT to build. Where a host has not defined a carrier, the answer is a steward
 * invitation in prose, never a manifest for a shape whose owner has not agreed to it.
 */

/**
 * LCP §8.3 wire compatibility — can this placement be deployed against stock, unmodified implementations of
 * the host protocol?
 *
 * `"A"` — works today, no upstream coordination required.
 * `"B"` — requires a coordinated change to the host protocol's specification.
 *
 * REQUIRED on every manifest, and the reason is the rule above: a placement that cannot state its tier reads as
 * available-today, and shipping a Tier-B placement as though it were Tier A asks the ecosystem to adopt our
 * shape before it can talk to us. `pattern: "protocol-extension"` is Tier B BY DEFINITION per §8.3.6 — the
 * schema rejects the combination, so the type and the vector tree agree.
 *
 * **This axis is coarse on purpose, and it is NOT the strength axis.** Several protocols in LCP v1.38
 * Appendix C offer more than one Tier A carrier — a strong one that is declared, negotiated and
 * schema-published but activates only where the counterparty has adopted it, and a weak one that is
 * undeclared but works against every conformant implementation on day one. UCP is the clearest case: §C.3
 * presents Tier A "at three strengths" — a `links` URL, a `policies[]` entry, and a vendor capability
 * whose schema origin is authority-bound. All three are Tier A. Neither `tier`
 * nor `pattern` separates them. Carrier strength is declared per carrier — see `readAlso` — never here.
 */
export type PlacementTier = "A" | "B";

/**
 * How the reference sits in the declared field.
 *
 * - `lcp-string` — the canonical `lcp:{type}:{value}` string (ACP).
 * - `reference-object` — the LCP §8.1 `{ type, value }` object (A2A, AP2, ACK, x402's `extensions` slot).
 * - `bare-value` — the raw value alone, its type fixed by the field's own contract (x402's `extra.atrHash`,
 *   MPP's `methodDetails.atrHash`, Mastercard VI's constraint value, a UCP terms URL).
 *
 * REQUIRED, and NOT a stylistic choice: the host protocol's existing field decides it. `placement-acp` writes
 * an `lcp:` string and it was reasonable to assume that generalizes; checked against the real carriers it does
 * not, and ACP is the exception rather than the rule. Writing `lcp:sha256:0x…` into x402's `extra.atrHash`
 * would produce a field our own shipped seller does not emit and no x402 counterparty would recognize — the
 * prohibition exactly.
 */
export type PlacementEncoding =
  | "lcp-string"
  | "reference-object"
  | "bare-value";

/**
 * What a carrier GUARANTEES about the terms it points at — independent of where it sits or how it is shaped.
 *
 * - `integrity` — the value commits to the terms document's CONTENT. `sha256`, `ipfs` and `ar` are
 *   content-addressed, so a reader can verify that the document it fetched is the document that was agreed.
 * - `discovery` — the value only LOCATES a document. A `url` says where to look and commits to nothing about
 *   what is found there, which may change after the fact without any reader being able to tell.
 *
 * The distinction is load-bearing because several protocols in LCP v1.38 Appendix C present both at
 * once — UCP's §C.3 offers a hash-bearing `policies[]` entry and a bare `links` URL side by side — and a
 * tolerant reader that fell from the first to the second would hand its caller a URL where a hash
 * was asked for. That is the whole reason a `discovery` hit is REPORTED as one and never silently promoted:
 * a url locates a document and commits to nothing about its content, so promoting it would answer a question
 * about integrity with evidence that carries none.
 *
 * LCP v1.38 §C.2 states it too — "A terms-of-use policy page is not a per-transaction terms record and is
 * not a substitute for one" — as support rather than as the ground.
 */
export type CarrierClass = "integrity" | "discovery";

/** The carrier types that commit to a document's content. `url` is deliberately absent — it locates, it does
 *  not attest. A placement's REFERENCE field must permit at least one of these; the vector schema enforces it
 *  with `contains`, and {@link assertManifestHygiene} enforces it in code. */
export const INTEGRITY_CARRIER_TYPES: readonly LegalContextRef["type"][] = [
  "sha256",
  "ipfs",
  "ar",
];

/**
 * How the declared field is reached inside a host document.
 *
 * A CLOSED set of three, derived from the ten protocols rather than imagined: `object-path` covers every
 * protocol whose slot is addressable directly; `tagged-array` covers the two whose reference lives in an
 * entry of a typed array — UCP contributes two of the three, its `policies[]` carrier and its `links` alias,
 * and Mastercard VI's Layer-2 `constraints` is the third; `header-map` covers the one
 * whose keys compare case-insensitively per RFC 9110.
 *
 * That UCP and Mastercard VI — two protocols with nothing else in common — reduce to the SAME rule with
 * different data is the evidence the abstraction is discovered rather than invented. Two is where a shared
 * shape earns its keep; had `tagged-array` fit only one protocol it would belong in that package.
 *
 * This is also what keeps `field` honest. Without it a tagged-array manifest could only name its container,
 * and a stranger reading `field: "links"` would find an array and no rule for searching it — defeating the
 * reason the manifest exists.
 */
export type PlacementContainer =
  | {
      readonly kind: "object-path";
      /**
       * OPTIONAL — the exact key sequence the walker takes, overriding the dot-split of `field`.
       *
       * Needed when a KEY contains literal dots — a reverse-domain name used as a single map key is the
       * general case. A dot-split locator would walk one segment per component into a document that has
       * one key, and respelling the name to suit the walker would put a spelling on the wire the host's own
       * naming convention does not use. So the walker adapts instead: when present, `field` stays the
       * human-readable locator and this carries the machine-readable form — the division of labour
       * tagged-array established.
       *
       * **NO SHIPPED MANIFEST DECLARES THIS TODAY.** The motivating case was UCP's vendor capability under
       * an `extensions` map, and that carrier was retired once UCP turned out to define no such map on a
       * checkout response — `placement-ucp` writes a `policies[]` entry, which is a tagged-array. The field
       * is kept because the shape it describes is not UCP-specific and the next host that keys a map by
       * reverse domain will need it; it is not kept because anything here uses it.
       */
      readonly segments?: readonly string[];
    }
  | {
      readonly kind: "tagged-array";
      /** Dotted path to the array itself. */
      readonly at: string;
      /** The entry property that identifies the right entry (`type`). */
      readonly tagField: string;
      /** The value `tagField` must equal (`terms_of_service`). */
      readonly tag: string;
      /** The entry property the reference occupies (`url`, `value`). */
      readonly valueField: string;
      /**
       * Sibling fields written onto a NEWLY CREATED entry, because the host's own schema requires them.
       *
       * UCP is the consumer and the reason this exists. Its `policies[]` entries are
       * `required: ["type", "description"]`, so an entry carrying only a tag and a value fails the host's
       * schema — and a writer emitting one would be putting an invalid document on the wire, which is the
       * shape-assertion this seam refuses. Verified at UCP HEAD 2026-08-08:
       * `source/schemas/shopping/types/policy.json`.
       *
       * NOT applied when merging into an entry that already exists. A counterparty's own `description` is
       * theirs; overwriting it would edit their prose in order to write our reference, which is a change
       * to their document we were never asked to make.
       *
       * Spread BEFORE the tag and value fields so neither can be shadowed by a constant.
       */
      readonly constants?: Readonly<Record<string, unknown>>;
      /**
       * OPTIONAL — the entry property carrying the human-readable terms URL (`url`), where the host puts
       * the locator on the SAME entry as the reference.
       *
       * Container-relative because a document path cannot reach it. The entry's index is decided by the
       * writer at write time — replace-by-tag when one matches, append when none does — so no dotted path
       * names it in advance, and {@link PlacementManifest.termsUrlFields} is object-path only by
       * construction. UCP is the consumer: `policies[]` is `additionalProperties: true` with `url` declared
       * on the policy object itself ("Optional link to the full policy document", `format: uri`, verified at
       * UCP HEAD `source/schemas/shopping/types/policy.json`), and LCP v1.38 §C.3's own illustration carries
       * `url` and `atrHash` side by side in one entry.
       *
       * Written on the entry this container OWNS — the one carrying our tag — so unlike `constants` it
       * applies on merge as well as on create: the URL is half of our own advertisement, not a host field
       * we would be editing. Spread before the tag and value fields, for the same reason constants are.
       */
      readonly termsUrlField?: string;
    }
  | { readonly kind: "header-map" };

/**
 * WHEN a carrier may be written — the axis neither `tier`, `pattern` nor `carrierClass` expresses.
 *
 * Those three describe a carrier's standing in the abstract. This one describes a single host DOCUMENT: a
 * write that is conformant against one document and not against another, decided by what that document says.
 *
 * ⚠ **NO SHIPPED MANIFEST DECLARES ONE TODAY, and the reason is a decision rather than an oversight.** Both
 * consumers this axis was built for have since been closed from above. ACP's top-level `legal_context` was
 * the original case — `CheckoutSessionBase` is `additionalProperties: false`, so the write was authorized
 * only by a declaration in the session at `capabilities.extensions[]` naming
 * `$.CheckoutSession.legal_context`, and the gate read that authorization before writing the field it
 * authorizes. LCP v1.38 §C.2 withdrew the write outright, so `placement-acp` now writes only the
 * unconditional `metadata.legal_context` and needs no gate. Mastercard Verifiable Intent was the second,
 * and v1.38 §C.7 made that placement declaration-only for the same kind of reason.
 *
 * The axis is kept because what it encodes is not ACP-specific: a host that authorizes a field per document
 * will appear again, and the alternative — each placement hand-rolling the check inside its own `place` —
 * is how the seam stops being a seam. Everything below describes machinery with no current declarer; read
 * it as the contract a future one must satisfy, not as a description of shipped behaviour.
 *
 * WHAT THE GATE DOES NOT CLAIM. It reads the session, which the seller composed, so it cannot verify that a
 * declaration was itself negotiated: ACP's negotiation is the agent sending the identifiers it understands and
 * the response declaring those active in the session, and the request's identifiers are a bare array of strings
 * this axis cannot reach (see the last paragraph). A seller declaring an extension the agent never sent has
 * produced a non-conformant session upstream of LCP, and no reading of the document in hand discharges that.
 * What the gate does guarantee is the half that is ours: we never add the field to a session that does not
 * authorize it.
 *
 * THE RULE, STATED ONCE: a carrier whose condition is unmet is not written. Where that carrier is the
 * reference field itself, nothing was placed, so `place` refuses `<protocol>/write-condition-unmet`; where it
 * is an alias, the placement stands without it and `place` succeeds. That is not two rules — it is one rule
 * and the consequence each carrier's own standing implies. ACP is why the alias half must not refuse: its
 * `metadata` carrier requires nothing of the counterparty, and refusing there would mean no legal context
 * could be recorded against any counterparty that has not adopted the extensions framework.
 *
 * `permits` is an ALLOW-LIST. It allows rather than denies because the values a gate must refuse cannot be
 * enumerated — a session's active-extension list may carry any third party's identifier, so a deny-list would
 * have to name everything and would fail open on the first value nobody thought of. It is a SET rather than a
 * single string because a gate resolving through `object-path` compares a scalar, where presence alone would
 * fail open; ACP's tagged-array gate is the degenerate case, in which {@link readFromContainer} has already
 * filtered by `container.tag` so `permits` can only be `[tag]` — {@link assertManifestHygiene} enforces exactly
 * that rather than leaving the redundancy free to drift. Absent, non-string and unlisted values all decline.
 * **The two consumers it was built for needed two permitted values and one respectively, so the set is
 * load-bearing at both ends** — neither declares a condition now, but the shape was derived from real hosts.
 *
 * MASTERCARD VERIFIABLE INTENT WAS THE SECOND CONSUMER, and the one whose gate needed a set. Its constraints
 * document (verifiableintent.dev/spec/constraints/, read 2026-07-30) places the `constraints` array solely in
 * Autonomous-mode Layer 2 OPEN mandates and says outright: "Constraints do NOT appear in Immediate mode
 * credentials (`vct: "mandate.checkout.1"` and `vct: "mandate.payment.1"`)". So the two open `vct` values are
 * the only documents an LCP constraint could be written into. `placement-mastercard-vi` writes nothing at
 * all — v1.38 §C.7 withdrew the write — and why it does not is the sharpest available illustration of the
 * rule below.
 *
 * **`tier` IS NOT A GATE.** `place()` is gated on `writeCondition` alone and never reads `tier`, so a
 * manifest can declare `tier: "B"` and still ship a writer. On Verifiable Intent that combination is
 * unsafe: in the open mandates "Regardless of strictness mode, verifiers MUST reject open mandates
 * containing unknown constraint types", so a custom LCP type has no home against a stock verifier and a
 * written constraint gets the WHOLE mandate rejected. LCP v1.38 §C.7 states the conclusion — "Tier B —
 * there is no Tier A carrier" — and the placement is declaration-only.
 *
 * The one shape this cannot gate on is a bare array of strings — ACP's REQUEST carries
 * `capabilities.extensions: ["<id>"]` while its RESPONSE carries objects. That is a fourth container kind, not
 * a second condition shape, and it is owed the day a consumer places into a request rather than into the
 * session a seller is composing.
 *
 * A GATE IS A CONJUNCTION, and ACP is why. An extension declaration authorizes a field on the ONE schema its
 * `extends` target names — ACP's own core `discount` extension enumerates `$.CheckoutSessionCreateRequest.
 * discounts`, `$.CheckoutSessionUpdateRequest.discounts` and `$.CheckoutSession.discounts` as three separate
 * targets, so `$.CheckoutSession.legal_context` covers the session response and nothing else. But
 * `Capabilities` is ONE definition shared by request and response and its `extensions` `oneOf` is
 * undiscriminated, so a schema-valid `CheckoutSessionCreateRequest` may carry declaration OBJECTS, and an
 * identifier-only gate would then write a top-level field into a document that is `additionalProperties: false`
 * and names it nowhere. Measured against the live schema: a valid create request in, an INVALID one out. Two
 * facts therefore authorize a write — the extension is declared, and the document is the schema the extension
 * extends — and {@link WriteCondition.and} is how a manifest states the second. See `placement-acp`.
 */
export type WriteConditionTerm = {
  /** The locator of the value that decides — human-readable; `container` carries the machine-readable form. */
  readonly path: string;
  /**
   * REQUIRED, and never inherited from the manifest.
   *
   * ACP's gate sits in a DIFFERENT container kind than either carrier it guards: it searches
   * `capabilities.extensions[]` by tagged array, while the declared-extension placement's `legal_context` and
   * `placement-acp`'s alias beside `metadata.legal_context` are both object-paths. A default would be wrong on
   * both, and would read the wrong place rather than read nothing. Terms of one gate differ from each other
   * for the same reason: ACP's document-kind term is an `object-path` at `status` beside a tagged-array term.
   */
  readonly container: PlacementContainer;
  /**
   * The values at `path` that PERMIT the write. Anything unlisted declines.
   *
   * Non-empty, entries non-empty and distinct, and — where `container` is a tagged array reading its own tag
   * field — containing `container.tag`, since that is then the only value the reader can return.
   * {@link assertManifestHygiene} holds all four; a gate that no document can satisfy is not a gate.
   */
  readonly permits: readonly string[];
};

/** A write gate: one term, plus any further terms that must ALSO hold. See the docblock above. */
export type WriteCondition = WriteConditionTerm & {
  /**
   * OPTIONAL — further terms, ALL of which must hold for the write to proceed.
   *
   * A conjunction and never a disjunction: each term names an independent fact that must be true of the
   * document, and an OR over facts is a gate that passes on the weakest of them. Depth is exactly two — a term
   * carries no `and` of its own — because a nested gate is an expression language, and a manifest that needs
   * one has stopped being data. Terms are distinct by `path`; {@link assertManifestHygiene} holds both rules.
   *
   * ACP's declared-extension carrier is the consumer: its first term reads the declaration at
   * `capabilities.extensions[]`, and its second reads `status` — REQUIRED on `CheckoutSessionBase`, absent from
   * every request schema in the live spec (all `additionalProperties: false`), and a closed eleven-value enum,
   * so it is the host's own evidence that the document in hand is the `CheckoutSession` the declaration
   * extends. Absent, the write declines: a status ACP adds later declines until the enum is re-read, which is
   * the safe direction — the reach carrier still lands and no unauthorized field ever does.
   */
  readonly and?: readonly WriteConditionTerm[];
};

/**
 * One additional shape `extract` accepts.
 *
 * `encoding` defaults to the manifest's — an alias often differs — and `bareType` fixes the type for a
 * bare-value alias, which carries no type tag of its own. `carrierClass` defaults to `integrity`; declaring
 * `discovery` is how a placement admits that this particular carrier locates rather than attests. `write`
 * defaults to false, preserving strict write.
 */
export type PlacementAlias = {
  readonly path: string;
  readonly encoding?: PlacementEncoding;
  readonly bareType?: LegalContextRef["type"];
  readonly carrierClass?: CarrierClass;
  /**
   * OPTIONAL — the container this alias resolves through, defaulting to the manifest's.
   *
   * A protocol's carriers are not always the same SHAPE of thing. UCP's canonical capability is an
   * `object-path` at `extensions.<reverse-domain>.legal-context`, while the discovery carrier §C.3 advises
   * publishing alongside it is a `tagged-array` at `links[type=terms_of_service].url`. Without this an alias
   * could only ever be another spelling in the manifest's own container.
   *
   * That shape difference is what this field answers, and it stands independently of `write`: UCP declares
   * its `links` alias READ-ONLY because that entry carries a URL where the alias would write an atrHash,
   * which is a different datum — see the manifest's own account of it in `placement-ucp`.
   *
   * An alias already declares its own `encoding`; declaring where it SITS is the same kind of fact one level
   * further out.
   */
  readonly container?: PlacementContainer;
  /**
   * Does `place` populate this carrier as well as `field`?
   *
   * Default false — one declared field, ours. `true` exists for the general case where a protocol's
   * canonical field is not by itself sufficient: a negotiated or declaration-gated carrier can be SILENTLY
   * pruned when the counterparty has not declared it, and a writer cannot know in advance whether the strong
   * carrier survived. "Write one and hope" is not available to it. Setting this makes the manifest state what
   * actually lands on the wire rather than leaving the second write to a convention in some adapter's body.
   *
   * The one shipped consumer is x402, which sets it on the `accepts.0.extra.atrHash` mirror — the §C.4
   * illustration's bare-hash spelling, written unconditionally because `accepts[].extra` is an open map the
   * host's own schema requires on any payable challenge, so nothing has to be negotiated first. UCP §C.3
   * describes the pruning hazard this flag was built for, but the UCP manifest declines the write: its
   * second carrier holds the terms URL rather than the atrHash, and `place` carries one reference, not two
   * data.
   */
  readonly write?: boolean;
  /**
   * OPTIONAL — the condition under which this alias's write is valid. See {@link WriteCondition}.
   *
   * Unmet, this alias is NOT written and the placement stands. Meaningless without `write: true`, and
   * {@link assertManifestHygiene} rejects that pairing rather than leaving an inert guard on the manifest.
   */
  readonly writeCondition?: WriteCondition;
};

/**
 * What a non-settling protocol declares. Deliberately NOT a `BindingManifest`: `rail`, the WLD-3 recovery
 * triple, `indexing`, `finality`, `weldGrades` and `lifecycleStates` are all statements ABOUT A SETTLEMENT,
 * and a manifest that carried them with hollow values would declare properties no one can check.
 */
export type PlacementManifest = {
  protocol: ProtocolId;
  pattern: PlacementPattern;
  /** §8.3 wire compatibility. See {@link PlacementTier} — Tier A is the product; Tier B is declared and inert. */
  tier: PlacementTier;
  /** How the reference SITS in `field`. See {@link PlacementEncoding} — the host protocol decides it. */
  encoding: PlacementEncoding;
  /** How `field` is REACHED. See {@link PlacementContainer} — required, so `field` is always a locator. */
  container: PlacementContainer;
  /** The locator of the protocol-native field the REFERENCE occupies. See {@link PlacementContainer}. */
  field: string;
  /**
   * OPTIONAL — the condition under which writing `field` is valid at all. See {@link WriteCondition}.
   *
   * Unmet, `place` REFUSES: the reference field IS the placement, so a document we may not write it into is a
   * document nothing was placed in. Omitted means unconditional, which is what every carrier but ACP's
   * top-level `legal_context` is — the axis does not change the behaviour of a manifest that does not
   * declare it.
   */
  writeCondition?: WriteCondition;
  /**
   * OPTIONAL — additional shapes `extract` also accepts, and (where an entry sets `write`) also writes.
   *
   * Declared as data so every shape we accept is machine-readable and vector-pinned rather than a convention
   * buried in a parser. No entry's `path` may equal `field` — that is a duplicate, not an alias, and
   * {@link assertManifestHygiene} rejects it because JSON Schema draft 2020-12 cannot compare two properties
   * of the same object without `$data`. The host governs: the host protocol's ecosystem, not LCP's Appendix C, decides
   * which spellings exist in the wild.
   */
  readAlso?: readonly PlacementAlias[];
  /**
   * OPTIONAL — the dotted paths of every field carrying the human-readable terms URL, where the protocol has
   * room for one. All slots are WRITTEN by `place` and all are READ by `extract`, which reconciles them and
   * refuses disagreement — two values on one document would let a seller advertise different terms to
   * different readers and later disown whichever reading lost.
   *
   * A LIST, not a single path, because the predecessor member was singular and that was a measured defect
   * twice over. x402's wire carries the URL in BOTH `accepts[].extra` and `extensions.legalContext.info` —
   * LCP v1.38 §C.4's own illustration uses the first — so a singular declaration could only name one, and
   * the buyer-side parser that generalized over it had to report the other slot as unanswerable
   * (`undeclared-at-answering-carrier`) rather than read it. Worse, no write path existed AT ALL: the member
   * was declared, hygiene-checked, read by parsers that demand the URL — and never placed, so a seller
   * assembling from published parts emitted a challenge the published buyer refuses
   * (integra-protocol#8). The reference field already solved this shape with `field` + `readAlso`;
   * this member is the same solution for the terms URL, with one difference — every slot is written,
   * because a URL is plain data with no per-slot encoding to vary.
   *
   * OBJECT-PATH SLOTS ONLY, and that is a property of dotted paths rather than a judgement about which
   * hosts have a slot. Where the locator rides the same entry the reference is written into, the entry's
   * index is chosen at write time and no path names it in advance; the container declares that slot
   * instead, as {@link PlacementContainer} `termsUrlField`. UCP is the case — its `url` sits on the
   * `policies[]` entry, not at any fixed path — and the two members are read and reconciled together, so a
   * protocol declares whichever one its host's shape puts the URL in and never both.
   *
   * §8.1 DEFINES THIS CARRIER — `legalContextUrl` beside the reference, required wherever the reference is
   * a digest — and it defines it because this implementation shipped it first: the standard recorded the
   * gap as deferred normative work, the slots below were built on what each HOST declares (§C.1 and §C.4
   * illustrate host-side slots, and integra-protocol#8 measured what buyers refuse without one), and §8.1
   * then ratified the shape that had been battle-tested rather than inventing a second one. The order
   * matters for anyone reading a divergence later: where a host's own naming convention governs the
   * surrounding object it wins over the spelling — ACP's `legal_context_url` is snake-case for that reason,
   * and UCP's locator sits on the host's own entry — and §8.1 says so explicitly.
   *
   * A placement carrying only the reference says so by omitting this, and {@link makePlacement} then
   * REFUSES an advertisement that supplies a URL — silently dropping a datum the seller meant to publish
   * is fail-open. Declared, it is REQUIRED of any integrity-bearing advertisement: a bare hash with no
   * locator cannot be verified by a counterparty that does not already hold the document, which is what
   * every shipped buyer parser enforces by refusing the challenge. A `url`-type reference is its own
   * locator, so the mandate applies only where the reference attests rather than locates.
   */
  termsUrlFields?: readonly string[];
  /** Which carrier types this field can legally hold (a tight length budget may permit only the shortest). */
  carrierTypes: readonly LegalContextRef["type"][];
  /** Citation for the protocol's own spec section that owns this field. */
  specRef?: string;
};

/**
 * What a seller advertises about the terms governing a transaction: the reference, and — where the
 * protocol has room for one — the URL where the terms document those bytes hash to can be fetched.
 *
 * ONE input to `place`, not two parameters, because the two are one act. The predecessor signature took
 * only the reference, on the reasoning that "the terms URL is a different datum" — which is true and was
 * still a defect: the different datum had no write path anywhere in the published set, so the challenge a
 * third party assembled from published parts advertised a hash the published buyer could not verify and
 * refused (integra-protocol#8). A seller does not place a hash and separately, optionally, somewhere
 * else, place its locator; it advertises terms. The type says so.
 *
 * `termsUrl` is optional at the TYPE level because the manifest decides: {@link makePlacement} refuses a
 * URL the manifest declares no slot for, and demands one where the manifest declares slots and the
 * reference is integrity-bearing. See {@link PlacementManifest.termsUrlFields} for both rules' grounds.
 */
export type LegalContextAdvertisement = {
  /** The §8.1 reference — what the terms ARE, by content address or location. */
  readonly ref: LegalContextRef;
  /** Where the terms document can be fetched. `https://` only — a locator a buyer must not follow is worse than none. */
  readonly termsUrl?: string;
};

/**
 * What a document says about where its terms live — read, or one of two distinguishable absences.
 *
 * A UNION rather than `string | undefined`, because the two absences license different conclusions and a
 * reader flattening them answers questions it was never asked. `no-field-declared` is a fact about the
 * PROTOCOL: this manifest models no terms-URL slot, so absence says nothing about the seller.
 * `declared-fields-empty` is a fact about the DOCUMENT: the protocol has the room and this seller left it
 * empty — which a gate that must fetch the terms treats as fatal, and a renderer merely reports.
 *
 * Absence is a VALUE here, never a refusal, on purpose: `extract` reads counterparty documents, including
 * ones emitted before this member had a write path, and a reference without a locator is still evidence.
 * Whether to transact against it is the gate's decision, made where the buyer's policy lives.
 * (Promoted from the buyer-side parser that first drew this taxonomy; the third case it needed —
 * `undeclared-at-answering-carrier` — existed only because the manifest member was singular, and
 * collapses now that every slot is declared. See {@link PlacementManifest.termsUrlFields}.)
 */
export type AdvertisedTermsUrl =
  | { readonly kind: "read"; readonly url: string }
  | { readonly kind: "no-field-declared" }
  | {
      readonly kind: "declared-fields-empty";
      readonly fields: readonly string[];
    };

/**
 * What `extract` recovers: the reference, plus what the document says about where its terms live.
 *
 * NOT {@link LegalContextAdvertisement}, deliberately — the write side takes a URL or nothing because the
 * seller either has one or does not, while the read side must distinguish "this protocol has no slot"
 * from "this seller left the slot empty". Collapsing the two types would lose exactly the distinction
 * {@link AdvertisedTermsUrl} exists to carry.
 */
export type ExtractedAdvertisement = {
  /** The recovered §8.1 reference, decoded and type-checked against the manifest's permitted set. */
  readonly ref: LegalContextRef;
  /** The terms-URL reading, reconciled across every declared slot. */
  readonly termsUrl: AdvertisedTermsUrl;
};

/**
 * Place an LCP advertisement into a protocol document, and recover one from it.
 *
 * The sibling of `WeldAdapter` for protocols that never settle. Two members, no ports, no chain: there is
 * no `observe` (no lifecycle without a settlement), no `recover(ref, ports)` (no `SettlementRef` exists)
 * and no `enumerate` (nothing to forward-index). Forcing those onto this contract with throwing bodies
 * would be a fail-fast violation dressed as an implementation.
 *
 * Both members are TOTAL and return `Outcome` — a refusal is a value, never an exception, on this path as
 * on every other. `extract` on a document with no reference REFUSES; it never returns a placeholder.
 */
export interface ReferencePlacementAdapter {
  manifest: PlacementManifest;
  /** Return the document with the advertisement placed at every declared slot. Pure — never mutates its input. */
  place(ad: LegalContextAdvertisement, doc: unknown): Outcome<unknown>;
  /** Read the advertisement back out of a protocol document. */
  extract(doc: unknown): Outcome<ExtractedAdvertisement>;
}

/** A canonical array index and nothing else. `"01"`, `"1.0"`, `"-1"`, `"1e0"` and `"length"` are NOT indices:
 *  each either names a property that is not an element or spells an element two ways, and a locator that
 *  accepted two spellings of index 1 would let two different manifests claim the same carrier. */
const INDEX = /^(0|[1-9][0-9]*)$/;

/**
 * Read a dotted path out of an untrusted document. TOTAL — returns `undefined` rather than throwing, on
 * every shape a hostile wire can present.
 *
 * Own-property only (`Object.hasOwn`), on EVERY segment and both container branches: a document is
 * attacker-influenced input, and walking the prototype chain would let `constructor.name` answer as though it
 * were a placed reference.
 *
 * An array is traversed ONLY by a canonical integer segment, and that is the single deliberate relaxation of
 * "arrays are not traversed as objects". It is narrow by construction: `length` and every other array
 * property stay unreachable, an inherited numeric index is not an element, so an array at a path the manifest
 * declares as an OBJECT is still a malformed document rather than a container to rummage through. x402 is the reason — its per-requirement
 * `accepts[].extra` is a real declared carrier that no object-only walker can reach, and the alternative was
 * a private index loop inside one placement package, where nobody reviewing the read rule would see it.
 */
export function readAtPath(doc: unknown, path: string): unknown {
  return readSegments(doc, path.split("."));
}

/** The segment-based walker `readAtPath` delegates to. Separate because a segment may legitimately CONTAIN a
 *  dot — a UCP capability key is one key, not a path — so the split and the walk cannot be one operation. */
function readSegments(doc: unknown, segs: readonly string[]): unknown {
  let cur: unknown = doc;
  for (const seg of segs) {
    if (Array.isArray(cur)) {
      if (!INDEX.test(seg)) return undefined;
      // Widened to `readonly unknown[]` first: `Array.isArray` narrows `unknown` to `any[]`, and reading an
      // element straight off that would put an `any` back into the walk.
      const arr: readonly unknown[] = cur;
      // Own property here too — the invariant is about the WALK, not about one branch of it. A polluted
      // `Array.prototype["0"]` would otherwise answer `accepts.0.extra` on an EMPTY array as though the
      // attacker's object were placed document data, and a sparse hole would answer with the prototype's
      // value rather than absent.
      if (!Object.hasOwn(arr, seg)) return undefined;
      cur = arr[Number(seg)];
      continue;
    }
    if (typeof cur !== "object" || cur === null) return undefined;
    if (!Object.hasOwn(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Split a locator into the path of its container and the final key. `"headers.x-lcp-hash"` →
 *  `["headers", "x-lcp-hash"]`; a single-segment locator has an empty container path meaning the document
 *  itself. Shared by the header-map reader and every writer so the two can never disagree. */
function splitLocator(path: string): [string, string] {
  const i = path.lastIndexOf(".");
  return i === -1 ? ["", path] : [path.slice(0, i), path.slice(i + 1)];
}

/** Narrow to a plain object — never an array, never null. The one shape every container walks through. */
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/**
 * Read a locator out of an untrusted document, honouring the container kind. TOTAL.
 *
 * The generalization of {@link readAtPath} to the three declared containers — and the reason a stranger can
 * act on a manifest alone. `object-path` delegates unchanged. `tagged-array` resolves the array, then finds
 * the FIRST entry whose tag matches; a duplicate tag is the host's problem and first-wins is the only rule
 * that does not silently prefer a later forgery. `header-map` compares the final segment case-insensitively
 * per RFC 9110, because `X-LCP-Hash` and `x-lcp-hash` are the same header and a case-sensitive read would
 * miss a conformant counterparty.
 */
export function readFromContainer(
  doc: unknown,
  container: PlacementContainer,
  path: string,
): unknown {
  switch (container.kind) {
    case "object-path":
      return readSegments(doc, container.segments ?? path.split("."));
    case "tagged-array": {
      const arr = readAtPath(doc, container.at);
      if (!Array.isArray(arr)) return undefined;
      for (const entry of arr) {
        const rec = asRecord(entry);
        if (rec === undefined) continue;
        // Own-property on the TAG too, not just the value: an entry whose prototype carries the tag would
        // otherwise be selected, and the entry itself never claimed it. Same invariant as `readAtPath`.
        if (!Object.hasOwn(rec, container.tagField)) continue;
        if (rec[container.tagField] !== container.tag) continue;
        return Object.hasOwn(rec, container.valueField)
          ? rec[container.valueField]
          : undefined;
      }
      return undefined;
    }
    case "header-map": {
      const [at, key] = splitLocator(path);
      const map = asRecord(at === "" ? doc : readAtPath(doc, at));
      if (map === undefined) return undefined;
      const want = key.toLowerCase();
      for (const k of Object.keys(map))
        if (k.toLowerCase() === want) return map[k];
      return undefined;
    }
  }
}

/**
 * Is the document one this carrier may be written into? TOTAL — never throws, on any shape a wire can present.
 *
 * Exported because a caller frequently needs the answer BEFORE it calls `place`: a seller deciding whether to
 * negotiate an ACP extension, or which of two carriers its record will actually reach, cannot read that off a
 * refusal it has not provoked yet. `place` asks the same question through this function, so the advertised
 * answer and the enforced one cannot drift.
 *
 * The gate resolves through {@link readFromContainer}, the same reader every carrier uses — so RFC 9110 header
 * folding and the tagged-array first-match rule apply to a gate exactly as they apply to a reference, and a
 * gate can never see a shape a carrier could not.
 */
export function writeConditionMet(
  doc: unknown,
  condition: WriteCondition,
): boolean {
  if (!termMet(doc, condition)) return false;
  // EVERY further term, not some: the gate is a conjunction, and a short-circuit on the first success would
  // make the second fact decorative. `every` on an absent `and` is vacuously true, which is the unconditional
  // single-term gate every carrier but ACP's declares.
  return (condition.and ?? []).every((t) => termMet(doc, t));
}

/**
 * The gate, as one line of refusal prose. EVERY term, because a caller told only about the term that happens
 * to be listed first would fix that one and refuse again on the next.
 */
function describeGate(condition: WriteCondition): string {
  return [condition, ...(condition.and ?? [])]
    .map((t) => `${t.path} is one of ${t.permits.join("/")}`)
    .join(" and ");
}

/** One term of a gate: read the declared locator, compare it to the allow-list. TOTAL. */
function termMet(doc: unknown, term: WriteConditionTerm): boolean {
  const found = readFromContainer(doc, term.container, term.path);
  // `some` rather than `includes`: `found` is unknown, and casting it to string to satisfy `includes` would
  // assert a type the wire never promised. Strict equality against each permitted value answers the same
  // question without the lie — a non-string value matches nothing and the write is declined.
  return term.permits.some((v) => v === found);
}

/** What a declared read matched: the raw value, the encoding it is in, and what it GUARANTEES. */
export type DeclaredRead = {
  readonly raw: unknown;
  readonly encoding: PlacementEncoding;
  readonly carrierClass: CarrierClass;
  readonly bareType?: LegalContextRef["type"];
};

/** The subset of a manifest a tolerant read needs. Structural so a caller can pass a manifest literal.
 *  `container` is REQUIRED here as it is on the manifest — defaulting it to object-path would be a silent
 *  fallback, and on a tagged-array protocol it would read the wrong thing rather than nothing. */
type ReadableManifest = Pick<
  PlacementManifest,
  "field" | "encoding" | "container" | "carrierTypes"
> & { readonly readAlso?: readonly PlacementAlias[] };

/**
 * Read the canonical field, then each DECLARED alias in order. The canonical field always wins when both are
 * present — a document carrying two spellings is answered with ours, never with whichever happened to be
 * enumerated first.
 *
 * Returns the ENCODING alongside the value, because an alias frequently differs in shape from the canonical
 * slot (x402's `extra.atrHash` is bare where its `extensions` slot is an object). A reader that got back only
 * the value would have to guess, and guessing is the thing this whole seam exists to remove.
 *
 * Returns the CARRIER CLASS for the same reason at a higher stake. A caller that needs integrity must be able
 * to tell that what it got was a URL — the fall from a hash carrier to a discovery carrier is a real downgrade
 * and a located document cannot stand in for an attested one (LCP v1.38 §C.2 describes it; v1.37 forbade
 * it in those words). This function never refuses a discovery hit; it
 * labels it, and {@link requireIntegrity} is how a caller that cannot accept one says so.
 *
 * Only paths the manifest declares are read. There is no heuristic, no "try camelCase too": an accepted shape
 * that is not in `readAlso` does not exist, which is what keeps tolerance auditable. (Header-map containers
 * DO fold case, and that is not a heuristic — RFC 9110 makes `X-LCP-Hash` and `x-lcp-hash` the same header,
 * so folding is what reading that container correctly means.)
 *
 * An alias resolves through the container IT declares, falling back to the manifest's — which is the common
 * case, an alias being usually another spelling in the same document shape. {@link PlacementAlias.container}
 * exists because that is not always true: UCP's canonical capability is an `object-path` while the discovery
 * carrier §C.3 pairs it with is a `tagged-array` in the same document.
 */
export function readDeclaredPaths(
  doc: unknown,
  manifest: ReadableManifest,
): DeclaredRead | undefined {
  const canonical = readFromContainer(doc, manifest.container, manifest.field);
  if (canonical !== undefined)
    return {
      raw: canonical,
      encoding: manifest.encoding,
      // The reference field is integrity-bearing by construction — assertManifestHygiene and the vector
      // schema both refuse a manifest whose carrierTypes hold no content-addressed type.
      carrierClass: "integrity",
      ...(manifest.encoding === "bare-value"
        ? { bareType: manifest.carrierTypes[0] }
        : {}),
    };
  for (const alias of manifest.readAlso ?? []) {
    const v = readFromContainer(
      doc,
      alias.container ?? manifest.container,
      alias.path,
    );
    if (v === undefined) continue;
    const encoding = alias.encoding ?? manifest.encoding;
    return {
      raw: v,
      encoding,
      carrierClass: alias.carrierClass ?? "integrity",
      ...(encoding === "bare-value"
        ? { bareType: alias.bareType ?? manifest.carrierTypes[0] }
        : {}),
    };
  }
  return undefined;
}

/**
 * Narrow a declared read to an integrity-bearing one, or `undefined`.
 *
 * The whole point of labelling the class is that somebody checks it. A verification path that would treat a
 * located-but-unattested document as an agreed one calls this first; a path that genuinely only needs to find
 * the terms (rendering a link for a human) does not.
 *
 * TWO CONDITIONS, AND BOTH MUST HOLD: the SLOT must be declared integrity-bearing, and the VALUE that
 * actually turned up must be of a content-addressed type.
 *
 * The value half matters as much as the slot half. `carrierClass` is declared per slot,
 * and the canonical field's label is `"integrity"` because the MANIFEST is required to permit at least one
 * content-addressed type — which says nothing about what a given document put there. Several shipped
 * manifests permit `url` alongside `sha256`, so `{type:"url", …}` in the canonical slot read
 * back as integrity-bearing and satisfied this function: exactly the substitution the class axis exists to
 * refuse — a located document standing in for an attested one — arriving through the one field nobody was
 * checking. LCP v1.38 §C.2 describes it ("A terms-of-use policy page is not a per-transaction terms record
 * and is not a substitute for one"). The axis does not depend on which way the appendix words it.
 *
 * The slot half is kept rather than replaced. A deployment that declares an alias `discovery` has said what
 * that carrier is FOR, and a hash appearing in it does not promote it — UCP's `links` alias is the case, and
 * a value must not overrule a declaration. So this is strictly narrowing: everything refused before is still
 * refused, and the url-in-canonical-slot case joins it.
 *
 * Decoding is delegated to {@link decodeDeclaredRead} rather than re-reading the type out of `raw` here. The
 * type lives in a different place for each encoding — inside the object for `reference-object`, in the
 * declared `bareType` for `bare-value`, in the string's second segment for `lcp-string` — and a second copy
 * of that knowledge is the kind that drifts. It also means a CORRUPT carrier THROWS `CarrierError` here
 * rather than being reported as merely not-integrity-bearing: callers already keep one catch for that error,
 * and collapsing "corrupt" into "not integrity" would hide a malformed document behind a clean refusal.
 */
export function requireIntegrity(
  hit: DeclaredRead | undefined,
): DeclaredRead | undefined {
  if (hit?.carrierClass !== "integrity") return undefined;
  const ref = decodeDeclaredRead(hit);
  // `undefined` is an absent or unrecognized reference (LCP §8.2 says ignore); either way it attests nothing.
  return ref !== undefined && INTEGRITY_CARRIER_TYPES.includes(ref.type)
    ? hit
    : undefined;
}

/**
 * Decode a declared read into a reference, per the encoding the read reported.
 *
 * Routes every shape through the existing §8.1 codec rather than re-implementing validation: the object and
 * bare forms are wrapped into the structured-JSON carrier the codec already speaks, so a present-but-empty
 * value is corrupt on all three paths and not merely on the string one. Returns `undefined` for absent or
 * unrecognized (LCP §8.2 says ignore); THROWS `CarrierError` for a corrupt value, exactly as the string
 * decoder does, so callers keep one catch and one meaning.
 */
export function decodeDeclaredRead(
  hit: DeclaredRead,
): LegalContextRef | undefined {
  switch (hit.encoding) {
    case "lcp-string":
      return typeof hit.raw === "string"
        ? decodeLegalContextString(hit.raw)
        : undefined;
    case "reference-object":
      // The field holds the BARE `{type, value}` object; the codec speaks the wrapped `{legalContext:{…}}`
      // form, so wrap rather than duplicate its validation.
      return decodeLegalContextJson({ legalContext: hit.raw });
    case "bare-value":
      // No pre-guard on `raw` or `bareType`. The codec already returns undefined for a non-string value and
      // for an absent/unknown type, so a guard here would be a second copy of the same rule — and a copy
      // that cannot be told apart from its own absence by any test, which is how it was found.
      return decodeLegalContextJson({
        legalContext: { type: hit.bareType, value: hit.raw },
      });
  }
}

/** The one scheme a terms URL may carry, write side and read side alike. A locator a buyer must not
 *  follow — cleartext, or a scheme its fetcher refuses — is worse than none, and the shipped buyer
 *  parsers already refuse it, so an emitter that wrote one would mint a challenge no counterparty
 *  accepts. Both halves of the seam hold the same line so the refusal lands at the party whose datum
 *  is wrong. */
const TERMS_URL_SCHEME = "https://";

/** How one terms-URL reading over every declared slot came out — {@link AdvertisedTermsUrl} plus the two
 *  document defects `extract` must refuse. Module-internal: the defects become refusal codes at the
 *  adapter boundary, where every other refusal is minted. */
type TermsUrlReading =
  | AdvertisedTermsUrl
  | {
      readonly kind: "mismatch";
      readonly first: { readonly path: string; readonly url: string };
      readonly second: { readonly path: string; readonly url: string };
    }
  | {
      readonly kind: "malformed";
      readonly path: string;
      readonly raw: unknown;
    };

/** The entry a `tagged-array` container owns — the FIRST whose tag matches, by the same own-property and
 *  first-match rules {@link readFromContainer} reads the reference under, so the reference and the terms
 *  URL beside it can never be read off two different entries. */
function taggedEntry(
  doc: unknown,
  container: Extract<PlacementContainer, { kind: "tagged-array" }>,
): Record<string, unknown> | undefined {
  const arr = readAtPath(doc, container.at);
  if (!Array.isArray(arr)) return undefined;
  for (const entry of arr) {
    const rec = asRecord(entry);
    if (rec === undefined) continue;
    if (!Object.hasOwn(rec, container.tagField)) continue;
    if (rec[container.tagField] === container.tag) return rec;
  }
  return undefined;
}

/** Every terms-URL slot this manifest declares, as human-readable locators — the document paths, plus the
 *  container-relative entry field written in the `at[tagField=tag].field` notation §C.3 itself uses.
 *  `undefined` where the manifest declares NO slot, which is the one condition that distinguishes "this
 *  protocol has nowhere to put a URL" from "it has somewhere and the document left it empty". */
function entryTermsUrlSlot(container: PlacementContainer):
  | {
      readonly container: Extract<PlacementContainer, { kind: "tagged-array" }>;
      readonly field: string;
      readonly label: string;
    }
  | undefined {
  if (
    container.kind !== "tagged-array" ||
    container.termsUrlField === undefined
  )
    return undefined;
  // The narrowed container travels WITH the slot so no caller re-tests the kind. A second check would be
  // true whenever this returned a value, which makes it both redundant and unfalsifiable.
  return {
    container,
    field: container.termsUrlField,
    label: `${container.at}[${container.tagField}=${container.tag}].${container.termsUrlField}`,
  };
}

function declaredTermsUrlSlots(
  manifest: Pick<PlacementManifest, "termsUrlFields" | "container">,
): readonly string[] | undefined {
  const entry = entryTermsUrlSlot(manifest.container);
  if (manifest.termsUrlFields === undefined && entry === undefined)
    return undefined;
  return [
    ...(manifest.termsUrlFields ?? []),
    ...(entry === undefined ? [] : [entry.label]),
  ];
}

/** Read every declared terms-URL slot and reconcile. One value present answers; two agreeing answer; two
 *  disagreeing are a mismatch, because a document advertising different terms locations to different
 *  readers lets its author disown whichever reading lost. A non-string or non-https value at any declared
 *  slot is malformed even when another slot reads cleanly — a half-corrupt advertisement is not resolved
 *  by preferring the clean half. Document paths and the container's own entry field are read the same way
 *  and reconciled against each other: which member a protocol declares is a fact about its host's shape,
 *  never about how strictly its document is checked. */
function readTermsUrls(
  doc: unknown,
  manifest: Pick<PlacementManifest, "termsUrlFields" | "container">,
): TermsUrlReading {
  const slots = declaredTermsUrlSlots(manifest);
  if (slots === undefined) return { kind: "no-field-declared" };
  const entry = entryTermsUrlSlot(manifest.container);
  const readings: { path: string; raw: unknown }[] = (
    manifest.termsUrlFields ?? []
  ).map((path) => ({ path, raw: readAtPath(doc, path) }));
  if (entry !== undefined) {
    // OWN-PROPERTY, like the reference read out of the same entry (`readFromContainer`'s `valueField`
    // branch) and like every segment of `readAtPath`. A bare index read walks the prototype chain, and a
    // document is attacker-influenced input: an entry OWNING only `type` and the reference, inheriting
    // `url`, handed the caller `{kind:"read", url:"<attacker's>"}` — a locator nobody advertised,
    // presented as the counterparty's own. It also reached the reconciliation arm, where an inherited
    // value can manufacture a `mismatch` against a document whose one real advertisement is coherent.
    // `undefined` here means the entry did not claim the slot, which is what `declared-fields-empty`
    // exists to say — the same answer an entry with no `url` at all already gave.
    const rec = taggedEntry(doc, entry.container);
    readings.push({
      path: entry.label,
      raw:
        rec !== undefined && Object.hasOwn(rec, entry.field)
          ? rec[entry.field]
          : undefined,
    });
  }

  let hit: { path: string; url: string } | undefined;
  for (const { path, raw } of readings) {
    if (raw === undefined) continue;
    if (typeof raw !== "string" || !raw.startsWith(TERMS_URL_SCHEME))
      return { kind: "malformed", path, raw };
    if (hit === undefined) {
      hit = { path, url: raw };
      continue;
    }
    if (hit.url !== raw)
      return { kind: "mismatch", first: hit, second: { path, url: raw } };
  }
  return hit === undefined
    ? { kind: "declared-fields-empty", fields: slots }
    : { kind: "read", url: hit.url };
}

/**
 * Render a reference in a given encoding, ready to write into a field.
 *
 * The inverse of {@link decodeDeclaredRead}, and the reason `place` can honour an alias's `write` flag without
 * each adapter hard-coding a second shape. Throws `CarrierError` on a value that is invalid for its type —
 * minting a corrupt carrier is never a silent outcome.
 */
export function encodeForField(
  ref: LegalContextRef,
  encoding: PlacementEncoding,
): unknown {
  switch (encoding) {
    case "lcp-string":
      return encodeLegalContextString(ref);
    case "reference-object":
      return encodeLegalContextJson(ref).legalContext;
    case "bare-value":
      // Encode-then-discard: `encodeLegalContextString` runs the value check, so a bad value throws here
      // rather than landing on the wire as a bare string nothing would validate.
      encodeLegalContextString(ref);
      return ref.value;
  }
}

/**
 * THE MALFORMED-CONTAINER RULE, stated once because all three containers obey it.
 *
 * A container that is ABSENT is created — creating an absent `metadata` map on a real session is the
 * extension point working. A container that is PRESENT but cannot be merged into is:
 *
 * - **replaced**, when it is the DIRECT HOLDER of the field; and
 * - **refused**, when it is anywhere above the direct holder.
 *
 * The first half is `placement-acp`'s ratified behaviour, pinned by two vectors whose own `$comment` gives the
 * reason: spreading `metadata: "not-a-map"` would explode it into `{0:'n',1:'o',…}` and silently corrupt the
 * session, and arrays are objects to `typeof` so `{...['a','b']}` would emit `{0:'a',1:'b'}`. A placement is
 * structural and is NOT a host-protocol validator — it declines to corrupt, it does not adjudicate.
 *
 * Note this contradicts the design note this kit was built from, which said a container is "never repaired
 * when malformed". That phrasing would have made the kit reject the two ACP cases above — and the same note
 * named those vectors as the arbiter, since ACP is the kit's regression test and its vectors must stay
 * byte-identical. The vectors are the ratified record of designed behaviour; a prose description of intended
 * behaviour is not. So the vectors win.
 *
 * The second half is NOT evidenced by ACP — whose path has exactly one segment above the field — and is the
 * conservative reading. Replacing an intermediate would discard everything beneath it, which is a
 * substantially larger act than dropping the one unmergeable value that sits where the field's own holder
 * belongs. Nothing asks for that, so it refuses.
 */
function writeAtPath(
  doc: unknown,
  path: string,
  value: unknown,
): Record<string, unknown> | undefined {
  return writeSegments(doc, path.split("."), value);
}

/** The segment-based writer `writeAtPath` delegates to — the mirror of `readSegments`, and separate for the
 *  same reason: a segment may CONTAIN a dot, so splitting and walking cannot be one operation.
 *
 *  It descends into an array ONLY through an element that already exists, and the asymmetry with
 *  `readSegments` — which reads any canonical index — is deliberate and narrower than the old rule
 *  ("does not index arrays at all"). Writing element 2 of a one-element array would mint holes in the
 *  host's own list, so an element is NEVER created or extended here: the walk enters `accepts.0` when the
 *  host put a first requirement there, and refuses the whole write when it did not. That keeps the
 *  invariant the old rule protected — this writer decides where a value goes inside objects, never where
 *  an element goes inside the host's list — while admitting the case x402 actually has: the terms-URL and
 *  bare-hash mirrors live inside `accepts[0].extra`, an object the host's own schema requires to exist on
 *  any challenge that can be paid. (`tagged-array` remains the only writer that changes an array's
 *  membership, by tag rather than by position.) */
function writeSegments(
  doc: unknown,
  allSegs: readonly string[],
  value: unknown,
): Record<string, unknown> | undefined {
  const segs = allSegs.slice(0, -1);
  const leaf = allSegs[allSegs.length - 1];
  if (leaf === undefined || leaf === "") return undefined;
  const root = asRecord(doc);
  if (root === undefined) return undefined;

  // Walk down to the field's direct holder, structurally copying nothing yet — `chain[i]` is the container
  // the i-th segment is read from, so the rebuild below can copy each level exactly once. An array level
  // records the index it was entered through, because the rebuild must put the rebuilt element back at
  // that position rather than spread the array into an object.
  const chain: (Record<string, unknown> | readonly unknown[])[] = [root];
  for (const [i, seg] of segs.entries()) {
    const parent = chain[i] as Record<string, unknown> | readonly unknown[];
    let child: unknown;
    if (Array.isArray(parent)) {
      // Existing elements only, own-property checked like every other level: a canonical index into a
      // sparse hole or past the end is a write that would mint list structure, and a polluted
      // `Array.prototype["0"]` must not stand in for an element the host never put there.
      if (!INDEX.test(seg) || !Object.hasOwn(parent, seg)) return undefined;
      child = (parent as readonly unknown[])[Number(seg)];
    } else {
      // OWN-PROPERTY ONLY, for the same reason `readAtPath` checks it: `place`'s document is exactly as
      // attacker-influenced as `extract`'s. Without this, `Object.create({metadata:{attacker:"x"}})` — a
      // document with ZERO own properties — walks into the prototype's `metadata`, `asRecord` accepts it as
      // a mergeable container, and its keys are spread into the document we emit. `extract` on the same
      // input correctly reports the field absent, so the read and write halves disagreed about what is
      // present.
      child = Object.hasOwn(parent, seg)
        ? (parent as Record<string, unknown>)[seg]
        : undefined;
    }
    if (Array.isArray(child)) {
      // An array is a mergeable container for DESCENT only. As the field's direct holder it is
      // unmergeable — an object key written into an array would be list corruption — so it falls through
      // to the replace-or-refuse rule below like any other unmergeable value.
      const nextSeg = segs[i + 1] ?? leaf;
      if (INDEX.test(nextSeg)) {
        chain.push(child as readonly unknown[]);
        continue;
      }
    }
    // An INDEX segment names a position inside a list the HOST built, so it can only ever be entered —
    // never created. Creating `{ accepts: { "0": … } }` on a document with no `accepts` would mint an
    // object that reads back as a list to every index-aware reader, which is exactly the kind of
    // half-plausible structure a counterparty's parser chokes on. The refusal covers both directions: an
    // absent child about to be keyed by an index, and an absent child at an index key of a record parent
    // (a record that really keys "0" is entered through the own-property read above, untouched by this).
    if (
      child === undefined &&
      (INDEX.test(seg) || INDEX.test(segs[i + 1] ?? leaf))
    )
      return undefined;
    const rec = child === undefined ? {} : asRecord(child);
    if (rec !== undefined) {
      chain.push(rec);
      continue;
    }
    // Unmergeable. Replace it only if this segment IS the direct holder; otherwise refuse. An ARRAY parent
    // never replaces: the unmergeable value is one of the host's own elements, and overwriting it with a
    // fresh object would rewrite list content this writer has no mandate over.
    if (i !== segs.length - 1 || Array.isArray(parent)) return undefined;
    chain.push({});
  }

  // The leaf's direct holder must be an object — a leaf written into an array by index would replace one
  // of the host's own elements wholesale, which is the act the descent rule above exists to prevent.
  const holder = chain[segs.length];
  if (Array.isArray(holder)) return undefined;

  // Rebuild upward. Pure — one structural copy per level, input untouched. An array level is copied as an
  // array with the one rebuilt element replaced in place, so sibling elements and their order survive.
  let acc: unknown = {
    ...(holder as Record<string, unknown>),
    [leaf]: value,
  };
  for (let i = segs.length - 1; i >= 0; i--) {
    const level = chain[i] as Record<string, unknown> | readonly unknown[];
    const seg = segs[i] as string;
    if (Array.isArray(level)) {
      const copy = [...(level as readonly unknown[])];
      copy[Number(seg)] = acc;
      acc = copy;
    } else {
      acc = { ...(level as Record<string, unknown>), [seg]: acc };
    }
  }
  // The root is a record by the guard at the top; an array root never reaches here.
  return acc as Record<string, unknown>;
}

/**
 * Write a rendered reference into a document, honouring the container kind. Pure; `undefined` on a malformed
 * document.
 *
 * `tagged-array` REPLACES a matching entry in place with its sibling keys intact, and APPENDS when no entry
 * matches. Both halves matter: replacing wholesale would destroy the host's own fields on that entry, and
 * appending unconditionally would leave two entries carrying the same tag — a document where the first-wins
 * read rule silently decides which record counts.
 *
 * `header-map` writes the locator's own casing on a fresh key, but REUSES the existing key's casing when one
 * matches case-insensitively. Writing `x-lcp-hash` beside an existing `X-LCP-Hash` would produce two headers
 * RFC 9110 considers the same one.
 *
 * `entryFields` sets further properties on the SAME `tagged-array` entry, in the one write that creates or
 * merges it. It exists because the entry's index is not knowable in advance — replace-by-tag or append is
 * decided here — so a second, path-addressed write could not name the entry this one just landed. Applied
 * on merge as well as on create, unlike `constants`: these are our own fields on our own tagged entry, not
 * host siblings we would be overwriting. Ignored by the other two container kinds, which have no entry.
 */
export function writeToContainer(
  doc: unknown,
  container: PlacementContainer,
  path: string,
  value: unknown,
  entryFields?: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  switch (container.kind) {
    case "object-path":
      return writeSegments(doc, container.segments ?? path.split("."), value);
    case "tagged-array": {
      const rec = asRecord(doc);
      if (rec === undefined) return undefined;
      const current = readAtPath(doc, container.at);
      // Same malformed-container rule as writeAtPath: the array IS the field's direct holder, so a
      // present-but-unmergeable value there is replaced rather than spread. `[..."junk"]` would emit
      // ["j","u","n","k"] as the constraint list, which is the corruption the rule exists to prevent.
      const arr: readonly unknown[] = Array.isArray(current) ? current : [];
      // Map rather than index-and-narrow: the matched entry is a record by construction of the predicate, so
      // an `asRecord` re-check on it would be a branch no input can take. `found` keeps it FIRST-match-only,
      // matching the read rule — a duplicate tag must not have both entries rewritten.
      let found = false;
      const next = arr.map((e) => {
        const entry = asRecord(e);
        const claims =
          entry !== undefined &&
          Object.hasOwn(entry, container.tagField) &&
          entry[container.tagField] === container.tag;
        if (found || !claims) return e;
        found = true;
        return { ...entry, ...entryFields, [container.valueField]: value };
      });
      if (!found)
        next.push({
          // Constants first: a host-required sibling can never shadow the tag or the value, whichever
          // order a manifest happens to declare them in. `entryFields` follows them and precedes the tag
          // and value for the same reason — every one of the three is ours, and none may displace the two
          // that make the entry findable and meaningful.
          ...(container.constants ?? {}),
          ...entryFields,
          [container.tagField]: container.tag,
          [container.valueField]: value,
        });
      return writeAtPath(rec, container.at, next);
    }
    case "header-map": {
      const [at, key] = splitLocator(path);
      if (asRecord(doc) === undefined) return undefined;
      // Same malformed-container rule: the header map is the field's direct holder, so absent is created and
      // present-but-unmergeable is replaced. Spreading a string into a header map would mint numeric headers.
      // `asRecord(…) ?? {}` covers absent and unmergeable in one expression — splitting them into a ternary
      // produced two branches with identical results.
      const map = asRecord(at === "" ? doc : readAtPath(doc, at)) ?? {};
      const want = key.toLowerCase();
      const existingKey = Object.keys(map).find(
        (k) => k.toLowerCase() === want,
      );
      const next = { ...map, [existingKey ?? key]: value };
      // A single-segment locator means the DOCUMENT is the header map — Visa TAP's request headers are the
      // document, with no wrapper object to nest under.
      return at === "" ? next : writeAtPath(doc, at, next);
    }
  }
}

/**
 * Narrow a {@link writeToContainer} result an override has already proven cannot be `undefined`.
 *
 * The overrides that compose on top of `makePlacement` write into a path the kit's own write just created,
 * so the refusal branch is unreachable BY CONSTRUCTION rather than merely unlikely. Casting the result
 * would be the cheap way to say that, and it is the wrong one: a cast that turns out to be false yields
 * `{ ok: true, value: undefined }` — a success carrying no document, which is the silent failure this
 * codebase refuses everywhere else. This throws instead, so the impossible state is loud where it lands.
 *
 * It also keeps the mutation gate honest. A guard written inline at each call site is dead code there —
 * unkillable, which is exactly what the gate flags — while here the branch is reachable from this
 * function's own tests and is killed once, at its own door, for every override that uses it.
 *
 * NOT a refusal. Refusals are returned values describing a document; this describes a broken invariant in
 * our own composition, which no caller can act on and none should have to pattern-match.
 */
export function requireWritten(
  out: Record<string, unknown> | undefined,
  where: string,
): Record<string, unknown> {
  if (out === undefined)
    throw new Error(
      `${where}: the container write returned no document on a path the preceding write had already created — a placement override's postcondition is broken, not the caller's document`,
    );
  return out;
}

/**
 * Build a `ReferencePlacementAdapter` from a manifest alone.
 *
 * THE realization of U-β — "adding a protocol is data, never a core change". A protocol whose container is one
 * of the three declared kinds needs no adapter code at all: the manifest IS the implementation. `place` writes
 * exactly `field` (plus any alias that declares `write`, and only where a declared {@link WriteCondition} is
 * met); `extract` reads `field` then each declared alias, decoding by each one's own encoding — never gated,
 * because a condition says what WE may write and a counterparty's document is evidence either way.
 *
 * Refusal codes are namespaced from `manifest.protocol`, so `ucp/document-malformed` and `a2a/reference-absent`
 * fall out of the data rather than being retyped per package.
 *
 * A protocol whose write shape is genuinely not one of the three overrides `place` and keeps the generic
 * `extract` — that is composition, not an escape hatch, and the override is a named export in that package
 * reviewed like any other code. A THIRD override means a container kind is missing, not that the package is
 * special.
 */
export function makePlacement(
  manifest: PlacementManifest,
): ReferencePlacementAdapter {
  const permitted: readonly string[] = manifest.carrierTypes;
  const p = manifest.protocol;

  const refuse = (code: string, detail: string): Outcome<never> => ({
    refused: true,
    haltClass: "verification-failure",
    code: `${p}/${code}`,
    detail,
  });
  const malformedDocument = (): Outcome<never> =>
    refuse("document-malformed", `a ${p} document is a non-null object`);
  const describe = (raw: unknown): string =>
    typeof raw === "string" ? raw : JSON.stringify(raw);

  return {
    manifest,

    place(ad: LegalContextAdvertisement, doc: unknown): Outcome<unknown> {
      const { ref, termsUrl } = ad;
      if (!permitted.includes(ref.type))
        return refuse(
          "carrier-type-not-permitted",
          `${manifest.field} permits ${permitted.join("/")}, got ${ref.type}`,
        );
      // The advertisement's own coherence, before the document is examined: these are statements about
      // what the SELLER is trying to publish, and a malformed document must not mask them. Order within
      // the three matters — an unplaceable URL is answered first because fixing the document cannot fix
      // it; a manifest with slots then demands the URL of any integrity-bearing reference (a bare hash no
      // counterparty can resolve is unverifiable by construction — the defect integra-protocol#8
      // measured); and a supplied URL must be https on the write side for the same reason the read side
      // refuses it — minting a challenge every shipped buyer refuses is not a success path.
      const termsUrlSlots = declaredTermsUrlSlots(manifest);
      if (termsUrlSlots === undefined && termsUrl !== undefined)
        return refuse(
          "terms-url-unplaceable",
          `this ${manifest.protocol} placement declares no terms-URL slot — dropping the supplied URL silently would advertise less than the seller stated`,
        );
      if (
        termsUrlSlots !== undefined &&
        termsUrl === undefined &&
        INTEGRITY_CARRIER_TYPES.includes(ref.type)
      )
        return refuse(
          "terms-url-missing",
          `${manifest.protocol} declares ${termsUrlSlots.join(" and ")} and the ${ref.type} reference is integrity-bearing — a hash with no locator cannot be verified by a counterparty that does not already hold the terms`,
        );
      if (termsUrl !== undefined && !termsUrl.startsWith(TERMS_URL_SCHEME))
        return refuse(
          "terms-url-malformed",
          `terms URL must be ${TERMS_URL_SCHEME}…, got ${termsUrl}`,
        );
      if (asRecord(doc) === undefined) return malformedDocument();

      // The gate on the reference field, BEFORE anything is rendered or written. Ordering matters twice: a
      // malformed document is answered as malformed (there is no gate to read out of a non-object), and a
      // corrupt reference under an unmet gate is answered as unmet — otherwise a seller fixes the value it
      // was told about and hits the gate second, having been led to believe the document was acceptable.
      if (
        manifest.writeCondition !== undefined &&
        !writeConditionMet(doc, manifest.writeCondition)
      )
        return refuse(
          "write-condition-unmet",
          `${manifest.field} is writable only where ${describeGate(manifest.writeCondition)}`,
        );

      // Render through the codec, never by interpolation — a value that does not meet its type's rule
      // refuses here instead of minting a corrupt carrier the decoder would later reject.
      let rendered: unknown;
      try {
        rendered = encodeForField(ref, manifest.encoding);
      } catch (e) {
        if (!(e instanceof CarrierError)) throw e; // never swallow a non-carrier bug
        return refuse(
          "reference-malformed",
          `not a valid carrier value for its type: ${ref.value}`,
        );
      }

      // Container failures name the path that could not be written, because `document-malformed` alone
      // cannot tell an operator whether the document was not an object or a specific container inside a
      // well-formed object was unmergeable — and the value found there, because "extensions is not a map"
      // without the offending value sends them back with a debugger for what one string would have said.
      const unwritable = (path: string): Outcome<never> =>
        refuse(
          "document-malformed",
          `${path} has no writable holder on this document — an intermediate container is present and not a map, or an index names an element the host never created: ${describe(readAtPath(doc, path.split(".").slice(0, -1).join(".")) ?? doc)}`,
        );
      // The reference and any entry-relative terms URL land in ONE write, because the entry the container
      // owns is created or merged here and no later write could name it: its index is decided by this call.
      const entrySlot = entryTermsUrlSlot(manifest.container);
      let out = writeToContainer(
        doc,
        manifest.container,
        manifest.field,
        rendered,
        entrySlot !== undefined && termsUrl !== undefined
          ? { [entrySlot.field]: termsUrl }
          : undefined,
      );
      if (out === undefined) return unwritable(manifest.field);

      // Aliases that declare `write` are populated too, each in its OWN encoding — the write-both shape
      // honoured from the manifest rather than from a second adapter body. ACP is the shipped consumer;
      // UCP, whose §C.3 advice motivated the flag, declines it (see `write` on PlacementAlias).
      for (const alias of manifest.readAlso ?? []) {
        if (alias.write !== true) continue;
        // An alias whose condition is unmet is DECLINED, not refused: this carrier is an addition and the
        // placement already landed in `field`. That is ACP's case — writing its top-level carrier outside a
        // negotiated session would have stock ACP reject the session, while the metadata carrier the
        // placement is built on needs nothing from the counterparty. The gate reads the INPUT document, never
        // `out`: a condition satisfied by our own canonical write would be self-certifying.
        if (
          alias.writeCondition !== undefined &&
          !writeConditionMet(doc, alias.writeCondition)
        )
          continue;
        let aliasValue: unknown;
        try {
          aliasValue = encodeForField(ref, alias.encoding ?? manifest.encoding);
        } catch (e) {
          if (!(e instanceof CarrierError)) throw e;
          return refuse(
            "reference-malformed",
            `not a valid carrier value for its type: ${ref.value}`,
          );
        }
        const next = writeToContainer(
          out,
          alias.container ?? manifest.container,
          alias.path,
          aliasValue,
        );
        if (next === undefined) return unwritable(alias.path);
        out = next;
      }

      // The terms URL lands at EVERY declared slot, after the reference and its aliases so a slot nested
      // inside the canonical carrier (x402's `info.legalContextUrl`) writes into the object the reference
      // write just created. A slot the document cannot hold — the walk fails because the host structure
      // it descends is absent or unmergeable — refuses the whole placement: the manifest declared what a
      // complete advertisement is, and a document that can carry half of one is a document this protocol
      // cannot advertise in.
      if (termsUrl !== undefined && manifest.termsUrlFields !== undefined)
        for (const path of manifest.termsUrlFields) {
          const next = writeAtPath(out, path, termsUrl);
          if (next === undefined)
            return refuse(
              "terms-url-slot-unwritable",
              `${path} cannot be written on this document — the host structure it lives in is absent or malformed`,
            );
          out = next;
        }
      return { ok: true, value: out };
    },

    extract(doc: unknown): Outcome<ExtractedAdvertisement> {
      if (asRecord(doc) === undefined) return malformedDocument();
      const hit = readDeclaredPaths(doc, manifest);
      if (hit === undefined)
        return refuse(
          "reference-absent",
          `no ${manifest.field} on this document`,
        );

      let decoded: LegalContextRef | undefined;
      try {
        decoded = decodeDeclaredRead(hit);
      } catch (e) {
        if (!(e instanceof CarrierError)) throw e; // never swallow a non-carrier bug
        return refuse(
          "reference-malformed",
          `carrier value is invalid for its type: ${describe(hit.raw)}`,
        );
      }
      if (decoded === undefined)
        return refuse(
          "reference-malformed",
          `not a parseable ${hit.encoding} reference: ${describe(hit.raw)}`,
        );
      if (!permitted.includes(decoded.type))
        return refuse(
          "carrier-type-not-permitted",
          `${manifest.field} permits ${permitted.join("/")}, got ${decoded.type}`,
        );

      // The terms URL is read AFTER the reference resolves, because a document with no reference has
      // nothing to advertise a locator FOR — `reference-absent` already answered it. The two document
      // defects refuse; both absences are values (see AdvertisedTermsUrl for why the gate, not the
      // reader, decides what an absence means).
      const terms = readTermsUrls(doc, manifest);
      if (terms.kind === "mismatch")
        return refuse(
          "terms-url-mismatch",
          `two declared slots disagree — ${terms.first.path} advertises ${terms.first.url}, ${terms.second.path} advertises ${terms.second.url}`,
        );
      if (terms.kind === "malformed")
        return refuse(
          "terms-url-malformed",
          `${terms.path} must be an ${TERMS_URL_SCHEME}… string, got ${describe(terms.raw)}`,
        );
      return { ok: true, value: { ref: decoded, termsUrl: terms } };
    },
  };
}

/**
 * Every rule a {@link WriteCondition} must meet, checked once for the manifest's gate and once per alias gate.
 *
 * `where` names the site, so a throw points at the gate that is wrong rather than at the manifest as a whole —
 * and a term inside `and` names its index, because a gate with several terms has several places to be wrong.
 *
 * Two rules belong to the conjunction rather than to any one term. An EMPTY `and` declares a second fact and
 * then names none, which reads as a stricter gate than it is; and two terms on the SAME `path` are one term
 * written twice, where the looser copy silently decides the gate.
 */
function assertWriteConditionHygiene(where: string, c: WriteCondition): void {
  assertWriteTermHygiene(where, c);
  if (c.and === undefined) return;
  if (c.and.length === 0)
    throw new Error(
      `${where} declares an empty and — a conjunction with no further terms is the single-term gate, so omit the key`,
    );
  const paths = [c.path, ...c.and.map((t) => t.path)];
  if (new Set(paths).size !== paths.length)
    throw new Error(
      `${where} declares a conjunction whose terms repeat a path (${paths.join("/")}) — the looser copy would decide the gate`,
    );
  for (const [i, t] of c.and.entries())
    assertWriteTermHygiene(`${where} and[${i}]`, t);
}

/**
 * Every rule ONE term must meet.
 *
 * The first four restate the vector schema's `minLength` / `minItems` / `items.minLength` / `uniqueItems`,
 * because a manifest authored in TypeScript never meets that schema — and two of them are not cosmetic. An
 * empty `path` resolves to the `""` key, which any document can carry and a hostile one will; an empty
 * `permits` refuses every document forever while reporting a gate that named nothing.
 *
 * The fifth rule has no schema half, because JSON Schema cannot compare two sibling values. It is the one that
 * matters most on an alias: an unsatisfiable alias gate declines SILENTLY, and a silent decline is the exact
 * shape of a fallback path.
 */
function assertWriteTermHygiene(where: string, c: WriteConditionTerm): void {
  if (c.path.length === 0)
    throw new Error(
      `${where} declares a writeCondition with an empty path — that resolves to the "" key, which any document can carry`,
    );
  if (c.permits.length === 0)
    throw new Error(
      `${where} declares a writeCondition permitting nothing — a condition no document can satisfy is not a condition`,
    );
  if (c.permits.some((v) => v.length === 0))
    throw new Error(
      `${where} declares a writeCondition permitting the empty string — that is not a wire value`,
    );
  if (new Set(c.permits).size !== c.permits.length)
    throw new Error(
      `${where} declares a writeCondition whose permits repeat: ${c.permits.join("/")}`,
    );
  // A tagged array whose valueField IS its tagField can return exactly one value — the tag — because
  // `readFromContainer` matched on it to find the entry. `permits` is then wholly redundant with
  // `container.tag`, and unchecked redundancy drifts: a one-line rename on either side leaves a gate no
  // document can satisfy, which refuses forever on the manifest and declines without a signal on an alias.
  if (
    c.container.kind === "tagged-array" &&
    c.container.valueField === c.container.tagField &&
    !c.permits.includes(c.container.tag)
  )
    throw new Error(
      `${where} declares a writeCondition reading its own tag field ${c.container.tagField}, so ${c.container.tag} is the only value it can ever see — permits (${c.permits.join("/")}) does not list it`,
    );
}

/**
 * Assert a placement manifest's internal consistency — the rules JSON Schema cannot express.
 *
 * THROWS rather than returning an Outcome: this is a build-time authoring defect in our own manifest, not an
 * untrusted-wire condition. A refusal value would let a broken manifest ship as a handled case.
 *
 * Every placement package calls this from its manifest test. That is the enforcement point — the schema
 * checks shape, this checks coherence, and neither substitutes for the other.
 */
export function assertManifestHygiene(m: PlacementManifest): void {
  if (m.readAlso?.some((a) => a.path === m.field))
    throw new Error(
      `readAlso repeats the canonical field ${m.field} — that is a duplicate, not an alias`,
    );
  if (m.termsUrlFields !== undefined) {
    if (m.termsUrlFields.length === 0)
      throw new Error(
        "termsUrlFields is declared and empty — a protocol with no terms-URL slot says so by omitting the member, and an empty list reads as a slot while placing nothing",
      );
    if (new Set(m.termsUrlFields).size !== m.termsUrlFields.length)
      throw new Error(
        `termsUrlFields repeats a path (${m.termsUrlFields.join(", ")}) — one slot written twice is one slot, declared as two`,
      );
    for (const path of m.termsUrlFields) {
      if (path === m.field)
        throw new Error(
          `termsUrlFields names field (${m.field}) — the reference and its terms URL are different objects`,
        );
      if (m.readAlso?.some((a) => a.path === path))
        throw new Error(
          `termsUrlFields names alias path ${path} — a slot cannot hold the reference and its locator at once`,
        );
    }
  }
  if (m.pattern === "protocol-extension" && m.tier !== "B")
    throw new Error(
      "protocol-extension is Tier B by definition (LCP §8.3.6) — a Tier A claim is incoherent",
    );
  if (!m.carrierTypes.some((t) => INTEGRITY_CARRIER_TYPES.includes(t)))
    throw new Error(
      `the reference field ${m.field} permits no integrity-bearing carrier type (${INTEGRITY_CARRIER_TYPES.join("/")}) — that is discovery, not a placement`,
    );
  if (m.encoding === "bare-value" && m.carrierTypes.length !== 1)
    throw new Error(
      `bare-value encoding needs exactly one carrierType to fix the type; ${m.field} permits ${m.carrierTypes.length}`,
    );
  if (m.writeCondition !== undefined)
    assertWriteConditionHygiene("the manifest", m.writeCondition);
  assertTaggedArrayConstants("the manifest", m.container, m.field);
  for (const a of m.readAlso ?? []) {
    if (
      (a.encoding ?? m.encoding) === "bare-value" &&
      a.bareType === undefined &&
      m.carrierTypes.length !== 1
    )
      throw new Error(
        `bare-value alias ${a.path} declares no bareType and the manifest permits ${m.carrierTypes.length} carrier types — nothing fixes its type`,
      );
    if (a.writeCondition === undefined) continue;
    // A condition gates a WRITE. On an alias that is never written it guards nothing while reading as a
    // guard, which is worse than absent: a reviewer infers the carrier is conditional when in fact it never
    // lands at all. The vector schema rejects the same pairing; this is the half that catches a manifest
    // authored in TypeScript, which never meets that schema.
    if (a.write !== true)
      throw new Error(
        `alias ${a.path} declares a writeCondition but not write — a condition gating a write that never happens is inert`,
      );
    assertWriteConditionHygiene(`alias ${a.path}`, a.writeCondition);
  }
  for (const a of m.readAlso ?? [])
    if (a.write === true)
      assertTaggedArrayConstants(`alias ${a.path}`, a.container, a.path);
}

/**
 * A `tagged-array` constant may not collide with the tag or the value field it sits beside.
 *
 * The writer spreads constants FIRST so a collision cannot corrupt the reference at runtime — but a
 * manifest that declares one is stating something it does not mean, and silently losing it is how a
 * reader comes to believe a host-required sibling is being written when it is not. Fail on the claim, not
 * only on the consequence.
 */
function assertTaggedArrayConstants(
  where: string,
  container: PlacementContainer | undefined,
  field: string,
): void {
  if (container?.kind !== "tagged-array") return;
  // The terms-URL slot is written onto the same entry and is subject to the same rule for the same reason:
  // it is spread ahead of the tag and value, so a collision would be silently lost rather than corrupting
  // them — and a manifest that declares one is still stating something it does not mean.
  if (
    container.termsUrlField !== undefined &&
    (container.termsUrlField === container.tagField ||
      container.termsUrlField === container.valueField)
  )
    throw new Error(
      `${where}: tagged-array termsUrlField on ${field} is "${container.termsUrlField}", which is the entry's own ${container.termsUrlField === container.tagField ? "tagField" : "valueField"} — the terms URL and the ${container.termsUrlField === container.tagField ? "tag" : "reference"} are different objects`,
    );
  if (container.constants === undefined) return;
  for (const key of [
    container.tagField,
    container.valueField,
    ...(container.termsUrlField === undefined ? [] : [container.termsUrlField]),
  ])
    if (Object.hasOwn(container.constants, key))
      throw new Error(
        `${where}: tagged-array constants on ${field} declare "${key}", which is the entry's own ${key === container.tagField ? "tagField" : key === container.valueField ? "valueField" : "termsUrlField"} — a constant cannot also be the tag, the value or the terms URL`,
      );
}
