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
      endpoint: ["stacks-api-rest"],
      search:
        "Keyed by the origin and the nonce it signed: the lookup by origin and nonce, a scan for nonce 0 and a bisection " +
        "by block height as its fallback. Every answer but a settlement at the signed nonce also searches for H every " +
        "nonce the origin executed after the position it starts from through the last it executed at the tip, at most " +
        "32 in one read.",
      history:
        "from the position; a height a route does not know is a history gap, and a search from a position reads the " +
        "nonce route at that height, which no run has yet shown, so it proves no absence",
      contracts: [],
      lapse:
        "the origin's nonce consumed by another transaction; a Stacks transaction has no expiry, so an unused nonce " +
        "never lapses",
    },
    destination: "the recipient of the token's transfer event (or of the STX token transfer), compared with the option's payee",
    asset: "that event's contract (or `STX`), compared with nothing",
    payer: "the origin (never the sponsor), compared with the option's payee",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "a sponsor (sponsored authorization) or the origin (standard), as the resource server's offer asks",
      succeeded:
        "the transaction at the mark is on the canonical chain with status `success`, its origin not the option's payee, " +
        "calling a SIP-010 `transfer` with `(some H)` as memo, or a token transfer whose memo is H followed by two zero " +
        "bytes; what it moved is recorded as observed",
    },
    proves:
      "The payer signed a Stacks transaction whose origin is the payer and which carries this ATR's hash as the " +
      "`(some H)` memo of a SIP-010 `transfer`, or as a token transfer's memo. The chain verified the origin's " +
      "signature, the transaction executed with status success on the canonical chain, and the memo is in the mined " +
      "transaction on chain. Where it made a transfer, one of zero included, it paid that transfer's recipient, named " +
      "in the record; the origin, never a sponsor, is the signer. This does not show that the contract is a SIP-010 " +
      "token, or that amount, asset or timing match the ATR's content.",
  },
});
