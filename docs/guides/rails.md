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

The package reads each standard base64 text on a rail as padded standard base64 (RFC 4648 §4) in its canonical form
only (RFC 4648 §3.5): what the payer signs (a Sui, Cardano, Aptos, Algorand, Hedera, Solana, Stellar or Stacks
transaction, a NEAR signed delegate action, a TON message), a TON option's forward payload and the TON state init
`build` takes, and what a node answers (an Algorand genesis hash, a Hedera Mirror Node memo, NEAR function-call
arguments, Stellar event topics and values). A text whose last character before the padding has a bit set past the last
byte spells the same bytes in another form, and each reader answers it as it answers any other malformed text.

Each byte array the package returns is a `Uint8Array<ArrayBuffer>` that shares no memory with any input: the bytes
`assemble` writes, `toRawBytes` and the base64 readers, each rail's decoded fields, and the bytes each `build` hands the
payer's signer. It passes as a `BlobPart` or a `BufferSource` (to `Blob`, `Response`, `crypto.subtle` or `TextDecoder`)
as it is. The one exception is the TON cell `lcpComment` gives: it is `@ton/core`'s own `Cell`, whose `hash()` answers a
Node `Buffer`. Each function that reads bytes takes any `Uint8Array`, a Node `Buffer` included. A decoded type that a
function also reads (`Bolt11`, `ProfileCall`, `SuiTx`, `SvmTx`, `TronRaw`) takes its bytes' backing as a type
parameter: `ArrayBuffer` where the package decoded it, any backing where a function reads it.

## The forms H takes on a rail

A rail field holds H in one of these forms:

| Form | Size | Used where |
|---|---|---|
| H's 32 bytes | 32 bytes | EVM nonces and salts, the Casper nonce, Sui's unused `Pure` input, the Stacks memo, the MPP XRPL `InvoiceID`, the Lightning invoice's description hash `h`. |
| H's LCP string, `lcp:sha256:0x…` | 77 bytes | Memos and notes: Solana, Algorand, Hedera, NEAR, Tron, TON, Concordium, the Polkadot remark, Cardano's CIP-20 message, the XRPL session memo. |
| H's low 250 bits | one felt | The Starknet nonce. |
| SHA-256 of H's LCP string | 32 bytes | The x402 XRPL `InvoiceID`. |
| A value derived from the challenge id | varies | The MPP `authorization` and `permit2` charges on EVM, and `usdc` on EVM and Gateway, whose nonce, salt or memo derives from the challenge id that carries H. |

The 77 bytes of H's LCP string are the string itself. Concordium writes it as a CBOR text string of 79 bytes, 83
inside a PLT transfer's CBOR tag 24, and Cardano's CIP-20 message holds it as two strings of 13 and 64 bytes, since a
CIP-20 string holds at most 64 bytes.

A field that holds a value derived from H, such as a digest over a preimage that holds it, lets anyone holding the
ATR confirm H, but does not let anyone recover H from the chain alone. Each pairing's `pattern` says which it is:
`zeroPartyRecoverable` is true only where the chain keeps H itself. No pairing takes part of H as proof: a field too
small for H carries none of it.

This example prints the forms for one H, using each rail's own helper:

```ts
import { hash, toLcpString } from "@integraledger/lcp";
import { challengeId } from "@integraledger/lcp/mpp";
import { snNonce } from "@integraledger/lcp/starknet";
import { mppInvoiceId, x402InvoiceId } from "@integraledger/lcp/xrpl";

const h = await hash(new TextEncoder().encode("abc"));

console.log("H:                     ", h);
console.log("LCP string (memos):    ", toLcpString(h));
console.log("Starknet nonce:        ", snNonce(h));
console.log("x402 XRPL InvoiceID:   ", await x402InvoiceId(h));
console.log("MPP XRPL InvoiceID:    ", mppInvoiceId(h));
console.log("MPP challenge id:      ", challengeId(h, 0));
```

