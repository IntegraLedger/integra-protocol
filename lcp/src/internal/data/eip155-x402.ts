/** The data of the x402 pairings on EVM chains, and of Cloudflare's batch settlement. */
import { freeze } from "./freeze.js";

const PERMIT2_NOTE =
  "receipt, logs, a transaction (the hit's input), `eth_call` (`nonceBitmap`), a block by mark with its timestamp; the " +
  "archival fallback for Permit2 state the node no longer holds";

const NO_SEARCH_FOR_H = "This is no search for H, and none is defined: every answer that would be `failed` is `pending`, `search-incomplete`.";

const ESCROW_LAPSE =
  "`preApprovalExpiry`: the value unconsumed at a final block past it; no `failed` is answered while no search for H is defined";

export const EIP155_X402 = /* @__PURE__ */ freeze({
  "x402/exact/eip155/eip3009": {
    coverage: "full",
    carrier: {
      signed: "the EIP-3009 `nonce`, which is H, all of H; for the act `agreement`, the tagged digest over the agreement tag and H",
    },
    source: "lcp's client; stock `@x402/evm` 2.30.0 draws the nonce at random, so a stock client writes no H",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, logs, `eth_call` (`authorizationState(from, H)` on the asset), a block by mark with its timestamp",
      search:
        "The logs of every contract with topics `[AuthorizationUsed, payer, H]`, from the block after the position recorded " +
        "at issue to a `finalized` block past `validBefore`, and before any `failed` to the latest head; a hit on another " +
        "contract counts only where the payer's signature verifies, and a cancellation is the asset's " +
        "`[AuthorizationCanceled, null, H]`.",
      history: "the log search from the position recorded at issue to the latest head",
      contracts: ["the asset (the EIP-3009 token)"],
      lapse:
        "`validBefore`: `authorizationState(from, H)` false at a `finalized` block whose timestamp is at or past it, and at " +
        "the latest block, with the search of every contract read whole finding no payer act for H",
    },
    destination:
      "the `Transfer` from the signed `from` that the token consuming the authorization emitted in that transaction; its " +
      "`to` compared on a charge with the option's `payTo`",
    asset: "that `Transfer`'s token, recorded as observed and compared with nothing",
    payer: "the authorization's `from` (the `authorizer`), the signer of H",
    confirmed: "no",
    agreement: {
      floor: "0",
      fee: "the party that submits, always; the buyer needs a key, and no funds where the amount is zero",
      succeeded:
        "the receipt's `status` is 1, and in it the token called emitted `AuthorizationUsed(authorizer, nonce)`, `nonce` the " +
        "agreement's digest and `authorizer` the buyer's `from`, paired with its `Transfer`, recorded as what moved",
    },
    proves:
      "The payer signed an EIP-3009 transfer authorization whose nonce is this ATR's hash. The token contract " +
      "verified that signature when it executed the transfer, and the hash is on chain as the nonce topic of " +
      "its AuthorizationUsed event in the settlement transaction. This does not show that amount, payee, asset " +
      "or timing match the ATR's content.",
  },
  "x402/exact/eip155/permit2": {
    coverage: "full",
    carrier: {
      signed: "the Permit2 `nonce`, which is H, all of H; for the act `agreement`, the tagged digest over the agreement tag and H",
    },
    source: "lcp's client; the stock client draws the nonce at random, so it writes no H",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      fallback: "json-rpc",
      note: PERMIT2_NOTE,
      search:
        "Every contract's `Transfer` from the payer from the block after the position recorded at issue, each hit counted " +
        "only where its transaction's input carries H in the proxy call whose owner is the payer, the bit set at the hit's " +
        "block and unset at the block before; read to a `finalized` block past `deadline`, and whole to the latest head " +
        "before any `failed`. A cancellation is Permit2's `UnorderedNonceInvalidation` with the payer as owner.",
      history:
        "an archive JSON-RPC endpoint where the node no longer holds the Permit2 bitmap state the read needs; without it " +
        "the read is `unreadable`, `history-gap`",
      contracts: ["Permit2", "x402's exact Permit2 proxy"],
      lapse:
        "`deadline`: bit `H & 0xff` of `nonceBitmap(from, H >> 8)` unset at a `finalized` block whose timestamp is past " +
        "`deadline`, and at the latest block",
    },
    destination: "the `Transfer` from the payer (the Permit2 owner) in the hit's transaction; its `to` compared on a charge with the option's `payTo`",
    asset: "that `Transfer`'s token, recorded as observed and compared with nothing",
    payer: "the Permit2 owner, the signer of H",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the party that submits; the buyer's one-time approval of Permit2 is the buyer's unless x402's gas-sponsoring extension covers it",
      succeeded:
        "`status` 1; the payer's `Transfer`, recorded as what moved; the transaction's input carrying the digest as the " +
        "nonce of the proxy call whose owner is the payer, the payer's bit for it set at the receipt's block and unset before",
    },
    proves:
      "The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 " +
      "proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed " +
      "the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event " +
      "carries it. This does not show that amount, payee, asset or timing match the ATR's content.",
  },
  "x402/upto/eip155/permit2": {
    coverage: "full",
    carrier: { signed: "the Permit2 `nonce`, which is H, written in decimal" },
    source: "lcp's client",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      fallback: "json-rpc",
      note: PERMIT2_NOTE,
      search:
        "As `x402/exact/eip155/permit2`, through the `upto` proxy: every contract's `Transfer` from the payer, each hit " +
        "counted only where its transaction's input carries H in the proxy call whose owner is the payer and the bit is set " +
        "at its block and unset before; a cancellation by `UnorderedNonceInvalidation`.",
      history: "an archive JSON-RPC endpoint where the node no longer holds the Permit2 bitmap state the read needs; else `history-gap`",
      contracts: ["Permit2", "x402's `upto` Permit2 proxy"],
      lapse: "`deadline`: the Permit2 bit unset at a `finalized` block whose timestamp is past `deadline`, and at the latest block",
    },
    destination: "the `Transfer` from the payer (the Permit2 owner) in the hit's transaction; its `to` compared on a charge with the option's `payTo`",
    asset: "that `Transfer`'s token, recorded as observed and compared with nothing",
    payer: "the Permit2 owner, the signer of H",
    confirmed: "no",
    proves:
      "The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, with the scheme's x402 " +
      "proxy as spender and the payee in the witness. Permit2 verified the signature when the proxy executed " +
      "the transfer, and the hash is in the settlement transaction's calldata as the Permit2 nonce; no event " +
      "carries it. This does not show that amount, payee, asset or timing match the ATR's content. The amount " +
      "settled is the seller's, submitted by the facilitator the witness names, and at most the signed maximum.",
  },
  "x402/auth-capture/eip155/eip3009": {
    coverage: "full",
    carrier: {
      signed:
        "`PaymentInfo.salt`: H where `receiverAuthorizer` and `policy` are absent, else `keccak256` over a typehash, both " +
        "and H; a bound salt travels with `saltNonce`, which is H",
    },
    source: "lcp's client",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, logs, `eth_call`, a block by mark with its timestamp",
      search:
        "The escrow's payment hash with payer zero, as the token's authorization nonce, found by " +
        "`[AuthorizationUsed, null, nonce]` on the asset. " +
        NO_SEARCH_FOR_H,
      contracts: ["the escrow (v1.1 or v1.0 deployment)", "the deployment's EIP-3009 collector", "the asset"],
      lapse: ESCROW_LAPSE,
    },
    destination: "the escrow's `PaymentInfo.receiver`, compared with the option's `payTo`; the deployment's collector is the transfer's recipient",
    asset: "the token the authorization moves, recorded as observed and compared with nothing",
    payer: "the escrow's `PaymentInfo.payer`, the token authorization's signer",
    confirmed: "no",
    proves:
      "The payer signed a token authorization whose nonce commits, through the escrow's PaymentInfo, to a salt " +
      "that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and policy " +
      "when bound. The token contract verified the signature when the escrow collected the payment, and the " +
      "escrow's event carries the salt. When unbound, the salt is this ATR's hash, so the settled transaction " +
      "itself shows it. When bound, a holder of the ATR, the receiver authorizer and the policy can confirm " +
      "the hash from the salt; the chain alone does not reveal it. This record covers that first collection; " +
      "capture, void, refund and reclaim are the operator's and the payer's.",
  },
  "x402/auth-capture/eip155/permit2": {
    coverage: "full",
    carrier: {
      signed:
        "`PaymentInfo.salt`: H where `receiverAuthorizer` and `policy` are absent, else `keccak256` over a typehash, both " +
        "and H; a bound salt travels with `saltNonce`, which is H",
    },
    source: "lcp's client",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, logs, `eth_call`, a block by mark with its timestamp",
      search:
        "The escrow's payment hash with payer zero, as the Permit2 nonce, found by the escrow's event by payment id " +
        "(`PaymentAuthorized`, or `PaymentCharged` for the `authorization` flow). " +
        NO_SEARCH_FOR_H,
      contracts: ["the escrow (v1.1 or v1.0 deployment)", "the deployment's Permit2 collector", "Permit2"],
      lapse: ESCROW_LAPSE,
    },
    destination: "the escrow's `PaymentInfo.receiver`, compared with the option's `payTo`; the deployment's collector is the transfer's recipient",
    asset: "the token the permit moves, recorded as observed and compared with nothing",
    payer: "the escrow's `PaymentInfo.payer`, the token authorization's signer",
    confirmed: "no",
    proves:
      "The payment presented a Permit2 authorization whose nonce commits, through the escrow's PaymentInfo, to " +
      "a salt that is this ATR's hash when unbound, or a commitment over it with the receiver authorizer and " +
      "policy when bound. The escrow's event in the settlement transaction carries that PaymentInfo, salt " +
      "included; it does not show which collector funded the payment. When unbound, the salt is this ATR's " +
      "hash, so the settled transaction itself shows it. When bound, a holder of the ATR, the receiver " +
      "authorizer and the policy can confirm the hash from the salt; the chain alone does not reveal it. This " +
      "record covers that first collection; capture, void, refund and reclaim are the operator's and the " +
      "payer's.",
  },
  "x402/batch-settlement/eip155": {
    coverage: "full",
    carrier: {
      signed:
        "`ChannelConfig.salt`, which is H; in refund-authorizer mode the deposit authorization's salt " +
        "(`erc3009Authorization.salt`, or the Permit2 deposit nonce) is H, and the channel salt is " +
        "`bytes12(entropy) ‖ bytes20(refundAuthorizer)`",
    },
    source: "lcp's client",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, logs, `eth_call`, a block by mark with its timestamp",
      search:
        "The deposit authorization's nonce on the token or Permit2, found by `[AuthorizationUsed, null, keccak256(channelId, " +
        "salt)]` on the token, or `Deposited` by channel id. " +
        NO_SEARCH_FOR_H,
      contracts: ["the channel contract", "the token or Permit2 (the deposit collector)"],
      lapse:
        "the deposit's `validBefore` or `deadline`: the value unconsumed at a final block past it; no `failed` is answered " +
        "while no search for H is defined",
    },
    destination: "the channel's `receiver`, compared with the option's `payTo`",
    asset: "the payer's transfer into the channel, its token recorded as observed and compared with nothing",
    payer: "the channel's `payer`",
    confirmed: "no",
    proves:
      "The payer signed a token authorization for a deposit into an x402 batch-settlement channel whose " +
      "identifier, the EIP-712 hash of the channel's configuration, commits to this ATR's hash as the " +
      "configuration's salt. The token contract or Permit2 verified that signature when the channel contract " +
      "collected the deposit, and the hash is on chain as the salt in the channel's ChannelCreated event. Each " +
      "voucher in this channel signs a commitment to this ATR's hash. This does not show that amount, payee, " +
      "asset or timing match the ATR's content.",
  },
  "x402/batch-settlement/cloudflare": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: Cloudflare writes its own 402, so the seller's H never reaches the buyer",
    nonce: "unshown",
    broadcasts: "payee",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The buyer's agent signed, with the HTTP message signature key it " +
      "registered with Cloudflare, a request whose PAYMENT-SIGNATURE header echoes this ATR's hash in the " +
      "legalContext entry of x402's extensions. Cloudflare verifies that signature and bills the agent's " +
      "registered identity off chain. This does not show that amount, asset or timing match the ATR's content.",
  },
  "x402/exact/eip155/erc7710-salt": {
    coverage: "full",
    carrier: { signed: "the leaf delegation's `salt`, which is H, all of H, through the reference manager on a chain of its list" },
    source: "lcp's client; x402 ships no ERC-7710 client",
    nonce: "reusable",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, logs, a block by mark",
      search:
        "The manager's `RedeemedDelegation` by root delegator (topic 1), each hit tested for a leaf whose delegate is the " +
        "redeemer and whose salt is H, searched to the end of the payment's hold; lcp declares no search.",
      contracts: ["the reference delegation manager"],
      lapse: "none: a delegation signs no bound, so it is searched to the end of the payment's hold and is never `failed`",
    },
    destination: "the token's `Transfer` from the payment's `delegator`, its `to` compared on a charge with the option's `payTo`",
    asset: "that `Transfer`'s token, compared with nothing",
    payer: "the root delegator; every delegator from the root through the leaf is tested as signer of H",
    confirmed: "no",
    proves:
      "The leaf delegation of the permission context redeemed for this payment, made through MetaMask's " +
      "DelegationManager, carries this ATR's hash as its signed salt. The manager verified every delegation's " +
      "signature when it redeemed them, and the leaf, with its salt, is in a RedeemedDelegation event in the " +
      "settlement transaction. The leaf's signer is its delegator, which may be an account the paying account " +
      "authorised rather than the paying account itself. This does not show that amount, payee, asset or " +
      "timing match the ATR's content.",
  },
  "x402/exact/eip155/erc7710": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: nothing the delegator signed holds H, which rides only in the echoed legal-context extension",
    nonce: "reusable",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, a transaction, a block by mark",
      search:
        "No search: the transaction the seller names, read for a `Transfer` from the payment's `delegator` to the option's " +
        "`payTo`, whatever its amount, after the position recorded when the agreement settled, and never the agreement's " +
        "own transaction.",
      contracts: [],
      lapse: "none: never `failed` for lapse",
    },
    destination: "the token's `Transfer` from the payment's `delegator`, its `to` compared with the option's `payTo`",
    asset: "that `Transfer`'s token, compared with nothing",
    payer: "the payment's `delegator`, who signed nothing holding H",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The ATR was assembled and delivered before the payment, and the " +
      "buyer's payment payload echoed this ATR's hash in the legalContext entry of x402's extensions. The " +
      "buyer's delegation does not sign the hash, and the settlement transaction does not carry it.",
  },
});
