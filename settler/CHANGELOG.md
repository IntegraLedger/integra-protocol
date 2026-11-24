# Changelog

Every release of `@integraledger/profile-facilitator`, the settler, with what an operator must act on. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The package is 0.x: a minor release may change the
configuration, the answers or the storage.

## [Unreleased]

### Fixed

- `xrpl`: a payment that validated after its first `/settle` answered `settlement_pending` was never answered settled:
  lcp's read through the settler's node reader answered `unreadable` for every landed transaction it read by `tx`,
  whose binary answer names the transaction `tx` on rippled's API version 1, the settler's default (rippled 3.1.3,
  xrpld 3.3.0), and `tx_blob` with `meta_blob` on version 2, while the reader took only `tx_blob` with `meta`. It now
  takes either form, from `tx` and from `account_tx` (note row 9).
- `xrpl`: lcp's read searched the payer's history to the open ledger (`ledger_current`), which `account_tx`, reading
  validated ledgers only, never covers, so a lapsed, consumed or `tec` payment read `pending/search-incomplete` at rest
  and never final `failed`, and a read during which a ledger closed could answer final and the next read pending. The
  search now ends at the validated ledger of the same `server_info` answer, as the Binder's XRPL reader's does; the
  reader no longer calls `ledger_current` (note row 29).

## [0.5.1] - 2026-11-20

### Changed

- The peer dependency is `@integraledger/lcp` `~0.6.3` (0.5.0: `~0.6.0`). Install `@integraledger/lcp@~0.6.3` beside
  it: the `starknet` kind takes an amount of zero on Starknet Sepolia's STRK and USDC, as lcp does from 0.6.3.
- The README's module table gives each pairing's `confirmed` as `@integraledger/lcp`'s registry now states it: `yes`
  on `x402/exact/cardano/lock`, `x402/exact/eip155/permit2`, `x402/upto/eip155/permit2`,
  `x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2`, `x402/batch-settlement/eip155`,
  `x402/exact/eip155/erc7710`, `x402/exact/eip155/erc7710-salt` and `x402/upto/xrpl`, each shown end to end by a
  recorded run on a test network. No module's behaviour changes.
- `GET /supported`: each kind's `extra.acceptsZero` is the list of its pairings that take an amount of zero, `[]`
  where none does, where 0.5.0 stated a boolean for the kind. An option of amount zero is refused
  `invalid_payment_requirements` where its pairing is not in the list. `exact` on an `eip155` network names
  `x402/exact/eip155/eip3009`, whose transfer of zero Base Sepolia's USDC takes, and not `x402/exact/eip155/permit2`,
  whose proxy reverts at zero; `sui` names `x402/exact/sui`, a transfer of zero having executed on Sui testnet where the
  buyer pays gas; `starknet` names `x402/exact/starknet` on `starknet:SN_SEPOLIA`, where lcp takes an amount of zero on
  STRK and USDC, each of whose `transfer` of 0 emits a `Transfer` of 0, and states `[]` on `starknet:SN_MAIN`.
  `polkadot` states `[]`. Each module's list and its evidence are in [The modules](./README.md#the-modules).

### Fixed

