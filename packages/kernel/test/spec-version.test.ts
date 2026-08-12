/**
 * THE DRIFT GATE for `LCP_SPEC_VERSION`.
 *
 * The constant exists because the spec version was four independent literals that drifted apart. Two of
 * those four are DATA — `vectors/legal-context/schema.json` and `vectors/binding/cardano-metadatum.json`
 * are JSON, so they cannot import the constant and nothing but a test can hold them to it. Without this
 * file the constant would fix the two TypeScript copies and quietly leave the same defect in the two data
 * copies, which are the ones that ship inside `@integraledger/lcp-conformance` and are read by independent
 * implementers.
 *
 * These assertions are deliberately about EQUALITY WITH THE CONSTANT rather than about the string
 * a literal. Pinning one would make every assertion here a second place to edit on the next bump —
 * which is the failure being closed, reintroduced in the gate meant to close it.
 */
import { readFileSync } from "node:fs";
import { LCP_SPEC_VERSION } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";

const read = (path: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../${path}`, import.meta.url), {
      encoding: "utf8",
    }),
  );

describe("LCP_SPEC_VERSION is the single source of truth", () => {
  it("is a bare MAJOR.MINOR.PATCH string — no leading v, no range", () => {
    // It is stamped verbatim into an on-chain metadatum and into a URL path segment. A stray "v" prefix or
    // whitespace would be written to a chain, where it cannot be corrected.
    expect(LCP_SPEC_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("the shipped legal-context schema's $id and description carry it", () => {
    const schema = read("vectors/legal-context/schema.json") as Record<
      string,
      unknown
    >;
    const id = schema["$id"];
    expect(typeof id).toBe("string");
    // The version is a PATH SEGMENT — asserted with slashes so a version appearing anywhere else in the
    // URL (a host, a query) cannot satisfy this.
    expect(id as string).toContain(`/${LCP_SPEC_VERSION}/`);

    // The DESCRIPTION carries the version too, and until 2026-08-08 nothing gated it: a bump could leave
    // this string on the old revision with the suite green. This test was already NAMED as though it
    // covered a second site — it named a `$comment` that does not exist in this file, while the real
    // second copy sat one key away, unasserted.
    const description = schema["description"];
    expect(typeof description).toBe("string");
    expect(description as string).toContain(`v${LCP_SPEC_VERSION}`);
  });

  it("every cardano metadatum `v` pin is the constant, unless the case NAMES its own version", () => {
    // These are fixtures of the on-chain stamp, shipped to other implementers inside
    // `@integraledger/lcp-conformance`. A pin left behind would certify a metadatum the binding no longer
    // produces.
    //
    // One case deliberately pins a DIFFERENT version — `v` is a parameter, not a constant, and something
    // has to prove the encoder round-trips an arbitrary string. That case declares it in its own name
    // (`… v=0.0.0-test`), and this gate keys off that declaration rather than hardcoding the exception:
    // an arbitrary version is allowed exactly when the vector says out loud that it is deliberate. A pin
    // that quietly falls behind announces nothing, and fails here.
    const doc = read("vectors/binding/cardano-metadatum.json") as {
      cases?: { name?: unknown; v?: unknown }[];
    };
    const cases = doc.cases ?? [];
    expect(cases.length).toBeGreaterThan(0);

    const pins = cases
      .map((c) => ({ name: String(c.name ?? ""), v: c.v }))
      .filter((c): c is { name: string; v: string } => typeof c.v === "string");
    // Guards the whole assertion against a rename of `input.v` silently emptying it.
    expect(pins.length).toBeGreaterThan(0);

    const undeclared = pins.filter(
      (p) => p.v !== LCP_SPEC_VERSION && !p.name.includes(`v=${p.v}`),
    );
    expect(undeclared).toEqual([]);
    // …and at least one case really does exercise the current version, so a corpus of nothing but
    // self-declared oddities cannot satisfy the rule above.
    expect(pins.some((p) => p.v === LCP_SPEC_VERSION)).toBe(true);
  });

  it("no source file re-declares the version as its own literal", () => {
    // The constant only helps while it stays the ONLY definition. This catches a future package that
    // hardcodes the string instead of importing — the exact way the original four copies came about.
    // `binding-cardano/src/constants.ts` re-EXPORTS it, which is a reference and not a redeclaration.
    const offenders = [
      "packages/discovery/src/schema.ts",
      "packages/binding-cardano/src/constants.ts",
    ].filter((path) =>
      readFileSync(new URL(`../../../${path}`, import.meta.url), {
        encoding: "utf8",
      }).includes(`"${LCP_SPEC_VERSION}"`),
    );
    expect(offenders).toEqual([]);
  });
});
