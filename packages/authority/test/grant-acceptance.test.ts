import { describe, expect, it } from "vitest";
import type { SignatureVerifier, SignedAcceptance } from "../src/acceptance.js";
import {
  commitmentWithinLeaf,
  isAcceptanceScheme,
  verifyAcceptance,
  verifyAcceptanceStructure,
} from "../src/acceptance.js";
import type { AtaGrant } from "../src/grant.js";
import { linkAttenuates } from "../src/grant.js";

function grant(
  bounds: AtaGrant["credentialSubject"]["bounds"],
  delegable: boolean,
  maxDepth?: number,
): AtaGrant {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    issuer: "did:web:integraledger.com",
    credentialSubject: {
      id: "did:example:x",
      bounds,
      delegable,
      ...(maxDepth !== undefined ? { maxDepth } : {}),
    },
  };
}

describe("linkAttenuates", () => {
  it("accepts a narrower link from a delegable parent", () => {
    const parent = grant({ caps: { USD: "1000000" } }, true, 2);
    const link = grant({ caps: { USD: "50000" } }, false, 0);
    expect(linkAttenuates(link, parent)).toBe(true);
  });
  it("refuses when the parent is not delegable", () => {
    const parent = grant({ caps: { USD: "1000000" } }, false);
    const link = grant({ caps: { USD: "1" } }, false);
    expect(linkAttenuates(link, parent)).toBe(false);
  });
  it("refuses a widening link (the forged $50M from $10k)", () => {
    // The link states a depth that fits, so this case isolates the BOUNDS gate — otherwise it would be
    // refused by the depth gate first and stop proving what its name claims.
    const parent = grant({ caps: { USD: "10000" } }, true, 1);
    const link = grant({ caps: { USD: "50000000" } }, false, 0);
    expect(linkAttenuates(link, parent)).toBe(false);
  });
  it("refuses a link that OMITS its depth below a depth-bounded parent", () => {
    // An absent `maxDepth` is unbounded onward delegation, so omitting it below a parent holding one hop
    // claims strictly more than the parent had. Reading it as `parentDepth - 1` would be a silent fallback.
    const parent = grant({ caps: { USD: "10000" } }, true, 1);
    const link = grant({ caps: { USD: "1" } }, true);
    expect(linkAttenuates(link, parent)).toBe(false);
  });
  it("accepts an omitted depth below an UNBOUNDED parent", () => {
    // Nothing is escalated when the parent itself was never depth-bounded.
    const parent = grant({ caps: { USD: "10000" } }, true);
    const link = grant({ caps: { USD: "1" } }, true);
    expect(linkAttenuates(link, parent)).toBe(true);
  });
  it("refuses when no depth remains below the parent", () => {
    const parent = grant({ caps: { USD: "10000" } }, true, 0);
    const link = grant({ caps: { USD: "1" } }, false);
    expect(linkAttenuates(link, parent)).toBe(false);
  });
  it("refuses a link that mints itself MORE onward depth than the parent held", () => {
    // Bounds narrow impeccably; the link claims it may extend 99 hops below a parent that authorized 1.
    const parent = grant({ caps: { USD: "10000" } }, true, 1);
    const link = grant({ caps: { USD: "1" } }, true, 99);
    expect(linkAttenuates(link, parent)).toBe(false);
  });
  it("accepts a link that consumes exactly the depth the parent had left", () => {
    const parent = grant({ caps: { USD: "10000" } }, true, 3);
    const link = grant({ caps: { USD: "1" } }, true, 2);
    expect(linkAttenuates(link, parent)).toBe(true);
  });
  it("refuses a link claiming EXACTLY its parent's depth — the ceiling is parentDepth - 1", () => {
    // The boundary that pins the arithmetic. `parentDepth - 1`
    // mutating to `parentDepth + 1` and surviving: link=2/parent=3 passes under both, link=99/parent=1
    // fails under both. Only link == parent tells them apart, and it is the case that matters — a link
    // holding its parent's full depth has consumed no hop at all.
    //
    // This lives here AND in vectors/authority/link-attenuates.json deliberately. The corpus checks the
    // cross-party rule, but `conformance` imports authority's built dist, so a corpus case can never kill
    // a mutant in authority's SOURCE. The two are not substitutes.
    const parent = grant({ caps: { USD: "10000" } }, true, 3);
    const link = grant({ caps: { USD: "1" } }, true, 3);
    expect(linkAttenuates(link, parent)).toBe(false);
  });
  it("refuses a link claiming MORE than its parent's depth by one", () => {
    const parent = grant({ caps: { USD: "10000" } }, true, 3);
    const link = grant({ caps: { USD: "1" } }, true, 4);
    expect(linkAttenuates(link, parent)).toBe(false);
  });
  it("refuses any link below an EXHAUSTED parent, including a nonsensical negative depth", () => {
    // `maxDepth: 0` means no hop remains. For any sane link depth the arithmetic below already rejects,
    // so only a negative claim reaches past it — and grants arrive as wire JSON, where nothing stops a
    // forger from writing one. The guard has to fail closed rather than let `-1 > -1` open the chain.
    const exhausted = grant({ caps: { USD: "10000" } }, true, 0);
    expect(
      linkAttenuates(grant({ caps: { USD: "1" } }, true, 0), exhausted),
    ).toBe(false);
    expect(
      linkAttenuates(grant({ caps: { USD: "1" } }, true, -1), exhausted),
    ).toBe(false);
  });
  it("refuses a NON-FINITE depth on EITHER side — NaN disengages both comparisons", () => {
    // `typeof NaN === "number"`, and NaN compares false on BOTH sides of the escalation arithmetic
    // (`NaN <= 0`, `x > NaN - 1`), so before the guard a NaN parent depth let a child state ANY onward
    // depth and attenuate, and a NaN link depth slipped past the ceiling under a bounded parent. This is
    // a boolean PERMIT — it cannot report a gap, so a stated-but-unusable depth fails closed.
    //
    // JSON cannot express NaN, so this can never be a corpus vector: it is reachable only by constructed
    // (SDK) callers, and the pin lives here. The walk's own shape gate makes the matching ruling for the
    // documents it parses (walk.ts `walkableGrant`).
    const narrower = { caps: { USD: "1" } };
    for (const unusable of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      // Parent side: the attack shape — an unusable parent depth beneath a delegable parent, with a
      // child minting itself 99 onward hops. Impeccable bounds; the depth gate must still refuse.
      const parent = grant({ caps: { USD: "10000" } }, true, unusable);
      expect(linkAttenuates(grant(narrower, true, 99), parent)).toBe(false);
      // ...and it is the DEPTH that refuses, not the bounds: a leaf claiming no onward depth at all
      // would be accepted under any finite parent depth ≥ 1.
      expect(linkAttenuates(grant(narrower, false, 0), parent)).toBe(false);
      // Link side: a finite, delegable parent with depth to spare still refuses an unusable child depth.
      expect(
        linkAttenuates(
          grant(narrower, true, unusable),
          grant({ caps: { USD: "10000" } }, true, 3),
        ),
      ).toBe(false);
    }
  });
});

