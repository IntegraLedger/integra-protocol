/** The data of the Cardano pairings. */
import { freeze } from "./freeze.js";

const carrier = {
  signed:
    "CIP-20 metadata, label 674, holding H's LCP string, to which the signed body's auxiliary-data hash (key 7) commits; all of H",
} as const;

const read = {
  endpoint: ["indexer-rest"],
  note: "Blockfrost or Koios, holding the chain from genesis; marks are counts of confirmations, the final one the ledger's security parameter from the endpoint's genesis",
  search:
    "Keyed by the transaction id (the Blake2b-256 of the signed body) and the input `payload.nonce` names. Before every " +
    "`failed` but `before-position`, the search for H over the transactions of the payment credential that holds that " +
    "input, from the block after the position given to the tip read first, each read whole; whole only through a " +
    "listing a run has shown to hold every transaction of the credential, which no run has shown yet, so that until " +
    "then no read answers those `failed`; the payee is never a key.",
  history:
    "the endpoint answers a read of the block at the position given (or, where none is given, of the genesis block); " +
    "where it answers none, `history-gap`",
  contracts: [],
  lapse:
    "the slot of the block the security parameter below the tip at or past the body's TTL with the input `payload.nonce` " +
    "names unspent, and the search for H read whole with no act of the payer found; a body with no TTL never lapses",
} as const;

export const CARDANO = /* @__PURE__ */ freeze({
  "x402/exact/cardano": {
    coverage: "full",
    carrier,
    source: "lcp's client; no stock client writes it",
    nonce: "single-use",
    broadcasts: "payee",
    read,
    destination:
      "the signed body's outputs to addresses other than the payer's credential, recorded as observed; on a payment an " +
      "output names the payee's account where its address has the payee's payment credential, whatever its stake part",
    asset: "what the outputs carry, recorded as observed and compared with nothing",
    payer: "the payment credential that holds the input `payload.nonce` names",
    confirmed: "yes",
    agreement: {
      floor: "rule",
      fee: "the buyer, as a field of the body balanced against the buyer's own inputs; the published scheme sponsors no fee",
      succeeded:
        "the transaction whose id is the Blake2b-256 of the signed body is in a block at the mark with `valid_contract` true " +
        "and its metadata 674 holds H; what its outputs pay is recorded as observed and compared with nothing",
    },
    proves:
      "The payer, the payment credential that holds the input the payment names, signed a Cardano transaction whose body " +
      "commits through its auxiliary_data_hash to a CIP-20 message (label 674) carrying this ATR's hash, and the ledger " +
      "included it as valid at the mark read. It paid: the read names each output it created, to which payment " +
      "credential and in what asset and amount, as observed, and on a payment one output reached the payee's payment " +
      "credential. A transaction with fewer confirmations than the ledger's security parameter (2160 on mainnet) can be " +
      "rolled back. The read compares no amount, asset or time with the ATR's terms.",
  },
  "x402/exact/cardano/lock": {
    coverage: "full",
    carrier,
    source: "lcp's client; no stock client writes it",
    nonce: "single-use",
    broadcasts: "payee",
    read,
    destination:
      "the signed body's outputs to addresses other than the payer's credential, recorded as observed; on a Masumi lock " +
      "a deposit into the escrow, the option's `payTo`, which the reference keeps, names by its inline datum's field 2, " +
      "`seller`, the beneficiary, which names the payee's account where it has the payment credential of the seller the " +
      "option names, and every other output names its own payment credential; on a script lock an output names it " +
      "where its address has the payment credential of the option's `payTo`",
    asset: "what the outputs carry, recorded as observed and compared with nothing",
    payer: "the payment credential that holds the input `payload.nonce` names",
    confirmed: "no",
    proves:
      "The payer, the payment credential that holds the input the payment names, signed a Cardano transaction whose body " +
      "commits through its auxiliary_data_hash to a CIP-20 message (label 674) carrying this ATR's hash, and the ledger " +
      "included it as valid at the mark read. It deposited into a contract: the read names each output it created, as " +
      "observed, and on a Masumi lock the beneficiary its escrow datum names. A deposit is a charge and never an " +
      "agreement. The read compares no amount, asset or time with the ATR's terms.",
  },
});
