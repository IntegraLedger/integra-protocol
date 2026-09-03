---
"@integraledger/lcp-kernel": patch
"@integraledger/lcp-conformance": patch
"@integraledger/lcp-verify": patch
---

0.15.0 shipped with `atrVersion` as the assembled ATR's first member; its 0.15.0 changelog entry, written
before that rename landed, names `atr`. This entry corrects the record: from 0.15.0 the first member is
`atrVersion`.

An assembled ATR's first member is `"atrVersion": "0.3"`, not `"atr": "0.3"`. No published release ever
emitted `"atr"` as the first member — 0.15.0's code already stamped `atrVersion`, and only its changelog
entry named the earlier spelling.

Why: a version field names what it versions. `"atr": "0.3"` names the artifact, and a reader can take it
for an identifier; `"atrVersion": "0.3"` is unmistakable on the wire. The bare `atr` was the only stamped
name that needed that sentence to be read correctly.

BREAKING for consumers: the `Atr` type's first member is `atrVersion`, `assemble` refuses a caller slot
named `atrVersion` with `assemble/reserved-slot`, `verify`'s recourse step recognises a kernel-assembled
ATR by that member, and every derived digest moves with it — every pinned vector hash was re-derived
independently and its superseded values recorded, and the corpus root moved with them.
