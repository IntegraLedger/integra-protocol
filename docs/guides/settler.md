---
title: Run the settler
description: Start the settler, configure its modules, keys, credential and fee budget, and call it.
---

# Run the settler

The settler, `@integraledger/profile-facilitator`, is an x402 facilitator for the x402 pairings this package
implements: one HTTP surface, `GET /supported`, `POST /verify` and `POST /settle`, on x402's own facilitator class with
one module per chain ([the settler](../concepts/settler.md)). This guide runs it. Its programs need Postgres and the
package itself, so they are marked `no-check`: the documentation's check, which runs every other program in these
pages, does not run them.

## Install

```sh
npm install @integraledger/profile-facilitator @integraledger/lcp
```

It needs Node.js `>=24.22.1`, Postgres (the tests run on Postgres 18), and, for each network it serves, the node its module
reads. It is ESM only. `@integraledger/lcp` is its peer dependency: install it with the settler. A module that holds a
key takes it as the signer object of x402's class for that chain; make it with that chain's x402 package at 2.31.0, the
release the settler's classes are pinned to (`@x402/evm`, `@x402/svm`, `@x402/avm`, and so on).

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
        "acceptsZero": false,
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
        "acceptsZero": false,
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

The package exports one function that starts the server; it has no command-line entry. A service is a short module
that reads its configuration, makes the signer objects its keyed modules take, and stops cleanly on a signal. This one
serves x402's `exact` scheme on Base Sepolia through the `evm` module, whose key, the seller's gas key, sends each
transaction and pays its gas:

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
const signer = toFacilitatorEvmSigner({
  address: account.address,
  getCode: (a) => client.getCode(a),
  readContract: (a) => client.readContract({ ...a, args: a.args ?? [] } as never),
  verifyTypedData: (a) => client.verifyTypedData(a as never),
  writeContract: (a) => client.writeContract({ ...a, args: a.args ?? [] } as never),
  sendTransaction: (a) => client.sendTransaction(a as never),
  waitForTransactionReceipt: (a) => client.waitForTransactionReceipt(a) as never,
  simulateCalls: (a) => client.simulateCalls(a as never) as never,
});

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

Run it with `node settler.ts`: Node.js 26 runs TypeScript directly. Every call must then carry
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
        "acceptsZero": false,
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
opened and rejects with the error that stopped it, such as the listen's `EADDRINUSE` or a configuration it refuses.

## Configuration

`serveProfileFacilitator(config)` takes a `ProfileFacilitatorConfig`: the core's members, and one member for each module
the deployment starts, named for the module. A module whose member is absent is neither loaded nor started.

### The core's members

