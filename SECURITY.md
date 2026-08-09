# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security report.** Public issues are visible to everyone,
including anyone who would use the finding before it is fixed.

Report privately through **[GitHub Security Advisories][advisory]** — the "Report a vulnerability" button on
this repository's Security tab. That channel is private between you and the maintainers, gives us a place to
work the fix with you, and issues a CVE when one is warranted.

[advisory]: https://github.com/IntegraLedger/integra-protocol/security/advisories/new

Please include, as far as you have it: which package and version, what an attacker gains, and the smallest
input or sequence that shows it. A failing vector is the most useful thing you can send — this codebase is
vector-gated, so a case that reproduces the problem usually becomes the regression test for the fix.

### What to expect

| | |
|---|---|
| Acknowledgement | within 3 business days |
| Initial assessment — is it a vulnerability, and how severe | within 10 business days |
| Fix or a stated plan with dates | communicated to you before any public disclosure |

We will tell you what we conclude, including when we conclude a report is **not** a vulnerability, and why.
A report that turns out to be a design decision rather than a defect still gets a written answer.

We ask for a coordinated disclosure window so a fix can reach implementers before the details are public.
We will not ask you to stay quiet indefinitely — if we cannot fix something, we will say so and you are free
to publish. Reporters who ask to be credited are credited in the advisory.

## What is in scope

This repository is the reference implementation of the **Legal Context Protocol (LCP)**, co-stewarded by
Integra Ledger and AAA-ICDR. Two kinds of finding both matter, and they are different:

**Implementation defects** — a package in `packages/` behaves unsafely: a check that can be bypassed, a
parser that can be made to crash or hang, a dependency with a known advisory reachable from our code.

**Specification defects** — the protocol itself, as written, permits an unsafe reading. These are worth
reporting even when every implementation happens to behave correctly today, because the specification is
what independent implementations are built against. A recent example, found in our own code and fixed in
both places: the attribution step proved that a record's parties had been resolved when the record named no
party and stated no resolution method. The implementation was wrong, but so was the corpus that failed to
catch it, and fixing only the first would have left every other implementation free to repeat it.

The verification surface is the sharpest area. Anything that lets a record be reported as **verified**,
**settled**, or at a **transaction class** it does not honestly support is a serious finding — the whole
point of this software is to record accurately, so a check that passes on evidence that is not evidence is
the failure mode that matters most.

## What is out of scope

- Findings in **third-party services** (registries, RPC providers, chain infrastructure) — report those to
  the operator concerned; tell us too if the exposure reaches our software.
- **On-chain risk that is a property of the rail**, not of our binding — settlement finality, reorgs, and
  fee markets are declared per rail in each binding's manifest rather than defended against.
- Reports produced solely by an automated scanner with **no demonstrated impact**. A dependency flagged by a
  tool is welcome, but say how it is reachable from our code; we check that ourselves before acting.
- **Missing hardening that is a deliberate declaration.** Where an evidentiary claim is weaker, this protocol
  states it as weaker rather than enforcing it away — `zeroPartyRecoverable: false` and
  `assetBinding: "none"` are published facts about a rail, not oversights. If you believe such a
  declaration is *inaccurate*, that IS in scope and we want to hear it.

## Supported versions

Packages are versioned independently and released together from `main`. Security fixes land on the **latest
released minor of each affected package**; there are no long-term support branches. If a fix cannot be
applied to a version you depend on, we will say so rather than imply coverage we are not providing.

## Our own practice

Automated checks run on every push: CodeQL, secret scanning with push protection, Dependabot security
updates, and `pnpm audit` inside the build gate. Two things we have learned the hard way and state here so
you can calibrate a report against them:

- **A green `pnpm audit` is not evidence that no advisory exists.** npm's database has lagged a published
  GHSA by a meaningful margin at least once. If you know a version is bad, tell us even if our tooling is
  quiet.
- **Dependabot reports `security_update_not_possible` for transitive dependencies** it cannot patch,
  because it cannot author a pnpm `overrides:` entry. We read that as "Dependabot cannot", never as
  "cannot be done", and fix those by hand.
