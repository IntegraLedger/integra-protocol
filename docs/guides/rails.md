---
title: Rails
description: Where the ATR hash rides on each chain and on Lightning, and how each rail's settlement is read.
---

# Rails

A **rail** is where the payment settles: an EVM chain, Solana, the XRP Ledger, a Lightning node. x402 and MPP each
define how a payment is authorized on a rail, and each rail offers different fields a payment can carry: a nonce, a
memo, a note, a salt, an invoice field. This page gives, for every chain and Lightning rail this package supports, the
field H rides in, the pairings that use it, and how the settlement is read.

Each rail's pieces are in their own entry point, such as `@integraledger/lcp/evm` or `@integraledger/lcp/sui`: the
signed form the payer produces, where H sits in it, and the settlement read. The pairings that use a rail are
exported from the protocol's entry point or the rail's own, as the
[pairings reference](../reference/pairings.md) lists.

## The forms H takes on a rail

A rail field holds H in one of these forms:

| Form | Size | Used where |
|---|---|---|
| H's 32 bytes | 32 bytes | EVM nonces and salts, the Casper nonce, Sui's unused `Pure` input, the Stacks memo, the MPP XRPL `InvoiceID`, the Lightning invoice field. |
| H's LCP string, `lcp:sha256:0x…` | 77 bytes | Memos and notes: Solana, Algorand, Hedera, NEAR, Tron, TON, Concordium, the Polkadot remark, Cardano's CIP-20 message, the XRPL session memo. |
| H's first 8 bytes | 8 bytes | The Stellar muxed id, and the MPP Solana session salt. |
| H's low 250 bits | one felt | The Starknet nonce. |
| SHA-256 of H's LCP string | 32 bytes | The x402 XRPL `InvoiceID`. |
| A value derived from the challenge id | varies | The MPP charges on EVM, Tempo and Hedera, and `usdc` on EVM and Gateway, whose nonce, salt or memo derives from the challenge id that carries H. |

A field that holds only part of H, or a value derived from it, lets anyone holding the ATR confirm H, but does not let
anyone recover H from the chain alone. Each pairing's `pattern` says which it is: `zeroPartyRecoverable` is true only
where the chain keeps H itself. Where only 7 or 8 bytes of the payment depend on H, as with the Stellar muxed id and
the nonce of MPP's attribution memo on Tempo and Hedera, the payment binds H only through those bytes: whoever
assembles the ATR can construct a second ATR that shares them, and the pairing's `pattern.proves` says so.

This example prints the forms for one H, using each rail's own helper:

```ts
import { hash, toLcpString } from "@integraledger/lcp";
import { challengeId } from "@integraledger/lcp/mpp";
import { snNonce } from "@integraledger/lcp/starknet";
import { muxedId } from "@integraledger/lcp/stellar";
import { mppInvoiceId, x402InvoiceId } from "@integraledger/lcp/xrpl";

const h = await hash(new TextEncoder().encode("abc"));

console.log("H:                     ", h);
console.log("LCP string (memos):    ", toLcpString(h));
console.log("Stellar muxed id:      ", muxedId(h));
console.log("Starknet nonce:        ", snNonce(h));
console.log("x402 XRPL InvoiceID:   ", await x402InvoiceId(h));
console.log("MPP XRPL InvoiceID:    ", mppInvoiceId(h));
console.log("MPP challenge id:      ", challengeId(h, 0));
```

```text
H:                      0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
LCP string (memos):     lcp:sha256:0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
Stellar muxed id:       13436514500253700074n
Starknet nonce:         0x27816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
x402 XRPL InvoiceID:    FD9AF578DE2AF5DFC44BE5821EEF4EFE048BB2268AC8F59D58162E8310A3AB73
MPP XRPL InvoiceID:     BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD
MPP challenge id:       ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0.0
```

## Rail by rail

