/** The data of the Stacks pairing. */
import { freeze } from "./freeze.js";

export const STACKS = /* @__PURE__ */ freeze({
  "mpp/charge/usdc/stacks": {
    coverage: "full",
    carrier: { signed: "the SIP-010 `transfer`'s memo argument, `(some H)` with H's 32 bytes as a buffer, in the transaction the origin signs" },
    source: "lcp's client; no stock client implements the profile",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: "stacks-api-rest",
      search:
        "Keyed by the origin and its nonce, read from the issue position. Every lapse also needs the search for H over the " +
        "origin's nonces from the position to the latest head.",
      history: "from the position; absence is answered only in the endpoint's documented form and only where it holds that history",
      contracts: [],
      lapse:
        "the origin's nonce consumed by another transaction, with the search for H read whole; a Stacks transaction has no " +
        "expiry, so an unused nonce releases nothing",
    },
    destination: "the recipient of the token's transfer event (or of the STX token transfer), compared with the option's payee",
    asset: "that event's contract (or `STX`), compared with nothing",
    payer: "the origin (never the sponsor), compared with the option's payee",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "a sponsor (sponsored authorization) or the origin (standard); the seller's option, on by default, fixed in the option",
      succeeded:
        "the transaction at the mark is on the canonical chain with status `success`, its origin not the option's payee, " +
        "calling a SIP-010 `transfer` with `(some H)` as memo, or a token transfer whose memo is H followed by two zero " +
        "bytes; what it moved is recorded as observed",
    },
    proves:
      "The payer signed a Stacks transaction calling a contract's `transfer` with this ATR's hash as its " +
      "fourth (memo) argument. The chain verified the signature, the transaction executed with status success, " +
      "and the memo is in the mined transaction on chain. This does not show that the contract is a SIP-010 " +
      "token, or that amount, payee, asset or timing match the ATR's content.",
  },
});
