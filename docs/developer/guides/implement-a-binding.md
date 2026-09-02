# Implement a binding

## What you will have at the end

A rail binding for a chain this repository does not ship: a published manifest declaring exactly what your
recovery can and cannot do, an adapter with four verbs, and conformance vectors that landed *before* the
code and failed for the reason you predicted. Days to weeks, not an afternoon — most of the work is
deciding what is true about the rail, and almost none of it is TypeScript.

Read [concepts/welds.md](../concepts/welds.md) and
[concepts/bindings-vs-placements.md](../concepts/bindings-vs-placements.md) first. This page assumes you
have already answered the one question that decides whether you need a binding at all: **does the artifact
you are putting a reference into, by itself, move value?** If it does not, you want
[add-a-placement.md](add-a-placement.md) instead.

## Step 1 — Name the rail

`BindingManifest.rail` is a **scheme id** — a free string, deliberately, because the set of chains is not
closed. The naming rule is `family:shape` where a chain family carries more than one distinct settlement
shape, and a bare family name where it carries one. Five of the thirteen shipped ids are namespaced — the
three distinct settlement shapes EVM carries, plus Tempo's and Canton's x402 rail — and the other eight are
bare:

```text
evm:x402   evm:mpp   evm:escrow   tempo:mpp   canton:x402
solana     cardano   stellar      xrpl        hedera      sui   aptos   canton
```

Choose once and choose carefully: the scheme id is what a caller dispatches on, so renaming it later is a
wire-visible change rather than a refactor.

`BindingManifest.protocol` is a **different field with a different job**: optional, drawn from
`ProtocolId`, which *is* closed — `x402`, `mpp`, `ap2`, `ack`, `acp`, `ucp`, `visa-tap`, `mastercard-vi`,
`a2a`, `mcp`. It is absent exactly when the binding is protocol-neutral, which every bare-rail binding is.
Without the second field the only way to answer "which commerce protocol is this?" would be to string-parse
a scheme id, and for a mechanism like `evm:escrow` there would be no answer at all.

## Step 2 — Find the carrier field, and grade it

A weld is the ATR hash in a field the settlement itself commits to. Finding that field on a new rail is the
substantive work, and how the reference rides is classified by `pattern`, a closed seven-name vocabulary:

```text
native-field   overlay-contract     sidecar-attestation   opaque-challenge
id-reuse       protocol-extension   http-advisory
```

`native-field` — the rail already had somewhere to put 32 bytes — is the answer on ten of the thirteen
shipped rails, and `nativeField` names that field. Two rails have no such slot, so a reference can only ride
a deployed contract there (`overlay-contract`), and stating that is not a formality: an overlay binding
inherits that contract's trust assumptions where a native-field binding inherits only the chain's, and a
verifier has to be able to tell which it is looking at. The thirteenth is `id-reuse` — no free slot at all, so
the reference is supplied as an input the host protocol already requires and the host's own derivation
carries it.

Then grade it. `weldGrades` maps each **call path** to `"signature"` or `"tx"`:

- **`signature`** — the payer's own signature covers the carrier field.
- **`tx`** — a transaction commits the value, but no signature over the reference itself does.

It is a map rather than a scalar because the grade can differ *between call paths on one rail*: on Tempo,
`transferWithMemo` is signature-grade because the payer signs the calldata carrying the memo, while
`transferFromWithMemo` is tx-grade because there the spender, not the owner, chooses it. If your rail has
one path, the map has one entry; if it has four, it has four.

## Step 3 — Declare the manifest

The manifest is the part every rail has in common, and it is the artifact a stranger reads to decide what
your weld is worth. Every field below is required except `protocol`, `nativeField` and `offCanonical`.

```ts
import type { BindingManifest } from "@integraledger/lcp-binding-core";

const MANIFEST: BindingManifest = {
  rail: "examplechain",
  // `protocol` omitted — this rail is protocol-neutral, which is what absence means.
  pattern: "native-field",
  nativeField: "transfer.note", // present iff pattern is "native-field"
  recovery: {
    onChain: true, // the reference is on the chain, not in a sidecar
    zeroPartyRecoverable: true, // a party holding ONLY the settlement can obtain the hash
    forwardIndexable: false, // given the hash, settlements CANNOT be found without the tx
  },
  assetBinding: "none", // recovery reads the envelope, never the token that moved
  successGate: "raw-field", // this rail records FAILED transactions with their note readable
  indexing: "history-scan:note", // how the forward path works, if there is one
  finality: {
    reversible: false,
    note: "final on inclusion — no on-rail reversal; recourse is the record's elected forum",
  },
  weldGrades: { "transfer.note": "signature" }, // one entry per call path
  lifecycleStates: ["proposed", "settled"],
};

console.log(`${MANIFEST.rail} / ${MANIFEST.pattern} / ${MANIFEST.nativeField}`);
console.log(JSON.stringify(MANIFEST.recovery));
console.log(`assetBinding=${MANIFEST.assetBinding} successGate=${MANIFEST.successGate}`);
console.log(`indexing=${MANIFEST.indexing}`);
```

