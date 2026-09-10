/**
 * ⛔⛔ SHIPPED PROSE CITES THE PUBLISHED SPECIFICATION, AND NEVER AN INTERNAL REVISION.
 *
 * ★ WHAT THIS FILE USED TO ENFORCE, AND WHY THE RULE CHANGED. Until 2026-09-07 the rule was that a file
 * may cite an older LCP revision only if it ALSO cites the current one — a contrast is a fact worth
 * shipping, a lone stale stamp is a claim that has quietly expired. That rule was right for its regime,
 * where `LCP_SPEC_VERSION` held Integra's internal `0.1.3x` working series and "current" was another
 * number in the same series.
 *
 * ⛔ **The regime was itself the defect.** Those revisions — `v1.36`, `v1.37`, `v1.38` — are Integra's
 * internal drafts. They are not published anywhere a reader of this package can reach, so a citation of one
 * is not a stale stamp to be paired with a fresh one: it is a reference that CANNOT BE FOLLOWED, shipped
 * inside an npm tarball, and it also discloses the existence and numbering of an unpublished document.
 * 269 of them were in this tree, 57 in code that ships.
 *
 * ★ THE RULE NOW. Shipped prose may cite `LCP §N` — the section numbering is stable and the published
 * specification carries it — and may not spell an internal revision at all. The published edition is
 * `LCP_SPEC_VERSION`, it is what a counterparty can go and read, and it belongs in at most the one place
 * that defines it.
 *
 * ⚠️ **WHAT THIS CANNOT CATCH, said plainly.** It does not know whether a citation is ACCURATE — nothing
 * mechanical does, and §C.1 is the live example: the published text states a sufficiency claim this
 * implementation deliberately does not rely on (see `binding-evm-mpp/src/id-reuse.ts`, which records the
 * disagreement rather than resolving it silently). What this guarantees is narrower and worth having: no
 * shipped sentence points a reader at a document that does not exist for them.
 */
import { join } from "node:path";
import { LCP_SPEC_VERSION } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import { type Prose, packageProse, vectorProse } from "./shipped-prose.js";

const PACKAGES = new URL("../../", import.meta.url).pathname;

/**
 * An INTERNAL LCP revision spelled in prose: `v1.37`, `v0.1.38`, `v1.36`.
 *
 * ⛔ The TWO-digit patch is the discriminator and it is load-bearing. `v1.0` appears in shipped source for
 * W3C Bitstring Status List, in three `authority` files, and — since 2026-09-07 — is also the PUBLISHED
 * LCP edition. A looser pattern would read both as internal revisions and refuse them. Integra's internal
 * series has always been `1.3x`, so two digits separates it from every other `vN.N` in the tree.
 */
const ANY_REVISION = /v(?:0\.)?1\.\d{2}\b/g;

/**
 * Every surface npm packs whose prose is ours — packages AND the vector tree. `vectors/` ships inside
 * `lcp-conformance` and carried fifteen superseded citations while this gate reported clean.
 */
function shippedProse(): Prose[] {
  return [
    ...packageProse(PACKAGES),
    ...vectorProse(join(PACKAGES, "..", "vectors")),
  ];
}

describe("shipped prose cites the published specification, never an internal revision", () => {
  const prose = shippedProse();

  it("walks a plausible surface", () => {
    // The blind-gate canary. A walker that finds nothing reports clean forever.
    expect(prose.length).toBeGreaterThan(110);
    expect(
      prose.filter((p) => p.where.startsWith("vectors/")).length,
    ).toBeGreaterThan(300);
    expect(LCP_SPEC_VERSION).toMatch(/^\d+(?:\.\d+)+$/);
  });

  it("⛔ no shipped file spells an internal LCP revision", () => {
    const offenders: string[] = [];
    for (const { where: file, text } of prose) {
      const cited = [
        ...new Set([...text.matchAll(ANY_REVISION)].map((m) => m[0] as string)),
      ].sort();
      if (cited.length > 0)
        offenders.push(`${file} — cites ${cited.join(", ")}`);
    }
    // If this fails: cite `LCP §N` instead. The section numbering is stable across revisions and the
    // published specification carries it, so the section is what a reader can actually follow. If the
    // sentence genuinely depends on what an internal draft said and the published text says otherwise, say
    // so about the PUBLISHED text — as `binding-evm-mpp/src/id-reuse.ts` does — rather than quoting a
    // document the reader cannot open.
    expect(offenders.sort()).toEqual([]);
  });
});
