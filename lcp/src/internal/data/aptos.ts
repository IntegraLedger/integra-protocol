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
      endpoint: ["fullnode-rest"],
      fallback: "fullnode-rest",
      search:
        "No search: found by the sender and its signed sequence number (`GET /v1/accounts/{sender}/transactions?start=n&limit=1`), " +
        "a named hash read first as a hint; where nothing is at the number, the account's own sequence number " +
        "(`GET /v1/accounts/{sender}`) with that answer's ledger time and history floor.",
      history:
        "a number passed with nothing returned at it, or an expiry passed, is decided only where `x-aptos-ledger-oldest-version` " +
        "of each answer is at or below the issue position; otherwise `history-gap`, on which the archive fallback is read",
      contracts: [],
      lapse:
        "nothing at the signed sequence number, and the account's sequence number has not passed it, at a ledger whose time " +
        "in whole seconds is at or past the signed expiry",
    },
    destination:
      "the committed transaction's fungible-asset deposits, each with its store's owner; on a charge one deposit's store " +
      "owner is compared with the option's payee",
    asset: "each deposit's asset, recorded as observed and compared with nothing",
    payer: "the sender",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment was taken, an account signed an agreement transaction carrying this ATR's hash on <network>, " +
      "recorded in <transaction>; this shows neither that the account is the payer nor what the agreement moved. The " +
      "ATR was assembled before the challenge went out, and the challenge advertised its hash and link. The payer's " +
      "signed Aptos transaction does not carry the hash. The resource server tied the hash to this payment when it " +
      "recorded the hash for this request, and the read identified the payment as the sender's committed transaction at " +
      "its signed sequence number, signed by an account other than the option's payee and depositing to a store the " +
      "payee owns. What it moved is recorded as observed: this does not show that amount, asset or timing match the " +
      "ATR's content.",
  },
});
