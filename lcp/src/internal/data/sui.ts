/** The data of the Sui pairing. */
import { freeze } from "./freeze.js";

export const SUI = /* @__PURE__ */ freeze({
  "x402/exact/sui": {
    coverage: "full",
    carrier: { signed: "one `Pure` input, H's 32 bytes, that no command uses, inside the transaction data the sender signs" },
    source: "lcp's client; x402 publishes no Sui client",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["graphql"],
      search:
        "Found by the digest, computed from the signed transaction data. Every `failed` but `before-position` waits for the " +
        "search for H in the sender's transactions (`transactions` filtered by `sentAddress`, `afterCheckpoint` and " +
        "`beforeCheckpoint`), from the issue position to the last checkpoint the endpoint states it holds for that filter, " +
        "page by page; at this release a search read whole proves no absence (the profile, rule 15).",
      history:
        "from the issue position: the endpoint's first checkpoint for transactions at or before it, for the digest, and the " +
        "range it states for the sender filter beginning at or before it, for the search",
      contracts: [],
      lapse:
        "the signed expiration epoch, compared with the epoch at the search's head; a transaction with no epoch in its " +
        "expiration has no readable bound and is never `failed`",
    },
    destination:
      "the effects' balance changes: a positive change owned by the payee's address, in any coin; for a transfer of zero, " +
      "or a SUI transfer whose change the payee's gas outweighs, the recipient the signed transfer names",
    asset: "the balance change's coin type, recorded as observed and compared with nothing",
    payer: "the sender, who signed the bytes carrying H",
    confirmed: "yes",
    agreement: {
      floor: "rule",
      fee:
        "by gas path, the seller's option fixed in the option: the buyer, a sponsor (the seller's settler) owning the gas " +
        "data, or gasless; by default sponsored where the settler declares a gas key, else gasless where eligible, else the buyer",
      succeeded:
        "the transaction with the digest is in a checkpoint after the position with effects status success, its one unused " +
        "`Pure` input H and its sender not the option's payee; what it moved is recorded as observed",
    },
    proves:
      "The payer, the sender, signed a Sui transaction whose one unused Pure input is this ATR's hash, and the network " +
      "executed it successfully in a checkpoint after the position the read was given; the hash is on chain in its input " +
      "list, readable by its digest while a node retains it. The sender is not the option's payee. Where the transaction " +
      "moved value it paid each account a positive balance change names; where it moved nothing it was signed, naming the " +
      "recipient its signed transfer names. What it moved is recorded as observed: this does not show that amount, coin " +
      "type or timing match the ATR's content.",
  },
});
