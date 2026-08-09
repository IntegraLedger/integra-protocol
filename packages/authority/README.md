# @integraledger/lcp-authority

Delegated authority: whether a chain of grants actually attenuates, whether an acceptance signature holds,
and whether either was revoked or expired as of the moment that matters.

```bash
npm install @integraledger/lcp-authority
```

## Attenuation

A delegation chain is only meaningful if each link is *no wider* than the one above it. `isWithin` decides
that, dimension by dimension:

```ts
import { isWithin } from "@integraledger/lcp-authority";

const parent = {
  jurisdictions: ["US-NY", "US-CA"],
  caps: { USD: "1000000" },
  forbiddenClauseCategories: ["arbitration-waiver"],
};

isWithin({ jurisdictions: ["US-NY"], caps: { USD: "250000" },
           forbiddenClauseCategories: ["arbitration-waiver"] }, parent);            // true
isWithin({ jurisdictions: ["US-NY"], caps: { USD: "5000000" },
           forbiddenClauseCategories: ["arbitration-waiver"] }, parent);            // false — cap raised
isWithin({ jurisdictions: ["US-TX"], caps: { USD: "250000" },
           forbiddenClauseCategories: ["arbitration-waiver"] }, parent);            // false — jurisdiction never held
```

This is the predicate whose absence lets a compromised officer holding a $10k grant mint itself a $50M
link — entirely within its authority to *delegate* — while every signature and revocation check still
passes, and the verifier then affirmatively asserts the forged chain valid.

### One dimension runs the other way

`jurisdictions`, `caps` and `disputeMethods` are permission sets: a child attenuates by holding **less**.
`forbiddenClauseCategories` is a *restriction* set, so it attenuates by forbidding **more**:

```ts
import { isWithin } from "@integraledger/lcp-authority";

const parent = {
  jurisdictions: ["US-NY", "US-CA"],
  caps: { USD: "1000000" },
  forbiddenClauseCategories: ["arbitration-waiver"],
};

// Adds a prohibition — more restrictive, therefore within.
isWithin({ jurisdictions: ["US-NY"], caps: { USD: "250000" },
           forbiddenClauseCategories: ["arbitration-waiver", "venue-waiver"] }, parent); // true

// Drops the one the parent imposed — that is a WIDENING.
isWithin({ jurisdictions: ["US-NY"], caps: { USD: "250000" },
           forbiddenClauseCategories: [] }, parent);                                     // false
```

An implementer who pattern-matches subset-checking from `jurisdictions` writes that fourth rule backwards,
and the result is a silent forged-widening hole.

### Absent means unbounded, so absence does not escape

```ts
import { isWithin } from "@integraledger/lcp-authority";

declare const parent: Parameters<typeof isWithin>[1];

isWithin({ jurisdictions: ["US-NY"], forbiddenClauseCategories: ["arbitration-waiver"] }, parent);
// false — the child states no caps, and unstated is unbounded
```

Every gate is on the **parent's** side. Where a parent restricts a dimension, the child must restrict it
no wider — and a dimension the child leaves out is the widest possible value, not an exemption. This is
why the forged empty link `{}` is rejected rather than affirmed. For the same reason, a bound key the
predicate has no rule for fails closed: a dimension it cannot interpret is one it cannot check.

## Depth, and delegability

```ts
import { linkAttenuates } from "@integraledger/lcp-authority";

declare const childGrant: Parameters<typeof linkAttenuates>[0];
declare const parentGrant: Parameters<typeof linkAttenuates>[1];

linkAttenuates(childGrant, parentGrant);
```

Beyond bounds containment this enforces three things: the parent permitted delegation at all, the parent
had depth remaining, and the child did not mint itself more onward-delegation depth than the parent held.
A link descending from a depth-bounded parent must **state** its own depth — inferring `parent - 1` would
be a silent fallback that also leaves the next hop's parent depth unstated, disengaging the gate for the
rest of the chain.

`delegable` is non-delegable by default, so an omitted flag reads as refusal rather than permission.

## Lifecycle and signatures

`isActiveAsOf` and `revokedAsOf` evaluate validity against the settlement's own timestamp, not against
now — a grant that expired last week was valid at the moment it was used, and a grant revoked since then
was not. Expiry and revocation are independent gates: a grant that expired before settlement is exactly
as unusable as one revoked at it.

`verifyAcceptance` checks a buyer's signed acceptance over the fingerprint through an injected
`SignatureVerifier` port, so this package carries no chain dependency. The EVM implementation — EOA
EIP-191/712 plus smart-account ERC-1271/6492 — is in [`@integraledger/lcp-binding-evm-common`](../binding-evm-common#readme).

## Chain custody

Attenuation says a chain's *bounds* are coherent. Custody says the chain is *one chain*: each link
signed by the key the link above it granted, rooted at the declared principal, ending at the key that
signed the acceptance. `walkChain` verifies all of it over the presented VC grants:

```ts
import { walkChain } from "@integraledger/lcp-authority";

type WalkInput = Parameters<typeof walkChain>[0];
declare const principal: WalkInput["principal"];
declare const chain: WalkInput["chain"];
declare const acceptanceSigner: WalkInput["acceptanceSigner"];
declare const asOf: WalkInput["asOf"];
declare const statusSnapshots: NonNullable<WalkInput["statusSnapshots"]>;
declare const proofVerifier: Parameters<typeof walkChain>[1];

const walk = await walkChain(
  { principal, chain, acceptanceSigner, asOf, statusSnapshots },
  proofVerifier, // a GrantProofVerifier — cryptosuite implementations live with their producers
);
// { status: "walked", links }         — verified custody, flattened per-hop readout
// { status: "refused", code, … }      — a spliced link, a forged widening, a revoked grant …
// { status: "not-attempted", depth }  — an unwalkable input; a gap never passes and never impeaches
```

A spliced middle link, a root issued by someone other than the principal, a leaf granted to anyone but
the acceptance signer, a proof that does not cover the grant as presented — each is a reasoned refusal.
Everything `linkAttenuates` gates at issuance is applied per hop, and lifecycle is evaluated **as-of the
settlement instant** against hash-pinned status-list snapshots, never a live dereference. The
cryptographic proof gate is the injected port's; `walkChainStructure` is the deterministic half the
conformance corpus certifies.

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
