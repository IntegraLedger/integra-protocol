# @integraledger/lcp-binding-tempo-mpp

Welds an ATR hash into a Tempo TIP-20 settlement under [MPP](https://paymentauth.org), and reads it back out of the
chain.

```bash
npm install @integraledger/lcp-binding-tempo-mpp
```

| | |
|---|---|
| **Chain** | Tempo (mainnet `4217`, Moderato testnet `42431`) |
| **Protocol** | `mpp` — Machine Payments Protocol, Tempo charge method |
| **Pattern** | `native-field` (LCP §8.3.1) |
| **Carrier** | TIP-20 `transferWithMemo(to, amount, bytes32 memo)` → `TransferWithMemo(…, bytes32 indexed memo)` |
| **Surface** | `createTempoMppAdapter` returning a rail-native adapter over a `TempoReader` port — **not** `binding-core`'s `WeldAdapter`, whose shape is EVM's |
| **Recovery** | on-chain, zero-party-recoverable, **forward-indexable** |
| **Weld** | `signature` on `transferWithMemo`, `tx` on `transferFromWithMemo` |
| **Spec** | TIP-20 spec + `draft-ryan-httpauth-payment-01` + `mpp-rs`, gate discharged **2026-07-30** |
| **Depends on** | [`@integraledger/lcp-binding-core`](../binding-core#readme) for the manifest and the MPP attribution tag, [`@integraledger/lcp-kernel`](../kernel#readme) for the atrHash |

## Why this rail is the strong one

TIP-20's memo is a fixed 32-byte field that accepts any value, and it is an **indexed** event parameter. An
`atrHash` is exactly 32 bytes, so the memo *is* the atrHash — nothing is packed, padded, tagged or
truncated. Three consequences:

- **On-chain.** The reference is topic 3 of the settlement's own log.
- **Zero-party recoverable.** `eth_getTransactionReceipt(txHash)` recovers the full hash with no seller
  cooperation, no indexer and no archive.
- **Forward-indexable.** `eth_getLogs({topics: [sig, null, null, atrHash]})` returns *every* settlement ever
  bound to one reference, in one query.

Measured against the rest of the tree rather than asserted: **four** shipped profiles declare the full triple
— this one, `evm:x402`, `cardano` and `evm:escrow` — and only two index by the reference itself. `evm:x402` is
the other, over EIP-3009's indexed `nonce` topic; `cardano` indexes by metadata *label*, so a query returns
every LCP-labelled settlement rather than one reference's; `evm:escrow` carries its `salt` in event *data*, so
the forward path is a scan-and-decode. Solana, XRPL, Hedera, Sui and Stellar declare
`forwardIndexable: false` and offer a history scan instead. What is distinctive here is the **carrier**: a
free-form 32 bytes with no other job — x402's nonce is replay protection the weld consumes — indexed on the
settlement transfer's own event.

The property is **chain-level, not MPP-level**: `memo.ts`, `calls.ts`, `log.ts` and `constants.ts` contain no
MPP knowledge at all, so a bare-TIP-20 binding reuses them unchanged. Only `mpp.ts` and the adapter's
`propose` know about MPP.

```ts
import {
  createTempoMppAdapter,
  TEMPO_MPP_MANIFEST,
} from "@integraledger/lcp-binding-tempo-mpp";
import type { TempoReader } from "@integraledger/lcp-binding-tempo-mpp";

declare const atrHash: `0x${string}`; // the record's atrHash
declare const seller: `0x${string}`;  // the payee
declare const txHash: `0x${string}`;  // the settlement transaction
// A `TempoReader`, NOT binding-core's `ChainReader`: this rail reads TransferWithMemo logs and queries by
// memo topic, so it adds `settlementLogs` and `logsByMemo`. The prose below says the same thing.
declare const reader: TempoReader;    // caller-supplied chain access

// The token is required: it is what makes a log evidence rather than a claim. See below.
const adapter = createTempoMppAdapter(TEMPO_MPP_MANIFEST, { token: "0x20c0…" });

// Seller: advertise the reference in the MAC-protected challenge body, and the call the buyer makes.
const { methodDetails, call } = adapter.propose(atrHash, { to: seller, amount: 1_000_000n });

// Anyone, later, from the settlement alone:
const recovered = await adapter.recover({ txHash }, reader);
const everySettlement = await adapter.enumerate(atrHash, { fromBlock: 0, toBlock: "latest" }, reader);
```

`reader` is a `TempoReader` — two methods over whatever EVM transport the deployment already has. The
package ships no client: the memo needs no ABI decoding, so a transport would be dead weight.

**One token per adapter, and it is not optional.** TIP-20 token creation is permissionless through the
`TIP20Factory` precompile, every token emits the same `TransferWithMemo`, and the memo accepts any 32 bytes.
So the memo topic identifies a *reference*; it does not authenticate an *emitter*. Without a token, anyone
could mint a worthless TIP-20, call `transferWithMemo(anyone, 1, atrHash)` on it, and hand you a transaction
that satisfies every refusal below — a weld nobody paid for. `recover`, `observe` and `enumerate` therefore
accept only the configured token's logs, `enumerate` pins it in the `eth_getLogs` filter *and* re-checks it
on the way back, and construction throws on anything that is not a 20-byte TIP-20 address. The `0x20c0…`
prefix is deliberately **not** the check: a forged token is inside the reserved range too. This is the same
shape as `binding-evm-x402`'s `config.asset` and `binding-evm-escrow`'s escrow address. A seller accepting
two tokens builds two adapters.

**`recover` establishes the reference, never the weld grade.** Four TIP-20 entry points emit the same
`TransferWithMemo`, so the grade is a property of the **call**: `adapter.weldGradeForCall(calldata)` is the
discriminator, and it needs the transaction's calldata (`eth_getTransactionByHash` → the type-`0x76`
envelope's `calls[].input`), which the `TempoReader` port deliberately does not fetch — that read is not part
of either job this binding does. Under `rail: "tempo:mpp"` the distinction is moot: mpp-rs accepts only the
`transfer` and `transferWithMemo` selectors as Tempo payment calls
(`src/protocol/methods/tempo/method.rs`), so an MPP settlement carrying a memo is signature-grade. The
bare-TIP-20 reuse has no such gate and **must** grade the calldata before treating a recovered memo as
signature-grade.

## Specification provenance — verified against the live host, 2026-07-30

Read against the host specifications and the host reference implementation, never against LCP's Appendix C
(which is informative) or any internal design note.

**Sources consulted, all on 2026-07-30.**

| Source | What it settled |
|---|---|
| `https://tempo.xyz/developers/docs/protocol/tip20/spec` (live; `docs.tempo.xyz` now 308-redirects here) | `transferWithMemo(address to, uint256 amount, bytes32 memo)`; `event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo)`; the memo "is always a fixed 32-byte field"; `transferFromWithMemo` / `mintWithMemo` / `burnWithMemo` emit the same event; TIP-403 policies; virtual-address resolution; the T6 `ReceivePolicyGuard` |
| `draft-ryan-httpauth-payment-01` (IETF, 18 Mar 2026, expires 19 Sep 2026) | the seven-slot HMAC canonicalization, with `request` (JCS + base64url) as **slot 3** — the table is 0-based — so `methodDetails` is MAC-protected |
| `https://mpp.dev` — `/intents/charge`, `/payment-methods/tempo/*`, `/sdk/typescript/server/Method.tempo.charge` | the charge request schema; `memo` as a Tempo-charge parameter; split memos constrained to a "32-byte hex hash"; mainnet `4217` / testnet `42431`; push/pull/proof modes |
| `tempoxyz/mpp-rs` @ `main` (updated 2026-07-29) — `src/protocol/methods/tempo/{types,charge,method}.rs`, `src/tempo/attribution.rs` | `TempoMethodDetails = { chainId?, feePayer?, memo?, splits? }` as the Rust type stood on that date; the memo "must be a 32-byte hex string (with or without 0x prefix)"; "when present, the server verifies `TransferWithMemo` logs instead of `Transfer`"; the attribution memo layout |
| `draft-tempo-charge-00`, Method Details (re-read 2026-08-11) | the NORMATIVE member list, which is five and not four: `chainId`, `feePayer`, `memo`, `splits`, `supportedModes` — all OPTIONAL. `supportedModes` advertises the non-zero submission modes (`"pull"` and/or `"push"`) a server accepts. This package sets `memo` and reads nothing else, so the extra member changes no behaviour here; the four-field list above is a snapshot of one implementation, not the definition |
| Tempo mainnet itself, over the public RPC | every value in the manifest — see below |

**Confirmed.** LCP §C.1's description of this rail is accurate: `methodDetails.memo` is real, it is inside
the MAC-protected body, and setting it makes the host server verify the on-chain memo matches. Tier A, with
no upstream coordination needed.

**Five findings neither the appendix nor an earlier reading carries.**

1. **The memo slot is CONTESTED by MPP itself.** When a seller supplies no `methodDetails.memo`, MPP
   generates an *attribution memo* filling all 32 bytes —
   `keccak256("mpp")[0..3] ‖ 0x01 ‖ serverId fp(10) ‖ clientId fp(10) ‖ challengeId nonce(7)` — and the
   server then *requires* a memo bound to its realm and challenge id. The two uses are mutually exclusive
   per transfer: advertising `memo = atrHash` forfeits MPP's on-chain attribution. This is not theoretical:
   in two sampled mainnet windows, **every** `TransferWithMemo` observed carried an attribution memo (45/45
   and 73/73). Hence `isMppAttributionMemo`, and hence `recover` refusing with
   `tempo-mpp/memo-is-mpp-attribution` rather than returning attribution bytes as a reference.
2. **`TransferWithMemo` is emitted for transfers, mints AND burns.** An issuer can put any 32 bytes on the
   topic with nobody paying anybody, so the parsed event carries an explicit `movement` and a memo on an
   issuance is refused as `tempo-mpp/memo-not-a-transfer`.
3. **A memo transfer emits two logs** — the standard ERC-20 `Transfer` *and* `TransferWithMemo`. A verifier
   matching `Transfer` concludes the settlement carried no memo.
4. **The recipient in the event is not necessarily the advertised one.** TIP-20 resolves a virtual-address
   recipient to its master wallet *before* emitting, and under T6 a blocked receive policy still succeeds
   with delivery redirected to `ReceivePolicyGuard`. So enumeration leaves `from`/`to` open, and this
   binding claims the memo was welded to a settled movement — never that a particular party was paid.
5. **The memo topic does not authenticate an emitter.** `TIP20Factory` is a precompile and token creation
   through it is permissionless, so an attacker's own TIP-20 emits the same `TransferWithMemo` with any 32
   bytes — including someone else's `atrHash`. The token is therefore the one part of the query that
   establishes whose settlement a log is, and the `0x20c0…` range cannot substitute for it. Hence the
   required `{ token }` at construction, above.

**One amendment to the design as drafted.** It sketched a single `weldGrades: { "tip20-memo": "tx" }`.
Reading the host changed it to
two keys: `transferWithMemo` is **signature**-grade (the observed Tempo transaction type `0x76` carries the
transfer in a `calls[]` array under the payer's own `secp256k1` signature, with the sponsor's
`feePayerSignature` beside it — the same reasoning that makes x402's EIP-3009 nonce and Solana's SPL memo
signature-grade), while `transferFromWithMemo` stays **tx**-grade because there the spender, not the owner,
chooses the memo.

**Not verified, and named as such:** hosted Stripe/Tempo facilitator behaviour in sponsored-fee paths. The
open-source SDKs are spec-clear, but whether a hosted facilitator can rewrite a user-supplied memo in a
sponsored flow is unconfirmed. Confirm with Tempo before relying on a sponsored deployment.

## Proven against a live settlement

The `recovery` triple is declared from what was observed, not from what the spec promises. Every leg was
exercised against Tempo **mainnet** (chainId 4217) on 2026-07-30, against a real production settlement:

```
tx     0x45dfbd262d0d43e3ad72f35ce6e6ac7861c112a1aeee48c2e8fa0be9031f9aef   (block 32395772)
token  0x20c000000000000000000000b9537d11c60e8b50
memo   0xef1ed7120127a6b6ab68afb53d38020000000000000000000066689448d5d103   (MPP attribution, not an atrHash)
```

Unlike every other rail binding here, this proof needs **no funds and no credentials** — which is exactly
what zero-party recovery means. The settlement is pinned in `test/fixtures/mainnet-transfer-with-memo.ts` and
re-fetched live by the opt-in suite:

```bash
TEMPO_MAINNET_RPC_URL=https://rpc.tempo.xyz pnpm --filter @integraledger/lcp-binding-tempo-mpp test
```

Without the variable those five tests skip loud and the other 149 still run. The live suite proves the pinned
fixture still matches the chain, that `recover` reads the memo from the tx hash alone (and refuses it as
attribution), that `enumerate` finds the settlement by memo topic filter, and that the live `eth_chainId`
matches the manifest's rail.

## What this package is not

- **Not the MPP placement.** A *placement* would write an advisory reference at `methodDetails.atrHash`, a
  key MPP does not read; this package writes `methodDetails.memo`, the host's own settlement instruction,
  which commits the reference to the transaction. Different keys, different jobs. There is no MPP placement
  package yet — it is unbuilt — so nothing here depends on one.
- **Not a payment verifier.** It reports what the memo bound. Whether the amount, currency and recipient were
  right is MPP's server-side verification, and whether the funds reached the named recipient is a separate
  fact — a `TransferWithMemo` proves a memo rode a transfer of the scoped token, not that the transfer
  discharged the obligation the record describes.
- **Not a settlement operator.** No writer port, no driving verb, no funds ever held. We record and verify.

## Requirement ids

This package's source and its messages cite short ids — `ATA-3`, `RCS-5`, `CMP-6` and their kin.
**They are not LCP clause numbers.** LCP is cited by section (`§8.3.1`, `§C.2`); anything shaped `XXX-n`
comes from Integra's functional specification of what a complete agent transaction requires, the fourteen
families below. Nothing in this package's behaviour depends on them, and where an id and an LCP section
disagree the section governs.

| | | | |
|---|---|---|---|
| `IDN` identity | `ASP` authority to spend | `ATA` authority to accept terms | `TRM` the terms record |
| `RCS` recourse | `PAY` payment and settlement | `WLD` the transactional weld | `OFR` offer integrity |
| `FRC` fraud, risk, and compliance | `OPS` commercial operations | `DSC` discovery and reputation | `ORC` orchestration |
| `CMP` composition | `PRS` persistence and verification infrastructure | | |

---

**Requires Node >= 24.** Part of the
[Legal Context Protocol open layer](https://github.com/IntegraLedger/integra-protocol) — see the
[documentation](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/index.md)
and the
[package index](https://github.com/IntegraLedger/integra-protocol/blob/main/docs/developer/reference.md).
Apache-2.0.