```text
H:                      0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
LCP string (memos):     lcp:sha256:0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
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
| Tempo | `tempo` | `mpp/session/tempo`, `mpp/subscription/tempo` | The channel's salt, or the key authorization's witness. |
| Solana | `svm`, `x402-exact-solana`, `x402-upto-solana` | `x402/exact/solana`, `x402/upto/solana`, `x402/batch-settlement/solana`, `mpp/charge/solana`, `mpp/charge/usdc/solana` | The one Memo instruction holding H's LCP string; on the MPP charges, Memo instructions whose data is not an LCP string are not read. An `x402/batch-settlement/solana` opening also carries x402's receiver-authorizer binding memo. |
| XRP Ledger | `xrpl`, `x402-exact-xrpl` | `x402/exact/xrpl` | The Payment's `InvoiceID`: SHA-256 of H's LCP string. The blob is single-signed or multisigned: the payment is found by the payer's `Account` and signed `Sequence` or ticket, so a copy signed by another quorum, under another hash, is the same payment. The blob carries `NetworkID` as rippled requires of the option's network, none where its id is at most 1024 and that id above 1024, else `xrpl/network-mismatch`, which `build`'s `complete` also gives. |
| | | `mpp/charge/xrpl` | The Payment's `InvoiceID`: H. The payer signs with a single key, as for `x402/exact/xrpl`. |
| | | `mpp/session/xrpl` | The `PaymentChannelCreate`'s one memo holding an LCP string: H's. The payer signs the opening with a single key. |
| Hedera | `hedera` | `x402/exact/hedera` | The signed transaction body's memo: H's LCP string. |
| | | `x402/exact/hedera/transfer-executor` | The challenge only. |
| Algorand | `avm` | `x402/exact/algorand` | The asset transfer's `note`: H's LCP string. The payment entry is read as the x402 facilitator decodes it and as algod decodes the bytes the facilitator submits: an entry either reader refuses, or that the two read as different signed transactions, is `avm/txn-malformed`, and the transaction id is the one algod computes, from the transaction's canonical encoding. The facilitator decodes an entry's base64 with Node's `Buffer.from(entry, "base64")`, which takes other spellings of the same bytes; `avmCarrier` reads the canonical form only (RFC 4648 §3.5). |
| Aptos | `aptos` | `x402/exact/aptos` | The challenge only. No field of a standard Aptos transfer carries H; the seller ties the payment to H when it claims it for the request. `build`'s `complete` reads the signed transaction as `reference` reads it and gives `reference`'s code for each fault: a `transaction` that is not a string is `x402/payload-malformed`; text that is not base64 of a transaction prefix that reads to the end of its fields, or that names a module, function or struct with a name that is not a Move identifier, is `aptos/tx-malformed`; a transaction over the size bound, 64 KiB decoded, is `aptos/tx-too-large`; a payload that is not an entry function call is `aptos/not-entry-function`; a call that is not the framework `primary_fungible_store::transfer` or `fungible_asset::transfer` with one struct type argument and three arguments is `aptos/not-an-x402-transfer`; and a transaction for a chain other than the option's network is `aptos/chain-mismatch`. |
| Cardano | `cardano` | `x402/exact/cardano`, `x402/exact/cardano/lock` | A CIP-20 message (metadata label 674) holding H's LCP string as two strings, `lcp:sha256:0x` and the 64 lowercase hex digits, which the signed body commits to through `auxiliary_data_hash`. A message that repeats a key, or holds a second line reading as the marker in any case or behind a byte-order mark, is refused, so every reader of the chain sees one hash. |
| Casper | `casper` | `x402/exact/casper` | The CEP-3009 authorization's `nonce`. |
| Concordium | `ccd` | `x402/exact/ccd` | The one transfer's memo: H's LCP string as a CBOR text string, which a PLT transfer wraps in CBOR tag 24. The signed transaction travels in x402's wire form, which `@concordium/web-sdk` gives as `JSON.parse(Transaction.toJSONString(tx))`. |
| NEAR | `near` | `x402/exact/near` | The `memo` of the one NEP-141 `ft_transfer` in the NEP-366 delegate action the payer signs. |
| | `mpp` | `mpp/charge/nearintents` | The challenge's `externalId`. The deposit carries nothing. |
| Polkadot Asset Hub | `polkadot` | `x402/exact/polkadot/lcp-assets-remark` | A `system.remark_with_event` holding H's LCP string with lowercase hex, byte for byte, batched atomically with the asset transfer in one signed extrinsic. |
| Starknet | `starknet` | `x402/exact/starknet` | The SNIP-9 outside execution's nonce: H's low 250 bits. |
| Sui | `sui` | `x402/exact/sui` | One `Pure` input, H's 32 bytes, that no command uses. |
| Tron | `tron` | `x402/exact/tron/lcp-trc20-memo` | The TRC-20 transfer's memo, `raw_data.data`: H's LCP string. |
| TON | `tvm` | `x402/exact/tvm` | The Jetton transfer's forward payload: a TEP-74 text comment holding H's LCP string. The pairing serves `tvm:-239` (mainnet) and `tvm:-3` (testnet). The settlement BoC is read as TON deserializes a bag of cells, and each message in it as TON's action phase sends it at the configuration lcp holds for the option's network, which for both is mainnet's: bytes or a settlement message TON refuses are `tvm/boc-malformed`, an outgoing message TON would not send is `tvm/not-jetton-transfer`, a send mode other than 1 or 3, the two x402's TON scheme admits, is `tvm/actions`, and the wallet and Jetton wallet `reference` names are the addresses TON sends to. The W5 request is read as W5's `internal_signed` path reads it: its signature is the body's last 512 bits, and nothing after `has_other_actions` 0 is read. `build` refuses a state init TON deploys no wallet from: one that holds libraries, whose fixed prefix is longer than 8 bits, or whose hash, the bits of its fixed prefix aside, is not the wallet's address, and an attached value above the option's forward TON amount plus 30,000,000 nanotons, the stock settler's cap (`tvm/value-too-high`). `advertise` reads the stock server's forward payload, the cell of one zero bit, as an empty carrier. |
| Stacks | `stacks` | `mpp/charge/usdc/stacks` | The SIP-010 `transfer`'s memo: H's 32 bytes. The signed transaction is read as a Stacks node decodes it: bytes a node does not decode and serialize back to themselves are `mpp/stacks-tx-malformed`. |
| Lightning | `lightning` | `mpp/charge/lightning`, `mpp/session/lightning` | The BOLT11 invoice's description hash `h`, which the seller's node signs. |

Where a profile defines the binding, the [pairings reference](../reference/pairings.md) links it, and the profile
states the rail's rules clause by clause.

## Peer dependencies

Some rails parse or write their wire formats with the rail's own library, which the package declares as an optional
peer dependency. Install the one for each rail you use:

| Rail | Install |
|---|---|
| Solana | `@solana/kit` |
| Stellar | `@stellar/stellar-sdk` |
| XRP Ledger | `ripple-binary-codec` |
| Sui | `@mysten/sui` |
| NEAR | `borsh` |
| TON | `@ton/core` and its peer `@ton/crypto` |
| Algorand | `algosdk` |

Without its peer, a rail's function gives `<rail>/peer-missing` only when it reaches the one step that must decode or
write with the peer, after every check that needs none: every other input gets the answer it gets with the peer. Every
x402 pairing's option filter reads its options without the peer, so `pairingOf`, `read` and `advertise` need none:
Algorand reads its address text and TON its raw addresses, and TON's `advertise` writes the comment's BoC itself,
decoding only a forward payload the offer holds in other bytes. Algorand's `bound` and `reference` need no peer. The
other functions read or write the transaction with the peer and check everything else first: TON reads a BoC's base64,
size, layout and CRC32C before `@ton/core` decodes its cells; Sui's `build` writes its request without `@mysten/sui`,
and its `complete` decodes the signed transaction; and the Solana `build`s check every input, a blockhash the choice
gives included, before `@solana/kit` writes the message. A `status` or a locate reads as it does with the peer and gives
the same answer, after the same calls, wherever it decodes nothing with the peer; a step that must decode with the peer
makes a `status` `unreadable`, or a locate's search incomplete, when it is reached, after the reads before it.
Of the reads, Stellar's `status` and `stellarLocate` decode only a transaction that succeeded (a search that lists no
candidate decodes none), Sui's `status` only a present transaction's bytes that hash to the digest, and TON's `status`
decodes the cells it reads itself and compares raw addresses, without `@ton/core`. Every other rail needs nothing more than the package.

## Reading settlement

Which read comes first depends on who broadcast the payment. Each pairing's `broadcaster(presented)` answers
`"payer"` where the payer sent it before presenting it, so the seller reads the landed payment, and `"payee"` where the
seller sends or executes what the payer presents, then reads its settlement; the [pairings page](../concepts/pairings.md#who-broadcasts)
lists the pairings that answer by the kind of payment.

`status(ref, reader, query)` reads a payment, or an agreement, through a **reader** you supply: an object with a few
read-only calls against one network's endpoint. The package makes those calls and nothing else, so the endpoint, the
credentials, the timeouts and the retries are yours. Each `status` makes a bounded number of calls. `query` names the act
asked about (`payment` or `agreement`) and the finality asked for, one of the rail's marks below, and, where you have
them, a final ledger position the transaction must come after (`after`), the search position an earlier `pending`
answer returned (`search`), and other acts under the same H (`others`), which `status` never settles on.

`status` answers `settled`, `pending`, `failed` or `unreadable`, with one reason of the closed list the
[read-status profile](../../lcp/profiles/read-status.md) states, the transaction it names with its ledger position and
the mark it read, and the foreign items it met: transactions that carry H and are not the act asked about, each with its
reason. The profile's rules choose the answer from what the rail's read observes, which the paragraphs below describe
rail by rail. Two of them shape every rail's answers today. `failed`, for any reason but `before-position`, comes only
from a read at the rail's final mark and, where the payer's own signed act carries H, only once the search for H is read
whole; no rail's read is yet that search, so where the paragraphs below say a read finds a payment expired, failed or
not this payment, `status` answers `pending`, `search-incomplete`, and a later read with that search gives the verdict.
And an absence is `not-found` only where the reader shows it holds the history the payment would be in; otherwise it is
`unreadable`, `history-gap`.

A reader that throws or times out never makes a payment failed: a rejected read of the transaction makes `status` answer
`unreadable`, with the reason `transport` (or `too-large` where the reader says its answer exceeded its bound), and a
later read can settle it; a rejected read of a finality mark counts as that mark not reached. On EVM chains and Tempo,
a reader answer that is not a receipt (a `status` of 0 or 1, a bigint `blockNumber` and a list of logs), or a receipt
holding a log that is not an object with a string `address`, an array of string `topics` and a string `data`, makes
`status` answer `unreadable`, `unparseable`, and `recover` refuses it as `evm/unreadable` or `tempo/unreadable`, the
code its rail gives a failed read.
A reader that declares a network other than the reference's makes `status` answer `unreadable`, `chain-mismatch`, with nothing read,
so no later read through it settles the payment. The package compares only the `network` a reader declares and never
asks its endpoint which network it serves, so a reader declares its endpoint's own: one that declares the payment's
network over another network's endpoint finds nothing, and where a verdict rests on a point it reads, such as a head,
ledger, slot or round, it can answer failed `expired` for a payment that landed. On `x402/exact/eip155/erc7710-salt`,
`x402/auth-capture/eip155/eip3009`, `x402/auth-capture/eip155/permit2`, `x402/batch-settlement/eip155`,
`mpp/charge/evm/authorization` and `mpp/charge/usdc/evm`, whose
`reference` always names the log carrying H or its commitment, a reference without a well-formed log of that event is
`unreadable` too: the hash cannot be checked, nothing is read, and no later read settles it. On Casper,
Concordium, Starknet, Tron, TON, the XRP Ledger, NEAR, Stacks, Cardano, Aptos, Sui and Stellar, and in the XRP Ledger
session close read, a reference that lacks a field `status` compares the landed payment with, or holds it
malformed, such as a hash without the `0x` its pairing writes or an address in another encoding, is pending
`unreadable` as well, with nothing read; so is one whose transaction id on Tron, Cardano, Algorand, Aptos, Stellar or
the XRP Ledger, last valid round on Algorand, sender on Aptos, digest on Sui, request body hash on TON, or asset,
recipient, expiration ledger or starting ledger on Stellar, is
malformed. On the EVM rails, a reference whose transaction is not a 32-byte hash, or whose binding log or transfer log
is not of the form its pairing writes, is `unreadable` too, with nothing read; `x402/exact/eip155/eip3009`
reads H and the token from the reference's `h` and `asset` rather than its binding log, and an `h` that is not a
32-byte hash or an `asset` that is not an address reads the same; `mpp/charge/evm/transaction` and
`mpp/charge/evm/hash` read the token from the reference's `asset`, which their transfer log names, and an `asset` that
is not an address reads the same; and so is an MPP EVM or Tempo session or Tempo
subscription reference whose `opens`, `opened`, `closes`, `accessKey` or `revokes` is not, or that names none of the
keys its own pairing writes for the opening or the close, or names a key another of the three writes (see
[Channels, sessions and subscriptions](./sessions.md)). Hex digits in a hash or a
hex address read the same in either case; a NEAR account id and a Stacks address read only as their pairing writes
them.
Failed means the rail itself says so: a reverted, aborted or expired transaction, or one that does not carry this
payment. On Tron a failed answer can come from the FullNode's head before the block is solidified, and on TON from
transactions not yet finalized; a failed answer names no finality.

`status` reads the settlement of the presented transaction. On Tron and NEAR, `reference` takes the token from
that transaction, so `status` reports the settlement on the contract the transaction called; on Stacks the reference
names the origin, the nonce it signed and the challenge's recipient, and no contract, and on Solana
the reference names no token: confirming that it is the token the challenge named is the seller's check.

On EVM chains and Tempo, a block above the `finalized` mark can be replaced, by one in which the same transaction
succeeds or holds other logs. A failed answer names no mark, so `status` gives one read from a receipt (`reverted`,
`authorization-not-used`, `transfer-not-found`, `binding-log-not-found`, `receive-policy-blocked`, `nonce-not-used` or
`open-call-not-found`) only when the receipt's block is at or below the reader's `finalized` mark. Above it, or where
that mark cannot be read, `status` answers pending with the same reason, and a later read gives the verdict. An EVM
`recover` (`x402/exact/eip155/eip3009`, `x402/exact/eip155/erc7710-salt`, `x402/exact/eip155/permit2`,
`x402/upto/eip155/permit2`, `x402/batch-settlement/eip155` and `mpp/session/evm`) places by the same mark a revert and
each verdict it reads from the receipt, the settle call it finds with the receipt's `Transfer`, or Permit2's nonce
bitmap at the receipt's block (`evm/no-authorization-use`, `evm/no-leaf`, `evm/no-channel-created`,
`evm/no-permit2-settle`, `evm/nonce-not-used`, `evm/ambiguous`, and `evm/no-open-call` for an open call whose receipt
holds no `Transfer` from its payer): the verdict at or below it, and `evm/not-final`, a read to repeat, above it or
where it cannot be read. A transaction whose own call is not an escrow open call is `evm/no-open-call` on every read,
since its calldata is its own. A Tempo `recover` (`mpp/session/tempo` and `mpp/subscription/tempo`) places a revert,
`tempo/open-not-found`, `tempo/no-witness` and `tempo/ambiguous` by the same mark, with `tempo/not-final` above it or
where it cannot be read. Settled answers, and the hash a `recover` gives, are not held to the mark: they carry the mark
they reached, or none.

On Solana a block at `confirmed` has been voted on by a supermajority of the cluster but can still be replaced, and a
transaction in it can land in another block and execute otherwise; a block at `finalized` has reached maximum lockout.
So a Solana `status` gives a failure that rests on how the transaction executed, an error (`err`) or no token or SOL
transfer among its instructions and inner instructions (`no-transfer`), only from the read at `finalized`. From a read
at `confirmed` alone it answers pending `not-final`, and a later read gives the verdict. A failure that rests only on
the signed message, which the signature fixes, holds from a read at either commitment: a message the payer did not sign
(`not-this-instrument`), or no single `open` or `top_up` payment-channels instruction (`no-channel-instruction`). An
account a transaction takes from an address lookup table, such as an inner instruction's program, is read from the
addresses the landed transaction's tables loaded (`SvmLanded.loaded`, `getTransaction`'s `meta.loadedAddresses`), so no
table is read; a landed answer whose loaded addresses are not 32-byte keys in exactly the numbers the message's lookups
name, or repeat a static key or each other (the runtime refuses a transaction that loads one account twice), reads as
`unreadable`. The Solana `recover`s and `fetchPresented` read an error by the same rule: `svm/err` from the read
at `finalized`, and `svm/not-final`, a read to repeat, from the read at `confirmed` alone.

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

On Sui, a node keeps only recent history, so an absent transaction can be one the endpoint has pruned.
`suiStatus(ref, reader, position)` takes the checkpoint from which you need history, such as the latest checkpoint when
the payment is requested, and answers failed `expired` only when the epoch is past the transaction's bound and the
endpoint holds transactions from that checkpoint or earlier; otherwise an absent transaction is pending `not-found`.
A transaction that sets no maximum epoch can execute in any later epoch: `reference` records it with a null
`untilEpoch`, and `suiStatus` never answers `expired` for it.

On Cardano, a recent block can still be rolled back. `cardanoStatus(ref, reader, query)` counts a transaction's
confirmations up to the ledger's security parameter, read from the endpoint's genesis, which is the final mark, and
reads the body's TTL as passed only when the block that many blocks below the tip is at or past its TTL slot, so a
rollback above that depth leaves a payment that landed pending, never failed. The ledger takes a transaction only in a
slot below its TTL (`invalid_hereafter`), so the TTL slot is the first in which it cannot land.

On Aptos, the ledger takes a transaction only while its time, in whole seconds, is below the transaction's
`expiration_timestamp_secs` (the prologue's `timestamp::now_seconds() < txn_expiration_time`), so that second is the
first in which it cannot commit. `aptosStatus(ref, reader)` answers failed `expired` for an absent transaction only once
the ledger's timestamp, read first, is at or past the reference's `expiresAt`.

On the rails in the table below, a verdict that a payment will never land rests on a reference point: a head time, a
ledger, a confirmed nonce, a final height, a chain tip or the slot of a nonce account read. The reference point is
read before the lookup it judges, and
a lookup shows the payment absent only up to the point its own source had reached. So the reader's answer names that
point, in the answer itself or read from the source that answered before the lookup, and the verdict needs it at or
past the reference point. A payment that lands between the two reads, or that a lookup misses because its source lags
the reference point, as one node behind a load-balanced endpoint can, stays pending (NEAR's `status` answers `pending`), never
failed, and so does one whose answer names no point. A later read, once that source has caught up, gives the verdict.
The rule governs `expired` on Tron, TON, Aptos and Stellar, `nonce-moved` for a named Solana durable-nonce transaction
no lookup finds, and NEAR's and Cardano's `instrument-unused`. Stacks reads no absence this way: its read holds the
origin's nonce, read at the chain tip, so a nonce not consumed there is `instrument-live`, and one consumed whose
transaction no lookup finds is `search-incomplete`, never `not-found`. On Solana
`getTransaction` names no slot when it finds nothing, so a reader reads `getSlot` at the lookup's commitment from the
node that answers, before the lookup, and must pin one node to name it; a reader that cannot names no slot.

| Rail | The reference point, read first | What the answer that finds nothing names |
|---|---|---|
| Tron | the latest solidified block's time | `{ notFound: true, timestamp }`: the time of the latest block at the lookup's level on the node that answered |
| TON | the masterchain head's `gen_utime` | `indexed()`: the index's statement of a finalized masterchain block through which it holds every block, with its `gen_utime`, on which the expiry read decides |
| Aptos | the ledger's timestamp | `{ notFound: true, timestampUsecs }`: the ledger timestamp of the answer |
| Stellar | `getLatestLedger`, read after the named transaction and before the events search | each events page's `latestLedger` |
| NEAR | the final block height | the key read's `blockHeight`, `view_access_key`'s `block_height` |
| Cardano | the chain tip's slot | `{ notFound: true, slot }`: the slot of the latest block the indexer that answered held |
| Solana | the context slot of the durable nonce account's read (`getAccountInfo` at `finalized`) | `{ notFound: true, slot }`: the slot at the lookup's commitment of the node that answered, read before the lookup |

On TON, `status` counts only a Jetton transfer that a run of the payer's W5 wallet sent, since W5 checks the
signature before it sends anything; an equal transfer body executed any other way never settles. A request the wallet
has run stays pending `search-incomplete`, held at its transaction, until its Jetton transfer lands, however
late, because an internal message carries no expiry. Its lapse is the expiry read of the profile `x402-exact-tvm`
(rule 6): the wallet's state, its transactions linked back to the position, and the index's statement of the blocks it
holds. That an index lists whole is not yet shown by a run, so until it is the expiry read releases nothing: no answer
but `before-position` is `failed`.

| Rail | Reader | Its calls | Settled carries |
|---|---|---|---|
| EVM chains, Tempo | `EvmReader` | `eth_getTransactionReceipt`, `eth_getBlockByNumber` for the `safe` and `finalized` marks, `eth_getTransactionByHash`, `eth_call` at a block number | the finality mark reached: `latest`, `safe` or `finalized` |
| Solana | `SvmReader` | `getTransaction` at a commitment, with encoding `base64` and `maxSupportedTransactionVersion: 1` (asked with 0, a node answers a version-1 transaction with an error, and a version-1 payment never reads settled), with the node's slot at that commitment (`getSlot`) read before it when it finds nothing, `getSignaturesForAddress`, with `minContextSlot` when the search names one, `getFirstAvailableBlock`, `getAccountInfo` at `finalized` for a durable nonce account; and `isBlockhashValid` with its context slot, which the package does not call: you read it for your own verdict on a blockhash reference (below) | the commitment: `confirmed` or `finalized` |
| Stellar | `StellarReader` | `getTransaction`, SEP-41 `transfer` events with `getEvents`' `latestLedger`, `getLatestLedger` | the ledger |
| XRP Ledger | `XrplReader` | `tx` by hash, `tx` as a binary blob, the validated ledger index | the validated ledger index |
| Hedera | `HederaReader` | the Mirror Node's transaction by id, where a rejected duplicate or a node due-diligence failure (`INVALID_NODE_ACCOUNT`, `INVALID_PAYER_SIGNATURE`) leaves the id free for the transaction itself | the consensus timestamp |
| Algorand | `AvmReader` | the Indexer's transaction search by id | the confirmed round |
| Aptos | `AptosReader` | the ledger info, read first; the transaction by hash; the sender's transaction by sequence number, with the ledger timestamp of its answer | the version |
| Cardano | `CardanoReader` | the security parameter from the endpoint's genesis; the chain tip, read first; the slot of the block at a height; the output an input names, with the transaction that spent it; the transaction by id, with the indexer's latest slot when it holds none; the addresses that hold a transaction's inputs; a payment credential's transactions, by page | the confirmations |
| Casper | `CasperReader` | `info_get_transaction` | the finalized block height |
| Concordium | `CcdReader` | gRPC `GetBlockItemStatus` | `finalized` |
| NEAR | `NearReader` | `EXPERIMENTAL_tx_status`, the final block height, `view_access_key` at final and at the latest head with its `block_height`, `changes` for one access key and for every key of an account | `final` when the status is `FINAL` and the change is at or below the final height, else `optimistic` |
| Polkadot Asset Hub | `PolkadotReader` | Sidecar's extrinsic by block and index, a block's raw extrinsics, the finalized head | `finalized` or `head` |
| Starknet | `StarknetReader` | the newest `ACCEPTED_ON_L1` and `ACCEPTED_ON_L2` blocks, `is_valid_outside_execution_nonce` on the payer's account at a block, `starknet_getEvents` on the asset a page at a time, `starknet_getTransactionReceipt` with its events, `starknet_traceTransaction` | `ACCEPTED_ON_L2` or `ACCEPTED_ON_L1` |
| Sui | `SuiReader` | the transaction by digest, with the current epoch and the first checkpoint the endpoint holds transactions from | the checkpoint |
| Tron | `TronReader` | the latest solidified block, read first; `gettransactioninfobyid` at the solidified or head level, with the node's latest block time at that level when it finds nothing; `gettransactionbyid` | `solidified` or `head` |
| TON | `TvmReader` | the masterchain head, read first; the index's statement of the blocks it holds; Toncenter's transactions by message body hash (the signed W5 request's); the wallet's state and its transactions by account, each with its predecessor and the account's state before and after it; by message hash (the Jetton transfer a run sent, then the `internal_transfer` it led to) and by hash; and `runGetMethod`'s `get_wallet_data` and `get_wallet_address` | `confirmed` or `finalized` |
| Stacks | `StacksReader` | the chain tip's Stacks and Bitcoin heights (`GET /extended`), read first; the reference's transaction by id with its events and bytes, a hint; the origin's last executed nonce at the tip or at a height; the lookup by origin and nonce, or for nonce 0 a scan of the origin's transactions; a block's transactions, the lookup's fallback; the Bitcoin height of the burn block of the tenure after a block's | `block` or `bitcoin` |

On EVM chains, a reader rejects with `ReaderError` and one of the kinds `timeout`, `too-large`, `transport` or
`malformed`. The [seller guide](./seller.md#the-whole-flow) builds an `EvmReader` from one receipt and reads a
settlement through it.

A Solana message lives until its recent blockhash's validity ends, 150 blocks after the blockhash's own block, unless it
uses a durable nonce: its first instruction is the System program's `AdvanceNonceAccount`, naming a writable nonce
account as a static key, the `RecentBlockhashes` sysvar and the nonce authority as a signer, and its blockhash field
holds the nonce value. Such a message lands only while the nonce account holds that value. Its reference records
`nonce`, the account and the value, and an empty `blockhash`. The sysvar may come from an address lookup table: the
runtime resolves it and checks it when `AdvanceNonceAccount` runs, and the reference records the nonce the same way. A
durable message names its nonce account as a static key (SIMD-0242), so `bound` and `reference` refuse a message whose
`AdvanceNonceAccount` takes its nonce account from a lookup table with `svm/nonce-account-not-static`.

A Solana `status` (`svmStatus`, `svmChannelStatus`, and each Solana pairing's `status`) reads one mark, `finalized`. It
searches for H in the memo-carrying signatures of the buyer's own account, which every transaction the buyer signs
loads, never the fee payer's, from the position given to the latest head (`confirmed`, which is no mark), 10 pages of
1,000 and 50 candidates a pass; a pass not read whole answers `pending`, `search-incomplete`, with the handle
(`search`) the next call takes. It reads a durable nonce's account at `finalized` and at the latest head. For a
blockhash message it takes the first `isBlockhashValid` answer of `true` at `confirmed`, whose context slot bounds the
blockhash's own slot from above and which the handle keeps; it reads the blockhash lapsed only where `isBlockhashValid`
answers `false` at `finalized` at a slot at least 150 past that bound, since a slot count alone decides nothing: a
skipped slot adds no block. Until a run shows that the buyer's signatures list every transaction the buyer signs
(`SVM_SEARCH_SHOWN`), a search read whole proves no absence: the read answers no `failed` but `before-position`, and
`pending`, `search-incomplete` where it would answer `instrument-unused`, `instrument-consumed` or
`transaction-failed`. The profiles `x402-exact-solana` and `read-status` state the read whole.

Lightning has no settlement read: the invoice and its preimage, which the parties hold, show that the invoice was paid.
They do not show who paid it, and no public ledger shows the payment. Its pairings give `reference` and no `status`.

On Lightning, `build` checks the binding and the invoice's form: that the invoice carries H where its pairing places
it, that it answers this request, and that its currency is the one the network names. It verifies no signature and
does not compare the invoice's amount or payee with the offer: those checks are the payer's, done by its wallet or
node.

## Recovering H from the chain alone

On some pairings anyone can read H back from the settled transaction alone, without either party. Those pairings have
`recover({ network, tx, option }, reader)` and `pattern.zeroPartyRecoverable` set: the network, the settlement
transaction's id, and the x402 option or MPP challenge the ATR's binding slot holds, from which each rail's read takes
what it needs, as its profile states. This example lists them from the registry:

```ts
import { BINDINGS } from "@integraledger/lcp";