const ACC: SignedAcceptance = {
  atrHash: "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  signer: "0x00000000000000000000000000000000000000a1",
  scheme: "evm:eip191",
  signature: "0xdeadbeef",
  signedAt: "2026-07-16T00:00:00Z",
  payloadType: "atrHash",
};
const okVerifier: SignatureVerifier = { verify: async () => true };
const badVerifier: SignatureVerifier = { verify: async () => false };

describe("verifyAcceptance (pure over the signature port)", () => {
  it("accepts a matching atrHash with a good signature", async () => {
    const out = await verifyAcceptance(ACC, ACC.atrHash, okVerifier);
    expect("refused" in out).toBe(false);
  });
  it("refuses an atrHash mismatch before touching the signature", async () => {
    const out = await verifyAcceptance(ACC, `0x${"00".repeat(32)}`, okVerifier);
    expect("refused" in out).toBe(true);
    if ("refused" in out) expect(out.code).toBe("acceptance/atrhash-mismatch");
  });
  it("refuses a bad signature (verification-failure)", async () => {
    const out = await verifyAcceptance(ACC, ACC.atrHash, badVerifier);
    // The `code` was never asserted on this arm, only the class — and `refused` itself never at all.
    // `"refused" in out` holds even when the flag underneath is false.
    expect("ok" in out).toBe(false);
    if (!("refused" in out)) throw new Error("expected a refusal");
    expect(out.refused).toBe(true);
    expect(out.haltClass).toBe("verification-failure");
    expect(out.code).toBe("acceptance/bad-signature");
  });
  it("returns the verified acceptance itself, under ok:true", async () => {
    expect(await verifyAcceptance(ACC, ACC.atrHash, okVerifier)).toEqual({
      ok: true,
      value: ACC,
    });
  });
  it("returns the acceptance under ok:true when an ATA-4 commitment fits the leaf", async () => {
    expect(
      await verifyAcceptance(ACC, ACC.atrHash, okVerifier, {
        commitment: { caps: { USD: "5000" } },
        leafBounds: { caps: { USD: "10000" } },
      }),
    ).toEqual({ ok: true, value: ACC });
  });
  it("refuses when the accepted commitment exceeds the leaf grant (ATA-4)", async () => {
    const out = await verifyAcceptance(ACC, ACC.atrHash, okVerifier, {
      commitment: { caps: { USD: "50000" } },
      leafBounds: { caps: { USD: "10000" } },
    });
    expect("refused" in out).toBe(true);
    if ("refused" in out)
      expect(out.code).toBe("acceptance/commitment-exceeds-grant");
  });
  it("commitmentWithinLeaf mirrors isWithin", () => {
    expect(
      commitmentWithinLeaf(
        { caps: { USD: "5000" } },
        { caps: { USD: "10000" } },
      ),
    ).toBe(true);
    expect(
      commitmentWithinLeaf(
        { caps: { USD: "50000" } },
        { caps: { USD: "10000" } },
      ),
    ).toBe(false);
  });
});

