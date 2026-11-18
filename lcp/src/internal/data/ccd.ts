/** The data of the Concordium pairing. */
import { freeze } from "./freeze.js";

export const CCD = /* @__PURE__ */ freeze({
  "x402/exact/ccd": {
    coverage: "full",
    carrier: { signed: "the transfer's memo, H's LCP string, in the account transaction the sender signs; all of H" },
    source: "lcp's client; the stock `@x402/concordium` client writes no memo",
    // `unshown` until a run shows a landed payment refused when sent again (x402-exact-ccd.md, rule 7).
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["grpc-v2"],
      search:
        "Keyed by the sender's account and its signed sequence number: the finalized heights bisected from the position " +
        "recorded at issue to the one at which that number was read passed, and that block's items; the search for H reads " +
        "the sender's items at every number from its next number at that position to the one before its next number at " +
        "the latest head the node serves, at most 16 numbers in one call.",
      history: "the account's state and the blocks at every finalized height in those ranges",
      contracts: [],
      lapse: "the sender's sequence number against the signed `expiry`",
    },
    destination: "the transfer's receiver; on a charge compared with the option's `payTo` as an account by its first 29 bytes",
    asset: "the transfer's kind and token id, recorded as observed and compared with nothing",
    payer: "the header's sender, compared with the option's payee as an account by its first 29 bytes",
    confirmed: "no",
    // No `agreement` while `nonce` is `unshown`: the agreement option waits on the run that shows a landed payment refused
    // when sent again, which shows single use (x402-exact-ccd.md, rule 7).
    proves:
      "The payer signed a Concordium transaction one of whose transfers carries this ATR's hash, in LCP string " +
      "form, as its memo. The chain accepted the transaction only with the sender's valid signature, and the " +
      "memo is on chain in the finalized transfer event. Where the transfer moved an amount, zero included, the " +
      "payer paid it to the account the transfer names. It does not show that amount, token or timing match the " +
      "ATR's content.",
  },
});