const recoverable = BINDINGS.filter((b) => "pattern" in b && b.pattern.zeroPartyRecoverable).map((b) => b.id);
console.log(recoverable.length);
console.log(recoverable.sort().join("\n"));
```

```text
30
mpp/charge/solana
mpp/charge/solana/unsponsored
mpp/charge/usdc/solana
mpp/charge/usdc/stacks
mpp/charge/xrpl
mpp/session/evm
mpp/session/solana/memo
mpp/session/tempo
mpp/session/xrpl
mpp/subscription/solana
mpp/subscription/tempo
x402/batch-settlement/eip155
x402/batch-settlement/solana
x402/exact/algorand
x402/exact/cardano
x402/exact/cardano/lock
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

Two pairings that keep no H on chain have a `recover` that returns the value the transaction carries in H's place,
which a holder of the ATR computes from its own H and compares: `x402/exact/starknet` returns the outside execution's
nonce, H's low 250 bits, and `x402/exact/xrpl` the `Payment`'s `InvoiceID`, the SHA-256 of H's LCP string.

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
  (`evm/no-open-call`), whose calldata does not show which contract the account called, and so one whose calldata is
  longer than 131,072 bytes, go-ethereum's transaction pool maximum, which the read does not decode.

`mpp/session/tempo` reads only the receipt: the salt is data word 3 of the `ChannelOpened` log of the TIP-20 channel
reserve (TIP-1034). A v1 escrow's `ChannelOpened` carries no salt, and the reader does not show a Tempo transaction's
calls, so a v1 opening is refused (`tempo/open-not-found`, once its block is at or below the reader's `finalized`
mark).

