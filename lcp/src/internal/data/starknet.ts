/** The data of the Starknet pairing. */
import { freeze } from "./freeze.js";

export const STARKNET = /* @__PURE__ */ freeze({
  "x402/exact/starknet": {
    coverage: "full",
    carrier: {
      signed:
        "the SNIP-9 outside execution's `Nonce`: H's low 250 bits as a felt (on an agreement, the low 250 bits of a digest " +
        "over a fixed agreement tag and H)",
    },
    source: "lcp's client; the stock `@vauban-pay/x402-starknet` 0.2.1 draws the nonce at random unless its configuration fixes one",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      fallback: "json-rpc",
      note: "a node that serves `starknet_traceTransaction`; the archival fallback for the event search",
      search:
        "Keyed by the payer's account and the nonce (`is_valid_outside_execution_nonce` read as state), then " +
        "`starknet_getEvents` on the asset for a `Transfer` from the payer, from the issue position to the block at which " +
        "the nonce was read consumed.",
      history: "the event search alone; the lapse reads state, so no history floor enters it",
      contracts: ["the payer's account (`is_valid_outside_execution_nonce`)", "the asset (its `Transfer` events)"],
      lapse:
        "`Execute Before`: the nonce still valid at an `ACCEPTED_ON_L1` block whose timestamp is at or past it, and at the " +
        "latest block",
    },
    destination:
      "each `Transfer`'s recipient from the payer, and the `to` of a transfer call of zero on a token that emits no " +
      "`Transfer` for zero; compared with `payTo` on a charge only",
    asset: "the `Transfer`'s emitting contract, compared with nothing",
    payer: "the account that signed, compared with the option's payee on either act",
    confirmed: "yes",
    agreement: {
      floor: "rule",
      fee: "the seller's settler, always, through the named `Caller`",
      succeeded:
        "the receipt's execution status is not `REVERTED` and its finality is at the mark, the transaction executing the " +
        "payer's outside execution with that nonce, read in its trace; each `Transfer` from the payer recorded as what moved",
    },
    proves:
      "The payer signed, as SNIP-12 typed data, a SNIP-9 outside execution whose nonce is the low 250 bits of " +
      "this ATR's hash. The payer's account contract verified that signature when it executed the transfer " +
      "call, and the nonce is in the settlement transaction's calldata. A holder of the ATR can confirm the " +
      "hash from the nonce; the chain alone does not reveal all of it, and no event indexes it. This does not " +
      "show that amount, payee, asset or timing match the ATR's content.",
  },
});
