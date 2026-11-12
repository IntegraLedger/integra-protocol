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
    read: {
      endpoint: ["rest-api", "json-rpc"],
      note:
        "`rest-api` is polkadot-rest-api; the `json-rpc` side endpoint serves the genesis hash, the head and the " +
        "validation of a presented extrinsic",
      search:
        "By the signer and its signed account nonce, decoding each extrinsic from the issue position to the signed era's " +
        "last includable block, never by the extrinsic's hash. Every `failed` but `before-position` also waits for the " +
        "search for H over every extrinsic of the signer to the latest head the endpoint serves.",
      history:
        "every block from the issue position to the latest head (finalized for a `failed`); a block of the range at or below " +
        "finalized that the endpoint does not hold is `unreadable`, `history-gap`",
      contracts: [],
      lapse:
        "the account nonce, read at finalized past the era's end, not past the signed one, with the search for H finding " +
        "nothing; an immortal era has no end and is never `failed` for its lapse",
    },
    destination:
      "the `to` of every transfer event the extrinsic emitted from the payer, or the account a transfer call of zero " +
      "names; compared on a charge with `payTo`'s 32-byte account",
    asset: "each transfer event's asset, recorded as observed and compared with nothing",
    payer: "the events' `from`, or, for a call of zero, the account the call runs as; the signer is named with its authority",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the signer only: no other party can pay on Polkadot Asset Hub, and the seller has no option",
      succeeded:
        "the extrinsic at the mark succeeded (`system.ExtrinsicSuccess`) and carries the remark of H with " +
        "`system.Remarked` for it; what its transfers from the payer moved is recorded as observed",
    },
    proves:
      "The payer signed one Polkadot Asset Hub extrinsic whose bytes end with the profile call, the encoding " +
      "of a batch of a transfer of the asset and a remark whose bytes are this ATR's hash in LCP string form. " +
      "The chain verified the signature and dispatched the extrinsic, and its record carries a Remarked event " +
      "with the BLAKE2b-256 of that remark and a Transferred event of the asset, at the finality recorded. " +
      "This does not show that amount, payee, asset or timing match the ATR's content.",
  },
});
