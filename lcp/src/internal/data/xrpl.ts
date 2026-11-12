/** The data of the XRPL pairings on x402 and MPP. */
import { freeze } from "./freeze.js";

const NOTE =
  "a rippled or Clio server answering `tx`, `account_tx`, `account_info`, `ledger_entry` and `server_info`, holding the " +
  "ledgers from the issue to the latest ledger it serves";

const HISTORY = "the endpoint holds the whole range from the issue ledger; a range not held whole is `unreadable`, `history-gap`, never absence";

const ASSET = "`meta.delivered_amount`'s currency and issuer, XRP, or the MPT id; recorded and compared with nothing";

const PAYER = "`Account`, and `Delegate` where present, for the test that the payee did not sign";

export const XRPL = /* @__PURE__ */ freeze({
  "x402/exact/xrpl": {
    coverage: "full",
    carrier: { signed: "the Payment's `InvoiceID`, the SHA-256 of H's LCP string", member: ["extra", "invoiceId"] },
    source: "stock `@x402/xrpl` 2.30.0, copying `extra.invoiceId`, which lcp's `advertise` sets to H's LCP string",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["rippled"],
      note: NOTE,
      search:
        "Found by the buyer's `Account` with the signed `Sequence` or `TicketSequence`, in `account_tx` from the issue " +
        "ledger to the signed `LastLedgerSequence`. Before every `failed` but `before-position`, the search for H over the " +
        "payer's `account_tx`, read whole to the latest ledger the server serves.",
      history: HISTORY,
      contracts: [],
      lapse:
        "the signed `LastLedgerSequence` passed in a validated ledger with the sequence or ticket unused, the sequence or " +
        "ticket taken by another transaction, or a `tec` result; each only once the search for H, read whole, holds no " +
        "payment for H",
    },
    destination: "the Payment's `Destination`, compared on a charge with the option's payee",
    asset: ASSET,
    payer: PAYER,
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the buyer, in the Payment it signs",
      succeeded:
        "the transaction is in a validated ledger with `meta.TransactionResult` `tesSUCCESS`, a Payment whose `InvoiceID` " +
        "is the pairing's carrier for H; its `Destination` and `meta.delivered_amount` are recorded as observed",
    },
    proves:
      "The payer signed, with a single key, an XRPL Payment whose InvoiceID is the SHA-256 of this ATR's hash " +
      "in LCP string form, and the Payment is in a validated ledger with tesSUCCESS. The hash can be confirmed " +
      "from the ATR's bytes but not recovered from the ledger alone. This does not show that amount, " +
      "destination, asset or timing match the ATR's content.",
  },
  "mpp/charge/xrpl": {
    coverage: "full",
    carrier: { signed: "the Payment's `InvoiceID`, H itself", member: ["methodDetails", "invoiceId"] },
    source: "stock `xrpl-mpp-sdk` 0.1.0-beta.4, copying `methodDetails.invoiceId`, on pull and on push",
    nonce: "single-use",
    broadcasts: "either",
    read: {
      endpoint: ["rippled"],
      note: NOTE,
      search:
        "Found by the buyer's `Account` with the signed `Sequence` or `TicketSequence`, in `account_tx` from the issue " +
        "ledger to the signed `LastLedgerSequence`; a pushed payment is read through the codec's read of the presented " +
        "payment. Before every `failed` but `before-position`, the payer's `account_tx` read whole to the latest ledger.",
      history: HISTORY,
      contracts: [],
      lapse:
        "the signed `LastLedgerSequence` where one is signed, the sequence or ticket taken by another transaction or a " +
        "Payment to another account, or a `tec` result; each only once the search for H, read whole, holds no payment for H",
    },
    destination: "the Payment's `Destination`, compared on a charge with the option's payee",
    asset: ASSET,
    payer: PAYER,
    confirmed: "no",
    proves:
      "The payer signed, with a single key, an XRPL Payment whose InvoiceID is this ATR's hash, and the " +
      "Payment is in a validated ledger with tesSUCCESS. This does not show that amount, destination, asset or " +
      "timing match the ATR's content.",
  },
  "mpp/session/xrpl": {
    coverage: "full",
    carrier: { signed: "one memo, H's LCP string, in the `PaymentChannelCreate` the buyer signs and the server submits" },
    source: "lcp's client; a stock client writes no memo, and its opening is refused before the server submits it",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["rippled"],
      note: NOTE,
      search:
        "Found by the create's `Account` and its `Sequence` or ticket in `account_tx`; before every `failed` but " +
        "`before-position`, the payer's `account_tx` read whole to the latest ledger the server serves.",
      history: HISTORY,
      contracts: [],
      lapse:
        "the create's signed `LastLedgerSequence`, the sequence or ticket taken by another transaction or a channel to " +
        "another account, or a `tec` result; each only once the search for H, read whole, holds no payment for H",
    },
    destination: "the PayChannel's `Destination`, compared with the option's payee",
    asset: "XRP, the only asset of an in-band opening; the create's `Amount` recorded as observed",
    payer: "the create's `Account`",
    confirmed: "no",
    proves:
      "The payer signed, with a single key, an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's " +
      "hash, and it is in a validated ledger with tesSUCCESS. The memo is in the public transaction. Vouchers " +
      "in this channel sign the channel id and an amount, not the hash. This does not show that amount, " +
      "deposit, destination, settle delay or timing match the ATR's content.",
  },
});