| Rail | Entry point | Pairings | Where H rides |
|---|---|---|---|
| EVM chains (`eip155`) | `evm` | `x402/exact/eip155/eip3009`, `x402/exact/eip155/permit2`, `x402/upto/eip155/permit2` | The nonce of the EIP-3009 authorization, or of the Permit2 witness transfer, the payer signs. |
| | | `x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2` | The escrow payment's salt, or a commitment over it with the receiver authorizer and policy, which the token authorization's nonce commits to. |
| | | `x402/exact/eip155/erc7710-salt`, `x402/exact/eip155/erc7710` | The salt of the redeemed leaf delegation; or, where the delegation signs no hash, the echoed extension only. |
| | | `x402/batch-settlement/eip155`, `mpp/session/evm` | The channel's salt. See [Channels, sessions and subscriptions](./sessions.md). |
| | | `mpp/charge/evm/authorization`, `mpp/charge/evm/permit2`, `mpp/charge/usdc/evm`, `mpp/charge/usdc/gateway` | A nonce or salt derived from the MPP challenge id. |
| | | `mpp/charge/evm/transaction`, `mpp/charge/evm/hash` | The challenge only; the payment transaction carries nothing. |
| Tempo | `tempo` | `mpp/charge/tempo/memo`, `mpp/charge/tempo/push` | MPP's attribution memo on `transferWithMemo`, whose last 7 bytes derive from the challenge id. |
| | | `mpp/session/tempo`, `mpp/subscription/tempo` | The channel's salt, or the key authorization's witness. |
| Solana | `svm`, `x402-exact-solana`, `x402-upto-solana` | `x402/exact/solana`, `x402/upto/solana`, `x402/batch-settlement/solana`, `mpp/charge/solana`, `mpp/charge/usdc/solana` | The transaction's one Memo instruction, holding H's LCP string. An `x402/batch-settlement/solana` opening also carries x402's receiver-authorizer binding memo. |
| | | `mpp/session/solana` | The session channel's salt: H's first 8 bytes. It binds those 8 bytes only: whoever assembles the ATR can construct a second ATR whose hash shares them. |
| Stellar | `stellar`, `x402-exact-stellar` | `x402/exact/stellar`, `mpp/charge/stellar` | The seller's muxed address, whose 8-byte id is H's first 8 bytes, as the Soroban `transfer`'s `to`. |
| XRP Ledger | `xrpl`, `x402-exact-xrpl` | `x402/exact/xrpl` | The Payment's `InvoiceID`: SHA-256 of H's LCP string. The payer signs with a single key: a blob that carries `Signers` is refused `xrpl/multisigned`. |
| | | `mpp/charge/xrpl` | The Payment's `InvoiceID`: H. The payer signs with a single key, as for `x402/exact/xrpl`. |
| | | `mpp/session/xrpl` | The `PaymentChannelCreate`'s one memo: H's LCP string. The payer signs the opening with a single key. |
| Hedera | `hedera` | `x402/exact/hedera` | The signed transaction body's memo: H's LCP string. |
| | | `mpp/charge/hedera` | MPP's attribution memo, as the signed body memo. |
| | | `mpp/session/hedera` | The escrow channel's salt. |
| | | `x402/exact/hedera/transfer-executor` | The challenge only. |
| Algorand | `avm` | `x402/exact/algorand` | The asset transfer's `note`: H's LCP string. |
| Aptos | `aptos` | `x402/exact/aptos` | The challenge only. No field of a standard Aptos transfer carries H; the seller ties the payment to H when it claims it for the request. |
| Cardano | `cardano` | `x402/exact/cardano` | A CIP-20 message (metadata label 674) holding H's LCP string as two strings, `lcp:sha256:0x` and the 64 lowercase hex digits, which the signed body commits to through `auxiliary_data_hash`. A message that repeats a key, or holds a second line reading as the marker in any case or behind a byte-order mark, is refused, so every reader of the chain sees one hash. |
| Casper | `casper` | `x402/exact/casper` | The CEP-3009 authorization's `nonce`. |
| Concordium | `ccd` | `x402/exact/ccd` | The one transfer's memo: H's LCP string as a CBOR text string, which a PLT transfer wraps in CBOR tag 24. The signed transaction travels in x402's wire form, which `@concordium/web-sdk` gives as `JSON.parse(Transaction.toJSONString(tx))`. |
| NEAR | `near` | `x402/exact/near` | The `memo` of the one NEP-141 `ft_transfer` in the NEP-366 delegate action the payer signs. |
| | `mpp` | `mpp/charge/nearintents` | The challenge's `externalId`. The deposit carries nothing. |
| Polkadot Asset Hub | `polkadot` | `x402/exact/polkadot/lcp-assets-remark` | A `system.remark_with_event` holding H's LCP string with lowercase hex, byte for byte, batched atomically with the asset transfer in one signed extrinsic. |
| Starknet | `starknet` | `x402/exact/starknet` | The SNIP-9 outside execution's nonce: H's low 250 bits. |
| Sui | `sui` | `x402/exact/sui` | One `Pure` input, H's 32 bytes, that no command uses. |
| Tron | `tron` | `x402/exact/tron/lcp-trc20-memo` | The TRC-20 transfer's memo, `raw_data.data`: H's LCP string. |
| TON | `tvm` | `x402/exact/tvm` | The Jetton transfer's forward payload: a TEP-74 text comment holding H's LCP string. |
| Stacks | `stacks` | `mpp/charge/usdc/stacks` | The SIP-010 `transfer`'s memo: H's 32 bytes. |
| Lightning | `lightning` | `x402/exact/lnbtc` | The BOLT11 invoice's `m` field, which the seller's node signs. |
| | | `x402/exact/lnbtc/invoice-named` | Nothing in the invoice: the ATR's `x402` slot names the invoice instead. The buyer's `build` reads that slot only from an ATR whose first members are `atrVersion`, `id` and `x402` and whose member names do not repeat. |
| | | `mpp/charge/lightning`, `mpp/session/lightning` | The BOLT11 invoice's description hash `h`, which the seller's node signs. |