## Where the payment is not a public proof

On some pairings the settlement leaves no public record that commits to H: `data.coverage` is `none`. H still
rides in the challenge, and each pairing's record says what its payment shows. On most of them nothing the buyer signs
carries H either. On the MPP Lightning pairings the invoice carries H; the invoice and its preimage are held by the
parties, and no public ledger shows them.

For these pairings the seller advertises an [agreement URL](../concepts/buyer-gate.md#the-agreement-url) beside the
link, and the buyer gate declines such an offer without one: the buyer first pays that URL, whose payment is a public
proof of H, and then the full payment. This example lists the x402 and MPP pairings it applies to:

```ts
import { BINDINGS } from "@integraledger/lcp";

const rails = BINDINGS.filter((b) => /^(x402|mpp)\//.test(b.id) && b.data.coverage === "none").map((b) => b.id);
console.log(rails.sort().join("\n"));
```

```text
mpp/charge/card
mpp/charge/evm/hash
mpp/charge/evm/transaction
mpp/charge/lightning
mpp/charge/nearintents
mpp/charge/stripe
mpp/charge/usdc/gateway
mpp/session/hedera/stock
mpp/session/lightning
mpp/session/solana/stock
mpp/session/xrpl/stock
mpp/subscription/stripe
x402/batch-settlement/cloudflare
x402/exact/aptos
x402/exact/eip155/erc7710
x402/exact/hedera/transfer-executor
```

The checkout pairings are the same where the buyer's approval does not sign H; see
[Agentic checkouts](./checkouts.md).

## Next

- [Binding](../concepts/binding.md): the binding patterns and the `pattern` record.
- [x402](./x402.md) and [MPP](./mpp.md): the protocols these rails settle under.
