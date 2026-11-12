/** The data of the Aptos pairing. */
import { freeze } from "./freeze.js";

export const APTOS = /* @__PURE__ */ freeze({
  "x402/exact/aptos": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "nobody",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: "fullnode-rest, with a declared archive fallback",
      search:
        "No search: found by the sender and its signed sequence number (`GET /v1/accounts/{sender}/transactions?start=n&limit=1`); " +
        "where that returns nothing, the account's own sequence number with the ledger time of that answer.",
      history:
        "an empty lookup is absence only where `x-aptos-ledger-oldest-version` is at or below the issue position; otherwise " +
        "`history-gap`, on which the archive fallback is read",
      contracts: [],
      lapse:
        "nothing at the signed sequence number, and the account's sequence number has not passed it, at a ledger whose time " +
        "is at or past the signed expiry",
    },
    destination:
      "the committed transaction's fungible-asset deposits, each with its store's owner; on a charge one deposit's store " +
      "owner is compared with the option's payee",
    asset: "each deposit's asset, recorded as observed and compared with nothing",
    payer: "the sender",
    agreementOn: "any",
    confirmed: "yes",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The ATR was assembled before the challenge went out, and the " +
      "challenge advertised its hash and link. The payer's signed Aptos transaction does not carry the hash. " +
      "The seller tied the hash to this payment when it claimed it for this request, and identified the " +
      "settlement as the payer's committed transaction by sender, sequence number and a digest of its " +
      "transfer. This does not show that the buyer's approval carried the hash, or that amount, payee, asset " +
      "or timing match the ATR's content.",
  },
});
