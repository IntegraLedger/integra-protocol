/** The data of the MPP pairings on EVM chains and Tempo, and of `usdc` on EVM chains and Circle Gateway. */
import { freeze } from "./freeze.js";

const AUTHORIZATION_SEARCH =
  "`[AuthorizationUsed, payer, nonce]` on every contract, a hit on another contract counted only where the payer's " +
  "signature verifies in that contract's own domain, one the read cannot decode or verify holding the search at it; a " +
  "cancellation by `[AuthorizationCanceled, null, nonce]` on the asset. From the position the caller gives to the latest " +
  "head, in pages of at most 10,000 blocks halved where the endpoint refuses one, the position reached returned.";

const NAMED_TRANSACTION =
  "No search: the transaction the seller names, read after the position recorded when the agreement settled, and never " +
  "the agreement's own transaction.";

const NO_SEARCH_FOR_H = "every answer that would be `failed` is `pending`, `search-incomplete`, since no search for H is defined";

const TEMPO_SPLIT_SEARCH =
  "`[TransferWithMemo, payer, any, H]` on every contract, by a filter that names no address, and the receive-policy " +
  "guard's `TransferBlocked` by its topic alone, each receipt kept where its originator is the payer and its memo H, one " +
  "that does not decode holding the search; from the position the caller gives to the latest head, in pages of at most " +
  "10,000 blocks, halved for a range the endpoint refuses; each hit tested against the act asked about: on pull the " +
  "landed transaction's sender-signed fields hashed as `expiringNonceHash` hashes them equal the presented " +
  "transaction's, on push the transaction is the one the credential names. A value read consumed whose transaction the " +
  "search did not find is found in the first block it reads consumed at, by halving the blocks, and that block's " +
  "transactions.";

const TEMPO_SPLIT_LAPSE =
  "the transaction's signed `validBefore`; one that signs none has no bound. The single-use value is the Tempo " +
  "transaction's own nonce, read by its nonce key at `finalized` and at `latest`, each at the last block below " +
  "`validBefore` once the head is past it: the expiring nonce's slot in the nonce precompile, a 2D lane's `getNonce`, " +
  "the protocol nonce's count. A reverted transaction of the payer's own is included and its nonce consumed";

