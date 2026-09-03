import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  buildMuxedDestination,
  createStellarAdapter,
  type StellarReader,
  type StellarSettlementView,
} from "../src/adapter.js";
import { STELLAR_MANIFEST } from "../src/manifest.js";

const ATR = `0x${"ab".repeat(32)}`;
const OTHER = `0x${"cd".repeat(32)}`;
const G_PUBKEY = Keypair.fromRawEd25519Seed(
  Buffer.from(new Uint8Array(32).fill(7)),
).publicKey();

const adapter = createStellarAdapter(STELLAR_MANIFEST);

/** A view of a SUCCESSFUL settlement paying to `muxedDestination` (Horizon `successful: true`). */
function settled(muxedDestination: string): StellarSettlementView {
  return { muxedDestination, successful: true };
}

/** A reader driven by a per-txHash script of settlement views. */
function reader(
  views: Record<string, StellarSettlementView>,
  perAccount: string[] = [],
): StellarReader {
  return {
    async settlementView(
      txHash: string,
    ): Promise<StellarSettlementView | null> {
      // ⛔ `null` for a hash the script does not hold — the port's own "Horizon has no such transaction".
      // This used to answer `{ muxedDestination: null }`, which made every unknown hash indistinguishable
      // from a real transaction that paid an unmuxed address.
      return views[txHash] ?? null;
    },
    async transactionsFor(_account: string): Promise<string[]> {
      return perAccount;
    },
  };
}

describe("buildMuxedDestination / propose", () => {
  it("builds a valid CAP-67 M-address welding atrHash[:8]", () => {
    const mAddr = adapter.propose(ATR, G_PUBKEY);
    expect(mAddr).toBe(buildMuxedDestination(ATR, G_PUBKEY));
    expect(StrKey.isValidMed25519PublicKey(mAddr)).toBe(true);
    expect(mAddr.startsWith("M")).toBe(true);
  });
});

describe("createStellarAdapter", () => {
  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() =>
      createStellarAdapter({ ...STELLAR_MANIFEST, rail: "solana" }),
    ).toThrow('manifest.rail "solana" is not "stellar"');
  });
});

describe("verify — the primary confirm-not-recover surface", () => {
  const mAddr = buildMuxedDestination(ATR, G_PUBKEY);

  it("confirms a known atrHash's prefix-8 against the settlement", async () => {
    const r = await adapter.verify(
      ATR,
      { txHash: "tx1" },
      reader({ tx1: settled(mAddr) }),
    );
    expect("refused" in r).toBe(false);
    if (!("refused" in r)) {
      expect(r.value.confirmed).toBe(true);
      // 0x + 16 hex chars = the 8-byte prefix, NOT a 64-hex full hash.
      expect(r.value.muxIdPrefix8Hex).toBe(`0x${"ab".repeat(8)}`);
      expect(r.value.muxIdPrefix8Hex.length).toBe(18);
    }
  });

  it("refuses (verification-failure) when the known atrHash's prefix-8 does not match", async () => {
    const r = await adapter.verify(
      OTHER,
      { txHash: "tx1" },
      reader({ tx1: settled(mAddr) }),
    );
    expect("refused" in r).toBe(true);
    if ("refused" in r) {
      expect(r.haltClass).toBe("verification-failure");
      expect(r.code).toBe("stellar/mux-prefix-mismatch");
    }
  });

  it("refuses when the settlement has no muxed destination", async () => {
    const r = await adapter.verify(
      ATR,
      { txHash: "tx1" },
      reader({ tx1: { muxedDestination: null } }),
    );
    expect("ok" in r).toBe(false);
    // The whole refusal, not just its code: `"refused" in r` holds even when the flag itself is false.
    expect(r).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "stellar/no-muxed-destination",
      detail: expect.stringContaining("tx1"),
    });
  });
});

