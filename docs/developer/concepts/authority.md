# Authority

A record says a buyer accepted terms. Authority is the question underneath: **was the key that signed
actually allowed to?**

Answering it takes three separate things, and confusing them is where the holes are. *Attenuation* asks
whether a chain's bounds are coherent — no link wider than the one above it. *Custody* asks whether the
links are one chain at all rather than unrelated assertions. *Lifecycle* asks whether each link was live at
the moment it was used. A chain can pass any two and fail the third.

[`@integraledger/lcp-authority`](../../../packages/authority/README.md) implements all three. It carries no
chain dependency: every cryptographic check is an injected port.

## The artifact

An authority artifact is an **ATA grant** — a W3C Verifiable Credential 2.0 with a Data Integrity proof.
Its `credentialSubject` states who holds the authority and what it covers:

| Field | What it says |
|---|---|
| `id` | the subject the grant is issued to |
| `bounds` | the four dimensions of what may be committed |
| `delegable` | may this be delegated onward? **Default `false`** — an omitted flag reads as refusal |
| `maxDepth` | how many further links may extend below this one (`0` = leaf) |

Beside the subject sit `issuer`, the VC 2.0 lifecycle window `validFrom`/`validUntil`, an optional
`credentialStatus` (a Bitstring Status List v1.0 entry), and the `proof`.

A **delegation link** is the same document re-issued narrower: the parent's subject becomes the child's
issuer, and the child's bounds must be contained by the parent's.

## Bounds, and the dimension that runs backwards

`isWithin(child, parent)` decides containment dimension by dimension. Four dimensions, and the fourth is
the one an implementer gets wrong:

| Dimension | Rule |
|---|---|
| `jurisdictions` | child ⊆ parent — a permission set attenuates by holding **less** |
| `caps` | child ≤ parent, per currency, decimal-integer base-unit strings |
| `disputeMethods` | child ⊆ parent — an acceptable-methods set narrows |
| `forbiddenClauseCategories` | child ⊇ parent — a **restriction** set attenuates by forbidding **more** |

A child that *drops* a category its parent forbade has widened. An implementer who pattern-matches subset
checking from `jurisdictions` writes that fourth rule backwards, and the result is a silent
forged-widening hole.

Two rules make the predicate fail closed rather than fail quietly:

- **Absent means unbounded.** Every gate is on the *parent's* side: wherever the parent restricts a
  dimension, the child must restrict it no wider — and a dimension the child leaves out is the widest
  possible value, not an exemption. This is what refuses the forged empty link `{}` rather than treating it
  as inheriting.
- **An unknown dimension refuses.** A bound key the predicate has no rule for is one it cannot check, so
  the whole comparison answers `false`.

This is the predicate whose absence lets a compromised officer holding a $10k grant mint itself a $50M
link — entirely within its authority to *delegate* — while every signature and revocation check still
passes, and the verifier then affirmatively asserts the forged chain valid.

## Delegability and depth

`linkAttenuates(child, parent)` adds three gates on top of bounds containment: the parent permitted
delegation at all, the parent had depth remaining, and the child did not mint itself more onward-delegation
depth than the parent held.

A link descending from a depth-bounded parent must **state** its own depth. Absent means unbounded, so
omitting it is the same escalation as overstating it — and reading it as `parentDepth - 1` instead would be
a silent fallback that also leaves the *next* hop's parent depth unstated, disengaging the gate for the
rest of the chain.

Attenuation is a property of the authority to delegate, not only of what is delegated. Without the depth
comparison, a holder of a `maxDepth: 1` grant could issue a `maxDepth: 99` link, every pairwise bounds
check would pass, and the chain would extend arbitrarily deep below a parent that authorized one more hop.

## The custody walk

Attenuation says a chain's bounds are coherent. It says nothing about whether the links belong together.
`walkChain` establishes that they do, in this order:

1. **Continuity.** The root is issued by the declared principal and signed by the issuer's key. Every later
   link is signed by its parent's subject key and states that subject as its issuer. Without this the chain
   is unrelated assertions and anyone can splice a link in.
