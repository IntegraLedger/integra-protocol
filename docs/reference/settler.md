---
title: Settler reference
description: The settler's exports, HTTP API, declarations, order of checks, record, reasons, storage, bounds and logs.
---

# Settler reference

The settler is the package `@integraledger/profile-facilitator`, in this repository's
[`settler/`](https://github.com/IntegraLedger/integra-protocol/tree/main/settler) folder. This page is for the operator
and the resource server's developer: every answer, reason, check, table, bound and log entry the settler gives.
[Run the settler](../guides/settler.md) starts it and configures each module. Version 0.5.0 takes
`@integraledger/lcp` `~0.6.0` as its peer ([Versions](../guides/settler.md#versions)).

## Exports

The package's entry point exports:

| Export | Kind | What it is |
|---|---|---|
| `serveProfileFacilitator(config)` | `(c: ProfileFacilitatorConfig) => Promise<{ close(): Promise<void> }>` | Opens the store, starts each configured module and the HTTP server, and resolves once it listens. If it cannot start, it closes what it opened and rejects with the error that stopped it. |
| `ProfileFacilitatorConfig` | type | The configuration: the core's members and one member per module ([Run the settler](../guides/settler.md)). |
| `FeeBudgetConfig` | interface | One entry of `feeBudgets`: `{ network, amount, periodSeconds }`. |

The [API pages](./api/index.md) cover `@integraledger/lcp` alone; the settler's exports are the three above.

## HTTP API

| Request | Answer |
|---|---|
| `GET /supported` | `200` `{kinds, extensions, signers}`. |
| `POST /verify` | `200` `{isValid: true, payer}` or `{isValid: false, invalidReason, invalidMessage?, payer?}`; `400` `{isValid: false, invalidReason: "invalid_payload"}` when the body is not JSON. |
| `POST /settle` | `200` `{success: true, transaction, network, payer}` or `{success: false, errorReason, errorMessage?, transaction, network}`; `400` with `errorReason` `invalid_payload` when the body is not JSON. |
| A call without the credential, where one is configured | `401` `{error: "unauthorized"}` with `WWW-Authenticate: Bearer`, before the body is read; the connection is closed. |
| A body over 132,096 bytes | `413`, and the connection is closed. |
| Another method on a served path | `405` `{error}`. |
| Any other path | `404` `{error}`. |
| An error outside every answer | `500` `{error: "internal error"}`, once its entry is in the operator log. |

The body bound is twice lcp's `MAX_HEADER_BYTES` (65,536), the largest payment payload and the largest option lcp's
x402 codec reads, and 1,024 bytes for the envelope.

### Reasons

| Reason | `/verify` | `/settle` | Meaning |
|---|---|---|---|
| `invalid_x402_version` | yes | yes | `x402Version` is not 2 in the request or the payload. |
| `invalid_network` | yes | yes | No configured module serves the network. |
| `unsupported_scheme` | yes | yes | No module registers the scheme on the network. On `lnbtc`, every `/verify`. |
| `invalid_payment_requirements` | yes | yes | The requirements are not ones the pairing's profile admits; an amount of zero whose pairing the kind's `extra.acceptsZero` does not name; a form outside the kind's pairings; an option the module refuses ([each module](../guides/settler.md#the-modules)). |
| `invalid_payload` | yes | yes | The payload does not match the profile or the requirements. |
| `unsupported_permission` | yes | yes | Tron: the owner's permission does not accept the transaction's signatures. |
| `invalid_transaction` | yes | yes | The node refuses the transaction in simulation or validation, in a module of the settler's own. |
| `invalid_transaction_state` | yes | yes | `/verify`: the record or the chain already holds the payment. `/settle`: a repeat of a final row, or a payment the chain shows failed, consumed by another act, lapsed or landed by another route; each names the transaction where one is known. |
| `fee_budget_spent` | yes | yes | The network's fee budget is spent, and the module's key would pay the fee. |
| `settlement_pending` | no | yes | Submitted, or possibly submitted, and not yet final or not yet stored when the wait ended; `transaction` names it. |
| `unexpected_verify_error` | yes | no | A node or the store could not be read. |
| `unexpected_settle_error` | no | yes | A node or the store could not be read before submission, the settle's wait ended before it, or the submission failed with nothing sent. |

`unsupported_permission`, `invalid_transaction` and `fee_budget_spent` are the settler's own; the others are x402's. A
published class's own reasons, such as `invalid_exact_evm_payload_signature`, pass unchanged.

## What `/supported` states

`GET /supported` answers `{kinds, extensions, signers}` as x402's facilitator class gives it. Each kind is
`{x402Version: 2, scheme, network, extra}`, one per scheme on each configured network, and its `extra` holds:

| Member | Value |
|---|---|
| `extra.pairings` | The lcp pairing ids the kind submits. A scheme on one network can hold several forms, so the scheme alone does not name them. |
| `extra.key` | `none`, `relayer` or `fee-payer` ([Keys](../guides/settler.md#keys)). |
| `extra.acceptsZero` | The pairings of `extra.pairings` the kind settles at an amount of zero; `[]` where none does. An option of amount zero whose pairing it does not name is refused `invalid_payment_requirements`. |
| `extra.feeBudget` | `true` on each kind of a network whose fee budget the operator set; absent otherwise. Neither the amount nor what remains is stated. |
| The class's own members | Kept unchanged, such as `assetTransferMethod` on Tron and Polkadot, `feePayer` where a fee payer co-signs, and `areFeesSponsored` on the XRP Ledger and Stellar. No module's class may state one of the four members above: the settler refuses one that does at start. |

`signers` is keyed as x402's class keys it, by CAIP family (`eip155:*`, `solana:*`, ...), and holds the address of every
key that signs on that family. A seller reads `extra.key` to know what a deployment must hold, `extra.pairings` to know
which forms it can offer with this settler, and `extra.acceptsZero` before choosing a zero agreement amount.

## The order of checks

### `/verify`

`/verify` moves nothing. In order; the first refusal is the answer:

1. The request's shape: `invalid_x402_version`, `invalid_payload`.
2. The network is one a module serves, else `invalid_network`, and the scheme one a module registers on it, else
   `unsupported_scheme`. Where an own module claims the payment (by a member of the option, or by what the payment
   holds), it goes to that module, else to the registration's class. On `lnbtc` the answer is `unsupported_scheme`.
3. lcp's checks of the pairing, from the payment and its requirements alone. A refusal carries x402's reason and, on
   the `algorand`, `aptos`, `casper`, `hedera`, `solana`, `starknet` and `sui` modules, lcp's refusal code as
   `invalidMessage` (on `starknet` and `sui`, the module's own code where its own check refused).
4. The record: a payment it holds, claimed or final, is refused `invalid_transaction_state`, since `isValid: true`
   tells the caller that a settle may follow.
5. What the kind declares: an amount of zero whose pairing `extra.acceptsZero` does not name, and a form outside the
   pairings of the module the payment goes to, are refused `invalid_payment_requirements`.
6. The fee budget, where the module's key pays the fee: a spent budget is refused `fee_budget_spent`.
7. The class's verify, unchanged, with its own reasons.
8. lcp's read of the chain: a payment the chain shows final (landed, or consumed by another act) is refused
   `invalid_transaction_state`. A read that fails goes to the operator log and leaves the class's answer.

On `sui`, whose `/verify` judges a transaction the buyer already executed by its effects, steps 4 and 8 are not made.
The answer is `{isValid: true, payer}` or `{isValid: false, invalidReason, invalidMessage?, payer?}`.

### `/settle`

1. Steps 1 to 3 of `/verify`, with `errorMessage` for `invalidMessage`; `lnbtc` is served here. On `upto`, whose
   requirements carry the charge, the `evm` module holds requirements that are the option the payment accepted in
   every member but an `amount` at or below the accepted one as that option.
2. The record: a final row is answered `invalid_transaction_state` naming the transaction it holds, never a second
   success.
3. What the kind declares, as `/verify` checks it.
4. A claim the record holds that is not final, which another settle holds or whose hold has ended: it is answered as
   [the record](#the-record-and-what-a-repeat-answers) says, and no step below is made.
5. The class's verify; on `upto`, the check the class's own settle makes before it submits. On `evm`, the permit
   against the maximum the payment accepted. On `solana`, a deposit's opening as the buyer sent it, without the `type`
   the resource server adds to each settle; a claim against an open channel, which the class's verify never takes, is
   checked by its settle, before it sends anything. Where it refuses, lcp's read of the chain: a payment the chain
   shows landed, or whose value another act consumed, is stored final and answered `invalid_transaction_state` naming
   its transaction; otherwise the class's refusal is the answer, nothing is stored, and a repeat is checked again.
6. Where the module's read searches from a position no x402 call carries (a ledger, a slot, a block), the chain's
   position, read just before the claim, which the row keeps for every later read.
7. The claim: one conditional insert of the payment's row, held by this settle for `settleWaitMs`, so that of two
   settles of one payment only one submits.
8. The fee budget, where the module's key pays the fee: a spent budget answers `fee_budget_spent`, sends nothing, and
   leaves the claim, not final.
9. The class's settle, which submits what the payer signed. A success that names a transaction is stored final, then
   answered `{success: true, transaction, network, payer}`. Anything else is classified by lcp's read: a payment the
   chain shows final is stored final and answered (success only where the read shows a transaction this settler sent,
   or the payment it presented, settled); one still live is answered `settlement_pending` naming the transaction sent,
   or the class's own failure where it named no transaction or its failure consumed nothing.

A success is answered once, only by the settle whose write stored it: of two settles of one payment, only one answers
success, and the other answers `invalid_transaction_state` naming the transaction, or `settlement_pending` where its
wait ends first. A success that cannot be stored is answered `settlement_pending` naming its transaction, and a later
`/settle` reads the chain again.

## The record, and what a repeat answers

The record is one row per payment, its **instrument**, within its network: the single-use value its signer signed (an
authorization nonce, a sequence number, an account nonce, with the token or nonce key it counts in), or the transaction
id where the chain derives it from the signed content alone, or the digest of the signed payment where the pairing's
single-use value is not shown. It is never the single-use value alone, which two payers can share, and never a hash
that a copy signed again would change. An agreement and a payment of one payer under one H are two instruments.

A row is **final** once its answer can never change: a success; a failed result that consumed the single-use value; a
value another act consumed; a validity that passed with the value unconsumed; or a payment that landed by another
route. A refused submission, one that cannot have reached the node, and a failed result that consumed nothing leave the
row a claim, which a repeat reads again. A claim is never removed.

| A repeated `/settle` finds | It answers |
|---|---|
| A final row | `invalid_transaction_state` naming the transaction the row holds. Never a second success, as x402's `exact` family requires: a consumed payment produces a settlement failure. |
| A claim another settle holds | It reads the row every second and sends nothing, until that settle answers or its hold ends; then the row's answer, or lcp's read. It answers `settlement_pending` naming the transaction where one is known, and `unexpected_settle_error` where none is known when its wait ends. |
| A claim whose hold has ended | It takes the claim and reads the chain. A payment the chain shows final is stored and answered. The identical signed payment is submitted again only where the pairing's `nonce` is `single-use` in lcp's registry, the row is not named by the digest of the signed payment, the read shows the value unconsumed and its validity open, the body is the one that claimed the row, and the class's verify passes again. Another body under the same instrument is answered `invalid_transaction_state`. Otherwise `settlement_pending` naming the transaction sent, or `unexpected_settle_error` where none is known. |
| No row, and the store cannot be read | `settlement_pending` where the payment's transaction id is known before it is sent, else `unexpected_settle_error`: the settler cannot know whether it was sent. |

When the wait ends first, `/settle` answers `{success: false, errorReason: "settlement_pending", transaction}`; x402
requires that `transaction` not be empty. Call `/settle` again with the same request: it reads the chain from where the
last read stopped, never sends what it sent before unless the rule above admits it, and returns the final answer once
there is one. A final row is kept at least 24 hours past the time its payment can last land (its signed validity, or
the longest the rail keeps a signed payment payable), and for the settler's life where neither is known or the
pairing's `nonce` is not `single-use`; a claim that is not final is kept until a repeat makes it final.

## Storage

Postgres holds three tables, created at start where they do not exist. Postgres 11 or later; the role needs `CREATE` on
the schema and owns the tables, since every start runs the statements below
([The database](../guides/settler.md#the-database)):

```sql
CREATE TABLE IF NOT EXISTS instrument (
  network text NOT NULL,
  key text NOT NULL,
  pairing text NOT NULL,
  claimed bigint NOT NULL,
  held_until bigint NOT NULL,
  final boolean NOT NULL DEFAULT false,
  outcome text,
  answer jsonb,
  transaction text,
  sent text[] NOT NULL DEFAULT '{}',
  body text,
  payer text,
  search jsonb,
  since jsonb,
  keep_until bigint,
  PRIMARY KEY (network, key)
);
CREATE INDEX IF NOT EXISTS instrument_final_keep ON instrument (keep_until) WHERE final AND keep_until IS NOT NULL;
CREATE TABLE IF NOT EXISTS fee (
  network text NOT NULL,
  transaction text NOT NULL,
  at bigint NOT NULL,
  fee numeric(78, 0) NOT NULL,
  included boolean NOT NULL,
  PRIMARY KEY (network, transaction)
);
CREATE INDEX IF NOT EXISTS fee_at ON fee (network, at);
CREATE TABLE IF NOT EXISTS module_state (
  module text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (module, key)
)
```

- `instrument` is the record: `key` is the instrument, its kind and parts as a JSON array. `held_until` is when the
  settle holding the claim may no longer send (0 once it answered); `answer` is the answer as first given, once
  `final`; `transaction` the transaction the row names; `sent` every transaction the settler's submissions for the
  claim named, any of which can be the one that lands; `body` the SHA-256 of the body that claimed the row, the only
  body sent again; `search` where the next read resumes; `since` the chain's position read just before the claim; times
  are Unix milliseconds.
- `fee` is the fee count: one row per transaction a keyed module submitted on a network with a budget.
- `module_state` is the modules' durable state, under each module's name: a class's pending settlements, Cardano's
  broadcast guard, Solana's channels.
- A sweep every minute drops the final rows kept 24 hours past their keep, and the fees older than the longest budget
  period. The pool holds at most 10 connections; acquiring one, each query and each statement are bounded by 5 seconds.

## Bounds and logs

- Each node call the settler makes itself has a timeout of at most 5 seconds and an answer of at most 4 MiB, except
  Polkadot's block reads, bounded by the runtime's `System.BlockLength` (at most 4 of them at once in a process). A
  published class's calls are bounded by the class, and its settle takes no deadline: `settleWaitMs` bounds the
  settler's own reads and store calls, and a class's settle runs on its own bounds. x402's EVM signer waits up to
  180 s for a receipt unless `toFacilitatorEvmSigner`'s `confirmationTimeoutMs` is set: set it below `settleWaitMs`,
  or a `/settle` can outlast its wait.
- `/settle`'s reads and submission end a second before `settleWaitMs` (a quarter of a shorter wait), the time kept for
  storing the answer. The server's request timeout is `settleWaitMs` plus 60 seconds.
- An error names a node by its origin alone, since a URL's path or query can hold an API key.
- The operator log (`operatorLog`; by default one JSON line on standard error) receives what the operator should see
  and the answer does not carry, each entry with `network`, `payer` and `transaction` where they are known, and the
  error that caused it as `cause`. The answer to the client is the same either way and carries nothing from the cause.
  A log that throws, or returns a promise that rejects, changes no answer: the entry is written by the default, with an
  `operator-log-failed` entry. The core's entries are `verify-error`, `settle-error` and `request-error` (an error the
  handling threw); `read-failed` and `position-unread` (lcp's read, or the position before a claim, could not be made);
  `store-call-failed` (with the `call`), `store-connection-error` and `answer-not-stored`; `settle-deadline-passed`
  (with `before`, the step not started); `claim-unread` (a held claim whose read told nothing); `success-not-stored`;
  and `fee-not-counted`. Each module adds its own, such as `node-call-failed` and `settlement-failed`. Every
  `unexpected_verify_error` and `unexpected_settle_error` has an entry that names why, written when it is first given.

## Tests (contributors)

The package ships no tests: in a clone of this repository, the tests feed lcp's vectors for each module's pairings
through the settler's `/verify` and `/settle`, against local node stubs that replay recorded node answers
(`test/fixtures/tron-mainnet-answers.json`, Polkadot Asset Hub's runtime metadata in
`test/fixtures/polkadot-asset-hub-2005000.json.gz`) or answers derived from the pairing's profile. They need Postgres:
set `INTEGRA_DATABASE_URL` to a connection string whose user may create databases. Each test file makes and drops its
own database, so test runs share one server. CI runs them against a Postgres 18 service.

```sh
INTEGRA_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm --filter @integraledger/profile-facilitator test
```