describe("recover — explicitly PARTIAL (prefix only, never a full atrHash)", () => {
  const mAddr = buildMuxedDestination(ATR, G_PUBKEY);

  it("returns only the 8-byte on-chain prefix, flagged partial with an honest note", async () => {
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: settled(mAddr) }),
    );
    expect("refused" in r).toBe(false);
    if (!("refused" in r)) {
      expect(r.value.partial).toBe(true);
      expect(r.value.muxIdPrefix8Hex).toBe(`0x${"ab".repeat(8)}`);
      // ★ NOT a full atrHash — it must not equal the 32-byte ATR and must be 18 chars (0x + 16 hex).
      expect(r.value.muxIdPrefix8Hex).not.toBe(ATR);
      expect(r.value.muxIdPrefix8Hex.length).toBe(18);
      expect(r.value.note).toMatch(/NOT the full atrHash/);
    }
  });

  it("refuses when there is no muxed destination", async () => {
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: { muxedDestination: null } }),
    );
    expect("refused" in r).toBe(true);
    if ("refused" in r) expect(r.code).toBe("stellar/no-muxed-destination");
  });
});

describe("observe", () => {
  it("reports the settled transition with the on-chain mux prefix", async () => {
    const mAddr = buildMuxedDestination(ATR, G_PUBKEY);
    const o = await adapter.observe(
      { txHash: "tx1" },
      reader({ tx1: settled(mAddr) }),
    );
    expect("refused" in o).toBe(false);
    if (!("refused" in o))
      expect(o.value).toEqual({
        state: "settled",
        muxIdPrefix8Hex: `0x${"ab".repeat(8)}`,
      });
  });

  /**
   * `observe` was only ever asked about a settlement that WAS there — its whole refusal arm was
   * uncovered. It re-runs the same prefix read `recover` does and forwards the refusal; with nothing
   * pinning that, the reader could answer `{state:"settled", muxIdPrefix8Hex:undefined}` for a transaction
   * with no CAP-67 destination at all. Same shape found in canton, aptos, solana, hedera, xrpl, cardano.
   */
  it("refuses a transaction with no CAP-67 muxed destination — never settled-with-nothing", async () => {
    const o = await adapter.observe(
      { txHash: "tx-plain" },
      reader({ "tx-plain": { muxedDestination: null } }),
    );
    expect("ok" in o).toBe(false);
    if (!("refused" in o)) throw new Error("expected a refusal");
    expect(o.refused).toBe(true);
    expect(o.haltClass).toBe("verification-failure");
    expect(o.code).toBe("stellar/no-muxed-destination");
    expect(o.detail).toContain("tx-plain");
  });

  it("refuses a transaction the reader has never heard of, AS never heard of", async () => {
    const o = await adapter.observe({ txHash: "tx-unknown" }, reader({}));
    expect("refused" in o && o.refused).toBe(true);
    if (!("refused" in o)) throw new Error("expected a refusal");
    expect(o.code).toBe("stellar/no-such-transaction");
  });

  it("forwards the same refusal recover produces, adding nothing", async () => {
    const rdr = reader({ tx1: { muxedDestination: null } });
    const observed = await adapter.observe({ txHash: "tx1" }, rdr);
    const recovered = await adapter.recover({ txHash: "tx1" }, rdr);
    expect(observed).toEqual(recovered);
  });
});

/**
 * Every fixture in this file is a repeated byte (`ab` × 32), so `toHex`'s zero-padding never fires:
 * 0xab is already two hex chars. A hash whose prefix holds a byte below 0x10 is what proves the mux id
 * is rendered as fixed-width hex — without it, `0x0a…` renders as `0xa…` and the reported prefix is a
 * short, wrong string that would not compare equal to any correctly-derived one.
 */
