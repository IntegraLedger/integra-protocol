import { describe, expect, it } from "vitest";
import {
  createXrplAdapter,
  recoverAtrHashFromPayment,
  type XrplPaymentView,
  type XrplReader,
} from "../src/adapter.js";
import { decodeInvoiceId, encodeInvoiceId } from "../src/invoice-id.js";
import { XRPL_MANIFEST } from "../src/manifest.js";
import { buildLcpMemo, type XrplMemo } from "../src/memo.js";

const ATR =
  "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
const OTHER =
  "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function settledView(memos: ReadonlyArray<XrplMemo>): XrplPaymentView {
  // The LEGACY shape: a payment welded before 2026-08-08 carries no InvoiceID. Kept as the fixture for
  // the memo path so the read-only legacy branch stays exercised.
  return {
    invoiceId: undefined,
    memos,
    validated: true,
    engineResult: "tesSUCCESS",
  };
}

/** The CURRENT shape: the atrHash rides InvoiceID and no memo is present (x402 rejects memo-bearing txs). */
function settledInvoiceView(atrHash: string): XrplPaymentView {
  return {
    invoiceId: encodeInvoiceId(atrHash),
    memos: undefined,
    validated: true,
    engineResult: "tesSUCCESS",
  };
}

describe("createXrplAdapter.propose", () => {
  it("builds the InvoiceID carrying the atrHash", () => {
    const adapter = createXrplAdapter(XRPL_MANIFEST);
    expect(decodeInvoiceId(adapter.propose({ atrHash: ATR }))).toBe(ATR);
  });

  it("REFUSES when the seller also binds an x402 extra.invoiceId", () => {
    // The two welds are mutually exclusive per transaction and NOTHING on-chain tells them apart — an
    // atrHash and SHA-256("INV-2025-001") are both 32 opaque bytes. Proposal time is the only moment that
    // information exists, so it is the only place the collision can be caught.
    const adapter = createXrplAdapter(XRPL_MANIFEST);
    expect(() =>
      adapter.propose({ atrHash: ATR, usesX402InvoiceBinding: true }),
    ).toThrow(/mutually exclusive/);
  });
});

describe("recoverAtrHashFromPayment", () => {
  it("recovers a settled, welded Payment", () => {
    expect(recoverAtrHashFromPayment(settledView([buildLcpMemo(ATR)]))).toBe(
      ATR,
    );
  });
  it("refuses an unvalidated tx (fail closed — moved no funds yet)", () => {
    expect(
      recoverAtrHashFromPayment({
        invoiceId: undefined,
        memos: [buildLcpMemo(ATR)],
        validated: false,
        engineResult: undefined,
      }),
    ).toBeNull();
  });
  it("refuses a validated-but-failed engine result (tec* lands in the ledger, moves no funds)", () => {
    expect(
      recoverAtrHashFromPayment({
        invoiceId: undefined,
        memos: [buildLcpMemo(ATR)],
        validated: true,
        engineResult: "tecUNFUNDED_PAYMENT",
      }),
    ).toBeNull();
  });
  it("returns null for a settled Payment with no LCP memo", () => {
    expect(recoverAtrHashFromPayment(settledView([]))).toBeNull();
    expect(recoverAtrHashFromPayment(null)).toBeNull();
  });
});

