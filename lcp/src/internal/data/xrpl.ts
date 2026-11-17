/** The data of the XRPL pairings on x402 and MPP. */
import { freeze } from "./freeze.js";

const NOTE =
  "a rippled or Clio server answering `server_info`, `tx`, `account_tx`, `account_info` and `ledger_entry`, each " +
  "`account_info` and `ledger_entry` call naming its ledger, `validated` or `current`, never the server's default; one " +
  "mark, `validated`, the final mark; the search for H reads on to the latest ledger the server serves, no mark, where a " +
  "payment found is `pending`, `below-mark`";

const HISTORY =
  "`complete_ledgers` holding the ledgers from the issue ledger to the validated ledger the read is made at, and the " +
  "search beginning at the issue ledger; a range not held whole is `unreadable`, `history-gap`, never absence";

const ASSET =
  "`meta.delivered_amount`'s currency and issuer (`CUR:issuer`), XRP, or the MPT id; recorded and compared with nothing";

const PAYER =
  "`Account`, its signer `Delegate` where present, for the test that the payee did not sign; `Signers`, a `Delegate` " +
  "or an inner `Batch`'s parent recorded as the authority";

const SEARCH =
  "Found by the payer's `Account` with the signed `Sequence` or `TicketSequence`, read at the validated ledger and the " +
  "current one; the presented hash is a way to look. The search for H: the payer's `account_tx` from the issue ledger " +
  "to the latest ledger the server serves, read whole, every transaction of the payer's account whatever it moved, " +
  "never narrowed to a destination or an asset; one found above the validated ledger is `pending`, `below-mark`";

const LAPSE =
  "a validated ledger past the signed `LastLedgerSequence` with the sequence number not passed or the ticket present " +
  "(`instrument-unused`), the sequence or ticket taken by another transaction, a Payment to another account among them " +
  "(`instrument-consumed`), or a validated `tec` result (`transaction-failed`); each only once the search for H, read " +
  "whole, holds no act of the payer that is the act asked about. A transaction that signs no `LastLedgerSequence` has " +
  "no lapse. That `account_tx` lists every transaction of the payer's account, a delegated payment and an inner " +
  "`Batch` payment among them, is not yet shown by a run: until it is, a search read whole proves no absence, and the " +
  "read answers `pending`, `search-incomplete` where it would answer any of these three";

