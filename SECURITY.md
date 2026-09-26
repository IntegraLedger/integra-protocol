# Security policy

## Reporting a vulnerability

Report a vulnerability privately, through GitHub's
[private vulnerability reporting](https://github.com/IntegraLedger/integra-protocol/security/advisories/new) on this
repository. Do not open a public issue, pull request or discussion for it.

Include:

- the package version and the entry point involved;
- the smallest input that shows the problem, and what the package returned;
- what an attacker gains, and under which conditions.

The maintainers acknowledge the report in the advisory, work on a fix with you there, and publish the advisory with
the fixed release. Credit is given to the reporter unless you ask otherwise.

For a bug that is not a vulnerability, open a [public issue](https://github.com/IntegraLedger/integra-protocol/issues).

## Supported versions

Security fixes are released for the latest published version of `@integraledger/lcp`.

## What counts

The package's one job is the binding between an ATR and a payment, so a vulnerability is anything that breaks it:

- `assemble` or `hash` giving two different results for the same bytes, or the same result for different bytes;
- `hashEquals` accepting two different hashes, or a value that is not a 32-byte hash;
- a pairing's `bound` returning a hash that the presented payment does not carry, or its `read` returning a hash or
  link the document does not advertise;
- `build` producing something to sign that does not carry the hash it was given;
- `status` or `recover` reporting a settlement, or a hash, that the rail's data does not show;
- a link that `isHttpsLink` accepts but that is not an `https` URL with a host;
- a crafted input that makes a function use unbounded memory or time, or throw where it documents a refusal.

## What does not

By design, the package does not check amount, payee, asset, timing or payer against the ATR's content, does not hold
keys, and does not verify every signature it reads; each pairing's `pattern.proves` states which signatures the rail
or network verifies. A report that relies on one of these is not a vulnerability in this package.
