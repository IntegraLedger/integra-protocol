# The verification walk

The walk is what a verifier does with a record. It takes the pieces of a transaction — the ATR bytes, the
hash a settlement carried, the acceptance, the authority artifacts — and reports, **step by step**, what it
was able to establish and what it was not.

It is pure over its supplied inputs. `verify` opens no sockets and fetches nothing; gathering the inputs
over live ports is the caller's job. That split is what makes the walk deterministic, testable against
fixed vectors, and identical across independent implementations holding the same inputs.

## What the walk answers, and what it declines to answer

It answers: *is this record self-consistent, and how much of it was I equipped to check?*

It does not answer whether you should do business with the counterparty, whether the price was fair, or
whether the goods arrived. Those are judgements. The walk is a readout — it recomputes hashes, checks
containment, compares timestamps, and reports outcomes. Where it cannot check something it says so, and
saying so is a first-class result rather than a failure.

## Inputs

Everything the walk consults arrives in one `VerifyInput`. Grouped by what it is:

| | Fields |
|---|---|
| The moment | `asOf` — the settlement's chain-anchored time. Every validity check is evaluated against it, never against now. |
| The record | `atrBytes` — the ATR file as retrieved. |
| The settlement | `settledAtrHash` — the hash **recovered from the settlement's carrier field**, not one you computed. `settlements` — what enumeration found. |
| Acceptance | `acceptance`, `acceptanceVerifier` — the buyer's signed acceptance and the port that checks its signature. |
| Authority | `authorityWalk` (preferred) or `authorityChain`; `commitment` — the accepted commitment against the leaf grant's bounds. |
| Identity | `identity` — both parties' resolutions, each at a stated assurance. |
| Retention | `evidenceRoles` — the roles present in the retained evidence package. |
| Framing | `claimedClass` (default `"TC-2"`), `depth` (default `"structural"`), `coverage` — what this caller was equipped with. |
| Additive | `composition`, `placement` — supply either and its steps are appended; omit them and the report is byte-identical to one produced without them. |

`authorityWalk` and `authorityChain` are **mutually exclusive** and supplying both throws rather than
picking one. Two answers about the same chain is a contradiction, not a precedence question.

## The four statuses

Every step reports exactly one of four outcomes. These names are the report's own, and a conformant
implementation emits them verbatim:

| Status | Meaning | Carries |
|---|---|---|
| `proved` | The step ran and held. | — |
| `failed` | The step ran and did **not** hold. | `haltClass` |
| `indeterminate` | The input exists but could not be retrieved. | — |
| `not-attempted` | The input was never supplied, or was unusable. | `depth` — the reason |

Most verifiers have two of these. Collapsing to pass/fail merges two situations a caller must be able to
tell apart: *this record contradicts itself* and *I was not equipped to check this*.

Three rules hold across every step:

- **An absent input never becomes a pass.** An empty authority chain is `not-attempted`, never `proved`. A
  record carrying no delegated authority must not clear the authority rung by supplying nothing.
- **Contradictions fail; gaps do not.** `failed` is reserved for a record that contradicts itself — a
  fingerprint that does not match, a link that widens its parent, a signature that does not verify. Missing
  evidence is a gap.
- **Every step is total.** A malformed slot reads out as a gap, never as a `failed`. A caller's shape error
  says nothing about whether the record is self-consistent, and a walk that throws cannot report the
  malformation it was handed.

The `depth` string on a `not-attempted` is the reason, and it is specific: `no-acceptance` and
`no-signature-verifier` are different facts about an acceptance, and an acceptance nobody could check is
not an acceptance that failed.

## The steps

The walk is an ordered table. Seven steps always run:

| Step | What it checks |
|---|---|
| `atr-fingerprint` | Recomputes the hash over `atrBytes` and compares it to `settledAtrHash`. This step **is** the weld check. |
| `settlement-enumeration` | A settlement was supplied; multiple settlements are flagged. |
| `buyer-acceptance` | The buyer's signature over the fingerprint, through the injected verifier port. |
| `authority-attenuation` | Every link in the delegation chain was permitted by its parent, attenuates it, and was unrevoked and unexpired as of settlement. |
| `commitment-vs-leaf` | The accepted commitment is contained by the leaf grant's bounds. |
| `recourse-elections` | The forum and governing law elected **inside the hashed record**, and the completeness of the retained evidence package. |
| `resolve-party` | Both parties resolve, each at a stated assurance, over a non-empty resolution chain. |