describe("mux prefix hex rendering", () => {
  const LOW_BYTES = `0x00010203040506070${"f".repeat(47)}`;

  it("zero-pads every byte — a 0x0N byte must not render as one nibble", async () => {
    const mAddr = buildMuxedDestination(LOW_BYTES, G_PUBKEY);
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: settled(mAddr) }),
    );
    if ("refused" in r) throw new Error("expected a recovery");
    expect(r.value.muxIdPrefix8Hex).toBe("0x0001020304050607");
    expect(r.value.muxIdPrefix8Hex.length).toBe(18);
  });

  it("reports the same fixed-width prefix through verify and observe", async () => {
    const mAddr = buildMuxedDestination(LOW_BYTES, G_PUBKEY);
    const rdr = reader({ tx1: settled(mAddr) });

    const v = await adapter.verify(LOW_BYTES, { txHash: "tx1" }, rdr);
    expect(v).toEqual({
      ok: true,
      value: { confirmed: true, muxIdPrefix8Hex: "0x0001020304050607" },
    });

    const o = await adapter.observe({ txHash: "tx1" }, rdr);
    expect(o).toEqual({
      ok: true,
      value: { state: "settled", muxIdPrefix8Hex: "0x0001020304050607" },
    });
  });
});

/**
 * `"refused" in r` is true even when the flag is false, and `"ok" in r` likewise — so the literal
 * discriminants need pinning on their own. A consumer branching on `if (r.refused)` would otherwise
 * read a refusal as a success.
 */
describe("Outcome discriminants", () => {
  it("carries refused:true with the full refusal body, not merely the key", async () => {
    const r = await adapter.verify(
      OTHER,
      { txHash: "tx1" },
      reader({ tx1: settled(buildMuxedDestination(ATR, G_PUBKEY)) }),
    );
    expect(r).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "stellar/mux-prefix-mismatch",
      detail: expect.stringContaining("tx1"),
    });
  });

  it("carries ok:true on the partial recovery, with the honest note", async () => {
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: settled(buildMuxedDestination(ATR, G_PUBKEY)) }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        muxIdPrefix8Hex: `0x${"ab".repeat(8)}`,
        partial: true,
        note: expect.stringContaining("NOT the full atrHash"),
      },
    });
  });
});

/**
 * ★ THE SUCCESS GATE. A Stellar transaction that fails is still recorded in the ledger with its fee
 * charged, and the operation's `to` destination lives in the transaction ENVELOPE — so the CAP-67
 * M-address is readable regardless of the result. Confirming it would mint a settlement record out of a
 * failure: the buyer paid nothing but the fee. Confirm-only posture does NOT mitigate this — it changes
 * WHAT is proven (a prefix match rather than a recovered hash), never WHETHER settlement occurred.
 * Mirrors binding-solana's `err === null` gate and binding-xrpl's validated/tesSUCCESS gate.
 */