export const XRPL = /* @__PURE__ */ freeze({
  "x402/exact/xrpl": {
    coverage: "full",
    carrier: { signed: "the Payment's `InvoiceID`, the SHA-256 of H's LCP string", member: ["extra", "invoiceId"] },
    source: "stock `@x402/xrpl` 2.30.0, copying `extra.invoiceId`, which lcp's `advertise` sets to H's LCP string",
    nonce: "single-use",
    broadcasts: "payee",
    read: { endpoint: ["rippled"], note: NOTE, search: SEARCH, history: HISTORY, contracts: [], lapse: LAPSE },
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
      "The payer signed an XRPL Payment whose InvoiceID is the SHA-256 of this ATR's hash in LCP string form, and " +
      "it is in a validated ledger with tesSUCCESS: it paid the amount meta.delivered_amount states to the account " +
      "its Destination names. The hash can be confirmed from the ATR's bytes but not recovered from the ledger " +
      "alone. This does not show that amount, destination, asset or timing match the ATR's content.",
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
      search: `${SEARCH}. A pushed payment presented by its hash alone is found by that hash, which names the instrument`,
      history: HISTORY,
      contracts: [],
      lapse: LAPSE,
    },
    destination: "the Payment's `Destination`, compared on a charge with the option's payee",
    asset: ASSET,
    payer: PAYER,
    confirmed: "no",
    proves:
      "The payer signed an XRPL Payment whose InvoiceID is this ATR's hash, and it is in a validated ledger with " +
      "tesSUCCESS: it paid the amount meta.delivered_amount states to the account its Destination names. This does " +
      "not show that amount, destination, asset or timing match the ATR's content.",
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
      search: SEARCH.replace("payer's `Account`", "create's `Account`"),
      history: HISTORY,
      contracts: [],
      lapse: LAPSE.replace("a Payment to another account", "a channel to another account"),
    },
    destination: "the PayChannel's `Destination`, the create's, compared with the option's payee",
    asset: "XRP, the only asset of an in-band opening; the create's `Amount` recorded as observed",
    payer: PAYER,
    confirmed: "no",
    proves:
      "The payer signed an XRPL PaymentChannelCreate whose one LCP memo carries this ATR's hash, and it is in a " +
      "validated ledger with tesSUCCESS: it deposited the create's Amount into a channel whose beneficiary is the " +
      "account its Destination names. The memo is in the public transaction. Vouchers in this channel sign the " +
      "channel id and an amount, not the hash. This does not show that amount, deposit, destination, settle delay or " +
      "timing match the ATR's content.",
  },
  "mpp/session/xrpl/stock": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: a stock opening, which the buyer's client submits out of band, carries no H",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["rippled"],
      note: NOTE,
      search:
        "The channel the voucher names: its `PayChannel` at the validated ledger, then the `PaymentChannelCreate` whose " +
        "metadata creates that entry, in the `account_tx` of the channel's `Account`, or, where the validated ledger does " +
        "not show the channel, of the payer the credential's `source` names, from the ledger the create must come after " +
        "to the latest ledger the server serves",
      history: HISTORY,
      contracts: [],
      lapse:
        "none: a create the read finds has landed and succeeded. A channel another account opened, or one to another " +
        "account, is `failed`, `instrument-consumed`; one whose create is found at or before the position, `failed`, " +
        "`before-position`. One the validated ledger shows whose create the search, read whole, does not hold was created " +
        "at or before the position only if `account_tx` lists every transaction of the account, which no run has yet " +
        "shown: until one does, `pending`, `search-incomplete`, the search's position held where it began; on a server " +
        "that does not hold the range, `unreadable`, `history-gap`. One the validated ledger does not show whose create " +
        "the search, read whole, does not hold, `pending`, `not-found`",
    },
    destination: "the PayChannel's `Destination`, compared with the option's payee",
    asset: "XRP, the only asset of a channel; the create's `Amount` recorded as observed",
    payer: PAYER,
    agreementOn: "same-network",
    confirmed: "no",
    proves:
      "Before this session, an account signed an agreement transaction carrying this ATR's hash on the session's " +
      "XRPL network. The channel's create is in a validated ledger with tesSUCCESS: the account the voucher's " +
      "source names deposited the create's Amount into the channel the voucher names, whose beneficiary is the " +
      "account its Destination names, after the ledger the agreement was recorded at. The create does not carry the " +
      "hash, and this does not show that the account that signed the agreement is the one that opened the channel " +
      "unless the record compares the two. Vouchers sign the channel id and an amount, not the hash. This does not " +
      "show that amount, deposit, destination, settle delay or timing match the ATR's content.",
  },
  "x402/upto/xrpl": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: the payer's client opens the channel to `payTo` itself, and neither its create nor its claim carries H",
    nonce: "single-use",
    broadcasts: "payer",
    read: {
      endpoint: ["rippled"],
      note: NOTE,
      search:
        "The channel `payload.channelId` names: its `PayChannel` at the validated ledger, then the `PaymentChannelCreate` " +
        "whose metadata creates that entry, in the `account_tx` of the channel's `Account`, or, where the validated ledger " +
        "does not show the channel, of the payer `payload.payer` names, from the ledger the create must come after to " +
        "the latest ledger the server serves",
      history: HISTORY,
      contracts: [],
      lapse:
        "none: a create the read finds has landed and succeeded, its `Sequence` or ticket the single-use value. A channel " +
        "another account opened, or one to another account, is `failed`, `instrument-consumed`; one whose create is found " +
        "at or before the position, `failed`, `before-position`. One the validated ledger shows whose create the search, " +
        "read whole, does not hold was created at or before the position only if `account_tx` lists every transaction of " +
        "the account, which no run has yet shown: until one does, `pending`, `search-incomplete`, the search's position " +
        "held where it began; on a server that does not hold the range, `unreadable`, `history-gap`. One the validated " +
        "ledger does not show whose create the search, read whole, does not hold, `pending`, `not-found`",
    },
    destination: "the PayChannel's `Destination`, compared with the option's payee",
    asset: "XRP, the only asset of a channel; the create's `Amount` recorded as observed",
    payer: PAYER,
    agreementOn: "same-network",
    confirmed: "no",
    proves:
      "Before this payment, an account signed an agreement transaction carrying this ATR's hash on the payment's " +
      "XRPL network. The channel's create is in a validated ledger with tesSUCCESS: the account the payment's payer " +
      "names deposited the create's Amount into the channel the payment names, whose beneficiary is the account its " +
      "Destination names, after the ledger the agreement was recorded at. The create does not carry the hash, and " +
      "this does not show that the account that signed the agreement is the one that opened the channel unless the " +
      "record compares the two. The claim that closes the channel signs the channel id and an amount, not the hash, " +
      "and is not read. This does not show that amount, deposit, destination, settle delay or timing match the ATR's " +
      "content.",
  },
});
