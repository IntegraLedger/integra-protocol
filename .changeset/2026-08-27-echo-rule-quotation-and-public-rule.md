---
"@integraledger/lcp-conformance": patch
---

Correct a conformance vector that attributed LCP v1.37's withdrawn RFC-2119 capitals to the x402
specification itself.

`vectors/placement/x402.json`'s sibling-extension case was named *"clients MUST NOT delete or overwrite"*
and its `$comment` called that "x402's own rule about x402's own map". Neither half survives measurement.
The host states the rule in lower case and about the DATA rather than the map — the client "must include at
least the info received; it may append additional info but cannot delete or overwrite existing info" — and
`placement-x402`'s own README already records that v1.37 rendered it in capitals and that **v1.38 §C.4
withdrew that rendering**. So the package documentation and the shipped corpus disagreed about a
quotation, with the corpus carrying the superseded one into every consumer that reads the vectors.

The case now quotes the host verbatim and names the revision that changed. Behaviour is unchanged: only the
case name and its comment move, so the corpus counts hold at 44 areas / 847 cases / 82 files and only the
seal root moves.

Also adds `scorecard.yml`, which ran in the sibling public repository and not here — this repository
publishes thirty-one packages to that one's two — and a standing rule in `CLAUDE.md` that everything
written here is world-readable, which was stated only about commit history.