describe("the success gate — a FAILED transaction is never a settlement", () => {
  const mAddr = buildMuxedDestination(ATR, G_PUBKEY);
  const failed = { muxedDestination: mAddr, successful: false };
  /** A reader that saw the transaction but reported no outcome at all. */
  const silent = { muxedDestination: mAddr };

  it("verify REFUSES a failed transaction whose mux id matches the known atrHash", async () => {
    const r = await adapter.verify(
      ATR,
      { txHash: "tx1" },
      reader({ tx1: failed }),
    );
    expect("ok" in r).toBe(false);
    expect(r).toEqual({
      refused: true,
      haltClass: "verification-failure",
      code: "stellar/unsuccessful-transaction",
      detail: expect.stringContaining("tx1"),
    });
  });

  it("recover REFUSES a failed transaction — no partial prefix leaks out of a failure", async () => {
    const r = await adapter.recover({ txHash: "tx1" }, reader({ tx1: failed }));
    expect("ok" in r).toBe(false);
    if (!("refused" in r)) throw new Error("expected a refusal");
    expect(r.code).toBe("stellar/unsuccessful-transaction");
  });

  it("observe REFUSES a failed transaction — never reports state:settled off a failure", async () => {
    const o = await adapter.observe({ txHash: "tx1" }, reader({ tx1: failed }));
    expect("ok" in o).toBe(false);
    if (!("refused" in o)) throw new Error("expected a refusal");
    expect(o.refused).toBe(true);
    expect(o.code).toBe("stellar/unsuccessful-transaction");
  });

  it("enumerate SKIPS failed transactions even when their mux id matches", async () => {
    const rdr = reader(
      { tx1: { muxedDestination: mAddr, successful: true }, tx2: failed },
      ["tx1", "tx2"],
    );
    const hits = await adapter.enumerate(ATR, "GACCOUNT", rdr);
    expect(hits.map((h) => h.txHash)).toEqual(["tx1"]);
  });

  it("an ABSENT successful field is not evidence of success — fail closed", async () => {
    // The reader gave no outcome. That is not a success, and a binding must never assume one.
    const r = await adapter.verify(
      ATR,
      { txHash: "tx1" },
      reader({ tx1: silent }),
    );
    expect("ok" in r).toBe(false);
    if (!("refused" in r)) throw new Error("expected a refusal");
    expect(r.code).toBe("stellar/unsuccessful-transaction");
  });

  it("enumerate skips a transaction whose outcome the reader did not report", async () => {
    const rdr = reader({ tx1: silent }, ["tx1"]);
    expect(await adapter.enumerate(ATR, "GACCOUNT", rdr)).toEqual([]);
  });

  it("enumerate skips a SUCCESSFUL transaction that has no muxed destination", async () => {
    // The success check alone is not enough: a plain successful payment carries no mux id, and the
    // destination guard is what keeps it out — both halves of the scan condition are load-bearing.
    const rdr = reader({ tx1: { muxedDestination: null, successful: true } }, [
      "tx1",
    ]);
    expect(await adapter.enumerate(ATR, "GACCOUNT", rdr)).toEqual([]);
  });

  it("the success gate is checked BEFORE the prefix match — a failed tx never reports a mismatch", async () => {
    // Refusal codes carry meaning: a failed transaction is not "the wrong ATR", it is "no settlement".
    const r = await adapter.verify(
      OTHER,
      { txHash: "tx1" },
      reader({ tx1: failed }),
    );
    if (!("refused" in r)) throw new Error("expected a refusal");
    expect(r.code).toBe("stellar/unsuccessful-transaction");
  });
});

/**
 * ⛔ **A transaction Horizon does not have is not a transaction with no muxed destination.**
 *
 * `StellarReader.settlementView` returned `StellarSettlementView` with no `null` in it, so a reader had no
 * way to say "no such transaction" — it had to invent a view, and the only view it could invent read as a
 * real transaction that paid an unmuxed address. Every surface then refused `stellar/no-muxed-destination`
 * about a hash Horizon had never heard of: a claim about a settlement, made where nothing was found to
 * make a claim about. Four sibling rails — solana, cardano, xrpl, hedera — all carry a
 * `no-such-transaction` reading for exactly this, and each cites the distinction; this rail is the one
 * they cite that could not make it.
 */
describe("a transaction the reader does not have", () => {
  it("all four surfaces report no-such-transaction, not no-muxed-destination", async () => {
    const rdr = reader({}, ["missing"]);
    const [v, r, o] = await Promise.all([
      adapter.verify(ATR, { txHash: "missing" }, rdr),
      adapter.recover({ txHash: "missing" }, rdr),
      adapter.observe({ txHash: "missing" }, rdr),
    ]);
    for (const outcome of [v, r, o]) {
      if (!("refused" in outcome)) throw new Error("expected a refusal");
      expect(outcome.code).toBe("stellar/no-such-transaction");
      expect(outcome.haltClass).toBe("verification-failure");
    }
    // A scan over hashes the reader cannot produce yields nothing, and throws nothing.
    expect(await adapter.enumerate(ATR, "GACCOUNT", rdr)).toEqual([]);
  });

  it("still says no-muxed-destination when the transaction EXISTS and paid an unmuxed address", async () => {
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: { muxedDestination: null, successful: true } }),
    );
    if (!("refused" in r)) throw new Error("expected a refusal");
    expect(r.code).toBe("stellar/no-muxed-destination");
  });
});

