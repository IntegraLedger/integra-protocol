/** The data of the NEAR pairings. */
import { freeze } from "./freeze.js";

export const NEAR = /* @__PURE__ */ freeze({
  "x402/exact/near": {
    coverage: "full",
    carrier: {
      signed: "the `memo` argument of the one `ft_transfer`, H's LCP string, inside the NEP-366 delegate action the payer signs; all of H",
    },
    source: "lcp's client; the stock `@x402/near` client writes no memo, so no stock client pays this form",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: "json-rpc; a declared archival json-rpc fallback for history below the node's floor",
      search:
        "Keyed by the payer's access key (account and public key), from the position recorded at issue to the delegate's " +
        "`max_block_height`. The lapse's search for H covers every access key of the payer's account from the issue " +
        "position to the latest head.",
      history: "from the position recorded at issue (the final block height); below the node's floor, the declared archival fallback",
      contracts: [],
      lapse:
        "the access key's nonce still below the signed nonce at a final block past `max_block_height`, and the search for H " +
        "read whole finding no delegate action for H",
    },
    destination:
      "the `receiver_id` of the executed `ft_transfer`, recorded as observed; on a charge the delegate pays only where it " +
      "is the payee's account",
    asset: "the token the delegate's `ft_transfer` executes on, recorded as observed and compared with nothing",
    payer: "the delegate's sender and its key",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the relayer, always",
      succeeded:
        "the relayer's transaction at the mark, the delegate's `ft_transfer` receipt with outcome success and its memo H; " +
        "its token and `receiver_id` recorded as observed",
    },
    proves:
      "The payer signed a NEP-366 delegate action whose one ft_transfer carries this ATR's hash in its memo, " +
      "in LCP string form. The runtime verified that signature and executed the transfer on the token " +
      "contract, and the memo is on chain in the delegated call's arguments. This does not show that amount, " +
      "receiver, token or timing match the ATR's content.",
  },
  "mpp/charge/nearintents": {
    coverage: "none",
    carrier: { signed: null, member: ["externalId"] },
    link: "h",
    source:
      "the seller writes H's LCP string in the challenge request's `externalId`; the stock " +
      "`@defuse-protocol/nearintents-mpp-sdk` 0.4.0 client presents the `hash` credential, and no one writes H into a payment",
    nonce: "unshown",
    broadcasts: "payer",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The seller's MPP challenge carried this ATR's hash in its " +
      "externalId, bound by the seller's server to a deposit address issued for that challenge only, and the " +
      "seller reported delivery. The buyer's deposit does not carry the hash, and the buyer did not sign it. " +
      "The NEAR Intents backend, not a contract the buyer signed, links the deposit to the seller.",
  },
});
