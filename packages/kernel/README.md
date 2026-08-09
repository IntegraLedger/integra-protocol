# @integraledger/lcp-kernel

ATR assembly and hashing — the smallest thing every other package agrees on.

An **ATR** (Agreed Terms Record) is one canonical JSON document naming the terms, the parties, and the
commercial slots of a transaction. Its SHA-256 is the **ATR hash**: the fingerprint a settlement carries
and a verifier recomputes.

Zero runtime dependencies, by design and by enforced rule. Everything downstream is free to depend on
this; it depends on nothing.

```bash
npm install @integraledger/lcp-kernel
```

The base of the tree: no dependencies at all, and every other package here is built on it. The next
layer up is [`@integraledger/lcp-binding-core`](../binding-core#readme), which adds the carrier codec
and the rail port.

## Use

```ts
import { assemble, hashAtr, isAtrHash } from "@integraledger/lcp-kernel";

const { atrFile, atrHash } = await assemble([
  { slot: "terms", ref: "lcp:sha256:0xaaaa…" },
  { slot: "id", value: "0x3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f" },
  { slot: "parties", value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" } },
]);

isAtrHash(atrHash);                  // true
await hashAtr(atrFile) === atrHash;  // true
```

A component carries **exactly one** of `value` (inline) or `ref` (an `lcp:sha256:` content reference).
Both, or neither, is a typed refusal rather than a guess.

## Why the bytes are hashed as handed

`hashAtr` hashes the exact bytes it is given. It does not re-assemble, re-order, or canonicalize them.

This is the opposite of the rule for a verification *report*, which is canonicalized with RFC 8785 — and
conflating the two is the mistake worth naming. A report has many independent producers that must
converge on identical bytes, so it needs a canonical form. An ATR has exactly one producer, and the
received bytes *are* the fingerprint. Canonicalizing them at verification time would mean the verifier
hashes something the payer never signed.

`normalizeTerms` is offered for authoring surfaces to stabilize a terms document *before* it is
fingerprinted — CRLF to LF, trailing newlines collapsed to one, NFC. It never runs inside `assemble`.

## Refusals are typed and loud

Every guard has its own reason, because "the record is malformed" is not an actionable message:

| Refusal | Cause |
|---|---|
| `assemble/reserved-slot` | `lcp` is engine-stamped, not a caller's component |
| `assemble/numeric-slot` | Integer-like slot names reorder under JSON serialization |
| `assemble/duplicate-slot` | The same slot supplied twice |
| `assemble/component-shape` | Not exactly one of `value` \| `ref` |
| `assemble/bad-ref` | A `ref` that is not a well-formed `lcp:sha256:` reference |

The numeric-slot rule is subtler than it looks: JavaScript serializes integer-like keys first regardless
of insertion order, so a slot named `"1"` would jump ahead of the engine-stamped `lcp` field and change
the bytes. It is refused rather than silently reordered.

The assembled envelope is prototype-free, so a component named `__proto__` becomes an ordinary key
instead of vanishing from `JSON.stringify` and mutating a prototype on the way past.

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
