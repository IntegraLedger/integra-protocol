# @integraledger/lcp-binding-solana

Welds an ATR hash into a Solana SPL token settlement.

```bash
npm install @integraledger/lcp-binding-solana
```

| | |
|---|---|
| **Chain** | Solana |
| **Pattern** | `native-field` |
| **Carrier** | SPL Memo instruction data |
| **Surface** | `createSolanaAdapter` returning a rail-native adapter over a `SolanaReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |

Installing this package installs **`@solana/web3.js`** — it is a direct dependency, and `makeSolanaReader`
is the one place its types reach this API. You construct the `Connection`; nothing here submits anything.

```ts
import {
  createSolanaAdapter,
  makeSolanaReader,
  SOLANA_MANIFEST,
} from "@integraledger/lcp-binding-solana";

declare const atrHash: string;
declare const signature: string;
/** a @solana/web3.js `Connection` — `new Connection(getSolanaConfig("devnet").rpcUrl)` */
declare const connection: Parameters<typeof makeSolanaReader>[0];

const adapter = createSolanaAdapter(SOLANA_MANIFEST);

// PAYER — a Memo instruction to add to the SAME transaction as the SPL transfer.
const memoIx = adapter.propose(atrHash);

// VERIFIER — the atrHash back out of a confirmed, successful settlement.
const reader = makeSolanaReader(connection);
const recovered = await adapter.recover({ signature }, reader);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

## The carrier

The ATR hash rides the SPL Memo program's instruction data — an existing Solana primitive for arbitrary
bytes. No Anchor program, no overlay contract.

```ts
import { decodeSplMemo, encodeSplMemo } from "@integraledger/lcp-binding-solana";

declare const atrHash: string;

const memoData = encodeSplMemo(atrHash); // "hex" is canonical; "raw" is the 32 bytes
decodeSplMemo(memoData); // "0x…" | null — encoding defaults to "hex"; pass "raw" for the 32 bytes
```

Because the memo instruction and the transfer instruction are in the same transaction, the payer's
signature covers both atomically: the settlement cannot be replayed with a different memo attached.

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
