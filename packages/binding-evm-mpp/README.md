# @integraledger/lcp-binding-evm-mpp

Welds an LCP record to an [MPP](https://paymentauth.org) settlement on EVM, by **Id-Reuse** (LCP §8.3.5): the seller
sets `challenge.id = atrHash`, and MPP's own required derivation carries it into the transaction.

**This is the one binding in the family that differs at the weld.** On MPP's EVM charge method there is no
field for us to occupy — the EIP-3009 nonce is a derivation MUST and the Permit2 witness type string is
fixed. So nothing is placed; an input is supplied, and the host protocol does the binding.

```bash
npm install @integraledger/lcp-binding-evm-mpp
```

| | |
|---|---|
| **Rail** | `evm:mpp` |
| **Protocol** | `mpp` |
| **Pattern** | `id-reuse` (LCP §8.3.5, Tier A) |
| **Weld** | `nonce = keccak256(abi.encodePacked(challenge.id, challenge.realm))`, with `challenge.id = atrHash` |
| **Credential-type scope** | MPP's **`authorization`** type only (§5.3) — see below; the other three are out of scope by construction |
| **On-chain artifact** | `AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)` |
| **Recovery triple** | *within that scope* — on-chain **yes**; zero-party recoverable **no**; forward-indexable **no** |
| **Weld grade** | `weldGrades: { authorization: "signature" }` — the payer's EIP-3009 message covers the nonce |
| **Surface** | `createMppEvmAdapter` returning [`@integraledger/lcp-binding-core`](../binding-core#readme)'s `WeldAdapter` over a `ChainReader`, built on [`@integraledger/lcp-binding-evm-common`](../binding-evm-common#readme) |
| **Spec** | `draft-evm-charge-00` + the core `Payment` scheme, gate discharged **2026-07-30** |

## Use

```ts
import { createMppEvmAdapter } from "@integraledger/lcp-binding-evm-mpp";
import type { VerifierPorts } from "@integraledger/lcp-binding-core";

declare const USDC: `0x${string}`;    // the settlement token address on this chain
declare const atrHash: `0x${string}`; // the record's atrHash
declare const txHash: `0x${string}`;  // the settlement transaction
declare const ports: VerifierPorts;   // caller-supplied chain access

const adapter = createMppEvmAdapter({ chainId: 84532, asset: USDC, realm: "api.example.com" });

// SELLER, at proposal: challenge.id IS the atrHash; the nonce follows by MPP's rule.
// `propose` returns an Outcome — a refusal is a RETURNED VALUE, never a thrown exception, which is this
// family's central contract. Narrow before reading; destructuring `.value` straight off the union is the
// one handling of this type that does not compile.
const proposed = await adapter.propose(atrHash);
if ("refused" in proposed) throw new Error(proposed.detail); // or route on proposed.code
const binding = proposed.value;                     // { challengeId, realm, nonce }

// AUDITOR, after settlement: bring the atrHash, the chain confirms it.
await adapter.verifyCandidate(atrHash, { chainId: 84532, txHash }, ports);
```

## Specification provenance — verified against the live host, 2026-07-30

Read against the host protocol's own live specifications, not LCP's Appendix C.

**EVM charge method — `draft-evm-charge-00` (paymentauth.org, read 2026-07-30).**

1. **§5.3.1 — the derivation.** `nonce = keccak256(abi.encodePacked(challenge.id, challenge.realm))`, with
   "This specification requires the nonce to be set to the `challengeHash`" and "This provides cryptographic
   challenge binding equivalent to the Permit2 witness mechanism." The nonce is a **derivation, not a slot**.
2. **§5.2.3 — Permit2 is closed too.** The witness type string is given literally
   (`PaymentWitness witness)PaymentWitness(bytes32 challengeHash, string externalId)…`) with
   "Implementations MUST use the exact type string above when constructing the EIP-712 typed data." There is
   no room for an LCP field on the Permit2 path either.
3. **§4.2 / Table 2 — `methodDetails` is constrained**, not an open map: `chainId` and `permit2Address`
   REQUIRED, `credentialTypes`, `decimals` and `splits` OPTIONAL, and the document states no allowance for
   arbitrary keys. This is why the EVM method gets a *binding* and the open-map placement lives in
   `placement-mpp` instead.
4. **§8 — replay protection is the token's.** "The nonce is consumed on-chain by the token contract itself";
   a consumed nonce cannot be reused. Our binding adds no replay machinery and must not appear to.

**Core scheme — the `Payment` HTTP authentication scheme (read 2026-07-30).**

5. **§5.1.1 — `id` is required to be unique** ("Unique challenge identifier. Servers MUST bind this value to
   the challenge parameters… Clients MUST include this value unchanged in the credential"), and `realm` is a
   MUST ("Protection space identifier per [RFC9110]"). The uniqueness requirement is satisfied the way
   LCP §8.3.5 prescribes: each ATR is unique per transaction, so each `challenge.id` is too.
6. **§5.1.1 — `id` has no declared format.** Its examples are opaque strings (`"aB3cDeF4gHiJkLmN"`), so an
   `0x`-prefixed 32-byte atrHash is a conformant id. Nothing about Id-Reuse asks MPP to accommodate us.
7. **§5.1.2.1.1 Table 2 — the seven-slot canonicalization** is `realm, method, intent, request, expires,
   digest, opaque`. `id` is *not* a slot; it is bound by the server per §5.1.1 and by the EVM method's
   derivation, which is what makes the weld hold without touching the canonicalization.

**Two drifts found, recorded rather than smoothed over.**

- **The core draft's identifier.** LCP v1.37 §C.1 cites
  `draft-ryan-httpauth-payment-01` (the IETF individual submission). paymentauth.org's own document index
  publishes the core scheme as **`draft-httpauth-payment-00.html`**. Both were read for this gate; they agree
  on §5.1.1 and on the seven slots. Treat the paymentauth.org copy as the live one — it is the family's own
  publication point — and the datatracker submission as its IETF mirror.
- **`challenge.id` uniqueness is a CORE requirement, not an EVM-method one.** `draft-evm-charge-00` states no
  uniqueness rule of its own; §8's replay protection is the token contract's. An implementer reading only the
  method spec would not find the constraint that makes Id-Reuse safe.

**Per-method scope.** MPP is a specification *family*, and this gate covers the **EVM** charge method only.
Tempo's TIP-20 memo is a different and much stronger realization and gets its own package and its own gate.

## Credential-type scope — read this before trusting `recovery.onChain`

MPP's EVM method defines **four** credential types (§5), and the derived `challengeHash` reaches the chain in
**exactly one** of them. Everything this profile declares is scoped to that one, and both the machine-readable
declaration and the runtime behaviour say so.

| Credential type | Where the `challengeHash` lives | Readable from a settlement? |
|---|---|---|
| **`authorization`** (§5.3) — opt-in, EIP-3009 tokens only | the **on-chain** EIP-3009 nonce (§5.3.1) | **yes** — this binding's whole surface |
| `permit2` (§5.2) — **RECOMMENDED** | the EIP-712 `PaymentWitness` the client signs (§5.2.3, §10.4) | no — signed, never in calldata or a log |
| `transaction` (§5.4) | nowhere — no challenge binding (§10.4) | no |
| `hash` (§5.5) | nowhere — no challenge binding (§10.4) | no |

Two consequences, both deliberate:

- **`weldGrades` is keyed by MPP's own credential-type name** — `{ authorization: "signature" }`, not a coinage
  like `derived`. The key *is* the scope, machine-readably, and `finality.note` repeats it in prose for a
  consumer who reads only the published profile JSON. Grading `permit2` would be declaring from the
  specification rather than from this binding: the package constructs no witness. `transaction` and `hash` have
  no weld to grade at all.
- **The adapter enforces the same scope at runtime.** A settlement that moved the configured token but emitted
  no `AuthorizationUsed` really did settle — under one of the other three types — so `verifyCandidate` and
  `observe` both refuse `mpp-evm/not-authorization-credential-type` rather than report an absence. Reporting
  `{ ok: true, value: [] }` there would be a silent wrong answer at a verification boundary. Only when the
  token did not move either is the honest answer "this transaction settled none of this asset"
  (`mpp-evm/no-settlement-event` / an empty transition list, reached without reading a block).

**`recovery.onChain: true` is still declared from the specification, not yet from a live settlement.** Two of
the triple's three members are observable without a chain — `zeroPartyRecoverable: false` because no code path
maps a settlement to an atrHash (`recover` refuses and takes no arguments), `forwardIndexable: false` because no
`enumerate` exists — but the on-chain member needs a real `AuthorizationUsed`. `test/integration.onchain.test.ts`
reads exactly that and is **skipped until `MPP_EVM_SETTLEMENT_TX` names one**. Until it runs, treat that single
member as owed.

## The weld, and the only check it permits

`verifyCandidate` is the primary surface, and it is a **confirmation**, not a lookup. The on-chain value is
keccak-256 over the atrHash and the realm, so:

- **`recover` refuses, always**, with `mpp-evm/not-recoverable-by-construction`. It is present because a
  generic `WeldAdapter` consumer will reach for it and must be told loudly; it is typed `Promise<Refusal>` so
  the impossibility is visible before the call, and it takes **no arguments** because there is no input a
  recovery could read.
- **There is no `enumerate`.** Absence is the declaration, matching `forwardIndexable: false`.
- **Re-deriving from a stored challenge would be a defect, not a feature.** That is the service's own records
  re-labelled; it would falsify `zeroPartyRecoverable: false`, and it is the one edit this package must never
  accept.

### Why `forwardIndexable: false` when the nonce is an indexed topic

§8.3's criterion is enumeration of every settlement bound to **a given `atrHash`**, and §8.3.5 answers it
directly: "Not forward-indexable by `atrHash` alone — the on-chain value is a hash over `atrHash` and other
inputs." An auditor who *also* knows the realm can derive the nonce and topic-filter it — but that is
realm-scoped, and it is degenerate anyway: §8.3.5's uniqueness satisfaction makes each ATR unique per
transaction, so there is at most one settlement per atrHash to find. Hence `indexing: "none"`.

## Do not reconcile this manifest with `binding-evm-x402`'s

They bind the *same* EIP-3009 nonce field and they legitimately disagree. x402 leaves the nonce unconstrained,
so the atrHash rides it directly — off-canonical Native Field, zero-party recoverable. MPP-EVM *derives* the
nonce, so the same field carries a hash of the atrHash — Id-Reuse, confirmation only. `binding-evm-x402`'s
manifest carries a KNOWN-BAD note about an archived declaration that read MPP's derivation-MUST onto the x402
path; **this package is where that reading is correct.** Making either manifest resemble the other
reintroduces the bug.

The same rule holds down to the error messages. `binding-evm-common`'s `assertBytes32` enforces the right 32
bytes but explains them as the value that will "ride as the EIP-3009 nonce" — true on x402, false here — so
`bindAtrHash` carries **its own guard**: on this rail the atrHash rides `challenge.id`, and the nonce is derived
from it, never occupied by it.

## Provenance

Cut against `draft-evm-charge-00` and the core `Payment` scheme at paymentauth.org, gate discharged
2026-07-30, and reconciled against LCP v1.37 §C.1 and §8.3.5 the same day. The derivation oracles in
`vectors/binding/mpp-evm-id-reuse.json` were produced by two independent keccak-256 implementations
(pycryptodome and Foundry `cast keccak`), and `abi.encodePacked`'s string semantics were confirmed against
Foundry's own encoder — neither of them the implementation under test.

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
