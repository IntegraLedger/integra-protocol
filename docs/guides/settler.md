---
title: Run the settler
description: Start the settler, configure its modules, keys, credential and fee budget, and call it.
---

# Run the settler

The settler, `@integraledger/profile-facilitator`, is an x402 facilitator that holds each payment to its pairing's LCP
profile (hence the package name), for the x402 pairings `@integraledger/lcp` implements: one HTTP surface,
`GET /supported`, `POST /verify` and `POST /settle`, on x402's own facilitator class with one module per chain
([the settler](../concepts/settler.md)). This guide is for the operator who runs it: at the end you can install it,
configure each module with its keys, nodes and database, put it behind TLS, and call it. Its programs need Postgres
and the package itself, so they are marked `no-check`: the documentation's check, which runs every other program in
these pages, does not run them.

## Install

```sh
npm install @integraledger/profile-facilitator @integraledger/lcp@~0.6.3
```

It needs Node.js `>=24.22.1`, Postgres 11 or later ([The database](#the-database)), and, for each network it serves,
the node its module reads. It is ESM only. `@integraledger/lcp` is its peer dependency, at `~0.6.3`: install it with
the settler ([Versions](#versions)). A module that holds a key takes it as the signer object of x402's class for that
chain; make it with that chain's x402 package at 2.31.0, the release the settler's classes are pinned to
(`@x402/evm`, `@x402/svm`, `@x402/avm`, and so on).

Two packages in its dependency tree have install scripts that it runs without: `protobufjs` (through `@hiero-ledger/sdk`
and `@concordium/web-sdk`) and `secp256k1` (through `@x402/near`). This repository installs with both denied, and runs
the settler's tests so. pnpm 12 stops an install at a build script it has no decision for (`ERR_PNPM_IGNORED_BUILDS`);
deny both in your `pnpm-workspace.yaml`:

```yaml
permissions:
  protobufjs: {build: false}
  secp256k1: {build: false}
```

With npm, `npm install --ignore-scripts` runs neither.

A project that installs under pnpm's `trustPolicy: no-downgrade`, as this repository does, excludes exactly two
versions from it, and nothing wider:

```yaml
trustPolicy: no-downgrade
trustPolicyExclude:
  - '@noble/ed25519@1.7.5'
  - '@noble/secp256k1@1.7.2'
```

The Casper module registers `@x402/casper` 2.31.0, which pins `casper-js-sdk` 5.1.1; every `casper-js-sdk` from 5.1.1
to 5.3.1 requires `@noble/ed25519` `^1.7.5` and `@noble/secp256k1` `^1.7.2`, with which it verifies a payer's ed25519
and secp256k1 signatures and signs with the settler's key, and no version of either package avoids them. Both were
published in April 2025 as maintenance releases of the packages' 1.x lines without provenance, after each package's
2.1.0 had been published with it in March 2024, so `no-downgrade` refuses them. Every other version of the two
packages, and every other package, stays under the policy.

A pnpm project that turns hoisting off (`hoist: false`) also declares, for the Concordium module, the one dependency
`@concordium/web-sdk` 12.0.2 imports without declaring it, `@protobuf-ts/runtime`; without it the module does not load
("Cannot find package '@protobuf-ts/runtime'"). With hoisting on, pnpm's default, and with npm, nothing is needed.

```yaml
packageExtensions:
  "@concordium/web-sdk@12.0.2":
    dependencies:
      "@protobuf-ts/runtime": "2.11.1"
```

## Start it and read what it supports

Start the settler for Tron mainnet and Polkadot Asset Hub, and read what it supports. Neither module holds a key, so
this deployment needs no credential. The node URLs are your own nodes; the settler calls them only when a payment
arrives. `DATABASE_URL` is your Postgres connection string.

```ts no-check title="supported.ts"
import { serveProfileFacilitator } from "@integraledger/profile-facilitator";

const settler = await serveProfileFacilitator({
  listen: "127.0.0.1:4020",
  store: { url: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/postgres" },
  settleWaitMs: 30_000,
  tron: [{ network: "tron:728126428", fullNode: "http://127.0.0.1:8090", solidityNode: "http://127.0.0.1:8091" }],
  polkadot: [{ network: "polkadot:68d56f15f85d3136970ec16946040bc1", rpc: "http://127.0.0.1:9944" }],
});

const supported = await (await fetch("http://127.0.0.1:4020/supported")).json();
console.log(JSON.stringify(supported, null, 2));
await settler.close();
```

```text
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "polkadot:68d56f15f85d3136970ec16946040bc1",
      "extra": {
        "assetTransferMethod": "lcp-assets-remark",
        "key": "none",
        "acceptsZero": [],
        "pairings": [
          "x402/exact/polkadot/lcp-assets-remark"
        ]
      }
    },
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "tron:728126428",
      "extra": {
        "assetTransferMethod": "lcp-trc20-memo",
        "key": "none",
        "acceptsZero": [],
        "pairings": [
          "x402/exact/tron/lcp-trc20-memo"
        ]
      }
    }
  ],
  "extensions": [],
  "signers": {
    "polkadot:*": [],
    "tron:*": []
  }
}
```

## Run it as a service

The package exports one function that starts the server; it has no command-line entry. It reads no environment variable
and no file: every setting is a member of the configuration, and the variable names in these samples are the samples'
own. A service is a short module that reads its configuration, makes the signer objects its keyed modules take, and
stops cleanly on a signal. This one serves x402's `exact` scheme on Base Sepolia through the `evm` module, whose key,
the seller's gas key, sends each transaction and pays its gas:

```ts no-check title="settler.ts"
import { serveProfileFacilitator } from "@integraledger/profile-facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { createWalletClient, http, publicActions, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const rpc = process.env.BASE_SEPOLIA_RPC ?? "http://127.0.0.1:8545";
const credential = process.env.SETTLER_CREDENTIAL;
const gasKey = process.env.SELLER_GAS_KEY as Hex | undefined;
if (credential === undefined || gasKey === undefined) throw new Error("set SETTLER_CREDENTIAL and SELLER_GAS_KEY");

// The seller's gas key, as x402's EVM classes take it.
const account = privateKeyToAccount(gasKey);
const client = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) }).extend(publicActions);
const signer = toFacilitatorEvmSigner(
  {
    address: account.address,
    getCode: (a) => client.getCode(a),
    readContract: (a) => client.readContract({ ...a, args: a.args ?? [] } as never),
    verifyTypedData: (a) => client.verifyTypedData(a as never),
    writeContract: (a) => client.writeContract({ ...a, args: a.args ?? [] } as never),
    sendTransaction: (a) => client.sendTransaction(a as never),
    waitForTransactionReceipt: (a) => client.waitForTransactionReceipt(a) as never,
    simulateCalls: (a) => client.simulateCalls(a as never) as never,
  },
  // Below settleWaitMs, so /settle answers settlement_pending instead of waiting up to x402's default 180 s.
  { confirmationTimeoutMs: 25_000 },
);

const listen = process.env.LISTEN ?? "127.0.0.1:4021";
const settler = await serveProfileFacilitator({
  listen,
  store: { url: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/postgres" },
  settleWaitMs: 30_000,
  credential,
  evm: [{ network: "eip155:84532", rpc, signer, schemes: ["exact"] }],
  // At most 0.01 ETH of gas in any 24 hours; past it, payments whose gas the key pays are refused.
  feeBudgets: [{ network: "eip155:84532", amount: "10000000000000000", periodSeconds: 86_400 }],
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void settler.close().then(() => process.exit(0));
  });
}
console.log(`settler listening on ${listen}`);
```

```text
settler listening on 127.0.0.1:4021
```

`@x402/evm`'s signer waits up to 180 s for a receipt unless `toFacilitatorEvmSigner`'s `confirmationTimeoutMs` is
set, and a class's settle takes no deadline from the settler, so the sample sets it below `settleWaitMs`. Run it with
`node settler.ts`: Node.js 26 runs TypeScript directly. Every call must then carry
`Authorization: Bearer <credential>`. Its `/supported` states:

```json no-check
{
  "kinds": [
    {
      "x402Version": 2,
      "scheme": "exact",
      "network": "eip155:84532",
      "extra": {
        "key": "relayer",
        "acceptsZero": ["x402/exact/eip155/eip3009"],
        "pairings": ["x402/exact/eip155/eip3009", "x402/exact/eip155/permit2"],
        "feeBudget": true
      }
    }
  ],
  "extensions": [],
  "signers": { "eip155:*": ["<the gas key's address>"] }
}
```

`close()` stops accepting requests, closes open connections, closes what each module opened (the Polkadot nodes'
connections among them), stops the sweep and closes the Postgres pool. If the settler cannot start, it closes what it
opened and rejects with the error that stopped it, such as the listen's `EADDRINUSE` or a configuration it refuses
([What stops the start](#what-stops-the-start)).

## Configuration

`serveProfileFacilitator(config)` takes a `ProfileFacilitatorConfig`: the core's members, and one member for each module
the deployment starts, named for the module. A module whose member is absent is neither loaded nor started.

### The core's members

| Member | Type | Meaning |
|---|---|---|
| `listen` | `string` | `"host:port"`; an IPv6 host may be written in brackets. |
| `store` | `{ url: string }` | The Postgres connection string. Postgres holds the record, the fee count and the modules' durable state; the settler creates its tables at start where they do not exist ([The database](#the-database)). |
| `settleWaitMs` | `number` | How long `/settle` waits for the chain before it answers `settlement_pending`. A value that is not a positive finite number means 30 000. |
| `credential` | `string`, optional | The credential every call must present as `Authorization: Bearer <credential>`; required where a configured module holds a key ([The credential](#the-credential)). Its characters are those RFC 6750 admits in a bearer token: letters, digits and `-._~+/`, then any `=`. |
| `feeBudgets` | `{ network, amount, periodSeconds }[]`, optional | At most one per network, each on a network a configured module serves ([The fee budget](#the-fee-budget)). `amount` is in the smallest unit of the network's fee asset, a `bigint` or its decimal digits, and positive; `periodSeconds` is a positive whole number. |
| `operatorLog` | `(entry, cause?) => void`, optional | Receives every entry for the operator ([Bounds and logs](../reference/settler.md#bounds-and-logs)). The default writes one JSON line per entry on standard error. |

### The database

The settler needs Postgres 11 or later: nothing it runs is newer than `hashtextextended`, which Postgres 11 added. Its
tests run on Postgres 18. At every start it runs `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for its
three tables and two indexes ([Storage](../reference/settler.md#storage)), so the role in `store.url` needs `CREATE` on
the schema they live in and owns them. From Postgres 15, the schema `public` grants `CREATE` to no role but its owner by
default: grant it, or create a schema named for the role and owned by it, which Postgres's default `search_path`
(`"$user", public`) puts first. The role then reads and writes only those tables, and takes transaction-level advisory
locks. Each process holds at most 10 connections.

Every settler process that may settle the same payments uses the same database: the record is what keeps one payment
submitted once and answered success once. Do not truncate or replace its tables while payments they hold can still
land, and back them up as you back up payment records.

### The modules

Each module's member lists the networks it serves. Its keys reach it inside that member, as the signer objects its
classes take; the settler reads no key material of its own. A network is the CAIP-2 id lcp's type for the chain
names, and the table gives the ones each module takes.

| Member | Chain | Networks | Scheme: pairings (`confirmed`) | `extra.key` | `extra.acceptsZero` | Facilitator |
|---|---|---|---|---|---|---|
| `algorand` | Algorand | `algorand:<genesis hash prefix>` | `exact`: `x402/exact/algorand` (yes) | `fee-payer` | `x402/exact/algorand` | `@x402/avm`'s class; the settler's own path for a rekeyed payer signing with one key and a Falcon-key payer |
| `aptos` | Aptos | `aptos:<chain id>` | `exact`: `x402/exact/aptos` (yes) | `fee-payer`, or `none` with `sponsor: false` | `[]` | `@x402/aptos`'s class |
| `cardano` | Cardano | `cardano:mainnet`, `cardano:preprod`, `cardano:preview` | `exact`: `x402/exact/cardano` (yes), `x402/exact/cardano/lock` (yes) | `none` | `[]` | `@x402/cardano`'s class |
| `casper` | Casper | `casper:casper-test` | `exact`: `x402/exact/casper` (no) | `relayer` | `[]` | `@x402/casper`'s class |
| `concordium` | Concordium | `ccd:<genesis hash prefix>` | `exact`: `x402/exact/ccd` (no) | `fee-payer` | `x402/exact/ccd` | `@x402/concordium`'s class |
| `evm` | EVM | `eip155:<chain id>` | `exact`: `x402/exact/eip155/eip3009` (yes), `x402/exact/eip155/permit2` (yes); `upto`: `x402/upto/eip155/permit2` (yes); `auth-capture`: `x402/auth-capture/eip155/eip3009` (yes), `x402/auth-capture/eip155/permit2` (yes); `batch-settlement`: `x402/batch-settlement/eip155` (yes) | `relayer` | `x402/exact/eip155/eip3009` on `exact`; `[]` on the others | `@x402/evm`'s classes |
| `erc7710` | EVM | `eip155:<chain id>`, where `evm` registers `exact` | `exact` with `erc7710`: `x402/exact/eip155/erc7710` (yes), `x402/exact/eip155/erc7710-salt` (yes) | `relayer` | `[]` | the settler's own, behind the `evm` module's `exact` |
| `hedera` | Hedera | `hedera:mainnet`, `hedera:testnet`, `hedera:previewnet`, `hedera:devnet` | `exact`: `x402/exact/hedera` (yes) | `fee-payer` | `[]` | `@x402/hedera`'s class |
| `lnbtc` | Lightning | `lnbtc:000000000019d6689c085ae165831e93`, `lnbtc:000000000933ea01ad0ee984209779ba` | `exact`: `x402/exact/lnbtc/payment-hash` (yes) | `none` | `[]` | the settler's own |
| `near` | NEAR | `near:mainnet`, `near:testnet` | `exact`: `x402/exact/near` (yes) | `relayer` | `[]` | `@x402/near`'s class |
| `polkadot` | Polkadot Asset Hub | `polkadot:68d56f15f85d3136970ec16946040bc1`, `polkadot:67f9723393ef76214df0118c34bbbd3d` | `exact`: `x402/exact/polkadot/lcp-assets-remark` (yes) | `none` | `[]` | the settler's own |
| `solana` | Solana | `solana:<genesis hash prefix>`; `upto` and `batch-settlement` not on `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `exact`: `x402/exact/solana` (yes); `upto`: `x402/upto/solana` (no); `batch-settlement`: `x402/batch-settlement/solana` (no) | `fee-payer` | `x402/exact/solana` on `exact`; `[]` on the others | `@x402/svm`'s classes |
| `starknet` | Starknet | `starknet:SN_MAIN`, `starknet:SN_SEPOLIA` | `exact`: `x402/exact/starknet` (yes) | `relayer` | `x402/exact/starknet` on `starknet:SN_SEPOLIA`; `[]` on `starknet:SN_MAIN` | the settler's own |
| `stellar` | Stellar | `stellar:pubnet`, `stellar:testnet` | `exact` with `lcp-precondition`: `x402/exact/stellar/precondition` (yes) | `relayer` | `x402/exact/stellar/precondition` | the settler's own |
| `sui` | Sui | `sui:mainnet`, `sui:testnet`, `sui:devnet` | `exact`: `x402/exact/sui` (yes) | `none` | `x402/exact/sui` | the settler's own |
| `ton` | TON | `tvm:-239`, `tvm:-3` | `exact`: `x402/exact/tvm` (yes) | `relayer` | `x402/exact/tvm` | `@x402/tvm`'s class |
| `tron` | Tron | `tron:<chain id in decimal>` | `exact`: `x402/exact/tron/lcp-trc20-memo` (yes) | `none` | `[]` | the settler's own |
| `xrpl` | XRP Ledger | `xrpl:<NetworkID>` | `exact`: `x402/exact/xrpl` (yes); `upto`: `x402/upto/xrpl` (yes) | `none` | `[]` | `@x402/xrpl`'s class for a payer signing with one key; the settler's own for a multisigned payer and for `upto` |

`confirmed` is lcp's registry's: whether something outside lcp has shown the form as its profile defines it
([the pairing registry](../reference/pairings.md)). The
settler serves the forms marked `no` as their profiles define them, but no recorded run outside lcp has yet shown one.
The `casper` and `concordium` modules serve only such forms: run them on a test network, and do not offer those forms
to buyers until the registry says `yes`.

Each member, one entry per network unless it says otherwise:

- **`algorand`**: `network`; `signer`, the seller's fee payer as `@x402/avm`'s class takes it (`FacilitatorAvmSigner`),
  with its algod node; `indexer`, the seller's Indexer, which lcp's read uses; `archival`, optional, true where that
  Indexer holds every round. The fee payer pools the group's fee by its own zero-amount payment in the same atomic
  group. The class signs every entry of the group that one of the key's addresses sends, so a group may hold one such
  entry, and only where the option's `extra.feePayer` names its sender: a group with two, or with one the option's
  `extra.feePayer` does not name, is refused `invalid_exact_avm_invalid_fee_payer`; with no `extra.feePayer` the buyer
  pays its own fee. An entry a logic signature authorises, and one that names `asnd`, are refused before anything
  moves.
- **`aptos`**: `network`; `signer`, the seller's account (`FacilitatorAptosSigner`); `sponsor`, optional, whether the
  key pays the payer's gas as its fee payer (default true, the class's own default); `node`, the seller's REST endpoint,
  its base without `/v1`. With `sponsor: false` the payer pays its own gas and the key signs nothing: the kind states
  `extra.key` `none` and `/supported` names no signer for it, and an option that names an `extra.feePayer` is refused
  `invalid_payment_requirements` before the class is asked, since the class pays the gas of any payment whose option
  names one of the key's addresses.
- **`cardano`**: `network`; `signer`, the chain-query object `@x402/cardano`'s class takes over the seller's provider (a
  provider's project id is its configuration, not a key); `reader`, lcp's `CardanoReader` over the seller's indexer. The
  class broadcasts the transaction the buyer signed, whose fee the buyer pays. `@x402/cardano` 2.31.0 reads a
  transaction's confirmations from Blockfrost alone: over Koios alone it sees none, so an option it settles there
  states `extra.confirmationPolicy` as `{ "l1Confirmations": 0 }`, and an option that states none, whose default asks
  one confirmation, is refused at `/verify`. A provider with a Blockfrost project serves an option that asks
  confirmations. `/settle` answers success where the class does, and
  otherwise once lcp's read through `reader` shows the transaction final, at the ledger's security parameter of
  confirmations (2160 on mainnet and Preprod, some 12 hours); until then it answers `settlement_pending` naming the
  transaction. Over Koios alone the class's settle gives no success, so a payment is answered at that mark. Its guard
  against broadcasting one transaction twice is kept in the settler's database, so a repeat after a restart resumes
  observing what was broadcast.
- **`casper`**: `network`, `casper:casper-test` (the settler does not start on `casper:casper`: see *What it does not
  serve*); `signer`, the seller's key as `@x402/casper`'s class takes it (`FacilitatorCasperSigner`, made with its
  `toFacilitatorCasperSigner` and an `rpcUrlConfig` that names `rpc` for the network), which sends the transaction that
  calls the token package's `transfer_with_authorization` with the payer's CEP-3009 authorization, and pays its gas;
  `rpc`, the seller's node, through which the class reads the token before it settles, lcp's read finds the payment and
  the fee count reads its cost. The settler does not start where the signer names another node, as `@x402/casper`'s
  signer does for a network its `rpcUrlConfig` leaves out, falling back to a public node, nor where its
  `speculativeRpcUrlConfig` names a node other than `rpc`: with one, the class's check has the key sign a deploy of the
  payer's authorization at every `/verify` and `/settle` and sends it there for speculative execution. `paymentMotes`,
  optional, is the most the transaction can pay, in motes (`@x402/casper`'s default, 2.5 CSPR, where absent), which the
  fee budget counts from the transaction's submission until the node shows the cost. The class refuses a zero amount.
  `signers` lists the key's account hash, 64 hex digits without the `00` tag a payload's address carries. The class's
  node calls and lcp's read carry no header of the seller's, so a node credential reaches the node only within `rpc`'s
  URL; and the class waits up to a minute for its transaction, its node calls without a timeout of their own, so its
  settle can run past `settleWaitMs`. lcp's read takes the token's used nonces from its dictionary
  `used_nonces`, as lcp's profile names it, where the class's check before it settles reads `authorization_state`.
- **`concordium`**: `network`, the one the signer is connected to; `signer`, the seller's sponsor account and its key
  with its node (`FacilitatorConcordiumSigner`), which co-signs the payer's sponsored transaction and pays its energy;
  `reader`, lcp's `CcdReader` over the seller's node. The record names each payment by the digest of what its sender
  signed, so a payment is never sent twice.
- **`evm`**: `network`; `rpc`, the seller's JSON-RPC endpoint, which lcp's reads and the fee's read go through; `signer`,
  the seller's gas key (`FacilitatorEvmSigner`, made with `toFacilitatorEvmSigner` over the same node); `schemes`,
  optional, the schemes registered (`exact`, `upto`, `auth-capture`, `batch-settlement`; all four where absent);
  `eip6492AllowedFactories`, optional, the ERC-6492 factories `exact` and `batch-settlement` may call to deploy a payer's
  wallet (none where absent); `authCapture`, optional, `auth-capture`'s own configuration, passed to its class
  unchanged. Before the class is asked, `exact` refuses an option that pays several payees (a non-empty
  `extra.splits`) and Circle's batched option (`extra.name` `GatewayWalletBatched`, or an `extra.verifyingContract`
  other than the asset), which no published EVM class settles. At `/settle`, `upto` settles the amount its requirements
  state, the charge: requirements that are the option the payment accepted in every member but an `amount` at or below
  the accepted one are held as that option, and the class checks the permit against the accepted maximum, as its own
  settle does; any other requirements are refused `invalid_payload`. `exact`'s `extra.acceptsZero` names
  `x402/exact/eip155/eip3009` alone, and every other kind's is `[]`. On Base Sepolia, USDC's EIP-3009
  `transferWithAuthorization` of 0 succeeds, emitting `AuthorizationUsed` and a `Transfer` of 0 (`eth_simulateV1` at
  block 61198157); at block 61194449, x402's `exact` and `upto` Permit2 proxies revert `InvalidAmount` and the
  commerce-payments escrow's `authorize` reverts `ZeroAmount`; batch settlement's facilitator requires a deposit above
  0. The later messages of the two multi-step schemes, which a resource server sends after the payment opened, go to
  the class as x402's own code sends them: `auth-capture`'s `capture`, `void` and `refund` (x402's lifecycle manager,
  and the hold's own payload the resource server stamps `capture` after its handler or `void` on cancel), and
  `batch-settlement`'s `claim`, `settle` and `refund` (x402's channel manager, whose requirements are its own, at
  amount `"0"`). The class checks each (the receiver authorizer's signature, or its own where `authCapture` delegates
  that authorizer to it; the escrow's or the channel's state), and the escrow or the channel contract bounds what it
  moves by what the opening funded. An escrow message is its own row, keyed by what its receiver authorizer signs (its
  type, the twelve members of the escrow's `PaymentInfo` whose hash it binds, and but for a void its amount and the
  escrow amounts it expects), so one message, however spelt, is sent once; a channel's refund by the digest of its payload. A channel's `claim` and `settle` are not recorded:
  the manager sends the same settle in every round, and the contract claims only above the channel's recorded total
  and settles only what is claimed and unpaid, to the channel's receiver. At `/settle` of a `claim` or `settle`, which
  the batch class's `verify` does not take, the class's `settle` makes the check, simulating the call before it sends;
  at `/verify` the class's `verify` answers them, as without the settler. An escrow refund for the default `delegated`
  operator is funded by the operator's own address, the seller's gas key: the class refuses it unless `authCapture`
  sets `refundFunding`. An escrow message the class refused with nothing sent is not sent again: a repeat of it is
  answered `unexpected_settle_error`.
- **`erc7710`**: `network`; `rpc`; `signer`, the seller's gas key, whose node must answer `eth_simulateV1`. The key
  sends from its first address, so that address is the delegate the leaf delegation must name (or the reference
  implementation's wildcard delegate), and the account the simulation runs from. It registers nothing of its own: on
  each of its networks it is offered to the `evm` module's `exact` registration, which hands it every payment whose
  option names `erc7710`. The settler does not start where the `evm` module does not register `exact` on such a
  network. It simulates the redemption the payment names, then calls `redeemDelegations` on the delegation manager the
  payload names, with one execution that transfers the option's amount to `payTo`.
- **`hedera`**: `network`; `signer`, the seller's fee-payer account and its key (`FacilitatorHederaSigner`): the class
  takes only a payment whose transaction id names an account it manages as `extra.feePayer`; `mirror`, the seller's
  Mirror Node REST base URL, which lcp's read and the fee count use; `archival`, optional, true where it holds every
  record since the network began. `@x402/hedera` 2.31.0 makes the signer from its parts rather than from a key alone:
  `toFacilitatorHederaSigner` over `signAndSubmitTransaction` from `createHederaSignAndSubmitTransaction` (a client per
  network, such as `createHederaClient`'s, and the fee payer's `PrivateKey`), `verifyPayerSignature` from
  `createHederaVerifyPayerSignature`, and `preflightTransfer` from `createHederaPreflightTransfer`.
- **`lnbtc`**: `network`, x402's `lnbtc` id of Bitcoin mainnet (`lnbtc:000000000019d6689c085ae165831e93`) or testnet3
  (`lnbtc:000000000933ea01ad0ee984209779ba`). The buyer's node paid the invoice before the preimage reached the buyer,
  so settling moves nothing: the module makes the scheme's validation through lcp's `validateExactLnbtc`, answers the
  invoice's payment hash as the transaction, names no payer, and reads nothing. x402's scheme forbids `/verify` for
  this flow, so `/verify` answers `unsupported_scheme`; `/settle` makes the validation before the record's claim.
- **`near`**: `network`; `signer`, the seller's relayer account and key with its RPC node (`FacilitatorNearSigner`),
  which wraps the payer's NEP-366 delegate action in a transaction of its own and pays its gas and one-yoctoNEAR
  deposit; `rpc`, the seller's RPC node.
- **`polkadot`**: `network`, `polkadot:68d56f15f85d3136970ec16946040bc1` (Polkadot Asset Hub) or
  `polkadot:67f9723393ef76214df0118c34bbbd3d` (Westend Asset Hub); `rpc`, an HTTP JSON-RPC endpoint. The payer signs
  and pays every fee. A node that keeps the state of every block (an archive node) gives the events of any block; a
  pruning node discards the state of older blocks, and a block that holds the extrinsic and whose state is discarded
  keeps the answer `settlement_pending`. The runtime metadata is loaded on the first payment for the network, and again
  whenever the node's runtime version changes. A success names `<block hash>-<extrinsic index>`; a pending answer
  names the extrinsic's hash. The kind's `extra.acceptsZero` is `[]`: lcp's option filter takes a positive amount only
  (its profile's rule 1), and a `transfer_keep_alive` of 0, dry-run on Westend Asset Hub at block 19635446, dispatches
  and emits no event.
- **`solana`**: `network`; `node`, the seller's JSON-RPC endpoint, one whose `getFirstAvailableBlock` is at or below the
  slot at which each payment was issued; `signer`, the seller's fee payer (`FacilitatorSvmSigner`), which co-signs every
  transaction the payer signed and, on the channel forms, pays the channel's rent; `transactionVersions`, optional, the
  message versions the classes accept (their default `[0, 1]`). `upto` and `batch-settlement` need the payment-channels
  program, which is deployed on devnet and testnet and not on mainnet: on Solana mainnet
  (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) only `exact` is registered. Their channels are kept in the settler's
  database. `upto` is settled in the order x402's `upto` resource server sends it: `/verify` of the opening as the buyer
  sent it, then `/settle` of its deposit before the resource server's handler runs and of its claim after, each
  carrying the `type` (`deposit`, `claim`) that server adds. A claim needs the voucher of the option's
  `extra.receiverAuthorizer`, which the module does not sign: the resource server signs it with its own key.
  `batch-settlement`'s `claim`, `seal` and `settle`, which x402's channel manager sends, go to the class's `settle`,
  which checks each before it sends anything (the channel, its status, and the payer authorizer's voucher), each time
  they are sent: they are not recorded, and the program moves nothing twice for them; the class's `verify`, which takes
  only what a buyer sends, answers them at `/verify`. Its server-signed voucher mode
  (`extra.voucherSigner` `"server"`) is not served: lcp's option filter names no pairing for it, and its deposit is
  refused `invalid_payment_requirements`.
- **`starknet`**: an object `{ networks }`, one entry per network: `network`; `rpc`, a JSON-RPC node (specification 0.9
  or later) that serves `starknet_traceTransaction` and `starknet_simulateTransactions`; `executor`, an `address` and
  its `signer`, the account the payer's outside execution names as its caller, stated as `extra.feePayer`, which
  sends and pays for the transaction that executes it; `maxFee`, optional, the most one settlement's resource bounds
  may pay, in fri; `skewMarginSeconds` (default 60) and `minSettleMarginSeconds` (default 30), optional, the scheme's
  margins. x402 specifies Starknet and publishes no code for it, so the module is written to x402's scheme text and
  lcp's profile. On `starknet:SN_SEPOLIA` the kind's `extra.acceptsZero` names `x402/exact/starknet`, and an option of
  amount `"0"` is taken on STRK (`0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`) and USDC
  (`0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080`), the tokens on which lcp's `starknetFloor`
  answers 0 (its profile's rule 24): a `transfer` of 0 of each, simulated on Starknet Sepolia at block 18422698, emits a
  `Transfer` of 0. lcp refuses `"0"` on any other token, `starknet/option-malformed`, which the module answers
  `invalid_payment_requirements`. On `starknet:SN_MAIN` the list is `[]`.
- **`stellar`**: an object `{ networks }`: `network`; `rpc`, a Stellar RPC endpoint that holds the history the read
  searches; `source`, the seller's funded account as a signer (`address` and `signTransaction`, such as x402's
  `createEd25519Signer` of `@x402/stellar` or a SEP-43 wallet), the transaction's source, which pays its fee;
  `maxTransactionFeeStroops`, optional (default 50,000), and `inclusionFeeStroops`, optional (at least 100, default
  100). It serves the agreement form, the option whose `extra.assetTransferMethod` is `lcp-precondition`: the module
  builds the transaction around the buyer's operation and preconditions, unchanged, signs it as its source, and carries
  the buyer's payload signature with its own.
- **`sui`**: an object `{ networks }`: `network` (`sui:mainnet`, `sui:testnet` or `sui:devnet`); `graphql`, the seller's
  GraphQL endpoint. It serves the path where the buyer pays gas and the gasless path (`extra.gasless`), and holds no
  key. A transaction the buyer already executed is judged at `/verify` by its effects, and not refused for having
  executed; its `/settle` answers a failure naming it. The kind's `extra.acceptsZero` names `x402/exact/sui`: a
  transfer of 0 executes where the buyer pays gas (Sui testnet transaction
  `7EjfN1kqGng3phZjqgCzy8RRRXCP2Ybt7mikGgjBUwKA`, status `SUCCESS`, its only balance change the sender's gas), and at
  0 the signed transfer must name the option's payee. lcp's option filter refuses 0 on the gasless path.
- **`ton`**: `network`; `signer`, the seller's highload-v3 wallet and its node (`FacilitatorTvmSigner`), which relays
  the payer's W5 request in a message of its own and pays its gas; `reader`, lcp's `TvmReader` over the seller's TON
  Center v3 index.
- **`tron`**: `network`, `tron:<chain id in decimal>`; `fullNode` and `solidityNode`, the base URLs of a FullNode that
  keeps the block history (not a lite FullNode) and of a Solidity node, with java-tron's HTTP API. The payer signs and
  pays every fee.
- **`xrpl`**: `network`; `node`, the seller's rippled or Clio JSON-RPC endpoint, holding the ledgers from each payment's
  issue to the validated ledger; `waitMs`, optional, how long a settle waits for its transaction in a validated ledger
  (default 30 000); `maxFeeDrops`, optional, the most fee a payment may sign (the class's default, 10 000). Both paths
  refuse a payment that names a `Delegate` or carries `Memos`, as x402's scheme requires. For `upto`, the payer opens a
  payment channel to `payTo` and signs one claim off the ledger; at `/settle` the resource server adds
  `settlementTransaction`, a `PaymentChannelClaim` its `payTo` key signed for the actual charge with `tfClose`, which the
  module checks and submits unchanged; `/verify` refuses a payload that already carries one, as the scheme requires.

The `cardano`, `concordium` and `ton` modules take an lcp reader in `reader` rather than a node's URL, and lcp ships the
interface but no implementation: `CardanoReader` of `@integraledger/lcp/cardano`, `CcdReader` of
`@integraledger/lcp/ccd` and `TvmReader` of `@integraledger/lcp/tvm`, each documented member by member on its API page
([`cardano`](../reference/api/cardano.md), [`ccd`](../reference/api/ccd.md), [`tvm`](../reference/api/tvm.md)), with the
calls each makes in [Rails: reading settlement](./rails.md#reading-settlement). Write one over your own indexer or node.
Its `network` is the module's `network`: the module refuses to start where they differ. Each call is read-only and
bounded by your own timeout and byte limit, and rejects on any failure, with lcp's `ReaderError`
(`@integraledger/lcp/evm`) where the kind is known: a rejection reads as `unreadable`, never as absence. An item the
endpoint does not hold is answered only in the form the interface names for it (`null`, or `{ notFound: true, ... }`
with the point the interface asks for), and only where the endpoint answered in the form it documents for a missing
item. lcp makes no other call, so the endpoint, its credentials, its timeouts and its retries are yours.

### What stops the start

`serveProfileFacilitator` rejects with the first of these it meets, in this order, having closed what it opened; each
message starts as shown:

| The configuration | The message |
|---|---|
| `listen` is not `host:port` | `listen must be "host:port"` |
| `credential` holds a character RFC 6750 does not admit | `credential must be a bearer token` |
| A fee budget whose amount is not a positive integer, or whose period is not a positive whole number of seconds | `the fee budget of <network>: its amount is not a positive integer`, `the fee budget of <network>: its period is not a positive number of seconds` |
| Two fee budgets on one network | `<network> has two fee budgets` |
| Postgres cannot be reached, or the tables cannot be created ([The database](#the-database)) | the driver's own error |
| A module's member it refuses, the modules taken in the order of their names | `casper on <network>: not served` (`casper:casper`), `casper on <network>: the signer reads`, `casper on <network>: the signer's speculative execution goes to`, `casper on <network>: the signer names the chain`; `the Cardano reader serves`; `the Concordium signer and reader must serve`; `lnbtc: <network> is not an lnbtc network`; `not a Starknet network`, `the executor's address is not an account address`; `not a Stellar network`, `the source account's address is not an account strkey`, `the fee ceiling must be positive, and the inclusion fee at least 100 stroops`; `not a Sui network`; `the TON reader serves` |
| An `erc7710` network where the `evm` module does not register `exact` | `an own module is offered to exact on <network>, which no module registers` |
| A module's class that states `pairings`, `key`, `acceptsZero` or `feeBudget` in its `extra` | `<network>: a module's facilitator states` |
| Two registrations of one scheme on one network | `two registrations of <scheme> <network>` |
| Two modules behind one registration whose keys sign for different purposes | `<scheme> on <network>: its modules' keys sign for` |
| A fee budget on a network no module serves | `the fee budget of <network>: no module serves it` |
| A fee budget on a network where a keyed module neither counts nor shows its fees (`ton`, `concordium`) | `the fee budget of <network>: the <module> module's key pays fees it neither meters nor shows` |
| A keyed module, and no `credential` | `a module holds a key (<scheme> on <network>, ...): credential is required` |

Any other rejection is the error of a call the start makes, such as the listen's `EADDRINUSE`.

## Keys

`extra.key` states what the module's key signs, by one of three values:

| `extra.key` | The key | Modules |
|---|---|---|
| `none` | The module holds no key and signs nothing: it submits what the payer signed, and the payer pays the fee. | `cardano`, `lnbtc`, `polkadot`, `sui`, `tron`, `xrpl`, and `aptos` with `sponsor: false` |
| `relayer` | The key sends the transaction and pays its network fee. | `casper`, `erc7710`, `evm`, `near`, `starknet`, `stellar`, `ton` |
| `fee-payer` | The key co-signs the payer's transaction as the account that pays its fee. | `algorand`, `aptos`, `concordium`, `hedera`, `solana` |

Each chain's own name for the role (a gas key, a sponsor, a source account, an executor) stays in its module's notes
above. The key is always the seller's: the operator's code makes the signer object the module's class takes and passes
it in the configuration, and its address is in `/supported`'s `signers`. One kind states one purpose: two modules
behind one registration whose keys sign for different purposes are refused at start.

## The credential

The resource server names the payee and the amount, and a keyed module pays a fee for whatever it submits, so an open
settler would spend the seller's money on payments between other parties. A deployment with a module whose key is not
`none` therefore does not start without `credential`. Every call, `GET /supported` included, must then present it as
`Authorization: Bearer <credential>`; the settler compares the SHA-256 of what is presented with that of the credential
in constant time, and answers a call without it `401` `{"error":"unauthorized"}` with `WWW-Authenticate: Bearer`,
before it reads the body, closing the connection. A keyless deployment may set one too, with the same effect.

## Security

The settler serves plain HTTP (`node:http`, no TLS option): the credential and every payment cross the network in clear
unless TLS is in front of it. Bind `listen` to loopback or a private interface and terminate TLS in a proxy before it,
or run the settler on the resource server's own host. The credential is its only gate: anyone who holds it can have a
keyed module pay fees for payments between other parties, without limit unless a fee budget caps them ([The fee
budget](#the-fee-budget)), so keep it as you keep the keys, and set a budget on each network whose fees a key pays (the
`ton` and `concordium` modules take none). The keys live in the operator's process, as the signer objects passed in; the
settler reads no key material itself, and names a node in an error by its origin alone. It does not check that H is the
one the resource server issued, nor that the resource server has not accepted it before ([the
settler](../concepts/settler.md#where-it-sits)): those checks are the resource server's.

## The fee budget

A keyed module pays fees for what it submits. `feeBudgets` caps them per network: an amount of the network's fee asset,
in its smallest unit, over a period of seconds. The count holds every transaction a module whose key pays the fee
submitted on the network over the last period: its bound until the chain shows it included, then the fee it paid.
Where the count has reached the amount:

- `/verify` and `/settle` refuse a payment whose fee the module's key would pay, `fee_budget_spent`, before anything is
  sent. A payment whose payer pays the fee is never refused for it.
- Each kind of the network states `extra.feeBudget: true`, so that a resource server learns that the settler may refuse
  every payment on that network for a period.

The fee counted is what the chain shows. On an EVM network it is the gas used times its price and, on an OP Stack
network, the L1 data fee the receipt shows (`l1Fee`); before inclusion, the gas limit times the fee cap, with the L1
data fee the network's GasPriceOracle (`getL1Fee`) gives. On Hedera it is the fee the Mirror Node shows, asked for up
to five seconds after the settle answers; where the mirror shows none by then, the `maxFee` the payer signed. The
`evm`, `solana`, `aptos` and `casper` modules count each transaction their key sends as it is sent, one their class
does not name in its answer included: a payer's ERC-6492 wallet deployment on EVM, or a Solana or Casper transaction
whose send failed.

At start the settler refuses a budget on a network no configured module serves, and one on a network where a module
whose key pays fees can neither show the fee of what it sent nor count it as it sends: the `ton` and `concordium`
modules, whose classes and lcp's reads give no fee.

Its stated costs:

- A transaction is counted once it is sent (`evm`, `solana`, `aptos`, `casper`) or once its settle answers (`algorand`,
  `erc7710`, `hedera`, `near`), so settles that run at once on a nearly spent budget can each pass the check before the
  first is counted. The `starknet` and `stellar` modules count each send before it is made, one at a time per network.
  The `evm` module's count at the send is what its node shows then: a transaction the node does not show yet (the
  operator log's `fee-not-counted`, reason `not-shown`) is not counted until a later read shows it, when the class's
  wait for its receipt ends or when the settle answers, and one the node never shows, never mined, is not counted.
- A transaction whose id is not known before it is sent is counted at its bound for the whole period, as well as at
  the fee it paid once included. The count can exceed what was paid; it never falls short of it.

## Call it

Both `POST /verify` and `POST /settle` take x402's facilitator request,
`{x402Version: 2, paymentPayload, paymentRequirements}`, with `paymentPayload.x402Version` 2. A refusal answers `200`
with the refusal in its body.

```ts no-check title="verify.ts"
import { serveProfileFacilitator } from "@integraledger/profile-facilitator";

const settler = await serveProfileFacilitator({
  listen: "127.0.0.1:4022",
  store: { url: process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/postgres" },
  settleWaitMs: 30_000,
  tron: [{ network: "tron:728126428", fullNode: "http://127.0.0.1:8090", solidityNode: "http://127.0.0.1:8091" }],
});

const requirements = {
  scheme: "exact",
  amount: "10000",
  asset: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  payTo: "TCwX1UeSkVfu43HD5xNMmFqDR2Xgjdxihx",
  maxTimeoutSeconds: 60,
  extra: { assetTransferMethod: "lcp-trc20-memo" },
};
// The first network is configured, and its payload is not a Tron transaction; the second is not configured.
for (const network of ["tron:728126428", "tron:3448148188"]) {
  const body = {
    x402Version: 2,
    paymentPayload: { x402Version: 2, payload: { transaction: "0a02" } },
    paymentRequirements: { ...requirements, network },
  };
  for (const path of ["/verify", "/settle"]) {
    const res = await fetch(`http://127.0.0.1:4022${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log(path, res.status, JSON.stringify(await res.json()));
  }
}
await settler.close();
```

```text
/verify 200 {"isValid":false,"invalidReason":"invalid_payload"}
/settle 200 {"success":false,"errorReason":"invalid_payload","transaction":"","network":"tron:728126428"}
/verify 200 {"isValid":false,"invalidReason":"invalid_network"}
/settle 200 {"success":false,"errorReason":"invalid_network","transaction":"","network":"tron:3448148188"}
```

Every check `/verify` and `/settle` make, in order, is in [the reference](../reference/settler.md).

## Pending and repeated settles

When the wait ends first, `/settle` answers `{success: false, errorReason: "settlement_pending", transaction}`; x402
requires that `transaction` not be empty. Call `/settle` again with the same request: it reads the chain from where the
last read stopped, sends nothing it sent before unless its single-use value is shown unconsumed and its validity open,
and returns the final answer once there is one. A payment is answered success once: every later `/settle` of it
answers `invalid_transaction_state` naming the transaction, as x402's `exact` family requires of a consumed payment.
What each kind of repeat answers is in [the reference](../reference/settler.md#the-record-and-what-a-repeat-answers).

## What it does not serve

- **MPP.** The settler answers x402's facilitator calls only, and serves none of MPP's calls.
- **Sui's sponsored path.** x402's Sui scheme needs a gas station, whose wire its scheme does not state and whose caller
  is the buyer's client, which does not hold the resource server's credential. An option that names one is refused
  `invalid_payment_requirements`; the `sui` module holds no key.
- **Hedera's transfer executor** (`x402/exact/hedera/transfer-executor`). No member of the configuration names an
  executor, and x402's specification of the method admits none by default.
- **Solana's channel forms on mainnet.** `x402/upto/solana` and `x402/batch-settlement/solana` need the payment-channels
  program, which is not deployed on Solana mainnet; there only `exact` is registered.
- **Casper mainnet.** x402's Casper scheme names `casper:casper`, but no token there has yet been shown to execute
  `transfer_with_authorization`, so the `casper` module does not start on it; it serves `casper:casper-test`.
- **lcp's x402 pairings that another party settles.** `x402/exact/eip155/gateway-batched`, Circle's batched option,
  which the `evm` module refuses, and `x402/batch-settlement/cloudflare`, on Cloudflare's `cloudflare:402` network,
  which no module serves.

## Versions

0.5.1 takes `@integraledger/lcp` `~0.6.3` as its peer dependency: install `@integraledger/lcp@~0.6.3` beside it. A later
lcp minor release needs a settler release that names it. While both packages are 0.x, a minor release may change the
configuration, the answers or the storage; [the CHANGELOG](../../settler/CHANGELOG.md) lists what each release changes.
It needs Node.js 24.22.1 or later.

### Upgrading from 0.4.0

0.4.0 served the `tron` and `polkadot` modules alone. 0.5.0 takes `listen`, `store`, `settleWaitMs`, `operatorLog`,
`tron` and `polkadot` unchanged, and needs `@integraledger/lcp` `~0.6.0` (0.4.0 took `~0.5.0`) and Node.js 24.22.1.

0.4.0 kept its record in the table `settlement`. 0.5.0 creates `instrument`, `fee` and `module_state` beside it, never
reads or writes `settlement`, and does not fill `instrument` from it, so it does not know the payments 0.4.0 answered.
A repeated `/settle` of one of them is judged afresh, by the module's checks and lcp's read of the chain:

- **A payment 0.4.0 answered success is never answered success again.** On Tron, the module's checks refuse a
  transaction id the node holds in its blocks or pending pool, and an expiration already passed; on Polkadot, the node
  no longer answers the extrinsic valid once its nonce is used. The answer is `invalid_transaction_state` naming the
  transaction, stored, where lcp's read shows the payment final, and otherwise the check's refusal, with nothing stored.
- **A payment 0.4.0 answered `settlement_pending` is answered the same way once its transaction is in a block, and so
  is never answered success by 0.5.0, though it landed.** The one exception is a Polkadot extrinsic still in the
  node's pool, not yet in a block, when the repeat arrives: it passes the checks, 0.5.0 claims it, the node refuses
  its submission as already seen, and 0.5.0 answers success once lcp's read shows it final.
- **A payment 0.4.0 claimed and never sent** is new to 0.5.0, which settles it.

Neither rail lets one signed payment land twice: a Tron transaction id and a Polkadot account nonce are each used once.
Before you switch, call `/settle` on 0.4.0 again for each payment it left pending, until each has a final answer (its
rows in `settlement` whose `answer` is null or whose `answer->>'errorReason'` is `settlement_pending`), or read those
payments with lcp's `status` after the switch. Do not run 0.4.0 and 0.5.0 at once for the same payments: each keeps its
own record, so each can submit a payment and answer it success. `settlement` can be dropped once no payment it holds
can still land.
