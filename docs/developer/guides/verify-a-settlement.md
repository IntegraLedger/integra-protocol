# Verify a settlement

## What you will have at the end

A settled transaction on some rail, a terms document, and a defensible answer to one question: **did this
settlement carry a reference to this record?** Around that answer, the full verification report — every
other rung the walk could reach and every one it could not. About forty minutes.

The answer is deterministic. It is *recover, recompute, compare*, and it consults no oracle and trusts no
signature of ours; [concepts/welds.md](../concepts/welds.md) is why, and this page is the procedure. Read
[getting-started.md](../getting-started.md) first if you have not assembled a record before — this guide
starts where that one ends, with the difference that `settledAtrHash` now comes off a chain instead of out
of your own `assemble` call.

You need Node 24 or newer. Everything in this repository is ESM-only.

## What you have to have in hand

Three things, and the second is the one people arrive without.

1. **A settlement reference**, in whatever shape the rail uses. `{ chainId, txHash }` on an EVM chain, a
   base58 signature on Solana, a Horizon transaction hash on Stellar. Each binding names its own.
2. **The ATR bytes** — the exact bytes that were hashed, not a re-assembly from remembered components.
   `hashAtr` hashes what it is handed and does not re-canonicalize, so a document rebuilt from the same
   slots in a different order is a different record with a different hash. See
   [concepts/atr.md](../concepts/atr.md).
3. **The rail's binding package and a reader for that rail.** `verify` opens no sockets and fetches
   nothing; gathering the inputs over live ports is yours, which is exactly what leaves the walk
   deterministic.

## Step 1 — Recover the hash the settlement carried

This is the one step a rail binding contributes, and it is the only step that touches a chain. Everything
after it is arithmetic.

Both fences below replay a recorded settlement rather than dialling an RPC endpoint, so the page runs
offline and the numbers are reproducible. Swap the fixed reader for a live one and nothing else changes:
that substitution is the whole point of the port.

### On an EVM rail — the EIP-3009 nonce

`binding-evm-x402` binds the ATR hash into the nonce the payer already signs, so recovery is reading one
`AuthorizationUsed` event back out of the settlement's own receipt. The adapter is scoped to **one chain
and one token** at construction, and that is not a convenience: any address can deploy a token that emits
the same event, so an unscoped read would accept a log nobody paid for.

```ts no-check
import type { SettlementRef, VerifierPorts } from "@integraledger/lcp-binding-core";
import { createX402Adapter } from "@integraledger/lcp-binding-evm-x402";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const settlement: SettlementRef = {
  chainId: 84532,
  txHash: "0xf1a4d0e2c3b5978664fa2b1c0d9e8f7a6b5c4d3e2f10112233445566778899aa",
};

// One settlement's receipt logs, exactly as `eth_getTransactionReceipt` returned them. Topic 0 is
// keccak256("AuthorizationUsed(address,bytes32)"), topic 1 the indexed authorizer, and topic 2 the
// indexed nonce — the carrier field.
const receiptLogs = [
  {
    address: USDC,
    topics: [
      "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5",
      "0x0000000000000000000000002222222222222222222222222222222222222222",
      "0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356",
    ],
    data: "0x",
    transactionHash: settlement.txHash,
    logIndex: 0,
  },
];

// In production this is `makeChainReader` from `@integraledger/lcp-binding-evm-common` over your own viem
// client. `recover` needs exactly one of its four members.
const ports: VerifierPorts = {
  chain: {
    getLogs: async () => [],
    getTransactionLogs: async () => receiptLogs,
    readContract: async () => {
      throw new Error("recovery reads logs, never contract state");
    },
    blockTime: async () => 1754179200n,
  },
  artifacts: { resolve: async () => null },
};

const adapter = createX402Adapter({
  chainId: 84532,
  asset: USDC,
  tokenName: "USDC",
  tokenVersion: "2",
});

const recovered = await adapter.recover(settlement, ports);
if ("refused" in recovered)
  throw new Error(`${recovered.code}: ${recovered.detail}`);
console.log(recovered.value);
```

