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

## Reading over GraphQL

Recovery reads the `PaymentSettled` event, and **Sui's public fullnode JSON-RPC no longer serves one.**
Measured 2026-09-10 on both networks, `https://fullnode.{testnet,mainnet}.sui.io` answers every method with
`-32601 "JSON-RPC on public fullnodes has been deprecated. Please migrate to gRPC or GraphQL endpoints."`
`getSuiConfig(network).rpcUrl` still names that endpoint because a provider endpoint is addressed the same
way and a settlement is still submitted over one — but nothing may fall back to it.

`makeSuiGraphqlRpc` binds Sui's GraphQL endpoint to the same narrow `SuiRpcLike` port `makeSuiReader`
takes, so switching transports changes one line and leaves `recover`, `observe` and `enumerate` untouched.

```ts
import {
  createSuiAdapter,
  getSuiConfig,
  makeSuiGraphqlRpc,
  makeSuiReader,
  SUI_MANIFEST,
} from "@integraledger/lcp-binding-sui";

declare const packageId: string;
declare const digest: string;

const reader = makeSuiReader(makeSuiGraphqlRpc(getSuiConfig("testnet").graphqlUrl));
const settled = await createSuiAdapter(SUI_MANIFEST).recover({ digest, packageId }, reader);
if (!("refused" in settled)) console.log(settled.value); // "0x…"
```

GraphQL renders a Move `vector<u8>` as a **base64 string** where JSON-RPC renders a JSON array of byte
values, so a hand-rolled wrapper that passes `contents.json` through unchanged leaves every `payment_id`
unreadable — and an unreadable `payment_id` is a refusal, not an error, so a real weld reads as
never-anchored. `makeSuiGraphqlRpc` decodes it at that boundary; write your own wrapper and you own that
conversion, along with the three things that make it correct rather than merely present:

- **Which fields are bytes is asked, not guessed.** The wrapper selects `contents.type.layout` and decodes
  exactly the fields the endpoint's own layout calls `vector<u8>` — `payment_id` and `coin_type` on
  `PaymentSettled`. Matching on the field NAME instead breaks on a Sui PTB, which the **buyer** composes:
  a co-located event from another package carrying a Move `String` named `payment_id` is not base64, and
  decoding it throws recovery away for a settlement that is on chain and signed.
- **Both event connections are paged.** `TransactionEffects.events` and `Query.events` each cap at 50 per
  page and default to 20, and Sui allows 1024 events in one transaction — so an unpaged read answers with
  the oldest 20 and drops the rest without an error. `SUI_GRAPHQL_DEFAULT_EVENT_PAGE` is the page this
  wrapper asks for and the scan depth it uses when `enumerate` is given no `limit`; a larger `limit` is
  walked a page at a time rather than refused by the endpoint.
- **Requests carry a deadline.** `fetch` has none of its own, so an endpoint that accepts a connection and
  never answers would hang `recover` for good. `SUI_GRAPHQL_TIMEOUT_MS` sits above the endpoint's own
  40-second query timeout, so it never pre-empts a query that is still running.

Everything the queries select is REQUIRED: an absent `status`, `events` connection, `contents`,
`contents.json`, type `repr`, `layout` or emitting `transaction` is a throw, never an empty read. A
refusal from this rail means the chain says no — it never means the transport could not read the answer.

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
