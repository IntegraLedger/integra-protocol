/** The data of the Concordium pairing. */
import { freeze } from "./freeze.js";

export const CCD = /* @__PURE__ */ freeze({
  "x402/exact/ccd": {
    coverage: "full",
    carrier: { signed: "the transfer's memo, H's LCP string, in the account transaction the sender signs; all of H" },
    source: "lcp's client; the stock `@x402/concordium` client writes no memo",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["grpc-v2"],
      search:
        "Keyed by the sender's account and its signed sequence number, from the position recorded at issue to the finalized " +
        "height at which that number was read passed; the search for H, keyed by the sender's account and H in a transfer's " +
        "memo, runs to the latest head the node serves.",
      history: "the account's state and the blocks at every finalized height in those ranges",
      contracts: [],
      lapse: "the sender's sequence number against the signed `expiry`",
    },
    destination: "the transfer's receiver; on a charge compared with the option's `payTo` as an account by its first 29 bytes",
    asset: "the transfer's kind and token id, recorded as observed and compared with nothing",
    payer: "the header's sender, compared with the option's payee as an account by its first 29 bytes",
    confirmed: "no",
    agreement: {
      floor: "0",
      fee: "the sponsor, always; the buyer needs a key and, where the amount is zero, no funds",
      succeeded:
        "the finalized item's outcome is a success, with one transfer carrying the memo H from a sender that is not the " +
        "option's payee; its token and receiver recorded as observed",
    },
    proves:
      "The payer signed a Concordium transaction one of whose transfers carries this ATR's hash, in LCP string " +
      "form, as its memo. The chain accepted the transaction only with the sender's valid signature, and the " +
      "memo is on chain in the finalized transfer event. This does not show that amount, payee, token or " +
      "timing match the ATR's content.",
  },
});
