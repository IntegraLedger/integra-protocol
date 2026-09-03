---
"@integraledger/lcp-discovery": patch
"@integraledger/lcp-binding-canton": patch
"@integraledger/lcp-evidence": patch
"@integraledger/lcp-binding-cardano": patch
---

Six gate weaknesses, and the three shipped case-folds one of them was not reaching.

- `check:dist` was the only gate in `scripts/` with no non-empty floor: an unbuilt tree printed
  `0 build outputs across 0 packages` and exited 0. Driven by `pnpm clean` — it now refuses.
- `spec-version.test.ts` claimed to catch "a future package that hardcodes the string" over a literal
  two-element array of paths, which by construction cannot contain a future package.
  `binding-cardano/src/metadata.ts` already carried the literal twice, in docblocks reading
  `e.g. "0.1.38"`. The subject set is derived from every `packages/*/src/**/*.ts`, exempting only the
  definition; the two comments now name the constant instead of a revision.
- `atrhash-case-invariant` said "nothing in the tree case-folds an atrHash except this file" while three
  files did. Its regex admitted a bracket but not the quote inside one, and required the fold to sit
  against the name, so `doc["atrHash"].toLowerCase()`, `stripHexPrefix(atrHash).toLowerCase()` and
  `atrHashFromCid(cid).toLowerCase()` were all invisible. Widened, and the three sites now go through the
  kernel: `discovery`'s emit path and `binding-canton`'s ledger-text form call `canonicalAtrHash` (one
  validation and one fold, in the one place that owns both), and `evidence`'s fold is gone — the value it
  folded is lowercase by construction.
- `vectors/legal-context/schema.json` is what a third party validates against, generated from the Zod
  schema, and guarded only by two `toContain` assertions. It had already drifted: its `description` was
  missing a word the generator emits. The vector is re-rendered and pinned by equality on the parsed value.
- `release.yml`'s packing loop read `|| continue`, and a `require` that throws exits 1 exactly as a private
  package does — so a manifest with a stray comma silently left the publishable set and the run stayed
  green. The probe now exits 2 for an unreadable manifest and the release stops. `publish-integrity.mjs`
  had the same collapse in a `catch { continue }` and now distinguishes ENOENT from a parse failure.
- `tags.yml` annotated two pinned action SHAs `v5.0.1` and `v6.0.0`; the same SHAs are annotated `v7.0.1`
  and `v7.0.0` at twenty other sites in this repository. The SHA is what pins, so nothing was exploitable —
  the comment is what a reviewer reads.

Behaviour: `emit` and `atrHashToLedgerText` now throw the kernel's message rather than each package's own
on a malformed atrHash. Both threw before.

The corpus root moves to `c2875add14f5f2bf…` — the schema vector's re-render is a sealed file.
