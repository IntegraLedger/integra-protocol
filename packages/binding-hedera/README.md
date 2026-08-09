# @integraledger/lcp-binding-hedera

Welds an ATR hash into a Hedera Token Service transfer.

```bash
npm install @integraledger/lcp-binding-hedera
```

| | |
|---|---|
| **Chain** | Hedera |
| **Pattern** | `native-field` |
| **Carrier** | the HTS transaction memo |
| **Surface** | `createHederaAdapter` returning a rail-native adapter over a `HederaReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |

Pure TypeScript — **no chain SDK**. Recovery is a Mirror Node read through a port you supply, so a
settlement is not visible the instant it reaches consensus.

```ts
import {
  createHederaAdapter,
  HEDERA_MANIFEST,
  type HederaReader,
} from "@integraledger/lcp-binding-hedera";

declare const atrHash: string;
declare const reader: HederaReader; // your Mirror Node REST client
declare const transactionId: string;

const adapter = createHederaAdapter(HEDERA_MANIFEST);

// PAYER — the string to set as the HTS transfer's `transactionMemo`.
const memo = adapter.propose(atrHash);

// VERIFIER — the atrHash back out of a transaction that reached consensus.
const recovered = await adapter.recover({ transactionId }, reader);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

## The carrier

The ATR hash rides `TransferTransaction.transactionMemo` — an existing Hedera primitive for an arbitrary
transaction annotation. No overlay contract.

```ts
import {
  encodeMemoAtrHash,
  verifyMemoAtrHash,
} from "@integraledger/lcp-binding-hedera";

declare const atrHash: string;

const memo = encodeMemoAtrHash(atrHash); // the `transactionMemo` string
verifyMemoAtrHash({ memo, atrHash }); // true
```

The memo field is byte-capped by the network, so the encoder checks the encoded length against that limit
and fails loudly rather than emitting a memo the network will truncate — a truncated ATR hash is not a
shorter fingerprint, it is a wrong one.

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