```text
0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356
```

A settlement carrying several `AuthorizationUsed` events is disambiguated by putting a `logIndex` on the
ref. A pinned index that matches no event is a refusal, never a quiet fall back to the first event — that
fallback would recover a *different* settlement's hash and present it as this one's.

### On Solana — the SPL Memo instruction

`binding-solana` reads the memo instruction that rode in the same transaction as the `transferChecked`.
Note what the adapter is *not*: it does not implement `binding-core`'s `WeldAdapter`, because that port is
EVM-shaped. It exposes a Solana-native surface — a signature ref and a `SolanaReader` — beside the same
chain-agnostic `BindingManifest`. [implement-a-binding.md](implement-a-binding.md) explains why that is
the honest arrangement rather than a gap.

```ts
import {
  createSolanaAdapter,
  MEMO_PROGRAM_ID,
  SOLANA_MANIFEST,
  type SolanaReader,
} from "@integraledger/lcp-binding-solana";

const atrHash =
  "0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356";

// One confirmed transaction as `getParsedTransaction` returned it. `err: null` is the ONLY success.
const reader: SolanaReader = {
  txView: async () => ({
    memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: atrHash }],
    err: null,
  }),
  signaturesFor: async () => [],
};

const adapter = createSolanaAdapter(SOLANA_MANIFEST);
const ref = {
  signature:
    "5Nq8bF3sYy1Wp7vJc2kR4dQ9tH6aG8mZxL3nB5uC1eD7fS2rT4wV6yX8zA9bC1dE",
};

const recovered = await adapter.recover(ref, reader);
if ("refused" in recovered)
  throw new Error(`${recovered.code}: ${recovered.detail}`);
console.log(recovered.value);

// A transaction that RAN AND FAILED still carries its memo and still charged its fee. Recovery is
// fail-closed on anything but `err: null`, because a memo on a movement that never happened is not a weld.
const failedTx: SolanaReader = {
  txView: async () => ({
    memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: atrHash }],
    err: { InstructionError: [1, "Custom"] },
  }),
  signaturesFor: async () => [],
};
console.log(JSON.stringify(await adapter.recover(ref, failedTx)));
```

```text
0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356
{"refused":true,"haltClass":"verification-failure","code":"solana/no-atr-memo","detail":"no successful transaction carrying an atrHash memo for 5Nq8bF3sYy1Wp7vJc2kR4dQ9tH6aG8mZxL3nB5uC1eD7fS2rT4wV6yX8zA9bC1dE"}
```

That second refusal is a manifest promise being kept. Solana declares `successGate: "raw-field"`, which
means the rail records failed transactions along with their weld payload and recovery therefore reads the
chain's own outcome field. Six of the thirteen rails declare it; the other seven declare `structural`, meaning
a failed transaction on that rail cannot carry a weld at all — a reverted EVM transaction emits no logs, so
the EIP-3009 fence above needs no such check and does not have one.

## Step 2 — Recompute over the ATR bytes, and compare

Two 32-byte values, compared case-insensitively. That is the entire correspondence.

```ts
import { assemble, atrHashEquals, hashAtr } from "@integraledger/lcp-kernel";

// What Step 1 returned — off the EIP-3009 nonce on EVM, out of the memo on Solana.
const recovered =
  "0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356";

// The ATR bytes you were handed. In a real check you READ these from wherever the record was retained
// and pass them straight to `hashAtr`; the assembly here only makes the fence self-contained.
const { atrFile } = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" },
  {
    slot: "parties",
    value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" },
  },
]);

const recomputed = await hashAtr(atrFile);
console.log(recomputed);
console.log(atrHashEquals(recovered, recomputed));

// A record differing in ONE slot recomputes to a different hash, and the comparison simply fails.
const other = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0x00000000000000000000000000000001" },
  {
    slot: "parties",
    value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" },
  },
]);
console.log(atrHashEquals(recovered, other.atrHash));
```

