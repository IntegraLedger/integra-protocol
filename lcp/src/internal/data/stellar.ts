/** The data of the Stellar pairings. */
import { freeze } from "./freeze.js";

export const STELLAR = /* @__PURE__ */ freeze({
  "x402/exact/stellar/precondition": {
    coverage: "full",
    carrier: {
      signed:
        "the transaction's `PRECOND_V2` extra signer `SIGNER_KEY_TYPE_ED25519_SIGNED_PAYLOAD`: the buyer's key and the " +
        "40-byte payload of H and the nonce of the buyer's Soroban authorization entry, an `int64` big-endian, on the " +
        "transaction carrying that authorization of `transfer(buyer, payTo, amount)`; all of H",
    },
    source: "lcp's client; no stock client builds it, and the buyer's own software signs the raw payload",
    nonce: "single-use",
    broadcasts: "payee",
    option: { extra: { assetTransferMethod: "lcp-precondition", areFeesSponsored: true } },
    read: {
      endpoint: ["json-rpc"],
      note: "a Stellar RPC: `getNetwork`, `getLatestLedger`, `getEvents` and `getTransaction`",
      search:
        "`getEvents` on every contract, by a filter that names none: `transfer` and `burn` events whose `from` topic is " +
        "the buyer, from the ledger recorded at issue to the latest closed ledger at the read, each candidate's " +
        "transaction read whole; at most 50 candidates and 10 pages in one call. Not yet shown to hold every act of " +
        "the buyer; until a run shows it, no read answers a `failed` but `before-position`.",
      history: "from the ledger recorded at issue",
      contracts: [],
      lapse:
        "the authorization entry's expiration ledger passed with its nonce unconsumed, which only a successful landing " +
        "of the entry consumes: the search read through to the latest closed ledger above that ledger, finding no " +
        "transaction that consumed it",
    },
    destination: "the event's `to` topic, its base account, with `to_muxed_id` where the event carries one, recorded as observed",
    asset: "the contract that emitted the event, recorded as observed and compared with nothing",
    payer: "the transfer's `from`, whose authorization entry the transaction consumed",
    confirmed: "yes",
    agreement: {
      floor: "0",
      fee: "the settler, as the transaction's source; the buyer needs a key, and no funds where the amount is zero",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "`getTransaction` answers `SUCCESS` (`txSUCCESS`, or `txFEE_BUMP_INNER_SUCCESS` under a fee bump, with " +
        "`INVOKE_HOST_FUNCTION_SUCCESS`), and the five checks hold: one signed-payload signer whose payload is H and " +
        "the consumed entry's nonce, its key one whose signature that entry carries, the transfer's `from` not the " +
        "payee, and the buyer an account with address credentials",
      only: true,
    },
    proves:
      "Signed: the buyer's account signed a Soroban authorization of a transfer and the 40-byte payload of this ATR's " +
      "hash and that authorization's nonce, carried as a signed-payload precondition of the transaction that consumed " +
      "it, so the buyer's own signed act carries the hash. The transaction succeeded on the asset contract its event " +
      "names; where the transfer moved a nonzero amount, it paid the account the event's to names. This states nothing " +
      "of the amount, nor that the asset, the account reached or the time meet a term of the ATR.",
  },
});
