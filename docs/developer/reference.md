# Package reference

Every package shipped by this repository, grouped by what it does. Each package's README is its detailed
API reference; the role column says only what the package is for.

Packages publish under the `@integraledger` scope — a table entry `kernel` is `@integraledger/lcp-kernel`.

## Core

The verification cone: the record, the walk, and everything the walk consults. Seven packages — the same
seven the root README names, `binding-core` among them, because it is chain-free and the walk consults it.

| Package | Role | README |
|---|---|---|
| `kernel` | Assembles an ATR into one canonical JSON document and hashes it; carries zero runtime dependencies, by design and by enforced rule. | [README](../../packages/kernel/README.md) |
| `verify` | Runs the verification walk over the inputs it is given and emits the canonical report, opening no sockets and fetching nothing itself. | [README](../../packages/verify/README.md) |
| `authority` | Decides whether a chain of delegated grants actually attenuates, whether an acceptance signature holds, and whether either was revoked or expired as of the moment that matters. | [README](../../packages/authority/README.md) |
| `evidence` | Builds and verifies content-addressed evidence bundles — a CARv1 file whose root manifest lists every artifact by role and content hash — and resolves the referenced artifacts through a hardened fetcher. | [README](../../packages/evidence/README.md) |
| `discovery` | Emits and validates the `/.well-known/legal-context.json` document and the capability declaration a buyer's agent publishes, covering both sides of the bilateral handshake. | [README](../../packages/discovery/README.md) |
| `conformance` | Ships the conformance corpus, its runner, and the subject adapters that drive an implementation under test. | [README](../../packages/conformance/README.md) |
| `binding-core` | The seam the rails hang off: the carrier codec, the placement kit, and the `WeldAdapter` port. Chain-free, and `depcruise` holds it that way. | [README](../../packages/binding-core/README.md) |

## Bindings

A binding welds an ATR hash into a settlement that moves value, through a field that settlement commits
to. The three EVM rail bindings implement `binding-core`'s `WeldAdapter` port, so a caller can weld and
recover across them without
knowing which chain it is on.

| Package | Role | README |
|---|---|---|
| `binding-evm-common` | Supplies the EVM typed-data construction, signature verification, and event decoding that the EVM bindings are built from; it is not itself a rail binding and binds no chain. | [README](../../packages/binding-evm-common/README.md) |
| `binding-evm-x402` | Welds an ATR hash into an x402 instant settlement on any EVM chain, carried in the EIP-3009 `nonce` the payer already signs. | [README](../../packages/binding-evm-x402/README.md) |
| `binding-evm-mpp` | Welds an LCP record to an MPP settlement on EVM by Id-Reuse: the seller sets `challenge.id` to the ATR hash and MPP's own required derivation carries it into the transaction. | [README](../../packages/binding-evm-mpp/README.md) |
| `binding-evm-escrow` | Welds an ATR hash into an authorize-and-capture escrow settlement on EVM chains, carried in `PaymentInfo.salt`, so a payment authorized under one set of terms and captured later still corresponds to them. | [README](../../packages/binding-evm-escrow/README.md) |
| `binding-aptos` | Welds an ATR hash into an Aptos settlement, carried in the `payment_id` argument of a Move entry call against a deployed `lcp_payment` module. | [README](../../packages/binding-aptos/README.md) |
| `binding-canton` | Welds an ATR hash into a Canton settlement through an `LcpAnchor` Daml contract — an overlay by CHOICE, for the deployments x402's exact-Canton scheme cannot reach (it settles Canton Coin only). Ships the Daml template. | [README](../../packages/binding-canton/README.md) |
| `binding-canton-x402` | Welds an ATR hash into a Canton Coin settlement over x402's `exact` scheme, carrying it in `PaymentRequirements.extra.memo` — facilitator-verified and on the same transaction as the payment. | [README](../../packages/binding-canton-x402/README.md) |
| `binding-cardano` | Welds an ATR hash into a Cardano transaction under a dedicated transaction-metadata label, which the signed transaction body commits to. | [README](../../packages/binding-cardano/README.md) |
| `binding-hedera` | Welds an ATR hash into a Hedera Token Service transfer, carried in the transaction memo. | [README](../../packages/binding-hedera/README.md) |
| `binding-solana` | Welds an ATR hash into a Solana SPL token settlement, carried in SPL Memo instruction data with no overlay program. | [README](../../packages/binding-solana/README.md) |
| `binding-stellar` | Welds an ATR hash into a Stellar payment, carried in the `mux_id` of a CAP-67 muxed destination address that commits atomically with the transfer. | [README](../../packages/binding-stellar/README.md) |
| `binding-sui` | Welds an ATR hash into a Sui settlement through the Pay402 facilitator, carried in the full 32 raw bytes of the `payment_id` argument. | [README](../../packages/binding-sui/README.md) |
| `binding-tempo-mpp` | Welds an ATR hash into a Tempo TIP-20 settlement under MPP, carried in the indexed `bytes32 memo` of `transferWithMemo`, and reads it back out of the chain. | [README](../../packages/binding-tempo-mpp/README.md) |
| `binding-xrpl` | Welds an ATR hash into an XRP Ledger payment, carried in `Payment.InvoiceID`; the `Memos[].MemoData` path is read-only legacy, because x402's exact-XRPL scheme makes a facilitator reject a memo-bearing transaction. | [README](../../packages/binding-xrpl/README.md) |

