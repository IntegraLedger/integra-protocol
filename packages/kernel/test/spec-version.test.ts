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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LCP_SPEC_VERSION } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";

const read = (path: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../${path}`, import.meta.url), {
      encoding: "utf8",
    }),
  );

describe("LCP_SPEC_VERSION is the single source of truth", () => {
  it("is a bare dotted numeric edition — no leading v, no range, no whitespace", () => {
    // It is stamped verbatim into an on-chain metadatum. A stray "v" prefix or whitespace would be written
    // to a chain, where it cannot be corrected.
    //
    // ⛔ THREE COMPONENTS WERE REQUIRED HERE UNTIL 2026-09-07, and the rule was wrong rather than strict.
    // It was written when this constant held Integra's internal `0.1.x` working series. The PUBLISHED
    // specification's header reads `Version: 1.0` — two components — so a three-component rule would have
    // forced this tree to invent a `1.0.0` the specification does not use, which is the same defect as the
    // internal number it replaced: a version no reader can go and check. What the rule is FOR is that the
    // value is safe to write on a chain and into text, and that is what it now says.
    expect(LCP_SPEC_VERSION).toMatch(/^\d+(?:\.\d+)+$/);
  });

  it("the shipped legal-context schema's $id and description carry it", () => {
    const schema = read("vectors/legal-context/schema.json") as Record<
      string,
      unknown
    >;
    const id = schema["$id"];
    expect(typeof id).toBe("string");
    // ⛔⛔ THE `$id` NO LONGER CARRIES THE VERSION, AND THAT IS THE FIX RATHER THAN A REGRESSION. It used
    // to be asserted as a PATH SEGMENT — `/${LCP_SPEC_VERSION}/` — which is how every discovery document
    // this library produced came to carry `…/schema/0.1.38/legal-context.json`, a URL that resolved to
    // nothing at any value the constant ever held (measured 404, 2026-09-07). The specification publishes
    // one canonical, UNVERSIONED id in `spec/legal-context.schema.json`, and it returns 200. An `$id` is an
    // identity; the edition belongs in the description, which is asserted below.
    expect(id as string).toBe(
      "https://legalcontextprotocol.org/schema/legal-context.schema.json",
    );

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

  it("no shipped source file spells the version out as a literal", () => {
    // The constant only helps while it stays the ONLY place the string appears. This catches a future
    // package that hardcodes it instead of importing — the exact way the original four copies came about.
    //
    // ⛔ THE SUBJECT SET IS DERIVED. It used to be a two-element array naming `discovery/src/schema.ts`
    // and `binding-cardano/src/constants.ts`, under a comment claiming it "catches a FUTURE package that
    // hardcodes the string" — which it could not, because a future package is by definition not in a list
    // written today. `binding-cardano/src/metadata.ts` already carried the literal twice, in docblocks
    // reading `e.g. "0.1.38"`, and this test could not see the file. A version spelled out in a comment
    // is a version literal: it is shipped in the tarball, a reader takes it for the current one, and
    // nothing updates it.
    //
    // One exemption, and it is the definition itself rather than a name on a list.
    const DEFINITION = "packages/kernel/src/spec-version.ts";
    const root = new URL("../../../", import.meta.url).pathname;
    const sources: string[] = [];
    const walk = (dir: string, rel: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, `${rel}/${name}`);
        else if (name.endsWith(".ts")) sources.push(`${rel}/${name}`);
      }
    };
    for (const pkg of readdirSync(join(root, "packages"))) {
      const src = join(root, "packages", pkg, "src");
      if (existsSync(src)) walk(src, `packages/${pkg}/src`);
    }
    // A walk that stops matching finds no offenders, which is the same colour as a clean tree.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).toContain(DEFINITION);

    // ⛔⛔ **THE MATCH IS CONTEXTUAL, AND IT HAD TO BECOME SO WHEN THE EDITION BECAME `1.0`.** A bare
    // `includes("\"" + version + "\"")` was sound while the constant held `0.1.38`, a string that appears
    // nowhere by accident. `"1.0"` does: `binding-core/src/placement.ts` names it in a docblock about
    // canonical ARRAY INDICES — `"01"`, `"1.0"`, `"-1"` are not indices — which is not a copy of the spec
    // version and never was. Exempting that file by name would be the list this test already refuses.
    //
    // ⇒ A line is an offender when it spells the version AND says what it is spelling. That is derived
    // from the line, so a future package hardcoding the version in a version-shaped sentence is caught,
    // and a future docblock mentioning `1.0` about something else is not.
    const NAMES_THE_SUBJECT = /\b(?:spec|specification|LCP|version|edition)\b/i;
    const offenders = sources.filter((path) => {
      if (path === DEFINITION) return false;
      const text = readFileSync(join(root, path), { encoding: "utf8" });
      return text
        .split("\n")
        .some(
          (line) =>
            line.includes(`"${LCP_SPEC_VERSION}"`) &&
            NAMES_THE_SUBJECT.test(line),
        );
    });
    expect(offenders).toEqual([]);
  });
});
