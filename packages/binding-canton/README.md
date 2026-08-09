# @integraledger/lcp-binding-canton

Welds an ATR hash into a Canton settlement.

```bash
npm install @integraledger/lcp-binding-canton
```

| | |
|---|---|
| **Chain** | Canton |
| **Pattern** | `overlay-contract` |
| **Carrier** | the `LcpAnchor` Daml contract |
| **Surface** | `createCantonAdapter` returning a rail-native adapter over a `CantonParticipantReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |


Pure TypeScript — the participant is reached over the Daml JSON Ledger API with `fetch` and **no Daml
SDK**. You do need the DAR deployed; the template ships in this tarball (below).

```ts
import {
  CANTON_MANIFEST,
  createCantonAdapter,
  makeCantonParticipantReader,
} from "@integraledger/lcp-binding-canton";

declare const atrHash: string;
declare const buyer: string;
declare const seller: string;
declare const packageId: string; // the hash of YOUR uploaded lcp-anchor DAR
declare const contractId: string;

const adapter = createCantonAdapter(CANTON_MANIFEST);

// BUYER — the create-LcpAnchor command to submit (buyer signatory, seller observer).
const command = adapter.propose({ packageId, buyer, seller, atrHash });

// VERIFIER — the atrHash back off an active anchor contract.
const reader = makeCantonParticipantReader({
  jsonLedgerUrl: "https://participant.example",
  lcpAnchorPackageId: packageId,
  bearerJwt: process.env["CANTON_READER_JWT"] ?? "",
});
const recovered = await adapter.recover({ contractId }, reader);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

## The carrier — an overlay by choice, and when to choose it

An earlier release said Canton **cannot** be bound with a native field, because "Daml has no native
arbitrary-bytes carrier on a transaction: no memo, no metadata label, no nonce". That is false. x402's
`exact` scheme for Canton defines `PaymentRequirements.extra.memo`, which the payer must echo into the
transfer's metadata and the facilitator rejects on mismatch.

**Where that scheme applies, use the memo, not this.** It is the stronger carrier on every axis: same
transaction as the payment, facilitator-enforced, and asset-bound. It is
[`@integraledger/lcp-binding-canton-x402`](../binding-canton-x402#readme).

**This package is for everything that scheme does not reach.** x402's exact-Canton scheme settles *Canton
Coin only* — instrument fixed to `Amulet`, via `transfer-factory`, relayed by a facilitator. Enterprise
Canton is the rest: any instrument, any synchronizer, DvP and fund and bond workflows, deployments with no
facilitator and no x402 at all. There, an overlay contract genuinely is the only surface, and this rail
exists so those deployments are not asked to become Canton Coin payments in order to record a legal
context.

One chain, two carriers, two bindings — the same shape EVM already has with `evm:x402`, `evm:escrow` and
`evm:mpp`, because a manifest can honestly describe exactly one carrier.

## The template ships with this package

`daml/Main.daml` and `daml/daml.yaml` are in the tarball. Build and upload them:

```bash
daml build                       # -> .daml/dist/lcp-anchor-0.9.0.dar
daml ledger upload-dar --host <participant> .daml/dist/lcp-anchor-0.9.0.dar
```

The package id is the **hash of the compiled DAR**, so you pass it per call
(`lcpAnchorTemplateId(packageId)`). That is why the source ships rather than a prebuilt `.dar`: an artifact
in the tarball would pin one SDK version and still leave you reading the package id off your own upload.

Because the hash is over the compiled package, it is **deterministic for a given source and SDK version** —
so it doubles as an integrity check. Built with **SDK 2.10.4**, this source produces:

```
4411f3acd4d47249c86455c1edbcb94a992e2d01b2df16c088177b17943dbe11
```

If your `daml build` yields that id, you are running this template and not a modified one. A different id
means either a different SDK version or a changed source — both worth knowing before you upload.

`test/daml-template.test.ts` gates the template's field names, its stakeholders and its `ensure` against
the TypeScript codec, so the two cannot drift apart silently.

```ts
import {
  atrHashToLedgerText,
  buildAnchorPayload,
} from "@integraledger/lcp-binding-canton";

declare const atrHash: string;
declare const buyer: string;
declare const seller: string;

atrHashToLedgerText(atrHash); // the bare lowercase 64-hex the `Text` field carries — no `0x`
const payload = buildAnchorPayload({ buyer, seller, atrHash });
```

## What that costs, stated plainly

Because the anchor is a separate contract rather than a field the payer signs over, the binding is
**anchor-grade** rather than transaction-grade: the seller anchors, and the anchor is evidence of the
record rather than part of the payment's own authenticated payload. The lifecycle reflects this
honestly — `proposed` then `anchored`, not a settlement state set.

This is the kind of difference the per-chain binding table exists to record. A verifier should know which
grade of weld it is looking at, and this package does not present one as the other.

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