- `x402/upto/eip155/permit2`: `/settle` of a charge below the maximum the payment accepted, the requirements x402's
  `upto` resource server sends, was refused `invalid_payload`. Requirements that are the option the payment accepted in
  every member but an `amount` at or below the accepted one are held as that option, and the check `/settle` makes
  before it submits verifies the permit against the accepted maximum, as the class's own settle does
  ([The modules](./README.md#the-modules)).
- `x402/upto/solana`: `/settle` of the deposit and of the claim x402's `upto` resource server sends, each carrying the
  `type` that server adds, was refused `invalid_upto_svm_payload_type` by the check `/settle` makes before it submits,
  the class's `verify` of an opening. A deposit is checked as the buyer sent it, without the `type`, and a claim by the
  class's own settle ([The modules](./README.md#the-modules)).

## [0.5.0] - 2026-11-18

The settler for the x402 pairings `@integraledger/lcp` 0.6.0 ships, on x402's own facilitator class (`@x402/core`
2.31.0) with one module per chain form. 0.4.0 served Tron and Polkadot alone.

### Changed

- The package moved into this repository, in [`settler/`](https://github.com/IntegraLedger/integra-protocol/tree/main/settler):
  its `repository`, `homepage` and `bugs` name `IntegraLedger/integra-protocol`. 0.4.0 and earlier were published from
  another repository, and this file starts at 0.5.0.
- The peer dependency is `@integraledger/lcp` `~0.6.0` (0.4.0: `~0.5.0`). Install `@integraledger/lcp@~0.6.0` beside it.
- `engines.node` is `>=24.22.1` (0.4.0: `>=24`).
- Storage. The record moves from the table `settlement` to the table `instrument`, beside two new tables, `fee` and
  `module_state`, all three created at start where they do not exist ([Storage](./README.md#storage)). 0.5.0 never
  reads or writes `settlement`, and does not fill `instrument` from it. The role in `store.url` needs `CREATE` on the
  schema and owns the tables ([The database](./README.md#the-database)).
- The record keys a payment by its instrument: a Tron payment by its transaction id, as before, and a Polkadot payment
  by its signer and the account nonce it signed, no longer by the extrinsic's hash, so a payment signed again at the
  same nonce is the same payment.
- A repeated `/settle` of a payment the record holds final is answered `invalid_transaction_state` naming the
  transaction the row holds, whatever the first answer was. 0.4.0 answered a stored success so, and returned any other
  stored final answer as first given.
- `GET /supported`: each kind's `extra` also states `pairings`, `key` and `acceptsZero`, and `feeBudget: true` on a
  network with a fee budget; `signers` is keyed by CAIP family (`"tron:*": []`, `"polkadot:*": []`), where 0.4.0
  answered `{}`.
- A request body may hold up to 132,096 bytes (0.4.0: 65,536); a larger one is answered `413`.

### Added

- Sixteen modules, each started by its own member of the configuration: `algorand`, `aptos`, `cardano`, `casper`,
  `concordium`, `erc7710`, `evm`, `hedera`, `lnbtc`, `near`, `solana`, `starknet`, `stellar`, `sui`, `ton` and `xrpl`,
  beside `tron` and `polkadot`. Each module's networks, pairings, key and the registry's `confirmed` value for each
  pairing are in [The modules](./README.md#the-modules). `casper` serves `casper:casper-test` alone and does not start
  on `casper:casper`; `x402/exact/casper` and `x402/exact/ccd` are served with `confirmed` `no`. The `cardano`,
  `concordium` and `ton` modules take an lcp reader the operator writes.
- `credential`: the bearer credential every call must then present. A deployment with a module whose key is not
  `none` does not start without it; `tron` and `polkadot` hold no key, so a 0.4.0 configuration starts without one. A
  call without it is answered `401` before its body is read.
- `feeBudgets`, at most one per network, which cap the fees a module's key pays; a spent budget is answered
  `fee_budget_spent`.
- The export `FeeBudgetConfig`.
- `extra.acceptsZero`: a kind that states `false`, as Tron's and Polkadot's do, refuses an option of amount zero
  `invalid_payment_requirements`.
- Start refusals for the new members (a credential's characters, fee budgets, the modules' own members, a keyed module
  without `credential`), each listed with its message in [What stops the start](./README.md#what-stops-the-start).

### Unchanged

- The configuration members `listen`, `store`, `settleWaitMs`, `operatorLog`, `tron` and `polkadot`, with the same
  shapes, and the server's request timeout of `settleWaitMs` plus 60 seconds.

### Upgrading from 0.4.0

0.5.0 does not know the payments 0.4.0 answered, and judges a repeated `/settle` of one afresh, by the module's checks
and lcp's read of the chain ([Upgrading from 0.4.0](./README.md#upgrading-from-040)):

- A payment 0.4.0 answered success is never answered success again: Tron's checks refuse a transaction id the node
  holds in its blocks or pending pool, and an expiration passed; Polkadot's node no longer answers the extrinsic valid
  once its nonce is used. The answer is `invalid_transaction_state` naming the transaction where lcp's read shows the
  payment final, and otherwise the check's refusal.
- A payment 0.4.0 answered `settlement_pending` is answered the same way once its transaction is in a block, so 0.5.0
  never answers it success, though it landed; a Polkadot extrinsic still in the node's pool when the repeat arrives is
  claimed and answered success once final.
- Neither rail lets one signed payment land twice. Finish 0.4.0's pending payments on 0.4.0 before switching, or read
  them with lcp's `status`, and do not run both versions at once for the same payments: each keeps its own record, and
  each can answer one payment success.

[0.5.1]: https://github.com/IntegraLedger/integra-protocol/tree/settler-v0.5.1/settler
[0.5.0]: https://github.com/IntegraLedger/integra-protocol/tree/settler-v0.5.0/settler
