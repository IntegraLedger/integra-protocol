/**
 * A SUPERSEDED SPEC VERSION IS CITED AS HISTORY OR NOT AT ALL.
 *
 * Shipped prose cites LCP by revision — "reconciled against LCP v1.37 §C.4", "v1.37 §C.2 forbids". Those
 * sentences are true when written and become misleading the moment the revision moves, because a reader
 * has no way to tell a deliberate historical contrast from a stamp nobody re-read.
 *
 * ★ WHY THIS FILE EXISTS. v1.38 landed 2026-08-08 and forty-three citations of v1.37 stayed behind. They
 * were not uniformly wrong — nine were correct as written, narrating what changed — which is exactly what
 * made the set expensive: telling the two apart took a section-by-section reading of both revisions. Worse,
 * the obvious remedy was a trap. Two sentences say "v1.37 §C.2 **forbids**", and v1.37 does forbid: a
 * policy page "MUST NOT be substituted for one". v1.38 states the same thing as fact rather than
 * obligation. A `v1.37 → v1.38` sed would have converted two accurate sentences into two false ones, and a
 * verbatim quotation of §C.7 into a fabricated one — the appendix rewrote "optionally-skipped" as
 * "unusable" between revisions.
 *
 * ★ THE RULE, AND WHY IT IS THIS ONE. A file may cite an older revision only if it ALSO cites the current
 * one. That is the difference between a contrast and a stamp: "v1.37 said X; v1.38 says Y" is a fact worth
 * shipping, "reconciled against v1.37" alone is a claim that has quietly expired. The rule needs no
 * allowlist, it never asks whether a sentence is *right*, and it survives the next bump without editing —
 * the current revision is derived from `LCP_SPEC_VERSION`, not written here.
 *
 * ★ WHAT IT DOES NOT CATCH, said plainly. It cannot tell whether the contrast is accurate. Nothing
 * mechanical can. What it guarantees is that every superseded citation sits next to a current one, so the
 * reader is never left holding a lone stale stamp — and so the next bump produces a list of exactly the
 * files that have to be re-read, rather than a tree-wide grep whose results all look alike.
 */
import { join } from "node:path";
import { LCP_SPEC_VERSION } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import { type Prose, packageProse, vectorProse } from "./shipped-prose.js";

const PACKAGES = new URL("../../", import.meta.url).pathname;

/**
 * The spec revision this tree targets, in the two spellings the prose uses.
 *
 * `LCP_SPEC_VERSION` is `0.1.38`; the appendix and the packages write both `v1.38` and `v0.1.38`. Derived
 * rather than written down, so the bump that moves the constant moves this with it.
 */
const CURRENT = ((): readonly string[] => {
  const [, minor, patch] = LCP_SPEC_VERSION.split(".");
  return [`v${minor}.${patch}`, `v${LCP_SPEC_VERSION}`];
})();

/**
 * Any LCP revision spelled in prose: `v1.37`, `v0.1.38`.
 *
 * The TWO-digit patch is the discriminator, and it is not incidental. `v1.0` also appears in shipped
 * source — W3C Bitstring Status List, in three `authority` files — and a looser pattern reads it as a
 * superseded LCP revision and demands they cite v1.38, which would be nonsense. LCP has been in the
 * `1.3x` series since well before this tree existed, so requiring two digits separates the protocol's
 * revisions from every other `vN.N` a host specification carries.
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

describe("shipped prose cites the current spec, or contrasts with it", () => {
  const prose = shippedProse();

  it("walks a plausible surface, and knows what current is", () => {
    // The blind-gate canary. A walker that finds nothing, or a CURRENT that derives to nonsense, reports
    // clean forever.
    expect(prose.length).toBeGreaterThan(110);
    expect(
      prose.filter((p) => p.where.startsWith("vectors/")).length,
    ).toBeGreaterThan(300);
    expect(CURRENT[0]).toMatch(/^v\d+\.\d+$/);
    expect(
      prose.filter((p) => p.text.match(ANY_REVISION)).length,
    ).toBeGreaterThan(10);
  });

  it("no file cites a superseded revision without also citing the current one", () => {
    const offenders: string[] = [];
    for (const { where: file, text } of prose) {
      const cited = new Set(
        [...text.matchAll(ANY_REVISION)].map((m) => m[0] as string),
      );
      const superseded = [...cited].filter((v) => !CURRENT.includes(v)).sort();
      if (superseded.length > 0 && !CURRENT.some((c) => cited.has(c)))
        offenders.push(
          `${file} — cites ${superseded.join(", ")}, never ${CURRENT[0]}`,
        );
    }
    // If this fails: either the citation is stale and needs re-reading against the current revision, or it
    // is deliberate history and the sentence should say what the current revision does instead. Do NOT
    // bulk-replace the version — §C.2's modality and §C.7's wording both changed between revisions, so a
    // sed turns accurate sentences into false ones.
    expect(offenders.sort()).toEqual([]);
  });
});