```text
examplechain / native-field / transfer.note
{"onChain":true,"zeroPartyRecoverable":true,"forwardIndexable":false}
assetBinding=none successGate=raw-field
indexing=history-scan:note
```

Four of those values are where a new rail is most often dishonest, so state them against what you
*measured*:

- **`zeroPartyRecoverable`** asks whether someone holding only the settlement can obtain the hash. Four
  shipped rails answer `false`, for different reasons — `evm:mpp` because its carrier is a one-way
  derivation, `stellar` because only eight bytes of the hash ride on-chain, and the two Canton rails
  because Daml limits contract and transaction visibility to stakeholders, so a neutral verifier is not
  shown the record at all.
- **`forwardIndexable`** asks whether, given a hash, every settlement bound to it can be found without
  knowing the transaction in advance. A history scan is not an index. Ten of the thirteen declare `false`
  and offer a scan, which is an honest `false` rather than a scan presented as an index.
- **`assetBinding`** states whether — and how — recovery observes the asset that actually settled:
  `filtered` (recovery reads the token's own log), `carried` (the token's identity is in the record),
  `proposal-only` (named at proposal, never re-checked), `none` (recovery never observes the asset). `none`
  is the majority answer and it is not a defect: a memo or a metadata label is an envelope-level carrier,
  and its indifference to the payload is the same property that makes such rails asset-independent. The
  declaration is never enforced.
- **`successGate`** is the sibling axis, and it is the one that bites hardest. `assetBinding` declares whether
  recovery observes *what* moved; this declares whether it observes *that anything* moved. Two values, split
  six `raw-field` and seven `structural`. **`raw-field`** means the rail records failed transactions along
  with their weld payload, so the reader supplies the chain's own outcome field and the pure recovery gates on
  it — fail-closed, because an absent outcome is not evidence of success. **`structural`** means the rail
  cannot produce a failed transaction that still carries a weld, so no field is read and none is needed: a
  reverted EVM transaction emits no logs, an aborted Sui programmable transaction discards its events, a Daml
  command that did not commit leaves no contract.

There is deliberately **no third value**. "Recovery cannot tell" is not a posture a profile may publish —
a rail that cannot distinguish a failed transaction from a settled one will mint a settlement record out of
a failure, fee charged and nothing moved, which is the strongest misreport a binding can make. Note also
that a `structural` claim is only as durable as the reader's data source: sourcing events from something
that survives a failure — a dry-run, a mempool feed, an archived-contract query — breaks it and demands
`raw-field` instead.

`offCanonical: { profile }` is for a named variant of a canonical pattern, and it is a reference to a
published profile rather than a hedge about an unclear one.

## Step 4 — The four verbs

`binding-core` exposes one port, `WeldAdapter`. Its members are `manifest`, `propose`, `observe`, `recover`
and the optional `enumerate` — one declaration and four verbs, and there is nothing else on it:

```text
interface WeldAdapter {
  manifest: BindingManifest;
  propose(atrHash: 0x-hex, ctx: unknown): Promise<Outcome<unknown>>;
  observe(ref: SettlementRef, ports: VerifierPorts): Promise<Outcome<LifecycleTransition[]>>;
  recover(ref: SettlementRef, ports: VerifierPorts): Promise<Outcome<0x-hex>>;
  enumerate?(atrHash: 0x-hex, ports: VerifierPorts): Promise<SettlementRef[]>;
}
```

Every read member returns an `Outcome<T>` — `{ ok: true; value: T }` or a `Refusal`
`{ refused: true; haltClass; code; detail? }`, where `haltClass` is one of `risk-block`,
`policy-rejection`, `verification-failure`. **A refusal is a value, never an exception**, on this path as
on every other, and the code is namespaced by the rail. `enumerate` is the one member that is optional, and
its absence is how `forwardIndexable: false` is stated in code.

The types those signatures name are the rest of the port surface, and there is nothing else:

