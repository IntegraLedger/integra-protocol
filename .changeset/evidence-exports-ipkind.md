---
"@integraledger/lcp-evidence": patch
---

`ipKind` joins the evidence barrel, so a consumer can ask whether a string is an IP literal without restating the question

`resolver.ts` has exported `ipKind` at module level since it was written, and `index.ts` re-exported
four names from it and not that one — so `import { ipKind } from "@integraledger/lcp-evidence"` was
`TS2305` and the function was unreachable from outside the package.

⛔ **The range judgement was never the thing at risk.** `isUnicastPublic` — which addresses are
public — has always been exported and is imported by every consumer that needs it. What a consumer
could not reach is the far weaker question of whether a string is an IP literal at all, which
decides only whether to consult a resolver. `integra-agentic-commerce` wrote its own
`isAddressLiteral` for exactly that reason and said so in a docblock.

⇒ The reason to close it is not the duplication that happened but the one invited next: a barrel
that withholds half of a two-function judgement invites the next consumer to restate the *other*
half — the half that decides what "private" means — and nothing in either tree would catch that.
