/** The data of the TRON pairing. */
import { freeze } from "./freeze.js";

/**
 * The contracts a run has shown to succeed and log `Transfer` on a `transfer(to, 0)`, each by its network and its
 * base58check address: the option filter admits `"0"` for these alone, every other contract taking one base unit. Empty
 * until a run on a test network shows one, such as Nile's USDT.
 */
export const TRON_ZERO_SHOWN: readonly { readonly network: string; readonly contract: string }[] = Object.freeze([]);

export const TRON = /* @__PURE__ */ freeze({
  "x402/exact/tron/lcp-trc20-memo": {
    coverage: "full",
    carrier: { signed: "`raw_data.data`: H's 77-byte LCP string, signed with the one `TriggerSmartContract`" },
    source: "lcp's client; no stock client writes the form",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["fullnode-http"],
      search:
        "A transaction's `data` equal to H's 77-byte LCP string, its hex digits in either case, over ranges of at most 100 blocks, each answer within the " +
        "reader's byte bound, at most `TRON_BOUNDS.searchBlocks` blocks a call, each block linked to the one before it.",
      history: "the blocks from the position the caller gives to the solidified head, or a node the caller declares archival",
      contracts: [],
      lapse: "the signed `expiration` (milliseconds)",
    },
    destination:
      "each `Transfer` log's `to` topic (0x41 and the topic's last 20 bytes), or, where a signed `transfer(to, 0)` logs " +
      "nothing, that call's `to`; compared with `payTo` on a charge",
    asset: "the `Transfer` log's emitter, compared with nothing",
    payer: "the transaction's owner, read from its signed bytes, against the payer lcp's reference names",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the buyer; the seller has no option",
      succeeded:
        "the receipt's result is `SUCCESS`, `raw_data.data` is H, and the owner is the payer lcp's reference names; the " +
        "`Transfer` logs are recorded as what moved",
    },
    proves:
      "The payer, the transaction's owner, signed a Tron transaction whose memo is this ATR's hash in LCP string form, " +
      "and whose one contract calls transfer on the token. The network verified the signature, which covers the memo " +
      "through the transaction id, and the receipt's result is SUCCESS, at the finality recorded. Where the receipt holds " +
      "Transfer logs, the transaction paid, with each recipient and what moved; where it holds none and the signed call " +
      "is a transfer of zero, it paid zero to that call's recipient; where it holds neither, the payer signed, and no " +
      "account is named. The owner is named as the signer. This does not show a log's sender, nor that amount, token " +
      "or timing match the ATR's content.",
  },
});