- `SettlementRef` — a `chainId`, plus an optional `txHash` and `logIndex`
- `LifecycleTransition` — a `state`, an `at` (chain time, a `bigint`), and a `ref`
- `VerifierPorts` — `{ chain: ChainReader; artifacts: ArtifactResolver }`
- `ChainReader` — `getLogs(q)`, `getTransactionLogs(ref)`, `readContract(c)`, `blockTime(ref)`
- `ArtifactResolver` — `resolve(ref)`

Satisfied end to end, with a fixed reader in place of a live one:

```ts
import type {
  BindingManifest,
  LifecycleTransition,
  Outcome,
  SettlementRef,
  VerifierPorts,
  WeldAdapter,
} from "@integraledger/lcp-binding-core";

const MANIFEST: BindingManifest = {
  rail: "examplechain",
  pattern: "native-field",
  nativeField: "transfer.note",
  recovery: { onChain: true, zeroPartyRecoverable: true, forwardIndexable: false },
  assetBinding: "none",
  successGate: "raw-field",
  indexing: "history-scan:note",
  finality: { reversible: false, note: "final on inclusion" },
  weldGrades: { "transfer.note": "signature" },
  lifecycleStates: ["proposed", "settled"],
};

/** What this rail's reader hands back: the note, and the chain's own outcome for the transaction. */
type NoteEntry = { note: `0x${string}`; succeeded: boolean };
const isNoteEntry = (e: unknown): e is NoteEntry =>
  typeof e === "object" && e !== null && "note" in e && "succeeded" in e;

const adapter: WeldAdapter = {
  manifest: MANIFEST,

  async propose(atrHash: `0x${string}`, _ctx: unknown): Promise<Outcome<unknown>> {
    return { ok: true, value: { note: atrHash } };
  },

  async recover(
    ref: SettlementRef,
    ports: VerifierPorts,
  ): Promise<Outcome<`0x${string}`>> {
    const entry = (await ports.chain.getTransactionLogs(ref)).find(isNoteEntry);
    // A settlement carrying no readable reference REFUSES. It never answers with a placeholder, and it
    // never throws — a caller has to be able to tell "no weld here" from "this verifier crashed".
    if (entry === undefined)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "examplechain/no-note",
        detail: `no note on the settlement at ${ref.txHash}`,
      };
    // `successGate: "raw-field"` in the manifest is a PROMISE that this check exists. Fail-closed:
    // anything but an explicit success refuses, because a note on a movement that never happened is
    // not a weld — the transaction ran, the fee was charged, and nothing settled.
    if (entry.succeeded !== true)
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "examplechain/not-settled",
        detail: `the transaction at ${ref.txHash} carries a note but did not succeed`,
      };
    return { ok: true, value: entry.note };
  },

  async observe(
    ref: SettlementRef,
    ports: VerifierPorts,
  ): Promise<Outcome<LifecycleTransition[]>> {
    const recovered = await this.recover(ref, ports);
    if ("refused" in recovered) return recovered;
    return {
      ok: true,
      value: [{ state: "settled", at: await ports.chain.blockTime(ref), ref }],
    };
  },

  // `enumerate` is LEFT OFF — the manifest declares `forwardIndexable: false`.
};

const portsServing = (entries: readonly NoteEntry[]): VerifierPorts => ({
  chain: {
    getLogs: async () => [],
    getTransactionLogs: async () => [...entries],
    readContract: async () => null,
    blockTime: async () => 1754179200n,
  },
  artifacts: { resolve: async () => null },
});

const note = `0x${"c7".repeat(32)}` as const;
const ref: SettlementRef = { chainId: 1, txHash: `0x${"11".repeat(32)}` };
const settled = portsServing([{ note, succeeded: true }]);

console.log(JSON.stringify(await adapter.recover(ref, settled)));
console.log(
  JSON.stringify(await adapter.observe(ref, settled), (_k, v) =>
    typeof v === "bigint" ? `${v}` : v,
  ),
);
console.log(
  JSON.stringify(
    await adapter.recover(ref, portsServing([{ note, succeeded: false }])),
  ),
);
console.log(JSON.stringify(await adapter.recover(ref, portsServing([]))));
console.log(adapter.enumerate === undefined);
```

```text
{"ok":true,"value":"0xc7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7c7"}
{"ok":true,"value":[{"state":"settled","at":"1754179200","ref":{"chainId":1,"txHash":"0x1111111111111111111111111111111111111111111111111111111111111111"}}]}
{"refused":true,"haltClass":"verification-failure","code":"examplechain/not-settled","detail":"the transaction at 0x1111111111111111111111111111111111111111111111111111111111111111 carries a note but did not succeed"}
{"refused":true,"haltClass":"verification-failure","code":"examplechain/no-note","detail":"no note on the settlement at 0x1111111111111111111111111111111111111111111111111111111111111111"}
true
```

