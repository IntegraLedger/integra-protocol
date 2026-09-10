import { readFileSync } from "node:fs";
import {
  type ChainWalkInput,
  type VerifiedChainWalkResult,
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
 * This test does: every readout the walk emits must read out under `authorityStep` as the walk's own work
 * warrants, or the flattener and the step have diverged. It lives HERE because conformance is the one
 * package that imports both sides.
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
  it("every walked vector's links re-prove — or read the ONE gap the walk honestly left", async () => {
    // The walked vectors split, and the split is the contract rather than a wrinkle in the test. A grant
    // that names a `credentialStatus` had its pinned snapshot read, so its readout STATES `revoked` and
    // the step proves. A grant that names none had no list to consult, so the readout omits the field and
    // the step answers `no-revocation-stated` — the token `verify` has emitted for a hand-flattened link
    // since 2026-08-08, and which the walk-fed door could not reach while the walk stamped `false` for a
    // check that never ran. Asserted BY THE INPUT DOCUMENT, so a walk that simply stopped consulting
    // status lists would flip a case into the wrong bucket and fail here.
    const walked = V.cases.filter((c) => c.expected.status === "walked");
    expect(walked.length).toBeGreaterThan(0); // a silent filter-to-zero would certify nothing
    let proved = 0;
    let gapped = 0;
    for (const c of walked) {
      const walk = await walkChainStructure(c.input);
      if (walk.status !== "walked")
        throw new Error(`${c.name}: expected walked, got ${walk.status}`);
      const everyLinkStatesStatus = c.input.chain.every(
        (g) => g.credentialStatus !== undefined,
      );
      if (everyLinkStatesStatus) {
        expect(authorityStep(walk.links), c.name).toEqual({ status: "proved" });
        proved++;
      } else {
        expect(authorityStep(walk.links), c.name).toEqual({
          status: "not-attempted",
          depth: "no-revocation-stated",
        });
        gapped++;
      }
    }
    // Both buckets are non-empty, or one arm of the contract went uncertified behind a green.
    expect(proved).toBeGreaterThan(0);
    expect(gapped).toBeGreaterThan(0);
  });

  it("authorityStepFromWalk agrees with the hand-flattened path on EVERY vector", async () => {
    // The composition exists to remove the flattening step, not to change the answer. Any vector where
    // the two disagree means the mapping is doing arithmetic of its own, which is exactly what it must
    // not do. Walked arms compare against `authorityStep`; the other two arms are pinned below.
    //
    // The success arm is RE-TAGGED to `verified` by hand, and that is the honest construction rather than
    // a way round the type: `authorityStepFromWalk` accepts only `VerifiedChainWalkResult`, this corpus
    // certifies the STRUCTURAL walk (the proof gate is port-injected and out of it by design), and what
    // is under test here is the MAPPING — three arms in, three outcomes out. Standing up a cryptosuite to
    // re-derive the same links would test the port, not the mapping. Same ruling as
    // `verify/test/step-readouts.test.ts`: the result type is this function's INPUT.
    expect(V.cases.length).toBeGreaterThan(0);
    for (const c of V.cases) {
      const walk = await walkChainStructure(c.input);
      const asVerified: VerifiedChainWalkResult =
        walk.status === "walked"
          ? { status: "verified", links: walk.links }
          : walk;
      const composed = authorityStepFromWalk(asVerified);
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