Where a profile defines the binding, the [pairings reference](../reference/pairings.md) links it, and the profile
states the rail's rules clause by clause.

## Peer dependencies

Some rails parse their wire formats with the rail's own library, which the package declares as an optional peer
dependency. Install the one for each rail you use:

| Rail | Install |
|---|---|
| Solana | `@solana/kit` |
| Stellar | `@stellar/stellar-sdk` |
| XRP Ledger | `ripple-binary-codec` |
| Sui | `@mysten/sui` |
| NEAR | `@near-js/crypto`, `@near-js/transactions`, `borsh` |
| TON | `@ton/core` |
| Algorand | `algosdk` |
| Stacks | `@stacks/transactions` |

Without its peer, a rail's functions refuse with `<rail>/peer-missing`, or the pairing serves no option. Every other
rail needs nothing more than the package.

## Reading settlement

`status(ref, reader)` reads a payment's settlement through a **reader** you supply: an object with a few read-only
calls against one network's endpoint. The package makes those calls and nothing else, so the endpoint, the
credentials, the timeouts and the retries are yours. Each `status` makes a bounded number of calls.

A reader that throws, times out, or answers for another network never makes a payment failed: `status` answers
pending, with the reason `unreadable`, and a later read can settle it. On `x402/exact/eip155/erc7710-salt`,
`x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2`, `x402/batch-settlement/eip155`,
`mpp/charge/evm/authorization`, `mpp/charge/tempo/memo`, `mpp/charge/tempo/push` and `mpp/charge/usdc/evm`, whose
`reference` always names the log carrying H or its commitment, a reference without a well-formed log of that event is
pending `unreadable` too: the hash cannot be checked, nothing is read, and no later read settles it. On Casper,
Concordium, Starknet, Tron, TON, the XRP Ledger, NEAR, Stacks, Cardano, Aptos and Sui, and in the Solana and XRP Ledger
session close reads, a reference that lacks a field `status` compares the landed payment with, or holds it malformed,
such as a hash without the `0x` its pairing writes or an address in another encoding, is pending `unreadable` as well,
with nothing read; so is one whose transaction id on Tron, Cardano, Aptos or the XRP Ledger, sender on Aptos, digest on
Sui, or request body hash on TON, is
malformed. On the EVM rails, a reference whose transaction is not a 32-byte hash, or whose binding log or transfer log
is not of the form its pairing writes, is pending `unreadable` too, with nothing read; `x402/exact/eip155/eip3009`
reads H and the token from the reference's `h` and `asset` rather than its binding log, and an `h` that is not a
32-byte hash or an `asset` that is not an address reads the same; and so is an MPP EVM or Tempo session or Tempo
subscription reference whose `opens`, `opened`, `closes`, `accessKey` or `revokes` is not. Hex digits in a hash or a
hex address read the same in either case; a NEAR account id and a Stacks address read only as their pairing writes
them.
Failed means the rail itself says so: a reverted, aborted or expired transaction, or one that does not carry this
payment.