### The port is EVM-shaped, and most rails say so

Three of the thirteen shipped rails implement `WeldAdapter` structurally — `evm:x402`, `evm:escrow` and
`evm:mpp`. The other ten deliberately do not, and each one says so in its own source: `SettlementRef.txHash`
is `0x`-hex where Solana speaks base58 signatures, and `ChainReader` speaks `eth_getLogs` where Stellar
speaks Horizon and Canton speaks Daml. Those bindings expose a **rail-native surface** — their own
reference type, their own reader port — beside the same chain-agnostic `BindingManifest`.

That is not ten packages cutting corners. Satisfying the port by widening `SettlementRef` until every rail
fits, or by throwing from members a rail cannot honour, would put a shape on the type that the rail does not
have. Unifying the port across EVM and non-EVM rails is open work; forcing it would misrepresent the rail,
and the manifest — which *is* uniform — already carries everything a caller needs to dispatch.

So the rule for a new rail: **the four verbs, the `Outcome` discipline, and the manifest are the contract.**
If your rail's references and reads fit `SettlementRef` and `ChainReader`, implement `WeldAdapter` and get
port compatibility for free. If they do not, export your own types and say in the module header that you did
and why — that sentence is the thing reviewers check.

## Step 5 — The exemplar

[`binding-solana`](../../../packages/binding-solana/README.md) is the smallest real binding: five source
files and no overlay program. Its shape is worth copying because of how the work is divided — the SDK does
one job, and everything a vector can pin is pure.

```ts
import {
  decodeSplMemo,
  encodeSplMemo,
  MEMO_PROGRAM_ID,
  recoverAtrHashFromTxView,
  SOLANA_MANIFEST,
} from "@integraledger/lcp-binding-solana";

const atrHash =
  "0xe86225e8541075b52506b25d1d7de54677931857862754d8d14db7080fde1f99";

// THE CODEC — no SDK, no network, and therefore pinnable by a vector.
const memo = encodeSplMemo(atrHash, "hex");
console.log(new TextDecoder().decode(memo));
console.log(decodeSplMemo(memo, "hex"));

// A memo that is not ours decodes to `null`, so a scan can skip it rather than treat it as an error.
console.log(decodeSplMemo(new TextEncoder().encode("thanks for lunch"), "hex"));

// A malformed atrHash on the WRITE path is a wiring defect in our own caller, so it THROWS. Refusals are
// for what the wire hands you; a programming error is not a policy outcome.
try {
  encodeSplMemo("0xdead");
} catch (e) {
  console.log((e as Error).message);
}

// THE DECODED VIEW — still pure. The SDK's only job is to produce this shape from an RPC response.
console.log(
  recoverAtrHashFromTxView({
    memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: atrHash }],
    err: null,
  }),
);
// Fail-closed on anything but `err: null`: a transaction that ran and failed still carries its memo and
// still charged its fee, and a memo on a movement that never happened is not a weld.
console.log(
  recoverAtrHashFromTxView({
    memos: [{ programId: MEMO_PROGRAM_ID, memoUtf8: atrHash }],
    err: { InstructionError: [1, "Custom"] },
  }),
);

console.log(JSON.stringify(SOLANA_MANIFEST.weldGrades));
```

```text
0xe86225e8541075b52506b25d1d7de54677931857862754d8d14db7080fde1f99
0xe86225e8541075b52506b25d1d7de54677931857862754d8d14db7080fde1f99
null
encodeSplMemo: atrHash must be a 0x-prefixed 32-byte value, got "0xdead"
0xe86225e8541075b52506b25d1d7de54677931857862754d8d14db7080fde1f99
null
{"spl-memo":"signature"}
```

Four things to take from it. The **codec is pure and separate**, so the encoding is testable without a
node. The **SDK boundary is one function** that maps a parsed transaction into a plain view, so the
adapter's logic is testable without a network. The **success gate is fail-closed and lives in the pure
path** — `err: null` is the only success and an absent `err` is not evidence of one, which is the
`successGate: "raw-field"` declaration honoured in code rather than in prose. And the **manifest tells the
truth about the scan**: `enumerate` exists, `forwardIndexable` is `false`, and `indexing` reads
`signature-scan:memo` rather than pretending an account scan is an index.

## Step 6 — Vectors first, then the implementation

This is the definition of done, and the order is not a style preference.
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) states three rules for `vectors/`, and they are not
negotiable:

1. **Land the failing vector first.** Add the vector, confirm it fails, and confirm it fails *for the
   reason you expect* — then implement. A vector written after the code merely records that the code agrees
   with itself.
