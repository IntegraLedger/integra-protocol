import {
  type LegalContextAdvertisement,
  makePlacement,
  type Outcome,
  type ReferencePlacementAdapter,
  readAtPath,
  writeToContainer,
} from "@integraledger/lcp-binding-core";
import { LEGAL_CONTEXT_SCHEMA, X402_PLACEMENT } from "./manifest.js";

const base = makePlacement(X402_PLACEMENT);

/**
 * The x402 reference placement — the kit, plus the ONE wrapper the kit cannot know.
 *
 * x402's slot does not hold the reference directly: it holds `{ info, schema }`, where `info` is the
 * carrier payload and `schema` is the inlined JSON Schema describing it (a REQUIRED member per x402
 * §5.1.2). That wrapper is a protocol fact no container kind models, so `place` is overridden — but as
 * COMPOSITION over `base.place`, not as a reimplementation beside it. The kit performs the entire
 * placement first: the advertisement rules (terms URL demanded of an integrity-bearing reference,
 * refused where malformed), the canonical write into `extensions.legalContext.info`, the bare-hash
 * mirror into `accepts[0].extra.atrHash`, the terms-URL writes into BOTH declared slots, every
 * malformed-container refusal, and purity. The override then does exactly one thing: rebuilds our entry
 * as `{ info, schema }` so the wrapper's second member lands beside the payload the kit just wrote.
 *
 * The predecessor override reimplemented the write wholesale — sibling preservation, own-property
 * walks, the malformed-`extensions` refusal, all restated beside the kit's copies — which is how it
 * could drift: it froze a schema and never wrote a terms URL while the kit's manifest declared one
 * (integra-protocol#8). A one-member rebuild has no room to disagree with the manifest, because
 * everything the manifest declares is discharged before it runs.
 *
 * Rebuilding the ENTRY wholesale (rather than merging `schema` into whatever sits there) is the
 * predecessor's ratified behaviour, kept: our entry is the direct holder and is REPLACED, so junk a
 * counterparty parked inside `extensions.legalContext` does not ride our wire; sibling entries in
 * `extensions` survive untouched, per the host's own echo rule. `extract` is the kit's, unchanged —
 * reading `info` is an ordinary object-path read, the alias and both terms-URL slots are declared data,
 * and reconciliation lives where every protocol shares it.
 */
export const x402Placement: ReferencePlacementAdapter = {
  ...base,

  place(ad: LegalContextAdvertisement, doc: unknown): Outcome<unknown> {
    const placed = base.place(ad, doc);
    if ("refused" in placed) return placed;
    // The kit's write just created this path on its own output; reading it back — rather than re-encoding
    // the reference a second time — keeps one codepath responsible for what `info` contains.
    const info = readAtPath(placed.value, X402_PLACEMENT.field);
    const wrapped = writeToContainer(
      placed.value,
      X402_PLACEMENT.container,
      "extensions.legalContext",
      { info, schema: LEGAL_CONTEXT_SCHEMA },
    );
    if (wrapped === undefined)
      // Unreachable by construction — `placed.value` holds the record the kit wrote through — but a
      // wrapper that silently returned the unwrapped document on the impossible branch would ship a
      // challenge with no `schema`, so the branch refuses like every other malformed container.
      return {
        refused: true,
        haltClass: "verification-failure",
        code: "x402/document-malformed",
        detail:
          "the placed document lost its extensions map between two writes",
      };
    return { ok: true, value: wrapped };
  },
};
