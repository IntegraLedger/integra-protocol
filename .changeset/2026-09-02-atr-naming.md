---
"@integraledger/lcp-kernel": minor
"@integraledger/lcp-conformance": minor
"@integraledger/lcp-verify": minor
---

The ATR's type is named `Atr`, its bytes `atrBytes`, and one assembly input a `Slot`. The format version is
stamped as `atr` rather than `lcp`, which collided with the specification's own version line.

BREAKING for consumers: `Envelope` → `Atr`, `AtrFile`/`atrFile` → `AtrBytes`/`atrBytes`,
`Component` → `Slot`, refusal code `assemble/component-shape` → `assemble/slot-shape`, and an assembled ATR's
first member is now `"atr": "0.3"`. Every derived digest moves with that first member; the corpus areas
`envelope.assemble` and `envelope.schema` are now `atr.assemble` and `atr.schema`, every pinned vector hash
was re-derived independently with its superseded value recorded, and `verify`'s recourse step recognises a
kernel-assembled ATR by the new member. "Envelope" is reserved for what carries a record — the AP2 transport
envelope, the EIP-712 acceptance envelope — and names nothing the kernel mints.
