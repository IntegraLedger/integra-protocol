/** The data of the Casper pairing. */
import { freeze } from "./freeze.js";

export const CASPER = /* @__PURE__ */ freeze({
  "x402/exact/casper": {
    coverage: "full",
    carrier: {
      signed:
        "the CEP-3009 authorization's 32-byte `nonce`, which is H, signed by `from`; on an agreement, the agreement's own " +
        "value, SHA-256 over the ASCII bytes `lcp-agreement-v1` and H",
    },
    source: "lcp's client; the stock `@x402/casper` client draws a random nonce, so it cannot pay this pairing",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "a node or its sidecar whose `available_block_range.low` is at or below the position the caller gives",
      search:
        "Keyed by `(from, n)` in the token's `used_nonces`, `n` the signed nonce, read with `state_get_dictionary_item` at " +
        "past state roots: at the newest block, then bisecting block heights to the first block where it is set, whose " +
        "transactions are read for the one that set it; each token package keeps its own, so this read is no search for H.",
      history: "from the position (a block height; every block is final)",
      contracts: ["the asset packages whose dictionary and item key a run has shown"],
      lapse:
        "`validBefore`, which the payer signed, with the nonce unset at a final block whose timestamp is past it; answered " +
        "`pending`, `search-incomplete`, never `failed`",
    },
    destination: "the call's `to`, recorded; on a charge compared with the option's `payTo`",
    asset: "the package called, recorded and compared with nothing",
    payer: "the call's `from`, recorded and compared with the option's payee",
    confirmed: "no",
    agreement: {
      floor: "0",
      fee: "the settler, always",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "the transaction executed with no `error_message`, calling `transfer_with_authorization` or " +
        "`receive_with_authorization` with `from` not the option's payee and the signed nonce, which sets " +
        "`used_nonces[(from, nonce)]`; its `to` and `value` recorded as observed",
    },
    proves:
      "The payer's own signed CEP-3009 authorization carries this ATR's hash as its nonce (on an agreement, the " +
      "agreement's value of it), which the token contract verified with the payer's key when it executed the call. " +
      "It paid the account its `to` names the amount its `value` states, zero included: on a payment, the option's " +
      "`payTo`. This does not show that the amount, the asset or the timing match the ATR's content.",
  },
});