On Stellar the payer signs an authorization entry for the transfer, not the transaction that carries it, and a
transaction that fails leaves the entry unused. So a named transaction that is not found, failed, or carries another
entry leaves the payment pending while the entry is valid. Past the entry's expiration ledger, `status` searches the
asset's transfer events to the seller: it settles on a transaction that used the entry, and answers failed `expired`
only when that search is complete, finds none, and each page of events names a `latestLedger` at or above the one
`getLatestLedger` gave first. The search runs through the expiration ledger itself, in which the entry is still valid:
`transfers` takes `fromLedger` through `toLedger`, both inclusive. Stellar RPC's `getEvents` treats `endLedger` as
exclusive and scans at most 10,000 ledgers per call, so a reader over it sends `endLedger: toLedger + 1` on the first
page, only the cursor after that, and returns a `cursor` until `getEvents` has scanned through `toLedger`, even when a
page holds no events, and keeps only the events through `toLedger`, since a cursor page can scan past it. Each page
also returns `getEvents`' `latestLedger`, the latest ledger the RPC held when it answered.

An MPP Stellar push payment (a `hash` credential, under a request whose `feePayer` is false or absent) may come from a
payer that submits the transaction as its source account and authorizes the transfer with a source-account credential
instead of an address entry: the transaction's signature covers the whole transaction, `to` included. Such a payment
has no authorization entry to name, so its `reference` names the transaction and carries no `authDigest` or
`expiration`. `status` settles when that transaction succeeded as the transfer the payer authorized as its source
account, and is otherwise pending, never failed: there is no expiration ledger to pass, and `stellarLocate` has
nothing to search for.

On Sui, a node keeps only recent history, so an absent transaction can be one the endpoint has pruned.
`suiStatus(ref, reader, position)` takes the checkpoint from which you need history, such as the latest checkpoint when
the payment is requested, and answers failed `expired` only when the epoch is past the transaction's bound and the
endpoint holds transactions from that checkpoint or earlier; otherwise an absent transaction is pending `not-found`.
A transaction that sets no maximum epoch can execute in any later epoch: `reference` records it with a null
`untilEpoch`, and `suiStatus` never answers `expired` for it.

On Cardano, a recent block can still be rolled back. `cardanoStatus(ref, reader, depth)` takes the number of newer
blocks at which you take a settlement as final, and answers failed `expired` only when the block that many blocks below
the tip is at or past the transaction's TTL slot, so a rollback above that depth leaves a payment that landed pending
`not-found`, never failed. The ledger takes a transaction only in a slot below its TTL (`invalid_hereafter`), so the
TTL slot is the first in which it cannot land.