| Member | Type | Meaning |
|---|---|---|
| `listen` | `string` | `"host:port"`; an IPv6 host may be written in brackets. |
| `store` | `{ url: string }` | The Postgres connection string. Postgres holds the record, the fee count and the modules' durable state; the settler creates its tables at start where they do not exist. |
| `settleWaitMs` | `number` | How long `/settle` waits for the chain before it answers `settlement_pending`. A value that is not a positive finite number means 30 000. |
| `credential` | `string`, optional | The credential every call must present as `Authorization: Bearer <credential>`; required where a configured module holds a key ([The credential](#the-credential)). Its characters are those RFC 6750 admits in a bearer token: letters, digits and `-._~+/`, then any `=`. |
| `feeBudgets` | `{ network, amount, periodSeconds }[]`, optional | At most one per network, each on a network a configured module serves ([The fee budget](#the-fee-budget)). `amount` is in the smallest unit of the network's fee asset, a `bigint` or its decimal digits, and positive; `periodSeconds` is a positive whole number. |
| `operatorLog` | `(entry, cause?) => void`, optional | Receives every entry for the operator ([Bounds and logs](../reference/settler.md#bounds-and-logs)). The default writes one JSON line per entry on standard error. |

### The modules

Each module's member lists the networks it serves. Its keys reach it inside that member, as the signer objects its
classes take; the settler reads no key material of its own. The network is the CAIP-2 id lcp's type for the chain
names (`eip155:<chain id>`, `solana:<genesis hash prefix>`, and so on).

| Member | Chain | Scheme: pairings | `extra.key` | `extra.acceptsZero` | Facilitator |
|---|---|---|---|---|---|
| `algorand` | Algorand | `exact`: `x402/exact/algorand` | `fee-payer` | `true` | `@x402/avm`'s class; the settler's own path for a rekeyed payer signing with one key and a Falcon-key payer |
| `aptos` | Aptos | `exact`: `x402/exact/aptos` | `fee-payer`, or `none` with `sponsor: false` | `false` | `@x402/aptos`'s class |
| `cardano` | Cardano | `exact`: `x402/exact/cardano`, `x402/exact/cardano/lock` | `none` | `false` | `@x402/cardano`'s class |
| `casper` | Casper | `exact`: `x402/exact/casper` | `relayer` | `false` | `@x402/casper`'s class |
| `concordium` | Concordium | `exact`: `x402/exact/ccd` | `fee-payer` | `true` | `@x402/concordium`'s class |
| `evm` | EVM | `exact`: `x402/exact/eip155/eip3009`, `x402/exact/eip155/permit2`; `upto`: `x402/upto/eip155/permit2`; `auth-capture`: `x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2`; `batch-settlement`: `x402/batch-settlement/eip155` | `relayer` | `false` | `@x402/evm`'s classes |
| `erc7710` | EVM | `exact` with `erc7710`: `x402/exact/eip155/erc7710`, `x402/exact/eip155/erc7710-salt` | `relayer` | `false` | the settler's own, behind the `evm` module's `exact` |
| `hedera` | Hedera | `exact`: `x402/exact/hedera` | `fee-payer` | `false` | `@x402/hedera`'s class |
| `lnbtc` | Lightning | `exact`: `x402/exact/lnbtc/payment-hash` | `none` | `false` | the settler's own |
| `near` | NEAR | `exact`: `x402/exact/near` | `relayer` | `false` | `@x402/near`'s class |
| `polkadot` | Polkadot Asset Hub | `exact`: `x402/exact/polkadot/lcp-assets-remark` | `none` | `false` | the settler's own |
| `solana` | Solana | `exact`: `x402/exact/solana`; `upto`: `x402/upto/solana`; `batch-settlement`: `x402/batch-settlement/solana` | `fee-payer` | `true` on `exact`, `false` on the others | `@x402/svm`'s classes |
| `starknet` | Starknet | `exact`: `x402/exact/starknet` | `relayer` | `false` | the settler's own |
| `stellar` | Stellar | `exact` with `lcp-precondition`: `x402/exact/stellar/precondition` | `relayer` | `true` | the settler's own |
| `sui` | Sui | `exact`: `x402/exact/sui` | `none` | `false` | the settler's own |
| `ton` | TON | `exact`: `x402/exact/tvm` | `relayer` | `true` | `@x402/tvm`'s class |
| `tron` | Tron | `exact`: `x402/exact/tron/lcp-trc20-memo` | `none` | `false` | the settler's own |
| `xrpl` | XRP Ledger | `exact`: `x402/exact/xrpl`; `upto`: `x402/upto/xrpl` | `none` | `false` | `@x402/xrpl`'s class for a payer signing with one key; the settler's own for a multisigned payer and for `upto` |

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
  class broadcasts the transaction the buyer signed, whose fee the buyer pays. The class reads a transaction's confirmations from Blockfrost
  alone: over Koios alone it sees none, so an option it settles there states `extra.confirmationPolicy` as
  `{ "l1Confirmations": 0 }`, and an option that states none, whose default asks one confirmation, is refused at `/verify`
  (`@x402/cardano` 2.31.0, `dist/esm/index.mjs:483-492`, `dist/esm/chunk-C7JT2R6E.mjs:38`, `:116-117`). A provider with a
  Blockfrost project serves an option that asks confirmations. `/settle` answers success where the class does, and
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
  other than the asset), which no published EVM class settles.
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
  record since the network began.
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
  names the extrinsic's hash.
- **`solana`**: `network`; `node`, the seller's JSON-RPC endpoint, one whose `getFirstAvailableBlock` is at or below the
  slot at which each payment was issued; `signer`, the seller's fee payer (`FacilitatorSvmSigner`), which co-signs every
  transaction the payer signed and, on the channel forms, pays the channel's rent; `transactionVersions`, optional, the
  message versions the classes accept (their default `[0, 1]`). `upto` and `batch-settlement` need the payment-channels
  program, which is deployed on devnet and testnet and not on mainnet: on Solana mainnet
  (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) only `exact` is registered. Their channels are kept in the settler's
  database.
- **`starknet`**: an object `{ networks }`, one entry per network: `network`; `rpc`, a JSON-RPC node (specification 0.9
  or later) that serves `starknet_traceTransaction` and `starknet_simulateTransactions`; `executor`, an `address` and
  its `signer`, the account the payer's outside execution names as its caller, stated as `extra.feePayer`, which
  sends and pays for the transaction that executes it; `maxFee`, optional, the most one settlement's resource bounds
  may pay, in fri; `skewMarginSeconds` (default 60) and `minSettleMarginSeconds` (default 30), optional, the scheme's
  margins. x402 specifies Starknet and publishes no code for it, so the module is written to x402's scheme text and
  lcp's profile.
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
  executed; its `/settle` answers a failure naming it.
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
