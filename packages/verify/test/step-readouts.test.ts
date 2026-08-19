/**
 * Every step reports one of two things when it cannot prove: a `not-attempted` with a `depth` naming the
 * GAP, or a `failed` with a `haltClass` naming the CONTRADICTION. The suite asserted `status` almost
 * everywhere and the two strings beside it almost nowhere — so the readouts could have gone blank while
 * every test stayed green, leaving a report that says "not attempted" without saying why. That string is
 * the entire honesty of the readout: a gap the verifier could not close is not the same claim as a record
 * that contradicts itself, and only `depth`/`haltClass` distinguish them downstream.
 *
 * `totality.test.ts` covers the malformed-input half of this. These are the well-formed-but-incomplete
 * paths — the ordinary way a real record arrives short of proof.
 */
import type {
  ChainWalkResult,
  SignatureVerifier,
  SignedAcceptance,
} from "@integraledger/lcp-authority";
import { hashAtr } from "@integraledger/lcp-kernel";
import { describe, expect, it } from "vitest";
import { verify } from "../src/index.js";
import type { StepOutcome, VerificationReport } from "../src/report.js";
import {
  type AuthorityLink,
  acceptanceStep,
  authorityStep,
  authorityStepFromWalk,
  commitmentStep,
  fingerprintStep,
  settlementStep,
} from "../src/steps.js";

const ATR_BYTES = new TextEncoder().encode('{"lcp":"0.3","id":"x"}');
const WRONG_HASH = `0x${"11".repeat(32)}` as const;

const ACCEPTANCE: SignedAcceptance = {
  atrHash: WRONG_HASH,
  signer: "0x00000000000000000000000000000000000000a1",
  scheme: "evm:eip191",
  signature: "0xdeadbeef",
  signedAt: "2026-07-16T00:00:00Z",
  payloadType: "atrHash",
};
const ACCEPTS: SignatureVerifier = { verify: async () => true };
const REJECTS: SignatureVerifier = { verify: async () => false };

