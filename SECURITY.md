# Security policy

## Reporting a vulnerability

Report a vulnerability privately, through GitHub's
[private vulnerability reporting](https://github.com/IntegraLedger/integra-protocol/security/advisories/new) on this
repository. Do not open a public issue or pull request for it.

Include:

- the package and its version, and the entry point or settler module involved;
- the smallest input that shows the problem, and what the package returned;
- what the problem allows, and under which conditions.

The maintainers acknowledge the report in the advisory, work on a fix with you there, and publish the advisory with
the fixed release. Credit is given to the reporter unless you ask otherwise.

## Supported versions

Security fixes are released for the latest published version of each package: `@integraledger/lcp` and the settler,
`@integraledger/profile-facilitator`.

## What counts

### In `@integraledger/lcp`

The package's one job is the binding between an ATR and a payment, so a vulnerability is anything that breaks it:

- `assemble` or `hash` giving two different results for the same bytes, or the same result for different bytes;
- `hashEquals` accepting two different hashes, or a value that is not a 32-byte hash;
- a pairing's `bound` returning a hash that the presented payment does not carry, or its `read` returning a hash or
  link the document does not advertise;
- `build` producing something to sign that does not carry the hash it was given;
- `status` or `recover` reporting a settlement, or a hash, that the rail's data does not show;
- a link that `isHttpsLink` accepts but that is not an `https` URL with a host;
- a crafted input that makes a function use unbounded memory or time, or throw where it documents a refusal.

### In the settler

The settler checks each payment against its pairing, submits what the payer signed, records each payment once in
Postgres and answers what the chain shows. A vulnerability is anything that breaks one of those:

- a payment submitted twice, or answered `success` twice;
- a payment verified or settled that lcp's checks of its pairing refuse;
- a `/verify` or `/settle` answer that differs from what the chain shows;
- a call served without the configured credential, or the settler disclosing or misusing a configured signer key or
  the database credential;
- a keyed module paying fees past its `feeBudgets` other than in the ways the settler's documentation states;
- a request that makes the settler use unbounded memory, time or fee budget.

## What does not

By design, `@integraledger/lcp` does not check amount, payee, asset, timing or payer against the ATR's content, does
not hold keys, and does not verify every signature it reads; each pairing's `data.proves` says what the payment shows.
The settler does not check that the H a payment carries is the one the resource server issued for the request, or that
the resource server has not accepted it before: those are the resource server's own records. Its operator owns its
keys, its database and its network exposure. A report that relies on one of these is not a vulnerability in this
repository.

## Bugs that are not vulnerabilities

Open a [public issue](https://github.com/IntegraLedger/integra-protocol/issues).
