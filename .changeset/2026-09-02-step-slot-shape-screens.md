---
"@integraledger/lcp-verify": patch
"@integraledger/lcp-conformance": patch
---

Three verification steps proved a rung over a slot they could not read. Each is now shape-screened on the
rule a sibling step in the same file already applied, so `steps.ts`'s own capitalised rule — ABSENT INPUTS
NEVER PROVE — holds for the untyped caller these steps exist for.

- `authorityStep` read `parentDelegable` for TRUTHINESS. ATA-3 gate one asks whether the parent was
  permitted to delegate at all, and every non-boolean but `0` and `""` cleared it: the strings `"false"`,
  `"no"` and `"0"`, an empty array, an empty object. It is now type-screened exactly as `revoked` and
  `active` are beside it, and as `authority.walkableGrant` screens `delegable` on the producing side — a
  non-boolean is `not-attempted("malformed-authority-chain")`. An ABSENT flag is unchanged and still
  `failed`: ATA-3 fixes a restrictive default, which is a ruling rather than a gap.
- `settlementStep` read `.length` on whatever the slot held. `.length` is `undefined` on an object, a
  number and a boolean, and `undefined === 0` is false, so `{}`, `42`, `true`, `"abc"` and the duck-typed
  `{ length: 5 }` all reached `proved` with zero settlements enumerated — on the rung that carries TC-1. A
  non-array is now `not-attempted("no-enumeration-port")`, the same token an absent slot gets and the same
  ruling `authorityStep` makes on a non-array chain.
- `commitmentStep` screened its two bounds halves with `typeof !== "object"`, which admits an array.
  `Object.keys([])` answers `[]`, so `isWithin` read an array as a bounds with no dimensions — unbounded —
  and skipped all four ATA-2 gates: a $50M commitment cleared ATA-4 containment against a leaf grant that
  was never readable. Both halves now go through `boundsShaped`, the screen written for this and never
  carried here. An empty-object leaf still PROVES, which is correct — an absent dimension is unbounded.

The corpus gains four `verify.authorityWalk` cases: three non-boolean `parentDelegable` shapes, and a
control pinning that an absent flag still fails rather than joining them as a gap. 852 → 856 cases; the
corpus root moved.

`verify`'s totality property was asserting only that the walk returns a boolean and a class inside the
ladder, which a walk that proves every rung over nonsense also satisfies — that is what hid the settlement
defect through 500 runs a time. It now also asserts that a step handed a slot it cannot read never answers
`proved`.
