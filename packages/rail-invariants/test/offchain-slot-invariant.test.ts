/**
 * THE OFF-CHAIN SLOT INVARIANT — a rail that says "fetch the rest off-chain" must name a slot something
 * actually writes.
 *
 * Most rails carry the whole atrHash on-chain, so a reader never has to leave the ledger. `binding-stellar`
 * cannot: a CAP-67 muxed account's `id` is 8 bytes and an atrHash is 32, so the on-chain value is
 * `atrHash[:8]` and the binding's entire reader-facing instruction is *bring the full hash from the
 * placement and let the chain confirm the prefix*. That instruction is the rail's whole usable surface, and
 * it is only as good as the slot name in it.
 *
 * ★ WHY THIS FILE EXISTS. Until 2026-08-08 that instruction named a slot nothing writes, at seven `src`
 * sites. No LCP emitter has ever written that key. The shipped x402 placement writes
 * `extensions.legalContext.info`, and has since it was cut. A verifier following the instruction looked in
 * an empty slot and concluded the reference was absent — the worst available outcome, because "absent" is
 * indistinguishable from "this seller never welded a record" and reads as exculpatory.
 *
 * Two of the seven were not comments. `STELLAR_MANIFEST.finality.note` is published manifest text a
 * stranger reads before choosing the rail, and `STELLAR_PREFIX_NOTE` is the `note` returned to a caller
 * inside every partial recovery. Both shipped. The note was module-private until this invariant needed it;
 * exporting it is not a concession to the test — a caller who receives a string and cannot import it is
 * left matching on wording.
 *
 * ★ WHY IT LIVES HERE. The assertion is inherently cross-package — it compares a BINDING's prose against a
 * PLACEMENT's declared field — and `rail-invariants` is the only package permitted to depend on both without
 * inverting the tiers. Pinning the literal string inside `binding-stellar` instead would restate the
 * spelling rather than check it, and a rename would then move two copies of one fact in lockstep or not at
 * all, which is the failure being closed.
 */
import {
  STELLAR_MANIFEST,
  STELLAR_PREFIX_NOTE,
} from "@integraledger/lcp-binding-stellar";
import { X402_PLACEMENT } from "@integraledger/lcp-placement-x402";
import { describe, expect, it } from "vitest";

describe("binding-stellar's off-chain instruction names a slot that is written", () => {
  const written = X402_PLACEMENT.field;

  it("the placement still writes the field this invariant is about", () => {
    // Vacuity guard. If the placement's field is ever renamed to something the note happens to contain
    // already — or emptied — the assertions below would pass while meaning nothing.
    expect(written).toBe("extensions.legalContext.info");
  });

  it("the manifest's finality.note points at it", () => {
    // Published surface: this is what a stranger reads when deciding whether the rail's evidence is
    // strong enough, and it is the only place the manifest explains where the other 24 bytes are.
    expect(STELLAR_MANIFEST.finality.note).toContain(written);
  });

  it("the note returned by every partial recovery points at it", () => {
    // Returned to a caller inside every partial recovery. A note naming an unwritten slot sends them
    // somewhere empty at exactly the moment they are trying to establish whether a record exists.
    expect(STELLAR_PREFIX_NOTE).toContain(written);
  });

  it("neither surface names the slot nothing writes", () => {
    // `extensions.lcp.` rather than the full old string: any revival of that namespace is the same defect.
    for (const surface of [STELLAR_MANIFEST.finality.note, STELLAR_PREFIX_NOTE])
      expect(surface).not.toContain("extensions.lcp.");
  });
});
