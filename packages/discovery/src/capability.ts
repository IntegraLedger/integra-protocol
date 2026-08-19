// LCP §4.5 capability declaration — what an agent REQUIRES of a counterparty, published where the
// counterparty can pre-filter on it, in the two host shapes that carry it today.
//
// This is the OTHER half of `legal-context.json`. That document says what a service OFFERS; this one says
// what a buyer's principal will ACCEPT (§4.1's bilateral handshake). §4.5 permits exposing a subset of an
// otherwise-private policy "so the counterparty can pre-filter incompatible offers" and states that "the
// mechanism for that exposure is protocol-specific and out of scope for this standard" — so the shapes
// below come from the HOST protocols' live specifications, never from LCP's informative Appendix C.
//
// **Advertisement, not negotiation.** Emitting a declaration says what this deployment requires. It commits
// nothing on any counterparty's behalf, and reading one obliges nobody: it tells a caller what it would have
// to satisfy, and the decision stays the caller's.
//
// **THROW on our own malformed input, RETURN null on a counterparty's honest silence.** Both emitters and
// both readers throw `CapabilityError` — the readers because a malformed or unreadable advertisement is bad
// data at a trust boundary, exactly the posture `parseLegalContextJson` takes. "The counterparty declares no
// LCP requirement" is not bad data, so it answers `null`, the same spelling `carrierOp`'s decode misses use.
//
// **Which direction silence is safe in decides every judgement call here.** Answering `null` means "nothing
// to satisfy". Answering it for a document that DOES carry a requirement we merely could not read would let
// an agent transact believing it complied when it did not, so every unreadable case refuses instead — a
// declared-but-unparseable requirement, an unsupported version, an unrecognized requirement key. Declining a
// transaction that might have completed is the recoverable error; the other one is not.
import {
  A2A_LCP_EXTENSION_URI,
  LCP_CAPABILITY_AUTHORITY_ORIGIN,
  LCP_CAPABILITY_NAME,
  LCP_CAPABILITY_SCHEMA_URL,
  LCP_CAPABILITY_SPEC_URL,
  LCP_CAPABILITY_VERSION,
} from "./capability-identity.js";

/** Thrown by every member of this module. `code` is the cross-implementation contract; the message is prose
 *  and is deliberately not pinned by any vector. Same shape as `binding-core`'s `CarrierError`. */
export class CapabilityError extends Error {
  // Declared-and-assigned rather than a constructor parameter property: parameter properties are
  // TypeScript-only syntax the workspace's `erasableSyntaxOnly` forbids.
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CapabilityError";
  }
}

/** The four LCP trust levels (§3). A declaration names the floor it requires, never a level of its own. */
export type LcpLevel = 1 | 2 | 3 | 4;
const LEVELS: readonly LcpLevel[] = [1, 2, 3, 4];

/**
 * The protocol-neutral declaration. Exactly three fields, and the omissions are the design:
 *
 * §4.2 lists eight policy primitives. §4.5 says a buyer MAY expose "a subset ... typically the minimum
 * required level and the acceptable jurisdictions", and the three below are that subset plus the third the
 * same sentence's logic reaches: each states a bar a counterparty can tell whether its own offer clears.
 *
 * **Two of the remaining five must never be published, and that is the sharp case.** Commitment caps and
 * signing thresholds put the value above which a human reviews on the wire, handing a counterparty the exact
 * number to stay under — the §12.7 attack surface the standard spends a whole section closing. They stay
 * private, and no future version should add them.
 *
 * The other three — required dispute resolution, identity requirements, format requirements — are publishable
 * in principle and §4.2 describes the last of them as precisely a pre-filter ("A buyer with a JSON-only parser
 * may decline to transact with services that publish only PDF terms"). They are **out of scope for this
 * version**, not unsafe. Adding one is a version bump, which is the cost the strict-unknown-key rule below
 * accepts on purpose.
 *
 * `minimumLevel` is REQUIRED. A declaration that requires nothing is not an advertisement, and emitting one
 * would put a field on the wire that says only "LCP was mentioned here".
 */
export interface LcpCapabilityDeclaration {
  readonly minimumLevel: LcpLevel;
  readonly acceptedJurisdictions?: readonly string[];
  readonly acceptedDisputeMethods?: readonly string[];
}