/**
 * A reader can hand back a `muxedDestination` string that is not a valid CAP-67 M-address — a G-address
 * (an unmuxed destination Horizon reports in the same field), a truncated StrKey, junk. `recoverMuxIdPrefix8`
 * answers `null` for those, and every surface must refuse rather than report a settlement with no prefix.
 */
describe("a destination string that is not a valid M-address", () => {
  const NOT_MUXED = { muxedDestination: G_PUBKEY, successful: true };

  it("recover refuses — it never returns a prefix it could not decode", async () => {
    const r = await adapter.recover(
      { txHash: "tx1" },
      reader({ tx1: NOT_MUXED }),
    );
    expect("ok" in r).toBe(false);
    if (!("refused" in r)) throw new Error("expected a refusal");
    expect(r.code).toBe("stellar/no-muxed-destination");
  });

  it("observe refuses — never state:settled with an undecodable destination", async () => {
    const o = await adapter.observe(
      { txHash: "tx1" },
      reader({ tx1: NOT_MUXED }),
    );
    expect("ok" in o).toBe(false);
    if (!("refused" in o)) throw new Error("expected a refusal");
    expect(o.refused).toBe(true);
    expect(o.code).toBe("stellar/no-muxed-destination");
  });

  it("verify refuses as no-muxed-destination — NOT as a prefix mismatch", async () => {
    // The codes carry meaning and must agree across surfaces. An undecodable destination has no mux id to
    // compare, so calling it a "mismatch" would claim the ATR was wrong when nothing was ever compared.
    const r = await adapter.verify(
      ATR,
      { txHash: "tx1" },
      reader({ tx1: NOT_MUXED }),
    );
    expect("ok" in r).toBe(false);
    if (!("refused" in r)) throw new Error("expected a refusal");
    expect(r.code).toBe("stellar/no-muxed-destination");
  });

  it("all four surfaces agree on the code for the same view", async () => {
    const rdr = reader({ tx1: NOT_MUXED }, ["tx1"]);
    const [v, r, o] = await Promise.all([
      adapter.verify(ATR, { txHash: "tx1" }, rdr),
      adapter.recover({ txHash: "tx1" }, rdr),
      adapter.observe({ txHash: "tx1" }, rdr),
    ]);
    for (const outcome of [v, r, o]) {
      if (!("refused" in outcome)) throw new Error("expected a refusal");
      expect(outcome.code).toBe("stellar/no-muxed-destination");
    }
    expect(await adapter.enumerate(ATR, "GACCOUNT", rdr)).toEqual([]);
  });

  it("mux-prefix-mismatch now means strictly: there WAS a mux id and it was wrong", async () => {
    const rdr = reader({
      tx1: settled(buildMuxedDestination(OTHER, G_PUBKEY)),
    });
    const r = await adapter.verify(ATR, { txHash: "tx1" }, rdr);
    if (!("refused" in r)) throw new Error("expected a refusal");
    expect(r.code).toBe("stellar/mux-prefix-mismatch");
  });

  it("enumerate skips it", async () => {
    const rdr = reader({ tx1: NOT_MUXED }, ["tx1"]);
    expect(await adapter.enumerate(ATR, "GACCOUNT", rdr)).toEqual([]);
  });
});

describe("enumerate — best-effort account scan (no native index)", () => {
  it("returns only the txs whose mux id matches the known atrHash's prefix-8", async () => {
    const mAtr = buildMuxedDestination(ATR, G_PUBKEY);
    const mOther = buildMuxedDestination(OTHER, G_PUBKEY);
    const rdr = reader(
      {
        tx1: settled(mAtr),
        tx2: settled(mOther),
        tx3: settled(mAtr),
        tx4: { muxedDestination: null },
      },
      ["tx1", "tx2", "tx3", "tx4"],
    );
    const hits = await adapter.enumerate(ATR, "GACCOUNT", rdr);
    expect(hits.map((h) => h.txHash)).toEqual(["tx1", "tx3"]);
  });
});
