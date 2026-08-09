# @integraledger/lcp-binding-stellar

Welds an ATR hash into a Stellar payment.

```bash
npm install @integraledger/lcp-binding-stellar
```

| | |
|---|---|
| **Chain** | Stellar |
| **Pattern** | `native-field` |
| **Carrier** | the CAP-67 muxed-address `mux_id` |
| **Surface** | `createStellarAdapter` returning a rail-native adapter over a `StellarReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |

Installing this package installs **`@stellar/stellar-sdk`** — it is a direct dependency, used for XDR
envelope decoding. You supply the `StellarReader`; nothing here opens a connection.

```ts
import {
  createStellarAdapter,
  STELLAR_MANIFEST,
  type StellarReader,
} from "@integraledger/lcp-binding-stellar";

declare const atrHash: string;
declare const baseGPubkey: string;
declare const reader: StellarReader; // your Horizon client
declare const txHash: string;

const adapter = createStellarAdapter(STELLAR_MANIFEST);

// SELLER — the muxed M-address to advertise as `payTo`. It welds atrHash[:8].
const payTo = adapter.propose(atrHash, baseGPubkey);

// VERIFIER — `verify`, not `recover`. You bring the atrHash; the chain confirms its first 8 bytes.
const confirmed = await adapter.verify(atrHash, { txHash }, reader);
if (!("refused" in confirmed)) console.log(confirmed.value.muxIdPrefix8Hex);
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

## The carrier

The binding rides `mux_id` inside a [CAP-67](https://stellar.org/protocol/cap-67) muxed M-address — an
existing Stellar account primitive, not an overlay contract. The muxed destination commits atomically with
the transfer.

```ts
import {
  recoverMuxIdPrefix8,
  verifyMuxedBinding,
} from "@integraledger/lcp-binding-stellar";

declare const atrHash: string;
declare const muxedM: string;

recoverMuxIdPrefix8(muxedM); // Uint8Array(8) | null — eight bytes, never a 64-hex lookalike
verifyMuxedBinding({ muxedM, atrHash }); // true iff the on-chain prefix matches the hash you hold
```

## Eight bytes, and the honesty that requires

`mux_id` is 64 bits, so it carries the **first 8 bytes** of the ATR hash, not the whole thing. The API
reflects that exactly:

- `recoverMuxIdPrefix8` returns raw 8 bytes — never a 64-hex value that would read as a full hash.
- `verifyMuxedBinding` **confirms** rather than recovers: an observer who already holds the ATR hash can
  check that the on-chain destination binds to it.

Eight bytes is enough to confirm a hash you have and not enough to reconstruct one you do not, and the
surface is shaped so a caller cannot mistake the second for the first.

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
