/** The data of the TRON pairing. */
import { freeze } from "./freeze.js";

export const TRON = /* @__PURE__ */ freeze({
  "x402/exact/tron/lcp-trc20-memo": {
    coverage: "full",
    carrier: { signed: "`raw_data.data`: H's 77-byte LCP string, signed with the one `TriggerSmartContract`" },
    source: "lcp's client; no stock client writes the form",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: "fullnode-http",
      search:
        "A transaction's `data` equal to H's 77-byte LCP string, over ranges of at most 100 blocks, each answer within the " +
        "reader's byte bound.",
      history: "the blocks from the position the caller gives to the solidified head, or a node the caller declares archival",
      contracts: [],
      lapse: "the signed `expiration` (milliseconds)",
    },
    destination:
      "each `Transfer` log's `to` topic (0x41 and the topic's last 20 bytes), or, where a signed `transfer(to, 0)` logs " +
      "nothing, that call's `to`; compared with `payTo` on a charge",
    asset: "the `Transfer` log's emitter, compared with nothing",
    payer: "the transaction's owner, which lcp's reference names, with its permission",
    confirmed: "no",
    agreement: {
      floor: "rule",
      fee: "the buyer; the seller has no option",
      succeeded:
        "the receipt's result is `SUCCESS`, `raw_data.data` is H, and the owner is the payer lcp's reference names; the " +
        "`Transfer` logs are recorded as what moved",
    },
    proves:
      "The payer signed a Tron transaction whose memo is this ATR's hash in LCP string form, and whose one " +
      "contract calls transfer on the token. The network verified the signature, which covers the memo through " +
      "the transaction id. The call succeeded with the token's Transfer event, at the finality recorded. The " +
      "memo is on chain in the transaction. This does not show that amount, payee, token or timing match the " +
      "ATR's content.",
  },
});
