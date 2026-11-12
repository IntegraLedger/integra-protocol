/** The data of the Hedera pairings. */
import { freeze } from "./freeze.js";

export const HEDERA = /* @__PURE__ */ freeze({
  "x402/exact/hedera": {
    coverage: "full",
    carrier: { signed: "the memo of the transfer body the buyer signs: H's LCP string (77 bytes), all of H, in lowercase hex" },
    source: "lcp's client; the stock x402 client writes no memo, and its payment is refused before the settler submits",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: "the mirror node's REST interface",
      search:
        "Found by the transaction id fixed in what the buyer signs (`GET /api/v1/transactions/{id}`). Before every `failed` " +
        "but `before-position`, the search for H over the debited account's transactions after the position, paged to the " +
        "mirror's latest consensus timestamp, each `memo_base64` compared with H's string.",
      history:
        "the mirror holds records back to the valid start, and for the search back to the position, by the first timestamp " +
        "of its oldest block or the endpoint's archival declaration; otherwise `unreadable`, `history-gap`",
      contracts: [],
      lapse:
        "the transaction id consumed by a record that does not settle the payment, or unconsumed with valid start plus " +
        "`validDuration` strictly before the mirror's latest consensus timestamp; each only once the search for H, read " +
        "whole, finds no record that settles",
      life: {
        value: 180,
        unit: "seconds",
        rule: "the body's `validDuration` from the valid start, which the chain holds to its `transaction.maxValidDuration`, 180 seconds as lcp holds it; a valid start later than the time of the check is refused",
      },
    },
    destination:
      "the credited account of the mirror record's `transfers` (HBAR) or `token_transfers`, compared on a charge with the " +
      "option's payee",
    asset: "HBAR (0.0.0) from `transfers`, or the token id from `token_transfers`; recorded and compared with nothing",
    payer: "the one account the signed body debits (`is_approval` false), never the account the transaction id names (the settler's)",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the seller's settler (the account the transaction id names)",
      succeeded:
        "the mirror's record of the transaction id with nonce 0 and `scheduled` false has result `SUCCESS`, its " +
        "`memo_base64` decodes to H's LCP string, and its transfers debit the buyer with `is_approval` false; what they " +
        "credit is recorded as observed",
    },
    proves:
      "The payer signed a Hedera transaction body whose memo carries this ATR's hash in LCP string form. A " +
      "transaction under that body's id with that memo reached consensus with SUCCESS, and the memo is in the " +
      "public transaction record; the fee payer, the seller's facilitator, could land another body under the " +
      "same id. This does not show that amount, recipient, token or timing match the ATR's content.",
  },
  "x402/exact/hedera/transfer-executor": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: nothing the payer signs carries H, which reaches the payer only in the option's extension and returns unsigned",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The payment is an x402 transferExecutor payment on Hedera: the " +
      "payer's executor contract moved the funds under an authorization the seller did not read, and the " +
      "facilitator submitted the transaction. The hash reached the payer only in the challenge's extension, " +
      "and nothing the payer signed carries it. The seller read the merged consensus record of the named " +
      "transaction, and found that its one debited account, by at least one unit, is the payer recorded at " +
      "claim. This does not show that amount, recipient, token or timing match the ATR's content.",
  },
});