Five more are appended when a `composition` slot is supplied — `offer-bound`, `operations-bound`,
`discovery-integrity`, `proportionality-declared`, `frc-non-gating` — and one more when a `placement` slot
is supplied: `reference-placement`.

`recourse-elections` reads its elections from the hashed record itself, parsed as the envelope, never from
a caller-supplied side channel. What it proves is therefore what was welded.

## The class ladder

A record is *shaped for* a transaction class. The taxonomy is closed:

```text
TC-0  TC-1  TC-2  TC-3  TC-4
```

What each class requires to be `proved`, cumulatively:

| Class | Adds |
|---|---|
| `TC-1` | `settlement-enumeration`, `resolve-party` |
| `TC-2` | `atr-fingerprint` |
| `TC-3` | `buyer-acceptance`, `authority-attenuation`, `commitment-vs-leaf`, `recourse-elections` |
| `TC-4` | `offer-bound`, `operations-bound`, `discovery-integrity`, `proportionality-declared` |

The ladder is **cumulative** — TC-4 cannot hold without the TC-3 acceptance — and **exact**: a class never
requires a step it does not depend on, so a TC-1 record with an unattempted fingerprint still verifies.
`TC-0` requires nothing, which is what makes it the floor an impeached record lands on.

Two appended steps are deliberately in no class's requirement list. `frc-non-gating` and
`reference-placement` are **reported, never required**: each impeaches when it *fails*, and its absence
never blocks.

One requirement of the classes has **no step at all**, and the gap is named rather than papered over.
Spend-authority bounds live inside the rail's own settlement authorization — an EIP-3009 `value`, an
authorization cap — and `verify` is pure over supplied inputs with no rail decoder, so it cannot re-derive
them. `recourse-elections` reaches the requirement indirectly by insisting the spend artifact is present in
the retained evidence package, so the artifact is kept and referenced even though its bounds are not
re-checked here. Closing it properly needs a rail decoder, and until one exists the honest thing is to say
which rung is standing on a retention check.

## `verified` is a verdict about a claim; `supportedClass` is a finding

`depth` decides what the walk is entitled to say.

At the default `depth: "structural"`, `verified` is **always** `false`. A structural walk is a
presence-and-absence readout over supplied inputs; it cannot affirm liveness, so it does not pretend to.
Passing `depth: "mechanical"` — where the caller has gathered the inputs over live ports — lets `verified`
become an honest function of the walk: `true` only when every class-required step is `proved` and no step
`failed`.

`supportedClass` is not the same kind of thing. It is a **finding**, computed from the steps alone: the
highest class every one of whose required rungs is `proved`, dropping to `TC-0` the moment any step fails.
White paper #4 §5 defines a transaction's class as "the highest class whose criteria it fully meets", so
the caller's claim neither caps the answer nor lifts it — a record that proves nothing reads `TC-0` however
high the caller aimed, and one whose rungs reach past the claim reads what they reach.

The claim is still reported, as `claimedClass`, because `verified` answers *"did the record reach the class
it claimed?"* and cannot be read without it. Comparing the two is the useful act: where they agree the
record met its own shape, and where they differ it did not.

Note what `depth` does and does not touch. Step outcomes are depth-agnostic — they depend on the inputs
supplied, not on the depth — so `depth` governs `verified` alone. That is also why a `not-attempted` rung
never lowers the class *dishonestly*: it lowers it because nothing proved, and the step's own reason says
whether that was the record's gap or this walk's. A report is a statement about what its producer could
see, not a score to optimize.

## Authority chain custody

The authority step is the load-bearing one, and it has two doors.

`authorityChain` takes an already-flattened array of links. Every field on such a link — `parentBounds`,
`parentDelegable`, `parentMaxDepth`, `revoked`, `active` — is a *derived* fact, and the step takes each at
face value. Whoever produced that array is therefore a trusted, unverified oracle: a flattener that never
checked that link N+1 was signed by link N's subject, and never consulted a status list, still yields a
confident `proved`.

