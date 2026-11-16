// xrplOpenStatus: when an XRPL PaymentChannelCreate opening is final, and what the profile read-status answers for
// it. Expected values are xrpl.org's Finality of Results: "`tesSUCCESS` | Final when included in a validated ledger";
// "Any `tec` code | Final when included in a validated ledger"; "`tefMAX_LEDGER` | Final when a validated ledger has a
// ledger index higher than the transaction's `LastLedgerSequence` field, and no validated ledger includes the
// transaction"; and the `tx` method: a `txnNotFound` "on its own is not enough to know the final outcome"; with
// `min_ledger` and `max_ledger` the response includes `searched_all`. The read is no search for H, so every final
// answer but a settlement is pending, search-incomplete (read-status.md rules 23 and 24).
import { describe, expect, it } from "vitest";
import { ReaderError } from "../src/evm.js";
import { xrplOpenStatus, type XrplLanded, type XrplReader } from "../src/xrpl.js";

const ref = { network: "xrpl:1" as const, transaction: "AB".repeat(32), lastLedgerSequence: 1000, fromLedger: 900, payee: "rpjfAeE3DeeHPFnN2PgGFW5YxnZFAjrEyN" };

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

describe("xrplOpenStatus: the answers for an XRPL channel opening", () => {
  const VALIDATED = { act: "payment", finality: "validated" } as const;
  const INCOMPLETE = { state: "pending", reason: "search-incomplete", foreign: [] };

  it("an expiry, the whole range to LastLedgerSequence searched and a validated ledger past it, is search-incomplete, as a lookup that finds nothing is", async () => {
    const ranges: unknown[] = [];
    expect(await xrplOpenStatus(ref, reader({ notFound: true, searchedAll: true }, 1001, ranges), VALIDATED)).toEqual(INCOMPLETE);
    expect(ranges).toEqual([{ min: 900, max: 1000 }]);
    expect(await xrplOpenStatus(ref, reader({ notFound: true, searchedAll: true }, 1000), VALIDATED)).toEqual(INCOMPLETE);
    expect(await xrplOpenStatus(ref, reader({ notFound: true, searchedAll: false }, 2000), VALIDATED)).toEqual(INCOMPLETE);
  });

  it("an opening without LastLedgerSequence never expires", async () => {
    const open = { ...ref, lastLedgerSequence: null };
    expect(await xrplOpenStatus(open, reader({ notFound: true, searchedAll: true }, 5000), VALIDATED)).toEqual(INCOMPLETE);
  });

  it("a tec code in a validated ledger, and one not yet validated, are search-incomplete", async () => {
    expect(await xrplOpenStatus(ref, reader(landed(true, "tecNO_DST"), 1001), VALIDATED)).toEqual(INCOMPLETE);
    expect(await xrplOpenStatus(ref, reader(landed(false, "tecNO_DST"), 1001), VALIDATED)).toEqual(INCOMPLETE);
  });

  it("a validated tesSUCCESS that is not a PaymentChannelCreate settles nothing; one that is settles at its ledger index", async () => {
    expect(await xrplOpenStatus(ref, reader(landed(true, "tesSUCCESS", "Payment"), 1001), VALIDATED)).toEqual(INCOMPLETE);
    expect(await xrplOpenStatus(ref, reader(landed(true, "tesSUCCESS"), 1001), VALIDATED)).toEqual({
      state: "settled",
      transaction: ref.transaction,
      position: 990,
      finality: "validated",
      foreign: [],
    });
  });

  it("an opening at the position the query gives is before-position", async () => {
    expect(await xrplOpenStatus(ref, reader(landed(true, "tesSUCCESS"), 1001), { ...VALIDATED, after: 990 })).toEqual({
      state: "failed",
      reason: "before-position",
      transaction: ref.transaction,
      position: 990,
      finality: "validated",
      foreign: [],
    });
  });

  it("a failed read is unreadable, transport", async () => {
    expect(await xrplOpenStatus(ref, reader("error", 1001), VALIDATED)).toEqual({ state: "unreadable", reason: "transport", foreign: [] });
  });
});
