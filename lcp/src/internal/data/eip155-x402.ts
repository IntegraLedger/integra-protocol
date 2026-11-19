/** The data of the x402 pairings on EVM chains, and of Cloudflare's batch settlement. */
import { freeze } from "./freeze.js";

const PERMIT2_NOTE =
  "receipt, logs, a transaction (the hit's input), `eth_call` (`nonceBitmap`), a block by mark with its timestamp; the " +
  "archival fallback for Permit2 state the node no longer holds";

const NO_SEARCH_FOR_H =
  "This is no search for H, and none is defined: every answer that would be `failed`, but `before-position`, is " +
  "`pending`, `search-incomplete`.";

/**
 * How a read that holds its single-use value finds, below the position recorded at issue, the transaction that consumed
 * it, by `logs`, the indexed logs that name it in one block.
 */
const belowPosition = (logs: string): string =>
  " Where the value reads consumed and the search has found no transaction that consumed it, the value is read at the " +
  "position recorded at issue; consumed there, the first block at which it reads consumed is found by halving the range " +
  "from the network's first block, and " + logs + " in that block name the transaction: `failed`, `before-position`, " +
  "naming it, or, where none is found, `pending`, `search-incomplete`.";

const ESCROW_LAPSE =
  "`preApprovalExpiry`: the value unconsumed at a final block past it; no `failed` is answered while no search for H is defined";