`authorityWalk` is the door that removes that trust, and it is the one to use. It takes the readout of
`walkChain` from [`@integraledger/lcp-authority`](../../../packages/authority/README.md), which verifies that
the chain is *one chain* before any of its bounds are considered:

1. **Continuity.** The root is issued by the declared principal and signed by the issuer's key; every later
   link is signed by its parent's subject key and states that subject as its issuer. Without this, the
   chain is unrelated assertions and anyone can splice a link in.
2. **Signed bytes match the presented link.** The proof must verify over the grant *as presented*, through
   an injected `GrantProofVerifier`, so the visible grant and the signed grant cannot differ.
3. **Leaf binding.** The leaf subject's key must be the acceptance signer.
4. **Attenuation per hop.** The parent permitted delegation, the depth arithmetic holds, and the bounds are
   contained — an absent dimension on a child is *unbounded*, so the forged empty link is refused rather
   than treated as inheriting.
5. **Lifecycle as of settlement.**

`walkChain` returns one of three readouts, and `verify` maps them without interpretation because the walk
already draws the same line: `walked` hands over links whose every field it *stated*; `refused` is a
reasoned contradiction and carries its halt class through to the report; `not-attempted` is an honest gap
whose depth passes through verbatim.

### Revoked and active are stated, never defaulted

Both `revoked` and `active` are **required** fields on a link, and that is the whole point of them.

- `active` is expiry: the grant's `validFrom`/`validUntil` evaluated at `asOf`. A grant that expired before
  settlement is exactly as unusable as one revoked at it — two independent gates, not one.
- `revoked` is read from a **hash-pinned status-list snapshot captured at settlement**. A status list has
  no historical query: dereferencing it live yields *today's* list. Presenting today's answer as history
  would be a different claim than the one being made.

Neither field is optional, because "the caller never consulted a status list" and "the walk checked the
pinned snapshot and the grant is unrevoked" would otherwise be the same absent value — and one of them
proves. Requiring them makes the unstated case a compile error at the call site. A caller that walks first
satisfies both for free; only a hand-flattener feels it, which is the intent.

The runtime says the same thing as the type, which matters because the step is deliberately total over
untyped input — a foreign conformance subject or an unvalidated intake reaches it without ever meeting the
compiler. An unstated `revoked` is `not-attempted` with depth `no-revocation-stated`, an unstated `active`
is `no-liveness-stated`, and a non-boolean in either slot is `malformed-authority-chain` — the caller's
shape error, not the record's contradiction. The two slots carry separate depth tokens on purpose: a report
should never describe an expiry gap as something about revocation.

Everything here is evaluated against `asOf`, the settlement's own instant. A grant that expired last week
was valid at the moment it was used.

## What a `failed` step means for a consumer

A `failed` step is the walk's only impeaching outcome, and it carries a **halt class** naming what kind of
stop it is. The vocabulary is shared with every refusal in this repository — refusals are values carrying
one of these three, never exceptions — and it has exactly three members:

| `haltClass` | What it says | Raised by a walk step? |
|---|---|---|
| `verification-failure` | The record contradicts itself. | yes |
| `risk-block` | A risk signal gated the transaction. | yes, by `frc-non-gating` |
| `policy-rejection` | A policy refused. | not by any step here |

`verification-failure` is what the record's own steps raise: a fingerprint that does not match its
settlement, a chain link that widens its parent, a revoked or expired grant, an acceptance signature that
does not verify, a placed reference naming a different record. `risk-block` arrives only through
`frc-non-gating`, when a signal is found to have *gated* settlement. `policy-rejection` is in the shared
enum because a caller's own refusals need to speak the same three words; no step in the walk emits it,
because deciding a policy is not something the walk does.

For a consumer, a `failed` step means three things at once:

1. **`supportedClass` is `TC-0`**, whatever was claimed. Any downstream check keyed on class must read the
   reported one and never the claimed one.
2. **`verified` is `false`** at any depth. A failure short-circuits it before the class requirements are
   consulted, so mechanical depth cannot rescue it.
