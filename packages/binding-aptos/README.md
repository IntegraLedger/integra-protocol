# @integraledger/lcp-binding-aptos

Welds an ATR hash into an Aptos settlement.

```bash
npm install @integraledger/lcp-binding-aptos
```

| | |
|---|---|
| **Chain** | Aptos |
| **Pattern** | `overlay-contract` |
| **Carrier** | a Move entry-call argument |
| **Surface** | `createAptosAdapter` returning a rail-native adapter over a `AptosReader` port — **not** [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter`, whose shape is EVM's |

Installing this package installs **`@aptos-labs/ts-sdk`** — it is a direct dependency, and `makeAptosReader`
is the one place its types reach this API.

```ts
import {
  APTOS_MANIFEST,
  createAptosAdapter,
  makeAptosReader,
} from "@integraledger/lcp-binding-aptos";

declare const atrHash: string;
declare const recipient: string;
declare const hash: string;
/** an @aptos-labs/ts-sdk `Aptos` — `new Aptos(new AptosConfig({ network: Network.TESTNET }))` */
declare const aptos: Parameters<typeof makeAptosReader>[0];

const adapter = createAptosAdapter(APTOS_MANIFEST, "testnet");

// PAYER — the Move entry call to sign. `payment_id` carries the atrHash.
const call = adapter.propose({ atrHash, recipient, amount: 1_000_000n });

// VERIFIER — the atrHash back out of a settled transaction's `PaymentSettled` event.
const reader = makeAptosReader(aptos);
const recovered = await adapter.recover({ hash }, reader);
if (!("refused" in recovered)) console.log(recovered.value); // "0x…"
// Narrow with `"refused" in x` — `Refusal` has no `ok`, so the union cannot discriminate on one.
```

`getAptosConfig("mainnet")` **throws**: the `lcp_payment` module is unpublished there, and a `0x0` module
address would send a settlement to a call target that does not exist.

## The carrier — and why this one is an overlay

The ATR hash rides the `payment_id: vector<u8>` argument of a Move entry call. That call targets a
**bespoke, deployed** `lcp_payment` module rather than a stock Aptos primitive, which is precisely what
makes this an **overlay-contract** binding rather than a native-field one.

The distinction is not bookkeeping. Aptos's stock USDC and APT coins carry no arbitrary-bytes field, so a
settlement can only bind an ATR hash through a module someone deployed — and a binding that depends on a
deployed contract inherits that contract's trust assumptions, where a native-field binding inherits only
the chain's.

```ts
import {
  decodePaymentIdBytes,
  encodePaymentId,
  encodePaymentIdArg,
} from "@integraledger/lcp-binding-aptos";

declare const atrHash: string;

const paymentId = encodePaymentId(atrHash); // Uint8Array(32) — throws on a malformed atrHash
encodePaymentIdArg(atrHash); // number[] — the shape the SDK's `functionArguments` wants
decodePaymentIdBytes(paymentId); // "0x…" | null
```

The module address is per-deployment, so it is configuration rather than a constant.

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
