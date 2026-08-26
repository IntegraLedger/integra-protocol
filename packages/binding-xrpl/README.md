# @integraledger/lcp-binding-xrpl

Welds an ATR hash into an XRP Ledger payment.

```bash
npm install @integraledger/lcp-binding-xrpl
```

| | |
|---|---|
| **Chain** | XRPL |
| **Pattern** | `native-field` (LCP §8.3.1, signature-grade) |
| **Protocol** | `x402` — the carrier choice was made by reading x402's exact-XRPL scheme |
| **Carrier** | `Payment.InvoiceID` (the legacy `Memos[].MemoData` path is read-only) |
| **Surface** | `createXrplAdapter` returning a rail-native adapter over a `XrplReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |

Pure TypeScript — this package speaks rippled's JSON-RPC through a port you supply and pulls **no XRPL
SDK**. Signing and submitting are your rail runtime's job.

```ts
import {
  createXrplAdapter,
  XRPL_MANIFEST,
  type XrplReader,
} from "@integraledger/lcp-binding-xrpl";

declare const atrHash: string;
declare const reader: XrplReader; // your rippled `tx` / `account_tx` client
declare const txHash: string;

const adapter = createXrplAdapter(XRPL_MANIFEST);

// PAYER, before signing — the value to set as Payment.InvoiceID.
const invoiceId = adapter.propose({ atrHash });

// VERIFIER, after settlement — the atrHash back out of a validated tesSUCCESS Payment.
const recovered = await adapter.recover({ txHash }, reader);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

## The weld moved off `Memos` — x402 rejects them

Verified at `x402-foundation/x402` HEAD 2026-08-08, the exact-XRPL scheme disqualifies memos twice:

> **§9 Safety Checks (MUST)** — The facilitator MUST reject transactions with: … `Memos` present.

> **§8 Invoice Binding** — … Memos MUST NOT be used for invoice binding.

A payment carrying the old memo weld could not settle through an x402-XRPL facilitator **at all** —
rejected before verification ever reached the amount. `InvoiceID` is a native 256-bit field, exactly the
width of an atrHash, and it was unused.

The memo path is **read-only legacy**: payments welded before the move still recover, because discarding
them would lose real records. Nothing emits one.

## Why the atrHash rides `InvoiceID` directly

x402 defines a second route — the seller sets `extra.invoiceId` and the chain carries
`InvoiceID = SHA-256(invoiceId)`, with the facilitator rejecting a mismatch. That is **facilitator-enforced
and strictly worse for a record**: the on-chain value becomes a hash *of* the atrHash, an §8.3.5 Id-Reuse
binding whose only honest surface is confirming a candidate the auditor already holds, because SHA-256 has
no inverse.

Writing the atrHash directly keeps all 32 bytes readable by anyone with the ledger — `zeroPartyRecoverable:
true`, which is most of the reason an on-chain weld exists. It is legal because the facilitator's
MUST-reject on `InvoiceID` is conditioned on `invoiceId` being **present**, so a payment that declares none
leaves the field to us.

**The cost, stated rather than guarded away.** The two uses are mutually exclusive per transaction. A seller
already using x402 invoice binding has spent the field, and — unlike the MPP attribution memo, which carries
a four-byte tag — nothing on-chain separates an atrHash from `SHA-256("INV-2025-001")`. Both are 32 opaque
bytes. So `propose` **refuses** when you tell it you are also binding an `extra.invoiceId`:

```ts
declare const atrHash: string;
declare const adapter: import("@integraledger/lcp-binding-xrpl").XrplAdapter;

adapter.propose({ atrHash });                                  // -> "AB…" for Payment.InvoiceID
adapter.propose({ atrHash, usesX402InvoiceBinding: true });     // throws — the field is already spent
```

Proposal time is the only moment that information exists; it can never be recovered from the ledger.

## The legacy memo codec

`buildLcpMemo` / `decodeLcpMemo` / `readLcpMemoAtrHash` still ship, and `recover` still consults them —
`InvoiceID` first, the memo only if it is absent. They exist for payments welded before 2026-08-08 and
nothing emits one. The codec pins LCP's `MemoType` and `MemoFormat` so an old memo is recognisable rather
than an untyped blob that happens to be 32 bytes.

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