const TEMPO_SPLIT_PROVES =
  "The ATR's hash is in the MPP Tempo charge challenge the payer answered: its id is the hash in base64url with the " +
  "challenge's position, and one of its splits carries the hash as its memo. The payer's own signed Tempo transaction " +
  "carries all of the hash as the memo of a `transferWithMemo` call, and the chain verified the payer's signature when it " +
  "executed the call. The record states \"paid\" where value moved, with the account it reached, and \"signed\" where " +
  "nothing moved. This does not show that amount, payee, asset or timing match the ATR's content.";

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
    destination:
      "the asset contract's own `Transfer` paired with `AuthorizationUsed`, never the system emitter's log Arc adds beside it; " +
      "its `to` compared on a charge with the challenge's `recipient`",
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
    carrier: {
      signed:
        "the Permit2 witness's `challengeHash`, a digest over the challenge holding H; the permit's `nonce` is required to be the same value, and `bound` refuses a permit under another",
    },
    source: "lcp's client; no stock client writes it",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      fallback: "json-rpc",
      search:
        "Every contract's `Transfer` from the payer, each hit counted only where its transaction carries the nonce or the " +
        "witness word of a challenge of the sale's issue on this pairing and chain, the chosen one's and each one the " +
        "caller gives `reference` as `issue`, in the Permit2 witness transfer whose owner is the payer, naming the hit's token, " +
        "recipient and amount, the bit of the call's own nonce set at its block and unset before; a cancellation by Permit2's `UnorderedNonceInvalidation` with the payer as owner; an " +
        "EIP-3009 use of the same nonce the token logged, the `authorization` charge of the same challenge, an act of " +
        "another kind. From the position the caller gives to the latest head, in pages of at most 10,000 blocks.",
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
    destination:
      "an asset contract's own `Transfer` in the named transaction to the challenge's `recipient`, never the system " +
      "emitter's log Arc adds beside it; for a reverted transaction, which moved nothing, the recipient of the `transfer` " +
      "call that is the transaction's own",
    asset: "that transfer's token, compared with nothing",
    payer: "the named transaction's signer, read for the test that the payee did not sign",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, an account signed an agreement carrying this ATR's hash on <network>, recorded in " +
      "<transaction>; that shows neither that the account is the payer nor when this charge was taken. The payment " +
      "is an ERC-20 transfer signed as a whole transaction (`transaction`), or broadcast by its signer and named by " +
      "its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction " +
      "does not carry the hash; the read found that the named transaction succeeded and moved a token to the " +
      "challenge's recipient. This does not show that amount, payee, asset or timing match the ATR's content.",
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
    destination:
      "an asset contract's own `Transfer` in the named transaction to the challenge's `recipient`, never the system " +
      "emitter's log Arc adds beside it; for a reverted transaction, which moved nothing, the recipient of the `transfer` " +
      "call that is the transaction's own",
    asset: "that transfer's token, compared with nothing",
    payer: "the named transaction's signer, read for the test that the payee did not sign",
    agreementOn: "any",
    confirmed: "no",
    proves:
      "Before this payment, an account signed an agreement carrying this ATR's hash on <network>, recorded in " +
      "<transaction>; that shows neither that the account is the payer nor when this charge was taken. The payment " +
      "is an ERC-20 transfer signed as a whole transaction (`transaction`), or broadcast by its signer and named by " +
      "its hash (`hash`), answering a challenge whose id and opaque carry this ATR's hash. The payment transaction " +
      "does not carry the hash; the read found that the named transaction succeeded and moved a token to the " +
      "challenge's recipient. This does not show that amount, payee, asset or timing match the ATR's content.",
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
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      search:
        "the opening by its funding, the escrow emitting no event: an `authorization` by the currency's " +
        "`[AuthorizationUsed, payer, nonce]`, a `permit2` by every contract's `Transfer` from the payer to the escrow, each " +
        "transaction decoded for the escrow's `openWithAuthorization` or `openWithPermit2` calls, each call's signer its " +
        "`from`, from the position given to the latest head. A call counts only where the receipt shows the escrow ran it: " +
        "an `openWithAuthorization` by its token's `AuthorizationUsed` of its `from` and the nonce the escrow recomputes, an " +
        "`openWithPermit2` or `open` only as the transaction's own call to the escrow; a call carrying H or the funding's " +
        "nonce not shown so is an item the read cannot decode. Neither is a search for H, the nonce being a digest over the payee and the token as well and a " +
        "permit's nonce any unused value, so " +
        NO_SEARCH_FOR_H +
        ".",
      contracts: ["the session's escrow", "the token (an `authorization` opening) or Permit2 (a `permit2` opening)"],
      lapse:
        "the funding's value, `authorizationState(payer, nonce)` on the currency or the payer's Permit2 bit at the nonce " +
        "it signed, read at the `finalized` block and at the latest block, against the `authorization`'s `validBefore` or " +
        "the `permit2`'s `deadline`; no `failed` but `before-position` is answered, no search for H being made",
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
      "whose witness carries the salt. The seller read that the opening transaction succeeded and moved the " +
      "payer's deposit to the escrow, and that the escrow ran the open call as the transaction shows it: an " +
      "`openWithAuthorization` by its token's AuthorizationUsed of the payer and the nonce the escrow recomputes over " +
      "the channel parameters and the salt, or an `openWithPermit2` as the transaction's own call to the escrow. Its " +
      "salt is this ATR's hash, its payee is the channel's beneficiary, and the payer is the account its " +
      "authorization or permit is signed by, whose deposit moved to the escrow. This does " +
      "not show that amount, payee, asset or timing match the ATR's content. Each voucher in this channel " +
      "signs a commitment to this ATR's hash.",
  },
  "mpp/charge/tempo/split-memo": {
    coverage: "full",
    carrier: {
      signed:
        "the `memo` of the one `transferWithMemo` call to `currency` whose memo is H, the split `{recipient, amount: 1, memo: H}` " +
        "the challenge carries, in the Tempo transaction the payer signs; all of H",
      member: ["methodDetails", "splits"],
    },
    source: "stock `mppx` 0.17.6 and pympp 0.20.0, copying each split's `memo` from the challenge's `methodDetails.splits` into its transfer",
    nonce: "single-use",
    broadcasts: "payee",
    read: {
      endpoint: ["json-rpc"],
      note:
        "an endpoint that answers `eth_getLogs` with a filter naming no address, in ranges of up to 10,000 blocks, and " +
        "`eth_getStorageAt`, `eth_call` and `eth_getTransactionCount` at the blocks the value is read at",
      search: TEMPO_SPLIT_SEARCH,
      contracts: ["the receive-policy guard", "the nonce precompile"],
      lapse: TEMPO_SPLIT_LAPSE,
    },
    destination:
      "every token transfer the transaction's calls make from the payer, each by its `Transfer` log; a charge pays where one " +
      "of them goes to the challenge's `recipient`",
    asset: "each of those transfers' token, compared with nothing",
    payer: "the transaction's sender, recovered from the signed bytes in their `0x76` form, whether a `0x76` or a `0x78` envelope carried them",
    confirmed: "no",
    agreement: {
      floor: "2",
      fee: "the resource server's settler under `feePayer: true`, the payer in the fee token under `feePayer: false`",
      succeeded:
        "the receipt's `status` is 1 for the act's own transaction, whose sender is the payer, a `source` the credential carries " +
        "naming the same account, and in it a token emitted `TransferWithMemo` from the payer with memo H, its recipient recorded as observed",
    },
    proves: TEMPO_SPLIT_PROVES,
  },
  "mpp/charge/tempo/split-memo/push": {
    coverage: "full",
    carrier: {
      signed:
        "the `memo` of the one `transferWithMemo` call to `currency` whose memo is H, in the Tempo transaction the payer signed " +
        "and broadcast; all of H",
      member: ["methodDetails", "splits"],
    },
    source: "stock `mppx` 0.17.6 and pympp 0.20.0, copying each split's `memo` from the challenge's `methodDetails.splits` into its transfer",
    nonce: "single-use",
    broadcasts: "payer",
    read: {
      endpoint: ["json-rpc"],
      note:
        "an endpoint that answers `eth_getLogs` with a filter naming no address, in ranges of up to 10,000 blocks, and " +
        "`eth_getStorageAt`, `eth_call` and `eth_getTransactionCount` at the blocks the value is read at",
      search: TEMPO_SPLIT_SEARCH,
      contracts: ["the receive-policy guard", "the nonce precompile"],
      lapse: TEMPO_SPLIT_LAPSE,
    },
    destination:
      "every token transfer the transaction's calls make from the payer, each by its `Transfer` log; a charge pays where one " +
      "of them goes to the challenge's `recipient`",
    asset: "each of those transfers' token, compared with nothing",
    payer: "the landed transaction's sender, recovered from its signed bytes",
    confirmed: "no",
    proves: TEMPO_SPLIT_PROVES,
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
      contracts: ["the session's escrow", "the nonce precompile"],
      lapse:
        "the opening's signed `validBefore`; its value, the opening transaction's nonce, is read by its nonce key at " +
        "`finalized` and at `latest`; no `failed` is answered while no search for H is defined",
    },
    destination: "the escrow's channel `payee`, recorded as the beneficiary and compared with the challenge's `recipient`",
    asset: "the channel's token, recorded and compared with nothing",
    payer:
      "the sender of the Tempo transaction the payer signed, recovered from its `0x76` form, whether a `0x76` envelope or the " +
      "`0x78` envelope a stock signer sends when the seller pays the fee carried it, the `0x78` envelope's item 11 naming that sender",
    confirmed: "no",
    proves:
      "The ATR's hash is in the MPP session challenge this channel opened under: its id is the hash in " +
      "base64url with the challenge's position. The payer signed a Tempo transaction whose one call to the " +
      "channel escrow opens a channel with this ATR's hash as its salt, and the chain verified that signature " +
      "when it executed the call. The escrow's ChannelOpened event names the channel, whose id commits to the " +
      "salt, and carries the salt itself, on the v1 escrow as on the TIP-1034 escrow. This does not show that amount, " +
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
      note:
        "an endpoint that answers `eth_getLogs`, and `eth_call` and `eth_getBlockByNumber` with its transactions at the " +
        "blocks the key slot is read at",
      search:
        "The account keychain's `KeyAuthorizationWitness` whose witness topic is H and whose account topic is the payer's " +
        "account, whose root key signed the key authorization, from the position given to the latest head; the search " +
        "leaves the account topic open, so that a witness log under another account is met and named a foreign item. " +
        "A key slot read consumed whose transaction the search did not find is found in the first block it reads " +
        "consumed at, by halving the blocks, as the payer's transaction there whose key authorization names the key or " +
        "whose own keychain call authorizes it, its receipt deciding: a reverted activation is `transaction-failed`.",
      contracts: ["the account keychain"],
      lapse:
        "the key authorization's signed `expiry`; one that signs none has no bound. The single-use value is the key slot " +
        "the presented key authorization names in the payer's keychain, `getKey(account, keyId)` at `finalized` and at " +
        "`latest`, consumed where it names the key or reads it revoked; the keychain registers a key id once, whatever the " +
        "transaction's result, and none whose expiry has passed",
    },
    destination:
      "the one account the payer's key authorization lets the key pay, read from the key authorization the landed " +
      "transaction carries, compared with the option's payee",
    asset:
      "every token transfer from the payer's account in the same transaction, the `currency` transfer among them, " +
      "recorded as what moved with its recipient, a transfer the receive-policy guard held as moved to the guard " +
      "(`nothing` where none)",
    payer:
      "the account whose root key signed the key authorization, recovered from its signature, compared with the " +
      "witness log's account topic",
    confirmed: "no",
    proves:
      "The ATR's hash is the MPP subscription challenge's id, in base64url. The payer's root key signed a " +
      "Tempo key authorization whose witness is this ATR's hash, granting the seller's access key a per-period " +
      "limit. The chain verified that signature when the activation transaction registered the key, and the " +
      "account keychain's KeyAuthorizationWitness event carries the payer's account and this hash as topics. " +
      "The key authorization names one recipient the key may pay; what the same transaction transferred " +
      "from the payer's account, if anything, is recorded as what moved, with its recipient. This does not show " +
      "that amount, period, payee, asset or timing match the ATR's content.",
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
    destination:
      "the asset contract's own `Transfer` paired with `AuthorizationUsed`, never the system emitter's log Arc adds beside it; " +
      "its `to` compared on a charge with the challenge's `recipient`",
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
