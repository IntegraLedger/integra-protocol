---
"@integraledger/lcp-kernel": patch
"@integraledger/lcp-conformance": patch
"@integraledger/lcp-verify": patch
---

0.15.0 was staged and withdrawn before publication; this ships in 0.15.1 as the first release after 0.14.0
to carry the first-member rename.

An assembled ATR's first member is `"atrVersion": "0.3"`, not `"atr": "0.3"`. This supersedes the 0.15.0
entry that named `atr` as the new first member: that version was staged and never published, so no record
in use ever carried either spelling, and this is the last moment the name can move.

Why: a version field names what it versions. `"atr": "0.3"` names the artifact, and a reader can take it
for an identifier; `"atrVersion": "0.3"` is unmistakable on the wire. The bare `atr` was the only stamped
name that needed that sentence to be read correctly.

BREAKING for consumers: the `Atr` type's first member is `atrVersion`, `assemble` refuses a caller slot
named `atrVersion` with `assemble/reserved-slot`, `verify`'s recourse step recognises a kernel-assembled
ATR by that member, and every derived digest moves with it — every pinned vector hash was re-derived
independently and its superseded values recorded, and the corpus root moved with them.
