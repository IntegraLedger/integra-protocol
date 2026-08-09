import { readFileSync } from "node:fs";
import {
  type ChainWalkInput,
  walkChainStructure,
} from "@integraledger/lcp-authority";
import {
  authorityStep,
  authorityStepFromWalk,
} from "@integraledger/lcp-verify";
import { describe, expect, it } from "vitest";

/**
 * `WalkedLink` is only STRUCTURALLY compatible with `verify.AuthorityLink` — the named type cannot live
 * in verify (verify imports authority), so nothing in the type system ties the two shapes together.
 * This test does: every readout the walk emits must re-prove under `authorityStep`, or the flattener and
 * the step have diverged. It lives HERE because conformance is the one package that imports both sides.
 *
 * It also pins `authorityStepFromWalk`, the composition that lets a caller skip flattening entirely. That
 * function is only worth having if it agrees with the hand-flattened path on every walked vector and maps
 * the other two arms without inventing anything — so both properties are asserted over the same corpus.
 */
const V = JSON.parse(
  readFileSync(
    new URL("../../../vectors/authority/chain-walk.json", import.meta.url),
    "utf8",
  ),
) as {
  cases: {
    name: string;
    input: ChainWalkInput;
    expected: { status: string };
  }[];
};

describe("the walk's readout is what authorityStep proves", () => {
  it("every walked vector's links re-prove under verify.authorityStep", async () => {
    const walked = V.cases.filter((c) => c.expected.status === "walked");
    expect(walked.length).toBeGreaterThan(0); // a silent filter-to-zero would certify nothing
    for (const c of walked) {
      const walk = await walkChainStructure(c.input);
      if (walk.status !== "walked")
        throw new Error(`${c.name}: expected walked, got ${walk.status}`);
      expect(authorityStep(walk.links)).toEqual({ status: "proved" });
    }
  });

  it("authorityStepFromWalk agrees with the hand-flattened path on EVERY vector", async () => {
    // The composition exists to remove the flattening step, not to change the answer. Any vector where
    // the two disagree means the mapping is doing arithmetic of its own, which is exactly what it must
    // not do. Walked arms compare against `authorityStep`; the other two arms are pinned below.
    expect(V.cases.length).toBeGreaterThan(0);
    for (const c of V.cases) {
      const walk = await walkChainStructure(c.input);
      const composed = authorityStepFromWalk(walk);
      if (walk.status === "walked") {
        expect(composed).toEqual(authorityStep(walk.links));
      } else if (walk.status === "refused") {
        // A refusal is a reasoned contradiction and must impeach, carrying the walk's own halt class.
        expect(composed).toEqual({
          status: "failed",
          haltClass: walk.haltClass,
        });
      } else {
        // A gap passes through verbatim — the walk's reason IS the report's reason.
        expect(composed).toEqual({
          status: "not-attempted",
          depth: walk.depth,
        });
      }
    }
  });

  it("the corpus exercises all three arms of the mapping, so the agreement means something", async () => {
    // Without this, the test above could pass while two of the three arms were never reached — a green
    // suite certifying one third of the contract.
    const arms = new Set<string>();
    for (const c of V.cases)
      arms.add((await walkChainStructure(c.input)).status);
    expect([...arms].sort()).toEqual(["not-attempted", "refused", "walked"]);
  });
});