const DECLARATION_FIELDS: readonly string[] = [
  "minimumLevel",
  "acceptedJurisdictions",
  "acceptedDisputeMethods",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One indexed read, in one place. Every call site reads an untyped host document, so the alternative is
// `doc["capabilities"]` at two dozen sites — TS4111 under `noPropertyAccessFromIndexSignature` if written
// with a dot, and a biome `useLiteralKeys` warning if written with a literal subscript. A variable key is
// neither, and the return type is `unknown` either way.
//
// **OWN PROPERTY ONLY, on every segment of every walk.** This is the house rule `binding-core`'s document
// walker states and proves — "a document is attacker-influenced input, and walking the prototype chain would
// let `constructor.name` answer as though it were a placed reference" — and both readers here walk exactly
// that kind of input. Stating it unconditionally is the point: no read key here collides with
// `Object.prototype` today, so a chain walk has no JSON-reachable exploit, and a rule that held only while
// that coincidence lasted would be no rule. A document with zero own properties declares nothing.
function get(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function asLevel(value: unknown): LcpLevel {
  for (const level of LEVELS) if (value === level) return level;
  throw new CapabilityError(
    "capability/minimum-level-invalid",
    `minimumLevel must be one of the four LCP §3 levels (1-4); got ${JSON.stringify(value)}`,
  );
}

function asAcceptedList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value))
    throw new CapabilityError(
      "capability/accepted-list-not-an-array",
      `${field} must be an array of strings`,
    );
  // An empty list is not "no constraint" — read literally it accepts nothing, so it would refuse every
  // counterparty on earth. A deployment that constrains neither omits the field.
  if (value.length === 0)
    throw new CapabilityError(
      "capability/accepted-list-empty",
      `${field} is present but empty, which accepts nothing; omit the field to constrain nothing`,
    );
  // COPIED, not handed back. `readonly string[]` is erased at runtime, so returning the caller's array would
  // leave the emitted entry aliasing it — the caller could push a jurisdiction into a declaration it had
  // already published, and a document already on the wire would change under a reader. Building a new array
  // rather than casting the old one makes the copy the only way out of this function.
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "")
      throw new CapabilityError(
        "capability/accepted-entry-blank",
        `${field} carries an entry that is not a non-blank string`,
      );
    entries.push(entry);
  }
  return entries;
}

/**
 * Validate a declaration and return it in canonical key order — the ONE validator, used on both emit paths
 * and both read paths. A counterparty's advertisement is therefore held to exactly the shape we publish, and
 * the two directions cannot drift into disagreeing about what a declaration is.
 *
 * **STRICT on unrecognized keys, which is the opposite of `legal-context.json`.** LCP §2.5 makes the
 * discovery document extensible and its validator preserves fields it has never heard of, because an unknown
 * field there is a claim the seller makes and a reader may ignore. An unknown field HERE is a requirement
 * placed on the reader, and A2A's own `required` semantics say the plain part out loud — "the client must
 * understand and comply with the extension's requirements". Complying with a requirement you cannot parse is
 * not possible, and ignoring it is the silence that is unsafe. The cost is stated in the README: a future
 * primitive is a version bump, not a tolerated extra key.
 */
export function normalizeCapabilityDeclaration(
  value: unknown,
): LcpCapabilityDeclaration {
  if (!isRecord(value))
    throw new CapabilityError(
      "capability/declaration-not-an-object",
      "a capability declaration is a JSON object",
    );
  for (const key of Object.keys(value))
    if (!DECLARATION_FIELDS.includes(key))
      throw new CapabilityError(
        "capability/unrecognized-field",
        `${key} is not an LCP capability requirement this version can evaluate`,
      );
  const jurisdictions = get(value, "acceptedJurisdictions");
  const methods = get(value, "acceptedDisputeMethods");
  return {
    minimumLevel: asLevel(get(value, "minimumLevel")),
    ...(jurisdictions === undefined
      ? {}
      : {
          acceptedJurisdictions: asAcceptedList(
            jurisdictions,
            "acceptedJurisdictions",
          ),
        }),
    ...(methods === undefined
      ? {}
      : {
          acceptedDisputeMethods: asAcceptedList(
            methods,
            "acceptedDisputeMethods",
          ),
        }),
  };
}