describe("createXrplAdapter (I/O over XrplReader)", () => {
  const adapter = createXrplAdapter(XRPL_MANIFEST);

  function reader(
    views: Record<string, XrplPaymentView | null>,
    account: Record<string, string[]> = {},
  ): XrplReader {
    return {
      async paymentView(txHash: string): Promise<XrplPaymentView | null> {
        return views[txHash] ?? null;
      },
      async paymentHashesFor(acct: string): Promise<string[]> {
        return account[acct] ?? [];
      },
    };
  }

  it("recover returns the welded atrHash", async () => {
    const r = await adapter.recover(
      { txHash: "TX1" },
      reader({ TX1: settledView([buildLcpMemo(ATR)]) }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("recover refuses (verification-failure) when no atr memo is present", async () => {
    const r = await adapter.recover(
      { txHash: "TX1" },
      reader({ TX1: settledView([]) }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "xrpl/no-atr-weld",
      detail: expect.stringContaining("validated tesSUCCESS Payment"),
    });
  });

  it("recover refuses a transaction rippled does not have — absence is not failure", async () => {
    const r = await adapter.recover({ txHash: "MISSING" }, reader({}));
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "xrpl/no-such-transaction",
      detail: expect.stringContaining("nothing settled there"),
    });
  });

  it("recover refuses an unvalidated Payment as unsuccessful — whatever it carries is not a weld", async () => {
    const r = await adapter.recover(
      { txHash: "TX1" },
      reader({
        TX1: {
          invoiceId: encodeInvoiceId(ATR),
          memos: undefined,
          validated: false,
          engineResult: undefined,
        },
      }),
    );
    expect(r).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "xrpl/unsuccessful-transaction",
      detail: expect.stringContaining("is not a weld"),
    });
  });

  it("recover reads the InvoiceID weld", async () => {
    const r = await adapter.recover(
      { txHash: "TX1" },
      reader({ TX1: settledInvoiceView(ATR) }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("InvoiceID WINS over a legacy memo when a payment carries both", async () => {
    // Order is not arbitrary: the memo path exists only for payments welded before the move, so a payment
    // carrying both has an InvoiceID that is the current, x402-settleable weld.
    const other = `0x${"cd".repeat(32)}`;
    const r = await adapter.recover(
      { txHash: "TX1" },
      reader({
        TX1: {
          invoiceId: encodeInvoiceId(ATR),
          memos: [buildLcpMemo(other)],
          validated: true,
          engineResult: "tesSUCCESS",
        },
      }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("still recovers a LEGACY memo weld when no InvoiceID is present", async () => {
    // The read-only legacy branch. Discarding these would lose real records welded before the carrier
    // moved; nothing emits one now.
    const r = await adapter.recover(
      { txHash: "TX1" },
      reader({ TX1: settledView([buildLcpMemo(ATR)]) }),
    );
    expect(r).toEqual({ ok: true, value: ATR });
  });

  it("observe reports the settled transition", async () => {
    const o = await adapter.observe(
      { txHash: "TX1" },
      reader({ TX1: settledView([buildLcpMemo(ATR)]) }),
    );
    expect(o).toEqual({ ok: true, value: { state: "settled", atrHash: ATR } });
  });

  it("observe PROPAGATES the refusal — it never reports a settlement that is not there", async () => {
    // Without the forward, observe answers `{state: "settled", atrHash: undefined}` for a hash
    // rippled does not have.
    const o = await adapter.observe({ txHash: "MISSING" }, reader({}));
    expect(o).toMatchObject({
      refused: true,
      haltClass: "verification-failure",
      code: "xrpl/no-such-transaction",
    });
  });

  it("the factory refuses another rail's manifest — fail-fast, never a silent misreport", () => {
    expect(() => createXrplAdapter(XRPL_MANIFEST)).not.toThrow();
    expect(() =>
      createXrplAdapter({ ...XRPL_MANIFEST, rail: "solana" }),
    ).toThrow('manifest.rail "solana" is not "xrpl"');
  });

  it("enumerate throws on a malformed atrHash — a silent [] is not an answer", async () => {
    await expect(
      adapter.enumerate("not-a-hash", "rSomeAccount", reader({})),
    ).rejects.toThrow("enumerate: atrHash must be a 0x-prefixed 32-byte value");
  });

  it("enumerate scans an account's Payments and returns only the atrHash matches", async () => {
    const rdr = reader(
      {
        TX1: settledView([buildLcpMemo(ATR)]),
        TX2: settledView([buildLcpMemo(OTHER)]),
        TX3: settledView([buildLcpMemo(ATR)]),
      },
      { rSomeAccount: ["TX1", "TX2", "TX3"] },
    );
    const hits = await adapter.enumerate(ATR, "rSomeAccount", rdr);
    expect(hits.map((h) => h.txHash)).toEqual(["TX1", "TX3"]);
  });

  it("enumerate excludes an unvalidated Payment even if it carries the atrHash", async () => {
    const rdr = reader(
      {
        TX1: settledView([buildLcpMemo(ATR)]),
        TX2: {
          invoiceId: undefined,
          memos: [buildLcpMemo(ATR)],
          validated: false,
          engineResult: undefined,
        },
      },
      { rSomeAccount: ["TX1", "TX2"] },
    );
    const hits = await adapter.enumerate(ATR, "rSomeAccount", rdr);
    expect(hits.map((h) => h.txHash)).toEqual(["TX1"]);
  });
});

describe("enumerate skips payments that carry no weld", () => {
  it("returns only the matching ones, and never a weldless payment", () => {
    // Without the `atr !== null` term, a validated payment with no InvoiceID and no memo would be pushed
    // as a settlement of whatever atrHash was being searched for — a fabricated weld at scan scale.
    const adapter = createXrplAdapter(XRPL_MANIFEST);
    const other = `0x${"cd".repeat(32)}`;
    return expect(
      adapter.enumerate(ATR, "rAccount", {
        async paymentView(h) {
          if (h === "HIT") return settledInvoiceView(ATR);
          if (h === "OTHER") return settledInvoiceView(other);
          return {
            invoiceId: undefined,
            memos: undefined,
            validated: true,
            engineResult: "tesSUCCESS",
          };
        },
        async paymentHashesFor() {
          return ["HIT", "OTHER", "NOWELD"];
        },
      }),
    ).resolves.toEqual([{ txHash: "HIT" }]);
  });
});
