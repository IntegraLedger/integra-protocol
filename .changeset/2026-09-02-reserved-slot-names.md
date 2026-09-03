---
"@integraledger/lcp-kernel": patch
"@integraledger/lcp-conformance": patch
---

`assemble` refuses the slot names `lcp` and `atr` with `assemble/reserved-slot`, beside the `atrVersion`
refusal it already made. `lcp` names the specification, and bare on the wire it is ambiguous between a
version, a reference and a label; `atr` names the record itself. A profile that records the specification
version it targets uses an ordinary, clearly named slot — `lcpVersion` — which stays open.

The corpus gains four `atr.assemble` cases: `atrVersion` as a caller's slot refused, which the kernel had
done since the member existed and the corpus had never pinned; `lcp` refused; `atr` refused; and
`lcpVersion` preserved verbatim, so the openness is pinned rather than inherited. 848 → 852 cases; the
corpus root moved.