2. **Re-derive pinned oracle values independently.** A pinned digest or encoded byte string is computed
   from the input bytes with something that is not this implementation — a throwaway `python3`/`hashlib`
   script, `cast keccak`, a second library — and the derivation is shown in the changeset. Copying what the
   implementation now emits proves nothing.
3. **Record the superseded pin.** A changed vector says what it used to be and why it moved, so the change
   is auditable years later by someone who was not in the room.

A new rail owes vectors in two places, and they answer different questions.

**The corpus** carries the manifest. Your profile document goes in
`vectors/binding/profile-documents.json`, which the `binding.profiles` area validates against
`vectors/binding/profile.schema.json` — the type-level catch for a misdeclared pattern. Add the case, run
the corpus, and watch it fail before you have written anything:

```bash
npx @integraledger/lcp-conformance --phase P3
```

```text
conformance: 366 passed, 1 failed, 18 skipped (verify.authorityWalk, verify.classLadder, verify.recourse, verify.identity, vocabulary.protocolId, placement.manifestSchema, placement.acp, placement.ap2, placement.ucp, placement.a2a, placement.x402, placement.ack, placement.mpp, placement.visa-tap, placement.mastercard-vi, placement.dispatch, verify.referencePlacement, discovery.capability)
FAIL binding.profiles / the examplechain note profile validates: expected true got false
```

That is the right failure for the right reason: the profile declared no `successGate`, and the schema
requires one because a rail that cannot say how it knows a settlement happened has a bug rather than a
posture. Fix the manifest, not the schema.

**Your package** carries the rail's own oracles — a derivation, a metadatum encoding, a typed-data digest.
Those live beside the corpus in `vectors/binding/<rail>-*.json` and are read by that package's tests, which
is where rule 2 does its real work: the shipped MPP-EVM derivation vector was produced by two independent
keccak-256 implementations, and the Cardano metadatum vector by an independent CBOR oracle.

Two things to know before you run any of this.

**`lcp-conformance` cannot be pointed at a third party.** It always drives the in-process JavaScript
implementation, and no flag redirects it. Driving a foreign implementation is the library API,
`runCorpus(subject, opts)` with a `CliSubject` — see [run-conformance.md](run-conformance.md).

**`runCorpus` defaults `phase` to `"P1"`, where the CLI defaults to the wired floor.** P1 is 95 cases —
roughly an eighth of the corpus — and it contains no binding area at all, so a library caller who omits
`phase` certifies none of the work above. State the phase, and check `report.skipped` is empty rather than
trusting a string.

Then the repository's own gates, which a new package has to pass like every other:

```bash
pnpm verify          # check:versions → check:docblocks → check:live-rails → corpus-seal → audit → build
                     #   → check:dist → lint → depcruise → typecheck → check:docs → test
pnpm mutation <pkg>  # the package's mutation ratchet, which only ever moves up
```

`depcruise` is a real gate here and not decoration: your chain SDK is confined to your own binding package,
so it can never leak into another rail's consumer graph.

Finally, know which bar you are clearing.
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) puts changes to protocol semantics, wire formats and the
conformance corpus in a second tier: **nothing enters the standard until it is battle-tested in production
use, and standard-affecting changes require steering-committee sign-off.** A new rail's carrier field and
its profile are exactly that kind of change. A change to this repository cannot ratify a change to the
[specification](https://legalcontextprotocol.org/standard), which is published separately; the Legal Context
Protocol is co-stewarded by **Integra Ledger** and **AAA-ICDR**, and contributions and proposals reach the
maintainers through them.

## What a binding is not

- **Not settlement operation.** Observation is read-only: a binding reads a settled artifact's own fields
  and never supplies, operates, or prices the settlement mechanism it reads.
- **Not a payment verifier.** A weld reports what the carrier field bound. Whether the amount, currency and
  recipient were right is the host protocol's own verification.
- **Not a judgement.** Recovering a hash produces a correspondence or its absence. What follows is the
  elected forum's question, and the walk reports rather than decides.

## Where next

- [concepts/welds.md](../concepts/welds.md) — the carrier field on every shipped rail, weld grades, and
  the recovery declarations in full.
- [binding-core README](../../../packages/binding-core/README.md) — the carrier codec's three shapes and
  the `WeldAdapter` port, which the three EVM rails implement and the ten others deliberately do not.
- [verify-a-settlement.md](verify-a-settlement.md) — what a caller does with the binding you just wrote.
- [add-a-placement.md](add-a-placement.md) — the other half of the reference surface, for artifacts that
  never settle.
