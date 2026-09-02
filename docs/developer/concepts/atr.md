# The ATR

An **ATR** — Agentic Transaction Record — is the standalone artifact whose SHA-256, taken over its exact
bytes, is the **ATR hash**: the fingerprint a settlement carries and a verifier recomputes.
`@integraledger/lcp-kernel` mints one as JSON: its `terms` slot carries the agreement inline, or
incorporates it by content-addressed reference.

Everything else in this repository rides on that one property. A binding welds the hash into a settlement;
the walk recomputes it and compares. Neither can be stronger than the record, so the record is defined
first and defined narrowly.

The record format is the specification's, published at
[legalcontextprotocol.org/standard](https://legalcontextprotocol.org/standard). This page describes what
`@integraledger/lcp-kernel` implements; where the two disagree, the specification is right.

## One document, assembled from slots

You do not hand `assemble` an object. You hand it an ordered list of **slots**, each a name with an inline
value or a content reference, and it compiles them into the ATR:

```ts no-check
const { atrBytes, atrHash } = await assemble([
  { slot: "terms", ref: "lcp:sha256:0x…" },
  { slot: "id", value: "0x…" },
]);
```

The difference matters because the engine controls the emitted document. It stamps the ATR format
version (`atr`) first, refuses `atr` as a caller's slot, and refuses integer-like slot names — JavaScript
serializes integer-like keys ahead of everything else regardless of insertion order, so a slot named `"1"`
would jump in front of `atr` and change the bytes. Slot names it does not recognize are preserved
verbatim, so the format is open at the edges while the parts that fix the byte layout are not.

Two slots are required and must be non-empty strings: `terms` and `id`. Beyond those the record carries
optional slots the specification names — `identity`, `spendAuthority`, `acceptanceAuthority`, `intent`,
`offer`, `regime`, `standingTrust`, `recourse`, `declarations`, `caps` — and preserves anything else.

Each refusal has its own code, because "the record is malformed" is not an actionable message. The full
table is in the [kernel README](../../../packages/kernel/README.md); the shape of it is that every guard
fails loudly rather than guessing.

## `value` or `ref` — exactly one

A slot carries **exactly one** of:

- **`value`** — the slot's content, inline, as JSON.
- **`ref`** — an `lcp:sha256:` content reference to bytes held elsewhere.

Both, or neither, is a typed refusal (`assemble/slot-shape`) rather than a guess about which the
caller meant. A `ref` must match the exact form `lcp:sha256:0x` followed by 64 hex characters; anything
else is `assemble/bad-ref`.

`terms` is the slot where this choice is usually made. Inline prose is a legitimate record. But a content
reference lets the terms be *any bytes at all* — a Markdown agreement, a countersigned PDF, a ratified
template — while the record still names them unambiguously, because the reference is the SHA-256 of those
bytes. A mutable link would not do: it names a location, and the location can change under you.

One slot has a content rule rather than a shape rule. `caps` is the machine-decided slot, and raw JSON
numbers in it are refused (`assemble/caps-raw-number`): monetary amounts are decimal-integer strings of
base units. `1e+21` is a byte-unstable serialization of a number, and past 2^53 the number is lossy
besides — neither is a thing to carry an amount in.

## Canonical bytes

`assemble` emits the document once, as UTF-8 bytes, and hashes those bytes. `hashAtr` hashes whatever
bytes it is handed, **exactly as handed** — it does not re-assemble them, re-order their keys, or
canonicalize them in any way.

That is deliberate, and it is the opposite of the rule this repository applies to a verification *report*,
which is canonicalized with RFC 8785 before hashing. The two cases differ in exactly one respect that
decides everything:

| | ATR | Verification report |
|---|---|---|
| Producers | one | many, independently |
| So the bytes are | authoritative as received | recomputed by each verifier |
| Therefore | hash them as handed | canonicalize, then hash |

An ATR has one producer, and the received bytes *are* the fingerprint — they are what a payer's signature
covered. A verifier that canonicalized them before hashing would be hashing something the payer never
signed, and would then report a mismatch as a forgery or, worse, report a match for a document that had
been reshaped in transit. A report has many producers who must converge on identical bytes, which is
precisely the case RFC 8785 exists for.

Byte-exactness is why the kernel offers `normalizeTerms` and never calls it. Normalizing line endings and
Unicode form is a sensible thing to do to a terms document at *authoring* time, before it is fingerprinted.
Doing it at hashing time would silently change what the record says.

## Two hashes, and they are not the same hash

This is the confusion worth heading off, because both are SHA-256 and both appear on the same record.

- The **`terms` reference** — `lcp:sha256:0x…` — is a content reference to an **input**: the hash of the
  terms document's own bytes. It points *outward*, at an artifact the record does not contain.
- The **ATR hash** is the hash of the **assembled record**: the ATR, with the terms reference already
  inside it, serialized to bytes. It names the record itself, and it is what a settlement carries.

Change the terms document and the reference changes, which changes the record's bytes, which changes the
ATR hash. Change the `id` and only the ATR hash changes. They are related by construction and equal never.

## Recomputability

The property everything downstream rides on is this one:

```text
hashAtr(atrBytes) === atrHash
```

Anyone holding the ATR bytes can recompute the fingerprint, with no access to the producer, no service to
call, and no trust in whoever handed them the bytes. That is what makes the walk's `atr-fingerprint` step
a comparison rather than an appeal to authority, and it is what makes a weld checkable by a party who was
not present at settlement.

`assemble` is pure over its slots — same slots in, same bytes out — so the recomputation is not
a re-run of the producer's process. It is a hash of bytes.

## Assembled, and checked

This record uses both slot forms: `terms` is a `ref`, and everything else is inline.

```ts
import { assemble, hashAtr, isAtrHash, isRef, parseRef } from "@integraledger/lcp-kernel";

// A content reference to an INPUT: the SHA-256 of the terms document's own bytes.
const termsRef =
  "lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30";
console.log(isRef(termsRef)); // true — the exact form assemble accepts

const { atrBytes, atrHash } = await assemble([
  { slot: "terms", ref: termsRef }, // ref: the terms document lives outside the record
  { slot: "id", value: "0xcfd11a6df93dae9b9ff76196eadf0939" }, // inline
  {
    slot: "parties",
    value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" },
  }, // inline
  { slot: "caps", value: { USDC: "25000000" } }, // inline — base units, as a string
  {
    slot: "recourse",
    value: { governingLaw: "US-NY", forum: "Arbitration Forum" },
  }, // inline
]);

console.log(new TextDecoder().decode(atrBytes));

// Two hashes, two different things.
console.log(parseRef(termsRef).hash); // the INPUT's hash — what `terms` points at
console.log(atrHash); // the RECORD's hash — what a settlement carries
console.log(parseRef(termsRef).hash === atrHash); // false

console.log(isAtrHash(atrHash)); // true
console.log((await hashAtr(atrBytes)) === atrHash); // true — recomputable from the bytes alone
```

<!-- SUPERSEDED PIN (2026-08-07): the record hash below was
     0xaacf7dcf7eba02d99d14b12d7deab4e0ad255f6b796305c04f9afdaef9ac9973 over a forum of "AAA-ICDR";
     the example forum was generalized (illustrative examples name no provider) and the new hash
     re-derived independently (python hashlib over the printed one-line bytes).
     SUPERSEDED PIN (2026-09-02): 0x3c7ac77760fe1c8d603dbd0554156390b4625df2de902f068da4f135f453f93b over a record whose first member was
     "lcp":"0.3"; the format-version member was renamed to `atr` and the new hash re-derived the same
     way. -->
```text
true
{"atr":"0.3","terms":"lcp:sha256:0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30","id":"0xcfd11a6df93dae9b9ff76196eadf0939","parties":{"seller":"did:web:seller.example","buyer":"did:web:buyer.example"},"caps":{"USDC":"25000000"},"recourse":{"governingLaw":"US-NY","forum":"Arbitration Forum"}}
0xe6ad241521e947349b7d5e1cb19c122f478278a58d55665c6bc35143ef2a6f30
0x91daf472e22c818546b2ad77ce43711610b4c60860ac80e3f1a8270835d8d424
false
true
true
```

The document is emitted in one line with no whitespace, `atr` first, then the slots in the order they
were supplied. That string is the record. Its SHA-256 is the fourth line.

Note what the third and fourth lines are not: the same value. The `terms` reference names the terms
document; the ATR hash names this record.

## Where next

- [verification-walk.md](verification-walk.md) — what a verifier can establish about a record, step by
  step, and what it declines to establish.
- [welds.md](welds.md) — how the ATR hash gets into a settlement, and how it is read back out.
- [kernel README](../../../packages/kernel/README.md) — the API, the full refusal table, and the
  prototype-free record rule.
- [../getting-started.md](../getting-started.md) — the same assembly end to end, from a terms file up.
