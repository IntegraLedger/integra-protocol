/** The data of the Polkadot pairing. */
import { freeze } from "./freeze.js";

export const POLKADOT = /* @__PURE__ */ freeze({
  "x402/exact/polkadot/lcp-assets-remark": {
    coverage: "full",
    carrier: {
      signed:
        "`system.remark_with_event` of H's LCP string, batched with the transfer in `utility.batch_all`, inside the " +
        "extrinsic the payer signs",
    },
    source: "lcp's client; no stock client writes the form, and `build` gives the call",
    nonce: "single-use",
    broadcasts: "payee",
    option: { extra: { assetTransferMethod: "lcp-assets-remark" } },
    read: {
      endpoint: ["rest-api", "json-rpc"],
      note:
        "`rest-api` is polkadot-rest-api; the `json-rpc` side endpoint serves the genesis hash, the head and the " +
        "validation of a presented extrinsic",
      search:
        "By the signer and its signed account nonce, decoding each extrinsic from the issue position to the latest head " +
        "the endpoint serves, at most `POLKADOT_BOUNDS.searchBlocks` blocks a call, never by the extrinsic's hash; every " +
        "extrinsic whose bytes hold the remark of H is read for the search for H, which every `failed` but " +
        "`before-position` waits for.",
      history:
        "every block from the issue position to the latest head (finalized for a `failed`); a block of the range at or below " +
        "finalized that the endpoint does not hold is `unreadable`, `history-gap`",
      contracts: [],
      lapse:
        "the account nonce, read at finalized past the era's end, not past the signed one, with the search for H finding " +
        "nothing; the era's end is proven only by the chain's validation of the presented extrinsic answering valid at a " +
        "head; an immortal era has no end and is never `failed` for its lapse",
    },
    destination:
      "the `to` of every transfer event the extrinsic emitted from the payer, or the account a transfer call of zero " +
      "names; compared on a charge with `payTo`'s 32-byte account",
    asset: "each transfer event's asset, recorded as observed and compared with nothing",
    payer:
      "the account the extrinsic's call runs as, its signer, a `proxy.proxy`'s `real` or an `as_multi_threshold_1`'s " +
      "multisig account, read from its signed bytes, against the signer lcp's reference names",
    payeePreconditions: [
      "for an agreement at the floor, the asset already held, since a transfer of one unit cannot open an asset " +
        "account below the asset's minimum balance",
    ],
    confirmed: "yes",
    agreement: {
      floor: "1",
      fee: "the signer only: no other party can pay on Polkadot Asset Hub, and the seller has no option",
      feePayer: { may: ["buyer"], default: "buyer" },
      succeeded:
        "the extrinsic at the mark succeeded (`system.ExtrinsicSuccess`) and carries the remark of H with " +
        "`system.Remarked` for it; what its transfers from the payer moved is recorded as observed",
    },
    proves:
      "The payer signed one Polkadot Asset Hub extrinsic whose bytes hold this ATR's hash in LCP string form as a " +
      "remark, at the account nonce its reference holds, or an account acting for the payer through a `proxy.proxy` or " +
      "`multisig.as_multi_threshold_1` wrapper signed one. The chain verified the signature and dispatched the " +
      "extrinsic with a Remarked event for that remark, at the finality recorded. Where the record shows a transfer " +
      "event from the payer, or the call is a transfer of zero that runs as the payer, it states that the extrinsic " +
      "paid, with each recipient and what moved; where it shows neither, it states that the payer signed. The signer is " +
      "named, with the wrapper as its authority where it acted for the payer. This does not show that amount, asset or " +
      "timing match the ATR's content.",
  },
});
