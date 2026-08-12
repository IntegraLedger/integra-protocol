# Welds

A **weld** is the ATR hash carried in a field the settlement itself commits to.

That is the whole definition, and every word in it is load-bearing. Not a hash stored beside the
settlement, not a hash in a database keyed by transaction id, not a hash in a receipt the seller issues
afterwards — a hash in a field that the settlement's own authenticated payload covers, so that whatever
authenticated the payment authenticated the reference too.

The consequence is that a settlement stops being an isolated value transfer and becomes evidence about
which terms it settled. Anyone who can read the settlement can read the reference; anyone holding the ATR
bytes can recompute the hash; the two either correspond or they do not.

## Recover, recompute, compare

Verification of a weld is three mechanical operations, in this order:

1. **Recover.** Read the carrier field out of the settled artifact. This is `adapter.recover(ref, ports)`,
   and what it returns is the hash the *chain* holds.
2. **Recompute.** Hash the ATR bytes you were handed. This is `hashAtr(atrFile)`.
3. **Compare.** Two 32-byte values, compared case-insensitively.

There is no third source of truth consulted, no oracle asked, no signature of ours to trust. That is why
the correspondence is **deterministic** rather than a judgement: given the same settlement and the same
bytes, every implementation reaches the same answer, and the answer does not depend on who is asking.

Which is also the honest limit. The comparison establishes that *this settlement carried a reference to
this record*. It does not establish that the price was right, the goods arrived, or the counterparty is
solvent.

```ts
import {
  decodeLegalContextString,
  encodeLegalContextString,
} from "@integraledger/lcp-binding-core";
import { assemble, atrHashEquals, hashAtr } from "@integraledger/lcp-kernel";

const { atrFile, atrHash } = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" },
]);

// SELLER, before settlement: the reference a string-shaped carrier field will hold.
const carried = encodeLegalContextString({ type: "sha256", value: atrHash });
console.log(carried);

// VERIFIER, after settlement: these are the bytes `recover` read back off the rail.
const recovered = decodeLegalContextString(carried);
console.log(recovered?.type, recovered?.value);

// The correspondence: recompute over the ATR bytes you were handed, then compare.
const recomputed = await hashAtr(atrFile);
console.log(atrHashEquals(recovered?.value ?? "", recomputed)); // true

// A different record recomputes to a different hash, and the comparison simply fails.
const other = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0x00000000000000000000000000000001" },
]);
console.log(atrHashEquals(recovered?.value ?? "", other.atrHash)); // false
```

```text
lcp:sha256:0x437a46db8485b1b3552533d415ba6290a4e7d1ff4cb01e4e6eb7ef63d10748a5
sha256 0x437a46db8485b1b3552533d415ba6290a4e7d1ff4cb01e4e6eb7ef63d10748a5
true
false
```

Inside the walk, this comparison is the `atr-fingerprint` step — see
[verification-walk.md](verification-walk.md). What a rail binding contributes is step 1: turning a
settlement into the hash it carried.

## The carrier field, rail by rail

Every rail already had somewhere to put 32 bytes, or it did not and something had to be deployed. The
carrier is whichever field that turned out to be, and it is different on every chain:

| Package | Rail | Pattern | Carrier field |
|---|---|---|---|
| [`binding-evm-x402`](../../../packages/binding-evm-x402/README.md) | `evm:x402` | `native-field` | the EIP-3009 `nonce` the payer already signs |
| [`binding-evm-mpp`](../../../packages/binding-evm-mpp/README.md) | `evm:mpp` | `id-reuse` | MPP's `challenge.id`, which the host protocol's own required derivation carries into the EIP-3009 nonce |
| [`binding-evm-escrow`](../../../packages/binding-evm-escrow/README.md) | `evm:escrow` | `native-field` | `PaymentInfo.salt` |
| [`binding-tempo-mpp`](../../../packages/binding-tempo-mpp/README.md) | `tempo:mpp` | `native-field` | TIP-20's `bytes32 memo` on `transferWithMemo`, emitted as an indexed topic of `TransferWithMemo` |
| [`binding-solana`](../../../packages/binding-solana/README.md) | `solana` | `native-field` | SPL Memo instruction data |
| [`binding-cardano`](../../../packages/binding-cardano/README.md) | `cardano` | `native-field` | a dedicated LCP transaction-metadata label |
| [`binding-stellar`](../../../packages/binding-stellar/README.md) | `stellar` | `native-field` | the CAP-67 muxed-address `mux_id` |
| [`binding-xrpl`](../../../packages/binding-xrpl/README.md) | `xrpl` | `native-field` | `Payment.InvoiceID` (x402's exact-XRPL scheme makes a facilitator reject memo-bearing transactions) |
| [`binding-hedera`](../../../packages/binding-hedera/README.md) | `hedera` | `native-field` | the HTS `TransferTransaction.transactionMemo` |
| [`binding-sui`](../../../packages/binding-sui/README.md) | `sui` | `native-field` | the Pay402 `settle_payment` `payment_id` argument |
| [`binding-aptos`](../../../packages/binding-aptos/README.md) | `aptos` | `overlay-contract` | the `payment_id` argument of a Move entry call against a deployed `lcp_payment` module |
| [`binding-canton`](../../../packages/binding-canton/README.md) | `canton` | `overlay-contract` | an `LcpAnchor` Daml contract, for deployments outside x402's Canton-Coin-only scheme |
| [`binding-canton-x402`](../../../packages/binding-canton-x402/README.md) | `canton:x402` | `native-field` | `PaymentRequirements.extra.memo`, echoed into the transfer metadata under `x402.memo` |

`binding-evm-common` is not in the table because it is not a rail: it supplies the typed-data
construction, signature verification, and event decoding the EVM bindings are built from, and binds no
chain of its own.

The **pattern** column is the specification's classification of *how* the reference rides, and the two
overlay rows are where it earns its keep. Aptos's stock coins carry no arbitrary-bytes field and Daml
exposes no transaction memo, metadata label, or nonce at all — so on those two rails a reference can only
ride a deployed contract, and a binding that depends on a deployed contract inherits that contract's trust
assumptions where a native-field binding inherits only the chain's. Stating the pattern is how a verifier
knows which it is looking at.

### Weld grade — what did the commitment

"A field the settlement commits to" admits two strengths, and each manifest declares which one it has, per
call path, in `weldGrades`:

- **`signature`** — the payer's own signature covers the carrier field. An EIP-3009 authorization covers
  its `nonce`; a Cardano transaction body commits to the metadata hash; a Solana signature covers the memo
  instruction and the transfer instruction together. The reference is inside what the payer signed.
- **`tx`** — a transaction commits the value, but no signature over the reference itself does. Canton's
  `LcpAnchor` is the clearest case: the buyer authorizes the create command, so the anchor is evidence of
  the record standing beside the payment rather than a field inside the payment's own authenticated
  payload.

The grade can differ between call paths on one rail. TIP-20's `transferWithMemo` is signature-grade
because the payer signs the calldata carrying the memo, while `transferFromWithMemo` is tx-grade because
there the spender, not the owner, chooses the memo — which is why the grade is a property of the *call*
and a recovered memo alone does not establish it.

`binding-evm-mpp` is the one row whose **pattern** is neither `native-field` nor `overlay-contract` — its
grade is ordinary, `weldGrades.authorization: "signature"`. Nothing of ours occupies a field there: MPP fixes its
EIP-3009 nonce to a derivation and fixes its Permit2 witness type string, so there is no free slot. What
remains is to supply an input the host already requires — the challenge id — and let the host's own
derivation carry it. Note that `binding-evm-x402` binds the *same* nonce field under a different pattern,
and the two are not reconcilable: x402 leaves the nonce unconstrained so the hash rides it directly, while
MPP derives it, so the same field holds a hash *of* the hash.

## Every binding declares what its recovery can actually do

A carrier field is not the same as a recoverable one, and the differences are not rounding errors. Each
binding ships a `BindingManifest` stating them, so a verifier reads the strength of a weld rather than
assuming it:

| Rail | `assetBinding` | Zero-party recoverable | Forward-indexable |
|---|---|---|---|
| `evm:x402` | `filtered` | yes | yes |
| `evm:mpp` | `filtered` | **no** | no |
| `evm:escrow` | `carried` | yes | no |
| `tempo:mpp` | `filtered` | yes | yes |
| `cardano` | `none` | yes | yes |
| `solana` | `none` | yes | no |
| `xrpl` | `none` | yes | no |
| `hedera` | `none` | yes | no |
| `sui` | `proposal-only` | yes | no |
| `aptos` | `proposal-only` | yes | no |
| `stellar` | `none` | **no** | no |
| `canton` | `none` | **no** | no |
| `canton:x402` | `carried` | **no** | no |

All thirteen declare `recovery.onChain: true`; the two columns above are the ones that vary.

**Zero-party recoverable** asks whether a party holding only the settlement can obtain the ATR hash from
it. Four rails answer no, for three different reasons. Stellar's `mux_id` is 64 bits, so only the first 8
bytes of the hash ride on-chain — enough to *confirm* a hash you already hold, never enough to reconstruct
one you do not, and the API says so by returning raw 8 bytes rather than something that reads like a full
hash. `evm:mpp` is non-recoverable by construction: keccak-256 has no inverse, so its `recover` refuses
unconditionally and `verifyCandidate` — a confirmation, not a lookup — is the whole surface. The two Canton
rails answer no because recovery there needs the participant node's own view: `canton` reads an `LcpAnchor`
contract and `canton:x402` the transfer's metadata, and neither is visible to a party without ledger
access.

**Forward-indexable** asks whether, given an ATR hash, every settlement bound to it can be found without
knowing the transaction in advance. Three rails declare `true`, and even among those the index is not the
same index: `tempo:mpp` and `evm:x402` are indexed **by the reference itself**, so one query returns every
settlement bound to one hash; `cardano` indexes by metadata *label*, so a query returns every LCP-labelled
settlement rather than one reference's. The other ten declare `false` and offer a history scan — an honest
`false` rather than a scan presented as an index. `evm:escrow` is the instructive one: it carries its `salt`
in event *data* rather than in a topic, so the forward path is a scan-and-decode, and a scan is not an
index however convenient it is to call one.

### The asset-binding axis

`assetBinding` states whether — and how — recovery observes the asset that actually settled. Four values,
because measurement found four cases and a boolean cannot express the middle two honestly:

| Value | Meaning |
|---|---|
| `filtered` | Recovery reads the token's own log, so the record proves **this** token moved. |
| `carried` | The token's identity is written into the record itself. |
| `proposal-only` | The asset is named at proposal but never re-checked at recovery. |
| `none` | Recovery never observes the asset — the weld rides the transaction envelope, which is indifferent to its payload. |

`none` is the majority answer and it is not a defect. A memo, a metadata label and a muxed destination are
all envelope-level carriers, and their indifference to the payload is the same property that makes those
rails asset-independent. What matters is that a weaker evidentiary claim is *declared* as weaker rather
than flattened into equality — and that the declaration is never enforced, because refusing an
envelope-level weld would end that asset-independence and put the verifier in the business of judging what
should have settled.

## What welding is not

- **Not settlement operation.** Observation is read-only: a binding reads a settled artifact's own fields
  and never supplies, operates, or prices the settlement mechanism it reads.
- **Not a payment verifier.** A weld reports what the carrier field bound. Whether the amount, currency and
  recipient were correct is the host protocol's own verification, and on rails where a transfer's recipient
  can be resolved or redirected before the event is emitted, a binding claims the reference was welded to a
  settled movement — never that a particular party was paid.
- **Not a placement.** A placement puts a reference into a protocol document that never settles. Both carry
  an LCP reference; only a weld rides something that moved value. See
  [bindings-vs-placements.md](bindings-vs-placements.md).
- **Not a judgement.** Recovering a hash and recomputing it produces a correspondence or its absence. What
  follows from that is the elected forum's question, and the walk reports rather than decides.

## Where next

- [bindings-vs-placements.md](bindings-vs-placements.md) — the distinction that decides which package you
  need.
- [verification-walk.md](verification-walk.md) — where a recovered hash becomes `settledAtrHash`, and what
  the walk does with it.
- [binding-core README](../../../packages/binding-core/README.md) — the carrier codec's three shapes and
  the `WeldAdapter` port the three EVM rails implement (the ten others expose a rail-native surface).
- [../guides/verify-a-settlement.md](../guides/verify-a-settlement.md) — recover, recompute, compare,
  against a real settlement.
- [../guides/implement-a-binding.md](../guides/implement-a-binding.md) — what a new rail owes.