2. **Signed bytes match the presented link.** The proof must verify over the grant *as presented*, through
   an injected `GrantProofVerifier`, so the visible grant and the signed grant cannot differ.
3. **Leaf binding.** The leaf subject's key must be the acceptance signer.
4. **Attenuation per hop.** Everything `linkAttenuates` gates at issuance, applied verbatim at
   verification. The verdict *is* `linkAttenuates`'s — one implementation, so a producer and a verifier
   cannot diverge; the per-gate refusal codes only name which gate it was.
5. **Lifecycle as of settlement.**

Identifier equality is exact, with one bridge: `did:pkh` is the DID method whose final `:`-segment *is* the
account identifier, so a leaf `did:pkh:eip155:…:0xabc` binds the scheme-canonical signer `0xabc`. Producers
of any other identifier form must grant to the signer's exact identifier.

`walkChainStructure` is the deterministic half — everything above except the proof gate. It is what the
conformance corpus certifies cross-implementation, and it is what a subject with no cryptosuite can still
run. `walkChain` composes the port on top.

### Three readouts, and none of them is a boolean

```text
{ status: "walked",        links }              verified custody, flattened per hop
{ status: "refused",       haltClass, code, detail }
{ status: "not-attempted", depth }
```

A chain that **contradicts itself** is `refused`, carrying `verification-failure` and a code naming the
defect — `walk/spliced-link`, `walk/issuer-discontinuity`, `walk/widened-bounds`,
`walk/parent-not-delegable`, `walk/depth-escalation`, `walk/revoked-link`, `walk/inactive-link`,
`walk/leaf-not-signer`, `walk/proof-invalid`, and the two root cases `walk/root-not-principal` and
`walk/root-key-mismatch`.

A chain that is **unwalkable** is `not-attempted`, carrying the reason as a `depth` string —
`no-authority-chain`, `empty-authority-chain`, `malformed-authority-chain`, `unproven-link`,
`no-status-snapshot`, and the rest. A gap never passes and never impeaches.

The walk is total over untrusted wire input. A malformed element is a gap, never a crash and never a
refusal: the caller's shape error says nothing about whether the chain is self-consistent.

## Revoked and active are stated, never defaulted

Both are **required** fields on a walked link, and the requirement is the whole point.

- **`active`** is expiry — `validFrom` ≤ `asOf` < `validUntil`, evaluated at the settlement instant. A
  grant that expired before settlement is exactly as unusable as one revoked at it. Two independent gates,
  not one.
- **`revoked`** is read from a **hash-pinned status-list snapshot captured at settlement**. A Bitstring
  Status List has no historical query: dereferencing it live yields *today's* list, and presenting today's
  answer as history would be a different claim than the one being made.

Revocation is three-way rather than boolean, and the third arm is where the honesty lives. The bit set →
`walk/revoked-link`, a refusal. The bit clear → the walk proceeds. **Anything else is a gap**: a snapshot
that was never supplied (`no-status-snapshot`), one that will not decode (`unreadable-status-snapshot`), an
index past the end of the bitstring (`status-index-out-of-range`), a malformed status entry
(`malformed-credential-status`), and a `statusPurpose` other than `revocation`
(`unsupported-status-purpose`) — because a bit set under `suspension` is not a revocation, and reading it
as one would refuse a chain over a state this walk has no semantics for. None of those can pass, and none
of them can impeach.

Which is why a link that reaches the readout always states `revoked: false` and `active: true`: a revoked
or expired link was refused before any readout existed, and a grant carrying no `credentialStatus` at all
has no status entry to check. The readout is a statement of what the walk *did*, not a default.