```text
0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356
true
false
```

What that `true` establishes is narrow and worth stating precisely: **this settlement carried a reference
to this record.** It does not establish that the price was right, that the goods arrived, or that the
counterparty is solvent. The comparison is a correspondence, not a judgement.

## Step 3 — Run the walk

The comparison above is one rung. `verify` runs it as the `atr-fingerprint` step and reports it beside
everything else the record does or does not carry. The input that matters here is `settledAtrHash`: it is
the value **recovered from the chain**, never one you computed. Handing the walk your own recomputation on
both sides would make `atr-fingerprint` compare a number to itself.

```ts
import { assemble } from "@integraledger/lcp-kernel";
import { verify } from "@integraledger/lcp-verify";

const { atrFile } = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" },
  {
    slot: "parties",
    value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" },
  },
]);

const report = await verify({
  asOf: "2026-08-03T00:00:00Z",
  coverage: { ports: ["evm"], bindings: ["evm:x402"] },
  atrBytes: atrFile,
  settledAtrHash:
    "0xc7004db2c5ab2231c497513e50c4a75da051f8d67172366e39e1c24944aed356",
  settlements: [
    {
      txHash:
        "0xf1a4d0e2c3b5978664fa2b1c0d9e8f7a6b5c4d3e2f10112233445566778899aa",
    },
  ],
});

console.log(
  `verified: ${report.verified} | supportedClass: ${report.supportedClass}`,
);
for (const step of report.steps) {
  const why =
    step.outcome.status === "not-attempted"
      ? ` ${step.outcome.depth}`
      : step.outcome.status === "failed"
        ? ` ${step.outcome.haltClass}`
        : "";
  console.log(`   ${step.name.padEnd(24)} ${step.outcome.status}${why}`);
}
```

```text
verified: false | supportedClass: TC-2
   atr-fingerprint          proved
   settlement-enumeration   proved
   buyer-acceptance         not-attempted no-acceptance
   authority-attenuation    not-attempted no-authority-chain
   commitment-vs-leaf       not-attempted no-commitment
   recourse-elections       not-attempted no-elections-recorded
   resolve-party            not-attempted no-identity
```

`verified: false` is the correct answer at the default `depth: "structural"`, where the walk is a
presence-and-absence readout and cannot raise a verdict at all. Five steps read `not-attempted` with the
reason each could not run — **an absent input never becomes a pass.** All of that is
[concepts/verification-walk.md](../concepts/verification-walk.md); what this guide adds is the one input
the walk cannot obtain for itself.

## Step 4 — Read the failure modes as what they are

Three things go wrong, they mean three different things, and conflating them is how a verifier ends up
reporting a gap as a forgery.

### The hash is absent — the binding refuses

The settlement carried no reference this binding can read: a plain `transfer` where an EIP-3009
authorization was expected, a Solana transaction with no memo instruction, a transaction that executed and
failed. The binding returns a `Refusal` — a **value**, carrying a namespaced code and a halt class, never
a thrown exception:

```text
{
  "refused": true,
  "haltClass": "verification-failure",
  "code": "x402/no-settlement-event",
  "detail": "no AuthorizationUsed for asset 0x036CbD53842c5426634e7929541eC2318f3dCF7e in this settlement"
}
```

This says the *settlement* carries no weld. It says nothing about the record, which may be perfectly
sound and simply never welded to this transaction. Do not feed a refusal into `settledAtrHash` as an empty
string: leave the input absent and let `atr-fingerprint` report `not-attempted("no-settled-hash")`, which
is the true statement.

### The hash does not match — the record is impeached

Recovery succeeded and the value disagrees with the recomputation. That is a **contradiction**, not a gap,
and it is the one thing this whole procedure exists to detect. `atr-fingerprint` fails, and a single failed
step drops `supportedClass` to `TC-0`:

```text
verified: false | supportedClass: TC-0
{"name":"atr-fingerprint","outcome":{"status":"failed","haltClass":"verification-failure"}}
```

The likeliest cause is prosaic — you are holding a *different version* of the terms, or a re-assembly
rather than the retained bytes. Check that before concluding anything about the counterparty: byte
equality is unforgiving by design, and it does not distinguish a forgery from a stale copy.

### The authority chain does not hold — the record contradicts itself

Independent of the weld. The chain of delegated grants behind the acceptance either attenuates or it does
not, and a link that widens its parent's bounds is a forgery whether or not every signature on it
verifies. Supplying `authorityChain` to the same walk:

```text
verified: false | supportedClass: TC-0
   atr-fingerprint          proved
   settlement-enumeration   proved
   buyer-acceptance         not-attempted no-acceptance
   authority-attenuation    failed verification-failure
   commitment-vs-leaf       not-attempted no-commitment
   recourse-elections       not-attempted no-elections-recorded
   resolve-party            not-attempted no-identity
```

`atr-fingerprint` still says `proved` — the settlement did carry this record — and the record is still
impeached to `TC-0`, because a walk reports each rung on its own evidence and lets the class fall out.
Prefer `authorityWalk` over `authorityChain` in real use: a flattened chain hides what the custody walk
found, and [concepts/authority.md](../concepts/authority.md) says why that matters.

## Not every rail hands back a hash

`recover` is not uniform across the thirteen rails, and a verifier that assumes it is will misread two of
them. The manifest declares the difference rather than leaving it to be discovered — see the recovery
table in [concepts/welds.md](../concepts/welds.md).

| Rail | What `recover` gives you |
|---|---|
| `evm:x402`, `evm:escrow` | the 32-byte hash, through `binding-core`'s `WeldAdapter` port |
| `tempo:mpp`, `solana`, `cardano`, `xrpl`, `hedera`, `sui`, `aptos`, `canton`, `canton:x402` | the 32-byte hash, through a rail-native surface with the same verbs |
| `evm:mpp` | **nothing, ever.** `recover()` takes no arguments and always refuses |
| `stellar` | **8 bytes**, explicitly marked partial — `atrHash[:8]`, not a hash |

Both exceptions are properties of the rail, not omissions.

`evm:mpp` is an Id-Reuse binding: the on-chain nonce is a keccak-256 derivation over the ATR hash and the
protection space, and keccak has no inverse. Its refusal says so —
`mpp-evm/not-recoverable-by-construction`. The verify surface there is `verifyCandidate`, which takes the
candidate hash, the settlement ref and the ports: **you** bring the hash, the chain confirms it. That is a
confirmation rather than a lookup, and the difference is exactly `zeroPartyRecoverable: false` in the
manifest.

`stellar` carries only the first eight bytes of the hash in a CAP-67 muxed-address `mux_id`, so the full
hash never touches the chain. `recover` returns `{ muxIdPrefix8Hex, partial: true, note }` rather than
something that reads like a hash, and `verify(atrHash, ref, reader)` is the primary surface for the same
reason as MPP: enough to confirm a hash you already hold, never enough to reconstruct one you do not.

On both rails the shape of Step 2 changes and Steps 3 and 4 do not. You obtain the ATR hash off-chain,
confirm it against the settlement, and hand the confirmed value to the walk as `settledAtrHash`.

## Where next

- [concepts/welds.md](../concepts/welds.md) — the carrier field on every rail, weld grades, and what each
  binding's recovery is declared to be able to do.
- [concepts/verification-walk.md](../concepts/verification-walk.md) — every step, the four statuses, and
  the class ladder the report reads out.
- [verify README](../../../packages/verify/README.md) — the walk's full input surface and the canonical
  report.
- [implement-a-binding.md](implement-a-binding.md) — when the rail you need is not one of the thirteen.
- [run-conformance.md](run-conformance.md) — prove your own implementation agrees with this one.
