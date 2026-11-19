/** The data of the Starknet pairing. */
import { freeze } from "./freeze.js";

export const STARKNET = /* @__PURE__ */ freeze({
  "x402/exact/starknet": {
    coverage: "full",
    carrier: {
      signed:
        "the SNIP-9 outside execution's `Nonce`: H's low 250 bits as a felt; on an agreement, the low 250 bits of the " +
        "agreement's own value, SHA-256 over the ASCII bytes `lcp-agreement-v1` and H",
    },
    source: "lcp's client; the stock `@vauban-pay/x402-starknet` 0.2.1 draws the nonce at random unless its configuration fixes one",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      fallback: "json-rpc",
      note: "a node that serves `starknet_traceTransaction`; the archival fallback for the event search",
      search:
        "`is_valid_outside_execution_nonce` of the signed nonce on the payer's account, read as state at the newest " +
        "`ACCEPTED_ON_L1` block and at the newest block: valid at both, those two reads are the search for H, read whole. " +
        "Consumed, `starknet_getEvents` on the asset for a `Transfer` from the payer, in either layout, from the position " +
        "given to the block at which the nonce was read consumed, a candidate taken only where its trace carries the " +
        "outside execution under the nonce; nothing found is `search-incomplete`.",
      history: "the event search alone; the lapse reads state, so no history floor enters it",
      contracts: ["the payer's account (`is_valid_outside_execution_nonce`)", "the asset (its `Transfer` events)"],
      lapse:
        "`Execute Before`: the nonce still valid at an `ACCEPTED_ON_L1` block whose timestamp is at or past it, and at the " +
        "latest block",
    },
    destination:
      "each `Transfer`'s recipient from the payer, and the `to` of a transfer call of zero for which its token emitted no " +
      "`Transfer`; compared with `payTo` on a charge only",
    asset: "the `Transfer`'s emitting contract, compared with nothing",
    payer: "the account whose outside execution executed, compared with the option's payee on either act",
    confirmed: "yes",
    agreement: {
      floor: "rule",
      fee: "the seller's settler, always, through the named `Caller`",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "the receipt's execution status is `SUCCEEDED` at the mark, its trace holding the payer's `execute_from_outside_v2` " +
        "under the signed nonce with nothing on its path reverted; each `Transfer` from the payer recorded as what moved",
    },
    proves:
      "The payer's own signed SNIP-9 outside execution carries the low 250 bits of this ATR's hash as its nonce (on an " +
      "agreement, of the agreement's value of it), which the payer's account verified when it executed it. It paid the " +
      "account each `Transfer` from the payer, or a transfer call of zero, names the amount it states, zero included: on " +
      "a payment, the option's `payTo` among them; where the read observed no transfer, the payer signed it. A holder of " +
      "the ATR confirms the hash's low 250 bits from the nonce; the chain holds no more of it. This does not show that " +
      "the amount, the asset or the timing match the ATR's content.",
  },
});