Downstream, `verify`'s authority step reads exactly those two fields and treats `revoked === true` and
`active === false` as impeaching. Requiring them on the type is what makes the unstated case a **compile
error at the call site**: "the caller never consulted a status list" and "the walk checked the pinned
snapshot and the grant is unrevoked" would otherwise be the same absent value, and one of them proves. A
caller that walks first satisfies both for free; only a hand-flattener feels it, which is the intent. The
runtime agrees with the type rather than quietly forgiving it: the step stays total over untyped input, and
an absent `revoked` reads `not-attempted` with depth `no-revocation-stated`, an absent `active`
`no-liveness-stated`, and a non-boolean in either slot `malformed-authority-chain`. A contradiction still
outranks a gap — a link that both widens its parent and states no status fails, because attenuation is
checked first. See
[verification-walk.md § Authority chain custody](verification-walk.md#authority-chain-custody).

## A chain that walks, and one that does not

The chain below is two hops. The officer's grant permits delegation two levels deep and caps USDC spend at
5,000,000 base units; the agent's link narrows that cap, adds a forbidden clause category, and forbids
onward delegation.

```ts
import type { AtaGrant } from "@integraledger/lcp-authority";
import { walkChainStructure } from "@integraledger/lcp-authority";

const officer = "did:pkh:eip155:84532:0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const agent = "did:pkh:eip155:84532:0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

const root: AtaGrant = {
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  type: ["VerifiableCredential", "AtaGrant"],
  issuer: "did:web:acme.example",
  validFrom: "2026-07-01T00:00:00Z",
  validUntil: "2027-07-01T00:00:00Z",
  credentialSubject: {
    id: officer,
    bounds: {
      jurisdictions: ["US-DE"],
      caps: { USDC: "5000000" },
      forbiddenClauseCategories: ["indemnity-waiver"],
    },
    delegable: true,
    maxDepth: 2,
  },
  proof: {
    type: "DataIntegrityProof",
    verificationMethod: "did:web:acme.example#key-1",
    proofPurpose: "assertionMethod",
    proofValue: "z-root",
  },
};

const link: AtaGrant = {
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  type: ["VerifiableCredential", "AtaDelegation"],
  issuer: officer, // the parent's SUBJECT is the child's issuer — that is continuity
  validFrom: "2026-07-01T00:00:00Z",
  validUntil: "2027-01-01T00:00:00Z",
  credentialSubject: {
    id: agent,
    bounds: {
      jurisdictions: ["US-DE"],
      caps: { USDC: "1000000" }, // narrower
      forbiddenClauseCategories: ["indemnity-waiver", "class-action-waiver"], // MORE forbidden
    },
    delegable: false,
    maxDepth: 0,
  },
  proof: {
    type: "DataIntegrityProof",
    verificationMethod: `${officer}#key`, // signed by the PARENT's subject key
    proofPurpose: "assertionMethod",
    proofValue: "z-link",
  },
};

const input = {
  principal: "did:web:acme.example",
  chain: [root, link],
  acceptanceSigner: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  asOf: "2026-07-20T00:00:00Z", // the settlement instant — never "now"
};

const walk = await walkChainStructure(input);
console.log(walk.status);
if (walk.status === "walked")
  for (const l of walk.links) console.log(JSON.stringify(l));

// Drop a category the parent forbade. Every signature still verifies; the chain is still continuous.
const widened: AtaGrant = {
  ...link,
  credentialSubject: {
    ...link.credentialSubject,
    bounds: { ...link.credentialSubject.bounds, forbiddenClauseCategories: [] },
  },
};
const forged = await walkChainStructure({ ...input, chain: [root, widened] });
if (forged.status === "refused")
  console.log(forged.status, forged.haltClass, forged.code);

