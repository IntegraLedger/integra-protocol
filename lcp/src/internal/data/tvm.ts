/** The data of the TON pairing. */
import { freeze } from "./freeze.js";

export const TVM = /* @__PURE__ */ freeze({
  "x402/exact/tvm": {
    coverage: "full",
    carrier: {
      signed: "the forward payload's comment cell, in the Jetton transfer the payer's W5 wallet signs",
      member: ["extra", "forwardPayload"],
    },
    source: "the stock `@x402/tvm` client, copying `extra.forwardPayload`",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: "toncenter-v3, with `runGetMethod`",
      search:
        "The signed request's body hash on the payer's W5 wallet, and the wallet's own transactions from its latest to the " +
        "position, for a run at the signed sequence number and, as the search for H, a run at another number carrying H.",
      history: "from the position, and the index's statement of the blocks it holds",
      contracts: ["the two Jetton wallets and the master, read from the messages (none from the option)"],
      lapse: "`validUntil` with no run at the signed number",
    },
    destination:
      "the delivering transaction's account, compared on a charge with the payee's wallet of that master (the master's " +
      "`get_wallet_address` for `payTo`)",
    asset: "the payer's Jetton wallet's master, compared with nothing",
    payer: "the W5 wallet, compared with the option's payee",
    confirmed: "no",
    agreement: {
      floor: "0",
      fee: "the settler, always",
      succeeded:
        "three transactions at the mark, none aborted: the payer's W5 wallet took the signed request and sent the Jetton " +
        "transfer, the payer's Jetton wallet sent `internal_transfer`, and the Jetton wallet it was sent to took it",
    },
    proves:
      "The payer's W5 wallet signed a request whose one Jetton transfer carries this ATR's hash in its forward " +
      "payload, as a TEP-74 text comment in LCP string form. The payer's Jetton wallet executed that transfer, " +
      "and the Jetton wallet its `internal_transfer` reached accepted it. The comment is on chain in the " +
      "transfer's message bodies. This does not show that amount, payee, asset or timing match the ATR's " +
      "content.",
  },
});
