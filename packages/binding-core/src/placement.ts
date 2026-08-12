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
 * entry of a typed array (UCP's `links`, Mastercard VI's Layer-2 `constraints`); `header-map` covers the one
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
   * its `links` alias READ-ONLY on the reasoning in `placement-ucp/src/manifest.ts:40–51` (the links entry
   * carries the terms URL, a different datum than the atrHash). The shipped `write: true` consumer is ACP.
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
   * The shipped consumer is ACP, not UCP — `placement-acp/src/manifest.ts:195–199` sets it on the
   * `legal_context` alias under a {@link WriteCondition} that requires the agent to have declared the
   * extension. UCP §C.3 describes the same pruning hazard and was the motivating case for this flag, but the
   * UCP manifest deliberately declines the write: its second carrier holds the terms URL rather than the
   * atrHash, and `place` carries one reference, not two data.
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
   * OPTIONAL — dotted path of the field carrying the human-readable terms URL, where the protocol has room
   * for one. Declared rather than left to convention because a buyer-side parser that REQUIRES the URL
   * against a placement that never places it cannot round-trip: the x402 wire carries both halves, which is
   * why its parser can demand both. A placement carrying only the reference says so by omitting this, and a
   * parser reads the manifest rather than assuming.
   */
  termsUrlField?: string;
  /** Which carrier types this field can legally hold (a tight length budget may permit only the shortest). */
  carrierTypes: readonly LegalContextRef["type"][];
  /** Citation for the protocol's own spec section that owns this field. */
  specRef?: string;
};

/**
 * Place an LCP reference into a protocol document, and recover it from one.
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
  /** Return the document with the reference placed at `manifest.field`. Pure — never mutates its input. */
  place(ref: LegalContextRef, doc: unknown): Outcome<unknown>;
  /** Read the reference back out of a protocol document. */
  extract(doc: unknown): Outcome<LegalContextRef>;
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
 * content-addressed type — which says nothing about what a given document put there. Four shipped manifests
 * permit `url` alongside `sha256` (ACP, UCP, x402, ACK), so `{type:"url", …}` in the canonical slot read
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
 * Note this contradicts the S7 plan text, which says a container is "never repaired when malformed". That
 * phrasing would have made the kit reject the two ACP cases above, and S7's own Step 6 names those vectors as
 * the arbiter — "its vectors must stay byte-identical … ACP is the regression test for the kit". The vectors
 * are the ratified record of designed behaviour; a prose description of intended behaviour is not.
 * So the vectors win.
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
 *  It does NOT index arrays, and the asymmetry with `readSegments` is deliberate: writing element 2 of a
 *  one-element array would mint holes in the host's own list, and the only array WRITE anyone declared is
 *  `tagged-array`, which appends or replaces by tag instead of by position. Reading an element the host put
 *  there is a different act from choosing where an element goes. */
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

  // Walk down to the field's direct holder, structurally copying nothing yet — `chain[i]` is the record the
  // i-th segment is read from, so the rebuild below can copy each level exactly once.
  const chain: Record<string, unknown>[] = [root];
  for (const [i, seg] of segs.entries()) {
    const parent = chain[i] as Record<string, unknown>;
    // OWN-PROPERTY ONLY, for the same reason `readAtPath` checks it: `place`'s document is exactly as
    // attacker-influenced as `extract`'s. Without this, `Object.create({metadata:{attacker:"x"}})` — a
    // document with ZERO own properties — walks into the prototype's `metadata`, `asRecord` accepts it as a
    // mergeable container, and its keys are spread into the document we emit. `extract` on the same input
    // correctly reports the field absent, so the read and write halves disagreed about what is present.
    const child = Object.hasOwn(parent, seg) ? parent[seg] : undefined;
    const rec = child === undefined ? {} : asRecord(child);
    if (rec !== undefined) {
      chain.push(rec);
      continue;
    }
    // Unmergeable. Replace it only if this segment IS the direct holder; otherwise refuse.
    if (i !== segs.length - 1) return undefined;
    chain.push({});
  }

  // Rebuild upward. Pure — one structural copy per level, input untouched.
  let acc: Record<string, unknown> = {
    ...(chain[segs.length] as Record<string, unknown>),
    [leaf]: value,
  };
  for (let i = segs.length - 1; i >= 0; i--)
    acc = {
      ...(chain[i] as Record<string, unknown>),
      [segs[i] as string]: acc,
    };
  return acc;
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
 */
export function writeToContainer(
  doc: unknown,
  container: PlacementContainer,
  path: string,
  value: unknown,
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
        return { ...entry, [container.valueField]: value };
      });
      if (!found)
        next.push({
          // Constants first: a host-required sibling can never shadow the tag or the value, whichever
          // order a manifest happens to declare them in.
          ...(container.constants ?? {}),
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

    place(ref: LegalContextRef, doc: unknown): Outcome<unknown> {
      if (!permitted.includes(ref.type))
        return refuse(
          "carrier-type-not-permitted",
          `${manifest.field} permits ${permitted.join("/")}, got ${ref.type}`,
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

      let out = writeToContainer(
        doc,
        manifest.container,
        manifest.field,
        rendered,
      );
      if (out === undefined) return malformedDocument();

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
        if (next === undefined) return malformedDocument();
        out = next;
      }
      return { ok: true, value: out };
    },

    extract(doc: unknown): Outcome<LegalContextRef> {
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
      return { ok: true, value: decoded };
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
  if (m.termsUrlField !== undefined && m.termsUrlField === m.field)
    throw new Error(
      `termsUrlField equals field (${m.field}) — the reference and its terms URL are different objects`,
    );
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
  if (container?.kind !== "tagged-array" || container.constants === undefined)
    return;
  for (const key of [container.tagField, container.valueField])
    if (Object.hasOwn(container.constants, key))
      throw new Error(
        `${where}: tagged-array constants on ${field} declare "${key}", which is the entry's own ${key === container.tagField ? "tagField" : "valueField"} — a constant cannot also be the tag or the value`,
      );
}
