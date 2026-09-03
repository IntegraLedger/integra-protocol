# @integraledger/lcp-kernel

ATR assembly and hashing — the smallest thing every other package agrees on.

An **ATR** (Agentic Transaction Record) is the standalone artifact whose SHA-256 is the **ATR hash** — the
fingerprint a settlement carries and a verifier recomputes. This kernel mints one as JSON: its `terms` slot
carries the agreement inline, or incorporates it by content-addressed reference.

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

const { atrBytes, atrHash } = await assemble([
  { slot: "terms", ref: "lcp:sha256:0xaaaa…" },
  { slot: "id", value: "0x3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f" },
  { slot: "parties", value: { seller: "did:web:seller.example", buyer: "did:web:buyer.example" } },
]);

isAtrHash(atrHash);                  // true
await hashAtr(atrBytes) === atrHash;  // true
```

A slot carries **exactly one** of `value` (inline) or `ref` (an `lcp:sha256:` content reference).
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

## Store the bytes, not the object

The corollary of the section above, and the one that costs people real evidence: **an ATR is a file, not a
data structure.** Retain `atrBytes` as opaque bytes. Reconstructing one later from the slot values will not
reproduce it unless you also kept their order, and a record whose bytes you cannot reproduce is a hash you
cannot open — which is the whole of its evidentiary value.

Two ways this is lost by default, both silent until the moment someone needs the record:

- **A key-reordering store.** PostgreSQL `jsonb` decomposes to a binary form that does not preserve key
  order and drops duplicate keys; `json` preserves the input text exactly. `jsonb` is the column type most
  guidance tells you to prefer, so the default choice is the wrong one here. Store `bytea`, `text`, or the
  file. Any ORM that round-trips through a parsed object has the same effect.
- **Re-serializing in another runtime.** A JavaScript `JSON.parse` → `JSON.stringify` round-trip happens to
  return the identical bytes, so a Node service can round-trip an ATR and never notice. Other runtimes
  differ by default: Python's `json.dumps` inserts a space after `:` and `,` and escapes non-ASCII unless
  called as `json.dumps(o, separators=(",", ":"), ensure_ascii=False)`. A verifier that re-serializes before
  hashing computes a different digest and reports a mismatch — which reads as counterparty tampering, not as
  a local encoding choice.

The safe rule is the simple one: hash what you received, and keep what you hashed.

## Refusals are typed and loud

Every guard has its own reason, because "the record is malformed" is not an actionable message:

| Refusal | Cause |
|---|---|
| `assemble/reserved-slot` | `atrVersion` is engine-stamped, not a caller's slot |
| `assemble/numeric-slot` | Integer-like slot names reorder under JSON serialization |
| `assemble/duplicate-slot` | The same slot supplied twice |
| `assemble/slot-shape` | Not exactly one of `value` \| `ref` |
| `assemble/bad-ref` | A `ref` that is not a well-formed `lcp:sha256:` reference |

The numeric-slot rule is subtler than it looks: JavaScript serializes integer-like keys first regardless
of insertion order, so a slot named `"1"` would jump ahead of the engine-stamped `atrVersion` field and change
the bytes. It is refused rather than silently reordered.

The assembled ATR is prototype-free, so a slot named `__proto__` becomes an ordinary key
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
