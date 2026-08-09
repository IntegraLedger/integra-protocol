import { type LegalContextJson, parseLegalContextJson } from "./schema.js";

/**
 * Build a `/.well-known/legal-context.json` discovery document from a profile: drop undefined fields
 * (so an absent optional never serializes as `null`) and validate the result (fail-fast on a malformed
 * profile). An authoring helper; the trust-boundary intake is parse/isLegalContextJson.
 */
export function emit(profile: LegalContextJson): LegalContextJson {
  const doc: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(profile)) if (v !== undefined) doc[k] = v;
  // LCP v0.1.38 §2.5 RECOMMENDS emitting an atrHash lowercase, so a served document has exactly one
  // spelling however the profile was authored. EMISSION only, and only this field: `terms` is a URL whose
  // path and query are case-sensitive, and every other member here is prose or an identifier the author
  // chose. The intake side (`parseLegalContextJson`) still accepts either case, because §2.5 constrains
  // what an implementation writes and a counterparty's document is theirs.
  if (typeof doc["atrHash"] === "string")
    doc["atrHash"] = doc["atrHash"].toLowerCase();
  return parseLegalContextJson(doc);
}
