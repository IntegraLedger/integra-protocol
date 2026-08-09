# @integraledger/lcp-binding-cardano

Welds an ATR hash into a Cardano transaction.

```bash
npm install @integraledger/lcp-binding-cardano
```

| | |
|---|---|
| **Chain** | Cardano |
| **Pattern** | `native-field` |
| **Carrier** | a transaction metadata label |
| **Surface** | `createCardanoAdapter` returning a rail-native adapter over a `CardanoReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |

Pure TypeScript — **no chain SDK**. Recovery takes Blockfrost-shaped metadata as a port, so Blockfrost,
db-sync or Koios all satisfy it, and this package holds no credential and performs no HTTP.

```ts
import {
  CARDANO_MANIFEST,
  createCardanoAdapter,
  LCP_METADATA_LABEL,
  type CardanoReader,
} from "@integraledger/lcp-binding-cardano";

declare const atrHash: string;
declare const reader: CardanoReader; // your Blockfrost-shaped indexer client
declare const txHash: string;

const adapter = createCardanoAdapter(CARDANO_MANIFEST);

// PAYER — the metadatum to attach under label 8847 (JSON value + canonical CBOR).
const metadatum = adapter.propose(atrHash);
console.log(LCP_METADATA_LABEL); // 8847

// VERIFIER — the atrHash back out of a confirmed transaction.
const recovered = await adapter.recover({ txHash }, reader);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

`enumerate` here is a NATIVE forward index, not a scan — an indexer queries label 8847 directly
(`metadata-label-index:8847`), which is why the label is dedicated rather than a CIP-20 piggyback. Three of
the thirteen rails can say that; the other two are `evm:x402` and `tempo:mpp`, both indexing on a log topic.

## The carrier

The ATR hash rides Cardano's transaction-metadata facility under a dedicated LCP label — an existing
primitive for arbitrary auxiliary data, not an overlay contract. The buyer signs the transaction body,
which commits to the metadata hash, so the binding is covered by the payer's own signature.

```ts
import {
  type BlockfrostMetadataEntry,
  LCP_METADATA_LABEL,
  recoverAtrHashFromTx,
} from "@integraledger/lcp-binding-cardano";

declare const metadata: readonly BlockfrostMetadataEntry[];

console.log(LCP_METADATA_LABEL); // 8847
recoverAtrHashFromTx(metadata); // "0x…" | null — null is "no LCP label here", not an error
```

The metadatum is a text-keyed map `{ v, atrHash }` carrying the spec version alongside the hash, encoded
as canonical CBOR per [RFC 8949 §4.2.1](https://www.rfc-editor.org/rfc/rfc8949#section-4.2.1) so the bytes
are reproducible.

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
