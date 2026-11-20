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
    option: { extra: { areFeesSponsored: true } },
    read: {
      endpoint: ["toncenter-v3"],
      note: "with its `runGetMethod`",
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
    confirmed: "yes",
    agreement: {
      floor: "0",
      fee: "the settler, always",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "three transactions at the mark, none aborted: the payer's W5 wallet took the signed request and sent the Jetton " +
        "transfer, the payer's Jetton wallet sent `internal_transfer`, and the Jetton wallet it was sent to took it",
    },
    proves:
      "The payer's W5 wallet signed a request whose one Jetton transfer carries this ATR's hash in its forward " +
      "payload, as a TEP-74 text comment in LCP string form, and ran it: the payer's own signed act carries the hash. " +
      "The W5 wallet paid, through its Jetton wallet, the amount the `internal_transfer` names, zero included, to the " +
      "Jetton wallet that took it, the recipient; where the read observed no transfer, the W5 wallet signed. The signer " +
      "is the W5 wallet, named apart from the recipient. This does not show that the amount, the Jetton, the payee or " +
      "the time match the ATR's content.",
  },
});
