# @integraledger/lcp-binding-canton-x402

Welds an ATR hash into a Canton Coin settlement over x402's `exact` scheme.

```bash
npm install @integraledger/lcp-binding-canton-x402
```

| | |
|---|---|
| **Chain** | Canton — **Canton Coin only**, see below |
| **Pattern** | `native-field` (LCP §8.3.1) |
| **Protocol** | `x402` — the carrier is x402's, not Canton's own |
| **Carrier** | `PaymentRequirements.extra.memo`, echoed into the transfer metadata under `x402.memo` |
| **Surface** | `createCantonX402Adapter` returning a rail-native adapter over a `CantonX402Reader` port — **not** `binding-core`'s `WeldAdapter`, whose shape is EVM's |

## The carrier

x402's `exact` scheme for Canton defines a seller-set memo:

> `extra.memo` (optional): Seller-defined UTF-8 string, max 256 bytes. When present, the client MUST
> include it in the transfer's metadata.

and its facilitator safety checks make it binding:

> **Memo.** If `paymentRequirements.extra.memo` is set, the transfer metadata MUST carry the identical
> value under `x402.memo`. Reject with `invalid_exact_canton_memo_mismatch`.

So the seller names the value, the payer must echo it into the transfer that moves the money, and a third
party refuses to relay the payment if the two disagree. One transaction settles each payment, so the
weld, the value and the settlement are the same on-ledger event.

```ts
import {
  CANTON_X402_MANIFEST,
  createCantonX402Adapter,
  makeCantonX402Reader,
} from "@integraledger/lcp-binding-canton-x402";

declare const atrHash: string;
declare const updateId: string;

const adapter = createCantonX402Adapter(CANTON_X402_MANIFEST);

// SELLER, at proposal time — merge into the x402 PaymentRequirements you already emit.
const extra = adapter.propose(atrHash); // { memo: "0x…" }

// VERIFIER, after settlement — one update carries the weld and the asset it is attached to.
const reader = makeCantonX402Reader({
  jsonLedgerUrl: "https://participant.example",
  bearerJwt: process.env["CANTON_READER_JWT"] ?? "",
});
const settled = await adapter.observe({ updateId }, reader);
// { ok: true, value: { state: "settled", atrHash, receiver, amount, instrumentId } }
```

## Which Canton binding do I want?

There are two, because Canton has two carriers and a manifest can honestly describe one.

**This one, when you settle through x402.** The scheme covers **Canton Coin only** — `asset: "CC"`,
instrument fixed to `Amulet`, via `transfer-factory`, relayed by a facilitator. Within that, it wins on
every axis:

| | `LcpAnchor` overlay | `extra.memo` (this package) |
|---|---|---|
| Same transaction as the payment | no — a separate contract create | **yes** |
| Weld enforced by | nobody | **the facilitator, before relaying** |
| `assetBinding` | `none` — recovery never saw what settled | **`carried`** — receiver, amount, instrument |
| Needs a Daml package deployed | yes | **no** |

**[`@integraledger/lcp-binding-canton`](../binding-canton#readme) for everything else** — any instrument,
any synchronizer, DvP and fund and bond workflows, deployments with no facilitator and no x402 at all.
There is no native field to ride there, so an overlay contract genuinely is the only carrier, and that
package now ships the `lcp-anchor` Daml template so it can be deployed.

An earlier release said Canton *"cannot"* be bound with a native field, because "Daml has no native
arbitrary-bytes carrier on a transaction". That was false, and this package is the correction — but the
overlay is an overlay by **choice**, not obsolete.

## What it still costs, stated plainly

**Not zero-party recoverable, and the carrier move did not change that.** Canton is a privacy ledger: a
transfer and its metadata are visible only to the transaction's stakeholders, so a reader needs a JWT
authenticating one of them. §8.3 asks whether an auditor can reconstruct the atrHash from the settlement
reference **alone, without trusting either party to produce records** — on Canton they cannot, whichever
carrier is used. No private key is needed; a party's cooperation is.

**Not forward-indexable.** A participant's update stream is one participant's view, not a chain-global
index, and the memo is a metadata value rather than an indexed key. `enumerate` scans one party's visible
transfers and says so.

**Scoped to x402.** The manifest declares `protocol: "x402"` because the field, its 256-byte ceiling and
its enforcement are all x402's. A Canton Coin payment settled outside x402 does not get this carrier — and
an absent `protocol` would have been a positive claim of protocol-neutrality this binding cannot make.

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
