// The `legal-context.json` discovery document (LCP §2.1–2.8).
// A Zod v4 loose-object schema is the single trust-boundary
// validator; unrecognized fields are preserved (LCP §2.5 extensibility), and only the SHAPE of recognized
// fields is gated (non-HTTPS/whitespace `terms`, malformed `atrHash`, wrong types). The Zod schema is
// kept module-internal and `LegalContextJson` is hand-written: Zod's schema types blow the
// isolatedDeclarations serialization limit (same as viem), so no Zod type reaches the public API.
import { LCP_SPEC_VERSION } from "@integraledger/lcp-kernel";
import { z } from "zod";

/** The `format` a listing may declare for its terms document. Five values, and the split that matters is
 *  not this list but which of them a machine can read — see {@link MACHINE_READABLE_TERMS_FORMATS}. */
export type TermsFormat = "markdown" | "json" | "plain" | "html" | "pdf";
/** Every {@link TermsFormat}, for iteration and validation. */
export const KNOWN_TERMS_FORMATS: readonly TermsFormat[] = [
  "markdown",
  "json",
  "plain",
  "html",
  "pdf",
];
/** The three formats an agent can actually parse. `html` and `pdf` are excluded deliberately: a document
 *  a machine cannot read still HASHES fine, so the integrity check and this list answer different
 *  questions and a listing can pass one while failing the other. */
export const MACHINE_READABLE_TERMS_FORMATS: readonly TermsFormat[] = [
  "markdown",
  "json",
  "plain",
];

// End-anchored + whitespace-free: `terms` MUST be an absolute HTTPS URL an agent will fetch (LCP §2.4);
// embedded whitespace / a trailing second URL is a request-splitting / SSRF-adjacent hazard.
//
// LOWERCASE-ONLY, deliberately — `HTTPS://…` is REFUSED. RFC 3986 §3.1 makes schemes case-insensitive
// and directs normalization to lowercase, so this is stricter than the URL grammar on purpose: intake is
// a trust boundary and this document is what an atrHash gets computed against downstream. Accepting
// several spellings of one URL means the same terms document can arrive under names that compare
// unequal, and the fix for that is a normalize-then-accept step — a fallback path, which is exactly what
// this codebase refuses to grow. Every publisher can emit the canonical spelling; nobody is locked out.
// Contrast `atrHash` below, which is accepted case-INSENSITIVELY on the read side and
// no normalization is needed to compare two hashes. The two decisions are independent and both are meant.
const HTTPS_URL_PATTERN = "^https://[^\\s]+$";
/**
 * The single location LCP §2.1 fixes normatively for the discovery document.
 *
 * Exported because it is a wire constant a publisher must get exactly right, and this package already
 * exports another protocol's header (`A2A_EXTENSION_ACTIVATION_HEADER`) while leaving LCP's own path to be
 * retyped from prose. A typo here does not fail loudly — it serves a 404 that reads as "this seller
 * publishes no terms", which is the same observable as a seller who genuinely does not.
 */
export const LEGAL_CONTEXT_WELL_KNOWN_PATH = "/.well-known/legal-context.json";

// `atrHash`: 0x + 64 hex, accepted case-INSENSITIVELY. LCP v0.1.38 §2.5 RECOMMENDS emitting lowercase and
// `emit()` does, but that constrains what WE write: a counterparty's document is theirs, and refusing an
// uppercase spelling of a well-formed hash would reject a conformant peer over a presentation choice.
const ATR_HASH_PATTERN = "^0x[0-9a-fA-F]{64}$";
const CLAUSE_ID_PATTERN = "^sha256:0x[0-9a-fA-F]{64}$";

// A field that IS the claim may be absent, but it may not be blank. `""` validates as a string while
// carrying no election, and a §4.2 policy engine testing presence of `disputeResolution.method` reads it
// as present — the strictly worse outcome, because an absent field at least reads as absent. This is the
// discipline `verify/src/steps.ts` already applies to the elections themselves ("an empty election is not
// an election"); LCP §2.5 imposes no non-blank rule, so this is the tree being consistent with itself
// rather than a conformance requirement. Whitespace counts as blank for the same reason.
const nonBlank = z.string().refine((v) => v.trim().length > 0, {
  message: "must not be blank — omit the field instead of stating it empty",
});

const DisputeResolutionSchema = z.looseObject({
  method: nonBlank.optional(),
  jurisdiction: nonBlank.optional(),
  contact: nonBlank.optional(),
  clauseId: z.string().regex(new RegExp(CLAUSE_ID_PATTERN)).optional(),
  source: nonBlank.optional(),
  catalog: nonBlank.optional(),
});
const ContactSchema = z.looseObject({
  legal: nonBlank.optional(),
  technical: nonBlank.optional(),
});

// Module-internal (never exported — keeps Zod types out of the .d.ts under isolatedDeclarations).
const legalContextSchema = z
  .looseObject({
    terms: z.string().regex(new RegExp(HTTPS_URL_PATTERN)),
    termsFormat: z.string().optional(),
    atrHash: z.string().regex(new RegExp(ATR_HASH_PATTERN)).optional(),
    acceptanceRequired: z.boolean().optional(),
    disputeResolution: DisputeResolutionSchema.optional(),
    returns: z.string().optional(),
    contact: ContactSchema.optional(),
    api: z.string().optional(),
  })
  .meta({
    title: "legal-context.json",
    description: `LCP discovery document served at /.well-known/legal-context.json (spec v${LCP_SPEC_VERSION} LCP §2.4–2.5).`,
  });

/**
 * A validated `legal-context.json` document (LCP §2.4–2.5). Hand-written to match `legalContextSchema`
 * (the runtime validator); the index signature reflects the loose schema (unrecognized fields preserved).
 * Only `terms` is required — every other field gates a higher trust level (LCP §3).
 */
export type LegalContextJson = {
  terms: string;
  termsFormat?: string;
  atrHash?: string;
  acceptanceRequired?: boolean;
  disputeResolution?: Record<string, unknown>;
  returns?: string;
  contact?: Record<string, unknown>;
  api?: string;
  [k: string]: unknown;
};

/** Parse + validate (fail-fast: throws ZodError on the first violation). Unrecognized fields preserved. */
export function parseLegalContextJson(value: unknown): LegalContextJson {
  return legalContextSchema.parse(value) as LegalContextJson;
}

/** Non-throwing predicate: is `value` a valid discovery document? */
export function isLegalContextJson(value: unknown): value is LegalContextJson {
  return legalContextSchema.safeParse(value).success;
}

/** Is `format` one of the LCP §2.5 known `termsFormat` tokens? */
export function isKnownTermsFormat(format: string): format is TermsFormat {
  return (KNOWN_TERMS_FORMATS as readonly string[]).includes(format);
}
/** Is `format` a machine-readable text token (markdown/json/plain) suitable for agent-facing terms? */
export function isMachineReadableTermsFormat(
  format: string,
): format is TermsFormat {
  return (MACHINE_READABLE_TERMS_FORMATS as readonly string[]).includes(format);
}

/** The canonical language-neutral JSON Schema (draft 2020-12), generated from the Zod schema. */
export const LEGAL_CONTEXT_JSON_SCHEMA: Readonly<Record<string, unknown>> =
  Object.freeze({
    $id: `https://legalcontextprotocol.org/schema/${LCP_SPEC_VERSION}/legal-context.json`,
    ...(z.toJSONSchema(legalContextSchema, {
      target: "draft-2020-12",
    }) as Record<string, unknown>),
  });
