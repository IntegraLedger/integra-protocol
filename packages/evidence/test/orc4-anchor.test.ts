import { describe, expect, it } from "vitest";
import { settlementAnchor } from "../src/anchor.js";
import { appendOrc4, emptyOrc4Log } from "../src/orc4.js";

describe("ORC-4 log", () => {
  it("starts empty and appends immutably (functional core)", () => {
    const a = emptyOrc4Log();
    expect(a.entries).toEqual([]);
    const b = appendOrc4(a, {
      timestamp: "2026-07-17T00:00:00Z",
      artifactsVerified: ["lcp:sha256:0xabc"],
      rulesFired: ["terms-present"],
    });
    expect(a.entries).toHaveLength(0); // original untouched
    expect(b.entries).toHaveLength(1);
    const c = appendOrc4(b, {
      timestamp: "2026-07-17T00:00:01Z",
      artifactsVerified: [],
      rulesFired: ["risk-check"],
      haltClass: "risk-block",
    });
    expect(c.entries).toHaveLength(2);
    expect(c.entries[1]?.haltClass).toBe("risk-block");
  });
});

describe("settlementAnchor (PRS-4)", () => {
  it("builds the settlement-inclusion anchor from a ref + chain block time", () => {
    const anchor = settlementAnchor(
      { chainId: 84532, txHash: `0x${"11".repeat(32)}` },
      1_700_000_000n,
    );
    expect(anchor.kind).toBe("settlement-inclusion");
    expect(anchor.chainId).toBe(84532);
    expect(anchor.blockTime).toBe(1_700_000_000n);
    expect(anchor.txHash).toBe(`0x${"11".repeat(32)}`);
  });

  it("omits txHash when the ref carries none", () => {
    const anchor = settlementAnchor({ chainId: 1 }, 42n);
    expect(anchor.txHash).toBeUndefined();
  });
});