// ── A2A's own two `AgentExtension` fields, and the ONE place emit and read deliberately differ ──────────
//
// The declaration validator is shared in both directions on purpose (see `normalizeCapabilityDeclaration`),
// because a requirement means the same thing whoever wrote it. `description` and `required` are not
// requirements: they are the HOST's fields, so the host's JSON mapping decides what a conformant
// counterparty may put on the wire, and it permits encodings our emitter would never choose.
//
// **Neither field has presence tracking.** `string description = 2` and `bool required = 3` (a2a.proto
// 428/430) carry no `optional`, so proto3 gives them the scalar defaults `""` and `false`, and a serializer
// with default emission — Go `protojson`'s `EmitUnpopulated`, protobuf-es's `emitDefaultValues` — prints
// `"description": ""` alongside `"required": false`. proto3 JSON separately accepts `null` for ANY field as
// that field's default. So `{"description": "", "required": false}` and `{"description": null}` are legal
// encodings of a card carrying no description and no demand — the exact card our own emitter's output
// round-trips to once a stock serializer expands the defaults.
//
// EMIT stays strict: a blank description we chose to write is noise on the wire, and refusing it is the
// module's own choice about its own output. READ maps the host's default encodings to absent and then applies
// the same strict check to what remains, so the reader refuses a description that is a number or an array
// and accepts every encoding of "there is nothing here". The alternative — one guard for both directions —
// makes `readAgentCard` refuse conformant cards, and refusing to read is exactly the pre-filter failure this
// module exists to prevent. UCP has no analogue and needs none: a UCP profile is JSON-native, with no proto3
// default mapping behind it.

function asRequired(value: unknown): boolean {
  // Absent means false, and that is the host's own rule rather than a default of ours: `required` is a
  // proto3 non-optional `bool` (a2a.proto 430), so its default value is `false` and proto3 JSON omits it.
  if (value === undefined) return false;
  if (typeof value !== "boolean")
    throw new CapabilityError(
      "capability/required-not-a-boolean",
      "required must be a boolean",
    );
  return value;
}

function asDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new CapabilityError(
      "capability/description-not-a-string",
      "description must be a string",
    );
  // A blank description is indistinguishable from an absent one once proto3 has serialized it, so emitting
  // it puts a field on the wire that carries nothing. Refuse rather than emit noise.
  if (value.trim() === "")
    throw new CapabilityError(
      "capability/description-blank",
      "description is blank; omit it rather than emitting an empty string",
    );
  return value;
}

/** Read side: proto3 JSON's `null`-is-the-default rule, then the strict check on whatever is left. */
function readRequired(value: unknown): boolean {
  return value === null ? false : asRequired(value);
}