// Re-sign the same link with a key the parent never delegated to.
const spliced: AtaGrant = {
  ...link,
  proof: {
    type: "DataIntegrityProof",
    verificationMethod: "did:web:attacker.example#key",
    proofPurpose: "assertionMethod",
    proofValue: "z-link",
  },
};
const cut = await walkChainStructure({ ...input, chain: [root, spliced] });
if (cut.status === "refused") console.log(cut.status, cut.code);
```

```text
walked
{"bounds":{"jurisdictions":["US-DE"],"caps":{"USDC":"5000000"},"forbiddenClauseCategories":["indemnity-waiver"]},"parentBounds":{},"parentDelegable":true,"maxDepth":2,"revoked":false,"active":true}
{"bounds":{"jurisdictions":["US-DE"],"caps":{"USDC":"1000000"},"forbiddenClauseCategories":["indemnity-waiver","class-action-waiver"]},"parentBounds":{"jurisdictions":["US-DE"],"caps":{"USDC":"5000000"},"forbiddenClauseCategories":["indemnity-waiver"]},"parentDelegable":true,"parentMaxDepth":2,"maxDepth":0,"revoked":false,"active":true}
refused verification-failure walk/widened-bounds
refused walk/spliced-link
```

Read the root link's readout: its `parentBounds` is `{}` and its `parentDelegable` is `true`. The root's
parent is synthesized as the principal's own authority — unbounded in every dimension, and inherently
delegable, because issuing the root grant *is* the act of delegating it. That is what lets a single direct
grant read out as one link rather than as an empty, unprovable chain.

Then read the two refusals. The widened link is genuinely issued and signed by the officer and its
continuity is intact; only the inverted dimension catches it. The spliced link's bounds attenuate
perfectly; only continuity catches it. Neither check subsumes the other.

## Acceptance

The other half of the package answers a narrower question: did the buyer sign *this* fingerprint?

`verifyAcceptanceStructure` is pure and substrate-free — the acceptance must bind the expected ATR hash
(case-insensitively, the ATR canon), and where a commitment and leaf bounds are supplied the commitment
must be contained by the leaf grant. `verifyAcceptance` composes the cryptographic gate on top through an
injected `SignatureVerifier`.

The scheme is namespaced `<family>:<method>` — `evm:eip191`, `evm:eip712`, `evm:erc1271`, `evm:erc6492`
today, implemented by [`binding-evm-common`](../../../packages/binding-evm-common/README.md). The set is
open: a new rail introduces its schemes with its port and this package does not change. Fail-closed
survives the openness because it lives in the port contract — a verifier refuses schemes it does not
implement, exactly as `isWithin` refuses bound dimensions it has no semantics for. The namespace is
mandatory: an un-namespaced scheme names no family, so no port is answerable for it.

Both `walkChain` and `verifyAcceptance` emit exactly one halt class, `verification-failure`. Neither
decides a policy and neither raises a risk signal; see [verification-walk.md](verification-walk.md) for
what the walk does with either.

## The identity floor

A chain of grants says what a key may commit. It says nothing about *who* is behind the key, and the
package keeps the two apart rather than merging them.

An `IdentityResolution` names the signing key, a **stated assurance** — `wallet-signature-only`,
`domain-controlled`, `attested`, `legal-party` — and an ordered chain of steps walking from the key toward
an accountable party. Each step names *how* it resolves (`key`, `domain-control`, `attestation`, `grant`,
`legal-party`) rather than a specific attestation format, so the chain is open to substrates this version
has never heard of. `terminatesInAccountableParty` asks whether the chain ends in more than a bare key;
`isConsequentialConformant` adds the assurance gate on top.

Neither is a step of the walk, and that is deliberate. A record that honestly states
`wallet-signature-only` is conformant *at its level*, and whether that level is good enough is a buyer's
policy question rather than a property of the record's class. The walk's `resolve-party` step therefore
checks only that both parties resolve at a stated assurance over a non-empty chain, and stops there. The
whole discipline is that the low level stated honestly passes while an unstated level does not.

## What this is not

- **Not an identity system.** A grant says what a subject may commit, not who they are. The predicates
  above are the floor a buyer's own policy applies; nothing here decides whether a counterparty is
  acceptable.
- **Not a revocation service.** This package reads a snapshot it is handed. It never dereferences a status
  list, because a live dereference cannot answer a question about the past.
- **Not a cryptosuite.** Proof and signature verification are ports. Implementations live with their
  producers.

## Where next

- [verification-walk.md](verification-walk.md) — how a walk readout becomes the `authority-attenuation`
  step, and why the walk-fed door is the one to use.
- [atr.md](atr.md) — the fingerprint an acceptance signs.
- [evidence.md](evidence.md) — the `authority chain` and `status-list-snapshot` roles a retained package
  carries.
- [authority README](../../../packages/authority/README.md) — the API in full.
