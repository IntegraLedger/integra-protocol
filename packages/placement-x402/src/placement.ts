import {
  CarrierError,
  encodeForField,
  type LegalContextRef,
  makePlacement,
  type Outcome,
  type ReferencePlacementAdapter,
} from "@integraledger/lcp-binding-core";
import { LEGAL_CONTEXT_SCHEMA, X402_PLACEMENT } from "./manifest.js";

const base = makePlacement(X402_PLACEMENT);

/** Refusals namespaced from the protocol id, exactly as the kit does — so `x402/document-malformed` means the
 *  same thing whether it came from the override or from the generic read path. */
function refuse(code: string, detail: string): Outcome<never> {
  return {
    refused: true,
    haltClass: "verification-failure",
    code: `x402/${code}`,
    detail,
  };
}

/**
 * The x402 reference placement — the kit's `extract`, and the ONE `place` in the set that the kit cannot
 * supply.
 *
 * x402's slot does not hold the reference directly: it holds `{ info, schema }`, where `info` is the §8.1
 * reference object and `schema` is a `$ref` pointing at the carrier schema. That is a WRAPPER, and no
 * container kind models it. Inventing an `x402-extension` container kind would put one protocol's name inside
 * a generic enum — the abstraction leaking — so the write half is overridden here, in this package, where it
 * is reviewed like any other code. `extract` is the kit's unchanged: reading `extensions.legalContext.info` is
 * an ordinary object-path read, and the bare-hash alias at `accepts.0.extra.atrHash` is handled by its own
 * declared encoding (S2/S6). One overridden member is composition; a second would mean this package had
 * stopped using the kit, and the test suite says so.
 */
export const x402Placement: ReferencePlacementAdapter = {
  ...base,

  place(ref: LegalContextRef, doc: unknown): Outcome<unknown> {
    if (!X402_PLACEMENT.carrierTypes.includes(ref.type))
      return refuse(
        "carrier-type-not-permitted",
        `${X402_PLACEMENT.field} permits ${X402_PLACEMENT.carrierTypes.join("/")}, got ${ref.type}`,
      );
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
      return refuse(
        "document-malformed",
        "an x402 challenge is a non-null object",
      );

    // Rendered through the codec, never by interpolation — a value that does not meet its type's rule refuses
    // here instead of putting an extension on the wire that a buyer's parser would reject.
    let encoded: unknown;
    try {
      encoded = encodeForField(ref, X402_PLACEMENT.encoding);
    } catch (e) {
      if (!(e instanceof CarrierError)) throw e; // never swallow a non-carrier bug
      return refuse(
        "reference-malformed",
        `not a valid carrier value for its type: ${ref.value}`,
      );
    }

    // OWN PROPERTY ONLY. `place`'s document is exactly as attacker-influenced as `extract`'s, so a challenge
    // with ZERO own properties must not walk into its prototype's `extensions` and put those entries on the
    // wire — `extract` reports that document as `reference-absent`, and the two halves have to agree about
    // what is present. binding-core's own writer states the rule and proves it for the generic path; the
    // override is the one write path that has to restate it. The DECLARED view rather than a
    // `Record<string, unknown>` is deliberate: reading `extensions` off an index signature is TS4111, and the
    // bracket form biome would then ask for is the fix it classes as unsafe. The document is still spread
    // wholesale below, so nothing is narrowed away.
    const ext = Object.hasOwn(doc, "extensions")
      ? (doc as { readonly extensions?: unknown }).extensions
      : undefined;

    // Sibling extensions are PRESERVED: the live x402 v2 spec states a client "must include at least the info
    // received; it may append additional info but cannot delete or overwrite existing info". That is the host
    // protocol's rule about its own map, and a placement that pruned a sibling would make the client
    // using it non-conformant.
    //
    // An `extensions` that is PRESENT but cannot be merged into REFUSES, and that is binding-core's ratified
    // malformed-container rule read against the manifest this package PUBLISHES rather than against the
    // granularity the override happens to write at: `field` is `extensions.legalContext.info`, so `legalContext`
    // is the field's direct holder and `extensions` sits one level ABOVE it — replaced at the holder, refused
    // above it, because replacing an intermediate discards everything beneath it. A stranger holding only the
    // manifest and the kit computes that refusal for the same document, and an override that emitted a
    // challenge instead would make the manifest a description rather than an artifact. ABSENT is still
    // created; our own entry, being the direct holder, is still replaced.
    const siblings =
      ext === undefined
        ? {}
        : typeof ext === "object" && ext !== null && !Array.isArray(ext)
          ? (ext as Record<string, unknown>)
          : undefined;
    if (siblings === undefined)
      return refuse(
        "document-malformed",
        `extensions is present and is not a map, so ${X402_PLACEMENT.field} has no holder to write into: ${JSON.stringify(ext)}`,
      );

    return {
      ok: true,
      value: {
        ...(doc as object),
        extensions: {
          ...siblings,
          legalContext: {
            info: encoded,
            schema: LEGAL_CONTEXT_SCHEMA,
          },
        },
      },
    };
  },
};
