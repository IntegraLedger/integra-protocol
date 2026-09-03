import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TEMPO_MPP_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/tempo-mpp-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("TEMPO_MPP_MANIFEST", () => {
  it("matches the published integra-tempo-mpp-memo-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-tempo-mpp-memo-v1");
    expect(TEMPO_MPP_MANIFEST).toEqual(rest);
  });

  it("is the MPP-specific Tempo rail, not a bare-chain binding", () => {
    expect(TEMPO_MPP_MANIFEST.rail).toBe("tempo:mpp");
    expect(TEMPO_MPP_MANIFEST.protocol).toBe("mpp");
  });

  it("is a native-field binding on tip20.memo", () => {
    expect(TEMPO_MPP_MANIFEST.pattern).toBe("native-field");
    expect(TEMPO_MPP_MANIFEST.nativeField).toBe("tip20.memo");
    expect(TEMPO_MPP_MANIFEST.assetBinding).toBe("filtered");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail cannot produce a failed transaction that still carries a weld.
    expect(TEMPO_MPP_MANIFEST.successGate).toBe("structural");
  });

  it("declares the FULL recovery triple, and it was observed rather than asserted", () => {
    // Observed on Tempo mainnet 2026-07-30, not read off a spec: recovered from a tx hash through a
    // public RPC, and re-found by a topic-3 filter. All three legs are true of the code, not aspirational.
    // What is particular here is the carrier and the index key, not the triple, which several profiles
    // carry. The set is DERIVED in `rail-invariants/test/recovery-triple-invariant.test.ts` rather than
    // counted here: this comment said "four of the eleven" and named evm:escrow, which declares no such
    // triple, over a corpus that ships thirteen profiles. See the manifest's own note.
    expect(TEMPO_MPP_MANIFEST.recovery).toEqual({
      onChain: true,
      zeroPartyRecoverable: true,
      forwardIndexable: true,
    });
    expect(TEMPO_MPP_MANIFEST.indexing).toBe("topic:TransferWithMemo.memo");
  });

  it("declares TWO weld grades because the two memo-bearing calls differ", () => {
    // The completion plan's §6.2 B2 sketch wrote `{"tip20-memo": "tx"}`. The gate amended it: the payer's
    // own signature covers the calls[] array carrying the memo (observed on a type-0x76 transaction), so
    // transferWithMemo is signature-grade like every sibling memo binding; transferFromWithMemo stays
    // tx-grade because there the spender, not the owner, chooses the memo.
    expect(TEMPO_MPP_MANIFEST.weldGrades).toEqual({
      "tip20-transferWithMemo": "signature",
      "tip20-transferFromWithMemo": "tx",
    });
  });

  it("declares finality without representing it as dispute resolution (PAY-3/RCS-5)", () => {
    expect(TEMPO_MPP_MANIFEST.finality.reversible).toBe(false);
    expect(TEMPO_MPP_MANIFEST.finality.note).toMatch(
      /never dispute resolution/,
    );
  });

  it("carries no offCanonical profile — this is the canonical Native Field realization", () => {
    // LCP §8.3.1's off-canonical escape is for a variant of the pattern. TIP-20's memo IS an
    // unconstrained, indexed field on the standard transfer primitive, so there is no variant to name.
    expect(TEMPO_MPP_MANIFEST.offCanonical).toBeUndefined();
  });

  it("declares the two lifecycle states the rail actually has", () => {
    expect(TEMPO_MPP_MANIFEST.lifecycleStates).toEqual(["proposed", "settled"]);
  });
});
