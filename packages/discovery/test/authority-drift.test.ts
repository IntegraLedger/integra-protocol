/**
 * A2 — THE DRIFT GUARD. The unit's centre of gravity.
 *
 * Serving a document that disagrees with emitted output is the same failure as serving the wrong document,
 * one level subtler: the URL resolves, the content is plausible, and it describes software we do not ship.
 * A 404 at least tells a reader nothing is there. A schema that accepts what we would refuse, or refuses
 * what we emit, tells them something false and they have no way to notice.
 *
 * So this asserts three things the authored documents must never stop being true of:
 *
 * 1. Every declaration `normalizeCapabilityDeclaration` ACCEPTS, the schema validates.
 * 2. Every declaration it REJECTS, the schema rejects — unknown key, level outside 1–4, empty array,
 *    blank entry. This direction is the one that rots quietly: a permissive schema still resolves.
 * 3. The `$id`s and paths equal the constants that advertise them, so the document a counterparty fetches
 *    is addressed the way the wire says it is.
 *
 * ⛔ Per finding 1.6 it must also refuse to pass over an EMPTY case set: a table-driven guard whose table
 * someone empties is a green test asserting nothing, which is the exact defect `check:wire` and
 * `mandate-boundary` were both caught by.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Validator } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";
import {
  type LcpCapabilityDeclaration,
  normalizeCapabilityDeclaration,
} from "../src/capability.js";
import {
  A2A_LCP_EXTENSION_URI,
  LCP_CAPABILITY_SCHEMA_URL,
  LCP_CAPABILITY_SPEC_URL,
} from "../src/capability-identity.js";

const AUTHORITY = new URL("../authority/", import.meta.url);

function document(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, AUTHORITY)), "utf8"),
  ) as Record<string, unknown>;
}

const ucpSchema = document("ucp/2026-07-30/legal-context.schema.json");
const x402Schema = document("x402/legal-context/v1.schema.json");

const ucp = new Validator(ucpSchema, "2020-12");

/** Does the ONE validator accept this? Its answer is the schema's obligation, in both directions. */
function normalizerAccepts(value: unknown): boolean {
  try {
    normalizeCapabilityDeclaration(value);
    return true;
  } catch {
    return false;
  }
}

// ── The addresses ───────────────────────────────────────────────────────────────────────────────────

describe("the documents are addressed the way the wire advertises them", () => {
  it("the UCP schema's $id equals LCP_CAPABILITY_SCHEMA_URL", () => {
    // UCP authority-binds THIS url: "a declared `schema` URL's origin MUST match the namespace authority in
    // its name". A document served at one address and claiming another is a document a validator cannot
    // trust, so the two are pinned equal rather than merely both correct.
    expect(ucpSchema["$id"]).toBe(LCP_CAPABILITY_SCHEMA_URL);
  });

  it("⭐ every advertised URL is under the namespace authority's own origin", () => {
    // `com.integraledger.*` is documented at integraledger.com. Anything else under our capability name is
    // a claim on our namespace by a party that does not hold it — and moving the SPEC or the A2A identifier
    // to another host would split one capability across two custodians even where no host binds it.
    for (const url of [
      LCP_CAPABILITY_SCHEMA_URL,
      LCP_CAPABILITY_SPEC_URL,
      A2A_LCP_EXTENSION_URI,
      String(x402Schema["$id"]),
    ])
      expect(new URL(url).origin).toBe("https://integraledger.com");
  });

  it("⭐ every advertised URL is https and lives under /lcp/", () => {
    // The scheme is part of an origin: a document fetched over http is rewritable in transit. The path
    // prefix is what the authority worker's zone route owns, so a document outside it would be served by
    // the site — which is the catch-all this whole unit exists to escape.
    for (const url of [
      LCP_CAPABILITY_SCHEMA_URL,
      LCP_CAPABILITY_SPEC_URL,
      A2A_LCP_EXTENSION_URI,
      String(x402Schema["$id"]),
    ]) {
      expect(url.startsWith("https://")).toBe(true);
      expect(new URL(url).pathname.startsWith("/lcp/")).toBe(true);
    }
  });
});

// ── The schema agrees with the ONE validator, in BOTH directions ─────────────────────────────────────

/** Declarations the normalizer accepts. The schema must validate every one. */
const ACCEPTED: readonly LcpCapabilityDeclaration[] = [
  { minimumLevel: 1 },
  { minimumLevel: 2 },
  { minimumLevel: 3 },
  { minimumLevel: 4 },
  { minimumLevel: 2, acceptedJurisdictions: ["US-DE"] },
  { minimumLevel: 3, acceptedDisputeMethods: ["aaa-icdr"] },
  {
    minimumLevel: 4,
    acceptedJurisdictions: ["US-DE", "GB"],
    acceptedDisputeMethods: ["aaa-icdr", "jams"],
  },
];