3. **The record is impeached, not merely unproven.** This is categorically different from a `not-attempted`
   walk with the same `verified: false`. A gap says *reach for more inputs*; a failure says *this record
   contradicts itself, and gathering more will not change that*. Treating the two alike is the mistake the
   four-status vocabulary exists to prevent — and `anyStepFailed(report)` is the discriminant that keeps
   them apart in one call.

## A walk that fails, and switching on it

The record below is coherent. The hash recovered from the settlement is not its hash — it names a different
record — so `atr-fingerprint` fails and the claim is impeached.

```ts
import { assemble } from "@integraledger/lcp-kernel";
import { anyStepFailed, verify } from "@integraledger/lcp-verify";

const { atrFile } = await assemble([
  {
    slot: "terms",
    ref: "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30",
  },
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" },
  { slot: "recourse", value: { governingLaw: "US-NY", forum: "Arbitration Forum" } },
]);

const report = await verify({
  asOf: "2026-08-03T00:00:00Z",
  coverage: { ports: [], bindings: ["evm-x402"] },
  atrBytes: atrFile,
  // Recovered from the settlement's carrier field — and it names a DIFFERENT record.
  settledAtrHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  settlements: [
    { txHash: "0xf1a4d0e2c3b5978664fa2b1c0d9e8f7a6b5c4d3e2f10112233445566778899aa" },
  ],
});

for (const step of report.steps) {
  switch (step.outcome.status) {
    case "proved":
      console.log(`${step.name.padEnd(24)} proved`);
      break;
    case "failed":
      // The only branch that impeaches. `haltClass` narrows here and nowhere else.
      console.log(`${step.name.padEnd(24)} failed  ${step.outcome.haltClass}`);
      break;
    case "indeterminate":
      console.log(`${step.name.padEnd(24)} indeterminate`);
      break;
    case "not-attempted":
      console.log(`${step.name.padEnd(24)} not-attempted  ${step.outcome.depth}`);
      break;
  }
}

console.log(`claimed TC-2 → supportedClass: ${report.supportedClass}`);
console.log(`verified: ${report.verified} | anyStepFailed: ${anyStepFailed(report)}`);
```

```text
atr-fingerprint          failed  verification-failure
settlement-enumeration   proved
buyer-acceptance         not-attempted  no-acceptance
authority-attenuation    not-attempted  no-authority-chain
commitment-vs-leaf       not-attempted  no-commitment
recourse-elections       not-attempted  no-evidence-package
resolve-party            not-attempted  no-identity
claimed TC-2 → supportedClass: TC-0
verified: false | anyStepFailed: true
```

Read the difference between line 1 and lines 3–7. One record contradicted its settlement; five rungs were
never reached for. Both leave `supportedClass` at `TC-0` here, and they are not the same fact: the failure
**impeaches** — it would force `TC-0` even if every other rung had proved — while the gaps merely fail to
lift the class, and would lift it the moment their inputs were supplied. `steps` is where that difference
is legible; the summary cannot carry it.

`recourse-elections` is worth a second look: its reason is `no-evidence-package`, not `no-elections-recorded`.
This record *did* elect a forum and a governing law, so the step got past those gates and stopped at the
next one — the retained evidence package, which was never supplied. The reason string tells you how far it
got.

## Byte-identical reports

`serializeReport(report)` emits RFC 8785 (JCS) canonical JSON. Independent verifiers holding the same
inputs must emit the same bytes, and that is exactly the multi-producer convergence case JCS exists for —
including its rule that integer-like keys sort by UTF-16 code unit rather than numerically.

This is the *opposite* of the ATR rule, and conflating the two is the mistake worth naming. See
[atr.md](atr.md).

## Where next

- [welds.md](welds.md) — where `settledAtrHash` comes from: the carrier field on each rail, and what it
  means to recover a hash rather than compute one.
- [authority.md](authority.md) — grants, attenuation, and the custody walk in full.
- [verify README](../../../packages/verify/README.md) and
  [authority README](../../../packages/authority/README.md) — the APIs.
- [../guides/verify-a-settlement.md](../guides/verify-a-settlement.md) — the whole procedure against a real
  settlement.