/** The networks of the reference DelegationManager's deployments, `DELEGATION_MANAGER_CHAINS` as CAIP-2 ids. */
const DELEGATION_MANAGER_NETWORKS = [
  "eip155:1", "eip155:10", "eip155:56", "eip155:97", "eip155:100", "eip155:130", "eip155:137", "eip155:143",
  "eip155:146", "eip155:1155", "eip155:1301", "eip155:1328", "eip155:1329", "eip155:2020", "eip155:2021",
  "eip155:4114", "eip155:4217", "eip155:4663", "eip155:5000", "eip155:5003", "eip155:5042", "eip155:5115",
  "eip155:6342", "eip155:6343", "eip155:8453", "eip155:10143", "eip155:10200", "eip155:13579", "eip155:14601",
  "eip155:42161", "eip155:42170", "eip155:42220", "eip155:42431", "eip155:46630", "eip155:50312", "eip155:57073",
  "eip155:59141", "eip155:59144", "eip155:80002", "eip155:80069", "eip155:80094", "eip155:84532", "eip155:421614",
  "eip155:560048", "eip155:737373", "eip155:747474", "eip155:763373", "eip155:5042002", "eip155:11142220",
  "eip155:11155111", "eip155:11155420",
];

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
        "contract counts only where the payer's signature verifies (by ecrecover in the contract's domain, or the payer's " +
        "ERC-1271 check), holds the search where the read cannot verify it or show it is not the payer's, and a " +
        "cancellation is the asset's " +
        "`[AuthorizationCanceled, null, H]`." +
        belowPosition("the asset's `[AuthorizationUsed, payer, H]` and `[AuthorizationCanceled, payer, H]` logs"),
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
    confirmed: "yes",
    agreement: {
      floor: "0",
      fee: "the party that submits, always; the buyer needs a key, and no funds where the amount is zero",
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "the receipt's `status` is 1, and in it the token called emitted `AuthorizationUsed(authorizer, nonce)`, `nonce` the " +
        "agreement's digest and `authorizer` the buyer's `from`, paired with its `Transfer`, recorded as what moved",
    },
    proves:
      "The payer signed an EIP-3009 transfer authorization whose nonce is this ATR's hash, or for an agreement the " +
      "agreement's value of it. The token contract " +
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
        "before any `failed`. A cancellation is Permit2's `UnorderedNonceInvalidation` with the payer as owner." +
        belowPosition("every contract's `Transfer` from the payer, counted so, and Permit2's `UnorderedNonceInvalidation` of the payer"),
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
      feePayer: { may: ["settler"], default: "settler" },
      succeeded:
        "`status` 1; the payer's `Transfer`, recorded as what moved; the transaction's input carrying the digest as the " +
        "nonce of the proxy call whose owner is the payer, the payer's bit for it set at the receipt's block and unset before",
    },
    proves:
      "The payer signed a Permit2 witness transfer whose nonce is this ATR's hash, or for an agreement the " +
      "agreement's value of it, with the scheme's x402 proxy as spender and the payee in the witness. Permit2 " +
      "verified the signature when the proxy executed the transfer, and the hash is in the settlement transaction's " +
      "calldata as the Permit2 nonce; no event carries it. This does not show that amount, payee, asset or timing " +
      "match the ATR's content.",
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
        "at its block and unset before; a cancellation by `UnorderedNonceInvalidation`." +
        belowPosition("every contract's `Transfer` from the payer, counted so, and Permit2's `UnorderedNonceInvalidation` of the payer"),
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
        "The escrow's `PaymentAuthorized` and `PaymentCharged` logs, each tested by its `PaymentInfo.salt` before its " +
        "transaction's receipt is read, the act the option's flow's event through the deployment's EIP-3009 collector; the value, the escrow's payment hash with payer " +
        "zero as the token's authorization nonce, read by `authorizationState` on the asset. " +
        NO_SEARCH_FOR_H +
        belowPosition("the escrow's `PaymentAuthorized` and `PaymentCharged` logs whose topic 1 is the payment hash"),
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
        "The escrow's `PaymentAuthorized` and `PaymentCharged` logs, each tested by its `PaymentInfo.salt` before its " +
        "transaction's receipt is read, the act the option's flow's event through the deployment's Permit2 collector; the value, the escrow's payment hash with payer " +
        "zero as the Permit2 nonce, read by the payer's `nonceBitmap` bit. " +
        NO_SEARCH_FOR_H +
        belowPosition("the escrow's `PaymentAuthorized` and `PaymentCharged` logs whose topic 1 is the payment hash"),
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
      "included, and names the deployment's Permit2 collector as the token collector that funded it. When unbound, the salt is this ATR's " +
      "hash, so the settled transaction itself shows it. When bound, a holder of the ATR, the receiver " +
      "authorizer and the policy can confirm the hash from the salt; the chain alone does not reveal it. This " +
      "record covers that first collection; capture, void, refund and reclaim are the operator's and the " +
      "payer's.",
  },
  "x402/batch-settlement/eip155": {
    coverage: "full",
    carrier: {
      signed:
        "`ChannelConfig.salt`, which is H, all of H; in the scheme's refund-authorizer mode (`extra.voucherManager` " +
        "`\"facilitator\"` with a non-zero `extra.refundAuthorizer`), whose channel salt packs entropy and the refund " +
        "authorizer, the deposit authorization's salt (`erc3009Authorization.salt`) or the Permit2 deposit's nonce, which is H",
    },
    source: "lcp's client",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, logs, `eth_call`, a block by mark with its timestamp",
      search:
        "The channel contract's `ChannelCreated` logs, each tested by its salt, and its `Deposited` logs of the channel; a " +
        "deposit is the opening where its transaction consumed the deposit authorization's nonce (`keccak256(channelId, " +
        "authSalt)` on the token, or the Permit2 nonce), any other deposit a later credential of the channel; another " +
        "channel's opening is its payer's only with the payer's transfer of its amount. In the refund-authorizer mode " +
        "the reference's channel salt carries no H, and the nonce is `keccak256(channelId, H)` or H. " +
        NO_SEARCH_FOR_H +
        belowPosition("the channel contract's `ChannelCreated` and `Deposited` logs whose topic 1 is the channel id"),
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
      "configuration's salt, or, in the scheme's refund-authorizer mode, whose own salt is this ATR's hash. The " +
      "token contract or Permit2 verified that signature when the channel contract collected the deposit, and the " +
      "hash is on chain as the salt in the channel's ChannelCreated event, or in that mode in the deposit call. " +
      "Each voucher in this channel signs a commitment to the channel, and so, outside that mode, to this ATR's " +
      "hash. This does not show that amount, payee, asset or timing match the ATR's content.",
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
      "The request whose payment echoed this ATR's hash in the legalContext entry of x402's extensions was signed " +
      "with an HTTP message signature key registered with Cloudflare, which Cloudflare verifies, billing that key's " +
      "registered identity off chain. The echoed hash only locates the sale: the pairing follows no agreement, and no " +
      "public ledger records the payment. This does not show that amount, asset or timing match the ATR's content.",
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
        "The manager's `RedeemedDelegation` by root delegator (topic 1), each hit tested for a delegation whose salt is H, " +
        "the leaf's (its delegate the redeemer or the wildcard) the act; searched for as long as the caller asks, never " +
        "read whole, so never `failed`.",
      contracts: ["the reference delegation manager"],
      chains: { "the reference delegation manager": DELEGATION_MANAGER_NETWORKS },
      lapse: "none: a delegation signs no bound, so it is searched for as long as the caller asks and is never `failed`",
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
      "Before this payment was taken, an account signed an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>; this shows neither that the account is the payer nor what the agreement " +
      "moved. The ATR was assembled and delivered before the payment, and the payment payload echoed this ATR's hash " +
      "in the legalContext entry of x402's extensions. The read found the named settlement transaction, after the " +
      "agreement's position, holding a transfer from the payment's delegator to the payee. The delegation does not " +
      "sign the hash, and the settlement transaction does not carry it.",
  },
  "x402/exact/eip155/gateway-batched": {
    coverage: "none",
    carrier: {
      signed:
        "the nonce of the `TransferWithAuthorization` signed in Circle Gateway's `GatewayWalletBatched` domain, which is " +
        "H, all of H; no public ledger shows it",
    },
    link: "h",
    source:
      "lcp's client; stock `@circle-fin/x402-batching` 4.0.0 draws the nonce at random (`src/nonce.ts:6-12`), so it " +
      "writes no H",
    nonce: "unshown",
    broadcasts: "payee",
    agreementOn: "same-network",
    confirmed: "yes",
    proves:
      "Before this payment was reported, an account signed an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>; this shows neither that the account is the payer nor when the payment " +
      "was taken. The payment presented was a Circle Gateway batched authorization whose nonce is this ATR's hash, " +
      "signed under the Gateway Wallet's domain; no public ledger records it, since a batch carries each depositor's " +
      "net change and no payment's nonce, and Circle's transfers API listing it by its nonce is Circle's statement, " +
      "not a ledger's. The seller reported it paid. This does not show that amount, payee, asset or timing match the " +
      "ATR's content.",
  },
  "spend-permissions/eip155": {
    coverage: "full",
    carrier: {
      signed:
        "the Spend Permission's `salt`, which is H, all of H: a member of the EIP-712 hash the account signs in the " +
        "SpendPermissionManager's domain, or of the permission the account's own `approve` call carries",
    },
    source: "lcp's client; or Coinbase's developer platform SDK given the salt (`@coinbase/cdp-sdk` 1.60.0, `createSpendPermission`)",
    nonce: "single-use",
    broadcasts: "either",
    read: {
      endpoint: ["json-rpc"],
      note: "receipt, logs, a transaction (a revocation's input), `eth_call` (`isApproved` and `isRevoked` of the permission), a block by mark",
      search:
        "The manager's `[SpendPermissionApproved, hash]` and `[SpendPermissionRevoked, hash]` logs, `hash` the " +
        "permission's, from the block after the position the caller gives to the latest head, in pages; the act the " +
        "approval, the permission decoding whole with `salt` H, signed by its `account`." +
        " Where the value reads consumed and the search has found no transaction that consumed it, the value is read at " +
        "the position the caller gives; consumed there, the first block at which it reads consumed is found by halving " +
        "the range from the network's first block, and the same two logs in that block name the transaction: `failed`, " +
        "`before-position`, naming it, or, where none is found, `pending`, `search-incomplete`.",
      history: "the log search from the position the caller gives to the latest head",
      contracts: ["the SpendPermissionManager"],
      lapse:
        "none: the manager approves at any time, so an unapproved permission is `pending`, `instrument-live`, for as " +
        "long as the caller asks; `failed`, `instrument-consumed` on the manager's `SpendPermissionRevoked` before any approval",
    },
    destination: "the permission's `spender`, compared with nothing: the approval moves nothing and is held to no account",
    asset: "the permission's `token`, compared with nothing",
    payer: "the permission's `account`, the signer of H, never the transaction's sender",
    confirmed: "yes",
    agreement: {
      floor: "0",
      fee:
        "the party that submits: the spender on the signature route, which calls `approveWithSignature`; the account, " +
        "or the paymaster its user operation names, on the transaction route",
      feePayer: { may: ["settler", "buyer", "paymaster"] },
      succeeded:
        "the receipt's `status` is 1, and in it the SpendPermissionManager emitted `SpendPermissionApproved` with the " +
        "permission's hash as its topic and the permission whole, `salt` H, as its data",
      only: true,
    },
    proves:
      "The account named signed a Spend Permission whose salt is this ATR's hash, naming the payee as spender, and " +
      "the SpendPermissionManager approved it: the hash is on chain in the permission its SpendPermissionApproved " +
      "event carries in the approval's transaction. The approval moves nothing. This does not show that any amount " +
      "was later spent, nor that the allowance, period, token or timing match the ATR's content.",
  },
});