On Aptos, the ledger takes a transaction only while its time, in whole seconds, is below the transaction's
`expiration_timestamp_secs` (the prologue's `timestamp::now_seconds() < txn_expiration_time`), so that second is the
first in which it cannot commit. `aptosStatus(ref, reader)` answers failed `expired` for an absent transaction only once
the ledger's timestamp, read first, is at or past the reference's `expiresAt`.

On the rails in the table below, a verdict that a payment will never land rests on a reference point: a head time, a
ledger, a confirmed nonce, a final height or a chain tip. The reference point is read before the lookup it judges, and
a lookup shows the payment absent only up to the point its own source had reached. So the reader's answer names that
point, in the answer itself or read from the source that answered before the lookup, and the verdict needs it at or
past the reference point. A payment that lands between the two reads, or that a lookup misses because its source lags
the reference point, as one node behind a load-balanced endpoint can, stays pending (`nearLapsed` answers false), never
failed, and so does one whose answer names no point. A later read, once that source has caught up, gives the verdict.
The rule governs `expired` on Tron, TON, Aptos, Stellar and Cardano, `aborted` when every W5 transaction with a TON
request aborted, `nonce-used` for a transaction the Stacks API does not know or lists as dropped, and `nearLapsed`. On
TON, `no-transfer` reads the W5 wallet's own transaction with the request at any indexed time. On Stacks the API's
answers name no height, so a reader reads the API's chain tip from the node that answered, after the nonce read and
before the lookup, and must pin one node to name it; a reader that cannot names no height.

| Rail | The reference point, read first | What the answer that finds nothing names |
|---|---|---|
| Tron | the latest solidified block's time | `{ notFound: true, timestamp }`: the time of the latest block at the lookup's level on the node that answered |
| TON | the masterchain head's `gen_utime` | `byInBody`'s `headUtime`: the `gen_utime` of a masterchain block through which the index that answered holds every block |
| Stacks | the origin's confirmed nonce, with its `height` read after it | `{ notFound: true, height }`, or an unmined transaction's `height`: the block height of the chain tip of the API that answered, read before the lookup |
| Aptos | the ledger's timestamp | `{ notFound: true, timestampUsecs }`: the ledger timestamp of the answer |
| Stellar | `getLatestLedger`, read after the named transaction and before the events search | each events page's `latestLedger` |
| NEAR | the final block height | the key read's `blockHeight`, `view_access_key`'s `block_height` |
| Cardano | the chain tip's slot | `{ notFound: true, slot }`: the slot of the latest block the indexer that answered held |

On TON, `status` counts only the Jetton transfer that a transaction of the payer's W5 wallet sent with the signed
request, since W5 checks the signature before it sends anything; an equal transfer body executed any other way never
settles. A request the payer's W5 wallet has executed stays pending `in-flight` until its Jetton transfer lands,
however late, because an internal message carries no expiry.

| Rail | Reader | Its calls | Settled carries |
|---|---|---|---|
| EVM chains, Tempo | `EvmReader` | `eth_getTransactionReceipt`, `eth_getBlockByNumber` for the `safe` and `finalized` marks, `eth_getTransactionByHash`, `eth_call` at a block number | the finality mark reached: `latest`, `safe` or `finalized` |
| Solana | `SvmReader` | `getTransaction` at a commitment, `getSignaturesForAddress`, `isBlockhashValid`, `getFirstAvailableBlock`, `getAccountInfo` at `finalized` for a durable nonce account | the commitment: `confirmed` or `finalized` |
| Stellar | `StellarReader` | `getTransaction`, SEP-41 `transfer` events with `getEvents`' `latestLedger`, `getLatestLedger` | the ledger |
| XRP Ledger | `XrplReader` | `tx` by hash, `tx` as a binary blob, the validated ledger index | the validated ledger index |
| Hedera | `HederaReader` | the Mirror Node's transaction by id, where a rejected duplicate or a node due-diligence failure (`INVALID_NODE_ACCOUNT`, `INVALID_PAYER_SIGNATURE`) leaves the id free for the transaction itself; the MPP session reads its escrow through an `EvmReader` on Hedera's JSON-RPC relay | the consensus timestamp |
| Algorand | `AvmReader` | the Indexer's transaction search by id | the confirmed round |
| Aptos | `AptosReader` | the ledger info, read first; the transaction by hash; the sender's transaction by sequence number, with the ledger timestamp of its answer | the version |
| Cardano | `CardanoReader` | the chain tip, read first; the transaction by id, with the indexer's latest slot when it holds none; the slot of the block at a height | the confirmations |
| Casper | `CasperReader` | `info_get_transaction` | the finalized block height |
| Concordium | `CcdReader` | gRPC `GetBlockItemStatus` | `finalized` |
| NEAR | `NearReader` | `EXPERIMENTAL_tx_status`, the final block height, `view_access_key` with its `block_height` | `final` when the status is `FINAL`, else `optimistic` |
| Polkadot Asset Hub | `PolkadotReader` | Sidecar's extrinsic by block and index, a block's raw extrinsics, the finalized head | `finalized` or `head` |
| Starknet | `StarknetReader` | `starknet_getTransactionReceipt` with its `Transfer` events, `starknet_traceTransaction` | `ACCEPTED_ON_L2` or `ACCEPTED_ON_L1` |
| Sui | `SuiReader` | the transaction by digest, with the current epoch and the first checkpoint the endpoint holds transactions from | the checkpoint |
| Tron | `TronReader` | the latest solidified block, read first; `gettransactioninfobyid` at the solidified or head level, with the node's latest block time at that level when it finds nothing; `gettransactionbyid` | `solidified` or `head` |
| TON | `TvmReader` | the masterchain head, read first; Toncenter's transactions by message body hash (the signed W5 request's), with the `gen_utime` of a masterchain block through which the index holds every block, by message hash (the Jetton transfer the W5 transaction sent, then the `internal_transfer` it led to) and by hash | `confirmed` or `finalized` |
| Stacks | `StacksReader` | the origin's confirmed nonce, read first, with the chain tip's height (`GET /extended`) read after it from the same node; the transaction by id, with the chain tip's height read before it from the same node when the API does not know it or lists it unmined; a block's tenure height; the tip's tenure height | `block` or `bitcoin` |