describe("fingerprintStep", () => {
  it("names the gap when the ATR was retrieved but no settled hash was supplied", async () => {
    expect(await fingerprintStep(ATR_BYTES, undefined)).toEqual({
      status: "not-attempted",
      depth: "no-settled-hash",
    });
  });

  it("FAILS with a verification-failure when the recomputed hash does not match", async () => {
    expect(await fingerprintStep(ATR_BYTES, WRONG_HASH)).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("proves on a match, either spelling of the same bytes (LCP §2.5)", async () => {
    const real = await hashAtr(ATR_BYTES);
    expect(await fingerprintStep(ATR_BYTES, real)).toEqual({
      status: "proved",
    });
    // Uppercase DIGITS, lowercase `0x`. The prefix is not a spelling of the value.
    expect(
      await fingerprintStep(ATR_BYTES, `0x${real.slice(2).toUpperCase()}`),
    ).toEqual({ status: "proved" });
  });

  it("fails on a settled hash that is not a well-formed atrHash", async () => {
    // §2.5 compares DECODED BYTES, so a value that cannot be decoded cannot prove the weld. Before
    // 2026-08-08 this was a case-folded string comparison — `0X…`, an uppercase prefix that was never a
    // legal spelling, would have been folded into a match.
    const real = await hashAtr(ATR_BYTES);
    for (const bad of [real.toUpperCase(), real.slice(2), ""])
      expect(await fingerprintStep(ATR_BYTES, bad)).toEqual({
        status: "failed",
        haltClass: "verification-failure",
      });
  });
});

describe("settlementStep", () => {
  it("distinguishes an EMPTY enumeration from an absent port", () => {
    // Two different readouts that both mean "no settlement here": the port ran and found nothing, versus
    // no port was supplied at all. Collapsing them would report an unenumerated record as unsettled.
    expect(settlementStep([])).toEqual({
      status: "not-attempted",
      depth: "no-settlement-found",
    });
    expect(settlementStep(undefined)).toEqual({
      status: "not-attempted",
      depth: "no-enumeration-port",
    });
  });

  it("proves when the enumeration found anything at all", () => {
    expect(settlementStep([{ txHash: "0xabc" }])).toEqual({
      status: "proved",
    });
  });
});

describe("acceptanceStep names which of the three inputs was missing", () => {
  it("no acceptance", async () => {
    expect(await acceptanceStep(undefined, WRONG_HASH, ACCEPTS)).toEqual({
      status: "not-attempted",
      depth: "no-acceptance",
    });
  });

  it("no settled hash to bind the acceptance against", async () => {
    expect(await acceptanceStep(ACCEPTANCE, undefined, ACCEPTS)).toEqual({
      status: "not-attempted",
      depth: "no-settled-hash",
    });
  });

  it("no verifier — a signature nobody checked is not evidence of a signature", async () => {
    expect(await acceptanceStep(ACCEPTANCE, WRONG_HASH, undefined)).toEqual({
      status: "not-attempted",
      depth: "no-signature-verifier",
    });
  });

  it("proves with a verifier that accepts, and forwards the halt class when one rejects", async () => {
    expect(await acceptanceStep(ACCEPTANCE, WRONG_HASH, ACCEPTS)).toEqual({
      status: "proved",
    });
    expect(await acceptanceStep(ACCEPTANCE, WRONG_HASH, REJECTS)).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("fails when the acceptance binds a DIFFERENT hash than the settlement", async () => {
    expect(
      await acceptanceStep(ACCEPTANCE, `0x${"22".repeat(32)}`, ACCEPTS),
    ).toEqual({ status: "failed", haltClass: "verification-failure" });
  });
});

describe("authorityStep — each ATA-3 gate reports its own contradiction", () => {
  // `revoked`/`active` are STATED here, never left to the runtime default, because the type now requires
  // them: an unstated revocation and a checked-unrevoked one must not be the same value at a callsite.
  // The cast survives only because spreading a `Partial` widens the optional depth fields back out.
  const link = (over: Partial<AuthorityLink> = {}): AuthorityLink =>
    ({
      parentDelegable: true,
      parentBounds: { caps: { USD: "10000" } },
      bounds: { caps: { USD: "100" } },
      revoked: false,
      active: true,
      ...over,
    }) as AuthorityLink;

  it("an EMPTY chain walks nothing — a gap, not a proof", () => {
    expect(authorityStep([])).toEqual({
      status: "not-attempted",
      depth: "empty-authority-chain",
    });
  });

  it("fails a link whose parent never permitted delegation", () => {
    expect(authorityStep([link({ parentDelegable: false })])).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("fails below a depth-EXHAUSTED parent, including a nonsensical negative claim", () => {
    // `parentMaxDepth: 0` admits no link. Only a negative child depth reaches past the arithmetic below
    // it, and links arrive as wire JSON where nothing stops a forger from writing one.
    expect(authorityStep([link({ parentMaxDepth: 0, maxDepth: 0 })])).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
    expect(authorityStep([link({ parentMaxDepth: 0, maxDepth: -1 })])).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("fails a link that OMITS its depth below a depth-bounded parent", () => {
    // Unstated depth is unbounded onward delegation — an escalation, not a default.
    expect(authorityStep([link({ parentMaxDepth: 2 })])).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("fails a link that mints itself more onward depth than the parent held", () => {
    expect(authorityStep([link({ parentMaxDepth: 2, maxDepth: 2 })])).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("fails a forged widening, a revoked link and an expired one", () => {
    expect(
      authorityStep([link({ bounds: { caps: { USD: "50000000" } } })]),
    ).toEqual({ status: "failed", haltClass: "verification-failure" });
    expect(authorityStep([link({ revoked: true })])).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
    expect(authorityStep([link({ active: false })])).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("proves a chain whose every link attenuates, is unrevoked and unexpired", () => {
    expect(
      authorityStep([link({ parentMaxDepth: 2, maxDepth: 1 }), link()]),
    ).toEqual({ status: "proved" });
  });

  it("reads a NON-FINITE depth as a GAP on either side — NaN disengages both comparisons", () => {
    // `typeof NaN === "number"`, and NaN compares false on BOTH sides of the arithmetic
    // (`NaN <= 0`, `x > NaN - 1`), so before the guard a NaN parent depth reached `proved` with the depth
    // never checked, and a NaN child depth slipped past the ceiling under a bounded parent.
    //
    // It is `not-attempted`, NOT `failed`, and that is this step's own discipline rather than a softening:
    // a caller's type corruption is a malformed slot, and says nothing about whether the record
    // contradicts itself — impeaching `supportedClass` to TC-0 over it would misreport a coherent record.
    // `authority.walkChainStructure` makes the same ruling on the same value, so walk and step stay
    // categorically aligned.
    //
    // JSON cannot express NaN, so `vectors/verify/authority-walk.json` can never pin this: it is reachable
    // only by constructed (SDK) callers, and the pin lives here.
    const gap = {
      status: "not-attempted",
      depth: "malformed-authority-chain",
    };
    for (const unusable of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      // Parent side: the attack shape — an unusable parent depth under a link minting itself 99 hops.
      expect(
        authorityStep([link({ parentMaxDepth: unusable, maxDepth: 99 })]),
      ).toEqual(gap);
      // Child side: a finite parent with depth to spare still cannot read an unusable child depth.
      expect(
        authorityStep([link({ parentMaxDepth: 3, maxDepth: unusable })]),
      ).toEqual(gap);
    }
    // And the gap is reported for the CHAIN: one malformed hop stops the walk even behind good ones.
    expect(
      authorityStep([
        link({ parentMaxDepth: 2, maxDepth: 1 }),
        link({ parentMaxDepth: Number.NaN, maxDepth: 99 }),
      ]),
    ).toEqual(gap);
  });

  it("requires `revoked` and `active` to be STATED at a typed callsite", () => {
    // The compile-time half of the same discipline that makes `parentDelegable` required: "the flattener
    // never consulted a status list" and "the walk checked the pinned snapshot and it is unrevoked" are
    // otherwise the same absent value, and one of them proves. This case is a TYPE pin — it asserts what
    // does and does not compile, which no runtime vector can express.
    const stated: AuthorityLink = {
      parentDelegable: true,
      parentBounds: { caps: { USD: "10000" } },
      bounds: { caps: { USD: "100" } },
      revoked: false,
      active: true,
    };
    expect(authorityStep([stated])).toEqual({ status: "proved" });
    // @ts-expect-error — omitting `revoked`/`active` must not compile; that error IS the gate.
    const unstated: AuthorityLink = {
      parentDelegable: true,
      parentBounds: { caps: { USD: "10000" } },
      bounds: { caps: { USD: "100" } },
    };
    // The runtime now AGREES with the type instead of quietly forgiving it. This used to read `proved` —
    // absent taken as unrevoked-and-active — on the grounds that the corpus pinned that reading
    // cross-implementation. The corpus was the thing to change, and it was: the vectors state both slots
    // wherever their subject is delegation or depth, and `no-revocation-stated` / `no-liveness-stated`
    // are pinned in their own cases. The compile error is still the primary gate; this is what the
    // untyped caller the step exists for now gets.
    expect(authorityStep([unstated])).toEqual({
      status: "not-attempted",
      depth: "no-revocation-stated",
    });
  });
});

describe("authorityStepFromWalk — the walk's readout, not a caller's flattening", () => {
  // `ChainWalkResult` is the INPUT type here, so these are inputs rather than stand-ins for the walk. The
  // real walk → step round-trip is pinned in `packages/conformance/test/walk-readout.test.ts`, which is
  // the one package importing both sides and running the corpus vectors through them.
  it("maps a REFUSED walk to a failure, carrying the walk's own halt class", () => {
    // A refusal is a reasoned contradiction — the chain was spliced, or widened, or revoked — so it
    // impeaches, exactly as the flattened step's own contradiction arms do.
    const refused: ChainWalkResult = {
      status: "refused",
      haltClass: "verification-failure",
      code: "walk/spliced-link",
      detail: "link 1 is signed by someone other than the parent's subject",
    };
    expect(authorityStepFromWalk(refused)).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("passes a walk's GAP through verbatim, depth string and all", () => {
    // The depth must survive the mapping unaltered: the walk's reason for not attempting IS the report's
    // reason, and rewriting it here would launder a specific gap into a generic one.
    for (const depth of [
      "malformed-authority-chain",
      "unproven-link",
      "no-principal",
    ]) {
      expect(authorityStepFromWalk({ status: "not-attempted", depth })).toEqual(
        { status: "not-attempted", depth },
      );
    }
  });

  it("re-proves a WALKED readout through the flattened step", () => {
    const walked: ChainWalkResult = {
      status: "walked",
      links: [
        {
          parentDelegable: true,
          parentBounds: { caps: { USD: "10000" } },
          bounds: { caps: { USD: "100" } },
          parentMaxDepth: 2,
          maxDepth: 1,
          revoked: false,
          active: true,
        },
      ],
    };
    expect(authorityStepFromWalk(walked)).toEqual({ status: "proved" });
  });

  it("does NOT rubber-stamp a walked readout — the step still gates it", () => {
    // Re-proving is the point of the composition: if `walked` short-circuited to `proved`, the custody
    // walk and the verification step could drift apart without any test noticing. A readout whose link
    // widens its parent must still fail, even though the walk handed it over.
    const widening: ChainWalkResult = {
      status: "walked",
      links: [
        {
          parentDelegable: true,
          parentBounds: { caps: { USD: "10000" } },
          bounds: { caps: { USD: "50000000" } },
          revoked: false,
          active: true,
        },
      ],
    };
    expect(authorityStepFromWalk(widening)).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
  });

  it("is TOTAL over untyped input, like every step here", () => {
    // Absent slot, wrong primitive, and an unrecognized readout shape — each an honest gap, never a throw
    // and never a proof. The last one carries no `links`, so it falls through to the flattened step's own
    // gap rather than needing a branch of its own.
    expect(authorityStepFromWalk(undefined)).toEqual({
      status: "not-attempted",
      depth: "no-authority-walk",
    });
    expect(authorityStepFromWalk(42 as unknown as ChainWalkResult)).toEqual({
      status: "not-attempted",
      depth: "no-authority-walk",
    });
    expect(
      authorityStepFromWalk({ status: "wat" } as unknown as ChainWalkResult),
    ).toEqual({ status: "not-attempted", depth: "no-authority-chain" });
  });
});

describe("commitmentStep", () => {
  it("FAILS when the accepted commitment exceeds the leaf grant (ATA-4)", () => {
    // The failure arm of this step had no test at all — only its gap arms did.
    expect(
      commitmentStep({
        commitment: { caps: { USD: "50000" } },
        leafBounds: { caps: { USD: "10000" } },
      }),
    ).toEqual({ status: "failed", haltClass: "verification-failure" });
  });

  it("proves a commitment contained by the leaf", () => {
    expect(
      commitmentStep({
        commitment: { caps: { USD: "5000" } },
        leafBounds: { caps: { USD: "10000" } },
      }),
    ).toEqual({ status: "proved" });
  });
});

describe("verify — the walk reaches the report, refusals and all", () => {
  const base = {
    asOf: "2026-07-27T00:00:00Z",
    coverage: { ports: [], bindings: [] },
  };
  const authority = (r: VerificationReport): StepOutcome =>
    r.steps.find((s) => s.name === "authority-attenuation")
      ?.outcome as StepOutcome;

  it("a REFUSED walk impeaches the report — the flattened door cannot express this at all", async () => {
    // Flattening a spliced chain yields links that read as a clean `not-attempted`, so the report would
    // say the record carried no chain when it carried a contradictory one. Through the walk slot the
    // refusal arrives with its halt class and drives supportedClass to TC-0.
    const report = await verify({
      ...base,
      authorityWalk: {
        status: "refused",
        haltClass: "verification-failure",
        code: "walk/spliced-link",
        detail: "link 1 is signed by a key that is not the parent's subject",
      },
    });
    expect(authority(report)).toEqual({
      status: "failed",
      haltClass: "verification-failure",
    });
    expect(report.supportedClass).toBe("TC-0");
  });

  it("a walk GAP passes its own depth through verbatim, never the generic one", async () => {
    const report = await verify({
      ...base,
      authorityWalk: { status: "not-attempted", depth: "unproven-link" },
    });
    expect(authority(report)).toEqual({
      status: "not-attempted",
      depth: "unproven-link",
    });
    // A gap is not an impeachment, and the class says so by resting where the proved rungs reach rather
    // than by being floored: nothing here proves, so there is no rung to rest on.
    expect(report.supportedClass).toBe("TC-0");
  });

  it("a WALKED chain proves, and agrees with the hand-flattened path on the same links", async () => {
    const links = [
      {
        bounds: {},
        parentBounds: {},
        parentDelegable: true,
        revoked: false,
        active: true,
      },
    ];
    const viaWalk = await verify({
      ...base,
      authorityWalk: { status: "walked", links },
    });
    const viaChain = await verify({ ...base, authorityChain: links });
    expect(authority(viaWalk)).toEqual({ status: "proved" });
    expect(authority(viaWalk)).toEqual(authority(viaChain));
  });

  it("supplying BOTH is a contradiction and throws — never a silent precedence", async () => {
    await expect(
      verify({
        ...base,
        authorityChain: [],
        authorityWalk: { status: "not-attempted", depth: "no-authority-chain" },
      }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});
