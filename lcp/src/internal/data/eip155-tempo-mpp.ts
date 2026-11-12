/** The data of the MPP pairings on EVM chains and Tempo, and of `usdc` on EVM chains and Circle Gateway. */
import { freeze } from "./freeze.js";

const AUTHORIZATION_SEARCH =
  "`[AuthorizationUsed, payer, nonce]` on every contract, a hit on another contract counted only where the payer's " +
  "signature verifies; a cancellation by `[AuthorizationCanceled, null, nonce]` on the asset. From the position recorded " +
  "at issue to the signed `validBefore`, and before any `failed` on to the latest head; lcp searches `currency`'s logs alone.";

const NAMED_TRANSACTION =
  "No search: the transaction the seller names, read after the position recorded when the agreement settled, and never " +
  "the agreement's own transaction.";

const NO_SEARCH_FOR_H = "every answer that would be `failed` is `pending`, `search-incomplete`, since no search for H is defined";

export const EIP155_TEMPO_MPP = /* @__PURE__ */ freeze({
  "mpp/charge/evm/authorization": {
    coverage: "full",
    carrier: {
      signed: "the EIP-3009 `nonce`, `keccak256(JSON.stringify([id, realm]))`, a 256-bit digest over a preimage holding H",
    },
    source: "stock `mppx` 0.17.6 and pympp, deriving the nonce from the echoed challenge's `id` and `realm`",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      search: AUTHORIZATION_SEARCH,
      contracts: ["the asset (`currency`, the EIP-3009 token)"],
      lapse:
        "`validBefore` (the challenge's `expires`): `authorizationState` false at a `finalized` block whose timestamp is at " +
        "or past it, and at the latest block, with the search of every contract read whole to the latest head",
    },
    destination: "the `Transfer` paired with `AuthorizationUsed`; its `to` compared on a charge with the challenge's `recipient`",
    asset: "that `Transfer`'s token, compared with nothing",
    payer: "the authorization's `from` (the authorizer)",
    confirmed: "no",
    agreement: {
      floor: "0",
      fee: "the settler",
      succeeded:
        "`status` 1 with `AuthorizationUsed(authorizer, nonce)`, the nonce derived from the challenge, paired with its " +
        "`Transfer`, recorded as what moved",
    },
    proves:
      "The payer signed an EIP-3009 transfer authorization whose nonce is keccak256 of this challenge's id and " +
      "realm, and the id is this ATR's hash in base64url with the challenge's position. The token contract " +
      "verified the signature when it executed the transfer, and the nonce is on chain as the nonce topic of " +
      "its AuthorizationUsed event. A holder of the ATR and the realm can confirm the hash from that nonce; " +
      "the chain alone does not reveal it. This does not show that amount, payee, asset or timing match the " +
      "ATR's content.",
  },
  "mpp/charge/evm/permit2": {
    coverage: "full",
    carrier: { signed: "the Permit2 witness's `challengeHash`, a digest over the challenge holding H; the permit's `nonce` is the same value" },
    source: "lcp's client; no stock client writes it",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      fallback: "json-rpc",
      search:
        "Every contract's `Transfer` from the payer, each hit counted only where its transaction carries the nonce in the " +
        "Permit2 call whose owner is the payer, the bit set at its block and unset before; a cancellation by Permit2's " +
        "`UnorderedNonceInvalidation` with the payer as owner. Until that search is declared, the transaction the seller names.",
      history: "an archive JSON-RPC endpoint for Permit2 state the node no longer holds",
      contracts: ["Permit2"],
      lapse: "`deadline` (the challenge's `expires`): the Permit2 bit unset at a `finalized` block past it, and at the latest block",
    },
    destination: "the `Transfer` from the payer in the hit's transaction; its `to` compared on a charge with the challenge's `recipient`",
    asset: "that `Transfer`'s token, compared with nothing",
    payer: "the Permit2 owner",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the seller's settler (the `spender`), with the seller's gas key",
      succeeded: "as the `mpp/charge` profile states for `permit2`",
    },
    proves:
      "The payer signed a Permit2 transfer, single or batch, whose witness carries keccak256 of this " +
      "challenge's id and realm, and the id is this ATR's hash in base64url with the challenge's position. " +
      "Permit2 verified the signature when it executed the transfer; a batch's transfers all executed in that " +
      "one call. The witness is in the settlement transaction's calldata only as a hash, and no event carries " +
      "it. This does not show that amount, payee, asset, splits or timing match the ATR's content.",
  },
  "mpp/charge/evm/transaction": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: nothing in the signed ERC-20 `transfer` carries H, and `bound` answers `mpp/no-signed-place`",
    nonce: "single-use",
    broadcasts: "either",
    read: {
      endpoint: ["json-rpc"],
      search: NAMED_TRANSACTION,
      contracts: [],
      lapse:
        "none: a relayed transaction that never lands signs no bound, and the payer's account nonce is no evidence of a " +
        "lapse; never `failed` by lapse",
    },
    destination: "a transfer in the named transaction to the challenge's `recipient`",
    asset: "that transfer's token, compared with nothing",
    payer: "the named transaction's signer, read for the test that the payee did not sign",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The payment is an ERC-20 transfer the buyer signed as a whole " +
      "transaction (`transaction`), or broadcast itself and named by its hash (`hash`), answering a challenge " +
      "whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the " +
      "seller's server bound the challenge, and the settlement transaction it reported succeeded and moved the " +
      "token. This does not show that amount, payee, asset or timing match the ATR's content.",
  },
  "mpp/charge/evm/hash": {
    coverage: "none",
    carrier: { signed: null },
    link: "none",
    source: "none: nothing in the signed ERC-20 `transfer` carries H, and `bound` answers `mpp/no-signed-place`",
    nonce: "single-use",
    broadcasts: "either",
    read: {
      endpoint: ["json-rpc"],
      search: NAMED_TRANSACTION,
      contracts: [],
      lapse: "none: never `failed` by lapse; while the named transaction is not found, `pending`, `not-found`",
    },
    destination: "a transfer in the named transaction to the challenge's `recipient`",
    asset: "that transfer's token, compared with nothing",
    payer: "the named transaction's signer, read for the test that the payee did not sign",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, the buyer signed and paid an agreement transaction carrying this ATR's hash on " +
      "<network>, recorded in <transaction>. The payment is an ERC-20 transfer the buyer signed as a whole " +
      "transaction (`transaction`), or broadcast itself and named by its hash (`hash`), answering a challenge " +
      "whose id and opaque carry this ATR's hash. The payment transaction does not carry the hash; the " +
      "seller's server bound the challenge, and the settlement transaction it reported succeeded and moved the " +
      "token. This does not show that amount, payee, asset or timing match the ATR's content.",
  },
  "mpp/session/evm": {
    coverage: "full",
    carrier: {
      signed:
        "the channel `salt`, which is H; an `authorization` funding's EIP-3009 nonce is a digest over the channel's " +
        "parameters and H, and a `permit2` funding's witness carries the salt",
    },
    source: "lcp's client",
    nonce: "unshown",
    broadcasts: "either",
    read: {
      endpoint: ["json-rpc"],
      search:
        "`ChannelOpened` by the channel id, and for an `authorization` opening `[AuthorizationUsed, null, nonce]`, to the " +
        "signed `validBefore` or `deadline`. Neither is a search for H, since both digests also cover payee and token, so " +
        NO_SEARCH_FOR_H +
        ".",
      contracts: ["the session's escrow", "the token (an `authorization` opening) or Permit2 (a `permit2` opening)"],
      lapse: "the `authorization`'s `validBefore` or the `permit2`'s `deadline`; no `failed` is answered while no search for H is defined",
    },
    destination: "the escrow's channel `payee`, recorded as the beneficiary and compared with the challenge's `recipient`",
    asset: "the channel's token, recorded and compared with nothing",
    payer: "the account the deposit moved from to the escrow",
    confirmed: "no",
    proves:
      "The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in " +
      "base64url with the challenge's position. The payer opened a payment channel whose salt is this ATR's " +
      "hash, so the channel id, keccak256 over the payer, payee, token, salt, authorized signer, escrow and " +
      "chain, commits to it. The payer signed that opening as an open call carrying the salt, an EIP-3009 " +
      "authorization whose nonce is MPP's hash over the channel parameters and the salt, or a Permit2 transfer " +
      "whose witness carries the salt, and the escrow and the token verified it on chain. The seller read that " +
      "the opening transaction succeeded and moved the payer's deposit to the escrow. Where the payer sent the " +
      "open call, or a relayer sent the escrow's Permit2 opening, the seller read that call: it is to the " +
      "escrow, its salt is this ATR's hash, and its payer, payee, token and authorized signer give this " +
      "channel id, so the payer is the account that signed the call or, on Permit2, the transfer. This does " +
      "not show that amount, payee, asset or timing match the ATR's content. Each voucher in this channel " +
      "signs a commitment to this ATR's hash.",
  },
  "mpp/session/tempo": {
    coverage: "full",
    carrier: {
      signed: "the channel `salt`, which is H, in the `open` call to the escrow the payer signs; on the newer session protocol the descriptor carries it too",
    },
    source: "lcp's client under the stock method; stock `mppx` draws the salt at random and never broadcasts, so its opening is refused",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      search:
        "The escrow's `ChannelOpened` by the channel id computed over H, under each protocol version's topic. It is narrowed " +
        "to one payee and token, so it is no search for H, and " +
        NO_SEARCH_FOR_H +
        ".",
      contracts: ["the session's escrow"],
      lapse: "the opening's signed `validBefore`; no `failed` is answered while no search for H is defined",
    },
    destination: "the escrow's channel `payee`, recorded as the beneficiary and compared with the challenge's `recipient`",
    asset: "the channel's token, recorded and compared with nothing",
    payer: "the sender of the Tempo transaction the payer signed",
    confirmed: "no",
    proves:
      "The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in " +
      "base64url with the challenge's position. The payer signed a Tempo transaction whose one call to the " +
      "channel escrow opens a channel with this ATR's hash as its salt, and the chain verified that signature " +
      "when it executed the call. The escrow's ChannelOpened event names the channel, whose id commits to the " +
      "salt; on the TIP-1034 escrow the event also carries the salt itself. This does not show that amount, " +
      "payee, asset or timing match the ATR's content. Each voucher in this channel signs a commitment to this " +
      "ATR's hash.",
  },
  "mpp/subscription/tempo": {
    coverage: "full",
    carrier: { signed: "the key authorization's witness, the challenge `id`'s 32 bytes, which are H" },
    source: "stock `mppx` 0.17.6, from the challenge `id` lcp sets (the bare base64url of H)",
    nonce: "unshown",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      search:
        "The account keychain's `KeyAuthorizationWitness` whose witness topic is H and whose account topic is the payer's " +
        "account, whose root key signed the key authorization; lcp's search leaves the account open.",
      contracts: ["the account keychain"],
    },
    destination:
      "the one account the payer's key authorization lets the key pay, read from the key authorization the landed " +
      "transaction carries, compared with the option's payee",
    asset:
      "the `currency` transfer from the payer's account in the same transaction, recorded as what moved with its " +
      "recipient (`nothing` where none)",
    payer: "the account whose root key signed the key authorization (the witness log's account topic)",
    confirmed: "no",
    proves:
      "The ATR's hash is the MPP subscription challenge's id, in base64url. The payer's root key signed a " +
      "Tempo key authorization whose witness is this ATR's hash, granting the seller's access key a per-period " +
      "limit. The chain verified that signature when the activation transaction registered the key, and the " +
      "account keychain's KeyAuthorizationWitness event carries the payer's account and this hash as topics. " +
      "The same transaction transferred the token the payer's key authorization limits to the recipient it " +
      "allows. This does not show that amount, period, payee, asset or timing match the ATR's content.",
  },
  "mpp/charge/usdc/evm": {
    coverage: "full",
    carrier: {
      signed: "the EIP-3009 `nonce`, keccak256 of the JCS of `{id, method, realm, intent, requestHash}`, a digest over H",
    },
    source: "lcp's client; no stock library ships `usdc`",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      search: AUTHORIZATION_SEARCH,
      contracts: ["the asset (`currency`, the EIP-3009 token)"],
      lapse:
        "`validBefore`: `authorizationState` false at a `finalized` block at or past it, and at the latest block, with the " +
        "search of every contract read whole",
    },
    destination: "the `Transfer` paired with `AuthorizationUsed`; its `to` compared on a charge with the challenge's `recipient`",
    asset: "that `Transfer`'s token, compared with nothing",
    payer: "the authorization's `from` (the authorizer)",
    confirmed: "no",
    agreement: {
      floor: "1",
      fee: "the settler",
      succeeded: "as `mpp/charge/evm/authorization`, with the nonce derived from the challenge",
    },
    proves:
      "The payer signed an EIP-3009 authorization whose nonce is keccak256 of the JCS of this challenge's id, " +
      "realm and request hash, and the id is this ATR's hash in base64url with the challenge's position. The " +
      "token contract verified the signature when it executed the transfer, and the nonce is on chain in its " +
      "AuthorizationUsed event. A holder of the ATR, the realm and the request can confirm the hash; the chain " +
      "alone does not reveal it. This does not show that amount, payee, asset or timing match the ATR's " +
      "content.",
  },
  "mpp/charge/usdc/gateway": {
    coverage: "none",
    carrier: {
      signed: "the Circle Gateway burn intent's TransferSpec `salt`, a digest over the challenge `id`, which the payer signs and which is not public",
    },
    link: "h",
    source: "lcp's client",
    nonce: "unshown",
    broadcasts: "payee",
    destination:
      "the Gateway Minter's mint recipient, the TransferSpec's `destinationRecipient`, compared with the option's payee once " +
      "a run has shown it; not read until then",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "The payer signed a Circle Gateway burn intent whose TransferSpec salt is keccak256 of the JCS of this " +
      "challenge's id and parameters, and the id is this ATR's hash in base64url with the challenge's " +
      "position. The signature is not verified here. The salt travels inside the TransferSpec that the " +
      "destination mint carries, and the Gateway Minter emits that TransferSpec's keccak256 hash; this record " +
      "reads no chain, and settlement is the seller's report. This does not show that amount, payee, asset or " +
      "timing match the ATR's content.",
  },
});