## Placements

A placement puts an LCP reference into a document of a host protocol that never settles. Import
`placements` rather than a `placement-*` package directly — it is the one place a protocol is registered.

| Package | Role | README |
|---|---|---|
| `placements` | Maps a protocol id to the placement adapter that handles it, making a new protocol a data edit in one package rather than a change at every call site. | [README](../../packages/placements/README.md) |
| `placement-x402` | Places an LCP reference into an x402 v2 payment challenge and reads it back out — the HTTP-layer carrier, distinct from the EVM settlement weld of `binding-evm-x402`. | [README](../../packages/placement-x402/README.md) |
| `placement-mpp` | Places an LCP reference into an MPP (Machine Payments Protocol) charge request body and reads it back out, riding inside the challenge-bound payload byte-for-byte. | [README](../../packages/placement-mpp/README.md) |
| `placement-ap2` | Places an LCP reference into the transport envelope that carries an AP2 (Agent Payments Protocol) mandate and reads it back out, alongside the mandate and never inside it. | [README](../../packages/placement-ap2/README.md) |
| `placement-ack` | Places an LCP reference into an Agent Commerce Kit (ACK) payment receipt credential and reads it back out, through the credential's own documented extension point. | [README](../../packages/placement-ack/README.md) |
| `placement-acp` | Places an LCP reference into an ACP agentic checkout session's `metadata.legal_context` and reads it back out; the top-level `legal_context` is READ only — LCP v1.38 §C.2 withdrew the write, and ACP's own schema rejects it. | [README](../../packages/placement-acp/README.md) |
| `placement-ucp` | Places an LCP reference into a UCP (Universal Commerce Protocol) checkout and reads it back out, carried in a `policies[]` entry tagged with a reverse-domain type. | [README](../../packages/placement-ucp/README.md) |
| `placement-visa-tap` | Places an LCP reference into a Visa TAP request header and reads it back out; the header sits outside the covered components of any TAP signature, so it makes a reference available and attests nothing. | [README](../../packages/placement-visa-tap/README.md) |
| `placement-mastercard-vi` | **Declaration only.** Describes where an LCP reference would ride in a Verifiable Intent open mandate — a custom Layer-2 constraint under the deployment's own reverse-DNS namespace — and reads one back out. `place` REFUSES: LCP v1.38 §C.7 withdrew the write. | [README](../../packages/placement-mastercard-vi/README.md) |
| `placement-a2a` | Places an LCP reference into an A2A (Agent-to-Agent Protocol) task and reads it back out, riding the task metadata every conformant implementation already admits. | [README](../../packages/placement-a2a/README.md) |