/** Declarations the normalizer REJECTS. The schema must reject every one — the direction that rots. */
const REJECTED: readonly { readonly why: string; readonly value: unknown }[] = [
  { why: "not an object", value: [] },
  { why: "minimumLevel missing", value: {} },
  { why: "minimumLevel below the range", value: { minimumLevel: 0 } },
  { why: "minimumLevel above the range", value: { minimumLevel: 5 } },
  { why: "minimumLevel as a string", value: { minimumLevel: "2" } },
  {
    why: "an unknown key, which is a requirement placed on the reader",
    value: { minimumLevel: 2, commitmentCap: "1000" },
  },
  {
    why: "an empty acceptedJurisdictions, which accepts nothing",
    value: { minimumLevel: 2, acceptedJurisdictions: [] },
  },
  {
    why: "an empty acceptedDisputeMethods",
    value: { minimumLevel: 2, acceptedDisputeMethods: [] },
  },
  {
    why: "a blank jurisdiction entry",
    value: { minimumLevel: 2, acceptedJurisdictions: ["  "] },
  },
  {
    why: "a non-string jurisdiction entry",
    value: { minimumLevel: 2, acceptedJurisdictions: [7] },
  },
];

describe("the served schema agrees with the ONE validator", () => {
  it("refuses to pass over an empty case set", () => {
    // A table-driven guard whose table someone empties is a green test asserting nothing. Two gates in this
    // programme were caught exactly that way, so the count is asserted rather than assumed.
    expect(ACCEPTED.length).toBeGreaterThan(6);
    expect(REJECTED.length).toBeGreaterThan(8);
  });

  it.each(ACCEPTED.map((d) => [JSON.stringify(d), d] as const))(
    "accepts %s, and so does the normalizer",
    (_label, declaration) => {
      expect(normalizerAccepts(declaration)).toBe(true);
      expect(ucp.validate(declaration).valid).toBe(true);
    },
  );

  it.each(REJECTED.map((c) => [c.why, c.value] as const))(
    "⭐ rejects %s, and so does the normalizer",
    (_why, value) => {
      expect(normalizerAccepts(value)).toBe(false);
      expect(ucp.validate(value).valid).toBe(false);
    },
  );
});

// ── The x402 document describes what the seller surface actually emits ───────────────────────────────

describe("the x402 schema describes both info shapes", () => {
  const ATR = `0x${"ab".repeat(32)}`;
  const URL_ = "https://seller.example/terms/atr.md";
  const challenge = new Validator(x402Schema, "2020-12");

  it("validates the CHALLENGE-time info the middleware builds", () => {
    expect(
      challenge.validate({ type: "sha256", value: ATR, legalContextUrl: URL_ })
        .valid,
    ).toBe(true);
  });

  it("⭐ REFUSES the receipt shape at the root — they are two definitions on purpose", () => {
    // The whole reason the document carries `$defs/receipt` separately: one pointer cannot define both
    // shapes, so a root that also accepted the receipt would ship a `schema` that misdescribes its own
    // `info` on whichever block shared it.
    expect(
      challenge.validate({
        type: "sha256",
        value: ATR,
        legalContextUrl: URL_,
        phase: "settlement",
        signatureCoverage: "none",
        weldCarrier: "eip3009.nonce",
      }).valid,
    ).toBe(false);
  });

  it("validates the SETTLEMENT-time info through $defs/receipt", () => {
    // Referenced rather than spliced: `$defs/receipt` refers to `#/$defs/atrHash`, so it only resolves
    // against the real document's base URI. Copying the subschema out and re-rooting it would validate a
    // different document from the one served, which is the failure this whole file exists to catch.
    const receipt = new Validator(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: String(x402Schema["$id"]),
        $ref: "#/$defs/receipt",
        $defs: x402Schema["$defs"],
      },
      "2020-12",
    );
    expect(
      receipt.validate({
        type: "sha256",
        value: ATR,
        legalContextUrl: URL_,
        phase: "settlement",
        signatureCoverage: "none",
        weldCarrier: "eip3009.nonce",
      }).valid,
    ).toBe(true);
    // The three fields exist to stop it being mistaken for a binding artifact, so none of them is optional.
    expect(
      receipt.validate({ type: "sha256", value: ATR, legalContextUrl: URL_ })
        .valid,
    ).toBe(false);
  });
});

// ── What the documents must never say ────────────────────────────────────────────────────────────────

describe("what the documents must never state", () => {
  const sources = [JSON.stringify(ucpSchema), JSON.stringify(x402Schema)].join(
    "\n",
  );

  it("⛔ never publishes a commitment cap or a signing threshold", () => {
    // Two of LCP §4.2's eight policy primitives must never be published in any version: they put the value
    // above which a human reviews on the wire and hand a counterparty the exact number to stay under, which
    // is the §12.7 attack surface the standard spends a section closing.
    expect(sources).not.toMatch(/commitmentCap|signingThreshold/i);
  });

  it("⛔ never says DTR — the published name is ATR", () => {
    expect(sources).not.toMatch(/\bDTR\b/);
  });

  it("⛔ asserts nothing about whether an agreement is lawful or enforceable", () => {
    // This is a technology harness and never a legal judgment. The documents say so; they must not also
    // quietly claim the opposite somewhere else.
    expect(sources).not.toMatch(
      /legally binding|is enforceable|constitutes a contract/i,
    );
    expect(sources).toMatch(
      /never a legal judgment|asserts nothing about whether/i,
    );
  });
});
