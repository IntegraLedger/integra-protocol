---
"@integraledger/lcp-binding-canton": minor
---

`propose` sends the `createdAt` the Daml template requires, and the drift gate no longer excuses it.

`daml/Main.daml` declares `createdAt : Text` as a required field of `LcpAnchor`. `buildAnchorPayload` sent
four fields and the name appeared nowhere in `src/`, so every create command this package built was one the
participant would reject with a Daml type error — at deployment time, on somebody else's ledger. The only
code that ever supplied it was this package's own live harness, which spread it onto the codec's output by
hand immediately before the create, which is why the on-chain proof passed over the defect.

⛔ The gate that exists for exactly this drift had been taught the exception: `test/daml-template.test.ts`
asserted the template's fields equal `[...sent, "createdAt"]`. A drift gate that names its own drift
asserts that the two sides agree except where they do not. The assertion is now a plain equality and the
harness submits the command as built.

**This changes published behaviour**: `createdAt` (ISO-8601 UTC, `Z`-terminated) is a REQUIRED input to
both `propose` and `buildAnchorPayload`. It is not defaulted to the current time — this codec is pure, a
builder that read the clock would emit a different payload for the same inputs, and the caller is the one
who knows when the settlement happened. `anchorCreatedAt` is exported for callers that want to validate the
stamp on its own; an offset or a local time is refused rather than normalized, so one instant has one
spelling on the ledger.
