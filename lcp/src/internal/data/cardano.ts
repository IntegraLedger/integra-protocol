/** The data of the Cardano pairing. */
import { freeze } from "./freeze.js";

export const CARDANO = /* @__PURE__ */ freeze({
  "x402/exact/cardano": {
    coverage: "full",
    carrier: {
      signed:
        "CIP-20 metadata, label 674, holding H's LCP string, to which the signed body's auxiliary-data hash (key 7) commits; all of H",
    },
    source: "lcp's client; no stock client writes it",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["indexer-rest"],
      note: "Blockfrost or Koios, holding the chain from genesis",
      search:
        "Keyed by the transaction id (the Blake2b-256 of the signed body). Before every `failed` but `before-position`, the " +
        "search for H over the transactions of the payment credential that holds the input `payload.nonce` names, from the " +
        "issue position to the tip, read whole; the payee is never a key.",
      history:
        "a documented not-found is absence where the endpoint holds the chain from genesis; an endpoint that answers no read " +
        "of the block at the position recorded at issue is `history-gap`",
      contracts: [],
      lapse:
        "the body's TTL passed with the input `payload.nonce` names unspent, and the search for H read whole with no payer " +
        "act for H found",
    },
    destination:
      "the signed body's outputs to addresses other than the payer's credential, recorded as observed; on a charge an output " +
      "pays the payee where its address has the payee's payment credential, whatever its stake part",
    asset: "what the outputs carry, recorded as observed and compared with nothing",
    payer: "the payment credential that holds the input `payload.nonce` names",
    confirmed: "no",
    agreement: {
      floor: "rule",
      fee: "the buyer, as a field of the body balanced against the buyer's own inputs; the seller has no option",
      succeeded:
        "the transaction whose id is the Blake2b-256 of the signed body is in a block at the mark with `valid_contract` true " +
        "and its metadata 674 holds H; what its outputs pay is recorded as observed and compared with nothing",
    },
    proves:
      "The payer signed a Cardano transaction whose body commits, through its auxiliary_data_hash, to a CIP-20 " +
      "message (label 674) carrying this ATR's hash. The ledger included the transaction as valid, at the " +
      "stated depth; a Cardano transaction with fewer than k blocks after it (2160 on mainnet) can be rolled " +
      "back. The hash is in the transaction's metadata on chain. This does not show that amount, payee, asset " +
      "or timing match the ATR's content.",
  },
});
