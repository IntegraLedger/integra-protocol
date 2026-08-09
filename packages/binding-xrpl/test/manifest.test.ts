import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XRPL_MANIFEST } from "../src/manifest.js";

const profile = JSON.parse(
  readFileSync(
    new URL("../../../vectors/binding/xrpl-profile.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

describe("XRPL_MANIFEST", () => {
  it("matches the published integra-xrpl-invoice-id-v1 profile (minus the profile id)", () => {
    const { profile: id, ...rest } = profile;
    expect(id).toBe("integra-xrpl-invoice-id-v1");
    expect(XRPL_MANIFEST).toEqual(rest);
  });

  it("is a signature-grade native-field binding with no forward index (scan only)", () => {
    expect(XRPL_MANIFEST.pattern).toBe("native-field");
    expect(XRPL_MANIFEST.nativeField).toBe("InvoiceID");
    // x402's exact-XRPL scheme makes a facilitator reject any memo-bearing transaction (§9) and forbids
    // memos for invoice binding outright (§8), so the carrier moved. `protocol` follows: the choice was
    // made by reading x402, so silence would claim a neutrality this binding does not have.
    expect(XRPL_MANIFEST.protocol).toBe("x402");
    expect(XRPL_MANIFEST.weldGrades["invoice-id"]).toBe("signature");
    // The legacy carrier keeps its grade — payments welded before the move are still signature-grade.
    expect(XRPL_MANIFEST.weldGrades["tx-memo"]).toBe("signature");
    expect(XRPL_MANIFEST.recovery.forwardIndexable).toBe(false);
    expect(XRPL_MANIFEST.indexing).toBe("tx-scan:invoice-id");
    expect(XRPL_MANIFEST.assetBinding).toBe("none");
    // The sibling axis: whether recovery observes THAT anything moved. Pinned because the
    // published profile carries it — the rail records failed transactions, so recovery must read the chain's outcome field.
    expect(XRPL_MANIFEST.successGate).toBe("raw-field");
  });

  it("recovers the full 32-byte atrHash (no truncation), which is why the DIRECT field was chosen", () => {
    // x402 also defines a hashed route — the seller sets extra.invoiceId and the chain carries
    // SHA-256(invoiceId), facilitator-enforced. That is an §8.3.5 Id-Reuse binding: SHA-256 has no
    // inverse, so its only honest surface is confirming a candidate the auditor already holds. It would
    // buy enforcement and pay for it with THIS property, which is most of why an on-chain weld exists.
    expect(XRPL_MANIFEST.recovery.zeroPartyRecoverable).toBe(true);
  });
});