/** Read side: `null` and any blank string are the host's encodings of "no description". */
function readDescription(value: unknown): string | undefined {
  if (value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return asDescription(value);
}

/** Options a deployment sets on the A2A Agent Card entry. Not part of the declaration: both are A2A's
 *  fields, and neither has an analogue in UCP. */
export interface AgentCardExtensionOptions {
  /**
   * A2A's `required` flag (a2a.proto 430) — "If true, the client must understand and comply with the
   * extension's requirements."
   *
   * **Defaults to `false`, and `true` is an explicit choice with a real interoperability cost:** it commits
   * the agent to refusing counterparties that do not support the extension, and today essentially none do.
   * The default is not timidity — an advertisement that no counterparty can satisfy advertises nothing.
   */
  readonly required?: boolean;
  /** A2A's `description` (a2a.proto 428) — "A human-readable description of how this agent uses the
   *  extension." Omitted from the emitted entry when absent. */
  readonly description?: string;
}

const OPTION_FIELDS: readonly string[] = ["required", "description"];

/**
 * Validate the options bag and return it as a plain record to read through {@link get}.
 *
 * **STRICT on unrecognized keys, for the same reason the declaration validator is — and here the cost of
 * tolerance is a silent downgrade.** `required` is the one interoperability flag this unit's binding
 * constraint says must be an explicit deployment choice; a bag carrying `requird` would satisfy an
 * object-only check, read `required` as absent and emit `false` without a word. TypeScript's excess-property
 * check does not save a deployment that reads its options out of a JSON or YAML config, which is the
 * realistic case for a published Agent Card, and a misspelling that quietly produces the safe-looking value
 * is exactly what fail-fast-and-loud forbids. `uri` and `params` are refused by the same rule: neither is the
 * deployment's to set here.
 *
 * Returning the record rather than asserting through a `void` helper is what lets the whitelist and the reads
 * agree on own-property-only, and it keeps `options.required` off an index signature — TS4111 if narrowed in
 * place at the call site.
 */
function optionsRecord(options: unknown): Record<string, unknown> {
  if (options === undefined) return {};
  if (!isRecord(options))
    throw new CapabilityError(
      "capability/options-not-an-object",
      "Agent Card extension options must be a JSON object",
    );
  for (const key of Object.keys(options))
    if (!OPTION_FIELDS.includes(key))
      throw new CapabilityError(
        "capability/unrecognized-option",
        `${key} is not an A2A AgentExtension option this version sets`,
      );
  return options;
}

/**
 * One entry for an Agent Card's `capabilities.extensions[]` (a2a.proto 418), carrying all FOUR
 * `AgentExtension` fields in proto field order.
 */
export interface AgentCardExtension {
  readonly uri: string;
  readonly description?: string;
  readonly required: boolean;
  readonly params: LcpCapabilityDeclaration;
}

/**
 * Build the Agent Card extension entry. Merge it into `capabilities.extensions[]`.
 *
 * **Declaration is not activation, and this function does neither on the wire.** A2A extensions "default to
 * being inactive"; a client activates by naming URIs in the {@link A2A_EXTENSION_ACTIVATION_HEADER} request
 * header and the agent SHOULD echo back the set it activated. A card that declares and is never activated is
 * never exercised — which is exactly why `placement-a2a` puts the per-transaction reference in task
 * `metadata` instead, where nothing has to be negotiated.
 */
export function emitAgentCardExtension(
  declaration: LcpCapabilityDeclaration,
  options?: AgentCardExtensionOptions,
): AgentCardExtension {
  const opts = optionsRecord(options);
  const params = normalizeCapabilityDeclaration(declaration);
  const required = asRequired(get(opts, "required"));
  const description = asDescription(get(opts, "description"));
  // Proto field order (uri 1, description 2, required 3, params 4), and `required` is emitted even when
  // false: `true` must be a documented choice, and a card that states the
  // value leaves no room to read the omission as an oversight.
  return description === undefined
    ? { uri: A2A_LCP_EXTENSION_URI, required, params }
    : { uri: A2A_LCP_EXTENSION_URI, description, required, params };
}

/**
 * One declaration in a UCP profile's `capabilities` map.
 *
 * The host requires a `schema` and its origin MUST match the namespace authority; a `spec` is a MAY, and
 * its origin is explicitly NOT authority-bound (https, any host). Both are required on THIS type because
 * this deployment always emits both — that is our choice, not the host's rule, and an earlier docblock
 * stated it as the host's. `extends` is deliberately absent — see {@link emitUcpCapability}.
 */
export interface UcpCapabilityDeclaration {
  readonly version: string;
  readonly spec: string;
  readonly schema: string;
  readonly config: LcpCapabilityDeclaration;
}

/** A one-key fragment of a UCP profile's `capabilities` map, ready to spread into it. The value is an
 *  ARRAY: the host declares one entry per supported version. */
export type UcpCapabilityEntry = {
  readonly [capabilityName: string]: readonly UcpCapabilityDeclaration[];
};

/**
 * Build the UCP vendor-capability entry. Spread it into `ucp.capabilities` in `/.well-known/ucp`.
 *
 * **No `extends`, and that is a decision.** UCP's intersection algorithm removes "any capability where
 * extends is set but none of its parent capabilities are in the intersection", and repeats until stable — so
 * an extension of `dev.ucp.shopping.checkout` would vanish from the negotiated set precisely when checkout
 * was not negotiated. This capability states a requirement rather than augmenting a vertical, so it is a
 * root capability with no parent to be orphaned from.
 *
 * **UCP has no `required` flag, and we do not invent one.** Capabilities activate only inside the negotiated
 * intersection; a capability the counterparty does not declare is silently pruned, never loudly refused.
 * A2A's `required` has no UCP analogue, so the same declaration is advisory here and can be mandatory there
 * — the host decides, not us.
 */
export function emitUcpCapability(
  declaration: LcpCapabilityDeclaration,
): UcpCapabilityEntry {
  return {
    [LCP_CAPABILITY_NAME]: [
      {
        version: LCP_CAPABILITY_VERSION,
        spec: LCP_CAPABILITY_SPEC_URL,
        schema: LCP_CAPABILITY_SCHEMA_URL,
        config: normalizeCapabilityDeclaration(declaration),
      },
    ],
  };
}

/** What an A2A Agent Card told us. `required` is A2A's, not LCP's: it says the counterparty will refuse an
 *  agent that cannot comply, which is the actionable half of reading a card at all. */
export interface A2aCapabilityRequirement {
  readonly description?: string;
  readonly required: boolean;
  readonly declaration: LcpCapabilityDeclaration;
}

/**
 * Read an LCP requirement out of an A2A Agent Card, or `null` if the card declares none.
 *
 * **A2A offers no authority binding, and this reader cannot supply one.** Extension URIs are identifiers —
 * "These URIs are identifiers, HTTP access is not expected" — so matching ours proves only that the card's
 * author typed our URI. Nothing in A2A ties the URI to the party that defined it. Contrast
 * {@link readUcpProfile}, where the host requires the check and this module performs it.
 */
export function readAgentCard(card: unknown): A2aCapabilityRequirement | null {
  if (!isRecord(card))
    throw new CapabilityError(
      "capability/document-not-an-object",
      "an A2A Agent Card is a JSON object",
    );
  // `AgentCard.capabilities` carries `field_behavior = REQUIRED` (a2a.proto 380), so its absence is a
  // malformed card rather than an agent with no extensions. `extensions` is `repeated` (a2a.proto 418) and
  // proto3 JSON omits an empty repeated field, so an absent `extensions` IS a conformant "none".
  const capabilities = get(card, "capabilities");
  if (!isRecord(capabilities))
    throw new CapabilityError(
      "capability/a2a-capabilities-missing",
      "the Agent Card has no capabilities object, which the host marks REQUIRED",
    );
  const extensions = get(capabilities, "extensions");
  if (extensions === undefined) return null;
  if (!Array.isArray(extensions))
    throw new CapabilityError(
      "capability/a2a-extensions-not-an-array",
      "capabilities.extensions must be an array",
    );
  let found: Record<string, unknown> | undefined;
  for (const entry of extensions) {
    if (!isRecord(entry))
      throw new CapabilityError(
        "capability/a2a-extension-not-an-object",
        "every capabilities.extensions entry must be an object",
      );
    if (get(entry, "uri") !== A2A_LCP_EXTENSION_URI) continue;
    // Two entries under one URI leave no way to tell which requirement governs, and taking either one hands
    // the choice to whoever controlled the array order.
    if (found !== undefined)
      throw new CapabilityError(
        "capability/a2a-duplicate-extension",
        `two capabilities.extensions entries declare ${A2A_LCP_EXTENSION_URI}`,
      );
    found = entry;
  }
  if (found === undefined) return null;
  const params = get(found, "params");
  if (params === undefined)
    throw new CapabilityError(
      "capability/params-missing",
      "the LCP Agent Card extension carries no params, so it states no requirement",
    );
  const declaration = normalizeCapabilityDeclaration(params);
  const required = readRequired(get(found, "required"));
  const description = readDescription(get(found, "description"));
  return description === undefined
    ? { required, declaration }
    : { description, required, declaration };
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * UCP's `spec` rule, which is a SCHEME rule on the VALUE and not an authority binding — and not a demand
 * that the member be present at all. The host's MUST governs what a declared URL looks like: "it MUST be
 * `https` but MAY be served from any host". Declaring one is a MAY: "Each entity MAY also declare a `spec`
 * URL (human-readable documentation)", and `capability.json` carries the same split — `business_schema` is
 * allOf [base, {required: ["schema"]}] while `platform_schema` is allOf [base, {required: ["spec",
 * "schema"]}].
 *
 * So this helper answers only the question it is given a value for. **A reader of a PLATFORM declaration
 * owes its own presence check**: absence is conformant in the business document that
 * {@link readUcpProfile} reads, and refusing it here would refuse a conformant counterparty.
 *
 * `undefined` is the member's absence; every other value, `null` included, is a declared URL held to the
 * scheme. Enforced because a spec document fetched over http is rewritable in transit — the same reasoning
 * `placement-ucp` applies to the `links[]` terms URL. NOT enforced as an origin match, because the host
 * says the opposite in the same paragraph.
 */
function requireHttpsIfDeclared(value: unknown, field: string): void {
  if (value === undefined) return;
  const origin = typeof value === "string" ? originOf(value) : null;
  if (origin === null || !origin.startsWith("https://"))
    throw new CapabilityError(
      "capability/spec-not-https",
      `${field} must be an absolute https URL; UCP permits any host but requires the scheme`,
    );
}

/**
 * UCP's authority binding, enforced. Verbatim at HEAD 2026-08-11: "a declared `schema` URL's origin MUST
 * match the namespace authority in its name", and a platform "MUST validate each business-declared `schema`
 * URL before fetching it". `com.integraledger.*` is documented at `integraledger.com`, so anything else
 * under our capability name is a claim on our namespace by a party that does not hold it.
 *
 * The binding is on `schema` ONLY — see {@link LCP_CAPABILITY_AUTHORITY_ORIGIN} for the host's own sentence
 * putting the `spec` URL outside the trust path, and for the invented quotation that once said otherwise.
 *
 * The scheme is part of an origin, so a plain-`http` URL at the right host fails too — a schema document
 * fetched over http is rewritable in transit, which is the same reasoning `placement-ucp` applies to the
 * `links[]` terms URL. The host requires `schema` of a business declaration, so an absent one is refused
 * here rather than passed through.
 */
function requireAuthorityOrigin(value: unknown, field: string): void {
  const origin = typeof value === "string" ? originOf(value) : null;
  if (origin !== LCP_CAPABILITY_AUTHORITY_ORIGIN)
    throw new CapabilityError(
      "capability/authority-binding-violated",
      `${field} must be an absolute URL whose origin is ${LCP_CAPABILITY_AUTHORITY_ORIGIN}, the authority for ${LCP_CAPABILITY_NAME}`,
    );
}

/**
 * Read an LCP requirement out of a UCP profile (`/.well-known/ucp`), or `null` if the profile declares none.
 *
 * **An unsupported version REFUSES rather than answering `null`, and that departs from what UCP's own
 * negotiation would do with it.** The intersection algorithm selects "the highest mutually-supported
 * version" and silently prunes what does not intersect, so a version mismatch simply means the capability
 * never activates. That is the right answer to "will this capability be live on the wire". It is the wrong
 * answer to the question a reader is asking — "does this counterparty require something of me" — because the
 * counterparty plainly does, in a dialect we cannot read. Pruning is about activation; this is about what we
 * are entitled to tell our caller.
 */
export function readUcpProfile(
  profile: unknown,
): LcpCapabilityDeclaration | null {
  if (!isRecord(profile))
    throw new CapabilityError(
      "capability/document-not-an-object",
      "a UCP profile is a JSON object",
    );
  // The `ucp` envelope holds `version`, `services`, `capabilities` and `payment_handlers`. A document
  // without it is not the profile the caller said it was, and answering "declares nothing" for a document
  // we failed to recognize is the unsafe silence.
  const envelope = get(profile, "ucp");
  if (!isRecord(envelope))
    throw new CapabilityError(
      "capability/ucp-envelope-missing",
      "the document has no ucp object, so it is not a UCP profile",
    );
  const capabilities = get(envelope, "capabilities");
  if (capabilities === undefined) return null;
  if (!isRecord(capabilities))
    throw new CapabilityError(
      "capability/ucp-capabilities-not-an-object",
      "ucp.capabilities must be a map of capability name to declarations",
    );
  const declared = get(capabilities, LCP_CAPABILITY_NAME);
  if (declared === undefined) return null;
  if (!Array.isArray(declared))
    throw new CapabilityError(
      "capability/ucp-declarations-not-an-array",
      `${LCP_CAPABILITY_NAME} must hold an array of declarations, one per supported version`,
    );
  if (declared.length === 0)
    throw new CapabilityError(
      "capability/ucp-declarations-empty",
      `${LCP_CAPABILITY_NAME} is declared with no declarations`,
    );
  let found: Record<string, unknown> | undefined;
  for (const entry of declared) {
    if (!isRecord(entry))
      throw new CapabilityError(
        "capability/ucp-declaration-not-an-object",
        "every capability declaration must be an object",
      );
    if (get(entry, "version") !== LCP_CAPABILITY_VERSION) continue;
    if (found !== undefined)
      throw new CapabilityError(
        "capability/ucp-duplicate-version",
        `two declarations of ${LCP_CAPABILITY_NAME} claim version ${LCP_CAPABILITY_VERSION}`,
      );
    found = entry;
  }
  if (found === undefined)
    throw new CapabilityError(
      "capability/version-unsupported",
      `${LCP_CAPABILITY_NAME} is declared, but at no version this build reads (${LCP_CAPABILITY_VERSION})`,
    );
  // Two URLs, two different host rules, and the difference is the host's — see each helper. This is the
  // BUSINESS document, so `schema` is the member the host requires of it and `spec` is a MAY.
  requireHttpsIfDeclared(get(found, "spec"), "spec");
  requireAuthorityOrigin(get(found, "schema"), "schema");
  const config = get(found, "config");
  if (config === undefined)
    throw new CapabilityError(
      "capability/config-missing",
      "the declaration carries no config, so it states no requirement",
    );
  return normalizeCapabilityDeclaration(config);
}
