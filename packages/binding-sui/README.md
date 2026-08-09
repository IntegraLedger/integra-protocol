# @integraledger/lcp-binding-sui

Welds an ATR hash into a Sui settlement through the Pay402 facilitator.

```bash
npm install @integraledger/lcp-binding-sui
```

| | |
|---|---|
| **Chain** | Sui |
| **Pattern** | `native-field` |
| **Carrier** | the Pay402 `payment_id` argument |
| **Surface** | `createSuiAdapter` returning a rail-native adapter over a `SuiReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |

Installing this package installs **`@mysten/sui`** — it is a direct dependency. `makeSuiReader` takes a
STRUCTURAL port rather than the SDK class, so a gRPC or GraphQL client you write satisfies it too.

```ts
import {
  createSuiAdapter,
  getSuiConfig,
  makeSuiReader,
  pay402SettleTarget,
  SUI_MANIFEST,
  type SuiRpcLike,
} from "@integraledger/lcp-binding-sui";

declare const atrHash: string;
declare const packageId: string;
declare const buyer: string;
declare const buyerCoin: string;
declare const merchant: string;
declare const client: SuiRpcLike;
declare const digest: string;
/** a @mysten/sui `Transaction` you are already building */
declare const tx: Parameters<ReturnType<typeof createSuiAdapter>["propose"]>[0];

const adapter = createSuiAdapter(SUI_MANIFEST);

// PAYER — `propose` MUTATES the transaction, appending the Pay402 settle call.
adapter.propose(tx, {
  atrHash,
  packageId,
  coinType: getSuiConfig("testnet").usdcCoinType,
  buyerCoin,
  buyer,
  merchant,
  amount: 1_000_000n,
  facilitatorFee: 0n,
});

// VERIFIER — the full 32 bytes back out of the `PaymentSettled` event.
const recovered = await adapter.recover({ digest, packageId }, makeSuiReader(client));
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.

pay402SettleTarget(packageId); // "<packageId>::payment::settle_payment"
```

## The carrier

The ATR hash rides the **full 32 raw bytes** of Pay402's
`settle_payment<T>(.., payment_id: vector<u8>, ..)` argument — no truncation, no derivation.

```ts
import {
  decodeAtrPaymentId,
  encodeAtrPaymentId,
} from "@integraledger/lcp-binding-sui";

declare const atrHash: string;

const paymentId = encodeAtrPaymentId(atrHash); // Uint8Array(32) — all of it, no truncation
decodeAtrPaymentId(paymentId); // "0x…" | null
```

Recovery reads the `PaymentSettled` event. Sui's JSON-RPC methods are deprecated in favour of gRPC and
GraphQL, so the reader is written against a narrow surface that is straightforward to repoint.

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
