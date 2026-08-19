import { readFileSync } from "node:fs";
import { LEGAL_CONTEXT_SCHEMA } from "@integraledger/lcp-placement-x402";
import { describe, expect, it } from "vitest";

/**
 * THE DRIFT GATE integra-protocol#8 proved was missing.
 *
 * Two published artifacts define the x402 `legalContext.info` shape: the schema `placement-x402` INLINES
 * onto the wire of every challenge (x402 makes `schema` a required member, and Bazaar forbids an external
 * `$ref`, so it cannot point at the authority document), and the AUTHORITY document `lcp-discovery` ships
 * and integraledger.com serves. From 0.10.1 until this gate existed the two disagreed — `required:
 * ["type","value"]` on the wire, `required: ["type","value","legalContextUrl"]` at the authority, both
 * `additionalProperties: false` — so NO info document validated against both, each package's own tests
 * passed against the schema it carried, and the break surfaced at a third party's buyer. Self-consistent
 * halves are exactly what a per-package test cannot catch; only comparing the two can, and this file is
 * where the two meet: conformance depends on both packages, while neither may depend on the other.
 *
 * The contract is DERIVABILITY, not resemblance: the wire literal must equal the authority document minus
 * `$id` (an absolute URL Bazaar's same-document rule forbids on the wire) and minus `$defs` (the
 * RECEIPT-time definition, which is not this challenge-time `info` and would bloat every 402). Deep
 * equality, so a drift in a description string fails too — the description travels on the wire and is
 * part of what a counterparty reads.
 */
describe("the inlined x402 wire schema is the authority document, minus $id and $defs", () => {
  const authority = JSON.parse(
    readFileSync(
      new URL(
        "../../discovery/authority/x402/legal-context/v1.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;

  it("derives member for member", () => {
    const { $id, $defs, ...wire } = authority;
    expect(JSON.parse(JSON.stringify(LEGAL_CONTEXT_SCHEMA))).toEqual(wire);
  });

  it("the members removed are exactly the two the wire may not carry", () => {
    // If the authority document grows a third top-level member the wire copy must either carry it or this
    // gate must consciously widen — silently dropping a new member is how the next drift starts.
    expect(Object.keys(authority).sort()).toEqual(
      [...Object.keys(LEGAL_CONTEXT_SCHEMA), "$id", "$defs"].sort(),
    );
  });

  it("both definitions REQUIRE the locator — the half that was wrong, pinned at the meeting point", () => {
    expect((authority["required"] as string[]).sort()).toEqual([
      "legalContextUrl",
      "type",
      "value",
    ]);
  });
});