describe("verifyAcceptanceStructure (pure, chain-free — the corpus-certified half)", () => {
  it("passes a matching atrHash with no signature port in sight", () => {
    expect(verifyAcceptanceStructure(ACC, ACC.atrHash)).toEqual({
      ok: true,
      value: ACC,
    });
  });
  it("matches either spelling of the same 32 bytes (LCP §2.5)", () => {
    // Uppercase DIGITS, lowercase `0x`. The prefix is not a spelling of the value — it is part of what
    // makes the string an atrHash — so it does not move with the digits.
    const upperDigits = `0x${ACC.atrHash.slice(2).toUpperCase()}`;
    const out = verifyAcceptanceStructure(ACC, upperDigits);
    expect("refused" in out).toBe(false);
  });
  it("refuses an expectation that is not a well-formed atrHash", () => {
    // §2.5 compares DECODED BYTES, so both sides must decode. Before 2026-08-08 this was a case-folded
    // string comparison: an acceptance and an expectation that were equally malformed matched each other.
    for (const bad of [
      ACC.atrHash.toUpperCase(), // `0X…` — an uppercase prefix was never a legal spelling
      ACC.atrHash.slice(2), // no prefix at all
      `0x${"ab".repeat(31)}`, // 31 bytes
      "",
    ]) {
      const out = verifyAcceptanceStructure(ACC, bad);
      expect("refused" in out, `should refuse: ${bad}`).toBe(true);
      if ("refused" in out)
        expect(out.code).toBe("acceptance/atrhash-mismatch");
    }
  });
  it("refuses an atrHash mismatch", () => {
    const out = verifyAcceptanceStructure(ACC, `0x${"11".repeat(32)}`);
    expect("refused" in out).toBe(true);
    if ("refused" in out) expect(out.code).toBe("acceptance/atrhash-mismatch");
  });
  it("refuses the inverted forbidden-clause widening (commitment drops a leaf-forbidden category)", () => {
    const out = verifyAcceptanceStructure(ACC, ACC.atrHash, {
      commitment: { forbiddenClauseCategories: ["auto-renewal"] },
      leafBounds: {
        forbiddenClauseCategories: ["auto-renewal", "class-action-waiver"],
      },
    });
    expect("refused" in out).toBe(true);
    if ("refused" in out)
      expect(out.code).toBe("acceptance/commitment-exceeds-grant");
  });
});

/**
 * The scheme namespace (`<family>:<method>`) is the whole structural claim the open set makes: the family
 * names the port answerable for the signature. Un-namespaced and half-empty schemes name no one.
 */
describe("isAcceptanceScheme — the namespace convention", () => {
  it("accepts family:method from any family — the set is open by design", () => {
    expect(isAcceptanceScheme("evm:eip191")).toBe(true);
    expect(isAcceptanceScheme("jose:ES256")).toBe(true);
    expect(isAcceptanceScheme("solana:ed25519")).toBe(true);
  });
  it("rejects an un-namespaced scheme — it names no family, so no port is answerable", () => {
    expect(isAcceptanceScheme("schnorr")).toBe(false);
  });
  it("rejects empty halves", () => {
    expect(isAcceptanceScheme("evm:")).toBe(false);
    expect(isAcceptanceScheme(":eip191")).toBe(false);
    expect(isAcceptanceScheme(":")).toBe(false);
  });
});