On EVM chains, a reader rejects with `ReaderError` and one of the kinds `timeout`, `too-large`, `transport` or
`malformed`. The [seller guide](./seller.md#the-whole-flow) builds an `EvmReader` from one receipt and reads a
settlement through it.

A Solana message lives until its recent blockhash expires, 150 slots after it, unless it uses a durable nonce: its first
instruction is the System program's `AdvanceNonceAccount`, naming a writable nonce account as a static key, the
`RecentBlockhashes` sysvar and the nonce authority as a signer, and its blockhash field holds the nonce value. Such a
message lands only while the nonce account holds that value. Its reference records `nonce`, the account and the value,
and an empty `blockhash`. The sysvar may come from an address lookup table: the runtime resolves it and checks it when
`AdvanceNonceAccount` runs, and the reference records the nonce the same way. A durable message names its nonce account
as a static key (SIMD-0242), so `bound` and `reference` refuse a message whose `AdvanceNonceAccount` takes its nonce
account from a lookup table with `svm/nonce-account-not-static`. `svmNonceMoved(ref, reader)` reads the nonce account at
`finalized` and is true once the account holds another value, or is not a nonce account, at a read at least 150 slots
past `fromSlot`. A named transaction then not found is failed, with the reason `nonce-moved`. With no transaction named,
a `svmLocate` that starts after `svmNonceMoved` reads true, and is complete with nothing found, shows the message never
landed.

Lightning has no settlement read: the invoice and its preimage, which the parties hold, are the proof of payment, and
no public ledger shows it. Its pairings give `reference` and no `status`.

## Recovering H from the chain alone

On some rails the settled transaction keeps H itself, so anyone can read it back without either party. Those
pairings have `recover(tx, reader)` and `pattern.zeroPartyRecoverable` set. This example lists them from the
registry:

```ts
import { BINDINGS } from "@integraledger/lcp";

const recoverable = BINDINGS.filter((b) => b.pattern.zeroPartyRecoverable).map((b) => b.id);
console.log(recoverable.length);
console.log(recoverable.sort().join("\n"));
```

```text
27
mpp/charge/solana
mpp/charge/usdc/solana
mpp/charge/usdc/stacks
mpp/charge/xrpl
mpp/session/evm
mpp/session/hedera
mpp/session/tempo
mpp/session/xrpl
mpp/subscription/tempo
x402/batch-settlement/eip155
x402/batch-settlement/solana
x402/exact/algorand
x402/exact/cardano
x402/exact/casper
x402/exact/ccd
x402/exact/eip155/eip3009
x402/exact/eip155/erc7710-salt
x402/exact/eip155/permit2
x402/exact/hedera
x402/exact/near
x402/exact/polkadot/lcp-assets-remark
x402/exact/solana
x402/exact/sui
x402/exact/tron/lcp-trc20-memo
x402/exact/tvm
x402/upto/eip155/permit2
x402/upto/solana
```

Where H is only in calldata, `recover` reads the transaction as well as its receipt:

- `x402/exact/eip155/permit2` and `x402/upto/eip155/permit2` read the Permit2 nonce of the scheme's x402 proxy call
  (`settle` or `settleWithPermit`) found at any byte offset of the transaction's input, directly or inside a batched
  call or an ERC-4337 bundle, where the receipt holds a `Transfer` that the call's token emits from the call's owner
  (its recipient and value are not compared), and where Permit2 marks that nonce used for the owner in the receipt's
  block and not before, the Permit2 read `status` makes. No signature is checked, and Permit2's mark is per block,
  whether a settlement or the owner's `invalidateUnorderedNonces` set it: any transaction of that block whose input
  carries a call with the same nonce and owner, and whose receipt holds a `Transfer` from that owner emitted by the
  contract that call names as its token, gives H. `status` with the ATR's reference tells which transaction paid.
- `mpp/session/evm` reads the salt of the escrow's open call (`open`, `openWithAuthorization` or `openWithPermit2`)
  that the transaction itself makes, where the receipt holds a `Transfer` of the call's token, of any value, from the
  call's payer into the called contract. It refuses an opening sent through an ERC-4337 EntryPoint
  (`evm/no-open-call`), whose calldata does not show which contract the account called.

`mpp/session/tempo` reads only the receipt: the salt is data word 3 of the `ChannelOpened` log of the TIP-20 channel
reserve (TIP-1034). A v1 escrow's `ChannelOpened` carries no salt, and the reader does not show a Tempo transaction's
calls, so a v1 opening is refused (`tempo/open-not-found`).

## Where the payment is not a public proof

On some pairings the settlement leaves no public record that commits to H: `pattern.publicProof` is false. H still
rides in the challenge, and each pairing's record says what its payment shows. On most of them nothing the buyer signs
carries H either. On Lightning the invoice carries H, but the invoice and its preimage are held by the parties, and no
public ledger shows them.

For these pairings the seller advertises an [agreement URL](../concepts/buyer-gate.md#the-agreement-url) beside the
link, and the buyer gate declines such an offer without one: the buyer first pays that URL, whose payment is a public
proof of H, and then the full payment. This example lists the x402 and MPP pairings it applies to:

```ts
import { BINDINGS } from "@integraledger/lcp";

const rails = BINDINGS.filter((b) => /^(x402|mpp)\//.test(b.id) && !b.pattern.publicProof).map((b) => b.id);
console.log(rails.sort().join("\n"));
```

```text
mpp/charge/card
mpp/charge/evm/hash
mpp/charge/evm/transaction
mpp/charge/lightning
mpp/charge/nearintents
mpp/charge/stripe
mpp/session/lightning
mpp/subscription/stripe
x402/batch-settlement/cloudflare
x402/exact/aptos
x402/exact/eip155/erc7710
x402/exact/hedera/transfer-executor
x402/exact/lnbtc
x402/exact/lnbtc/invoice-named
```

The checkout pairings are the same where the buyer's approval does not sign H; see
[Agentic checkouts](./checkouts.md).

## Next

- [Binding](../concepts/binding.md): the binding patterns and the `pattern` record.
- [x402](./x402.md) and [MPP](./mpp.md): the protocols these rails settle under.
