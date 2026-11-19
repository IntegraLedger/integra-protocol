/** The data of the Hedera pairings. */
import { freeze } from "./freeze.js";

/** The payee's preconditions, which no validation reads (x402-exact-hedera.md rule 18, mpp-method-lcp.md rule 23). */
const HEDERA_PAYEE = [
  "the account exists",
  "for an HTS asset, the account is associated with the token or holds a free automatic association",
  "the account does not require a receiver's signature, since a credited account with `receiverSigRequired` set " +
    "must sign the transaction",
  "for an HTS token, the account is granted KYC where the token has a KYC key, and is not frozen for the token",
];

export const HEDERA = /* @__PURE__ */ freeze({
  "x402/exact/hedera": {
    coverage: "full",
    carrier: { signed: "the memo of the transfer body the buyer signs: H's LCP string (77 bytes), all of H, in lowercase hex" },
    source: "lcp's client; the stock x402 client writes no memo, and its payment is refused before the settler submits",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["mirror-rest"],
      note: "the mirror node's REST interface",
      search:
        "Found by the transaction id fixed in what the buyer signs (`GET /api/v1/transactions/{id}`). Before every `failed` " +
        "but `before-position`, the search for H over the debited account's transactions after the position " +
        "(`GET /api/v1/transactions?account.id=`), 100 a page, at most 8 pages a read, to the mirror's latest consensus " +
        "timestamp, each `memo_base64` compared with H's string; never read whole until a run shows the three facts it " +
        "rests on, so it proves no absence and every such `failed` is `pending`, `search-incomplete`.",
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
    payeePreconditions: HEDERA_PAYEE,
    confirmed: "yes",
    agreement: {
      floor: "1",
      fee: "the seller's settler (the account the transaction id names)",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "the mirror's record of the transaction id with nonce 0 and `scheduled` false has result `SUCCESS`, its " +
        "`memo_base64` decodes to H's LCP string, and its transfers debit the buyer with `is_approval` false; what they " +
        "credit is recorded as observed",
    },
    proves:
      "The payer's own signed act carries this ATR's hash: a Hedera crypto transfer whose memo is the hash's LCP " +
      "string reached consensus with SUCCESS, debiting the payer, the one account its rows debit, and paid the " +
      "account it credits, recorded with the asset and amount it moved. The memo is in the public transaction " +
      "record, readable by transaction id. It compares no amount, asset or time with the ATR's terms.",
  },
  "mpp/charge/lcp/hedera": {
    coverage: "full",
    carrier: { signed: "the memo of the TransferTransaction body the buyer signs: H's LCP string (77 bytes), all of H, in lowercase hex" },
    source: "lcp's client; no stock client implements the `lcp` method",
    nonce: "single-use",
    broadcasts: "either",
    read: {
      endpoint: ["mirror-rest"],
      note: "the mirror node's REST interface",
      search:
        "Found by the transaction id fixed in what the buyer signs (`GET /api/v1/transactions/{id}`). Before every `failed` " +
        "but `before-position`, the search for H over the debited account's transactions after the position " +
        "(`GET /api/v1/transactions?account.id=`), 100 a page, at most 8 pages a read, to the mirror's latest consensus " +
        "timestamp, each `memo_base64` compared with H's string; never read whole until a run shows the three facts it " +
        "rests on, so it proves no absence and every such `failed` is `pending`, `search-incomplete`.",
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
        rule: "the body's `validDuration` from the valid start, which the chain holds to its `transaction.maxValidDuration`, 180 seconds as lcp holds it; a valid start later than the clock reading `validate` is given is refused",
      },
    },
    destination:
      "the credited account of the mirror record's `transfers` (HBAR) or `token_transfers`, compared on a charge with the " +
      "challenge's `recipient`",
    asset: "HBAR (0.0.0) from `transfers`, or the token id from `token_transfers`; recorded and compared with nothing",
    payer:
      "the one account the signed body debits (`is_approval` false): never the account the transaction id names where " +
      "`feePayer` is true, and that account where it is not",
    payeePreconditions: HEDERA_PAYEE,
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the account the transaction id names: the submitter's `feePayerAccountId` where `feePayer` is true, else the buyer",
      feePayer: { may: ["settler", "buyer"], default: "buyer" },
      succeeded:
        "the mirror's record of the transaction id with nonce 0 and `scheduled` false has result `SUCCESS`, its " +
        "`memo_base64` decodes to H's LCP string, and its transfers debit the buyer with `is_approval` false; what they " +
        "credit is recorded as observed",
    },
    proves:
      "The payer's own signed act carries this ATR's hash: a Hedera crypto transfer whose memo is the hash's LCP " +
      "string reached consensus with SUCCESS, debiting the payer, the one account its rows debit, and paid the " +
      "account it credits, recorded with the asset and amount it moved. The memo is in the public transaction " +
      "record, readable by transaction id. It compares no amount, asset or time with the ATR's terms.",
  },
  "x402/exact/hedera/transfer-executor": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: nothing the payer signs carries H, which reaches the payer only in the option's extension and returns unsigned",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "any",
    read: {
      endpoint: ["mirror-rest"],
      note: "the mirror node's REST interface",
      search:
        "The transaction the facilitator names, by its id (`GET /api/v1/transactions/{id}`), in its merged consensus " +
        "record, the user entry and its child entries; no search, the act being the transaction named.",
      history:
        "the mirror holds records back to the named transaction's valid start, by the first timestamp of its oldest block " +
        "or the endpoint's archival declaration; otherwise `unreadable`, `history-gap`",
      contracts: [],
      lapse:
        "the named transaction id, single-use: consumed by an entry under it that decides, or unconsumed with its valid " +
        "start plus 180 seconds, the chain's longest `validDuration`, strictly before the mirror's latest consensus timestamp",
    },
    destination: "the account the merged record credits, other than the node's and the fee accounts', compared with the option's payee",
    asset: "HBAR (0.0.0) or the token id of each credited row; recorded and compared with nothing",
    payer: "the one account the merged record debits, compared by its digest with the payer `reference` recorded",
    confirmed: "no",
    proves:
      "Before this payment was taken, an account signed an agreement carrying this ATR's hash on <network>, recorded " +
      "in <transaction>; this does not show that the account is the payer. The payment is an x402 transferExecutor " +
      "payment on Hedera: the payer's executor contract moved the funds under an authorization the seller did not " +
      "read, and the facilitator submitted the transaction. The hash reached the payer only in the challenge's " +
      "extension, and nothing the payer signed carries it. The read of the named transaction's merged consensus " +
      "record found that its one debited account is the payer recorded when the payment was presented, and that it " +
      "credited the payee. It compares no amount, asset or time with the ATR's terms.",
  },
  "mpp/session/hedera/stock": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: the stock client sends `approve` and `open` itself, with a random salt",
    nonce: "unshown",
    broadcasts: "either",
    agreementOn: "same-network",
    read: {
      endpoint: ["json-rpc", "mirror-rest"],
      note:
        "the network's JSON-RPC relay, which reads the opening, and its mirror node's REST interface, which resolves the " +
        "opening's payer and payee to account ids; a network that declares no relay is not served",
      search:
        "The opening by the transaction hash its credential names (`eth_getTransactionReceipt`), at the relay's " +
        "`finalized` block, every block the relay serves being final; no search.",
      history:
        "the mirror holds the blocks after the position the opening must come after, by the number of its oldest block " +
        "or the endpoint's archival declaration; otherwise a hash with no receipt is `unreadable`, `history-gap`",
      contracts: ["the escrow the challenge's `methodDetails.escrowContract` names"],
      lapse:
        "none but the revert: a named hash that never lands is read until the caller's own bound ends, answering " +
        "`pending`, `not-found`",
    },
    destination:
      "the escrow's `ChannelOpened` `payee`, resolved by the mirror (`GET /api/v1/accounts/{address}`) to an account id " +
      "and compared with the account the challenge's `recipient` names",
    asset: "the `ChannelOpened` token and deposit, recorded as observed and compared with nothing",
    payer:
      "the `ChannelOpened` `payer`, an EVM address, resolved by the mirror to the account id that opened the channel; an " +
      "address it resolves to no account is another account",
    confirmed: "no",
    proves:
      "Before this session, an account signed an agreement transaction carrying this ATR's hash on the session's " +
      "Hedera network. The opening the credential names reached consensus: the account its ChannelOpened log names " +
      "as payer deposited the deposit into the escrow's channel, whose payee the log names, after the block the " +
      "agreement was recorded at. The opening does not carry the hash, and this does not show that the account that " +
      "signed the agreement is the one that opened the channel unless the record compares the two. Vouchers sign the " +
      "channel id and an amount, not the hash. This does not show that amount, deposit, payee or timing match the " +
      "ATR's content.",
  },
});
