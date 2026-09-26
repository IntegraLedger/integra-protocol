// xrplOpenStatus: when an XRPL PaymentChannelCreate opening is final, and which answers are releases. Expected values
// are xrpl.org's Finality of Results: "`tesSUCCESS` | Final when included in a validated ledger"; "Any `tec` code |
// Final when included in a validated ledger"; "`tefMAX_LEDGER` | Final when a validated ledger has a ledger index higher
// than the transaction's `LastLedgerSequence` field, and no validated ledger includes the transaction"; and the `tx`
// method: a `txnNotFound` "on its own is not enough to know the final outcome"; with `min_ledger` and `max_ledger` the
// response includes `searched_all`.
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { xrplOpenStatus, type XrplLanded, type XrplReader } from "../src/xrpl.js";

const ref = { network: "xrpl:1" as const, transaction: "AB".repeat(32), lastLedgerSequence: 1000, fromLedger: 900 };

function reader(answer: XrplLanded | { notFound: true; searchedAll: boolean } | "error", validated: number, ranges: unknown[] = []): XrplReader {
  return {
    network: "xrpl:1",
    tx: async (_hash, range) => {
      ranges.push(range);
      if (answer === "error") throw new ReaderError("transport");
      return answer;
    },
    txBlob: async () => null,
    validatedLedger: async () => validated,
  };
}

const landed = (validated: boolean, result: string, transactionType = "PaymentChannelCreate"): XrplLanded => ({
  validated,
  result,
  ledgerIndex: 990,
  transactionType,
});

describe("xrplOpenStatus: release reasons for an XRPL channel opening", () => {
  it("expired only when the whole range to LastLedgerSequence was searched and a validated ledger is past it", async () => {
    const ranges: unknown[] = [];
    expect(await xrplOpenStatus(ref, reader({ notFound: true, searchedAll: true }, 1001, ranges))).toEqual({ state: "failed", why: "expired" });
    expect(ranges).toEqual([{ min: 900, max: 1000 }]);
    expect(await xrplOpenStatus(ref, reader({ notFound: true, searchedAll: true }, 1000))).toEqual({ state: "pending", why: "not-found" });
    expect(await xrplOpenStatus(ref, reader({ notFound: true, searchedAll: false }, 2000))).toEqual({ state: "pending", why: "not-found" });
  });

  it("an opening without LastLedgerSequence never expires", async () => {
    const open = { ...ref, lastLedgerSequence: null };
    expect(await xrplOpenStatus(open, reader({ notFound: true, searchedAll: true }, 5000))).toEqual({ state: "pending", why: "not-found" });
  });

  it("claimed-fee for a tec code in a validated ledger; not before it is validated", async () => {
    expect(await xrplOpenStatus(ref, reader(landed(true, "tecNO_DST"), 1001))).toEqual({ state: "failed", why: "claimed-fee" });
    expect(await xrplOpenStatus(ref, reader(landed(false, "tecNO_DST"), 1001))).toEqual({ state: "pending", why: "not-validated" });
  });

  it("a validated tesSUCCESS that is not a PaymentChannelCreate is not this instrument, never expired", async () => {
    expect(await xrplOpenStatus(ref, reader(landed(true, "tesSUCCESS", "Payment"), 1001))).toEqual({
      state: "failed",
      why: "not-this-instrument",
    });
    expect(await xrplOpenStatus(ref, reader(landed(true, "tesSUCCESS"), 1001))).toEqual({ state: "settled", ledgerIndex: 990 });
  });

  it("a failed read is pending", async () => {
    expect(await xrplOpenStatus(ref, reader("error", 1001))).toEqual({ state: "pending", why: "unreadable" });
  });
});
